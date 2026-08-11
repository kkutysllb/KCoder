# QiLin v1.0.0 · 首个正式稳定版本发布 / First Stable Release

> 发布时间 / Released: **2026-07-29**
> Tag: `v1.0.0` · Commit: `4094d75`
> 来源 / Origin: extracted from `bytedance/deer-flow` (`backend/packages/harness/deerflow`)
> 重命名 / Renamed: `deerflow` → **`qilin`**

---

## 🎉 概述 / Overview

QiLin 是一个面向生产环境的 **Python 智能体运行时引擎 (agent harness engine)**，基于 LangGraph 构建。它将模型调用、工具执行、子智能体协作、沙箱隔离、记忆与可观测性整合在同一个可插拔的运行时之内，既可作为嵌入式客户端直接调用，也可以作为独立服务通过 HTTP/SDK 对外暴露。

**QiLin** is a production-grade **Python agent harness engine** built on LangGraph. It unifies model invocation, tool execution, sub-agent collaboration, sandbox isolation, memory, and observability under one pluggable runtime — usable either as an embedded client or as a standalone service over HTTP/SDK.

---

## 🗺️ 版本路线 / Version Roadmap

| 版本 / Version | 定位 / Positioning | 状态 / Status |
|---|---|---|
| **v1.0.0** | **单智能体框架 / Single-agent framework** — lead agent + 工具式子代理委派 | ✅ 当前版本 / Current |
| **v2.0.0** | **多智能体框架 / Multi-agent framework** — 编排拓扑、agent 间通信、handoff 协议、并行批次与协作模式 | 🔧 开发中 / In development |

v1.0.0 的架构形态为"单主代理 + 工具式子代理"（hierarchical delegation）：全部控制流由 lead agent 主导，子代理经 `task_tool` 委派、调用-返回、用完即弃。v2.0.0 在该基座上演进为真正的多智能体框架，核心改造（2026-08-07 起）：

- **配置选择单/多 agent**：`orchestration.mode: single | multi`（`make_lead_agent` 按模式构建 v1 lead 图或 OrchestratorGraph；单次请求可 runtime 临时覆盖，切换需重启）
- **P0 执行层**：`subagents/batch` 并行批次执行（有界并发 + 失败隔离 + 保序）
- **P1 编排层**：handoff 协议（`AgentHandoff` / `HandoffResult` / `HandoffError`）、`OrchestratorGraph`（orchestrator + worker 节点、按 `to_agent` 路由、`max_rounds` 防死循环）、`orchestration` 配置段（`AgentSpec` worker 注册表）
- **P2 协作层**：`AgentInbox` 消息总线（每 agent 队列 + 订阅广播）、`orchestrator_workers` / `peer_consensus` 协作模式
- **P3 治理与可观测**：agent 身份（`normalize_agent_identity`）、per-agent token 配额（`TokenBudgetConfig.per_agent`）、跨 agent trace 关联（`qilin_trace_id` 注入 handoff）

测试基线从 54 增至 128（P0-P3 + 模式切换全部配套测试）。

---

## ✨ 核心亮点 / Highlights

- 🔌 **双模引擎 / Dual-mode Runtime** — 同一套代码同时支持 **embedded 模式**（进程内 LangGraph 执行器）与 **service 模式**（LangGraph Server 部署）。
- 🧠 **子智能体一等公民 / Sub-agents as First-class Citizens** — 子智能体拥有独立的 checkpoint、token 计量与状态契约，递归调用不需要 ad-hoc hack。
- 📦 **可插拔沙箱 / Pluggable Sandbox** — 同一接口下抽象了 `local`、`aio_sandbox`、`boxlite`、`e2b`、`tenki` 五种执行后端。
- 🗄️ **多后端持久化 / Multi-backend Persistence** — 同一仓储接口可在 SQLite（开发）与 PostgreSQL（生产）间切换，含 Alembic 迁移。
- 🛡️ **基于 Casbin 的 RBAC / Casbin-based RBAC** — 资源与角色级别授权。
- 🔍 **双追踪后端 / Dual Tracing Backends** — 同 trace 上同时往 **Langfuse** 与 **Monocle** 推送观测数据。
- 🧰 **Skill Marketplace / Skill 市场** — Markdown 描述的技能包，支持双层审阅 + 安全静态扫描。
- 🔁 **热重载 / Hot Reload** — 基于配置签名的运行时重载，无需重启进程。
- 🤝 **MCP + ACP 协议 / MCP & ACP** — 外部工具接入 + 跨进程智能体调用。

---

## 📚 子系统清单 / Subsystem Inventory (20 modules)

| 模块 / Module | 功能 / Responsibility |
|---|---|
| `agents` | 内置智能体 + 子智能体 + 记忆后端 / Built-in agents + memory backends |
| `authz` | Casbin RBAC 资源授权 / Resource-level authorization |
| `community` | Skill 包社区分享与导入 / Community skill sharing |
| `config` | Pydantic 配置 + 热重载 + YAML 加载 / Hot-reloadable config |
| `guardrails` | 结构化输出与请求校验 / Structured output validation |
| `integrations` | GitHub / GitLab / Notion / Slack 适配 / External platform adapters |
| `mcp` | Model Context Protocol 客户端 / MCP client + tool bridge |
| `models` | LLM 提供商 + 嵌入 + 重排序 / LLM + embeddings + rerankers |
| `persistence` | SQLAlchemy + Alembic (SQLite / PostgreSQL) |
| `reflection` | 会话反思与轨迹抽取 / Conversation reflection |
| `runtime` | LangGraph 运行时 + 双模引擎 / Dual-mode engine |
| `sandbox` | 可插拔沙箱 / Pluggable sandbox abstraction |
| `scheduler` | 内置定时调度器 / Built-in scheduler |
| `skills` | Markdown skill 注册与执行 (含 `skillscan` 静态扫描 + 双层 review) |
| `subagents` | 子智能体递归调用 / Sub-agent recursion |
| `tools` | 内置工具集 / Built-in tools (search, RAG, files, code execution, uploads) |
| `tracing` | Langfuse + Monocle 双追踪后端 / Dual tracing providers |
| `tui` | Textual 终端 UI + CLI / Terminal UI |
| `uploads` | 附件上传与处理 / Attachment upload & processing |
| `utils` | 通用工具 / Cross-cutting utilities |
| `workspace_changes` | 工作区变更追踪 / Workspace change tracking |

---

## 📖 文档 / Documentation

所有文档均为 **中英双语** / All documentation is **bilingual (Chinese + English)**：

- [`README.md`](../../blob/v1.0.0/README.md) — 项目说明
- [`docs/architecture.md`](../../blob/v1.0.0/docs/architecture.md) — 整体技术架构（485 行）
- [`docs/modules/*.md`](../../tree/v1.0.0/docs/modules) — 21 个子模块技术文档

```

$ tree docs/

docs/
├── architecture.md
└── modules/
    ├── agents.md
    ├── authz.md
    ├── community.md
    ├── config.md
    ├── guardrails.md
    ├── integrations.md
    ├── mcp.md
    ├── models.md
    ├── persistence.md
    ├── reflection.md
    ├── runtime.md
    ├── sandbox.md
    ├── scheduler.md
    ├── skills.md
    ├── subagents.md
    ├── tools.md
    ├── tracing.md
    ├── tui.md
    ├── uploads.md
    ├── utils.md
    └── workspace_changes.md
```

---

## 📦 安装 / Installation

```bash
# 核心 / Core
pip install qilin

# 可选附加 / Optional extras
pip install 'qilin[postgres]'      # PostgreSQL 后端
pip install 'qilin[redis]'         # Redis 流桥
pip install 'qilin[tui]'           # 终端 UI
pip install 'qilin[boxlite]'       # BoxLite 沙箱
pip install 'qilin[tenki]'         # Tenki 沙箱
pip install 'qilin[monocle]'       # Monocle 追踪
pip install 'qilin[browser]'       # Playwright 浏览器工具
pip install 'qilin[memory-zh]'     # 中文分词记忆
pip install 'qilin[pymupdf]'       # PDF 解析
pip install 'qilin[ollama]'        # Ollama 模型
```

---

## 🚀 快速开始 / Quick Start

```bash
# 启动 TUI
qilin

# 启动 LangGraph 服务（service 模式）
qilin-serve

# Python 内嵌调用
python -c "from qilin import run_agent; print(run_agent('Hello, world'))"
```

最小配置示例（`config.yaml`）：

```yaml
qilin:
  model:
    provider: openai
    name: gpt-4o
  persistence:
    backend: sqlite
    path: ./qilin.db
  sandbox:
    backend: local
```

---

## 🔧 配置 / Configuration

| 环境变量 / Env Var | 默认值 / Default | 说明 / Description |
|---|---|---|
| `QILIN_MODEL_PROVIDER` | `openai` | LLM 提供商 |
| `QILIN_LOG_LEVEL` | `INFO` | 日志级别 |
| `QILIN_PERSISTENCE_BACKEND` | `sqlite` | 持久化后端 (`sqlite` / `postgres`) |
| `QILIN_SANDBOX_BACKEND` | `local` | 沙箱后端 (`local` / `aio_sandbox` / `boxlite` / `e2b` / `tenki`) |
| `QILIN_TRACING_ENABLED` | `false` | 开启追踪 |
| `QILIN_TRACING_PROVIDER` | `langfuse` | 追踪后端 (`langfuse` / `monocle` / `both`) |
| `QILIN_HOT_RELOAD` | `true` | 配置变更时热重载 |

完整配置见 `qilin/config/schema.py`。

---

## 💻 Python 要求 / Requirements

- Python **`>=3.12`**
- 依赖：LangGraph 1.2.9–1.3、LangChain 1.3、Pydantic 2.12+、SQLAlchemy 2（async）等，完整依赖见 `pyproject.toml`。

---

## 🔄 从原项目迁移 / Migration Notes

本版本是从 `bytedance/deer-flow` 的 `backend/packages/harness/deerflow` 子目录抽取并重命名而来。所有对外可见标识符已统一从 `deerflow` → `qilin`：

- Python 包名 / Package name: `deerflow` → **`qilin`**
- CLI 命令 / CLI: `deer` → **`qilin`**
- 内存后端 / Memory backend: `deermem` → **`qilinmem`**
- 类名 / Class names: `DeerFlow` → **`QiLin`**、 `DeerMem` → **`QiLinMem`**
- 环境变量 / Env vars: `DEERFLOW_*` / `DEER_FLOW_*` → **`QILIN_*`**
- 数据库文件 / DB files: `deer.db` → **`qilin.db`**

---

## 🐛 已知限制 / Known Limitations

- `service` 模式需要外部 Postgres + Redis（不在本仓库打包）。
- `boxlite` / `tenki` 沙箱后端需要对应的二进制包，仅在 `[boxlite]` / `[tenki]` extras 安装后可启用。

---

## 📜 许可证 / License

Apache-2.0 — 继承自 `bytedance/deer-flow`。

---

## 🙏 致谢 / Acknowledgements

本项目基于 **[bytedance/deer-flow](https://github.com/bytedance/deer-flow)** 的 harness 子模块开发，感谢其开源贡献。
