"""Sub-agents endpoints — Phase 13 本地 JSON 实现.

QiLin 的 subagents 是内部执行器，无 HTTP 管理接口。KCoder 的 Settings >
Sub-agents 面板需要完整 CRUD + clone，全部落在 ``<dataDir>/kcoder_local/
sub_agents.json``。

端点表
------

- ``GET /v1/sub-agents``                读 sub_agents.json → ``{ subAgents: SubAgentEntry[] }``
- ``POST /v1/sub-agents``               创建
- ``PATCH /v1/sub-agents/{id}``         更新
- ``DELETE /v1/sub-agents/{id}``        删除
- ``POST /v1/sub-agents/{id}/clone``    复制

数据结构（对齐 renderer SubAgentEntry）
-------------------------------------

::

    {
      "id": str,
      "name": str,
      "type": "builtin" | "user",
      "description": str,
      "tools": [str],
      "source": str,
      "content": str,
      "inheritMode": "default" | "custom",
      "createdAt": str | None,
      "updatedAt": str | None
    }
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from .local_store import load_json, resolve_local_dir, save_json

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/sub-agents", tags=["sub-agents"])


def _store_path(request: Request) -> Path:
    return resolve_local_dir(request) / "sub_agents.json"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load(request: Request) -> list[dict[str, Any]]:
    data = load_json(_store_path(request), default=[])
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    if isinstance(data, dict) and isinstance(data.get("subAgents"), list):
        return [item for item in data["subAgents"] if isinstance(item, dict)]
    return []


def _save(request: Request, agents: list[dict[str, Any]]) -> None:
    save_json(_store_path(request), agents)


def _normalize_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Pick only known fields + coerce types (defense against bad client input)."""
    out: dict[str, Any] = {}
    if "id" in payload:
        out["id"] = str(payload["id"] or "")
    if "name" in payload:
        out["name"] = str(payload["name"] or "")
    if "description" in payload:
        out["description"] = str(payload.get("description") or "")
    if "tools" in payload:
        raw_tools = payload.get("tools") or []
        if isinstance(raw_tools, list):
            out["tools"] = [str(t) for t in raw_tools]
        else:
            out["tools"] = []
    if "content" in payload:
        out["content"] = str(payload.get("content") or "")
    inherit_mode = payload.get("inheritMode")
    if inherit_mode in ("default", "custom"):
        out["inheritMode"] = inherit_mode
    return out


# --------------------------------------------------------------------------- #
# 端点
# --------------------------------------------------------------------------- #

@router.get("")
@router.get("/")
async def list_sub_agents(request: Request) -> dict[str, Any]:
    return {"subAgents": _load(request)}


@router.post("")
@router.post("/")
async def create_sub_agent(request: Request) -> JSONResponse:
    try:
        payload = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"error": "invalid JSON body"})
    if not isinstance(payload, dict):
        return JSONResponse(status_code=400, content={"error": "body must be an object"})

    agent_id = str(payload.get("id") or "")
    if not agent_id:
        return JSONResponse(status_code=400, content={"error": "id is required"})

    agents = _load(request)
    if any(a.get("id") == agent_id for a in agents):
        return JSONResponse(
            status_code=409,
            content={"error": f"sub-agent '{agent_id}' already exists"},
        )

    now = _utc_now()
    agent = {
        "id": agent_id,
        "name": str(payload.get("name") or agent_id),
        "type": "user",
        "description": str(payload.get("description") or ""),
        "tools": [str(t) for t in (payload.get("tools") or []) if isinstance(t, (str, int))],
        "source": "user",
        "content": str(payload.get("content") or ""),
        "inheritMode": payload.get("inheritMode") if payload.get("inheritMode") in ("default", "custom") else "default",
        "createdAt": now,
        "updatedAt": now,
    }
    agents.append(agent)
    _save(request, agents)
    return JSONResponse(status_code=200, content=agent)


@router.patch("/{agent_id}")
@router.patch("/{agent_id}/")
async def update_sub_agent(request: Request, agent_id: str) -> JSONResponse:
    try:
        payload = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"error": "invalid JSON body"})
    if not isinstance(payload, dict):
        return JSONResponse(status_code=400, content={"error": "body must be an object"})

    agents = _load(request)
    target = next((a for a in agents if a.get("id") == agent_id), None)
    if target is None:
        return JSONResponse(
            status_code=404,
            content={"error": f"sub-agent '{agent_id}' not found"},
        )

    normalized = _normalize_payload(payload)
    # id 不可改
    normalized.pop("id", None)
    target.update(normalized)
    target["updatedAt"] = _utc_now()
    _save(request, agents)
    return JSONResponse(status_code=200, content=target)


@router.delete("/{agent_id}")
@router.delete("/{agent_id}/")
async def delete_sub_agent(request: Request, agent_id: str) -> JSONResponse:
    agents = _load(request)
    new_agents = [a for a in agents if a.get("id") != agent_id]
    if len(new_agents) == len(agents):
        return JSONResponse(
            status_code=404,
            content={"error": f"sub-agent '{agent_id}' not found"},
        )
    _save(request, new_agents)
    return JSONResponse(status_code=200, content={"deleted": agent_id})


@router.post("/{agent_id}/clone")
@router.post("/{agent_id}/clone/")
async def clone_sub_agent(request: Request, agent_id: str) -> JSONResponse:
    agents = _load(request)
    source = next((a for a in agents if a.get("id") == agent_id), None)
    if source is None:
        return JSONResponse(
            status_code=404,
            content={"error": f"sub-agent '{agent_id}' not found"},
        )

    now = _utc_now()
    # 生成唯一 id：原 id + -copy / -copy-2 / ...
    base = f"{agent_id}-copy"
    new_id = base
    counter = 2
    existing_ids = {a.get("id") for a in agents}
    while new_id in existing_ids:
        new_id = f"{base}-{counter}"
        counter += 1

    clone = {
        "id": new_id,
        "name": f"{source.get('name') or agent_id} (copy)",
        "type": "user",
        "description": str(source.get("description") or ""),
        "tools": list(source.get("tools") or []),
        "source": "user",
        "content": str(source.get("content") or ""),
        "inheritMode": source.get("inheritMode") if source.get("inheritMode") in ("default", "custom") else "default",
        "createdAt": now,
        "updatedAt": now,
    }
    agents.append(clone)
    _save(request, agents)
    return JSONResponse(status_code=200, content=clone)
