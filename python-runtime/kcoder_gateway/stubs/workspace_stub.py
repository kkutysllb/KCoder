"""Stub endpoints for /v1/workspace/* — replaced by real git status in Phase 7.

Returns a "not a git repo" status so the renderer's workspace bar shows
empty state. Response shapes mirror WorkspaceStatus /
BranchListResponse (engine-api.ts L532-549).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from urllib.parse import unquote

from fastapi import APIRouter

router = APIRouter(prefix="/v1/workspace", tags=["workspace-stub"])


@router.get("/status")
async def workspace_status(path: str = "") -> dict[str, Any]:
    """GET /v1/workspace/status?path= → empty/non-git status.

    Phase 7 replaces this with real git subprocess calls.
    """
    return {
        "path": unquote(path) if path else "",
        "exists": False,
        "isGitRepository": False,
        "branch": None,
        "headSha": None,
        "isDirty": None,
        "fileChangeCount": None,
        "checkedAt": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/branches")
async def list_branches(path: str = "") -> dict[str, Any]:
    """GET /v1/workspace/branches?path= → empty branch list."""
    return {
        "path": unquote(path) if path else "",
        "branches": [],
        "current": None,
    }
