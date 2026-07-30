"""Commands endpoints — Phase 13 本地 JSON 实现.

QiLin 有 slash.py 但无 HTTP 管理接口。KCoder 的 Settings > Commands 面板
需要完整 CRUD，全部落在 ``<dataDir>/kcoder_local/commands.json``。

端点表
------

- ``GET /v1/commands``             读 commands.json → ``{ commands: CommandEntry[] }``
- ``POST /v1/commands``            创建
- ``PATCH /v1/commands/{id}``      更新
- ``DELETE /v1/commands/{id}``     删除

数据结构（对齐 renderer CommandEntry）
-------------------------------------

::

    {
      "id": str,
      "description": str,
      "content": str,
      "source": "skill" | "user",
      "skillId": str | None,
      "aliases": [str],
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

router = APIRouter(prefix="/v1/commands", tags=["commands"])


def _store_path(request: Request) -> Path:
    return resolve_local_dir(request) / "commands.json"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load(request: Request) -> list[dict[str, Any]]:
    data = load_json(_store_path(request), default=[])
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    if isinstance(data, dict) and isinstance(data.get("commands"), list):
        return [item for item in data["commands"] if isinstance(item, dict)]
    return []


def _save(request: Request, commands: list[dict[str, Any]]) -> None:
    save_json(_store_path(request), commands)


def _normalize_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Pick only known fields + coerce types."""
    out: dict[str, Any] = {}
    if "description" in payload:
        out["description"] = str(payload.get("description") or "")
    if "content" in payload:
        out["content"] = str(payload.get("content") or "")
    if "aliases" in payload:
        raw = payload.get("aliases") or []
        if isinstance(raw, list):
            out["aliases"] = [str(a) for a in raw]
        else:
            out["aliases"] = []
    if "skillId" in payload:
        out["skillId"] = str(payload["skillId"]) if payload.get("skillId") else None
    return out


# --------------------------------------------------------------------------- #
# 端点
# --------------------------------------------------------------------------- #

@router.get("")
@router.get("/")
async def list_commands(request: Request) -> dict[str, Any]:
    return {"commands": _load(request)}


@router.post("")
@router.post("/")
async def create_command(request: Request) -> JSONResponse:
    try:
        payload = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"error": "invalid JSON body"})
    if not isinstance(payload, dict):
        return JSONResponse(status_code=400, content={"error": "body must be an object"})

    command_id = str(payload.get("id") or "")
    if not command_id:
        return JSONResponse(status_code=400, content={"error": "id is required"})

    commands = _load(request)
    if any(c.get("id") == command_id for c in commands):
        return JSONResponse(
            status_code=409,
            content={"error": f"command '{command_id}' already exists"},
        )

    now = _utc_now()
    command = {
        "id": command_id,
        "description": str(payload.get("description") or ""),
        "content": str(payload.get("content") or ""),
        "source": "user",
        "skillId": None,
        "aliases": [str(a) for a in (payload.get("aliases") or []) if isinstance(a, (str, int))],
        "createdAt": now,
        "updatedAt": now,
    }
    commands.append(command)
    _save(request, commands)
    return JSONResponse(status_code=200, content=command)


@router.patch("/{command_id}")
@router.patch("/{command_id}/")
async def update_command(request: Request, command_id: str) -> JSONResponse:
    try:
        payload = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"error": "invalid JSON body"})
    if not isinstance(payload, dict):
        return JSONResponse(status_code=400, content={"error": "body must be an object"})

    commands = _load(request)
    target = next((c for c in commands if c.get("id") == command_id), None)
    if target is None:
        return JSONResponse(
            status_code=404,
            content={"error": f"command '{command_id}' not found"},
        )

    normalized = _normalize_payload(payload)
    target.update(normalized)
    target["updatedAt"] = _utc_now()
    _save(request, commands)
    return JSONResponse(status_code=200, content=target)


@router.delete("/{command_id}")
@router.delete("/{command_id}/")
async def delete_command(request: Request, command_id: str) -> JSONResponse:
    commands = _load(request)
    new_commands = [c for c in commands if c.get("id") != command_id]
    if len(new_commands) == len(commands):
        return JSONResponse(
            status_code=404,
            content={"error": f"command '{command_id}' not found"},
        )
    _save(request, new_commands)
    return JSONResponse(status_code=200, content={"deleted": command_id})
