r"""KCoder QiLin gateway 启动入口（单 Python 进程）。

用法
----
在 python-runtime 目录下用 venv 启动引擎自带 gateway：

    .venv/bin/python run_gateway.py

架构（2026-08 重构后）
----------------------
KCoder 产品层重构：删除自研 kcoder_gateway 翻译层与 langgraph dev 平台，
前端直连 QiLin 引擎自带的生产级 gateway（``app.gateway``，位于
``vendor/qilin/app``）。单一 Python 进程完成：auth / threads / runs /
memory / skills / mcp / models / 事件流 全部能力。

环境约定
--------
- 用户数据根：``~/.kcoder``（``KCODER_APP_DATA_DIR`` 可覆盖）
- 引擎配置：``<数据根>/config/qilin.runtime.yaml``（由桌面端或本脚本生成）
- 引擎运行数据：``<数据根>/runtime/qilin``（sqlite checkpoint / 用户库）
- 端口：``KCODER_GATEWAY_PORT``（桌面端注入；默认 18900）

兼容垫片
--------
vendor/qilin 快照（config_version 31）存在一处上游不一致：
``app/gateway/routers/mcp.py`` 引用了 ``qilin.config.extensions_config``
中尚未提供的三个符号（``extensions_config_write_lock`` /
``atomic_write_extensions_config`` / ``normalize_mcp_transport_alias``）。
本脚本在导入 gateway 前注入兼容实现（``hasattr`` 防御，上游修复后自动
失效），与 KStock 的 ``scripts/run_gateway.py`` 同款处理。
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent

# vendor/qilin 顶层是 app 包（app.gateway），qilin 引擎核心经 editable 安装
VENDOR_QILIN = REPO_ROOT.parent / "vendor" / "qilin"
if str(VENDOR_QILIN) not in sys.path:
    sys.path.insert(0, str(VENDOR_QILIN))
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


def _apply_vendor_extensions_config_compat_shim() -> None:
    """为 vendor/qilin 快照缺失的 extensions_config 符号注入兼容实现。

    幂等且带 ``hasattr`` 防御：上游修复并重新同步后自动跳过。
    """
    import qilin.config.extensions_config as ec

    if not hasattr(ec, "extensions_config_write_lock"):
        ec.extensions_config_write_lock = threading.Lock()

    if not hasattr(ec, "atomic_write_extensions_config"):
        def atomic_write_extensions_config(config_path, config_data) -> None:
            path = str(config_path)
            directory = os.path.dirname(path) or "."
            os.makedirs(directory, exist_ok=True)
            fd, tmp = tempfile.mkstemp(prefix=".ext_cfg_", suffix=".json", dir=directory)
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as fh:
                    json.dump(config_data, fh, ensure_ascii=False, indent=2)
                os.replace(tmp, path)
            except Exception:
                if os.path.exists(tmp):
                    os.remove(tmp)
                raise
        ec.atomic_write_extensions_config = atomic_write_extensions_config

    if not hasattr(ec, "normalize_mcp_transport_alias"):
        _ALIASES = {"http": "streamable_http", "streamablehttp": "streamable_http",
                    "ws": "sse", "websocket": "sse"}

        def normalize_mcp_transport_alias(data):
            if not isinstance(data, dict):
                return data
            for key in ("type", "transport"):
                raw = data.get(key)
                if isinstance(raw, str):
                    data[key] = _ALIASES.get(raw.strip().lower(), raw.strip().lower())
            return data
        ec.normalize_mcp_transport_alias = normalize_mcp_transport_alias


def _resolve_data_root() -> Path:
    """用户数据根：KCODER_APP_DATA_DIR 优先，默认 ~/.kcoder。"""
    env = os.environ.get("KCODER_APP_DATA_DIR")
    return Path(env) if env else Path.home() / ".kcoder"


def _ensure_runtime_config(data_root: Path) -> Path:
    """确保 qilin.runtime.yaml 存在（缺则从仓库模板生成，指向数据根）。"""
    runtime_cfg = data_root / "config" / "qilin.runtime.yaml"
    if runtime_cfg.exists():
        return runtime_cfg

    import shutil
    import yaml

    data_root.mkdir(parents=True, exist_ok=True)
    (data_root / "config").mkdir(parents=True, exist_ok=True)
    (data_root / "runtime" / "qilin").mkdir(parents=True, exist_ok=True)

    template = REPO_ROOT / "config.yaml"
    cfg: dict = yaml.safe_load(template.read_text(encoding="utf-8")) or {}
    db = dict(cfg.get("database") or {})
    db["backend"] = "sqlite"
    db["sqlite_dir"] = str(data_root / "runtime" / "qilin" / "data")
    cfg["database"] = db
    cfg.setdefault("run_events", {})["backend"] = "db"
    runtime_cfg.write_text(yaml.safe_dump(cfg, allow_unicode=True, sort_keys=False), encoding="utf-8")
    return runtime_cfg


def _configure_gateway_security() -> None:
    """注入桌面端渲染层的 CORS origin 白名单（GATEWAY_CORS_ORIGINS）。

    dev 态：Vite dev server（electron-vite 默认 http://localhost:5173）直连
    gateway，需把渲染层 origin 加入白名单（引擎 CORSMiddleware 与
    CSRFMiddleware 的 origin 白名单均读该环境变量）。
    打包态：渲染层 origin 为 app:// 或 file://，需主进程同源代理
    （KStock 方案），届时无需 CORS。
    """
    dev_origins = [
        "http://localhost:5173",   # electron-vite dev server（默认端口）
        "http://127.0.0.1:5173",
    ]
    existing = os.environ.get("GATEWAY_CORS_ORIGINS", "").strip()
    if existing:
        configured = {o.strip() for o in existing.split(",") if o.strip()}
        merged = list(configured) + [o for o in dev_origins if o not in configured]
        os.environ["GATEWAY_CORS_ORIGINS"] = ",".join(merged)
    else:
        os.environ["GATEWAY_CORS_ORIGINS"] = ",".join(dev_origins)


def main() -> None:
    data_root = _resolve_data_root()
    runtime_cfg = _ensure_runtime_config(data_root)

    os.environ.setdefault("QILIN_CONFIG_PATH", str(runtime_cfg))
    os.environ.setdefault("QILIN_HOME", str(data_root / "runtime" / "qilin"))
    os.environ.setdefault("KCODER_APP_DATA_DIR", str(data_root))
    os.environ.setdefault("QILIN_EXTENSIONS_CONFIG_PATH", str(REPO_ROOT / "extensions_config.json"))
    # 产品要求：真实登录注册（未注册用户停在 landing 页），不启用 auth-disabled
    os.environ.pop("QILIN_AUTH_DISABLED", None)
    # JWT secret：持久化到数据根（跨重启稳定；消除引擎启动警告，
    # 未来启用 auth 时直接可用）
    jwt_secret_path = data_root / "config" / ".jwt_secret"
    if "AUTH_JWT_SECRET" not in os.environ:
        if jwt_secret_path.exists():
            os.environ["AUTH_JWT_SECRET"] = jwt_secret_path.read_text(encoding="utf-8").strip()
        else:
            import secrets
            secret = secrets.token_urlsafe(32)
            jwt_secret_path.parent.mkdir(parents=True, exist_ok=True)
            jwt_secret_path.write_text(secret, encoding="utf-8")
            os.environ["AUTH_JWT_SECRET"] = secret

    _configure_gateway_security()
    _apply_vendor_extensions_config_compat_shim()

    host = os.environ.get("KCODER_GATEWAY_HOST", "127.0.0.1")
    port = int(os.environ.get("KCODER_GATEWAY_PORT", "18900"))

    import uvicorn
    uvicorn.run("app.gateway.app:create_app", factory=True, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
