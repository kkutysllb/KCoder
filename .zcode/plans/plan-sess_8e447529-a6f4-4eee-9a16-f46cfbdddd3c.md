# 核心引擎 v1.1.1 → v1.1.2 同步 + 产品级全链路适配

## 背景与已验证的关键事实（代码层面，非文档）

我已用 5 个并行/串行 Explore agent + 直接读源码，从代码层面完整理解了三件事：

1. **上游 v1.1.2 的 headline 能力是「持久化并行图执行」(durable parallel graph execution)**。它是**纯增量、引擎内部**的能力，**没有改任何 HTTP 路由、SSE 线格式、DB schema、config**（已逐文件 `git diff` 验证为空）。新增内容集中在：
   - 1 个新源文件 `packages/engine/loop/src/parallel-branch-state.ts`（纯 reducer 状态机：`spawnParallelBranches`/`advanceBranch`/`settleBranch`/`abortOpenBranches`/`joinReadiness`/`buildJoinResult`/`projectBranchStatus`/`projectActiveNodeIds`）。
   - `packages/engine/loop/src/` 共 **12 个文件**改动 + 1 个新增。
   - `packages/foundation/contracts/src/` 共 **7 个文件**改动（multi-agent-runtime.ts 加 ParallelNode/JoinNode/DurableBranchRun/MultiAgentRun.branches/AgentRun.branchId；engine-stream.ts 加 BranchRoiSnapshot/RoiSnapshot.byBranch；engine-identity.ts/graph-governance.ts/graph-runtime.ts/usage.ts/graph-definition.ts 各加 `branchId`/parallel 词汇）。
   - `packages/ports-layer/ports/src/durable-engine-store.ts` 1 个文件（EngineStreamEventInput 加 branchId）。
   - 新增 4 个测试文件 + 16 个现有测试文件更新。

2. **KCoder 的 engine/ 确实还在 v1.1.1 源码级**（这是推翻了早期 agent 的错误结论——早期 agent 被 pnpm 的 `node_modules/@qiongqi/*` 相对软链造成的「Directory loop detected」骗了，没真正 diff 到 .ts 源码）。我用 `diff -rq <up>/packages/<layer>/<pkg>/src <kc>/.../src`（src 目录无软链）逐包验证：**15 个包字节相同，3 个包有差异**。精确的 re-vendor 面 = **20 个 src 文件**（engine/loop 12 + contracts 7 + ports 1）+ 顶层 tests/docs/package.json/README。

3. **模型无关架构重构（KCoder 06599a7）已经在上游 v1.1.2 里了**——`user-data-store.ts`/`sqlite-user-data-store.ts`/`user-scoped-model-client.ts`/`runtime-factory.ts`/`routes/index.ts` 两边**字节相同**，`routes/compat.ts` 两边都不存在。所以**没有需要合并的引擎侧定制冲突**，同步就是干净地拿上游 v1.1.2 的 packages/ + tests/ 覆盖。

4. **产品适配的契约面**：`EngineStreamEvent.kind` 是自由字符串（非封闭枚举），新增约定事件 `branch.spawned`/`branch.started`/`branch.completed`/`branch.failed`/`branch.cancelled`/`branch.late.result`/`join.waiting`/`join.completed`/`run.cancelled`，加可选顶层 `branchId` 字段；`roi.snapshot` 的 payload 新增可选 `byBranch`。这些都**向后兼容**。线程级 SSE (`/v1/threads/:id/events`) 的 `RuntimeEventKind`（32 种）**没变**。真正的分支数据走 **governed durable stream** `GET /v1/engine/streams/:streamId/subscribe`（已存在，未变）+ `GET /v1/runtime/evented-v2/runs/:runId/timeline`。

5. **类型导入可行性已验证**：`@qiongqi/contracts` 的 `exports` 允许 root 和子路径导入；`index.ts` 已 re-export 全部所需模块；`app/package.json` 已声明 `"@qiongqi/contracts": "workspace:*"`；软链可解析。**关键**：renderer 不 externalize（会 bundle），contracts 唯一运行时依赖是 zod v4（~50-100KB），所以**必须用 `import type { ... }`（编译期擦除，不把 zod 拖进浏览器 bundle）**，绝不导入 `*Schema` 值对象。

6. **铁律遵守**：上游 `/Users/libing/kk_Projects/QiongQi` 当前 `git status` 干净（HEAD `aa2e17d`，v1.1.2 release + 2 个后续 commit），全程**只读**，不写、不 commit、不留 scratch 文件。

---

## 阶段 0：工作区基线（保留未提交改动）

按用户决定，**保留** `app/renderer/src/{hooks/useChat.ts, services/engine-api.ts, stores/app-store.ts}` 的未提交 itemId 化重构（这是并发分支的正确基底），保留未跟踪的 `engine/assets/`。本计划在其之上继续。**不**做 git commit/stash（提交时机由用户决定）；分支操作仅在 `main` 上做文件级改动。

---

## 阶段 1：引擎源码同步到 v1.1.2（engine/，纯文件复制，零逻辑改动）

**方法**：对每个 src 目录用 `diff -rq` 已确认的差异文件，从上游直接复制覆盖到 KCoder。**不**碰 `node_modules`、`dist`、`skills`（KCoder 本地）、`assets`。**不**在上游仓库执行任何写命令。

### 1.1 复制 20 个 src 文件（engine/loop 12 + contracts 7 + ports 1）

逐文件 `cp`（覆盖）：
- `packages/engine/loop/src/`：`parallel-branch-state.ts`（新建）、`deterministic-node-runner.ts`、`durable-agent-dispatch-worker.ts`、`durable-engine.ts`、`durable-graph-store-adapters.ts`、`engine-stream-publisher.ts`、`engine-value-ledger.ts`、`evented-v2-multi-agent-runtime.ts`、`graph-governor.ts`、`index.ts`、`multi-agent-graph.ts`、`root-run-aggregate.ts`
- `packages/foundation/contracts/src/`：`engine-identity.ts`、`engine-stream.ts`、`graph-definition.ts`、`graph-governance.ts`、`graph-runtime.ts`、`multi-agent-runtime.ts`、`usage.ts`
- `packages/ports-layer/ports/src/durable-engine-store.ts`

### 1.2 同步 tests/

- 复制 4 个新测试：`durable-parallel-engine.test.ts`、`evented-v2-parallel-external.test.ts`、`parallel-branch-state.test.ts`、`postgres-durable-parallel-engine.test.ts`
- 覆盖 16 个已变测试（build-order / deterministic-node-runner / durable-agent-dispatch-worker / durable-graph-store-adapters / engine-roi-stream / engine-stream / evented-v2-multi-agent-runtime / graph-definition / graph-governance-contracts / graph-human-checkpoint / graph-runtime-contracts / multi-agent-contracts / multi-agent-graph / root-run-aggregate / sqlite-durable-engine-store，以及 `release-version.test.ts`——它断言版本号）。

### 1.3 同步顶层文件 + 文档

- `engine/package.json` + 5 个子包 package.json：`version` `1.1.1` → `1.1.2`（adapter-model / adapter-storage / adapter-tools / cli-layer/cli；其它包不带 version）。
- `README.md` / `README.en.md` / `README.zh.md`：版本字符串。
- 4 个 adapter/cli 的 `tsconfig.json`：补上游的 path-alias 块（`@qiongqi/adapter-fs` / `@qiongqi/tool-infra`）——这是 v1.1.2 build 修复，否则 typecheck 不过。
- `docs/releases/v1.1.2.md`（新增）+ 覆盖 `docs/architecture.*.md`、`docs/deployment.*.md`、`docs/migrations/engine-v1.1.md`、`docs/releases/v1.1.1.md`。
- `scripts/verify-sqlite.mjs` / `scripts/verify-postgres-engine.mjs`：补上游的测试列表。
- **不**复制：`docs/superpowers/{plans,specs}/2026-07-27-durable-parallel-join*`（上游 superpowers scratch，KCoder 已 gitignore superpowers）、`findings.md`/`progress.md`/`task_plan.md`/`.qoder`/`.DS_Store`（上游 agent scratch）。

### 1.4 重新构建引擎 + 验证

- `cd engine && pnpm install`（同步 lockfile 变化，若有）。
- `pnpm -r run build`（regenerate 全部 18 个 dist 目录）——**必须**，因为 app/main 用 `externalizeDepsPlugin` 运行时通过软链解析 `@qiongqi/*` 的 dist。
- `pnpm -r run typecheck` —— 必须零错误。
- `pnpm vitest run`（engine 测试）—— 必须全绿，特别是 4 个新 durable-parallel 测试 + 3 个 customization guard（no-kworks-compat / engine-v1.1-compatibility / provider-compatibility，已验证与上游字节相同会保持绿）。

**阶段 1 完成标志**：引擎在 v1.1.2 源码级，构建通过，全部测试绿，`/health` 返回正常，`app/main/engine-host.ts` 无需任何改动（已验证它只 import `createCodingAgent`/`createHttpServer`/`QiongqiCapabilitiesConfig`，不碰任何 v1.1.2 新 API，且 pending-configuration 占位符模式与上游字节相同的 `UserScopedModelClient` 兼容）。

---

## 阶段 2：产品级渲染层全链路适配（app/renderer/src）

### 2.1 类型来源迁移：手写重声明 → `import type` from `@qiongqi/contracts`（纠漂移源）

在 `engine-api.ts` 把手写的契约类型替换为 `import type { ... } from '@qiongqi/contracts'`：
- 删除虚构的 `parallelGroup` 字段（真实字段是 `branchId`）。
- 引入：`DurableBranchRun`, `ParallelNode`, `JoinNode`, `MultiAgentRun`, `AgentRun`, `AgentGraphNode`, `EngineStreamEvent`, `RoiSnapshot`, `BranchRoiSnapshot`, `EngineEfficiency`, `GraphNodeAttributionMetrics`, `GraphEdgeAttributionMetrics`, `CostEntry`, `EngineStreamChannel`, `GraphAttribution`, `GraphCorrelationIdentity`, `RuntimeEventKind`。
- **仅用 `import type`**（编译期擦除，zod 不进浏览器 bundle）。保留 KCoder 自有的 view 类型（`TurnExecutionView`/`AgentExecutionView` 等渲染层投影 DTO），它们是 engine stream 数据的渲染投影，不是 engine 契约本身。

### 2.2 engine-api.ts：接入 governed durable stream（替换 `getTurnExecution` 桩）

当前 `getTurnExecution` 返回 `{available:false}` 桩（注释明说「tracked for a later phase」）。本期实现：
- 新增 `subscribeEngineStream(streamId, onEvent)`：`GET /v1/engine/streams/:streamId/subscribe`（SSE，复用现有 fetch+ReadableStream 手动解析模式，带 `Authorization: Bearer`）。
- 新增 `getRunTimeline(runId)`：`GET /v1/runtime/evented-v2/runs/:runId/timeline`（拉一次快照，用于首屏 + 恢复）。
- 新增 `ackEngineStream(streamId, seq)`：`POST /v1/engine/streams/:streamId/ack`（订阅者确认，配合 durable at-least-once 语义）。
- `getTurnExecution` 改为：先 `getRunTimeline(runId)` 拿首屏 DAG 快照，返回带 `graph` 的 `evented_v2` 视图（nodes/edges/activeAgentKeys 现在能真实填充，包括 parallel/join 节点）。
- 解析 `EngineStreamEvent`：`kind` 自由字符串 → 分组（`branch.*` / `join.*` / `run.cancelled` / `roi.snapshot` / `node.*`）；读 `branchId`、`payload.byBranch`、`payload.byNode/byEdge`。

### 2.3 store（app-store.ts）：从单值投影 → 多分支投影

- `MessagePart` 加可选 `branchId?`（并发分支的 item 按 `(itemId, branchId)` 去重，扩展现有 itemId 去重逻辑）。
- `pendingApproval`/`pendingUserInput` 从单值 → **Map/数组**（并发分支可同时各自请求审批/输入）。新增 `pendingApproals: Record<string, ApprovalRequest>`、`pendingUserInputs: Record<string, UserInputRequest>`，保留旧单值字段做兼容 getter。
- 新增分支投影切片：`branches: Record<branchId, BranchProjection>`（status / agentKey / parallelNodeId / joinNodeId / roiSnapshot?）。
- 新增 `roiSnapshot: RoiSnapshot | null`（顶层 ROI：incurredCost / businessValue / roiRatio / fanOut / byBranch / byNode）。
- 新增 actions：`upsertBranch`、`settleBranch`、`setRoiSnapshot`、`addPendingApproval`、`resolvePendingApproval`、`addPendingUserInput`、`resolvePendingUserInput`。

### 2.4 useChat.ts：handleSseEvent 增加分支事件分发 + 订阅引擎流

- `handleSseEvent` 的 default case 拆出：新增对 `branch.spawned`/`branch.started`/`branch.completed`/`branch.failed`/`branch.cancelled`/`branch.late.result`/`join.waiting`/`join.completed`/`run.cancelled`/`roi.snapshot` 的 case（这些来自 engine stream，不是 thread SSE）。
- 新增 `subscribeEngineProjection(threadId, turnId)`：turn 开始后，除了现有 thread SSE，**额外**订阅该 turn 对应 run 的 engine stream（streamId = `stream:<multiAgentRunId>`，从 `POST /turns` 响应或 timeline 推断）。分支事件实时写入 store 的 `branches`/`roiSnapshot`。
- `pollExecution` 从「轮询桩」改为「订阅 engine stream」；保留 timeline 快照作为首屏/重连兜底。
- `loadThread` 增加：从 timeline 重建分支历史（目前只重建 user/assistant_text，会丢分支 item）。

### 2.5 ExecutionView.tsx：DAG 渲染并行分支泳道 + 状态 + ROI

- `DagGraph` 现在按 `parallelGroup`→改为按 **branchId/parallelNodeId** 分泳道（lane）：planning-manager → [parallel: 多个 branch 泳道，每泳道显示该 branch 的 agent + 状态徽章] → join 节点 → synthesis-manager。
- 每个 branch 节点显示：branchId、状态（queued/running/completed/failed/aborted，`suspended` 投影成 running）、late-result 标记、fail_fast 取消标记。
- 新增 `<RoiPanel>`：渲染 `roiSnapshot`（顶层 roiRatio、fanOut、criticalPathLatencyMs、retryAmplification）+ `byBranch` 表格（每分支 incurredCost / businessValue / netValue / roiRatio / EngineEfficiency）。
- `handoffs` 从扁平文本列表 → 带 `GraphEdgeAttributionMetrics`（selected/traversals/rejected）的真实边。
- 保持 `kernel_v3` delegation 树和 `classic` 不可用态不变（向后兼容）。

### 2.6 InfoPanel + 审批/输入组件：并发支持

- InfoPanel：auto-open 触发条件从 `turnExecution.available` 扩展为「有分支数据 OR 有 ROI」；可考虑加第 4 个 tab「ROI/分支」（或并入 execution tab）。
- MessageBubble 的 `<ApprovalPartCard>` + UserInputModal：绑定到 **Map** 而非单值，支持同一时刻多个分支各自挂起的审批/输入卡片（按 branchId 分组或堆叠）。

### 2.7 i18n

- `app/renderer/src/i18n/index.tsx` 新增 zh-CN + en 字符串：分支状态、late result、fail_fast 取消、ROI 指标（fanOut/retryAmplification/criticalPathLatency/roiRatio）、并发审批/输入提示。

### 2.8 验证（阶段 2）

- `pnpm --filter @kcoder/app typecheck` 零错误。
- `pnpm --filter @kcoder/app build` 成功（renderer bundle 不含 zod——用 `import type` 保证）。
- 手动验证（需用户配合，或我描述预期）：发一个 team（evented_v2）编排的 turn，观察 ExecutionView 出现并行分支泳道、状态实时更新、ROI 面板有数据；并发审批/输入能分别响应。

---

## 不做的事（明确边界）

- **不改** `app/main/engine-host.ts`（已验证无需改动，与 v1.1.2 兼容）。
- **不改** HTTP 路由 / SSE 线格式 / DB schema / config（v1.1.2 没改，我们也不改）。
- **不**在上游 `/Users/libing/kk_Projects/QiongQi` 执行任何写/commit/scratch。
- **不**导入 zod schema 值对象到 renderer（只用 `import type`）。
- **不**碰 settings 面板的 stub（subagents/commands/plugins/remote/skills-mutation）——这些与 v1.1.2 无关，是独立的「后续 phase」。
- **不**做 git commit（提交时机由用户决定）。

---

## 风险与回滚

- 风险 1：引擎同步后某个 customization guard 测试变红 → 已验证 3 个 guard 与上游字节相同，会保持绿；若意外红，回滚对应单文件。
- 风险 2：renderer 引入 contracts 类型后 vite bundle 报错 → 用 `import type` 规避；若仍报，回退该文件到手写类型。
- 风险 3：engine stream 订阅与 thread SSE 双流时序问题 → timeline 快照作为首屏兜底，engine stream 仅做增量；若双流复杂，可先只接 timeline 轮询（降级），engine stream 订阅作为增强。
- 全程可按文件粒度回滚（每个 cp/edit 独立）。

---

## 执行顺序

阶段 1（引擎同步，纯机械复制 + 构建/测试验证）→ 阶段 2.1（类型迁移）→ 2.2（stream 接入）→ 2.3（store）→ 2.4（useChat）→ 2.5（ExecutionView）→ 2.6（InfoPanel/审批/输入）→ 2.7（i18n）→ 2.8（验证）。

每个子步骤完成后我会简要汇报，遇到不确定的设计点会用 AskUserQuestion 确认，不会擅自扩大范围。