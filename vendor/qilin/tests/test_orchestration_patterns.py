"""Unit tests for qilin.orchestration.patterns (collaboration modes)."""

import asyncio

import pytest

from qilin.config.orchestration_config import AgentSpec
from qilin.orchestration.patterns import orchestrator_workers, peer_consensus
from qilin.subagents.executor import SubagentResult, SubagentStatus


class FakeExecutor:
    """Duck-typed executor; optionally fails the task."""

    def __init__(self, name: str, *, fail: bool = False) -> None:
        self.name = name
        self.fail = fail
        self.executed: list[str] = []

    async def _aexecute(self, task: str, result_holder=None) -> SubagentResult:
        self.executed.append(task)
        result = result_holder or SubagentResult(
            task_id="t", trace_id="tr", status=SubagentStatus.PENDING
        )
        if self.fail:
            result.try_set_terminal(SubagentStatus.FAILED, error="boom")
        else:
            result.try_set_terminal(
                SubagentStatus.COMPLETED, result=f"{self.name}:{task}"
            )
        return result


def _factory(*, fail: set[str] | None = None) -> object:
    fail = fail or set()

    def _make(spec: AgentSpec) -> FakeExecutor:
        return FakeExecutor(spec.name, fail=spec.name in fail)

    return _make


def _specs(*names: str) -> list[AgentSpec]:
    return [AgentSpec(name=n, description=f"{n} agent") for n in names]


class TestOrchestratorWorkers:
    async def test_dispatches_same_task_to_all_workers(self) -> None:
        specs = _specs("coder", "reviewer", "tester")

        results = await orchestrator_workers(
            specs, "build feature", executor_factory=_factory()
        )

        assert set(results) == {"coder", "reviewer", "tester"}
        assert results["coder"].result == "coder:build feature"
        assert results["reviewer"].result == "reviewer:build feature"

    async def test_requires_at_least_one_worker(self) -> None:
        with pytest.raises(ValueError, match="at least one worker"):
            await orchestrator_workers([], "t", executor_factory=_factory())

    async def test_failure_isolated_per_worker(self) -> None:
        specs = _specs("coder", "reviewer")

        results = await orchestrator_workers(
            specs, "t", executor_factory=_factory(fail={"reviewer"})
        )

        assert results["coder"].status == SubagentStatus.COMPLETED
        assert results["reviewer"].status == SubagentStatus.FAILED
        assert results["reviewer"].error == "boom"

    async def test_max_concurrency_is_enforced(self) -> None:
        probe = _ConcurrencyProbe()

        class ProbingExecutor:
            async def _aexecute(self, task: str, result_holder=None) -> SubagentResult:
                probe.active += 1
                probe.peak = max(probe.peak, probe.active)
                try:
                    await asyncio.sleep(0.05)
                    result = result_holder or SubagentResult(
                        task_id="t", trace_id="tr", status=SubagentStatus.PENDING
                    )
                    result.try_set_terminal(
                        SubagentStatus.COMPLETED, result="ok"
                    )
                    return result
                finally:
                    probe.active -= 1

        specs = _specs("a", "b", "c", "d")
        await orchestrator_workers(
            specs, "t", executor_factory=lambda spec: ProbingExecutor(),
            max_concurrency=2,
        )

        # 有并发发生（peak > 1）且被限流（peak <= 2）。
        assert 1 < probe.peak <= 2


class _ConcurrencyProbe:
    """Shared counter measuring peak active executions across workers."""

    def __init__(self) -> None:
        self.active = 0
        self.peak = 0


class TestPeerConsensus:
    async def test_consensus_when_all_peers_agree(self) -> None:
        specs = _specs("a", "b", "c")

        consensus, agreements, total = await peer_consensus(
            specs, "t", executor_factory=_factory(), min_agreement=0.6
        )

        assert agreements == 3
        assert total == 3
        assert consensus == "a: a:t\nb: b:t\nc: c:t"

    async def test_no_consensus_below_threshold(self) -> None:
        specs = _specs("a", "b")

        consensus, agreements, total = await peer_consensus(
            specs, "t", executor_factory=_factory(fail={"b"}), min_agreement=0.6
        )

        assert agreements == 1
        assert total == 2
        assert consensus is None

    async def test_threshold_boundary_reached(self) -> None:
        specs = _specs("a")

        consensus, agreements, total = await peer_consensus(
            specs, "t", executor_factory=_factory(), min_agreement=1.0
        )

        assert agreements == 1
        assert total == 1
        assert consensus == "a: a:t"

    @pytest.mark.parametrize(
        "min_agreement",
        [0.0, -0.5, 1.5],
    )
    async def test_invalid_min_agreement_raises(self, min_agreement: float) -> None:
        with pytest.raises(ValueError, match="min_agreement"):
            await peer_consensus(
                _specs("a"), "t", executor_factory=_factory(),
                min_agreement=min_agreement,
            )

    async def test_requires_at_least_one_peer(self) -> None:
        with pytest.raises(ValueError, match="at least one"):
            await peer_consensus([], "t", executor_factory=_factory())
