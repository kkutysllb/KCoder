"""KCoder /v1/threads 路由 — 5 个核心端点 + 字段映射.

这是 MVP 的核心交付物：将 KCoder renderer 的 /v1/* API 契约翻译到
LangGraph Platform REST API。

字段映射表（关键）::

    KCoder ThreadResponse      LangGraph thread object
    { id }                   ← { thread_id }
    { createdAt }            ← { created_at }
    { workspace, model, ...} ← { metadata.workspace, metadata.model, ... }
    { title }                ← { metadata.title }

端点对照::

    POST   /v1/threads               → POST /threads (LangGraph)
    GET    /v1/threads               → POST /threads/search
    DELETE /v1/threads/{id}          → DELETE /threads/{id}
    POST   /v1/threads/{id}/turns    → 异步启动 stream_run，立即返回 turnId
    GET    /v1/threads/{id}/events   → SSE 转发（sse.py 翻译）
"""

from __future__ import annotations

import asyncio
import json
import logging
import urllib.parse
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import PlainTextResponse, StreamingResponse
from pydantic import BaseModel

from .sse import (
    ActiveRun,
    RunRegistry,
    consume_langgraph_stream,
    sse_event_generator,
    workspace_tracker,
    _extract_reasoning_text,
)
from .qilin_client import QiLinClient
from .projects_routes import ensure_project
from . import thread_log

logger = logging.getLogger("kcoder_gateway.threads")

router = APIRouter(prefix="/v1", tags=["threads"])


# ────────────────────────────────────────────────────────────────
# 请求/响应模型
# ────────────────────────────────────────────────────────────────


class CreateThreadRequest(BaseModel):
    title: str | None = None
    workspace: str | None = None
    model: str | None = None
    workModeId: str | None = "coding"
    mode: str | None = None


class StartTurnRequest(BaseModel):
    prompt: str
    attachmentIds: list[str] | None = None
    model_name: str | None = None
    subagent_enabled: bool = False
    # 推理深度：auto / off / low / medium / high（auto 不传，让 QiLin 用默认）
    reasoning_mode: str | None = None
    # 计划模式：启用 QiLin TodoMiddleware（write_todos 工具）——InfoPanel
    # 「进度」段依赖它产生 todos 数据。默认 True（编码任务均受益）。
    is_plan_mode: bool = True
    # 执行权限模式（KCoder 运行权限）：plan-mode / auto-edit / full-access /
    # confirm-before-change。引擎 PermissionMiddleware 在每个 mutating 工具
    # 执行前按模式拦截。默认 auto-edit（编辑放行 + 危险命令拒绝）。
    permission_mode: str | None = None
    # 已批准操作 id 列表（confirm-before-change 模式审批通过后由前端带回），
    # 命中 (tool,args) 稳定 hash 的工具调用放行一次。
    approved_ops: list[str] | None = None


# ────────────────────────────────────────────────────────────────
# 字段映射辅助函数
# ────────────────────────────────────────────────────────────────

# QiLin DynamicContextMiddleware 的 ID-swap 后缀：
#   - 真实用户消息 id = "{stable_id}__user"
#   - 注入的 memory reminder HumanMessage id = "{stable_id}__memory"
# 与 vendor/qilin/qilin/agents/middlewares/dynamic_context_middleware.py
# 的 INJECTED_USER_MESSAGE_ID_SUFFIX / __memory 保持一致。
INJECTED_USER_MESSAGE_ID_SUFFIX = "__user"
INJECTED_MEMORY_MESSAGE_ID_SUFFIX = "__memory"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _get_metadata(thread: dict[str, Any]) -> dict[str, Any]:
    """安全提取 LangGraph thread 的 metadata 字典."""
    meta = thread.get("metadata")
    if isinstance(meta, dict):
        return meta
    return {}


def _to_thread_response(thread: dict[str, Any]) -> dict[str, Any]:
    """LangGraph thread → KCoder ThreadResponse."""
    meta = _get_metadata(thread)
    return {
        "id": thread.get("thread_id", ""),
        "createdAt": thread.get("created_at", _now_iso()),
        "workspace": meta.get("workspace", ""),
        "model": meta.get("model"),
        "mode": meta.get("mode"),
        "workModeId": meta.get("workModeId", "coding"),
        "title": meta.get("title", "New Chat"),
    }


def _to_thread_summary(thread: dict[str, Any]) -> dict[str, Any]:
    """LangGraph thread → KCoder ThreadSummary."""
    meta = _get_metadata(thread)
    return {
        "id": thread.get("thread_id", ""),
        "title": meta.get("title", "New Chat"),
        "workspace": meta.get("workspace", ""),
        "model": meta.get("model"),
        "mode": meta.get("mode"),
        "workModeId": meta.get("workModeId", "coding"),
        # LangGraph 没有 thread status 概念，统一返回 idle
        "status": "idle",
        "createdAt": thread.get("created_at", ""),
        "updatedAt": thread.get("updated_at", ""),
        "archived": bool(meta.get("archived", False)),
    }


# ────────────────────────────────────────────────────────────────
# 依赖获取（从 app.state）
# ────────────────────────────────────────────────────────────────


def _get_client(request: Request) -> QiLinClient:
    client = getattr(request.app.state, "qilin_client", None)
    if client is None:
        raise HTTPException(status_code=503, detail="QiLin client not initialized")
    return client


def _get_registry(request: Request) -> RunRegistry:
    registry = getattr(request.app.state, "run_registry", None)
    if registry is None:
        raise HTTPException(status_code=503, detail="Run registry not initialized")
    return registry


def _get_assistant_id(request: Request) -> str:
    assistant_id = getattr(request.app.state, "assistant_id", None)
    if not assistant_id:
        raise HTTPException(
            status_code=503,
            detail="Default assistant not found — ensure langgraph dev is running",
        )
    return assistant_id


# ────────────────────────────────────────────────────────────────
# 端点 1: POST /v1/threads — 创建会话
# ────────────────────────────────────────────────────────────────


@router.post("/threads")
async def create_thread(req: CreateThreadRequest, request: Request) -> dict[str, Any]:
    """创建新 thread.

    renderer 总是传 workModeId='coding'（见 engine-api.ts createThread）。
    KCoder 风格的字段存入 LangGraph thread.metadata，list/get 时原样取回。
    """
    client = _get_client(request)

    metadata = {
        "title": req.title or "New Chat",
        "workspace": req.workspace or "",
        "workModeId": req.workModeId or "coding",
    }
    if req.model:
        metadata["model"] = req.model
    if req.mode:
        metadata["mode"] = req.mode

    # 绑定 workspace → 自动注册项目（upsert by path，失败不阻断建线程）。
    # 保证侧边栏「项目」分区总能覆盖到每个任务。
    if req.workspace:
        try:
            ensure_project(request, req.workspace)
        except Exception:
            logger.warning(
                "Failed to auto-register project for %s", req.workspace, exc_info=True
            )

    thread = await client.create_thread(metadata=metadata)

    # 同步落一份元数据到 KCoder 自有 thread-log：langgraph dev 多实例/重启
    # 会清空其存储（线程列表直接消失 → 侧边栏全空）。list_threads 会用
    # 日志合并回这些线程，点开后走 get_thread 的日志回退读消息。
    thread_log.save_thread_meta(
        thread.get("thread_id", ""),
        {
            "title": metadata["title"],
            "workspace": metadata["workspace"],
            "model": metadata.get("model"),
            "mode": metadata.get("mode"),
            "workModeId": metadata["workModeId"],
            "createdAt": datetime.now(timezone.utc).isoformat(),
        },
    )
    return _to_thread_response(thread)


# ────────────────────────────────────────────────────────────────
# 端点 2: GET /v1/threads — 列出会话
# ────────────────────────────────────────────────────────────────


@router.get("/threads")
async def list_threads(request: Request, limit: int = 200, include_archived: bool = False) -> dict[str, Any]:
    """列出所有 threads.

    renderer 调 GET /v1/threads?limit=200，期望 {threads: [ThreadSummary]}.
    LangGraph 的列表端点是 POST /threads/search（注意不是 GET）。

    ``include_archived=False`` 时过滤掉已归档的 thread（metadata.archived=True）。
    """
    client = _get_client(request)

    try:
        threads = await client.search_threads(limit=limit)
    except Exception as exc:
        # langgraph 不可达：不直接 502——thread-log 合并仍能给出已知线程
        #（侧边栏在引擎重启间隙保持可用）。
        logger.warning("Failed to search threads, falling back to thread_log: %s", exc)
        threads = []

    summaries = [_to_thread_summary(t) for t in threads]

    # 合并 KCoder 自有 thread-log 里的线程（langgraph 存储被清空时补回）：
    # langgraph 列表缺失的线程，用日志元数据 + 首条 prompt 合成 ThreadSummary。
    try:
        seen_ids = {s.get("id") for s in summaries}
        for entry in thread_log.list_logged_threads():
            tid = entry.get("threadId") or ""
            if not tid or tid in seen_ids:
                continue
            meta = entry.get("meta") or {}
            first_turn_at = meta.get("createdAt") or entry.get("savedAt") or ""
            summaries.append(
                {
                    "id": tid,
                    "title": meta.get("title")
                    or (str(entry.get("prompt") or "")[:40] or "New Chat"),
                    "workspace": meta.get("workspace", ""),
                    "model": meta.get("model"),
                    "mode": meta.get("mode"),
                    "workModeId": meta.get("workModeId", "coding"),
                    "status": "idle",
                    "createdAt": first_turn_at,
                    "updatedAt": entry.get("savedAt") or first_turn_at,
                    "archived": bool(meta.get("archived", False)),
                }
            )
    except Exception:
        logger.warning("thread_log merge in list_threads failed", exc_info=True)

    if not include_archived:
        summaries = [s for s in summaries if not s.get("archived")]
    return {"threads": summaries}


# ────────────────────────────────────────────────────────────────
# 端点 3: DELETE /v1/threads/{id} — 删除会话
# ────────────────────────────────────────────────────────────────


@router.delete("/threads/{thread_id}")
async def delete_thread(thread_id: str, request: Request) -> dict[str, Any]:
    """删除 thread. renderer 期望返回 {deleted: bool}.

    langgraph dev 的 checkpoint 在多实例/重启下会丢——thread 可能只在本地
    thread-log（兜底）里、LangGraph state 已 404。因此：
      1. 先删本地 thread-log；
      2. 再删 LangGraph（best-effort，404 视为已删、不再视为失败）。
    只要本地日志已删，即返回 deleted:true，避免「列表可见却删不掉」。
    """
    client = _get_client(request)

    # 1. 删除本地兜底日志（幂等）
    thread_log.delete_thread(thread_id)

    # 2. 删除 LangGraph thread（best-effort；404 说明 state 已丢，不算失败）
    try:
        await client.delete_thread(thread_id)
    except Exception:
        logger.warning(
            "delete_thread: LangGraph delete failed for %s (non-fatal)", thread_id,
            exc_info=True,
        )

    return {"deleted": True}


# ────────────────────────────────────────────────────────────────
# 端点 3b: PATCH /v1/threads/{id} — 更新 thread metadata（title 等）
# ────────────────────────────────────────────────────────────────


class UpdateThreadRequest(BaseModel):
    """PATCH /v1/threads/{id} 请求体。

    允许更新 title 和 archived 标记；workspace 等其他字段经讨论不应被随意修改
    （workspace 在创建时绑定，后续变更会打乱侧边栏项目归类）。
    """
    title: str | None = None
    archived: bool | None = None


@router.patch("/threads/{thread_id}")
async def update_thread(
    thread_id: str, req: UpdateThreadRequest, request: Request
) -> dict[str, Any]:
    """更新 thread metadata（合并式，不替换其他字段）。

    LangGraph 的 Threads.patch 把传入的 metadata 合并到现有 metadata，
    所以只传 title 不会覆盖 workspace/model/workModeId。
    """
    client = _get_client(request)

    metadata: dict[str, Any] = {}
    if req.title is not None:
        title = req.title.strip()
        if not title:
            raise HTTPException(status_code=400, detail="title cannot be empty")
        metadata["title"] = title

    if req.archived is not None:
        metadata["archived"] = req.archived

    if not metadata:
        raise HTTPException(status_code=400, detail="no updatable fields provided")

    try:
        thread = await client.update_thread_metadata(thread_id, metadata)
    except Exception as exc:
        logger.exception("Failed to update thread %s", thread_id)
        raise HTTPException(status_code=502, detail=f"Upstream error: {exc}") from exc

    return _to_thread_response(thread)


# ────────────────────────────────────────────────────────────────
# Title 自动生成辅助
# ────────────────────────────────────────────────────────────────


def _generate_title_from_prompt(prompt: str, *, max_len: int = 40) -> str:
    """从首条用户消息生成可读 title。

    规则：取首行/首句，去除多余空白，截断到 max_len 字符并加省略号。
    代码标识符/路径/中文均可保留。对于多行 prompt（如粘贴代码），
    取首行避免 title 过长。
    """
    first_line = prompt.strip().splitlines()[0] if prompt.strip() else ""
    # 去除 markdown 代码块标记、# 标题标记等前缀噪音
    cleaned = first_line.lstrip("#`*->").strip()
    if not cleaned:
        cleaned = first_line.strip() or "New Chat"
    if len(cleaned) > max_len:
        return cleaned[:max_len].rstrip() + "…"
    return cleaned


async def _safe_update_title(client: Any, thread_id: str, title: str) -> None:
    """后台安全更新 title，失败仅记日志（不阻断 turn）."""
    try:
        await client.update_thread_metadata(thread_id, {"title": title})
        logger.info("Auto-updated title for thread %s: %r", thread_id, title)
    except Exception:
        logger.warning("Failed to auto-update title for thread %s", thread_id, exc_info=True)


async def _safe_update_metadata(client: Any, thread_id: str, metadata: dict[str, Any]) -> None:
    """后台安全更新 thread 元数据，失败仅记日志（不阻断 turn）."""
    try:
        await client.update_thread_metadata(thread_id, metadata)
        logger.info(
            "Auto-updated metadata for thread %s: %s",
            thread_id,
            sorted(metadata),
        )
    except Exception:
        logger.warning(
            "Failed to auto-update metadata for thread %s", thread_id, exc_info=True
        )


async def _resolve_workspace(client: Any, thread_id: str) -> tuple[str | None, str]:
    """解析 turn 的 workspace 绑定，返回 (workspace_path, current_title).

    解析顺序：LangGraph thread metadata → thread-log 元数据兜底。

    兜底不依赖 get_thread 抛异常：重启后第一次恢复运行时
    ``if_not_exists="create"`` 会在 LangGraph 侧重建一个**空元数据**线程，
    此后 get_thread 成功但 meta.workspace 为空——若只在异常分支兜底，
    sandbox 会把 /mnt/user-data/workspace 映射到默认空目录，agent 找不到
    项目（历史任务重启后「工作区是空的」澄清卡 bug 的根因）。
    """
    workspace_path: str | None = None
    current_title = "New Chat"
    try:
        thread = await client.get_thread(thread_id)
        meta = _get_metadata(thread)
        workspace_path = meta.get("workspace", "") or None
        current_title = meta.get("title", "New Chat")
    except Exception:
        # 线程在 LangGraph 侧丢失（重启后 checkpoint 丢）——继续走兜底。
        logger.debug(
            "thread metadata fetch failed for %s (langgraph thread lost?)",
            thread_id,
            exc_info=True,
        )

    if not workspace_path:
        try:
            logged = thread_log.load_thread(thread_id)
            recovered = ((logged or {}).get("meta") or {}).get("workspace") or None
            if recovered:
                workspace_path = recovered
                logger.info(
                    "start_turn: workspace recovered from thread_log: %s", recovered
                )
                # 自愈：把恢复的 workspace 写回 LangGraph 元数据，后续 turn
                # 直接命中，不再依赖兜底（线程不存在时写回失败仅记日志）。
                asyncio.create_task(
                    _safe_update_metadata(client, thread_id, {"workspace": recovered})
                )
            else:
                logger.info(
                    "start_turn: no workspace for thread %s (langgraph meta and thread_log both empty)",
                    thread_id,
                )
        except Exception:
            logger.warning("thread_log meta fallback failed", exc_info=True)

    return workspace_path, current_title


# ────────────────────────────────────────────────────────────────
# 端点 4: POST /v1/threads/{id}/turns — 发消息（异步启动）
# ────────────────────────────────────────────────────────────────


@router.post("/threads/{thread_id}/turns")
async def start_turn(
    thread_id: str, req: StartTurnRequest, request: Request
) -> dict[str, Any]:
    """发消息启动一个 turn.

    renderer 的流程（见 engine-api.ts sendMessage）::

        1. POST /v1/threads/:id/turns {prompt}  → 立即返回 {turnId}
        2. GET  /v1/threads/:id/events          → SSE 流式响应

    本端点：
    - 生成 turn_id / user_message_id（LangGraph 不提供这些，gateway 合成）
    - 启动后台 consume_langgraph_stream 任务
    - 立即返回，不阻塞

    SSE 翻译在 sse.py 中完成（D2 决策点：gateway 侧转换）。
    """
    client = _get_client(request)
    registry = _get_registry(request)
    assistant_id = _get_assistant_id(request)

    turn_id = str(uuid.uuid4())
    user_message_id = str(uuid.uuid4())

    run = ActiveRun(
        thread_id=thread_id,
        turn_id=turn_id,
        user_message_id=user_message_id,
    )

    # 注册（会取消同 thread 上之前的 run）
    registry.register(run)

    # Phase 6: 获取当前 user_id，注入 LangGraph configurable
    # （未登录时 user_id=None，QiLin 会用默认用户）
    from .auth.middleware import get_current_user

    current_user = await get_current_user(request)
    user_id = current_user.id if current_user else None

    # 读取 thread metadata：提取 workspace_path 和自动更新 title
    workspace_path, current_title = await _resolve_workspace(client, thread_id)
    if current_title == "New Chat" and req.prompt.strip():
        new_title = _generate_title_from_prompt(req.prompt)
        if new_title != "New Chat":
            asyncio.create_task(
                _safe_update_title(client, thread_id, new_title)
            )

    # 注入附件内容：把附件文本拼成 <user_attachments> 块 prepend 到 prompt，
    # 让 agent 真正读到用户上传的文件（修复 stub 时代"上传假成功、agent 读不到"）。
    # 二进制附件只列元信息；失败不阻断 turn（按无附件处理）。
    effective_prompt = req.prompt
    if req.attachmentIds:
        try:
            from .attachments_routes import build_attachments_block

            block = build_attachments_block(request, req.attachmentIds)
            if block:
                effective_prompt = f"{block}\n\n{req.prompt}"
        except Exception:
            logger.debug("attachments injection failed", exc_info=True)

    # 启动后台消费任务
    run.task = asyncio.create_task(
        consume_langgraph_stream(
            client, registry, run, assistant_id, effective_prompt,
            user_id=user_id, model_name=req.model_name,
            subagent_enabled=req.subagent_enabled,
            reasoning_mode=req.reasoning_mode,
            workspace_path=workspace_path,
            is_plan_mode=req.is_plan_mode,
            permission_mode=req.permission_mode,
            approved_ops=req.approved_ops,
        )
    )

    logger.info(
        "Turn started: thread=%s turn=%s prompt=%d chars",
        thread_id,
        turn_id,
        len(req.prompt),
    )

    return {
        "threadId": thread_id,
        "turnId": turn_id,
        "userMessageItemId": user_message_id,
    }


# ────────────────────────────────────────────────────────────────
# 端点 5: GET /v1/threads/{id}/events — SSE 流式响应
# ────────────────────────────────────────────────────────────────


@router.get("/threads/{thread_id}/events")
async def stream_events(thread_id: str, request: Request) -> StreamingResponse:
    """SSE 事件流 — 转发 ActiveRun 中的翻译事件到 renderer.

    renderer 用 fetch + ReadableStream 消费（非 EventSource，因为需要
    Authorization header）。每帧格式::

        data: {"kind": "assistant_text_delta", "delta": "..."}\n\n

    终端事件（turn_completed/turn_failed/turn_aborted）后流自动关闭。
    """
    registry = _get_registry(request)
    run = registry.get(thread_id)

    if run is None:
        # 没有活跃的 turn — 返回一个 turn_failed 让 renderer 关闭连接
        async def _no_active_run() -> bytes:
            yield (
                f"data: {json.dumps({'kind': 'turn_failed', 'turnId': '', 'threadId': thread_id, 'message': 'No active turn'})}\n\n".encode()
            )

        return StreamingResponse(
            _no_active_run(), media_type="text/event-stream"
        )

    return StreamingResponse(
        sse_event_generator(run),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # 禁用 nginx 缓冲
            "Connection": "keep-alive",
        },
    )


# ────────────────────────────────────────────────────────────────
# 附加端点: GET /v1/threads/{id} — 获取单个 thread（renderer loadThread 用）
# ────────────────────────────────────────────────────────────────


@router.get("/threads/{thread_id}")
async def get_thread(thread_id: str, request: Request) -> dict[str, Any]:
    """获取单个 thread 详情（含消息历史）.

    renderer 的 loadThread 期望返回 {turns: [{items: [...]}]}.
    我们从 LangGraph thread state 提取 messages，翻译成 KCoder item 结构。
    """
    client = _get_client(request)

    thread: dict[str, Any] = {}
    state: dict[str, Any] = {}
    try:
        thread = await client.get_thread(thread_id)
        state = await client.get_thread_state(thread_id)
    except Exception as exc:
        # langgraph 不可达/线程丢失：不 502——落到下方 thread-log 回退，
        # 用日志元数据 + 已落盘 turns 兜底（引擎重启间隙历史仍可看）。
        logger.warning("get_thread upstream miss for %s, using thread_log: %s", thread_id, exc)

    if not thread:
        # 用日志元数据合成 thread 基本结构（列表/标题/workspace 归属）
        logged = thread_log.load_thread(thread_id)
        meta = (logged or {}).get("meta") or {}
        if not meta:
            raise HTTPException(status_code=404, detail="thread not found")
        thread = {
            "thread_id": thread_id,
            "created_at": meta.get("createdAt"),
            "updated_at": meta.get("savedAt"),
            "metadata": meta,
        }

    # 从 state 提取消息列表。兼容不同 langgraph-api 版本的 state 响应结构：
    # 多数版本 {"values": {...}}，部分用 {"channel_values": {...}}，极少数直接是 values。
    values = thread_log.extract_state_values(state)
    messages = values.get("messages", []) if isinstance(values, dict) else []

    # 将 LangChain messages 翻译成 KCoder item 结构
    items: list[dict[str, Any]] = []
    for msg in messages:
        item = _message_to_item(msg)
        if item:
            items.append(item)

    logger.info(
        "get_thread %s: state keys=%s, messages=%d, items=%d",
        thread_id,
        list(state.keys()) if isinstance(state, dict) else type(state).__name__,
        len(messages) if isinstance(messages, list) else 0,
        len(items),
    )

    base = _to_thread_response(thread)
    turns: list[dict[str, Any]] = [{"id": "turn-0", "items": items}] if items else []
    if not turns:
        # 兜底：langgraph dev 重启后 state 可能读不出（values 空）→ 回退到
        # 网关自有的 thread-log（sse.py 每个 turn 结束时落盘）。
        logged = thread_log.log_turns(thread_id)
        if logged:
            # thread-log 每个 turn 存的是「当时累积的 state 消息」，跨 turn
            # 会重复携带同 id 的 items。这里按 id 去重、合并成单 turn，
            # 否则前端 loadThread 会渲染出重复消息（重复 React key）。
            seen_ids: set[str] = set()
            merged_items: list[dict[str, Any]] = []
            for t in logged:
                for item in t.get("items") or []:
                    iid = str(item.get("id", ""))
                    if iid and iid in seen_ids:
                        continue
                    if iid:
                        seen_ids.add(iid)
                    merged_items.append(item)
            if merged_items:
                turns = [{"id": "turn-0", "items": merged_items}]
            logger.info(
                "get_thread %s: state empty, thread_log fallback turns=%d items=%d (deduped)",
                thread_id, len(logged), len(merged_items),
            )
    base["turns"] = turns
    return base


def _message_to_item(msg: dict[str, Any]) -> dict[str, Any] | None:
    """LangChain message dict → KCoder TurnItem 结构.

    renderer 的 handleItemEvent 按 item.kind 分发：
    - assistant_text → 显示 AI 文本
    - tool_call → 显示工具调用
    - tool_result → 显示工具结果
    - user_message → 显示用户消息
    """
    if not isinstance(msg, dict):
        return None

    msg_type = str(msg.get("type", msg.get("role", "")))
    type_lower = msg_type.lower()
    msg_id = str(msg.get("id", ""))

    if "human" in type_lower:
        # ── 内部消息拦截（根因修复）───────────────────────────────
        # QiLin DynamicContextMiddleware 会把 memory reminder 注入为
        # HumanMessage（id 后缀 "__memory"，additional_kwargs.hide_from_ui=True），
        # 这是给 LLM 看的工作记忆，**不应** 通过 history API 暴露给客户端。
        # 若不拦截，前端 loadThread 会把它当 user_message 渲染 → 泄漏 <memory> 块。
        additional_kwargs = msg.get("additional_kwargs") or {}
        is_hidden = bool(additional_kwargs.get("hide_from_ui"))
        if msg_id.endswith(INJECTED_MEMORY_MESSAGE_ID_SUFFIX) or is_hidden:
            return None

        # 真实用户消息：QiLin ID-swap 后 id 带 "__user" 后缀，还原原始 id
        # （否则前端按 id 匹配会找不到对应消息）
        if msg_id.endswith(INJECTED_USER_MESSAGE_ID_SUFFIX):
            msg_id = msg_id[: -len(INJECTED_USER_MESSAGE_ID_SUFFIX)]

        return {
            "id": msg_id,
            "kind": "user_message",
            "role": "user",
            "text": _extract_text(msg.get("content", "")),
        }

    if "ai" in type_lower:
        text = _extract_text(msg.get("content", ""))
        item: dict[str, Any] = {
            "id": msg_id,
            "kind": "assistant_text",
            "role": "assistant",
            "text": text,
        }
        # 思考内容（reasoning_content）：历史消息里同样存于
        # additional_kwargs.reasoning_content / 顶层 reasoning_content，
        # 与 sse.py 的实时提取保持一致，否则前端 loadThread 会丢失思考块。
        reasoning = _extract_reasoning_text(msg)
        if reasoning:
            item["reasoning"] = reasoning
        # 附带工具调用（如果有）
        tool_calls = msg.get("tool_calls") or []
        if tool_calls:
            item["toolCalls"] = [
                {
                    "id": tc.get("id", ""),
                    "toolName": tc.get("name", ""),
                    "args": tc.get("args", {}),
                }
                for tc in tool_calls
                if isinstance(tc, dict)
            ]
        return item

    if msg_type == "tool":
        return {
            "id": msg_id,
            "kind": "tool_result",
            "role": "tool",
            "toolName": str(msg.get("name", "")),
            "callId": str(msg.get("tool_call_id", "")),
            "output": _extract_text(msg.get("content", "")),
        }

    return None


def _extract_text(content: Any) -> str:
    """从 LangChain content 提取纯文本（复用 sse.py 的逻辑）."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, dict):
                if block.get("type") == "text":
                    parts.append(str(block.get("text", "")))
            elif isinstance(block, str):
                parts.append(block)
        return "".join(parts)
    return ""


# ────────────────────────────────────────────────────────────────
# Turn 控制端点: steer / interrupt / compact (Phase 5 stub)
# ────────────────────────────────────────────────────────────────


@router.post("/threads/{thread_id}/turns/{turn_id}/steer")
async def steer_turn(thread_id: str, turn_id: str, request: Request) -> dict[str, Any]:
    """POST /v1/threads/:id/turns/:turnId/steer → 方案 A「打断重发」的打断半边。

    前端 steer 流程：先调 stopGeneration（→ interruptTurn，即本端点打断当前
    run），再以 steer 文本 sendMessage 发起新 turn。因此本端点只负责中断当前
    run；真正的新 turn 由前端随后发起（复用 sendMessage 的订阅通道）。
    """
    logger.info("steer: interrupt current run (方案 A) thread=%s turn=%s", thread_id, turn_id)
    return await interrupt_turn(thread_id, turn_id, request)


@router.post("/threads/{thread_id}/turns/{turn_id}/interrupt")
async def interrupt_turn(thread_id: str, turn_id: str, request: Request) -> dict[str, Any]:
    """POST /v1/threads/:id/turns/:turnId/interrupt → 真实中断。

    流程：
      1. 先向 event_queue 推 turn_aborted + None 哨兵（前端据此正常收尾，
         不会把流关闭误判为「掉线重连」）。
      2. 取消后台消费任务（其 finally 会再推 None + registry.remove_if_current
         身份校验清理，幂等，且不会误删 steer 已注册的新 run）。
      3. 取消 LangGraph run（若 run_id 已从 metadata 事件捕获）。
      4. 立即从 registry 移除，避免残留占用同 thread 的下一个新 turn。
    """
    registry = _get_registry(request)
    run = registry.get(thread_id)

    if run is None or run.turn_id != turn_id:
        # 无活跃 run（或已结束/已被替换）——幂等 ack，前端 stopGeneration 只关心 ok
        logger.info("interrupt: no active run for thread=%s turn=%s", thread_id, turn_id)
        return {"status": "interrupted"}

    try:
        run.event_queue.put_nowait(
            {"kind": "turn_aborted", "turnId": turn_id, "threadId": thread_id}
        )
        # None 哨兵让 sse_event_generator 停止（与 consume 任务的 finally 语义一致）
        run.event_queue.put_nowait(None)
    except Exception:  # pragma: no cover - queue 满等极端情况
        logger.warning("interrupt: failed to push abort events", exc_info=True)

    if run.task and not run.task.done():
        run.task.cancel()

    if run.run_id:
        client = _get_client(request)
        await client.cancel_run(thread_id, run.run_id)

    # 只移除「仍是当前注册 run」的自己：cancel_run 的 await 期间，steer 的
    # 新 turn 可能已注册，按 thread_id 移除会把新 run 误删（No active turn）。
    registry.remove_if_current(run)
    logger.info(
        "interrupt: cancelled thread=%s turn=%s run=%s",
        thread_id, turn_id, run.run_id,
    )
    return {"status": "interrupted"}


@router.post("/threads/{thread_id}/compact")
async def compact_thread(thread_id: str) -> dict[str, Any]:
    """POST /v1/threads/:id/compact → stub no-op.

    renderer 的 compactThread 期望返回 { replacedTokens, summary }。
    QiLin 的上下文压缩由 agent graph 内部管理，手动触发返回 no-op。
    """
    logger.info("compact stub: thread=%s (no-op)", thread_id)
    return {"replacedTokens": 0, "summary": ""}


# ────────────────────────────────────────────────────────────────
# 文件查看端点
# ────────────────────────────────────────────────────────────────


@router.get("/threads/{thread_id}/file")
async def read_thread_file(
    thread_id: str, path: str, request: Request
) -> PlainTextResponse:
    """GET /v1/threads/:id/file?path=/mnt/user-data/outputs/report.md

    读取 thread outputs 目录下的文件内容，返回纯文本。
    仅允许访问 /mnt/user-data/outputs/ 下的文件（安全边界）。
    """
    client = _get_client(request)

    # path 可能携带 URL 编码（agent 输出的链接本身已编码时，前端 encodeURIComponent
    # 会造成双重编码；FastAPI 只解一层），这里统一解码后再匹配虚拟路径。
    path = urllib.parse.unquote(path)

    # 从 thread state 获取 outputs_path
    try:
        state = await client.get_thread_state(thread_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Upstream error: {exc}") from exc

    values = state.get("values", {}) if isinstance(state, dict) else {}
    thread_data = values.get("thread_data", {}) if isinstance(values, dict) else {}
    outputs_path = thread_data.get("outputs_path", "") if isinstance(thread_data, dict) else ""

    if not outputs_path:
        raise HTTPException(status_code=404, detail="Thread outputs directory not found")

    outputs_dir = Path(outputs_path).resolve()

    # 将虚拟路径转换为实际文件路径
    VIRTUAL_OUTPUTS_PREFIX = "/mnt/user-data/outputs"
    if path.startswith(VIRTUAL_OUTPUTS_PREFIX):
        relative = path[len(VIRTUAL_OUTPUTS_PREFIX):].lstrip("/")
        actual_path = outputs_dir / relative
    else:
        actual_path = outputs_dir / Path(path).name

    # 安全检查：确保解析后的路径在 outputs 目录内
    try:
        actual_path = actual_path.resolve()
        actual_path.relative_to(outputs_dir)
    except (ValueError, OSError) as exc:
        raise HTTPException(status_code=403, detail="Access denied: path outside outputs directory") from exc

    if not actual_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")

    if not actual_path.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    try:
        content = actual_path.read_text(encoding="utf-8", errors="replace")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read file: {exc}") from exc

    return PlainTextResponse(content=content, media_type="text/plain; charset=utf-8")


# ────────────────────────────────────────────────────────────────
# 变更历史端点
# ────────────────────────────────────────────────────────────────


@router.get("/threads/{thread_id}/changes")
async def get_thread_changes(
    thread_id: str, request: Request
) -> dict[str, Any]:
    """GET /v1/threads/:id/changes — 该 thread 的 workspace 变更历史（新→旧）。

    数据来自 gateway 内存变更历史（sse.py 的 workspace_tracker，每轮 turn
    结束时记录，上限 50 条）。历史不含 diff 的完整内容查询：files 数组
    完整返回（含 diff），供 ChangePanel 渲染。
    """
    return {
        "threadId": thread_id,
        "changes": workspace_tracker.history(thread_id),
    }


# ────────────────────────────────────────────────────────────────
# Thread Goal / Todos — InfoPanel「计划 / 进度」段的数据源
# ────────────────────────────────────────────────────────────────


def _extract_state_values(state: dict[str, Any]) -> dict[str, Any]:
    """从 LangGraph thread state 提取 values（委托 thread_log 的共享实现）。"""
    return thread_log.extract_state_values(state)


def _first_human_text(values: dict[str, Any]) -> str:
    """提取 thread 中第一条用户消息文本（作为 goal objective 的兜底来源）。"""
    for msg in values.get("messages") or []:
        if not isinstance(msg, dict):
            continue
        if msg.get("type") == "human" or msg.get("role") == "user":
            content = msg.get("content")
            if isinstance(content, str) and content.strip():
                # 剥掉附件注入块，只留用户原始指令
                text = content.split("<user_attachments>")[0].strip()
                if text:
                    return text[:2000]
    return ""


@router.get("/threads/{thread_id}/goal")
async def get_thread_goal(thread_id: str, request: Request) -> dict[str, Any]:
    """GET /v1/threads/:id/goal — thread goal（InfoPanel「计划」段）。

    objective 优先取最后一条用户消息（当前任务目标），兜底第一条；
    无任何用户消息时返回 404（前端显示「暂无目标」）。
    """
    client = _get_client(request)
    try:
        state = await client.get_thread_state(thread_id)
    except Exception:
        logger.debug("goal: get_thread_state failed for %s", thread_id, exc_info=True)
        raise HTTPException(status_code=404, detail="thread state not available")

    values = _extract_state_values(state)
    objective = ""
    # 最后一条用户消息 = 当前正在执行的任务目标
    humans = [
        m for m in (values.get("messages") or [])
        if isinstance(m, dict) and (m.get("type") == "human" or m.get("role") == "user")
    ]
    if humans:
        content = humans[-1].get("content")
        if isinstance(content, str) and content.strip():
            objective = content.split("<user_attachments>")[0].strip()[:2000]
    if not objective:
        objective = _first_human_text(values)
    if not objective:
        # state 读不出（dev 重启丢 checkpoint 等）→ 回退 thread-log：
        # 优先最新 goal_updated 落盘值，其次最新 turn 的 prompt。
        logged_goal = thread_log.latest_goal(thread_id)
        if logged_goal and logged_goal.get("objective"):
            return logged_goal
        for turn in reversed(thread_log.log_turns(thread_id)):
            if turn.get("prompt"):
                return {
                    "threadId": thread_id,
                    "objective": str(turn["prompt"]).split("<user_attachments>")[0][:2000],
                    "status": "active",
                    "tokensUsed": 0,
                    "timeUsedSeconds": 0,
                    "createdAt": turn.get("savedAt") or datetime.now(timezone.utc).isoformat(),
                    "updatedAt": turn.get("savedAt") or datetime.now(timezone.utc).isoformat(),
                }
        raise HTTPException(status_code=404, detail="no goal yet")

    now = datetime.now(timezone.utc).isoformat()
    return {
        "threadId": thread_id,
        "objective": objective,
        "status": "active",
        "tokensUsed": 0,
        "timeUsedSeconds": 0,
        "createdAt": now,
        "updatedAt": now,
    }


@router.get("/threads/{thread_id}/todos")
async def get_thread_todos(thread_id: str, request: Request) -> dict[str, Any]:
    """GET /v1/threads/:id/todos — thread todos（InfoPanel「进度」段）。

    数据来自 QiLin TodoMiddleware 写入的 graph state ``todos`` 通道
    （write_todos 工具整体替换语义，reducer 保留最后非 None 值）。
    无 todos（未启用计划模式 / 未产生待办）返回 404。
    """
    client = _get_client(request)
    try:
        state = await client.get_thread_state(thread_id)
    except Exception:
        logger.debug("todos: get_thread_state failed for %s", thread_id, exc_info=True)
        raise HTTPException(status_code=404, detail="thread state not available")

    values = _extract_state_values(state)
    raw_todos = values.get("todos")
    if not isinstance(raw_todos, list) or not raw_todos:
        # state 读不出（dev 重启丢 checkpoint 等）→ 回退 thread-log：
        # 最新一次 todos_updated 的落盘值。
        logged = thread_log.latest_todos(thread_id)
        if logged and logged.get("items"):
            return logged
        raise HTTPException(status_code=404, detail="no todos")

    now = datetime.now(timezone.utc).isoformat()
    items = []
    for idx, td in enumerate(raw_todos):
        if not isinstance(td, dict):
            continue
        status = td.get("status") or "pending"
        if status not in ("pending", "in_progress", "completed"):
            status = "pending"
        items.append(
            {
                "id": str(td.get("id") or f"todo-{idx}"),
                "content": str(td.get("content") or ""),
                "status": status,
                "createdAt": now,
                "updatedAt": now,
            }
        )
    return {
        "threadId": thread_id,
        "items": items,
        "updatedAt": now,
    }
