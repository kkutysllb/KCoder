"""SSE 事件翻译层 — LangGraph Platform SSE ↔ KCoder renderer SSE.

KCoder renderer 期望的 SSE 格式（见 engine-api.ts subscribeToThread）::

    data: {"kind": "assistant_text_delta", "delta": "Hello"}\n\n
    data: {"kind": "tool_call_started", "callId": "...", "toolName": "..."}\n\n
    data: {"kind": "turn_completed", "turnId": "...", "threadId": "..."}\n\n

LangGraph Platform 的 SSE 格式（stream_mode=["messages"]，实测 langgraph_api 0.10.x）::

    event: metadata\n
    data: {"run_id": "..."}\n\n
    event: messages/partial\n
    data: [{"type":"AIMessageChunk","content":"Hel"}, {...}]\n\n
    event: messages/complete\n
    data: [{"type":"AIMessageChunk","content":"Hello"}, {...}]\n\n
    event: end\n
    data: {}\n\n

注意：旧版 LangGraph（<0.4）用 ``event: messages``；新版拆成 ``messages/partial``
（流式增量，content 为增量文本）、``messages/complete``（完整消息，content 为
累积全文）和 ``messages/metadata``（每条消息的 graph run 元数据，无消息体）。

本模块负责：
1. 解析 LangGraph SSE 帧（跨字节块缓冲）
2. 将 LangGraph 事件翻译成 KCoder kind 体系
3. 管理 ActiveRun（后台消费任务 + 事件队列）
4. 为 threads.py 的 GET /events 提供异步生成器

翻译决策（对应计划 D2 决策点）：在 gateway 侧转换，renderer 无感。
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

from .qilin_client import QiLinClient

logger = logging.getLogger("kcoder_gateway.sse")


# ────────────────────────────────────────────────────────────────
# SSE 帧解析
# ────────────────────────────────────────────────────────────────


def parse_sse_frame(frame: str) -> tuple[str | None, Any]:
    """将一个 SSE 帧（不含尾部空行）解析为 (event_type, parsed_data).

    SSE 帧格式::

        event: messages
        data: {...json...}

    多行 data: 会拼接（SSE 标准）。返回 (None, None) 表示无数据帧。
    """
    event_type: str | None = None
    data_lines: list[str] = []

    for line in frame.split("\n"):
        line = line.rstrip("\r")
        if line.startswith("event:"):
            event_type = line[6:].strip()
        elif line.startswith("data:"):
            data_lines.append(line[5:].lstrip())
        elif line.startswith(":"):
            pass  # SSE comment / heartbeat
        # id:, retry: 等字段忽略

    if not data_lines:
        return event_type, None

    raw_data = "\n".join(data_lines)
    try:
        return event_type, json.loads(raw_data)
    except json.JSONDecodeError:
        logger.debug("Non-JSON SSE data (event=%s): %s", event_type, raw_data[:200])
        return event_type, raw_data


# ────────────────────────────────────────────────────────────────
# 事件翻译
# ────────────────────────────────────────────────────────────────


def translate_event(event_type: str, data: Any, run: ActiveRun) -> list[dict[str, Any]]:
    """将一个 LangGraph 事件翻译成 0~N 个 KCoder SSE 事件.

    核心映射（D2 决策点）::

        metadata      → turn_started
        messages/AI   → assistant_text_delta (+ tool_call_started)
        messages/Tool → tool_call_finished
        end           → turn_completed
        error         → turn_failed
    """
    events: list[dict[str, Any]] = []

    if event_type == "metadata":
        run_id = ""
        if isinstance(data, dict):
            run_id = str(data.get("run_id", ""))
        events.append({"kind": "turn_started", "turnId": run.turn_id, "runId": run_id})

    elif event_type == "messages" or event_type.startswith("messages/"):
        # messages/metadata 只含 graph run 元数据，不是真正的消息体，跳过
        if event_type == "messages/metadata":
            return events
        # messages/partial 是流式增量（AIMessageChunk，content 为增量文本）；
        # messages/complete 是该消息流结束后的完整 AIMessage（content 为累积全文）。
        # 为避免文本重复，complete 只处理工具调用最终态，跳过文本提取。
        is_complete = event_type == "messages/complete"
        events.extend(_translate_messages_event(data, run, skip_text=is_complete))

    elif event_type == "end":
        events.append(
            {"kind": "turn_completed", "turnId": run.turn_id, "threadId": run.thread_id}
        )

    elif event_type == "error":
        msg_text = "Unknown error"
        if isinstance(data, dict):
            msg_text = str(data.get("message", data.get("error", data)))
        elif isinstance(data, str):
            msg_text = data
        events.append(
            {
                "kind": "turn_failed",
                "turnId": run.turn_id,
                "threadId": run.thread_id,
                "message": msg_text,
            }
        )

    return events


def _translate_messages_event(
    data: Any, run: ActiveRun, *, skip_text: bool = False
) -> list[dict[str, Any]]:
    """翻译 stream_mode=messages 的事件（messages/partial、messages/complete 等）.

    data 格式是 LangGraph 的标准 tuple：``[msg_dict, meta_dict]``。
    某些旧版本可能发 ``{"messages": [...], "metadata": {...}}``，一并兼容。

    ``skip_text=True`` 时跳过 AI 文本提取（用于 messages/complete 避免与
    messages/partial 的增量文本重复——complete 的 content 是累积全文）。
    """
    messages: list[dict[str, Any]] = []

    if isinstance(data, list) and len(data) >= 1:
        first = data[0]
        if isinstance(first, list):
            messages = first  # 嵌套列表
        elif isinstance(first, dict):
            messages = [first]
    elif isinstance(data, dict):
        if "messages" in data and isinstance(data["messages"], list):
            messages = data["messages"]

    events: list[dict[str, Any]] = []
    for msg in messages:
        if isinstance(msg, dict):
            events.extend(_translate_single_message(msg, skip_text=skip_text))
    return events


def _translate_single_message(
    msg: dict[str, Any], *, skip_text: bool = False
) -> list[dict[str, Any]]:
    """将单个 LangChain 消息字典翻译成 KCoder 事件.

    ``skip_text=True`` 时跳过 AI 文本提取（messages/complete 的 content 是
    累积全文，与 messages/partial 增量重复）。工具调用最终态不受影响。
    """
    events: list[dict[str, Any]] = []
    msg_type = str(msg.get("type", msg.get("role", "")))

    # 统一类型判断（LangGraph 可能用 "ai" 或 "AIMessageChunk" 等）
    type_lower = msg_type.lower()
    is_ai = "ai" in type_lower or msg_type == "AIMessageChunk"
    is_human = "human" in type_lower or msg_type == "HumanMessage"
    is_tool = msg_type == "tool" or msg_type == "ToolMessage"

    if is_human:
        # 用户消息跳过 — renderer 已经在 UI 显示了
        return events

    if is_ai:
        # 文本内容增量（skip_text=True 时跳过——用于 messages/complete 避免与 partial 重复）
        if not skip_text:
            text = _extract_text(msg.get("content", ""))
            if text:
                events.append({"kind": "assistant_text_delta", "delta": text})

        # 工具调用（完整调用或流式 chunk）
        for tc in (msg.get("tool_calls") or []):
            if isinstance(tc, dict):
                name = tc.get("name") or ""
                call_id = tc.get("id") or ""
                if call_id and name:
                    events.append(
                        {"kind": "tool_call_started", "callId": call_id, "toolName": name}
                    )

        for tcc in (msg.get("tool_call_chunks") or []):
            if isinstance(tcc, dict):
                name = tcc.get("name") or ""
                call_id = tcc.get("id") or ""
                # 只在 name+id 都有时才 emit（避免半成品 chunk 重复触发）
                if call_id and name:
                    events.append(
                        {"kind": "tool_call_started", "callId": call_id, "toolName": name}
                    )

    elif is_tool:
        call_id = str(msg.get("tool_call_id", ""))
        text = _extract_text(msg.get("content", ""))
        if call_id:
            events.append(
                {
                    "kind": "tool_call_finished",
                    "callId": call_id,
                    "summary": text[:500] if text else "",
                    "isError": False,
                }
            )

    return events


def _extract_text(content: Any) -> str:
    """从 LangChain content（字符串或 content-blocks 列表）提取纯文本."""
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
# ActiveRun 管理
# ────────────────────────────────────────────────────────────────


@dataclass
class ActiveRun:
    """一个正在运行的 LangGraph run 的跟踪状态.

    POST /v1/threads/:id/turns 创建一个 ActiveRun 并启动后台消费任务；
    GET /v1/threads/:id/events 从 event_queue 读取翻译后的事件。
    """

    thread_id: str
    turn_id: str
    user_message_id: str
    event_queue: asyncio.Queue[dict[str, Any] | None] = field(
        default_factory=asyncio.Queue
    )
    task: asyncio.Task[None] | None = None


class RunRegistry:
    """按 thread_id 索引的 ActiveRun 注册表.

    同一时间一个 thread 只允许一个 ActiveRun。新 run 注册时旧的会被取消。
    """

    def __init__(self) -> None:
        self._runs: dict[str, ActiveRun] = {}

    def register(self, run: ActiveRun) -> None:
        old = self._runs.get(run.thread_id)
        if old and old.task and not old.task.done():
            old.task.cancel()
        self._runs[run.thread_id] = run

    def get(self, thread_id: str) -> ActiveRun | None:
        return self._runs.get(thread_id)

    def remove(self, thread_id: str) -> None:
        self._runs.pop(thread_id, None)


# ────────────────────────────────────────────────────────────────
# 后台流消费
# ────────────────────────────────────────────────────────────────


async def consume_langgraph_stream(
    client: QiLinClient,
    registry: RunRegistry,
    run: ActiveRun,
    assistant_id: str,
    prompt: str,
    *,
    user_id: str | None = None,
    model_name: str | None = None,
) -> None:
    """后台任务：消费 LangGraph SSE 流 → 翻译 → 推入 event_queue.

    流结束后（正常或异常）向队列推入 None 作为哨兵，通知 SSE 端点关闭。

    ``user_id``（可选）注入到 LangGraph ``configurable``，让 QiLin 的
    ``resolve_config_user_id`` 能识别当前用户（Phase 6）。
    ``model_name``（可选）注入到 ``configurable.model_name``，让 QiLin 的
    ``_resolve_model_name`` 按需选用指定模型（而非默认 models[0]）。
    """
    q = run.event_queue
    got_end = False

    try:
        input_data = {"messages": [{"role": "user", "content": prompt}]}
        # 把 user_id / model_name 放入 configurable，QiLin 据此隔离用户数据 / 选模型
        configurable: dict[str, Any] = {}
        if user_id:
            configurable["user_id"] = user_id
        if model_name:
            configurable["model_name"] = model_name
        run_config: dict[str, Any] | None = (
            {"configurable": configurable} if configurable else None
        )
        buffer = ""
        async for raw_chunk in client.stream_run(
            run.thread_id, assistant_id, input_data, config=run_config
        ):
            # 归一化换行：SSE 可能用 \n、\r\n 或 \r
            buffer += raw_chunk.decode("utf-8", errors="replace").replace("\r\n", "\n").replace("\r", "\n")

            # 按空行切分完整帧
            while "\n\n" in buffer:
                frame, buffer = buffer.split("\n\n", 1)
                if not frame.strip():
                    continue
                event_type, event_data = parse_sse_frame(frame)
                if event_type is None and event_data is None:
                    continue
                for ev in translate_event(event_type or "", event_data, run):
                    await q.put(ev)
                if event_type == "end":
                    got_end = True

        # 处理缓冲区中残留的最后一帧（部分服务器不在结尾加空行）
        if buffer.strip():
            event_type, event_data = parse_sse_frame(buffer)
            if event_type is not None or event_data is not None:
                for ev in translate_event(event_type or "", event_data, run):
                    await q.put(ev)
                if event_type == "end":
                    got_end = True

        if not got_end:
            logger.warning(
                "LangGraph stream ended without 'end' event (thread=%s) — synthesizing turn_completed",
                run.thread_id,
            )
            await q.put(
                {
                    "kind": "turn_completed",
                    "turnId": run.turn_id,
                    "threadId": run.thread_id,
                }
            )

    except asyncio.CancelledError:
        logger.info("LangGraph stream cancelled for thread %s", run.thread_id)
        await q.put(
            {
                "kind": "turn_aborted",
                "turnId": run.turn_id,
                "threadId": run.thread_id,
            }
        )
        raise

    except Exception as exc:
        logger.exception("LangGraph stream failed for thread %s", run.thread_id)
        await q.put(
            {
                "kind": "turn_failed",
                "turnId": run.turn_id,
                "threadId": run.thread_id,
                "message": str(exc),
            }
        )

    finally:
        # 哨兵：通知 SSE 端点关闭
        await q.put(None)
        registry.remove(run.thread_id)
        logger.debug("Run cleaned up: thread=%s turn=%s", run.thread_id, run.turn_id)


# ────────────────────────────────────────────────────────────────
# SSE 响应生成器
# ────────────────────────────────────────────────────────────────


async def sse_event_generator(
    run: ActiveRun,
) -> AsyncIterator[bytes]:
    """为 GET /v1/threads/:id/events 提供异步字节生成器.

    从 run.event_queue 读取翻译后的 KCoder 事件，yield 为 SSE 帧。
    读到 None 哨兵时停止。
    """
    try:
        while True:
            event = await run.event_queue.get()
            if event is None:
                break
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n".encode("utf-8")
    except asyncio.CancelledError:
        logger.debug("SSE client disconnected (thread=%s)", run.thread_id)
        raise
