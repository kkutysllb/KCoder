# @qiongqi/ports：引擎端口

> v1.1.1。只定义依赖反转接口，不实现产品策略、网络协议或持久化细节。

## 关键端口

| 端口 | 责任 |
|---|---|
| `DurableEngineStore` | 原子 commit、graph/run/task、ledger/checkpoint/memory/stream/outbox/cost/value |
| graph queries/claims | immutable revision、work event、task model policy、approval token、resource claim |
| `ModelProvider` / `ModelClient` | 按 immutable profile 执行模型请求和实时事件 |
| `ToolHost` | 工具描述、effect metadata、执行和流式进度 |
| `CapabilityToolProvider` / `LocalTool` | skills/tools 共享的 capability 边界，避免 adapter 反向依赖 |
| turn collaborators | inflight、steering、compactor 的窄接口，services 不依赖 loop 实现 |
| `EngineStreamSink` | 发布 public/private/diagnostic engine event |
| `ApprovalGate` / `UserInputGate` | 外部等待和恢复边界 |

## DurableEngineStore 要求

生产实现必须在 transaction 中校验 expected task/run revision 和 lease fence，并原子写入 graph run、work events、mailbox/outbox、ledger、checkpoint、cost/value 等 mutations。还必须保证：

- `(graphId, revision)` 内容不可变；digest 冲突失败。
- checkpoint resolution token 单次 compare-and-set。
- write resource claim 有数据库级 fence 和互斥语义。
- outbox claim、stream seq 和 subscriber ack 可恢复。
- `aggregateKind: 'governed_root'` 的 commit 必须同时写同 operation、同 ID、同新版本的 GraphRun 与 root EngineRun，且 EngineRun 必须包含调用方 limits；任何 partial mutation 整体失败。
- budget reservation 创建必须在 parent aggregate 的串行化边界内累计 settled actual、active requested 和 new requested。
- `claimWork()` 返回带 fence 的 lease；长 handler 通过 `renewWorkClaim(workId, lease, ttlMs)` 续租。续租失败的 worker 不得再提交，过期 intent 可由更高 fence 接管。

PostgreSQL 是多实例生产必需实现；SQLite/in-memory 只用于单进程与 conformance。
