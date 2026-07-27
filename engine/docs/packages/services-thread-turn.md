# @qiongqi/services：Thread 与 Turn 服务

> v1.1.1。服务层维护用户可见的 thread/turn 投影，并把执行操作交给 Durable Engine。

## 职责

- thread create/read/list/fork/side 和 turn item 查询。
- turn create、输入追加、等待状态投影、终态映射。
- goal/todo 等兼容投影和事件记录。
- usage、artifact 和 runtime event 的服务级查询。

## v1 边界

- `taskId` 是跨 turn 的 durable identity；threadId 不是 task identity。
- service 不直接重发模型或工具调用，也不自行判断恢复点。
- task checkpoint/outbox 提交成功后才更新用户可见投影。
- 模型选择来自 task `ModelSelectionPolicy`；service 不注入默认模型名称。
- cancel 先写 durable desired state，再由 Kernel 在安全边界停止。
