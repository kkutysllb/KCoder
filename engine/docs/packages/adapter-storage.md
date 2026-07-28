# @qiongqi/adapter-storage：Durable storage adapters

> v1.1.4。提供 PostgreSQL、SQLite 和 in-memory 的 `DurableEngineStore` 实现，并保留 thread/session 兼容 store。

## 适配器定位

| 实现 | 用途 | 多实例生产 |
|---|---|---|
| PostgreSQL | graph/run/ledger/stream/outbox/governance 共享事实源 | 是 |
| SQLite | 单进程开发、测试、迁移验证 | 否 |
| In-memory | 单元测试和 conformance | 否 |
| file/hybrid | 兼容 thread/session 与本地投影 | 否 |

## v1.1 持久化面

- immutable graph revision 和 pinned graph run；
- sequenced work graph events 与 evented_v2 mailbox/outbox；
- revisioned task model policy；
- human checkpoint token CAS；
- fenced read/write resource claim；
- model/tool ledger、task/context checkpoint、memory、stream、cost/value。
- governed root aggregate：GraphRun 和 EngineRun 同 ID、同版本、同 transaction；
- prepare-first AgentRun/KernelRun identity、budget reservation 与 dispatch intent；
- work claim TTL、续租、fence takeover 和 `root_run_repaired` audit fact。
- durable branch cursor/status/output、branch lifecycle stream/work event、稳定 join result 与 branch ROI projection；
- parallel fan-out 的批量 reservation/intent 原子提交，以及不同实例乱序 completion 的 shared-version CAS；

`commit()` 同时校验 expected task revision、run version 和 lease fence。冲突由调用方重新加载后确定性处理；adapter 不覆盖 revision，不用进程内 mutex 模拟多节点一致性。

所有实现逐字段执行同一个根预算公式：

```text
sum(settled reservation actual usage)
+ sum(active reservation requested usage)
+ new requested usage
<= root budgetLimits
```

released reservation 计为零。重复 settlement 只有 actual 完全相同时才幂等。PostgreSQL 在 reservation transaction 中 `SELECT ... FOR UPDATE`（或等价 parent-row lock）后加载历史 reservation、校验并写入，防止并发 child 各自通过旧快照。SQLite/in-memory 实现相同 contract，但不声明多实例生产能力。

## 运维

- PostgreSQL schema 先备份后做 additive migration；多实例生产必须使用 PostgreSQL。
- graph revision、work event、stream、ledger 和 outbox 唯一键/索引必须保留。
- SQLite native binding 用 `pnpm run prepare:sqlite && pnpm run verify:sqlite` 验证。
- PostgreSQL contract 用 `QIONGQI_TEST_POSTGRES_URL=... pnpm run verify:postgres-engine` 验证。
- PostgreSQL 多实例发布还必须通过两个独立 connection/engine 并发 branch completion 的 `postgres-durable-parallel-engine` 验收。
- readiness 必须把 SQLite/file 的多节点能力报告为 degraded。
- worker claim TTL 应覆盖正常处理周期并提前调用 `renewWorkClaim()`；续租失败必须停止写入，让更高 fence 接管原 intent 和 identity。
