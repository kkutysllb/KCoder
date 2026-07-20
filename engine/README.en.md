<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/qiongqi.png">
    <img src="assets/qiongqi.png" width="100%" alt="Qiongqi — The beast that breaks the deadlock">
  </picture>
</p>

<h1 align="center">Qiongqi</h1>

<p align="center">
  <b>Independent Multi-Agent Framework · Constant skeleton, mutable flesh</b>
</p>

<p align="center">
  <a href="./README.zh.md">中文</a> ·
  <a href="#-quick-start">Quick Start</a> ·
  <a href="#-design-philosophy">Philosophy</a> ·
  <a href="#-architecture">Architecture</a> ·
  <a href="#-monorepo-package-structure">Packages</a> ·
  <a href="./docs/packages/README.md">Technical Docs</a> ·
</p>

---

> **The beast that breaks the deadlock.** Qiongqi is named after the mythical
> creature from Chinese classics — a winged tiger that "understands human
> speech" and dares to "destroy trust and discard loyalty." The engine rejects
> central scheduling oligarchs; every Agent is an independent warrior. A single
> Agent can operate in a closed loop, while multiple Agents self-negotiate
> through a decoupled engine skeleton and external skill flesh.

---

## 📖 What is Qiongqi?

**Qiongqi** is a **domain-neutral, independent multi-agent framework** built on
a **cache-first, decentralized orchestration** HTTP/SSE engine skeleton, paired
with a pluggable skill and tool system, assembled into productivity tools for
different industries.

Core goal: **maximize the ROI of every token.** Avoid duplicate tool schemas,
runaway tool outputs, malformed history, invalid retries, and any stable prefix
that could be cached but is missed.

The current implementation includes classic / evented turn orchestration,
declarative loop engineering (LoopRunner interprets LoopPlan phases and uses the Evaluator for bounded retry), HTTP/SSE APIs, A2A task lifecycle,
Skill/MCP/Web/Memory/Delegation providers, attachments/artifacts, hybrid
SQLite+JSONL storage, Prometheus metrics, structured access logs,
OpenTelemetry HTTP tracing, and Post-P1 runtime governance such as tool
result budgeting, bash command audit, virtual paths, and terminal-state
guards.

---

## 🐯 Design Philosophy

A three-headed beast, three core propositions:

### 1️⃣ Core Philosophy: The Rebel Against Centralization

Qiongqi has no central scheduling oligarch. Turn orchestration, tool
coordination, and context compaction — every component is a replaceable
port/adapter contract. The engine is just a skeleton; the flesh is injected by
external skills and tools.

### 2️⃣ Individual Capability: The "Tiger Wings"

Every Agent is an end-to-end independent execution unit. A single Agent can
complete a closed loop from prompt to tool call to result return. The Skill
system supports capability encapsulation at any granularity.

### 3️⃣ Collective Intelligence: Self-Negotiating Organization

Multiple Agents self-negotiate through a decoupled engine skeleton (EventBus,
Store, Gate) rather than central orchestration. The subagent delegation
mechanism supports hierarchical consensus.

---

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- pnpm 10+

### Install & Build

```bash
pnpm install
pnpm -r run build
node scripts/flatten-dist.mjs  # Flatten build output
```

Before using `hybrid` storage in production or CI, run `pnpm run prepare:sqlite && pnpm run verify:sqlite` to build and verify that the `better-sqlite3` native binding can be loaded.

Verify the evented orchestrator + two-instance A2A path:

```bash
pnpm -r run build
node scripts/flatten-dist.mjs
pnpm run verify:evented-a2a
```

The script covers async `POST /a2a/tasks` submission, polling to task completion, artifacts, SSE subscribe, and evented turn-state cleanup.

### Start the Runtime

```bash
npx tsx packages/cli/src/serve-entry.ts serve \
  --data-dir ~/.qiongqi/data \
  --base-url "$QIONGQI_BASE_URL" \
  --api-key "$QIONGQI_API_KEY" \
  --port 8899
```

After startup, the HTTP API is available at `http://127.0.0.1:8899`.

Production probes and runtime metrics:

```bash
curl http://127.0.0.1:8899/health
curl http://127.0.0.1:8899/ready
curl -H "Authorization: Bearer $QIONGQI_RUNTIME_TOKEN" \
  http://127.0.0.1:8899/v1/runtime/metrics
curl -H "Authorization: Bearer $QIONGQI_RUNTIME_TOKEN" \
  -H "Accept: text/plain" \
  "http://127.0.0.1:8899/v1/runtime/metrics?format=prometheus"
```

`/ready` exposes storage degraded state; `/v1/runtime/metrics` returns JSON by default and can also export Prometheus text for token/cache usage, A2A tasks, and storage diagnostics.

### Script Reference

```bash
pnpm -r run build          # Build all 18 packages
pnpm run prepare:sqlite    # Build the better-sqlite3 native binding for the current Node ABI
pnpm run verify:sqlite     # Verify the better-sqlite3 native binding for hybrid storage
pnpm run verify:evented-a2a # Local fake-model two-instance evented + A2A verification
pnpm test                  # Full test suite (71 files, 510 tests)
pnpm test:unit             # Unit tests
pnpm test:fast             # Fast test subset (70 files, 481 tests)
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────┐
│                    Client (GUI / CLI)            │
└────────────────────┬────────────────────────────┘
                     │ HTTP / SSE
┌────────────────────▼────────────────────────────┐
│                 @qiongqi/http                    │
│   Router · Auth · SSE · Runtime Factory          │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│              @qiongqi/loop                       │
│  TurnOrchestrator · LoopRunner · LoopPlan        │
│  PromptBuilder · Policy · Evaluator              │
│  ToolCallCoordinator · ContextCompactor          │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│              @qiongqi/ports                      │
│  ModelClient · ToolHost · Stores · EventBus      │
│  ApprovalGate · UserInputGate · Workspace        │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│           Adapters + Extensions                  │
│  adapter-model · adapter-tools · adapter-storage │
│  skills · memory · attachments · delegation      │
│  tool-infra · artifacts · OpenTelemetry          │
└───────────────────────────────────────────────────┘
```

> Detailed architecture: [`docs/architecture.en.md`](./docs/architecture.en.md)
> Per-package technical docs: [`docs/packages/README.md`](./docs/packages/README.md)

---

## 📦 Monorepo Package Structure

Qiongqi uses a pnpm monorepo structure with 18 independent npm packages:

| Package | Responsibility |
|---------|---------------|
| `@qiongqi/contracts` | Zod schemas + types (zero-dependency base layer) |
| `@qiongqi/domain` | Thread/Turn/Item/Event entities |
| `@qiongqi/ports` | ModelClient/ToolHost/Stores interfaces |
| `@qiongqi/cache` | LRU/TTL cache, immutable prefix |
| `@qiongqi/loop` | TurnOrchestrator/LoopRunner/LoopPlan/PromptBuilder/Policy |
| `@qiongqi/services` | Thread/Turn/Usage services |
| `@qiongqi/adapter-model` | Provider-neutral model compatibility client |
| `@qiongqi/adapter-tools` | Built-in tools + MCP/Web/Memory/Delegation providers |
| `@qiongqi/adapter-storage` | File/Hybrid/SQLite storage |
| `@qiongqi/skills` | SkillRuntime + PluginHost |
| `@qiongqi/memory` | Cross-session memory + lexical retrieval |
| `@qiongqi/attachments` | Attachment management + virtual path resolver |
| `@qiongqi/adapter-fs` | Pure filesystem I/O utilities |
| `@qiongqi/tool-infra` | Tool infrastructure, result budget, command audit |
| `@qiongqi/delegation` | Child-agent delegation runtime + terminal-state guard |
| `@qiongqi/http` | HTTP/SSE, A2A, metrics, artifacts, OpenTelemetry |
| `@qiongqi/cli` | CLI entry point |
| `@qiongqi/preset-coding` | Coding preset |

> Full dependency graph: [`docs/architecture.en.md#appendix-a-complete-dependency-table`](./docs/architecture.en.md)
> Package details: [`docs/packages/README.md`](./docs/packages/README.md)

---

## ✨ Features

### 🔧 Agent Loop
- **Declarative Loop Engineering**: the evented mode evolves into a declarative loop substrate — `LoopRunner` interprets the `LoopPlan` phase set (build-prompt → run-model → decide → optional evaluate → dispatch-tools); rich events (`prompt:built` / `model:ran` / `decision` / `tools:dispatched` / `step:retry`) are materialized and appended to a `LoopRun` audit log; a pluggable deterministic `LoopEvaluator` triggers bounded retry/reflection according to the phase retry budget; classic mode is retained as a regression anchor
- **Cache-first orchestration**: Immutable prompt prefix + TTL/LRU cache + inflight tracking
- **Context compaction**: Soft/hard threshold-triggered summarization
- **Token economy**: Compress tool descriptions and results
- **Tool Storm Breaker**: Suppress repeated tool calls within the same turn
- **Loop Policy**: Pure-function stop/continue/fail/dispatch/plan-materialize decisions
- **Runtime governance**: Tool result externalization, bash command audit, terminal-state guards

### 🔌 Capability Matrix
- **MCP client**: stdio / streamable-http / SSE transports, BM25 tool search
- **Skills system**: Plugin-based capability injection via `skill.json` / `SKILL.md`
- **Subagent delegation**: Hierarchical agent calls with concurrency control
- **Memory system**: Cross-session persistence, Chinese/English lexical ranking, scope-based retrieval
- **Attachments and artifacts**: Image binary stripping, visual/text channels, virtual-path reads

### 🌐 Server
- **HTTP/SSE API**: Complete `/v1/*` RESTful routes
- **Runtime diagnostics**: Capability manifest, tool diagnostics, JSON/Prometheus metrics
- **Thread management**: Create, fork, side threads, event replay
- **Approval gating**: Multiple policy support
- **Observability**: Request id, structured access logs, W3C `traceparent`, OpenTelemetry HTTP tracing

---

## 📁 Project Structure

```
.
├── assets/
│   └── qiongqi.png               # Project cover image
├── docs/                          # Technical docs (bilingual)
│   ├── architecture.{zh,en}.md   # Unified architecture (philosophy + technical architecture + packages)
│   ├── deployment.{zh,en}.md     # Production deployment, probes, metrics, OTel, A2A verification
│   ├── packages/                 # 27 per-package technical docs
│   └── superpowers/plans/        # Runtime governance and external A2A plans
├── packages/                      # 18 @qiongqi/* packages (packages/<layer>/<package>)
│   ├── foundation/contracts/
│   ├── domain-layer/domain/
│   ├── ports-layer/ports/
│   ├── infrastructure/{cache,attachments,adapter-fs,tool-infra}/
│   ├── engine/{loop,services}/
│   ├── adapters/{adapter-model,adapter-tools,adapter-storage}/
│   ├── capabilities/{skills,memory}/
│   ├── delegation-layer/delegation/
│   ├── http-layer/http/
│   ├── cli-layer/cli/
│   └── presets/preset-coding/
├── tests/                         # Full test suite (71 files, 510 tests)
├── deploy/                        # Kubernetes manifests and Prometheus rules
├── .github/workflows/ci.yml       # CI: SQLite, typecheck, fast tests, build, A2A
├── scripts/                       # Migration and build helper scripts
├── pnpm-workspace.yaml
├── vitest.config.ts
└── package.json
```

---

## 📚 Related Documents

| Document | Location |
|----------|----------|
| **Architecture Overview** | [`docs/architecture.en.md`](./docs/architecture.en.md) |
| **Technical Docs Index** | [`docs/packages/README.md`](./docs/packages/README.md) |
| **Deployment** | [`docs/deployment.en.md`](./docs/deployment.en.md) |
| **Package Dependencies** | [`docs/architecture.en.md#appendix-a-complete-dependency-table`](./docs/architecture.en.md) |
| **Per-Package Docs** | [`docs/packages/`](./docs/packages/) |
| **External A2A Verification Plan** | [`docs/superpowers/plans/2026-06-23-external-a2a-interoperability.md`](./docs/superpowers/plans/2026-06-23-external-a2a-interoperability.md) |
| **Runtime Governance Plan** | [`docs/superpowers/plans/2026-06-22-kk-oclaw-runtime-hardening.md`](./docs/superpowers/plans/2026-06-22-kk-oclaw-runtime-hardening.md) |
| **CI / Delivery Assets** | [`.github/workflows/ci.yml`](./.github/workflows/ci.yml), [`Dockerfile`](./Dockerfile), [`deploy/`](./deploy/) |
| **Chinese README** | [`README.zh.md`](./README.zh.md) |

---

## 🗺️ Roadmap

Qiongqi's four-stage architecture refactoring currently stands at:

| Stage | Goal | Status |
|-------|------|--------|
| **Stage 1** | SDK extraction + monorepo split | Complete |
| **Stage 2** | AgentCard + AgentIdentity | Complete |
| **Stage 3** | TurnOrchestrator event-driven | Complete |
| **Stage 4** | A2A protocol endpoint | Nearly complete; awaiting external Agent cross-vendor interop verification |
| **Post-P1** | Runtime governance + OpenTelemetry exporter | Complete |
| **Loop Engineering** | Declarative loop substrate (LoopPlan/LoopRunner/Evaluator) | Complete |
| **P2** | Real external A2A peer / cross-vendor interoperability | Awaiting external counterpart |

Detailed progress: see CHANGELOG commit history.

---

<p align="center">
  <sub>Built with ❤️ for the Agent era</sub>
</p>
