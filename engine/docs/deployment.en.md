# Qiongqi Durable Engine v1.1.2 Production Deployment

## 1. Prerequisites

- Node.js 20+ and pnpm 10+.
- PostgreSQL for multi-instance production; SQLite only for single-process development and conformance.
- A secret manager resolves `credentialRef`; credentials never enter profiles, checkpoints, streams, or logs.
- Publish an immutable `GraphRevision` before starting new work with `graphRef`.
- Every governed `start()` receives caller-supplied `budgetLimits`; the engine does not infer a product budget.
- Every `dispatchParallelAgents()` receives a complete caller-authorized `requestedBudgets[branchId]`; missing or extra branch budgets fail before dispatch.

## 2. Build and release gate

```bash
pnpm install --frozen-lockfile
pnpm run prepare:sqlite
pnpm run verify:sqlite
QIONGQI_TEST_POSTGRES_URL='postgresql://user:pass@host:5432/qiongqi' pnpm run verify:postgres-engine
pnpm typecheck
pnpm test:fast
pnpm test
pnpm run build:clean
pnpm run verify:evented-a2a
pnpm vitest run tests/release-version.test.ts tests/engine-v1.1-compatibility.test.ts
git diff --check
```

`build:clean` compiles all 18 workspaces in acyclic dependency order and fails on every non-zero compiler exit. The removed behavior that accepted stale `dist` output after type errors is not a valid gate.

## 3. PostgreSQL and migration

Back up first, apply the additive v1.1 graph schema, deploy workers, then deploy API instances. The schema includes immutable graph revisions, same-version GraphRun/EngineRun root aggregates, work-graph events, task model policies, human checkpoints, budget reservations, and resource claims. Preserve unique keys, CAS versions, lease fences, outbox claims, and stream sequence indexes.

During rolling upgrade:

1. Let incomplete v1.0 runs finish on compatibility workers, or explicitly cancel and restart them as new graph runs.
2. Only v1.1 workers may claim new runs pinned to a revision and digest.
3. On shutdown, stop new claims, finish the current transaction, and leave pending outbox work for takeover.
4. Do not remove v1.1 graph tables or events during rollback; follow [engine-v1.1.md](./migrations/engine-v1.1.md).

When upgrading an affected v1.1.0 deployment that already produced governed GraphRuns without root EngineRuns, stop claims for each run and explicitly call `migrateGraphOnlyRun({ runId, budgetLimits })` as described in the migration guide. Loaders, `inspect()`, and workers never auto-repair. Migration commits both same-version projections and a `root_run_repaired` audit event; terminal work is not dispatched again.

PostgreSQL must check `settled actual + active requested + new requested <= root limits` while holding the parent-row lock. Passing SQLite/in-memory conformance does not replace this multi-instance locking requirement.

A v1.1.2 multi-instance release must run `tests/postgres-durable-parallel-engine.test.ts`. It races out-of-order branch completions through two independent store/engine instances and requires one join plus equal root projection versions. The gate skips without `QIONGQI_TEST_POSTGRES_URL`; such a build is not verified for multi-instance production.

## 4. Readiness and probes

- `/health` means that the process responds.
- `/ready` aggregates store and graph readiness and must gate new work.
- `/v1/runtime/metrics` and Prometheus expose stream, ledger, outbox, usage, cost, ROI, and graph metrics.

Autonomous production requires evidence for a valid definition, telemetry, production storage, recovery drills, budgets, approvals, resource fencing, trace correlation, cancellation, and circuits. `draft`/`observe` must not receive production writes; `assisted` retains human approval.

## 5. Streaming

Disable proxy buffering for SSE, allow long-lived connections, and forward `Last-Event-ID` or an equivalent sequence cursor. Events commit before transport, and disconnect never cancels work. Branch lifecycle events carry stable `branchId`, and root `roi.snapshot.byBranch` must reconcile with root totals. Subscriber acknowledgements are independent and cannot truncate another subscriber's replay window.

Private reasoning collection, persistence, subscription, and retention are off by default. Proxies, access logs, and trace exporters must not record authorization, prompts, tool arguments, credentials, or private memory.

## 6. Models and policies

Register providers and immutable profile revisions at startup. A task policy references authorized profiles only. Product-level model switching advances the task policy revision: new physical attempts use the new revision while in-flight attempts retain the one they started with.

Do not configure a hidden core default. If authorized profiles are unavailable, return an explicit resolution/degraded state rather than falling back to `deepseek-chat` or another model ID.

## 7. Monitoring

Monitor at least:

- logical/physical/replayed/suppressed/uncertain attempts and duplicate ratio;
- outbox age, claim failure, lease conflict, checkpoint lag, and resume/cancel latency;
- graph circuit state, readiness level, node/branch failure/retry/cancel, fan-out, join latency, and critical-path latency;
- stream append latency, subscriber lag, and SSE reconnects;
- model/tool usage, cost, graph/node/edge ROI, avoided cost, and ROI status.

ROI is `incomplete` without evidence-backed business value and `unavailable` when cost is missing or currencies conflict. Suppression and avoided cost are engine efficiency, not business value.

## 8. Failure drills

Set worker claim TTL above the normal handler interval and call `renewWorkClaim()` before expiry. A failed renewal must stop commits and leave takeover to a higher fence. Before release, exercise interrupted model deltas, provider success before commit failure, tool effect before commit failure, crash after parallel fan-out, out-of-order branch completion, crash before join commit, prepare commit before notification failure, outbox commit before publish failure, expired dispatch/cancel claim takeover, approval-token replay, conflicting writes, missing/divergent root projections, cumulative budget exhaustion, `wait_all`/`fail_fast`, root cancel versus late completion, branch stream replay, and temporary PostgreSQL outage.

Acceptance means no silent duplicate effect, no cross-task or cross-Agent memory leak, and an explainable resumable state for every run. Treat `ROOT_RUN_AGGREGATE_INCOMPLETE`, `ROOT_RUN_AGGREGATE_DIVERGED`, and `ROOT_RUN_BUDGET_MISSING` as governed alerts that are not automatically retried.
