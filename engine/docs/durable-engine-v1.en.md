# Durable Engine v1.1.1 Completion Note

Release date: 2026-07-27. Status: the root-run aggregate production fix is complete, with the root and all 18 workspace packages aligned at `1.1.1`.

## Outcome

v1.1 adds production graph engineering to the v1.0 durable foundation. Graph definitions are immutable and versioned, actual node/edge/attempt work becomes a durable work graph, and governance state shares the same fact source as execution. v1.1.1 makes the governed `GraphRunRecord` and root `EngineRunRecord` one same-ID, same-version, same-transaction aggregate and moves Agent dispatch to a durable prepare-first protocol. `evented_v2` remains the only cross-Agent orchestration plane; isolated Kernel runs remain the model-driven execution plane.

## Highlights

| Area | v1.1 result |
|---|---|
| Graph contract | canonical digest, immutable revision, pinned run identity, compatibility diagnostics |
| Work graph | deterministic node/edge traversal, actual attempt events, durable projection |
| Model policy | durable task policy revision, node policy refs, graph correlation, no vendor default |
| Usage | budget reservations settle against actual usage without duplicate accounting |
| Approval | durable human checkpoint, one resume edge, single-use resolution token |
| Resources | read/write claims, write fences, wait/skip/escalate conflict strategy |
| Circuits | `running`/`report_only`/`paused`/`retired`, automatic escalation, explicit recovery |
| Readiness | `draft`/`observe`/`assisted`/`autonomous` evidence model aggregated by `/ready` |
| ROI | graph/node/edge cost/value, fan-out, retries, suppression, avoided cost, critical path |
| Facade | `publishGraph`, governed `start`, `inspect`, checkpoint/circuit operations, `recordCost` |
| Build | package cycle removed; clean build fails on every compiler error |
| Root aggregate | GraphRun/EngineRun advance atomically with one ID/version; structured errors fail closed |
| Dispatch recovery | identity/reservation/intent commit first; local and remote workers share one fenced handler |
| Root budgets | caller limits are mandatory; settled actual and active requested usage are checked cumulatively |
| Migration | `migrateGraphOnlyRun` explicitly repairs affected v1.1.0 graph-only runs; loaders never repair |

## Preserved v1 foundation

Durable model/tool ledgers, context compaction, task and Agent memory isolation, real SSE streaming, subscriber replay/ack, cancel/outbox behavior, private-reasoning defaults, and model-profile abstraction remain in place and are covered by v1.1 regression gates.

## Compatibility and migration

Calling `start()` without `graphRef` retains the v1.0 facade shape but never rewrites an in-flight run as governed execution. Governed `start()` now requires caller-supplied `budgetLimits` and returns after the first durable dispatch preparation commits, not after model completion. New work publishes a revision first. Existing v1.0 runs either finish on compatibility workers or are cancelled and restarted with a new run identity. Affected v1.1.0 graph-only runs require explicit migration. See [engine-v1.1.md](./migrations/engine-v1.1.md).

See [v1.1.1 release notes](./releases/v1.1.1.md) for changes and risks.
