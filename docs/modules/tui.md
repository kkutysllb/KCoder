# tui 模块（tui module）

> QiLin engine · tui subsystem · 双语 / Bilingual

---

## 中文版

### 职责

`qilin.tui` 是一个基于 [Textual](https://github.com/Textualize/textual) 的终端工作台。它是 QiLin 默认的人机交互入口之一（另一种是嵌入式 `QiLinClient`，另一种是 Gateway HTTP API）。

- **CLI 入口**：`cli.py: main()` —— 启动 TUI 或一次性 headless 模式
- **App**：`app.py` 是 Textual 应用主体
- **Runtime**：`runtime.py` 调度 TUI ↔ QiLin client 的事件
- **Session 抽象**：`session.py` 维持 thread 状态、resume / continue、user / thread 解析
- **视图层**：
  - `render.py` / `theme.py`：文本渲染与主题
  - `view_state.py`：View 状态机
  - `message_format.py`：消息格式化
  - `widgets/composer.py`：输入/复合控件
- **持久化**：`persistence.py` 把会话状态写入 SQLite
- **命令面板**：`command_registry.py` 注册 `/` 斜杠命令

### 关键文件

| 文件 | 作用 |
|------|------|
| `tui/cli.py` | CLI 入口（`qilin`） |
| `tui/__main__.py` | `python -m qilin.tui` |
| `tui/app.py` | Textual App |
| `tui/runtime.py` | TUI ↔ Client 桥 |
| `tui/session.py` | 会话生命周期 |
| `tui/render.py` / `theme.py` | 渲染 + 主题 |
| `tui/view_state.py` | 视图状态机 |
| `tui/message_format.py` | 消息格式化 |
| `tui/widgets/composer.py` | 输入控件 |
| `tui/persistence.py` | 会话持久化 |
| `tui/input_history.py` | 输入历史 |
| `tui/command_registry.py` | 斜杠命令 |

### 设计要点

1. **Headless-friendly**：`qilin --print` / `--json` 可在没有 TTY 的环境运行（如 CI）
2. **可恢复**：`persistence.py` 支持会话断线后 `--continue` / `--resume THREAD`
3. **Textual 解耦**：`import textual` 仅在 TUI 实际启动时才发生，可作为 `pip install qilin[tui]` 选装
4. **统一命令**：通过 `command_registry.py` 注入 `/help`、`/resume`、`/clear` 等斜杠命令
5. **可观察**：所有用户消息与 Run event 都通过 `runtime.py` 上传 `tracing`

### 用法

```bash
# 启动交互
qilin

# 一次性回答
qilin --print "What is 2+2?"

# JSON 流式
echo "What's the weather?" | qilin --json

# 恢复上次对话
qilin --continue
qilin --resume THREAD_ID
```

### 关联模块

- **上游**：`client.py`（embedded 客户端）；`runtime/stream_bridge/`（事件订阅）
- **下游**：`persistence/thread_meta/` 存会话

---

## English Version

### Responsibility

`qilin.tui` is a Textual-based terminal workbench. It is one of three default human-interaction surfaces for QiLin (alongside the embedded `QiLinClient` and the Gateway HTTP API).

- **CLI entry** — `cli.py: main()`
- **App** — `app.py` (Textual app)
- **Runtime** — `runtime.py` schedules TUI ↔ QiLin client events
- **Session** — `session.py` holds thread state; resume / continue
- **Views**:
  - `render.py` / `theme.py` — rendering + theme
  - `view_state.py` — view state machine
  - `message_format.py` — message formatting
  - `widgets/composer.py` — input widget
- **Persistence** — `persistence.py` writes session state to SQLite
- **Command palette** — `command_registry.py` registers `/` slash commands

### Key Files

| File | Purpose |
|------|---------|
| `tui/cli.py` | CLI entry (`qilin`) |
| `tui/__main__.py` | `python -m qilin.tui` |
| `tui/app.py` | Textual App |
| `tui/runtime.py` | TUI ↔ Client bridge |
| `tui/session.py` | Session lifecycle |
| `tui/render.py` / `theme.py` | Rendering + theme |
| `tui/view_state.py` | View state machine |
| `tui/message_format.py` | Message format |
| `tui/widgets/composer.py` | Input widget |
| `tui/persistence.py` | Session persistence |
| `tui/input_history.py` | Input history |
| `tui/command_registry.py` | Slash commands |

### Design Highlights

1. **Headless-friendly** — `qilin --print` / `--json` work without TTY (CI, webhooks).
2. **Resumable** — `persistence.py` supports `--continue` / `--resume THREAD_ID` after disconnect.
3. **Textual-deferred** — `import textual` only at TUI launch; installable via `pip install qilin[tui]`.
4. **Unified commands** — `/help`, `/resume`, `/clear` via `command_registry.py`.
5. **Observable** — User messages and Run events emitted via `runtime.py` to `tracing`.

### Usage

```bash
qilin
qilin --print "What is 2+2?"
echo "What's the weather?" | qilin --json
qilin --continue
qilin --resume THREAD_ID
```

### Related Modules

- **Upstream** — `client.py` (embedded client); `runtime/stream_bridge/`
- **Downstream** — `persistence/thread_meta/` for sessions
