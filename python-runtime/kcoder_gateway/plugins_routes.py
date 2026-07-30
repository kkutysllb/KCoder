"""Plugins endpoints — Phase 13 本地 JSON 实现.

QiLin 没有 plugin 系统，KCoder 的 Settings > Plugins 面板需要一个 CRUD
后端。所有数据落在 ``<dataDir>/kcoder_local/plugins.json``，gateway 自管。

端点表
------

- ``GET /v1/plugins``                  读 plugins.json → ``{ plugins: PluginEntry[] }``
- ``GET /v1/plugins/discover``         返回 ``{ plugins: [] }``（无市场源）
- ``POST /v1/plugins/{id}/toggle``     翻转 enabled
- ``POST /v1/plugins/{id}/install``    添加到 plugins.json
- ``POST /v1/plugins/check-updates``   返回 ``{ updates: [] }``

数据结构（对齐 renderer PluginEntry）
-----------------------------------

::

    {
      "id": str,
      "name": str,
      "version": str,
      "description": str,
      "builtin": bool,
      "enabled": bool,
      "source": "official" | "community" | "unknown",
      "category": str,
      "provides": { skills, commands, hooks, mcpServers },
      "author": str | None,
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

router = APIRouter(prefix="/v1/plugins", tags=["plugins"])


def _plugins_path(request: Request) -> Path:
    return resolve_local_dir(request) / "plugins.json"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _empty_plugin(plugin_id: str) -> dict[str, Any]:
    """Seed a freshly installed plugin with safe defaults."""
    return {
        "id": plugin_id,
        "name": plugin_id,
        "version": "0.0.0",
        "description": "",
        "builtin": False,
        "enabled": True,
        "source": "unknown",
        "category": "general",
        "provides": {"skills": 0, "commands": 0, "hooks": 0, "mcpServers": 0},
        "author": None,
        "updatedAt": _utc_now(),
    }


def _load_plugins(request: Request) -> list[dict[str, Any]]:
    data = load_json(_plugins_path(request), default=[])
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    if isinstance(data, dict) and isinstance(data.get("plugins"), list):
        return [item for item in data["plugins"] if isinstance(item, dict)]
    return []


def _save_plugins(request: Request, plugins: list[dict[str, Any]]) -> None:
    save_json(_plugins_path(request), plugins)


# --------------------------------------------------------------------------- #
# 端点
# --------------------------------------------------------------------------- #

@router.get("")
@router.get("/")
async def list_plugins(request: Request) -> dict[str, Any]:
    return {"plugins": _load_plugins(request)}


@router.get("/discover")
@router.get("/discover/")
async def discover_plugins() -> dict[str, Any]:
    """No marketplace source — always empty (UI shows empty state)."""
    return {"plugins": []}


@router.post("/{plugin_id}/toggle")
@router.post("/{plugin_id}/toggle/")
async def toggle_plugin(request: Request, plugin_id: str) -> JSONResponse:
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    enabled = bool(payload.get("enabled")) if isinstance(payload, dict) else False

    plugins = _load_plugins(request)
    target = next((p for p in plugins if p.get("id") == plugin_id), None)
    if target is None:
        return JSONResponse(
            status_code=404,
            content={"error": f"plugin '{plugin_id}' not found"},
        )
    target["enabled"] = enabled
    target["updatedAt"] = _utc_now()
    _save_plugins(request, plugins)
    return JSONResponse(status_code=200, content=target)


@router.post("/{plugin_id}/install")
@router.post("/{plugin_id}/install/")
async def install_plugin(request: Request, plugin_id: str) -> JSONResponse:
    plugins = _load_plugins(request)
    existing = next((p for p in plugins if p.get("id") == plugin_id), None)
    if existing is not None:
        # 幂等：已安装则直接返回
        return JSONResponse(status_code=200, content=existing)

    # 尝试从 body 读 metadata（DiscoverPlugin install 场景），没有就用默认
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}

    plugin = _empty_plugin(plugin_id)
    if payload:
        for key in ("name", "version", "description", "category", "author"):
            value = payload.get(key)
            if isinstance(value, str) and value:
                plugin[key] = value
        source = payload.get("source")
        if isinstance(source, str) and source in ("official", "community", "unknown"):
            plugin["source"] = source
        builtin = payload.get("builtin")
        if isinstance(builtin, bool):
            plugin["builtin"] = builtin

    plugins.append(plugin)
    _save_plugins(request, plugins)
    return JSONResponse(status_code=200, content=plugin)


@router.post("/check-updates")
@router.post("/check-updates/")
async def check_plugin_updates() -> dict[str, Any]:
    """No marketplace source — never reports updates."""
    return {"updates": []}
