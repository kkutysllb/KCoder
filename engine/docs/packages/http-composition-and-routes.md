# @qiongqi/http：组合根和路由

> v1.1.1。组合 store、模型 provider、tool host、governed evented_v2 runtime、Kernel executor 和 transport，不承载产品业务逻辑。

## 组合职责

- 注入 provider-neutral model registry、task model policy 和 node policy。
- 构造 durable graph stores、evented_v2 runtime、Kernel executor 与 governor。
- 将 start/resume/cancel、stream subscribe/ack 和 A2A lifecycle 映射到 durable state。
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
| Task resume/cancel | 操作 durable wait/cancel intent，不直接改内存 run |
| `/a2a/tasks` | A2A create/read/subscribe/cancel 与 artifact projection |

## 安全边界

runtime token 与 provider credential 分离；SSE 默认只暴露 public channel；HTTP disconnect 不取消任务；access log 和 span 不记录 prompt、工具参数、Authorization、credential 或 private memory。route handler 不绕过 engine/store 直接推进 graph。
