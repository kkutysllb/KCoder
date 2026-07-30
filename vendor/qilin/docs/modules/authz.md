# authz 模块（authz module）

> QiLin engine · authz subsystem · 双语 / Bilingual

---

## 中文版

### 职责

`qilin.authz` 实现 RBAC（Role-Based Access Control）级别的资源授权过滤器。它的目标不是"鉴权用户"，而是"鉴权一次具体的工具调用 / 一次资源访问"。在 LangGraph 之外注入，比 OAuth/JWT 更细粒度。

- **Principal 抽象**：`principal.py` 把当前用户的所有属性（`role`、`team`、`label`、`custom`）归一化为 `Principal` 对象
- **Resource 抽象**：把任何对象（tool / skill / agent / file / channel / webhook）抽象为 `Resource` 实例
- **策略提供者**：`provider.py` 提供 `AuthorizationProvider` 接口（类似 OAuth2 AS）
- **策略评估**：内置 `rbac.py` 实现"角色 + 资源类型 + 动作"三维评估
- **过滤器**：`tool_filter.py` 在工具集装配阶段按角色裁剪可用工具
- **执行**：`enforcement.py` 在运行时的"动作前"拍板 allow / deny
- **适配器**：`adapter.py` 把决策结果转化为 `GuardrailMiddleware` 可消费的中间件
- **运行集成**：`runtime.py` 让 `authz` 在 `RunManager` 中可观测

### 关键文件

| 文件 | 作用 |
|------|------|
| `authz/principal.py` | 当前用户归一化 |
| `authz/rbac.py` | RBAC 评估 |
| `authz/provider.py` | provider 抽象 |
| `authz/tool_filter.py` | 工具级裁剪 |
| `authz/enforcement.py` | 运行时强制 |
| `authz/adapter.py` | 与 guardrail 桥接 |
| `authz/runtime.py` | Run 集成 |
| `authz/__init__.py` | 对外 API |

### 设计要点

1. **基于属性而非基于身份**：策略通常基于 `(role, resource_type, action)` 三元组而非用户名，更适合 LLM 场景（同一用户在不同 run 中可能扮演不同角色）。
2. **可声明策略**：策略可用 YAML 编写，存到 `AuthorizationConfig.rules`，无需修改代码。
3. **决策可观察**：每次 deny 都写入 `journal` 与 `tracing`，可追溯。
4. **与 Guardrail 解耦**：authz 自身是个独立组件；`adapter.py` 把它接入 `GuardrailMiddleware` 是可选的。
5. **多租户**：当 `principal.attributes.tenant != resource.tenant` 时默认 deny。

### 配置示例

```yaml
authorization:
  enabled: true
  default_effect: deny
  rules:
    - role: developer
      can: [tool:bash, tool:read_file]
    - role: viewer
      can: [tool:read_file]
    - role: ops
      can: ["resource:*"]
```

### 关联模块

- **上游**：`config/authorization_config.py`、`config/auth_config.py`
- **下游**：`guardrails/middleware.py` 通过 `adapter.py` 接入；`tools/tools.py` 通过 `tool_filter.py` 裁剪

---

## English Version

### Responsibility

`qilin.authz` implements RBAC-style authorization filtering. The goal is not "authenticate the user" but "authorize this single tool call / resource access". The check runs outside LangGraph, finer-grained than OAuth/JWT.

- **Principal** — `principal.py` normalizes all attributes (`role`, `team`, `label`, `custom`) into a `Principal`
- **Resource** — Abstraction over any object (tool / skill / agent / file / channel / webhook)
- **Provider** — `provider.py` exposes `AuthorizationProvider` interface
- **Evaluation** — `rbac.py` evaluates `(role, resource_type, action)`
- **Tool filter** — `tool_filter.py` prunes tools at assembly
- **Enforcement** — `enforcement.py` makes allow/deny decisions pre-action
- **Adapter** — `adapter.py` exposes decisions as `GuardrailMiddleware`
- **Runtime integration** — `runtime.py` exposes authz to `RunManager`

### Key Files

| File | Purpose |
|------|---------|
| `authz/principal.py` | User normalization |
| `authz/rbac.py` | RBAC evaluator |
| `authz/provider.py` | Provider abstraction |
| `authz/tool_filter.py` | Tool-level filter |
| `authz/enforcement.py` | Runtime enforcement |
| `authz/adapter.py` | Bridge to guardrails |
| `authz/runtime.py` | Run integration |
| `authz/__init__.py` | Public API |

### Design Highlights

1. **Attribute-based, not identity-based** — Decisions use `(role, resource_type, action)` tuples, better suited for LLM scenarios.
2. **Declarative policies** — YAML in `AuthorizationConfig.rules`.
3. **Observable decisions** — Every deny is journaled and traced.
4. **Decoupled from Guardrails** — Adapter is optional.
5. **Multi-tenant** — `principal.tenant != resource.tenant` defaults to deny.

### Config Example

```yaml
authorization:
  enabled: true
  default_effect: deny
  rules:
    - role: developer
      can: [tool:bash, tool:read_file]
    - role: viewer
      can: [tool:read_file]
    - role: ops
      can: ["resource:*"]
```

### Related Modules

- **Upstream** — `config/authorization_config.py`, `config/auth_config.py`
- **Downstream** — `guardrails/middleware.py` via `adapter.py`; `tools/tools.py` filters via `tool_filter.py`
