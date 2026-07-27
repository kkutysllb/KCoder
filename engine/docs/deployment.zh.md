# Qiongqi Durable Engine v1.1.2 生产部署

## 1. 前置条件

- Node.js 20+、pnpm 10+。
- 多实例使用 PostgreSQL；SQLite 只用于单进程、本地验证和 conformance。
- provider credential 由 secret manager 解析 `credentialRef`，不得写入 profile、checkpoint、stream 或日志。
- 新任务必须先发布 immutable `GraphRevision`，再以 `graphRef` 启动。
- 每个 governed `start()` 必须由调用方提供 `budgetLimits`；引擎不推断产品预算。
- 每次 `dispatchParallelAgents()` 必须由调用方提供完整 `requestedBudgets[branchId]`；缺失或额外 branch budget 都应在 dispatch 前失败。

## 2. 构建与发布门禁

```bash
pnpm install --frozen-lockfile
pnpm run prepare:sqlite
pnpm run verify:sqlite
QIONGQI_TEST_POSTGRES_URL='postgresql://user:pass@host:5432/qiongqi' pnpm run verify:postgres-engine
pnpm typecheck
pnpm test:fast
pnpm test
pnpm run build:clean
pnpm run verify:evented-a2a
pnpm vitest run tests/release-version.test.ts tests/engine-v1.1-compatibility.test.ts
git diff --check
```

`build:clean` 按无循环依赖顺序编译 18 个 workspace 包，任一编译器非零退出立即失败。不得再使用“已有 dist 即容忍类型错误”的旧门禁。

## 3. PostgreSQL 与迁移

先备份，再应用 additive v1.1 graph schema，随后发布 worker，最后发布 API。schema 包括 immutable graph revisions、同版本 GraphRun/EngineRun root aggregate、work graph events、task model policies、human checkpoints、budget reservations 和 resource claims。唯一键、CAS version、lease fence、outbox claim 和 stream seq 索引不可降级。

滚动升级期间：

1. v1.0 未完成 run 继续由兼容 worker 执行，或显式 cancel 后以新 graph run 重启。
2. v1.1 新 run 必须固定 revision 和 digest，不允许 v1.0 实例 claim。
3. shutdown 先停止新 claim，等待当前 transaction，保留未完成 outbox 给下一实例恢复。
4. 不删除 v1.1 graph 表或 event；回滚规则见 [engine-v1.1.md](./migrations/engine-v1.1.md)。

从已经产生 governed GraphRun 但没有 root EngineRun 的 v1.1.0 实例升级时，先停止该 run 的 claim，再按迁移文档逐个执行 `migrateGraphOnlyRun({ runId, budgetLimits })`。loader、`inspect()` 和 worker 都不会自动修复。迁移提交两个同版本 projection 和 `root_run_repaired` 审计事件；terminal run 不会重新执行。

PostgreSQL 必须在 parent row lock 内校验“settled actual + active requested + new requested <= root limits”。SQLite/in-memory 即使通过 conformance，也不能替代多实例数据库锁。

v1.1.2 的多实例发布必须执行 `tests/postgres-durable-parallel-engine.test.ts`：两个独立 store/engine 实例并发提交乱序 branch completion，最终只能产生一个 join，且两份 root projection 版本一致。没有 `QIONGQI_TEST_POSTGRES_URL` 时该门禁会跳过，这种构建不得作为已验证的多实例生产发布。

## 4. Readiness 与探针

- `/health` 只表示进程可响应。
- `/ready` 聚合 store readiness 和 graph readiness；未达到部署要求时不得接收新任务。
- `/v1/runtime/metrics` 与 Prometheus 输出 stream、ledger、outbox、usage、cost、ROI 和 graph 指标。

生产自主运行至少需要 `autonomous` evidence：definition valid、telemetry、production store、recovery drill、budget、approval、resource fence、trace correlation、cancel verification 和 circuit configuration。`draft`/`observe` 不得接生产写流量；`assisted` 必须保留人工审批路径。

## 5. Streaming

SSE 代理必须关闭响应缓冲，允许长连接，并传递 `Last-Event-ID` 或等价 seq cursor。引擎先提交 durable event 再输出；客户端断开不取消任务。branch lifecycle event 带稳定 `branchId`，root `roi.snapshot.byBranch` 必须与根总量对账。subscriber ack 是独立 cursor，不能用一个消费者的 ack 截断其他消费者。

private reasoning 默认不采集、不持久化、不订阅、不保留。反向代理、access log 和 trace exporter 不得记录 Authorization、prompt、工具参数、credential 或 private memory。

## 6. 模型和策略

启动时注册 provider 与 immutable profile revision；任务 policy 只引用授权 profile。任务或产品切换模型时提交新的 task model policy revision，新物理 attempt 使用新 revision，已开始的 attempt 保持原 revision。

不要设置核心默认模型。若所有授权 profile 都不可用，任务进入可解释的 resolution/degraded 状态，而不是回退到 `deepseek-chat` 或其他隐藏 model id。

## 7. 监控与告警

至少监控：

- logical/physical/replayed/suppressed/uncertain attempts 与 duplicate ratio；
- outbox age、claim failure、lease conflict、checkpoint lag 和 resume/cancel latency；
- graph circuit state、readiness level、node/branch failure/retry/cancel、fan-out、join latency 和 critical-path latency；
- stream append latency、subscriber lag、SSE reconnect；
- model/tool usage、cost、graph/node/edge ROI、avoided cost 和 ROI status。

ROI `incomplete` 表示缺少带 evidence 的业务价值，`unavailable` 表示成本缺失或币种不一致。suppression 和 avoided cost 是 engine efficiency，不等于业务价值。

## 8. 故障演练

worker claim TTL 必须覆盖正常 handler 周期，并在到期前调用 `renewWorkClaim()`；续租失败立即停止提交，等待更高 fence 的 worker 接管。发布前验证：模型 delta 中断、provider 返回后 commit 前崩溃、工具 effect 后 commit 失败、parallel fan-out commit 后崩溃、乱序 branch completion、join commit 前崩溃、prepare commit 后 notify 前崩溃、outbox commit 后 publish 前崩溃、过期 dispatch/cancel claim takeover、审批 token 重放、resource write 冲突、root projection 缺失/分歧、累计预算耗尽、`wait_all`/`fail_fast`、root cancel 与 late completion 竞争、SSE branch replay、PostgreSQL 暂时不可用。

验收条件是：没有静默重复 effect、没有跨 task/Agent memory 泄露、所有 run 都能从 durable facts 解释和恢复。监控应将 `ROOT_RUN_AGGREGATE_INCOMPLETE`、`ROOT_RUN_AGGREGATE_DIVERGED`、`ROOT_RUN_BUDGET_MISSING` 作为不可自动重试的治理告警。
