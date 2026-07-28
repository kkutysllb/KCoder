# @qiongqi/contracts：v1.1 公共契约

> v1.1.4。零业务依赖的 Zod/TypeScript contract 包，是 engine、adapter 和 transport 的共享语言。

## 核心 schema

| 模块 | 核心类型 |
|---|---|
| `engine-identity` | `TaskScope`、完整 graph/run/node/edge/attempt correlation |
| `graph-definition` | `GraphRevision`、九类 node（含 `parallel`）、versioned node/edge/model policy ref |
| `graph-runtime` | `ExecutionContext`、`GraphRunRecord`、带 `branchId` 的 `WorkGraphEvent` |
| `graph-governance` | branch-aware human checkpoint、resource claim、circuit、readiness evidence |
| `execution-ledger` | model/tool operation key、status、profile ref、replay descriptor |
| `task-checkpoint-v1` | task/context checkpoint、waiting state、provenance |
| `memory` | `task_shared`、`agent_private` record/query/create request |
| `model-profile` | profile、capabilities、task selection policy 和 route decision |
| `engine-stream` / `usage` | stream policy、cost/value、graph/branch attribution、ROI、efficiency |
| `multi-agent-runtime` | 策略完整 AgentGraph、dispatch v1/v2/v3、durable branch、非空 JoinResult、AgentRun、mailbox/outbox |
| `turns` | governed execution request、Turn↔GraphRun binding 与普通 Turn 生命周期 |
| `turn-execution-policy` | immutable per-turn skill/tool/output policy snapshot、digest/ref 与 validator verdict |
| `builtin-tool-names` | core 与 adapter 共享的 plan/goal/todo 工具名称 |

## 不变量

- graph revision 以 `(graphId, revision, graphDigest)` 固定；child context 必须继承父 graph identity。
- edge work event 必须有 edge id；write resource claim 必须有 fence。
- profile 和 policy 引用包含 revision，恢复不能静默切换模型配置。
- `credentialRef` 只引用 secret；durable schema 不接收明文凭证。
- private stream/reasoning 和 private memory 必须显式区分。
- strict schema 拒绝未知字段；跨版本变化通过 revision/schema 表达。
- `StartTurnRequest` 是 strict schema；产品策略只能通过声明过的 `explicitSkillIds` 与 `executionPolicy` 字段进入，拼进 prompt 或发送未知字段不构成执行约束。
- execution policy 以 canonical list 和 SHA-256 digest 固定；`requiredSkillIds` 必须是 `allowedSkillIds` 的子集，空 allow-list 表示 deny all，不表示“未配置”。
- `parallel.branches` 至少两个；owning join 的 required branch set 必须精确匹配且非空。nested parallel 在 v1.1.3 仍不支持。
- `JoinResult.branches` 至少包含一个 terminal branch，并以稳定 branch ID 顺序构建。

## Per-turn execution policy

`StartTurnRequest.executionPolicy` 接受一个版本化策略：

```ts
{
  policyId: 'product.finance.writer',
  revision: 3,
  skills: {
    allowedSkillIds: ['finance-report'],
    requiredSkillIds: ['finance-report']
  },
  tools: { allowedToolNames: ['read', 'write_report'] },
  output: {
    validatorRef: {
      validatorId: 'finance-report-v1',
      revision: 1,
      digest: '<64 lowercase hex chars>'
    }
  }
}
```

创建 Turn 时引擎排序、去重并持久化 `TurnExecutionPolicySnapshot`，生成覆盖完整 canonical policy 的 digest。恢复和重试复用该 snapshot，不从当前产品 catalog 或 prompt 重建。未提供 `executionPolicy` 的 Turn 保留 v1.1.2 行为。

`explicitSkillIds` 是公开、可持久化的显式激活请求；存在 policy 时仍受 `allowedSkillIds` 约束。`Turn.outputValidation` 持久化 `accepted | rejected | error` verdict，防止完成重试重复执行 validator。

## Dispatch 与取消契约

`KernelDispatchPayload` 是 `agent_execution_requested` outbox intent 的 strict discriminated union。当前写入端统一生成 `schemaVersion: 3`，在稳定 `AgentRunIdentity`、预算、role、`inputRef` 和 policy refs 之外固定 `threadId`、`turnId`、`workspaceKey` 与 `nodePolicyRef`。读取端继续接受 schema v1/v2，并从 durable GraphRun、root EngineRun、固定 GraphRevision 和 AgentRun 权威补全；payload 中任何已提供但矛盾的 graph/context/policy 值都会 fail closed。它拒绝 raw prompt、credential 和未声明字段。

Agent/Judge graph node 可以固定 `executionPolicyRef`。编译后的 immutable graph revision、prepared dispatch 和恢复 worker 必须原样传递该引用；恢复时不能静默改用同 ID 的新 revision 或不同 digest。

`KernelCompletionPayload` 用稳定 execution identity 返回 outcome、usage refs 和 artifact refs；branch identity 从准备好的 AgentRun 解析。`KernelCancellationPayload` 区分 `fail_fast` 与 `root_cancel`，可携带 `branchId`。branch/root cancellation 与 `branch_late_result` 都是公开 work/stream lifecycle fact，不依赖日志文本。

Governed root loader 以结构化 code 区分不可自动重试的损坏：

| Code | 含义 |
|---|---|
| `ROOT_RUN_AGGREGATE_INCOMPLETE` | GraphRun 缺少同 ID root EngineRun |
| `ROOT_RUN_AGGREGATE_DIVERGED` | 两个 projection 的 scope、graph identity、版本或状态不兼容 |
| `ROOT_RUN_BUDGET_MISSING` | root EngineRun 缺少调用方授权的 limits |

`WorkGraphEventKind` 的 `root_run_repaired` 只记录显式 v1.1.0 graph-only migration；它不能由普通 loader 或恢复流程生成。
