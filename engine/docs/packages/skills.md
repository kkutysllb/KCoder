# @qiongqi/skills

> v1.1.1。Skill 只注入能力和说明，不绕过任务 scope、模型授权、工具 ledger 或记忆隔离。

> Skill 运行时 + Plugin Host —— 引擎层之上的"能力挂载"机制。
> Layer 6 — 依赖：`@qiongqi/contracts`、`@qiongqi/ports`、`@qiongqi/adapter-tools`。

---

## 中文

### 1. 职责

`@qiongqi/skills` 提供**双 runtime + 技能生态基础设施**：

- **`SkillRuntime`** (v1 legacy) —— 通过 `skill.json` v1 schema 或 legacy `SKILL.md` frontmatter 加载
- **`SkillPluginHost`** (current) —— 通过 `SkillManifestV1`（specVersion 1.0）加载
- **`migrateLegacyManifest`** —— 把 v0 manifest 升级为 v1
- **MCP 桥接**（`collectSkillMcpServers`）—— 把 skill 自带的 MCP server 暴露给 CapabilityRegistry
- **命令注册表**（`collectCommands`）—— 收集 `/<cmd>` 命令
- **Marketplace**（`MarketplaceClient`）—— git-based 安装/更新/卸载

两套 runtime 共享同一**打分算法**：explicit mention 1000+ → command 900+ → prompt pattern 500+ → file-type 300+。

### 2. 公共 API

| 导出 | 类型 | 来源文件 | 一句话 |
|------|------|---------|--------|
| `SkillRuntime` | class | `skill-runtime.ts` | v1 legacy runtime |
| `SkillPluginHost` | class | `plugin-host.ts` | current v1 spec runtime |
| `LoadedSkillPlugin` | type | `plugin-host.ts` | 加载后的 plugin 描述 |
| `SkillPluginDiagnostics` | type | `plugin-host.ts` | 诊断信息 |
| `SkillActivation` | type | `plugin-host.ts` | 单次激活记录 |
| `SkillTurnResolution` | type | `plugin-host.ts` | `resolveTurn` 返回 |
| `SkillManifestV1` | zod schema | `manifest.ts` | v1 manifest |
| `migrateLegacyManifest` | function | `manifest.ts` | 旧 manifest 升级 |
| `buildSkillToolProvider` | function | `skill-tool-provider.ts` | 把 skill 作为 `CapabilityToolProvider`（kind=`'skill'`）|
| `SkillToolExecutor` | type | `skill-tool-provider.ts` | 工具执行器签名 |
| `ActiveSkillsLookup` | type | `skill-tool-provider.ts` | `(context) => readonly string[]` |
| `collectSkillMcpServers` | function | `skill-mcp-bridge.ts` | 收集 skill 声明的 MCP server |
| `collectCommands` | function | `skill-command-registry.ts` | 收集所有 skill 的命令 |
| `MarketplaceClient` | class | `marketplace.ts` | marketplace 客户端 |
| `parseMarketplaceManifest` | function | `marketplace.ts` | 解析 marketplace.json |
| `GitOperations` | type | `marketplace.ts` | git ops 抽象（可注入测试 mock）|
| `DEFAULT_ACTIVE_LIMIT` | const | `skill-runtime.ts` / `plugin-host.ts` | `3` |
| `DEFAULT_INSTRUCTION_BUDGET_BYTES` | const | `skill-runtime.ts` / `plugin-host.ts` | `24_000` |

### 3. 关键不变量

- **打分算法一致**：两 runtime 都用 `explicit(1000+) > command(900+) > prompt pattern(500+) > file-type(300+)`。
- **`specVersion: /^1\./`**：`migrateLegacyManifest` 用 `safeParse` 验证；任何不匹配 v1 的旧 manifest 自动升级（`manifest.ts:33`）。
- **MCP server ID 命名空间**：`<pluginId>__<serverName>` 防止跨 skill 冲突（`skill-mcp-bridge.ts:9`）。
- **MCP trust scope**：所有 skill MCP server 自动标 `trustScope: 'workspace'` + `trustedWorkspaceRoots: [workspace]`。
- **命令命名空间**：每个命令 ID 用 `skillId/cmdId` 前缀防止冲突（`skill-command-registry.ts`）。
- **byte budget enforcement**：`DEFAULT_INSTRUCTION_BUDGET_BYTES=24_000` —— `buildInjection` 用累计 byte counter 跳过超 budget 的低优先级 skill，但仍允许更小的 skill 注入。
- **`resolveTurn` 不返回 `allowedToolNames`**：源码注释（`plugin-host.ts:130-138`）—— bash/git 等必备工具**不**列入 skill 的 `tools.allowed`；engine 必须保证这些工具始终可用。
- **Marketplace 缓存**：`<dataDir>/.marketplace-cache` —— 避免重复 clone；`update` 用 `git pull --ff-only` 失败时回退到 `install`。
- **`legacy: boolean` 字段保留在 plugin 描述中**：用于 `diagnostics` 输出"该 skill 用的是 legacy manifest"提示。

### 4. 行为规约

来自 `tests/skill-runtime.test.ts` / `tests/plugin-host.test.ts` / `tests/manifest.test.ts` / `tests/marketplace.test.ts` / `tests/skill-mcp-bridge.test.ts` / `tests/skill-tool-provider.test.ts` / `tests/skill-command-registry.test.ts` / `tests/builtin-skills.test.ts`：

- `SkillRuntime.create loads skills from the configured roots`
- `SkillRuntime.resolveTurn returns skills ranked by score (explicit > command > prompt > file-type)`
- `SkillRuntime skips skills whose injection bytes exceed the budget`
- `SkillPluginHost.create supports both v1 manifest and legacy SKILL.md frontmatter`
- `SkillPluginHost.migrateLegacyManifest handles missing fields and applies defaults`
- `migrateLegacyManifest maps triggers → activation, derives commands[] from triggers.commands`
- `collectSkillMcpServers namespaces ids as <pluginId>__<serverName>`
- `collectCommands dedupes by cmd.id with skillId prefix`
- `MarketplaceClient.install clones the source to <dataDir>/<entryId>/`
- `MarketplaceClient.update pulls --ff-only with fallback to install`
- `MarketplaceClient.uninstall removes the directory`
- `buildSkillToolProvider only advertises a skill when the lookup includes its id`

### 5. 使用示例

```typescript
import { SkillPluginHost, buildSkillToolProvider } from '@qiongqi/skills'

// 1. 加载
const host = await SkillPluginHost.create({
  roots: ['/work/.qiongqi/skills', '<dataDir>/builtin-skills'],
  builtinRoot: '<dataDir>/builtin-skills',
  activeLimit: 3,
  instructionBudgetBytes: 24_000,
})

// 2. Resolve per turn
const result = host.resolveTurn({
  prompt: '/plan add login flow',
  workspace: '/work',
  filePaths: ['src/auth.ts'],
})
// {
//   activeSkillIds: ['plan'],
//   activations: [{ skillId, score, matchedBy: 'command', ... }],
//   instructions: '<skill_instructions>...',
//   injectedBytes: 1234,
// }

// 3. 作为 tool provider
const skillProvider = buildSkillToolProvider(
  host.list(),
  (ctx) => result.activeSkillIds,
  async (call, ctx) => host.executeSkill(call.toolName, ctx),
)
```

### 6. 关联文档

- 架构文档：[`../architecture.zh.md#3-包结构`](../architecture.zh.md#3-包结构)（§3.3 Layer 6 能力扩展层）
- 消费方：`@qiongqi/http` 的 `runtime-factory` 通过 `createToolMatrix` 装配 skill provider；`@qiongqi/loop/PromptBuilder` 调用 `resolveTurn` 注入到 `contextInstructions`
- 源文件：[`skill-runtime.ts`](../../packages/capabilities/skills/src/skill-runtime.ts)、[`plugin-host.ts`](../../packages/capabilities/skills/src/plugin-host.ts)、[`manifest.ts`](../../packages/capabilities/skills/src/manifest.ts)、[`skill-tool-provider.ts`](../../packages/capabilities/skills/src/skill-tool-provider.ts)、[`skill-mcp-bridge.ts`](../../packages/capabilities/skills/src/skill-mcp-bridge.ts)、[`skill-command-registry.ts`](../../packages/capabilities/skills/src/skill-command-registry.ts)、[`marketplace.ts`](../../packages/capabilities/skills/src/marketplace.ts)
- 测试：见上述 8 个测试文件
