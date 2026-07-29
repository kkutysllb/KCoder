# config 模块（config module）

> QiLin engine · config subsystem · 双语 / Bilingual

---

## 中文版

### 职责

`qilin.config` 是 QiLin 的"配置大脑"，全部基于 Pydantic 2 BaseModel，提供类型安全的配置加载、env 解析、热重载、版本号提示。

- **核心对象**：`AppConfig` 是根配置对象，把所有子配置（models / sandbox / skills / memory / tools / subagents / guardrails / authorization / integrations / scheduler / persistence / tracing ...）聚合成单棵配置树
- **加载策略**：按优先级读取 CLI 参数 → `QILIN_CONFIG_PATH` 环境变量 → 工程根目录 `config.yaml` → 源码树 `backend/config.yaml`
- **热重载**：基于 `config_signature` 的内容哈希检测；签名变化触发 reload；某些结构性配置（如 sandbox / database / checkpointer）需要进程重启
- **env 解析**：`$VAR` 形式的值会在加载时通过 `os.getenv` 解析
- **版本提示**：`config.example.yaml` 与 `config.yaml` 的 `config_version` 数字不一致时提示用户升级
- **路径解析**：`paths.py` / `runtime_paths.py` 把"项目根"、"HOST_BASE_DIR"等路径变量统一到一个 `Paths` 单例
- **签名工具**：`file_signature.py` 计算 `ConfigSignature`（包含路径 + mtime + 内容哈希）

### 关键文件

| 文件 | 作用 |
|------|------|
| `config/app_config.py` | `AppConfig` 根配置对象 |
| `config/model_config.py` | 模型配置（provider / model / api_key） |
| `config/sandbox_config.py` | 沙箱配置（type / provider / env） |
| `config/skills_config.py` | 技能全局配置 + SkillsConfig |
| `config/skill_scan_config.py` | 静态扫描配置 |
| `config/skill_evolution_config.py` | Agent 自动改 Skill 配置 |
| `config/agents_config.py` | Agent 命名规则、路径、加载 |
| `config/agents_api_config.py` | 自定义 Agent 管理 API |
| `config/acp_config.py` | Agent Client Protocol 外部 Agent |
| `config/memory_config.py` | 记忆后端选择 + backend_config |
| `config/persistence/` 子目录中：database_config / agent_storage_config / run_events_config / scheduled_tasks / etc. |
| `config/database_config.py` | SQLite / Postgres 选择 |
| `config/extensions_config.py` | MCP servers / Skills 状态 |
| `config/checkpointer_config.py` | LangGraph checkpointer 选择 |
| `config/scheduler_config.py` | scheduler 启用 + 任务 |
| `config/tracing_config.py` | tracing providers |
| `config/tool_config.py` | 工具声明与 tool_group |
| `config/guardrails_config.py` | 护栏 provider / 启用规则 |
| `config/authorization_config.py` | RBAC 策略配置 |
| `config/auth_config.py` | 本地 / OIDC SSO |
| `config/input_polish_config.py` | 输入清洗规则 |
| `config/run_events_config.py` | run events 存储类型 |
| `config/channel_connections_config.py` | IM 渠道连接 |
| `config/run_ownership_config.py` | lease + 抢占 |
| `config/dedupe_storage_config.py` | webhook dedupe 存储 |
| `config/loop_detection_config.py` | 循环检测阈值 |
| `config/tool_progress_config.py` | 工具进度状态机 |
| `config/read_before_write_config.py` | 写前读门控 |
| `config/tool_search_config.py` | 延迟发现工具 |
| `config/tool_output_config.py` | 工具输出额度 |
| `config/token_usage_config.py` | Token 用量策略 |
| `config/token_budget_config.py` | Token 预算 |
| `config/title_config.py` | 自动生成 thread title |
| `config/summarization_config.py` | 对话总结策略 |
| `config/safety_finish_reason_config.py` | provider safety filter 拦截 |
| `config/stream_bridge_config.py` | 流桥后端（memory / redis） |
| `config/suggestions_config.py` | 后续建议生成 |
| `config/subagents_config.py` | 子代理清单 / 默认值 |
| `config/reload_boundary.py` | 哪些字段不能热重载 |
| `config/runtime_paths.py` | 进程内路径解析 |
| `config/paths.py` | 全局 `Paths` 单例 |
| `config/file_signature.py` | `ConfigSignature` 计算 |
| `config/__init__.py` | 对外统一 API |

### 设计要点

1. **类型安全顶层到底**：每个 YAML 节点都有对应 BaseModel，错字错误在启动时即被检测。
2. **三段生命周期**：
   - **冷加载**（首次启动）：扫描 → 解析 → DB bootstrap
   - **热重载**（运行中）：内容签名变化 → 部分 reload
   - **冷重启**（结构性变更）：需要 `restart`
3. **Reload 边界**：`reload_boundary.py` 显式列出"不可热重载"的字段（如 `sandbox.type`），防止误 reload 导致不一致。
4. **env 优先于 yaml**：所有敏感字段都使用 `SecretStr`，从 `os.getenv` 读取而不是明文写 YAML。
5. **版本可见**：`config_version` 在文件里显式标号，便于 linter 或 make 脚本自动升级。

### 配置示例

```yaml
config_version: 3

models:
  - name: gpt4o
    provider: openai
    model: gpt-4o
    api_key: ${OPENAI_API_KEY}

sandbox:
  type: aio_sandbox
  provider: qilin.community.aio_sandbox.aio_sandbox_provider:AioSandboxProvider

memory:
  backend: qilinmem
  qilinmem:
    model: gpt-4o-mini
    injection_max_tokens: 800

skills:
  enabled: true
  scan_on_install: true

guardrails:
  enabled: true
  providers: [builtin]

logging:
  enhance:
    enabled: true
```

### 关联模块

- **上游**：CLI / TUI 在启动时加载 `AppConfig`
- **下游**：所有运行时模块通过 `qilin.config.app_config.get_app_config()` 读取配置

---

## English Version

### Responsibility

`qilin.config` is QiLin's "config brain", fully based on Pydantic 2 BaseModel. It provides type-safe config loading, env resolution, hot reload, and version hints.

- **Core object** — `AppConfig` is the root config aggregating all sub-configs (models, sandbox, skills, memory, tools, subagents, guardrails, authorization, integrations, scheduler, persistence, tracing, ...)
- **Load order** — CLI arg → `QILIN_CONFIG_PATH` env → project-root `config.yaml` → source-tree `backend/config.yaml`
- **Hot reload** — File signature (path + mtime + content hash) detection; structural fields require process restart
- **Env resolution** — `$VAR` form resolved via `os.getenv` at load time
- **Version hints** — Mismatch between `config.example.yaml` and user `config.yaml` `config_version` triggers upgrade prompt
- **Path resolution** — `paths.py` / `runtime_paths.py` unify project root / HOST_BASE_DIR into a `Paths` singleton
- **Signature** — `file_signature.py` computes `ConfigSignature`

### Key Files

| File | Purpose |
|------|---------|
| `config/app_config.py` | `AppConfig` root |
| `config/model_config.py` | Model configs |
| `config/sandbox_config.py` | Sandbox configs |
| `config/skills_config.py` | Skills global config |
| `config/skill_scan_config.py` | Static scan config |
| `config/skill_evolution_config.py` | Auto-evolve skills |
| `config/agents_config.py` | Agent naming/path/load |
| `config/agents_api_config.py` | Custom agent API |
| `config/acp_config.py` | ACP external agents |
| `config/memory_config.py` | Memory backend + config |
| `config/database_config.py` | SQLite / Postgres |
| `config/extensions_config.py` | MCP servers / skill state |
| `config/checkpointer_config.py` | LangGraph checkpointer |
| `config/scheduler_config.py` | Scheduler enable + tasks |
| `config/tracing_config.py` | Tracing providers |
| `config/tool_config.py` | Tool declarations + groups |
| `config/guardrails_config.py` | Guardrails provider/rules |
| `config/authorization_config.py` | RBAC policies |
| `config/auth_config.py` | Local + OIDC SSO |
| `config/input_polish_config.py` | Input cleaning rules |
| `config/run_events_config.py` | Run-event storage type |
| `config/channel_connections_config.py` | IM channels |
| `config/run_ownership_config.py` | Lease + ownership |
| `config/dedupe_storage_config.py` | Webhook dedupe storage |
| `config/loop_detection_config.py` | Loop detection thresholds |
| `config/tool_progress_config.py` | Tool progress state machine |
| `config/read_before_write_config.py` | Read-before-write gate |
| `config/tool_search_config.py` | Lazy tool discovery |
| `config/tool_output_config.py` | Tool output budget |
| `config/token_usage_config.py` | Token usage policy |
| `config/token_budget_config.py` | Token budgets |
| `config/title_config.py` | Auto thread-title |
| `config/summarization_config.py` | Conversation summarization |
| `config/safety_finish_reason_config.py` | Provider safety filter |
| `config/stream_bridge_config.py` | Stream-bridge backend |
| `config/suggestions_config.py` | Follow-up suggestions |
| `config/subagents_config.py` | Subagent listing / defaults |
| `config/reload_boundary.py` | Non-hot-reloadable fields |
| `config/runtime_paths.py` | In-process path resolver |
| `config/paths.py` | Global `Paths` singleton |
| `config/file_signature.py` | `ConfigSignature` calculation |

### Design Highlights

1. **End-to-end type safety** — Every YAML node maps to a BaseModel; typos fail at boot.
2. **Three-stage lifecycle**:
   - **Cold load** — Initial scan / parse / DB bootstrap
   - **Hot reload** — Partial reload on signature change
   - **Cold restart** — Required for structural changes
3. **Reload boundary** — `reload_boundary.py` explicitly lists non-reloadable fields (e.g. `sandbox.type`).
4. **Env > yaml** — Sensitive fields use `SecretStr`, read from `os.getenv`.
5. **Visible versioning** — `config_version` is explicit so linters / make-scripts can auto-upgrade.

### Config Example

```yaml
config_version: 3

models:
  - name: gpt4o
    provider: openai
    model: gpt-4o
    api_key: ${OPENAI_API_KEY}

sandbox:
  type: aio_sandbox
  provider: qilin.community.aio_sandbox.aio_sandbox_provider:AioSandboxProvider

memory:
  backend: qilinmem
  qilinmem:
    model: gpt-4o-mini
    injection_max_tokens: 800

skills:
  enabled: true
  scan_on_install: true

guardrails:
  enabled: true
  providers: [builtin]
```

### Related Modules

- **Upstream** — CLI / TUI load `AppConfig` at startup
- **Downstream** — All runtime modules read via `qilin.config.app_config.get_app_config()`
