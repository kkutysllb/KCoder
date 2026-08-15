"""``present_plan`` tool — KCoder plan-mode approval gate.

In plan-mode the PermissionMiddleware rejects every mutating tool call, so the
agent can only analyze with read-only tools. To leave plan-mode it must submit
its plan through this tool; the returned ToolMessage carries a
``<plan_request id="..." status="awaiting_approval">`` block that the KCoder
frontend renders as a plan-approval card. On approval the client starts a new
turn with ``permission_mode`` switched to ``auto-edit`` and the approved plan
replayed as context, so execution follows the approved plan.

The plan id is a stable hash of (title, steps): re-presenting the same plan
yields the same id, so an approval message already in flight can still match.
"""

from __future__ import annotations

import hashlib
from typing import Annotated

from langchain.tools import InjectedToolCallId, tool
from langchain_core.messages import ToolMessage
from langgraph.types import Command


def _plan_id(title: str, steps: list[str]) -> str:
    payload = "\n".join([title or "", *(str(step) for step in steps)])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:12]


@tool("present_plan", parse_docstring=True)
def present_plan_tool(
    title: str,
    overview: str,
    steps: list[str],
    verification: str | None = None,
    tool_call_id: Annotated[str, InjectedToolCallId] = "",
) -> Command:
    """Submit your implementation plan for user approval before any code changes.

    Use this tool when you are in plan-mode (or generally when the task is
    complex enough that the user should review the approach first). After
    calling it, STOP: do not call any mutating tool (write_file, str_replace,
    bash, task) until the user approves the plan and a new execution turn starts.

    Args:
        title: Short, concrete plan title (one line).
        overview: 2-4 sentence summary of what will be done and why this approach.
        steps: Ordered list of concrete implementation steps, each one action-focused.
        verification: How the result will be verified (tests to run, commands to check).
    """
    plan_id = _plan_id(title, steps)
    step_lines = "\n".join(f"{i}. {step}" for i, step in enumerate(steps, 1))
    verification_block = f"\n\nVerification:\n{verification}" if verification else ""
    content = (
        f'<plan_request id="{plan_id}" status="awaiting_approval">\n'
        f"Title: {title}\n\n"
        f"{overview}\n\n"
        f"Steps:\n{step_lines}"
        f"{verification_block}\n"
        "</plan_request>\n\n"
        "The plan has been submitted for user approval. Stop here — do not start "
        "implementing or call any mutating tool until the user approves the plan."
    )
    return Command(
        update={"messages": [ToolMessage(content=content, tool_call_id=tool_call_id)]},
    )
