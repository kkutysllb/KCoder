# KCoder Agent 自行中断 —— 全链路诊断报告（2026-08-16）

> 现象：agent 执行任务时"自己中断"，非预算导致。
> 方法：基于 `logs/kcoder-debug.log`（2026-08-16 09:15:59–09:21:54 完整会话）、
> `~/.kcoder/thread-log/`、`qilin.db` runs 表、checkpoint 文件、全链路源码交叉验证。

---

## 一、事故时间线（日志实锤）

| 时间 | 事件 |
|---|---|
| 09:15:59 | App 启动：langgraph dev(:19164) + gateway(:19163) + 7 个 MCP server |
| 09:16:31 | Turn 1（"还有哪些没有完成？"）→ 09:16:38 成功。**流无 `end` 事件**，gateway 合成 turn_completed |
| 09:16:56 | Turn 2（2 字符 prompt）→ plan 模式 + 子代理，run `01a00824-afc7` |
| 09:16:59 | LLM 调用完成（input 55,343 tokens，cache_read 54,912） |
| 09:17:00.15 | 沙箱审计通过 `python -m pytest tests/ --tb=line 2>&1 \| tail -60`，权限预检 auto-edit 通过 → pytest 执行 |
| 09:17:00 → 09:21:00 | **4 分钟完全静默**（pytest 未完成，run 存活）；网关每 15s 发 `: ping` 心跳 |
| 09:21:00±2s | **前端看门狗触发**（240s 无事件）：标 error「任务长时间无响应（超过 4 分钟无进展），已自动终止」+ `abortCurrentTurnWait()` —— **只解除前端等待，不 cancel 引擎 run（假终止）** |
| 09:21:07 | 看门狗 finally → 线程列表刷新（`POST /threads/search`） |
| 09:21:54.5 | 用户手动退出 → `before-quit` → `stopEngine()` → SIGTERM gateway → SIGTERM langgraph dev |
| 09:21:54.86 | run 被 `CancelledError` 杀死（"Background run failed, will retry" → 进程死亡） |
| 09:21:54.56 | 网关 SSE `ReadError` → 合成 turn_failed「引擎执行流中断」 |

## 二、核心根因：三层对 run 生命周期的认知不一致

```
引擎层：  run 在后台 worker 执行；SSE 流只是事件通道。流关 ≠ run 停，run 一直跑到完成/取消
网关层：  流结束就合成终态（无 end 事件 → turn_completed / 异常 → turn_failed），不校验 run 真实状态
前端层：  等终态事件；240s 无事件 → "假终止"（只 abort 本地等待 + 红字），不调 interruptTurn
```

用户确认：**「旧 run 还在跑」** —— 看门狗报"已自动终止"后引擎 run 并未终止；直到重发消息，网关"队列排毒"
（防线1：新 turn 前 cancel 所有遗留 run）才真正杀掉旧 run。

## 三、qilin.db runs 表揭示的规律（旁证）

同一线程（01a00531）的 run 普遍是"巨型 run"：

| run | tokens | LLM 轮数 | 结局 |
|---|---|---|---|
| 01:07 run | 7,538,228 | 99 | 自然结束 |
| 00:44 run | 5,428,898 | 86 | 自然结束 |
| 12:48 run | 3,205,500 | 76 | 用户取消 |

- 每轮输入 ~55K tokens（全量历史重发）→ 99 轮 ≈ 753 万 tokens
- **预算守卫未启用**（`TokenBudgetConfig.enabled=False`，config 无 token_budget 段）→ "不是预算导致"成立
- 循环检测（LoopDetection）阈值：相同调用 5 次 / 单工具 50 次（窗口内）——99 轮 run 参数多变，检测不到
- Summarization 阈值 36 万 tokens——上下文稳定 ~55K，从未触发
- **runs 表 status 全部 = 'error'**（连成功的 turn 1 也是）：`sse.py` 用 `"success" if got_end else "error"`，
  而 langgraph dev 的流从不发 `end` 事件 → 用量统计 status 系统性失真

## 四、内存/checkpoint 膨胀（历史"发烫"根源）

- full 模式下每次 agent step 全量快照消息列表：单线程 checkpoint **12,563 个快照 / 1,078 份完整 messages / 190MB**
- 两处 pckl 合计约 400MB（仓库侧 235MB + `~/.kcoder` 侧 163MB）
- 已治理：切换引擎原生 **delta checkpoint**（见下）

## 五、修复方向（按优先级）

1. **消除假终止**：看门狗触发时真正 `interruptTurn`；心跳计入活动；或引擎给长工具推进度事件（bash stdout tick）
2. **终态判定修复**：gateway 合成 turn_completed/failed 前查 `GET /runs` 校验真实状态；修 status 标记
3. **长工具可见性**：工具执行期间周期性发 `tool_progress` SSE 事件
4. **run 效率治理**：99 轮/753 万 tokens 的循环需分析任务内容（thread-log 有记录），判断正常大任务 vs 无效空转
5. **checkpoint 治理（已实施）**：见下节

---

## 六、Checkpoint Delta 治理（已实施并验证 2026-08-16）

### 引擎原生支持

`qilin/runtime/checkpoint_mode.py`：dual-mode（`full` 全量快照 / `delta` LangGraph `DeltaChannel` 哨兵+增量），
full → delta 是官方支持的迁移路径（delta 进程透明读旧 full checkpoint）。

### 改动

| 文件 | 修改 |
|---|---|
| `~/.kcoder/config/qilin.runtime.yaml` | `database.checkpoint_channel_mode: delta` + `checkpoint_delta.snapshot_frequency: 10` |
| `python-runtime/config.yaml`（模板） | 同款 database 段 |

mode 为 process-frozen（restart-required），重启 app 生效。

### 旧数据备份

- 仓库侧 235MB → `backups/langgraph-api-pckl-20260816/`
- `~/.kcoder` 侧 163MB → `~/.kcoder/backups/langgraph-api-pckl-20260816/`
- 确认无误后可删除

### 端到端验证（真实 MiniMax 调用，2 个 turn 含 bash 工具）

| 指标 | full（旧） | delta（新） |
|---|---|---|
| checkpoint 数 | 12,563 | 24 |
| 序列化体积 | ~242MB（仓库侧）+163MB（用户侧） | **74 KB** |
| 磁盘写入 | 每 10s 全量 dump 190MB pckl | 不生成 pckl（增量驻内存，每 10 步全量快照） |
| metadata | 无 | `qilin_checkpoint_channel_mode="delta"` + `counters_since_delta_snapshot` |
| run 执行 | — | 正常（无 CheckpointModeMismatchError，state 正常物化） |

体积缩小约 **5000 倍**。

### 旧线程恢复验证（thread-log fallback）

旧线程 01a00531 的 checkpoint 已移走，实测 gateway `GET /v1/threads/:id`：
`get_thread upstream miss (404) → thread_log fallback turns=11 items=573 (deduped)`，历史完整恢复（22 用户消息 + 282 助手文本 + 269 工具结果）。

### 已知观察

- delta 模式下 checkpoint 未再落盘 pckl 文件（磁盘膨胀=0）；跨重启的线程状态恢复依赖 gateway thread-log 兜底（现有机制，已验证）
- 如需 checkpoint 跨重启持久化，可研究 `langgraph.json` 的 `"checkpointer"` 字段（langgraph-checkpoint-sqlite 3.1.1 已安装），但引擎工厂对 delta+checkpointer 组合有限制，需单独验证

---

## 七、中断主线修复（已实施并验证 2026-08-16）

### 1. 前端：看门狗"假终止"根治（useChat.ts + engine-api.ts）

**改动前**：240s 无**任何**事件 → 判死。但 gateway 的 `: ping` 心跳帧在前端被过滤
（无 `data:` 行），不刷新计时 → "连接活着但引擎静默"（长 pytest > 4 分钟）被误判；
且触发时只 `abortCurrentTurnWait()` 解锁 UI，**不 cancel 引擎 run**（"已自动终止"名不副实，
run 继续后台跑，直到用户重发消息才被队列排毒杀掉）。

**改动后**（双活性看门狗）：
- `engine-api.ts`：SSE comment 帧（`: ping`）转为 `{kind:'heartbeat'}` 事件上抛
- `useChat.ts`：
  - **连接活性** 240s 无任何帧（含心跳）→ 连接死/网关挂
  - **业务活性** 720s 无业务事件但连接活 → run 疑似卡死（长工具由
    `bash_command_timeout=600s` 兜底，12 分钟留足余量，不再误杀 pytest）
  - 触发时：`abortCurrentTurnWait()` + **真正 `interruptTurn()` 取消引擎侧 run**
- i18n 文案更新（去掉不准确的"超过 4 分钟"）

### 2. 网关：终态诚实化补齐（sse.py）

**改动前**：流结束无 `end` 事件 → 无脑合成 turn_completed（可能把"还在后台跑的 run"
伪装成完成）；`persist_run_usage` status 用 `"success" if got_end else "error"`
（langgraph dev 从不发 end → runs 表全部 error，统计失真）。

**改动后**：合成终态前查 `GET /threads/{id}/runs` 的真实 run 状态：
- `completed`/`success`（langgraph dev 实测返回 success，两值兼容）→ 合成 turn_completed（有依据）
- `error`/`cancelled`/`interrupted` → 如实 turn_failed
- `running`/`pending` → turn_failed 并注明"引擎仍在后台执行，连接已中断"
- 查不到（接口异常/run_id 未捕获）→ 维持旧行为（不回归）
- persist status 同步基于真实状态

### 验证

- 网关 pytest 26 通过；前端 `tsc --noEmit` 通过
- 端到端冒烟（真实 MiniMax 调用）：事件流完整（turn_started→reasoning→text→usage→completed）；
  日志确认 `run_status=completed → synthesizing turn_completed`（终态校验生效）
- 顺带验证 delta checkpoint 落盘体积：**~513KB vs full 模式 240MB（缩小约 470 倍）**

### 剩余待办

- run 效率治理：99 轮/753 万 tokens 的巨型 run 需分析任务内容（thread-log 有记录），
  判断正常大任务 vs 无效空转（可考虑上下文压缩阈值下调）
- 长工具可见性（可选增强）：bash 工具执行期间推 `tool_progress` 事件，前端显示进度

