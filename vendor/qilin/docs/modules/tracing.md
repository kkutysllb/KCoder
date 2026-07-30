# tracing 模块（tracing module）

> QiLin engine · tracing subsystem · 双语 / Bilingual

---

## 中文版

### 职责

`qilin.tracing` 提供可观测性适配层。它围绕"请求级 trace_id" 与"Run 级事件流"，把 QiLin 的所有内部动作暴露给 Langfuse、Monocle 等追踪平台。

- **trace 上下文**：`trace_context.py` + 全局 `ContextVar` `_current_trace_id`
- **元数据桥接**：`metadata.py` 把 trace_id 注入 LangChain call metadata，使 Langfuse / Monocle 自动跟随
- **Monocle 适配**：`monocle.py` 把 OpenTelemetry 风格的 Span 注入到 LangChain 调用
- **多 provider 工厂**：`factory.py` 支持按 `tracing_config.providers` 列表启用多个 backend
- **运行集成**：`setup_monocle_tracing_if_enabled()` 在 Gateway lifespan 启动时调用

### 关键文件

| 文件 | 作用 |
|------|------|
| `tracing/__init__.py` | 对外 API：`get_tracing_metadata()` 等 |
| `tracing/factory.py` | 多 provider 路由 |
| `tracing/metadata.py` | metadata 注入 LangChain calls |
| `tracing/monocle.py` | Monocle 适配 |
| `trace_context.py` | 全局 `_current_trace_id` ContextVar（模块顶层文件） |

### 设计要点

1. **请求 trace 一致**：`X-Trace-Id` header 进入 Gateway → `TraceMiddleware` 校验 → ContextVar → 日志/Run event/Langfuse 三处一致
2. **metadata 双注入**：LangChain Tool 调用和 LLM 调用都会带上 `qilin_trace_id`，便于 Langfuse 关联
3. **Monocle 可选**：仅当 `tracing_config.monocle.enabled=true` 时启用，避免引入 OpenTelemetry 副作用
4. **多次初始化安全**：`setup_monocle_tracing_if_enabled()` 是幂等的，重复调用不报错
5. **日志 trace**：`logging_config.py` 中的 `_qilin_trace_context_filter` 帮所有 log 注入 trace_id

### 配置示例

```yaml
tracing:
  providers:
    langfuse:
      enabled: true
      public_key: ${LANGFUSE_PUBLIC_KEY}
      secret_key: ${LANGFUSE_SECRET_KEY}
    monocle:
      enabled: false
```

### 关联模块

- **横切**：所有 `runtime/runs/manager.py`、`agents/lead_agent/agent.py` 都通过 `tracing/metadata.py` 注入 trace
- **上游**：`config/tracing_config.py`

---

## English Version

### Responsibility

`qilin.tracing` is the observability adapter layer. Built around "request-level trace_id" and "run-level event streams", it surfaces QiLin's internal actions to Langfuse, Monocle, etc.

- **Trace context** — `trace_context.py` + global `ContextVar` `_current_trace_id`
- **Metadata bridging** — `metadata.py` injects `trace_id` into LangChain call metadata for Langfuse / Monocle to follow
- **Monocle adapter** — `monocle.py` injects OTel-style spans into LangChain calls
- **Multi-provider factory** — `factory.py` routes via `tracing_config.providers`
- **Runtime integration** — `setup_monocle_tracing_if_enabled()` is called at Gateway lifespan startup

### Key Files

| File | Purpose |
|------|---------|
| `tracing/__init__.py` | Public API: `get_tracing_metadata()` |
| `tracing/factory.py` | Multi-provider router |
| `tracing/metadata.py` | Metadata injection |
| `tracing/monocle.py` | Monocle adapter |
| `trace_context.py` | Global `_current_trace_id` ContextVar (top-level) |

### Design Highlights

1. **Single trace ID everywhere** — `X-Trace-Id` → Gateway middleware → ContextVar → logs/RunEvent/Langfuse all share.
2. **Dual injection** — Both LangChain Tool calls and LLM calls carry `qilin_trace_id`.
3. **Optional Monocle** — Only enables when `tracing_config.monocle.enabled=true`.
4. **Idempotent setup** — `setup_monocle_tracing_if_enabled()` is safe to call repeatedly.
5. **Log trace** — `_qilin_trace_context_filter` injects trace_id into all log records.

### Config Example

```yaml
tracing:
  providers:
    langfuse:
      enabled: true
      public_key: ${LANGFUSE_PUBLIC_KEY}
      secret_key: ${LANGFUSE_SECRET_KEY}
    monocle:
      enabled: false
```

### Related Modules

- **Cross-cutting** — `runtime/runs/manager.py`, `agents/lead_agent/agent.py` all consume `tracing/metadata.py`
- **Upstream** — `config/tracing_config.py`
