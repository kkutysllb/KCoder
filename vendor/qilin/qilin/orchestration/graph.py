"""OrchestratorGraph: build a LangGraph multi-agent orchestration graph.

拓扑：单一 orchestrator 节点 + N 个 worker 节点（每个 worker 由注入的
``executor_factory`` 驱动，真实场景为 ``SubagentExecutor``）。

每轮执行：
1. orchestrator 从 ``handoffs`` 待办队列弹出一个 ``AgentHandoff``，
   写入 ``active_handoff`` 并路由到对应 worker 节点；
2. worker 节点执行任务，把 ``HandoffResult`` 追加进 ``results``；
3. worker 完成后回到 orchestrator，循环直到待办队列为空或达到
   ``max_rounds``（防死循环）。

并行吞吐由 :mod:`qilin.subagents.batch` 提供（patterns 层）；本图保证
单 handoff 的正确流转与失败隔离。
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Protocol

from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from typing_extensions import TypedDict

from qilin.config.orchestration_config import AgentSpec
from qilin.orchestration.handoff import AgentHandoff, HandoffError, HandoffResult
from qilin.subagents.executor import SubagentResult, SubagentStatus


class OrchestrationState(TypedDict, total=False):
    """Shared state channels of the orchestration graph."""

    messages: list[Any]
    handoffs: list[AgentHandoff]  # 待办队列（FIFO）
    results: list[HandoffResult]  # 已完成结果
    active_handoff: AgentHandoff | None  # 当前分派的 handoff
    round: int
    max_rounds: int


class _WorkerExecutor(Protocol):
    """最小执行器契约：测试 fake 与真实 SubagentExecutor 都满足。"""

    async def _aexecute(
        self, task: str, result_holder: SubagentResult | None = None
    ) -> SubagentResult: ...


@dataclass
class OrchestratorGraph:
    """Build and run a LangGraph orchestrator/workers graph.

    Attributes:
        workers: 参与编排的 worker 规格（name -> spec）。
        executor_factory: 由 AgentSpec 创建 worker 执行器的工厂（真实场景
            返回 SubagentExecutor；测试可注入 fake）。执行器只需提供
            async ``_aexecute(task, result_holder=None)``。
        max_rounds: orchestrator 分派轮次上限（防死循环）。
        max_concurrency: 保留字段，供 patterns 层并行度参考。
    """

    workers: dict[str, AgentSpec]
    executor_factory: Callable[[AgentSpec], _WorkerExecutor]
    max_rounds: int = 10
    max_concurrency: int = 3

    def build(self) -> CompiledStateGraph:
        """Compile the orchestration graph.

        Raises:
            ValueError: 当 ``workers`` 为空时（编排图至少需要一个 worker）。
        """
        if not self.workers:
            raise ValueError("OrchestratorGraph requires at least one worker")

        graph = StateGraph(OrchestrationState)
        graph.add_node("orchestrator", self._orchestrator_node)  # type: ignore[arg-type]  # langgraph 桩泛型局限
        for name in self.workers:
            graph.add_node(name, self._make_worker_node(name))  # type: ignore[arg-type]  # langgraph 桩泛型局限
        graph.add_edge(START, "orchestrator")
        graph.add_conditional_edges(
            "orchestrator",
            self._route,
            {**{name: name for name in self.workers}, "end": END},
        )
        for name in self.workers:
            graph.add_edge(name, "orchestrator")
        return graph.compile()

    async def _orchestrator_node(self, state: OrchestrationState) -> dict[str, Any]:
        """Pop the next pending handoff, or signal completion."""
        max_rounds = int(state.get("max_rounds", self.max_rounds))
        round_no = int(state.get("round", 0)) + 1
        if round_no > max_rounds:
            # 超轮次上限：停止分派，剩余 handoffs 保留在待办队列中。
            return {
                "active_handoff": None,
                "round": round_no,
                "results": state.get("results", []),
            }

        handoffs = list(state.get("handoffs", []))
        if not handoffs:
            return {
                "active_handoff": None,
                "round": round_no,
                "results": state.get("results", []),
            }

        active = handoffs.pop(0)
        active.inherit_trace_id()  # 无显式 trace 时继承父 trace（P3）
        return {"active_handoff": active, "handoffs": handoffs, "round": round_no}

    def _route(self, state: OrchestrationState) -> str:
        """Route the active handoff to its target worker (or ``end``)."""
        active = state.get("active_handoff")
        if active is None:
            return "end"
        if active.to_agent not in self.workers:
            raise HandoffError(
                f"Handoff targets unknown agent '{active.to_agent}' (from {active.from_agent})"
            )
        return active.to_agent

    def _make_worker_node(
        self, name: str
    ) -> Callable[[OrchestrationState], Awaitable[dict[str, Any]]]:
        """Create the node executing handoffs routed to worker *name*."""
        spec = self.workers[name]

        async def _worker_node(state: OrchestrationState) -> dict[str, Any]:
            active = state.get("active_handoff")
            if active is None:
                return {"active_handoff": None}

            try:
                subagent_result: SubagentResult = await self.executor_factory(
                    spec
                )._aexecute(active.task)
            except Exception as exc:
                outcome = HandoffResult(
                    success=False,
                    error=str(exc),
                    handoff=active,
                    trace_id=active.context.get("trace_id"),
                )
            else:
                outcome = HandoffResult(
                    success=subagent_result.status == SubagentStatus.COMPLETED,
                    result=subagent_result.result,
                    error=subagent_result.error,
                    handoff=active,
                    trace_id=active.context.get("trace_id"),
                )

            return {
                "results": [*state.get("results", []), outcome],
                "active_handoff": None,
            }

        return _worker_node
