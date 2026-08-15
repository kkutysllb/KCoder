# KCoder Coding Agent 主线改造计划

> **维护规则（防漂移）**
> 1. 本文件是「coding agent 主线」计划的唯一权威来源。范围变更必须先改这里、得到确认，再动手写代码。
> 2. 已完成阶段只存档、不删除；后续阶段以「提案」状态进入，确认后改为「进行中」，完成时打 ✅。
> 3. 每一次里程碑落地后，必须在《[coding-agent-进度记录.md](./coding-agent-进度记录.md)》追加一条进度记录（提交、内容、验证状态），两者配套使用。
> 4. 若发现实际实现与本文件冲突，以「先对齐计划、再改实现」为原则处理。

---

## 0. 为什么有这份文档

- 审计基线：《kcoder-completion-audit-report.md》（2026-08-14）判定 KCoder 为**内部 Alpha**：功能完成度约 60%，交付就绪度 35%–40%；治理/审批/运行控制完成度仅 20%–35%，多数为 stub；可靠性（SSE、失败恢复、删除语义）与安全边界（路径越权、认证 fail-open、真实 key 入库）存在 P0/P1 问题。
- 用户确认的主线目标（原文）：
  > “我们后续主要完成一个 coding agent 的核心功能，结合我们的子代理、技能、工具。从 coding 本身出发，完善所有场景和功能点。”
- 主线策略：**先控制面（A），再核心能力（B），再上下文与可靠性（C），最后场景完善（D）**。不做漫无边际的 UI/端点扩展；审计报告里的安全止血与打包路线（其阶段一~五）作为关联长线，另行推进，不与主线混淆。

## 1. 主线范围与不变量

### 1.1 范围内

| 类别 | 内容 |
|---|---|
| 控制面 | 权限四模式、审批、停止、追加（steer）、计划批准、上下文压缩 |
| 代码理解 | 仓库索引（repo_map）、依赖图谱（dep_map）、读/搜/浏览工具 |
| 执行闭环 | 编辑 → 验证（run_tests）→ 审查（marcus）→ 安全（security_scan/sandra）→ 交付（PR/changelog） |
| 委派 | 子代理（task）在主循环中的编排与回传展示 |
| 场景完善 | 以 coding 实际场景驱动，补全工具、技能与子代理的配合点 |

### 1.2 范围外（现阶段明确不做，防止漂移）

- 独立打包 / 跨平台发布（审计阶段四）
- 多用户 / 多租户隔离、marketplace、远程控制（审计 P2）
- 以上仅当用户明确要求时才纳入。

### 1.3 架构不变量（任何改动必须遵守）

1. 三层架构：Electron(Main/Renderer) ↔ FastAPI Gateway（SSE 事件翻译）↔ QiLin(LangGraph Platform REST)。前端不直连 QiLin。
2. QiLin 引擎 vendored 在 `vendor/qilin`，KCoder 只改适配层（middleware、tools、prompt、sandbox）。
3. 历史与 workspace 绑定有 thread-log JSON 兜底（`$KCODER_APP_DATA_DIR/thread-log/<id>.json`），LangGraph checkpoint 重启丢失时恢复。
4. 执行权限四模式：`plan-mode` / `auto-edit`（默认）/ `confirm-before-change` / `full-access`，经 `configurable.permission_mode` 注入，PermissionMiddleware 拦截。
5. 新增引擎工具必须注册三处配置：`python-runtime/config.yaml`（私密，gitignored）、`python-runtime/config.yaml.example`（可提交）、`~/.kcoder/config/qilin.runtime.yaml`（运行时实际生效，需 escalation 修改）。
6. 前端交互卡片检测统一模式：引擎写 `<xxx_request id="...">` 块到 ToolMessage.content → 前端查 `tool.output ?? tool.summary` + 正则容忍截断（闭合标签可缺）。
7. 提交粒度：每个里程碑一次独立提交，提交信息标注阶段号。

## 2. 阶段总览

| 阶段 | 主题 | 状态 |
|---|---|---|
| A | 控制面地基（审批 / 停止 / 追加） | ✅ 完成（已存档） |
| B | coding 核心能力四件套（索引 / 计划门 / 审查安全门 / 交付） | ✅ 完成，⏳ 待用户运行时验收（已存档） |
| C | 上下文压缩 + 长任务可靠性 | ✅ 完成（C1 压缩接线 / C2 SSE 重放 / C3 失败状态），⏳ 待运行时验收 |
| D | 技能与场景完善 | 🔨 提案中（见 §6，待用户确认） |
| 关联长线 | 审计路线图 阶段一（安全止血）~ 阶段五（产品能力/质量体系） | 参考背景，不在主线内 |

## 3. 阶段 A：控制面地基（✅ 已存档）

**目标**：把审计中 “stub / no-op” 的治理能力最小闭环做真——审批、停止、追加（steer）。

**范围与完成标准**：

- 执行审批闭环：`confirm-before-change` 下 mutating 工具中断 → `<approval_request id>` → 前端审批卡 → 批准后 `approved_ops` 随下轮一次性放行；审批 id 按稳定身份字段（文件 path / bash command）哈希，避免 LLM 重生成 content 导致重复审批。
- 停止与追加：gateway `interrupt_turn` / `steer_turn` 实装（cancel run + turn_aborted 哨兵 + registry 清理）；前端 queue 模式（运行中输入入队 + 「立即执行」）。
- 提示词配合：confirm-before-change 模式注入说明，抑制冗余 ask_clarification。

**落地提交**：`545b890`、`1c80443`（详见进度记录）。

## 4. 阶段 B：coding 核心能力四件套（✅ 已存档，⏳ 待运行时验收）

**目标**：把 coding 的主链路补齐成「理解 → 计划 → 执行 → 审查 → 交付」闭环。

**范围与完成标准**：

- ① **代码理解**：`repo_map`（目录树，噪声排除、深度 1–8 默认 4、条目 ≤400）+ `dep_map`（import/require 依赖映射，按文件聚合、三级预算截断）+ `search.path_matches` 支持 `{a,b}` 花括号。
- ② **计划批准门**：plan-mode 只读分析 → `present_plan` 提交结构化计划（`<plan_request>`）→ 前端计划卡 → 批准后切 `auto-edit` 并按计划执行。
- ③ **审查 + 安全入主线**：`<delivery_gate>` 提示词让非平凡变更自动派发 `marcus`（审查）/ `sandra`（安全）子代理；`security_scan` 确定性启发式扫描（8 类模式）作为安全第一道。
- ④ **交付**：`present_delivery` 产出 PR 描述 + changelog 条目 → 前端交付卡（复制 PR 描述 / 追加 CHANGELOG）。

**落地提交**：`0452fbb`、`5d9afa1`、`a8b4450`、`76a2ae5`、`5142119`（详见进度记录）。

## 5. 阶段 C：上下文压缩 + 长任务可靠性（🔨 进行中）

**背景**：QiLin 已有完整的 SummarizationMiddleware（自动压缩 + keep 策略 + before_summarization 钩子）；KCoder 侧此前未接线（gateway compact 端点是 stub，运行配置 trigger 为空）。

**提案范围（按优先级）**：

- C1 **上下文压缩接线** ✅ 已实现（待运行时验收）：
  - 自动压缩：运行配置 `summarization.enabled: true`，trigger = 40 条消息，keep = 最近 20 条；
  - 手动压缩：前端「压缩」按钮 = 强制压缩 turn（`configurable.force_compact`），引擎绕过自动阈值压缩；
  - 可见性：引擎压缩时向 custom 流发 `context_compacted` 事件 → gateway 翻译为 `compaction_completed` SSE → 前端 turn 内渲染「上下文已压缩：移除 N 条」提示。
- C2 **SSE / 长任务可靠性** ✅ 已实现（待运行时验收）：registry 按 run 身份清理（`aef79c4` 热修）+ 事件 seq / `Last-Event-ID` 重放 / 最近缓存迟到订阅重放（`e15f03a`），消除「No active turn」残余路径。
- C3 **失败状态如实传递** ✅ 已实现（待运行时验收）：gateway `_translate_tool_message` 按 langgraph `status: "error"` 与 KCoder 沙箱工具 `Error:` 前缀契约标红工具失败（此前 isError 恒为 False，失败显示为成功）；前端 isError 链路（turnReducer → ToolOutput 红字）此前已就绪。

## 6. 阶段 D：技能与场景完善（🔨 提案，待确认）

**背景**：C 阶段完成，主线只剩「场景完善」。以下条目按优先级细化，确认后开工。

- D1 **技能在 coding 闭环中的深接**：
  - 任务开始时基于 repo_map/dep_map + 用户意图**自动推荐相关技能**（describe_skill 检查已有，补「开工即检查」的提示词强化 + 命中技能名注入）；
  - **自定义技能安装后即时可用**验证链（安装 → 扫描热生效 → skill-first 可用，不重启引擎）；
  - 技能产物（SKILL.md/脚本）与 repo_map/dep_map/security_scan 的配合说明。
- D2 **错误自愈**：
  - 沙箱工具「Error:」失败后的**自动重试/降级**策略：同参数重试一次（瞬态失败）→ 换路径提示（模型自纠已在 loop-detection 层）→ 失败汇总进交付卡；
  - `run_tests` 失败时自动读错误输出重跑的红绿循环强化（<verification> 已有文字要求，补「失败必须读输出再改」的强制提示）。
- D3 **交付增强**：
  - changelog **条目去重**（同标题已有则不重复追加）；
  - PR 描述模板化（场景/变更/测试/审查固定结构）；
  - 分支创建 + 推送（可选，涉及远程 git 操作，默认关闭，需确认）。

**确认项**：D1/D2/D3 是否全部纳入；D3 的「推送」是否开启。

## 7. 验收与验证纪律

1. **引擎侧**：`py_compile` + `get_available_tools` 注册表冒烟 + 提示词渲染断言 + 真实仓库跑新工具。
2. **前端侧**：`pnpm run typecheck` 通过；正则/解析逻辑用 node 单测真实引擎输出样例。
3. **用户运行时验收**：重启引擎（langgraph dev）+ 前端，走一遍对应场景，`logs/kcoder-debug.log` grep 关键字。
4. 未通过运行时验收的里程碑，在进度记录中保持 ⏳，不得标记完成。

## 8. 与审计报告路线图的关系

| 审计路线图（kcoder-completion-audit-report.md §13） | 与主线关系 |
|---|---|
| 阶段一 安全止血（key 轮换、路径 allowlist、强制认证、runtime token） | 关联长线，**不在主线内**；其中「真实 key 仍在 config.yaml」每轮提醒 |
| 阶段二 统一数据与配置模型 | 关联长线 |
| 阶段三 可靠运行时（SSE 重放、竞态、失败状态） | **部分并入主线 C**（C2/C3） |
| 阶段四 可交付运行时（打包） | 关联长线，范围外 |
| 阶段五 产品能力与质量体系 | **主线 A/B 已覆盖其“审批/interrupt/steer”部分**；compact 并入 C1；其余（测试/CI）待定 |
