# models 模块（models module）

> QiLin engine · models subsystem · 双语 / Bilingual

---

## 中文版

### 职责

`qilin.models` 是统一的聊天模型工厂层。它把多家 LLM provider（OpenAI / Anthropic / DeepSeek / Google GenAI / Ollama / 自定义）抽象为统一接口 `BaseChatModel`，并使上层 Agent 代码无需关心底层细节。

- **工厂入口**：`__init__.py` 的 `create_chat_model()` 根据 `ModelConfig.provider` 实例化正确的 chat model
- **Provider 实现**：
  - `claude_provider.py`：Anthropic Claude（含 tool + extended thinking）
  - 其它 provider 通过 `langchain-*` 自动支持
- **电路熔断**：与 `CircuitBreakerConfig` 协同，provider 连续失败即跳闸
- **限流**：与 `LlmCallConfig.max_concurrent_calls` 协同，避免突发熔断
- **重试**：内置对 transient error 的 decorrelated-jitter 重试

### 关键文件

| 文件 | 作用 |
|------|------|
| `models/__init__.py` | `create_chat_model` 工厂 |
| `models/claude_provider.py` | Anthropic Claude 适配 |

### 设计要点

1. **统一接口**：所有 provider 都返回 LangChain `BaseChatModel`，让 Agent 不感知 provider 类型
2. **配置驱动**：通过 `ModelConfig` 切换 provider，无需改代码
3. **circuit breaker + 重试 + 限流 三件套**：任何 provider 突发不稳定都不会立刻雪崩
4. **device_id 派生**：`claude_provider.py` 用 `hashlib.sha256(f"qilin-{hostname}")` 派生 device fingerprint，方便厂商侧去重
5. **可扩展**：接入新 provider 只需新增一个文件 + 在 factory 中加 `if provider == "..."` 分支

### 配置示例

```yaml
models:
  - name: gpt4o
    provider: openai
    model: gpt-4o
    api_key: ${OPENAI_API_KEY}
  - name: sonnet
    provider: anthropic
    model: claude-sonnet-4-5
    api_key: ${ANTHROPIC_API_KEY}
  - name: qwen2-local
    provider: ollama
    model: qwen2.5:14b
```

### 关联模块

- **上游**：`config/model_config.py`
- **下游**：`agents/lead_agent/agent.py`、`runtime/runs/manager.py` 通过 `create_chat_model()` 构造

---

## English Version

### Responsibility

`qilin.models` is the unified chat-model factory. It abstracts LLM providers (OpenAI / Anthropic / DeepSeek / Google GenAI / Ollama / custom) behind a uniform `BaseChatModel` interface so upstream agent code is provider-agnostic.

- **Factory entry** — `__init__.py`'s `create_chat_model()` instantiates the right chat model from `ModelConfig.provider`
- **Provider implementations**:
  - `claude_provider.py` — Anthropic Claude (tool + extended thinking)
  - Others via `langchain-*`
- **Circuit breaker** — Coordinating with `CircuitBreakerConfig`, trips after N consecutive failures
- **Rate limit** — Cooperates with `LlmCallConfig.max_concurrent_calls`
- **Retry** — Built-in decorrelated-jitter retry for transient errors

### Key Files

| File | Purpose |
|------|---------|
| `models/__init__.py` | `create_chat_model` factory |
| `models/claude_provider.py` | Anthropic Claude adapter |

### Design Highlights

1. **Unified interface** — Every provider returns LangChain `BaseChatModel`.
2. **Config-driven** — Provider switch via `ModelConfig`.
3. **Breaker + Retry + Concurrency** — Burst instability doesn't cascade.
4. **device_id derivation** — `claude_provider.py` derives device fingerprint as `hashlib.sha256(f"qilin-{hostname}")`.
5. **Extensible** — Add a provider file + a factory branch.

### Config Example

```yaml
models:
  - name: gpt4o
    provider: openai
    model: gpt-4o
  - name: sonnet
    provider: anthropic
    model: claude-sonnet-4-5
  - name: qwen2-local
    provider: ollama
    model: qwen2.5:14b
```

### Related Modules

- **Upstream** — `config/model_config.py`
- **Downstream** — `agents/lead_agent/agent.py`, `runtime/runs/manager.py` use `create_chat_model()`
