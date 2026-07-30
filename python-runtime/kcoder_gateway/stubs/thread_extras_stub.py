"""Stub endpoints for thread goal / todos.

KCoder renderer reads thread goal and todos for the objective-tracking
sidebar. QiLin's agent graph doesn't persist a goal/todo structure in the
thread store yet, so we return 404 — the renderer's getThreadGoal /
getThreadTodos explicitly handle 404 as "no goal set" / "no todos" and
return null (engine-api.ts L1280, L1290).

Endpoint map (engine-api.ts L1276-1294)::

    GET /v1/threads/:id/goal   → { goal: ThreadGoal | null }
    GET /v1/threads/:id/todos  → { todos: ThreadTodoList | null }
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/v1/threads", tags=["thread-extras-stub"])


@router.get("/{thread_id}/goal")
async def get_thread_goal(thread_id: str) -> None:
    """GET /v1/threads/:id/goal → 404 (no goal set).

    renderer's getThreadGoal treats 404 as null and the UI shows no
    objective. This is the correct empty state.
    """
    raise HTTPException(
        status_code=404,
        detail=f"No goal set for thread {thread_id}",
    )


@router.get("/{thread_id}/todos")
async def get_thread_todos(thread_id: str) -> None:
    """GET /v1/threads/:id/todos → 404 (no todos).

    renderer's getThreadTodos treats 404 as null and the UI shows an
    empty todo list.
    """
    raise HTTPException(
        status_code=404,
        detail=f"No todos for thread {thread_id}",
    )
