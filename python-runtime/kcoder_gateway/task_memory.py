"""KCoder 任务记忆（thread 作用域）——产品层自建存储。

背景（为什么不用 QiLin MemoryManager）：
- QiLin 记忆按 ``(agent_name, user_id)`` 分桶，无任务（thread）级桶；
  曾经全局注入用户级记忆导致新任务携带旧项目上下文（跨线程污染，
  已关停）。任务记忆的正确作用域是单个 thread：
  - 只注入该 thread 的 turn（start_turn prepend ``<task_memory>`` 块）
  - 跨任务零污染（其他 thread 永远读不到）
  - 不依赖引擎 ``memory.enabled``（其开关连坐 CRUD，面板 503）

存储：``$KCODER_APP_DATA_DIR/thread-memory/<thread_id>.json``
（原子写，上限 TASK_MEMORY_MAX 条）。
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger("kcoder_gateway.task_memory")

# 每 thread 记忆条数上限（防无限膨胀）
TASK_MEMORY_MAX = 100


def _dir() -> Path:
    base = os.environ.get("KCODER_APP_DATA_DIR", str(Path.home() / ".kcoder"))
    d = Path(base) / "thread-memory"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _path(thread_id: str) -> Path:
    return _dir() / f"{thread_id}.json"


def _load(thread_id: str) -> dict[str, Any]:
    p = _path(thread_id)
    if not p.exists():
        return {"threadId": thread_id, "entries": []}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        logger.warning("task_memory read failed for %s", thread_id, exc_info=True)
        return {"threadId": thread_id, "entries": []}


def _save(thread_id: str, data: dict[str, Any]) -> None:
    try:
        tmp = _path(thread_id).with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        tmp.replace(_path(thread_id))
    except Exception:
        logger.warning("task_memory save failed for %s", thread_id, exc_info=True)


def list_entries(thread_id: str) -> list[dict[str, Any]]:
    return _load(thread_id).get("entries") or []


def create_entry(thread_id: str, content: str, tags: list[str] | None = None) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    entry = {
        "id": uuid.uuid4().hex[:12],
        "content": content.strip(),
        "tags": tags or [],
        "createdAt": now,
        "updatedAt": now,
    }
    data = _load(thread_id)
    entries = data.get("entries") or []
    entries.append(entry)
    data["entries"] = entries[-TASK_MEMORY_MAX:]
    _save(thread_id, data)
    return entry


def update_entry(thread_id: str, entry_id: str, content: str | None = None, tags: list[str] | None = None) -> dict[str, Any] | None:
    data = _load(thread_id)
    for e in data.get("entries") or []:
        if e.get("id") == entry_id:
            if content is not None:
                e["content"] = content.strip()
            if tags is not None:
                e["tags"] = tags
            e["updatedAt"] = datetime.now(timezone.utc).isoformat()
            _save(thread_id, data)
            return e
    return None


def delete_entry(thread_id: str, entry_id: str) -> bool:
    data = _load(thread_id)
    before = len(data.get("entries") or [])
    data["entries"] = [e for e in (data.get("entries") or []) if e.get("id") != entry_id]
    if len(data["entries"]) == before:
        return False
    _save(thread_id, data)
    return True


def build_task_memory_block(thread_id: str, max_entries: int = 30) -> str:
    """注入块：本任务的记忆条目（start_turn prepend 到 prompt）。

    只含本 thread 的条目——跨任务隔离由存储分文件天然保证。
    空记忆返回 ''（不注入空块）。
    """
    entries = list_entries(thread_id)[:max_entries]
    if not entries:
        return ""
    lines = [f"- {e['content']}" for e in entries if e.get("content")]
    if not lines:
        return ""
    return (
        "<task_memory>\n"
        "以下是本任务（thread）的用户管理记忆——只对当前任务生效：\n"
        + "\n".join(lines)
        + "\n</task_memory>"
    )


def list_threads_with_memory() -> list[dict[str, Any]]:
    """有任务记忆的 thread 概要（id + 条数 + 最近更新），供设置面板选择器。"""
    out: list[dict[str, Any]] = []
    try:
        for p in _dir().glob("*.json"):
            data = _load(p.stem)
            entries = data.get("entries") or []
            if entries:
                out.append(
                    {
                        "threadId": p.stem,
                        "count": len(entries),
                        "updatedAt": entries[-1].get("updatedAt"),
                    }
                )
    except Exception:
        logger.warning("task_memory list threads failed", exc_info=True)
    return out
