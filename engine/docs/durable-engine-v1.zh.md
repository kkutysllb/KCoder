# Durable Engine v1.1.1 结束说明

发布日期：2026-07-27。状态：root run aggregate 生产修复完成，根包和 18 个 workspace 包统一为 `1.1.1`。

## 结果

v1.1 在 v1.0 durable foundation 上增加生产级 graph engineering：graph definition 版本化且不可变，真实 node/edge/attempt 形成 durable work graph，治理状态与执行状态共享一个事实源。v1.1.1 进一步把 governed `GraphRunRecord` 和 root `EngineRunRecord` 固化为同 ID、同版本、同事务 aggregate，并将 Agent dispatch 改为 prepare-first durable protocol。`evented_v2` 继续作为唯一跨 Agent 编排平面，隔离 Kernel 继续作为唯一模型驱动执行平面。

## 重点功能

| 领域 | v1.1 结果 |
|---|---|
| Graph contract | canonical digest、immutable revision、pinned run identity、兼容 compiler diagnostics |
| Work graph | deterministic node/edge traversal、真实 attempt event、恢复后可投影 |
| 模型策略 | durable task policy revision、node policy ref、graph correlation、无厂商默认值 |
| Usage | 预算 reservation 按实际 usage settlement，失败/恢复不会重复计费 |
| 审批 | durable human checkpoint、唯一 resume edge、单次 resolution token |
| 资源 | read/write claim、write fence、wait/skip/escalate conflict strategy |
| Circuit | `running`/`report_only`/`paused`/`retired`、自动只升级、人工可恢复 |
| Readiness | `draft`/`observe`/`assisted`/`autonomous` evidence model 与 `/ready` 聚合 |
| ROI | graph/node/edge cost/value、fan-out、retry、suppression、avoided cost、critical path |
| Facade | `publishGraph`、governed `start`、`inspect`、checkpoint/circuit、`recordCost` |
| Build | 移除 package cycle，clean build 对所有非零编译退出 fail-fast |
| Root aggregate | GraphRun/EngineRun 同 ID、同版本原子推进，结构化错误 fail closed |
| Dispatch recovery | identity/reservation/intent 先提交，本地与远程 worker 共用 fenced handler |
| 根预算 | 调用方强制 limits，累计 settled actual 与 active requested 原子校验 |
| 迁移 | `migrateGraphOnlyRun` 显式修复 v1.1.0 graph-only run，loader 不自动修复 |

## 保持不变的 v1 基础

模型/工具 durable ledger、上下文压缩、任务与 Agent 记忆隔离、真实 SSE streaming、subscriber replay/ack、cancel/outbox、private reasoning 安全默认值和模型 profile 抽象均保留并纳入 v1.1 回归门禁。

## 兼容与迁移

不带 `graphRef` 的 `start()` 保留 v1.0 facade 形状，但不会自动把在途 run 转换成 governed graph。Governed `start()` 现在强制调用方提供 `budgetLimits`，并在首次 dispatch durable preparation 提交后返回，不等待模型完成。新任务必须发布 revision 后启动；在途 v1.0 run 要么由兼容 worker 跑到终态，要么取消后以新 run 重启。受 v1.1.0 缺陷影响的 graph-only run 必须显式迁移。详见 [engine-v1.1.md](./migrations/engine-v1.1.md)。

完整变化与风险见 [v1.1.1 release notes](./releases/v1.1.1.md)。
