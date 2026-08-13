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
)
from .qilin_client import QiLinClient

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

    thread = await client.create_thread(metadata=metadata)
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
        logger.exception("Failed to search threads")
        raise HTTPException(status_code=502, detail=f"Upstream error: {exc}") from exc

    summaries = [_to_thread_summary(t) for t in threads]
    if not include_archived:
        summaries = [s for s in summaries if not s.get("archived")]
    return {"threads": summaries}


# ────────────────────────────────────────────────────────────────
# 端点 3: DELETE /v1/threads/{id} — 删除会话
# ────────────────────────────────────────────────────────────────


@router.delete("/threads/{thread_id}")
async def delete_thread(thread_id: str, request: Request) -> dict[str, Any]:
    """删除 thread. renderer 期望返回 {deleted: bool}."""
    client = _get_client(request)

    ok = await client.delete_thread(thread_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Thread not found: {thread_id}")
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
    workspace_path: str | None = None
    try:
        thread = await client.get_thread(thread_id)
        meta = _get_metadata(thread)
        workspace_path = meta.get("workspace", "") or None
        current_title = meta.get("title", "New Chat")
        if current_title == "New Chat" and req.prompt.strip():
            new_title = _generate_title_from_prompt(req.prompt)
            if new_title != "New Chat":
                asyncio.create_task(
                    _safe_update_title(client, thread_id, new_title)
                )
    except Exception:
        logger.debug("title auto-update check failed", exc_info=True)

    # 启动后台消费任务
    run.task = asyncio.create_task(
        consume_langgraph_stream(
            client, registry, run, assistant_id, req.prompt,
            user_id=user_id, model_name=req.model_name,
            subagent_enabled=req.subagent_enabled,
            reasoning_mode=req.reasoning_mode,
            workspace_path=workspace_path,
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

    try:
        thread = await client.get_thread(thread_id)
        state = await client.get_thread_state(thread_id)
    except Exception as exc:
        logger.exception("Failed to get thread %s", thread_id)
        raise HTTPException(status_code=502, detail=f"Upstream error: {exc}") from exc

    # 从 state 提取消息列表
    values = state.get("values", {}) if isinstance(state, dict) else {}
    messages = values.get("messages", []) if isinstance(values, dict) else []

    # 将 LangChain messages 翻译成 KCoder item 结构
    items: list[dict[str, Any]] = []
    for msg in messages:
        item = _message_to_item(msg)
        if item:
            items.append(item)

    base = _to_thread_response(thread)
    base["turns"] = [{"id": "turn-0", "items": items}] if items else []
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
async def steer_turn(thread_id: str, turn_id: str) -> dict[str, Any]:
    """POST /v1/threads/:id/turns/:turnId/steer → stub no-op.

    renderer 的 steerTurn 期望 void（只检查 response.ok）。QiLin 的
    LangGraph stream 尚不支持 mid-run 指令注入，后续阶段再实现。
    """
    logger.info("steer stub: thread=%s turn=%s (no-op)", thread_id, turn_id)
    return {"ok": True}


@router.post("/threads/{thread_id}/turns/{turn_id}/interrupt")
async def interrupt_turn(thread_id: str, turn_id: str) -> dict[str, Any]:
    """POST /v1/threads/:id/turns/:turnId/interrupt → stub ack.

    renderer 的 interruptTurn 期望返回 { status: string }。我们返回
    ``interrupted`` — 后台 SSE stream 会在 task 完成或 renderer 停止
    读取后自然关闭。完整的 cancel + discard 逻辑留待后续阶段。
    """
    logger.info("interrupt stub: thread=%s turn=%s", thread_id, turn_id)
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
