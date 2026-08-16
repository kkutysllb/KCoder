"""KCoder 自有的 thread 历史持久化（网关侧兜底）。

背景：langgraph dev 的 checkpoint 存储（.langgraph_api/*.pckl）在服务重启
或依赖版本变化后可能读不出历史——thread 记录仍在（列表可见），但
``/threads/:id/state`` 返回空 values。表现为「点击历史任务 → 新任务页」。

方案：网关在每个 turn 结束时，把该 turn 的消息（经 LangGraph state 翻译，
state 为空时回退用本轮 SSE 事件重建）落盘到
``$KCODER_APP_DATA_DIR/thread-log/<thread_id>.json``；
``GET /v1/threads/:id`` 在 state 提取不到 items 时回退读取该日志。

由此历史展示不再依赖 langgraph dev 存储的可靠性。
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger("kcoder_gateway.thread_log")

# 每 thread 保留的 turn 上限（超出丢最老的，防无限膨胀）
_MAX_TURNS = 200

# 与 QiLin DynamicContextMiddleware 的 ID-swap 后缀保持一致（threads.py 同名常量）
INJECTED_USER_MESSAGE_ID_SUFFIX = "__user"
INJECTED_MEMORY_MESSAGE_ID_SUFFIX = "__memory"


def extract_state_values(state: Any) -> dict[str, Any]:
    """从 LangGraph thread state 提取 values。

    兼容不同 langgraph-api 版本的响应结构：
    多数 ``{"values": {...}}``，部分用 ``{"channel_values": {...}}``，
    极少数直接是 values 本身。
    """
    if not isinstance(state, dict):
        return {}
    values = state.get("values")
    if isinstance(values, dict):
        return values
    values = state.get("channel_values")
    if isinstance(values, dict):
        return values
    return state


# ────────────────────────────────────────────────────────────────
# 持久化
# ────────────────────────────────────────────────────────────────


def _log_dir() -> Path:
    base = os.environ.get("KCODER_APP_DATA_DIR", str(Path.home() / ".kcoder"))
    d = Path(base) / "thread-log"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _path(thread_id: str) -> Path:
    return _log_dir() / f"{thread_id}.json"


def append_turn(
    thread_id: str,
    turn_id: str,
    prompt: str,
    items: list[dict[str, Any]],
    goal: dict[str, Any] | None = None,
    todos: dict[str, Any] | None = None,
) -> None:
    """把一个 turn 的 items 追加到该 thread 的日志（同 turn_id 重写去重）。

    ``goal`` / ``todos``（可选）来自本轮 SSE 事件（goal_updated /
    todos_updated），供 /goal /todos 端点在 state 读不出时兜底。
    失败只记日志不抛出——持久化是兜底能力，不能阻塞对话主流程。
    """
    try:
        data = load_thread(thread_id) or {"threadId": thread_id, "turns": []}
        turns = [t for t in (data.get("turns") or []) if t.get("id") != turn_id]
        record: dict[str, Any] = {
            "id": turn_id,
            "prompt": prompt,
            "items": items,
            "savedAt": datetime.now(timezone.utc).isoformat(),
        }
        if goal:
            record["goal"] = goal
        if todos:
            record["todos"] = todos
        turns.append(record)
        data["turns"] = turns[-_MAX_TURNS:]
        tmp = _path(thread_id).with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        tmp.replace(_path(thread_id))
    except Exception:
        logger.warning("thread_log append failed for %s", thread_id, exc_info=True)


def load_thread(thread_id: str) -> dict[str, Any] | None:
    """读取该 thread 的日志；不存在/损坏返回 None。"""
    p = _path(thread_id)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        logger.warning("thread_log read failed for %s", thread_id, exc_info=True)
        return None


def delete_thread(thread_id: str) -> None:
    """删除该 thread 的本地日志（幂等；文件不存在不报错）。"""
    try:
        p = _path(thread_id)
        if p.exists():
            p.unlink()
    except Exception:
        logger.warning("thread_log delete failed for %s", thread_id, exc_info=True)


def save_thread_meta(
    thread_id: str,
    meta: dict[str, Any],
) -> None:
    """保存/合并 thread 元数据（workspace/model/title 等）。

    langgraph dev 的 thread 存储在多实例/重启下会丢（列表直接变空），
    KCoder 自持元数据让侧边栏线程列表与项目分组得以存活。
    """
    try:
        data = load_thread(thread_id) or {"threadId": thread_id, "turns": []}
        existing = data.get("meta") or {}
        existing.update({k: v for k, v in meta.items() if v is not None})
        data["meta"] = existing
        tmp = _path(thread_id).with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        tmp.replace(_path(thread_id))
    except Exception:
        logger.warning("thread_log save meta failed for %s", thread_id, exc_info=True)


def list_logged_threads() -> list[dict[str, Any]]:
    """全部有日志的 thread 概要（id + meta + 最新时间 + 首条 prompt 作为标题兜底）。

    供 list_threads 与 langgraph 结果合并——langgraph 存储被清空时，
    侧边栏仍能列出这些线程（点开走 get_thread 的日志回退）。
    """
    out: list[dict[str, Any]] = []
    try:
        for p in _log_dir().glob("*.json"):
            thread_id = p.stem
            data = load_thread(thread_id)
            if not data:
                continue
            turns = data.get("turns") or []
            out.append(
                {
                    "threadId": thread_id,
                    "meta": data.get("meta") or {},
                    "savedAt": turns[-1].get("savedAt") if turns else None,
                    "prompt": turns[0].get("prompt") if turns else None,
                }
            )
    except Exception:
        logger.warning("thread_log list failed", exc_info=True)
    return out


def log_turns(thread_id: str) -> list[dict[str, Any]]:
    """日志中该 thread 的全部 turns（供 get_thread 兜底，保持落盘顺序）。"""
    data = load_thread(thread_id)
    return (data.get("turns") or []) if data else []


def latest_goal(thread_id: str) -> dict[str, Any] | None:
    """日志中最新一次 goal_updated 的 goal（新→旧找第一个）；无则 None。"""
    for turn in reversed(log_turns(thread_id)):
        goal = turn.get("goal")
        if isinstance(goal, dict) and goal.get("objective"):
            return goal
    return None


def latest_todos(thread_id: str) -> dict[str, Any] | None:
    """日志中最新一次 todos_updated 的 todos（新→旧找第一个）；无则 None。"""
    for turn in reversed(log_turns(thread_id)):
        todos = turn.get("todos")
        if isinstance(todos, dict) and isinstance(todos.get("items"), list) and todos["items"]:
            return todos
    return None


def goal_and_todos_from_events(
    events: list[dict[str, Any]],
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """从本轮 SSE 事件提取最后的 goal / todos（供 append_turn 持久化）。"""
    goal: dict[str, Any] | None = None
    todos: dict[str, Any] | None = None
    for ev in events:
        if ev.get("kind") == "goal_updated" and isinstance(ev.get("goal"), dict):
            goal = ev["goal"]
        elif ev.get("kind") == "todos_updated" and isinstance(ev.get("todos"), dict):
            todos = ev["todos"]
    return goal, todos


# ────────────────────────────────────────────────────────────────
# LangChain message → KCoder item 翻译（与 threads.py 历史语义一致）
# ────────────────────────────────────────────────────────────────


def _extract_text(content: Any) -> str:
    """从 LangChain content 提取纯文本。"""
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


def _extract_reasoning(msg: dict[str, Any]) -> str:
    """思考内容（reasoning_content）——additional_kwargs 或顶层。"""
    ak = msg.get("additional_kwargs") or {}
    for src in (ak, msg):
        text = src.get("reasoning_content")
        if isinstance(text, str) and text:
            return text
    return ""


def usage_from_msg(msg: dict[str, Any]) -> dict[str, Any] | None:
    """从 LangChain AI 消息提取 token 用量（KCoder 前端格式）。

    ``usage_metadata`` 是 langchain-core 标准（引擎 adapter 写入）；
    OpenAI 兼容的 ``additional_kwargs.usage`` 兜底。历史链路（state 翻译
    / thread-log 落盘）恢复消息时用它还原上下文统计——此前 usage 只存在
    于实时 SSE 流，任务切换再切回后统计清零。
    """
    im = msg.get("usage_metadata")
    if isinstance(im, dict):
        inp, out, tot = int(im.get("input_tokens") or 0), int(im.get("output_tokens") or 0), int(im.get("total_tokens") or 0)
        if tot > 0 or inp > 0 or out > 0:
            return {"promptTokens": inp, "completionTokens": out, "totalTokens": tot or inp + out}
    ak = msg.get("additional_kwargs") or {}
    u = ak.get("usage")
    if isinstance(u, dict):
        inp, out = int(u.get("prompt_tokens") or 0), int(u.get("completion_tokens") or 0)
        if inp > 0 or out > 0:
            return {"promptTokens": inp, "completionTokens": out, "totalTokens": int(u.get("total_tokens") or inp + out)}
    return None


def message_to_item(msg: dict[str, Any]) -> dict[str, Any] | None:
    """单条 LangChain message dict → KCoder TurnItem（与实时 SSE 语义对齐）。"""
    if not isinstance(msg, dict):
        return None

    msg_type = str(msg.get("type", msg.get("role", "")))
    type_lower = msg_type.lower()
    msg_id = str(msg.get("id", ""))

    if "human" in type_lower:
        # 内部注入消息（memory reminder 等）不进入历史
        additional_kwargs = msg.get("additional_kwargs") or {}
        is_hidden = bool(additional_kwargs.get("hide_from_ui"))
        if msg_id.endswith(INJECTED_MEMORY_MESSAGE_ID_SUFFIX) or is_hidden:
            return None
        if msg_id.endswith(INJECTED_USER_MESSAGE_ID_SUFFIX):
            msg_id = msg_id[: -len(INJECTED_USER_MESSAGE_ID_SUFFIX)]
        return {
            "id": msg_id,
            "kind": "user_message",
            "role": "user",
            "text": _extract_text(msg.get("content", "")),
        }

    if "ai" in type_lower:
        item: dict[str, Any] = {
            "id": msg_id,
            "kind": "assistant_text",
            "role": "assistant",
            "text": _extract_text(msg.get("content", "")),
        }
        reasoning = _extract_reasoning(msg)
        if reasoning:
            item["reasoning"] = reasoning
        usage = usage_from_msg(msg)
        if usage:
            item["usage"] = usage
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


def messages_to_items(messages: list[Any]) -> list[dict[str, Any]]:
    """messages 列表 → items 列表（跳过无法翻译的条目）。"""
    items: list[dict[str, Any]] = []
    for msg in messages:
        item = message_to_item(msg)
        if item:
            items.append(item)
    return items


# ────────────────────────────────────────────────────────────────
# SSE 事件 → items 重建（state 读不出时的兜底数据源）
# ────────────────────────────────────────────────────────────────


def items_from_sse_events(
    turn_id: str, prompt: str, events: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """用本轮已翻译的 SSE 事件重建 items（质量略低于 state 翻译，但可用）。

    前提：events 为 translate_event 的输出（与推给前端的事件一致）。
    """
    text_parts: list[str] = []
    tools: dict[str, dict[str, Any]] = {}
    usage: dict[str, Any] | None = None

    for ev in events:
        kind = ev.get("kind")
        if kind == "usage":
            u = ev.get("usage")
            if isinstance(u, dict):
                usage = u
        elif kind == "assistant_text_delta":
            text_parts.append(str(ev.get("delta") or ""))
        elif kind == "tool_call_started":
            call_id = str(ev.get("callId") or "")
            if call_id:
                entry = tools.get(call_id) or {}
                entry["toolName"] = ev.get("toolName") or entry.get("toolName", "")
                if ev.get("args"):
                    entry["args"] = ev.get("args")
                entry.setdefault("id", call_id)
                tools[call_id] = entry
        elif kind == "tool_call_finished":
            call_id = str(ev.get("callId") or "")
            if call_id:
                entry = tools.get(call_id) or {"id": call_id}
                entry["output"] = ev.get("summary") or ""
                tools[call_id] = entry

    items: list[dict[str, Any]] = [
        {"id": f"{turn_id}-user", "kind": "user_message", "role": "user", "text": prompt}
    ]
    assistant: dict[str, Any] = {
        "id": f"{turn_id}-assistant",
        "kind": "assistant_text",
        "role": "assistant",
        "text": "".join(text_parts),
    }
    if usage:
        assistant["usage"] = usage
    if tools:
        assistant["toolCalls"] = [
            {
                "id": t.get("id", ""),
                "toolName": t.get("toolName", ""),
                "args": t.get("args", {}),
            }
            for t in tools.values()
        ]
    items.append(assistant)
    # 工具输出单独成 tool_result items（loadThread 按 callId 回填）
    for t in tools.values():
        if t.get("output"):
            items.append(
                {
                    "id": f"{turn_id}-tool-{t.get('id', '')}",
                    "kind": "tool_result",
                    "role": "tool",
                    "toolName": t.get("toolName", ""),
                    "callId": t.get("id", ""),
                    "output": t.get("output", ""),
                }
            )
    return items
