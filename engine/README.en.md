# Qiongqi Durable Engine

**Durable Engine v1.1.4 | engine-only | model-neutral | governed graph execution**

Qiongqi is a domain-neutral Agent engine monorepo. It provides execution, state, storage, model/tool adapters, and HTTP/SSE contracts without product UI, business decisions, fixed Agents, or a default model. Downstream products may register any provider and multiple model profiles, then select them by task policy or graph-node policy.

## v1.1.4 architecture

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

`evented_v2` is the only cross-Agent orchestration plane. Kernel is the isolated execution plane for one AgentRun; they are not alternative runners. Every graph run is pinned to `(graphId, revision, graphDigest)`, including recovery and governance operations. A governed root `GraphRunRecord` and `EngineRunRecord` share one run ID, version, and transaction boundary; missing or divergent projections fail closed.

## Core capabilities

- **Versioned governed graphs**: `compileAgentGraph()` creates a canonical digest and `publishGraph()` persists an immutable revision with deterministic agent, parallel, tool, judge, join, wait, retry, and terminate traversal.
- **Policy-complete compilation**: every public node accepts `nodePolicyRef`, every edge accepts `edgePolicyRef`, and both survive normalization and participate in `graphDigest` without changing logical edge identity.
- **Durable parallel/join**: one `parallel` atomically creates three or more independent branch cursors; branches may finish out of order, while `join` always produces a stable non-empty result under `wait_all` or `fail_fast`.
- **Executed work graph**: intended topology and actual `WorkGraphEvent` history are distinct, exposing node/edge attempts, fan-out, retries, suppression, and the executed critical path.
- **Duplicate suppression**: durable model/tool ledgers replay completed operations, suppress semantic duplicates, and fail closed for crash-uncertain effects.
- **Long-task continuity**: `TaskCheckpoint`, `ContextCheckpoint`, and structured progress state are persisted before summaries. Compacted prose is never the only recovery fact.
- **Task memory isolation**: `task_shared` stays within a task; `agent_private` stays within one AgentRun unless explicitly published.
- **Production governance**: single-use human approval tokens, fenced write claims, `running`/`report_only`/`paused`/`retired` circuits, and evidence-based `draft`/`observe`/`assisted`/`autonomous` readiness.
- **Prepare-first dispatch**: AgentRun/KernelRun identity, parent reservation, and dispatch intent commit before either a local or remote worker claims the same fenced handler. Recovery always reuses the prepared identity.
- **Authoritative dispatch recovery**: new work is written as dispatch `schemaVersion: 3`; workers still read v1/v2 but rebuild thread, turn, workspace, graph, AgentRun, and policy context from durable root facts before Kernel execution.
- **Cumulative root budgets**: callers must authorize governed-run limits. Storage atomically checks settled actual usage plus active requested reservations plus the new request.
- **Model neutrality**: immutable provider/model/capability profiles, multi-profile task policies, and node-specific model-policy references. Credentials use `credentialRef`; no vendor or `deepseek-chat` fallback exists.
- **Real streaming**: model deltas, tool progress, branch lifecycle, work-graph events, checkpoints, usage, ROI, and outcomes use replayable streams. The production `kernel_v3` HTTP composition publishes assistant deltas before provider completion, persists them for thread SSE replay, and converges them with the final item by stable physical-attempt identity.
- **Live ROI and efficiency**: `recordCost()` / `recordValue()` publish `roi.snapshot` and attribute cost/value by graph, node, edge, and branch. Root totals and `byBranch` reconcile in real time. Business ROI remains separate from engine efficiency.
- **Governed Turn/HTTP facade**: strict `StartTurnRequest.governedExecution` persists explicit task scope, graph revision, budgets, and model policy. Optional `{ engine, store }` injection exposes graph/run lifecycle routes and crash-gap-safe Turn binding.

## Quick start

Requirements: Node.js 20+ and pnpm 10+.

```bash
pnpm install
pnpm run prepare:sqlite
pnpm run verify:sqlite
pnpm typecheck
pnpm test
pnpm run build:clean
```

Production multi-instance deployments must use PostgreSQL durable storage. SQLite and in-memory stores are for development, single-process verification, and conformance.

## Minimal governed graph API

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

Governed `start()` returns after the root aggregate and initial durable dispatch are prepared; it does not wait for model completion. Follow progress on the durable stream. Calling `start()` without `graphRef` is retained only for v1.0 compatibility. Callers must configure model profiles and task policy explicitly; the engine has no default provider or model.

## Durable parallel example

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

// The manager completion has advanced the root coordinator to join_all and queued three branches.
await engine.dispatchParallelAgents({
  multiAgentRunId,
  prompt,
  requestedBudgets: { draft: branchBudget, research: branchBudget, review: branchBudget }
})
```

The start node must be an `agent`. After the manager completion enters `fan_out`, `requestedBudgets` must authorize every branch being dispatched. Completion order never changes the join payload: `JoinResult.branches` is ordered by branch ID. `fail_fast` durably aborts unfinished siblings and persists cancellation work; a late result only appends `branch_late_result` and cannot change terminal state or advance the join again.

## Documentation

| Topic | Document |
|---|---|
| Architecture, lifecycle, governance, and graph ROI | [docs/architecture.en.md](./docs/architecture.en.md) |
| PostgreSQL, readiness, streaming, and release gates | [docs/deployment.en.md](./docs/deployment.en.md) |
| v1.0 to v1.1 migration and rollback | [docs/migrations/engine-v1.1.md](./docs/migrations/engine-v1.1.md) |
| v1.1.4 release notes | [docs/releases/v1.1.4.md](./docs/releases/v1.1.4.md) |
| All 18 workspace packages | [docs/packages/README.md](./docs/packages/README.md) |

Projects that have not yet adopted durable v1 should first follow [engine-v1.md](./docs/migrations/engine-v1.md).
