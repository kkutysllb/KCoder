"""Real attachment upload/storage — replaces ``stubs/attachments_stub.py``.

附件真实持久化到本地磁盘（``<local_dir>/attachments/<id>/``）：

- ``meta.json`` — AttachmentMetadata（id/name/mimeType/size/threadId/workspace/createdAt）
- ``data``     — 原始文件字节（base64 解码后）

端点契约对齐前端 ``engine-api.ts`` 的 ``AttachmentMetadata``：

- ``POST /v1/attachments { name, mimeType, dataBase64, threadId?, workspace? }``
  → ``{ attachment: AttachmentMetadata }``
- ``GET  /v1/attachments/:id``        → ``{ attachment: AttachmentMetadata }``（404 if missing）
- ``GET  /v1/attachments/:id/content``→ 原始字节流（供前端预览 / agent 读取）

这修复了 stub"上传假成功、文件被静默丢弃"的信任问题。前端上传 UI 已完备，
无需改动。附件文本内容会被 threads.start_turn 注入 agent prompt（见
``build_attachments_block``），让 agent 真正读到附件。
"""

from __future__ import annotations

import base64
import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from .local_store import resolve_local_dir

logger = logging.getLogger("kcoder_gateway.attachments")

router = APIRouter(prefix="/v1/attachments", tags=["attachments"])

# 单文件注入 prompt 的上限（字节）。超过则截断并标注。
_MAX_INLINE_BYTES = 50_000
# 所有附件注入 prompt 的总上限（字节）。
_MAX_TOTAL_BYTES = 200_000

# 视为"文本可内联"的 mime 前缀/精确匹配。
_TEXT_MIME_PREFIXES = ("text/",)
_TEXT_MIME_EXACT = {
    "application/json",
    "application/xml",
    "application/javascript",
    "application/x-yaml",
    "application/x-sh",
    "application/x-python",
}


def _attachments_root(request: Request) -> Path:
    """附件存储根目录：``<local_dir>/attachments/``（自动创建）."""
    root = resolve_local_dir(request) / "attachments"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _attachment_dir(request: Request, attachment_id: str) -> Path:
    return _attachments_root(request) / attachment_id


def _meta_path(request: Request, attachment_id: str) -> Path:
    return _attachment_dir(request, attachment_id) / "meta.json"


def _data_path(request: Request, attachment_id: str) -> Path:
    return _attachment_dir(request, attachment_id) / "data"


def _is_text_mime(mime_type: str | None) -> bool:
    if not mime_type:
        return False
    mt = mime_type.lower().split(";")[0].strip()
    if mt in _TEXT_MIME_EXACT:
        return True
    if mt.endswith("+json") or mt.endswith("+xml"):
        return True
    return mt.startswith(_TEXT_MIME_PREFIXES)


def _read_meta(request: Request, attachment_id: str) -> dict[str, Any] | None:
    """读取并解析 meta.json；缺失/损坏返回 None."""
    path = _meta_path(request, attachment_id)
    try:
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        logger.debug("read meta failed for %s", attachment_id, exc_info=True)
        return None


@router.post("")
@router.post("/")
async def upload_attachment(
    body: dict[str, Any] | None = None, request: Request = None
) -> dict[str, Any]:
    """POST /v1/attachments → 持久化附件，返回真实 metadata.

    body: ``{ name, mimeType, dataBase64, threadId?, workspace? }``
    """
    body = body or {}
    name = str(body.get("name") or "attachment.bin")
    mime_type = str(body.get("mimeType") or "") or None
    data_b64 = str(body.get("dataBase64") or "")
    thread_id = body.get("threadId")
    workspace = body.get("workspace")

    if not data_b64:
        raise HTTPException(status_code=400, detail="dataBase64 is required")

    try:
        raw = base64.b64decode(data_b64)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=f"invalid base64: {exc}") from exc

    attachment_id = uuid.uuid4().hex
    meta = {
        "id": attachment_id,
        "name": name,
        "mimeType": mime_type,
        "size": len(raw),
        "threadId": str(thread_id) if thread_id else None,
        "workspace": str(workspace) if workspace else None,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }

    # 原子写入：先写 data 再写 meta（meta 落盘才算"可读"）。
    data_path = _data_path(request, attachment_id)
    meta_path = _meta_path(request, attachment_id)
    try:
        data_path.parent.mkdir(parents=True, exist_ok=True)
        data_path.write_bytes(raw)
        meta_path.write_text(
            json.dumps(meta, ensure_ascii=False) + "\n", encoding="utf-8"
        )
    except OSError as exc:
        logger.exception("persist attachment failed")
        raise HTTPException(status_code=500, detail=f"storage failed: {exc}") from exc

    logger.info(
        "Attachment stored id=%s name=%s size=%d mime=%s",
        attachment_id, name, len(raw), mime_type,
    )
    return {"attachment": meta}


@router.get("/{attachment_id}")
async def get_attachment(
    attachment_id: str, request: Request
) -> dict[str, Any]:
    """GET /v1/attachments/:id → 真实 metadata（缺失返回 404）."""
    meta = _read_meta(request, attachment_id)
    if meta is None:
        raise HTTPException(status_code=404, detail=f"Attachment not found: {attachment_id}")
    return {"attachment": meta}


@router.get("/{attachment_id}/content")
async def get_attachment_content(
    attachment_id: str, request: Request
) -> FileResponse:
    """GET /v1/attachments/:id/content → 原始字节流.

    供前端预览（图片/PDF）与 agent 工具读取。媒体类型用上传时记录的 mimeType，
    缺省 ``application/octet-stream``。
    """
    meta = _read_meta(request, attachment_id)
    if meta is None:
        raise HTTPException(status_code=404, detail=f"Attachment not found: {attachment_id}")
    data_path = _data_path(request, attachment_id)
    if not data_path.exists():
        raise HTTPException(status_code=404, detail=f"Attachment data missing: {attachment_id}")
    return FileResponse(
        str(data_path),
        media_type=meta.get("mimeType") or "application/octet-stream",
        filename=meta.get("name") or attachment_id,
    )


# ────────────────────────────────────────────────────────────────
# Prompt 注入辅助（threads.start_turn 调用）
# ────────────────────────────────────────────────────────────────


def build_attachments_block(
    request: Request, attachment_ids: list[str]
) -> str:
    """把附件文本内容拼成 ``<user_attachments>`` 块，供 prepend 到 prompt。

    - 文本类附件：内联内容（单文件超 ``_MAX_INLINE_BYTES`` 截断，总计超
      ``_MAX_TOTAL_BYTES`` 停止追加并标注）。
    - 二进制附件：只列 name/mimeType/size，不内联。
    - 缺失的 id：跳过（不阻断 turn）。

    无可注入内容时返回空串（调用方据此决定是否 prepend）。
    """
    if not attachment_ids:
        return ""

    sections: list[str] = []
    total = 0
    capped = False
    for aid in attachment_ids:
        meta = _read_meta(request, aid)
        if meta is None:
            logger.debug("attachment %s not found, skipping", aid)
            continue
        name = meta.get("name") or aid
        mime = meta.get("mimeType")
        size = int(meta.get("size") or 0)
        data_path = _data_path(request, aid)

        if total >= _MAX_TOTAL_BYTES:
            capped = True
            sections.append(f"=== {name} ({mime or 'binary'}, {size} bytes) ===\n[达到总量上限，未内联]")
            continue

        if _is_text_mime(mime):
            try:
                raw = data_path.read_bytes() if data_path.exists() else b""
            except OSError:
                raw = b""
            try:
                text = raw.decode("utf-8")
            except UnicodeDecodeError:
                text = raw.decode("utf-8", errors="replace")
            if size > _MAX_INLINE_BYTES:
                text = text[:_MAX_INLINE_BYTES] + f"\n…[truncated, {size} bytes total]"
            sections.append(f"=== {name} ({mime}) ===\n{text}")
            total += len(text)
        else:
            sections.append(
                f"=== {name} ({mime or 'binary'}, {size} bytes) ===\n[binary file, not inlined]"
            )

    if not sections:
        return ""

    block = "<user_attachments>\nThe user attached the following files. Use them as context.\n\n"
    block += "\n\n".join(sections)
    if capped:
        block += "\n\n[部分附件因总量上限未完整内联]"
    block += "\n</user_attachments>"
    return block
