"""Stub endpoints for /v1/engine/* and /v1/runtime/* — governed graph surface.

The governed graph engine is a QiongQi concept (durable multi-agent runs with
circuit breakers, checkpoints, branches). QiLin has no equivalent, so all
governed endpoints return null-safe responses so the renderer's ExecutionView
and governance controls degrade gracefully.

Response strategy (mirrors engine-api.ts handling):
  - getRunTimeline:       200 + JSON null  (renderer response.json() → null → available:false)
  - inspectGraphRun:      200 + JSON null  (renderer response.json() → null)
  - subscribeEngineStream: 200 + empty SSE stream (closes immediately)
  - ackEngineStream:      200 + {ok:true}  (best-effort)
  - circuit/cancel/checkpoint: 503 (only triggered by explicit UI action on
    a governed run, which will never exist under QiLin)

注：timeline / inspect 最初用 404 / 503 表达“能力未配置”，但浏览器 DevTools
会把所有 4xx/5xx 自动打印成控制台红色错误（JS 的 try/catch 无法抑制），
导致每次发消息都刷屏。改为 200 + JSON null 后语义不变（仍是“无数据”，
前端走相同的 null 降级路径），但消除了控制台噪音。
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse, StreamingResponse

router = APIRouter(prefix="/v1", tags=["engine-stub"])


# ── Runtime timeline (GET /v1/runtime/evented-v2/runs/:runId/timeline) ─────


@router.get("/runtime/evented-v2/runs/{run_id}/timeline")
async def get_run_timeline(run_id: str) -> JSONResponse:
    """GET /v1/runtime/evented-v2/runs/:runId/timeline → 200 + JSON null.

    返回 200 + body ``null``：renderer 的 ``response.json()`` 解析出 null，
    ``getRunTimeline`` 返回 null，``getTurnExecution`` 据此返回 ``{available: false}``。
    用 200 而非 404 是为了避免浏览器 DevTools 把 4xx 当控制台错误刷屏。
    """
    # run_id 仅用于日志/标识；governed engine 未配置，一律返回 null
    _ = run_id
    return JSONResponse(content=None)


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
async def inspect_graph_run(run_id: str) -> JSONResponse:
    """GET /v1/engine/runs/:runId/inspect → 200 + JSON null.

    返回 200 + body ``null``：renderer 的 ``inspectGraphRun`` 解析出 null，
    调用方据此跳过 governance 渲染。用 200 而非 503 避免控制台噪音。
    """
    _ = run_id
    return JSONResponse(content=None)


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
