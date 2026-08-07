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
| `utils/file_io.py` | 异步文件读写（批量 worker） |
| `utils/file_conversion.py` | 文档转换（PDF / PPT / Excel / Word → Markdown） |
| `utils/file_outline.py` | 文档大纲提取（注入上下文） |
| `utils/custom_events.py` | 自定义事件总线（LangGraph middleware 间通信） |
| `utils/oneshot_llm.py` | 一次性 LLM 调用（用于元调用如 summarization） |
| `utils/llm_text.py` | LLM 响应文本规范化 |
| `utils/messages.py` | 消息内容提取 / 还原辅助 |
| `utils/network.py` | 线程安全网络工具 |
| `utils/readability.py` | 网页正文提取（Article / ReadabilityExtractor） |
| `utils/time.py` | ISO 8601 时间戳辅助 |

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
| `utils/file_io.py` | Async file I/O (batched workers) |
| `utils/file_conversion.py` | Document conversion (PDF / PPT / Excel / Word → Markdown) |
| `utils/file_outline.py` | Document outline extraction (context injection) |
| `utils/custom_events.py` | Custom event bus (middleware-to-middleware) |
| `utils/oneshot_llm.py` | One-shot LLM calls (summarization, etc.) |
| `utils/llm_text.py` | LLM response text normalization |
| `utils/messages.py` | Message content extraction / restoration |
| `utils/network.py` | Thread-safe network utilities |
| `utils/readability.py` | Web article extraction (Article / ReadabilityExtractor) |
| `utils/time.py` | ISO 8601 timestamp helpers |

### Design Highlights

1. **Zero business coupling** — Never imports `config` or `runtime`; testable in isolation.
2. **Strict typing** — Strict return types for IDE hints.
3. **Observable** — `oneshot_llm.py` reports every call to `tracing`.
4. **Event bus** — `custom_events` enables middleware-to-middleware communication without channel coupling.

### Related Modules

- **Cross-cutting** — Used by nearly every other module
