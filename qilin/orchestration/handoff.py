"""Handoff protocol: structured context transfer between agents.

一次 handoff 是 ``from_agent`` 把 ``task``（新任务或续做任务）连同
``context``（共享状态子集，如 trace_id / sandbox / thread_data）移交给
``to_agent``；完成后 ``result`` 回填。字段全部可选语义兼容 v1 的纯文本
调用-返回：即使只传 ``task`` 也能工作。
"""

import copy
from dataclasses import dataclass, field
from typing import Any


@dataclass
class AgentHandoff:
    """Structured handoff request."""

    from_agent: str
    to_agent: str
    task: str
    context: dict[str, Any] = field(default_factory=dict)
    result: str | None = None  # 由 to_agent 回填

    def to_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {
            "from_agent": self.from_agent,
            "to_agent": self.to_agent,
            "task": self.task,
            "context": copy.deepcopy(self.context),
        }
        if self.result is not None:
            data["result"] = self.result
        return data


@dataclass
class HandoffResult:
    """Outcome of executing a handoff."""

    success: bool
    result: str | None = None
    error: str | None = None
    handoff: AgentHandoff | None = None


class HandoffError(RuntimeError):
    """Raised when a handoff cannot be delivered (unknown target, etc.)."""
