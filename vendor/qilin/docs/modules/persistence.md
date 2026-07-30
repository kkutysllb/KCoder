# persistence 模块（persistence module）

> QiLin engine · persistence subsystem · 双语 / Bilingual

---

## 中文版

### 职责

`qilin.persistence` 是 QiLin 的"持久化层"，所有 Run / Thread / Agent / Skill / 用户上传 / 反馈 / 渠道连接 / webhook / token 用量 / scheduled task 都被建模为带 SQL DDL 的领域对象。

- **引擎抽象**：`engine.py` 暴露 `create_engine()` 工厂，封装 SQLite（开发 / 单机）vs PostgreSQL（生产）
- **基础**：`base.py` 提供 SQLAlchemy `DeclarativeBase`、`JSON` 兼容字段
- **迁移**：`migrations/` 提供 Alembic 脚本（10 个 version）
- **启动 hook**：`bootstrap.py` 提供 `bootstrap_persistence()` 启动钩子
- **JSON 兼容**：`json_compat.py` 处理老版本 Python 的兼容
- **领域对象**：
  - `agents/`：Agent 定义（file + db 两种 backend）
  - `run/`：Run 记录
  - `thread_meta/`：线程元数据
  - `feedback/`：用户反馈
  - `models/run_event.py`：Run 事件
  - `scheduled_tasks/`：定时任务定义
  - `scheduled_task_runs/`：定时任务执行记录
  - `channel_connections/`：IM 渠道连接
  - `webhook_delivery/`：webhook 投递记录（含 dedupe）
  - `user/`：用户档案

### 关键文件

| 文件 / 子包 | 作用 |
|--------------|------|
| `persistence/engine.py` | 数据库引擎工厂 |
| `persistence/base.py` | SQLAlchemy DeclarativeBase |
| `persistence/bootstrap.py` | 启动 hook |
| `persistence/json_compat.py` | JSON 兼容层 |
| `persistence/migrations/` | Alembic 迁移 |
| `persistence/agents/` | Agent 定义 |
| `persistence/run/` | Run records |
| `persistence/thread_meta/` | 线程元数据 |
| `persistence/feedback/` | 反馈 |
| `persistence/models/run_event.py` | Run event |
| `persistence/scheduled_tasks/` | 定时任务 |
| `persistence/scheduled_task_runs/` | 定时执行记录 |
| `persistence/channel_connections/` | IM 渠道 |
| `persistence/webhook_delivery/` | webhook dedupe |
| `persistence/user/` | 用户 |

### 设计要点

1. **多后端统一**：`DatabaseConfig` 决定 SQLite vs Postgres；同一份 SQLAlchemy 模型在两者上工作。
2. **JSON 兜底**：所有可变字段用 `JSON` 类型；老 Python（如 3.11）需要 `json_compat` 兼容 dict-of-int。
3. **Alembic 迁移**：每一次 schema 变更都生成 versioned migration，便于回滚与 CI 验证。
4. **Hot vs Cold**：RunRecords 写入热点通道，Migration 是冷启动 IO；两者不互相阻塞。
5. **Dedupe**：`webhook_delivery` 提供幂等性保障，避免重复 webhook 投递产生重复 Run。

### 启动流程

```
migrations upgrade → bootstrap_persistence() → 初始化 schema-version cache → 准备完毕
```

### 关联模块

- **上游**：`runtime/runs/manager.py` 写入 `run/`；`webhook_delivery/dedupe` 由 webhook handler 写入
- **下游**：`tui` 通过 `persistence.run` 读取历史；Gateway 通过 SQLAlchemy 跨节点共享

---

## English Version

### Responsibility

`qilin.persistence` is QiLin's "persistence layer". Every Run / Thread / Agent / Skill / user upload / feedback / channel connection / webhook / token usage / scheduled task is a domain object with SQL DDL.

- **Engine factory** — `engine.py` exposes `create_engine()` wrapping SQLite (dev / single-node) vs PostgreSQL (prod)
- **Declarative base** — `base.py` provides `DeclarativeBase` + `JSON` field
- **Migrations** — `migrations/` ships Alembic scripts (10 versions)
- **Bootstrap** — `bootstrap.py` startup hook
- **JSON compat** — `json_compat.py` for older Python versions
- **Domain objects**:
  - `agents/` — Agent definitions (file or db backend)
  - `run/` — Run records
  - `thread_meta/` — Thread metadata
  - `feedback/` — User feedback
  - `models/run_event.py` — Run events
  - `scheduled_tasks/` — Scheduled task definitions
  - `scheduled_task_runs/` — Scheduled execution records
  - `channel_connections/` — IM channel bindings
  - `webhook_delivery/` — Webhook delivery + dedupe
  - `user/` — User profiles

### Key Files / Sub-Packages

| Path | Purpose |
|------|---------|
| `persistence/engine.py` | Database engine factory |
| `persistence/base.py` | SQLAlchemy DeclarativeBase |
| `persistence/bootstrap.py` | Startup hook |
| `persistence/json_compat.py` | JSON compat layer |
| `persistence/migrations/` | Alembic migrations |
| `persistence/agents/` | Agent definitions |
| `persistence/run/` | Run records |
| `persistence/thread_meta/` | Thread metadata |
| `persistence/feedback/` | Feedback |
| `persistence/models/run_event.py` | Run events |
| `persistence/scheduled_tasks/` | Scheduled tasks |
| `persistence/scheduled_task_runs/` | Scheduled run records |
| `persistence/channel_connections/` | IM channel bindings |
| `persistence/webhook_delivery/` | Webhook + dedupe |
| `persistence/user/` | User profiles |

### Design Highlights

1. **Multi-backend** — `DatabaseConfig` switches SQLite vs PostgreSQL; same models work on both.
2. **JSON fallback** — `JSON` columns with `json_compat` shim for older Python.
3. **Versioned migrations** — Each schema change ships an Alembic versioned migration.
4. **Hot vs Cold** — RunRecord writes hot; migrations are cold IO.
5. **Idempotency** — `webhook_delivery` dedupes to avoid duplicate runs.

### Bootstrap

```
migrations upgrade → bootstrap_persistence() → schema-version cache → ready
```

### Related Modules

- **Upstream** — `runtime/runs/manager.py` writes `run/`; webhooks write `webhook_delivery/`
- **Downstream** — `tui/` reads `persistence.run`; Gateway shares persistence across nodes
