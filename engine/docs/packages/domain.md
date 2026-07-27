# @qiongqi/domain：领域实体

> v1.1.1。该包提供 Thread、Turn、Item、Event 等纯领域实体和 reducer，不包含 store、模型或网络代码。

## 职责

- 创建和校验 thread/turn/message/tool/approval/user-input/compaction/usage item。
- 将 runtime event 确定性投影为兼容 thread/turn 视图。
- 保持实体状态机和 terminal-state 不变量。
- 为 HTTP、CLI 和 legacy service surface 提供读取模型。

Durable Engine 的事实源是 `TaskCheckpoint`、run ledger 和 outbox；domain item 是兼容投影，不应被用来推断 effect 是否执行过。模型信息只保存已解析的 profile/model 引用，不提供厂商默认值。
