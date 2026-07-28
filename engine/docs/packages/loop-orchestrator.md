# @qiongqi/loop：Durable Engine 与治理图编排

> v1.1.4。实现公共 facade、immutable graph compiler、evented_v2 durable parallel/join、隔离 Kernel、graph governance、stream 和实时 ROI。

## 公共入口

| API/组件 | 职责 |
|---|---|
| `compileAgentGraph` | 规范化兼容 graph、稳定 edge id、canonical digest 和迁移诊断 |
| `createEngine` / `DurableEngine` | graph publish/start/inspect、resume/cancel、checkpoint/circuit、stream、cost/value |
| `EventedV2MultiAgentRuntime` | root/branch cursor、parallel/join、handoff/retry、mailbox/outbox 和 child lifecycle |
| `DeterministicNodeRunner` | tool/judge/handoff/join/wait/retry/terminate 的确定性决策 |
| `KernelAgentExecutor` | 隔离 AgentRun、父预算 reservation、实际 usage settlement、completion outbox |
| `RootRunAggregateCoordinator` | GraphRun/root EngineRun 同 ID、同版本原子创建、推进、branch/root 取消、完成与迁移 |
| `DurableAgentDispatchWorker` | claim/renew/fence dispatch intent，从 durable root/revision/AgentRun 权威恢复上下文并复用 prepared identity |
| `KernelV3TurnRunner.runTurnDetailed` | 返回终态/暂停状态及物理 Turn 的 persisted Kernel `BudgetState` |
| `GraphGovernor` | human checkpoint、resource claim、circuit 和 pinned revision 校验 |
| `evaluateGraphReadiness` | 以 evidence 计算 `draft`/`observe`/`assisted`/`autonomous` |
| `WorkGraphProjector` | intended/executed graph、attempt、fan-out、retry 和 critical path |
| `ExecutionLedgerService` | model/tool logical/physical attempt 去重与恢复 |
| `EngineStreamPublisher` | durable append/read/ack 和 reasoning policy |
| `EngineValueLedger` | cost/value、graph attribution、ROI 和 efficiency |
| `ModelProfileRegistry` | profile 注册、授权、capability negotiation 和 provider 解析 |
| `parallel-branch-state` | branch spawn/advance/settle/abort、active-node projection、join readiness/result |

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

Public continuation APIs include `flushAgentDispatches()`、`dispatchActiveAgent()`、`dispatchParallelAgents()` 和 `consumeKernelCompletion()`。`dispatchParallelAgents()` 要求调用方提供精确的 `requestedBudgets[branchId]`；每个 branch 的 identity/reservation/intent 在一个 root commit 中准备。乱序 completion 按稳定 execution identity 消费，join output 按 branch ID 排序。

`start()` 在 root aggregate 与初始 `agent_execution_requested` intent 完成 durable preparation 后返回，不等待模型完成。本地 notify 是低延迟优化；本地和远程 worker 都必须通过 `DurableAgentDispatchWorker` 的同一 claim handler。`KernelAgentExecutor` 只消费预生成 identity/reservation，不生成替代 KernelRun 或重复预留。

当前 writer 总是生成 dispatch schema v3。Agent/Judge node 的 `nodePolicyRef`、`modelPolicyRef` 与 `executionPolicyRef` 会进入原子 prepared intent；worker 从固定 revision 权威重建并校验这些引用。schema v1/v2 仅用于兼容 drain。单分支与 parallel fan-out 都使用同一规则。

## Turn policy enforcement 与详细结果

Classic、evented_v2 和 kernel_v3 的 prompt/tool 构建共享 Turn 上的 immutable execution policy。work-mode skill 范围与产品 allow-list 取交集；required skill 不可用时在模型调用前失败。产品 tool allow-list 直接进入 `ToolHostContext.allowedToolNames`，空数组保持 deny all；仅 policy-less Turn 可以使用旧的 goal/todo/GUI 工具自动扩展。

Kernel v3 提供两个兼容入口：

```ts
const status = await runtime.runTurn(threadId, turnId)
const detailed = await runtime.runTurnDetailed(threadId, turnId)
// detailed.status
// detailed.budget.toolCallsUsed  // 来自 persisted RunStateV3，不是产品估算值
// detailed.modelUsage           // 当前 thread 的模型 usage snapshot
```

`KernelV3TurnRunner.runTurn()` 委托 `runTurnDetailed()` 后只返回 status。详细预算从执行结束后的 `RunSnapshotStore` 加载，包含 `stepsUsed`、幂等去重后的 `toolCallsUsed`、input/output tokens 和 cost。ServerRuntime 在非 kernel_v3 模式下会明确拒绝详细 Kernel 结果，而不是返回伪造的零值。

`ModelProposalRunner` 在首个 chunk 前确定 `proposalId`，并将它随每个 delta 交给 composition callback。生产 HTTP 组合用 `item_kernel_text_<proposalId>` / `item_kernel_reasoning_<proposalId>` 写 RuntimeEvent；最终 materialization 复用同一 ID，SSE live/replay 均只收敛成一个 item。durable ledger replay 不重复发布，独立模型 step/retry 使用独立 ID；usage 仍在成功持久化 proposal 后精确入账一次，流式字符不参与 ROI 估算。

若 v1.1.0 留下 graph-only run，loader 和 `inspect()` 会以 `ROOT_RUN_AGGREGATE_INCOMPLETE` fail closed。调用方审计 durable facts 并提供 limits 后，显式调用 `migrateGraphOnlyRun({ runId, budgetLimits })`；terminal run 只修复、不 dispatch。

## 不变量

- graph run、governance 操作和恢复必须匹配 `(graphId, revision, digest)`。
- evented_v2 推进父图；Kernel completion 只通过 durable outbox 返回。
- root GraphRun/EngineRun 必须在同一 transaction 使用相同 ID 和版本；任何 partial/diverged aggregate fail closed。
- 根预算按 settled actual + active requested + new requested 累计校验；released reservation 不占用额度。
- completed operation replay 已提交结果；uncertain effect 等待验证，不自动重复调用。
- human checkpoint token 单次消费；write claim 必须 fence；自动 circuit 不降低严重度。
- stream 以 `(streamId, seq)` 去重；ROI 和 usage 可附 graph/node/edge/attempt attribution。
- branch lifecycle 带 `branchId` 进入 root stream；ROI 可附 branch attribution 并在 `byBranch` 中实时聚合。
- `wait_all` 等待全部 terminal branch；`fail_fast` durable abort sibling。late result 只审计，不重开 branch 或重复 join。
- governed `start()` 强制调用方 `budgetLimits`；不带 `graphRef` 的形状仅保留 v1.0 兼容。
- model profile 和 policy 全由调用方注册/选择；引擎没有 provider/model fallback。
- output validator 在 Turn 完成边界 fail closed；runner 必须采用 `finishTurn()` 返回的有效终态。
