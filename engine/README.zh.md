# Qiongqi · 穷奇

**Durable Engine v1.1.4 | 纯引擎代码 | 模型无关 | 可恢复治理图执行**

Qiongqi 是领域中立的 Agent 引擎 monorepo，只提供执行、状态、存储、模型/工具适配和 HTTP/SSE 契约。它不包含产品级 UI、业务判断、固定 Agent 或默认模型。下游可注册任意 provider 和多个 model profile，并按任务策略或 graph node policy 切换模型。

## v1.1.4 架构

```text
immutable GraphRevision
  -> evented_v2 orchestration plane
       -> deterministic node/edge traversal + durable parallel/join
       -> approval / resource claim / circuit / readiness governance
       -> isolated AgentRun
            -> Kernel execution plane
                 -> model/tool/context/memory ledgers
                 -> checkpoint, usage, cost, outcome and completion outbox
```

`evented_v2` 是跨 Agent 的唯一编排平面，Kernel 是单个 AgentRun 的隔离执行平面。两者不是可选 runner。Graph run 固定到 `(graphId, revision, graphDigest)`；恢复、审批和手工 circuit 操作都重新加载这个 revision，不跟随后续发布漂移。Governed root 的 `GraphRunRecord` 与 `EngineRunRecord` 共享 run ID、版本和事务边界，任何缺失或分歧都 fail closed。

## 核心能力

- **版本化治理图**：`compileAgentGraph()` 生成 canonical digest，`publishGraph()` 持久化 immutable revision；agent、parallel、tool、judge、join、wait、retry 和 terminate node 共用确定性 traversal。
- **完整图策略**：公开九类 node 都接受 `nodePolicyRef`，edge 接受 `edgePolicyRef`；编译后策略保真并进入 `graphDigest`，但不改变逻辑 edge ID。
- **Durable parallel/join**：一个 `parallel` 可原子生成三个或更多独立 branch cursor；分支可乱序完成，`join` 始终按稳定 branch ID 生成非空结果，并支持 `wait_all` 与 `fail_fast`。
- **真实执行图**：intended graph 与实际 `WorkGraphEvent` 分离记录，可追踪 node/edge attempt、fan-out、retry、suppression 和 critical path。
- **重复调用抑制**：模型请求和工具 effect 进入 durable ledger；completed replay、semantic suppression 和 uncertain fail-closed 避免崩溃后静默重发。
- **上下文与长任务**：`TaskCheckpoint`、`ContextCheckpoint` 和结构化 progress state 先于摘要持久化；恢复不会把压缩摘要当唯一事实。
- **任务级记忆隔离**：`task_shared` 只在任务内共享，`agent_private` 只对指定 AgentRun 可见，跨边界必须显式 publish。
- **生产治理**：human checkpoint 使用单次 resolution token；write resource claim 必须 fenced；circuit 支持 `running`、`report_only`、`paused`、`retired`；readiness 为 `draft`、`observe`、`assisted`、`autonomous`。
- **Prepare-first dispatch**：先原子持久化 AgentRun/KernelRun identity、父预算 reservation 和 dispatch intent，再由本地或远程 worker 通过同一 fenced handler claim；崩溃恢复始终复用原 identity。
- **权威 dispatch 恢复**：新 intent 写入 `schemaVersion: 3`；worker 继续读取 v1/v2，但在 Kernel 执行前从 durable root、GraphRun、固定 revision 与 AgentRun 重建 thread/turn/workspace/graph/policy 上下文并拒绝矛盾 payload。
- **累计根预算**：调用方必须为 governed run 提供根限制；引擎按“已结算实际用量 + 活跃预留请求量 + 新请求量”原子判定，不允许顺序 child 绕过总预算。
- **模型无关**：profile 固定 provider/model/capability revision，任务 policy 可授权多个 profile，node 可引用独立 model policy；凭证只用 `credentialRef`，没有 `deepseek-chat` 或任何厂商隐式默认值。
- **真实实时流**：模型 delta、工具进度、branch lifecycle、work graph、checkpoint、usage、ROI 和 outcome 进入可回放 stream。生产 `kernel_v3` HTTP 组合在 provider 完成前就发布 assistant delta，持久化供 thread SSE 断线续传，并用稳定物理 attempt identity 与最终 item 收敛。
- **实时 ROI 与效率**：`recordCost()` / `recordValue()` 发布 `roi.snapshot`；可按 graph/node/edge/branch 归因 cost/value，`byBranch` 与根总量实时对账。业务 ROI 与引擎效率分开呈现。
- **Governed Turn/HTTP 出口**：严格的 `StartTurnRequest.governedExecution` 持久化显式 task scope、graph revision、预算和模型策略；可选注入 `{ engine, store }` 后即可通过官方 HTTP 启动、恢复、推进和取消 governed run。

## 快速开始

要求 Node.js 20+、pnpm 10+。

```bash
pnpm install
pnpm run prepare:sqlite
pnpm run verify:sqlite
pnpm typecheck
pnpm test
pnpm run build:clean
```

生产多实例必须使用 PostgreSQL durable store；SQLite 和 in-memory 仅适合开发、单进程验证或 conformance。

## 最小 governed graph API

```ts
const engine = createEngine({ store, modelRegistry, kernelExecutor })
const revision = compileAgentGraph(agentGraph, {
  revision: 1,
  publishedAt: new Date().toISOString()
})

await engine.publishGraph(revision)
const run = await engine.start({
  scope: { ownerId, workspaceId, taskId },
  threadId,
  turnId,
  workspaceKey,
  prompt,
  modelPolicy: {
    authorizedProfileIds: ['primary', 'fast'],
    preferredProfileId: 'primary',
    capabilityMode: 'strict'
  },
  graphRef: { graphId: revision.graphId, revision: revision.revision },
  budgetLimits: {
    stepsUsed: 100,
    toolCallsUsed: 40,
    inputTokens: 200_000,
    outputTokens: 40_000,
    costUsd: 25
  }
})

await engine.inspect(run.multiAgentRunId)
await engine.subscribe(run.streamId, 'consumer-1', 0)
await engine.ack(run.streamId, 'consumer-1', 42)
await engine.recordCost(costEntry)
await engine.recordValue(valueEvent)
```

Governed `start()` 在 root aggregate 和首次 durable dispatch 已准备完成后返回，不等待模型完成；后续进度从 durable stream 获取。不带 `graphRef` 的 `start()` 仅保留 v1.0 兼容路径。调用方必须显式配置可用模型 profile 和任务 policy；引擎没有默认 provider 或 model。

## Durable parallel 示例

```ts
const graph = {
  version: 1,
  graphId: 'report',
  startNodeId: 'manager',
  nodes: [
    { id: 'manager', kind: 'agent', agentId: 'manager' },
    {
      id: 'fan_out', kind: 'parallel', joinNodeId: 'join_all', failurePolicy: 'wait_all',
      branches: [
        { branchId: 'draft', startNodeId: 'writer' },
        { branchId: 'research', startNodeId: 'researcher' },
        { branchId: 'review', startNodeId: 'reviewer' }
      ]
    },
    { id: 'writer', kind: 'agent', agentId: 'writer' },
    { id: 'researcher', kind: 'agent', agentId: 'researcher' },
    { id: 'reviewer', kind: 'agent', agentId: 'reviewer' },
    {
      id: 'join_all', kind: 'join', sourceParallelNodeId: 'fan_out',
      requiredBranchIds: ['draft', 'research', 'review'], outputPolicy: 'all'
    },
    { id: 'done', kind: 'terminate' }
  ],
  edges: [
    { from: 'manager', to: 'fan_out', condition: 'completed' },
    { from: 'writer', to: 'join_all', condition: 'completed' },
    { from: 'researcher', to: 'join_all', condition: 'completed' },
    { from: 'reviewer', to: 'join_all', condition: 'completed' },
    { from: 'join_all', to: 'done', condition: 'completed' }
  ]
}

// manager completion 已把 root coordinator 推进到 join_all，并创建三个 queued branch。
await engine.dispatchParallelAgents({
  multiAgentRunId,
  prompt,
  requestedBudgets: { draft: branchBudget, research: branchBudget, review: branchBudget }
})
```

start node 必须是 `agent`。manager completion 进入 `fan_out` 后，`requestedBudgets` 必须覆盖每个待 dispatch 的 branch，预算由调用方逐分支授权。完成顺序不影响 join 输出：`JoinResult.branches` 按 branch ID 稳定排序。`fail_fast` 会 durable abort 未完成 sibling 并写取消 intent；迟到结果只生成 `branch_late_result` 审计，不改变终态或再次推进 join。

## 文档

| 主题 | 文档 |
|---|---|
| 架构、生命周期、治理和 graph ROI | [docs/architecture.zh.md](./docs/architecture.zh.md) |
| PostgreSQL、readiness、流式和发布门禁 | [docs/deployment.zh.md](./docs/deployment.zh.md) |
| v1.0 到 v1.1 迁移与回滚 | [docs/migrations/engine-v1.1.md](./docs/migrations/engine-v1.1.md) |
| v1.1.4 发布说明 | [docs/releases/v1.1.4.md](./docs/releases/v1.1.4.md) |
| 18 个 workspace 包说明 | [docs/packages/README.md](./docs/packages/README.md) |

初次迁移到 durable v1 的项目先阅读 [engine-v1.md](./docs/migrations/engine-v1.md)。
