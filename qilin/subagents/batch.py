"""Parallel batch execution for subagents.

程序化并行入口，与 ``task_tool``（LLM 触发）互补：把多个独立子代理任务以
有界并发度并行执行，任一任务失败不影响其余任务（失败隔离），结果顺序与
输入顺序一致。
"""

import asyncio
from dataclasses import dataclass

from qilin.subagents.executor import SubagentResult, SubagentStatus


@dataclass
class BatchTask:
    """A single subagent task bound to its own executor.

    ``executor`` 独立实例（自带独立 trace_id），``task`` 为该实例执行的任务
    描述；``task_id`` 可选，用于在结果中标识批次内任务。
    """

    task: str
    executor: object  # duck-typed: 需要 async _aexecute(task, result_holder=None)
    task_id: str | None = None


async def run_batch_async(
    tasks: list[BatchTask],
    *,
    max_concurrency: int = 3,
) -> list[SubagentResult]:
    """并行执行一批子代理任务。

    Args:
        tasks: 待执行任务（顺序即返回顺序）。
        max_concurrency: 并发上限（Semaphore 限流）。

    Returns:
        与输入同序的 SubagentResult 列表；异常任务转为 FAILED 状态而非抛出。

    Raises:
        ValueError: 当 ``max_concurrency`` 小于 1 时。
    """
    if max_concurrency < 1:
        raise ValueError("max_concurrency must be >= 1")

    semaphore = asyncio.Semaphore(max_concurrency)

    async def _run_one(item: BatchTask) -> SubagentResult:
        result = SubagentResult(
            task_id=item.task_id or "",
            trace_id=getattr(item.executor, "trace_id", None) or "",
            status=SubagentStatus.RUNNING,
        )
        async with semaphore:
            try:
                return await item.executor._aexecute(item.task, result)
            except Exception as exc:  # 失败隔离：转 FAILED，不拖垮批次
                result.try_set_terminal(SubagentStatus.FAILED, error=str(exc))
                return result

    return list(await asyncio.gather(*(_run_one(t) for t in tasks)))


def run_batch(
    tasks: list[BatchTask],
    *,
    max_concurrency: int = 3,
) -> list[SubagentResult]:
    """同步包装：``asyncio.run`` 执行 :func:`run_batch_async`。

    注意：若调用方已处于运行中的事件循环（如 gateway 请求处理），请直接
    使用 :func:`run_batch_async`。
    """
    return asyncio.run(run_batch_async(tasks, max_concurrency=max_concurrency))
