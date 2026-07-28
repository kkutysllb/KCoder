# 引擎同步 v1.1.2 → v1.1.4 + 产品级严格对齐（删除所有补丁）

## 核心判断

上游 v1.1.3/v1.1.4 **原生实现了 governed graph 的 HTTP 出口**（`governed-turn-runtime.ts` + `routes/governed-engine.ts`），完美替代了 KCoder 之前手写的全部补丁代码。上游设计更健壮（无轮询、lazy 终端投影、replay-safe binding、authoritative context hydration）。

本次同步后，**KCoder 引擎代码与上游 v1.1.4 完全一致（零补丁）**，所有 governed graph 集成工作转移到**产品侧**（`engine-host.ts` 构造 `DurableEngine` + 前端发送 `governedExecution`）。

---

## 阶段 1：引擎源码同步（engine/ → v1.1.4，零补丁）

### 1.1 删除 KCoder 补丁文件
- 删除 `packages/http-layer/http/src/governed-turn-driver.ts`（+ dist artifacts）

### 1.2 同步全部 src 文件（直接覆盖上游 v1.1.4）
所有有差异的 src 文件直接用上游覆盖（23 个文件 + 3 个新文件）：
- **engine/loop**：durable-agent-dispatch-worker、durable-graph-store-adapters、evented-turn-orchestrator、evented-v2-multi-agent-runtime、graph-revision-compiler、kernel-agent-executor、kernel-v3-turn-runner、model-proposal-runner、prompt-builder、turn-orchestrator
- **engine/services**：turn-service（含上游的 bindGovernedRun/finishGovernedTurn，删除 KCoder 的 registerInflight/inflightBegin/inflightEnd）
- **foundation/contracts**：graph-definition、index、multi-agent-runtime、turns + **新增** turn-execution-policy.ts
- **http-layer/http**：index（入口）、runtime-factory、routes/index、routes/server-runtime、routes/turns + **新增** governed-turn-runtime.ts、routes/governed-engine.ts
- **ports-layer/ports**：index + **新增** output-validator.ts
- **adapters/adapter-model**：model-compat-client
- **capabilities/skills**：plugin-host
- **domain-layer/domain**：turn

### 1.3 唯一需要保留 + 重新应用的 KCoder 合法改动：`branchWorkspaceResolver`
`runtime-factory.ts` 是唯一同时包含「KCoder 补丁」和「KCoder 合法改动」的文件。同步上游后重新应用：
- `branchWorkspaceResolver?` 选项（enrichContext 钩子，用于 worktree overlay）
- `enrichToolContext` 里的 branchWorkspaceResolver 调用

### 1.4 同步 tests + 顶层文件
- 覆盖所有有差异的 test 文件 + 新增 7 个 test 文件
- 19 个 package.json 版本 1.1.2 → 1.1.4
- README/docs/scripts + v1.1.3/v1.1.4 release notes + superpowers design/plan docs

### 1.5 构建验证
- `pnpm -r run build` + `pnpm -r run typecheck` 零错误
- `pnpm vitest run` 全绿（上游 v1.1.4 全部测试）

---

## 阶段 2：产品级严格对齐（app/ 适配上游原生 governed graph）

### 2.1 `engine-host.ts` — 构造 DurableEngine 并传入 governedEngine

替换 `governedGraph: true`（KCoder 补丁选项，上游不存在）为上游原生 `governedEngine: { engine, store }`：

```ts
// 1. 构造 governed store
const governedStore = new SqliteDurableEngineStore(join(dataDir, 'governed-engine.sqlite'))

// 2. 构造 KernelAgentExecutor（startKernel 回调跑单 AgentRun Kernel 执行）
const kernelExecutor = new KernelAgentExecutor({
  store: governedStore,
  ids, nowIso,
  startKernel: async (input) => { /* 构建 RuntimeKernel 跑一个 AgentRun */ }
})

// 3. 构造 DurableEngine
const engine = createEngine({ store: governedStore, modelRegistry, kernelExecutor, ids, nowIso })

// 4. 发布默认 graph revision
await engine.publishGraph(compileAgentGraph(defaultSingleAgentGraph(agentName), { revision: 1, publishedAt: nowIso() }))

// 5. 传入 createCodingAgent
const agent = await createCodingAgent({
  ...existingOptions,
  governedEngine: { engine, store: governedStore }  // 替代 governedGraph: true
})
```

`startKernel` 回调需要从 loop 包导入 `RuntimeKernel` + `productionKernelV3Graph`（上游已导出），从 `createKernelV3TurnRunner` 构建的 `kernelV3Loop` 获取 node handlers/stores/middleware。**但这不再需要 `internals` getter**——上游的 `createKernelV3TurnRunner` 返回 `runTurnDetailed()` 方法，可以复用。

### 2.2 前端 `sendMessage` — 发送 `governedExecution`

`engine-api.ts` 的 `sendMessage` 在 POST body 里加 `governedExecution` 字段：

```ts
body: JSON.stringify({
  prompt: content,
  governedExecution: {
    scope: { ownerId, workspaceId, taskId },
    graphRef: { graphId: 'governed_single_Qiongqi', revision: 1 },
    budgetLimits: { stepsUsed: 96, toolCallsUsed: 256, ... },
    modelPolicy: { authorizedProfileIds: [selectedModel] }
  }
})
```

graphId 和 revision 必须与 engine-host 里 publishGraph 的一致。

### 2.3 删除前端对补丁 API 的引用
- `engine-api.ts`：删除手写的 governance 路由方法（inspect/circuit/cancel/checkpoint）——上游 `routes/governed-engine.ts` 提供完整路由，路径可能不同
- `useChat.ts`：`stopGeneration` 不再需要手动 abort engine stream——上游 interrupt 路由原生处理 governed cancel
- `store/app-store.ts`：`graphRunInspection` 等可能需要调整以匹配上游 inspect 响应格式

### 2.4 验证
- `pnpm typecheck`（app）零错误
- `pnpm build` 成功
- 引擎全测试套件绿
- better-sqlite3 重建为 Electron 版本

---

## 不做的事
- **不保留任何补丁代码**（governed-turn-driver.ts、registerInflight、internals getter、手写 governance 路由等全部删除）
- **不污染上游仓库**
- **保留 worktree overlay**（`engine/overlays/`）——它是合法的产品扩展，不是引擎补丁
- **保留 branchWorkspaceResolver**——合法的 overlay 集成点

---

## 执行顺序

阶段 1（同步引擎 → v1.1.4 + 零补丁验证）→ 阶段 2.1（engine-host 构造 DurableEngine）→ 阶段 2.2（前端 governedExecution）→ 阶段 2.3（清理补丁 API 引用）→ 阶段 2.4（验证）