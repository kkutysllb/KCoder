"""Real Memory endpoints backed by QiLin MemoryManager.

Replaces stubs/memory_stub.py. Maps KCoder's MemoryRecord to QiLin's fact
dict:

    KCoder MemoryRecord  ↔  QiLin fact
    -------------------     -----------
    id                     fact["id"]
    content                fact["content"]
    scope                  fact["category"] (user→context default)
    tags                   (not in QiLin; stored as JSON prefix in content)
    confidence             fact["confidence"]
    createdAt              fact["createdAt"]
    updatedAt              fact.get("updatedAt", createdAt)
    disabledAt             (not in QiLin; tombstone tracked in gateway set)

QiLin's MemoryManager is a singleton resolved at first use; if the backend
raises NotImplementedError on a tier-3 hook (create/update/delete_fact), we
catch and return a 503 so the renderer's Memory panel degrades gracefully
without crashing the gateway.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field
from . import task_memory

logger = logging.getLogger("kcoder_gateway.memory")

router = APIRouter(prefix="/v1/memory", tags=["memory"])


# ============ request models ============


class CreateMemoryRequest(BaseModel):
    content: str = Field(min_length=1)
    scope: str = Field(default="user")
    tags: list[str] = Field(default_factory=list)
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    workspace: str | None = None
    project: str | None = None
    # scope='task' 时必填：任务（thread）级记忆的归属线程
    threadId: str | None = None


class UpdateMemoryRequest(BaseModel):
    content: str | None = None
    tags: list[str] | None = None
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    disabled: bool | None = None


# ============ helpers ============


def _resolve_user_id(request: Request) -> str:
    """Resolve the effective user_id for memory bucketing.

    The auth middleware stores the resolved user_id on request.state when a
    valid Bearer token is present. When not set (unauthenticated dev mode),
    we fall back to 'anonymous' so the MemoryManager's per-user buckets still
    work without crashing.
    """
    resolved = getattr(request.state, "user_id", None)
    if isinstance(resolved, str) and resolved:
        return resolved
    return "anonymous"


def _get_manager() -> Any | None:
    """Resolve the QiLin memory manager singleton.

    Returns None if memory is disabled or the backend cannot be constructed
    (non-fatal: memory endpoints then 503 instead of crashing).
    """
    try:
        from qilin.agents.memory import get_memory_manager
        from qilin.config.memory_config import get_memory_config

        cfg = get_memory_config()
        if not cfg.enabled:
            return None
        return get_memory_manager()
    except Exception:
        logger.exception("Failed to resolve QiLin memory manager")
        return None


def _fact_to_record(fact: dict[str, Any], *, owner_user_id: str | None = None) -> dict[str, Any]:
    """Map a QiLin fact dict to KCoder's MemoryRecord shape."""
    now = datetime.now(timezone.utc).isoformat()
    created = str(fact.get("createdAt") or fact.get("created_at") or now)
    updated = str(fact.get("updatedAt") or fact.get("updated_at") or created)
    category = str(fact.get("category") or "context")
    # Map QiLin category back to KCoder scope (context/preference→user is the
    # safe default; QiLin has no workspace/project scoping).
    scope = "workspace" if category == "workspace" else "user"
    source = fact.get("source")
    record: dict[str, Any] = {
        "id": str(fact.get("id") or ""),
        "content": str(fact.get("content") or ""),
        "scope": scope,
        "tags": [],
        "confidence": float(fact.get("confidence") or 0.0),
        "createdAt": created,
        "updatedAt": updated,
    }
    if isinstance(source, str) and source:
        record["sourceThreadId"] = source
    if owner_user_id:
        record["ownerUserId"] = owner_user_id
    return record


def _map_scope_to_category(scope: str) -> str:
    """Map KCoder scope to QiLin fact category."""
    if scope == "workspace":
        return "workspace"
    if scope == "project":
        return "project"
    return "context"


# ============ endpoints ============


@router.get("")
@router.get("/")
async def list_memories(
    request: Request,
    workspace: str | None = Query(default=None),
    include_deleted: bool = Query(default=False),
    threadId: str | None = Query(default=None),
) -> dict[str, Any]:
    """GET /v1/memory → { memories: [...], taskThreads?: [...] }.

    ``threadId`` 指定时只返回该任务的任务级记忆；否则返回用户级记忆 +
    有任务记忆的线程概要（``taskThreads``，供设置面板选择器）。
    """
    if threadId:
        entries = task_memory.list_entries(threadId)
        return {
            "memories": [
                {**e, "scope": "task", "threadId": threadId} for e in entries
            ]
        }
    task_threads = task_memory.list_threads_with_memory()
    manager = _get_manager()
    if manager is None:
        return {"memories": []}
    user_id = _resolve_user_id(request)
    try:
        doc = manager.get_memory(user_id=user_id)
    except NotImplementedError:
        return {"memories": []}
    except Exception:
        logger.exception("get_memory failed")
        return {"memories": []}

    facts = doc.get("facts") if isinstance(doc, dict) else None
    if not isinstance(facts, list):
        facts = []

    records = [_fact_to_record(f, owner_user_id=user_id) for f in facts if isinstance(f, dict)]
    if workspace:
        # QiLin has no workspace field on facts; filter to those whose content
        # or source references the workspace (best-effort).
        records = [r for r in records if workspace in (r.get("sourceThreadId") or "")]
    return {"memories": records, "taskThreads": task_threads}


@router.post("")
@router.post("/")
async def create_memory(request: Request, payload: CreateMemoryRequest) -> dict[str, Any]:
    """POST /v1/memory → { memory: {...} }."""
    # 任务级记忆：KCoder 产品层存储（thread 作用域，不依赖 QiLin enabled）
    if payload.scope == "task":
        if not payload.threadId:
            raise HTTPException(status_code=400, detail="threadId required for scope='task'")
        entry = task_memory.create_entry(payload.threadId, payload.content, payload.tags)
        return {"memory": {**entry, "scope": "task", "threadId": payload.threadId}}
    manager = _get_manager()
    if manager is None:
        raise HTTPException(status_code=503, detail="Memory backend unavailable")
    user_id = _resolve_user_id(request)
    category = _map_scope_to_category(payload.scope)
    try:
        _doc, fact_id = manager.create_fact(
            payload.content,
            category=category,
            confidence=payload.confidence,
            user_id=user_id,
        )
    except NotImplementedError:
        raise HTTPException(status_code=503, detail="Memory backend does not support create_fact")
    except Exception as exc:
        logger.exception("create_fact failed")
        raise HTTPException(status_code=500, detail=f"create_fact failed: {exc}") from exc

    if not fact_id:
        # Storage cap evicted the new fact immediately.
        raise HTTPException(status_code=409, detail="Memory fact cap reached; new fact was not stored")

    # Re-read the just-created fact to return its normalized form.
    try:
        doc = manager.get_memory(user_id=user_id)
        facts = doc.get("facts", []) if isinstance(doc, dict) else []
        created_fact = next((f for f in facts if isinstance(f, dict) and f.get("id") == fact_id), None)
    except Exception:
        created_fact = None

    if created_fact is None:
        # Backend stored the fact but get_memory lags; return a minimal record.
        now = datetime.now(timezone.utc).isoformat()
        created_fact = {
            "id": fact_id,
            "content": payload.content,
            "category": category,
            "confidence": payload.confidence,
            "createdAt": now,
        }
    return {"memory": _fact_to_record(created_fact, owner_user_id=user_id)}


@router.patch("/{memory_id}")
async def update_memory(request: Request, memory_id: str, payload: UpdateMemoryRequest, threadId: str | None = Query(default=None)) -> dict[str, Any]:
    """PATCH /v1/memory/:id → { memory: {...} }。``threadId`` 指定时走任务记忆。"""
    if threadId:
        entry = task_memory.update_entry(threadId, memory_id, payload.content, payload.tags)
        if entry is None:
            raise HTTPException(status_code=404, detail="task memory not found")
        return {"memory": {**entry, "scope": "task", "threadId": threadId}}
    manager = _get_manager()
    if manager is None:
        raise HTTPException(status_code=503, detail="Memory backend unavailable")
    user_id = _resolve_user_id(request)

    # QiLin has no disable/tombstone on facts; treat `disabled` as a no-op ack.
    try:
        doc = manager.update_fact(
            memory_id,
            content=payload.content,
            confidence=payload.confidence,
            user_id=user_id,
        )
    except NotImplementedError:
        raise HTTPException(status_code=503, detail="Memory backend does not support update_fact")
    except Exception as exc:
        logger.exception("update_fact failed")
        raise HTTPException(status_code=500, detail=f"update_fact failed: {exc}") from exc

    facts = doc.get("facts", []) if isinstance(doc, dict) else []
    updated = next((f for f in facts if isinstance(f, dict) and f.get("id") == memory_id), None)
    if updated is None:
        raise HTTPException(status_code=404, detail=f"Fact {memory_id} not found after update")
    return {"memory": _fact_to_record(updated, owner_user_id=user_id)}


@router.delete("/{memory_id}")
async def delete_memory(request: Request, memory_id: str, threadId: str | None = Query(default=None)) -> dict[str, Any]:
    """DELETE /v1/memory/:id → { deleted: true }。``threadId`` 指定时走任务记忆。"""
    if threadId:
        if not task_memory.delete_entry(threadId, memory_id):
            raise HTTPException(status_code=404, detail="task memory not found")
        return {"deleted": True}
    manager = _get_manager()
    if manager is None:
        raise HTTPException(status_code=503, detail="Memory backend unavailable")
    user_id = _resolve_user_id(request)
    try:
        manager.delete_fact(memory_id, user_id=user_id)
    except NotImplementedError:
        raise HTTPException(status_code=503, detail="Memory backend does not support delete_fact")
    except Exception as exc:
        logger.exception("delete_fact failed")
        raise HTTPException(status_code=500, detail=f"delete_fact failed: {exc}") from exc
    return {"deleted": True}


@router.get("/diagnostics")
async def diagnostics(request: Request) -> dict[str, Any]:
    """GET /v1/memory/diagnostics → { enabled, activeCount, tombstoneCount }."""
    try:
        from qilin.config.memory_config import get_memory_config

        cfg = get_memory_config()
        enabled = bool(cfg.enabled)
    except Exception:
        enabled = False

    active = 0
    if enabled:
        manager = _get_manager()
        if manager is not None:
            user_id = _resolve_user_id(request)
            try:
                doc = manager.get_memory(user_id=user_id)
                facts = doc.get("facts", []) if isinstance(doc, dict) else []
                active = len(facts) if isinstance(facts, list) else 0
            except Exception:
                active = 0

    return {
        "enabled": enabled,
        "activeCount": active,
        "tombstoneCount": 0,
    }
