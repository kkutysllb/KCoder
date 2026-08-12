"""Sub-agents endpoints — 本地 JSON 实现.

QiLin 的 subagents 是内部执行器，无 HTTP 管理接口。KCoder 的 Settings >
Sub-agents 面板需要完整 CRUD + 全局参数配置，全部落在
``<dataDir>/kcoder_local/sub_agents.json``。

存储格式：``{ "settings": {...}, "agents": [...] }``

端点表
------

- ``GET /v1/sub-agents``                 读 → ``{ settings, subAgents }``
- ``PUT /v1/sub-agents/settings``         更新全局参数
- ``POST /v1/sub-agents``                 创建子代理
- ``DELETE /v1/sub-agents/{id}``          删除子代理

全局参数 (settings)
------------------

::

    {
      "timeout_seconds": 1800,   # 子代理默认超时（秒）
      "max_turns": null,          # 全局最大轮次覆盖 (null=用默认值)
      "max_total_per_run": 6      # 每次 run 最大委派数 (1-50)
    }

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


# ---- 默认全局参数 ----
# 对齐 QiLin CustomSubagentConfig 默认值（vendor/qilin/qilin/config/subagents_config.py:111-120）
DEFAULT_SETTINGS: dict[str, Any] = {
    "timeout_seconds": 900,
    "max_turns": 50,
    "max_total_per_run": 6,
}


def _load_all(request: Request) -> dict[str, Any]:
    """读取完整存储（settings + agents），兼容旧格式。"""
    path = _store_path(request)
    data = load_json(path, default={"settings": dict(DEFAULT_SETTINGS), "agents": []})
    if isinstance(data, list):
        # v1 格式：裸数组 → 迁移
        return {"settings": dict(DEFAULT_SETTINGS), "agents": [d for d in data if isinstance(d, dict)]}
    if isinstance(data, dict):
        settings = data.get("settings") if isinstance(data.get("settings"), dict) else {}
        # 兼容旧 key subAgents
        agents_list = data.get("agents")
        if agents_list is None and isinstance(data.get("subAgents"), list):
            agents_list = data["subAgents"]
        if agents_list is None:
            agents_list = []
        # 合并 settings（未知字段保留，缺失字段补默认值）
        merged_settings = dict(DEFAULT_SETTINGS)
        merged_settings.update({k: v for k, v in settings.items() if k in DEFAULT_SETTINGS})
        return {"settings": merged_settings, "agents": [d for d in agents_list if isinstance(d, dict)]}
    return {"settings": dict(DEFAULT_SETTINGS), "agents": []}


def _load(request: Request) -> list[dict[str, Any]]:
    return _load_all(request)["agents"]


def _load_settings(request: Request) -> dict[str, Any]:
    return _load_all(request)["settings"]


def _save_all(request: Request, agents: list[dict[str, Any]], settings: dict[str, Any] | None = None) -> None:
    """原子写入完整存储。"""
    if settings is None:
        settings = _load_settings(request)
    save_json(_store_path(request), {"settings": settings, "agents": agents})


def _save(request: Request, agents: list[dict[str, Any]]) -> None:
    _save_all(request, agents)


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
    return {"settings": _load_settings(request), "subAgents": _load(request)}


@router.put("/settings")
@router.put("/settings/")
async def update_settings(request: Request) -> JSONResponse:
    """更新全局参数，写入 sub_agents.json 的 settings 段。"""
    try:
        payload = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"error": "invalid JSON body"})
    if not isinstance(payload, dict):
        return JSONResponse(status_code=400, content={"error": "body must be an object"})

    settings = _load_settings(request)
    # 只允许已知字段
    if "timeout_seconds" in payload:
        val = payload["timeout_seconds"]
        settings["timeout_seconds"] = max(1, int(val)) if val else DEFAULT_SETTINGS["timeout_seconds"]
    if "max_turns" in payload:
        val = payload["max_turns"]
        settings["max_turns"] = max(1, int(val)) if val else None
    if "max_total_per_run" in payload:
        val = payload["max_total_per_run"]
        settings["max_total_per_run"] = max(1, min(50, int(val))) if val else DEFAULT_SETTINGS["max_total_per_run"]

    agents = _load(request)
    _save_all(request, agents, settings)
    return JSONResponse(status_code=200, content=settings)


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
