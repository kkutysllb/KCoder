"""Stub endpoints for thread goal / todos.

KCoder renderer reads thread goal and todos for the objective-tracking
sidebar. QiLin's agent graph doesn't persist a goal/todo structure in the
thread store yet, so we return 200 + {goal: null} / {todos: null}.

Endpoint map (engine-api.ts L1276-1294)::

    GET /v1/threads/:id/goal   → 200 { goal: null }
    GET /v1/threads/:id/todos  → 200 { todos: null }

注：最初用 404 表达“未设置”，但浏览器 DevTools 会把 4xx 自动打印成控制台
红色错误（JS 无法抑制），导致每次切线程 / 发消息都刷屏。改为 200 + null
后语义不变（renderer 取 data.goal ?? null 仍得 null），但消除控制台噪音。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

router = APIRouter(prefix="/v1/threads", tags=["thread-extras-stub"])


@router.get("/{thread_id}/goal")
async def get_thread_goal(thread_id: str) -> dict[str, Any]:
    """GET /v1/threads/:id/goal → 200 + {goal: null}.

    renderer 取 ``data.goal ?? null`` 得 null，UI 显示无目标（正确的空态）。
    """
    _ = thread_id
    return {"goal": None}


@router.get("/{thread_id}/todos")
async def get_thread_todos(thread_id: str) -> dict[str, Any]:
    """GET /v1/threads/:id/todos → 200 + {todos: null}.

    renderer 取 ``data.todos ?? null`` 得 null，UI 显示空待办列表。
    """
    _ = thread_id
    return {"todos": None}
