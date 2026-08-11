"""Principal builder — the single sanctioned way to construct a Principal.

Both Layer 1 (tool assembly) and Layer 2 (GuardrailAuthorizationAdapter) must
use this builder so identity semantics stay consistent. It is a pure function:
no global config reads, no caching, no input mutation.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from qilin.authz.provider import Principal


def normalize_authz_attributes(raw: Any) -> dict[str, Any]:
    """Validate and copy ``authz_attributes`` into a fresh dict.

    This is the single normalization point shared by the Principal builder and
    all propagation sites (middleware, executor, task_tool). Keeping it in one
    place ensures every in-process consumption boundary raises ``TypeError``
    for non-Mapping values rather than silently coercing.

    Raises:
        TypeError: If *raw* is not ``None`` and not a ``Mapping``.
    """
    if raw is None:
        return {}
    if isinstance(raw, Mapping):
        return dict(raw)
    raise TypeError(f"authz_attributes must be a Mapping, got {type(raw).__name__}")


_AGENT_IDENTITY_KEYS = ("agent_id", "agent_role")


def normalize_agent_identity(raw: Any) -> dict[str, str]:
    """Validate and extract the agent-dimension identity from *raw*.

    ``agent_id`` / ``agent_role`` 必须是非空 ``str``：缺失或空串不产生键，
    非法类型抛 ``TypeError``。与 user 维度的 attributes 并存——调用方把
    返回的 dict 合并进 :func:`normalize_authz_attributes` 的结果即可
    （agent 维度独立校验，不触碰 user 键）。

    Raises:
        TypeError: ``raw`` 非 ``None`` 且非 ``Mapping``，或 agent 键值
            不是 ``str``。
    """
    if raw is None:
        return {}
    if not isinstance(raw, Mapping):
        raise TypeError(
            f"authz_attributes must be a Mapping, got {type(raw).__name__}"
        )
    identity: dict[str, str] = {}
    for key in _AGENT_IDENTITY_KEYS:
        value = raw.get(key)
        if value is None:
            continue
        if not isinstance(value, str):
            raise TypeError(
                f"authz attribute '{key}' must be a str, got {type(value).__name__}"
            )
        if value:
            identity[key] = value
    return identity


def build_principal_from_context(
    context: Mapping[str, Any],
    *,
    default_role: str,
) -> Principal:
    """Build a :class:`Principal` from a runtime context mapping.

    Args:
        context: The runtime context (``config["context"]`` or a dict assembled
            from a :class:`~qilin.guardrails.provider.GuardrailRequest`).
        default_role: Role used when ``user_role`` is ``None`` or empty string.
            Unknown but non-empty roles are **not** replaced — only missing ones.

    Raises:
        TypeError: If ``authz_attributes`` is present but not a ``Mapping``.
    """
    resolved_role = context.get("user_role")
    if resolved_role is None or resolved_role == "":
        resolved_role = default_role

    return Principal(
        user_id=context.get("user_id"),
        role=resolved_role,
        oauth_provider=context.get("oauth_provider"),
        oauth_id=context.get("oauth_id"),
        channel_user_id=context.get("channel_user_id"),
        is_internal=context.get("is_internal") is True,
        attributes=normalize_authz_attributes(context.get("authz_attributes")),
    )
