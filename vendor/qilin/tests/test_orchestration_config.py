"""Unit tests for qilin.config.orchestration_config (multi-agent mode config)."""

import pytest
from pydantic import ValidationError

from qilin.config.orchestration_config import (
    AgentSpec,
    OrchestrationConfig,
    OrchestrationMode,
)


class TestOrchestrationMode:
    def test_enum_values(self) -> None:
        assert OrchestrationMode.SINGLE == "single"
        assert OrchestrationMode.MULTI == "multi"


class TestAgentSpec:
    def test_defaults(self) -> None:
        spec = AgentSpec(name="coder", description="Writes code")

        assert spec.role == "worker"
        assert spec.model == "inherit"
        assert spec.max_turns == 50
        assert spec.timeout_seconds == 900
        assert spec.tools is None
        assert spec.disallowed_tools is None

    def test_roundtrip_fields(self) -> None:
        spec = AgentSpec(
            name="reviewer",
            description="Reviews diffs",
            system_prompt="You are a reviewer",
            tools=["read_file", "grep"],
            disallowed_tools=["bash"],
            skills=["review"],
            model="deepseek-chat",
            max_turns=30,
            timeout_seconds=600,
            role="reviewer",
        )
        dumped = spec.model_dump()

        assert dumped["name"] == "reviewer"
        assert dumped["tools"] == ["read_file", "grep"]
        assert dumped["disallowed_tools"] == ["bash"]
        assert dumped["role"] == "reviewer"

    def test_empty_name_rejected(self) -> None:
        with pytest.raises(ValidationError):
            AgentSpec(name="", description="x")


class TestOrchestrationConfig:
    def test_defaults_to_single_mode(self) -> None:
        cfg = OrchestrationConfig()

        assert cfg.mode == OrchestrationMode.SINGLE
        assert cfg.enabled is False
        assert cfg.max_concurrency == 3
        assert cfg.workers == []

    def test_multi_mode_enabled(self) -> None:
        cfg = OrchestrationConfig(mode="multi")

        assert cfg.enabled is True

    def test_max_concurrency_must_be_positive(self) -> None:
        with pytest.raises(ValidationError):
            OrchestrationConfig(max_concurrency=0)

    def test_duplicate_worker_names_rejected(self) -> None:
        with pytest.raises(ValidationError, match="unique"):
            OrchestrationConfig(
                mode="multi",
                workers=[
                    AgentSpec(name="w1", description="one"),
                    AgentSpec(name="w1", description="two"),
                ],
            )

    def test_to_subagent_configs(self) -> None:
        cfg = OrchestrationConfig(
            mode="multi",
            workers=[
                AgentSpec(
                    name="coder",
                    description="Writes code",
                    system_prompt="You are coder",
                    tools=["read_file"],
                    model="claude-sonnet-4-5",
                    max_turns=60,
                ),
                AgentSpec(name="reviewer", description="Reviews"),
            ],
        )
        subagent_cfgs = cfg.to_subagent_configs()

        assert set(subagent_cfgs) == {"coder", "reviewer"}
        coder = subagent_cfgs["coder"]
        assert coder.description == "Writes code"
        assert coder.system_prompt == "You are coder"
        assert coder.tools == ["read_file"]
        assert coder.model == "claude-sonnet-4-5"
        assert coder.max_turns == 60
        # Inherited defaults preserved through the conversion.
        reviewer = subagent_cfgs["reviewer"]
        assert reviewer.model == "inherit"
        assert reviewer.max_turns == 50
        assert reviewer.disallowed_tools == ["task"]
