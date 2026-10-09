# dsh 0.2.1-alpha.1 → 0.2.1-alpha.2 差异分析（KCoder 升级第三轮）

> **读者**：执行本轮升级的人（或 AI 会话）。本文是 `docs/upstream-0.2.1-alpha.2-upgrade-plan.md`
> 的事实底座；两文档的关系与举证要求见 `docs/ARCHITECTURE.md` §12 **铁律 3（版本升级总纲）**。
>
> 事实基线：上游 tag `dsh-v0.2.1-alpha.2`（`d743267388641bc76f17c45ce8b4c231aed1d32c`，
> 2026-10-09 17:31 +08:00 发布，prerelease）；fork 集成分支 `kcoder/0.2.1-alpha.2`
> （尖端 `41f151ab20`）；本地克隆 = `/Users/libing/kk_Projects/deepseek-harness`。
> 采集日期：2026-10-09。
>
> **核对状态**：本文所有「待核」已由 [`docs/upstream-0.2.1-alpha.2-verification.md`](upstream-0.2.1-alpha.2-verification.md)
> （铁律 3 首次执行的核对报告）逐条闭合或明确留守；两文档与核对报告须同批维护。
>
> 影响分级：**🔴 需改动**（不改会坏/会静默失效）｜**🟡 需复核**（可能受影响，须给判据）｜
> **🟢 无影响**（已核对）｜**⚪ 已退役/不适用**｜**待核**（未验证，附验证方法）。

## 1. 规模与事实

| 项 | 值 |
|---|---|
| 提交 | 512（非 merge 计数见下） |
| 文件 | 3226 changed |
| 行数 | +114987 / −28177 |
| 我方偏离面 | 61 文件（fork 尖端 vs alpha.1 tag） |
| 偏离面 ∩ 上游改动 | **19 文件**（§9） |
| 集成分支冲突 | **6 处**（§2，已处置） |
| 新增包 | 12：`experimental/{badge-skill-bundle, client-ui-cot-translation, cot-translation-bundle, ralph-bundle, session-search, session-titles-bundle, terminal-bundle, tool-worktree, translator, worktree}`、`session/tool-working-directory`、`ssh/ssh-helper-runtime` |
| 删除包 | 0（`package.json` 级；但**包内目录**有删除，见 §5） |
| 官方发布说明 | GitHub Release 正文：**47 条**（新增 12 / 修复 17 / 体验 6 / 其他变更 12） |
| 官方升级指南 | `docs/upgrade-guide/v0.2.1-alpha.1/`——**本轮新加**（alpha.1 时该目录不存在），**20 个主题**，逐条含 Change + Migration |
| 持久化文档 | 本轮新增 3 篇：`2026-09-13-working-directory`、`2026-09-19-external-subagent-catalog`、`2026-10-05-ptc-operation-metadata` |
| 会话格式版本 | `currentVersion = 4`（**未变**；该包本轮仅 `package.json` 变更）⇒ 无历史会话迁移风险（核对 V2） |

改动最集中的区域（文件数）：`client/ui-chat`(68)、`subagent/subagent`(54)、`experimental/client-ui-cot-translation`(28)、
`client/ui-theme`(27)、`experimental/translator`(23)、`api/session-controller`(23)、`client/ui-primitives`(21)、
`llm/llm-pi-ai`(20)、`fs/tool-fs`(19)、`client/ui-tool`(19)、`experimental/ptc-runtime-python`(16)、
`client/ui-workspace`(15)、`boot/plugin-manager`(13)、`client/ui-conversation`(12)。

提交主题分布（前几位）：`test(web)`16 / `test(plugin)`16 / `fix(subagent)`16 / `fix(web)`15 / `chore(deps)`14 /
`refactor(subagent)`12 / `fix(plugin)`12 —— **subagent 与 plugin-manager 是本轮的两条主改线**。

## 2. 集成分支重放（已完成，记录备查）

`kcoder/0.2.1-alpha.2` = `dsh-v0.2.1-alpha.2` + `merge --no-ff kcoder/0.2.1-alpha.1`；19 处重叠 → **6 处硬冲突**：

| 文件 | 处置 |
|---|---|
| `client/ui-chat/src/client/chat/ChatNodeSeat.tsx` | 上游 props 序 + 保留我方 `editUserMessage` |
| `client/ui-chat/src/client/chat/ChatView.tsx` | **采上游新架构**（`renderSlot('conversation.chat.flow')` → 新组件 `ChatFlow`）；我方「用户消息编辑」重新接线（ChatView 传参 + `ChatFlowOwnerProps` 增字段 + ChatFlow 透传 seatProps） |
| `experimental/ptc-runtime-python/src/index.ts` | 上游新注释 + 我方 `windowsHide: true` |
| `llm/llm-pi-ai/src/adapter.ts` | 上游 watchdog 循环风格 + 我方 opencode session header 与 codex protocol fallback；另拔掉 2 处合并残留 `}` |
| `patches/@earendil-works__pi-ai@1.0.2.patch` | 上游 0.87.1 → **1.0.2** 且自带 patch；以**上游 patch 为基整份重生成**并追加我方 relay 修复（`extractAccountId` 回退） |
| `pnpm-lock.yaml` | 上游锁为基 + `pnpm install --no-frozen-lockfile` 增量（净差 +26/−13）；pi-ai 补丁哈希 `1cc211bc…` → `d3b9a833…` |

**回归证据**：`pnpm install` exit 0（1m6s + 6.4s 两轮）；`pnpm run build` exit 0（357 client artifacts）；
构建同时修复了克隆里 **81/319 包缺 `lib/index.js`** 的半成品态（本轮 `pnpm dev` 起不来的真根因）。

## 3. 官方发布说明逐条 → 代码级落点

> 条目取自 GitHub Release 正文（中英各一份，条目号 = 我按节顺序编的中文序号）。
> 「落点」以 alpha.2 工作树为准；「影响」是**对 KCoder 产品**的影响。

### 3.1 新增功能（12 条）

| # | 条目 | 代码级落点 | 影响 |
|---|---|---|---|
| 1 | 思考过程机器翻译实验插件（Bing/Google/DeepSeek Flash） | 新包 `experimental/translator`(23) + `client-ui-cot-translation`(28) + `cot-translation-bundle` + `ui-slots` +1 行 | 🟢 新可选能力（用户已启用 `cot-translation-bundle`）；我方无对应面 |
| 2 | 全局指令读共享 agents 目录（`DSH_AGENTS_HOME`） | `agent-instructions`（"instruction-home-override" 指南：**移除 `dshHome` 字段**） | 🟡 我方不设该行；用户补丁里若有 `dshHome` 会静默失效（需在发布说明提醒） |
| 3 | `working_directory` 工具 + SDK 读写会话工作目录 | 新包 `session/tool-working-directory`；指南 `working-directory`；持久化文档 `2026-09-13-working-directory` | 🟡 新工具会出现在工具卡；我方 `workspace-probe` 的 cwd 读取面需复核（见 §6） |
| 4 | Git Worktrees 实验插件 | 新包 `experimental/worktree` + `tool-worktree`；进 `OPTIONAL_BUNDLES` | 🟢（用户已启用）；我方无 git 面板（已退役） |
| 5 | Official 列表按需安装 Claude Code / Codex 组合包 | `boot/plugin-manager`(+583)；指南 `native-subagent-bundle-tools` | 🟡 我方 `plugins.ts` 只转发 `dsh plugin`；需复核 CLI 选项位置（#36 与指南 `plugin-option-placement`） |
| 6 | 通用设置新增字体（界面正文 / 代码与工具输出 / 侧栏终端） | `client/ui-theme`(27, +1028/−229)——新设置分区 + CSS 变量面 | 🔴/🟡 我方自绘标题栏/注入 CSS 用的是固定字号与自持 token；新变量体系需复核（尤其 `sidebar-fill` 与字号 token） |
| 7 | 语音输入麦克风选择 + 实时电平 | `experimental/client-ui-voice-input`(21) | 🟢（用户已启用） |
| 8 | Web 绑定指定 IP + `--tls-cert`/`--tls-key` | `apps/cli`(66) + `bundle/web-app`；指南 `web-listener-trust-config`（**监听与信任配置迁入 `webStartup`**） | 🟢 **已核（核对 V4）**：`--host/--port/--no-open/--public-url/--trusted-host/--tls-cert/--tls-key` 全在（`dsh web --help` 实测），我方 spawn 形态不变 |
| 9 | 工作步骤收起时机设置 | `client/ui-chat`(68) 的 presentation/collapse 策略 | 🟢 |
| 10 | pi-ai 按模型能力处理系统提示词更新与工具动态增删 | `llm/llm-pi-ai`(20)；与我方 adapter 偏离面同文件 | 🟡 **已随重放处置**（§2） |
| 11 | 实验性插件 Session 状态记录接口 | `packages/session/*` | 🟢 |
| 12 | SSH 独立可执行 helper 运行时 | 新包 `ssh/ssh-helper-runtime`；指南 `ssh-helper-launch` | 🔴 **`dsh-ssh-remote` 必须适配**（§7） |

### 3.2 问题修复（17 条）

| # | 条目 | 代码级落点 | 影响 |
|---|---|---|---|
| 13 | 流停止且传输不响应取消时仍挂起超时 | `llm-pi-ai` 的 watchdog/teardown（我方冲突区） | 🟡 已随重放合并（采上游 teardown 风格） |
| 14 | 插件包元信息不可读 / 辅助请求扩展准备失败阻断整个 DeepSeek 请求 | `boot/plugin-manager` + `llm` | 🟢 |
| 15 | 凭据/配置/**技能文件监听器**关闭后未捕获异常、Agent 关闭资源提前释放 | `packages/skill/*`（`skill-filesystem` 等）+ 配置/凭据 watcher | 🟡 我方 `dsh-skills-bundle` 自带扫描与注册，需复核关闭路径 |
| 16 | 模型设置刷新期间用旧数据编辑/删除 | `client/ui-settings-models` | 🟢 |
| 17 | Windows 持久 PowerShell 大量输出后不能及时结束 | `subprocess`/shell 线 | 🟢 |
| 18 | Windows 缺 `sleep` 时 Claude Code Mods 示例取消后仍执行工具 | `subagent/subagent-claude-code` | 🟢 |
| 19 | Trajectory 把等待/流式/重试标为完成；压缩提前显示结果 | `client/ui-trajectory`(17) | 🟢 |
| 20 | 后台工作流仍在跑却被标为已中断 | `workflow/*` | 🟢 |
| 21 | 可继续子代理输入栏恢复图片粘贴/拖放 | `client/ui-subagent` | 🟡 与 #38（subagent activations）同线 |
| 22 | `/goal`、`/plan` 高亮命令与参数交界处编辑器报错 | `client/ui-chat` 输入面 | 🟢 |
| 23 | **展开右侧栏后，会话标题栏的后台任务列表被遮挡/裁切** | `client/ui-jobs` + 布局层级 | 🟡 与我方「页头搬进自绘标题栏」强相关：上游改了 jobs 列表的层叠/portal——需复核（§6） |
| 24 | Windows Desktop 图片预览遮罩/关闭钮与标题栏重叠、侧栏按钮悬停圆角 | `apps/desktop` | 🟢（我方自有壳） |
| 25 | DevTools 捕获网络响应时取消后连接不结束 | `client/connection` | 🟢 |
| 26 | SenseVoice VAD 截断开头 | `speech-to-text-sensevoice` | 🟢 |
| 27 | Windows 安装器盘根校验 | `apps/desktop` 打包 | 🟢 |
| 28 | macOS 小尺寸 Finder 图标 / 复制替换对话框图标 | `apps/desktop` 打包 | 🟢（我方自有图标链） |
| 29 | Windows Desktop 终端退出后 PTY worker 未清理 | `packages/terminal`（大改，见 §5） | ⚪ 我方终端已退役 |

### 3.3 体验优化（6 条）

| # | 条目 | 落点 | 影响 |
|---|---|---|---|
| 30 | Shell/插件安装详情横向查看与复制完整命令；后台 Bash 可展开输入与启动回执 | `client/ui-tool`(19)、`client/ui-chat` | 🟢 |
| 31 | 超长源码行预览性能（超长行无高亮） | `client/ui-primitives`(21) | 🟢（我方侧栏已退役，文件预览归上游） |
| 32 | 会话标题生成保留合适标题 | `session-title/*` + 指南两篇 | 🟡 仅当有自研标题 provider（我方无） |
| 33 | 允许远程访问的 Web 用页面内目录选择器 | `host/directory-picker-browse`（**我方偏离面命中此包 package.json**） | 🟡 重放后需复核该包语义 |
| 34 | 侧栏 Fork / 子代理目录新增迁移提示 | `client/ui-workspace`(15)、`ui-subagent` | 🟢 |
| 35 | Python PTC 接入 Session 文件沙箱策略 | `experimental/ptc-runtime-python`（**我方偏离面命中**）+ 指南 | 🔴 我方 `windowsHide` 保留；沙箱新要求见指南 |

### 3.4 其他变更（12 条，破坏性主体）

| # | 条目 | 落点 | 影响 |
|---|---|---|---|
| 36 | 移除工具展示 `both` 混合模式（只留 native/ptc） | `packages/tools` + `agent-tool-presentation`；指南 `tool-presentation-mode` | 🟢 **已核**：`product-policy.ts` / `profiles/` / `bundle/*/cordis.patch.yml` 对 `mode: both` **零命中**（无残留、无需改） |
| 37 | `agent-instructions` 移除逐行 `dshHome` | 指南 `instruction-home-override` | 🟢 **已核**：零残留——命中的 `dshHome()` 是 KCoder 自有的 home 路径助手（`dsh-contract.ts:158`），与 `agent-instructions` 的配置项无关 |
| 38 | 统一子代理执行与完成通知（工具立即返回 child ID） | `subagent/*`(54) + `tool-subagent`；指南 `subagent-activations`；**移除 `subagent-in-process-driver` 包** | 🔴 外部插件：`backgroundMode`/`enableRunInBackground`/`run_in_background` 全失效（本机 `dsh-kylin-automation` 实测命中，§8） |
| 39 | Agent Team 消息直投目标 Inbox（去 outbox/重试/去重） | `experimental/agent-team`；指南 `team-direct-inbox` | 🔴/🟡 我方默认启用 `agent-team-profile`：行为变更 + `maxPendingMessagesPerMember` 键移除；升级前未投递的排队消息**永不投递** |
| 40 | 默认 SDK profile 从编程 Agent 改为通用 AI Agent 身份 | `packages/sdk`(30) | 🟡 仅 SDK/ACP 消费面 |
| 41 | 测试版 Desktop 默认关闭更新网关鉴权弹窗 | `apps/desktop` | 🟢 |
| 42 | 可选插件支持极简模式；Claude Code/Codex 组合包可用于 headless/SDK/ACP | `plugin-manager` | 🟢 |
| 43 | 新增思考正文 Slot + 官方 Markdown Content Factory | `ui-slots`(+1) + `ui-primitives` | 🟡 槽位目录 +1（我方有"槽位只增不减"复核纪律，§6） |
| 44 | 新增本地未签名 macOS DMG 打包 | `apps/desktop` | 🟢 |
| 45 | 新增回环 registry 命令（本地 Official 组合包安装测试） | `plugin-manager` | 🟢 |
| 46 | **pi-ai 更新至 1.0.2** | `patches/@earendil-works__pi-ai@1.0.2.patch` + lock | 🔴 已处置（§2）：上游自带 patch（0.87.1→1.0.2），我方 relay 修复重新并入 |
| 47 | 运行时工具 / MCP 协议 / 图片处理 / 客户端渲染依赖安全更新 | `packages/mcp`(3, 仅依赖与测试) + 各 package.json | 🟡 引擎 MCP 客户端依赖升版；我方 MCP 设置/存储面不涉及协议实现 |

## 4. 官方升级指南逐主题（`docs/upgrade-guide/v0.2.1-alpha.1/`，20 主题）

> 该目录**本轮新增**（alpha.1 时不存在）——即上游为 alpha.1→alpha.2 迁移写的正式指南。
> 每条给出「改动要点」与「我方影响 / 归属」。

| 主题 | 改动要点（摘） | 我方影响 |
|---|---|---|
| `plugin-option-placement` | `dsh plugin` **只认 pnpm 参数之前的 `--profile`**，并有自己的 help | 🟢 **已核**：`plugins.ts:429` 恒以 `dsh plugin --profile web <pnpm args…>` 执行（`--profile` 在 pnpm 参数之前 ✓）；我方不调用 `--help` |
| `tool-presentation-mode` | `mode` 只接受 `native`/`ptc`，`both` 移除 | 🟡 见 #36 |
| `subagent-activations` | 移除 `backgroundMode`/`enableRunInBackground`/`run_in_background`；结果统一为 `{kind:'activation', subagentId}`；移除 `subagent-in-process-driver`；本地子代理可续发消息 | 🔴 外部插件（§8） |
| `team-direct-inbox` | 直投 Inbox；`send_message` 只回 `{sent:true}`；移除 `maxPendingMessagesPerMember`；**升级前未投递的排队消息不投递** | 🔴 我方默认开 agent-team：升级时序必须有「先让排队消息落地」的运维提示 |
| `ssh-helper-launch` | `dsh-ssh` 顶层 `node`/`bootstrapPath`/`bootstrapHash` → `launch`；连接 getter `nodeExecutable`/`bootstrapPath` → `ptcLaunch`；helper 与 `helperHash` 必须与安装的 helper 同批 | 🔴 `dsh-ssh-remote` 插件仓适配 |
| `instruction-home-override` | `agent-instructions` 移除 `dshHome`，统一走 `resolveDshHome()` | 🟡 见 #37 |
| `web-listener-trust-config` | 监听与信任配置迁到 `webStartup` | 🟢 **已核（核对 V4）**：CLI flag 全在，`dsh-manager` 的 spawn 形态不变 |
| `working-directory` | 新工具 + 工具展示迁移 | 🟡 见 #3 |
| `python-ptc-sandbox` | Python PTC 需 `sandbox`+`sandboxPolicy` 服务；受限运行报 `sandbox-unavailable` | 🔴/🟡 我方偏离面含该文件；自定义组合才受影响 |
| `python-optional-resources` | Python 轮子不再内置 Office/作者环境，需显式 `download_office()`/`download_primary_runtime()`；`DSH_RESOURCE_CACHE` | 🟢（我方不使用 Python 运行时） |
| `session-title-adapters` | 标题路由需 `ctx.llm.registerAdapter()`；`reasoning.efforts` 由小到大 | 🟡 我方无自研 provider |
| `session-title-provider-strategy` | 移除三个导出（`registerSessionTitleLlmProvider` 等）；provider 自持 system/输入/解析 | 🟡 同上 |
| `terminal-command-labels` | `TerminalBlockLabels` 需 `commandLine(line)` 格式化器（可聚焦分组命名） | 🟡 仅渲染 `TerminalBlock` 的自研插件受影响 |
| `native-subagent-bundle-tools` | 组合包新增 Host 全局委派工具（行 id `tool-subagent-claude-code`/`tool-subagent-codex`）；移除 `backgroundMode` | 🟡 官方目录安装面 |
| `new-session-generations` | New Session 新建全新 Agent（不再复用空会话） | 🟢 行为变更，随上游 |
| `deepseek-model-discovery` | `deepseek-official` 路由**无凭据即空目录**（设置页隐藏该分组）；畸形凭据会报错 | 🟡 用户可感知：未配 key 时模型组消失（发布说明需提示） |
| `desktop-test-auth-popup` | 测试版默认不弹网关鉴权；`updates.allowTestAuthPopupWindow` | 🟢（我方自有更新链） |
| `mock-messages-events` | mock 服务器输出 SSE 命名事件 | 🟢（测试面） |
| `experimental-package-composition` | 可选能力**显式安装与组合**：CLI/Python 不再带 hook 桥；base/web 预设移除 dormant 行（Ralph/badge）；**安装 ≠ 挂载**，bundle 选中后行才可配 | 🟡 影响「用户以为装了就有」的心智；我方 profile 骨架写 bundles 的语义要复核 |
| `desktop-test-auth-popup`（重复项，上表已列） | — | — |

## 5. 官方**未提及**的结构性变更（本轮新发现）

> 发布说明与指南都没写、但从 diff 与工作树可确证的变化。**这部分是「逐条标记」要求的第二半。**

1. **`OPTIONAL_BUNDLES` 4 → 11**（`packages/boot/app-boot/src/profile.ts`）：新增 badge-skill / cot-translation /
   ralph / session-search / session-titles / terminal-bundle / tool-worktree 七条。KCoder 的
   `UPSTREAM_OPTIONAL_BUNDLES` 是本地镜像，**已同步**（否则用户开启的可选能力会被孤儿清理误删——本机已实证）。
2. **agent 终端工具已「可选化」（✅ 核对确证，见核对报告 V1）**：`packages/terminal/tool-terminal`
   **整包删除**（11 文件），迁为 `packages/experimental/tool-terminal`
   （`src/index.ts:28 export const name = 'tool-terminal'`）；其**唯一挂载点**是可选包
   `experimental/terminal-bundle` 的 `optional-tool-terminal` 行（与 `@deepseek-ai/dsh-terminal`
   注册表、bash/pwsh 行同组）。默认 `web-app` 组合只留 `terminal-controller`（API）与
   `ui-sidebar-terminal`（UI）——**不预选该可选包，agent 就没有终端工具**（而我方终端插件刚退役）
   ⇒ 澄清卡 Q3 升格为必答项。
3. **`packages/skill/skill-badge` 整包删除**（9 文件）→ 新增 `experimental/badge-skill-bundle`：
   徽章技能从核心技能包移到实验组合包。**我方技能包不含该技能**，但 `packages/skill` 其余 16 文件有改动
   （`skill-filesystem`、`skill-office`、`tool-skill` 等）——技能**核心服务面** `skill/src/index.ts` 的 diff 为空（§7 判据）。
4. **`packages/subagent/subagent-in-process-driver` 包移除**（指南提到，但发布说明未列）。
5. **布局第三列类名 `detailsCol` → `rightbarCol`**（`client/ui-layout/src/client/AppFrame.module.css`）；
   新增 `.leadingSeat`、`.bottomRow`。我方 `sidebar-toggle` 以 `[data-rightbar-col]` 为结构锚（仍存在 ✓），
   但 §7 清单里写的是 `detailsCol`——**清单过期，需改**。
6. **`DocumentTitle` 从 `client/web/src` 迁到 `client/ui-layout/src/client/DocumentTitle.tsx`**（README §7 行号/路径过期）。
7. **会话头新增槽位 `conversation.session.header.lineage`**（原有 `.actions`/`.utilities`/`.corner` 仍在）：
   我方 `workspace-header` 搬的是整块页头，故**大概率自动跟随**；但按「槽位清点纪律」需把新注册方列入复核。
8. **就绪行语义变化**：仍是 `dsh web: <url>`，但 URL 现携带鉴权令牌；同文件新增一条
   `dsh web: listening on …` 的**警告行**（绑定非回环 + 明文 HTTP 时打印）。我方
   `READY_LINE_RE = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)(\S*)/` 只认回环 URL ⇒ **不会误吞警告行** ✓（已核）。
9. **`dsh plugin` 的 help 与选项位置语义变化**（指南有、发布说明无）——影响我方 `plugins.ts` 的 CLI 转发与
   「更新」链路（`add <pkg>@<version>` 形态不变 ✓，序不变 ✓）。
10. **`ui-theme` 新增字体体系**（27 文件）：字号/字体 CSS 变量面扩张。我方注入 CSS（自绘标题栏、压制段）
    写死了字号与部分自持常量，**需逐条复核是否被新 token 取代**（§6）。
11. **`plugin-manager` +583**：官方目录（Official）与安装目标、极简模式、回环 registry——**安装语义**
    （安装 ≠ 挂载）成为显式规则（指南 `experimental-package-composition`）。
12. **持久化记录新增三类**（working-directory / external-subagent-catalog / ptc-operation-metadata）；
    **容器格式版本未变**：`session-format-catalog/src/generated.ts` 的 `currentVersion: 4`，
    且该包本轮仅 `package.json` 变更 ⇒ **无历史会话迁移风险**（核对报告 V2）。
13. **`experimental/hook-protocol` 未提及的大改**：19 文件 **+1913 行**，47 条发布说明中没有它，
    仅指南 `experimental-package-composition` 间接提到「CLI / Python 安装面不再带 hook 桥」。
    我方不消费 hooks 组合 ⇒ 🟢，但按铁律 3「未提及的也要说明」在此登记（核对报告 §2）。

## 6. 契约锚点复核（README §7 清单 × alpha.2）

| 锚点 | alpha.2 状态 | 处置 |
|---|---|---|
| 就绪行 `dsh web: http://127.0.0.1:<port>` | 仍在（`bundle/web-app/src/index.ts:281`），带 token；**新增警告行含同前缀** | 🟢 我方正则已安全；文档补一句警告行说明 |
| CLI `web --port 0` | ✅ **flag 齐全**：`--host/--port/--no-open/--public-url/--trusted-host/--tls-cert/--tls-key`（`dsh web --help` 实测） | 🟢 spawn 形态不变（S1.1 关闭） |
| `dsh plugin --profile <name> <pnpm args>` | 语义变化：`--profile` 必须在 pnpm 参数之前 | 🟢 我方调用序正确；补文档 + 冒烟 |
| `dsh.profile.bundles` 层叠 | 仍在；`OPTIONAL_BUNDLES` 扩到 11 | 🟢 已同步镜像 |
| 侧栏 `logoRow` / `collapsed` | 仍在（`SidebarRoot.module.css` / `SidebarRoot.tsx`） | 🟢 |
| 布局列 `sidebarCol` / `centerCol` / ~~`detailsCol`~~ | `sidebarCol`/`centerCol` 在；第三列现名 `rightbarCol` | 🔴 **清单与文档需改** |
| `[data-rightbar-col]` / `[data-sidebar-right-*]` | 仍在（`AppFrame.tsx` / `ExpandButton.tsx`） | 🟢（我方已改作结构锚/探针判据） |
| 主题 `body[data-ds-dark-theme]` + `colorScheme` | 仍在（`ui-theme/src/boot-theme.ts`） | 🟢 |
| `sidebar-fill` token / `html,body,#root{height:100%}` | 均在 | 🟢（字体体系扩张另计，#6） |
| 标题栏文字源 `DocumentTitle` | **迁移**到 `client/ui-layout`；我方改读面包屑（`_crumbCurrent`） | 🟡 文档路径更新；渲染源不变 |
| 会话行 `[role="treeitem"][aria-selected]` + fiber id | 仍在（`ui-workspace/.../Rows.tsx`） | 🟢 |
| 会话头槽 `.actions` / `.utilities` / `.corner` | 均在（`ui-conversation/src/client/apply.ts`）；**新增 `.lineage`** | 🟡 纳入槽位清点 |
| 会话头类名 `titleRow`/`headerActions`/`headerUtilities`/`headerCorner`/`titleCluster` | 均在（`ConversationRoot.module.css`）；`html:not([data-platform='darwin'])` 作用域仍在 | 🟢 |
| `_moreButton`（会话头「…」） | 已核（见下表同名行） | 🟢 判据：`pnpm dev` 后按 `[class*="_moreButton"]` 实测隐藏 |
| RPC `session/list` | ✅ **在**（`packages/api/session-controller/lib/typert.remote-client.d.ts:49`；`typert.host.js:1353` 同 id）；`workspace.list` 早于 alpha.1 已移除 | 🟢 我方 `workspace-probe` 不受影响；**但 README §7 记的 `packages/host/apiproxy` 包已不存在**（现为 `host/webserver`、`api/*`）——该行需重写（S1.3） |
| `_moreButton`（会话头「…」） | ✅ **仍有效**：`session-query/session-log-export/src/client/HeaderAction.tsx:55` `className={css.moreButton}` + `HeaderAction.module.css:2 .moreButton`；该包本轮仅 `package.json` 变更 | 🟢 我方隐藏规则继续命中（留档证据） |
| 协议层 `__DSH_TRANSPORT__.streamBaseUrl` | 仍在（`client/connection/src/client/index.ts`） | 🟢 |
| 聊天面 `[data-chat-running]` | 仍在（`ui-chat/.../RunningStatus.tsx`） | 🟢 |
| `[data-conversation-composer-overlay]` | 仍在（`ui-trajectory/.../TrajectoryView.tsx`）；输入面新增 `[data-composer-overlay]` | 🟢 |
| Node engines | 上游要求 `^22.19.0 || >=24.0.0` | 🟡 我方 `engines.node >=22`；发布/CI 需对齐（判据：`node -v` + setup.sh 断言） |

## 7. 自研内置插件逐项升级点

| 插件（包名/当前版本） | 上游对位与依赖面 | 结论 |
|---|---|---|
| **技能 `dsh-skills-bundle` 1.1.0** | `packages/skill`（25 文件；核心服务 `skill/src/index.ts` **diff 为空**）+ `settings.section` 槽 + 自有 fenced API | **🟢 无需代码改动**。判据：① `packages/skill/skill/src/index.ts` 与 `tool-skill` 的**注册/调用面**逐条比对；② 技能页冒烟（设置分区 + 可选技能开关 + `/技能` 调用）；③ 修复 #15 涉及`skill-filesystem` 监听器关闭——我方不用该包，但需确认引擎侧不再抛未捕获异常 |
| **MCP（宿主 `mcp-builtin`/`mcp-store`/`mcp-settings`）** | `packages/mcp` 仅 `mcp-client` 依赖升版 + `mcp-resources` 测试 | **🟡 仅复核**：引擎 MCP 客户端升版不改变我方配置面。判据：`smoke:mcp-dom`（已过）+ 真机 MCP 服务器启用/工具可见 |
| **`dsh-ssh-remote` 0.1.4** | `packages/ssh`(32) + 新包 `ssh-helper-runtime` + 指南 `ssh-helper-launch` | **🔴 需插件仓适配并发新版本**（铁律 2）：`launch` 取代顶层 `node`/`bootstrapPath`/`bootstrapHash`；连接 getter `nodeExecutable`/`bootstrapPath` → `ptcLaunch`；helper 与 `helperHash` 同批安装。判据：远端主机连接 → 文件读写 → 终端 → PTC 全链路 + `ssh_*` 工具卡。**补充（2026-10-09 核对）**：helper 现由 `@deepseek-ai/dsh-ssh-helper-runtime` 以**发布归档**形态提供（可执行文件 + 嵌入 Node + `manifest.json` 摘要，非 npm 包），上游 workflow 只在 `publish=true` 时挂到对应 release——**alpha.2 release 附件为空**（API 已核），故归档获取路径是适配前置（计划 S2.8）；上游另带两套官方验证器（`scripts/verify-ssh-helper-artifact.ts` / `verify-ssh-helper-ssh.ts`），见计划 S5.8。**2026-10-09 代码级核对的结论修正**：我方链路**不使用** helper 路径（插件只写自己的行；`node`/`helper`/`helperHash` 无值消费者；世界切换 = 在远端跑引擎）⇒ 该破坏性变更对 KCoder **无落点**、无需适配；helper 归档是「远端零依赖」的**机会**，见澄清卡 Q9 |
| **`dsh-shell-prefs` 1.0.1** | `client/locale`(1) + `client/ui-theme`(27) | **🟢 无需改**：`locale.getSnapshot()` 在；`theme.getTheme()/setTheme()/themes` 在（新字体设置不改这两个服务面）。判据：账号菜单切语言/主题实测 |
| ⚪ `dsh-coding-sidebar`（已退役） | 对位 `ui-sidebar-right` 本轮仅 4 行改动 | 不影响（我方已退役） |
| ⚪ `@kkutysllb/dsh-terminal`（已退役） | 对位 `packages/terminal` **大改**（tool-terminal 删除、terminal-bundle 新增） | 不影响（我方已退役）；**但 KCoder 的终端现在完全依赖上游侧栏终端的稳定性**，需在验收里覆盖（字体设置 #6 + 标签指南） |

## 8. 破坏性变更对外部/第三方自研插件的影响

**启动闸门事实**：兼容闸门（`boot/app-boot/src/plugin-compatibility.ts`）与预检文件**本轮 diff 为空** ⇒ 判定口径未变；
本机两个外部插件（`dsh-animations` 1.2.4、`dsh-super-ppts` 1.5.0）peer 为 `>=0.1.0-rc.5 <1.0.0`，**alpha.2 满足**；
且 alpha.2 + 本机 dev profile **实跑启动成功**（就绪行打印，零 FAIL/ERROR，仅一条「等待可选服务」的 pending）。

**逐个体检**（模式：`backgroundMode|enableRunInBackground|run_in_background|registerSessionTitleLlmProvider|generateSessionTitleWithLlm|maxPendingMessagesPerMember|team/message/outbox|dshHome`）：

| 插件 | 命中 | 判定 |
|---|---|---|
| `dsh-kylin-automation`（本机已装） | `src/executor.ts:37` 读 `args['run_in_background'] === true` | **🔴 语义失效**（指南 `subagent-activations` 移除了该模型参数与后台结果形态）→ 需改并重发版；否则该分支永不命中（静默） |
| `dsh-kylin-vibe` | `src/adapter.ts:25` 读 `env['DSH_HOME']` | 🟢 正确用法（与 #37 的 `dshHome` 配置项无关） |
| `dsh-animations` / `dsh-super-ppts` / `dsh-kylin-memory` / `dsh-kylin-images` / `dsh-kylin-srw` / `dsh-kylin-ssh-tunnel` | 无命中 | 🟢 现有证据；**待核**：仍需在真机逐项点开一次（本轮只跑过启动） |
| `dsh-shell-prefs`（我方） | 命中 `dshHome` 仅是注释里的 `__dshHomeMigration` 字样 | 🟢 假阳性 |
| `dsh-coding-sidebar`（已退役） | 命中 `backgroundModel`（图表库） | 🟢 假阳性 + ⚪ 已退役 |

**用户 profile 配置类观察（非升级引入，2026-10-09 真机日志核对）**：

| 现象 | 事实 | 判定 |
|---|---|---|
| 启动日志 `dsh: warning: 1 entry did not activate` + `graphrag-provider-local (dsh-kylin-vibe/provider): pending (waiting for service: graphrag)` | dev profile 的**用户补丁** `~/.kcoder-dev/profiles/web/cordis.patch.yml:172` 只 insert 了 `graphrag-provider-local`（`dsh-kylin-vibe/provider`），而提供 `graphrag` 服务的 **seam 行 `graphrag-seam`（`dsh-kylin-vibe`）没有挂载**——该 bundle **不在** `dsh.profile.bundles` 里，所以插件自带的 `cordis.patch.yml`（seam→provider→rpc→tools 四行）根本没机会生效。插件自身的判据也这么写：`src/provider.ts:996` "seam 未挂载（graphrag 行缺失或未先加载），provider 未注册" | **⚪ 既有配置问题，与 alpha.2 无关**：同一条警告在 **2026-10-01** 的启动日志里已出现（`startup-2026-10-01T21-16-58…log:46`），早于本轮升级 8 天。影响面仅「该插件行永不激活」，不牵连 KCoder 与共享服务。处置见计划 S3.5 |

**「新功能怎么验」核对（2026-10-09 真机，dump-config 级证据）**

发布说明条目的**形态**决定验证方式——不是每条都有 UI 面。以 #4 Git Worktrees 为例：

| 事实 | 证据 |
|---|---|
| 该能力的可见面 = **一个模型工具 `create_worktree`**，无任何面板/开关 | `packages/experimental/tool-worktree/src/index.ts`（`ctx.tools.register(defineTool({ name: 'create_worktree' … }))`）；bundle 只 insert `worktree`（服务）+ `tool-worktree`（工具）两行 |
| 行为：按本地 commit/branch/tag（缺省 HEAD）建分支 + worktree，**并把会话工作目录切进去**；未提交改动留在原 checkout | 工具 description；`packages/experimental/worktree/src/index.ts`（`directory: '.agents/worktrees'`、`namePrefix: 'worktree-'`、`workingDirectory.ensure`） |
| **源码态已挂载** | `DSH_HOME=~/.kcoder-dev dsh --profile web --dump-config` 输出含 `# == @deepseek-ai/dsh-experimental-tool-worktree` 与 `id: worktree`/`id: tool-worktree` 两行 |
| **打包态未挂载** | 同命令 + `DSH_HOME=~/.kcoder`：worktree 命中数 **0**（bundles 未选该包） |
| 验证判据 | 在 **Git 仓库目录**的会话里让 Agent 建 worktree：出现 `create_worktree` 工具卡 + `<repo>/.agents/worktrees/<name>` 落地 + `git worktree list` 多一条 + 会话工作区路径切换 |

**用户 profile 补丁的悬挂项（dump-config 警告，2026-10-09）**

| home | 警告 | 含义/处置 |
|---|---|---|
| dev | `patch: entry "better-sidebar" not found` | 补丁第 90-96 行仍在配置**已退役**的 `dsh-coding-sidebar` ⇒ 退役收尾：删掉该 `id: better-sidebar` 段 |
| dev | `patch: entry "dsh-kylin-memory" not found` | 插件未选为 bundle ⇒ 与 `graphrag-provider-local` 同类（S3.5） |
| packed | `patch: name mismatch for "llm-deepseek" (expected "@deepseek-ai/dsh-llm-deepseek-api-key", got "@deepseek-ai/dsh-llm-deepseek")` | **alpha.2 相关**：上游同时存在 `llm-deepseek`（基础路由）与 `llm-deepseek-api-key`；补丁里两条同 id `llm-deepseek` 的条目（一行 name 为 `…/dsh-llm-deepseek`、一行 `…/dsh-llm-deepseek-api-key`）导致前者被判名不符而 **静默跳过** ⇒ 用户自定义模型清单可能只生效一条。处置：按实际要挂的路由统一 id/name（S3.7） |
| packed | `entry "graphrag-provider-local" / "dsh-kylin-memory" not found` | 打包 home 的同类悬挂项（配置是从别处带过来的） |

**MCP 线真机核对（2026-10-09，进程级证据）**：

| 项 | 事实 | 判定 |
|---|---|---|
| `mcp-fetch` / `mcp-playwright` 是否在跑 | 都在：`uv tool uvx mcp-server-fetch==2026.8.18`（+ 其 python 子进程）与 `npm exec @playwright/mcp@0.0.81 --cdp-endpoint …` 均为独立进程；KCoder 启动入口已做 **PATH 增强**（`index.ts:118` 从 login shell 取 PATH），GUI 启动也能解析 `uvx`/`npx` | 🟢 健康（先前「日志里没看到」只是日志片段不含 MCP 子进程 stdout，怀疑撤销） |
| **源码态 playwright MCP 的端点指向** | dev profile 的 `mcp-playwright` 行**写死** `--cdp-endpoint http://127.0.0.1:9223`，而 `browserHostPort()` 按态分流：打包 9223 / **源码 9224**（`dev-isolation.ts:33-41` 正是为这个坑写的）。实测：`lsof` 9223=KCoder(打包)、9224=Electron(源码)；今天 22:48 随 dev 启动的 playwright 进程命令行指向 **9223** | 🔴（低危但真实）**跨实例串线**：源码态 agent 浏览连到打包态的 Chromium（共享登录态/页面/data dir）。修复见计划 S3.6 |
| 残留进程 | 两个 `npm exec @playwright/mcp@latest`（与两个 profile 都 pin `0.0.81` 不符）⇒ 可能是手工/历史残留 | 🟡 建议清理（非升级相关） |

**还需排查的语义面（未命中扫描但不等于安全）**：`ssh_*`（`ssh-helper-launch`）、`tool-presentation` `both`、
Agent Team 消费方、`TerminalBlock` 渲染方、Python PTC 组合方。**判据**：逐个插件在 alpha.2 下真实启动 +
点开其入口（GUI 由用户实测）。

## 9. 我方偏离面 ∩ 上游改动（19 文件）风险表

| 文件 | 上游改动 | 风险/处置 |
|---|---|---|
| `client/ui-chat/**`（5 文件：apply / ChatNodeSeat / ChatView / contract/slots / locale + 测试） | 68 文件大改（flow 槽架构） | 🔴 已在重放中重构（§2）；**后续任何 ui-chat 上游改动都要先看我方 `editUserMessage` 是否还在链上** |
| `client/ui-deliverables/src/client/index.ts` | 本轮有改动 | 🟡 我方曾改该包（file-review 退役时恢复 tailCard）；重放后需复核 `tailCard` 语义 |
| `client/ui-plugin-manager/src/client/locales.ts` | OZ 改动 | 🟢 冲突已自动合并 |
| `llm/llm-pi-ai/src/adapter.ts` + `tests/convert.spec.ts` | 20 文件 | 🔴 已重放（opencode header + codex fallback + upstream teardown） |
| `experimental/ptc-runtime-python/src/index.ts` | 16 文件 + 沙箱指南 | 🟡 `windowsHide` 保留；沙箱新要求需确认我方组合是否要给 `sandboxPolicy` |
| `host/directory-picker-browse/package.json` | #33 相关 | 🟡 复核依赖/peer 声明 |
| `api/workspace-controller/package.json` + `src/index.ts` + `tsconfig.json` | world 相关 | 🟡 重放已合；`workspace` 世界模型面需回归（远端/多世界） |
| `workspace/workspace/package.json` | 上游本轮有改动 | 🟡 冲突已自动合并（历史上此文件出过硬冲突） |
| `sdk/client/src/client.ts` / `llm/llm/src/index.ts` / `bundle/web-app/src/index.ts` | #40/#10/#8 | 🟡 重放已合，行为面需实测 |
| `.gitignore` / `pnpm-lock.yaml` | 常规 | 🟢 已处置 |

## 10. 结论

- **规模**：中等偏大（3226 文件），但**破坏面高度集中在 subagent / plugin-manager / terminal / skill / ssh / theme 六条线**；
  与 KCoder 直接相关的红线是 **ssh-remote 适配、就绪行/CLI 信任配置复核、字体体系复核、外部插件（kylin-automation）修复**。
- **KCoder 自身**：我方偏离面 61 文件里只有 19 处与上游重叠，且**已全部重放完成**；引擎实跑通过。
- **最大不确定性**（需真机/复核才能定）：layout 类名与新槽位对我方注入器的边角影响、
  `ui-theme` 字体体系对我方写死字号的注入 CSS 的影响、RPC 路由表改动对我方探针的影响、
  会话格式版本是否提升（影响用户历史会话）。
- **待拍板项**见 `docs/upstream-0.2.1-alpha.2-upgrade-plan.md` §澄清卡。
