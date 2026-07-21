---
kind: logging_system
name: 日志系统 — 基于 console 的轻量级输出与追加式会话日志
category: logging_system
scope:
    - '**'
source_files:
    - app/main/engine-host.ts
    - app/main/index.ts
    - app/main/settings.ts
    - engine/packages/engine/loop/src/append-only-session-log.ts
    - engine/packages/adapters/adapter-storage/src/file-session-store.ts
    - engine/packages/adapters/adapter-storage/src/hybrid-thread-store.ts
    - engine/packages/http-layer/http/src/runtime-factory.ts
    - app/renderer/src/hooks/useChat.ts
    - app/renderer/src/services/engine-api.ts
---

## 1. 使用的系统/方法
- Electron main 进程直接使用 console.log/console.error 输出应用生命周期、引擎启动停止、健康检查等关键路径信息，统一以 [KCoder] 前缀区分来源。
- QiongQi 引擎（vendored）未引入第三方日志框架，仅通过 console.warn 输出少量降级回退告警，并以 [qiongqi] 前缀标识来源。
- 渲染进程在 useChat.ts、engine-api.ts 等位置使用 console.error 记录网络解析错误，无结构化字段。
- 会话事件持久化通过 AppendOnlySessionLog 将 Agent 运行期事件追加写入磁盘，作为可回放的业务事件日志。

## 2. 关键文件与包
- app/main/engine-host.ts：Electron main 中启动停止 QiongQi HTTP 服务、健康检查的主要日志点。
- app/main/index.ts：Electron 主入口，打印引擎端口、关闭流程等。
- app/main/settings.ts：设置加载保存的错误与成功日志。
- engine/packages/engine/loop/src/append-only-session-log.ts：追加式会话日志实现，维护带内存窗口的事件项序列并落盘回放。
- engine/packages/adapters/adapter-storage/src/hybrid-thread-store.ts、file-session-store.ts、engine/packages/http-layer/http/src/runtime-factory.ts：引擎内部 console.warn 降级告警点。
- app/renderer/src/hooks/useChat.ts、app/renderer/src/services/engine-api.ts：渲染端错误日志。

## 3. 架构与约定
- 无集中 Logger 抽象：各模块直接调用原生 console.*，没有统一的 logger 初始化、级别控制或 sink 配置。
- 来源区分靠字符串前缀：Electron 侧统一使用 [KCoder]，引擎侧使用 [qiongqi]，便于在终端快速过滤。
- 级别策略简单：仅使用 log（常规）、error（异常）、warn（降级兼容）三个级别，无 info/debug 分级。
- 结构化程度低：日志为拼接字符串，不附带结构化字段如 threadId、turnId、pid、timestamp 等，无法被外部采集器直接解析。
- 业务事件日志独立：AppendOnlySessionLog 负责将 RuntimeEvent/TurnItem 追加到持久化存储，用于会话回放和 UI 展示，与诊断日志职责分离。

## 4. 开发者应遵循的规则
- 新增诊断日志时优先使用 console.log/console.error，并在消息开头加上 [KCoder]（Electron 侧）或 [qiongqi]（引擎侧）前缀，保持与现有风格一致。
- 避免过度日志：仅在关键路径（启动、停止、错误、降级）输出，高频循环内不要打 log，防止污染控制台。
- 不要自行封装 logger：当前仓库未提供集中日志抽象，新增模块不应引入新的日志库或自定义 wrapper，以免破坏一致性。
- 业务事件日志走 AppendOnlySessionLog：需要持久化的运行期事件应通过 appendSessionEvent/appendSessionItem 写入会话日志，而不是写 console。
- 未来扩展建议：若需结构化分级多 sink，可在 Electron 层引入 electron-log 或在 Node 层引入 pino，并通过环境变量切换级别，但需先评估对 vendored 引擎的影响。