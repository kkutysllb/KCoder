"""Stub endpoints for /v1/attachments/* — replaced by real uploads in Phase 7.

The upload endpoint stubs return a minimal AttachmentMetadata so the
renderer's uploadAttachment caller can proceed. GET returns 404 (null)
because no attachments exist yet.

Response shapes mirror AttachmentMetadata (engine-api.ts L197-205).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/v1/attachments", tags=["attachments-stub"])


@router.post("")
@router.post("/")
async def upload_attachment(body: dict[str, Any] | None = None) -> dict[str, Any]:
    """POST /v1/attachments → stub returns a placeholder attachment.

    The renderer expects { attachment: AttachmentMetadata }. We synthesize
    a stable id but do not persist the base64 data (Phase 7 wires real
    storage via QiLin uploads manager).
    """
    now = datetime.now(timezone.utc).isoformat()
    name = ""
    mime_type = ""
    if isinstance(body, dict):
        name = str(body.get("name", ""))
        mime_type = str(body.get("mimeType", ""))
    return {
        "attachment": {
            "id": f"stub-{uuid.uuid4().hex[:8]}",
            "name": name or "attachment.bin",
            "mimeType": mime_type or None,
            "size": 0,
            "createdAt": now,
        }
    }


@router.get("/{attachment_id}")
async def get_attachment(attachment_id: str) -> dict[str, Any]:
    """GET /v1/attachments/:id → 404 (no stub attachments persisted)."""
    raise HTTPException(status_code=404, detail=f"Attachment not found: {attachment_id}")
