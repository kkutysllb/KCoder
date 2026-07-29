# utils 模块（utils module）

> QiLin engine · utils subsystem · 双语 / Bilingual

---

## 中文版

### 职责

`qilin.utils` 是与业务无关的纯函数库。它为其他模块提供：

- 异步 / 并发工具
- 文件 I/O（受限路径下的复制 / 移动）
- JSON 序列化兼容
- 哈希 / 校验
- 日志工具
- 限流 / 软锁
- 自定义事件总线（`custom_events.py`）

### 关键文件

| 文件 | 作用 |
|------|------|
| `utils/async_helpers.py` | async 任务池 / gather helper |
| `utils/file_io.py` | 异步文件读写（批量 worker） |
| `utils/json_compat.py` | Old Python JSON 兼容 |
| `utils/hashing.py` | sha256 / md5 |
| `utils/limiter.py` | 限流令牌桶 |
| `utils/soft_lock.py` | 进程内软锁（asyncio.Lock） |
| `utils/oneshot_llm.py` | 一次性 LLM 调用（用于元调用如 summarization） |
| `utils/custom_events.py` | 自定义事件总线（LangGraph middleware 间通信） |

### 设计要点

1. **零业务耦合**：不会导入 `config` 或 `runtime`，可单独测试
2. **类型安全**：返回类型严格，便于 IDE 提示
3. **可观测**：`oneshot_llm.py` 的每次调用都上报 `tracing`，便于审计"哪些 utils 触发了 LLM"
4. **事件总线**：`custom_events` 是 middleware 之间通信的关键，避免直接依赖 channel 字段

### 关联模块

- **横切**：被几乎所有其他模块使用

---

## English Version

### Responsibility

`qilin.utils` is a business-agnostic pure-function library. It provides:

- Async / concurrency helpers
- File I/O (path-restricted copy/move)
- JSON serialization compat
- Hashing / checksums
- Logging helpers
- Rate limiting / soft lock
- Custom event bus (`custom_events.py`)

### Key Files

| File | Purpose |
|------|---------|
| `utils/async_helpers.py` | asyncio task pool / gather |
| `utils/file_io.py` | Async file IO (batched workers) |
| `utils/json_compat.py` | Old-Python JSON compat |
| `utils/hashing.py` | sha256 / md5 |
| `utils/limiter.py` | Token-bucket rate limit |
| `utils/soft_lock.py` | In-process soft lock (asyncio.Lock) |
| `utils/oneshot_llm.py` | One-shot LLM call (summarization, etc.) |
| `utils/custom_events.py` | Custom event bus (middleware-to-middleware) |

### Design Highlights

1. **Zero business coupling** — Never imports `config` or `runtime`; testable in isolation.
2. **Strict typing** — Strict return types for IDE hints.
3. **Observable** — `oneshot_llm.py` reports every call to `tracing`.
4. **Event bus** — `custom_events` enables middleware-to-middleware communication without channel coupling.

### Related Modules

- **Cross-cutting** — Used by nearly every other module
