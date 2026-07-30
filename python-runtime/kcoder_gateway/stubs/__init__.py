"""Stub endpoints for KCoder renderer API contract.

Phase 5 provides safe empty responses for all endpoints not yet backed by
QiLin. Each stub returns data shaped to match the renderer's TypeScript
interfaces (see app/renderer/src/services/engine-api.ts) so the UI panels
render without crashes.

These stubs are progressively replaced by real implementations in later
phases (auth → Phase 6, workspace → Phase 7, memory → Phase 10, skills → Phase 11).
"""

from .approvals_stub import router as approvals_router
from .attachments_stub import router as attachments_router
from .auth_stub import router as auth_router
from .engine_stub import router as engine_router
from .thread_extras_stub import router as thread_extras_router
from .workspace_stub import router as workspace_router

__all__ = [
    "approvals_router",
    "attachments_router",
    "auth_router",
    "engine_router",
    "thread_extras_router",
    "workspace_router",
]
