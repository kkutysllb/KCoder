"""ToolRetryMiddleware 单测（Phase D2 错误自愈）。

覆盖：
- 只读工具 ``Error:`` 受控失败 → 同参重试一次，返回第二次结果
- 只读工具成功 → 不重试
- mutating 工具失败 → 绝不重试（防重复副作用）
- BLOCKED（审批拦截）不是 Error: 失败 → 不重试
- langgraph status="error" → 也触发重试
- 重试自身抛异常 → 返回原始失败（不让中间件把错误吞成崩溃）
"""

from __future__ import annotations

from langchain.agents.middleware import ToolCallRequest
from langchain_core.messages import ToolMessage

from qilin.agents.middlewares.tool_retry_middleware import ToolRetryMiddleware

M = ToolRetryMiddleware()


def _req(name: str, args: dict | None = None) -> ToolCallRequest:
    return ToolCallRequest(
        tool_call={"name": name, "id": "c1", "args": args or {}},
        tool=None,
        state={},
        runtime=None,
    )


def _handler_seq(results: list, log: list):
    def handler(req):
        log.append(req.tool_call["name"])
        return results[len(log) - 1]
    return handler


def test_readonly_error_retried_once():
    log: list = []
    fail = ToolMessage(content="Error: transient I/O", tool_call_id="c1")
    ok = ToolMessage(content="file body", tool_call_id="c1")
    result = M.wrap_tool_call(_req("read_file", {"path": "a.py"}), _handler_seq([fail, ok], log))
    assert log == ["read_file", "read_file"]
    assert result.content == "file body"


def test_readonly_success_not_retried():
    log: list = []
    ok = ToolMessage(content="file body", tool_call_id="c1")
    M.wrap_tool_call(_req("grep", {"pattern": "x"}), _handler_seq([ok, ok], log))
    assert log == ["grep"]


def test_mutating_never_retried():
    log: list = []
    fail = ToolMessage(content="Error: disk full", tool_call_id="c1")
    result = M.wrap_tool_call(_req("write_file", {"path": "a.py"}), _handler_seq([fail, fail], log))
    assert log == ["write_file"]
    assert result.content.startswith("Error:")


def test_blocked_approval_not_retried():
    """权限拦截的 BLOCKED 消息不是 Error: 失败，原样透传。"""
    log: list = []
    blocked = ToolMessage(content="BLOCKED by permission mode 'plan-mode': ...", tool_call_id="c1")
    result = M.wrap_tool_call(_req("read_file", {"path": "a.py"}), _handler_seq([blocked, blocked], log))
    assert log == ["read_file"]
    assert result.content.startswith("BLOCKED")


def test_status_error_retried():
    log: list = []
    fail = ToolMessage(content="boom", tool_call_id="c1", status="error")
    ok = ToolMessage(content="recovered", tool_call_id="c1")
    result = M.wrap_tool_call(_req("ls", {}), _handler_seq([fail, ok], log))
    assert log == ["ls", "ls"]
    assert result.content == "recovered"


def test_retry_raise_returns_original():
    log: list = []
    fail = ToolMessage(content="Error: first failure", tool_call_id="c1")

    def handler(req):
        log.append(1)
        if len(log) == 1:
            return fail
        raise RuntimeError("retry exploded")

    result = M.wrap_tool_call(_req("repo_map", {}), handler)
    assert result.content == "Error: first failure"
