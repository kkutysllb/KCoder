"""Stub endpoints for /v1/auth/* — replaced by real auth in Phase 6.

Returns a single-user "guest" identity so the renderer's useAuth hook
proceeds past the login screen during Phase 5. Once Phase 6 lands the
real UserRepository + JWT, these routes are removed from this module and
served by kcoder_gateway.auth.routes instead.

Response shapes mirror the renderer's AuthSetupStatus / AuthUser /
AuthSessionResponse interfaces (engine-api.ts L474-497).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter

router = APIRouter(prefix="/v1/auth", tags=["auth-stub"])

# A fixed guest user so the renderer treats the session as authenticated
# during Phase 5. Phase 6 replaces this with a real DB-backed user.
_GUEST_USER: dict[str, Any] = {
    "id": "guest-user",
    "email": "guest@kcoder.local",
    "username": "guest",
    "display_name": "Guest",
    "system_role": "user",
    "is_admin": False,
    "auth_provider": "local",
}

_STUB_TOKEN = "kcoder-stub-token-phase5"


@router.get("/setup-status")
async def setup_status() -> dict[str, Any]:
    """AuthSetupStatus — tells renderer whether initial setup is needed."""
    return {
        "initialized": True,
        "has_admin": False,
        "needs_setup": False,
        "local_auth_enabled": True,
        "registration_enabled": True,
    }


@router.post("/initialize")
async def initialize() -> dict[str, Any]:
    """First-time admin setup — stub returns the guest session."""
    return _session()


@router.post("/login")
async def login() -> dict[str, Any]:
    """Login — stub returns the guest session regardless of credentials."""
    return _session()


@router.post("/register")
async def register() -> dict[str, Any]:
    """Register — stub returns the guest session."""
    return _session()


@router.get("/me")
async def me() -> dict[str, Any]:
    """Return current user — stub returns guest."""
    return {"user": _GUEST_USER}


@router.post("/logout")
async def logout() -> dict[str, Any]:
    """Logout — no-op stub (renderer clears its local token)."""
    return {"ok": True}


@router.post("/change-password")
async def change_password() -> dict[str, Any]:
    """Change password — stub returns guest session."""
    return _session()


def _session() -> dict[str, Any]:
    """Build a stub AuthSessionResponse."""
    return {
        "access_token": _STUB_TOKEN,
        "token_type": "bearer",
        "expires_in": 0,
        "user": _GUEST_USER,
        # Timestamps the renderer reads for session display.
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
