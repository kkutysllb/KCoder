# @qiongqi/delegation — Registry / Map

> v1.1.4。registry 解析 Agent/peer capability binding；执行状态仍由 AgentRun/KernelRun 和 outbox 管理。

> `PeerRegistry` + `SkillRegistry` + `TaskThreadMap` —— 跨实例寻址基础设施。
> Layer 7 — 同 runtime 子模块。

---

## 中文

### 1. 职责

本子模块提供**多 Agent 协作的"地址簿 + 调度簿"**：

- **`PeerRegistry`** —— 统一本地 / 远程 peer 寻址入口；通过依赖反转让 `@qiongqi/delegation` 不依赖 HTTP
- **`FilePeerStore`** —— 远程 peer 持久化（本地 peer 不持久化，因 handle 不能跨重启）
- **`SkillRegistry`** —— Agent ↔ Skill 绑定（哪些 skill 属于哪个 agent）
- **`TaskThreadMap`** —— Orchestrator 任务 → 子 Agent 线程映射（持久化到 JSON）

### 2. 公共 API

| 导出 | 类型 | 来源文件 | 一句话 |
|------|------|---------|--------|
| `LocalPeerHandle` | interface | `peer-registry.ts` | 进程内 peer 句柄 |
| `RemotePeerTransport` | interface | `peer-registry.ts` | 远程传输接口（由 `http/HttpPeerTransport` 实现）|
| `PeerRegistry` | class | `peer-registry.ts` | 统一寻址入口 |
| `PeerRegistryChangeHandler` | type | `peer-registry.ts` | `(event: 'added' \| 'removed', cardId) => void` |
| `PeerRegistryOptions` | type | `peer-registry.ts` | 构造配置 |
| `FilePeerStore` | class | `peer-registry.ts` | `<dir>/peers.json` 持久化 |
| `SkillRegistry` | class | `skill-registry.ts` | Agent ↔ Skill 绑定 |
| `SkillEntry` | type | `skill-registry.ts` | `{ skillId, agentCardId, state: 'bound' \| 'unbound' }` |
| `TaskThreadMap` | class | `task-thread-map.ts` | 任务 → 线程映射 |
| `SubTaskEntry` / `OrchestratorTaskEntry` | type | `task-thread-map.ts` | 单条任务/子任务 |

#### `PeerRegistry` 关键方法

```typescript
registerLocal(handle: LocalPeerHandle): void
registerRemote(card: AgentCard): void         // 依赖 RemotePeerTransport
unregister(cardId: string): void
get(cardId): LocalPeerHandle | AgentCard | undefined
getCard(cardId): AgentCard | undefined
list(): (LocalPeerHandle | AgentCard)[]
size: number
invokePeer(cardId, task: PeerTask, signal): Promise<PeerArtifact>
```

#### `SkillRegistry` 关键方法

```typescript
scanFromDir(rootDir, agentCardId?): Promise<number>   // 返回扫描数
register(skillId, agentCardId): void
unbind(agentCardId): void
findBySkill(skillId): SkillEntry[]
listByAgent(agentCardId): SkillEntry[]
allSkills(): SkillEntry[]
size: number
```

#### `TaskThreadMap` 关键方法

```typescript
record(orchThreadId, agentId, threadId, prompt): SubTaskEntry
updateStatus(orchThreadId, agentId, threadId, status): void
getSubTasks(orchThreadId): SubTaskEntry[]
getAgentThreads(agentId): SubTaskEntry[]
clearThread(orchThreadId): void
size: number
persist(dataDir): Promise<void>      // 写 <dataDir>/task-thread-map.json
load(dataDir): Promise<number>        // 加载；返回条目数
```

### 3. 关键不变量

- **依赖反转**：`@qiongqi/delegation` 不依赖 `@qiongqi/http`；`RemotePeerTransport` 是接口，由 `http/HttpPeerTransport` 实现（`peer-registry.ts:14-37` 注释明确）。
- **本地 peer 不持久化**：in-process handle 不能跨重启存活；`FilePeerStore` 只保存 remote peer。
- **并发策略不在 registry 层**：`PeerRegistry.invokePeer` 不强制 `maxParallel`；`DelegationRuntime` 才是该职责的承担者。
- **`SkillRegistry.scanFromDir` 容错**：单个 `SKILL.md` 解析失败静默跳过（`skill-registry.ts:73`）。
- **`TaskThreadMap.record` 去重**：相同 `(agentId, threadId)` 的多次记录会更新现有条目的 `prompt` 而非追加（`task-thread-map.ts:46-49`）。
- **`TaskThreadMap.persist` 写整个 snapshot**：每次覆盖；不适合高频写。

### 4. 行为规约

来自 `tests/`:（registry 行为主要通过 delegation-runtime / child-agent-executor 集成测验证）

- `PeerRegistry.registerLocal appends to the in-memory map`
- `PeerRegistry.registerRemote requires the RemotePeerTransport option`
- `PeerRegistry.invokePeer dispatches to local handle when present`
- `PeerRegistry.invokePeer dispatches to remote transport when only the card is registered`
- `PeerRegistry.unregister works for both local and remote cards`
- `FilePeerStore persists only remote peers; load returns the persisted cards`
- `SkillRegistry.scanFromDir returns the count of successfully parsed SKILL.md files`
- `SkillRegistry.register creates a bound entry; unbind marks it unbound`
- `TaskThreadMap.record dedupes on (agentId, threadId)`
- `TaskThreadMap.persist writes a snapshot; load restores it on restart`

### 5. 使用示例

```typescript
import {
  PeerRegistry,
  FilePeerStore,
  SkillRegistry,
  TaskThreadMap,
} from '@qiongqi/delegation'
import { HttpPeerTransport } from '@qiongqi/http'

// 1. Peer registry
const peerStore = new FilePeerStore({ dir: '/work/.qiongqi/peers' })
const transport = new HttpPeerTransport({ /* ... */ })
const peers = new PeerRegistry({
  remoteTransport: transport,
  peerStore,
  onChange: (event, cardId) => console.log(event, cardId),
})

// 2. Register a local child
peers.registerLocal({
  card: { id: 'qiongqi:child_1', name: 'Helper', /* ... */ },
  invoke: async (task, signal) => ({ /* PeerArtifact */ }),
})

// 3. Register a remote peer
peers.registerRemote({
  id: 'qiongqi:remote_a',
  url: 'http://other-host:8899',
  name: 'Remote agent',
  /* ... */
})

// 4. Invoke transparently
const result = await peers.invokePeer('qiongqi:remote_a', task, signal)

// 5. Skill registry
const skills = new SkillRegistry()
await skills.scanFromDir('/work/.qiongqi/skills', 'qiongqi:agent_1')
const agentSkills = skills.listByAgent('qiongqi:agent_1')

// 6. Task thread map
const taskMap = new TaskThreadMap()
taskMap.record('orch_thread_1', 'qiongqi:agent_1', 'thread_child_1', 'investigate auth')
await taskMap.persist('/work/.qiongqi')
// 重启后：
const taskMap2 = new TaskThreadMap()
const count = await taskMap2.load('/work/.qiongqi')
```

### 6. 关联文档

- 架构文档：[`../architecture.zh.md#4-关键架构决策`](../architecture.zh.md#4-关键架构决策)（§4.5 AgentCard / PeerRegistry / A2A）
- 消费方：`@qiongqi/http` 的 AgentCard 端点；`@qiongqi/delegation` 的 DelegationRuntime
- 源文件：[`peer-registry.ts`](../../packages/delegation-layer/delegation/src/peer-registry.ts)、[`skill-registry.ts`](../../packages/delegation-layer/delegation/src/skill-registry.ts)、[`task-thread-map.ts`](../../packages/delegation-layer/delegation/src/task-thread-map.ts)
- 测试：通过 `tests/delegation-runtime.test.ts` 集成测验证
