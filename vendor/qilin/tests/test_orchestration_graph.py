"""Unit tests for qilin.orchestration.graph (OrchestratorGraph)."""


import pytest

from qilin.config.orchestration_config import AgentSpec
from qilin.orchestration.graph import OrchestratorGraph
from qilin.orchestration.handoff import AgentHandoff, HandoffError
from qilin.subagents.executor import SubagentResult, SubagentStatus
from qilin.trace_context import request_trace_context


class FakeExecutor:
    """Duck-typed executor: records the executed task on the instance."""

    def __init__(self, name: str) -> None:
        self.name = name
        self.executed: list[str] = []

    async def _aexecute(self, task: str, result_holder=None) -> SubagentResult:
        self.executed.append(task)
        # 起始态必须是 PENDING：try_set_terminal 只接受首个 terminal 写入，
        # 构造即 COMPLETED 会导致后续 result 写入被拒绝（返回 False）。
        result = result_holder or SubagentResult(
            task_id="t", trace_id="tr", status=SubagentStatus.PENDING
        )
        result.try_set_terminal(
            SubagentStatus.COMPLETED, result=f"{self.name}:{task}"
        )
        return result


def _factory(spec: AgentSpec) -> FakeExecutor:
    return FakeExecutor(spec.name)


def _specs() -> dict[str, AgentSpec]:
    return {
        "coder": AgentSpec(name="coder", description="writes code"),
        "reviewer": AgentSpec(name="reviewer", description="reviews"),
    }


class TestBuild:
    def test_requires_at_least_one_worker(self) -> None:
        with pytest.raises(ValueError, match="at least one worker"):
            OrchestratorGraph(workers={}, executor_factory=_factory).build()

    def test_build_returns_compiled_graph_with_worker_nodes(self) -> None:
        graph = OrchestratorGraph(
            workers=_specs(), executor_factory=_factory
        ).build()

        nodes = set(graph.get_graph().nodes)
        assert "orchestrator" in nodes
        assert "coder" in nodes
        assert "reviewer" in nodes


class TestInvoke:
    async def test_single_handoff_executes_and_records_result(self) -> None:
        graph = OrchestratorGraph(
            workers=_specs(), executor_factory=_factory
        ).build()
        handoff = AgentHandoff(
            from_agent="lead", to_agent="coder", task="write code"
        )

        final = await graph.ainvoke({"handoffs": [handoff]})

        assert len(final["results"]) == 1
        result = final["results"][0]
        assert result.success is True
        assert result.result == "coder:write code"
        assert result.handoff is not None
        assert result.handoff.task == "write code"

    async def test_multiple_handoffs_run_sequentially(self) -> None:
        graph = OrchestratorGraph(
            workers=_specs(), executor_factory=_factory
        ).build()
        handoffs = [
            AgentHandoff(from_agent="lead", to_agent="coder", task="t1"),
            AgentHandoff(from_agent="lead", to_agent="reviewer", task="t2"),
        ]

        final = await graph.ainvoke({"handoffs": handoffs})

        assert [r.result for r in final["results"]] == ["coder:t1", "reviewer:t2"]

    async def test_no_handoffs_ends_immediately(self) -> None:
        graph = OrchestratorGraph(
            workers=_specs(), executor_factory=_factory
        ).build()

        final = await graph.ainvoke({"handoffs": []})

        assert final["results"] == []

    async def test_unknown_target_agent_raises(self) -> None:
        graph = OrchestratorGraph(
            workers=_specs(), executor_factory=_factory
        ).build()
        handoff = AgentHandoff(from_agent="lead", to_agent="ghost", task="t")

        with pytest.raises(HandoffError, match="ghost"):
            await graph.ainvoke({"handoffs": [handoff]})

    async def test_max_rounds_caps_execution(self) -> None:
        graph = OrchestratorGraph(
            workers=_specs(), executor_factory=_factory, max_rounds=2
        ).build()
        handoffs = [
            AgentHandoff(from_agent="lead", to_agent="coder", task=f"t{i}")
            for i in range(5)
        ]

        final = await graph.ainvoke({"handoffs": handoffs})

        # 每轮最多执行一个 handoff；round 从 0 开始，max_rounds=2 意味着
        # 只能执行 2 个，其余保留在待办队列中。
        assert len(final["results"]) == 2
        assert len(final["handoffs"]) == 3


    async def test_result_inherits_trace_id_from_handoff(self) -> None:
        graph = OrchestratorGraph(
            workers=_specs(), executor_factory=_factory
        ).build()
        handoff = AgentHandoff(from_agent="lead", to_agent="coder", task="t")

        with request_trace_context("trace-42"):
            final = await graph.ainvoke({"handoffs": [handoff]})

        assert final["results"][0].trace_id == "trace-42"
