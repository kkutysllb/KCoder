# workspace_changes 模块（workspace_changes module）

> QiLin engine · workspace_changes subsystem · 双语 / Bilingual

---

## 中文版

### 职责

`qilin.workspace_changes` 在 sandbox 中追踪"工作区的物理文件变更"，并把变更转为结构化的"workspace_changes"事件记入 Run events。

- **录制器**：`recorder.py` 在 sandbox 操作前后对目录做 diff（add / modified / deleted）
- **过滤**：屏蔽 `.git/`、`__pycache__/`、`.browser-frames/` 等临时/缓存目录
- **上报**：每次 Run 终止时把 changes 写入 `run_events`

### 关键文件

| 文件 | 作用 |
|------|------|
| `workspace_changes/recorder.py` | 变更录制与快照管理 |
| `workspace_changes/scanner.py` | 工作区扫描与敏感路径判定 |
| `workspace_changes/diff.py` | 变更 diff 计算 |
| `workspace_changes/api.py` | 面向调用方的变更响应组装 |
| `workspace_changes/types.py` | 快照 / 变更数据类型 |

### 设计要点

1. **Diff 类型**：基于 mtime + size 粗筛，再对 size 一致的做 hash 比对，避免高 CPU
2. **过滤白名单**：开发时只关心 `/workspace`，自动屏蔽系统目录
3. **结构化事件**：写入 `run_events` 的 type=workspace_changes 是 Pydantic 可序列化的
4. **可观察**：变更与 Run 关联，回放 Run 时可以看到完整修改历史
5. **可恢复**：能在 Run replay 时被重新构造

### 与 Run Event 关系

| Event | 来源 |
|-------|------|
| run.started | runtime/runs |
| tool.invoked | runtime/runs |
| workspace_changes | workspace_changes/recorder |
| run.finished | runtime/runs |

### 关联模块

- **上游**：`constants.py` 定义 `WORKSPACE_CHANGES_EVENT_TYPE`、`WORKSPACE_CHANGES_EVENT_CATEGORY`
- **下游**：`runtime/runs/manager.py` 触发并读出，写 `persistence/run_events/`

---

## English Version

### Responsibility

`qilin.workspace_changes` tracks "physical file changes in the workspace" inside the sandbox, turning them into structured `workspace_changes` events appended to Run events.

- **Recorder** — `recorder.py` diffs the directory before/after sandbox ops (add / modified / deleted)
- **Filtering** — Excludes `.git/`, `__pycache__/`, `.browser-frames/`, etc.

### Key Files

| File | Purpose |
|------|---------|
| `workspace_changes/recorder.py` | Change recording & snapshot management |
| `workspace_changes/scanner.py` | Workspace scanning & sensitive-path detection |
| `workspace_changes/diff.py` | Change diff computation |
| `workspace_changes/api.py` | Change-response assembly for callers |
| `workspace_changes/types.py` | Snapshot / change data types |

### Design Highlights

1. **Diff strategy** — mtime + size first; hash fallback only when sizes match — bounded CPU.
2. **Allow-list** — Tracks only `/workspace`; ignores system dirs.
3. **Structured event** — Run-event payload (`type=workspace_changes`) is Pydantic-serializable.
4. **Replayable** — When replaying a Run, you can see full modification history.
5. **Bound to Run** — Always linked to a RunRecord for traceability.

### Run Event Lifecycle

```
run.started → tool.invoked → workspace_changes → run.finished
```

### Related Modules

- **Upstream** — `constants.py` defines `WORKSPACE_CHANGES_EVENT_TYPE` / `WORKSPACE_CHANGES_EVENT_CATEGORY`
- **Downstream** — `runtime/runs/manager.py` triggers; `persistence/run_events/` stores
