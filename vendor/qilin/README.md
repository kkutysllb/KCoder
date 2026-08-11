<p align="center">
  <img src="docs/assets/qilin-hero.png" alt="QiLin 麒麟智能体引擎" width="640" />
</p>

# QiLin

> 中文版（Chinese version follows below）· [English Version](#english-version)

**QiLin** —— 生产级的智能体（Agent）引擎。
一个统一的 Python 包，把 LangGraph 状态机、模型调用、工具/技能生态、子代理递归、沙箱隔离、权限模型、可观测性与定时调度整合在同一二进制 / 同进程中运行。

- **包名称 / Package**：`qilin`
- **核心代码量 / Codebase**：约 517 文件，25 个子模块
- **Python 版本 / Python**：≥ 3.12
- **CLI**：`qilin`
- **版本路线 / Roadmap**：v1.0.0 单智能体框架 → **v2.0.0 多智能体框架（当前）**

## ✨ 核心能力 / Core Capabilities

| 中文 | English |
|------|---------|
| 嵌入式 & 服务化双模运行 | Embedded or service-mode runtime |
| 25 个高内聚子系统 | 25 cohesive subsystems |
| LangGraph 兼容的内核 | LangGraph-compatible kernel |
| 多 Provider 模型适配（OpenAI / Anthropic / DeepSeek / Gemini / Ollama） | Multi-provider model adapters |
| 子代理递归 + 独立 checkpoint | Recursive sub-agents with independent checkpoints |
| 多智能体编排（single/multi 配置切换 + 并行批次 + 协作模式） | Multi-agent orchestration (single/multi mode switch, parallel batch, collaboration patterns) |
| HTTP Agent Server（REST API + JWT 认证 + CSRF + GitHub Webhook） | HTTP Agent Server (REST API + JWT auth + CSRF + GitHub webhooks) |
| 8 大 IM 渠道接入（飞书/Discord/Slack/Telegram/钉钉/企微/微信/GitHub） | 8 IM channel adapters (Feishu/Discord/Slack/Telegram/DingTalk/WeCom/WeChat/GitHub) |
| 多沙箱后端（Local / aio_sandbox / boxlite / E2B / Tenki） | Multi-backend sandbox |
| RBAC 风格的资源授权 | RBAC-style resource authorization |
| Langfuse / Monocle 双 trace 适配 | Langfuse / Monocle trace adapters |
| 技能市场 + 静态/动态扫描 | Skill catalog with static + dynamic scanning |
| SkillACP 兼容（Agent Client Protocol） | ACP-compatible (Agent Client Protocol) |

## 📦 安装 / Installation

```bash
# 基础安装（仅内核）
pip install qilin

# 含 TUI 工作台
pip install "qilin[tui]"

# 完整可选功能
pip install "qilin[postgres,redis,tenki,monocle,browser,boxlite]"
```

可选 Extras：

| Extra | 引入 |
|-------|------|
| `tui` | Textual 终端 UI |
| `postgres` | asyncpg + langgraph-checkpoint-postgres |
| `redis` | Redis 流桥 |
| `monocle` | OpenTelemetry 观测 |
| `tenki` | Tenki 云沙箱 |
| `boxlite` | BoxLite 内核级沙箱 |
| `browser` | Playwright 浏览器自动化 |
| `pymupdf` | PyMuPDF Llama-text 增强 |
| `memory-zh` | jieba 中文分词 |
| `ollama` | Ollama 本地模型 |
| `groundroute` | GroundRoute 自定义检索 |
| `gateway` | FastAPI HTTP Agent Server（uvicorn / PyJWT / bcrypt） |
| `channels` | IM 渠道 SDK（钉钉 / Discord / 飞书 / Slack / Telegram 等） |

## 🚀 快速开始 / Quick Start

### Python API（嵌入式 / Embedded）

```python
from qilin.client import QiLinClient

client = QiLinClient()

# 一次性问答
answer = client.chat("解释一下 Transformer 的自注意力机制。", thread_id="my-thread")
print(answer)

# 流式事件
for event in client.stream("继续上一段对话"):
    print(event.type, event.data)
```

### TUI（终端 UI / Terminal Workbench）

```bash
# 启动 TUI（需 TTY）
qilin

# 一次性回答
qilin --print "What is the capital of France?"

# JSON 流式
echo "What is 2+2?" | qilin --json
```

### 配置 / Configuration

将 `config.example.yaml` 拷贝为 `config.yaml`，填入至少一个 model：

```yaml
models:
  - name: openai-gpt4
    provider: openai
    model: gpt-4o
    api_key: ${OPENAI_API_KEY}

sandbox:
  type: aio_sandbox
  provider: qilin.community.aio_sandbox.aio_sandbox_provider:AioSandboxProvider
```

### Agent Server（HTTP 服务 / Service Mode）

```bash
# 安装服务端依赖
pip install "qilin[gateway,channels]"

# 启动 HTTP Agent Server
uvicorn app.gateway.app:app --port 8080
```

服务端提供 agents / threads / runs / memory / skills / mcp / uploads / channels 等 REST API，
详见 [gateway 模块文档](docs/modules/gateway.md)；IM 渠道接入见 [channels 模块文档](docs/modules/channels.md)。

## 📂 项目结构 / Project Layout

```
.
├── pyproject.toml         # 包元信息 + CLI 注册
├── qilin/                 # 核心引擎代码（517 文件）
│   ├── client.py          # QiLinClient 嵌入式入口
│   ├── constants.py       # 共享运行时常量
│   ├── agents/            # Lead Agent + 中间件 + 记忆后端
│   ├── subagents/         # 子代理执行器 + 注册中心
│   ├── orchestration/     # 多智能体编排（handoff/图/消息总线/协作）
│   ├── tools/             # 工具注册与装配
│   ├── skills/            # 技能系统（含扫描器）
│   ├── mcp/               # MCP 协议适配
│   ├── runtime/           # LangGraph 运行 + checkpoint + 流桥
│   ├── persistence/       # 多后端持久化层
│   ├── scheduler/         # 定时任务调度
│   ├── config/            # Pydantic 配置 + 热重载
│   ├── sandbox/           # 沙箱抽象层
│   ├── guardrails/        # 安全护栏中间件
│   ├── authz/             # RBAC 资源授权
│   ├── tracing/           # Langfuse / Monocle 追踪
│   ├── reflection/        # 变量解析（SkillACP）
│   ├── community/         # 第三方生态（搜索、沙箱等）
│   ├── integrations/      # Lark 等第三方渠道
│   ├── models/            # 模型适配
│   ├── tui/               # Textual 终端 UI
│   ├── uploads/           # 用户上传管理
│   ├── utils/             # 通用工具
│   └── workspace_changes/ # 工作区变更追踪
├── app/                   # 服务面（HTTP Agent Server + IM 渠道，随 wheel 分发）
│   ├── gateway/           # FastAPI HTTP Agent Server（REST + 认证 + webhook）
│   ├── channels/          # IM 渠道接入层（8 大渠道）
│   └── scheduler/         # 定时任务 HTTP 调度服务
├── docs/                  # 项目文档（架构 + 各模块详解）
│   ├── architecture.md
│   └── modules/*.md       # 24 份模块文档
└── README.md              # 本文件
```

## 📑 文档导航 / Documentation Index

| 文档 | Document | 简介 / Summary |
|------|----------|----------------|
| [架构总览](docs/architecture.md) | [Architecture](docs/architecture.md) | 三层架构、运行机制、可观测性、安全模型 |
| [gateway 模块](docs/modules/gateway.md) | [gateway](docs/modules/gateway.md) | HTTP Agent Server（REST API + 认证） |
| [channels 模块](docs/modules/channels.md) | [channels](docs/modules/channels.md) | IM 渠道接入（8 大渠道） |
| [agents 模块](docs/modules/agents.md) | [agents](docs/modules/agents.md) | Lead Agent 工厂与中间件链 |
| [subagents 模块](docs/modules/subagents.md) | [subagents](docs/modules/subagents.md) | 子代理执行与注册 |
| [orchestration 模块](docs/modules/orchestration.md) | [orchestration](docs/modules/orchestration.md) | 多智能体编排（handoff/图/消息总线/协作模式） |
| [tools 模块](docs/modules/tools.md) | [tools](docs/modules/tools.md) | 工具装配流水线 |
| [skills 模块](docs/modules/skills.md) | [skills](docs/modules/skills.md) | 技能系统 |
| [mcp 模块](docs/modules/mcp.md) | [mcp](docs/modules/mcp.md) | MCP 协议适配 |
| [runtime 模块](docs/modules/runtime.md) | [runtime](docs/modules/runtime.md) | LangGraph 运行 + checkpoint |
| [persistence 模块](docs/modules/persistence.md) | [persistence](docs/modules/persistence.md) | 持久化层 |
| [scheduler 模块](docs/modules/scheduler.md) | [scheduler](docs/modules/scheduler.md) | 定时任务 |
| [config 模块](docs/modules/config.md) | [config](docs/modules/config.md) | 配置与热重载 |
| [sandbox 模块](docs/modules/sandbox.md) | [sandbox](docs/modules/sandbox.md) | 沙箱抽象 |
| [guardrails 模块](docs/modules/guardrails.md) | [guardrails](docs/modules/guardrails.md) | 安全护栏 |
| [authz 模块](docs/modules/authz.md) | [authz](docs/modules/authz.md) | 资源授权 |
| [tracing 模块](docs/modules/tracing.md) | [tracing](docs/modules/tracing.md) | 可观测性追踪 |
| [reflection 模块](docs/modules/reflection.md) | [reflection](docs/modules/reflection.md) | 变量解析 |
| [models 模块](docs/modules/models.md) | [models](docs/modules/models.md) | 模型适配层 |
| [community 模块](docs/modules/community.md) | [community](docs/modules/community.md) | 第三方生态 |
| [integrations 模块](docs/modules/integrations.md) | [integrations](docs/modules/integrations.md) | 渠道集成 |
| [tui 模块](docs/modules/tui.md) | [tui](docs/modules/tui.md) | 终端 UI |
| [uploads 模块](docs/modules/uploads.md) | [uploads](docs/modules/uploads.md) | 用户上传 |
| [utils 模块](docs/modules/utils.md) | [utils](docs/modules/utils.md) | 通用工具 |
| [workspace_changes 模块](docs/modules/workspace_changes.md) | [workspace_changes](docs/modules/workspace_changes.md) | 工作区变更 |

## ⚙️ 系统要求 / Requirements

- Python ≥ 3.12
- macOS / Linux（亦支持 WSL2）
- 可选：Docker（用于 `aio_sandbox`）
- 可选：PostgreSQL ≥ 13、Redis ≥ 5（如启用）

## 📜 许可证 / License

Apache-2.0

---

## English Version

**QiLin** — a production-grade agent engine.
A single Python package that consolidates LangGraph state machines, model orchestration, tool/skill ecosystems, recursive sub-agents, sandbox isolation, fine-grained authorization, observability, and scheduled tasks — all in one binary / one process.

- **Package**：`qilin`
- **Codebase**：~517 files, 25 sub-modules
- **Python**：≥ 3.12
- **CLI**：`qilin`
- **Roadmap**：v1.0.0 single-agent → **v2.0.0 multi-agent (current)**

### ✨ Core Capabilities

| Capability |
|------------|
| Embedded or service-mode runtime |
| 25 cohesive subsystems |
| LangGraph-compatible kernel |
| Multi-provider model adapters (OpenAI / Anthropic / DeepSeek / Gemini / Ollama) |
| Recursive sub-agents with independent checkpoints |
| Multi-agent orchestration (single/multi mode switch, parallel batch, collaboration patterns) |
| HTTP Agent Server (REST API + JWT auth + CSRF + GitHub webhooks) |
| 8 IM channel adapters (Feishu/Discord/Slack/Telegram/DingTalk/WeCom/WeChat/GitHub) |
| Multi-backend sandbox (Local / aio_sandbox / boxlite / E2B / Tenki) |
| RBAC-style resource authorization |
| Langfuse / Monocle trace adapters |
| Skill catalog with static + dynamic scanning |
| ACP-compatible (Agent Client Protocol) |

### 📦 Installation

```bash
# Core installation (kernel only)
pip install qilin

# With TUI workbench
pip install "qilin[tui]"

# All optional features
pip install "qilin[postgres,redis,tenki,monocle,browser,boxlite]"

# Agent Server / IM channels
pip install "qilin[gateway,channels]"
```

### 🚀 Quick Start

```python
from qilin.client import QiLinClient

client = QiLinClient()
print(client.chat("Explain the transformer self-attention mechanism.", thread_id="my-thread"))
```

```bash
# Interactive TUI
qilin
# One-shot
qilin --print "What is the capital of France?"
# JSON streaming
echo "What is 2+2?" | qilin --json
```

### 📂 Project Layout

```
.
├── pyproject.toml         # Package metadata + CLI registration
├── qilin/                 # Core engine (517 files, 25 sub-modules)
│   ├── client.py          # QiLinClient — embedded entry
│   ├── constants.py       # Shared runtime constants
│   ├── agents/            # Lead Agent + middlewares + memory backends
│   ├── subagents/         # Sub-agent executor + registry
│   ├── orchestration/     # Multi-agent orchestration (handoff/graph/bus/patterns)
│   ├── tools/             # Tool registry & assembly
│   ├── skills/            # Skill system
│   ├── mcp/               # MCP adapters
│   ├── runtime/           # LangGraph runner + checkpoint + stream bridge
│   ├── persistence/       # Multi-backend storage
│   ├── scheduler/         # Cron / one-shot tasks
│   ├── config/            # Pydantic config + hot reload
│   ├── sandbox/           # Sandbox abstraction
│   ├── guardrails/        # Safety middleware
│   ├── authz/             # RBAC authorization
│   ├── tracing/           # Langfuse / Monocle
│   ├── reflection/        # SkillACP variable resolution
│   ├── community/         # 3rd-party ecosystem (search, sandbox, ...)
│   ├── integrations/      # Lark, Lark CLI, ...
│   ├── models/            # Model adapters
│   ├── tui/               # Textual terminal UI
│   ├── uploads/           # Upload management
│   ├── utils/             # Generic utilities
│   └── workspace_changes/ # Workspace change tracker
├── app/                   # Service surface (HTTP Agent Server + IM channels, shipped in the wheel)
│   ├── gateway/           # FastAPI HTTP Agent Server (REST + auth + webhooks)
│   ├── channels/          # IM channel adapters (8 channels)
│   └── scheduler/         # Scheduled-task HTTP service
├── docs/
│   ├── architecture.md
│   └── modules/*.md       # 21 module docs
└── README.md              # This file
```

### ⚙️ Requirements

- Python ≥ 3.12
- macOS / Linux (WSL2 supported)
- Optional: Docker (for `aio_sandbox`)
- Optional: PostgreSQL ≥ 13, Redis ≥ 5

### 📜 License

Apache-2.0
