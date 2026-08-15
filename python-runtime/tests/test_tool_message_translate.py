"""_translate_tool_message 单测（Phase C3 失败状态如实传递）。

覆盖：
- 成功 → isError=False
- langgraph status="error" → isError=True
- KCoder 沙箱 "Error:" 前缀 → isError=True
- 无 tool_call_id → None（无法归属的事件丢弃）
- ask_clarification 的 artifact 解包（human_input 透传）
- 审批 BLOCKED 文案不误标失败（不以 Error: 开头）
"""

from __future__ import annotations

from kcoder_gateway.sse import _translate_tool_message


def test_success():
    ev = _translate_tool_message(
        {"tool_call_id": "c1", "content": "file body", "name": "read_file"}
    )
    assert ev is not None
    assert ev["kind"] == "tool_call_finished"
    assert ev["isError"] is False
    assert ev["toolName"] == "read_file"


def test_status_error():
    ev = _translate_tool_message(
        {"tool_call_id": "c1", "content": "boom", "name": "bash", "status": "error"}
    )
    assert ev is not None and ev["isError"] is True


def test_error_prefix():
    ev = _translate_tool_message(
        {"tool_call_id": "c1", "content": "Error: Directory not found", "name": "ls"}
    )
    assert ev is not None and ev["isError"] is True


def test_no_call_id_dropped():
    assert _translate_tool_message({"content": "orphan", "name": "ls"}) is None


def test_clarification_artifact_unwrapped():
    payload = {"kind": "human_input_request", "input_mode": "choice"}
    ev = _translate_tool_message(
        {
            "tool_call_id": "c2",
            "content": "pick one",
            "name": "ask_clarification",
            "artifact": {"human_input": payload},
        }
    )
    assert ev is not None
    assert ev["artifact"] == payload


def test_blocked_not_misflagged():
    ev = _translate_tool_message(
        {
            "tool_call_id": "c3",
            "content": "BLOCKED by permission mode 'plan-mode': read-only run.",
            "name": "write_file",
        }
    )
    assert ev is not None and ev["isError"] is False


def test_approval_request_marked_as_message_not_error():
    """审批请求 ToolMessage（confirm 模式）不是失败——前端按 approval 卡渲染。"""
    content = '<approval_request id="abc123" tool="write_file">\n{"path": "x"}\n</approval_request>'
    ev = _translate_tool_message(
        {"tool_call_id": "c4", "content": content, "name": "write_file"}
    )
    assert ev is not None and ev["isError"] is False
    assert "<approval_request" in ev["summary"]
