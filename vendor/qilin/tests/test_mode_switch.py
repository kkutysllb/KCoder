"""Unit tests for CFG: single/multi orchestration mode switch in make_lead_agent."""

import pytest
from langgraph.graph.state import CompiledStateGraph

from qilin.agents.lead_agent.agent import (
    _resolve_orchestration_mode,
    make_lead_agent,
)
from qilin.config.app_config import AppConfig
from qilin.config.orchestration_config import (
    AgentSpec,
    OrchestrationConfig,
    OrchestrationMode,
)


def _make_app_config(
    mode: OrchestrationMode, workers: list[AgentSpec]
) -> AppConfig:
    app_config = AppConfig.model_validate(
        {
            "sandbox": {"use": "qilin.sandbox.local:LocalSandboxProvider"},
            "models": [
                {
                    "name": "test-model",
                    "use": "langchain_openai.chat_models:ChatOpenAI",
                    "model": "gpt-4o-mini",
                }
            ],
        }
    )
    app_config.orchestration = OrchestrationConfig(
        mode=mode, max_concurrency=2, workers=workers
    )
    return app_config


def _lead_config(app_config: AppConfig) -> dict:
    # make_lead_agent 通过 runtime config 的 app_config 键注入已解析配置。
    return {"configurable": {"app_config": app_config}, "context": {}}


@pytest.fixture
def fake_chat_model(monkeypatch):
    """Stub create_chat_model so the v1 lead path builds without API keys."""

    from langchain_core.language_models.fake_chat_models import (
        GenericFakeChatModel,
    )

    def _stub(*args, **kwargs) -> GenericFakeChatModel:
        return GenericFakeChatModel(messages=iter([]))

    monkeypatch.setattr(
        "qilin.agents.lead_agent.agent.create_chat_model", _stub
    )


class TestResolveOrchestrationMode:
    def test_defaults_to_app_config_mode(self) -> None:
        orchestration = OrchestrationConfig()  # mode=single

        assert (
            _resolve_orchestration_mode({}, orchestration)
            == OrchestrationMode.SINGLE
        )

    def test_runtime_override_wins(self) -> None:
        orchestration = OrchestrationConfig()  # mode=single

        mode = _resolve_orchestration_mode(
            {"orchestration_mode": "multi"}, orchestration
        )

        assert mode == OrchestrationMode.MULTI

    def test_invalid_runtime_override_falls_back(self) -> None:
        orchestration = OrchestrationConfig(mode=OrchestrationMode.MULTI)

        mode = _resolve_orchestration_mode(
            {"orchestration_mode": "bogus"}, orchestration
        )

        assert mode == OrchestrationMode.MULTI


class TestMakeLeadAgentModeSwitch:
    def test_single_mode_builds_v1_lead_graph(
        self, fake_chat_model
    ) -> None:
        app_config = _make_app_config(OrchestrationMode.SINGLE, [])

        graph = make_lead_agent(_lead_config(app_config))

        assert isinstance(graph, CompiledStateGraph)
        # v1 图没有 orchestrator/worker 编排节点。
        assert "orchestrator" not in graph.get_graph().nodes

    def test_multi_mode_builds_orchestrator_graph(self) -> None:
        app_config = _make_app_config(
            OrchestrationMode.MULTI,
            [AgentSpec(name="coder", description="writes code")],
        )

        graph = make_lead_agent(_lead_config(app_config))

        assert isinstance(graph, CompiledStateGraph)
        nodes = set(graph.get_graph().nodes)
        assert "orchestrator" in nodes
        assert "coder" in nodes

    def test_multi_mode_requires_workers(
        self, fake_chat_model
    ) -> None:
        # mode=multi 但 workers 为空：回退 v1 lead graph。
        app_config = _make_app_config(OrchestrationMode.MULTI, [])

        graph = make_lead_agent(_lead_config(app_config))

        assert isinstance(graph, CompiledStateGraph)
        assert "orchestrator" not in graph.get_graph().nodes

    def test_runtime_override_enables_multi(self) -> None:
        # app 配置 single，但单次请求通过 runtime config 覆盖为 multi。
        app_config = _make_app_config(
            OrchestrationMode.SINGLE,
            [AgentSpec(name="coder", description="writes code")],
        )
        config = _lead_config(app_config)
        config["configurable"]["orchestration_mode"] = "multi"

        graph = make_lead_agent(config)

        assert "orchestrator" in graph.get_graph().nodes
