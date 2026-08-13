"""Workspace change tracking for the KCoder gateway.

每轮 turn 前后对用户选择的 workspace 目录做快照对比，生成 per-file unified
diff 数据，附加到 SSE ``turn_completed`` 事件并累积 per-thread 变更历史，
供前端 FileChangeCard / ChangePanel 使用。

实现上复用 QiLin 的 ``workspace_changes`` 库（快照扫描 + diff 生成），但扫描
根指向用户选择的真实 workspace 目录（而非 QiLin 内部沙箱目录）。QiLin 引擎
自身的 ``record_workspace_changes`` 扫的是内部目录，对用户 workspace 失明，
因此这里在 gateway 侧独立计算。
"""

from __future__ import annotations

import asyncio
import logging
import shutil
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from qilin.workspace_changes import (
    compare_snapshots,
    get_changed_paths,
    scan_workspace_roots,
)
from qilin.workspace_changes.types import (
    WorkspaceChangeLimits,
    WorkspaceChangeResult,
    WorkspaceRoot,
    WorkspaceSnapshot,
)

logger = logging.getLogger("kcoder_gateway.workspace_changes")

WORKSPACE_VIRTUAL_PREFIX = "/mnt/user-data/workspace"
HISTORY_LIMIT = 50


@dataclass
class _PendingCapture:
    before: WorkspaceSnapshot
    text_cache_dir: str


@dataclass
class ThreadChangeRecord:
    turn_id: str
    timestamp: float
    changes: dict[str, Any]  # WorkspaceChangeResult.to_dict()


class WorkspaceChangesTracker:
    """Per-turn snapshot diffing + per-thread change history (in-memory)."""

    def __init__(self, limits: WorkspaceChangeLimits | None = None) -> None:
        self._limits = limits or WorkspaceChangeLimits()
        self._pending: dict[str, _PendingCapture] = {}
        self._history: dict[str, list[ThreadChangeRecord]] = {}

    # ── before ─────────────────────────────────────────────────

    async def capture_before(self, turn_id: str, workspace_path: str | None) -> None:
        """Capture the pre-turn snapshot of the user's workspace.

        失败仅记录日志，绝不影响对话启动。
        """
        if not workspace_path:
            return
        try:
            host_path = Path(workspace_path).expanduser().resolve()
            if not host_path.is_dir():
                logger.debug(
                    "Turn %s: workspace %s is not a directory — skipping change tracking",
                    turn_id, host_path,
                )
                return

            def _scan() -> tuple[WorkspaceSnapshot, str]:
                cache_dir = tempfile.mkdtemp(prefix="kcoder-ws-changes-")
                roots = [
                    WorkspaceRoot(
                        name="workspace",
                        host_path=host_path,
                        virtual_prefix=WORKSPACE_VIRTUAL_PREFIX,
                    )
                ]
                snapshot = scan_workspace_roots(
                    roots,
                    limits=self._limits,
                    include_text=True,
                    text_cache_dir=Path(cache_dir),
                )
                return snapshot, cache_dir

            snapshot, cache_dir = await asyncio.to_thread(_scan)
            self._pending[turn_id] = _PendingCapture(
                before=snapshot, text_cache_dir=cache_dir
            )
            logger.debug(
                "Turn %s: captured workspace snapshot (%d files)",
                turn_id, len(snapshot.files),
            )
        except Exception:
            logger.warning(
                "Failed to capture pre-turn workspace snapshot for turn %s",
                turn_id, exc_info=True,
            )

    # ── after ──────────────────────────────────────────────────

    async def compute_changes(
        self,
        turn_id: str,
        thread_id: str,
        workspace_path: str | None,
    ) -> dict[str, Any] | None:
        """Compute changes since capture_before(); returns result.to_dict() or None."""
        pending = self._pending.pop(turn_id, None)
        if pending is None:
            return None
        try:
            result = await asyncio.to_thread(
                self._compute_sync, pending.before, workspace_path
            )
        except Exception:
            logger.warning(
                "Failed to compute workspace changes for turn %s",
                turn_id, exc_info=True,
            )
            return None
        finally:
            if pending.text_cache_dir:
                await asyncio.to_thread(
                    shutil.rmtree, pending.text_cache_dir, ignore_errors=True
                )

        if result is None or not result.has_changes():
            return None

        payload = result.to_dict()
        self._append_history(thread_id, turn_id, payload)
        logger.info(
            "Turn %s: %s",
            turn_id,
            _format_summary(result),
        )
        return payload

    def _compute_sync(
        self, before: WorkspaceSnapshot, workspace_path: str | None
    ) -> WorkspaceChangeResult | None:
        if not workspace_path:
            return None
        host_path = Path(workspace_path).expanduser().resolve()
        if not host_path.is_dir():
            return None
        roots = [
            WorkspaceRoot(
                name="workspace",
                host_path=host_path,
                virtual_prefix=WORKSPACE_VIRTUAL_PREFIX,
            )
        ]
        # 第一遍：仅 metadata，找出变更路径（省去对未变文件的第二次全文读取）
        after_meta = scan_workspace_roots(
            roots, limits=self._limits, include_text=False
        )
        changed_paths = get_changed_paths(before, after_meta)
        if not changed_paths:
            return None
        # 第二遍：只读取变更文件的文本
        after = scan_workspace_roots(
            roots,
            limits=self._limits,
            include_text=True,
            text_paths=changed_paths,
        )
        return compare_snapshots(before, after, limits=self._limits)

    # ── history ────────────────────────────────────────────────

    def _append_history(
        self, thread_id: str, turn_id: str, payload: dict[str, Any]
    ) -> None:
        records = self._history.setdefault(thread_id, [])
        records.append(
            ThreadChangeRecord(
                turn_id=turn_id, timestamp=time.time(), changes=payload
            )
        )
        del records[:-HISTORY_LIMIT]

    def history(self, thread_id: str) -> list[dict[str, Any]]:
        """Change history for one thread, newest first, as API-ready dicts."""
        records = self._history.get(thread_id, [])
        return [
            {
                "turnId": record.turn_id,
                "timestamp": record.timestamp,
                "summary": record.changes.get("summary", {}),
                "files": record.changes.get("files", []),
            }
            for record in reversed(records)
        ]


def _format_summary(result: WorkspaceChangeResult) -> str:
    summary = result.summary
    count = (
        summary.created + summary.modified + summary.deleted + summary.symlink_created
    )
    return (
        f"{count} files changed "
        f"+{summary.additions} -{summary.deletions}"
        f"{' (truncated)' if summary.truncated else ''}"
    )
