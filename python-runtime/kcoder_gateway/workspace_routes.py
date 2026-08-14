"""Real /v1/workspace/* endpoints — replaces Phase 5 stub.

Uses git subprocess calls to report the branch / dirty status of a
workspace path. ``GET /v1/workspace/branches`` stays a stub because the
renderer derives its branch list from the status response.

Endpoint map (engine-api.ts L1348-1360)::

    GET  /v1/workspace/status?path=   → WorkspaceStatus
    GET  /v1/workspace/branches?path= → BranchListResponse (stub, kept)
    POST /v1/workspace/commit         → CommitResult（git add -A + commit）
    POST /v1/workspace/push           → CommitResult（git push）

All git calls are bounded by a 2-second timeout (commit/push 放宽到 30s，
因为可能要等远端响应) so a hung git process can't wedge the gateway.
"""

from __future__ import annotations

import logging
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import unquote

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger("kcoder_gateway.workspace")

router = APIRouter(prefix="/v1/workspace", tags=["workspace"])

_GIT_TIMEOUT = 2.0    # seconds — git status/branch 应本地秒级
_GIT_LONG_TIMEOUT = 30.0  # commit/push 可能要等远端响应，放宽到 30s


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
            "additions": None,
            "deletions": None,
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
            "additions": None,
            "deletions": None,
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

    # +/- 行数（additions/deletions）：`git diff --shortstat HEAD` 给出工作树相对
    # HEAD 的汇总（含 staged + unstaged）。输出形如 "3 files changed, 12 insertions(+), 7 deletions(-)"。
    additions: int | None = None
    deletions: int | None = None
    if is_dirty:
        ok_stat, shortstat = _run_git(decoded, "diff", "--shortstat", "HEAD")
        if ok_stat and shortstat:
            additions, deletions = _parse_shortstat(shortstat)
    else:
        # 工作树干净：显式 0，让前端 UI 显示稳定的 +0 −0 也能展示
        additions = 0
        deletions = 0

    return {
        "path": decoded,
        "exists": True,
        "isGitRepository": True,
        "branch": branch or None,
        "headSha": head_sha or None,
        "isDirty": is_dirty,
        "fileChangeCount": file_count,
        "additions": additions,
        "deletions": deletions,
        "checkedAt": checked_at,
    }


def _parse_shortstat(text: str) -> tuple[int, int]:
    """Parse `git diff --shortstat` output → (additions, deletions).

    Example inputs::

        " 3 files changed, 12 insertions(+), 7 deletions(-)"
        " 1 file changed, 2 insertions(+)"
        " 1 file changed, 3 deletions(-)"
        ""  # 工作树相对 HEAD 无变更 → (0, 0)

    任一字段缺失时按 0 处理（不让单边信息炸掉前端 UI）。
    """
    import re

    add_match = re.search(r"(\d+)\s+insertion", text)
    del_match = re.search(r"(\d+)\s+deletion", text)
    additions = int(add_match.group(1)) if add_match else 0
    deletions = int(del_match.group(1)) if del_match else 0
    return additions, deletions


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


class BranchCreateRequest(BaseModel):
    """POST /v1/workspace/branch 请求体。"""

    path: str = Field(..., description="工作区绝对路径")
    name: str = Field(..., min_length=1, description="新分支名")
    base: str | None = Field(default=None, description="起点（分支名/commit），默认当前 HEAD")


@router.post("/branch")
async def create_branch(req: BranchCreateRequest) -> dict[str, Any]:
    """POST /v1/workspace/branch → 创建并检出新分支（git checkout -b）.

    返回 ``{ path, branch, created }``。分支已存在时返回 409；git 不可用或
    非 git 仓库返回 400。失败信息附在 ``detail``。
    """
    cwd = _resolve_repo_or_400(req.path)
    # 先校验分支名是否已存在（git check-ref-format + rev-parse）
    ok_existing, _ = _run_git(cwd, "rev-parse", "--verify", f"refs/heads/{req.name}")
    if ok_existing:
        raise HTTPException(
            status_code=409,
            detail=f"branch already exists: {req.name!r}",
        )
    args = ["checkout", "-b", req.name]
    if req.base:
        args.append(req.base)
    ok, out = _run_git(cwd, *args)
    if not ok:
        # _run_git 吞了 stderr，用 --no-ff 之外的方式重取错误信息
        raise HTTPException(
            status_code=400,
            detail=f"failed to create branch {req.name!r}: {out or 'git error'}",
        )
    return {"path": cwd, "branch": req.name, "created": True}


# ────────────────────────────────────────────────────────────────
# 请求模型（POST 端点）
# ────────────────────────────────────────────────────────────────


class CommitRequest(BaseModel):
    """POST /v1/workspace/commit 请求体。"""

    path: str = Field(..., description="工作区绝对路径")
    message: str = Field(..., min_length=1, description="commit 信息（非空）")


class PushRequest(BaseModel):
    """POST /v1/workspace/push 请求体。"""

    path: str = Field(..., description="工作区绝对路径")
    remote: str | None = Field(default=None, description="远端名称，默认 origin")
    branch: str | None = Field(default=None, description="分支名，默认当前 HEAD")


def _run_git_long(cwd: str, *args: str) -> tuple[bool, str, str]:
    """Run a git command with longer timeout (commit/push); returns (ok, stdout, stderr)."""
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=_GIT_LONG_TIMEOUT,
            check=False,
        )
        return result.returncode == 0, result.stdout.strip(), result.stderr.strip()
    except subprocess.TimeoutExpired:
        return False, "", f"git {' '.join(args)} timed out after {_GIT_LONG_TIMEOUT}s"
    except (FileNotFoundError, OSError) as exc:
        return False, "", f"git not available: {exc}"


def _resolve_repo_or_400(path: str) -> str:
    """校验路径存在且为 git 仓库；通过则返回解码后的绝对路径。"""
    decoded = unquote(path) if path else ""
    if not decoded or not os.path.isdir(decoded):
        raise HTTPException(status_code=400, detail=f"path does not exist: {decoded!r}")
    ok, _ = _run_git(decoded, "rev-parse", "--git-dir")
    if not ok:
        raise HTTPException(status_code=400, detail=f"not a git repository: {decoded!r}")
    return decoded


@router.post("/commit")
async def commit_workspace(req: CommitRequest) -> dict[str, Any]:
    """POST /v1/workspace/commit → 提交工作区变更（git add -A + git commit）.

    返回结构化结果（success / output / error / headSha）。失败时 HTTP 200 +
    success=false（前端 InfoPanel 弹 alert）；成功时填充 headSha 供前端刷新。
    """
    cwd = _resolve_repo_or_400(req.path)

    # 先 add -A 把全部变更放进 index（用户预期"一键提交"）
    ok_add, _, err_add = _run_git_long(cwd, "add", "-A")
    if not ok_add:
        return {"success": False, "error": f"git add failed: {err_add}", "output": ""}

    ok_commit, out_commit, err_commit = _run_git_long(cwd, "commit", "-m", req.message)
    if not ok_commit:
        # 常见情况：nothing to commit（非错误，但 success=false 提示用户）
        err_lower = err_commit.lower()
        if "nothing to commit" in err_lower or "no changes added" in err_lower:
            return {"success": False, "error": "nothing to commit", "output": err_commit}
        return {"success": False, "error": err_commit, "output": out_commit}

    _, head_sha = _run_git(cwd, "rev-parse", "--short", "HEAD")
    return {
        "success": True,
        "output": out_commit,
        "headSha": head_sha or None,
    }


@router.post("/push")
async def push_workspace(req: PushRequest) -> dict[str, Any]:
    """POST /v1/workspace/push → 推送当前分支到远端.

    remote/branch 未指定时使用默认（git push 缺省 = origin + current HEAD）。
    """
    cwd = _resolve_repo_or_400(req.path)

    args = ["push"]
    if req.remote:
        args.append(req.remote)
    if req.branch:
        args.append(req.branch)

    ok, out, err = _run_git_long(cwd, *args)
    if not ok:
        return {"success": False, "error": err, "output": out}

    return {"success": True, "output": out}
