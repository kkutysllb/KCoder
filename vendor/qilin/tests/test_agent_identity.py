"""Unit tests for P3 governance: agent identity + per-agent token budget."""

import pytest

from qilin.authz.principal import normalize_agent_identity
from qilin.config.token_budget_config import (
    TokenBudgetConfig,
    resolve_agent_token_budget,
)


class TestNormalizeAgentIdentity:
    def test_preserves_valid_identity(self) -> None:
        identity = normalize_agent_identity(
            {"agent_id": "coder", "agent_role": "worker"}
        )

        assert identity == {"agent_id": "coder", "agent_role": "worker"}

    def test_ignores_non_agent_keys(self) -> None:
        identity = normalize_agent_identity(
            {"user_id": "u", "agent_id": "coder"}
        )

        assert identity == {"agent_id": "coder"}

    def test_missing_identity_returns_empty(self) -> None:
        assert normalize_agent_identity(None) == {}
        assert normalize_agent_identity({}) == {}

    def test_invalid_agent_id_type_raises(self) -> None:
        with pytest.raises(TypeError, match="agent_id"):
            normalize_agent_identity({"agent_id": 123})

    def test_invalid_agent_role_type_raises(self) -> None:
        with pytest.raises(TypeError, match="agent_role"):
            normalize_agent_identity({"agent_role": []})

    def test_empty_string_values_dropped(self) -> None:
        identity = normalize_agent_identity({"agent_id": "", "agent_role": ""})

        assert identity == {}

    def test_non_mapping_raises(self) -> None:
        with pytest.raises(TypeError, match="Mapping"):
            normalize_agent_identity(["agent_id"])


class TestResolveAgentTokenBudget:
    def test_override_for_configured_agent(self) -> None:
        base = TokenBudgetConfig(max_tokens=200_000)
        per_agent = {"coder": TokenBudgetConfig(max_tokens=10_000)}

        resolved = resolve_agent_token_budget("coder", TokenBudgetConfig(
            max_tokens=200_000, per_agent=per_agent
        ))

        assert resolved is per_agent["coder"]
        assert resolved.max_tokens == 10_000
        # 全局配置不受影响。
        assert base.max_tokens == 200_000

    def test_fallback_to_global_when_unconfigured(self) -> None:
        config = TokenBudgetConfig(max_tokens=200_000, per_agent={"coder": TokenBudgetConfig(max_tokens=10_000)})

        resolved = resolve_agent_token_budget("reviewer", config)

        assert resolved is config

    def test_fallback_with_empty_map(self) -> None:
        config = TokenBudgetConfig()

        assert resolve_agent_token_budget("coder", config) is config
