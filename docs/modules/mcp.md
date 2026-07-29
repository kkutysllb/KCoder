# mcp 模块（mcp module）

> QiLin engine · mcp subsystem · 双语 / Bilingual

---

## 中文版

### 职责

`qilin.mcp` 是 Model Context Protocol（MCP）适配层。QiLin 既能作为 MCP 客户端消费外部 MCP 服务器的工具，也能通过缓存层减少重复发现。

- **客户端管理**：通过 `langchain-mcp-adapters` 包装 stdio / SSE / HTTP MCP 服务器
- **连接池**：按工具调用复用连接，避免每次跑 agent 都重新拉取
- **工具缓存**：`cache.py` 把 MCP 服务器返回的工具列表按 `config.extensions_config` 的 schema 缓存
- **元数据**：`tools/mcp_metadata.py` 在 LangChain Tool 上贴 `mcp_sourced` 标签
- **路由中间件**：`agents/middlewares/mcp_routing_middleware.py` 按工具调用的 metadata 决定路由
- **初始化钩子**：`initialize_mcp_tools()` 在每个 Agent 构造时刷新一次

### 关键文件

| 文件 | 作用 |
|------|------|
| `mcp/tools.py` | MCP 客户端 + 工具获取 |
| `mcp/cache.py` | 工具列表缓存 |
| `mcp/__init__.py` | 对外 API：`initialize_mcp_tools`、`get_cached_mcp_tools` 等 |

### 设计要点

1. **懒启动**：MCP 子进程只在第一个 Agent 调用时启动，避免 import 期副作用。
2. **缓存失效**：当 `extensions_config` 内容签名变化时，主动失效缓存。
3. **协议多态**：同时支持 stdio / sse / streamable_http 三种传输，通过 `extensions_config.mcp_servers[*].transport` 字段选择。
4. **安全审计**：所有 MCP 工具都被打 `mcp_sourced` 标签，便于在日志与审计中识别其来源。

### 配置示例

```yaml
# config.yaml
extensions:
  mcp_servers:
    - name: github
      transport: stdio
      command: mcp-server-github
      args: []
    - name: notion
      transport: sse
      url: https://mcp.example.com/notion
```

### 关联模块

- **上游**：`config/extensions_config.py`
- **下游**：`tools/tools.py` 在装配工具集时调用 `initialize_mcp_tools()`，并通过 `tag_mcp_tool()` 给工具打标签
- **横切**：`tracing/` 把 MCP 工具调用上报 Langfuse

---

## English Version

### Responsibility

`qilin.mcp` is QiLin's Model Context Protocol adapter. QiLin is both:

- **MCP client** — Consume tools from external MCP servers
- **MCP-aware runtime** — Use caching layer to avoid re-discovery

- **Client management** — Wraps stdio / SSE / HTTP MCP servers via `langchain-mcp-adapters`
- **Connection pooling** — Reuses connections across agent invocations
- **Tool cache** — `cache.py` caches tool lists per `extensions_config` schema
- **Metadata** — `tools/mcp_metadata.py` tags tools with `mcp_sourced`
- **Routing middleware** — `mcp_routing_middleware.py` routes calls based on metadata
- **Init hook** — `initialize_mcp_tools()` refreshes once per Agent construction

### Key Files

| File | Purpose |
|------|---------|
| `mcp/tools.py` | MCP client + tool fetch |
| `mcp/cache.py` | Tool list cache |
| `mcp/__init__.py` | Public API: `initialize_mcp_tools`, `get_cached_mcp_tools` |

### Design Highlights

1. **Lazy spawn** — MCP sub-processes are spawned at first Agent call, not at import time.
2. **Cache invalidation** — Cache is invalidated when `extensions_config` signature changes.
3. **Multi-transport** — stdio / sse / streamable_http selected via `mcp_servers[*].transport`.
4. **Auditability** — All MCP tools are tagged `mcp_sourced` for log / audit traceability.

### Config Example

```yaml
extensions:
  mcp_servers:
    - name: github
      transport: stdio
      command: mcp-server-github
    - name: notion
      transport: sse
      url: https://mcp.example.com/notion
```

### Related Modules

- **Upstream** — `config/extensions_config.py`
- **Downstream** — `tools/tools.py` calls `initialize_mcp_tools()` and tags tools via `tag_mcp_tool()`
- **Cross-cutting** — `tracing/` reports MCP tool calls to Langfuse
