# @qiongqi/adapter-tools — Registry / Host / Hooks

> v1.1.4。registry 负责能力发现和路由；物理 effect 的幂等性由 durable ledger 约束。

> `CapabilityRegistry` / `LocalToolHost` / `ReadTracker` / `ToolHooks` —— 工具路由与宿主基础设施。
> Layer 5 — 依赖：`@qiongqi/contracts`、`@qiongqi/domain`、`@qiongqi/ports`、`@qiongqi/adapter-fs`、`@qiongqi/tool-infra`、`@qiongqi/services`、`@qiongqi/memory`、`@qiongqi/delegation`。

---

## 中文

### 1. 职责

本子模块聚焦于**工具的注册、路由、执行**基础设施：

- **`CapabilityRegistry`** —— 把多个 `CapabilityToolProvider` 合并成统一注册表；按 `ToolProviderKind` 过滤
- **`LocalToolHost`** —— 进程内工具执行宿主；按 name 路由；支持 `shouldAdvertise(context)` 动态门控
- **`ReadTracker`** —— 跟踪每线程的文件读取次数；model 重复 read 时给出"已读过"提示
- **`ToolHooks`** —— PreToolUse / PostToolUse 钩子机制

### 2. 公共 API

| 导出 | 类型 | 来源文件 | 一句话 |
|------|------|---------|--------|
| `ToolProviderKind` | type | `capability-registry.ts` / `tool-host.ts` | `'built-in' \| 'mcp' \| 'web' \| 'skill' \| 'memory' \| 'gui' \| 'delegation'` |
| `ToolProviderPolicy` | type | `capability-registry.ts` | `{ id, kind, enabled, available, reason? }` |
| `CapabilityToolProvider` | interface | `capability-registry.ts` | `{ id, kind, listTools, execute?, getPolicy? }` |
| `CapabilityRegistry` | class | `capability-registry.ts` | 多 provider 组合 |
| `LocalToolHost` | class | `local-tool-host.ts` | 进程内执行宿主 |
| `LocalToolHostOptions` | type | `local-tool-host.ts` | 构造配置 |
| `LocalTool` | type | `local-tool-host.ts` | `{ name, description, toolKind, inputSchema, policy, shouldAdvertise?, execute }` |
| `defineTool(spec)` | method | `local-tool-host.ts` | fluent factory |
| `ReadTracker` | class | `read-tracker.ts` | 线程级文件读取计数 |
| `ToolHooks` | class | `tool-hooks.ts` | PreToolUse / PostToolUse 钩子 |

### 3. 关键不变量

- **`CapabilityRegistry` 是只读组合**：providers 不可变；`enabled` 是 provider 自身的状态。
- **`LocalToolHost.execute` 包装在 `InflightTracker.run`**：保证 SSE begin/end 对平衡。
- **`shouldAdvertise(context)` 动态门控**：`create_plan` 工具在 `context.threadMode !== 'plan' && !context.guiPlan` 时**不**被 model 看到（防止 model 在普通 agent turn 里调用 plan 工具）。
- **`ReadTracker` 按 thread 重置**：turn 完成后清空（由 `LocalToolHost` 在 `cleanupTurn` 时调用）。
- **重复 read 触发 hint**：当某路径在同一线程被读 N 次，tool output 附加"该文件已读过"信息（不阻止 model 行为）。
- **`ToolHooks` Pre/Post 不抛错吞咽**：钩子失败只记录到 `hooksFailed` 计数，不中断 tool 执行（避免一个 bug 钩子破坏整 turn）。
- **工具分类与并行安全**：`ToolProviderKind='built-in' + kind 在 `PARALLEL_READ_ONLY_TOOL_NAMES` 内` → 可并行批处理（由 `ToolCallCoordinator` 判定）。

### 4. 行为规约

来自 `tests/capability-registry.test.ts` / `tests/builtin-tools.test.ts`：

- `CapabilityRegistry.register(provider) appends; does not replace`
- `CapabilityRegistry.listAvailableTools returns only enabled+available tools`
- `CapabilityRegistry.providersByKind(kind) filters by provider kind`
- `LocalToolHost.defineTool returns a LocalTool with the merged spec`
- `LocalToolHost.execute dispatches by name and respects abortSignal`
- `LocalToolHost.shouldAdvertise(context) gates per-turn visibility`
- `ReadTracker.touch(path) increments the per-thread count`
- `ReadTracker.touch fires a hint at threshold 2+ for the same path`
- `ReadTracker.reset(threadId) clears the per-thread state`
- `ToolHooks.pre fires before tool execute; tool result is unchanged on hook failure`
- `ToolHooks.post fires after tool execute; hook failure does not surface to the model`

### 5. 使用示例

```typescript
import {
  CapabilityRegistry,
  LocalToolHost,
  ReadTracker,
  ToolHooks,
} from '@qiongqi/adapter-tools'

// 1. 创建 LocalToolHost
const host = new LocalToolHost({
  workspace: '/work',
  readTracker: new ReadTracker(),
  hooks: new ToolHooks(),
})

// 2. 添加工具
const readTool = host.defineTool({
  name: 'read',
  description: 'Read a file',
  toolKind: 'tool_call',
  inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
  policy: { requiresApproval: false },
  shouldAdvertise: (ctx) => ctx.approvalPolicy !== 'never',
  execute: async (call, ctx) => {
    return { item: makeToolResultItem({ /* ... */ }) }
  },
})

// 3. 注册表组合
const registry = new CapabilityRegistry()
registry.register({
  id: 'built-in',
  kind: 'built-in',
  listTools: () => host.listTools(),
  execute: (call, ctx) => host.execute(call, ctx),
})
registry.register({ id: 'mcp', kind: 'mcp', listTools: () => mcpTools, execute: mcpExec })
registry.register({ id: 'web', kind: 'web', listTools: () => webTools, execute: webExec })

// 4. 列出全部可用工具
const tools = registry.listAvailableTools()

// 5. 钩子
host.hooks.pre('read', async (call, ctx) => {
  console.log('About to read:', call.arguments)
})
```

### 6. 关联文档

- 架构文档：[`../architecture.zh.md#3-包结构`](../architecture.zh.md#3-包结构)（§3.3 Layer 5 适配器层）
- 消费方：`@qiongqi/loop` 的 `PromptBuilder` 与 `ToolCallCoordinator` 消费
- 源文件：[`capability-registry.ts`](../../packages/adapters/adapter-tools/src/capability-registry.ts)、[`local-tool-host.ts`](../../packages/adapters/adapter-tools/src/local-tool-host.ts)、[`read-tracker.ts`](../../packages/adapters/adapter-tools/src/read-tracker.ts)、[`tool-hooks.ts`](../../packages/adapters/adapter-tools/src/tool-hooks.ts)
- 测试：[`../../tests/capability-registry.test.ts`](../../tests/capability-registry.test.ts)
