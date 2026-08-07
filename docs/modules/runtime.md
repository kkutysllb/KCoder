# runtime 模块（runtime module）

> QiLin engine · runtime subsystem · 双语 / Bilingual

---

## 中文版

### 职责

`qilin.runtime` 是 QiLin 的"控制平面"，负责管理 LangGraph 的运行生命周期：Run、Checkpoint、Store、Stream Bridge、Secret Context、Context Compaction 等。

- **Run 管理**：`runs/` 中 `RunManager` / `RunRecord` / `RunStatus` 维护每一次 Agent 调用的状态、取消、并发限制
- **Checkpoint**：`checkpointer/` 抽象 LangGraph 的 state-persistence checkpointer（SQLite / Postgres）；`checkpoint_state.py` 提供 `CheckpointStateAccessor`
- **Store**：`store/` 提供 LangGraph Store（key-value 跨线程状态），由 `base` 模块选择 backend
- **流桥（Stream Bridge）**：`stream_bridge/` 把 LangGraph 的内部流暴露为 SSE 或 Redis Pub/Sub：`MemoryStreamBridge` / `RedisStreamBridge`
- **序列化**：`serialization.py` + `converters.py` 处理 LangChain 对象 → JSON 兼容值的转换
- **用户上下文**：`user_context.py` 在 LangGraph 之外维护用户身份
- **Secret 上下文**：`secret_context.py` 让敏感字段经过加密后再存储到 checkpoint
- **Context 压缩**：`context_compaction.py` 在长对话里压缩历史 token
- **Journal**：`journal.py` 持久化 Run events 决策日志
- **Goal**：`goal.py` 把 Agent 的"目标"作为全局上下文传递

### 关键文件

| 文件 / 子包 | 作用 |
|--------------|------|
| `runtime/runs/` | Run 生命周期管理 |
| `runtime/checkpointer/` | 持久化 checkpointer 抽象 |
| `runtime/store/` | LangGraph Store 适配 |
| `runtime/stream_bridge/` | SSE / Redis 流桥 |
| `runtime/serialization.py` | LC 对象序列化 |
| `runtime/converters.py` | 复杂类型转换 |
| `runtime/user_context.py` | 用户身份解析 |
| `runtime/secret_context.py` | 敏感上下文处理 |
| `runtime/context_compaction.py` | 长对话压缩 |
| `runtime/journal.py` | Run 决策日志 |
| `runtime/goal.py` | 跨图目标上下文 |
| `runtime/events/` | Run events 分类（cancel / progress / interrupt） |
| `runtime/stream_modes.py` | LangGraph stream-mode 适配 |
| `runtime/checkpoint_mode.py` | checkpoint channel 读写模式（freeze / normal） |
| `runtime/checkpoint_state.py` | checkpoint state 访问器 |

### 设计要点

1. **统一 RunRecord**：`RunRecord` 是每条 Run 的"单一真相源"，所有中间件、UI、查询接口都基于它。
2. **流桥可插拔**：memory 桥用于单进程，redis 桥用于跨进程（多 worker）。
3. **Secret 上下文**：使用 Pydantic SecretStr + Fernet 加密，确保 checkpoint 中不再有明文 API Key。
4. **Context Compaction**：当 LLM 调用前的 token 累计超过阈值时，自动摘要化早期消息，保证不会触发模型超长报错。
5. **Run Status**：`RunStatus`（idle / pending / streaming / interrupted / completed / failed / cancelled）覆盖了所有可观察状态。

### Run 生命周期

```
new → pending → (admission?) → streaming → (interrupt?) → completed | failed | cancelled
```

每个状态变更都触发 `journal` 写入；`RunManager` 维护全局 `pending_admission_queue`（受并发上限保护）。

### 关联模块

- **上游**：`agents/lead_agent/` 构造 Agent 后提供给 runtime/runs
- **下游**：`persistence/run/` 持久化 RunRecord；`persistence/run_events/` 存 Run events；`tui/` 订阅 stream bridge

---

## English Version

### Responsibility

`qilin.runtime` is QiLin's "control plane" — managing LangGraph run lifecycle, checkpoint, store, stream bridges, secret handling, and context compaction.

- **Run management** — `runs/` keeps state, cancellation, and concurrency caps via `RunManager` / `RunRecord` / `RunStatus`
- **Checkpoint** — `checkpointer/` abstracts state-persistence checkpointer (SQLite / Postgres)
- **Store** — `store/` exposes LangGraph Store (cross-thread KV)
- **Stream bridge** — `stream_bridge/` wraps LangGraph internals as SSE or Redis Pub/Sub
- **Serialization** — `serialization.py` + `converters.py` convert LC objects to JSON-friendly values
- **User context** — `user_context.py` resolves user identity outside LangGraph
- **Secret context** — `secret_context.py` encrypts sensitive fields into checkpoints
- **Context compaction** — `context_compaction.py` summarizes long histories
- **Journal** — `journal.py` persists run-decision logs
- **Goal** — `goal.py` carries cross-graph goal context

### Key Files / Sub-Packages

| Path | Purpose |
|------|---------|
| `runtime/runs/` | Run lifecycle management |
| `runtime/checkpointer/` | Checkpointer abstraction |
| `runtime/store/` | LangGraph Store adapter |
| `runtime/stream_bridge/` | SSE / Redis bridges |
| `runtime/serialization.py` | LC object serializer |
| `runtime/converters.py` | Type converters |
| `runtime/user_context.py` | User identity resolver |
| `runtime/secret_context.py` | Secret handling |
| `runtime/context_compaction.py` | Long-conversation compaction |
| `runtime/journal.py` | Run decision journal |
| `runtime/goal.py` | Cross-graph goal context |
| `runtime/events/` | Run-event types (cancel/progress/interrupt) |
| `runtime/stream_modes.py` | LangGraph stream-mode adapter |
| `runtime/checkpoint_mode.py` | Channel read/write mode (freeze/normal) |
| `runtime/checkpoint_state.py` | Checkpoint state accessor |

### Design Highlights

1. **Single source of truth** — `RunRecord` is the canonical record of every run; UI / middleware / queries all read from it.
2. **Pluggable stream bridge** — Memory (single process), Redis (cross-process).
3. **Secret context** — Pydantic SecretStr + Fernet; no plaintext API keys in checkpoints.
4. **Context compaction** — Auto-summarization when token accumulation exceeds threshold.
5. **RunStatus** — `idle / pending / streaming / interrupted / completed / failed / cancelled`.

### Lifecycle

```
new → pending → (admission?) → streaming → (interrupt?) → completed | failed | cancelled
```

Every transition writes to `journal`; `RunManager` maintains a bounded `pending_admission_queue`.

### Related Modules

- **Upstream** — `agents/lead_agent/` produces agents
- **Downstream** — `persistence/run/` persists `RunRecord`; `tui/` subscribes to stream bridge
