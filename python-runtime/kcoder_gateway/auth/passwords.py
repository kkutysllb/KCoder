"""Password hashing utilities — passlib[bcrypt] wrapper.

Provides constant-time password hashing and verification. We use bcrypt
via passlib's CryptContext (the industry standard for credential storage).

passlib handles algorithm migration transparently if we ever need to
rotate away from bcrypt — just update the ``schemes`` list below.
"""

from __future__ import annotations

from passlib.context import CryptContext

# bcrypt is the current scheme; "auto" lets passlib verify legacy hashes
# if we add new schemes in the future without breaking old stored hashes.
_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(plain: str) -> str:
    """Hash a plaintext password and return the bcrypt digest string."""
    return _pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    """Return True if *plain* matches *hashed*.

    Constant-time comparison is handled by passlib/bcrypt internally.
    Returns False on any verification failure (never raises).
    """
    try:
        return _pwd_context.verify(plain, hashed)
    except Exception:
        # Malformed hash, unknown scheme, etc. — treat as mismatch.
        return False
