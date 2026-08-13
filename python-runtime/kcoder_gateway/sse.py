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
import uuid
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

from .qilin_client import QiLinClient
from .workspace_changes_tracker import WorkspaceChangesTracker

logger = logging.getLogger("kcoder_gateway.sse")

# 模块级单例：threads.py 的 GET /threads/{id}/changes 端点共享同一实例
workspace_tracker = WorkspaceChangesTracker()


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
        if run_id:
            run.run_id = run_id
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
            events.extend(_translate_single_message(msg, run, skip_text=skip_text))
    return events


def _translate_single_message(
    msg: dict[str, Any], run: ActiveRun, *, skip_text: bool = False
) -> list[dict[str, Any]]:
    """将单个 LangChain 消息字典翻译成 KCoder 事件.

    ``skip_text=True`` 时跳过 AI 文本提取（messages/complete 的 content 是
    累积全文，与 messages/partial 增量重复）。工具调用最终态不受影响。

    messages/partial 的 content 也是【累积全文】（langgraph_api 内部
    ``messages[msg.id] += msg`` 后 yield 整个累积消息），因此对 partial
    必须做前缀 diff：增量 = 当前 text 去掉与该 msg.id 上次记录的公共前缀。
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
        # Token 用量：usage_metadata（langchain 标准）或 additional_kwargs.usage
        # （OpenAI 兼容）兑底。按消息 id 去重，同一消息在 partial/complete/
        # values 多帧出现只计一次。首次计入时向 renderer 发 usage 事件
        # （输入框底部 ROI 缩略条据此累加会话用量）。
        msg_id = str(msg.get("id", ""))
        usage = _extract_usage(msg)
        if usage:
            model = _extract_model_name(msg)
            cache_read = _extract_cache_read(msg)
            if _account_usage(run, msg_id, usage, model=model, cache_read=cache_read):
                events.append(
                    {
                        "kind": "usage",
                        "usage": {
                            "promptTokens": usage["input_tokens"],
                            "completionTokens": usage["output_tokens"],
                            "totalTokens": usage["total_tokens"],
                        },
                        "model": model,
                    }
                )
        if msg_id:
            run.ai_message_ids.add(msg_id)

        # 文本内容增量（skip_text=True 时跳过——用于 messages/complete 避免与 partial 重复）
        if not skip_text:
            text = _extract_text(msg.get("content", ""))
            delta = _compute_ai_delta(text, msg_id, run)
            if delta:
                events.append({"kind": "assistant_text_delta", "delta": delta})

        # 工具调用（完整调用或流式 chunk）
        for tc in (msg.get("tool_calls") or []):
            if isinstance(tc, dict):
                name = tc.get("name") or ""
                call_id = tc.get("id") or ""
                if call_id and name:
                    tc_event: dict[str, Any] = {
                        "kind": "tool_call_started",
                        "callId": call_id,
                        "toolName": name,
                    }
                    # present_files: extract file paths from args so the
                    # frontend can render artifact links immediately, even
                    # though the state-level artifacts list isn't streamed.
                    if name == "present_files":
                        tc_args = tc.get("args") or {}
                        if isinstance(tc_args, dict):
                            filepaths = tc_args.get("filepaths") or []
                            if isinstance(filepaths, list) and filepaths:
                                tc_event["args"] = {"filepaths": filepaths}
                    events.append(tc_event)

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
        tool_name = str(msg.get("name", ""))
        artifact = msg.get("artifact")
        if call_id:
            event: dict[str, Any] = {
                "kind": "tool_call_finished",
                "callId": call_id,
                "summary": text[:500] if text else "",
                "isError": False,
            }
            # Pass through the tool name so the frontend can identify
            # special tools (e.g. ask_clarification) without relying on
            # the preceding tool_call_started event being processed.
            if tool_name:
                event["toolName"] = tool_name
            # Pass through the artifact (e.g. human_input payload from
            # ask_clarification) so the frontend can render interactive
            # cards instead of falling back to plain text.
            # QiLin wraps the payload as {"human_input": payload}; unwrap
            # it so the frontend receives the payload object directly.
            if artifact is not None:
                if (
                    tool_name == "ask_clarification"
                    and isinstance(artifact, dict)
                    and "human_input" in artifact
                ):
                    event["artifact"] = artifact["human_input"]
                else:
                    event["artifact"] = artifact
            events.append(event)

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


def _compute_ai_delta(text: str, msg_id: str, run: ActiveRun) -> str:
    """计算 messages/partial 的真实增量.

    langgraph_api 的 ``messages/partial`` yield 的是【累积后完整消息】
    （``stream.py``: ``messages[msg.id] += msg`` 后 yield ``messages[msg.id]``），
    所以同一 msg.id 的连续 partial 帧，content 是递增的前缀关系。
    增量 = 当前 text 去掉与上次记录的公共前缀。

    无 msg_id 时无法跨帧追踪，退化为全量发送（单次不会重复，
    但若同帧多 chunk 无 id 会重复——LangChain 正常消息都有 id，此为兜底）。
    """
    if not text:
        return ""
    if not msg_id:
        return text
    prev = run.ai_text_seen.get(msg_id)
    if not prev:
        delta = text
    elif text.startswith(prev):
        # 正常路径：当前 = 上次 + 新增
        delta = text[len(prev):]
    elif prev.startswith(text):
        # 异常回退（当前比上次还短，可能消息被重置）：全量重发
        delta = text
    else:
        # 同 id 但内容无前缀关系（极少见，如分支重写）：全量重发
        delta = text
    run.ai_text_seen[msg_id] = text
    return delta


# ────────────────────────────────────────────────────────────────
# ActiveRun 管理
# ────────────────────────────────────────────────────────────────


@dataclass
class ActiveRun:
    """一个正在运行的 LangGraph run 的跟踪状态.

    POST /v1/threads/:id/turns 创建一个 ActiveRun 并启动后台消费任务；
    GET /v1/threads/:id/events 从 event_queue 读取翻译后的事件。

    ``usage_by_model`` 在流式消费过程中由 ``_account_usage`` 按消息 id
    去重累积；run 结束（end / 异常）时由 ``consume_langgraph_stream``
    写入 runs 表（RunRow），供 Token 统计面板聚合。
    """

    thread_id: str
    turn_id: str
    user_message_id: str
    event_queue: asyncio.Queue[dict[str, Any] | None] = field(
        default_factory=asyncio.Queue
    )
    task: asyncio.Task[None] | None = None
    # 按 message id 追踪 AI 文本累积量。langgraph_api 的 messages/partial
    # 发送的是【累积后完整消息】（见 stream.py: messages[msg.id] += msg），
    # 所以必须做前缀 diff 才能得到真正的增量，否则会层层重复。
    ai_text_seen: dict[str, str] = field(default_factory=dict)
    # LangGraph run id（从 metadata 事件捕获，用于 runs 表主键）
    run_id: str | None = None
    # 按模型聚合的 token 用量（桶字段对齐 RunRow.token_usage_by_model）
    usage_by_model: dict[str, dict[str, int]] = field(default_factory=dict)
    # 已计入 usage 的消息 id（同一消息在 partial/complete/values 多帧重复出现，只计一次）
    counted_usage_ids: set[str] = field(default_factory=set)
    # 已见过的 AI 消息 id（llm_call_count 统计）
    ai_message_ids: set[str] = field(default_factory=set)


def _extract_usage(msg: dict[str, Any]) -> dict[str, int] | None:
    """从 LangChain 消息字典提取 token 用量。

    ``usage_metadata`` 是 langchain-core 标准字段（引擎 adapter 会写入）；
    OpenAI 兼容的 ``additional_kwargs.usage`` 作为兑底（prompt_tokens /
    completion_tokens）。
    """
    usage_metadata = msg.get("usage_metadata")
    if isinstance(usage_metadata, dict):
        input_tokens = int(usage_metadata.get("input_tokens") or 0)
        output_tokens = int(usage_metadata.get("output_tokens") or 0)
        total_tokens = int(usage_metadata.get("total_tokens") or 0)
        if total_tokens > 0 or input_tokens > 0 or output_tokens > 0:
            return {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": total_tokens or (input_tokens + output_tokens),
            }
    additional = msg.get("additional_kwargs")
    if isinstance(additional, dict):
        usage = additional.get("usage")
        if isinstance(usage, dict):
            input_tokens = int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0)
            output_tokens = int(usage.get("completion_tokens") or usage.get("output_tokens") or 0)
            if input_tokens > 0 or output_tokens > 0:
                return {
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "total_tokens": input_tokens + output_tokens,
                }
    return None


def _extract_cache_read(msg: dict[str, Any]) -> int:
    """提取 Prompt 缓存命中 token（usage_metadata.input_token_details.cache_read）。"""
    usage_metadata = msg.get("usage_metadata")
    if isinstance(usage_metadata, dict):
        details = usage_metadata.get("input_token_details")
        if isinstance(details, dict):
            return int(details.get("cache_read") or 0)
    return 0


def _extract_model_name(msg: dict[str, Any]) -> str:
    """从消息元数据提取模型名（response_metadata / additional_kwargs）。"""
    resp_meta = msg.get("response_metadata")
    if isinstance(resp_meta, dict):
        name = resp_meta.get("model_name") or resp_meta.get("model")
        if name:
            return str(name)
    additional = msg.get("additional_kwargs")
    if isinstance(additional, dict):
        name = additional.get("model_name") or additional.get("model")
        if name:
            return str(name)
    return "unknown"


def _account_usage(
    run: ActiveRun,
    msg_id: str | None,
    usage: dict[str, int] | None,
    *,
    model: str = "unknown",
    cache_read: int = 0,
) -> bool:
    """按消息 id 去重累计 usage 到 run.usage_by_model；返回是否首次计入。"""
    if not usage:
        return False
    if msg_id:
        if msg_id in run.counted_usage_ids:
            return False
        run.counted_usage_ids.add(msg_id)
    total = usage.get("total_tokens", 0) or 0
    input_tokens = usage.get("input_tokens", 0) or 0
    output_tokens = usage.get("output_tokens", 0) or 0
    bucket = run.usage_by_model.setdefault(
        model,
        {"total_tokens": 0, "input_tokens": 0, "output_tokens": 0, "cache_read_tokens": 0},
    )
    bucket["total_tokens"] += total
    bucket["input_tokens"] += input_tokens
    bucket["output_tokens"] += output_tokens
    bucket["cache_read_tokens"] += cache_read
    return True


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
    subagent_enabled: bool = False,
    reasoning_mode: str | None = None,
    workspace_path: str | None = None,
) -> None:
    """后台任务：消费 LangGraph SSE 流 → 翻译 → 推入 event_queue.

    流结束后（正常或异常）向队列推入 None 作为哨兵，通知 SSE 端点关闭。

    ``user_id``（可选）注入到 LangGraph ``configurable``，让 QiLin 的
    ``resolve_config_user_id`` 能识别当前用户（Phase 6）。
    ``model_name``（可选）注入到 ``configurable.model_name``，让 QiLin 的
    ``_resolve_model_name`` 按需选用指定模型（而非默认 models[0]）。
    ``subagent_enabled``（可选）注入到 ``configurable.subagent_enabled``，
    为 True 时 QiLin 启用 task_tool（子 agent 编排；agent.py 默认 False）。
    ``reasoning_mode``（可选）映射到 ``configurable.thinking_enabled`` /
    ``configurable.reasoning_effort``：
      - "off"        → thinking_enabled=False（关闭思考）
      - "low"/"medium"/"high" → thinking_enabled=True + reasoning_effort=X
      - "auto"/None  → 不注入（让 QiLin 按自定义 agent 默认 / 运行时默认）
    ``workspace_path``（可选）注入到 ``configurable.workspace_path``，
    让 QiLin sandbox provider 将 /mnt/user-data/workspace 映射到用户选择的
    真实项目目录（而非默认的内部空目录）。
    """
    q = run.event_queue
    got_end = False
    run_error: str | None = None

    try:
        input_data = {"messages": [{"role": "user", "content": prompt}]}
        # 把 user_id / model_name / 推理参数放入 configurable，QiLin 据此隔离用户数据 / 选模型
        configurable: dict[str, Any] = {}
        if user_id:
            configurable["user_id"] = user_id
        if model_name:
            configurable["model_name"] = model_name
        if subagent_enabled:
            configurable["subagent_enabled"] = subagent_enabled
        if reasoning_mode == "off":
            configurable["thinking_enabled"] = False
        elif reasoning_mode in ("low", "medium", "high"):
            configurable["thinking_enabled"] = True
            configurable["reasoning_effort"] = reasoning_mode
        if workspace_path:
            configurable["workspace_path"] = workspace_path
        run_config: dict[str, Any] | None = (
            {"configurable": configurable} if configurable else None
        )
        # turn 前捕获 workspace 快照（失败不阻塞对话，仅记录日志）
        await workspace_tracker.capture_before(run.turn_id, workspace_path)

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
                    if ev.get("kind") == "turn_completed":
                        # run 结束：计算本轮 workspace 变更并附加到 turn_completed
                        changes = await workspace_tracker.compute_changes(
                            run.turn_id, run.thread_id, workspace_path
                        )
                        if changes:
                            ev["fileChanges"] = changes
                    await q.put(ev)
                if event_type == "end":
                    got_end = True

        # 处理缓冲区中残留的最后一帧（部分服务器不在结尾加空行）
        if buffer.strip():
            event_type, event_data = parse_sse_frame(buffer)
            if event_type is not None or event_data is not None:
                for ev in translate_event(event_type or "", event_data, run):
                    if ev.get("kind") == "turn_completed":
                        changes = await workspace_tracker.compute_changes(
                            run.turn_id, run.thread_id, workspace_path
                        )
                        if changes:
                            ev["fileChanges"] = changes
                    await q.put(ev)
                if event_type == "end":
                    got_end = True

        if not got_end:
            logger.warning(
                "LangGraph stream ended without 'end' event (thread=%s) — synthesizing turn_completed",
                run.thread_id,
            )
            completed_event: dict[str, Any] = {
                "kind": "turn_completed",
                "turnId": run.turn_id,
                "threadId": run.thread_id,
            }
            changes = await workspace_tracker.compute_changes(
                run.turn_id, run.thread_id, workspace_path
            )
            if changes:
                completed_event["fileChanges"] = changes
            await q.put(completed_event)

    except asyncio.CancelledError:
        logger.info("LangGraph stream cancelled for thread %s", run.thread_id)
        run_error = "cancelled"
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
        run_error = str(exc)
        await q.put(
            {
                "kind": "turn_failed",
                "turnId": run.turn_id,
                "threadId": run.thread_id,
                "message": str(exc),
            }
        )

    finally:
        # 持久化本次 run 的用量（runs 表）——KCoder 对话走 langgraph dev 的
        # /runs/stream，不经过引擎 RunJournal，由 gateway 补写一行供
        # /v1/token-usage 统计聚合。正常完成或异常结束都会记录。
        if got_end or run_error is not None or run.usage_by_model:
            try:
                from .token_usage_routes import persist_run_usage

                run_id = run.run_id or f"gateway-{uuid.uuid4().hex[:12]}"
                await persist_run_usage(
                    run_id=run_id,
                    thread_id=run.thread_id,
                    assistant_id=assistant_id,
                    user_id=user_id,
                    status="success" if got_end else "error",
                    usage_by_model=run.usage_by_model,
                    llm_call_count=len(run.ai_message_ids),
                    model_name=model_name,
                    error=run_error,
                )
            except Exception:
                logger.warning(
                    "Failed to persist run usage for thread %s (non-fatal)",
                    run.thread_id,
                    exc_info=True,
                )
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
