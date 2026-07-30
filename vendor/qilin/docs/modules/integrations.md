# integrations 模块（integrations module）

> QiLin engine · integrations subsystem · 双语 / Bilingual

---

## 中文版

### 职责

`qilin.integrations` 提供第三方 IM（飞书 Lark）平台与 QiLin 之间的桥接。当前内置仅飞书，但其抽象方式可被推广到任意"群聊 / 私聊 + 命令回执"通道。

- **`lark_broker.py`**：把飞书事件流转换为 QiLin `Run`，把 QiLin 流转换为飞书消息回复（支持流式 + 卡片 + Markdown）
- **`lark_cli.py`**：可被 skill / sub-agent 调用的 Lark CLI 封装（拉群、拉消息、创建文档等）

### 关键文件

| 文件 | 作用 |
|------|------|
| `integrations/lark_broker.py` | 飞书 ↔ QiLin 双向桥 |
| `integrations/lark_cli.py` | Lark CLI 命令封装 |

### 设计要点

1. **事件驱动**：`lark_broker` 把 webhook 转换为 QiLin Run，`run_ownership` 保证同 thread 不并发
2. **流式输出**：把 QiLin 输出的 token 级事件合并为卡片，富文本 + 按钮
3. **本地 session**：`lark_cli.py` 提供本地沙箱内的 `lark-cli` 二进制运行时
4. **manifest**：每次启动时写入 `.qilin-lark-cli-manifest.json` 与 `.qilin-lark-cli-runtime.json` 等 marker
5. **可观测**：每个 webhook 调用都通过 `tracing` 上报

### 配置示例

```yaml
channel_connections:
  lark:
    enabled: true
    app_id: ${LARK_APP_ID}
    app_secret: ${LARK_APP_SECRET}
    verification_token: ${LARK_VERIFICATION_TOKEN}
    webhook_url: https://open.feishu.cn/open-apis/bot/v2/hook/...
```

### 关联模块

- **上游**：`config/channel_connections_config.py`、`config/auth_config.py`
- **下游**：`runtime/runs/manager.py` 接收 webhook 转换的 Run

---

## English Version

### Responsibility

`qilin.integrations` bridges IM platforms (currently Lark/Feishu) to QiLin. The abstraction is generalizable to any "group/private chat + command echo" channel.

- **`lark_broker.py`** — Converts Lark events to QiLin Runs and QiLin stream to Lark messages (stream + card + Markdown)
- **`lark_cli.py`** — Lark CLI wrapper exposed to skills / sub-agents

### Key Files

| File | Purpose |
|------|---------|
| `integrations/lark_broker.py` | Lark ↔ QiLin bridge |
| `integrations/lark_cli.py` | Lark CLI wrapper |

### Design Highlights

1. **Event-driven** — `lark_broker` converts webhooks to QiLin Runs; `run_ownership` prevents concurrent same-thread runs.
2. **Streaming output** — Merges QiLin token-level events into rich cards.
3. **Local session** — `lark_cli.py` provides an in-sandbox `lark-cli` binary runtime.
4. **Manifest** — Writes `.qilin-lark-cli-manifest.json` and `.qilin-lark-cli-runtime.json` markers on each launch.
5. **Observable** — Every webhook call reports to `tracing`.

### Config Example

```yaml
channel_connections:
  lark:
    enabled: true
    app_id: ${LARK_APP_ID}
    app_secret: ${LARK_APP_SECRET}
    verification_token: ${LARK_VERIFICATION_TOKEN}
```

### Related Modules

- **Upstream** — `config/channel_connections_config.py`, `config/auth_config.py`
- **Downstream** — `runtime/runs/manager.py` receives webhook-spawned Runs
