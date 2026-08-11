# orchestration 模块（orchestration module）

> QiLin engine · multi-agent orchestration subsystem · 双语 / Bilingual

---

## 中文版

### 职责

`qilin.orchestration` 是 v2.0.0 多智能体编排层：在 v1 单智能体（lead agent +
`task_tool` 委派）之上，提供程序化的并行执行、handoff 协议、编排图、agent 消息
总线与协作模式。**运行形态由 `orchestration.mode` 配置选择**：`single`（默认，
v1.0.0 行为完全不变）或 `multi`（OrchestratorGraph 编排）。

编排栈（自底向上）：

- **`subagents/batch`**（P0）：`run_batch_async` 有界并发执行一批独立子代理任务，
  失败隔离 + 保序返回
- **`orchestration/handoff`**（P1）：`AgentHandoff`（from/to/task/context/result）
  结构化上下文转移协议，`HandoffResult` 结果回填，`HandoffError` 投递失败
- **`orchestration/graph`**（P1）：`OrchestratorGraph`——单一 orchestrator 节点 +
  N 个 worker 节点的 LangGraph 编排图，按 `to_agent` 路由、`max_rounds` 防死循环
- **`orchestration/inbox`**（P2）：`AgentInbox` 每 agent 一个 `asyncio.Queue` 的
  消息总线，`subscribe` 订阅广播，用于对等通信
- **`orchestration/patterns`**（P2）：`orchestrator_workers`（同任务并行分派 +
  结果聚合）与 `peer_consensus`（对等观点汇聚，成功率阈值达成共识）

### 关键文件

| 文件 | 作用 |
|------|------|
| `config/orchestration_config.py` | `OrchestrationMode` / `AgentSpec` / `OrchestrationConfig`（Pydantic 配置段） |
| `subagents/batch.py` | 并行批次执行：`BatchTask` / `run_batch_async` / `run_batch` |
| `orchestration/handoff.py` | handoff 协议 + `inherit_trace_id`（trace 关联） |
| `orchestration/graph.py` | `OrchestratorGraph`：LangGraph 编排图构建器 |
| `orchestration/inbox.py` | `AgentInbox` 消息总线（队列 + 订阅广播） |
| `orchestration/patterns.py` | orchestrator-workers / peer-consensus 协作模式 |
| `agents/lead_agent/agent.py` | `_build_orchestrator_graph`：multi 模式分支（模式切换入口） |

### 设计要点

1. **配置选择单/多 agent**：`orchestration.mode: single | multi`。`multi` 且
   `workers` 非空时 `make_lead_agent` 构建 OrchestratorGraph，否则完全走 v1 路径；
   单次请求可用 runtime `orchestration_mode` 临时覆盖（非法值回退配置默认）。
   模式切换属图结构变更，已在 `reload_boundary` 注册为 **startup-only**（需重启）。
2. **LangGraph 通道贯穿**：状态 schema 为 `total=False` TypedDict，orchestrator 节点
   的所有返回分支都显式携带 `results` 键，保证结果通道在最终 state 中始终存在。
3. **失败隔离**：batch 层单任务异常转 `FAILED` 不拖垮批次；graph 层 worker 异常转
   `HandoffResult(success=False)`；inbox 订阅者回调异常不影响投递与其他订阅者。
4. **可观测**：`AgentHandoff.inherit_trace_id` 把父 `qilin_trace_id` 注入 context
   （显式指定优先），`HandoffResult.trace_id` 回填，跨 agent 一条 trace 贯穿；
   `authz/principal.py` 的 `normalize_agent_identity` 为授权提供 agent 维度身份。
5. **配额治理**：`TokenBudgetConfig.per_agent` 提供 per-agent 配额 override，
   `resolve_agent_token_budget(agent_name, config)` 未配置时回退全局限制。

### 配置示例

```yaml
orchestration:
  mode: single          # single（v1 委派）| multi（编排图）
  max_concurrency: 3    # multi 模式并行执行上限
  # workers:            # multi 模式必须至少配置一个 worker
  #   - name: coder
  #     description: 编写代码的 worker
  #     system_prompt: You are a coding worker.
  #     tools: [read_file, bash]
  #     disallowed_tools: [task]
  #     model: inherit
  #     max_turns: 80

token_budget:
  enabled: false
  max_tokens: 200000
  # per_agent:          # per-agent 配额 override（多 agent 模式）
  #   coder:
  #     enabled: true
  #     max_tokens: 50000
```

### 关联模块

- **上游**：`config/orchestration_config.py`（配置段）、`subagents/config.py`
  （`AgentSpec.to_subagent_configs` 复用 `SubagentConfig`）、`subagents/executor.py`
  （`SubagentExecutor` 作为 worker 执行器）
- **下游**：`agents/lead_agent/agent.py`（模式切换入口）、`authz/principal.py`
  （agent 身份）、`config/token_budget_config.py`（per-agent 配额）、
  `trace_context.py`（`qilin_trace_id` 注入）

---

## English Version

### Responsibility

`qilin.orchestration` is the v2.0.0 multi-agent orchestration layer: on top of the
v1 single-agent runtime (lead agent + `task_tool` delegation) it adds programmatic
parallel execution, a handoff protocol, an orchestration graph, an agent message
bus, and collaboration patterns. **The runtime shape is chosen by
`orchestration.mode`**: `single` (default; v1.0.0 behavior unchanged) or `multi`
(OrchestratorGraph orchestration).

The stack (bottom-up):

- **`subagents/batch`** (P0): `run_batch_async` executes independent subagent tasks
  with bounded concurrency, failure isolation, and order-preserving results
- **`orchestration/handoff`** (P1): `AgentHandoff` (from/to/task/context/result)
  structured context transfer; `HandoffResult` backfills results; `HandoffError`
  signals delivery failure
- **`orchestration/graph`** (P1): `OrchestratorGraph` — a LangGraph orchestration
  graph with one orchestrator node + N worker nodes, routed by `to_agent`, with
  `max_rounds` guarding against infinite loops
- **`orchestration/inbox`** (P2): `AgentInbox` message bus — one `asyncio.Queue`
  per agent plus subscription broadcast, for peer-to-peer communication
- **`orchestration/patterns`** (P2): `orchestrator_workers` (parallel dispatch of
  the same task + result aggregation) and `peer_consensus` (peer opinions merged
  by a success-rate threshold)

### Key Files

| File | Responsibility |
|------|----------------|
| `config/orchestration_config.py` | `OrchestrationMode` / `AgentSpec` / `OrchestrationConfig` (Pydantic config section) |
| `subagents/batch.py` | Parallel batch execution: `BatchTask` / `run_batch_async` / `run_batch` |
| `orchestration/handoff.py` | Handoff protocol + `inherit_trace_id` (trace correlation) |
| `orchestration/graph.py` | `OrchestratorGraph`: LangGraph orchestration graph builder |
| `orchestration/inbox.py` | `AgentInbox` message bus (queues + subscription broadcast) |
| `orchestration/patterns.py` | orchestrator-workers / peer-consensus collaboration patterns |
| `agents/lead_agent/agent.py` | `_build_orchestrator_graph`: the multi-mode branch (mode switch entry) |

### Design Points

1. **Config-driven single/multi**: `orchestration.mode: single | multi`. With
   `multi` and a non-empty `workers`, `make_lead_agent` builds the
   OrchestratorGraph; otherwise the v1 path is untouched. A per-request runtime
   `orchestration_mode` override is honored (invalid values fall back to the
   configured default). Switching modes rebuilds the graph, so the section is
   registered as **startup-only** in `reload_boundary`.
2. **Channel continuity**: the state schema is a `total=False` TypedDict; every
   orchestrator return branch carries the `results` key explicitly so the results
   channel always exists in the final state.
3. **Failure isolation**: batch turns single-task exceptions into `FAILED`
   results; graph turns worker exceptions into `HandoffResult(success=False)`;
   inbox subscriber exceptions never block delivery or other subscribers.
4. **Observability**: `AgentHandoff.inherit_trace_id` injects the parent
   `qilin_trace_id` into the context (explicit values win), and
   `HandoffResult.trace_id` carries it back — one trace across agents.
   `normalize_agent_identity` in `authz/principal.py` adds an agent dimension to
   authorization attributes.
5. **Quota governance**: `TokenBudgetConfig.per_agent` provides per-agent budget
   overrides; `resolve_agent_token_budget(agent_name, config)` falls back to the
   global limits for unlisted agents.

### Configuration Example

```yaml
orchestration:
  mode: single          # single (v1 delegation) | multi (orchestration graph)
  max_concurrency: 3    # parallel execution cap in multi mode
  # workers:            # multi mode requires at least one worker
  #   - name: coder
  #     description: A worker that writes code
  #     system_prompt: You are a coding worker.
  #     tools: [read_file, bash]
  #     disallowed_tools: [task]
  #     model: inherit
  #     max_turns: 80

token_budget:
  enabled: false
  max_tokens: 200000
  # per_agent:          # per-agent budget override (multi-agent mode)
  #   coder:
  #     enabled: true
  #     max_tokens: 50000
```

### Related Modules

- **Upstream**: `config/orchestration_config.py` (config section),
  `subagents/config.py` (`AgentSpec.to_subagent_configs` reuses `SubagentConfig`),
  `subagents/executor.py` (`SubagentExecutor` drives workers)
- **Downstream**: `agents/lead_agent/agent.py` (mode switch entry),
  `authz/principal.py` (agent identity), `config/token_budget_config.py`
  (per-agent quotas), `trace_context.py` (`qilin_trace_id` injection)
