"""Collaboration patterns built on the orchestration primitives.

- ``orchestrator_workers``: 单 orchestrator 分派 + worker 并行执行 + 结果聚合
  （复用 :mod:`qilin.subagents.batch` 的有界并发与失败隔离）。
- ``peer_consensus``: 对等 agent 各自产出观点，按成功率阈值达成共识
  （辩论 / 评审场景）。
"""

from __future__ import annotations

import math
from collections.abc import Callable

from qilin.config.orchestration_config import AgentSpec
from qilin.subagents.batch import BatchTask, run_batch_async
from qilin.subagents.executor import SubagentResult, SubagentStatus


async def orchestrator_workers(
    specs: list[AgentSpec],
    task: str,
    *,
    executor_factory: Callable[[AgentSpec], object],
    max_concurrency: int = 3,
) -> dict[str, SubagentResult]:
    """Dispatch the same *task* to every worker in parallel.

    Returns:
        ``spec.name -> SubagentResult`` 映射；单个 worker 失败不影响其余
        （失败隔离，见 :func:`qilin.subagents.batch.run_batch_async`）。

    Raises:
        ValueError: 当 ``specs`` 为空时。
    """
    if not specs:
        raise ValueError("orchestrator_workers requires at least one worker")

    batch = [
        BatchTask(task=task, executor=executor_factory(spec), task_id=spec.name)
        for spec in specs
    ]
    results = await run_batch_async(batch, max_concurrency=max_concurrency)
    return {spec.name: result for spec, result in zip(specs, results, strict=True)}


async def peer_consensus(
    specs: list[AgentSpec],
    task: str,
    *,
    executor_factory: Callable[[AgentSpec], object],
    min_agreement: float = 0.6,
    max_concurrency: int = 3,
) -> tuple[str | None, int, int]:
    """Gather each peer's take on *task* and decide whether consensus is met.

    Args:
        min_agreement: 达成共识所需的最低成功率（含阈值，向上取整）。

    Returns:
        ``(consensus_text, agreements, total)``：成功率 >= 阈值时
        ``consensus_text`` 为所有成功观点的拼接（每行 ``name: result``），
        否则为 ``None``。

    Raises:
        ValueError: ``specs`` 为空，或 ``min_agreement`` 不在 (0, 1] 区间。
    """
    if not specs:
        raise ValueError("peer_consensus requires at least one peer")
    if not 0 < min_agreement <= 1:
        raise ValueError("min_agreement must be in (0, 1]")

    results = await orchestrator_workers(
        specs,
        task,
        executor_factory=executor_factory,
        max_concurrency=max_concurrency,
    )
    total = len(specs)
    agreements = sum(
        1 for r in results.values() if r.status == SubagentStatus.COMPLETED
    )
    required = math.ceil(min_agreement * total)
    if agreements < required:
        return None, agreements, total

    lines = [
        f"{spec.name}: {results[spec.name].result}"
        for spec in specs
        if results[spec.name].status == SubagentStatus.COMPLETED
        and results[spec.name].result is not None
    ]
    return "\n".join(lines), agreements, total
