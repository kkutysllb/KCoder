"""UserRepository — async CRUD over the QiLin users table.

Each method opens its own short-lived AsyncSession (mirrors the pattern
used by RunRepository / FeedbackRepository in qilin.persistence). The
session factory is injected at construction time and comes from
``qilin.persistence.get_session_factory()``.

UserRow fields (qilin.persistence.user.model):
  id (str PK), email (unique), password_hash (nullable), system_role,
  created_at, oauth_provider, oauth_id, needs_setup, token_version
"""

from __future__ import annotations

import logging

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from qilin.persistence.user.model import UserRow

logger = logging.getLogger("kcoder_gateway.auth.user_repo")


class UserRepository:
    """Async repository for the ``users`` table."""

    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._sf = session_factory

    async def create(
        self,
        *,
        id: str,
        email: str,
        password_hash: str | None,
        system_role: str = "user",
        needs_setup: bool = False,
    ) -> UserRow:
        """Insert a new user row and return it."""
        async with self._sf() as session:
            row = UserRow(
                id=id,
                email=email,
                password_hash=password_hash,
                system_role=system_role,
                needs_setup=needs_setup,
            )
            session.add(row)
            await session.commit()
            # refresh to load server-side defaults (created_at)
            await session.refresh(row)
            return row

    async def find_by_email(self, email: str) -> UserRow | None:
        """Return the user with *email*, or None."""
        async with self._sf() as session:
            stmt = select(UserRow).where(UserRow.email == email)
            result = await session.execute(stmt)
            return result.scalar_one_or_none()

    async def find_by_id(self, user_id: str) -> UserRow | None:
        """Return the user with *user_id*, or None."""
        async with self._sf() as session:
            stmt = select(UserRow).where(UserRow.id == user_id)
            result = await session.execute(stmt)
            return result.scalar_one_or_none()

    async def count(self) -> int:
        """Return total user count (used by setup-status to detect first run)."""
        async with self._sf() as session:
            result = await session.execute(select(func.count()).select_from(UserRow))
            return int(result.scalar_one())

    async def has_admin(self) -> bool:
        """Return True if at least one admin user exists."""
        async with self._sf() as session:
            result = await session.execute(
                select(func.count()).select_from(UserRow).where(UserRow.system_role == "admin")
            )
            return int(result.scalar_one()) > 0

    async def update_password(self, user_id: str, new_hash: str) -> None:
        """Set a new password hash for *user_id*."""
        async with self._sf() as session:
            await session.execute(
                update(UserRow).where(UserRow.id == user_id).values(password_hash=new_hash)
            )
            await session.commit()

    async def increment_token_version(self, user_id: str) -> int:
        """Atomically increment and return the new token_version.

        This invalidates all outstanding JWTs for the user because the
        ``tv`` claim embedded in each token no longer matches.
        """
        async with self._sf() as session:
            result = await session.execute(
                update(UserRow)
                .where(UserRow.id == user_id)
                .values(token_version=UserRow.token_version + 1)
                .returning(UserRow.token_version)
            )
            new_version = int(result.scalar_one())
            await session.commit()
            return new_version
