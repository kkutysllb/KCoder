# 上游 dsh 0.2.0-rc.2 差异分析（引擎内核 + 自研内置插件升级点）

> 分析对象：官方 `deepseek-ai/deepseek-harness` tag **`dsh-v0.2.0-rc.2` = `639ed01539`**（2026-09-29 17:21 +0800，merge PR #5479）
> 对照基线：**`dsh-v0.2.0-rc.1` = `4878cdabd8`**（2026-09-28）——上一轮已完成 KCoder 侧升级（集成分支 `kcoder/0.2.0-rc.1` @ `4cbc050fc7`，宿主侧已全部落地）
> 本文与 [upstream-0.2.0-rc.1-analysis.md](upstream-0.2.0-rc.1-analysis.md)（0.1.7-rc.2 → 0.2.0-rc.1）构成同一次 KCoder 发版（**v0.6.19，一次锚定两个上游版本**）的两段差异分析。
> 本文档为**只读分析**，未改动任何仓库代码；结论均可由 §8 命令复现。

---

## 0. 结论卡（TL;DR）

**区间规模**：187 提交 / 1022 文件 / +33253 −6141。变更集中在**桌面端 dsh 命令管理**（apps/desktop +2770）、**异步问答三件套**（ui-user-questions +3224 / interaction +1735 / tool-ask-user +668）、**Windows 沙箱单次修复**（+1007/−837）、**模型选择器搜索**、**PowerShell 完成识别**、**pi-ai 0.87.1 对齐**。

### 🔴 最重要发现：dev 实例启动卡死的根因已实锤（并给出解法）

用户 `pnpm dev` 卡在技能注册之后、ready 行之前——**这不是 bug，是版本落差的必然结果，且机制已被双盲实验证实**：

```
引擎 0.2.0-rc.2 ──兼容闸门──► dsh-schedule / dsh-time-context@0.2.0-rc.1 被禁
（peer 精确钉 "0.2.0-rc.1"）      │
                                  ▼
        dsh-client-ui-schedule@0.2.0-rc.1 不被禁（peer 只有 cordis ~4.0.4）
                                  │  mount 后注入 remote.schedule → 服务方已被禁 → 永不结算
                                  ▼
        Loader 树永不 settle → web-app 的 loader.await() 永不返回 → ready 行永不打印
                                  ▼
        KCoder 宿主 READY_LINE_RE 永不匹配 → 60s 超时 → "卡住"
```

**判决性实验**：同一命令追加一个临时 overlay 把 `ui-schedule` 也禁掉，ready 行**立即出现**（`dsh web: http://127.0.0.1:60879/?token=…`）。⇒ 阻塞元凶唯一：`ui-schedule` 等待被禁的 schedule 服务。

**解法（升级动作）**：把 profile 里调度四件套全部平移到 `0.2.0-rc.2`（`@deepseek-ai/dsh-experimental-schedule-bundle` / `dsh-schedule` / `dsh-time-context` / `dsh-client-ui-schedule`——npm 已全部有 `0.2.0-rc.2`，§0.3）。引擎与插件同线后，闸门不禁任何行，Loader 正常结算。

### 0.1 三类必须处理的事

| 级别 | 事项 | 一句话 |
|---|---|---|
| 🔴 **P0** | **调度四件套必须整体平移到 0.2.0-rc.2** | 不平移 = dev/prod 全部卡在启动（机制见上）；且 registry 实测 rc.2 包 peer 精确钉 rc.2，rc.1 残留连 pnpm install 都会 ERESOLVE（§6.4.3） |
| 🔴 **P0** | **集成分支重建 `kcoder/0.2.0-rc.2`** | 偏离面 71 文件 ∩ rc.2 变更 = **24 文件重叠**，其中 13 个是 pi-ai 线（见 §4，规则已定） |
| 🟠 **P1** | **brand-injector 补 `'Deep diving'`（无点）匹配** | rc.2 去（）了 EN 运行态文案的点，我方 rc.1 轮写的精确匹配在无时长态失效（§6.4.5，本区间唯一需改代码的点） |
| 🟠 **P1** | **KCoder 字面量二次平移** | BASELINE、setup.sh、release.sh、dsh-contract 的 `0.2.0-rc.1` → `0.2.0-rc.2`；PRESET 四个 SSH 包 + schedule bundle 同步 |

### 0.2 好消息（不需要动 / 比上一轮更省）

- **两自研插件零改动、零发版**：`>=0.1.7-rc.2 <1.0.0` 口径本就覆盖 rc.2（rc.1 轮 D5 的耐久性兑现）。rc.2 引擎上闸门全过。
- **seam 面零变化**：`docs/capability-seams.md` 两 tag **无 diff**；无新增包（package.json 集合不变）。
- **slot 契约第二次冻结**：`ui-slots`、`ui-deliverables` 不在本区间任何变更列表里。
- **pi-ai 分歧消失**：上游 rc.2 也钉 `^0.87.1`（PR #5445），我方"领先一个版本"的偏离（rc.1 轮的 D6 负担）不复存在。
- **技能 seam / MCP 子系统**：初判再次零变更（子代理复核中，§6）。

### 0.3 npm 侧 rc.2 就绪度（已实查 registry）

`dsh`、`dsh-experimental-schedule-bundle`、`dsh-schedule`、`dsh-time-context`、`dsh-client-ui-schedule`、`dsh-ssh`（含 fs-ssh / subprocess-ssh / sandbox-ssh）、`dsh-otel` —— **全部已有 `0.2.0-rc.2`**（`next` tag；dsh 本体已双标 `latest`+`next`）。

---

## 1. 版本与拓扑

```
官方 upstream/master ──► dsh-v0.2.0-rc.2 (639ed01539) ──► fork 本地 master 已同步（用户操作）
                                                          │
   dsh-v0.2.0-rc.1 (4878cdabd8) ──► 我方 kcoder/0.2.0-rc.1 @ 4cbc050fc7（rc.1 轮成果，已推 origin）
                                       │
                                       └──► 本文比较区间 ──► dsh-v0.2.0-rc.2
```

核验证据：

```bash
git -C /Users/libing/kk_Projects/deepseek-harness log -1 --format='%h %ci %s' dsh-v0.2.0-rc.2
# 639ed01539 2026-09-29 17:21:31 +0800 Merge pull request #5479 …release-dsh-0.2.0-rc.2
git rev-list --count dsh-v0.2.0-rc.1..dsh-v0.2.0-rc.2   # 187
git diff --shortstat dsh-v0.2.0-rc.1 dsh-v0.2.0-rc.2    # 1022 files, +33253 −6141
git diff --name-only dsh-v0.2.0-rc.1 kcoder/0.2.0-rc.1 | wc -l   # 71（我方偏离面）
```

**区间构成**：干线（first-parent）以 merge 为主；`+33253` 的大头是三个新特性面（异步问答三件套 ≈ +5.6k、桌面 dsh 管理 ≈ +2.8k、Windows ACL 重写 ≈ +1.0k）与配套 e2e（apps/web +1522）。

---

## 2. 官方发布说明逐条 → 代码变更点

官方 release（`dsh-v0.2.0-rc.2`，2026-09-29 09:42Z）共 **16 条**（7 新增 / 7 修复 / 2 其他性质）。逐条落点：

### 2.1 新增（7 条）

**①「macOS/Windows 桌面端可在菜单栏中管理和安装 dsh 命令，支持管理插件，无需另装 Node 或 pnpm」** @tianyicui

| 项 | 内容 |
|---|---|
| PR | #5288 `worktree/desktop-cli/manage` |
| 落点 | `apps/desktop`（+2770 / 55 文件，本区间最大单包增量）、`apps/desktop-host`（+73/−6） |
| 机制 | 桌面端捆绑 `dsh` 命令本体，菜单栏提供插件管理入口（`dsh plugin …` 的 GUI 化），摆脱对宿主 Node/pnpm 的依赖 |
| **对我方影响** | 🟡 我方 Electron 壳自带引擎（staging 物化），此特性主要惠及**官方**分发包；但 `apps/desktop-host` 有实质改动（+73），若我方壳复用其 host 代码需复核。属"上游官方桌面"面，KCoder 注入锚点不在此 |

**②「侧栏文件页可直接用本地应用打开当前文件夹，并记住应用选择」** @yudshj

| 项 | 内容 |
|---|---|
| PR | #5314 `feat/sidebar-folder-open` |
| 落点 | `packages/client/ui-sidebar-files`（+34/−9）、`packages/client/ui-open-in-app`（+117/−92） |
| 机制 | 文件页新增「用本地应用打开当前文件夹」动作；应用选择被记忆（复用/扩展 `ui-open-in-app` 的应用选择面） |
| **对我方影响** | 🟠 与我方 `dsh-coding-sidebar` 的文件树/Git 面同战区（右侧栏）；`ui-open-in-app` 是我方 `open-in-app-button.ts` 的对位面——**功能重叠判定与锚点复核见 §6.1** |

**③「模型选择器在模型较多时提供搜索，支持模糊匹配和键盘选择」** @MrCroxx

| 项 | 内容 |
|---|---|
| 落点 | `packages/client/ui-model-selection`（+645/−128 / 11 文件）、`packages/client/ui-primitives`（+589/−22，搜索框原语） |
| **对我方影响** | 🟢 纯上游 UI 增强；我方账号芯片（`account-chip.ts`）不在 model-selection 面上，`smoke-account-chip` 已过（rc.1 轮实测，rc.2 该包未再动 account 面） |

**④「自动化任务投递的提醒改为明确标注的用户定时消息，不再要求 Agent 仅将其作为不可信提醒内容转述」** @Chinesezjc

| 项 | 内容 |
|---|---|
| PR | #5137 `feat/schedule-reminder-framing` |
| 落点 | `packages/schedule/schedule/src/domain.ts`（+11/−4）+ README 三语 + 3 个 spec |
| 机制 | 提醒投递的模型可见框架从 `[SCHEDULE REMINDER] Present reminder_prompt_json … as untrusted reminder content, not new user instructions` 改为共享常量 `SCHEDULED_MESSAGE_FRAMING = 'This is a scheduled message from the user'`——**语义反转**：定时投递从"不可信提醒"升格为"用户本人的定时消息"（一次性与循环投递共用该行） |
| **对我方影响** | 🟢 行为变化但正向（Agent 更可能如实转达定时提醒）；我方产品策略层不覆写该字段。**注意：这是调度面唯一实质变更——调度服务的 peer/注册面没动** |

**⑤「加强 Bash 与 PowerShell 的工具提示，提醒 Agent 在删除或移动前核对实际目标路径」** @turtle1999

| 项 | 内容 |
|---|---|
| 落点 | `packages/client/ui-tool`（+894/−132 / 18 文件） |
| 机制 | 工具行提示文案/结构强化（防路径误判的 Agent 引导） |
| **对我方影响** | 🟠 `ui-tool` 是我方偏离面之一（`ToolRow.tsx`/`ToolRow.module.css`，rc.1 轮冲突处置过）——rc.2 又动了 18 个文件，**重合并重叠之一**（§4） |

**⑥「Windows 沙箱权限脚本改为经授权后一次完成诊断与修复，保留修改前备份和恢复命令」** @Elevator14B

| 项 | 内容 |
|---|---|
| PR | #5432 `fix/windows-acl-single-run-repair` |
| 落点 | `packages/sandbox/sandbox-windows-acl`（+1007/−837 / 10 文件）——**近似重写**：诊断与修复合并为一次授权运行 |
| **对我方影响** | 🟢 Windows 专属技能脚本；我方技能线零依赖（子代理复核 §6.1） |

**⑦「实验性添加异步问答模式，需要手动配置开启：等待超时后 Agent 可继续独立工作，用户仍可稍后回答」** @Magolor

| 项 | 内容 |
|---|---|
| 落点 | **三件套**：`packages/client/ui-user-questions`（+3224/−355 / 22 文件）、`packages/interaction/user-questions`（+1735/−90 / 12 文件，新增 `timed-wait.ts` + `projection.ts`）、`packages/interaction/tool-ask-user`（+668/−56）、`packages/client/ui-commands`（+232/−54） |
| 机制 | Host 侧新增 `TimedQuestionWait`（deadline / parent AbortSignal / 超时业务错误三参；无人应答时按 Host 时钟计时，超时 settle 后 Agent 继续独立工作）；问答状态持久化进 projection（durable question state）。**"手动配置开启"的真身 = 工具调用参数**：`projection.ts:36` `TIMED_WAIT_PARAMETER = 'timeout'`——`ask_user_question` 传 `timeout` 才进入定时等待，缺省维持阻塞语义；插件自身 `Config = z.object({})` 为空，无任何配置键 |
| **对我方影响** | 🟡 实验性、手动开启；对我方 `ask_user_question` 使用方式（本会话即用）无强制变化。配置面为 opt-in，**不影响默认行为**；策略层无需动作 |

### 2.2 修复（7 条）

**⑧「修复新建终端菜单重复列出同名 shell」** @LegGasai → `packages/api/terminal-controller`（+30/−12）。🟢 终端线，§6.3。

**⑨「修复切换会话或返回对话后计划审阅无法打开、『查看全文』消失」** @LegGasai → `packages/client/ui-plan`（+23/−24）。🟢 计划审阅面；我方侧边栏「任务计划」tab 的对位修复，§6.1。

**⑩「修复设置页关闭『显示代码工作视图』后无法调整 Agent 预设」** @lsdsjy → PR #5449 `fix/preset-settings-selection-ungated`；`ui-settings*` / `ui-agent-preset`。🟢 纯上游设置页。

**⑪「修复持久 PowerShell 完成状态后带空格时无法正确识别命令结束、丢失退出码或泄露内部标记」** @turtle2099 → PR #5208 `turtle/pwsh-prompt-path-check`；`packages/shell/tool-pwsh-persistent`（+635/−32 / 9 文件）。🟠 终端就绪判定链（承接 rc.1 的 `promptTailGraceMs`），§6.3。

**⑫「修复 macOS Intel 版桌面端内置 Node 的签名权限（Office 技能命令崩溃）」** @07akioni → `apps/desktop` 构建配置。🟢 官方打包面。

**⑬「修复 macOS/Linux 图形入口启动桌面端时缺少登录 shell 环境的问题」** @lsdsjy → PR #5393 `feat/desktop-login-shell-env`；`apps/desktop` + `apps/desktop-host`。🟡 **对我方有参考价值**：我方 Electron 壳从 Finder/Dock 启动同样可能缺登录 shell 环境（工具路径、代理变量）——上游的修法（登录 shell env 注入）可移植到 KCoder 壳，登记为改进项。

**⑭「更新第三方模型目录与兼容适配至 pi-ai 0.87.1；部分旧模型 ID 被移除，已保存的选择可能需要重新选择」** @tianyicui → PR #5445 `worktree/pi-ai-latest`；`packages/llm/llm-pi-ai`（15 文件 +144/−92）

| 项 | 内容 |
|---|---|
| **对我方影响** | ✅ **重大利好：D6 分歧消失**。我方 rc.1 集成分支已独立完成 pi-ai 0.85.1→0.87.1（含 drift gate 适配），上游 rc.2 做了同一件事。直接对比（§4.2）：`package.json` 的 pi-ai 声明**逐字相同**（`^0.87.1`）；src 差异是上游在同一工作上的**再精化**（如 `catalog.ts` 的 Mistral gate `satisfies` 子句、字段序调整） |
| ⚠️ 用户可见 | 「部分旧模型 ID 被移除」——我方用户保存的模型选择可能失效需重选（与 rc.1 轮我方升级时的预判一致，写发布说明） |

**⑮⑯（EN 段重复条目）** 官方 body 为中英双语，EN 段 16 行与 CN 7+7 一一对应，无独有条目。

### 2.3 未在发布说明单列但官方 PR 可见的主题

`worktree-perflong`（#5456，长会话性能——落在 `ui-chat`/`ui-sidebar-right` 的过程信息与动画开销优化，与 ⑩ 同条目归并）、`plugin-guide-package-only`（#5435）+ `plugin-upgrade-copy`（#5410，归并入插件引导条目）、`hide-empty-bonus-row`（#5430，空 bonus 行隐藏，小 UI 修）。

---

## 3. 官方发布说明**未提及**的代码变更点

| 路径 | 量级 | 要点 |
|---|---|---|
| `packages/client/ui-sidebar-right` | **+410/−299 / 12 文件** | 右侧栏内部重构（性能线）。**未提及但与侧边栏插件同战区**，§6.1 复核 |
| `packages/extensions/cordis-host-runner` | +369/−23 / 10 文件 | Host runner 扩展面（异步问答的 runner 支撑）；`capability-seams.md` 无 diff ⇒ 无新 seam，属既有 seam 内部实现 |
| `packages/extensions/cordis-client-runner` | +62/−5 | 同上，client 半 |
| `packages/extensions/tool-cordis` | +40/−10 | api-catalog 条目更新（异步问答相关 API 描述） |
| `packages/boot/hmr` | +43/−12 | HMR 面小改 |
| `packages/api/gateway` | +75/−3 | 网关小改 |
| `packages/web`（web-search 等） | 未见大额 | 搜索面本区间安静 |
| `packages/client/ui-workspace` | +51/−12 | 工作区头小改 |
| `packages/llm/llm-pi-ai`（非 #5445 部分） | 见 §4.2 | 与我方 rc.1 升级的重叠精化 |
| **结构性结论** | — | **`docs/capability-seams.md` 零 diff；无新增/删除包；`ui-slots`/`ui-deliverables`/`ui-settings-general` 不在变更集** —— 插件契约面第二次冻结 |

---

## 4. 我方偏离面 × rc.2 = 重合并测算

### 4.1 重叠清单（24 文件）

我方 `kcoder/0.2.0-rc.1` 相对纯 rc.1 偏离 71 文件，与 rc.2 变更集重叠 **24 个**：

| 类别 | 文件数 | 明细 |
|---|---|---|
| **pi-ai 线** | 13 | `llm-pi-ai/package.json`、`src/{catalog,replay,adapter}.ts`（adapter 未在重叠清单但两侧都动）、9 个 test 文件、`patches/@earendil-works__pi-ai@0.87.1.patch` |
| ui-chat 线 | 3 | `apply.ts`、`locale.ts`、`tests/chat-view.client.spec.tsx` |
| ui-tool 线 | 2 | `ToolRow.tsx`、`ToolRow.module.css` |
| ui-plugin-manager | 1 | `locales.ts` |
| 版本戳类 | 4 | `THIRD_PARTY_NOTICES.md`、`api/workspace-controller/package.json`、`host/directory-picker-browse/package.json`、`workspace/workspace/package.json` |
| 工作区杂项 | 1 | `pnpm-lock.yaml`、`pnpm-workspace.yaml`（计 2） |

### 4.2 pi-ai 线的重合并规则（本区间最重要的预处理）

直接对比我方集成分支与上游 rc.2（不经基线）：

| 文件 | 我方 vs rc.2 直接 diff | 定性 |
|---|---|---|
| `llm-pi-ai/package.json` | 仅 `version` 戳（rc.1→rc.2）；**pi-ai 依赖声明逐字相同**（`^0.87.1`） | 自动收敛 |
| `src/catalog.ts` | 73 行 | 同一 drift-gate 工作的**再精化**（Mistral gate `satisfies` 子句、`supportsMidConvoEffort`/`sessionAffinityFormat` 字段序） |
| `src/replay.ts` | 64 行 | 同上性质 |
| `src/adapter.ts` | 238 行 | 上游在 0.87.1 适配上更多改动（模型目录/兼容层） |
| `patches/@earendil-works__pi-ai@0.87.1.patch` | **约 80 行实质差** | 上游版 = 他们自己的基线补丁（流式 parse-once 族）重制到 0.87.1；**我方版 = 同基线 + 三条 relay 修复**（accountId 兜底 / 终止事件容错 / 协议自动降级） |

**重合并决策规则（预定，避免届时争论）**：
- `llm-pi-ai/src/*` 与 `tests/*`：**取上游 rc.2**——他们做的是同一次升级的更新精化，我方 src 侧改动已被包含或被超越；
- `patches/@0.87.1.patch`：**取我方**——relay 三修复只活在补丁文件里，上游版没有；合并后需跑 `pnpm install` 验证补丁干净应用（hunk 行号若漂移需 rebase 补丁）；
- 版本戳类：取上游（rc.2 戳）。

### 4.3 其余重叠的处置

`ui-chat/locale.ts`（rc.2 theirs=6 hunks， ours=3）、`chat-view.client.spec.tsx`（theirs=39）：沿用 rc.1 轮规则——**结构取上游、品牌文案回贴**（19 处 `KCoder` 品牌串的重贴动作与 rc.1 轮相同）。`ToolRow` 两文件、`ui-plugin-manager/locales.ts`：同规则。`ui-chat/apply.ts`：行号不相交预期自动合并，语义复核。

---

## 5. 启动卡点专题（本区间最重要的一节）

### 5.1 现象与复现

`pnpm dev` 卡在 `dsh-animations: 8 runtime skills registered` 之后，无 `dsh web: http://…` ready 行。进程未死：`lsof` 显示 TCP 已 LISTEN（如 `localhost:60363`）。复现命令与完整日志留存（§8）。

### 5.2 根因链（每一环都有证据）

1. **ready 行的发射门**：`packages/bundle/web-app/src/index.ts:250-285`（两 tag 逐字相同）——URL 行是 readiness 信号，"Await Loader settlement first"，`const settled = connectionCtx.get('loader')?.await(); if (settled === undefined) announceReady()`。**Loader 树不结算，行就不打印**。
2. **闸门禁行**：引擎 0.2.0-rc.2 上，`dsh-schedule@0.2.0-rc.1` 与 `dsh-time-context@0.2.0-rc.1` 被兼容闸门禁用（stderr 实录）：peer **精确钉** `"@deepseek-ai/dsh-agent":"0.2.0-rc.1"` 等（精确版本，无范围），semver 对 `0.2.0-rc.2` 必然 false。
3. **ui-schedule 漏网**：`dsh-client-ui-schedule@0.2.0-rc.1` 的 peer **只有** `"@deepseek-ai/cordis": "~4.0.4"`——无任何 `@deepseek-ai/dsh-*` 项，闸门（只查 dsh-* peer）不禁它。它 mount 后注入 `'remote.schedule'`（`src/client/index.ts:77` 的 inject 清单）——服务方已被禁，注入永不满足。
4. **判决性实验**：同一启动命令追加临时 overlay `[{id: ui-schedule, disabled: true}]`，**ready 行立即出现**（`dsh web: http://127.0.0.1:60879/?token=…`）。⇒ 阻塞元凶唯一且充分。

### 5.3 修复动作（进升级计划）

1. **PRESET 钉版平移**：`@deepseek-ai/dsh-experimental-schedule-bundle` → `0.2.0-rc.2`（其依赖 `dsh-schedule`/`dsh-time-context`/`dsh-client-ui-schedule` 在发布包里精确钉同版，装 bundle 即四件套同线）；4 个 `dsh-*-ssh` → `0.2.0-rc.2`。
2. **dev/prod profile 物化**：pnpm 装新版四件套（npm 已就绪 §0.3）。
3. **验证判据**：启动 stderr **无** `disabling profile plugin`，stdout 出现 `dsh web: http://`；`--dump-config` 中 `time-context`/`schedule`/`ui-schedule` 三行在位且无 `disabled`。
4. **通用教训（登记）**：`ui-schedule` 这类"peer 只有 cordis 的客户端行"不会被闸门拦，却会拖死 Loader 结算——**调度家族必须与引擎逐版本同线，不能只看闸门**。rc.3/0.2.0 正式版跟进时同样适用。

### 5.4 对 rc.1 轮结论的修正

rc.1 轮分析文说"闸门禁行 ⇒ 功能静默消失，不崩"——rc.2 的现场证明：**当被禁行是服务方、而其客户端行漏网时，表现从"功能消失"升级为"整个启动挂起"**。比预判更严重，幸有判决性实验闭环。

---

## 6. 自研内置插件升级点

### 6.1 技能线（Skills）

**结论：`packages/skill/*` 运行时零代码变更；三资产全部兼容、零适配。**

| 断言 | 证据 |
|---|---|
| 6 个技能包逐 blob 对比 | 仅 `package.json` 的 version 行（rc.1→rc.2）；全部 `src/` 树 blob 哈希**完全一致** |
| Seam 未动 | `skill/src/index.ts:94`（`ctx.skills.register()` 契约）、`:328-336`（registerProvider 语义）、`:700`（runtime `rank: RUNTIME_RANK`）；rank 常量 `:25` =250 / `:28` =600 不变；front-matter 解析不变 |
| ⑭ Windows ACL 单次修复（PR #5432，11 提交） | 改动**全部在资产层**：`SKILL.md`（61 行重写，单命令 `-Path -AllowRoot -Out` + `details.nextAction` 三值表）、`diagnose-*.ps1`（539 行重写，一次运行完成诊断+修复+`acl-backup-*.json`/独立恢复脚本）；**`src/acl-skill.ts` 注册代码零变更**（mkdtemp 拷贝 + registerProvider 路径原样） |
| ⑥ macOS Intel 签名（PR #5408） | 纯打包脚本：`apps/desktop/scripts/node-x64-entitlements.plist` +3 行、`macos-runtime.ts:27` 加 arch 参数——与技能引擎无关 |

**我方资产判定**：`bundle/dsh-skills-bundle`（`ctx.skills.register` 契约逐字段未变）→ **兼容**；`desktop/main/{kcoder-skills-bundle,skills-catalog,skills-settings}.ts`（物化链 / rank 约定 100/200/400/500 / 设置对话框结构）→ **兼容**。⑭ 是上游自带 skill，我方不 fork 不引用——**无影响**（若未来文档引用其用法，参数已改为 `-Path -AllowRoot -Out`）。

### 6.2 MCP 线

**结论：确证「零代码变更」。**

- `packages/mcp` 逐 blob 对比：仅 2 个 blob 差异 = 两个 `package.json` 的 version 字符串；**全部 src/types/tests blob 一致**；区间内该目录仅 1 个提交（release bump）
- `vendor/include/src/index.ts` 两 tag **同一 blob**（`ee4dd53f`，343 行）——补丁语义（含「id 不存在 → warn 后跳过」）字节级零变更
- 官方 16 条无 MCP 条目 ↔ 代码证据一致
- **快照漂移的真相**：`snapshots/session/*mcp*` 的 diff 全部只是 bash 工具 description 文本变化（§6.3 的 tool-bash 安全句）渗透进 MCP 测试快照，**不是 MCP 代码变更**

**我方资产判定**：`desktop/main/{mcp-builtin,mcp-settings,mcp-store}.ts` → **无影响**（依赖面 node 内建 + 本地模块 + yaml；mcp-client 插件与配置 schema 零变更）。

### 6.3 终端线

**② 同名 shell 去重**：唯一落点 `packages/api/terminal-controller/src/shells.ts`——`:25-38` 新增 `executableName()`/`shellKind()`（小写+去 .exe），去重键从全路径改为 executable（保留最早条目）。`remote.terminal.shells` API 形状不变；`ui-sidebar-terminal` 包仅版本号。

**⑤ pwsh 补垫状态行（PR #5208）**：`tool-pwsh-persistent/src/index.ts:112` 完成态正则 `/^(\d+)\r?\n/` → `/^(\d+) *\r?\n/`（容忍状态数字后的空格补垫）——修 conhost 补垫导致命令结束不识别/丢退出码/标记外泄。

**就绪判定层梯在 rc.2 的真实变化 = 无（且有回摆）**：`terminal-bash`（bash/pwsh 共用就绪层）**src 零变更**；rc.1 加的 `promptTailGraceMs: 5000` 在 rc.2 的自托管 lane 测试里**被撤回默认 0**（`loader-composition.spec.ts:108→131`）——非零值把 3.3s 回摆拖长到 8.3s 且误报慢通过。产品默认仍 0。

**我方 `disabled: ui-sidebar-terminal` 前提——rc.2 仍成立**：`packages/api/remotes/src/client/index.ts:28` 仍静态 import terminal remote、`:186` 仍在无条件 `$mount` 清单（该文件 rc.2 唯一实质变更是新增 `userQuestionsRemote`，与终端无关）；web-app 的 `ui-sidebar-terminal` 行无 disabled 条件、结构未变。

**我方资产判定**：`dsh-terminal` 1.1.1 **完全自包含**（自有 `$SHELL`/passwd 探测 + 自有 RPC `/dsh-terminal/api/*`），**不消费** `remote.terminal`/`discoverShells` → ②⑤ 均触不到，**无影响**；`dsh-shell-prefs`（locale/theme 桥）→ **无影响**。

### 6.4 侧边栏 + 文件审查线

**结论：slot 契约零破坏（第二次冻结的实证）；两插件无契约阻断；但 brand-injector 有一处文案断链需小改。**

#### 6.4.1 slot 契约与锚点

| 断言 | 证据 |
|---|---|
| `ui-slots/src` 两 tag tree SHA **完全相同** | `cce09249d61824300c6525a681a4cabcfdd83aac`（与 rc.1 轮记录的 SHA 一致——三个 tag 同一值） |
| `ui-chat/src/client/contract/slots.ts` blob 相同 | `5c7a8e37…`；整个 `contract/` 目录 diff 为空 |
| 四锚点全部存活 | `data-slot` 19/19（发射点 `scoped-slots.tsx:1088` 未变）、`settings.section` 30/30、`conversation.chat.turnTail` 20/20、`deliverables.file.actions` 12/12 |
| 改动审查面 | `ui-deliverables`/`api/workspace-files`/`workspace-changes` 的 src **全部未动**（仅 3 个 css 各 2 行：radius/color 变量），交付卡与变更审查语义零变化 |
| `_options` 家族（settings-page / about-settings / home-migration / skills-settings 四个注入页共用） | `SettingsRoot.tsx:70` role=dialog、`:99` `css.options`、`:100` 直接子 `renderSlot('settings.section')`、`:93` `css.close`；module.css:228/`:209`——**全部存活** |

#### 6.4.2 ⑨ 文件夹本地打开（PR #5314）与我方的交叠

- **新 slot**：`sidebar.right.tab.files.actions`（list / session / owner 只读 `absolutePath`），声明于 `ui-sidebar-files/src/client/index.ts:31-41`，渲染于文件树头部 reload 之后（`FilesBody.tsx:217-219`）
- **不新增服务**：`ui-open-in-app` 把同一个 `OpenInAppAction` 同时注册到会话头与新文件树 slot，**共享同一 controller**（launch/busy/choice）；打开走既有 `session.openWorkspacePath`
- **记住选择**：沿用既有持久化键 `dsh.open-in-app.choice`（`controller.ts:29`），会话头与文件树共享
- **与我方交叠：无**。按钮在上游原生文件树头部；我方压制原生侧栏时该按钮不可见；我方 `open-in-app-button.ts` 是自有 titlebar 按钮（无上游 DOM 锚）。**若日后放开原生侧栏需视觉验收**（登记）

#### 6.4.3 ⑫ 调度面（npm 实测补强 §5 的结论）

- **registry 实测**（非推断）：`dsh-schedule@0.2.0-rc.2` 的 **13 个引擎 peer 全部精确钉 `0.2.0-rc.2`**；`dsh-time-context@0.2.0-rc.2` 6 个精确 + 依赖 `dsh-util-values: 0.2.0-rc.2`（精确）；`dsh-client-ui-schedule@0.2.0-rc.2` 唯一 peer 是 cordis。发布管线逐包 `pnpm pack` 时 `workspace:*` 替换为精确版本（`scripts/release/pack.ts:29-31`）
- ⇒ **rc.1 版调度包 + rc.2 引擎 = pnpm 直接 ERESOLVE**（比闸门禁行更早失败）——四件套 lockstep 升级是硬前提
- `ui-schedule` 组件面 **src 零改动**（仅版本号）；`time-context` src 同样零改动；schedule 核心唯一改动即 §2.1④ 的 framing 文案
- 我方侧边栏 `ScheduleTaskPreview.tsx` 走 schedule Remote（含 `schedule.history`），形状未变 → 不受 framing 改动影响

#### 6.4.4 两插件逐点判定

| 插件 | 判定 | 依据 |
|---|---|---|
| `dsh-coding-sidebar` 1.0.35 | ✅ **无契约阻断** | 注册 slot 仅 `settings.section`（index.tsx:465）与 `conversation.chat.turnTail`（intercept.tsx:221），两者 rc.2 未变。关键隐藏面：`openpath-intercept.ts:305+/211+` 包装的 `ctx.sidebarRight.openResource/openTab` —— rc.2 `ui-sidebar-right/service.ts` 虽大改（seat 绑定改 report 制），但这两个 controller 原型方法**签名未变**（rc.2 `:322/:332`）→ 包装器继续有效；被移除的导出（`SidebarRightBinding`/`bindService`）我方均未消费 |
| `dsh-file-review-kcoder` 1.0.11 | ✅ **无契约阻断** | 注册的 `conversation.chat.turnTail`、`deliverables.file.actions`、`deliverables.review.file.actions` 三个 slot 声明 rc.2 逐字节未变 |

#### 6.4.5 🔴 brand-injector 文案断链（本区间唯一需改代码的点）

rc.2（提交 `ad008e2ea5`，#5346）改了运行态文案风格：**EN 无时长标签从 `'Deep diving...'` 改为 `'Deep diving'`（去点）**，带时长标签尾部改 ` ···`；ZH `深度求索中` 同步去点（我方 ZH 在 locale 源头已品牌化为 `'KCoder...'`，注入器不处理 ZH，不受影响）。

我方 rc.1 轮写的 `swapTurnStatus`（brand-injector.ts）精确匹配 `text === 'Deep diving...'`：

- ✅ `startsWith('Deep diving for ')` 分支**仍命中**（保留 ` ···` 尾）
- ❌ **无时长态 EN 标签精确匹配失效**（新值无点，永不等于 `'Deep diving...'`）

**修复（升级动作）**：匹配分支改为 `text === 'Deep diving'`（或 `startsWith('Deep diving')` 家族统一处理）。其余锚点（`logoRow`/`brandName`/`railMark`/`headline`/`fish`/`titleGroup`/`previewBadge`/`data-chat-running`/`data-ds-dark-theme`/document.title 拦截）**全部存活**——rc.2 仅移除 brand 按钮外的 Tooltip 包裹，button 本体仍在。

#### 6.4.6 非阻断观察项

- `ui-plan` 的 `openReview` 注入面签名 void→boolean（`PlanCard.tsx:30-33`）——上游内部改动，我方未实现该 inject 面，无需适配
- `conversation.session.header.utilities` 16→15 文件：唯一差异是 `OpenInAppAction` 拆分（occupant 改名），纯重构

---

## 7. 风险清单与升级动作建议（**不改码，仅列项**）

### 7.1 必做（P0）

1. **重建集成分支 `kcoder/0.2.0-rc.2`**：以 `639ed01539` 为基线整支 merge `kcoder/0.2.0-rc.1`（沿用 rc.1 轮验证过的"整支重放"法）。冲突预定规则见 §4.2/§4.3；预期冲突集中在 pi-ai 线 + ui-chat 品牌串。
2. **调度四件套与 4 个 SSH 包钉版平移到 `0.2.0-rc.2`**（P0-启动卡点的解法）。
3. **KCoder 字面量二次平移**：`upstream/BASELINE`（SHA + 追加记录）、`setup.sh`、`release.sh`、`dsh-contract.ts`、`preset-plugins.ts`。
4. **dev profile 重新物化**（rc.2 四件套 + rc.2 SSH），验证 §5.3 判据。

### 7.2 应做（P1）

5. **brand-injector 补 `'Deep diving'`（无点）匹配**（§6.4.5，本区间唯一需改代码的点）：`swapTurnStatus` 的精确匹配分支从 `=== 'Deep diving...'` 扩为同时覆盖 `=== 'Deep diving'`（或改 `startsWith('Deep diving')` 家族统一处理）。
6. **两插件零动作复核**：闸门口径脚本对 `0.2.0-rc.2` 引擎求值（预期全过）；锚点已由 §6.4.5 逐个核验存活——**不重发版**（peer 口径已覆盖）。
7. **`dsh-context` 仍按 B-1 冻结**（dev profile 已被漂移对账自动升到 0.60.0，prod 0.59.2——patch 键重出债务照旧登记）。
8. **发布说明补 rc.2 段**：v0.6.19 现在锚定两个上游版本；补"模型 ID 移除可能需重选"（⑭）与"定时提醒语义升级为用户定时消息"（④）。

### 7.3 建议（P2）

9. **登录 shell 环境移植评估**（⑬）：上游为图形入口启动补登录 shell env（`apps/desktop/src/login-shell-environment.ts` 新增，POSIX：userInfo().shell → /bin/zsh→bash→sh 降级链 + `DSH_DESKTOP_LOGIN_SHELL_TIMEOUT_MS`），KCoder 壳同场景受益（工具路径/代理变量）——独立小项，不阻塞本轮。
10. **把"调度家族必须同线"写进 preset-plugins 注释**（§5.3 教训）。
11. **（若日后放开原生侧栏）视觉验收 ⑨ 的文件树 open-in-app 按钮**（§6.4.2，当前被压制不可见）。

---

## 8. 复现命令清单

```bash
R=/Users/libing/kk_Projects/deepseek-harness   # 只读使用；工作树在 kcoder/0.2.0-rc.1

# 区间与结构
git -C $R rev-list --count dsh-v0.2.0-rc.1..dsh-v0.2.0-rc.2
git -C $R diff --shortstat dsh-v0.2.0-rc.1 dsh-v0.2.0-rc.2
git -C $R diff dsh-v0.2.0-rc.1 dsh-v0.2.0-rc.2 -- docs/capability-seams.md   # 空 = seam 零变化

# 启动卡点复现与判决性实验
export DSH_HOME=~/.kcoder-dev
node --expose-internals $R/apps/cli/lib/bin.js web \
  --patch ~/.kcoder-dev/cordis.patch.kcoder.yml --port 0 --no-open        # 卡住：无 ready 行
printf -- '- id: ui-schedule\n  disabled: true\n' > /tmp/disable-ui-schedule.yml
node --expose-internals $R/apps/cli/lib/bin.js web \
  --patch ~/.kcoder-dev/cordis.patch.kcoder.yml --patch /tmp/disable-ui-schedule.yml \
  --port 0 --no-open                                                      # ready 行立即出现
# stderr 里可见：disabling profile plugin row "time-context"/"schedule"（peer 精确钉 0.2.0-rc.1）

# pi-ai 收敛验证
git -C $R show dsh-v0.2.0-rc.2:packages/llm/llm-pi-ai/package.json | grep pi-ai   # ^0.87.1
git -C $R diff kcoder/0.2.0-rc.1 dsh-v0.2.0-rc.2 -- packages/llm/llm-pi-ai | head -40

# 提醒语义（#5137）
git -C $R diff dsh-v0.2.0-rc.1 dsh-v0.2.0-rc.2 -- packages/schedule/schedule/src/domain.ts

# 重叠面
comm -12 <(git -C $R diff --name-only dsh-v0.2.0-rc.1 kcoder/0.2.0-rc.1 | sort) \
          <(git -C $R diff --name-only dsh-v0.2.0-rc.1 dsh-v0.2.0-rc.2 | sort) | wc -l   # 24
```

---

## 9. 遗留与未决

| # | 项 | 状态 |
|---|---|---|
| 1 | ~~异步问答（⑦）的手动开关键名~~ | **已查实**：不是配置键——`projection.ts:36` `TIMED_WAIT_PARAMETER = 'timeout'`，`ask_user_question` 传 `timeout` 参数即启用；插件 `Config = z.object({})` 为空。opt-in 语义对默认行为零影响 |
| 2 | `apps/desktop` +2770 的 dsh 命令管理对我方壳的具体可复用面 | 未展开（官方桌面专属，KCoder 壳独立） |
| 3 | rc.2 之后是否很快出 0.2.0 正式版 | 跟踪 releases；若快，建议直接锚正式版（四件套同线规则不变） |
| 4 | dev profile 的 `dsh-context` 已被漂移对账升到 0.60.0（npm 新版） | B-1 冻结照旧；patch 键债务登记不变 |
| 5 | pi-ai 补丁 hunk 行号在 rc.2 树上是否漂移 | 重合并时 `pnpm install` 实测（若 PATCH_FAILED 则 rebase 补丁） |
