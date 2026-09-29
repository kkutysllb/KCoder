# 上游 dsh 0.2.0-rc.1 差异分析（引擎内核 + 自研内置插件升级点）

> 分析对象：官方 `deepseek-ai/deepseek-harness` tag **`dsh-v0.2.0-rc.1` = `4878cdabd8`**（2026-09-28 19:48 +0800，release PR #5387）
> 对照基线：我们 KCoder 钉版 **`477b4f4205`**（= tag `dsh-v0.1.7-rc.2`，2026-09-24）
> 本地 fork：`/Users/libing/kk_Projects/deepseek-harness`，`master` 已 ff 到 `upstream/master` = `4878cdabd8`（零自有提交，符合 `docs/fork-workflow` 约定）
> 我方消费态：集成分支 `kcoder/0.1.7-rc.2` @ `3376ee9896`
> 本文档为**只读分析**，未改动任何仓库代码；所有结论均可由 §7 的命令复现。
> **范围**：上游链只有 `deepseek-ai/deepseek-harness`（官方）→ `kkutysllb/deepseek-harness`（fork）→ KCoder。麒麟引擎的迁移属后续远期规划，不在本轮范围。

---

## 0. 结论卡（TL;DR）

**区间规模**：261 提交 / 94 merge / 干线 47 提交（44 个 PR merge + 3 个直推）/ 1109 文件变更。
但 `+20374 / -77957` 的删除量有 **96% 是文档产物**：`docs/persistence-schema.json` 一个文件就占 `-75190`（PR #5191 的类型清单压缩）。真实代码变更集中在 `packages/client`（+5112/-968，312 文件）、`packages/sandbox`（+1817）、`packages/telemetry`（新建 +1237）、`packages/core`（+589）、`apps/web`（+1493）、`apps/desktop`（+782）。

**四类必须处理的东西（按优先级）**

| 级别 | 事项 | 一句话 |
|---|---|---|
| 🔴 **P0** | **两个**自研插件会被上游兼容闸门 **deny** | `dsh-coding-sidebar@1.0.34`（11 条 peer）与 `dsh-file-review-kcoder@1.0.10`（2 条 peer：`dsh-session`、`dsh-api-session-controller` 写了裸 `^0.1.7-alpha.1`）在 `0.2.0-rc.1` 下**全部不命中**（`^0.1.x` desugar 出上界 `<0.2.0-0`，恰好挡掉 prerelease）。上游 `plugin-compatibility.ts:52-82` + `compatibility-preflight.ts:100-116` 命中即 `disabled: true` + stderr 警告 —— **不崩、静默不加载**。详见 §5.3.1 |
| 🔴 **P0** | 调度三行从默认组合中移除 | `time-context` / `schedule` / `ui-schedule` 三行**整行删除**，改由新可选包 `@deepseek-ai/dsh-experimental-schedule-bundle` 插入。我方 `cordis.patch.kcoder.yml` 里那三行 `disabled: false` **变成静默失效**（补丁语义：id 不存在 → warn 后跳过），产品上表现为「定时任务/时间上下文开箱即用」无声消失 |
| 🔴 **P0** | `ui-chat` 面大改 | 上游 4 个文件与我方 hunk 真冲突（`locale.ts` / `chat-view.client.spec.tsx` / `ui-plugin-manager/client/index.ts` / `ui-tool/ToolRow.tsx`），另 5 个 ui-chat 文件需语义性复核 |
| 🟠 **P1** | 会话日志上传新增用户可见开关 | `session-log-deepseek.enabled` 由 `boolean` 变 `Volatile<boolean>` 且 `apply()` 不再早退；新增客户端包 `ui-settings-session-log`（普通设置页开关）。我方「D2 不上传」策略行仍生效，但语义与界面都变了 |
| 🟠 **P1** | 新增两条遥测 seam 与四个新包 | `ctx.otel`、`ctx.productAnalytics`；新包 `otel`、`client-product-analytics`、`ui-settings-session-log`、`experimental/schedule-bundle`。桌面遥测行（`desktop-product-telemetry` / `product-analytics`）以 `profileContext.name === 'desktop'` 为闸，我方 profile 名是 `web` → 仍不会启用（但这是「靠名字巧合」的隔离，需显式决策） |
| 🟡 **P2** | pi-ai 线仍领先上游 | 上游 0.2.0-rc.1 **仍钉 `^0.85.1`**，我方已是 `0.87.1` + 改名补丁 + `patchedDependencies` 换键。升级时必须保留我方版本线，不能被新基线的 0.85.1 覆盖回去 |

**好消息（不需要动）**
- **技能 seam 零变更**：`packages/skill/*` 六个包除 `version` 外逐 blob 相同；`ctx.skills.register/registerProvider`、rank 语义、目录扫描、SKILL.md front-matter 契约全部原样。我方 `dsh-skills-bundle` / `dsh-skills-stock` / `dsh-animations` 零适配。
- **MCP 子系统零代码变更**：`packages/mcp/*` 仅两个 `package.json` 的 version 行。我方内置 MCP 写路径（`desktop/main/mcp-store.ts`）9 项契约全部兼容。
- **会话格式未变**：`docs/session-format-status.md` 两版 diff 为空。
- **plugin-manager 源码零变更**：只有测试与版本戳（PR #5207 里那个「bundle 可整组列行、不给单行开关」的特性**在同 PR 内被 revert**，所以最终落地是「每行各有自己的开关」，与我方认知一致）。
- **上游没碰我方大部分注入锚点**：我方 73 个偏离文件中，只有 18 个上游也改过，其中**行级真冲突仅 4 个**。

---

## 1. 版本与拓扑

```
官方 upstream/master ──ff──► fork master（4878cdabd8 = dsh-v0.2.0-rc.1，零自有提交）✅ 已同步
                                  │
   钉版基线 477b4f4205 (= dsh-v0.1.7-rc.2) ──► KCoder 集成分支 kcoder/0.1.7-rc.2 @ 3376ee9896
                                  │                    （= 基线 + 8 处修复/升级合并）
                                  └──► 本文比较区间 ──► dsh-v0.2.0-rc.1
```

核验证据：

```bash
git -C /Users/libing/kk_Projects/deepseek-harness rev-parse dsh-v0.1.7-rc.2      # 477b4f420553e8a52c2fbccc464d7561b239c443
git -C ... log -1 --format='%H %ci %d' dsh-v0.2.0-rc.1                          # 4878cdabd8 … (tag: dsh-v0.2.0-rc.1, upstream/master, master)
git -C ... merge-base --is-ancestor 477b4f4205 dsh-v0.2.0-rc.1                  # 成立（基线在新区间内）
git -C ... diff --shortstat 477b4f4205 kcoder/0.1.7-rc.2                        # 73 files, +2193 −596（我方继承偏离面）
```

**区间提交构成**

| 项 | 数量 |
|---|---|
| `git rev-list --count dsh-v0.1.7-rc.2..dsh-v0.2.0-rc.1` | 261 |
| `--merges`（含分支内合并） | 94 |
| `--first-parent`（干线） | 47（44 merge + 3 直推） |
| 变更文件 | 1109 |
| 净增删 | +20374 / −77957 |

**删除量的真相（避免误判"上游砍掉七万行"）**

```
docs/persistence-schema.json   +3393 / -75173   ← PR #5191「compact persistence schema type inventory」
docs/（其余）                  +405  / -124
packages/                      +11504 / -2012
apps/                          +2300 / -367
scripts/                       +871  / -45
```
即：`-77957` 中 **75173 行（96.4%）** 是持久化 schema 的类型清单由展开改为引用式，属文档生成物重构，**不影响任何运行时契约**（`docs/session-format-status.md` 无 diff 可佐证）。

---

## 2. 官方发布说明逐条 → 代码变更点

官方 release body（GitHub Releases / `dsh-v0.2.0-rc.1`）共 **19 条**（体验优化 10 / 问题修复 7 / 其他变更 2）。逐条落点如下，每条给出 PR、merge commit、落点文件与机制。

### 2.1 体验优化（10 条）

**①「优化对话进行中和完成状态的实时动画、用时信息、过程信息间距」** @yixiangihsiang, @imccyu

| 项 | 内容 |
|---|---|
| PR / commit | #5226 `78a21f29a9`（packages/client 13 文件）＋ #5346→#5368 `1ae8857842`（packages/client 41 文件 + apps/web 5） |
| 分支提交语义 | `fa3d555cd8 feat(ui-chat): animate a whale tail below the transcript while the Session runs`、`cae515d504 feat(ui-chat): restore the complete running status`、`e9e03abf95 fix(ui-chat): refine running status motion and shimmer`、`ae9a455bfd feat(client): unify process row shimmer`、`aad6053316 style(chat): tighten process row spacing`、`6dd319ad5a test(web): align completed turn spacing` |
| 机制 | 运行中的会话在 transcript 下方渲染"鲸尾"动画；过程行 shimmer 统一为一个 `TextShimmer` 原语；间距收紧 |
| **对我方影响** | 🟠 **直接命中我方偏离最深的文件族**。`ui-chat` 是我方 0007 用户消息编辑补丁 + ToolCallDetail 删除波的落点。本次上游新增 `TextShimmer`（`packages/client/ui-primitives/src/TextShimmer.tsx`），并把 DOM 属性 `data-text-shimmer` **改名为 `data-shimmer`**、新增 `DecorativeCopy` context 与 `contentClassName`、`active` 变可选；`ui-primitives/src/index.ts:62` 新增导出 `pointerModality`。我方 KCoder 仓内对 `data-text-shimmer` 零命中，故无 DOM 依赖断裂；但 `ui-chat` 侧需按新基线重放 |

**②「改善会话在图片失效后自动重传并继续请求的可靠性」** @CreatixChu

| 项 | 内容 |
|---|---|
| PR / commit | #5214 `783569bf73`（packages/llm 10 文件） |
| 分支提交 | `25e235d2c9 fix(llm): remove every stale DeepSeek file mapping in one index update`、`97d9115336 refactor(llm): invalidate stale file mappings with the index generation type` |
| 落点 | `packages/llm/llm-deepseek/src/file-store.ts`、`request-files.ts`、`upload-index.ts`（+4 个 spec） |
| 机制 | 失效的 DeepSeek Files 映射从"逐条清理"改为"一次索引代（generation）整体失效"，避免批量失效只清掉一部分导致重传语义不一致 |
| **对我方影响** | 🟢 无。我方对该路径无偏离（`llm-deepseek` 不在我方 73 文件内）。但它位于 `packages/llm`，与 pi-ai 升级同包树，rebase 时注意版本戳 |

**③「桌面更新提示补全版本、下载和重试说明」** @liyao

| 项 | 内容 |
|---|---|
| PR / commit | #5122 `a6f3d3b91d`（packages/client 20 + **apps/desktop 19** + apps/web 4） |
| 分支提交 | `bcf0ba45cb fix(client): clarify update guidance and unnamed session labels`、`f134ad960c docs(client): sync update guidance and session title catalog`、`5fc3dafa49 fix(desktop): reuse Windows installation copy` |
| 落点 | `apps/desktop/src/locale.ts`（65/65 全量重排）、新增期望文件 `apps/desktop/tests/expected/update-guidance-{en,zh-CN}.json`（各 49 行） |
| **对我方影响** | 🟡 我方 Electron 壳自己有更新提示 UI（`desktop/main/updater.ts`）与品牌注入；上游这套是 Electron 参考实现 `apps/desktop`，不通过 rpc 进入我方。但若我方复用其 locale 键需核对 |

**④「无标题的历史会话统一显示『未命名』，重命名时提供空白输入」** @liyao

| 项 | 内容 |
|---|---|
| PR / commit | 同 #5122 `a6f3d3b91d` |
| 分支提交 | `a4ac7e9eb3 fix(workspace): align unnamed rename entry points and hover actions`、`be5a84ad0b fix(workspace): capitalize Untitled and align title fixtures`、`274bb97e0a test(client): cover unnamed results and versionless update tooltips` |
| 落点 | `packages/client/ui-workspace/src/**`（+95/-35，19 文件） |
| **对我方影响** | 🟢 无偏离（`ui-workspace` 不在我方 73 文件内） |

**⑤「改善插件管理界面、内置插件界面布局及交互，改善安装引导」** @ZiyaZhang, @Yifffan

| PR / commit | 落点 | 分支提交要点 |
|---|---|---|
| #5210 `d70db1ccfd` | `packages/client/ui-settings-plugin-inventory`（+211/-111，8 文件） | `92690a5a3b` 卡片对齐与简化、`e563bb4bbc` card id 与 loading 复核 |
| #5233 `a8fc0b3f16` | `packages/client/ui-plugin-manager` 等 27 client 文件 | 安装交互/加载视觉打磨、注册表键盘选择与焦点反馈、IME 提交防护、保留 registry group |
| #5284 `4bbfa0884f` | client 17 文件 | 插件管理引导文案与警示措辞对齐评审意见、安装示例按钮居中 |
| #5354 `e5587c7ff5` | client 13 文件 | 见 ⑥ |

**⑥「改善深色主题下的开关色彩区分度」** @Yifffan

| 项 | 内容 |
|---|---|
| PR / commit | #5354 `e5587c7ff5`，分支仅一条提交 `9e8db21d2f fix(web): distinguish an off switch from a disabled one in dark mode` |
| **对我方影响** | 🟠 我方 `dsh-coding-sidebar` / `dsh-file-review-kcoder` 大量使用 `--dsw-*` 主题 token 与 `data-state` 选择器；开关类 token 语义变化可能导致我方自绘控件在深色下与上游不一致。建议视觉回归 |

**⑦「改善 Office 与 PDF 预览的文字选区在浅色、深色主题下的清晰度」** @yudshj

| 项 | 内容 |
|---|---|
| PR / commit | #5312 `8be17176fe`（client 8 文件），单提交 `37ffaa52ca fix(client): make Office and PDF text selections visible in both themes`；配套 #5243 `3117268c04`（1 文件）与 #5291 `5f782ebf12`（4 文件）为 Web e2e 稳定性调整 |
| **对我方影响** | 🟢 侧边栏文档/Office 预览由上游 `ui-sidebar-documentpreview` 承担；我方的 `dsh-coding-sidebar` 有独立预览器，需自查 `::selection` 配色 |

**⑧「改善插件配置保存操作的等待时间」** @turtle1999

| 项 | 内容 |
|---|---|
| PR / commit | #5357 `3366973eea`（packages/boot/config-editor 5 文件，+111/-4） |
| 落点 | `packages/boot/config-editor/src/index.ts` |
| 机制（**这是内核级变更，见 §3.4**） | `configuration()` 读配置时，**没有 profile config 覆盖项的条目共用一次组合结果**；有覆盖项的条目单独组合且只摘掉自己的覆盖。新增 `overridden` 集合判定、`composed` 预计算、返回 `structuredClone` 深拷贝；"own config key 即使值为 `undefined` 也能覆盖 inherited config" |
| **对我方影响** | 🟠 我方 `cordis.patch.kcoder.yml` 全部是"整份替换 config"的覆写行，正落在"有覆盖项"分支上，语义等价；但"值为 undefined 也覆盖"是新语义，需核对 `profile-patches.ts` 生成的补丁是否含 undefined 值 |

**⑨「创造模式完善插件开发指引，并提供体验技能」** @turtle1999

| 项 | 内容 |
|---|---|
| PR / commit | #5342 `8665142fd3`（packages/preset 8 文件） |
| 落点 | 新增 `packages/preset/agent-preset/skills/agent-experience/SKILL.md`（19 行）；`.agents/skills/agent-experience/SKILL.md` 由普通文件改为**符号链接**（mode 120000 → `../../../packages/preset/agent-preset/skills/agent-experience/SKILL.md`）防双份漂移；`skills/cordis-plugin-development/SKILL.md` 增 "designing, reviewing" 与 `## Design or review` 段；新增 `references/user-actions.md`；`references/packages.md` +10 |
| 机制 | 技能可见性**没有新增任何机制**——复用既有的 `skill-filesystem` `customSkillDirs` 行（`packages/bundle/web-app/presets/cordis.patch.yml:143-147`），该文件两版间 diff 为空；把文件放进包的 `skills/` 目录即被发现 |
| **对我方影响** | 🔴→ 对技能线是**范式级提示**（见 §5.1）：上游承认「包内自带 skills 目录 + customSkillDirs」是官方做法。我方 `dsh-super-ppts` / `dsh-video-generator` 目前**不注册 skill**，只有包内路径引用，若希望其技能出现在会话技能目录，需要走这条官方路径 |

**⑩「使用 DeepSeek 账号模型的会话无需配置额外 API Key 即可进行网页搜索」** @lsdsjy

| 项 | 内容 |
|---|---|
| PR / commit | #5228 `94a9b4d700`（packages/web 8 文件 + client 4 + docs 4） |
| 分支提交 | `b3c672e4f8 fix(web-search): 账号路由会话的 DeepSeek 搜索使用账号 token 鉴权`、`b38da29517 fix(web-search): 处理账号鉴权评审意见` |
| 落点 | `packages/web/web-search-deepseek/src/index.ts`（+3 行位移，config-catalog 行号 46→49） |
| **对我方影响** | 🟢 我方无偏离。但它是**默认行为变化**：账号模型用户的 web 搜索走账号 token，与 KCoder 的账号体系（`account-chip.ts`、credentials）可能有交互，建议回归一次账号态下的搜索 |

### 2.2 问题修复（7 条）

**⑪「Windows 内置沙箱新增权限诊断技能，可定位部分访问被拒原因，并在限定目录内进行带备份、可恢复的权限修复」** @Elevator14B

| 项 | 内容 |
|---|---|
| PR / commit | #5203 `eb1a903a45`（packages/sandbox 20 文件 + docs 8 + scripts 6 + apps/desktop 1，+1988/-34） |
| 落点 | `packages/sandbox/sandbox-windows-acl/assets/diagnose-windows-sandbox-acl/SKILL.md`（46 行）＋同目录 `scripts/diagnose-windows-sandbox-acl.ps1`（**+721 行**）＋ `src/acl-skill.ts`（76 行）＋ `src/index.ts` 导出 |
| 接线 | `packages/sandbox/sandbox-local/src/index.ts:295-303`：`process.platform === 'win32' && this.runnerCommand === undefined` 时 `ctx.inject(['skills'], ctx => registerAclDiagnosisSkill(ctx))` |
| 机制 | **首次出现「包内自带 skill provider」的官方参考实现**：`acl-skill.ts` 把 asar/SEA 内的资产私有拷贝到 tmpdir（`mkdtempSync` + `writeFileSync flag:'wx' mode:0o600` + async `rm`），再造 `SkillCandidate{source:'bundled', rank:BUNDLED_SKILL_RANK, resourceBase:{kind:'directory'}, locator}`，最后 `ctx.skills.registerProvider(() => provider)` |
| seam 影响 | `docs/capability-seams.md` 新增 `pkg_sandbox_windows_acl --> svc_skills`；`ctx.skills` 的 provider 列表由 3 个变 4 个 |
| **对我方影响** | 🟠 见 §5.1（技能线）与 §3.5（沙箱）；Windows 安装包会多一个技能与一段 PowerShell 资产 |

**⑫「修复工具调度异常后对话无法继续的问题；已执行但结果未知的操作会提示先核实副作用，不盲目重试」** @tianyicui

| 项 | 内容 |
|---|---|
| PR / commit | #4595 `67f648cf0c`（packages/core 13 + snapshots 7 + python 4 + scripts 5） |
| 落点 | `packages/core/agent-loop/src/agent.ts`（+18/-1）、`src/tool-calls.ts`（+6/-6）、`packages/core/session/src/repair.ts`（**+114/-80**） |
| 机制（**内核行为变更**） | 关闭失败步骤前，驱动器为**每个尚无结果的 assistant 工具调用**补记错误结果：已有 `tool/call` 记录但无已提交结果 → `TOOL_OUTCOME_UNKNOWN`（"Its outcome is unknown."，仅允许重试只读/幂等操作，有副作用须先核验外部状态或问用户）；完全无调用记录 → `TOOL_NOT_STARTED`（"The tool call was interrupted before the Harness recorded it as started."）。已提交结果保持完整，已启动的派发先结算再恢复，轮次保留原始失败。语料语：每个恢复结果对模型可见并计入 token，直到被压缩遮蔽；恢复结果追加在既有历史之后，**不破坏 KV Cache 可复用前缀** |
| 已知限制（上游自述） | "Previously closed inconsistent history — failed-step recovery does not rewrite unanswered calls in already-closed historical turns"（不回溯修复已关闭的历史轮） |
| **对我方影响** | 🟢 对我方插件无契约影响；🟠 对产品行为有影响：**历史里会多出合成的工具结果**，任何按"工具调用/结果配对"做统计或渲染的自研面板（文件审查、上下文面板、`dsh-context`）需确认能容忍这两种新结果 |

**⑬「修复桌面端弹窗、菜单和浮动面板避让标题栏，改善小窗口和全屏切换时的内容遮挡及操作问题」** @yudshj

| 项 | 内容 |
|---|---|
| PR / commit | #5268 `447471d34d`（**直推**，非 merge；client 28 + apps/desktop 7 + apps/web 2），+273/-78 |
| 落点 | `packages/client/ui-settings-general/src/client/SettingsRoot.module.css`、浮动面板/菜单的定位与 inset |
| **对我方影响** | 🔴 **CSS 变量改名**：`--dsh-frame-top-clearance` → `--dsh-frame-overlay-top`，`.mask` inset 改为 `var(--dsh-frame-chrome-top, 0px) 0 0`。我方 `desktop/main/sidebar-cluster.ts` / `panel-buttons.ts` / `theme-watcher.ts` 若引用旧变量会静默失效；且我方 Electron 壳自绘状态栏与"标题栏让位"补丁（`titleBarCompat` / `titleBarStripPx`）是同一战区 |

**⑭「修复 Windows 中『在文件资源管理器中打开』或定位文件可能打开隐藏窗口、操作无响应的问题」** @yudshj

| 项 | 内容 |
|---|---|
| PR / commit | #5223 `451e452043`（packages/util 13 + host 3 + api 2） |
| 分支提交 | `989fc3e2f5 refactor(native-command): require explicit window visibility`、`a895066443 fix(windows): keep Explorer path-opening windows visible` |
| 落点 | `packages/util/*`（native-command 语义改为**必须显式声明窗口可见性**）、`packages/host/directory-picker-native/src/native-picker.ts`（3 行） |
| **对我方影响** | 🟠 **API 语义收紧**：任何调用 `native-command` 的地方现在必须显式传窗口可见性。我方 `desktop/main/open-in-app-button.ts`、`workspace-probe.ts` 直接实现打开/定位（不经上游 util），需自查等价路径；若未来复用上游 util 会踩这个必填语义 |

**⑮「修复 macOS 桌面端缺少录音权限、影响麦克风授权的问题」** @LegGasai

| 项 | 内容 |
|---|---|
| PR / commit | #5323 `647a787a99`（apps/desktop 7 文件，+29/-4，含 `worktree/macos-microphone-entitlements`） |
| 落点 | `apps/desktop` 的 Electron entitlements / info.plist 配置 |
| **对我方影响** | 🟡 我方是独立 Electron 壳（`electron-builder.yml`）。若我们要支持语音输入，需要照抄 `NSMicrophoneUsageDescription` 与 entitlements；纯参考 |

**⑯「修复 Safari 在回答输出中刷新页面后无法恢复回复的问题」** @grllll

| 项 | 内容 |
|---|---|
| PR / commit | #4816 `1ca4e2af33`（apps/web 5 + packages/util 4 + tsconfig + workflow/core 各 1） |
| 分支提交 | `068c552b1e fix(session): 兼容 WebKit 原生构造器文本格式`、`9373f74c9c test(web): 补充 WebKit 会话回放回归`、`269768a823 refactor(web): limit Safari fix to session JSON validation` |
| 机制 | WebKit 的原生构造器文本格式与 V8 不同，会话 JSON 校验需兼容 |
| **对我方影响** | 🟢 无偏离；但我方 `packages/...` 侧若在宿主注入脚本里做 JSON 解析，语义一致 |

**⑰「修复部分 Linux 环境在缺少可选原生预构建包时的 npm 安装失败」** @turtle2099

| 项 | 内容 |
|---|---|
| PR / commit | #5327 `5c6427bd76`（packages/subprocess 2 + pnpm-workspace.yaml + pnpm-lock.yaml + 6 包版本戳） |
| 分支提交 | `c6e4c77a12 fix(release): pin Koffi to the validated native dependency`、`cc61979fbb docs(deps): clarify Koffi pin upgrade criteria` |
| 落点 | `pnpm-workspace.yaml:40-46` 的 `allowBuilds` 段新增注释并钉 **Koffi 3.1.1**（理由：Koffi 3.3.2 在 GCC 13 下、缺少可选预构建时源码构建失败；要求所有消费者一起升级） |
| **对我方影响** | 🔴 **与我方 `.pnpm-store` / `materialize-peers.mjs` 的 native 依赖物化直接相关**。我方 `scripts/materialize-peers.mjs` 有"版本盲选"的历史缺陷（BASELINE 记录了 pi-ai 补丁体选错的同类事故）；Koffi 版本钉定变化需要重跑 staging 端到端断言（版本 + 补丁标记 + 目录三查） |

### 2.3 其他变更（2 条）

**⑱「自动化任务改由可选插件包提供」** @Chinesezjc, @ZiyaZhang — **本次升级最危险的一条**

| 项 | 内容 |
|---|---|
| PR / commit | #5179 `cfeb478e03`（69 文件，+623/-88）＋ #5207 `88967ce80a`（52 文件，+249/-190） |
| 新增包 | `packages/experimental/schedule-bundle`（`@deepseek-ai/dsh-experimental-schedule-bundle`，12 文件，+402） |
| 新 bundle 的 patch | `packages/experimental/schedule-bundle/cordis.patch.yml` 用 **`- insert:`** 追加三行：`time-context`(`@deepseek-ai/dsh-time-context`)、`schedule`(`@deepseek-ai/dsh-schedule`)、`ui-schedule`(`@deepseek-ai/dsh-client-ui-schedule`) |
| 从默认组合删除 | `packages/bundle/web-app/cordis.patch.yml` **整段删除**了原本带 `disabled: true` 的这三行；`packages/bundle/web-app/package.json` 同时删除 `dsh-client-ui-schedule` / `dsh-schedule` / `dsh-time-context` 三个依赖 |
| 登记为可选 | `packages/boot/app-boot/src/profile.ts:217` 把包名加入 `OPTIONAL_BUNDLES`；`apps/cli/package.json:42` 加依赖 → 每个安装都随包提供但**默认关闭**，插件管理页在 Official 组提供 |
| 上游自述 | `packages/bundle/web-app/README.zh.md:58`：「随发行版交付的组合不含 `time-context`、`schedule` 和 `ui-schedule` 行，可选实验性 bundle `@deepseek-ai/dsh-experimental-schedule-bundle` 可在插件管理页插入这三行。」 |
| **对我方影响** | 🔴 **P0，详见 §4.4** |

**⑲「调整工作过程展示在不同初始化路径的默认值」** @imccyu

| 项 | 内容 |
|---|---|
| PR / commit | #5204 `80fad723f6`（client 12 + apps/web 9 + snapshots 3） |
| 分支提交 | `b066690f70 fix(web): default fresh work details to detailed`、`a03e63d1e3 fix(ui-chat): map legacy normal work details to detailed`、`47db27a730 fix(ui-chat): resolve work-details defaults in client code`、`682393aede docs(ui-chat): separate display modes from saved preferences` |
| 机制 | 旧值 `normal` 映射到新档 `detailed`；新装的默认档位改为 detailed；展示档位与"已保存偏好"解耦 |
| **对我方影响** | 🟠 我方 `dsh-file-review-kcoder` 的"三层互让"接管了 turnTail 行（`cordis.patch.kcoder.yml` 里 `ui-deliverables.tailCard: false` 那条产品策略），而档位默认值变化会改变 `conversation.chat.turnTail` 上的渲染量 → 需回归 turnTail 三档下的文件审查卡表现 |

---

## 3. 官方发布说明**未提及**的代码变更点

以下变更在 release body 中完全没有出现，但都是内核/契约面的真实变化。

### 3.1 新增两条 capability seam（`docs/capability-seams.md` 为权威真源）

| seam | 类型 | 定义包 | 消费者 | 语义（上游原文摘要） |
|---|---|---|---|---|
| `ctx.otel` | service | `packages/telemetry/otel`（**新包**） | `host-product-telemetry-otel`、`session-telemetry-otel` | "Shared transport provider. Mounting creates no queue, identity, or network connection." 两个方法：`createEventReporter(options)`（计数批处理）与 `createSessionLogReporter(options)`（**按字节**受限的会话日志通道） |
| `ctx.productAnalytics` | service | `packages/client/product-analytics`（**新包**） | — | "Accepts selected Desktop events, enriches available login identity, and observes live compaction under the live Host collection policy." 暴露 `@Remote enabled(): boolean` 与 `@Remote({mode:'stream'}) watchPolicy(signal)` |

对应的 Cordis 工具侧 API 目录也已登记（`packages/extensions/tool-cordis/src/api-catalog.ts`，+91/-5），说明这两个 seam 已对**运行时 Cordis 工具/创造模式**开放。

**同时变化的另一条已有 seam**：`ctx.credentials.getDeviceIdentity()` ——
`abstract getDeviceIdentity(): Promise<{ deviceId?: string; userId?: AccountUserId; osVersion: string }>`，"Read existing login identity without creating a device or returning credentials."

### 3.2 遥测与「会话日志上传」重构（PR #5216 / #5316 / #5337）

**#5216 `779d268199`（79 文件，+1687/-407）「session-log-otel」** —— 分支提交：

- `7b8c7dfff2 feat(telemetry): upload session log events through byte-bounded OTLP`
- `3dd52bfd9b fix(telemetry): own byte-bounded session request scheduling`
- `b97ef29e79 fix(telemetry): await SDK export slot cleanup between requests`
- `9d36f9c1fc refactor(telemetry): share reporting through a Cordis OTel service`

产生新包 `packages/telemetry/otel`（`@deepseek-ai/dsh-otel`，+1237）、`packages/host/product-telemetry-otel/src/index.ts`（+31/-81 重写）、`packages/session/session-telemetry-otel/src/index.ts`（+48/-83 重写）。`docs/config-catalog.md` 记录的新配置面：

- `session-telemetry-otel`：新增 `maxRequestBytes`（"Uncompressed OTLP request byte limit, at most 4,000,000"）；`inject` 由 `sessions` 变 `sessions · otel`；`exporter` 语义改为"显式 SDK HTTP transport 设置，含可选路由头，**不继承环境凭据**"；`shutdownTimeoutMillis` 文档由"pending exports may be lost"改为"Drain deadline; expiry cancels pending exports before disposal completes"
- `packages/bundle/base/cordis.patch.yml`：新增 `- id: otel / name: '@deepseek-ai/dsh-otel'` 行；`session-telemetry-otel` 的 `exporter.url` 生产端点由 `harness-telemetry.deepseeksvc.com` **改为 `dsh-otel-collector.deepseeksvc.com`**；新增 `maxRequestBytes: 4000000`

**#5316 `94c4954780`（40 文件，+541/-72）「desktop-otel-timeouts」** —— 分支提交 `32ade298b5 fix(telemetry): align desktop product reporting timeouts`、`746b9eb753 fix(telemetry): cancel product exports at shutdown deadline`、`2974008e0e fix(preview): isolate desktop telemetry HTTP transport`。

**#5337 `7ded036fdb`（直推，54 文件，+843/-35）「add Session Log upload preference in General settings」** —— **纯新增、发布说明未提**：

- 新客户端包 `packages/client/ui-settings-session-log`（+612，16 文件）：`UploadRow.tsx`、`upload-preference.ts`（`UploadPreference.setEnabled()` 写 Host 配置表单）、locales、`slot-catalog.ts` +2
- `packages/bundle/web-app/cordis.patch.yml` 新增 `- id: ui-settings-session-log / name: '@deepseek-ai/dsh-client-ui-settings-session-log'`
- **`packages/session/session-log-deepseek/src/index.ts` 行为变更**：

```diff
-export const Config: z<Config> = z.object({
-  enabled: z.boolean().default(true),
+export const Config = z.object({
+  enabled: z.boolean().default(true).volatile(),
...
 export function apply(ctx: Context, config: Config): void {
-  if (config.enabled !== true) return
-  const { maxBytes } = config as Required<Config>
+  const { maxBytes } = config
   ctx.deepseekLlmApiExtensions.register('dsh_session_log', {
     prepare: (request) => {
+      if (!config.enabled.get()) return undefined
```

即：**类型由可选变必填**（`enabled: Volatile<boolean>`、`maxBytes: number`），**`apply()` 不再早退**（插件恒加载，启用状态按请求实时读取），配置目录新增 `refs: Volatile`。

> **ⓘ 对我方 D2 决策的影响**：我方 `~/.kcoder/cordis.patch.kcoder.yml` 以整份替换 `config: { enabled: false }` 关掉上传路径 —— **该覆写仍然生效**（`config.enabled.get()` 返回 false）。但两点语义变了：(a) 插件不再"不加载"，而是加载后逐请求判定；(b) 现在有了一个**用户可见的通用设置页开关**（`ui-settings-session-log`），用户可以自己打开上传。这与我方"会话日志不上传"的产品决策口径需要重新对齐（是继续强制关闭，还是允许用户自选）。

> **ⓘ 补充（本轮新查证的机制结论）：若维持"强制关闭"，那个新开关在我方策略下是死控件。** 证据链：
> 1. 我方策略层是 **CLI overlay**：`productPolicyArgs()` → `['--patch', <file>]`（`desktop/main/product-policy.ts:159-162`）
> 2. 上游层级序（`packages/boot/app-boot/src/config-schema/document.ts:159` 的 `$comment` 原文）："Bundle, profile, home, and CLI layers apply in that order. **A patch config replaces the whole config.**"
> 3. `config` 是**整份替换**而非合并：`vendor/include/src/index.ts:120-123` 的 `target[key] = value`
> 4. 用户从设置页写 `enabled: true` 落在 **profile 层**，CLI overlay 在其**之后**把整个 `config` 换回 `{enabled: false}` ⇒ 有效值恒为关
> 5. `Volatile` 的提交条件是"所有**普通**字段的有效值仍一致"（`docs/cordis-tutorial/05-config.zh.md:93`）；候选被 overlay 掩蔽后与原值相等 ⇒ 不提交、不通知
>
> ⇒ 用户点开关"写入成功"却永不生效；UI 还可能显示"已开"而运行时是"关"。**结论：维持强制关闭时，应把 `ui-settings-session-log` 行 `disabled: true`（隐藏该开关）**，否则给用户一个误导性控件。该动作已登记为升级计划的派生决策 D2.1。

### 3.3 桌面产品分析（PR #5136 `2fc10a41c4`，**173 文件，+2359/-167**）

区间内单 PR 最大变更之一，发布说明未提。分支提交（节选）：

- `b1cf871b25 feat(desktop): collect product analytics through OTel`
- `1dc5232999 fix(desktop): isolate analytics and redact installer inputs`
- `9f7ef18c03 refactor(analytics): centralize live policy and message submission context`
- `97b3e97657 fix(desktop): report install confirmation before locking host requests`
- `5d1beb324e refactor(analytics): limit auth events and reuse client version`

落点：`packages/client/product-analytics`（新包）、`packages/credentials/*`（+58/-10，含 `getDeviceIdentity`）、`packages/api/gateway`、`packages/bundle/web-app/cordis.patch.yml`（新增两行）：

```yaml
- id: desktop-product-telemetry
  name: '@deepseek-ai/dsh-host-product-telemetry-otel'
  disabled: !!js "ctx.get('profileContext')?.name !== 'desktop'"
  config: { scheduledDelayMillis: 30000, timeoutMillis: 15000, exportTimeoutMillis: 20000,
            shutdownTimeoutMillis: 2000, serviceName: deepseek-harness-desktop,
            serviceVersion: !!js process.env.DSH_CLIENT_VERSION,
            endpoint: !!js process.env.DSH_PRODUCT_ANALYTICS_OTLP_URL }
- id: product-analytics
  name: '@deepseek-ai/dsh-client-product-analytics'
  disabled: !!js "ctx.get('profileContext')?.name !== 'desktop'"
  config: { enabled: true, appVersion: !!js process.env.DSH_CLIENT_VERSION }
```

> **ⓘ 对我方**：这两行以 `profileContext.name !== 'desktop'` 为闸。**我方 KCoder 桌面壳的 profile 名是 `web`**（见 `cordis.patch.kcoder.yml` 里 `ui-sidebar-browser` 那条注释），所以这两行在 KCoder 上是 disabled ⇒ **不会采集**。但这是"靠 profile 名巧合"的隔离，不是显式关闭。若将来我方把 profile 改名 `desktop`（或上游改成默认 on），遥测会随 `DSH_PRODUCT_ANALYTICS_OTLP_URL` 自动开启。建议像现在的 D2 那样，用显式行覆写把 `product-analytics`/`desktop-product-telemetry` 钉死为 `disabled: true`。

### 3.4 配置层：config-editor 合成语义与性能（PR #5357）

见 §2.1⑧。要点补全：

- 无覆盖项条目共享一次组合（`composeEntries` 只跑一次），有覆盖项条目单独组合
- 判定条件：`patch.insert === undefined && Object.hasOwn(patch, 'config')` —— 注意是 **`hasOwn`（键存在即算覆盖，哪怕值是 undefined）**，这是**新语义**
- 返回值为 `structuredClone`，且"组合结果不跨读取缓存"

### 3.5 沙箱：Windows ACL 诊断（PR #5203）+ 包内 skill provider 范式

见 §2.2⑪。除技能本体外的契约面变化：

- `docs/capability-seams.md`：`sandbox-windows-acl` 现在是 `ctx.skills` 的**服务提供方**（新边 `pkg_sandbox_windows_acl --> svc_skills`，provider 列表 3→4）
- `packages/sandbox/sandbox-windows-acl/package.json`：新增 `"assets"` files 条目、新增 peerDep `@deepseek-ai/dsh-skill`
- `packages/sandbox/sandbox-local/src/index.ts:295-303`：新增 `ctx.inject(['skills'], …)`，注释明确"registry remains optional and may be mounted after this provider"（可后挂，不强依赖）

### 3.6 客户端面的其余真实变更（发布说明未提）

| 路径 | 变更 | 要点 |
|---|---|---|
| `packages/client/ui-settings-account` | +284/-64 / 22 文件 | 账号 UI 随 #5136 扩展（设备信息、事件上报开关语境） |
| `packages/client/ui-settings-models` | +52/-27 / 13 文件 | welcome notice 文案改为 0.2 预览版说明（PR #5356 `5e19099593`：`WelcomeNotice.tsx`、`onboarding-copy.ts`、locale；并新增"必须确认 0.2 预览版说明"） |
| `packages/client/ui-tool` | +21/-19 / 6 文件 | 工具行随之动，`ToolRow.tsx` 与我方真冲突（见 §4.2） |
| `packages/client/ui-theme` | +21/-7 / 5 | 深色开关区分（#5354） |
| `packages/client/ui-sidebar` | +17/-5 / 6 | 侧边栏底座微调；我方 `dsh-coding-sidebar` 是替代实现，注意同一战区的 DOM/CSS |
| `packages/client/ui-schedule` | +26/-10 / 8 | 随调度抽包调整 |
| `packages/client/ui-workflow-run` | +13/-1 / 3 | workflow 运行态 |
| `packages/experimental/webworker-runtime` | +301/-23 / 20 | 新增 `src/client/text-viewer.ts`、`src/node/external_packages/got.ts`、`src/shell/process/xdg-open.ts`；另 PR #5375 `805cb207be`（**直推**）"open config files and load plugin manager in the preview" |
| `packages/extensions/cordis-client-runner` | slot-catalog +5/-2 | slot 目录随新设置页条目更新 |
| `packages/api/*` | +44/-22 / 22 | 多为版本戳；`workspace-controller`/`remotes` 有实质改动 |
| `packages/credentials/*` | +58/-10 / 14 | `getDeviceIdentity()` 新 API（见 §3.1） |
| `packages/host/product-telemetry-otel` | +31/-81（源码） | 改为经 `ctx.otel` 建通道；新增 `shutdown.patch.yml`/`shutdown.ts` 测试夹具 |

### 3.7 发布说明未提的其它 PR（产品影响低，但需知道）

| PR / commit | 内容 | 影响 |
|---|---|---|
| #5310 `4e25074651` | `feat(web): 反馈问卷预填账号、版本与桌面设备信息`（client 14 + desktop 11） | 反馈链路采集设备信息；与我方"不上传"口径相邻 |
| #5224 `719b86f870` | 移除仓库 Figma 链接；`fix(hooks): wait for Windows installer lock access`（hooks 等待 Windows 安装器锁） | Windows 安装期行为 |
| #5206 `cf7c3d9ea5` | 桌面键盘测试折进 client typecheck（删除 `tsconfig.desktop-keyboard-tests.json`） | 构建配置 |
| #5191 `4f9e0e7840` | 持久化 schema 类型清单压缩（`scripts/persistence-schema-model.ts` 新增，`persistence-changes.ts` 改） | 仅文档生成链 |
| #5327 / #5265 / #5232 / #5299 / #5190 / #5239 / #5264 / #5271 / #5292 | 测试/CI 稳定性：Koffi 钉版、plugin-manager Git 子进程隔离宿主命令行配置、lefthook 锁路径、oxlint 契约 spawn 预算、scoped-events 堆预算、web/windows 泳道 flake、seatbelt darwin 对等套件 | 对产品无运行时影响；**注意 `pnpm-workspace.yaml` 的 Koffi 钉版与我方 native 物化链耦合** |
| #5359 `00c179c1da` | 双发行安装布局按图规模判定（CI） | CI |
| #5339 `903bfa55c6` | 任务详情关闭竞态（client 1 + notes 9） | 测试为主 |
| #5277 `ce7718ad6a` | `translate Agent as 智能体 in zh tool copy` | 中文文案；我方若有同文案需保持一致 |

---

## 4. KCoder 侧：偏离面 × 新基线 = 升级冲突测算

### 4.1 我方继承偏离面（`git diff 477b4f4205 kcoder/0.1.7-rc.2`）

**73 文件，+2193/-596**。分类：

| 类型 | 数量 | 文件 |
|---|---|---|
| **A 我方新增** | 8 | `ui-chat/tests/message-icon-actions.client.spec.tsx`、`ui-primitives/src/markdown/modelSanitize.ts` + 其 spec、`host/directory-picker-browse/tests/world.spec.ts`、`llm-pi-ai/tests/codex-fallback.spec.ts`、`llm-pi-ai/tests/opencode-session.spec.ts`、`workspace/workspace/src/world.ts` + 其 spec |
| **R 重命名（相似度 56%）** | 1 | `patches/@earendil-works__pi-ai@0.85.1.patch` → `@0.87.1.patch` |
| **M 修改上游文件** | 64 | 见下 |

**M 类按战区归类**：

| 战区 | 文件数 | 代表文件 | 来源 |
|---|---|---|---|
| pi-ai 0.87.1 升级 | 15 | `llm/llm-pi-ai/src/{adapter,catalog,replay}.ts` + 11 spec、`llm/llm/src/index.ts`、`llm/tests/topology.spec.ts` | fork 提交 `d1a6e58ec3` / merge `3376ee9896` |
| ui-chat 用户消息编辑 + ToolCallDetail 删除 | 10 | `apply.ts`、`chat/ChatView.tsx`、`chat/ChatNodeSeat.tsx`、`chat/MessageItem.tsx`、`chat/MessageIconActions.tsx`、`chat/TurnProcessNodeView.{tsx,module.css}`、`contract/slots.ts`、`locale.ts`、`tests/chat-view.client.spec.tsx` | 补丁 0007 + 删除波 |
| markdown 跨行修复 | 2 | `ui-primitives/src/markdown/parse.ts`（+ 新增 modelSanitize.ts） | 补丁 0001 |
| 远程工作区 / world 解析 | 9 | `workspace/workspace/src/{world,entity,index}.ts`、`host/directory-picker-browse/src/index.ts`、`api/workspace-controller/src/index.ts`、`api/session-controller/src/agent.ts`、`bundle/web-app/src/index.ts`、`sdk/client/src/client.ts` | fork `fix/remote-workspace-world-resolution` 等 |
| Windows 控制台窗口隐藏 | 5 | `subprocess/win32-process/src/{abi,process}.ts`、`subprocess/subprocess-local/src/process-inspector.ts`、`sandbox/sandbox-local/src/index.ts` | fork `fix/win32-console-window-hide` |
| session-projection-cache 隔离 | 5 | `session-projection-cache/src/index.ts` + README 三语 + spec | `upstream-projection-cache-isolate.patch` |
| 我方产品面（tailCard / schedule / plugins 等） | 其余 | `ui-deliverables/src/client/index.ts`（`tailCard` 闸门）、`ui-plugin-manager/src/client/{index,locales}.ts`、`ui-schedule/src/client/index.ts`、`ui-slots/src/index.ts`、`ui-renderer/src/client/registry.ts`、`ui-conversation/.../assembly.ts`、`experimental/ptc-runtime-python/src/index.ts` | KCoder 自有 |

> **`ui-deliverables` 的 `tailCard` 是我方 fork 加的配置字段**（`Config { readonly tailCard?: boolean }`，`apply(ctx, config = {})`），上游 rc.2 与新版的 web-app patch 行都**不带** `config: tailCard`。这不是上游变更，是纯我方偏离 —— rebase 时必须重新带上。

### 4.2 与上游重叠的 18 个文件：4 个真冲突，14 个可自动合并

方法：两侧都基于同一基线（`477b4f4205` == `dsh-v0.1.7-rc.2`），故可比较 `git diff -U0` 的**旧侧行号区间是否相交**。

| 判定 | 文件 | 我方 hunk | 上游 hunk |
|---|---|---|---|
| 🔴 **CONFLICT** | `packages/client/ui-chat/src/client/locale.ts` | 65 90 154 347 | 60 65 90 253 258 283 |
| 🔴 **CONFLICT** | `packages/client/ui-chat/tests/chat-view.client.spec.tsx` | 1622 2206 2274 2456 3206…3315 | 507 1622 1624 2274 2456…4091 |
| 🔴 **CONFLICT** | `packages/client/ui-plugin-manager/src/client/index.ts` | 99 109 137 | 9 23 99 108 |
| 🔴 **CONFLICT** | `packages/client/ui-tool/src/client/tool/components/ToolRow.tsx` | 189 248 | 216 224 235 245 249 |
| 🟢 可自动合并 | `ui-chat/src/client/apply.ts` | 253 | 1 39 148 248 |
| 🟢 | `ui-chat/src/client/chat/ChatView.tsx` | 102 264 | 20 113 271 |
| 🟢 | `ui-chat/src/client/chat/MessageItem.tsx` | 319 335 | 5 110 |
| 🟢 | `ui-chat/src/client/chat/TurnProcessNodeView.module.css` | 51 56 | 26 |
| 🟢 | `ui-chat/src/client/chat/TurnProcessNodeView.tsx` | 51 | 1 5 18 28 30 33 35 |
| 🟢 | `ui-plugin-manager/src/client/locales.ts` | 6 199 | 2 7 12 51 55 58 61 63 72 75 200 205…268 |
| 🟢 | `sandbox/sandbox-local/src/index.ts` | 72 89 110 | 40 297 |
| 🟢 | `THIRD_PARTY_NOTICES.md` | 142 | 59 93 |
| 🟢 | `api/workspace-controller/package.json` | 85 98 | 4 |
| 🟢 | `host/directory-picker-browse/package.json` | 34 37 | 4 |
| 🟢 | `workspace/workspace/package.json` | 40 43 53 56 | 4 |
| 🟢 | `llm/llm-pi-ai/package.json` | 44 | 4 |
| 🟢 | `pnpm-workspace.yaml` | 64 98 | 42 |
| ⚠️ 行号不相交但**必须重新生成** | `pnpm-lock.yaml` | 数十处 | 数十处 |

**注意「可自动合并」≠「语义安全」**：
- `packages/sandbox/sandbox-local/src/index.ts` 是典型正面案例：我方加的是三处 `windowsHide: true`（行 72/89/110），上游加的是 `ctx.inject(['skills'], registerAclDiagnosisSkill)`（行 297），互不干扰
- `pnpm-workspace.yaml` 同理：我方改的是 `minimumReleaseAgeExclude`/`patchedDependencies` 里的 pi-ai 版本（行 64/98），上游在 `allowBuilds` 的 Koffi 处加注释（行 42）
- `ui-chat/src/client/apply.ts` 是灰区案例：我方在 253 行加 `editUserMessage` 接线，上游在 248 行附近改动 —— 行号不相交，但**同一个 apply 函数的注册顺序/依赖注入可能语义冲突**，必须人工复核

### 4.3 高危面：pi-ai 线（我方领先上游一个大版本）

| 维度 | 上游 0.2.0-rc.1 | 我方 kcoder/0.1.7-rc.2 |
|---|---|---|
| `packages/llm/llm-pi-ai/package.json` 依赖 | `"@earendil-works/pi-ai": "^0.85.1"` | `"^0.87.1"` |
| `patches/` | `@earendil-works__pi-ai@0.85.1.patch` | `@earendil-works__pi-ai@0.87.1.patch`（R056 重命名） |
| `pnpm-workspace.yaml` `patchedDependencies` | `'@earendil-works/pi-ai@0.85.1'` | `'@earendil-works/pi-ai@0.87.1'` |
| `minimumReleaseAgeExclude` | 未改 | `pi-ai@0.87.1` / `pi-telemetry@0.87.1` |

**结论**：上游本区间**没有**跟进 pi-ai 升级（`git merge-base --is-ancestor d1a6e58ec3 dsh-v0.2.0-rc.1` → 否）。rebase 到新基线时这条我方线必须整体保留，`patches/` 目录会同时出现 0.85.1（上游）与 0.87.1（我方），需要**删掉 0.85.1 那份**并保持 `patchedDependencies` 换键一致，否则 pnpm 会判 patch unused 静默不应用。

我方 pi-ai 升级的适配面（已在 BASELINE 记录，此处复述为检查清单）：`catalog.ts` 的 4 道 drift gate、`adapter.ts` 的 `TranscriptContext` 归一化、`replay.ts` 的 `parseArguments` 返回 `JsonObject`，以及 `deepseek` 路由型号 `deepseek-v4-flash → deepseek-flash`。

### 4.4 🔴 产品策略层逐行核验：7 行覆写里 **3 行已失效**

我方策略层的物理形态是 `~/.kcoder/cordis.patch.kcoder.yml`（**由 `desktop/main/product-policy.ts` 每次启动按代码重写**：文件名常量 `POLICY_FILENAME` 在 `:30`，调度三行在 `:109-114`，`ui-sidebar-terminal` 在 `:82-83`，`session-log-deepseek` 在 `:74-76`），经 `dsh web --patch <file>` 以 overlay 层载入（序：bundle → profile → home → overlay）。

补丁语义（权威实现 `vendor/include/src/index.ts:104-112`，`@deepseek-ai/cordis-plugin-include` 1.0.9）：

```ts
if (!id) { warn('patch: id is required for non-insert patches'); … }
const target = entryMap.get(id)
if (!target) { warn('patch: entry %C not found', id); … }   // ← 不报错、不插入，直接跳过
```

| 覆写行 id | 0.1.7-rc.2 里所在 bundle | 0.2.0-rc.1 里所在 bundle | 判定 |
|---|---|---|---|
| `session-log-deepseek` | base | base:43（`sdk-minimal` 也有） | ✅ 仍有效 |
| `ui-sidebar-terminal` | web-app | web-app:282 | ✅ 仍有效 |
| `ui-sidebar-browser` | web-app（`!!js profileContext.name !== 'desktop'`） | web-app:278（条件逐字相同） | ✅ 仍有效 |
| `ui-deliverables` | web-app | web-app:334 | ✅ 行还在；但 `config.tailCard` 是**我方 fork 加的字段**，随我方偏离面走 |
| `time-context` | **web-app**（`disabled: true`，我方翻 false） | **【不存在】** | 🔴 **失效**（warn + skip） |
| `schedule` | **web-app** | **【不存在】** | 🔴 **失效** |
| `ui-schedule` | **web-app** | **【不存在】** | 🔴 **失效** |

**后果**：升级后 KCoder 的「定时任务 / 时间上下文开箱即用」产品决策**无声消失** —— 不报错、不崩，只是插件管理页里少三个行、界面上没有任务页。这正是最容易被验收漏掉的形态。

**上游给出的正确路径**（`packages/experimental/schedule-bundle/README.md:38` 原文）：
> `OPTIONAL_BUNDLES` in `packages/boot/app-boot/src/profile.ts` names this package and `apps/cli` depends on it, so every installation ships it switched off and the plugin manager offers it in the Official group. **Selecting it appends the bundle to the profile's `dsh.profile.bundles` list.**

即：把我方 `~/.kcoder/profiles/web/package.json` 的 `dsh.profile.bundles` 加上 `@deepseek-ai/dsh-experimental-schedule-bundle`（并在 `dependencies` 里给出 spec），而不是继续用 id 覆写行。

---

## 5. 自研内置插件升级点

（本节覆盖 4 条线：技能 / MCP / 侧边栏与文件审查 / 终端）

### 5.1 技能线（Skills）

**上游结论：技能 seam 零变更。**

- `packages/skill/` 六个包（`skill` / `skill-badge` / `skill-filesystem` / `skill-office` / `tool-skill` / `tool-workspace-dependencies`）在两个 tag 间**除 `package.json` 的 `version` 外逐 blob 相同**
- 未变清单：服务名 `ctx.skills`（`packages/skill/skill/src/index.ts:390 registerProvider()`、`:439 register()`）、`SkillRegistration` 形状（`:95`）、rank 语义（`:25 RUNTIME_RANK=250`、`:28 BUNDLED_SKILL_RANK=600`、`:78` "Lower ranks win duplicate skill names"，即 project 100/200 < runtime 250 < user 400/500 < bundled 600）、目录扫描规则（`skill-filesystem/src/index.ts:250-258`：`.dsh/skills` / `.agents/skills` / `customSkillDirs` / `$DSH_HOME/skills` / `~/.agents/skills` / `bundledSkillDir`）、SKILL.md front-matter 契约（name+description 必需；可选 `whenToUse`/`invocation`/`metadata`；未知键容忍；仍拒绝 legacy 键 `disableModelInvocation`/`modelInvocable`）
- `plugin-manager`（bundle 安装与清单校验）**零 diff**

**上游本区间的四处真实变化（对我方是范式提示，不是破坏）**

1. **新增官方「包内自带 skill provider」参考实现**：`packages/sandbox/sandbox-windows-acl/src/acl-skill.ts`
   - 手法：asar/SEA 内资产先私有拷贝到 tmpdir（`mkdtempSync` + `writeFileSync flag:'wx' mode:0o600` + `yield async rm`），再构造 `SkillCandidate{source:'bundled', rank:BUNDLED_SKILL_RANK, resourceBase:{kind:'directory'}, locator}`，最后 `ctx.skills.registerProvider(() => provider)`（`:44-75`）
   - 自带一份精简 front-matter 解析（只取 description，`:26-37`）
2. 接线方式为**可选注入**：`sandbox-local/src/index.ts:301-303` 的 `ctx.inject(['skills'], …)`，注释明确 registry 可后挂
3. 打包含资产：`sandbox-windows-acl/package.json` 新增 `"assets"` files 条目与 `@deepseek-ai/dsh-skill` peerDep
4. 前端 `packages/client/ui-skill/src/client/SkillRow.tsx` 改用 `TextShimmer`，删除 `dsh-skill-row-sweep` keyframes；同时 `ui-primitives/TextShimmer` 的 DOM 属性 `data-text-shimmer` **改名 `data-shimmer`**、新增 `DecorativeCopy` context 与 `contentClassName`、`active` 变可选

**我方 6 个技能资产判定**

| 资产 | 依赖的上游契约 | 判定 | 依据 |
|---|---|---|---|
| `bundle/dsh-skills-bundle`（随包） | `ctx.skills.register({name,description,whenToUse?,source:'runtime',content,resourceBase})`；`package.json` 的 `dsh.bundle.patch` | ✅ **兼容，无需改** | `SkillRegistration` 形状与 `register()` 未变；runtime rank 与覆盖语义未变；`dsh.bundle` 校验点未变（`packages/boot/plugin-manager/src/index.ts:127-131`，该包区间内零 diff） |
| `desktop/main/{kcoder-skills-bundle,skills-catalog,skills-settings}.ts` | ① profile `node_modules` 物化 + `dsh.profile.bundles`；② 技能根目录与 rank；③ 可选技能拷到 `$DSH_HOME/skills/<name>`；④ SKILL.md 只解析 name/description | ✅ **兼容，无需改** | 这三个文件**不 import 任何 `@deepseek-ai/*` 运行时 API**（只用 node:fs/path/semver）；`dsh.profile.bundles` 读取点 `plugin-manager/src/index.ts:283` 未变；根目录/rank 与 `skill-filesystem/src/index.ts:250-258` 一致；front-matter 规则未变 |
| `KSkills` | 纯内容源（`coding/ common/ media/ office/ research/`） | ✅ 无影响 | 不含运行时契约，只被适配脚本 `scripts/adapt-kskills.mjs` 消费 |
| `dsh-skills-stock` | `lib/index.js:851-869` 用 `skills.register({…, source:'runtime', resourceBase})`，透传 `metadata:{requiredSecrets}` | ✅ 兼容，无需改 | `metadata` 仍是 `SkillCandidate/SkillDefinition` 合法可选字段（`skill/src/index.ts:76,86`；filesystem 解析 `:1039-1042`） |
| `dsh-animations` | `entry.js:61-70` 同上 `skills.register` + `resourceBase`；另向 systemPrompt 注入能力通告 | ✅ 兼容，无需改 | skill seam 未变；systemPrompt 服务非本次变更面 |
| `dsh-super-ppts` | **不注册 skill**：`skills/` 仅被包内路径引用（`src/paths.ts:14` 包根、`src/tools.ts:45` `skills/ppts-pptx/scripts/render_pptx.py`），技能正文由提示词指路 | ✅ 无 skill 契约面 | `grep -rn "skills.register\|registerProvider\|SKILL.md" src/ scripts/` → 0 命中 |
| `dsh-video-generator` | 同上；**包内没有 `skills/` 目录** | ✅ 无 skill 契约面 | `lib/*.js` 无 `skills.register`/`registerProvider` |

**战略提示（非破坏）**：`dsh-super-ppts` / `dsh-video-generator` 的 `SKILL.md` 若要出现在**会话技能目录**里，唯一官方路径是宿主/组合层的 `skill-filesystem` `customSkillDirs` 挂载（范式见 `packages/bundle/web-app/presets/cordis.patch.yml:143-147`，该文件本区间 diff 为空）。这是我方可以产品化的一条线。

**前端零影响**：KCoder 仓内（排除 node_modules）对 `data-text-shimmer` / `dsh-skill-row-sweep` / `dsh-client-ui-skill` **0 命中**；两个随包插件的 peer 声明是 `@deepseek-ai/dsh-client-ui-primitives` `^0.1.x`（`bundle/dsh-coding-sidebar/package.json:101`、`bundle/dsh-file-review-kcoder/package.json:99`），且都不使用 `TextShimmer`。

### 5.2 MCP 线

**上游结论：MCP 子系统在本区间零代码变更。**

- `packages/mcp/` 两个 tag 的 tree 各 41 文件，**完全一致**；子包只有 `mcp-client` + `mcp-resources`
- 全部 `src/**`、`tests/**`、`README*` 逐 blob 相同；只有两个 `package.json` 的 `:4` version 行不同
- 该路径在区间内**只出现于一个提交**：`4878cdabd8 release(dsh): 0.2.0-rc.1 (#5387)`
- 「MCP 升级至官方 SDK v2」**不发生在这一段**：`dsh-v0.1.7-rc.1` 就已是 `@modelcontextprotocol/client@2.0.0`，我们的钉版基线 rc.2 已带 v2；`@modelcontextprotocol/sdk@1.29.0` 在 rc.2 与 0.2.0-rc.1 的 lockfile 中逐字节相同（它只是 anthropic / pi-ai 等的间接依赖）
- 逐项契约核验全部"无变化"：传输（stdio / Streamable HTTP）、鉴权头、工具分页、无工具服务器、工具公开名 `mcp__<serverName>__<raw>`、资源三工具与 URI 模板、`ctx.mcpResources` seam、错误信封、server 配置 schema（字段/默认值/compat）、`cordis.patch.yml` 的 `- insert:` 方言（`vendor/` 全区间零变更）

**我方资产判定**

| 资产 | 契约 | 判定 |
|---|---|---|
| `desktop/main/mcp-store.ts`（**真正的契约层**，被 `mcp-builtin.ts:36` 与 `mcp-settings.ts:26` 引用） | patch 路径 `:59`、`insert` 条目形状 `:192-195,251-252`、插件名 `@deepseek-ai/dsh-mcp-client` `:53,150,170,192`、实例配置字段 `serverName/transport/command/args/env/cwd/url/headers/toolCallTimeoutMs` `:181-191`、`disabled` 启停 `:193,122`、serverName 正则 `^[A-Za-z0-9_-]{1,32}$` `:56`、transport 枚举 `:33,121`、profile 配置锁 `:222,265`、保存后靠上游 HMR 热重载 `:14-15` | ✅ **9/9 兼容** |
| `desktop/main/mcp-builtin.ts` | `BUILTIN_VERSION=6` `:44`、状态文件 `~/.kcoder/mcp-builtin-state.json` `:135,154`、5 个 stdio 条目 `:57-131`（fetch/context7/sequential-thinking/playwright/memory，serverName 全部满足正则）、PATH 探测 `:161-177,203,218` | ✅ 全部兼容 / 无影响 |
| `desktop/main/mcp-settings.ts` | dialog 选择器 `[role="dialog"][aria-modal="true"]` `:377`、`div[data-slot="settings.section"]` `:378,489`、nav 结构 `:388-390`、aria-current 复制 `:392-401`、表单默认值 `:101-104,137,157-159,201` | ✅ 兼容（**唯一视觉风险**：`SettingsRoot.module.css:73,90` 的 CSS 变量改名 `--dsh-frame-top-clearance` → `--dsh-frame-overlay-top`，设置面板垂直几何变化，建议做一次视觉回归） |

> **ⓘ 一个需要留意的旁路**：`packages/boot/config-editor/src/index.ts:52-60` 的新继承语义（own config key 值为 `undefined` 也覆盖 inherited）**只影响上游 configEditor 的展示/继承视图**。我方 `mcp-store.ts` 直接读写 `cordis.patch.yml`，不经 configEditor，故无影响；但若将来改用 configEditor 读写 MCP 配置，需重新对齐。

### 5.3 侧边栏 + 文件审查线

**上游结论：契约面近乎冻结（密码学级证明）。**

`packages/client/ui-slots/src` 与 `packages/client/ui-deliverables/src` 在两个 tag 间的 **git tree SHA 完全相同** ⇒ 注册签名、keyed vs list、options 必填字段、导出符号、`selectProducedFiles` / `producedForClosing` / `turnTail` **零变化**。同样只改版本号的还有：`readBytes`（`packages/api/workspace-files/`）、typert（protocol/registry/generator）、diff/审查 client 契约、`ui-renderer`、`ui-sidebar-right`、`ui-open-in-app`、`ui-session`、`connection`、`ui-chat/contract/{slots,snapshot}.ts`。

仅有的两处实质改动都是**附加式**：

| 位置 | 改动 | 安全性 |
|---|---|---|
| `packages/client/ui-sidebar/src/client/index.ts:67-73` | `selectPanel` 内新增 `ctx.get('productAnalytics')?.track('sidebar_menu_click')` | 可选查找，服务缺席即跳过 |
| `api/session-controller/src/client/contract/sessions.ts:136`、`ui-conversation/contract/input.ts:189` | `ISessions.fork` 新增可选 `onCreated`；composer `submit(mode?, source?)` 新增可选参数 | 附加可选；审查插件未调用 `fork(` |

**❗ 术语纠正：`tailCard` 是 KCoder 自造词。** 上游两个 tag 里 `grep tailCard` 均为空。真实锚点是 `conversation.chat.turnTail`（`packages/client/ui-chat/src/client/contract/slots.ts:315`，新旧同号）与 `deliverables.file.actions`（`packages/client/ui-deliverables/src/client/index.ts:67`，语义同、行号由注释里的 `:83` 漂移到 `:67`）——**两者都不变**。`tailCard` 是我方 fork 自加的 Config 字段（见 §4.1），随我方偏离面走。

#### 🔴 5.3.1 阻断点：peer 兼容闸门会 deny **两个**插件

| 项 | 内容 |
|---|---|
| 机制 | `packages/boot/app-boot/src/plugin-compatibility.ts:52-82` 的 `evaluatePluginCompatibility()`：遍历 `peerDependencies` 里**每一个** `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*`，任一不满足 `semver.satisfies(runtimeVersion, range, { includePrerelease: true })` 就进 `peers`；只要有**一个**进 `peers` 即返回不兼容。`compatibility-preflight.ts:100-116` 的 `preflight()` 对每个 profile/preset 行调用，命中即 `row.disabled = true`（`group` 行连 `group` 一起关）并往 stderr 写 `dsh: disabling profile plugin <label>: <reason>` —— **不崩、不报错，插件静默不加载** |
| 适用范围 | 仅 **profile / preset 行**（需 `profileContext`）。我方 6 个随包 bundle 都是 profile 行，**全部适用** |
| 豁免 | profile compatibility 文件里的**精确** `name@version → runtimeVersion` 映射（`dsh plugin allow-version` 或插件管理器），**不认范围** |
| `dsh-coding-sidebar@1.0.34` 实测 | 0.1.7-rc.2 ✅；**0.2.0-rc.1 ❌ 11 条 peer 全部不命中** |
| `dsh-file-review-kcoder@1.0.10` 实测 | 0.1.7-rc.2 ✅；**0.2.0-rc.1 ❌ 2 条 peer 不命中** —— `@deepseek-ai/dsh-session` 与 `@deepseek-ai/dsh-api-session-controller` 写的是裸 `^0.1.7-alpha.1`（desugar `>=0.1.7-alpha.1 <0.2.0-0`），**没有任何 `||` 分支兜底**。其余 peer 的 `>=0.1.0-rc.5 <0.2.0` 分支确实能过，但**只要两条不过就整体被拒** |
| 根因 | `^0.1.x` caret 在 semver 下 desugar 成 `>=0.1.x <0.2.0-0`。上界被改写成 `0.2.0-0`，`0.2.0-rc.1 > 0.2.0-0` ⇒ 恰好挡掉 prerelease 版 `0.2.0-rc.1`，即使加 `includePrerelease` 也救不回来 |
| 是否新增机制 | **不是**。该闸门代码两 tag 逐字节相同（既有机制）；这次只是我们的 peer 口径差第一次付出代价（侧边栏 `release/v1.0.33.md` 已自承该口径差） |
| 处置 | 两个插件都必须**补 peer 范围并重发版**。⚠️ **不要写 `^0.2.0`** —— caret 会 desugar 成 `>=0.2.0 <0.3.0-0`，而 `0.2.0-rc.1 < 0.2.0`，**连本 rc 都不接受**。实测可选口径见下表。临时兜底：`dsh plugin allow-version <name>@<精确版本> --dsh-version 0.2.0-rc.1 --accept-risk`（只对完全一致的版本对生效） |

| 口径 | 0.1.7-rc.2（旧） | **0.2.0-rc.1（目标）** | 0.2.0 稳定 | 0.3.0-rc.1（下次引擎升级） | 评价 |
|---|---|---|---|---|---|
| `^0.2.0` | ✗ | **✗** | ✓ | ✗ | ❌ **错解**：不接受 rc，且下次 minor 升级再踩 |
| `^0.2.0-rc.1` | ✗ | ✓ | ✓ | ✗ | 能用，但只在 rc 之后立即升到 0.2.0 才安全 |
| `>=0.2.0-0 <1.0.0` | ✗ | ✓ | ✓ | **✓** | ✅ **耐久解**：跨 rc 与 minor 升级都不再改 |
| `>=0.1.7-rc.2 <1.0.0` | **✓** | ✓ | ✓ | **✓** | ✅ **过渡双兼容解**：已发布的老版本（v0.6.14–v0.6.18）新装用户不受影响 |

> 过渡期建议用 `>=0.1.7-rc.2 <1.0.0`：因为老版本的 `PRESET_PLUGINS` 是 caret 的 `^1.0.34`，一旦我们发布 1.0.35，**老版本的新装用户会被解析到 1.0.35**，若其 peer 不含 0.1.x 就会被闸门拒载。等 v0.6.19 发出、老版本退场后，下一轮插件发版再收窄为 `>=0.2.0-0 <1.0.0`。

> 复核命令（本报告结论的可复现形式）：
> ```bash
> node -e "const s=require('semver'),p=require('/Users/libing/kk_Projects/dsh-file-review-kcoder/package.json'); \
>   for(const [n,r] of Object.entries(p.peerDependencies)) if(n.startsWith('@deepseek-ai/dsh')) \
>   console.log(s.satisfies('0.2.0-rc.1',r,{includePrerelease:true})?'ok  ':'FAIL',n,r)"
> ```
>
> 这条与 §4.4 的调度失效是**两个独立的 P0**：前者是"插件被拒载"，后者是"我们的策略补丁打空"。

#### 5.3.2 KCoder 注入锚点存活核验

**除一个外全部存活**（旧=新）：`body[data-ds-dark-theme]`、`[data-slot="settings.section"]`（70/70）、`[data-slot="conversation.session.header"]`（42/42）、`[data-composer-input|card]`（6/7）、`logoRow`(5)、`brandName`(5)、`railMark`(3)、`headline`(16)、`fish`(21)、`titleGroup`(2)、`previewBadge`(2)、`settingsArea`(2)、`_trigger`→`AccountMenu.module.css:3`、`_navTitle`→`SettingsRoot.module.css:122`、`_titleRow`(7)、`overlayLayer`/`sidebarCol`→`AppFrame.module.css:277`/`:63`、`[role="tree"]…sessionRow`(4)。

**既有死锚（基线即死，非本次回归）**：`desktop/main/brand-injector.ts:284` 的 `[class*="_turnStatus"]`。`turnStatus` 类名在 **0.1.7-rc.1 就消失**（0.1.5-rc.2 / 0.1.6-alpha.2 各有 2 文件命中，0.1.7-rc.1 起 0 文件）。

**修它的窗口正好在本次升级**：0.2.0-rc.1 把运行态抽成新文件 `ui-chat/src/client/chat/RunningStatus.tsx` + `RunningWhaleTail.tsx`，容器类 `css.runningText`，根节点带 **`data-chat-running`**（`ChatView.module.css:116-164` 新增 `.running*`）。建议锚点改 `[data-chat-running]`，兜底 `[class*="runningText"]`。

**自有锚**（不由上游提供，上游 grep 0 命中属正常）：`#__dsh_desktop_titlebar`（`theme-watcher` 注入）、`[data-dsh-toggle-cluster]` / `[class*="toggleButton"]`（插件 `Sidebar.tsx:1235,1359` / `sidebar.module.css:92`）、`[data-dsh-panel-host]`（插件 `index.tsx:269`）。

**澄清**：`file-activity.ts` / `dsh-contract.ts` / `profile-patches.ts` **不是 DOM 注入器**（无任何选择器）。`file-activity.ts` 是宿主探测（`spawnSync('dsh',['--version'])` + `gte(version,'0.1.0-rc.8')` 门限）。

#### 5.3.3 预览面（Office / PDF）真实落点

发布说明⑦「文字选区改善」的真实落点**只有一行 CSS**：`ui-sidebar-documentpreview/src/client/pdf/PdfBody.module.css:114` 由 `--dsw-alias-interactive-bg-hover-accent` 换成**新 token** `--dsw-alias-bg-document-selection`。该 token 是 0.2.0-rc.1 才在 `ui-theme/src/styles/design-platform.css:169`（浅）/:284（深）新增的（旧 tag grep = 0 文件）⇒ 若我方复刻该视觉，在旧宿主上必须带 fallback。

另：发布说明里的「文档预览加载提示」**不是本次新增** —— `LoadingIndicator.tsx` 两 tag 均存在且未改（已在基线内）。

#### 5.3.4 镜像一致性

真源 `/Users/libing/kk_Projects/dsh-coding-sidebar`、`/Users/libing/kk_Projects/dsh-file-review-kcoder` 与 `KCoder/bundle/` 下的镜像 **零 content diff**（`diff -r -q` 无 `Files ... differ`；镜像只是发布子集，缺 docs / release / scripts / tests）。

审查插件 `dsh-contracts.ts` 钉的 10 条 owner 声明（`TurnTailOwnerProps`、`deliverables.file.actions`、`SessionStandardProps.sessionId`、child-slot 抛点 `ui-slots/src/index.ts:1245`/`:1035`、`rendersExistingChildren`、`[data-slot]` = `scoped-slots.tsx:1088` …）**全部仍命中**。

### 5.4 终端线

**上游结论：本区间只有一处真实变更。**

唯一行为变更 —— `terminal-bash` 新增**提示符尾部宽限**：

| 位置 | 内容 |
|---|---|
| `packages/terminal/terminal-bash/src/config.ts:41-48` | `Config` 新增 `promptTailGraceMs?: number`（注释：marker 与尾部由同一次提示符渲染写出，尾部缺失属投递延迟） |
| `config.ts:107` | schema `promptTailGraceMs: z.number().default(0)` |
| `config.ts:124` / `:129-131` / `:139-140` | 正整数遍历跳过该字段（**0 合法**）；独立校验非负安全整数；组合约束「非零宽限必须 ≥ `pollIntervalMs`」 |
| `src/session.ts:586,593-595` | `tailPending = promptSeen && !promptTextSeen && CONTROLLED_PROMPT.startsWith(promptTail)`；`tailGrace = tailPending ? promptTailGraceMs : 0`；结算阈值 `idleSilenceMs + handoffGrace + tailGrace` |
| `config.ts:56` | `ResolvedConfig = Omit<Required<Config>, …>` ⇒ 该字段在 `ResolvedConfig` 里是**必填 number**。**类型级破坏面**：任何手写 `ResolvedConfig` 字面量的外部代码会在类型检查失败（上游自己 4 处已示范补字段：`tests/index.spec.ts:47`、`tests/session-buffer.spec.ts:47`、`benchmarks/terminal-io/terminal-io.worker.ts:62`）。**运行期完全向后兼容**（默认 0 = 旧行为） |
| 配套提交 | `3693c2b402 fix(pty): bound the wait for a seen prompt marker's printable tail`、`76a2b7a799 fix(pty): apply the tail grace only while the tail can still complete` |

**零 diff 面**（`git diff --quiet` 逐一确认）：`terminal/terminal/src`（PTY seam 本体）、`terminal/tool-terminal/src`、`api/terminal-controller/src/**`、`client/ui-sidebar-terminal/src/**`、`sandbox/sandbox/src`、`shell/shell/src`、`subprocess/subprocess/src`、`host/webserver/src`、`client/modules/src`、`api/remotes/src/index.ts`。终端包目录集合两版完全一致（无新增/删除包）。

`ui-sidebar-terminal` 客户端契约亦未变：`inject = ['slots','locale','sidebarRight','sidebarRightTabs','webTerminals','theme','shortcuts']`（`src/client/index.ts:23`），slot 注册点 `sidebar.right.tab.guide.entry`(:86) / `sidebar.right.pane.tab`(:94) / `sidebar.right.pane.tab.title`(:99)；行 id 未改名（新版 `packages/bundle/web-app/cordis.patch.yml:282-283`，**无 `disabled`**）。

#### 5.4.1 我方策略断言：仍成立

`packages/api/remotes/src/client/index.ts` 在 0.2.0-rc.1 中：

- `:27` 仍**模块顶层静态 import** terminal remote（rc.2 在 `:25`）
- `:184` 仍把 `terminalRemote` 作为静态数组元素纳入贡献列表（rc.2 在 `:181`）
- `:190` 仍逐个 `ctx.remote.$mount(contribution)`，**无按配置 / 懒加载 / 条件门控**

⇒ 我方 `disabled: ui-sidebar-terminal`（只摘 UI 行、不动 host 能力）的做法**仍然安全，无需改策略**。

⚠️ **但注释的因果说法两版都站不住**：禁用一个 provider 行不会让 `$mount` 本身失败；真实后果是 `remote.terminal` 在 host 侧失去 `api-terminal-controller` 提供的服务实现。建议把 `desktop/main/product-policy.ts:78-83` 的注释改为：「禁用会让 `remote.terminal` 失去 host 实现（client 侧终端 UI 报错），且 `packages/api/remotes` 仍无条件 import 该包 ⇒ 包必须留在 profile 依赖里」。

#### 5.4.2 两条「新版本变更」实为旧账（复核结论）

| 说法来源 | 复核结论 |
|---|---|
| 0.1.7-rc.1 说明「Web 用户终端使用系统用户权限，不受 Agent 沙箱模式限制」 | 语出 `packages/api/terminal-controller/README.md:30`（及 `.zh.md`），**两版逐字节相同** ⇒ 非本区间变更。对照：Agent 侧终端仍受沙箱约束（`terminal-bash/src/index.ts:27` inject 含 `sandboxPolicy`） |
| 0.1.7-rc.1 说明「`SandboxProvider.confine` 与 `ShellExecutor.start` 改为可取消的异步接口」 | 该签名引入提交 `caa69608fb`，`git tag --contains` 最早命中 **`dsh-v0.1.6-alpha.1`** ⇒ **基线之前的历史账**。且 `ShellExecutor.start` **符号不存在**：`packages/shell/shell/src/index.ts:64` 的 `ShellExecutor` 只有抽象 `resolve`(:84) 与 `execute`(:93)，两版完全一致 |

#### 5.4.3 我方资产判定

| 资产 | 判定 | 依据 |
|---|---|---|
| `@kkutysllb/dsh-terminal@1.1.1` | ✅ **无需适配** | 与上游终端面**完全解耦**：只用 `webServer.register({kind:'prefix'})`（`entry.js:49,613-615`）、`webRuntime.trustedHosts`（`:607-609`，软取）、`__ModuleLoader__` 协议（`client.js:39-46`）、`/api/session/list` 探针（`client.js:156`）——对应上游文件本区间全部零 diff；`entry.js` 对 `@deepseek-ai/*` **零 import**（除自带 `node-pty`） |
| `dsh-terminal/entry.js:73-78` 的 node-pty range 注释 | 🟡 **建议修订（非阻塞）** | 注释宣称与 core「同 range、同 integrity」解析到同一物理包，但上游是 **exact pin `1.2.0-beta.15`**（`packages/subprocess/subprocess-local/package.json:53`，两版相同），我方 `DSH_NODE_PTY_RANGE='^1.1.0'` 并不同 range。该不一致在 rc.2 就存在（非本次引入） |
| `dsh-shell-prefs@1.0.1` | ✅ **无需适配 / 无需重放** | 依赖的 `locale`（`packages/client/locale/src/client/index.ts:227 getSnapshot`、`:238 subscribe`、`:244 setLocale`）与 `theme`（`packages/client/ui-theme/src/client/index.ts:232 setTheme`）契约本区间零 diff；client 交付协议未变 |
| 镜像 `bundle/dsh-terminal` | ✅ **无漂移** | 8 个共有文件（LICENSE / README / client.js / cordis.patch.yml / entry.js / package.json / pnpm-lock.yaml / pnpm-workspace.yaml）**md5 全同**；仅缺 `files` 白名单外的开发资产 |
| 两插件的版本门禁 | ✅ **不触发兼容闸门** | `package.json` **均无 `peerDependencies`** ⇒ 不会撞 §5.3.1 的 peer 门（这与侧边栏/审查插件形成鲜明对比） |

**终端侧回归项**：`/api/session/list` 探针、`__ModuleLoader__` 装载、`webServer` prefix 注册与上游 SPA fallback 共存、node-pty 实际解析（`ensureSpawnHelper`）。

---

## 6. 风险清单与升级动作建议（**不改码，仅列项**）

### 6.1 必做（P0）

1. **解掉两个自研插件的 peer 门禁**（否则插件在 0.2.0-rc.1 上**静默不加载**）：
   - **`dsh-coding-sidebar@1.0.34`**：11 条 dsh peer 全部要改（现为 `^0.1.5-rc.2 || ^0.1.6-alpha.1 || ^0.1.6-alpha.2 || ^0.1.7-alpha.1`）
   - **`dsh-file-review-kcoder@1.0.10`**：除 `^0.1.7-alpha.1` 那两条（`dsh-session`、`dsh-api-session-controller`）外，其余也要一并收口
   - **口径（实测，勿用 `^0.2.0`）**：过渡期写 `>=0.1.7-rc.2 <1.0.0`（双兼容，保护老版本新装用户）；待 v0.6.19 发布、老版本退场后收窄为 `>=0.2.0-0 <1.0.0`（跨后续 minor 升级耐久）。**不要再用 `||` 拼一串 caret 历史版本**——那正是本轮踩坑的模式。详见 §5.3.1 的口径对照表
   - 重发版后更新 `KCoder/bundle/<pkg>` 镜像、`desktop/main/kcoder-skills-bundle.ts` 的 `BUNDLES` 与 `electron-builder.yml`
   - **临时**：`dsh plugin allow-version <name>@<精确版本> --dsh-version 0.2.0-rc.1 --accept-risk`（豁免只对**完全一致的插件版本@运行时版本**对生效，不是范围）
   - **验证**：`dsh web --dump-config` 与启动 stderr 均不应出现 `disabling profile plugin`
2. **调度三行改写为 bundle 选择**：`~/.kcoder/profiles/web/package.json` 的 `dsh.profile.bundles` 增 `@deepseek-ai/dsh-experimental-schedule-bundle`（`dependencies` 补 spec）；同时删除 `desktop/main/product-policy.ts:109-114` 那三行已失效的 `- id: time-context|schedule|ui-schedule / disabled: false`（保留会每次启动刷 3 条 `patch: entry … not found` warning）
3. **重建集成分支 `kcoder/0.2.0-rc.1`**：以 `4878cdabd8` 为基线，依次 merge 各修复分支；**pi-ai 线必须保留 0.87.1**（删上游 `patches/@earendil-works__pi-ai@0.85.1.patch`、保持 `patchedDependencies` 换键一致，否则 pnpm 判 patch unused 会静默不应用）
4. **ui-chat 4 个真冲突文件手工解**：`locale.ts`、`tests/chat-view.client.spec.tsx`、`ui-plugin-manager/client/index.ts`、`ui-tool/ToolRow.tsx`
5. **`pnpm-lock.yaml` 重新生成**（不要手工 merge）

### 6.2 应做（P1）

6. **会话日志策略重新决策**：`session-log-deepseek` 现在恒加载 + 逐请求判定 + 新增用户可见开关（`ui-settings-session-log`）。我方 overlay 的 `config: {enabled: false}` 仍生效，但要决定是"继续强制关"还是"允许用户自选"
7. **桌面遥测显式关闭**：`desktop-product-telemetry` / `product-analytics` 目前靠 `profileContext.name !== 'desktop'` 的巧合隔离（我方 profile 名是 `web`）。建议加显式 `disabled: true` 覆写，避免未来改名或上游改默认时静默开启
8. **`--dump-config` 实测覆写**：升级后跑一次 `dsh web --dump-config`，确认 `session-log-deepseek` / `ui-deliverables` / `ui-sidebar-browser` / `ui-sidebar-terminal` 四行的最终解析值仍符合产品意图，且没有 3 条 `patch: entry … not found` warning
9. **Koffi 钉版联动**：`pnpm-workspace.yaml` 的 Koffi 3.1.1 钉定（`packages/subprocess/{subprocess-local,win32-process}/package.json` 亦改精确 pin）与我方 `scripts/materialize-peers.mjs` 的 native 依赖物化链耦合。凡上游依赖升级后必须跑 staging 端到端断言（版本 + 补丁标记 + 目录三查），单查版本会漏掉"补丁体选错"
10. **CSS 变量改名回归**：`--dsh-frame-top-clearance` → `--dsh-frame-overlay-top`（`SettingsRoot.module.css:73,90`），涉及我方标题栏让位（`titleBarCompat` / `titleBarStripPx`）与面板按钮注入；另 `ui-theme` 新增 token `--dsw-alias-bg-document-selection` 影响文档预览选区配色
11. **终端回归**：`dsh-terminal` 与上游终端面已完全解耦、判定"无需适配"，但仍应跑四项冒烟 —— `/api/session/list` 探针、`__ModuleLoader__` 装载、`webServer` prefix 注册与上游 SPA fallback 共存、node-pty 实际解析（`ensureSpawnHelper`）

### 6.3 建议（P2）

12. **修既有死锚（窗口正好）**：`desktop/main/brand-injector.ts:284` 的 `[class*="_turnStatus"]` 在基线（0.1.7-rc.2）上就已空转（`turnStatus` 类名 0.1.7-rc.1 起消失）。0.2.0-rc.1 恰好把运行态抽成 `RunningStatus.tsx` / `RunningWhaleTail.tsx` 并引入更稳的 **`data-chat-running`**，建议本次一并切锚，兜底 `[class*="runningText"]`
13. **技能产品化**：考虑把 `dsh-super-ppts` / `dsh-video-generator` 的技能走官方 `customSkillDirs` 范式（`packages/bundle/web-app/presets/cordis.patch.yml:143-147`）进入会话技能目录；或采用 §2.2⑪ 的「包内自带 skill provider + tmpdir 私有拷贝」范式（asar/SEA 安全）
14. **工具结果配对渲染复核**：`TOOL_OUTCOME_UNKNOWN` / `TOOL_NOT_STARTED` 两种合成结果会进入历史，凡按配对做统计/渲染的自研面板需确认容忍
15. **native-command 语义收紧**：上游要求显式声明窗口可见性（#5223）；我方自研打开/定位路径需自查等价实现
16. **中文文案一致性**：`Agent → 智能体`（#5277）等我方同文案处保持一致
17. **注释准确性修订（非阻塞）**：① `product-policy.ts:78-83` 关于 `ui-sidebar-terminal` 的因果说法（见 §5.4.1）；② `dsh-terminal/entry.js:73-78` 关于 node-pty「同 range」的说法（上游实际 exact pin `1.2.0-beta.15`，见 §5.4.3）

---

## 7. 复现命令清单

```bash
R=/Users/libing/kk_Projects/deepseek-harness   # 只读使用，勿改工作树（当前检出 kcoder/0.1.7-rc.2）

# 拓扑与区间
git -C $R rev-parse dsh-v0.1.7-rc.2 dsh-v0.2.0-rc.1
git -C $R merge-base --is-ancestor 477b4f4205 dsh-v0.2.0-rc.1 && echo baseline-in-range
git -C $R rev-list --count dsh-v0.1.7-rc.2..dsh-v0.2.0-rc.1
git -C $R log --first-parent --reverse --format='%h|%s' dsh-v0.1.7-rc.2..dsh-v0.2.0-rc.1

# 删除量真相（务必用 -- docs 收窄）
git -C $R diff --numstat dsh-v0.1.7-rc.2 dsh-v0.2.0-rc.1 -- docs | sort -k2 -nr | head

# 新包 / 新 seam
git -C $R diff --name-status --diff-filter=AD dsh-v0.1.7-rc.2 dsh-v0.2.0-rc.1 -- '*/package.json'
git -C $R diff dsh-v0.1.7-rc.2 dsh-v0.2.0-rc.1 -- docs/capability-seams.md docs/config-catalog.md

# 调度抽包（P0 证据链）
git -C $R diff dsh-v0.1.7-rc.2 dsh-v0.2.0-rc.1 -- packages/bundle/web-app/cordis.patch.yml
git -C $R show dsh-v0.2.0-rc.1:packages/experimental/schedule-bundle/cordis.patch.yml
git -C $R show dsh-v0.2.0-rc.1:packages/boot/app-boot/src/profile.ts | sed -n '210,220p'
git -C $R show dsh-v0.2.0-rc.1:apps/cli/package.json | grep schedule-bundle
git -C $R show dsh-v0.2.0-rc.1:vendor/include/src/index.ts | sed -n '100,120p'   # id 不存在 → warn + skip

# 会话日志（P1 证据链）
git -C $R diff dsh-v0.1.7-rc.2 dsh-v0.2.0-rc.1 -- packages/session/session-log-deepseek/src/index.ts
git -C $R show --first-parent --stat 7ded036fdb

# 我方偏离面与新版本的重叠/冲突
git -C $R diff --name-only 477b4f4205 kcoder/0.1.7-rc.2 | sort > /tmp/fork.txt
git -C $R diff --name-only dsh-v0.1.7-rc.2 dsh-v0.2.0-rc.1 | sort > /tmp/up.txt
comm -12 /tmp/fork.txt /tmp/up.txt
# 行级冲突：把两侧 git diff -U0 的 @@ 旧侧区间求交（见 §4.2 脚本思路）

# 我方已改但新版本不存在的文件（注意区分"我方新增"与"上游删除"）
while read f; do git -C $R cat-file -e dsh-v0.2.0-rc.1:"$f" 2>/dev/null || echo "GONE: $f"; done < /tmp/fork.txt

# 产物级验收（升级后）
dsh web --dump-config | grep -E 'time-context|schedule|session-log'    # 三行是否真在位
node scripts/materialize-peers.mjs …                                    # native 物化三查

# 侧边栏 peer 门禁（P0 证据链）
git -C $R show dsh-v0.2.0-rc.1:packages/boot/app-boot/src/plugin-compatibility.ts | sed -n '70,85p'
git -C $R show dsh-v0.2.0-rc.1:packages/boot/app-boot/src/compatibility-preflight.ts | sed -n '95,115p'
node -e "const s=require('semver'); \
  console.log('0.2.0-rc.1 in ^0.1.5-rc.2 ->', s.satisfies('0.2.0-rc.1', '^0.1.5-rc.2', {includePrerelease:true})); \
  console.log('0.2.0-rc.1 in >=0.1.0-rc.5 <0.2.0 ->', s.satisfies('0.2.0-rc.1', '>=0.1.0-rc.5 <0.2.0', {includePrerelease:true}))"

# 终端面零 diff 证明
git -C $R diff --quiet dsh-v0.1.7-rc.2 dsh-v0.2.0-rc.1 -- \
  packages/terminal/terminal/src packages/api/terminal-controller/src \
  packages/client/ui-sidebar-terminal/src packages/sandbox/sandbox/src \
  packages/shell/shell/src packages/host/webserver/src packages/client/modules/src \
  packages/api/remotes/src/index.ts && echo ZERO-DIFF

# 契约面冻结证明（tree SHA 相同）
git -C $R rev-parse dsh-v0.1.7-rc.2:packages/client/ui-slots/src dsh-v0.2.0-rc.1:packages/client/ui-slots/src
git -C $R rev-parse dsh-v0.1.7-rc.2:packages/client/ui-deliverables/src dsh-v0.2.0-rc.1:packages/client/ui-deliverables/src

# 锚点存活
git -C $R grep -n 'data-chat-running' dsh-v0.2.0-rc.1 -- packages/client/ui-chat | head
git -C $R grep -rn '_turnStatus' dsh-v0.1.7-rc.2 dsh-v0.2.0-rc.1 -- packages/client/ui-chat | head   # 期望皆空
```

---

## 8. 遗留与未决

| # | 项 | 状态 |
|---|---|---|
| 1 | `packages/telemetry/otel` 是否对我方"不上传"策略构成新出口 | 需产品决策（新增 seam `ctx.otel` 本身不建连接、不采集；但 base bundle 新增 `otel` 行 + `session-telemetry-otel` 默认 `FEEDBACK_ONLY`） |
| 2 | `session-log-download` / `session-log-export` 行的导出语义是否与我方策略冲突 | 未展开（web-app:75-76 存在该行，属会话日志导出，非上传） |
| 3 | 上游 `apps/desktop` 的产品分析实现是否会被我方壳间接继承 | 否（我方壳独立，且 profile 名为 web）；但 `DSH_PRODUCT_ANALYTICS_OTLP_URL` 若被外部注入需确认 |
| 4 | 我方 18 个重叠文件中「可自动合并」的 14 个，语义安全性 | 已做行号级判定，**语义级仍需 rebase 后跑测试门** |
| 5 | `docs/persistence-schema.json` 压缩对我方产物有无影响 | 我方不消费该文档；如需可重生成 |
| 6 | 两个插件的「兼容」判定目前是**契约面/符号面**静态结论 | **未在 0.2.0-rc.1 上实跑 `pnpm typecheck` / smoke**（本次只读）。侧边栏/审查插件需在改完 peer 后补一次编译与冒烟 |
| 7 | 哈希前缀锚点（`_trigger` / `_navTitle` / `_close`）的最终存活 | 源码层已确认同名类存在且 owner 文件未变，但**未在 0.2.0-rc.1 实机 built 产物**上验证 |
| 8 | 兼容闸门在 KCoder 桌面集成路径（profile 注入第三方行）上是否对每个第三方行都生效 | 机制已确认（`compatibility-preflight.ts`），但未在实机 profile 上跑 deny 场景 |
| 9 | 官方 `dsh-v0.2.0-rc.1` 之后是否有 rc.2 | 本次分析截止 `4878cdabd8` |
