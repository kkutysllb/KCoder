"""Stub endpoints for /v1/approvals/* and /v1/user-inputs/*.

Approval and structured-input flows require QiLin interrupt integration
(Phase 8+). Until then, these endpoints are never reached during normal
rendering because the renderer only calls them after receiving an
``approval_requested`` or ``user_input_requested`` SSE event, which the
QiLin gateway never emits.

We return 200 ack responses (not 404) so that any unexpected call resolves
cleanly instead of surfacing an unhandled rejection in the renderer.

Endpoint map (engine-api.ts L1296-1335)::

    POST /v1/approvals/:id            decideApproval(id, decision, reason?)
    POST /v1/user-inputs/:id          resolveUserInput(id, answers) / cancelUserInput(id)
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

router = APIRouter(prefix="/v1", tags=["approvals-stub"])


@router.post("/approvals/{approval_id}")
async def decide_approval(approval_id: str) -> dict[str, Any]:
    """POST /v1/approvals/:id → stub ack.

    renderer's decideApproval throws on non-ok. Return a resolved ack so
    the UI (if ever reached) doesn't surface an error.
    """
    return {
        "approvalId": approval_id,
        "resolved": True,
        "status": "expired",
        "note": "approvals not supported under QiLin engine",
    }


@router.post("/user-inputs/{input_id}")
async def resolve_user_input(input_id: str) -> dict[str, Any]:
    """POST /v1/user-inputs/:id → stub ack.

    Handles both resolveUserInput (body has ``answers``) and
    cancelUserInput (body has ``cancelled: true``). Either way we ack.
    """
    return {
        "inputId": input_id,
        "resolved": True,
        "status": "cancelled",
        "note": "user-inputs not supported under QiLin engine",
    }
