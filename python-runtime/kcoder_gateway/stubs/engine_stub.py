"""Stub endpoints for /v1/engine/* and /v1/runtime/* — governed graph surface.

The governed graph engine is a QiongQi concept (durable multi-agent runs with
circuit breakers, checkpoints, branches). QiLin has no equivalent, so all
governed endpoints return null-safe responses so the renderer's ExecutionView
and governance controls degrade gracefully.

Response strategy (mirrors engine-api.ts error handling):
  - getRunTimeline: 404 → null  (engine-api.ts L973)
  - inspectGraphRun: 503 → null  (engine-api.ts L1228)
  - subscribeEngineStream: !ok → warn + close  (engine-api.ts L1048-1051)
  - ackEngineStream: try/catch, ignores body  (engine-api.ts L990-992)
  - circuit/cancel/checkpoint: 503 (only triggered by explicit UI action on
    a governed run, which will never exist under QiLin)
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

router = APIRouter(prefix="/v1", tags=["engine-stub"])


# ── Runtime timeline (GET /v1/runtime/evented-v2/runs/:runId/timeline) ─────


@router.get("/runtime/evented-v2/runs/{run_id}/timeline")
async def get_run_timeline(run_id: str) -> dict[str, Any]:
    """GET /v1/runtime/evented-v2/runs/:runId/timeline → 404.

    renderer's getRunTimeline treats 404 as "not yet recorded" and returns
    null, which makes getTurnExecution return {available: false}.
    """
    from fastapi import HTTPException

    raise HTTPException(
        status_code=404,
        detail=f"Run timeline not available (governed engine not configured): {run_id}",
    )


# ── Engine stream subscribe (GET /v1/engine/streams/:streamId/subscribe) ───


@router.get("/engine/streams/{stream_id}/subscribe")
async def subscribe_engine_stream(stream_id: str) -> StreamingResponse:
    """GET /v1/engine/streams/:streamId/subscribe → empty SSE stream.

    Returns an immediately-closing event stream. renderer's
    subscribeEngineStream reads until done, then resolves — no crash.
    """

    async def _empty_stream():
        yield b": no governed engine stream available\n\n"

    return StreamingResponse(_empty_stream(), media_type="text/event-stream")


# ── Engine stream ack (POST /v1/engine/streams/:streamId/ack) ──────────────


@router.post("/engine/streams/{stream_id}/ack")
async def ack_engine_stream(stream_id: str) -> dict[str, Any]:
    """POST /v1/engine/streams/:streamId/ack → best-effort ack.

    renderer wraps this in try/catch and ignores the body, so a 200 with
    an empty object is safe.
    """
    return {"ok": True, "streamId": stream_id}


# ── Governed graph run inspection / control ────────────────────────────────


@router.get("/engine/runs/{run_id}/inspect")
async def inspect_graph_run(run_id: str) -> dict[str, Any]:
    """GET /v1/engine/runs/:runId/inspect → 503.

    renderer's inspectGraphRun treats 503 as "governed engine not
    configured" and returns null.
    """
    from fastapi import HTTPException

    raise HTTPException(
        status_code=503,
        detail=f"Governed graph engine not configured: {run_id}",
    )


@router.post("/engine/runs/{run_id}/circuit")
async def set_graph_circuit(run_id: str) -> dict[str, Any]:
    """POST /v1/engine/runs/:runId/circuit → 503 (governed engine N/A)."""
    from fastapi import HTTPException

    raise HTTPException(
        status_code=503,
        detail=f"Governed graph circuit control not available: {run_id}",
    )


@router.post("/engine/runs/{run_id}/cancel")
async def cancel_graph_run(run_id: str) -> dict[str, Any]:
    """POST /v1/engine/runs/:runId/cancel → 503 (governed engine N/A)."""
    from fastapi import HTTPException

    raise HTTPException(
        status_code=503,
        detail=f"Governed graph run cancel not available: {run_id}",
    )


@router.post("/engine/checkpoints/{checkpoint_id}/resolve")
async def resolve_checkpoint(checkpoint_id: str) -> dict[str, Any]:
    """POST /v1/engine/checkpoints/:checkpointId/resolve → 503."""
    from fastapi import HTTPException

    raise HTTPException(
        status_code=503,
        detail=f"Governed graph checkpoint resolution not available: {checkpoint_id}",
    )
