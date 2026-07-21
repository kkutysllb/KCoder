---
kind: logging_system
name: 日志系统 — 基于 console 的轻量输出与 OpenTelemetry 可观测性
category: logging_system
scope:
    - '**'
source_files:
    - engine/packages/http-layer/http/src/telemetry.ts
    - engine/packages/cli-layer/cli/src/serve.ts
    - engine/packages/http-layer/http/src/runtime-factory.ts
    - engine/packages/engine/loop/src/middleware/observability-middleware.ts
    - engine/packages/foundation/contracts/src/qiongqi-config.ts
    - app/main/index.ts
    - app/main/engine-host.ts
    - app/main/settings.ts
    - app/renderer/src/hooks/useChat.ts
    - app/renderer/src/services/engine-api.ts
---

## 1. 使用的系统与方式
- 应用层（Electron）：app/ 目录下的主进程与渲染进程全部使用原生 console.log / console.error / console.warn 进行调试输出，未引入任何第三方日志框架。
- 引擎层（engine monorepo）：核心运行时同样以 console.* 为主；结构化、可追踪的访问日志通过 HTTP 层的 accessLog 回调提供，由调用方自行实现 sink。
- 分布式追踪：通过 @opentelemetry/* SDK 在 http-layer/http/src/telemetry.ts 中初始化 TracerProvider，支持 Console、InMemory、OTLP-HTTP 三种 exporter，并通过环境变量 QIONGQI_OTEL_* 控制开关与导出器。
- 中间件级观测：engine/packages/engine/loop/src/middleware/observability-middleware.ts 在每个 hook 前后记录耗时，并以 record-warning 命令形式注入到运行结果中，属于内嵌式轻量观测而非外部日志。

## 2. 关键文件与包
- engine/packages/http-layer/http/src/telemetry.ts：OpenTelemetry 初始化与 exporter 选择（ConsoleSpanExporter / InMemorySpanExporter / OTLPTraceExporter）
- engine/packages/cli-layer/cli/src/serve.ts：从配置与环境变量解析 observability.openTelemetry，构造 createOpenTelemetryRuntime 参数
- engine/packages/http-layer/http/src/runtime-factory.ts：createHttpServer 暴露 accessLog 回调，作为结构化访问日志的统一入口
- engine/packages/engine/loop/src/middleware/observability-middleware.ts：钩子级耗时观测，写入 commands.record-warning
- engine/packages/foundation/contracts/src/qiongqi-config.ts：ObservabilityConfigSchema 定义 openTelemetry.enabled/exporter/endpoint/serviceName 等字段
- app/main/index.ts、app/main/engine-host.ts、app/main/settings.ts、app/renderer/src/hooks/useChat.ts、app/renderer/src/services/engine-api.ts：Electron 端所有 console.* 输出点
- engine/packages/adapters/adapter-storage/src/file-session-store.ts、hybrid-thread-store.ts、adapter-model/src/model-compat-client.ts：引擎内部 console.warn 告警点

## 3. 架构与约定
- 分层职责：HTTP 层负责请求级访问日志（accessLog），引擎 loop 层负责 turn/hook 级耗时观测（observabilityMiddleware），底层存储/模型适配层仅用 console.warn 做兜底告警。
- 可插拔 exporter：createOpenTelemetryRuntime 根据 options.openTelemetry.exporter 动态选择 OTLP-HTTP / Console / InMemory，默认关闭（enabled 未设置时不启用）。
- trace 传播：HTTP 响应头自动携带 x-request-id 与 traceparent，并在 accessLog 条目中附带这些标识，便于跨服务关联。
- 无全局 logger 实例：仓库未定义统一的 Logger 类或单例，各模块直接调用 console.*，因此不存在集中化的 log level 管理或统一格式化策略。

## 4. 开发者应遵循的规则
- Electron 端：继续使用 console.log / console.error / console.warn 即可，注意在开发环境保留 [KCoder] 前缀以便快速过滤。
- 引擎新代码：需要请求级结构化日志时，优先使用 createHttpServer 传入的 accessLog 回调，避免自行 console.log；需要 turn/hook 级耗时观测时，复用 observabilityMiddleware 或通过 record-warning 命令上报，不要重复造轮子；仅在异常降级路径使用 console.warn('[qiongqi] ...') 作为兜底告警，不要用于常规业务流。
- OpenTelemetry 接入：通过 QIONGQI_OTEL_ENABLED、QIONGQI_OTEL_EXPORTER、QIONGQI_OTEL_ENDPOINT、QIONGQI_OTEL_SERVICE_NAME 四个环境变量控制，无需修改源码；生产建议开启 otlp-http 并指向后端 collector。
- 禁止新增第三方日志库：当前仓库未引入 pino/winston/bunyan 等依赖，保持零额外运行时开销；如需结构化日志，请扩展 accessLog 或 observabilityMiddleware 能力。