"""Helpers for ``langgraph.types.Overwrite``-wrapped channel values."""

from typing import Any, cast

from langgraph.types import Overwrite


def unwrap_sandbox(sandbox: object) -> tuple[dict[str, Any] | None, bool]:
    """Unwrap an ``Overwrite``-wrapped sandbox channel value, if present.

    Fork-restored checkpoints can deliver the sandbox channel still wrapped in
    ``langgraph.types.Overwrite`` (the rollback restore applies replace-style
    writes through a state-mutation graph in delta checkpoint mode). Reading
    ``sandbox["sandbox_id"]`` or ``sandbox.get("sandbox_id")`` on the wrapper
    itself crashes, so unwrap before use.

    Returns ``(value, fork_restored)``. The wrapped form replays the parent
    thread's sandbox state, so callers must not treat the sandbox as owned by
    this run (e.g. release it).
    """
    if isinstance(sandbox, Overwrite):
        return cast(dict[str, Any] | None, sandbox.value), True
    return cast(dict[str, Any] | None, sandbox), False
