"""Real /v1/workspace/* endpoints — replaces Phase 5 stub.

Uses git subprocess calls to report the branch / dirty status of a
workspace path. ``GET /v1/workspace/branches`` stays a stub because the
renderer derives its branch list from the status response.

Endpoint map (engine-api.ts L1348-1360)::

    GET /v1/workspace/status?path=   → WorkspaceStatus
    GET /v1/workspace/branches?path= → BranchListResponse (stub, kept)

All git calls are bounded by a 2-second timeout so a hung git process
in a huge repo can't wedge the gateway.
"""

from __future__ import annotations

import logging
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import unquote

from fastapi import APIRouter

logger = logging.getLogger("kcoder_gateway.workspace")

router = APIRouter(prefix="/v1/workspace", tags=["workspace"])

_GIT_TIMEOUT = 2.0  # seconds — git commands should be near-instant on local repos


def _run_git(cwd: str, *args: str) -> tuple[bool, str]:
    """Run a git command in *cwd*, returning (success, stdout_trimmed).

    Any failure (non-zero exit, timeout, missing git binary, not a repo)
    returns (False, ""). The caller treats failure as "not available".
    """
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=_GIT_TIMEOUT,
            check=False,
        )
        if result.returncode != 0:
            return False, ""
        return True, result.stdout.strip()
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return False, ""


def _query_workspace(path: str) -> dict[str, Any]:
    """Gather git status for *path*. Returns a WorkspaceStatus dict."""
    decoded = unquote(path) if path else ""
    checked_at = datetime.now(timezone.utc).isoformat()

    # Path must exist on disk to even attempt git commands.
    if not decoded or not os.path.exists(decoded):
        return {
            "path": decoded,
            "exists": False,
            "isGitRepository": False,
            "branch": None,
            "headSha": None,
            "isDirty": None,
            "fileChangeCount": None,
            "checkedAt": checked_at,
        }

    # Detect git repo + current branch in one call.
    ok_branch, branch = _run_git(decoded, "rev-parse", "--abbrev-ref", "HEAD")
    if not ok_branch:
        # Not a git repo (or git unavailable).
        return {
            "path": decoded,
            "exists": True,
            "isGitRepository": False,
            "branch": None,
            "headSha": None,
            "isDirty": None,
            "fileChangeCount": None,
            "checkedAt": checked_at,
        }

    # HEAD sha (short for readability).
    _, head_sha = _run_git(decoded, "rev-parse", "--short", "HEAD")

    # Porcelain status — one line per changed file.
    ok_status, status_output = _run_git(decoded, "status", "--porcelain")
    if ok_status:
        changed_files = [ln for ln in status_output.splitlines() if ln.strip()]
        file_count = len(changed_files)
        is_dirty = file_count > 0
    else:
        file_count = 0
        is_dirty = None  # unknown — couldn't query

    return {
        "path": decoded,
        "exists": True,
        "isGitRepository": True,
        "branch": branch or None,
        "headSha": head_sha or None,
        "isDirty": is_dirty,
        "fileChangeCount": file_count,
        "checkedAt": checked_at,
    }


@router.get("/status")
async def workspace_status(path: str = "") -> dict[str, Any]:
    """GET /v1/workspace/status?path= → real git-backed WorkspaceStatus."""
    return _query_workspace(path)


@router.get("/branches")
async def list_branches(path: str = "") -> dict[str, Any]:
    """GET /v1/workspace/branches?path= → stub (renderer derives from status).

    Kept as an empty-list stub. The renderer's branch display reads the
    ``branch`` field from the status response; a full branch listing is
    not needed for the workspace bar.
    """
    decoded = unquote(path) if path else ""
    return {
        "path": decoded,
        "branches": [],
        "current": None,
    }
