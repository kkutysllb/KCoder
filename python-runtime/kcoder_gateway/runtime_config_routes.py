"""Runtime config endpoints — memory / summarization / title 三段读写.

数据流::

    renderer Settings > Memory
        ↓ getRuntimeConfig / updateRuntimeConfigSection
    GET/PUT /v1/runtime-config[/{section}]
        ↓ 读 / 写 config.yaml（PyYAML round-trip）
    QiLin get_app_config() signature 热重载
        ↓ _apply_singleton_configs → load_*_config_from_dict
    get_memory_config() / get_summarization_config() / get_title_config()

设计要点：
    1. 读：直接调 QiLin ``get_*_config().model_dump()`` 返回**生效值**（而非
       文件原始值），确保前端看到的是热重载后的真实状态
    2. 写：PyYAML round-trip（safe_load 全文 → 改一段 → safe_dump 回）。注释
       丢失可接受：config.yaml 由 KCoder 自动管理，注释在 config.yaml.example
    3. 原子写入：tempfile + os.replace（避免引擎读到半写文件）
    4. Pydantic 校验：PUT 入参用 QiLin 的 ``MemoryConfig`` /
       ``SummarizationConfig`` / ``TitleConfig`` 直接校验，失败返回 400 +
       fieldErrors
    5. 热重载触发：PUT 后调 ``get_app_config()``，其内部 signature 检测发现
       文件变更自动重载（app_config.py:683）
"""

from __future__ import annotations

import logging
import os
import tempfile
from pathlib import Path
from typing import Any, Literal

import yaml
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ValidationError

logger = logging.getLogger("kcoder_gateway.runtime_config")

router = APIRouter(prefix="/v1/runtime-config", tags=["runtime-config"])

# 可编辑的配置段名（与 QiLin AppConfig 顶层字段对齐）
RuntimeConfigSection = Literal["memory", "summarization", "title"]
_VALID_SECTIONS: tuple[str, ...] = ("memory", "summarization", "title")


# ────────────────────────────────────────────────────────────────
# 配置路径解析
# ────────────────────────────────────────────────────────────────


def _resolve_config_path() -> Path:
    """解析 config.yaml 路径。

    优先级：
      1. ``QILIN_CONFIG_PATH`` 环境变量（gateway 启动时由 main.py:316 设置）
      2. <runtime_dir>/config.yaml（仓库内 python-runtime/config.yaml）
    """
    env_path = os.environ.get("QILIN_CONFIG_PATH")
    if env_path:
        p = Path(env_path)
        if p.exists():
            return p
        logger.warning("QILIN_CONFIG_PATH=%s does not exist, falling back", env_path)

    runtime_dir = Path(__file__).resolve().parent.parent
    return runtime_dir / "config.yaml"


# ────────────────────────────────────────────────────────────────
# QiLin 配置模型 import（懒加载，避免网关启动时强依赖）
# ────────────────────────────────────────────────────────────────


def _get_qilin_config_models() -> dict[str, type[BaseModel]]:
    """懒加载 QiLin 三段配置 Pydantic 模型，用于 PUT 入参校验。"""
    from qilin.config.memory_config import MemoryConfig
    from qilin.config.summarization_config import SummarizationConfig
    from qilin.config.title_config import TitleConfig

    return {
        "memory": MemoryConfig,
        "summarization": SummarizationConfig,
        "title": TitleConfig,
    }


def _read_effective_configs() -> dict[str, dict[str, Any]]:
    """读取三段配置的**生效值**（QiLin 热重载后的单例）。"""
    from qilin.config.memory_config import get_memory_config
    from qilin.config.summarization_config import get_summarization_config
    from qilin.config.title_config import get_title_config

    return {
        "memory": get_memory_config().model_dump(),
        "summarization": get_summarization_config().model_dump(),
        "title": get_title_config().model_dump(),
    }


# ────────────────────────────────────────────────────────────────
# 原子写入
# ────────────────────────────────────────────────────────────────


def _atomic_write(path: Path, content: str) -> None:
    """原子写入：同目录 tempfile + os.replace（避免跨文件系统 rename 失败）。"""
    fd, tmp_path = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent)
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
        os.replace(tmp_path, str(path))
    except Exception:
        # 清理残留 tmp 文件
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


# ────────────────────────────────────────────────────────────────
# 端点
# ────────────────────────────────────────────────────────────────


@router.get("")
@router.get("/")
async def get_runtime_config() -> dict[str, Any]:
    """GET /v1/runtime-config → { memory, summarization, title } 生效值。"""
    try:
        return _read_effective_configs()
    except Exception as exc:
        logger.exception("Failed to read runtime config")
        raise HTTPException(status_code=500, detail=f"Failed to read config: {exc}") from exc


@router.get("/{section}")
async def get_runtime_config_section(section: str) -> dict[str, Any]:
    """GET /v1/runtime-config/{section} → 单段生效值。"""
    if section not in _VALID_SECTIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid section '{section}'. Valid: {_VALID_SECTIONS}",
        )
    try:
        return _read_effective_configs()[section]
    except Exception as exc:
        logger.exception("Failed to read config section %s", section)
        raise HTTPException(status_code=500, detail=f"Failed to read config: {exc}") from exc


@router.put("/{section}")
async def update_runtime_config_section(
    section: str, request: Request
) -> dict[str, Any]:
    """PUT /v1/runtime-config/{section} → 写单段到 config.yaml，返回新生效值。

    入参为段内容的 JSON 对象（如 ``{"enabled": true, "mode": "middleware"}``）。
    用 QiLin 对应的 Pydantic 模型校验后写回。
    """
    if section not in _VALID_SECTIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid section '{section}'. Valid: {_VALID_SECTIONS}",
        )

    # 解析请求体
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body") from None
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Body must be a JSON object")

    # Pydantic 校验（用 QiLin 模型，确保字段类型/范围正确）
    models = _get_qilin_config_models()
    model_cls = models[section]
    try:
        validated = model_cls(**payload)
    except ValidationError as ve:
        # 字段级错误明细，前端可定位展示
        field_errors = [
            {"field": ".".join(str(x) for x in err["loc"]), "message": err["msg"], "type": err["type"]}
            for err in ve.errors()
        ]
        raise HTTPException(
            status_code=422,
            detail={"message": "Config validation failed", "errors": field_errors},
        ) from ve

    # 读 config.yaml → 替换段 → 原子写回
    config_path = _resolve_config_path()
    if not config_path.exists():
        raise HTTPException(
            status_code=500,
            detail=f"Config file not found at {config_path}",
        )

    try:
        raw = config_path.read_text(encoding="utf-8")
        data = yaml.safe_load(raw) if raw.strip() else {}
        if not isinstance(data, dict):
            data = {}

        # 整段替换（model_dump(mode="json") 让 Literal/Path 等可序列化）
        data[section] = validated.model_dump(mode="json")

        dumped = yaml.safe_dump(data, allow_unicode=True, sort_keys=False, default_flow_style=False)
        _atomic_write(config_path, dumped)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to write config section %s", section)
        raise HTTPException(status_code=500, detail=f"Failed to write config: {exc}") from exc

    # 触发 QiLin 热重载：get_app_config() 内部 signature 检测文件变更后自动重载
    # （app_config.py:683 should_reload 分支）。重载会刷新 get_*_config() 单例。
    try:
        from qilin.config.app_config import get_app_config

        get_app_config()
    except Exception:
        logger.warning("Failed to trigger QiLin config reload (non-fatal)", exc_info=True)

    # 读回生效值返回（可能因热重载延迟而仍是旧值，前端可轮询刷新）
    try:
        return _read_effective_configs()[section]
    except Exception as exc:
        logger.exception("Failed to read back config section %s", section)
        # 写入已成功，读回失败不报错，返回 payload
        return validated.model_dump(mode="json")
