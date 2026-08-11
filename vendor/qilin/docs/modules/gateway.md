# gateway 模块（gateway module）

> QiLin engine · HTTP Agent Server subsystem · 双语 / Bilingual

---

## 中文版

### 职责

`app.gateway` 是 QiLin 的 **HTTP Agent Server**：把内核能力（agents / threads / runs /
memory / skills / mcp / uploads / artifacts / scheduled_tasks / channels …）以 REST API
形式对外暴露，并内置完整的认证与安全面。与嵌入式 `QiLinClient` 互补：同一份内核代码，
进程内调用走 client，跨进程 / 跨语言调用走 gateway。

实现基于 FastAPI + uvicorn，代码随 `qilin` wheel 一并分发，运行依赖通过 `gateway` extras 安装。

### 路由面（REST API）

`app.gateway.app:app` 挂载 20+ 组路由，按功能域划分：

| 域 | Router | 说明 |
|----|--------|------|
| 模型与能力 | `models` / `features` / `console` | 模型清单、能力探测、控制台信息 |
| Agent | `agents` / `assistants_compat` | Agent 定义管理 + OpenAI Assistants 兼容面 |
| 会话 | `threads` / `thread_runs` / `runs` | 线程 CRUD、线程内运行、运行管理 |
| 记忆与技能 | `memory` / `skills` | 记忆检索、技能清单与安装 |
| 工具与 MCP | `mcp` | MCP 服务器 / 工具端点 |
| 文件 | `uploads` / `artifacts` | 上传管理、产物读取 |
| 反馈与建议 | `feedback` / `suggestions` / `input_polish` | 反馈回写、标题/总结建议、输入打磨 |
| 定时任务 | `scheduled_tasks` | 一次性 + Cron 任务管理 |
| 渠道 | `channels` / `channel_connections` | IM 渠道接入与连接绑定（见 channels 模块） |
| 集成 | `integrations` / `browser` | 第三方集成、浏览器自动化能力 |
| 认证 | `auth` | 登录 / 注册 / 会话（local + OIDC） |
| Webhook | `github_webhooks` | GitHub 事件接入（安装触发、运行时事件） |

### 认证与安全

- **AuthMiddleware**（`auth_middleware.py`）：请求级认证总入口，支持 **local**（用户名/密码，
  bcrypt + JWT）、**OIDC**（SSO 回调 + 状态校验）与 **session cookie** 三种源，按序回退；
  未认证请求返回标准 `AuthErrorResponse`（错误码见 `auth/errors.py`）
- **CSRF / CORS**（`csrf_middleware.py`）：可配置的 CORS 白名单与暴露头；CSRF 防护默认开启
- **TraceMiddleware**（`trace_middleware.py`）：校验 `X-Trace-Id` 并写入 ContextVar，
  与日志 / RunEvent / Langfuse metadata 贯穿
- **内部认证**（`internal_auth.py`）：受信内部调用方的共享令牌认证（`X-QiLin-Internal-Token` 头，`QILIN_INTERNAL_AUTH_TOKEN` 环境变量）
- **开发模式**（`auth_disabled.py`）：`auth.disabled` 或环境变量可关闭认证并注入测试用户，
  启动时打印警示日志
- **用户预置**（`auth/user_provisioning.py`）：首次启动自动创建管理员（`reset_admin.py`
  提供重置入口）
- **GitHub 侧**（`github/`）：webhook 使用 GitHub App 认证（`app_auth.py`），
  事件经 `dispatcher.py` 分发到安装 / 触发流程，`run_policy.py` 定义触发运行策略

### 关键文件

| 文件 | 作用 |
|------|------|
| `app/gateway/app.py` | FastAPI 应用工厂：中间件装配 + 全部 router 挂载 |
| `app/gateway/config.py` | `GatewayConfig`（端口等，默认 `GATEWAY_PORT=8001`） |
| `app/gateway/auth_middleware.py` | 认证总入口（local / OIDC / session 三源回退） |
| `app/gateway/auth/` | 认证子系统：`jwt` / `password` / `oidc` / `session_cookie` / `providers` / `local_provider` |
| `app/gateway/csrf_middleware.py` | CSRF / CORS 防护 |
| `app/gateway/trace_middleware.py` | `X-Trace-Id` 上下文贯穿 |
| `app/gateway/langgraph_auth.py` | LangGraph 协议层认证适配 |
| `app/gateway/run_models.py` | Run 的 HTTP 视图模型与分页 |
| `app/gateway/checkpoint_lineage.py` | checkpoint 血缘（thread → run 关联） |
| `app/gateway/github/` | GitHub App webhook 接入（认证 / 分发 / 触发策略） |
| `app/gateway/routers/` | 各组 REST 路由实现 |

### 设计要点

1. **双模运行**：gateway 与嵌入式 client 共用 `qilin.runtime` / `persistence` 内核，
   HTTP 只是新的传输面；同一 DB 可同时被 client 与 gateway 访问。
2. **协议兼容**：`assistants_compat` 提供 OpenAI Assistants API 兼容面，
   `langgraph_auth` 保持 LangGraph Server 协议互通。
3. **认证分层**：认证（Authentication，谁）与授权（Authorization，能否）分离——
   前者由 AuthMiddleware 完成，后者委托 `qilin.authz` RBAC 执行。
4. **Webhook 安全**：GitHub webhook 必须携带 App 签名，未验证来源的事件直接拒绝。
5. **可观测**：所有请求经 TraceMiddleware 注入 trace_id，链路与嵌入式运行一致。

### 配置示例

```bash
# 安装服务端依赖（gateway + channels extras）
pip install "qilin[gateway,channels]"

# 启动 HTTP Agent Server
uvicorn app.gateway.app:app --port 8001
```

```yaml
# config.yaml
auth:
  local:
    allow_registration: true   # 允许自助注册（生产建议关闭）
  oidc:
    enabled: false
    providers: {}              # 配置 SSO 提供方
```

环境变量：`GATEWAY_PORT`（默认 `8001`）。

### 关联模块

- **上游**：`qilin.runtime`（运行执行）、`qilin.persistence`（存储）、
  `qilin.config`（配置热重载）、`qilin.authz`（授权执行）、`qilin.trace_context`
- **下游**：`app.channels`（渠道 REST 端点）、`app.scheduler`（任务 API）、
  `app.gateway.github`（webhook → 运行时触发）
- **测试**：`tests/` 下 gateway 路由与认证测试（JWT / OIDC / CSRF 覆盖）

---

## English Version

### Responsibility

`app.gateway` is QiLin's **HTTP Agent Server**: it exposes the engine capabilities
(agents / threads / runs / memory / skills / mcp / uploads / artifacts /
scheduled_tasks / channels …) as REST APIs with a complete auth and security
surface. It complements the embedded `QiLinClient`: same kernel, in-process calls
go through the client, cross-process / cross-language calls go through the gateway.

Built on FastAPI + uvicorn, shipped in the `qilin` wheel; runtime dependencies
come from the `gateway` extra.

### REST Surface

`app.gateway.app:app` mounts 20+ route groups:

| Domain | Routers | Notes |
|--------|---------|-------|
| Models & capabilities | `models` / `features` / `console` | Model listing, feature probing, console info |
| Agents | `agents` / `assistants_compat` | Agent definitions + OpenAI Assistants compatibility |
| Sessions | `threads` / `thread_runs` / `runs` | Thread CRUD, in-thread runs, run management |
| Memory & skills | `memory` / `skills` | Memory retrieval, skill catalog & install |
| Tools & MCP | `mcp` | MCP server / tool endpoints |
| Files | `uploads` / `artifacts` | Upload management, artifact reads |
| Feedback & suggestions | `feedback` / `suggestions` / `input_polish` | Feedback, title/summary suggestions, input polishing |
| Scheduled tasks | `scheduled_tasks` | One-shot + cron management |
| Channels | `channels` / `channel_connections` | IM channel adapters & connection binding (see channels module) |
| Integrations | `integrations` / `browser` | 3rd-party integrations, browser automation |
| Auth | `auth` | Login / registration / sessions (local + OIDC) |
| Webhooks | `github_webhooks` | GitHub event ingestion (install triggers, runtime events) |

### Auth & Security

- **AuthMiddleware** (`auth_middleware.py`) — request-level auth entry; supports
  **local** (username/password, bcrypt + JWT), **OIDC** (SSO callback + state
  validation) and **session cookie** sources with ordered fallback; rejects with
  standard `AuthErrorResponse` (codes in `auth/errors.py`)
- **CSRF / CORS** (`csrf_middleware.py`) — configurable CORS allow-list and exposed
  headers; CSRF protection enabled by default
- **TraceMiddleware** (`trace_middleware.py`) — validates `X-Trace-Id` and stores it
  in a ContextVar, consistent across logs / RunEvents / Langfuse metadata
- **Internal auth** (`internal_auth.py`) — shared-token auth for trusted internal callers (`X-QiLin-Internal-Token` header, `QILIN_INTERNAL_AUTH_TOKEN` env var)
- **Dev mode** (`auth_disabled.py`) — `auth.disabled` or env vars disable auth and
  inject a test user, with a startup warning
- **User provisioning** (`auth/user_provisioning.py`) — auto-creates the admin on
  first boot (`reset_admin.py` provides a reset entry)
- **GitHub side** (`github/`) — webhooks are authenticated via GitHub App
  (`app_auth.py`); events are dispatched by `dispatcher.py`; `run_policy.py`
  defines the trigger policy

### Key Files

| File | Responsibility |
|------|----------------|
| `app/gateway/app.py` | FastAPI app factory: middleware assembly + all router mounts |
| `app/gateway/config.py` | `GatewayConfig` (port, default `GATEWAY_PORT=8001`) |
| `app/gateway/auth_middleware.py` | Auth entry (local / OIDC / session fallback) |
| `app/gateway/auth/` | Auth subsystem: `jwt` / `password` / `oidc` / `session_cookie` / `providers` / `local_provider` |
| `app/gateway/csrf_middleware.py` | CSRF / CORS protection |
| `app/gateway/trace_middleware.py` | `X-Trace-Id` context propagation |
| `app/gateway/langgraph_auth.py` | LangGraph protocol auth adaptation |
| `app/gateway/run_models.py` | HTTP view models and pagination for runs |
| `app/gateway/checkpoint_lineage.py` | Checkpoint lineage (thread → run correlation) |
| `app/gateway/github/` | GitHub App webhook ingestion (auth / dispatch / trigger policy) |
| `app/gateway/routers/` | REST route implementations |

### Design Points

1. **Dual-mode runtime** — gateway and the embedded client share the
   `qilin.runtime` / `persistence` kernel; HTTP is just another transport. The same
   DB can be accessed by both client and gateway.
2. **Protocol compatibility** — `assistants_compat` offers an OpenAI Assistants API
   surface; `langgraph_auth` keeps LangGraph Server protocol interop.
3. **Auth separation** — authentication (who) lives in AuthMiddleware;
   authorization (can they) is delegated to the `qilin.authz` RBAC engine.
4. **Webhook security** — GitHub webhooks must carry the App signature; events from
   unverified sources are rejected outright.
5. **Observability** — every request gets a trace_id via TraceMiddleware, matching
   the embedded run pipeline.

### Configuration Example

```bash
# Install server dependencies (gateway + channels extras)
pip install "qilin[gateway,channels]"

# Start the HTTP Agent Server
uvicorn app.gateway.app:app --port 8001
```

```yaml
# config.yaml
auth:
  local:
    allow_registration: true   # allow self-registration (disable in production)
  oidc:
    enabled: false
    providers: {}              # configure SSO providers
```

Env var: `GATEWAY_PORT` (default `8001`).

### Related Modules

- **Upstream**: `qilin.runtime` (run execution), `qilin.persistence` (storage),
  `qilin.config` (hot reload), `qilin.authz` (enforcement), `qilin.trace_context`
- **Downstream**: `app.channels` (channel REST endpoints), `app.scheduler` (task API),
  `app.gateway.github` (webhook → runtime triggers)
- **Tests**: gateway routes and auth tests under `tests/` (JWT / OIDC / CSRF coverage)
