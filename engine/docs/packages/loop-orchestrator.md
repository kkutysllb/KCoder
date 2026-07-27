# @qiongqi/loop：Durable Engine 与治理图编排

> v1.1.1。实现公共 facade、immutable graph compiler、evented_v2 编排、隔离 Kernel、graph governance、stream 和实时 ROI。

## 公共入口

| API/组件 | 职责 |
|---|---|
| `compileAgentGraph` | 规范化兼容 graph、稳定 edge id、canonical digest 和迁移诊断 |
| `createEngine` / `DurableEngine` | graph publish/start/inspect、resume/cancel、checkpoint/circuit、stream、cost/value |
| `EventedV2MultiAgentRuntime` | node/edge、handoff、join/retry、mailbox/outbox 和 child lifecycle |
| `DeterministicNodeRunner` | tool/judge/handoff/join/wait/retry/terminate 的确定性决策 |
| `KernelAgentExecutor` | 隔离 AgentRun、父预算 reservation、实际 usage settlement、completion outbox |
| `RootRunAggregateCoordinator` | GraphRun/root EngineRun 同 ID、同版本原子创建、推进、取消、完成与迁移 |
| `DurableAgentDispatchWorker` | claim/renew/fence dispatch intent，通过 `inputRef` 恢复并复用 prepared identity |
| `GraphGovernor` | human checkpoint、resource claim、circuit 和 pinned revision 校验 |
| `evaluateGraphReadiness` | 以 evidence 计算 `draft`/`observe`/`assisted`/`autonomous` |
| `WorkGraphProjector` | intended/executed graph、attempt、fan-out、retry 和 critical path |
| `ExecutionLedgerService` | model/tool logical/physical attempt 去重与恢复 |
| `EngineStreamPublisher` | durable append/read/ack 和 reasoning policy |
| `EngineValueLedger` | cost/value、graph attribution、ROI 和 efficiency |
| `ModelProfileRegistry` | profile 注册、授权、capability negotiation 和 provider 解析 |

## Governed graph 示例

```ts
const revision = compileAgentGraph(graph, { revision: 1, publishedAt: now })
await engine.publishGraph(revision)
const started = await engine.start({
  scope,
  threadId,
  turnId,
  workspaceKey,
  prompt,
  modelPolicy,
  graphRef: { graphId: revision.graphId, revision: revision.revision },
  budgetLimits: {
    stepsUsed: 100,
    toolCallsUsed: 40,
    inputTokens: 200_000,
    outputTokens: 40_000,
    costUsd: 25
  }
})

const inspection = await engine.inspect(started.multiAgentRunId)
await engine.setGraphCircuit(started.multiAgentRunId, 'report_only')
```

`start()` 在 root aggregate 与初始 `agent_execution_requested` intent 完成 durable preparation 后返回，不等待模型完成。本地 notify 是低延迟优化；本地和远程 worker 都必须通过 `DurableAgentDispatchWorker` 的同一 claim handler。`KernelAgentExecutor` 只消费预生成 identity/reservation，不生成替代 KernelRun 或重复预留。

若 v1.1.0 留下 graph-only run，loader 和 `inspect()` 会以 `ROOT_RUN_AGGREGATE_INCOMPLETE` fail closed。调用方审计 durable facts 并提供 limits 后，显式调用 `migrateGraphOnlyRun({ runId, budgetLimits })`；terminal run 只修复、不 dispatch。

## 不变量

- graph run、governance 操作和恢复必须匹配 `(graphId, revision, digest)`。
- evented_v2 推进父图；Kernel completion 只通过 durable outbox 返回。
- root GraphRun/EngineRun 必须在同一 transaction 使用相同 ID 和版本；任何 partial/diverged aggregate fail closed。
- 根预算按 settled actual + active requested + new requested 累计校验；released reservation 不占用额度。
- completed operation replay 已提交结果；uncertain effect 等待验证，不自动重复调用。
- human checkpoint token 单次消费；write claim 必须 fence；自动 circuit 不降低严重度。
- stream 以 `(streamId, seq)` 去重；ROI 和 usage 可附 graph/node/edge/attempt attribution。
- governed `start()` 强制调用方 `budgetLimits`；不带 `graphRef` 的形状仅保留 v1.0 兼容。
- model profile 和 policy 全由调用方注册/选择；引擎没有 provider/model fallback。
