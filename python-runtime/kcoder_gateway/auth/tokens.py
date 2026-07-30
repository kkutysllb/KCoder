"""JWT token utilities — PyJWT wrapper.

Issues and verifies HS256 JWTs carrying the user id, email, and a
``token_version`` claim. The token_version is checked against the user's
current ``UserRow.token_version`` on every authenticated request, so
``change-password`` can invalidate all outstanding tokens by incrementing
the version (no server-side token blacklist needed).

The JWT secret is generated once and persisted to
``<dataDir>/.kcoder_jwt_secret`` by the gateway lifespan (see main.py).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import jwt

# Default token lifetime: 24 hours. renderer treats expires_in as advisory
# (it doesn't auto-refresh), so a full day keeps the UX smooth without
# making stolen tokens live forever.
DEFAULT_EXPIRES_SECONDS = 86400
ALGORITHM = "HS256"


def create_access_token(
    *,
    user_id: str,
    email: str,
    token_version: int,
    secret: str,
    expires_seconds: int = DEFAULT_EXPIRES_SECONDS,
) -> str:
    """Mint a signed JWT for the given user.

    Claims:
      sub  — user id (JWT standard subject)
      email — user email (for display without a DB lookup)
      tv   — token_version (checked on verify to support revocation)
      iat  — issued-at (JWT standard)
      exp  — expiry (JWT standard)
    """
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": user_id,
        "email": email,
        "tv": token_version,
        "iat": now,
        "exp": now + timedelta(seconds=expires_seconds),
    }
    return jwt.encode(payload, secret, algorithm=ALGORITHM)


class TokenError(Exception):
    """Raised when a token is malformed, expired, or has a bad signature."""


def decode_token(token: str, secret: str) -> dict[str, Any]:
    """Verify and decode a JWT, returning the claims dict.

    Raises TokenError on any failure (expired, bad signature, malformed).
    """
    try:
        payload = jwt.decode(token, secret, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError as exc:
        raise TokenError("Token expired") from exc
    except jwt.InvalidTokenError as exc:
        raise TokenError(f"Invalid token: {exc}") from exc

    if not isinstance(payload, dict):
        raise TokenError("Token payload is not a dict")
    return payload
