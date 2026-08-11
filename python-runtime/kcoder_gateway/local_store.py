"""Atomic JSON store helpers for gateway-local feature storage.

Used by skills drafts / plugins / sub-agents / commands — all KCoder-local
features that have no QiLin equivalent. Files are written next to the target
then renamed (same-filesystem atomic rename) so a crash mid-write never
leaves a truncated JSON file.

Reads return the provided default when the file is missing or unparseable
(non-fatal: feature panels degrade to empty state instead of crashing).
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

from fastapi import Request

logger = logging.getLogger("kcoder_gateway.local_store")


_LOCAL_SUBDIR = "kcoder_local"


def resolve_local_dir(request: Request) -> Path:
    """Return the gateway-local storage directory.

    v0.2: 优先使用 ``<app_data_dir>/product/kcoder_local/``（统一数据根）。
    v0.1 回退：``<runtime_dir>/kcoder_local/``（仓库内 sidecar 自管 JSON）。

    解析优先级：
    1. ``KCODER_APP_DATA_DIR`` 环境变量 → ``<env>/product/kcoder_local/``
    2. ``request.app.state.data_dir``（main.py 设置的 runtime_dir）
       → ``<runtime_dir>/kcoder_local/``（向后兼容）

    Always creates the directory so callers can write directly.
    """
    # v0.2: 优先用 KCODER_APP_DATA_DIR
    app_data = os.environ.get("KCODER_APP_DATA_DIR")
    if app_data:
        local_dir = Path(app_data) / "product" / _LOCAL_SUBDIR
        try:
            local_dir.mkdir(parents=True, exist_ok=True)
            return local_dir
        except OSError:
            logger.debug("v02 local_dir mkdir failed for %s", local_dir, exc_info=True)

    # v0.1 回退：runtime_dir / kcoder_local
    data_dir = Path(getattr(request.app.state, "data_dir", "") or ".")
    local_dir = data_dir / _LOCAL_SUBDIR
    try:
        local_dir.mkdir(parents=True, exist_ok=True)
    except OSError:
        logger.debug("local_dir mkdir failed for %s", local_dir, exc_info=True)
    return local_dir


def load_json(path: Path, *, default: Any) -> Any:
    """Load JSON from ``path``; return ``default`` on any read/parse failure."""
    try:
        if not path.exists():
            return default
        text = path.read_text(encoding="utf-8")
        return json.loads(text)
    except (OSError, json.JSONDecodeError):
        logger.debug("local_store load failed for %s (returning default)", path, exc_info=True)
        return default


def save_json(path: Path, data: Any) -> None:
    """Persist ``data`` as pretty JSON to ``path`` (atomic temp + rename)."""
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(data, indent=2, ensure_ascii=False)
        tmp_path = _next_tmp_path(path)
        tmp_path.write_text(payload + "\n", encoding="utf-8")
        os.replace(tmp_path, path)
    except OSError:
        logger.exception("local_store save failed for %s", path)


def _next_tmp_path(path: Path) -> Path:
    """Build a unique temp path sibling to ``path`` for the atomic rename."""
    stamp = f"{os.getpid()}.{_counter()}"
    return path.with_name(f".{path.name}.{stamp}.tmp")


def _counter() -> int:
    """Monotonic int to make temp names unique within a process."""
    global _seq
    _seq += 1
    return _seq


_seq = 0
