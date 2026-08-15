# KCoder Coding Agent 主线进度记录

> 与《[coding-agent-改造计划.md](./coding-agent-改造计划.md)》配套。每完成一个里程碑追加一条；「用户运行时验收」未通过之前保持 ⏳，不得标记完成。
>
> 验证状态图例：`冒烟 ✅` = 引擎 py_compile/注册表/提示词断言 + 前端 tsc + 真实仓库工具实测；`运行时 ⏳` = 等用户重启引擎/前端走场景；`运行时 ✅` = 用户确认。

---

## Phase A：控制面地基

### 545b890 — 前端打磨 + 控制面地基（审批/停止/追加）

- **内容**：
  - 执行审批卡落地：`<approval_request>` 检测（`output ?? summary` + 容忍截断）、批准/拒绝按钮、approved_ops 一次性放行链路。
  - 停止按钮（interrupt）与 queue 模式（运行中输入入队 + 「立即执行」）。
  - 浅色主题可见性修复（sidebar `text-white` → `text-text-primary`）；Tailwind 透明度 bug 根治（颜色改为 RGB 三元组 + `rgb(var(--x)/<alpha-value>)`）。
  - 澄清卡 option 渲染修复（不再渲染对象原文）。
- **验证**：typecheck ✅；运行时 ✅（后续按此提交的用户反馈迭代）。
- **遗留**：审批卡不弹（M1）→ 1c80443 修复。

### 1c80443 — 验证闭环 + 子代理委派回传 + 重启恢复兜底

- **内容**（14 files，+418/−52）：
  - `run_tests` 工具（自动探测 package.json/go.mod/pytest）+ 提示词 `<verification>` 段 + 交付验证行。
  - 子代理回传：gateway `_translate_custom_event`（task_* → subagent_started/step/completed/failed）+ `tool_call_args_updated`（补齐 atlas 等延迟出现的 subagent_type）+ 前端 SubagentGroup（状态单调、横向不跳）。
  - 重启恢复：`stream_mode=["messages","custom"]` + `if_not_exists="create"`；thread-log 种子消息（60 条上限、id 去重）；workspace 从 thread-log meta 兜底。
  - 控制面实装：`interrupt_turn`/`steer_turn` 真打断（cancel_run + turn_aborted + registry 清理）。
  - 审批 id 改按 path/command 身份哈希（修复重复审批循环）；approval 卡检测兼容 `summary`。
- **验证**：冒烟 ✅；运行时 ⏳（重启后复验：审批卡、子代理卡片、重启恢复、run_tests 验证行）。

---

## Phase B：coding 核心能力四件套

### 0452fbb — repo_map 工具（① 仓库索引第一步）

- **内容**：递归目录树（缩进格式）；复用 list_dir 的 IGNORE_PATTERNS 噪声排除（node_modules/.git/.venv/dist 等）；深度钳制 1–8（默认 4）；条目上限 400，超限尾部提示下钻；走 ls_tool 同款路径解析/禁用技能过滤/掩码。
- **验证**：冒烟 ✅（KCoder 仓库实测 510 条目@depth4 / 1247@depth8，无噪声泄漏）；运行时 ⏳。

### 5d9afa1 — dep_map 工具 + glob 花括号支持（① 依赖索引）

- **内容**：单次 grep 扫 import/require 按文件聚合（py/js/ts/jsx/tsx/go/rs）；行首锚定防注释误报；Go import 块裸包名兼容；预算 2000 行（可调 200–5000）/文件 150/每文件 12 行；`search.path_matches` 增加 `{py,js}` 花括号 alternation（纯增量，glob/grep 同步受益）。
- **验证**：冒烟 ✅（KCoder 仓库 2000 匹配、224 文件聚合正常）；运行时 ⏳。

### a8b4450 — plan-mode 计划批准门（②）

- **内容**：
  - 引擎 `present_plan` 内建工具：结构化提交计划（title/overview/steps/verification），输出 `<plan_request id status="awaiting_approval">`；id=(title,steps) 稳定哈希。
  - PermissionMiddleware：plan-mode 拒绝文案指引 present_plan；README 白名单加入。
  - lead agent 提示词：plan-mode 注入只读约束 + present_plan 出口。
  - 前端 PlanApprovalCard：批准 → 切 `auto-edit` + 携带计划发起执行 turn；拒绝 → 保持 plan-mode 反馈；present_plan 工具调用不再重复展示。
- **验证**：引擎冒烟 ✅ + 前端 tsc ✅ + 解析逻辑 node 单测 ✅（含截断/无 verification 边界）；运行时 ⏳。

### 76a2ae5 — 交付门 review/security 子代理入主线 + security_scan 工具（③）

- **内容**：
  - `<delivery_gate>` 提示词：非平凡变更交付前自动派发 `marcus`（审查）/`sandra`（安全）子代理，严重发现必修；仅当 subagent_enabled 且注册表存在对应类型时注入；提醒预留子代理预算。
  - `security_scan` 确定性启发式扫描：硬编码密钥 / 命令执行 / shell=True / XSS 汇 / SQL 拼接 / 反序列化 / 私钥 / 明文 HTTP，按类聚合输出 + 误报提示；code-execution 模式带 lookbehind 排除 `obj.exec(` 方法调用误报。
  - PermissionMiddleware 只读白名单加入 repo_map/dep_map/security_scan。
- **验证**：冒烟 ✅（KCoder 仓库实测 58 findings/7 类，含 config.yaml 真实 api_key；误报已压）；运行时 ⏳。

### 5142119 — present_delivery 交付卡（④ PR/changelog）

- **内容**：
  - 引擎 `present_delivery` 内建工具：title/summary/changes/tests/review/changelog → `<delivery id>` 块；id=(title,changes) 稳定哈希。
  - 交付门提示词收尾：验证+审查通过后调用 present_delivery。
  - 前端 DeliveryCard：变更清单/测试/审查结论/changelog + 「复制 PR 描述」+「追加到 CHANGELOG」（useChat `writeChangelog` 让 agent 写入项目根 CHANGELOG.md）；present_delivery 调用不重复展示。
- **验证**：引擎冒烟 ✅ + 前端 tsc ✅ + 解析 node 单测 ✅；运行时 ⏳。

---

## Phase C：上下文压缩 + 长任务可靠性

### C2 — SSE 可靠性：事件 seq + Last-Event-ID 重放 + 迟到订阅重放

- **内容**：
  - 每个 SSE 事件分配单调递增 seq（`id:` 帧行 + payload `eventId`），事件进有界缓冲（1000 条）。
  - 断线重连携带 `Last-Event-ID`（头/query）→ 从断点补发（缓冲重放 + 队列剩余），前端按 eventId 单调去重，文本增量幂等消费。
  - run 结束移入 registry 最近缓存（20 条有界）→ 迟到订阅重放整轮事件，消除「短 turn 在 SSE 建连前结束 → No active turn」竞态；未知线程才返回该错误。
  - 重连悬挂防护：consume 任务已结束时队列空即收尾（避免哨兵被前一连接消费后阻塞）。
  - 前端 subscribeToThread 已有重连基建（Last-Event-ID 头 + 指数退避 + 终端检测），本轮补齐 seq 去重。
- **验证**：py_compile ✅ + 7 场景单测 ✅（首连全量 / 断点补发 / 最近缓存全量+断点重放 / 打断路径缓冲+队列重放 / 缓存有界 / Last-Event-ID 解析）+ 前端 tsc ✅ → 运行时 ⏳（断网重连、短 turn、追加场景）。

### C1 — 上下文压缩接线（自动 + 手动 + 前端可见）

- **内容**：
  - 自动压缩：运行配置启用 SummarizationMiddleware（trigger=40 条消息 / keep=最近 20 条）；此前 `trigger: null` 导致中间件存在但永不触发。
  - 手动压缩：前端「压缩」按钮改为**强制压缩 turn**——`configurable.force_compact` 注入，中间件 `_config_force_compact` 绕过自动阈值（`_determine_cutoff_index` 仍守卫短历史）。
  - 可见性：引擎压缩时 `before_summarization` 钩子向 custom 流发 `context_compacted` 事件 → gateway `_translate_custom_event` 翻译为 `compaction_completed` SSE（携带 removed/preserved 计数）→ 前端 turnReducer 记入 `msg.compaction`，AssistantTurn 渲染「📦 上下文已压缩」提示。
  - 配置落三处：config.yaml / config.yaml.example / ~/.kcoder/config/qilin.runtime.yaml（trigger 由 null → 40 条）。
- **验证**：引擎 py_compile + 中间件工厂/钩子/事件负载单测 ✅ + gateway 翻译单测 ✅ + 前端 tsc ✅；运行时 ⏳（长对话触发自动压缩 / 手动按钮 / 提示卡）。

### C3 — 工具失败状态如实传递

- **现象（审计 7.2）**：gateway 的 tool_call_finished 恒发 `isError: False`，工具执行失败在前端显示为成功。
- **修复**：抽出 `_translate_tool_message`：langgraph 序列化的 `status: "error"`（工具抛出）或 KCoder 沙箱工具的 `Error:` 前缀契约（受控失败）→ `isError: True`。前端 isError 链路（turnReducer → ToolCall.isError → ToolOutput 红字）此前已就绪，无需改动。
- **验证**：py_compile ✅ + 6 场景单测 ✅（成功/status=error/Error: 前缀/无 call_id/artifact 透传/审批拦截不误标）→ 运行时 ⏳。

---

## 缺陷修复（主线外热修）

### 删除项目后重启仍残留记录 + createProject 400 / todos 404

- **现象**：本地目录与项目数据空间都删了，重启后前端仍列出该项目的历史线程，启动时对死路径自动注册 `POST /v1/projects 400`，选中线程 `GET /todos 404`（`GET /goal` 同类，共多个 404）。第一轮只静默 console.error 无效——浏览器网络层照样显示红色 400/404。
- **根因**：① 删除项目（delete_project）只归档了 langgraph 侧线程，thread-log 兜底仍持有且无 archived 标记；② 侧边栏以 `includeArchived: true` 拉线程，归档线程也参与自动注册；③ goal/todos 端点对 langgraph 侧丢失的 thread-log 恢复线程一律 404。
- **修复（三个提交）**：
  1. `delete_project` 级联：thread-log 中 workspace 匹配的条目一并标记 archived（`archivedLogEntries` 计数返回）。
  2. `list_threads` 合并时对 thread-log 条目做**死路径软过滤**（workspace 目录不存在则跳过，不改存储，目录恢复后自动重新出现）——当前已有的残留线程重启后即被隐藏，无需迁移。
  3. 前端自动注册兜底（两轮）：先透传 400 detail + 「Directory does not exist」静默跳过；后改为**源头消除 400**——自动注册跳过 archived 线程且改走 `POST /projects?silent_missing=true`（缺失目录返回 200 skipped 而非 400），开发者面板不再出现红色网络错误。显式注册（目录选择器/新建项目）仍走严格 400。
  4. goal/todos 端点重构：thread 存在（langgraph 或 thread-log 恢复）→ 200 + null（无数据）；仅 thread 完全不存在才 404。顺带修复响应形状与 engine-api 读取对齐（`{"goal": ...}` / `{"todos": ...}` 包装；此前裸对象导致 `data.goal`/`data.todos` 恒为 null，InfoPanel 计划/进度段永远显示「暂无」）。
- **验证**：py_compile ✅ + 单测 ✅（死路径过滤 / 删除级联只归档匹配 workspace / silent_missing 三态 / goal+todos 8 场景）+ 前端 tsc ✅ → 运行时 ⏳（重启后控制台无 400/404，InfoPanel 计划/进度段开始有内容）。

### 追加（steer）后出现「No active turn」

- **现象**：运行中对 turn 追加指令（方案 A 打断重发）后，前端报 `No active turn`，新 turn 流没连上。
- **根因**：registry 清理按 `thread_id` 而非 run 身份。旧 consume 任务被 cancel 后，其 `finally` 仍会异步收尾（落盘用量、推哨兵都是 await），此时新 turn 已注册 → 旧 finally 的 `registry.remove(thread_id)` 把**新 run** 误删；`interrupt_turn` 里 `await cancel_run` 期间同样存在该窗口。
- **修复**：`RunRegistry.remove_if_current(run)`（对象身份校验，仅移除仍是当前注册的自己）；consume finally 与 interrupt_turn 两处调用点全部切换。单测覆盖：旧 run 迟到清理不误删 / interrupt await 窗口 / 正常清理 / 旧 `remove` 语义兼容。
- **验证**：py_compile ✅ + 单测 ✅ → 运行时 ⏳（重启 gateway 后追加一次验证）。

### 历史任务重启后「工作区是空的」澄清卡（workspace 绑定丢失）

- **现象**：重启引擎后继续历史任务，agent 看到 `/mnt/user-data/workspace` 为空（qlib_quantitative / chan_theory_v2 都不存在），弹出澄清卡要源文件——但上下文（种子消息）还在。
- **根因**：`start_turn` 的 thread-log 兜底只挂在 `get_thread` **异常**分支。重启后第一次恢复运行时 `if_not_exists="create"` 在 LangGraph 侧重建了**空元数据**线程，之后 `get_thread` 成功但 `meta.workspace` 为空 → 兜底不触发 → sandbox 映射到默认空目录。
- **修复**（`_resolve_workspace`）：workspace 解析改为「langgraph meta → thread-log 兜底」无条件二级回退；恢复成功后**异步写回** langgraph 元数据自愈（后续 turn 直接命中）。单测覆盖 4 场景（空元数据线程 / 线程丢失 / 直接命中 / 两处皆空）。
- **验证**：py_compile ✅ + 单测 ✅；已核对用户实际 thread-log（`01a0045e…`，workspace=`/Users/libing/kk_Projects/kk_Stock/KChan`，目录在盘存在）→ 运行时 ⏳（重启 gateway 后重发消息验证）。

## 待运行时验收清单（当前）

1. 重启引擎（langgraph dev）加载新工具/提示词；重启前端加载新卡片。
2. plan-mode 全链路：需求 → 计划卡 → 「批准并执行」→ 自动切 auto-edit 按计划执行。
3. 交付门：完成后自动派发 marcus/sandra（SubagentGroup 可见）+ security_scan 调用。
4. present_delivery 交付卡：复制 PR 描述 / 追加 CHANGELOG。
5. repo_map / dep_map 在新线程实际使用一次。
6. 复验 Phase A 遗留：审批卡、run_tests 验证行、子代理卡片、重启恢复（thread-log 种子）。
7. `logs/kcoder-debug.log` grep：`permission|custom event|subagent|no active turn|delivery`。

## 已知取舍 / 待办
- repo_map 未做 per-turn 缓存：扫描 <50ms，无状态实现更稳；如需再议。
- security_scan 为启发式扫描：注释/文档字样会误报，卡片已注明需人工甄别。
- **上下文压缩未接线**：`context_compaction.py` spike 存在但未接入 → Phase C1（最高优先级提案）。
- `docs/` 曾整体 gitignore → 本次修正为 `docs/*` + `!docs/coding-agent-*.md`，计划/进度纳入版本控制。
- `python-runtime/config.yaml` 含真实 api_key（审计 P0-1）：主线范围外，但每轮提醒轮换。

## 未决事项

- [ ] Phase C 范围确认（C1 压缩接线是否立即开工；C2/C3 可靠性是否纳入本轮）。
- [ ] Phase A 遗留的运行时复验结果登记（见上方清单第 6 条）。
- [ ] 是否需要 repo_map per-turn 缓存 / security_scan 增加 .env 等额外文件类型（当前被 walker 忽略）。
