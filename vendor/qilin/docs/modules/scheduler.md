# scheduler 模块（scheduler module）

> QiLin engine · scheduler subsystem · 双语 / Bilingual

---

## 中文版

### 职责

`qilin.scheduler` 提供调度时间计算的**纯函数原语**：cron 表达式规范化、时区校验，以及根据任务声明（one-shot / cron）计算下一次执行时间。它不持有事件循环、不做轮询、不接触数据库——轮询、派发与 lease 协调分别由服务化调度器（`app/scheduler/service.py`）与 `runtime/runs` 负责。

- **`validate_timezone`**：校验时区名（`zoneinfo`），未知时区抛 `ValueError`
- **`normalize_cron_expression`**：规范化标准 5 字段 cron 表达式（去多余空白、校验字段数）
- **`next_run_at`**：根据 `schedule_type`（`once` / `cron`）与 `schedule_spec` 计算下一次执行时间；naive 时间一律按任务声明时区解释，返回 `UTC` 感知时间

### 关键文件

| 文件 | 作用 |
|------|------|
| `scheduler/__init__.py` | 对外 API：`next_run_at`，`normalize_cron_expression`，`validate_timezone` |
| `scheduler/schedules.py` | 调度计算实现（基于 `croniter`，无 IO） |

### 设计要点

1. **纯函数、零依赖副作用**：模块不依赖 asyncio、配置或持久化层，可独立单测；这也让 `next_run_at` 成为回归测试的稳定锚点。
2. **时区显式**：naive `run_at` / cron 基准时间按任务声明时区解释，避免服务器时区漂移；结果统一归一化为 UTC。
3. **Cron 5 字段**：基于 `croniter`，支持标准 5 字段表达式。
4. **单一消费方**：服务化调度（`ScheduledTaskService`）只依赖这里的计算原语，不在业务层重复实现时间逻辑。

### 配置示例

```yaml
scheduler:
  enabled: true
  poll_interval_seconds: 5
  lease_seconds: 120
  max_concurrent_runs: 3
  min_once_delay_seconds: 60
```

### 关联模块

- **上游**：`config/scheduler_config.py` 提供 `SchedulerConfig`（enabled / 轮询间隔 / lease / 并发上限）
- **下游**：`app/scheduler/service.py`（`ScheduledTaskService`：轮询 `scheduled_tasks` 表并派发 Run）、`runtime/runs/`（Run 生命周期与多 worker lease）、`persistence/scheduled_tasks/` 与 `persistence/scheduled_task_runs/`（任务与运行记录表）

---

## English Version

### Responsibility

`qilin.scheduler` provides **pure-function scheduling primitives**: cron normalization, timezone validation, and computing the next run time from a task's declared schedule (`once` / `cron`). It holds no event loop, does no polling, and touches no storage — polling, dispatch, and lease coordination live in the service scheduler (`app/scheduler/service.py`) and `runtime/runs`.

- **`validate_timezone`** — validates a timezone name via `zoneinfo`; raises `ValueError` on unknown zones
- **`normalize_cron_expression`** — normalizes a standard 5-field cron expression (collapses whitespace, validates field count)
- **`next_run_at`** — computes the next run time from `schedule_type` (`once` / `cron`) and `schedule_spec`; naive times are interpreted in the task's declared timezone and the result is returned as timezone-aware UTC

### Key Files

| File | Purpose |
|------|---------|
| `scheduler/__init__.py` | Public API: `next_run_at`, `normalize_cron_expression`, `validate_timezone` |
| `scheduler/schedules.py` | Scheduling math (`croniter`-based, no I/O) |

### Design Highlights

1. **Pure functions, no side effects** — no asyncio/config/storage dependencies; independently unit-testable, which also makes `next_run_at` a stable regression anchor.
2. **Explicit timezone** — naive `run_at` / cron base times are interpreted in the task's declared timezone; results normalize to UTC.
3. **5-field cron** — `croniter`-based.
4. **Single consumer** — the service scheduler (`ScheduledTaskService`) consumes only these primitives and never re-implements time math.

### Config Example

```yaml
scheduler:
  enabled: true
  poll_interval_seconds: 5
  lease_seconds: 120
  max_concurrent_runs: 3
  min_once_delay_seconds: 60
```

### Related Modules

- **Upstream** — `config/scheduler_config.py` provides `SchedulerConfig` (enabled / poll interval / lease / concurrency cap)
- **Downstream** — `app/scheduler/service.py` (`ScheduledTaskService`: polls `scheduled_tasks` and dispatches Runs), `runtime/runs/` (Run lifecycle & multi-worker lease), `persistence/scheduled_tasks/` and `persistence/scheduled_task_runs/` (task & run tables)
