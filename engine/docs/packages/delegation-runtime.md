# @qiongqi/delegation：子 Agent 运行时

> v1.1.4。委派通过 AgentRun + isolated KernelRun 实现，不创建共享的隐式执行上下文。

## 职责

- 校验 Agent binding、并发上限、child-run 预算和取消状态。
- 将子任务提交给 evented_v2 orchestration plane。
- 为每个子 Agent 使用独立 `agent_private` memory namespace。
- 通过 completion outbox 报告 outcome、usage 和 artifact refs。
- 终态 guard 拒绝迟到 worker 覆盖 completed/failed/cancelled 状态。

## 模型选择

委派请求传递 task policy 允许的 profileId；子 Agent 可以从授权候选中选择，但不能引用未授权 profile。模型切换是 policy revision，不是任意字符串覆盖。凭证由 provider resolver 获取，绝不进入委派 payload。

## 预算

父 run 先预留 child budget，再允许 KernelRun 开始。完成、失败或取消后按实际 usage 结算并释放剩余额度。重复 completion outbox 是幂等的。
