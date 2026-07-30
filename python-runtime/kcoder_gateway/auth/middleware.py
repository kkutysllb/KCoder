"""Authentication dependencies for FastAPI routes.

Provides two dependency functions:
  - get_current_user(request) → UserRow | None  (soft: None if not logged in)
  - require_user(request)     → UserRow          (hard: 401 if not logged in)

Token parsing is done manually (not via fastapi.security.HTTPBearer) so
that missing tokens silently resolve to None instead of auto-raising
403 — callers decide whether auth is required.

The user_repo and jwt_secret are read from ``app.state``, both populated
by the gateway lifespan (see main.py).
"""

from __future__ import annotations

import logging

from fastapi import HTTPException, Request

from .tokens import TokenError, decode_token

logger = logging.getLogger("kcoder_gateway.auth.middleware")


async def get_current_user(request: Request):
    """Resolve the authenticated user from the Bearer token, or None.

    Returns None when:
      - auth is not initialised (user_repo / jwt_secret missing from state)
      - no Authorization: Bearer header is present
      - the token fails signature/expiry verification
      - the user no longer exists in the DB
      - the token's ``tv`` claim doesn't match user.token_version (revoked)
    """
    user_repo = getattr(request.app.state, "user_repo", None)
    jwt_secret = getattr(request.app.state, "jwt_secret", None)
    if user_repo is None or not jwt_secret:
        return None

    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header[len("Bearer ") :].strip()
    if not token:
        return None

    try:
        payload = decode_token(token, jwt_secret)
    except TokenError:
        return None

    user_id = payload.get("sub")
    token_version = payload.get("tv", 0)
    if not user_id:
        return None

    user = await user_repo.find_by_id(user_id)
    if user is None:
        return None

    # Reject tokens minted before the last password change / revocation.
    if user.token_version != token_version:
        return None

    return user


async def require_user(request: Request):
    """Like get_current_user, but raises 401 when not authenticated."""
    user = await get_current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user
