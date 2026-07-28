# @qiongqi/services：Thread 与 Turn 服务

> v1.1.4。服务层维护用户可见的 thread/turn 投影，并把执行操作交给 Durable Engine。

## 职责

- thread create/read/list/fork/side 和 turn item 查询。
- turn create、输入追加、等待状态投影、终态映射。
- goal/todo 等兼容投影和事件记录。
- usage、artifact 和 runtime event 的服务级查询。
- strict `StartTurnRequest` 解析、per-turn execution policy snapshot 持久化和 output validator 终态门禁。
- `governedExecution` 请求持久化、Turn↔GraphRun 单一绑定和 GraphRun 终态幂等投影。

## 产品级强制入口

`TurnService.startTurn()` 公开接受：

- `explicitSkillIds`：显式请求激活的 skill IDs，创建时直接持久化；
- `executionPolicy.skills.allowedSkillIds/requiredSkillIds`：skill allow-list 与必需集合；
- `executionPolicy.tools.allowedToolNames`：同时约束工具广告和执行；
- `executionPolicy.output.validatorRef`：完成前必须通过的版本化 validator。

请求 schema 拒绝未知字段，因此旧的 `allowedToolNames`、`outputValidatorId` 等顶层临时字段不会再被静默丢弃，而是立即返回验证错误。数组存在但为空具有明确 deny-all 语义；省略整个 execution policy 才表示兼容旧行为。

`finishTurn()` 在写入 completed 之前收集 Turn 的 assistant/tool items 并执行 validator。验证结果写入 `Turn.outputValidation`；恢复时复用已持久化 verdict，避免 validator 重复产生副作用。validator 失败时 runner 必须传播 `failed`，不能保留先前的 completed 状态。

`StartTurnRequest.governedExecution` 必须显式提供 `scope { ownerId, workspaceId, taskId }`、`graphRef`、`budgetLimits` 和 `modelPolicy`。`bindGovernedRun()` 拒绝第二个不同 run；`finishGovernedTurn()` 重放相同终态无副作用，矛盾终态失败关闭。服务层不把 threadId 推断为 taskId。

## v1 边界

- `taskId` 是跨 turn 的 durable identity；threadId 不是 task identity。
- service 不直接重发模型或工具调用，也不自行判断恢复点。
- task checkpoint/outbox 提交成功后才更新用户可见投影。
- 模型选择来自 task `ModelSelectionPolicy`；service 不注入默认模型名称。
- cancel 先写 durable desired state，再由 Kernel 在安全边界停止。
- policy snapshot 属于物理 Turn，不能通过 `updateTurnMetadata()` 事后放宽；该方法只维护观测元数据。
