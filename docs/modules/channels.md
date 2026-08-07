# channels 模块（channels module）

> QiLin engine · IM channel adapter subsystem · 双语 / Bilingual

---

## 中文版

### 职责

`app.channels` 是 QiLin 的 **IM 渠道接入层**：让最终用户通过常用 IM 直接与 Agent
对话（`@bot 提问` → 异步运行 → 回推结果），覆盖 8 大渠道：

| 渠道 | 实现 | 接入方式 |
|------|------|---------|
| 飞书 / Feishu | `feishu.py` | lark-oapi 长连接（无需公网 IP） |
| Discord | `discord.py` | discord-py 网关事件 |
| Slack | `slack.py` | slack-sdk Socket Mode / Events |
| Telegram | `telegram.py` | python-telegram-bot 长轮询（无需公网 IP） |
| 钉钉 / DingTalk | `dingtalk.py` | dingtalk-stream 长连接 |
| 企微 / WeCom | `wecom.py` | 企微回调 / 消息推送 |
| 微信 / WeChat | `wechat.py` | 微信协议接入 |
| GitHub | `github.py` | GitHub App 安装触发（与 gateway webhook 协同） |

渠道层只做"连接 + 协议转换"，对话逻辑全部委托 `qilin` 内核：
消息 → `ChannelManager` 去重与身份绑定 → `service` 发起异步运行 →
`run_policy` 决定运行形态 → 结果回推渠道。

### 关键机制

- **消息总线**（`message_bus.py`）：渠道与内核之间的异步消息管道，统一入站
  （用户消息）与出站（agent 回复）方向
- **去重**（`dedupe_store.py`）：入站消息按 (渠道, 用户, 消息) 指纹去重，
  防止平台重试 / webhook 重复投递导致重复运行
- **连接身份**（`connection_identity.py`）：渠道侧用户 ↔ QiLin 用户 / agent 的身份
  绑定与解析，配合 `channel_connections` 配置段的 `require_bound_identity`
- **运行策略**（`run_policy.py` + `feishu_run_policy.py`）：全局 `CHANNEL_RUN_POLICY`
  映射，定义消息如何映射到运行（单次运行 / 会话延续 / 权限校验）
- **运行时配置**（`runtime_config_store.py`）：渠道触发的运行所需的运行时参数
  （thread / agent / model override 等）持久化
- **命令**（`commands.py`）：统一的渠道命令集（如 `/start`、`/new`），
  单一权威定义避免各渠道行为漂移
- **连接存储**（`store.py`）：渠道连接记录落库（`persistence.channel`），
  支持跨进程 / 多实例共享状态

### 关键文件

| 文件 | 作用 |
|------|------|
| `base.py` | 渠道基类（连接生命周期、消息收发抽象） |
| `manager.py` | `ChannelManager`：渠道注册、入站去重、运行派发总入口 |
| `service.py` | 渠道异步运行服务（发起运行、回推结果；由 gateway lifespan 拉起） |
| `message_bus.py` | 入站 / 出站消息总线 |
| `run_policy.py` | 渠道运行策略映射 |
| `dedupe_store.py` | 入站消息去重存储 |
| `connection_identity.py` | 渠道用户身份绑定与解析 |
| `runtime_config_store.py` | 运行时参数持久化 |
| `commands.py` | 渠道命令权威定义 |
| `store.py` | 连接记录持久化 |
| `feishu_run_policy.py` | 飞书专属运行策略 |
| `dingtalk.py` / `discord.py` / `github.py` / `slack.py` / `telegram.py` / `wechat.py` / `wecom.py` | 各渠道实现 |

### 设计要点

1. **渠道薄、内核厚**：渠道文件只负责协议适配，不包含任何对话逻辑；
   全部渠道行为一致，差异收敛在 `base.py` 抽象内。
2. **一次消息 = 一次运行**：入站去重保证平台重试不会产生重复运行；
   运行结果经 message_bus 回推，渠道断开不影响内核执行。
3. **身份可绑定**：默认 `require_bound_identity: true`——未绑定用户的消息被拒绝，
   避免未授权访问；绑定关系可经 gateway `channel_connections` API 管理。
4. **无公网依赖**：飞书 / 钉钉 / Telegram 走长连接或长轮询，本地开发即可联调。
5. **可观测**：渠道事件携带 trace_id，与内核运行一条链路贯穿。

### 配置示例

```yaml
# config.yaml
channel_connections:
  enabled: true
  require_bound_identity: true   # 未绑定身份的消息将被拒绝
  telegram:
    enabled: true
    bot_username: ""             # 机器人用户名
  slack:
    enabled: false
  feishu:
    enabled: false
  dingtalk:
    enabled: false
  discord:
    enabled: false
  wechat:
    enabled: false
  wecom:
    enabled: false
```

```bash
# 安装渠道 SDK（channels extras）
pip install "qilin[channels]"

# 渠道服务随 gateway 进程一起启动（lifespan 拉起）
uvicorn app.gateway.app:app --port 8001
```

### 关联模块

- **上游**：`qilin.runtime`（异步运行）、`qilin.persistence.channel`（连接存储）、
  `qilin.config`（`channel_connections` 配置段）
- **下游**：`app.gateway`（`channels` / `channel_connections` REST 端点）、
  `app.scheduler`（渠道定时任务）
- **测试**：`tests/` 下渠道去重、身份绑定与运行策略测试

---

## English Version

### Responsibility

`app.channels` is QiLin's **IM channel adapter layer**: end users chat with the
agent directly from their favorite IM (`@bot ask` → async run → result pushed
back), covering 8 channels:

| Channel | Implementation | Transport |
|---------|----------------|-----------|
| Feishu | `feishu.py` | lark-oapi long connection (no public IP needed) |
| Discord | `discord.py` | discord-py gateway events |
| Slack | `slack.py` | slack-sdk Socket Mode / Events |
| Telegram | `telegram.py` | python-telegram-bot long polling (no public IP needed) |
| DingTalk | `dingtalk.py` | dingtalk-stream long connection |
| WeCom | `wecom.py` | WeCom callbacks / message push |
| WeChat | `wechat.py` | WeChat protocol adapter |
| GitHub | `github.py` | GitHub App install triggers (coordinated with gateway webhooks) |

The channel layer only handles "connection + protocol conversion"; all dialog
logic is delegated to the `qilin` kernel: message → `ChannelManager` dedupe and
identity binding → `service` starts an async run → `run_policy` shapes the run →
result pushed back to the channel.

### Key Mechanisms

- **Message bus** (`message_bus.py`) — async pipeline between channels and the
  kernel, unifying inbound (user messages) and outbound (agent replies)
- **Dedupe** (`dedupe_store.py`) — inbound messages are fingerprinted by
  (channel, user, message) to prevent duplicate runs from platform retries /
  webhook redelivery
- **Connection identity** (`connection_identity.py`) — channel user ↔ QiLin
  user/agent binding and resolution, paired with `require_bound_identity` in the
  `channel_connections` config section
- **Run policy** (`run_policy.py` + `feishu_run_policy.py`) — the global
  `CHANNEL_RUN_POLICY` map defines how messages map to runs (one-shot / session
  continuation / permission checks)
- **Runtime config store** (`runtime_config_store.py`) — persists the runtime
  parameters (thread / agent / model override) for channel-triggered runs
- **Commands** (`commands.py`) — single authoritative channel command set (e.g.
  `/start`, `/new`), preventing behavior drift across channels
- **Connection store** (`store.py`) — channel connection records persist via
  `persistence.channel`, shared across processes / instances

### Key Files

| File | Responsibility |
|------|----------------|
| `base.py` | Channel base class (connection lifecycle, messaging abstraction) |
| `manager.py` | `ChannelManager`: channel registration, inbound dedupe, run dispatch |
| `service.py` | Async run service (start runs, push results back; started by the gateway lifespan) |
| `message_bus.py` | Inbound / outbound message bus |
| `run_policy.py` | Channel run policy map |
| `dedupe_store.py` | Inbound message dedupe storage |
| `connection_identity.py` | Channel user identity binding & resolution |
| `runtime_config_store.py` | Runtime parameter persistence |
| `commands.py` | Authoritative channel command definitions |
| `store.py` | Connection record persistence |
| `feishu_run_policy.py` | Feishu-specific run policy |
| `dingtalk.py` / `discord.py` / `github.py` / `slack.py` / `telegram.py` / `wechat.py` / `wecom.py` | Per-channel implementations |

### Design Points

1. **Thin channels, thick kernel** — channel files only adapt protocols; no dialog
   logic lives there. All channels behave identically, with differences
   converged inside the `base.py` abstraction.
2. **One message = one run** — inbound dedupe guarantees platform retries never
   create duplicate runs; results are pushed back via the message bus, and a
   disconnected channel does not affect kernel execution.
3. **Bindable identity** — with `require_bound_identity: true` (default),
   messages from unbound users are rejected; bindings are managed through the
   gateway `channel_connections` API.
4. **No public IP needed** — Feishu / DingTalk / Telegram use long connections or
   long polling, so local development works out of the box.
5. **Observability** — channel events carry trace_id, sharing one pipeline with
   kernel runs.

### Configuration Example

```yaml
# config.yaml
channel_connections:
  enabled: true
  require_bound_identity: true   # reject messages from unbound identities
  telegram:
    enabled: true
    bot_username: ""             # bot username
  slack:
    enabled: false
  feishu:
    enabled: false
  dingtalk:
    enabled: false
  discord:
    enabled: false
  wechat:
    enabled: false
  wecom:
    enabled: false
```

```bash
# Install channel SDKs (channels extras)
pip install "qilin[channels]"

# Channels start together with the gateway process (lifespan)
uvicorn app.gateway.app:app --port 8001
```

### Related Modules

- **Upstream**: `qilin.runtime` (async runs), `qilin.persistence.channel`
  (connection storage), `qilin.config` (`channel_connections` config section)
- **Downstream**: `app.gateway` (`channels` / `channel_connections` REST endpoints),
  `app.scheduler` (channel scheduled tasks)
- **Tests**: channel dedupe, identity binding, and run-policy tests under `tests/`
