# tools 模块（tools module）

> QiLin engine · tools subsystem · 双语 / Bilingual

---

## 中文版

### 职责

`qilin.tools` 负责把"声明在配置里"的工具真正绑定到 LangGraph Runtime，并提供扩展点供子代理、技能、MCP、ACP 接入。所有工具通过统一的 `Runtime` 类型参数，与运行上下文（用户、线程、trace_id）解耦。

- **工具装配**：`tools.py` 中的 `get_available_tools()` 根据 `AppConfig.tools` / `tool_groups` 装配运行时工具集
- **MCP 工具注入**：`tools.py` 启动时通过 `initialize_mcp_tools()` 把外部 MCP Server 的工具纳入运行时
- **内建工具集**（`tools/builtins/`）：
  - `task_tool`：触发子代理
  - `invoke_acp_agent_tool`：触发 ACP 外部代理
  - `clarification_tool`：向用户提问
  - `present_file_tool`：让用户浏览工作区文件
  - `list_uploaded_files_tool`：列出用户上传
  - `view_image_tool`：查看图片
  - `setup_agent_tool` / `update_agent_tool`：创建 / 修改自定义 Agent 定义
  - `tool_search`：按需发现工具（延迟加载）
  - `review_skill_package_tool`：触发技能复核
  - `skill_manage_tool`：技能管理 CRUD
- **同步封装**：`sync.py` 的 `make_sync_tool_wrapper()` 为同步流式 API 桥接 async tool
- **元数据**：`mcp_metadata.py` 给 MCP 工具贴 `mcp_sourced` 标签，统一审计与路由

### 关键文件

| 文件 | 作用 |
|------|------|
| `tools/tools.py` | `get_available_tools()` 工具装配入口 |
| `tools/types.py` | `Runtime` TypedDict（用户、线程、trace_id 等上下文） |
| `tools/sync.py` | async → sync 工具包装 |
| `tools/mcp_metadata.py` | MCP 工具元数据标签 |
| `tools/skill_manage_tool.py` | 技能管理工具 |
| `tools/builtins/` | 内置工具集 |

### 设计要点

1. **声明 - 装配分离**：工具通过 `ToolConfig` 在 YAML 中声明，运行时按需装配，方便热重载新增工具而无需重启。
2. **统一 Runtime**：`Runtime` 是 LangChain Tool 调用时的统一字典，包含用户、线程、trace、agent 等上下文，避免工具与运行时耦合。
3. **延迟发现**：`tool_search` 工具实现"按需探索工具"，缓解长 prompt 里工具列表污染 token 的问题。
4. **MCP 一等公民**：所有 MCP 工具都被 `tag_mcp_tool()` 打标签，便于单独的路由 / 去重 / 限流。
5. **ACP 桥接**：`invoke_acp_agent_tool` 把 ACP 协议的外部代理封装为 QiLin 工具，使 QiLin 自身成为一个 ACP Client。

### 触发链路

```
LLM 决定 → tools/tools.py: get_available_tools() → 配置 + MCP + ACP
            ↓
        LangChain 实际调用 → Runtime 注入 → 工具执行
                              ↓
                  sync_wrapper (供同步客户端)
```

### 关联模块

- **上游**：`config/tool_config.py` 提供声明；`mcp/` 提供 MCP Server 连接
- **下游**：被 `agents/lead_agent/agent.py` 在 `build_middlewares()` 中绑定到 LangGraph

---

## English Version

### Responsibility

`qilin.tools` binds "tools declared in config" to the LangGraph Runtime and exposes extension points for sub-agents, skills, MCP, and ACP. All tools use a unified `Runtime` typed parameter so they stay decoupled from run context (user, thread, trace_id).

- **Tool assembly** — `get_available_tools()` assembles tools from `AppConfig.tools` / `tool_groups`
- **MCP injection** — `initialize_mcp_tools()` brings external MCP server tools into the runtime
- **Built-ins** (under `tools/builtins/`):
  - `task_tool` — Spawn sub-agent
  - `invoke_acp_agent_tool` — Call external ACP agent
  - `clarification_tool` — Ask user a clarifying question
  - `present_file_tool` — Show user a workspace file
  - `list_uploaded_files_tool` — List user uploads
  - `view_image_tool` — Inspect image
  - `setup_agent_tool` / `update_agent_tool` — Create / edit custom Agent definition
  - `tool_search` — Discover tools on demand
  - `review_skill_package_tool` — Trigger skill review
  - `skill_manage_tool` — Skill CRUD
- **Sync wrapper** — `sync.py` exposes async→sync bridge for sync-streaming clients
- **Metadata** — `mcp_metadata.py` tags MCP tools with `mcp_sourced` for routing / audit

### Key Files

| File | Purpose |
|------|---------|
| `tools/tools.py` | `get_available_tools()` entry |
| `tools/types.py` | `Runtime` TypedDict |
| `tools/sync.py` | async → sync wrapper |
| `tools/mcp_metadata.py` | MCP tool tag |
| `tools/skill_manage_tool.py` | Skill management tool |
| `tools/builtins/` | Built-in tools |

### Design Highlights

1. **Declarative-assembly separation** — Tools declared as `ToolConfig` in YAML; assembled at runtime so new tools can be hot-added.
2. **Unified Runtime** — `Runtime` is a single TypedDict passed to every LangChain tool, holding user / thread / trace / agent context.
3. **Lazy discovery** — `tool_search` lets the LLM discover tools on demand, avoiding long prompt bloat.
4. **MCP as first-class** — All MCP tools are tagged via `tag_mcp_tool()` for routing / dedup / rate-limit.
5. **ACP bridging** — `invoke_acp_agent_tool` wraps ACP external agents as QiLin tools, making QiLin itself an ACP client.

### Trigger Chain

```
LLM decides → get_available_tools() → config + MCP + ACP
   → LangChain Tool call → Runtime injection → tool execution
                                     → sync_wrapper (for sync clients)
```

### Related Modules

- **Upstream** — `config/tool_config.py` for declarations; `mcp/` for MCP server connections
- **Downstream** — bound into LangGraph via `agents/lead_agent/agent.py: build_middlewares()`
