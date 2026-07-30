"""KCoder gateway authentication subsystem.

Provides real local-auth (bcrypt + JWT) backed by the QiLin ``users``
table. Replaces the Phase 5 ``auth_stub`` with working endpoints.

Usage in main.py::

    from .auth import router as auth_router, init_auth_state

    # inside lifespan:
    user_repo, jwt_secret = await init_auth_state(data_dir)
    app.state.user_repo = user_repo
    app.state.jwt_secret = jwt_secret

    # inside create_app:
    app.include_router(auth_router)
"""

from __future__ import annotations

import logging
import os
import secrets
from pathlib import Path

from .routes import router
from .user_repo import UserRepository

logger = logging.getLogger("kcoder_gateway.auth")

__all__ = ["router", "init_auth_state", "UserRepository"]

# A 256-bit (32 byte) secret gives ample entropy for HS256. Stored as hex.
_SECRET_FILE_NAME = ".kcoder_jwt_secret"
_SECRET_NUM_BYTES = 32


def _load_or_create_secret(secret_path: Path) -> str:
    """Load the JWT secret from *secret_path*, or generate + persist one.

    The file is created with 0600 permissions. We never overwrite an
    existing secret — losing it invalidates every outstanding token.
    """
    if secret_path.exists():
        secret = secret_path.read_text(encoding="utf-8").strip()
        if secret:
            return secret
        logger.warning("JWT secret file %s is empty — regenerating", secret_path)

    secret = secrets.token_hex(_SECRET_NUM_BYTES)
    secret_path.parent.mkdir(parents=True, exist_ok=True)
    secret_path.write_text(secret, encoding="utf-8")
    try:
        os.chmod(secret_path, 0o600)
    except OSError:
        # Non-fatal: some filesystems don't support chmod.
        pass
    logger.info("Generated new JWT secret at %s", secret_path)
    return secret


async def init_auth_state(data_dir: str | Path) -> tuple[UserRepository | None, str]:
    """Initialise the auth subsystem for the gateway lifespan.

    Returns ``(user_repo, jwt_secret)``. ``user_repo`` is None when the
    QiLin persistence layer couldn't be initialised (memory backend or
    DB unavailable) — in that case auth endpoints degrade to stub mode.

    Args:
        data_dir: Directory to persist the JWT secret file in.
    """
    from qilin.persistence import get_session_factory

    secret_path = Path(data_dir) / _SECRET_FILE_NAME
    jwt_secret = _load_or_create_secret(secret_path)

    session_factory = get_session_factory()
    if session_factory is None:
        logger.warning(
            "QiLin persistence session factory is None (backend=memory?) "
            "— auth endpoints will return 503"
        )
        return None, jwt_secret

    user_repo = UserRepository(session_factory)
    logger.info("Auth subsystem ready (user_repo bound to session factory)")
    return user_repo, jwt_secret
