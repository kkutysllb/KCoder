# Qiongqi v1.1.4 逐包技术文档

本目录覆盖当前 18 个 workspace package。所有文档已按 v1.1.4 复核；引擎不包含产品 UI、固定 Agent、业务价值判断、secret 管理或默认模型。

v1.1.4 在 v1.1.3 跨包能力之上修复 adapter-model 诊断安全边界：合法 tool-call-only assistant 消息不再误报，provider 拒绝与空内容诊断仅输出 metadata。其余 package 继续遵守 governed Turn、权威 dispatch 恢复、task/Agent 隔离、模型无关、effect 幂等和 durable stream/ROI 不变量。

## Foundation

| 包 | 文档 | v1.1 边界 |
|---|---|---|
| `@qiongqi/contracts` | [contracts.md](./contracts.md) | public parallel/join、branch/root errors、identity、stream、ROI schema |
| `@qiongqi/domain` | [domain.md](./domain.md) | Thread/Turn/Item/Event 纯领域实体与 reducer |
| `@qiongqi/ports` | [ports.md](./ports.md) | root/parallel atomic commit、work claim renewal、model/tool 与 runtime 端口 |

## Infrastructure

| 包 | 文档 | v1.1 边界 |
|---|---|---|
| `@qiongqi/cache` | [cache.md](./cache.md) | immutable prefix、TTL/LRU、inflight 优化；不是事实源 |
| `@qiongqi/attachments` | [attachments.md](./attachments.md) | artifact/attachment durable references 和 scope 校验 |
| `@qiongqi/adapter-fs` | [adapter-fs.md](./adapter-fs.md) | 原子文件与目录边界；不提供跨节点一致性 |
| `@qiongqi/tool-infra` | [tool-infra.md](./tool-infra.md) | 结果预算、参数规范化、命令审计、文件 mutation queue |

## Engine and services

| 包 | 文档 | v1.1 边界 |
|---|---|---|
| `@qiongqi/loop` | [loop-orchestrator.md](./loop-orchestrator.md) | root coordinator、durable parallel/join、prepare-first dispatch、Kernel、governor、ROI |
| `@qiongqi/loop` | [loop-prompt-and-context.md](./loop-prompt-and-context.md) | prompt identity、结构化 checkpoint、上下文压缩 |
| `@qiongqi/loop` | [loop-tool-coordination.md](./loop-tool-coordination.md) | effect ledger、duplicate suppression、streaming progress |
| `@qiongqi/services` | [services-thread-turn.md](./services-thread-turn.md) | thread/turn/task 生命周期与兼容投影 |
| `@qiongqi/services` | [services-event-recorder.md](./services-event-recorder.md) | runtime event 记录；不替代 durable work event |
| `@qiongqi/services` | [services-usage.md](./services-usage.md) | usage/cost 查询、graph attribution 与 ROI 投影 |

## Adapters and capabilities

| 包 | 文档 | v1.1 边界 |
|---|---|---|
| `@qiongqi/adapter-model` | [adapter-model-client.md](./adapter-model-client.md) | provider-neutral chat/responses/messages streaming |
| `@qiongqi/adapter-model` | [adapter-model-pricing.md](./adapter-model-pricing.md) | 可插拔 pricing；不是模型路由规则 |
| `@qiongqi/adapter-storage` | [adapter-storage.md](./adapter-storage.md) | parallel/root atomicity、shared-version recovery、PostgreSQL locking |
| `@qiongqi/adapter-tools` | [adapter-tools-builtin.md](./adapter-tools-builtin.md) | 内置工具和 effect/replay metadata |
| `@qiongqi/adapter-tools` | [adapter-tools-providers.md](./adapter-tools-providers.md) | MCP/Web/Memory/Delegation provider |
| `@qiongqi/adapter-tools` | [adapter-tools-registry.md](./adapter-tools-registry.md) | 工具注册、诊断与 capability inventory |
| `@qiongqi/memory` | [memory.md](./memory.md) | `task_shared` / `agent_private` 隔离与 lexical retrieval |
| `@qiongqi/skills` | [skills.md](./skills.md) | Skill runtime/plugin 与 port-level capability provider |

## Delegation, HTTP, and delivery

| 包 | 文档 | v1.1 边界 |
|---|---|---|
| `@qiongqi/delegation` | [delegation-registry.md](./delegation-registry.md) | Agent/peer registry 与 capability binding |
| `@qiongqi/delegation` | [delegation-runtime.md](./delegation-runtime.md) | 子 Agent lifecycle、预算和 terminal-state guard |
| `@qiongqi/http` | [http-composition-and-routes.md](./http-composition-and-routes.md) | composition、graph readiness、SSE、metrics、A2A |
| `@qiongqi/http` | [http-transport.md](./http-transport.md) | Router、SSE、auth、Node HTTP、A2A transport |
| `@qiongqi/cli` | [cli.md](./cli.md) | serve、worker 和验证命令；无默认 provider/model |
| `@qiongqi/preset-coding` | [preset-coding.md](./preset-coding.md) | 可选 coding preset，不改变核心模型中立性 |

## 共同不变量

- `evented_v2` 只表示跨 Agent 编排；Kernel 只表示隔离 Agent 执行。
- 新 graph run 必须固定 immutable revision 和 digest；旧 `start` 形状只是兼容入口。
- governed root 的 GraphRun/EngineRun 同 ID、同版本、同 transaction；dispatch identity/reservation/intent 先于 Kernel 执行持久化。
- parallel branch 有独立 durable cursor；completion order 不影响稳定非空 join，取消与 late result 都有可重放审计事实。
- durable store 是唯一事实源；cache、runtime event、SSE 和本地 snapshot 都只是优化或投影。
- model selection 使用授权 profile/policy revision，不允许隐藏厂商 fallback。
- ROI 的业务价值来自带 evidence 的下游事件；suppression/avoided cost 属于 engine efficiency。
- v1.0 在途任务不原地转换，见 [v1.1 migration](../migrations/engine-v1.1.md)。
