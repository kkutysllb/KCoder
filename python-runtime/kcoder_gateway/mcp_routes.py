"""MCP/Tools configuration endpoints — Phase 12 真实对接 QiLin ExtensionsConfig.

KCoder renderer 的 Settings > MCP 面板通过 ``GET/POST /v1/mcp/config`` 读写
MCP server 配置。Phase 8 把这两个端点降级为 no-op（返回空配置），Phase 12
恢复真实读写，数据落地到 QiLin 的 ``extensions_config.json``。

关键映射规则
------------

1. **transport ↔ type**：KCoder UI 用 ``transport``（值：stdio / streamable-http
   / sse），QiLin McpServerConfig 用 ``type``（值：stdio / http / sse）。
   QiLin 的 ``_accept_transport_alias`` validator 已接受 ``transport`` 字段，
   但 ``streamable-http`` 需要在 gateway 层归一化为 ``http``。
2. **双格式返回**：renderer 同时读 ``mcp_servers`` 和 ``mcpServers`` 两个 key
   （历史遗留兼容），gateway 两个都填。
3. **原子写**：用 temp file + ``os.replace`` 避免 crash 留 truncated JSON。
4. **reload**：写后调 ``reload_extensions_config()`` 让 QiLin 单例立即生效。
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/mcp", tags=["mcp"])


# --------------------------------------------------------------------------- #
# 字段映射 helpers
# --------------------------------------------------------------------------- #

def _normalize_transport_in(value: Any) -> str:
    """KCoder transport 值 → QiLin type 值.

    KCoder UI 可选值：``stdio`` / ``streamable-http`` / ``sse``。
    QiLin 认 ``stdio`` / ``http`` / ``sse``。``streamable-http`` 归一化为 ``http``。
    """
    v = str(value or "stdio").strip().lower()
    if v == "streamable-http":
        return "http"
    if v in ("stdio", "http", "sse"):
        return v
    return "stdio"


def _normalize_transport_out(value: Any) -> str:
    """QiLin type 值 → KCoder transport 值（反向映射）."""
    v = str(value or "stdio").strip().lower()
    if v == "http":
        return "streamable-http"
    if v in ("stdio", "sse"):
        return v
    return "stdio"


def _server_to_entry(server: Any) -> dict[str, Any]:
    """QiLin McpServerConfig → KCoder McpServerConfigEntry."""
    # server 是 pydantic model；用 model_dump 拿全部字段
    try:
        data = server.model_dump(by_alias=False)
    except Exception:
        data = {}

    enabled = bool(data.get("enabled", True))
    transport = _normalize_transport_out(data.get("type"))
    entry: dict[str, Any] = {
        "enabled": enabled,
        "transport": transport,
    }
    # stdio 字段
    if data.get("command"):
        entry["command"] = str(data["command"])
    if data.get("args"):
        entry["args"] = list(data["args"])
    # http/sse 字段
    if data.get("url"):
        entry["url"] = str(data["url"])
    if data.get("headers"):
        entry["headers"] = dict(data["headers"])
    if data.get("env"):
        entry["env"] = dict(data["env"])
    # 可选字段直通
    if data.get("description"):
        entry["description"] = str(data["description"])
    tool_call_timeout = data.get("tool_call_timeout")
    if tool_call_timeout is not None:
        # QiLin 存秒，KCoder UI 用毫秒
        try:
            entry["timeoutMs"] = int(float(tool_call_timeout) * 1000)
        except (TypeError, ValueError):
            pass
    return entry


def _entry_to_server_dict(entry: Any) -> dict[str, Any]:
    """KCoder McpServerConfigEntry → QiLin 可解析的 dict.

    QiLin McpServerConfig 用 ``extra='allow'`` + ``_accept_transport_alias``，
    所以多余的 ``trustScope`` 等字段会被保留但 Pydantic 不报错。我们把
    ``transport`` 同时写成 ``type``（避免 alias validator 的边界情况）。
    """
    if not isinstance(entry, dict):
        return {}

    server: dict[str, Any] = {
        "enabled": bool(entry.get("enabled", True)),
        "type": _normalize_transport_in(entry.get("transport") or entry.get("type")),
    }
    if entry.get("command"):
        server["command"] = str(entry["command"])
    if entry.get("args"):
        server["args"] = [str(a) for a in entry["args"]]
    if entry.get("url"):
        server["url"] = str(entry["url"])
    if entry.get("headers"):
        server["headers"] = {str(k): str(v) for k, v in entry["headers"].items()}
    if entry.get("env"):
        server["env"] = {str(k): str(v) for k, v in entry["env"].items()}
    if entry.get("description"):
        server["description"] = str(entry["description"])
    timeout_ms = entry.get("timeoutMs")
    if timeout_ms is not None:
        try:
            server["tool_call_timeout"] = float(int(timeout_ms)) / 1000.0
        except (TypeError, ValueError):
            pass
    # KCoder 特有字段直通（QiLin extra='allow' 会保留）
    for passthrough_key in ("trustScope", "trustedWorkspaceRoots"):
        if entry.get(passthrough_key) is not None:
            server[passthrough_key] = entry[passthrough_key]
    return server


# --------------------------------------------------------------------------- #
# extensions_config.json 读写
# --------------------------------------------------------------------------- #

def _resolve_config_path() -> Path | None:
    """解析 extensions_config.json 路径.

    优先级（与 QiLin ExtensionsConfig.resolve_config_path 一致）：
    1. ``QILIN_EXTENSIONS_CONFIG_PATH`` 环境变量（main.py 启动时已设置）
    2. runtime 目录下的 ``extensions_config.json``
    3. None（未配置）
    """
    env_path = os.environ.get("QILIN_EXTENSIONS_CONFIG_PATH")
    if env_path:
        p = Path(env_path)
        if p.exists():
            return p
    runtime_dir = Path(__file__).resolve().parent.parent
    fallback = runtime_dir / "extensions_config.json"
    if fallback.exists():
        return fallback
    return None


def _atomic_write_json(path: Path, data: dict[str, Any]) -> None:
    """原子写 JSON：temp file + os.replace（同目录 rename 保证原子）."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        prefix=path.name + ".",
        suffix=".tmp",
        dir=str(path.parent),
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fp:
            json.dump(data, fp, indent=2, ensure_ascii=False)
            fp.write("\n")
        os.replace(tmp_name, path)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def _read_config_via_qilin() -> dict[str, Any] | None:
    """通过 QiLin 单例读 extensions_config（线程安全）."""
    try:
        from qilin.config.extensions_config import get_extensions_config

        cfg = get_extensions_config()
        return _build_response(cfg)
    except Exception:
        logger.debug("get_extensions_config failed", exc_info=True)
        return None


def _build_response(cfg: Any) -> dict[str, Any]:
    """把 QiLin ExtensionsConfig 转成 KCoder McpConfigResponse 双格式."""
    mcp_servers: dict[str, Any] = {}
    try:
        raw_servers = getattr(cfg, "mcp_servers", {}) or {}
        for name, server in raw_servers.items():
            mcp_servers[str(name)] = _server_to_entry(server)
    except Exception:
        logger.debug("mcp_servers mapping failed", exc_info=True)
        mcp_servers = {}

    skills_state: dict[str, Any] = {}
    try:
        raw_skills = getattr(cfg, "skills", {}) or {}
        for name, state in raw_skills.items():
            enabled = bool(getattr(state, "enabled", True))
            skills_state[str(name)] = {"enabled": enabled}
    except Exception:
        logger.debug("skills mapping failed", exc_info=True)
        skills_state = {}

    return {
        "mcp_servers": mcp_servers,
        "mcpServers": dict(mcp_servers),  # 双格式兼容 renderer
        "skills": skills_state,
    }


def _write_config(mcp_servers_input: dict[str, Any]) -> dict[str, Any] | None:
    """合并传入的 mcp_servers → 写回 extensions_config.json → reload.

    返回重载后的 McpConfigResponse，失败返回 None。
    """
    config_path = _resolve_config_path()
    if config_path is None:
        logger.warning("extensions_config.json path unresolved — MCP write rejected")
        return None

    # 读当前配置（用 QiLin 单例，保证拿到最新状态）
    try:
        from qilin.config.extensions_config import get_extensions_config

        current = get_extensions_config()
        config_data = current.to_file_dict()
    except Exception:
        # QiLin 未就绪时直接读文件
        try:
            config_data = json.loads(config_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            config_data = {}

    # 转换并合并
    normalized: dict[str, Any] = {}
    for name, entry in (mcp_servers_input or {}).items():
        normalized[str(name)] = _entry_to_server_dict(entry)

    config_data["mcpServers"] = normalized
    # 同时写 mcp_servers key（兼容旧读取路径， QiLin to_file_dict 只写 mcpServers alias）
    config_data["mcp_servers"] = normalized

    try:
        _atomic_write_json(config_path, config_data)
    except OSError:
        logger.exception("atomic write extensions_config.json failed")
        return None

    # reload QiLin 单例，让后续 Agent 构造拿到新配置
    try:
        from qilin.config.extensions_config import reload_extensions_config

        reloaded = reload_extensions_config()
        return _build_response(reloaded)
    except Exception:
        logger.debug("reload_extensions_config failed", exc_info=True)
        # 文件已写，fallback 到读文件重新构造响应
        return _read_config_via_qilin()


# --------------------------------------------------------------------------- #
# 端点
# --------------------------------------------------------------------------- #

@router.get("/config")
@router.get("/config/")
async def get_mcp_config() -> dict[str, Any]:
    """读 extensions_config.json → 返回 McpConfigResponse 双格式."""
    result = _read_config_via_qilin()
    if result is not None:
        return result
    # QiLin 未就绪：尝试直接读文件
    config_path = _resolve_config_path()
    if config_path is None or not config_path.exists():
        return {"mcp_servers": {}, "mcpServers": {}, "skills": {}}
    try:
        raw = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"mcp_servers": {}, "mcpServers": {}, "skills": {}}
    # 把原始 mcpServers dict 转成 KCoder entry 格式
    raw_servers = raw.get("mcpServers") or raw.get("mcp_servers") or {}
    normalized: dict[str, Any] = {}
    for name, entry in raw_servers.items():
        normalized[str(name)] = _server_to_entry(_DictServer(entry))
    return {
        "mcp_servers": normalized,
        "mcpServers": dict(normalized),
        "skills": {},
    }


class _DictServer:
    """适配器：把 dict 包装成有 model_dump 方法的对象，复用 _server_to_entry."""

    def __init__(self, data: dict[str, Any]) -> None:
        self._data = data

    def model_dump(self, by_alias: bool = True) -> dict[str, Any]:
        return dict(self._data)


@router.post("/config")
@router.post("/config/")
async def save_mcp_config(request: Request) -> JSONResponse:
    """合并传入的 mcp_servers → 写回 extensions_config.json → reload."""
    try:
        payload = await request.json()
    except Exception:
        try:
            body = (await request.body()).decode("utf-8", errors="replace")
        except Exception:
            body = ""
        logger.warning("MCP save: invalid JSON body: %r", body[:200])
        return JSONResponse(
            status_code=400,
            content={"error": "invalid JSON body", "mcp_servers": {}, "mcpServers": {}, "skills": {}},
        )

    mcp_servers_input = {}
    if isinstance(payload, dict):
        # 兼容两种 key
        mcp_servers_input = payload.get("mcp_servers")
        if mcp_servers_input is None:
            mcp_servers_input = payload.get("mcpServers")
        if mcp_servers_input is None:
            mcp_servers_input = {}
    elif isinstance(payload, list):
        # renderer 历史曾传 list[entry]，忽略但返回 400 引导修正
        return JSONResponse(
            status_code=400,
            content={
                "error": "mcp_servers must be an object, got array",
                "mcp_servers": {},
                "mcpServers": {},
                "skills": {},
            },
        )

    if not isinstance(mcp_servers_input, dict):
        return JSONResponse(
            status_code=400,
            content={
                "error": "mcp_servers must be an object",
                "mcp_servers": {},
                "mcpServers": {},
                "skills": {},
            },
        )

    result = _write_config(mcp_servers_input)
    if result is None:
        return JSONResponse(
            status_code=503,
            content={
                "error": "extensions_config.json unavailable",
                "mcp_servers": {},
                "mcpServers": {},
                "skills": {},
            },
        )
    return JSONResponse(status_code=200, content=result)
