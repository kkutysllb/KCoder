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
  🌐 <a href="./README.zh.md">中文</a> · <a href="./README.en.md">English</a><br>
  <a href="./docs/architecture.zh.md">架构文档</a> ·
  <a href="./docs/packages/README.md">技术文档</a> ·
  <a href="./docs/deployment.zh.md">生产部署</a>
</p>

---

> **穷奇非凶，乃破局之锐。** Qiongqi 是一个领域中立的独立多 Agent 框架，以 cache-first、去中心化编排的 HTTP/SSE 引擎为骨架，搭配可插拔的技能与工具体系。
>
> 本项目的 **四阶段架构构建**（monorepo 拆包 → AgentCard → 事件化 → A2A）已进入收尾状态：阶段 1–3 已完成，阶段 4 基本完成；Post-P1 运行治理与 OpenTelemetry exporter 已落地，真实外部 A2A peer / 跨厂商互操作验证保留为 P2。详细进度见 CHANGELOG 提交历史。

---

## 📖 什么是 穷奇（Qiongqi）？

**Qiongqi** 是一个**领域中立的独立多 Agent 框架**，以 **cache-first、去中心化编排**的 HTTP/SSE 引擎为骨架，搭配可插拔的技能与工具体系，面向不同行业组装为生产力工具。你也可以用预置的技能完成一个coding agent实现编码生产力的工具。

核心目标：**提高每一 token 的 ROI**。避免重复工具 schema、失控工具输出、畸形历史、无效重试，以及任何可以命中却错过的稳定前缀。

当前能力包括 classic / evented turn orchestration、声明式 loop engineering（LoopRunner 解释 LoopPlan phases，并通过 Evaluator 做有界 retry）、HTTP/SSE API、A2A task lifecycle、Skill/MCP/Web/Memory/Delegation provider、attachments/artifacts、hybrid SQLite+JSONL storage、Prometheus metrics、structured access logs、OpenTelemetry HTTP tracing，以及工具输出预算、bash command audit、virtual path、terminal-state guard 等运行治理能力。

> 完整介绍请阅读 **[中文 README](./README.zh.md)** 或 **[English README](./README.en.md)**。

---

## 🚀 快速开始

```bash
pnpm install
pnpm -r run build
node scripts/flatten-dist.mjs

npx tsx packages/cli/src/serve-entry.ts serve \
  --data-dir ~/.qiongqi/data \
  --base-url "$QIONGQI_BASE_URL" \
  --api-key "$QIONGQI_API_KEY" \
  --port 8899
```

生产或 CI 中使用 `hybrid` 存储前，建议运行 `pnpm run prepare:sqlite && pnpm run verify:sqlite`，用于编译并验证 `better-sqlite3` 原生绑定可加载。

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

验证 evented orchestrator + A2A 双实例路径：

```bash
pnpm -r run build
node scripts/flatten-dist.mjs
pnpm run verify:evented-a2a
```

该脚本覆盖异步 `POST /a2a/tasks` 提交、任务轮询完成、artifacts、SSE subscribe，以及 evented turn state 清理。

---

## 📦 Monorepo 包结构

采用 pnpm monorepo 多包结构，共 18 个独立 npm 包。当前状态以 [`docs/architecture.zh.md`](./docs/architecture.zh.md#3-包结构) 为准。

---

## 📚 相关文档

| 文档 | 位置 |
|------|------|
| **中文 README** | [`README.zh.md`](./README.zh.md) |
| **English README** | [`README.en.md`](./README.en.md) |
| **架构总览** | [`docs/architecture.zh.md`](./docs/architecture.zh.md) |
| **技术文档索引** | [`docs/packages/README.md`](./docs/packages/README.md) |
| **生产部署** | [`docs/deployment.zh.md`](./docs/deployment.zh.md) |
| **包依赖图** | [`docs/architecture.zh.md#附录-a-完整依赖表`](./docs/architecture.zh.md) |
| **逐包技术文档** | [`docs/packages/`](./docs/packages/) |
| **外部 A2A 验证计划** | [`docs/superpowers/plans/2026-06-23-external-a2a-interoperability.md`](./docs/superpowers/plans/2026-06-23-external-a2a-interoperability.md) |
| **CI 工作流** | [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) |
| **部署资产** | [`Dockerfile`](./Dockerfile), [`docker-compose.yml`](./docker-compose.yml), [`deploy/`](./deploy/) |

---

<p align="center">
  <sub>Built with ❤️ for the Agent era · 穷奇非凶，乃破局之锐</sub>
</p>
