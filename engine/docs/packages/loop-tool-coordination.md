# @qiongqi/loop：工具协调

> v1.1.4。`ToolCallCoordinator` 在执行前查询 durable effect ledger，并将工具进度写入 engine stream。

graph node 执行时，ledger、usage 和 stream event 传播 graph/node/edge/attempt attribution，使 semantic suppression 和 avoided cost 可按 work graph 归因。

## 执行流程

1. 规范化工具名和参数，计算稳定 semantic fingerprint。
2. 解析工具声明的 effect class、idempotency key、verify/replay policy。
3. 在 store 中 claim logical attempt；CAS 失败后重新读取 ledger。
4. completed/replayed 直接返回已提交结果，suppressed 返回已有证据，uncertain 进入 verification wait。
5. 新物理执行产生 progress/output/usage 事件，完成后与 result ref 原子提交。

## 治理

- 只读工具可在预算内并行；有副作用工具默认串行。
- `ToolStormBreaker` 是正常运行期无进展保护，不代替 durable ledger。
- history hygiene、tool result budget 和 externalization 控制上下文体积。
- bash command audit、路径边界和 terminal-state guard 在 effect 前后执行。
- 缺少 effect metadata 的生产工具 fail-closed，不回退到宽松重放。
