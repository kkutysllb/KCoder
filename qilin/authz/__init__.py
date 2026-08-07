"""Pluggable fine-grained authorization (resource-level RBAC and beyond)."""

from qilin.authz.adapter import GuardrailAuthorizationAdapter
from qilin.authz.enforcement import filter_tools_by_authorization
from qilin.authz.principal import (
    build_principal_from_context,
    normalize_authz_attributes,
)
from qilin.authz.provider import (
    AuthorizationProvider,
    AuthzDecision,
    AuthzReason,
    AuthzRequest,
    Principal,
)
from qilin.authz.rbac import RbacAuthorizationProvider
from qilin.authz.runtime import resolve_authorization_provider
from qilin.authz.tool_filter import apply_tool_authorization

__all__ = [
    "AuthorizationProvider",
    "AuthzDecision",
    "AuthzReason",
    "AuthzRequest",
    "GuardrailAuthorizationAdapter",
    "Principal",
    "RbacAuthorizationProvider",
    "apply_tool_authorization",
    "build_principal_from_context",
    "filter_tools_by_authorization",
    "normalize_authz_attributes",
    "resolve_authorization_provider",
]
