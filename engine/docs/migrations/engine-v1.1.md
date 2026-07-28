# Qiongqi Engine v1.1 Migration

This guide upgrades a Durable Engine v1.0, v1.1.0, v1.1.1, or v1.1.2 deployment to v1.1.3 governed graph execution. Existing in-flight runs are never rewritten or repaired by loaders.

> Release boundary: v1.1.3 includes the per-turn execution policy, detailed Kernel result, policy-complete graph compiler, authoritative dispatch recovery, and governed Turn/HTTP contracts described below.

## 1. Before upgrading

1. Finish the v1.0 durable migration in [engine-v1.md](./engine-v1.md).
2. Back up PostgreSQL and record every non-terminal v1.0 run.
3. Verify each registered model profile has an immutable revision, capabilities, endpoint format, and `credentialRef`.
4. Remove product configuration that assumes `deepseek-chat` or any other implicit default model.
5. Run the v1.1.3 release gate on the exact commit to deploy, including PostgreSQL durable engine tests for multi-instance production.

## 2. Storage

Apply the additive v1.1 schema for graph revisions, graph runs, work-graph events, task model policies, human checkpoints, and resource claims. Preserve existing task/run/ledger/stream/outbox records and indexes.

Do not populate graph identity by guessing from thread IDs, runner names, prompts, or old snapshots. A valid graph run requires a published revision and exact digest.

## 3. Upgrade v1.1.1 to v1.1.2

v1.1.2 makes `parallel` a public, executed graph node instead of an unsupported discriminator. Existing sequential v1.1.1 graph revisions remain valid and need no rewrite. For new or revised parallel graphs:

1. Upgrade API and workers before publishing a revision containing `parallel`.
2. Declare at least two globally unique branch IDs, one start node per branch, one owning join, and an exact non-empty `requiredBranchIds` set.
3. Choose `wait_all` or `fail_fast`; choose join `outputPolicy` as `all`, `successful`, or a valid non-empty `selectedBranchIds` subset.
4. Provide explicit `requestedBudgets[branchId]` for every branch dispatch. The engine does not divide a root budget or infer per-Agent limits.
5. Keep PostgreSQL for multi-instance production. SQLite supports one process and sequential reconstruction through independent connections, not distributed writers.

Do not let a v1.1.1 worker claim a v1.1.2 parallel run. A root coordinator cursor and durable branch cursors share the governed root version; older workers cannot preserve this aggregate. Existing non-terminal v1.1.1 sequential runs may drain on compatible workers or be durably cancelled before restart.

Join output is stable by branch ID, not completion time. `fail_fast` and root cancellation create durable cancellation work; an external cancel may be delivered more than once after claim expiry and must be idempotent. Late branch results are audit-only and cannot reopen a terminal branch or join.

## 3A. Upgrade v1.1.2 to v1.1.3

v1.1.3 changes new Agent dispatch writes from schema v2 to schema v3 and adds a public governed Turn/HTTP entry. Roll out in this order:

1. Upgrade every worker to v1.1.3 before enabling v1.1.3 writers.
2. Let v1.1.3 workers drain schema v1/v2 work; do not rewrite existing intents or immutable graph revisions.
3. Publish a new graph revision when adding `nodePolicyRef` or `edgePolicyRef`. Both refs now survive `compileAgentGraph()` and participate in `graphDigest`; changing only an edge policy keeps its logical edge ID.
4. Inject the HTTP runtime with one matching `{ engine, store }` pair before accepting `governedExecution`. A partial binding returns 503 and must not accept writes.
5. Send explicit `scope`, `graphRef`, `budgetLimits`, and `modelPolicy`. Never infer `taskId` from `threadId`.

Schema v1/v2 dispatch payloads omit some context. The v1.1.3 worker loads the durable root EngineRun, GraphRun, pinned GraphRevision, and prepared AgentRun to recover it. Schema-v3 payload context is also checked against those facts; a contradiction is durable corruption or tampering, not a retryable model error.

## 3B. Upgrade v1.1.3 to v1.1.4

v1.1.4 is a model-adapter diagnostic security patch. It does not change public contracts or durable schemas, so no state conversion or dispatch drain is required. Roll processes normally, prioritizing deployments that forward stderr to a shared logging system.

After upgrade, a legal assistant message containing `tool_calls` with omitted `content` no longer emits `[diagnoseEmptyContent]`. Genuine invalid empty-message and provider-rejection diagnostics remain available but contain metadata only; endpoint userinfo/query/hash, prompt content, reasoning, tool arguments/results, provider error text, and request bodies are excluded.

## 4. Publish graphs

Compile each product graph and review compiler diagnostics:

```ts
const revision = compileAgentGraph(agentGraph, {
  revision: 1,
  publishedAt: new Date().toISOString()
})
await engine.publishGraph(revision)
```

Replace deprecated `node.model` values with versioned `modelPolicyRef`. Assign node/edge governance policies explicitly. Publishing the same `(graphId, revision, digest)` is idempotent; changing content requires a new revision.

## 5. Start governed work with caller limits

Every governed start must provide product-authorized root limits. The engine has no provider, model, or budget default:

```ts
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
```

`start()` returns only after both root projections and the initial AgentRun/KernelRun identity, reservation, and dispatch intent commit. It does not wait for model completion. Consume progress from `started.streamId`.

Budget admission is cumulative for each dimension:

```text
settled reservation actual usage
+ active reservation requested usage
+ new requested usage
<= root budgetLimits
```

## 6. Model policy migration

Create one revisioned task `ModelSelectionPolicy` containing all profiles the user may select. Products can switch the preferred/candidate profile by advancing the task-policy revision. A graph node may reference a narrower model policy, but it cannot authorize a profile excluded by the task.

In-flight model attempts keep their original profile revision. Never change provider/model identity under an existing revision.

## 7. Incomplete v1.0 runs

Choose one action per non-terminal run:

- **Drain**: keep a compatibility worker and let the v1.0 run reach a terminal state.
- **Restart**: cancel the old run durably, publish a graph revision, create a new run/task identity, and carry forward only reviewed evidence/artifact references.

Do not attach a `graphRef` to an existing run, synthesize old work events, reuse approval tokens, or copy agent-private memory. The v1.0 `start()` shape remains callable without `graphRef` only to support controlled draining.

## 8. Repair affected v1.1.0 graph-only runs

The v1.1.0 governed-start defect may have created a `GraphRunRecord` without the required root `EngineRunRecord`. `inspect()`, loaders, API instances, and workers fail closed with `ROOT_RUN_AGGREGATE_INCOMPLETE`; they never synthesize limits or repair state.

For each affected run:

1. Stop workers from claiming the run and back up its records.
2. Load the pinned graph revision and review lifecycle facts, reservations, child records, and settled usage.
3. Choose caller-authorized limits that cover valid committed usage without inventing product policy.
4. Execute the explicit migration:

```ts
const repaired = await engine.migrateGraphOnlyRun({
  runId,
  budgetLimits: {
    stepsUsed: 100,
    toolCallsUsed: 40,
    inputTokens: 200_000,
    outputTokens: 40_000,
    costUsd: 25
  }
})
```

The migration validates the pinned revision and current facts, creates the root EngineRun, advances both projections from version `N` to `N + 1`, and appends `root_run_repaired` atomically. A non-terminal run resumes only through its existing prepared durable intent. A terminal run is repaired for audit consistency and is never dispatched again.

Do not call the migration twice, create an EngineRun directly, rewrite the GraphRun version, or treat `ROOT_RUN_AGGREGATE_DIVERGED`/`ROOT_RUN_BUDGET_MISSING` as retryable. These errors require operator review of durable facts.

## 9. Governance rollout

Start at the readiness level supported by evidence:

- `draft`: invalid/incomplete definition; no execution.
- `observe`: telemetry and production controls incomplete; no production writes.
- `assisted`: execution allowed with human approval and incomplete recovery evidence.
- `autonomous`: all required evidence plus a recorded recovery drill.

Configure circuit thresholds before autonomous traffic. `report_only` blocks write claims, while `paused` and `retired` block claims. Automatic evaluation never lowers severity; recovery is a manual, audited circuit operation.

## 10. ROI migration

Continue recording evidence-backed business value separately from engine efficiency. Add graph and optional branch attribution to new cost, value, and usage records. Historical un-attributed entries remain task totals and must not be retroactively assigned to nodes or branches without evidence. Consumers should accept additive `RoiSnapshot.byBranch` and reconcile it with root totals rather than treating it as a separate bill.

## 11. Rollback constraints

- Stop admitting new v1.1 graph runs before rolling binaries back.
- Do not delete graph tables, revisions, events, checkpoints, claims, or model-policy records.
- A v1.0 binary must not claim or mutate a v1.1 graph run.
- Runs already started on v1.1 require a v1.1-compatible worker until terminal or explicit cancellation.
- A v1.1.1 binary must not claim a v1.1.2 run whose pinned revision contains `parallel`; drain or cancel those runs before binary rollback.
- Rolling forward to the same or newer v1.1-compatible build is the supported recovery for active governed runs.

## 12. Adopt the v1.1.3 per-turn and governed execution contracts

Products must stop encoding skill/tool/output rules only in natural-language prompts. Send `explicitSkillIds` and one immutable `executionPolicy` in `StartTurnRequest`. Unknown fields fail strict validation instead of being stripped. To bind a Turn to DurableEngine, also send the strict `governedExecution` object described in section 3A.

Treat the following shapes differently:

- no `executionPolicy`: v1.1.2-compatible behavior;
- `allowedSkillIds: []`: no skill may activate;
- `allowedToolNames: []`: no tool may be advertised or executed;
- non-empty `requiredSkillIds`: every listed skill must also be allowed and available, otherwise execution fails before a model call.

Register every referenced output validator through `outputValidators` before accepting traffic. The registered implementation must report the exact `validatorId/revision/digest`; missing or mismatched validators fail closed.

Durable workers may encounter all three dispatch versions. v1 is policy-less legacy work; v2 may contain `executionPolicyRef`; v3 additionally carries thread/turn/workspace and `nodePolicyRef`. New writers emit v3 only. v1.1.3 readers hydrate every version from durable facts and fail closed when a payload contradicts the pinned revision.

Replace product-side `toolCallsUsed: 0` placeholders with `ServerRuntime.runTurnDetailed()`. Its `budget` is loaded from persisted Kernel state and includes idempotent tool-call accounting. Keep `runTurn()` only where a status-only response is sufficient. Detailed Kernel results are not synthesized for classic/evented_v2 execution.

## 13. Acceptance

The migration is complete when new tasks start with pinned graph identity and caller limits, GraphRun/EngineRun have the same ID and version, three or more branches can finish out of order and produce one stable non-empty join, expired dispatch/cancel claims recover with the original execution identity and policy ref, `/ready` reports the intended readiness level, branch stream replay survives reconnect, `byBranch` ROI reconciles with root totals, model switching advances policy revision, approval tokens reject replay, write claims are fenced, cumulative budget exhaustion rejects new reservations, deny-all policies advertise/execute nothing, configured output validators fail closed, and `runTurnDetailed()` reports the persisted Kernel tool-call count.
