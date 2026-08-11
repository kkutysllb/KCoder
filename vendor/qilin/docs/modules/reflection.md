# reflection 模块（reflection module）

> QiLin engine · reflection subsystem · 双语 / Bilingual

---

## 中文版

### 职责

`qilin.reflection` 是一个极小但关键的模块：它在配置加载与服务运行时提供"变量解析器"。所有 `${VAR_NAME}` 形式的占位符都会在适当时机被解析为真实字符串（通常来自 `os.getenv`）。

- **入口**：`resolvers.py` 暴露 `resolve_variable()` 与 `resolve_variables()`
- **典型用法**：
  - 配置加载时：`config/sandbox_config.py` 中 `default_runtime_image: ${MY_IMAGE}` → 实际使用时被替换
  - 运行时：Agent 在 system prompt 中嵌入 `${DATABASE_URL}` 之类的环境敏感字符串
- **并发安全**：所有解析逻辑是纯函数，可以并发调用
- **默认值**：可选 `${VAR:-default}` 语法

### 关键文件

| 文件 | 作用 |
|------|------|
| `reflection/__init__.py` | 对外 API |
| `reflection/resolvers.py` | `resolve_variable`、`resolve_variables` |

### 设计要点

1. **轻量**：整个模块只有几十行代码，专注于"占位符 → 真实值"
2. **不缓存**：每次解析都重新读取，保证配置切换时立即生效
3. **失败可观测**：`MissingVariableError` 列出未解析变量，便于诊断

### 关联模块

- **横切**：`config/`、`skills/`、`agents/lead_agent/prompt.py` 在不同阶段使用

---

## English Version

### Responsibility

`qilin.reflection` is a tiny but critical module: it provides the "variable resolver" for both config loading and runtime. All `${VAR_NAME}` placeholders are resolved (typically via `os.getenv`) at the appropriate moment.

- **Entry** — `resolvers.py` exposes `resolve_variable()` and `resolve_variables()`
- **Typical uses**:
  - At config load: `config/sandbox_config.py` `default_runtime_image: ${MY_IMAGE}` is replaced
  - At runtime: Agent embeds `${DATABASE_URL}` in the system prompt
- **Concurrency-safe** — Pure functions, safely callable concurrently
- **Default values** — Optional `${VAR:-default}` syntax

### Key Files

| File | Purpose |
|------|---------|
| `reflection/__init__.py` | Public API |
| `reflection/resolvers.py` | `resolve_variable`, `resolve_variables` |

### Design Highlights

1. **Tiny** — Only dozens of LOC, focused on placeholder → real value
2. **No caching** — Re-reads on every call; config changes take effect immediately
3. **Observable failures** — `MissingVariableError` lists unresolved variables

### Related Modules

- **Cross-cutting** — Used by `config/`, `skills/`, `agents/lead_agent/prompt.py`
