# QiLin v2.0.0 · 多智能体框架发布 / Multi-Agent Framework Release

> 发布时间 / Released: **2026-08-07**
> Tag: `v2.0.0`（待打标）· Commit: `7c2896c`
> 里程碑 / Milestone: v1.0.0（单智能体）→ **v2.0.0（多智能体 + 服务面）**

---

## 🎉 概述 / Overview

v2.0.0 在 v1.0.0 单智能体基座上完成两大跨越：

1. **多智能体编排**：程序化并行执行、handoff 协议、编排图、agent 消息总线与
   协作模式，全部由 `orchestration.mode` 配置驱动——`single`（默认，v1 行为
   完全不变）或 `multi`（OrchestratorGraph）。
2. **完整服务面**：仓库内新增 `app/gateway`（FastAPI HTTP Agent Server）、
   `app/channels`（8 大 IM 渠道）与 `app/scheduler`（定时任务 HTTP 服务），
   从"嵌入式优先"演进为嵌入式 + 服务化双形态交付。

v2.0.0 delivers two leaps on top of the v1.0.0 single-agent base:

1. **Multi-agent orchestration** — programmatic parallel execution, a handoff
   protocol, an orchestration graph, an agent message bus, and collaboration
   patterns, all chosen by `orchestration.mode` — `single` (default; v1 behavior
   unchanged) or `multi` (OrchestratorGraph).
2. **A complete service surface** — `app/gateway` (FastAPI HTTP Agent Server),
   `app/channels` (8 IM channel adapters) and `app/scheduler` (scheduled-task HTTP
   service) land in the repo, evolving from "embedded-first" to embedded + hosted
   delivery.

---

## 🗺️ 版本路线 / Version Roadmap

| 版本 / Version | 定位 / Positioning | 状态 / Status |
|---|---|---|
| **v1.0.0** | **单智能体框架 / Single-agent** — lead agent + 工具式子代理委派 | ✅ 已发布 / Released |
| **v2.0.0** | **多智能体框架 / Multi-agent** — 编排拓扑、agent 间通信、handoff 协议、并行批次与协作模式 + HTTP Agent Server + IM 渠道 | ✅ **当前版本 / Current** |

---

## ✨ 核心亮点 / Highlights

### 🧭 多智能体编排 / Multi-Agent Orchestration

- **P0 执行层**：`subagents/batch` —— `run_batch_async` 有界并发执行一批独立
  子代理任务（Semaphore 限流 + 失败隔离 + 保序返回）
- **P1 编排层**：`AgentHandoff` 结构化上下文转移协议（`HandoffResult` 回填 /
  `HandoffError` 投递失败）；`OrchestratorGraph`（1 orchestrator + N worker 节点，
  按 `to_agent` 路由，`max_rounds` 防死循环）；`orchestration` 配置段
  （`AgentSpec` worker 注册表）
- **P2 协作层**：`AgentInbox` 消息总线（每 agent 一个 `asyncio.Queue` + 订阅广播）；
  `orchestrator_workers`（同任务并行分派 + 结果聚合）与 `peer_consensus`
  （对等观点汇聚，成功率阈值达成共识）协作模式
- **P3 治理与可观测**：agent 身份（`normalize_agent_identity`）、per-agent token
  配额（`TokenBudgetConfig.per_agent`）、跨 agent trace 关联（`inherit_trace_id`
  注入 `qilin_trace_id`，`HandoffResult.trace_id` 回填）
- **模式切换**：`orchestration.mode: single | multi`，单次请求可 runtime 临时
  覆盖；模式切换属图结构变更（startup-only，需重启）

### 🌐 HTTP Agent Server（`app/gateway`）

- FastAPI + uvicorn 实现，20+ 组 REST 路由：agents / threads / runs / memory /
  skills / mcp / uploads / artifacts / feedback / scheduled_tasks / channels …
- 认证与安全：local（bcrypt + JWT）与 OIDC（SSO）双源认证、session cookie、
  CSRF / CORS 防护、trace 中间件、内部调用令牌（`X-QiLin-Internal-Token`）
- GitHub App webhook 接入（签名验证 + 事件分发 + 触发运行策略）
- OpenAI Assistants API 兼容面（`assistants_compat`）

### 💬 IM 多渠道接入（`app/channels`）

- 8 大渠道：飞书 / Discord / Slack / Telegram / 钉钉 / 企微 / 微信 / GitHub
- 统一机制：入站消息指纹去重（杜绝重复运行）、渠道用户 ↔ QiLin 身份绑定
  （`require_bound_identity`）、运行策略映射、命令集权威定义
- 长连接 / 长轮询接入（飞书 / 钉钉 / Telegram 无需公网 IP）

### 🔧 工程与质量 / Engineering & Quality

- **测试基线**：54 → **266 tests**（persistence / runtime / gateway / channels /
  编排 / 模式切换等核心模块补强）
- **类型门禁**：mypy 存量错误从 525 收敛至 284（19 个小模块清零），CI 新增
  clean-module 白名单门禁，防止回归
- **依赖基线**：langgraph 1.2.10 patch 基线验证与更新；纳入 `uv.lock` 锁定文件
- **示例配置**：`config.example.yaml` 补齐全部可选配置段（含 orchestration /
  auth / channel_connections 等），`config_version` 32

---

## 📚 新模块 / New Modules

| 模块 / Module | 功能 / Responsibility |
|---|---|
| `qilin/orchestration` | 多智能体编排层：handoff / OrchestratorGraph / AgentInbox / patterns |
| `qilin/subagents/batch.py` | 并行批次执行（有界并发 + 失败隔离 + 保序） |
| `app/gateway` | FastAPI HTTP Agent Server（REST + 认证 + webhook） |
| `app/channels` | IM 渠道接入层（8 大渠道） |
| `app/scheduler` | 定时任务 HTTP 管理服务 |

---

## 📖 文档 / Documentation

所有文档均为 **中英双语** / All documentation is **bilingual (Chinese + English)**：

- [`README.md`](../../blob/main/README.md) — 项目说明（v2.0.0 视角更新）
- [`docs/architecture.md`](../../blob/main/docs/architecture.md) — 整体技术架构（v2.0.0，含多智能体编排与服务面）
- [`docs/modules/*.md`](../../tree/main/docs/modules) — 24 份模块技术文档（新增 gateway / channels）

```
docs/
├── architecture.md
└── modules/
    ├── agents.md          ├── gateway.md   (new)
    ├── authz.md           ├── guardrails.md
    ├── channels.md (new)  ├── integrations.md
    ├── community.md       ├── mcp.md
    ├── config.md          ├── models.md
    ├── orchestration.md   ├── persistence.md
    ├── reflection.md      ├── runtime.md
    ├── sandbox.md         ├── scheduler.md
    ├── skills.md          ├── subagents.md
    ├── tools.md           ├── tracing.md
    ├── tui.md             ├── uploads.md
    ├── utils.md           └── workspace_changes.md
```

---

## 📦 安装 / Installation

```bash
# 核心 / Core
pip install qilin

# 可选附加 / Optional extras
pip install 'qilin[tui]'           # 终端 UI
pip install 'qilin[gateway]'       # HTTP Agent Server（FastAPI / PyJWT / bcrypt）
pip install 'qilin[channels]'      # IM 渠道 SDK（飞书 / Discord / Slack / Telegram / 钉钉等）
pip install 'qilin[postgres]'      # PostgreSQL 后端
pip install 'qilin[redis]'         # Redis 流桥
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

```python
# 嵌入式（v1 单智能体路径，行为不变）
from qilin.client import QiLinClient
client = QiLinClient()
print(client.chat("解释一下 Transformer 的自注意力机制。", thread_id="my-thread"))
```

```yaml
# 多智能体（multi 模式，需配置 workers）
orchestration:
  mode: multi
  max_concurrency: 3
  workers:
    - name: coder
      description: 编写代码的 worker
      system_prompt: You are a coding worker.
      tools: [read_file, bash]
      disallowed_tools: [task]
      model: inherit
      max_turns: 80
```

```bash
# HTTP Agent Server
pip install "qilin[gateway,channels]"
uvicorn app.gateway.app:app --port 8001
```

---

## ⚠️ 升级注意事项 / Migration Notes

- **默认行为不变**：`orchestration.mode` 缺省为 `single`，v1.0.0 配置与行为
  完全兼容，无需改动即可升级。
- **依赖基线**：langgraph 升级至 1.2.10（patch 基线已验证）；新增 `uv.lock`
  依赖锁定文件，建议使用 uv 管理环境。
- **配置版本**：`config.example.yaml` 的 `config_version` 已更新至 32，旧配置
  缺省字段均有默认值，可直接沿用。
- **服务面启用**：`app/`（gateway / channels / scheduler）随 wheel 一并分发，通过
  `qilin[gateway]` / `qilin[channels]` extras 安装依赖后即可
  `uvicorn app.gateway.app:app` 启动。
- **质量门禁**：CI 新增 mypy clean-module 白名单检查，贡献代码需保证白名单
  模块零类型错误。

---

## 🐛 已知限制 / Known Limitations

- 多智能体 `multi` 模式切换需重启进程（图结构变更，startup-only）。
- 渠道消息默认要求绑定身份（`require_bound_identity: true`），未绑定用户需先
  经 gateway `channel_connections` API 完成绑定。
- 剩余类型错误（284 个）集中在 `agents` / `community` / `runtime` 三大模块，
  清理路线图见 [`docs/mypy_backlog.md`](../../blob/main/docs/mypy_backlog.md)。

---

## 📜 许可证 / License

Apache-2.0
