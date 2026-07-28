# @qiongqi/adapter-tools — 外部 Provider

> v1.1.4。外部 provider 通过通用 ToolHost 接入，不成为 Durable Engine 的事实源。

> MCP / Web / Memory / Delegation provider —— 工具生态的"血肉"。
> Layer 5 — 同 registry 子模块。

---

## 中文

### 1. 职责

本子模块把外部能力**注入**为工具：

- **MCP** —— 通过 Model Context Protocol stdio / streamable-http / SSE 拉取远端工具；BM25 搜索
- **Web** —— 受域策略限制的 web_fetch / web_search
- **Memory** —— `memory_create` / `memory_update` / `memory_delete` 暴露为工具
- **Delegation** —— `delegate_task` / `list_delegates` / `read_child_run` 暴露为工具

这些 provider 都实现 `CapabilityToolProvider` 接口，可被 `CapabilityRegistry` 组合。

### 2. 公共 API

| 导出 | 类型 | 来源文件 | 一句话 |
|------|------|---------|--------|
| `buildMcpToolProviders(config, mcpConfig?)` | function | `mcp-tool-provider.ts` | MCP provider 工厂；返回 `CapabilityToolProvider[]`（每个 server 一个 provider）|
| `isMcpServerTrusted(serverName)` | function | `mcp-tool-provider.ts` | 域信任检查 |
| `McpToolSearchIndex` / `searchMcpTools(index, query, limit)` | function | `mcp-tool-search.ts` | BM25 搜索 + 工具索引 |
| `mcpSearch` / `mcpDescribe` / `mcpCall` / `mcpRefreshCatalog` | function | `mcp-tool-search.ts` | model 可见的 MCP 工具（当 MCP search 开启时）|
| `ACTION_SYNONYMS` | const | `mcp-tool-search.ts` | BM25 同义词映射（含中文）|
| `buildWebToolProviders(config, webConfig?)` | function | `web-tool-provider.ts` | web provider 工厂 |
| `buildMemoryToolProviders(memoryStore)` | function | `memory-tool-provider.ts` | memory provider 工厂 |
| `buildDelegationToolProviders(delegationRuntime, skillRegistry?)` | function | `delegation-tool-provider.ts` | delegation provider 工厂 |

### 3. 关键不变量

- **MCP 三传输协议**：`stdio` / `streamable-http` / `SSE` 通过 `@modelcontextprotocol/sdk` 客户端适配。
- **MCP 工具命名空间**：server 提供的工具暴露为 `<serverName>__<toolName>`，防止跨 server 冲突。
- **MCP BM25 索引**：build 时基于工具 name + description + 中文同义词（`ACTION_SYNONYMS` 包含 '查' / '搜索' / '找' / '检索' 等）建立倒排索引。
- **`mcpRefreshCatalog`** 重建索引而不重启 server（model 主动调用）。
- **Web 域策略**：`allowedDomains` / `deniedDomains` 在 `web-tool-provider.ts` 内强制，URL 解析前过滤。
- **Web `sourceId` 确定性哈希**：`sourceIdFor`（在 `@qiongqi/ports`）用 djb2 风格 32-bit 哈希生成 `web_<kind>_<hash>` id。
- **Memory provider 直接复用 `FileMemoryStore`**：把 store 的 create / update / delete 方法包装为工具调用。
- **Delegation provider 调用 `DelegationRuntime.runChild`**：单次委派生成 child run record；`list_delegates` 列出活跃子代理；`read_child_run` 读取结果。
- **Provider 失败吞咽**：单个 provider 启动失败不影响其他 provider 加载。

### 4. 行为规约

来自 `tests/mcp-tool-provider.test.ts` / `tests/web-tool-provider.test.ts`：

#### MCP

- `buildMcpToolProviders returns one CapabilityToolProvider per configured server`
- `MCP tool list filters by capability.mcp.search.enabled when BM25 is on`
- `searchMcpTools returns tools ranked by BM25 score (name + description + Chinese synonyms)`
- `mcpSearch returns the top-K tools with metadata for the model to choose from`
- `mcpDescribe returns the full schema for a given tool`
- `mcpCall invokes the MCP server's tool and returns the result`
- `mcpRefreshCatalog rebuilds the BM25 index without restarting the server`
- `MCP stdio / streamable-http / SSE transports all supported via @modelcontextprotocol/sdk`
- `isMcpServerTrusted enforces the trust policy from capability.mcp.servers config`

#### Web

- `buildWebToolProviders returns web_fetch + web_search when enabled`
- `web_fetch enforces the allowedDomains/deniedDomains policy before issuing the HTTP request`
- `web_fetch respects the abortSignal and maxBytes/timeoutMs options`
- `web_search returns results ranked by provider rank + the search query`
- `sourceIdFor produces deterministic web_<kind>_<hash> ids (same URL → same id)`
- `web provider throws an explicit "URL not allowed" error when policy is violated`

#### Memory

- `buildMemoryToolProviders returns memory_create / memory_update / memory_delete tools`
- `memory_create / update / delete delegate to MemoryStore directly`
- `memory tools propagate the MemoryStore's errors (e.g. "not found")`

#### Delegation

- `buildDelegationToolProviders returns delegate_task / list_delegates / read_child_run tools`
- `delegate_task creates a ChildRunRecord and invokes DelegationRuntime.runChild`
- `list_delegates returns the current child run records for the parent thread`
- `read_child_run returns the child run summary + usage`

### 5. 使用示例

```typescript
import {
  buildMcpToolProviders,
  buildWebToolProviders,
  buildMemoryToolProviders,
  buildDelegationToolProviders,
} from '@qiongqi/adapter-tools'

// 1. MCP
const mcpProviders = buildMcpToolProviders(
  { workspace: '/work' },
  {
    enabled: true,
    search: { enabled: true, mode: 'auto', autoThresholdToolCount: 24, topKDefault: 5, topKMax: 10, minScore: 0.15, bm25: { k1: 1.2, b: 0.75 } },
    servers: { /* server configs */ },
  },
)

// 2. Web
const webProviders = buildWebToolProviders(
  { workspace: '/work' },
  {
    enabled: true,
    fetchEnabled: true,
    searchEnabled: true,
    allowDomains: ['github.com', 'docs.example.com'],
    denyDomains: [],
  },
)

// 3. Memory
const memoryProviders = buildMemoryToolProviders(memoryStore)

// 4. Delegation
const delegationProviders = buildDelegationToolProviders(delegationRuntime, skillRegistry)

// 5. 全部注册到 registry
const registry = new CapabilityRegistry()
;[...mcpProviders, ...webProviders, ...memoryProviders, ...delegationProviders].forEach((p) =>
  registry.register(p),
)
```

### 6. 关联文档

- 架构文档：[`../architecture.zh.md#3-包结构`](../architecture.zh.md#3-包结构)（§3.3 Layer 5 适配器层）
- 消费方：`@qiongqi/http` 的 `runtime-factory` 通过 `createToolMatrix` 装配这些 provider
- 源文件：[`mcp-tool-provider.ts`](../../packages/adapters/adapter-tools/src/mcp-tool-provider.ts)、[`mcp-tool-search.ts`](../../packages/adapters/adapter-tools/src/mcp-tool-search.ts)、[`web-tool-provider.ts`](../../packages/adapters/adapter-tools/src/web-tool-provider.ts)、[`memory-tool-provider.ts`](../../packages/adapters/adapter-tools/src/memory-tool-provider.ts)、[`delegation-tool-provider.ts`](../../packages/adapters/adapter-tools/src/delegation-tool-provider.ts)
- 测试：[`../../tests/mcp-tool-provider.test.ts`](../../tests/mcp-tool-provider.test.ts)、[`../../tests/web-tool-provider.test.ts`](../../tests/web-tool-provider.test.ts)
