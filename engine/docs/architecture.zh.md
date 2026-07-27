# Qiongqi Durable Engine v1.1.1 架构

本文描述当前实现，不是路线图。Qiongqi 是纯引擎；身份、业务价值、模型凭证、Agent binding 和产品交互均由下游提供。

## 1. 执行平面

```text
GraphRevision(graphId, revision, digest)
  -> Durable GraphRun + WorkGraphEvent
  -> evented_v2: node/edge/mailbox/outbox/join/retry
       -> AgentRun
            -> KernelRun: model/tool/context/memory/checkpoint
```

- `evented_v2` 是唯一跨 Agent 编排平面。
- Kernel 是单个 AgentRun 的隔离执行平面，不直接推进父图。
- `DurableEngineStore` 是 graph、run、checkpoint、ledger、stream、outbox、cost/value 的事实源。
- 进程内 event bus、cache、自然语言摘要和 SSE 连接都不是事实源。

## 2. Immutable graph revision

`compileAgentGraph()` 规范化兼容 `AgentGraph`，分配稳定 edge id，拒绝重复 identity，并计算 SHA-256 canonical digest。`GraphRevision` 发布后不可变；同一 `(graphId, revision)` 只能对应同一 digest。

Graph node 支持 `agent`、`handoff`、`tool`、`judge`、`join`、`wait`、`retry`、`terminate`。node/edge 可以引用独立版本化 policy；旧 `node.model` 只产生迁移诊断，不能成为隐式模型绑定。

Graph run 固定保存 `graphId`、`graphRevision` 和 `graphDigest`。恢复、审批、circuit 和资源操作都先校验 pinned identity，防止运行中配置漂移。

## 3. Durable work graph

静态 graph 表达意图，`WorkGraphEvent` 表达真实执行。事件包含完整 task scope、run、revision、node/edge、attempt 和单调 seq，覆盖 node/edge 选择、child lifecycle、模型路由、审批、资源、预算和 circuit。

所有 graph run、evented_v2 state、mailbox/outbox 和 work event 通过同一 store transaction/CAS/fence 提交。恢复时按事实重建，不从日志文本或“找不到 snapshot”推断新任务。

## 4. Governed root aggregate 与 dispatch

Governed run 的 `GraphRunRecord` 和 root `EngineRunRecord` 使用同一 `runId`、`TaskScope`、graph identity 与严格相同版本。创建和每次状态推进都通过一个 `EngineCommit` 原子写入两个 projection；任一 projection 缺失、版本不等或生命周期不兼容时，引擎分别以 `ROOT_RUN_AGGREGATE_INCOMPLETE`、`ROOT_RUN_AGGREGATE_DIVERGED` 或 `ROOT_RUN_BUDGET_MISSING` fail closed。

每次 Agent/Judge dispatch 遵循 prepare-first：先生成稳定的 AgentRun、KernelRun、reservation 和 intent identity，在 root transaction 中持久化，再通知 worker。进程内通知仅降低延迟；本地和远程 worker 都 claim 同一 `agent_execution_requested` intent，使用 lease/fence 和 `renewWorkClaim()` 续租，并通过 `inputRef` 解析输入。过期 claim 可由更高 fence 接管，恢复不得为同一 attempt 生成新 identity。

Governed `start()` 必须接收调用方授权的 `budgetLimits`，并在 root aggregate 与首次 dispatch preparation 提交后返回，不等待模型完成。根预算在 store transaction 内按以下逐字段公式校验：

```text
sum(settled reservation actual usage)
+ sum(active reservation requested usage)
+ new requested usage
<= root budgetLimits
```

released reservation 不占预算；root 的 `budgets` projection 只累计 settled actual usage。模型/node policy 只能收紧调用方限制，不能提供或扩大限制。

## 5. Durable facade

| API | 语义 |
|---|---|
| `publishGraph(revision)` | 发布 immutable graph revision，重复相同 digest 幂等 |
| `start(input)` | 带 `graphRef` 时要求 `budgetLimits`，并在首次 durable dispatch 准备完成后返回；省略时仅走 v1.0 兼容入口 |
| `inspect(runId)` | 从 store 返回 graph run 和全部 work events |
| `migrateGraphOnlyRun(input)` | 用调用方提供的 root limits 显式修复 v1.1.0 graph-only run，并写 `root_run_repaired` |
| `resolveCheckpoint(id, resolution)` | 以单次 token 和 pinned revision 原子解决审批 |
| `setGraphCircuit(runId, state)` | 人工降级或恢复并记录 work event |
| `resume` / `cancel` | 恢复 Kernel wait 或写入取消意图；late completion 受 fence 保护 |
| `subscribe` / `ack` | 从 durable stream seq 续传并维护 subscriber cursor |
| `recordCost` / `recordValue` | 持久化计量并返回、发布实时 ROI snapshot |
| `setTaskModelPolicy` | 以递增 revision 更新任务模型授权 |

Facade 不缓存 graph governance 状态。新实例可只凭 store 恢复 inspect、checkpoint 和 circuit 操作。

loader 和 `inspect()` 不会自动创建缺失 projection。graph-only v1.1.0 run 只能由调用方显式授权 `migrateGraphOnlyRun({ runId, budgetLimits })`；terminal run 只修复审计一致性，不会重新 dispatch。

## 6. 模型无关路由

`ModelProfileRegistry` 将 `profileId@revision` 映射到 `providerId`、`modelId`、endpoint format、capabilities 和 `credentialRef`。任务 `ModelSelectionPolicy` 可以授权多个 profile；graph node 的 `modelPolicyRef` 可以施加更窄策略。

每次物理模型调用固定 immutable profile revision，并把 graph correlation 写入 usage/ledger/trace。任务切换 profile 必须提交下一 policy revision；已开始的 operation 不被中途替换。核心没有厂商名、默认 model id 或明文 API key fallback。

## 7. 去重、压缩与记忆

- 模型和工具 operation 使用稳定 request/context/effect fingerprint。
- completed operation replay 已提交结果；semantic duplicate 可 suppression；provider effect 不确定时进入 waiting verification，不自动重发。
- `TaskCheckpoint` 保存目标、约束、决策、证据、预算、等待状态和 durable refs；`ContextCheckpoint` 保存压缩 provenance 和 identity。
- `task_shared` 仅在 task scope 内可见；`agent_private` 绑定 AgentRun，只有显式 publish 才进入共享域。

## 8. 治理

Human checkpoint 必须对应唯一允许 resume edge，resolution token 单次消费并校验 graph revision。Resource claim 按 resource key 冲突；write claim 必须含 fence，`report_only` 只允许 read claim。

自动 circuit 只能提升严重度：`running -> report_only -> paused -> retired`；恢复必须通过显式 `setGraphCircuit()`，并写 `circuit_resumed`。readiness 由 definition、telemetry、production store、recovery drill、budget、approval、resource fence、trace、cancel 和 circuit 证据计算为 `draft`、`observe`、`assisted` 或 `autonomous`。

## 9. Streaming、ROI 与可观测性

模型 delta、工具 lifecycle、checkpoint、work graph、usage、ROI 和 outcome 先写 durable stream，再通过 SSE 传输。`streamId + seq` 是顺序与 replay identity；subscriber ack 独立，断连不取消任务。private reasoning 默认 collect/persist/subscribe/retain 全关闭。

`CostEntry`、`ValueEvent` 和 usage 可携带 graph/node/edge/attempt attribution。实时 `RoiSnapshot` 提供 `byNode`、`byEdge`、fan-out、retry amplification、suppressed physical attempts、avoided cost 和 executed critical-path latency。外部等待时间不计入执行 critical path。业务价值必须由下游提供 evidence；引擎 efficiency 不伪造业务 ROI。

OpenTelemetry span 只写 policy-safe identity 和数值指标，不写 prompt、工具参数、凭证或 private reasoning。

## 10. 存储与一致性

PostgreSQL 是多实例生产必需实现；SQLite/in-memory 用于单进程与 conformance。生产 store 必须提供 transaction、CAS、lease/fence、work claim 续租、immutable revision conflict、single-use checkpoint token、resource claim 和 outbox claim 语义。PostgreSQL 在创建 reservation 时锁定 parent row，使累计预算判定与写入处于同一串行化临界区。

v1.1 schema 为 additive graph tables/records。未完成 v1.0 run 不原地伪造成 governed graph；迁移规则见 [engine-v1.1.md](./migrations/engine-v1.1.md)。
