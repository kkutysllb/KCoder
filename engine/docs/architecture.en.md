# Qiongqi Durable Engine v1.1.2 Architecture

This document describes the current implementation, not a roadmap. Qiongqi is engine-only; downstream code owns identity, business value, model credentials, Agent bindings, and product interaction.

## 1. Execution planes

```text
GraphRevision(graphId, revision, digest)
  -> Durable GraphRun + WorkGraphEvent
  -> evented_v2: node/edge/mailbox/outbox/join/retry
       -> AgentRun
            -> KernelRun: model/tool/context/memory/checkpoint
```

- `evented_v2` is the only cross-Agent orchestration plane.
- Kernel executes one isolated AgentRun and never advances the parent graph directly.
- `DurableEngineStore` is the fact source for graphs, runs, checkpoints, ledgers, streams, outboxes, cost, and value.
- In-process events, caches, prose summaries, and SSE connections are not fact sources.

## 2. Immutable graph revisions

`compileAgentGraph()` normalizes a compatibility `AgentGraph`, assigns stable edge IDs, rejects duplicate identities, and computes a canonical SHA-256 digest. A published `GraphRevision` is immutable; one `(graphId, revision)` cannot map to different content.

Graph nodes include `agent`, `handoff`, `tool`, `judge`, `parallel`, `join`, `wait`, `retry`, and `terminate`. A `parallel` node declares at least two stable branch IDs, their start nodes, one join, and a `wait_all` or `fail_fast` policy. Nodes and edges may reference independently versioned policies. Legacy `node.model` produces a migration diagnostic instead of an implicit model binding.

Each graph run stores `graphId`, `graphRevision`, and `graphDigest`. Recovery, approval, circuit, and resource operations verify that pinned identity before changing state.

## 3. Durable work graph

The static graph records intent; `WorkGraphEvent` records execution. Events carry complete task scope, run/revision, node/edge, attempt, and monotonic sequence identity across traversal, child lifecycle, model routing, approval, resources, budgets, and circuits.

Graph run state, evented_v2 state, mailbox/outbox, and work events commit through one store transaction with CAS and fencing. Recovery projects durable facts and never infers a new run from a missing snapshot or log line.

A parallel run keeps one root coordinator cursor plus durable per-branch cursors, states, AgentRun IDs, outputs, usage/artifact references, and ROI snapshots. Fan-out creates all branch dispatch identities, reservations, and intents in one root aggregate commit. Completion advances by `(runId, branchId, AgentRun, KernelRun)` identity without comparing sibling or root cursors. Join consumes terminal branch records only and sorts by branch ID, so completion order and process restarts cannot change the non-empty `JoinResult`.

## 4. Governed root aggregate and dispatch

A governed `GraphRunRecord` and root `EngineRunRecord` have the same `runId`, `TaskScope`, graph identity, and strict version. Creation and every state transition write both projections atomically in one `EngineCommit`. A missing projection, incompatible version/lifecycle, or missing caller limits fails closed with `ROOT_RUN_AGGREGATE_INCOMPLETE`, `ROOT_RUN_AGGREGATE_DIVERGED`, or `ROOT_RUN_BUDGET_MISSING`.

Every Agent/Judge dispatch is prepare-first. Stable AgentRun, KernelRun, reservation, and intent identities are generated and committed in the root transaction before a worker is notified. The in-process notification only reduces latency; local and remote workers claim the same `agent_execution_requested` intent, renew its lease through `renewWorkClaim()`, honor the fence, and resolve input through `inputRef`. A higher fence may take over an expired claim, but recovery never creates a replacement identity for the same attempt.

Governed `start()` requires caller-authorized `budgetLimits` and returns after the root aggregate and initial dispatch preparation commit, not after model completion. Storage checks each budget dimension transactionally:

```text
sum(settled reservation actual usage)
+ sum(active reservation requested usage)
+ new requested usage
<= root budgetLimits
```

Released reservations consume no budget, and root `budgets` project settled actual usage only. Model and node policies may narrow caller limits but cannot supply or increase them.

## 5. Durable facade

| API | Semantics |
|---|---|
| `publishGraph(revision)` | Publish an immutable graph revision; replaying the same digest is idempotent |
| `start(input)` | With `graphRef`, require `budgetLimits` and return after initial durable dispatch preparation; omission is v1.0 compatibility only |
| `inspect(runId)` | Load the graph run and all work events from storage |
| `migrateGraphOnlyRun(input)` | Explicitly repair a v1.1.0 graph-only run with caller limits and append `root_run_repaired` |
| `resolveCheckpoint(id, resolution)` | Atomically consume one approval token against the pinned revision |
| `setGraphCircuit(runId, state)` | Apply a manual degradation or recovery and append a work event |
| `resume` / `cancel` | Resume Kernel waits or persist cancellation; fencing rejects late completion |
| `flushAgentDispatches(limit)` | Explicitly drain currently claimable durable Agent dispatches for worker/test integration |
| `dispatchActiveAgent(input)` | Prepare a recovered non-parallel Agent with a caller-authorized budget |
| `dispatchParallelAgents(input)` | Atomically prepare runnable branches from `requestedBudgets[branchId]` |
| `consumeKernelCompletion(input)` | Consume a Kernel completion by durable execution identity across reconstructed instances |
| `subscribe` / `ack` | Replay a durable stream from sequence and track subscriber cursors |
| `recordCost` / `recordValue` | Persist measurements and return/publish a live ROI snapshot |
| `setTaskModelPolicy` | Advance revisioned task model authorization |

The facade does not own volatile governance state. A reconstructed instance can inspect and govern runs from the shared store.

`wait_all` waits for every branch to become terminal before resolving the join. `fail_fast` atomically aborts open siblings and persists Kernel cancellation work after a failure or abort. Root cancellation likewise commits branch/root cancellation work and stream facts before retryable external cancellation. A late completion may settle genuine usage not yet recorded and append `branch_late_result`, but it cannot overwrite terminal state, output, cursor, or trigger another join.

Loaders and `inspect()` never synthesize a missing projection. Only caller-authorized `migrateGraphOnlyRun({ runId, budgetLimits })` repairs a graph-only v1.1.0 run. A terminal run may be repaired for audit consistency but is never dispatched again.

## 6. Model-neutral routing

`ModelProfileRegistry` maps immutable `profileId@revision` to `providerId`, `modelId`, endpoint format, capabilities, and `credentialRef`. A task policy may authorize several profiles while a graph-node `modelPolicyRef` narrows selection.

Every physical request pins one profile revision and carries graph correlation into usage, ledger, and trace records. Product-level model switching creates the next task-policy revision; in-flight operations retain their original profile. Core code has no vendor, default model ID, or plaintext-key fallback.

## 7. Suppression, compaction, and memory

- Model and tool operations use stable request/context/effect fingerprints.
- Completed work replays committed results; semantic duplicates can be suppressed; uncertain provider effects wait for verification instead of being reissued.
- `TaskCheckpoint` persists goals, constraints, decisions, evidence, budgets, wait state, and durable references. `ContextCheckpoint` persists compaction provenance and identity.
- `task_shared` remains inside one task; `agent_private` belongs to one AgentRun until explicitly published.

## 8. Governance

A human checkpoint has exactly one allow/resume edge and a single-use token tied to the graph revision. Resource claims resolve per resource key; writes require fences, and `report_only` permits reads only.

Automatic circuits only increase severity: `running -> report_only -> paused -> retired`. Recovery is an explicit `setGraphCircuit()` operation that records `circuit_resumed`. Readiness derives `draft`, `observe`, `assisted`, or `autonomous` from evidence for definition, telemetry, production storage, recovery drills, budgets, approvals, resource fencing, traces, cancellation, and circuits.

## 9. Streaming, ROI, and observability

Model deltas, tool lifecycle, branch lifecycle, checkpoints, work-graph events, usage, ROI, and outcomes enter the durable stream before SSE transport. `streamId + seq` defines order and replay, and branch events carry `branchId`; acknowledgements are per subscriber, and disconnect does not cancel work. Private reasoning collection, persistence, subscription, and retention are off by default.

Cost, value, and usage records may carry graph/node/edge/branch/attempt attribution. Live `RoiSnapshot` provides `byNode`, `byEdge`, `byBranch`, fan-out, retry amplification, suppressed physical attempts, avoided cost, and executed critical-path latency. External waiting time is excluded from execution critical path. Business value requires downstream evidence; engine efficiency never fabricates ROI.

OpenTelemetry spans contain policy-safe identifiers and numeric metrics, not prompts, tool arguments, credentials, or private reasoning.

## 10. Storage and consistency

PostgreSQL is required for multi-instance production. SQLite and in-memory stores are for single-process use and conformance. Production implementations require transaction, CAS, lease/fence, work-claim renewal, immutable revision conflict, single-use checkpoint token, resource claim, and outbox claim semantics. PostgreSQL locks the parent row while creating a reservation so cumulative budget validation and insertion share one serialized critical section.

v1.1 adds graph records and tables without mutating v1.0 runs. Incomplete v1.0 work is not rewritten in place as governed execution; see [engine-v1.1.md](./migrations/engine-v1.1.md).
