"""项目实体路由 — KCoder 一等项目概念.

产品定义（与侧边栏历史归类对齐）::

    项目 = 注册到 KCoder 的本地目录（agent 编码工作的上下文载体），
           生命周期独立于线程；删除项目只注销注册，不动磁盘目录。
    任务 = 创建时绑定了 workspace 的 thread（通过路径 join 到项目）。
    会话 = workspace 为空的 thread，不涉及项目。

存储于 ``kcoder_local/projects.json``（local_store 原子写）。
删除项目时其下任务自动归档（thread 数据保留，workspace 保留，
仅 metadata.archived=True），历史可回查不丢失。
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from .local_store import load_json, resolve_local_dir, save_json

logger = logging.getLogger("kcoder_gateway.projects")

router = APIRouter(prefix="/v1", tags=["projects"])

_PROJECTS_FILE = "projects.json"


class CreateProjectRequest(BaseModel):
    path: str
    name: str | None = None
    description: str | None = None


class UpdateProjectRequest(BaseModel):
    name: str | None = None
    description: str | None = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _get_client(request: Request) -> Any:
    """QiLin 客户端（本地取用，避免与 threads.py 循环导入）."""
    client = getattr(request.app.state, "qilin_client", None)
    if client is None:
        raise HTTPException(status_code=503, detail="QiLin client not initialized")
    return client


def _normalize_path(path: str) -> str:
    """路径规范化：expanduser + resolve（符号链接/相对路径统一）."""
    return str(Path(path).expanduser().resolve())


def _load_projects(request: Request) -> list[dict[str, Any]]:
    data = load_json(
        resolve_local_dir(request) / _PROJECTS_FILE, default={"projects": []}
    )
    if isinstance(data, dict) and isinstance(data.get("projects"), list):
        return data["projects"]
    return []


def _save_projects(request: Request, projects: list[dict[str, Any]]) -> None:
    save_json(resolve_local_dir(request) / _PROJECTS_FILE, {"projects": projects})


def _new_entry(path: str, name: str | None, description: str | None) -> dict[str, Any]:
    p = Path(path)
    now = _now_iso()
    return {
        "id": uuid.uuid4().hex[:12],
        "name": (name or "").strip() or p.name or path,
        "path": path,
        "description": (description or "").strip(),
        "is_git_repo": (p / ".git").exists(),
        "created_at": now,
        "updated_at": now,
    }


def _find_by_path(
    projects: list[dict[str, Any]], path: str
) -> dict[str, Any] | None:
    for p in projects:
        if p.get("path") == path:
            return p
    return None


def _find_by_id(projects: list[dict[str, Any]], pid: str) -> dict[str, Any] | None:
    for p in projects:
        if p.get("id") == pid:
            return p
    return None


def ensure_project(request: Request, path: str) -> dict[str, Any]:
    """workspace 路径注册为项目（upsert by path）。

    供 threads.create_thread 调用：新建任务绑定未注册路径时自动注册，
    保证侧边栏项目分组永不丢数据。重复调用幂等，返回已有条目。
    """
    normalized = _normalize_path(path)
    projects = _load_projects(request)
    existing = _find_by_path(projects, normalized)
    if existing:
        return existing
    entry = _new_entry(normalized, None, None)
    projects.append(entry)
    _save_projects(request, projects)
    logger.info("Auto-registered project: %s → %s", entry["id"], normalized)
    return entry


# ────────────────────────────────────────────────────────────────
# 端点
# ────────────────────────────────────────────────────────────────


@router.get("/projects")
async def list_projects(request: Request) -> dict[str, Any]:
    """列出所有已注册项目（按最近更新降序）."""
    projects = sorted(
        _load_projects(request),
        key=lambda p: p.get("updated_at", ""),
        reverse=True,
    )
    return {"projects": projects}


@router.post("/projects")
async def create_project(
    req: CreateProjectRequest,
    request: Request,
    silent_missing: bool = Query(False),
) -> dict[str, Any]:
    """注册项目（upsert by path）：path 已注册则返回已有条目。

    name 缺省取目录 basename；description 可选。

    ``silent_missing=true``（前端侧边栏自动注册专用）：目录不存在时返回
    200 + skipped 而非 400——死路径线程是历史残留，不该在开发者面板刷红。
    用户显式注册仍走严格路径（400）。
    """
    normalized = _normalize_path(req.path)
    if not Path(normalized).exists():
        if silent_missing:
            logger.info("create_project: skipped missing dir %s (silent_missing)", normalized)
            return {"skipped": True, "path": normalized, "reason": "missing"}
        raise HTTPException(
            status_code=400, detail=f"Directory does not exist: {normalized}"
        )

    projects = _load_projects(request)
    existing = _find_by_path(projects, normalized)
    if existing:
        return existing

    entry = _new_entry(normalized, req.name, req.description)
    projects.append(entry)
    _save_projects(request, projects)
    logger.info("Registered project: %s → %s", entry["id"], normalized)
    return entry


@router.patch("/projects/{project_id}")
async def update_project(
    project_id: str, req: UpdateProjectRequest, request: Request
) -> dict[str, Any]:
    """重命名项目 / 更新描述（path 不可改）."""
    projects = _load_projects(request)
    entry = _find_by_id(projects, project_id)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")

    if req.name is not None:
        name = req.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="name cannot be empty")
        entry["name"] = name
    if req.description is not None:
        entry["description"] = req.description.strip()
    entry["updated_at"] = _now_iso()
    _save_projects(request, projects)
    return entry


@router.delete("/projects/{project_id}")
async def delete_project(project_id: str, request: Request) -> dict[str, Any]:
    """注销项目注册（不动磁盘目录）。

    其下任务（workspace 匹配的未归档 thread）自动归档：
    thread 数据保留，历史可回查。
    """
    projects = _load_projects(request)
    entry = _find_by_id(projects, project_id)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")

    # 归档其下任务（失败不阻断注销，仅记日志）
    archived_count = 0
    try:
        client = _get_client(request)
        threads = await client.search_threads(limit=200)
        for t in threads:
            meta = t.get("metadata") or {}
            if meta.get("workspace") != entry["path"] or meta.get("archived"):
                continue
            try:
                await client.update_thread_metadata(
                    t.get("thread_id", ""), {"archived": True}
                )
                archived_count += 1
            except Exception:
                logger.warning(
                    "Failed to archive thread %s on project delete",
                    t.get("thread_id"),
                    exc_info=True,
                )
    except Exception:
        logger.exception("Failed to search threads on project delete")

    # thread-log 兜底数据同样归档：langgraph 重启丢 checkpoint 后，list_threads
    # 会用 thread-log 合并回线程。若只归档 langgraph 侧，删除项目后其任务仍会
    # 残留出现——且 workspace 目录已删，前端自动注册会对死路径 400、选中线程
    # 的 todos 404。这里把 thread-log 侧一并标记 archived。
    archived_log_count = 0
    try:
        from . import thread_log

        for logged in thread_log.list_logged_threads():
            tid = logged.get("threadId") or ""
            if not tid:
                continue
            logged_ws = ((logged.get("meta") or {}).get("workspace")) or ""
            if logged_ws and logged_ws == entry["path"]:
                thread_log.save_thread_meta(tid, {"archived": True})
                archived_log_count += 1
    except Exception:
        logger.warning("Failed to archive thread-log entries on project delete", exc_info=True)

    projects = [p for p in projects if p.get("id") != project_id]
    _save_projects(request, projects)
    logger.info(
        "Deleted project %s (%s), archived %d tasks (+%d thread-log)",
        project_id, entry.get("path"), archived_count, archived_log_count,
    )
    return {"deleted": True, "archivedThreads": archived_count, "archivedLogEntries": archived_log_count}
