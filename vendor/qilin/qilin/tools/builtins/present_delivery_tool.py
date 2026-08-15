"""``present_delivery`` tool — KCoder PR/changelog delivery.

The final step of the delivery gate: after verification (<verification>) and
the review pass (<delivery_gate>) succeed, the agent calls this tool with a
PR-style summary plus a changelog entry. The returned ToolMessage carries a
``<delivery id="...">`` block that the KCoder frontend renders as a delivery
card with actions (copy PR description, append entry to CHANGELOG.md).

The id is a stable hash of (title, changes) so a re-presentation maps to the
same card.
"""

from __future__ import annotations

import hashlib
from typing import Annotated

from langchain.tools import InjectedToolCallId, tool
from langchain_core.messages import ToolMessage
from langgraph.types import Command


def _delivery_id(title: str, changes: list[str]) -> str:
    payload = "\n".join([title or "", *(str(change) for change in changes)])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:12]


@tool("present_delivery", parse_docstring=True)
def present_delivery_tool(
    title: str,
    summary: str,
    changes: list[str],
    tests_run: str,
    review_notes: str | None = None,
    changelog_entry: str | None = None,
    tool_call_id: Annotated[str, InjectedToolCallId] = "",
) -> Command:
    """Present the final PR-style delivery summary and changelog entry for the completed task.

    Call this once at the END of a non-trivial coding task, after verification
    and review pass. It produces the user-facing delivery card (copyable PR
    description + changelog entry). Do not call it for trivial edits.

    Args:
        title: Short, concrete change title (one line).
        summary: 2-4 sentence summary of what changed and why (the PR description body).
        changes: List of concrete changes made, one entry per meaningful change.
        tests_run: Commands you ran to verify (with results), or "none (no test framework)".
        review_notes: Findings from the review/security pass and how you addressed them.
        changelog_entry: One-line changelog entry (e.g. "fix: ..." / "feat: ...").
    """
    delivery_id = _delivery_id(title, changes)
    changes_block = "\n".join(f"- {change}" for change in changes)
    review_block = f"\n\nReview:\n{review_notes}" if review_notes else ""
    changelog_block = f"\n\nChangelog:\n{changelog_entry}" if changelog_entry else ""
    content = (
        f'<delivery id="{delivery_id}">\n'
        f"Title: {title}\n\n"
        f"{summary}\n\n"
        f"Changes:\n{changes_block}\n\n"
        f"Tests:\n{tests_run}"
        f"{review_block}"
        f"{changelog_block}\n"
        "</delivery>"
    )
    return Command(
        update={"messages": [ToolMessage(content=content, tool_call_id=tool_call_id)]},
    )
