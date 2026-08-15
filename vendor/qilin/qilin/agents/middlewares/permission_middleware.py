"""Permission middleware — KCoder local patch (execution-permission enforcement).

Four permission modes (injected via ``configurable.permission_mode`` by the
KCoder gateway):

- ``full-access``         — everything allowed (middleware passes through).
- ``auto-edit`` (default) — file edits auto-approved; dangerous shell commands
  rejected with a ToolMessage so the model retries safely or reports to user.
- ``plan-mode``           — read-only analysis: any mutating tool is rejected;
  the model is nudged to keep analyzing and produce a plan instead.
- ``confirm-before-change`` — mutating tools interrupt the run (Command → END,
  same pattern as ClarificationMiddleware). The ToolMessage carries an
  ``<approval_request id="...">`` block; the KCoder frontend renders an
  approval card. On approval the client starts a new turn with
  ``approved_ops=[id]`` injected into configurable — matching tool calls are
  then executed once.

Approved-op ids are stable hashes of (tool, canonical args), so a re-issued
call after approval matches without storing state in the graph.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from typing import Any, Callable, override

from langchain.agents.middleware import AgentMiddleware, ToolCallRequest
from langchain_core.messages import ToolMessage
from langgraph.config import get_config
from langgraph.graph import END
from langgraph.types import Command

logger = logging.getLogger(__name__)

# ── Tool classification ──────────────────────────────────────────────────────
# Read-only tools: analysis, search, navigation, presentation — always allowed.
READ_ONLY_TOOLS = frozenset(
    {
        "ls", "read_file", "glob", "grep",
        "web_search", "web_fetch",
        "browser_navigate", "browser_snapshot", "browser_get_text",
        "browser_back", "browser_screenshot",
        "present_files", "ask_clarification", "review_skill_package",
        "list_uploaded_files", "view_image", "tool_search",
    }
)

# Mutating tools: change files, run shell, delegate work.
MUTATING_TOOLS = frozenset({"write_file", "str_replace", "edit", "multiedit", "bash", "task"})

# Dangerous shell fragments (auto-edit mode still blocks these).
# Matched against the lowercased command string.
_DANGEROUS_CMD_RE = re.compile(
    r"rm\s+(-[a-z]*\s+)*-?[rf]"  # rm -rf / rm -r / rm -f combos
    r"|mkfs(\.\w+)?\b"
    r"|dd\s+if="
    r"|git\s+push\s+.*--force"
    r"|git\s+reset\s+--hard"
    r"|git\s+clean\s+-[a-z]*f"
    r"|curl[^|]*\|\s*(ba)?sh"
    r"|wget[^|]*\|\s*(ba)?sh"
    r"|\bsudo\b"
    r"|chmod\s+777"
    r"|>\s*/dev/sd[a-z]"
    r"|shutdown\b|reboot\b|killall\b"
)


def _canonical_tool_args(args: Any) -> str:
    """Stable canonical serialization of tool args (for approval ids)."""
    try:
        return json.dumps(args, sort_keys=True, ensure_ascii=False, default=str)
    except Exception:
        return str(args)


# 文件工具按 path 匹配、bash 按 command 匹配。原因：LLM 在「批准」后重发同一
# 操作时会重新生成 content（非确定），若按完整 args 哈希，内容任何微调都会
# 改变审批 id → 匹配不上 → 反复审批。按稳定身份字段匹配即可。
_APPROVAL_IDENTITY_FILE_TOOLS = frozenset(
    {
        "write_file", "create_file", "delete_file", "move_file",
        "edit", "str_replace", "multiedit",
    }
)


def _approval_identity(tool_name: str, args: Any) -> str:
    """审批匹配用的身份键（比完整 args 更宽，容忍 content 重生成）。"""
    if isinstance(args, dict):
        if tool_name in _APPROVAL_IDENTITY_FILE_TOOLS:
            for key in ("path", "file_path", "file", "filename"):
                path = args.get(key)
                if isinstance(path, str) and path:
                    return f"{tool_name}:path:{path}"
        if tool_name == "bash":
            command = args.get("command") or args.get("cmd")
            if isinstance(command, str) and command:
                return f"{tool_name}:command:{command}"
    return f"{tool_name}:{_canonical_tool_args(args)}"


def approval_id_for(tool_name: str, args: Any) -> str:
    """Stable short id for a (tool, args) pair — survives re-issue by the model."""
    payload = _approval_identity(tool_name, args)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:12]


def _is_dangerous_command(args: Any) -> str | None:
    """Return the matched dangerous fragment if the bash args look unsafe."""
    if not isinstance(args, dict):
        return None
    command = args.get("command") or args.get("cmd") or ""
    if not isinstance(command, str) or not command:
        return None
    m = _DANGEROUS_CMD_RE.search(command.lower())
    return m.group(0) if m else None


class PermissionMiddlewareState(dict):
    """Marker schema (permission enforcement is stateless per call)."""


class PermissionMiddleware(AgentMiddleware[PermissionMiddlewareState]):
    """Enforce the KCoder permission mode on every tool call."""

    state_schema = PermissionMiddlewareState

    # ── Config access ────────────────────────────────────────────────────────

    @staticmethod
    def _run_config() -> dict[str, Any]:
        try:
            cfg = get_config()
        except Exception:
            return {}
        configurable = (cfg or {}).get("configurable") or {}
        return configurable if isinstance(configurable, dict) else {}

    def _mode(self) -> str:
        return str(self._run_config().get("permission_mode") or "auto-edit")

    def _approved_ops(self) -> set[str]:
        approved = self._run_config().get("approved_ops")
        if isinstance(approved, (list, tuple, set)):
            return {str(x) for x in approved}
        return set()

    # ── Decision ─────────────────────────────────────────────────────────────

    def _check(self, tool_name: str, args: Any) -> tuple[str, str | None]:
        """Return (verdict, detail).

        verdict: allow | deny_dangerous | deny_plan | request_approval
        """
        mode = self._mode()
        if mode == "full-access":
            return "allow", None

        if tool_name in READ_ONLY_TOOLS or tool_name not in MUTATING_TOOLS:
            # Unknown tools (MCP etc.) default to read-only treatment; mutating
            # capability is only the curated list above.
            return "allow", None

        # Mutating tool from here on.
        if mode == "plan-mode":
            return "deny_plan", None

        if mode == "auto-edit":
            if tool_name in ("bash",):
                frag = _is_dangerous_command(args)
                if frag:
                    return "deny_dangerous", frag
            return "allow", None

        if mode == "confirm-before-change":
            op_id = approval_id_for(tool_name, args)
            if op_id in self._approved_ops():
                return "allow", None
            return "request_approval", op_id

        # Unknown mode string — fail safe as auto-edit.
        return "allow", None

    # ── ToolMessage builders ─────────────────────────────────────────────────

    @staticmethod
    def _tool_call_id(tool_call: dict[str, Any]) -> str:
        return str(tool_call.get("id") or "")

    def _deny_message(self, tool_call: dict[str, Any], verdict: str, detail: str | None) -> ToolMessage:
        if verdict == "deny_plan":
            content = (
                "BLOCKED by permission mode 'plan-mode': this run is read-only analysis. "
                "Do not attempt to modify files or run state-changing commands. "
                "Continue with read-only tools (read_file / grep / glob / ls) and produce "
                "a written implementation plan for the user instead."
            )
        else:  # deny_dangerous
            content = (
                f"BLOCKED by permission mode 'auto-edit': the shell command contains a "
                f"dangerous construct ({detail!r}) that requires explicit user approval. "
                "Do NOT retry it unchanged. Either ask the user via ask_clarification "
                "(risk_confirmation), or decompose into a safer non-destructive command."
            )
        return ToolMessage(content=content, tool_call_id=self._tool_call_id(tool_call))

    def _approval_request_message(
        self, tool_call: dict[str, Any], op_id: str
    ) -> ToolMessage:
        tool_name = str(tool_call.get("name") or "")
        args = tool_call.get("args") or {}
        pretty = _canonical_tool_args(args)
        if len(pretty) > 1500:
            pretty = pretty[:1500] + "…"
        content = (
            f"<approval_request id=\"{op_id}\" tool=\"{tool_name}\">\n"
            f"{pretty}\n"
            "</approval_request>\n\n"
            "This operation requires user approval (permission mode "
            "'confirm-before-change'). Execution has been paused. Wait for the user's "
            "decision — do not call this tool again unprompted."
        )
        return ToolMessage(content=content, tool_call_id=self._tool_call_id(tool_call))

    # ── Interception ─────────────────────────────────────────────────────────
    # IMPORTANT: checks run BEFORE the handler — a denied/approval-pending tool
    # must never execute. This differs from post-hoc filtering.

    def _precheck(self, request: ToolCallRequest) -> ToolMessage | Command | None:
        """Return an interception result, or None to execute the handler."""
        tool_call = request.tool_call
        tool_name = str(tool_call.get("name") or "")
        args = tool_call.get("args") or {}

        # 诊断日志：每个工具调用都记录其权限模式（确认中间件是否被调用、
        # configurable.permission_mode 是否透传到位）。
        logger.info("permission: precheck tool=%s mode=%s", tool_name, self._mode())

        verdict, detail = self._check(tool_name, args)
        if verdict == "allow":
            return None

        if verdict in ("deny_plan", "deny_dangerous"):
            msg = self._deny_message(tool_call, verdict, detail)
            logger.info("permission: denied %s (%s) mode=%s", tool_name, verdict, self._mode())
            return msg

        # request_approval — pause the run like ClarificationMiddleware.
        op_id = detail or approval_id_for(tool_name, args)
        msg = self._approval_request_message(tool_call, op_id)
        logger.info("permission: approval requested %s op=%s", tool_name, op_id)
        return Command(
            update={"messages": [msg]},
            goto=END,
        )

    @override
    def wrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command],
    ) -> ToolMessage | Command:
        intercepted = self._precheck(request)
        if intercepted is not None:
            return intercepted
        return handler(request)

    @override
    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Any],
    ) -> ToolMessage | Command:
        intercepted = self._precheck(request)
        if intercepted is not None:
            return intercepted
        return await handler(request)
