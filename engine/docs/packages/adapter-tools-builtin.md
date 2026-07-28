# @qiongqi/adapter-tools — 内置工具

> v1.1.4。工具必须声明 effect/replay metadata，并受 durable ledger、输出预算和审计约束。

> `bash` / `read` / `edit` / `write` / `grep` / `find` / `ls` + `create-plan` / `goal` / `todo` 工具。
> Layer 5 — 同 registry 子模块。

---

## 中文

### 1. 职责

本子模块聚焦**内置文件/搜索/计划/目标/任务**工具：

- **文件操作**：`read` / `edit` / `write` —— 通过 `LocalToolHost` 注册
- **搜索**：`grep` / `find` / `ls` —— 路径约束 + 大小限制
- **Shell**：`bash` —— 短命令 + 长任务（`startBashSession` 带 poll/write/stop）
- **计划**：`create_plan` —— GUI Plan 模式的物化工具
- **目标**：`get_goal` / `create_goal` / `update_goal` —— 跨 turn 持久目标
- **任务**：`todo_list` / `todo_write` —— 任务列表维护

**3 种工具矩阵**：
- `buildAllBuiltinTools(host)` —— 全套（read / edit / write / bash / grep / find / ls）
- `buildCodingBuiltinTools(host)` —— 同上（默认 preset）
- `buildReadonlyBuiltinTools(host)` —— 只读（read / grep / find / ls）

### 2. 公共 API

| 导出 | 类型 | 来源文件 | 一句话 |
|------|------|---------|--------|
| `createBashLocalTool` | function | `builtin-bash-tool.ts` | bash 工具工厂 |
| `startBashSession` | function | `builtin-bash-tool.ts` | 长任务 session 启动 |
| `createReadLocalTool` | function | `builtin-read-tool.ts` | read 工具工厂 |
| `createWriteLocalTool` | function | `builtin-file-tools.ts` | write 工具工厂 |
| `createEditLocalTool` | function | `builtin-file-tools.ts` | edit 工具工厂（fuzzy match）|
| `createFindLocalTool` / `createGrepLocalTool` / `createLsLocalTool` | function | `builtin-search-tools.ts` | 搜索三件套 |
| `buildAllBuiltinLocalTools(host)` | function | `builtin-tools.ts` | 全套工具工厂 |
| `buildCodingBuiltinLocalTools(host)` | function | `builtin-tools.ts` | 编码 preset 工具 |
| `buildReadOnlyBuiltinLocalTools(host)` | function | `builtin-tools.ts` | 只读工具 |
| `getDefaultLocalTools()` | function | `builtin-tools.ts` | **延迟函数**，打破初始化循环（阶段 1.2）|
| `allBuiltinToolNames` | const | `builtin-tools.ts` | 全部内置工具名 |
| `allToolNames` | const | `builtin-tools.ts` | 全部工具名（含内置 + GUI state）|
| `BuiltinToolName` / `ToolName` | type | `builtin-tools.ts` | 工具名字面量类型 |
| `createCreatePlanTool` | function | `create-plan-tool.ts` | plan 工具工厂 |
| `CREATE_PLAN_TOOL_NAME` | const | `create-plan-tool.ts` | `'create_plan'`（renderer 契约）|
| `buildGoalLocalTools` | function | `goal-tools.ts` | goal 三件套（get/create/update）|
| `buildTodoLocalTools` | function | `todo-tools.ts` | todo 两件套（list/write）|
| `resolveWorkspacePath` / `withToolBoundary` | function | `builtin-tool-utils.ts` | 路径解析 + 沙箱边界 |
| `shellConfig` / `shellDisplayName` / `shellRuntimeInfo` | const / function | `builtin-tool-utils.ts` | shell 元数据 |

### 3. 关键不变量

- **路径沙箱**：`withToolBoundary(root, callback)` 强制所有路径解析必须落在 `root` 内；`..` 引用被拒绝。
- **Read 工具的"已读"提示**：当某文件在同一线程被读 ≥2 次，tool result 追加 hint（鼓励 model 减少冗余 read）。
- **Bash 长任务**：`startBashSession` 返回 `{ sessionId, pollAction, writeAction, stopAction }`，GUI 通过 poll 持续获取 stdout。
- **Edit fuzzy match**：`createEditLocalTool` 使用 `@qiongqi/adapter-fs/edit-diff` 的 `applyEditsToNormalizedContent`；找不到 / 重叠 / 空 oldText / 多 occurrence 都抛错。
- **Plan 工具的强制上下文**：`isPlanToolContextActive(ctx)` 返回 true 仅当 `ctx.guiPlan` 设置或 `ctx.threadMode === 'plan'`。
- **Plan 路径原子写**：`create-plan` 通过 `withFileMutationQueue` + temp+rename 写到 `<workspace>/.qiongqisdd/plan/<feature>.md`。
- **`getDefaultLocalTools` 是延迟函数**：阶段 1.2 关键设计；`adapter-tools` 模块初始化时不立即构造工具，避免循环。
- **Goal 状态转换合法**：`update_goal` 仅允许 `complete` / `blocked`（用户/系统控制其他状态）。
- **Todo 至多一个 in_progress**：`normalizeToolTodos` 把多余 `in_progress` 降级为 `pending`（与 `contracts` 层的 `superRefine` 共同强制）。
- **Edit 工具跳过 `file_change` 类的 string 截断**：`repairDispatchToolArguments` 中 `file_change` 类工具保留长 arguments（避免破坏 patch）。

### 4. 行为规约

来自 `tests/builtin-tools.test.ts` / `tests/create-plan-tool.test.ts` / `tests/goal-tools.test.ts` / `tests/todo-tools.test.ts`：

- `bash executes foreground commands in the workspace`
- `bash returns a pollable session id for long-running commands`
- `bash polls completed sessions for final output once the shell exits`
- `bash blocks poll for at least yield_seconds while the session is running`
- `bash includes the active shell in partial updates`
- `bash persists a full output file when truncated`
- `read returns the file contents with metadata (line count, byte count)`
- `read surfaces a "previously read" hint when the same path is read twice`
- `edit refuses when oldText is not found, has multiple occurrences, or overlaps another edit`
- `edit uses fuzzy match for line-ending whitespace and Unicode quotes`
- `write creates a new file (overwriting) and refuses to escape the workspace`
- `grep / find / ls enforce the path sandbox`
- `create_plan advertises only when threadMode='plan' OR context.guiPlan is set`
- `create_plan writes to <workspace>/.qiongqisdd/plan/<feature>.md atomically`
- `get_goal returns null when no goal is set`
- `update_goal allows only status 'complete' or 'blocked'`
- `todo_write normalizes content (trim, max 1000 chars) and enforces at-most-one in_progress`

### 5. 使用示例

```typescript
import {
  LocalToolHost,
  buildCodingBuiltinLocalTools,
  createCreatePlanTool,
  buildGoalLocalTools,
  buildTodoLocalTools,
} from '@qiongqi/adapter-tools'

// 1. 编码 preset 工具矩阵
const host = new LocalToolHost({ workspace: '/work' })
const tools = buildCodingBuiltinLocalTools(host)

// 2. 添加 plan 工具（仅 plan mode 可见）
tools.push(createCreatePlanTool({
  workspaceRoot: '/work',
  reservedRelativePath: '.qiongqisdd/plan/refactor.md',
}))

// 3. 添加 goal + todo 工具
tools.push(...buildGoalLocalTools(threadService))
tools.push(...buildTodoLocalTools(threadService))

// 4. 注册到 host
for (const tool of tools) host.register(tool)
```

### 6. 关联文档

- 架构文档：[`../architecture.zh.md#3-包结构`](../architecture.zh.md#3-包结构)（§3.3 Layer 5 适配器层）
- 消费方：`@qiongqi/loop` 的 `ToolCallCoordinator.dispatch`；`@qiongqi/preset-coding` 默认使用 `buildCodingBuiltinLocalTools`
- 源文件：[`builtin-tools.ts`](../../packages/adapters/adapter-tools/src/builtin-tools.ts)、[`builtin-bash-tool.ts`](../../packages/adapters/adapter-tools/src/builtin-bash-tool.ts)、[`builtin-read-tool.ts`](../../packages/adapters/adapter-tools/src/builtin-read-tool.ts)、[`builtin-file-tools.ts`](../../packages/adapters/adapter-tools/src/builtin-file-tools.ts)、[`builtin-search-tools.ts`](../../packages/adapters/adapter-tools/src/builtin-search-tools.ts)、[`create-plan-tool.ts`](../../packages/adapters/adapter-tools/src/create-plan-tool.ts)、[`goal-tools.ts`](../../packages/adapters/adapter-tools/src/goal-tools.ts)、[`todo-tools.ts`](../../packages/adapters/adapter-tools/src/todo-tools.ts)、[`builtin-tool-utils.ts`](../../packages/adapters/adapter-tools/src/builtin-tool-utils.ts)
- 测试：[`../../tests/builtin-tools.test.ts`](../../tests/builtin-tools.test.ts)、[`../../tests/create-plan-tool.test.ts`](../../tests/create-plan-tool.test.ts)、[`../../tests/goal-tools.test.ts`](../../tests/goal-tools.test.ts)、[`../../tests/todo-tools.test.ts`](../../tests/todo-tools.test.ts)
