"""Unit tests for qilin.subagents.batch (parallel batch execution)."""

import asyncio

import pytest

from qilin.subagents.batch import BatchTask, run_batch, run_batch_async
from qilin.subagents.executor import SubagentResult, SubagentStatus


class FakeExecutor:
    """Minimal duck-typed executor: only ``_aexecute`` is used by batch."""

    def __init__(self, *, delay: float = 0.0, fail: bool = False, name: str = "fake") -> None:
        self.delay = delay
        self.fail = fail
        self.name = name

    async def _aexecute(self, task: str, result_holder=None) -> SubagentResult:
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.fail:
            raise RuntimeError(f"boom: {task}")
        result = result_holder or SubagentResult(
            task_id="t", trace_id="tr", status=SubagentStatus.COMPLETED
        )
        result.try_set_terminal(SubagentStatus.COMPLETED, result=f"done: {task}")
        return result


def _make_tasks(n: int, **kwargs) -> list[BatchTask]:
    return [BatchTask(task=f"task-{i}", executor=FakeExecutor(**kwargs)) for i in range(n)]


class TestRunBatchAsync:
    async def test_returns_results_in_input_order(self) -> None:
        tasks = _make_tasks(5, delay=0.005)
        results = await run_batch_async(tasks, max_concurrency=3)

        assert len(results) == 5
        assert [r.result for r in results] == [f"done: task-{i}" for i in range(5)]
        assert all(r.status == SubagentStatus.COMPLETED for r in results)

    async def test_respects_max_concurrency(self) -> None:
        active = 0
        peak = 0
        lock = asyncio.Lock()

        class TrackingExecutor:
            async def _aexecute(self, task: str, result_holder=None) -> SubagentResult:
                nonlocal active, peak
                async with lock:
                    active += 1
                    peak = max(peak, active)
                await asyncio.sleep(0.02)
                async with lock:
                    active -= 1
                result = result_holder or SubagentResult(
                    task_id="t", trace_id="tr", status=SubagentStatus.COMPLETED
                )
                result.try_set_terminal(SubagentStatus.COMPLETED, result=f"done: {task}")
                return result

        tasks = [BatchTask(task=f"task-{i}", executor=TrackingExecutor()) for i in range(8)]
        results = await run_batch_async(tasks, max_concurrency=3)

        assert peak <= 3
        assert len(results) == 8

    async def test_failure_isolation_marks_failed_without_raising(self) -> None:
        tasks = [
            BatchTask(task="ok-1", executor=FakeExecutor()),
            BatchTask(task="bad", executor=FakeExecutor(fail=True)),
            BatchTask(task="ok-2", executor=FakeExecutor()),
        ]
        results = await run_batch_async(tasks, max_concurrency=2)

        assert results[0].status == SubagentStatus.COMPLETED
        assert results[1].status == SubagentStatus.FAILED
        assert "boom: bad" in (results[1].error or "")
        assert results[2].status == SubagentStatus.COMPLETED

    async def test_empty_task_list_returns_empty(self) -> None:
        assert await run_batch_async([]) == []

    async def test_max_concurrency_below_one_raises(self) -> None:
        with pytest.raises(ValueError, match="max_concurrency"):
            await run_batch_async(_make_tasks(1), max_concurrency=0)


class TestRunBatch:
    def test_sync_wrapper_returns_results(self) -> None:
        results = run_batch(_make_tasks(3), max_concurrency=2)

        assert len(results) == 3
        assert [r.result for r in results] == ["done: task-0", "done: task-1", "done: task-2"]
