"""ToolRetryMiddleware — KCoder local patch (transient read-only tool retry).

Error self-healing (Phase D2): when a READ-ONLY tool fails with the KCoder
sandbox convention (ToolMessage content starts with ``Error:``) or a langgraph
``status="error"`` ToolMessage, the middleware re-executes the exact same call
once before the model sees the failure.

Read-only tools are safe to retry (no side effects); mutating tools
(write_file / str_replace / bash / task ...) are never retried — a repeated
side effect could double-execute. Approval denials (``BLOCKED ...``) are not
``Error:`` failures and pass through untouched.
"""

from __future__ import annotations

import logging
from typing import Any, Callable, override

from langchain.agents.middleware import AgentMiddleware, ToolCallRequest
from langchain_core.messages import ToolMessage
from langgraph.types import Command

logger = logging.getLogger(__name__)

RETRYABLE_READ_ONLY_TOOLS = frozenset(
    {
        "ls", "read_file", "glob", "grep",
        "repo_map", "dep_map", "security_scan",
        "web_search", "web_fetch",
        "browser_snapshot", "browser_get_text",
    }
)


def _is_failure_result(result: Any) -> bool:
    """KCoder 沙箱工具的受控失败约定 + langgraph status=error。"""
    if not isinstance(result, ToolMessage):
        return False
    if getattr(result, "status", None) == "error":
        return True
    content = result.content
    if isinstance(content, str) and content.startswith("Error:"):
        return True
    # 内容为多段（multimodal）时检查第一段文本
    if isinstance(content, list):
        for part in content:
            if isinstance(part, dict) and isinstance(part.get("text"), str):
                return part["text"].startswith("Error:")
    return False


class ToolRetryMiddlewareState(dict):
    """Marker schema (stateless)."""


class ToolRetryMiddleware(AgentMiddleware[ToolRetryMiddlewareState]):
    """只读工具瞬态失败自动重试一次（Phase D2 错误自愈）。"""

    state_schema = ToolRetryMiddlewareState

    @override
    def wrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command],
    ) -> ToolMessage | Command:
        result = handler(request)
        tool_name = str(request.tool_call.get("name") or "")
        if tool_name not in RETRYABLE_READ_ONLY_TOOLS or not _is_failure_result(result):
            return result
        logger.info("tool_retry: retrying failed read-only tool %s once", tool_name)
        try:
            return handler(request)
        except Exception:
            logger.warning(
                "tool_retry: retry of %s raised; returning original failure",
                tool_name,
                exc_info=True,
            )
            return result

    @override
    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Any],
    ) -> ToolMessage | Command:
        result = await handler(request)
        tool_name = str(request.tool_call.get("name") or "")
        if tool_name not in RETRYABLE_READ_ONLY_TOOLS or not _is_failure_result(result):
            return result
        logger.info("tool_retry: retrying failed read-only tool %s once", tool_name)
        try:
            return await handler(request)
        except Exception:
            logger.warning(
                "tool_retry: retry of %s raised; returning original failure",
                tool_name,
                exc_info=True,
            )
            return result
