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
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .sse import (
    ActiveRun,
    RunRegistry,
    consume_langgraph_stream,
    sse_event_generator,
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


# ────────────────────────────────────────────────────────────────
# 字段映射辅助函数
# ────────────────────────────────────────────────────────────────


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
async def list_threads(request: Request, limit: int = 200) -> dict[str, Any]:
    """列出所有 threads.

    renderer 调 GET /v1/threads?limit=200，期望 {threads: [ThreadSummary]}.
    LangGraph 的列表端点是 POST /threads/search（注意不是 GET）。
    """
    client = _get_client(request)

    try:
        threads = await client.search_threads(limit=limit)
    except Exception as exc:
        logger.exception("Failed to search threads")
        raise HTTPException(status_code=502, detail=f"Upstream error: {exc}") from exc

    return {"threads": [_to_thread_summary(t) for t in threads]}


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

    # 启动后台消费任务
    run.task = asyncio.create_task(
        consume_langgraph_stream(
            client, registry, run, assistant_id, req.prompt, user_id=user_id
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
