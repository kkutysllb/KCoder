# @qiongqi/contracts：v1.1 公共契约

> v1.1.1。零业务依赖的 Zod/TypeScript contract 包，是 engine、adapter 和 transport 的共享语言。

## 核心 schema

| 模块 | 核心类型 |
|---|---|
| `engine-identity` | `TaskScope`、完整 graph/run/node/edge/attempt correlation |
| `graph-definition` | `GraphRevision`、八类 node、versioned node/edge/model policy ref |
| `graph-runtime` | `ExecutionContext`、`GraphRunRecord`、`WorkGraphEvent` |
| `graph-governance` | human checkpoint、resource claim、circuit、readiness evidence |
| `execution-ledger` | model/tool operation key、status、profile ref、replay descriptor |
| `task-checkpoint-v1` | task/context checkpoint、waiting state、provenance |
| `memory` | `task_shared`、`agent_private` record/query/create request |
| `model-profile` | profile、capabilities、task selection policy 和 route decision |
| `engine-stream` / `usage` | stream policy、cost/value、graph attribution、ROI、efficiency |
| `multi-agent-runtime` | 兼容 AgentGraph、AgentRun、mailbox/outbox、worker timeline |
| `builtin-tool-names` | core 与 adapter 共享的 plan/goal/todo 工具名称 |

## 不变量

- graph revision 以 `(graphId, revision, graphDigest)` 固定；child context 必须继承父 graph identity。
- edge work event 必须有 edge id；write resource claim 必须有 fence。
- profile 和 policy 引用包含 revision，恢复不能静默切换模型配置。
- `credentialRef` 只引用 secret；durable schema 不接收明文凭证。
- private stream/reasoning 和 private memory 必须显式区分。
- strict schema 拒绝未知字段；跨版本变化通过 revision/schema 表达。

## v1.1.1 root dispatch 契约

`KernelDispatchPayload` 是 `agent_execution_requested` outbox intent 的 strict payload：包含 `schemaVersion: 1`、稳定 `AgentRunIdentity`、`reservationId`、`requestedBudget`、`agent|judge` role、durable `inputRef`、共享 evidence refs 和可选 `modelPolicyRef`。它拒绝 raw prompt、credential 和未声明字段，确保远程 worker 与进程内 worker 消费同一 policy-safe contract。

Governed root loader 以结构化 code 区分不可自动重试的损坏：

| Code | 含义 |
|---|---|
| `ROOT_RUN_AGGREGATE_INCOMPLETE` | GraphRun 缺少同 ID root EngineRun |
| `ROOT_RUN_AGGREGATE_DIVERGED` | 两个 projection 的 scope、graph identity、版本或状态不兼容 |
| `ROOT_RUN_BUDGET_MISSING` | root EngineRun 缺少调用方授权的 limits |

`WorkGraphEventKind` 的 `root_run_repaired` 只记录显式 v1.1.0 graph-only migration；它不能由普通 loader 或恢复流程生成。
