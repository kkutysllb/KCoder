# QiLin v2.0.0 Multi-Agent Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 QiLin 从 v1.0.0 单智能体框架（lead agent + 工具式子代理）演进为 v2.0.0 多智能体框架：新增编排层、agent 间通信、handoff 协议、治理扩展，并支持配置切换 single / multi 两种运行模式（默认 single 保持 v1 兼容）。

**Architecture:** 在现有 `SubagentExecutor`（已有结果契约/超时/取消/后台任务）基座上，新增 `qilin/orchestration/` 包承载编排能力：`handoff.py`（协议）、`batch.py`（P0 并行执行层）、`inbox.py`（P2 消息）、`graph.py`（P1 Orchestrator 图）、`patterns.py`（P2 协作模式）。配置在 `AppConfig` 增加 `orchestration` 段（`mode: "single" | "multi"`），`make_lead_agent` 按模式分支。治理复用现有 `authz`/`token_budget_middleware` 并做 agent 维度扩展。

**Tech Stack:** Python 3.12 / LangGraph / Pydantic v2 / asyncio / pytest / ruff

**版本路线:** v1.0.0 = 单智能体（当前，已提交）；v2.0.0 = 多智能体（本次改造）

---

## 文件结构 / File Map

```
qilin/
├── subagents/
│   ├── batch.py                 # 新建 P0：并行批次执行（Semaphore 限流 + 失败隔离）
│   └── config.py                # 修改：SubagentConfig 增加 agent_id 字段（agent 身份）
├── orchestration/               # 新建包（P1-P2 核心）
│   ├── __init__.py              # 导出公共 API
│   ├── config.py                # AgentSpec + OrchestrationConfig（模式/worker 注册表）
│   ├── handoff.py               # AgentHandoff 协议（from/to/task/context/result）
│   ├── inbox.py                 # AgentInbox（asyncio.Queue 消息传递 + 订阅）
│   ├── graph.py                 # OrchestratorGraph（LangGraph 多 agent 图构建器）
│   └── patterns.py              # orchestrator-workers / peer-consensus 两种模式
├── config/
│   ├── app_config.py            # 修改：AppConfig 增加 orchestration: OrchestrationConfig
│   └── orchestration_config.py  # 新建：Pydantic 配置段（mode/max_concurrency/workers/agents）
└── authz/
    └── principal.py             # 修改：增加 agent 维度属性（agent_id/agent_role）
tests/
├── test_subagent_batch.py       # P0
├── test_orchestration_config.py # P1
├── test_orchestration_handoff.py# P1
├── test_orchestration_graph.py  # P1
├── test_agent_inbox.py          # P2
├── test_orchestration_patterns.py # P2
└── test_agent_identity.py       # P3
config.example.yaml              # 修改：orchestration 示例段
```

## 既有资产（复用清单）

- `SubagentExecutor`（subagents/executor.py）：`_aexecute(task, result_holder)` async 执行、`execute()` 同步包装（isolated loop 防冲突）、`SubagentResult` 契约（status/result/error/stop_reason/token_usage）、`execute_async` 后台任务。
- `SubagentConfig`（subagents/config.py）：name/description/system_prompt/tools/disallowed_tools/skills/model/max_turns/timeout_seconds。
- `make_lead_agent`（agents/lead_agent/agent.py:537）：LangGraph Server 兼容图工厂，从 `RunnableConfig` 读 `subagent_enabled` 等 runtime 选项 —— 多 agent 模式开关沿用此模式。
- `TokenBudgetMiddleware.from_config`：已有 `agent_name` 参数（per-agent 配额 override）。
- `trace_id` 传播链：executor → subagent（`SubagentResult.trace_id`），P3 复用。
- `qilin.tools.builtins.task_tool`（task_tool.py:242）：lead → subagent 委派入口，P0 批处理与其并存（batch 是程序化 API，task_tool 是 LLM 触发入口）。

---

## P0: 并行批次执行层（subagents/batch.py）

### Task P0-1: batch 模块测试先行

**Files:**
- Create: `tests/test_subagent_batch.py`
- Create: `qilin/subagents/batch.py`

- [ ] **Step 1: 写失败测试**（fake executor 用 duck typing，仅暴露 `_aexecute`）

```python
"""Unit tests for qilin.subagents.batch (parallel batch execution)."""

import asyncio

import pytest

from qilin.subagents.batch import BatchTask, run_batch, run_batch_async
from qilin.subagents.executor import SubagentResult, SubagentStatus


class FakeExecutor:
    """Minimal duck-typed executor: only ``_aexecute`` is used by batch."""

    def __init__(self, *, delay: float = 0.0, fail: bool = False) -> None:
        self.delay = delay
        self.fail = fail

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
```

- [ ] **Step 2: 运行确认失败**（模块不存在）
  Run: `.venv/bin/pytest tests/test_subagent_batch.py -v`
  Expected: `ModuleNotFoundError: No module named 'qilin.subagents.batch'`

- [ ] **Step 3: 实现 `qilin/subagents/batch.py`**

```python
"""Parallel batch execution for subagents.

程序化并行入口，与 ``task_tool``（LLM 触发）互补：把多个独立子代理任务以有界
并发度并行执行，任一任务失败不影响其余任务（失败隔离），结果顺序与输入一致。
"""

import asyncio
from dataclasses import dataclass

from qilin.subagents.executor import SubagentResult, SubagentStatus


@dataclass
class BatchTask:
    """A single subagent task bound to its own executor.

    ``executor`` 独立实例（自带独立 trace_id），``task`` 为该实例执行的任务描述。
    """

    task: str
    executor: object  # duck-typed: 需要 async _aexecute(task, result_holder=None)


async def run_batch_async(tasks: list[BatchTask], *, max_concurrency: int = 3) -> list[SubagentResult]:
    """并行执行一批子代理任务。

    Args:
        tasks: 待执行任务（顺序即返回顺序）。
        max_concurrency: 并发上限（Semaphore 限流）。

    Returns:
        与输入同序的 SubagentResult 列表；异常任务转为 FAILED 状态而非抛出。
    """
    if max_concurrency < 1:
        raise ValueError("max_concurrency must be >= 1")

    semaphore = asyncio.Semaphore(max_concurrency)

    async def _run_one(item: BatchTask) -> SubagentResult:
        result = SubagentResult(
            task_id="", trace_id="", status=SubagentStatus.RUNNING
        )
        async with semaphore:
            try:
                return await item.executor._aexecute(item.task, result)
            except Exception as exc:  # 失败隔离：转 FAILED，不拖垮批次
                result.try_set_terminal(SubagentStatus.FAILED, error=str(exc))
                return result

    return list(await asyncio.gather(*(_run_one(t) for t in tasks)))


def run_batch(tasks: list[BatchTask], *, max_concurrency: int = 3) -> list[SubagentResult]:
    """同步包装：``asyncio.run`` 执行 :func:`run_batch_async`。

    注意：若调用方已处于运行中的事件循环（如 gateway 请求处理），请直接使用
    ``run_batch_async``。
    """
    return asyncio.run(run_batch_async(tasks, max_concurrency=max_concurrency))
```

- [ ] **Step 4: 全量测试通过**
  Run: `.venv/bin/pytest tests/test_subagent_batch.py -v`
  Expected: 全部 PASS

- [ ] **Step 5: Commit**
  Run: `git add -A && git commit -m "feat(p0): 子代理并行批次执行（Semaphore 限流 + 失败隔离）"`

### Task P0-2: 批处理边界与失败隔离测试

**Files:**
- Modify: `tests/test_subagent_batch.py`（追加 TestClass）

- [ ] **Step 1: 追加测试**：并发峰值 ≤ max_concurrency（用共享计数器）、结果顺序一致、失败任务转 FAILED 且不影响其他任务、空列表返回 []、max_concurrency<1 抛 ValueError、异常在 _aexecute 内被吞（FakeExecutor.fail 实际由 batch 兜底）。
- [ ] **Step 2: 运行全部通过** + `ruff check tests qilin/subagents/batch.py`
- [ ] **Step 3: Commit**

---

## P1: 编排层（orchestration 包）

### Task P1-1: 配置段 `orchestration_config.py`

**Files:**
- Create: `qilin/config/orchestration_config.py`
- Create: `tests/test_orchestration_config.py`
- Modify: `qilin/config/app_config.py`（AppConfig 增加 `orchestration: OrchestrationConfig` 字段，默认 single）

- [ ] **Step 1: 测试先行**：`mode` 枚举校验（single/multi）、`max_concurrency` 默认 3 且 ≥1 校验、`workers` 列表（AgentSpec：name/description/system_prompt/tools/model）round-trip、`enabled` 派生（mode == "multi"）。
- [ ] **Step 2: 实现**：

```python
"""Orchestration configuration (multi-agent mode)."""

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from qilin.subagents.config import SubagentConfig


class OrchestrationMode(StrEnum):
    SINGLE = "single"   # v1.0.0 行为：lead agent + task_tool 委派
    MULTI = "multi"     # v2.0.0：Orchestrator 图编排


class AgentSpec(BaseModel):
    """A participant agent in multi-agent orchestration.

    与 SubagentConfig 同构（运行时转为 SubagentConfig 交给 SubagentExecutor），
    额外携带 ``role`` 用于 P3 身份。
    """

    name: str = Field(min_length=1)
    description: str
    system_prompt: str | None = None
    tools: list[str] | None = None
    disallowed_tools: list[str] | None = None
    skills: list[str] | None = None
    model: str = "inherit"
    max_turns: int = 50
    timeout_seconds: int = 900
    role: str = "worker"  # orchestrator | worker | reviewer


class OrchestrationConfig(BaseModel):
    """AppConfig.orchestration 段。"""

    mode: OrchestrationMode = OrchestrationMode.SINGLE
    max_concurrency: int = Field(default=3, ge=1)
    workers: list[AgentSpec] = Field(default_factory=list)

    @property
    def enabled(self) -> bool:
        return self.mode == OrchestrationMode.MULTI

    def to_subagent_configs(self) -> dict[str, SubagentConfig]:
        """把 workers 转成 SubagentConfig 注册表（name -> config）。"""
        return {
            w.name: SubagentConfig(
                name=w.name,
                description=w.description,
                system_prompt=w.system_prompt,
                tools=w.tools,
                disallowed_tools=w.disallowed_tools,
                skills=w.skills,
                model=w.model,
                max_turns=w.max_turns,
                timeout_seconds=w.timeout_seconds,
            )
            for w in self.workers
        }

    @field_validator("workers")
    @classmethod
    def _unique_worker_names(cls, v: list[AgentSpec]) -> list[AgentSpec]:
        names = [w.name for w in v]
        if len(names) != len(set(names)):
            raise ValueError("worker names must be unique")
        return v
```

- [ ] **Step 3: 接入 AppConfig**：`orchestration: OrchestrationConfig = OrchestrationConfig()` 字段；`config.example.yaml` 增加示例段（注释掉的多 agent 示例）。config_version 31 → 32（`_check_config_version` 逻辑核对）。
- [ ] **Step 4: 测试 + ruff 通过 + Commit**

### Task P1-2: handoff 协议 `handoff.py`

**Files:**
- Create: `qilin/orchestration/handoff.py`
- Create: `tests/test_orchestration_handoff.py`

- [ ] **Step 1: 测试先行**：`AgentHandoff` dataclass（from_agent/to_agent/task/context/result 字段、无 result 时 to_dict 不含 result）、`HandoffError`、`HandoffResult` 类型（success/failure + payload）。
- [ ] **Step 2: 实现**：

```python
"""Handoff protocol: structured context transfer between agents.

一次 handoff 是 ``from_agent`` 把 ``task``（新任务或续做任务）连同
``context``（共享状态子集，如 sandbox/thread_data/trace_id）移交给
``to_agent``；完成后 ``result`` 写回。字段全部可选以兼容 v1 的
纯文本调用-返回。
"""

from dataclasses import dataclass, field
from typing import Any


@dataclass
class AgentHandoff:
    """Structured handoff request."""

    from_agent: str
    to_agent: str
    task: str
    context: dict[str, Any] = field(default_factory=dict)
    result: str | None = None  # 由 to_agent 回填

    def to_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {
            "from_agent": self.from_agent,
            "to_agent": self.to_agent,
            "task": self.task,
            "context": dict(self.context),
        }
        if self.result is not None:
            data["result"] = self.result
        return data


@dataclass
class HandoffResult:
    """Outcome of executing a handoff."""

    success: bool
    result: str | None = None
    error: str | None = None
    handoff: AgentHandoff | None = None


class HandoffError(RuntimeError):
    """Raised when a handoff cannot be delivered (unknown target, etc.)."""
```

- [ ] **Step 3: 测试 + ruff + Commit**

### Task P1-3: OrchestratorGraph `graph.py`

**Files:**
- Create: `qilin/orchestration/graph.py`
- Create: `tests/test_orchestration_graph.py`

- [ ] **Step 1: 测试先行**：`OrchestratorGraph.build` 返回 langgraph `CompiledStateGraph`；图状态 schema 含 messages + handoffs 通道；orchestrator 路由节点按 worker 注册表分派（DAG 拓扑校验：重复/未知 worker 名报错）。
- [ ] **Step 2: 实现（核心）**：

```python
"""OrchestratorGraph: build a LangGraph multi-agent graph.

拓扑：单一 orchestrator 节点 + N 个 worker 节点（每个 worker 由
SubagentExecutor 驱动）。orchestrator 每轮从 handoffs 通道读取待办
（AgentHandoff 列表），按 to_agent 路由到对应 worker；worker 完成后把
HandoffResult 写回 handoffs，orchestrator 决定继续分派或结束。
"""

from dataclasses import dataclass, field
from typing import Any, Literal

from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from typing_extensions import TypedDict

from qilin.orchestration.handoff import AgentHandoff, HandoffResult
from qilin.orchestration.config import AgentSpec


class OrchestrationState(TypedDict, total=False):
    messages: list[Any]
    handoffs: list[AgentHandoff]
    results: list[HandoffResult]
    max_rounds: int


@dataclass
class OrchestratorGraph:
    """Build and run a LangGraph orchestrator/workers graph.

    Attributes:
        workers: 参与编排的 worker 规格（name -> spec）。
        max_rounds: orchestrator 分派轮次上限（防死循环）。
        max_concurrency: worker 并行度（P0 batch 复用）。
    """

    workers: dict[str, AgentSpec]
    max_rounds: int = 10
    max_concurrency: int = 3

    def build(self) -> CompiledStateGraph:
        # 校验：worker 名唯一（由配置层保证）且非空
        if not self.workers:
            raise ValueError("OrchestratorGraph requires at least one worker")

        graph = StateGraph(OrchestrationState)
        graph.add_node("orchestrator", self._orchestrator_node)
        for name in self.workers:
            graph.add_node(name, self._make_worker_node(name))
        graph.add_edge(START, "orchestrator")
        graph.add_conditional_edges(
            "orchestrator",
            self._route,
            {**{name: name for name in self.workers}, "end": END},
        )
        for name in self.workers:
            graph.add_edge(name, "orchestrator")
        return graph.compile()
```

（`_orchestrator_node` 从 state 取 handoffs 分派；`_route` 返回 worker 名或 "end"；`_make_worker_node` 用 SubagentExecutor._aexecute 执行并把结果写回 results。）

- [ ] **Step 3: 测试 + ruff + Commit**

---

## P2: 协作模式（inbox + patterns）

### Task P2-1: AgentInbox `inbox.py`

**Files:**
- Create: `qilin/orchestration/inbox.py`
- Create: `tests/test_agent_inbox.py`

- [ ] **Step 1: 测试先行**：`AgentInbox` 注册 agent、`send(from,to,message)` → `receive(to)` 队列、`subscribe` 回调（多订阅者广播）、未注册收件人抛 `HandoffError`、`pending(to)` 计数、`close` 后发送抛错。
- [ ] **Step 2: 实现**（asyncio.Queue 每 agent 一队列 + 订阅者回调表 + 生命周期）。
- [ ] **Step 3: 测试 + ruff + Commit**

### Task P2-2: 协作模式 `patterns.py`

**Files:**
- Create: `qilin/orchestration/patterns.py`
- Create: `tests/test_orchestration_patterns.py`

- [ ] **Step 1: 测试先行**：
  - `orchestrator_workers`：orchestrator 把任务分发给 workers，收集全部结果（复用 P0 batch）；
  - `peer_consensus`：N 个 peer 各自产出观点，汇聚后取多数/综合（min_agreement 阈值逻辑）。
- [ ] **Step 2: 实现**：

```python
"""Collaboration patterns built on the orchestration primitives.

- orchestrator_workers: 单 orchestrator 分派 + worker 并行执行 + 结果聚合。
- peer_consensus: 对等 agent 各自产出，按阈值达成共识（辩论/评审场景）。
"""

from typing import Callable

from qilin.orchestration.config import AgentSpec
from qilin.subagents.batch import BatchTask, run_batch_async


async def orchestrator_workers(
    specs: list[AgentSpec],
    task: str,
    *,
    executor_factory: Callable[[AgentSpec], object],
    max_concurrency: int = 3,
):
    """分派同一任务给多个 worker 并行执行，返回 (spec.name -> result) 映射。"""


async def peer_consensus(
    specs: list[AgentSpec],
    task: str,
    *,
    executor_factory: Callable[[AgentSpec], object],
    min_agreement: float = 0.6,
    max_concurrency: int = 3,
):
    """并行收集观点，返回 (consensus_text, agreements, total) 三元组。"""
```

- [ ] **Step 3: 测试 + ruff + Commit**

---

## P3: 治理与可观测（agent 身份）

### Task P3-1: agent 身份扩展 `principal.py`

**Files:**
- Modify: `qilin/authz/principal.py`（`normalize_authz_attributes` 接受 `agent_id`/`agent_role`）
- Create: `tests/test_agent_identity.py`

- [ ] **Step 1: 测试先行**：attributes 携带 agent_id/agent_role 时保留；非法类型（非 str）报错；缺省时 None。
- [ ] **Step 2: 实现**：扩展 normalize 逻辑（agent 维度与 user 维度并存）。
- [ ] **Step 3: 测试 + ruff + Commit**

### Task P3-2: per-agent token 配额

**Files:**
- Modify: `qilin/agents/middlewares/token_budget_middleware.py`（读 `agent_name` 已支持——核对 per-agent override 路径）
- Modify: `tests/test_agent_identity.py`（追加配额解析测试）

- [ ] **Step 1: 核对现状**：TokenBudgetMiddleware 的 per-agent override 如何配置（agent_name 参数 + config 映射）；若有缺口（无 per-agent 映射）则补 `resolve_agent_token_budget(agent_name, app_config)`。
- [ ] **Step 2: 实现 + 测试**
- [ ] **Step 3: Commit**

### Task P3-3: 跨 agent trace 关联

**Files:**
- Modify: `qilin/orchestration/handoff.py`（context 强制携带 `trace_id`）
- Modify: `tests/test_orchestration_handoff.py`

- [ ] **Step 1: 测试**：handoff context 无 trace_id 时由父 trace 继承并写回（`HandoffResult` 携带 trace_id）。
- [ ] **Step 2: 实现**：handoff 创建时注入当前 `qilin_trace_id`（复用 `trace_context`）。
- [ ] **Step 3: 测试 + ruff + Commit**

---

## 配置切换（最终交付）

### Task CFG-1: make_lead_agent 模式分支

**Files:**
- Modify: `qilin/agents/lead_agent/agent.py`（`_make_lead_agent` 增加 multi 分支）
- Create: `tests/test_mode_switch.py`

- [ ] **Step 1: 测试**：`orchestration.mode == "multi"` 且配置了 workers 时，`make_lead_agent` 构建 OrchestratorGraph（断言返回 CompiledStateGraph 且包含 orchestrator 节点）；`mode == "single"`（默认）时行为与 v1 完全一致。
- [ ] **Step 2: 实现**：`_make_lead_agent` 读 `resolved_app_config.orchestration`；`enabled and workers` → 用 OrchestratorGraph 包装（orchestrator 节点复用现有 lead 逻辑，worker 用 SubagentExecutor）；否则走现有路径。runtime config 可临时覆盖 mode（`cfg.get("orchestration_mode")`）。
- [ ] **Step 3: 测试 + ruff + Commit**

### Task CFG-2: 文档与示例

- [ ] **Step 1**: `config.example.yaml` 增加 orchestration 示例段（single 默认 + 注释掉的多 agent 示例）；`docs/modules/` 新增 `orchestration.md`（双语，按实际实现写）；README 核心能力表补一行。
- [ ] **Step 2**: 文档引用校验（脚本扫描 `code` 引用）0 未解析。
- [ ] **Step 3: Commit**

---

## 收尾验证

### Task FIN-1: 全量验证

- [ ] `ruff check .` → All checks passed
- [ ] `.venv/bin/pytest tests -v` → 全部 PASS（旧 54 + 新增）
- [ ] `python -m compileall -q qilin app` → OK
- [ ] Commit: `chore: 全量验证通过，v2.0.0 多智能体框架改造完成`

### Task FIN-2: 版本路线文档更新

- [ ] RELEASE_NOTES_v1.0.0.md 版本路线表：v2.0.0 状态 规划中 → 开发中/已完成
- [ ] Commit
