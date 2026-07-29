# guardrails 模块（guardrails module）

> QiLin engine · guardrails subsystem · 双语 / Bilingual

---

## 中文版

### 职责

`qilin.guardrails` 是 QiLin 的"中间件式安全围栏"。它独立于工具调用，可在 Lead Agent 的输入端、输出端、tool-call 端注入"组织级安全策略"，比如：

- 屏蔽已知 PII（信用卡号、身份证、SSN）
- 屏蔽 prompt injection（用户消息或上游第三方 Agent 输出含 `"ignore previous instructions"`）
- 内容审核（涉黄、涉政、仇恨）
- 用量限速（每用户每天最多 N 次 Run）

### 关键文件

| 文件 | 作用 |
|------|------|
| `guardrails/__init__.py` | 对外 API：`GuardrailMiddleware` |
| `guardrails/provider.py` | `GuardrailProvider` 抽象接口 |
| `guardrails/builtin.py` | 内置 provider（PII / 速率限制 / 提示词注入检测） |
| `guardrails/middleware.py` | LangGraph `AgentMiddleware` 实现 |

### 设计要点

1. **声明式**：`GuardrailsConfig.providers` 列表决定启用哪些 provider，无需修改代码。
2. **失败行为可配**：每条 provider 可配置 `on_violation = "block" | "warn" | "redact"`
3. **可复用 authorization 子模块**：`authz.adapter` 把 RBAC 决策也可作为 guardrail，让两类策略共用同一执行链
4. **异步安全**：所有 provider 必须支持 async，避免阻塞事件循环
5. **可观察性**：每次阻断 / 告警都写入 `tracing` 元数据，便于复盘

### 配置示例

```yaml
guardrails:
  enabled: true
  providers:
    - name: builtin.pii
      on_violation: redact
    - name: builtin.prompt_injection
      on_violation: block
    - name: builtin.rate_limit
      on_violation: block
      config:
        per_user_per_day: 200
```

### 关联模块

- **上游**：`config/guardrails_config.py` 决定 provider 链
- **下游**：`agents/lead_agent/agent.py` 在 `build_middlewares()` 中安装 `GuardrailMiddleware`

---

## English Version

### Responsibility

`qilin.guardrails` is QiLin's "middleware-style safety perimeter". It is independent of tool calls and can inject organization-level safety policies at the lead agent's input, output, and tool-call edges:

- Mask PII (credit cards, IDs, SSNs)
- Block prompt injection ("ignore previous instructions")
- Content moderation (sexual / political / hate)
- Usage rate limits (e.g. max N runs/day per user)

### Key Files

| File | Purpose |
|------|---------|
| `guardrails/__init__.py` | Public API: `GuardrailMiddleware` |
| `guardrails/provider.py` | `GuardrailProvider` interface |
| `guardrails/builtin.py` | Built-in providers (PII / rate limit / prompt-injection) |
| `guardrails/middleware.py` | LangGraph `AgentMiddleware` implementation |

### Design Highlights

1. **Declarative** — `GuardrailsConfig.providers` list controls which providers are enabled.
2. **Failure mode configurable** — `on_violation = block | warn | redact`
3. **Shared with authorization** — `authz.adapter` allows RBAC decisions to be enforced as guardrails.
4. **Async-safe** — All providers must support async.
5. **Observable** — Every block / warn emits tracing metadata for postmortem.

### Config Example

```yaml
guardrails:
  enabled: true
  providers:
    - name: builtin.pii
      on_violation: redact
    - name: builtin.prompt_injection
      on_violation: block
    - name: builtin.rate_limit
      on_violation: block
      config:
        per_user_per_day: 200
```

### Related Modules

- **Upstream** — `config/guardrails_config.py`
- **Downstream** — Installed in `agents/lead_agent/agent.py: build_middlewares()`
