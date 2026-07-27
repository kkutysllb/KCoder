# @qiongqi/memory：任务记忆

> v1.1.1。记忆以 task scope 和 AgentRun scope 隔离，lexical retrieval 只在授权 namespace 内发生。

## Namespace

| Namespace | 主键范围 | 可见性 |
|---|---|---|
| `task_shared` | owner/workspace/task | 同任务授权 Agent |
| `agent_private` | owner/workspace/task/agentRun | 单一 AgentRun |

写 private memory 不会自动进入 shared。显式 publish 必须生成新的 shared record、provenance 和 source ref。查询必须携带 discriminated namespace；禁止用缺省 scope 扫描其他任务。

旧 user/workspace/project 记录属于 legacy API，不自动注入 v1 TaskCheckpoint，也不自动迁移。排序、截断和注入数量只影响检索投影，不改变 durable memory 事实。
