# sandbox 模块（sandbox module）

> QiLin engine · sandbox subsystem · 双语 / Bilingual

---

## 中文版

### 职责

`qilin.sandbox` 是 QiLin 的"工具执行隔离层"，所有不平凡的副作用（写文件、跑 shell、装包、GPU 计算、跨主机任务）都必须封装在某个 `Sandbox` 实例中执行。

- **抽象接口**：`SandboxProvider` + `Sandbox` 双层接口；provider 提供工厂与池化、sandbox 提供具体操作
- **本地实现**：`local/LocalSandbox` —— 进程内 fork + namespace 隔离（仅开发）
- **路径策略**：`path_patterns.py` 把"工具可读写路径"映射到 RBAC 角色
- **覆写保护**：`overwrite.py` 防止某些"一次性写入"破坏已有文件
- **中间件**：`middleware.py` 把所有工具调用强制走沙箱入口
- **安全策略**：`security.py` 提供 host bash 权限控制
- **环境变量策略**：`env_policy.py` 控制向沙箱注入哪些环境变量（注入最小化）
- **文件锁**：`file_operation_lock.py` 提供跨进程文件锁
- **异常类型**：`exceptions.py` 定义 `SandboxError`、`PermissionDenied`
- **搜索辅助**：`search.py` 提供沙箱内 ripgrep 兼容搜索

### 关键文件

| 文件 / 子包 | 作用 |
|--------------|------|
| `sandbox/sandbox_provider.py` | provider 抽象 |
| `sandbox/sandbox.py` | Sandbox 抽象基类 |
| `sandbox/local/` | 本机沙箱（开发） |
| `sandbox/middleware.py` | 沙箱中间件（强制入口） |
| `sandbox/security.py` | host bash 权限 |
| `sandbox/env_policy.py` | 环境变量注入策略 |
| `sandbox/path_patterns.py` | 路径权限匹配 |
| `sandbox/overwrite.py` | 覆写保护 |
| `sandbox/file_operation_lock.py` | 文件锁 |
| `sandbox/exceptions.py` | 异常类型 |
| `sandbox/search.py` | ripgrep 搜索 |
| `sandbox/tools.py` | 工具入口（`bash_tool` 等） |

### 设计要点

1. **双层抽象**：`SandboxProvider.open_async()` 返回 `Sandbox`，保证每次调用都能复用 provider 内部池
2. **可插拔后端**：具体 provider 在 `community/` 注册（aio_sandbox / boxlite / e2b / tenki）
3. **强制入口**：`sandbox.middleware` 在 Lead Agent 跑每个工具调用前判别"sandbox-only"工具是否走了沙箱
4. **路径三元组**：每次文件操作被记录为（`agent_scope`、`path`、`op`），供审计与权限决策
5. **写前读门控**：`ReadBeforeWriteConfig` 强制禁止直接覆写没有读过的文件

### 关联模块

- **上游**：`config/sandbox_config.py` 决定 provider
- **下游**：`runtime/runs/manager.py` 在 tool call 时通过 `sandbox/tools.py` 执行；`agents/middlewares/` 调用 sandbox middleware

---

## English Version

### Responsibility

`qilin.sandbox` is QiLin's "tool execution isolation layer". All non-trivial side effects (file writes, shell runs, package installs, GPU compute, cross-host tasks) MUST happen inside a `Sandbox` instance.

- **Abstraction** — `SandboxProvider` + `Sandbox` two-layer interface
- **Local implementation** — `local/LocalSandbox` — in-process fork + namespace (dev only)
- **Path policy** — `path_patterns.py` maps tool-writable paths onto RBAC roles
- **Overwrite guard** — `overwrite.py` protects existing files from accidental overwrite
- **Middleware** — `middleware.py` forces every tool call to go through sandbox
- **Security policy** — `security.py` for host bash authorization
- **Env policy** — `env_policy.py` for minimal env injection
- **File lock** — `file_operation_lock.py` cross-process lock
- **Exceptions** — `exceptions.py` defines `SandboxError`, `PermissionDenied`
- **Search helper** — `search.py` ripgrep-compatible sandbox search

### Key Files

| Path | Purpose |
|------|---------|
| `sandbox/sandbox_provider.py` | Provider abstraction |
| `sandbox/sandbox.py` | Sandbox base class |
| `sandbox/local/` | Local sandbox |
| `sandbox/middleware.py` | Sandbox middleware (forced entry) |
| `sandbox/security.py` | host-bash authorization |
| `sandbox/env_policy.py` | Env var policy |
| `sandbox/path_patterns.py` | Path permission matching |
| `sandbox/overwrite.py` | Overwrite protection |
| `sandbox/file_operation_lock.py` | File lock |
| `sandbox/exceptions.py` | Exception types |
| `sandbox/search.py` | ripgrep search |
| `sandbox/tools.py` | Tool entry (`bash_tool`) |

### Design Highlights

1. **Two-layer abstraction** — `SandboxProvider.open_async()` returns `Sandbox`; provider pools internally.
2. **Pluggable backend** — Specific providers registered under `community/` (aio_sandbox / boxlite / e2b / tenki).
3. **Forced entry** — `middleware.py` ensures sandbox-only tools pass through sandbox.
4. **Path triple** — Every file op logged as `(agent_scope, path, op)` for audit / policy.
5. **Read-before-write gate** — `ReadBeforeWriteConfig` blocks direct overwrite of unread files.

### Related Modules

- **Upstream** — `config/sandbox_config.py`
- **Downstream** — `runtime/runs/manager.py` invokes tools via `sandbox/tools.py`; `agents/middlewares/` use sandbox middleware
