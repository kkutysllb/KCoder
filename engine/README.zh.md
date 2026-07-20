<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/qiongqi.png">
    <img src="assets/qiongqi.png" width="100%" alt="Qiongqi — 穷奇非凶，乃破局之锐">
  </picture>
</p>

<h1 align="center">Qiongqi · 穷奇</h1>

<p align="center">
  <b>独立多 Agent 框架 · 骨架不变，血肉万变</b>
</p>

<p align="center">
  <a href="./README.en.md">English</a> ·
  <a href="#-快速开始">快速开始</a> ·
  <a href="#-设计哲学">设计哲学</a> ·
  <a href="#-架构">架构</a> ·
  <a href="#-monorepo-包结构">包结构</a> ·
  <a href="./docs/packages/README.md">技术文档</a> ·
</p>

---

> **穷奇非凶，乃破局之锐。** Qiongqi 取意于《山海经》《神异经》《左传》中的"穷奇"——一头"状如虎，有翼"、"知人言语"、敢"毁信废忠"的凶兽。引擎拒绝中央调度寡头，每个 Agent 都是忠于任务的少昊氏不才子；单兵可独立闭环作战，多个 Agent 则在解耦的引擎骨架与外部技能血肉之间自协商达成共识。

---

## 📖 什么是 Qiongqi？

**Qiongqi** 是一个**领域中立的独立多 Agent 框架**，以 **cache-first、去中心化编排**的 HTTP/SSE 引擎为骨架，搭配可插拔的技能与工具体系，面向不同行业组装为生产力工具。

> 穷奇"状如虎，有翼"、"知人言语"——骨架不变，血肉万变。

核心目标：**提高每一 token 的 ROI**。避免重复工具 schema、失控工具输出、畸形历史、无效重试，以及任何可以命中却错过的稳定前缀。

当前实现覆盖 classic / evented turn orchestration、声明式 loop engineering（LoopRunner 解释 LoopPlan phases，并通过 Evaluator 做有界 retry）、HTTP/SSE API、A2A task lifecycle、Skill/MCP/Web/Memory/Delegation provider、attachments/artifacts、hybrid SQLite+JSONL storage、Prometheus 指标、结构化 access log、OpenTelemetry HTTP tracing，以及工具输出预算、bash command audit、virtual path、terminal-state guard 等 Post-P1 运行治理能力。

---

## 🐯 设计哲学

三头凶兽，三重主张：

### 1️⃣ 核心哲学：打破"中央集权"的叛逆者

> *"毁信废忠，崇饰恶言。"* ——《左传·文公十八年》

Qiongqi 不设中央调度寡头。回合编排、工具协调、上下文压缩——每个环节都是可替换的 port/adapter 合约。Engine 只是骨架，血肉由外部技能与工具注入。

### 2️⃣ 个体能力：独当一面的"虎翼"

> *"状如虎，有翼，食人。"* ——《山海经·海内北经》

每个 Agent 都是端到端独立的执行单元。单 Agent 可从 prompt 到工具调用到结果返回闭环完成。Skill 系统支持任意粒度的能力封装。

### 3️⃣ 群体智能：懂"人话"的自协商组织

> *"知人言语，闻人斗辄食直者，闻人忠信辄食其鼻。"* ——《神异经》

多 Agent 之间通过解耦的引擎骨架（EventBus、Store、Gate）自协商，而非中央编排。Subagent 委派机制支持分层共识。

---

## 🚀 快速开始

### 依赖

- Node.js 20+
- pnpm 10+

### 安装与构建

```bash
pnpm install
pnpm -r run build
node scripts/flatten-dist.mjs  # 拍平构建产物
```

生产或 CI 中使用 `hybrid` 存储前，建议额外运行 `pnpm run prepare:sqlite && pnpm run verify:sqlite`，用于编译并验证 `better-sqlite3` 原生绑定可加载。

验证 evented orchestrator + A2A 双实例路径：

```bash
pnpm -r run build
node scripts/flatten-dist.mjs
pnpm run verify:evented-a2a
```

该脚本覆盖异步 `POST /a2a/tasks` 提交、任务轮询完成、artifacts、SSE subscribe，以及 evented turn state 清理。

### 启动运行时

```bash
npx tsx packages/cli/src/serve-entry.ts serve \
  --data-dir ~/.qiongqi/data \
  --base-url "$QIONGQI_BASE_URL" \
  --api-key "$QIONGQI_API_KEY" \
  --port 8899
```

启动后可通过 `http://127.0.0.1:8899` 访问 HTTP API。

生产探针与运行指标：

```bash
curl http://127.0.0.1:8899/health
curl http://127.0.0.1:8899/ready
curl -H "Authorization: Bearer $QIONGQI_RUNTIME_TOKEN" \
  http://127.0.0.1:8899/v1/runtime/metrics
curl -H "Authorization: Bearer $QIONGQI_RUNTIME_TOKEN" \
  -H "Accept: text/plain" \
  "http://127.0.0.1:8899/v1/runtime/metrics?format=prometheus"
```

`/ready` 会暴露 storage degraded 状态；`/v1/runtime/metrics` 默认返回 JSON，也可用 Prometheus text 格式导出 token/cache、A2A task 与存储诊断。

### 脚本速查

```bash
pnpm -r run build          # 构建全部 18 个包
pnpm run prepare:sqlite    # 为当前 Node ABI 编译 better-sqlite3 原生绑定
pnpm run verify:sqlite     # 验证 hybrid 存储所需的 better-sqlite3 原生绑定
pnpm run verify:evented-a2a # 本地 fake model 双实例验证 evented + A2A
pnpm test                  # 全量测试（71 个文件，510 个测试用例）
pnpm test:unit             # 单元测试
pnpm test:fast             # 快速测试子集（70 个文件，481 个测试用例）
```

---

## 🏗️ 架构

```
┌─────────────────────────────────────────────────┐
│                    Client (GUI / CLI)            │
└────────────────────┬────────────────────────────┘
                     │ HTTP / SSE
┌────────────────────▼────────────────────────────┐
│                 @qiongqi/http                    │
│   Router · Auth · SSE · Runtime Factory          │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│              @qiongqi/loop                       │
│  TurnOrchestrator · LoopRunner · LoopPlan        │
│  PromptBuilder · Policy · Evaluator              │
│  ToolCallCoordinator · ContextCompactor          │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│              @qiongqi/ports                      │
│  ModelClient · ToolHost · Stores · EventBus      │
│  ApprovalGate · UserInputGate · Workspace        │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│           Adapters + Extensions                  │
│  adapter-model · adapter-tools · adapter-storage │
│  skills · memory · attachments · delegation      │
│  tool-infra · artifacts · OpenTelemetry          │
└───────────────────────────────────────────────────┘
```

> 详细架构说明见 [`docs/architecture.zh.md`](./docs/architecture.zh.md)
> 逐包技术细节见 [`docs/packages/README.md`](./docs/packages/README.md)

---

## 📦 Monorepo 包结构

Qiongqi 采用 pnpm monorepo 多包结构，共 18 个独立 npm 包：

| 包 | 职责 |
|---|------|
| `@qiongqi/contracts` | Zod schema + 类型（零依赖基础层） |
| `@qiongqi/domain` | Thread/Turn/Item/Event 实体 |
| `@qiongqi/ports` | ModelClient/ToolHost/Stores 接口 |
| `@qiongqi/cache` | LRU/TTL 缓存、不可变前缀 |
| `@qiongqi/loop` | TurnOrchestrator/LoopRunner/LoopPlan/PromptBuilder/Policy |
| `@qiongqi/services` | Thread/Turn/Usage 服务 |
| `@qiongqi/adapter-model` | Provider-neutral 模型兼容客户端 |
| `@qiongqi/adapter-tools` | 内置工具 + MCP/Web/Memory/Delegation providers |
| `@qiongqi/adapter-storage` | File/Hybrid/SQLite 存储 |
| `@qiongqi/skills` | SkillRuntime + PluginHost |
| `@qiongqi/memory` | 跨会话记忆存储 + lexical retrieval |
| `@qiongqi/attachments` | 附件管理 + virtual path resolver |
| `@qiongqi/adapter-fs` | 纯文件系统 I/O 工具 |
| `@qiongqi/tool-infra` | 工具执行基础设施、result budget、command audit |
| `@qiongqi/delegation` | 子代理委派运行时 + terminal-state guard |
| `@qiongqi/http` | HTTP/SSE、A2A、metrics、artifacts、OpenTelemetry |
| `@qiongqi/cli` | 命令行入口 |
| `@qiongqi/preset-coding` | 编码预设 |

> 完整依赖关系见 [`docs/architecture.zh.md#附录-a-完整依赖表`](./docs/architecture.zh.md)
> 各包详细说明见 [`docs/packages/README.md`](./docs/packages/README.md)

---

## ✨ 特性

### 🔧 Agent Loop
- **声明式 Loop Engineering**：evented 模式演进为声明式 loop 基质——`LoopRunner` 解释 `LoopPlan` phase 集合（build-prompt → run-model → decide → 可选 evaluate → dispatch-tools），富事件（`prompt:built`/`model:ran`/`decision`/`tools:dispatched`/`step:retry`）真实化并写入 `LoopRun` 审计日志；可插拔确定性 `LoopEvaluator` 按 phase retry budget 触发有界 retry/reflection；classic 模式保留为回归锚
- **Cache-first 编排**：不可变 prompt 前缀 + TTL/LRU 缓存 + inflight 跟踪
- **上下文压缩**：软/硬阈值触发摘要压缩
- **Token 经济**：压缩工具描述与结果
- **Tool Storm Breaker**：抑制同回合重复工具调用
- **Loop Policy**：纯函数决策停止/继续/失败/分派/计划物化
- **运行治理**：工具输出外置、bash command audit、terminal-state guard

### 🔌 能力矩阵
- **MCP 客户端**：stdio / streamable-http / SSE 传输，BM25 工具搜索
- **Skills 系统**：基于 `skill.json` / `SKILL.md` 的插件化能力注入
- **Subagent 委派**：带并发控制的分层 Agent 调用
- **记忆系统**：跨会话持久化，中英文 lexical ranking 与作用域检索
- **附件与 artifacts**：图片二进制剥离、视觉/文本双通道、虚拟路径读取

### 🌐 服务器
- **HTTP/SSE API**：完整的 `/v1/*` RESTful 路由
- **运行时诊断**：能力清单、工具诊断、JSON/Prometheus 指标
- **线程管理**：创建、Fork、Side 线程、事件回放
- **审批门控**：支持多种策略
- **可观测性**：request id、structured access log、W3C `traceparent`、OpenTelemetry HTTP tracing

---

## 📁 项目结构

```
.
├── assets/
│   └── qiongqi.png               # 项目封面图
├── docs/                          # 技术文档（中英双语）
│   ├── architecture.{zh,en}.md   # 统一架构（设计哲学 + 技术架构 + 包结构）
│   ├── deployment.{zh,en}.md     # 生产部署、探针、指标、OTel、A2A 验证
│   ├── packages/                 # 27 份逐包技术文档
│   └── superpowers/plans/        # 运行治理与外部 A2A 验证计划
├── packages/                      # 18 个 @qiongqi/* 包（packages/<layer>/<package>）
│   ├── foundation/contracts/
│   ├── domain-layer/domain/
│   ├── ports-layer/ports/
│   ├── infrastructure/{cache,attachments,adapter-fs,tool-infra}/
│   ├── engine/{loop,services}/
│   ├── adapters/{adapter-model,adapter-tools,adapter-storage}/
│   ├── capabilities/{skills,memory}/
│   ├── delegation-layer/delegation/
│   ├── http-layer/http/
│   ├── cli-layer/cli/
│   └── presets/preset-coding/
├── tests/                         # 全量测试套件（71 文件，510 测试）
├── deploy/                        # Kubernetes 与 Prometheus 规则
├── .github/workflows/ci.yml       # CI：SQLite、typecheck、fast tests、build、A2A
├── scripts/                       # 迁移与构建辅助脚本
├── pnpm-workspace.yaml
├── vitest.config.ts
└── package.json
```

---

## 📚 相关文档

| 文档 | 位置 |
|------|------|
| **架构总览** | [`docs/architecture.zh.md`](./docs/architecture.zh.md) |
| **技术文档索引** | [`docs/packages/README.md`](./docs/packages/README.md) |
| **生产部署** | [`docs/deployment.zh.md`](./docs/deployment.zh.md) |
| **包依赖图** | [`docs/architecture.zh.md#附录-a-完整依赖表`](./docs/architecture.zh.md) |
| **逐包技术文档** | [`docs/packages/`](./docs/packages/) |
| **外部 A2A 验证计划** | [`docs/superpowers/plans/2026-06-23-external-a2a-interoperability.md`](./docs/superpowers/plans/2026-06-23-external-a2a-interoperability.md) |
| **运行治理实现计划** | [`docs/superpowers/plans/2026-06-22-kk-oclaw-runtime-hardening.md`](./docs/superpowers/plans/2026-06-22-kk-oclaw-runtime-hardening.md) |
| **CI / 交付资产** | [`.github/workflows/ci.yml`](./.github/workflows/ci.yml), [`Dockerfile`](./Dockerfile), [`deploy/`](./deploy/) |
| **英文 README** | [`README.en.md`](./README.en.md) |

---

## 🗺️ 改造路线

Qiongqi 的四阶段架构改造当前状态如下：

| 阶段 | 目标 | 状态 |
|------|------|------|
| **阶段 1** | SDK 抽离 + monorepo 拆包 | 完成 |
| **阶段 2** | AgentCard + AgentIdentity | 完成 |
| **阶段 3** | TurnOrchestrator 事件化 | 完成 |
| **阶段 4** | A2A 协议端点 | 基本完成，待外部 Agent 做跨厂商互操作验证 |
| **Post-P1** | 运行治理 + OpenTelemetry exporter | 完成 |
| **Loop Engineering** | 声明式 loop 基质（LoopPlan/LoopRunner/Evaluator） | 完成 |
| **P2** | 真实外部 A2A peer / 跨厂商互操作验证 | 待外部对端 |

详细进度见 CHANGELOG 提交历史。

---

<p align="center">
  <sub>Built with ❤️ for the Agent era · 穷奇非凶，乃破局之锐</sub>
</p>
