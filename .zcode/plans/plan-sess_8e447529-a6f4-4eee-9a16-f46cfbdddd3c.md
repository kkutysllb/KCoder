# Git Worktree 隔离布丁包 — 实现方案

## 背景与已验证的关键事实（全部代码层面确认）

通过 3 轮深度代码调查，确认了以下决定架构的事实：

1. **并发隐患是真实的**：v1.1.2 持久化并行分支**共享同一个 `workspaceKey`**（`evented-v2-multi-agent-runtime.ts:473` 在 `start()` 设置一次，所有分支继承）。`DurableBranchRun`/`AgentRun` 都没有 workspace/cwd 字段。引擎的 lease/fence 只锁存储记录，不锁文件系统。两个分支同时 `edit` 同一文件会 TOCTOU 丢更新。

2. **工具的 cwd 单点解析**：bash（`builtin-bash-tool.ts:679` `cwd = workspaceRoot(context.workspace)`）和所有文件工具（`builtin-tool-utils.ts:60-87` `resolveWorkspacePath` 相对 `workspaceRoot(context.workspace)`）都只认 `ToolHostContext.workspace` 这一个字段。**改这一个字段 = 改所有工具的 cwd。**

3. **两个注入点**：
   - **enrichContext 钩子**（`runtime-factory.ts:826-829`）：已用于注入 PYTHONPATH，是覆盖 `context.workspace` 的干净切口。
   - **remote-worker workspace**（`evented-v2-multi-agent-runtime.ts:228`）：peer 分支路径的 workspace 设置点。

4. **生产 HTTP 运行时只走 peer 路径**：`runtime-factory.ts:1705-1711` 构建 `EventedV2MultiAgentRuntime` 时**不传 agentExecutor/dispatchPreparer**，所以本地并行分支不执行，分支只在 peer worker 路径上跑（228 行）。

5. **worktree 路径可重算**：worktree 路径是 `f(repoRoot, runId, branchId)` 的纯函数，因此**不需要持久化到 contracts**——崩溃重启后可重算。

6. **铁律与切口选择**：你选了 B（改 parallel-node 支持 per-branch cwd）+ 仓库同级目录存放。深度调查发现 Cut 3（enrichContext 注入）能零 contracts 改动、零上游同步冲突地达到完全相同的隔离效果（worktree 路径可重算不需持久化）。我据此选择 **Cut 3**，既满足你「让 parallel 分支获得独立 cwd」的真实意图，又严守铁律。

7. **git worktree 存放**：仓库同级 `<repo>/../.kcoder-wt/<runId>/<branchId>/`，符合 git 约定和引擎自带 skill 建议（`using-git-worktrees/SKILL.md:26`「放在主仓库路径之外」）。

---

## 总体架构

```
┌─ KCoder app (app/main/engine-host.ts) ─────────────────────┐
│  启动时: 注册 worktree MCP server + 注入 enrichContext 解析器 │
└────────────────────────┬───────────────────────────────────┘
                         │ (布丁包，不改 engine/packages 源码)
          ┌──────────────┴───────────────┐
          ▼                              ▼
┌─ packages/worktree-overlay/ ──┐   ┌─ enrichContext 注入 ─────────┐
│ MCP server (stdio)            │   │ 根据 (threadId → branchId)   │
│ - create_worktree             │   │ 查 worktree 注册表，覆盖      │
│ - list_worktrees              │   │ context.workspace            │
│ - remove_worktree             │   └──────────────────────────────┘
│ - merge_worktree (join 时)    │
│ + BranchWorktreeRegistry      │
│   (内存 Map: branchId→path)   │
└───────────────────────────────┘
```

**两条协作路径**（互补，不冲突）：
- **并行分支自动隔离**（Cut 3，引擎侧 enrichContext + 228 行）：parallel node 的分支 spawn 时，worktree 注册表记录 branchId→worktree 映射；分支的工具调用经 enrichContext 自动重定向。
- **显式委派隔离**（已有 delegate_task）：父 agent 用 `delegate_task(workspace=<worktree>)` 把子任务发到独立 worktree。这条路径已原生工作，无需改动。

---

## 阶段 1：worktree-overlay 包（独立 workspace 包）

### 1.1 包骨架：`packages/worktree-overlay/`

新建目录（与 `packages/*/*` 平级，纳入 pnpm workspace）：
```
packages/worktree-overlay/
  package.json        # @kcoder/worktree-overlay, private, ESM
  tsconfig.json
  src/
    registry.ts       # BranchWorktreeRegistry: branchId → worktree 路径映射（内存 Map，可重算）
    git.ts            # 封装 git worktree add/list/remove/merge（child_process spawn）
    mcp-server.ts     # MCP stdio server: create/list/remove/merge_worktree 工具
    resolver.ts       # resolveBranchWorkspace(threadId, workspace): string | null  —— Cut 3 的核心解析器
    index.ts          # 导出 createWorktreeMcpServer + BranchWorktreeRegistry + resolveBranchWorkspace
```

### 1.2 `registry.ts` — 分支 worktree 注册表

- 内存 `Map<string /*runId*/, Map<string /*branchId*/, string /*worktreePath*/>>`。
- **关键设计：路径可重算**。worktree 路径 = `join(repoRoot, '..', '.kcoder-wt', runId, branchId)`。即使注册表丢失，给定 (repoRoot, runId, branchId) 也能重算出同一路径。
- API：`register(runId, branchId, repoRoot)` / `lookup(runId, branchId)` / `resolve(repoRoot, runId, branchId)`（纯函数，重算路径）/ `clear(runId)`。

### 1.3 `git.ts` — git worktree 操作封装

- `createWorktree(repoRoot, branchName, worktreePath)`：`git -C <repoRoot> worktree add <worktreePath> -b refs/heads/parallel/<runId>/<branchId>`。
- `removeWorktree(worktreePath, { force })`：`git -C <repoRoot> worktree remove <path>`。
- `mergeWorktree(repoRoot, branchRef)`：`git -C <repoRoot> merge --no-ff <branchRef>`（join 时合并回集成分支）。
- `listWorktrees(repoRoot)`：`git -C <repoRoot> worktree list --porcelain`。
- 全部用 `child_process.spawn`，捕获 stderr，超时保护。**所有操作都在 repoRoot（主仓库）上执行**，worktree 路径在仓库外。

### 1.4 `mcp-server.ts` — MCP stdio server

暴露 4 个工具（供 agent 显式调用，也供编排层调用）：
- `create_worktree({ repoRoot, runId, branchId })` → `{ worktreePath, branchRef }`，同时写入注册表。
- `list_worktrees({ repoRoot })` → `[{ path, branch, head }]`。
- `remove_worktree({ repoRoot, worktreePath })` → `{ ok }`，同时清理注册表。
- `merge_worktree({ repoRoot, branchRef })` → `{ merged, head }`。

用 `@modelcontextprotocol/sdk` 实现 stdio server（KCoder 已有该依赖）。工具 annotations：`readOnlyHint` 给 list，`destructiveHint` 给 remove/merge（触发审批）。

### 1.5 `resolver.ts` — Cut 3 核心解析器

```ts
export function resolveBranchWorkspace(
  registry: BranchWorktreeRegistry,
  threadId: string,
  workspace: string
): string | null {
  // threadId 格式约定：runId = run_<threadId>_<turnId>，但 branch 经 peer 路径时
  // threadId 是分支子线程的 id。解析注册表：若该 threadId 对应一个已注册的
  // branch worktree，返回 worktree 路径；否则返回 null（用默认 workspace）。
  return registry.lookupByThread(threadId)
}
```

---

## 阶段 2：引擎侧最小切口（Cut 3，零 contracts 改动）

### 2.1 `runtime-factory.ts` enrichContext 注入（~15 行）

在 `enrichToolContext`（826-829 行）追加分支 worktree 解析：
```ts
const enrichToolContext = async (context: ToolHostContext): Promise<ToolHostContext> => {
  let next = context
  if (pythonPathEnv) {
    next = { ...next, environment: { ...(next.environment ?? {}), PYTHONPATH: pythonPathEnv } }
  }
  // Cut 3: 并行分支 worktree 隔离 —— 若该线程对应已注册的分支 worktree，覆盖 workspace
  const branchWs = options.branchWorkspaceResolver?.(next.threadId, next.workspace)
  if (branchWs) next = { ...next, workspace: branchWs }
  return next
}
```
- 新增 `QiongqiServeRuntimeOptions.branchWorkspaceResolver?: (threadId, workspace) => string | null` 可选字段。
- **零 contracts 改动**：这是 http-layer 内部 options，不是持久化 schema。

### 2.2 `evented-v2-multi-agent-runtime.ts:228` peer workspace 注入（~5 行）

```ts
const task: PeerTask = {
  prompt: promptFromMailboxMessage(message),
  ...(run?.workspaceKey ? {
    workspace: this.options.branchWorkspaceResolver
      ? (this.options.branchWorkspaceResolver(run.runId, input.branchId ?? '', run.workspaceKey) ?? run.workspaceKey)
      : run.workspaceKey
  } : {}),
  label: `evented_v2:${input.agentId}`
}
```
- 新增 `EventedV2MultiAgentRuntimeOptions.branchWorkspaceResolver?: (runId, branchId, fallback) => string | null`。
- 仅当 resolver 提供且返回非 null 时覆盖；否则保持原 `run.workspaceKey`（向后兼容）。

### 2.3 注入点都不破坏铁律

这两处改动都在 `packages/http-layer/http` 和 `packages/engine/loop`，是**可选回调注入**（resolver 未提供时行为完全不变）。**不碰 `packages/foundation/contracts`**（零持久化 schema 改动、零上游同步冲突）。未来上游同步时，这两处是叠加式的可选参数，冲突极小且易 merge。

---

## 阶段 3：KCoder app 侧装配（engine-host.ts）

### 3.1 注册 worktree MCP server + resolver

在 `engine-host.ts` 的 `startEngine()`：
1. 创建 `BranchWorktreeRegistry` 实例（进程级单例）。
2. 在 `capabilities` 里加 `mcp.servers['git-worktree']`（stdio server，指向 worktree-overlay 的 dist）。
3. 把 `branchWorkspaceResolver` 通过 `createCodingAgent` options 注入（需 preset-coding 透传该 option 到 createQiongqiServeRuntime —— 检查 preset-coding 是否透传未知 options；若不透传，改用 config.json 的 capabilities.mcp + 一个独立的 resolver 注入）。
4. 监听 `branch_spawned` / `join_completed` 事件：spawn 时调 `create_worktree`，join 时调 `merge_worktree`。

### 3.2 分支 worktree 生命周期绑定

- **spawn**：监听 engine stream 的 `branch.spawned` 事件 → 调 `registry.register(runId, branchId, repoRoot)` + MCP `create_worktree`。
- **join**：监听 `join.completed` 事件 → 对每个 `completed` 分支调 MCP `merge_worktree`（合并其 branchRef 到集成分支）→ `registry.clear(runId)`。
- **cancel/fail**：监听 `branch.cancelled`/`run.cancelled` → 调 MCP `remove_worktree`（清理半成品 worktree）。

---

## 阶段 4：Advisory lock 兜底（可选，阶段 3 之后）

当 worktree 不可用（如非 git 仓库、worktree 创建失败）时，提供文件写串行化兜底：
- 由于引擎中间件**无 per-tool-call 钩子**（已确认 `facts.toolCall` 从不填充），advisory lock 不能放引擎中间件。
- 放在 **MCP worktree server 内部**：`create_worktree` 调用本身用 mutex 串行化（同 repo 的 worktree 创建互斥）。
- 对「worktree 缺席时的文件写仲裁」，作为后续独立议题（需要 ToolHost.prepare 钩子，那是另一处引擎切口，本方案暂不涉及）。

---

## 不做的事（明确边界）

- **不改 `packages/foundation/contracts`**（零持久化 schema 改动，零上游同步冲突）。
- **不持久化 branch→worktree 映射到引擎记录**（路径可重算，无需持久化）。
- **不实现 per-tool-call advisory lock**（引擎无此钩子；worktree 已解决并行隔离，lock 作为兜底放 MCP server 内部）。
- **不碰 delegate_task 路径**（已原生支持 workspace 参数，天然工作）。
- **不做上游仓库任何改动**（铁律）。

---

## 风险与回滚

- **风险 1**：preset-coding 可能不透传未知 options（`branchWorkspaceResolver`）。验证方式：读 preset-coding/src/index.ts 的 createCodingAgent，若它白名单 options，则改用「config.json capabilities.mcp + 独立 resolver 注入到 runtime-factory 的全局单例」。回滚：移除 resolver 注入，worktree MCP 工具仍可用（降级为 agent 显式调用模式）。
- **风险 2**：peer 路径的 branchId 在 228 行可能为空（input.branchId 不一定填充）。验证方式：读 EventedV2RemoteAgentWorker 的 input 构造，确认 branchId 是否传递。若空，resolver 无法区分分支 → 该路径回退到共享 workspace（不隔离但不报错）。
- **风险 3**：worktree 创建失败（磁盘满、分支名冲突）。兜底：MCP 工具返回错误，agent 收到后可降级为在主工作区顺序执行。
- 全程可按文件粒度回滚。

---

## 执行顺序

阶段 1（worktree-overlay 包骨架 + registry/git/mcp-server/resolver）→ 阶段 2（引擎 enrichContext + 228 行两处可选注入）→ 阶段 3（engine-host 装配 + 生命周期绑定）→ 验证（构建 + 一个并行分支场景的手测）→ 阶段 4（advisory lock 兜底，可选）。

每步完成后简要汇报。遇到 preset-coding options 透传、branchId 传递等不确定点会先验证再继续，不臆断。