# scheduler 模块（scheduler module）

> QiLin engine · scheduler subsystem · 双语 / Bilingual

---

## 中文版

### 职责

`qilin.scheduler` 提供一次性（one-shot）与 Cron 定时任务调度。它运行于 QiLin 进程的同一 asyncio 事件循环内，每隔 `poll_interval_seconds` 轮询一次 `scheduled_tasks` 表，对到期任务派发为一次新的 Run。

- **轮询器（poller）**：定时扫描 `scheduled_tasks`，解析下一次执行时间
- **Cron 解析**：基于 `croniter` 支持标准 5 字段 cron 表达式
- **派发**：到期任务由 `RunManager` 启动新的 `scheduled_task_runs` 记录
- **错误恢复**：失败的派发不会让调度器永久卡住，会被记录并按 retry-policy 重试
- **多 worker 协调**：在 `run_ownership` 模式下保证同一任务在同一时刻只被一个 worker 抢到

### 关键文件

| 文件 | 作用 |
|------|------|
| `scheduler/__init__.py` | 对外 API：`start_scheduler`，`stop_scheduler` |
| `scheduler/poller.py` | 轮询任务表 |
| `scheduler/cron.py` | cron 表达式解析 |
| `scheduler/dispatcher.py` | 派发到 RunManager |
| `scheduler/locks.py` | 多 worker 锁定（lease） |

### 设计要点

1. **轮询而非线程**：避免引入多线程；调度器是 asyncio task。
2. **精确到秒**：cron 解析时显式校验时区，避免服务器时区漂移。
3. **可观察**：每次派发与失败都会被 `journal` 记录，可在 `tui` 中看到下一次 ETA。
4. **可关闭**：`SchedulerConfig.enabled=False` 时整个子模块不启动。

### 配置示例

```yaml
scheduler:
  enabled: true
  poll_interval_seconds: 5
  default_timezone: "UTC"
  tasks:
    - name: "daily-report"
      agent: "analyst"
      cron: "0 9 * * *"
      prompt: "生成昨日汇总报告"
```

### 关联模块

- **上游**：`config/scheduler_config.py` 决定是否启用与轮询间隔
- **下游**：`runtime/runs/manager.py` 启动 Run；`persistence/scheduled_tasks/`、`persistence/scheduled_task_runs/` 存表

---

## English Version

### Responsibility

`qilin.scheduler` provides one-shot and Cron-based scheduled task execution. It runs in QiLin's asyncio event loop, polling the `scheduled_tasks` table every `poll_interval_seconds`, dispatching due tasks as new Runs.

- **Poller** — Periodically scans `scheduled_tasks`, computes next run time
- **Cron parser** — Standard 5-field cron via `croniter`
- **Dispatcher** — Spawns `scheduled_task_runs` via `RunManager`
- **Error recovery** — Failures don't permanently block the scheduler; retry-policy applies
- **Multi-worker lease** — `run_ownership` mode ensures one task is locked by only one worker at a time

### Key Files

| File | Purpose |
|------|---------|
| `scheduler/__init__.py` | Public API: `start_scheduler`, `stop_scheduler` |
| `scheduler/poller.py` | Task table poller |
| `scheduler/cron.py` | Cron expression parser |
| `scheduler/dispatcher.py` | Dispatches to RunManager |
| `scheduler/locks.py` | Multi-worker lease locks |

### Design Highlights

1. **Polling > threading** — asyncio task, no extra threads.
2. **Second precision** — Explicit timezone validation prevents drift.
3. **Observable** — Every dispatch and failure is journaled.
4. **Disable-friendly** — `SchedulerConfig.enabled=False` short-circuits boot.

### Config Example

```yaml
scheduler:
  enabled: true
  poll_interval_seconds: 5
  default_timezone: "UTC"
  tasks:
    - name: "daily-report"
      agent: "analyst"
      cron: "0 9 * * *"
      prompt: "Generate yesterday's summary."
```

### Related Modules

- **Upstream** — `config/scheduler_config.py`
- **Downstream** — `runtime/runs/manager.py`; `persistence/scheduled_tasks/`, `persistence/scheduled_task_runs/`
