"""Real /v1/auth/* endpoints — replaces Phase 5 stub.

7 endpoints implementing the full local-auth flow:
  GET  /v1/auth/setup-status     — is first-run setup needed?
  POST /v1/auth/initialize       — first-run admin creation
  POST /v1/auth/login            — email + password → JWT session
  POST /v1/auth/register         — create a new (non-admin) user
  GET  /v1/auth/me               — current user from Bearer token
  POST /v1/auth/logout           — no-op (JWT is stateless)
  POST /v1/auth/change-password  — verify old, set new, rotate token_version

Request/response shapes match engine-api.ts L641-725. Note the field
name conventions:
  - login/register/initialize send { email, password }
  - change-password sends { current_password, new_password } (snake_case)
  - me returns { user: AuthUser }
  - all session responses are AuthSessionResponse { access_token, ... }
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field

from .middleware import get_current_user
from .passwords import hash_password, verify_password
from .tokens import create_access_token

logger = logging.getLogger("kcoder_gateway.auth.routes")

router = APIRouter(prefix="/v1/auth", tags=["auth"])


# ── Request models ─────────────────────────────────────────────────────────


class _EmailPasswordRequest(BaseModel):
    """Shared shape for initialize / login / register requests."""

    email: EmailStr
    password: str = Field(min_length=1)


class ChangePasswordRequest(BaseModel):
    """change-password uses snake_case field names (engine-api.ts L718)."""

    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=1)


# ── UserRow → AuthUser mapping ────────────────────────────────────────────


def _user_to_auth_user(user: Any) -> dict[str, Any]:
    """Map a UserRow to the renderer's AuthUser interface.

    UserRow has no username/display_name columns, so we derive them from
    the email local-part. auth_provider is 'local' for password accounts.
    """
    email = user.email or ""
    local_part = email.split("@")[0] if email else ""
    return {
        "id": user.id,
        "email": email,
        "username": local_part,
        "display_name": local_part or email,
        "system_role": user.system_role,
        "is_admin": user.system_role == "admin",
        "auth_provider": "local",
    }


def _make_session(user: Any, secret: str) -> dict[str, Any]:
    """Build an AuthSessionResponse dict with a fresh JWT."""
    token = create_access_token(
        user_id=user.id,
        email=user.email,
        token_version=user.token_version,
        secret=secret,
    )
    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_in": 86400,
        "user": _user_to_auth_user(user),
    }


def _get_repo_and_secret(request: Request) -> tuple[Any, str]:
    """Extract user_repo + jwt_secret from app.state, 503 if missing."""
    repo = getattr(request.app.state, "user_repo", None)
    secret = getattr(request.app.state, "jwt_secret", None)
    if repo is None or not secret:
        raise HTTPException(status_code=503, detail="Auth subsystem not initialized")
    return repo, secret


# ── Endpoints ──────────────────────────────────────────────────────────────


@router.get("/setup-status")
async def setup_status(request: Request) -> dict[str, Any]:
    """GET /v1/auth/setup-status → AuthSetupStatus.

    ``needs_setup=True`` when there are zero users (first run). The
    renderer shows its initial-setup wizard in that case.
    """
    repo, _ = _get_repo_and_secret(request)
    count = await repo.count()
    has_admin = await repo.has_admin() if count > 0 else False
    return {
        "initialized": count > 0,
        "has_admin": has_admin,
        "needs_setup": count == 0,
        "local_auth_enabled": True,
        "registration_enabled": True,
    }


@router.post("/initialize")
async def initialize(req: _EmailPasswordRequest, request: Request) -> dict[str, Any]:
    """POST /v1/auth/initialize → first-run admin creation.

    Returns 409 if any user already exists (setup is one-shot).
    """
    repo, secret = _get_repo_and_secret(request)

    if await repo.count() > 0:
        raise HTTPException(status_code=409, detail="Setup already completed")

    user = await repo.create(
        id=str(uuid.uuid4()),
        email=str(req.email),
        password_hash=hash_password(req.password),
        system_role="admin",
        needs_setup=False,
    )
    logger.info("Admin initialized: id=%s email=%s", user.id, user.email)
    return _make_session(user, secret)


@router.post("/login")
async def login(req: _EmailPasswordRequest, request: Request) -> dict[str, Any]:
    """POST /v1/auth/login → verify credentials, issue JWT."""
    repo, secret = _get_repo_and_secret(request)

    user = await repo.find_by_email(str(req.email))
    if user is None or not user.password_hash:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    return _make_session(user, secret)


@router.post("/register")
async def register(req: _EmailPasswordRequest, request: Request) -> dict[str, Any]:
    """POST /v1/auth/register → create a new user (role=user).

    Returns 409 if the email is already registered.
    """
    repo, secret = _get_repo_and_secret(request)

    existing = await repo.find_by_email(str(req.email))
    if existing is not None:
        raise HTTPException(status_code=409, detail="Email already registered")

    user = await repo.create(
        id=str(uuid.uuid4()),
        email=str(req.email),
        password_hash=hash_password(req.password),
        system_role="user",
    )
    logger.info("User registered: id=%s email=%s", user.id, user.email)
    return _make_session(user, secret)


@router.get("/me")
async def me(request: Request) -> dict[str, Any]:
    """GET /v1/auth/me → { user: AuthUser }.

    renderer reads ``data.user ?? data`` (engine-api.ts L701) so returning
    { user } is the canonical shape. 401 if not authenticated.
    """
    user = await get_current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return {"user": _user_to_auth_user(user)}


@router.post("/logout")
async def logout() -> dict[str, Any]:
    """POST /v1/auth/logout → no-op.

    JWT auth is stateless — the renderer simply discards the token.
    We return a trivial ack so response.ok is true.
    """
    return {"ok": True}


@router.post("/change-password")
async def change_password(
    req: ChangePasswordRequest, request: Request
) -> dict[str, Any]:
    """POST /v1/auth/change-password → rotate password + token_version.

    Returns a fresh AuthSessionResponse because incrementing
    token_version invalidates the old JWT; the renderer stores the new
    token from the response.
    """
    user = await get_current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    repo, secret = _get_repo_and_secret(request)

    if not user.password_hash or not verify_password(
        req.current_password, user.password_hash
    ):
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    # Update password, then bump token_version (invalidates all old tokens).
    await repo.update_password(user.id, hash_password(req.new_password))
    new_version = await repo.increment_token_version(user.id)

    # Re-fetch to get the updated token_version on the user object.
    refreshed = await repo.find_by_id(user.id)
    if refreshed is None:
        # Extremely unlikely (we just updated the row), but guard anyway.
        refreshed = user
        refreshed.token_version = new_version

    logger.info("Password changed: id=%s new_tv=%d", user.id, new_version)
    return _make_session(refreshed, secret)
