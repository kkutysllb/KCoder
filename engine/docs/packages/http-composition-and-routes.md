# @qiongqi/http：组合根和路由

> v1.1.4。组合 store、模型 provider、tool host、governed evented_v2 runtime、Kernel executor 和 transport，不承载产品业务逻辑。

## 组合职责

- 注入 provider-neutral model registry、task model policy 和 node policy。
- 构造 durable graph stores、evented_v2 runtime、Kernel executor 与 governor。
- 将 start/resume/cancel、stream subscribe/ack 和 A2A lifecycle 映射到 durable state。
- 为生产 `kernel_v3` 将 provider assistant chunk 立即写入 RuntimeEventRecorder；thread SSE 可 live 接收并按 seq 回放，最终 item 使用相同 proposal-derived ID 收敛。
- 可选注入完整 `{ engine: DurableEngine, store: DurableEngineStore }`，建立 governed Turn 与 GraphRun 生命周期桥接；不接受只有 engine 或只有 store 的写入组合。
- 提供 `/health`、聚合 graph evidence 的 `/ready`、JSON/Prometheus metrics。
- 传播 request id、W3C trace context 和 policy-safe graph OpenTelemetry attributes。
- 仅在 composition root 注入 adapter-specific shell runtime instruction；loop 不反向依赖 adapter-tools。

## 路由族

| 路由 | 语义 |
|---|---|
| `/health` | 进程 liveness |
| `/ready` | store + graph readiness；返回最弱 level 和缺失 evidence |
| `/v1/runtime/info` / `/v1/runtime/metrics` | capability、storage、usage、stream、ROI/graph diagnostics |
| Engine stream subscribe/ack | 从 seq 续传 durable event 并记录 subscriber ack |
| `/v1/engine/graphs` | 发布 immutable GraphRevision |
| `/v1/engine/runs/:runId` | 查询并同步 GraphRun/Turn 投影 |
| run dispatch/completion/resume/cancel | 仅调用 DurableEngine 公共方法，不直接修改 store |
| `/v1/threads/:id/turns` + `governedExecution` | 显式 TaskScope 下启动或恢复 governed run |
| Task resume/cancel | 操作 durable wait/cancel intent，不直接改内存 run |
| `/a2a/tasks` | A2A create/read/subscribe/cancel 与 artifact projection |

## 安全边界

runtime token 与 provider credential 分离；SSE 默认只暴露 public channel；HTTP disconnect 不取消任务；access log 和 span 不记录 prompt、工具参数、Authorization、credential 或 private memory。route handler 不绕过 engine/store 直接推进 graph。

Kernel 流式 callback 不修改 usage/ROI ledger：usage 保持 provider 报告和 durable ledger 的 exactly-once 入账，业务 ROI 仍要求调用方提供 evidence。
