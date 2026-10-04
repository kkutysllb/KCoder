# 上游 dsh 0.2.1-alpha.1 差异分析（引擎内核 + 自研内置插件升级点）

> **分析对象**：官方 `deepseek-ai/deepseek-harness` tag **`dsh-v0.2.1-alpha.1` = `5badb15009`**（2026-10-03 发布，prerelease）
> **区间**：`639ed01539`（tag `dsh-v0.2.0-rc.2`）→ `5badb15009`，**266 提交 / 4190 文件 / +51032 −32761**
> **性质**：本文档**只做分析与建议，不含任何已落地的代码改动**。实施计划见 [upstream-0.2.1-alpha.1-upgrade-plan.md](upstream-0.2.1-alpha.1-upgrade-plan.md)。
> **方法**：`git diff/show/grep` 逐项取证；所有 `文件:行` 默认取 **`5badb15009` 端点行号**；npm 事实用 `npm view` 实查（非推断）。
> **原始素材**（工作态，可复现）：`.tmp/upgrade-0.2.1/{release-notes-dsh-v0.2.1-alpha.1.md, A-release-notes-mapping.md, C-fork-replay-risk.md, D1-skills-mcp.md, divergence-rc2.txt}`
> **五路取证**：A=发布说明逐条映射 · B=未提及变更系统扫 · C=fork 重放风险 · D1=技能+MCP 线 · D2=侧边栏+终端+宿主注入面

---

## 0. 结论卡（TL;DR）

### 0.1 🔴 两个必修硬阻断（先把这两件做完，再谈其它）

| # | 阻断 | 一句话 | 判据 |
|---|---|---|---|
| **P0-1** | **调度组合包被上游退役，我方仍在钉它** | 上游新增 `RETIRED_BUNDLES`，每次加载都会把 `@deepseek-ai/dsh-experimental-schedule-bundle` 从 profile 的 `dsh.profile.bundles` **删掉并回写 manifest**；我方宿主每次启动又写回 → 启动震荡 + 持续安装一个已停产的组合包 | §5.1 |
| **P0-2** | **两个内置插件 bundle 的引擎 peer 上界把新引擎挡在门外** | `@kkutysllb/dsh-terminal@1.2.1` 与 `dsh-ssh-remote@0.1.3` 的 peer 是 `…<0.2.0`，而 `0.2.1-alpha.1` **不满足** `<0.2.0`（semver 实测）→ 新引擎的**组合包兼容闸门直接把这两个 bundle 跳过**（stderr 一行 `skipping profile bundle`），内置终端 UI 与 SSH 远程世界**静默消失**（不报错、不崩） | §5.2 |

> 二者共同特征：**静默**。没有编译失败、没有启动失败，只有能力"少了"。所以本轮回归必须以 stderr 两句话 + 功能在位为准绳，不能只看"能起来"。

### 0.2 三类必须处理的事

1. **fork 集成分支重建**：偏离面 61 文件 ∩ 新区间变更 = **15 文件重叠**，其中**必然冲突 3**（`ui-plugin-manager/src/client/index.ts`、`workspace/workspace/package.json`、`pnpm-lock.yaml`）。方案：以 `5badb15009` 为基整支 merge 重放，新建 `kcoder/0.2.1-alpha.1`（§4）。
2. **KCoder 宿主侧字面量与声明平移**：`upstream/BASELINE`、分支名（3 文件）、`PRESET_PLUGINS`（删调度行）、`DS_HOST_PEER_FALLBACK`（删陈旧项）（§7）。
3. **插件线 peer 口径重定**：不只两件内置，家族里 `dsh-animations` / `dsh-super-ppts` / `dsh-video-generator` 同样带 `<0.2.0`（§5.2.3）。

### 0.3 好消息（比 rc.2 那轮省得多）

- **技能线、MCP 线：零改动**——两个上游包的 `src/**` 在本区间**逐字节未变**（只有 README 与 package.json 版本号），我方注册面/配置 schema 逐字段对上（§6.1、§6.2）。
- **产品策略层七个覆写行 id 全部存活**，引用计数与 rc.2 完全相同 ⇒ `product-policy.ts` 的 YAML **无需改动**（§6.5）。
- **引擎启动契约完好**：`--no-open` / `--patch` / `--port` / `--profile` 全部在位（`--patch` 逐字节相同），`--public-url` 为**加法**（§3.1）。
- **slot 契约再度冻结**：`packages/client/ui-slots/src` 两个 tag 的 tree SHA **完全相同**（`cce09249…`，第三轮同值）；我方注册的 `settings.section` 与 `conversation.chat.turnTail` 引用数不变（135→139、35→35）（§6.3）。
- **pi-ai 分歧消失**：上游本区间**未升** pi-ai（两侧均 `^0.87.1`），我方补丁是上游基线补丁的**严格超集**，7 个 `upstream/*.patch` **无一需要 rebase**（§4.2）。
- **品牌运行态文案逐字节未变**（`RunningStatus.tsx:28,33`、`locale.ts:89,90,282,283`）⇒ `brand-injector.ts` 的 `'Deep diving'` 锚点继续有效（§6.6）。
- **上游修了一个正好砸在我方注入上的缺陷**：`client-modules` 此前把文档里**所有未打标的 `<style>`** 认领给当时物化的插件，导致插件启停时被误删——修复后只认 factory 运行期间注入的 style。我方 `style-overlay.ts` 正是"运行时注入的未打标 style"（`webContents.executeJavaScript` → 文档末尾追加 `<style>`），**这条修复直接让我们的主题覆写层变稳**（§3.2）。

### 0.4 npm 侧就绪度（实查 registry，非推断）

| 包 | dist-tags | 本区间需要 |
|---|---|---|
| `@deepseek-ai/dsh-schedule` | `alpha=0.2.1-alpha.1` | ✅ 有 |
| `@deepseek-ai/dsh-tool-schedule` | `alpha=0.2.1-alpha.1` | ✅ 有（本区间新增包） |
| `@deepseek-ai/dsh-{ssh,fs-ssh,subprocess-ssh,sandbox-ssh}` | `alpha=0.2.1-alpha.1` | ✅ 四件都有 |
| `@deepseek-ai/dsh-base` / `-web-app` | `alpha=0.2.1-alpha.1` | ✅ |
| `@deepseek-ai/dsh-invariants` | **止于 `0.2.0-rc.2`**（无 alpha.1） | ⚠️ 包已停产但**仍可解析**（我方是 devDependency，且不装进 profile） |
| `@deepseek-ai/dsh-experimental-schedule-bundle` | **止于 `0.2.0-rc.2`**（无 alpha.1） | ⚠️ 仍可解析 ⇒ P0-1 表现为**震荡**而非安装报错 |

> 这条实查**修正了一处推断**：`dsh-invariants@0.2.0-rc.1` 与 `dsh-experimental-schedule-bundle@0.2.0-rc.2` 在 npm 上**仍然在架**，所以两处都是"悬挂声明"而不是"安装期 404"。`dsh-invariants` 更是自始就没进 profile（devDependency + 无 peer 约束）。

---

## 1. 版本与拓扑

```
upstream(deepseek-ai)/master ──► dsh-v0.2.1-alpha.1 = 5badb15009   (2026-10-03)
                                    ▲
                                    │ 266 提交 / 4190 文件
dsh-v0.2.0-rc.2 = 639ed01539 ───────┘ ← 我方集成分支的 merge-base
                                    │
fork(origin)/master = 5badb15009    └── kcoder/0.2.0-rc.2 @ b428f93a79（我方当前集成分支，工作树干净）
```

| 项 | 值 |
|---|---|
| 上游仓 | `/Users/libing/kk_Projects/deepseek-harness`（origin=fork，upstream=deepseek-ai） |
| 我方集成分支 | `kcoder/0.2.0-rc.2` @ `b428f93a79`，工作树干净 |
| 产品仓 | `/Users/libing/kk_Projects/KCoder`，版本 **0.6.23**（当前发布说明锚 `0.2.0-rc.2` + `b428f93a79`） |
| 变更主要落点 | `.agents/notes` 1696（564 条为 `implemented/`→`archived/` 重命名，纯文档）· `packages/client` 457 · `packages/experimental` 311 · `docs/subsystems` 91 · `packages/session` 83 |
| 包目录 | 486 → 486；**新增 5**：`experimental/{claude-code-mods, client-ui-claude-code-mods, inspector-profile, session-inspector}`、`schedule/tool-schedule`；**移除 5**：`experimental/schedule-bundle`、`runtime-diagnostics/{README*, invariants}` |
| 真实代码量 top（排除 package.json） | `experimental/session-inspector` 65 · `claude-code-mods` 60 · `experimental/inspector` 56 · `ui-conversation` 37 · `ui-tool` 36 · `ui-chat` 35 · `ui-agent-preset` 19 · `schedule/schedule` 15 |

---

## 2. 官方发布说明逐条 → 代码变更点（25 条，**全部定位**）

**等级口径**：🔴 阻断（不处理无法升级/启动/发版）· 🟠 需适配（能走通但必须改我们代码/文档/锚点，或存在确定冲突面）· 🟢 无影响。
**KCoder 资产缩写**：`D`=`desktop/main/**` · `B`=`bundle/**`（5 内置插件）· `S`=`scripts/**` · `P`=`profiles/**` · `F`=fork 分叉文件面（61 文件）。

**结果分布：🔴 0 · 🟠 11 · 🟢 14**（详细证据表见 `.tmp/upgrade-0.2.1/A-release-notes-mapping.md`）

### 2.1 ✨ 新增功能（6 条）

| # | 条目 | sha（主） | 关键代码点（`5badb15009`） | 等级 | 理由 |
|---|---|---|---|---|---|
| A1 | Claude Code Mods 兼容层（实验） | `35873604ad` 等 10 提交 | `packages/experimental/claude-code-mods/src/index.ts:200,535` · `client-ui-claude-code-mods/src/client/index.ts` | 🟢 | 新 alpha 包，**未进 `OPTIONAL_BUNDLES`**，默认不挂载；我方零引用 |
| A2 | 插件管理页「让 Agent 创建插件」入口 | `ed50a72fc4`、`7d88fc9b2b` | `ui-agent-preset/src/client/CreatePluginMenuItem.tsx:27` · **`ui-plugin-manager/src/client/index.ts` + `locales.ts`** | 🟠 | 后两个文件**在分叉面内** → 必然冲突；`D/style-overlay.ts:22,160` 依赖该页 panellist 锚点，需复核 |
| A3 | 新会话预填提示；草稿/工作区切换保留文件、目录、会话引用 | `e400349e3a` 等 | `ui-conversation/src/client/draft.ts:34,44,64` · `contract/input.ts:27,50,70` | 🟠 | 改的是**输入契约**（draft/reference 类型）；`B/dsh-coding-sidebar` 客户端半依赖该包契约面，需复核 |
| A4 | Markdown 预览显示 YAML frontmatter 字段列表 | `0cad3a0137`、`39c614a143` | `ui-sidebar-documentpreview/src/client/markdown/frontmatter.ts:18` · `frontmatter-fields.tsx:58` | 🟢 | 上游自带包内部；我方自研侧栏不使用它 |
| A5 | Web `--public-url`（含带路径前缀反代） | `a7c3ad99bc` | `bundle/web-app/src/public-url.ts:16` · `src/index.ts:30,65,74` · `startup.ts:93` | 🟠 | `bundle/web-app/src/index.ts` **在分叉面内** → 冲突；我方走 loopback + `DSH_WEB_URL`，不声明该配置项不影响启动（**潜在新能力**：反代入口） |
| A6 | 可选「开发者工具」组合包 | `38c45638a2`、`732dd913cf` | `experimental/inspector-profile/package.json:2,5` · `session-inspector/src/client/index.ts:10,16` | 🟢 | 登记进 `OPTIONAL_BUNDLES`（`profile.ts:227`），默认不选中；我方未声明 |

### 2.2 🐛 问题修复（10 条）

| # | 条目 | sha（主） | 关键代码点 | 等级 | 理由 |
|---|---|---|---|---|---|
| B1 | 目标编辑多行 + Shift+Enter；IME/宽度适配 | `3843225471`、`66e101821c` | `ui-primitives/src/InlineEditor.tsx:20` · `ui-goal/src/client/GoalBar.tsx` | 🟢 | 客户端编辑器组件；我方未覆写 |
| B2 | 修目标停止→恢复→再停止后消息滞留队列 | `9a8d21dfe7` | `goal/goal-round-driver/src/index.ts:268,272,279` | 🟢 | 引擎内部；`F` 不含 |
| B3 | 修部分 Bash/PowerShell/文件修改记录无法展开 | `fce0a41da8`、`c74f39b4dc` | `ui-tool/src/client/tool/models/terminal-card-model.ts:190` · `diff-card-model.ts:69` | 🟢 | 客户端工具卡；我方自研 trajectory 卡 |
| B4 | 关代码工作视图后仍可选标准/创造/自定义；PTC/极简默认改标准 | `3c26fdd204` 等 7 提交 | `ui-agent-preset/src/client/index.ts:74,77` · `seat-store.ts`/`section-store.ts`/`locales.ts` | 🟠 | 与 A2 同包叠加；`D/product-policy.ts` 逐行覆写上游组合层，preset 默认值变化会改出厂首启呈现 → 需实测覆写行 id 仍在 |
| **B5** | **修启停插件时其他插件样式被移除（需刷新）** | `aa5334f1e0`、`015349e4ad` | `packages/client/modules/src/client/system.ts:47,66-68,71` | 🟠 | 我方 **4 个内置插件带客户端半**（sidebar/shell-prefs/ssh-remote/terminal），全部经 `client-modules` 装配 → 启停样式存留需实测（**建议第一条回归**）。另见此修复对我方注入层的**正面**影响（§3.2） |
| B6 | 登录无响应显示网络检查提示（新增 `no-response`） | `f3168f2be4`、`dff4dfbe75` | `ui-settings-account/src/client/SignInDialog.tsx:38` · `credentials/deepseek-account/src/types.ts` | 🟢 | 上游账号通道；KCoder 是本地 scrypt 鉴权（`D/auth.ts`），**不消费** `errorCode`（已 grep 我方零命中） |
| B7 | 桌面端默认用系统分配端口 | `ecd9bf9273` | `apps/desktop-host/src/index.ts:30,103`（上游自己的壳） | 🟢 | **我方早已同路线**：`D/dsh-manager.ts:168` 就是 `['--port','0']`，端口从就绪行解析 |
| B8 | 修侧栏列表重排后会话加载动画不同步 | `4b9d8ad6f7` | `ui-primitives/src/StateDot.tsx:14-16,22` | 🟢 | `ui-primitives` 内部；我方自研侧栏自带加载态 |
| B9 | HMR 可刷新包入口与依赖映射并重载原入口 | `6fe4a2e184`、`b1c5f861b6`、`d7d2e5fd4e` | `boot/hmr/src/package-manifest.ts:134` · `hmr/src/index.ts:256,328-350` · `app-boot/src/profile-resolution/service.ts:101` | 🟢 | 我方不开启上游 HMR 目录监听 |
| **B10** | **修组合包启用后找不到依赖 / 停用后残留映射** | `869afc493d`、`abf8b760ec`、`00b363074a` | `boot/plugin-manager/src/index.ts:298`（新 `removable` 语义）· `:617-621`（`removeBundle`）· `app-boot/src/profile.ts:738` | 🟠 | **正是 KCoder 注册内置 bundle 的通道**（`D/kcoder-skills-bundle.ts`、`D/preset-plugins.ts`）；`removable` 语义 + runtime resolution refresh 变化与我们的 `RETIRED_PLUGINS` 三清**行为交叠**，需回归内置 bundle 的启用/停用/更新 |

### 2.3 🎨 体验优化（5 条）

| # | 条目 | sha（主） | 关键代码点 | 等级 | 理由 |
|---|---|---|---|---|---|
| C1 | 自动化任务详情窄窗布局；关联会话入口收起为图标 | `5586cfef7e`、`d8f38c4ad6` | `ui-schedule/src/client/TaskDetail.tsx:309-322` | 🟢 | 我方侧栏「任务计划」tab 是自研实现，不复用该组件 |
| C2 | 组合包详情页显示代码来源与当前版本 | `b96959ecf4`（+`7d70426f5e`/`93a7d221ed` 快照） | `boot/plugin-manager/src/index.ts:317,322` · `ui-plugin-manager/src/client/manager-store.ts:89,435` · `PluginManagerPage.tsx:318-325` | 🟠 | 改了 `ui-plugin-manager/src/client/locales.ts`（**在分叉面内**）→ 冲突；详情区新增 `data-plugin-source` 段，`D/style-overlay.ts` 锚点需复核 |
| C3 | 工具调用准备阶段显示命令说明/路径/生成进度 | `2ba4144a7e` 等 7 提交 | `ui-chat/src/client/conversation-nodes/tool.ts:47-50,68-69` · `process-activity.ts:62,113-123` | 🟢 | `ui-chat` 节点渲染；我方不自研该面 |
| C4 | 加快大量会话列表读取（时间切片） | `ecc01b54a4`、`4402fa47e4` | `api/session-controller/src/index.ts:83,87,121,159`（新增 `listWorkSliceMs` 默认 16ms） | 🟢 | 引擎内部调度，对外契约不变 |
| C5 | 安装结果显示实际版本；被供应链年龄门挡时给说明 | `bab69fbec5`、`43c5f1e924`、`0bd1492940` | `boot/plugin-manager/src/index.ts`（读 `manifest.version`）· `manager-store.ts:212` · `PluginManagerPage.tsx` | 🟠 | 同样落在 `ui-plugin-manager/src/client/locales.ts`（分叉面内）→ 冲突；与 B10 同属 plugin-manager 面，我方内置 bundle 更新入口文案/行为需回归 |

### 2.4 ⚠️ 其他变更（4 条，破坏性变更集中于此）

| # | 条目 | sha（主） | 关键代码点 | 等级 | 理由 |
|---|---|---|---|---|---|
| **D1** | **自动化任务改为 Web 内置能力**；提醒工具按模式提供；旧组合包选择自动清理 | `c6dd905972`、`9633724b40`、`6c1a590a4c`、`699f1a8dc1` | 组合层 `bundle/web-app/cordis.patch.yml:139-140,389-390`；**退役机制** `app-boot/src/profile.ts:206-210`（`RETIRED_BUNDLES`）、`:667-674`（`dropRetiredBundles`）、`:738`（入口）；工具归属 `schedule/tool-schedule/src/index.ts:446` | **🔴→见 §5.1** | 我方 `D/preset-plugins.ts:122` 仍精确钉该组合包 ⇒ 与引擎的自愈逻辑**互搏** |
| D2 | 子路径插件不再读独立 `package.json`；展示文本/图标走子路径导出 | `8339f16c1d` 等 9 提交 | `boot/app-boot/src/package-meta.ts:21,24,40,57,123-140` · `scripts/verify-package-meta.ts` | 🟢 | 我方 5 个 bundle **全是包根插件**（`cordis.patch.yml` 的 5 处 `name:` 无一带子路径）；`bundle/dsh-coding-sidebar` 导出的是包根自己的 `./package.json`，不属被移除形态 |
| **D3** | **破坏性**：移除运行时 invariant 插件及所有 `./invariant` 导出 | `f028f25667`、`963715344b`、`f1f0dc54ff` | 整包删 `packages/runtime-diagnostics/invariants/**`；38 个包的 `./invariant` export **38→0**；`llm/llm/src/index.ts:355-372`（删 `code==='INVARIANT'` 收集与尾部 rethrow）；`sdk-minimal` 去掉 5 行 | 🟠 | 我方命中三处 + 一处合并冲突，见 §6.4 |
| D4 | 输入区统计拆为 `activity` / `usage` 两个入口 | `2190082866` 等 7 提交 | `ui-chat/src/client/apply.ts:288,291` · `chat/StatsPills.tsx:133,242,245,292` | 🟠 | `apply.ts` **在分叉面内**且本区间只被这一个提交改动 → 冲突点集中、易解；**功能面我方未注册 `stats` 行 → 不需要改注册 ID**（已 grep 我方零命中 `conversation.composer.dock`） |

### 2.5 官方升级指南（本区间新增 4 份）→ 我方动作

| 指南（`docs/upgrade-guide/v0.2.0-rc.2/…/guide.zh.md`） | 对应条目 | 我方动作 |
|---|---|---|
| `schedule-bundle-retired` | D1 | **删** `D/preset-plugins.ts:122`；更新相邻注释结论。指南原文点名"**由其他工具写入的 profile 目录需要自行删除该条目**"——KCoder 正是那种"其他工具" |
| `remove-runtime-invariants` | D3 | 删 `B/dsh-coding-sidebar/package.json` 的 `./invariant` export + `files` 条目 + `@deepseek-ai/dsh-invariants` 依赖；删 `src/invariant.ts`、`lib/invariant.js`、`lib/types/invariant.d.ts`、`src/context-types.ts` 的 `invariants` 镜像面；删 `D/plugins.ts:66` |
| `subpath-plugin-display-manifest` | D2 | **无强制动作**；未来新增子路径展示资源时按 `<subpath>/icon` + `<subpath>/locale/*.json` |
| `account-sign-in-errors` | B6 | **无动作**（我方本地鉴权，不消费 `errorCode`） |

**我方对指南迁移步骤的逐条自查（已做）**：指南要求删除的 5 个 `sdk-minimal` id（`invariants`/`session-invariant`/`agent-invariant`/`scope-invariant`/`agent-loop-invariant`）以及任何 `name` 为 `@deepseek-ai/dsh-invariants` 或以 `/invariant` 结尾的 patch 行——**我方 `D/*.ts` 与 `product-policy.ts` 零命中**（已 grep）；`time-context`/`ui-schedule` 的顶层覆写行我方也没有（仅注释里出现），无需按指南第 2 步删除。

---

## 3. 官方发布说明**未提及**的代码变更点

> 本节为 B 线系统扫 + 我在 P0 排查中的独立发现。**未提及 ≠ 无影响**：本区间最大的一个破坏面（P0-2 的 peer 闸门）恰恰不在发布说明里。

### 3.1 启动/组合契约面（对 KCoder 最关键，逐项已核）

| 面 | 断言 | 证据 | 判定 |
|---|---|---|---|
| `--patch` overlay（产品策略层入口） | 逐字节未变 | `apps/cli/src/args.ts:38,73,113,133` 两 tag 同行号同内容 | ✅ 我方 `product-policy.ts` 的引入方式继续有效 |
| `--no-open` | 未变 | `bundle/web-app/src/startup.ts:52` → `:60` | ✅ |
| `--port` / `--host` / `--profile` | 未变 | 同上 `:59-61`；`apps/cli/src/args.ts:203` | ✅ |
| `--public-url` | **新增** | `startup.ts:93`、`src/public-url.ts:16`（`parsePublicUrl`） | 🟢 加法；潜在能力（反代入口 / 对外地址） |
| `dsh.profile.bundles` 语义 | 未变（`profile.ts:79,95,101`） | 两 tag 同行号同语义 | ✅ 我方物化通道继续有效 |
| 组合包 patch 声明 `dsh.bundle.patch` | 未变；`bundlePatchFiles/bundlePatchPaths` 仍在 | `boot/app-boot/src/index.ts:56-73` 导出面 | ✅ |
| **组合包 peer 闸门** | **新执行路径**（组合包级） | `profile.ts:753-757`：`evaluatePluginCompatibility(bundleManifest, exemptions)` 失败 → 进 `skippedBundles` → **整个 bundle 层跳过** | 🔴 见 §5.2 |
| **`RETIRED_BUNDLES` 主动摘除** | **新行为** | `profile.ts:206-210` + `dropRetiredBundles:667-674`（`writeProfileManifest` 回写） | 🔴 见 §5.1 |
| 跳过/禁用的**可观测性** | 两句话都在 stderr | `reportSkippedBundles:118-122`（`dsh: skipping profile bundle "<name>": <reason>`，调用点 `apps/cli/src/profile-boot.ts:170`、`apps/desktop-host/src/index.ts:24`）· `compatibility-preflight.ts:82`（`dsh: disabling profile plugin row "<id>": <reason>`） | ✅ 回归判据可写死（§5.3） |
| `app-boot/src/index.ts` 导出面 | 仅**新增** `ProfileRuntimeResolution` | `git diff` 该文件仅 +1 导出 | 🟢 加法 |

### 3.2 我方的 CSS 注入层（`style-overlay.ts`）——上游顺手修了我们踩着的坑

`aa5334f1e0` 的原始问题（提交信息原文）：*"Materialization tagged every untagged `<style>` in the document for the materializing plugin, so styles inserted later by other owners (Cordis dynamic plugins, **runtime-injecting libraries**) were removed when an unrelated plugin was toggled."*

- 修复：`packages/client/modules/src/client/system.ts:66-71` 引入 `untaggedStyles()` 快照，`claimStyles(id, before)` 只认领 factory 运行**期间新增**的 style。
- 我方关联：`D/style-overlay.ts:236-255` 在 `did-finish-load` 时用 `webContents.executeJavaScript` 往文档末尾追加 `<style>` ⇒ 属于"运行时注入的未打标 style" ⇒ **旧引擎下用户启停任一插件就可能把我们的覆写层误删**（表现正是"样式丢了、刷新才好"）。本区间之后该风险消失。
- 结论：🟢 **净收益**；但同一改动也意味着"我方注入的 style 不再被任何插件认领"，与我们期望一致（它是宿主级覆写，本就不该属于某插件）。

### 3.3 发布说明未提及的**结构性**变更（B 线系统扫，明细见 `.tmp/upgrade-0.2.1/B-unlisted-changes.md`）

**（a）三条被发布说明完全掩盖的契约变更**

| # | 变更 | 证据 | 对我方 |
|---|---|---|---|
| 1 | **`tool.call.toolview` slot 破坏性变更**：声明里删掉 `hookContext` + `inject`；`UseToolCallArgumentsPartial` / `ToolCallHookContext` / `ToolCallInjected` 三个导出消失；参数改由新的惰性视图 `ToolArgs = PartialArguments` 提供（实现落在**新文件** `packages/util/values/src/partial-json.ts`，+666 行）；`ToolResultNode` 新增**必填** `name`(`records.ts:165`) + `args`(`:167`)，`ToolCallHead` 新增 `args`(`:278`) | 发布说明只写了"准备阶段可显示进度"这个体验结果 | 🟢 **我方零命中**（`grep -rn "tool.call.toolview\|UseToolCallArgumentsPartial\|ToolCallHookContext\|ToolCallInjected\|toolCallArgumentsPartial" dsh-coding-sidebar/src dsh-terminal/src` → 空）；我方自研工具卡不经该 slot |
| 2 | **`ui-conversation` 草稿/持久化契约重构**：slot inject 键 `bindDraftMirror: (write: (text: string) => void) => () => void`（`contract/slots.ts:344`）→ **`bindDraftPersistence: (write: (draft: DraftSnapshot) => void) => () => void`**；`InputActions` 新增 `persistDraft(): void`（`input.ts:253`）；`setDraft` 文档语义收窄为"用纯文本替换整份草稿，**移除行内引用 chip**"；`SessionInputResolver.requestDraftInitialization()` 新增；`UiWorkspace.startSession` 加可选第 2 参 | 逐行对照 `contract/input.ts`（rc.2 `:225-262` vs alpha.1 `:228-268`）与 `slots.ts:344` | 🟠 **但比 B 线初判轻**：我方**不实现** `bindDraftMirror`/`bindDraftPersistence` inject 面（`grep` 我方 src+lib **零命中**）⇒ 键改名对我方无破坏；我方 `client/conversation-draft.ts:184` 走的是 `conversation.input.for(actx).setDraft(next)`，而 **`InputState.draft` 在两个 tag 都仍是 `string`**（`input.ts:257` → `:277`）、**`setDraft(text: string)` 仍存在** ⇒ 读写路径兼容；需实测的只是"新增 `persistDraft()` 后，程序化写入的持久化时机是否变化" |
| 3 | **scoped-event 机制整体消失**：删 `packages/core/scope/src/scoped-events.generated.ts`（该目录只剩 `index.ts` + `store.ts`）与 `src/invariant.ts`；删 `scripts/gen-scoped-events.ts` 与 `gen-scoped-events` / `verify-scoped-events` 两条 gate；6 处 `@dshScopeScan` 契约标签清空 | `git ls-tree -r <tag> -- packages/core/scope/src` 对比 | 🟡 **运行时通道未受影响**：`agent/assistant-stream` 在两 tag 的发出/消费点**逐一相同**（`packages/acp/acp/tests/turns.spec.ts:213`、`api/session-controller/src/client/{transport.ts:58,76,206, sessions/session.ts:662}`）；且 `packages/core/scope/src/{store.ts,index.ts}` **`git diff --stat` 为空**（`store.ts:153,160-161,202-204` 的 global 层仍在）⇒ 我方 `assistant-live.ts:115` 的 `host.on('agent/assistant-stream', listener, { global: true })` 继续有效。被删的是**生成期类型注册表与质量门**，不是事件总线 |

> ⚠️ **一处需要修正的记录**：B 线的汇总把变更 2 记作"`ConversationStoreState.draft: string → DraftInput`"。**代码不支持这个表述**——拥有 `readonly draft: string` 的接口是 `InputState`，它在 alpha.1 仍是 `string`（`input.ts:277`）。新增的 `DraftInput`/`DraftSnapshot` 类型（`client/draft.ts`）属于**持久化路径**，不改公开的输入态投影。本文档按复核后的事实记录。

**（b）布局与资源面（对注入层有影响但当前不阻断）**

- **新增 root slot `shell.bottom`**：`ui-layout/src/client/index.ts:94,185` 声明，发射点 `AppFrame.tsx:289-290`（`data-shell-bottom`），AppFrame 网格改 `grid-template-rows: minmax(0,1fr) auto`。槽位集合 **191 → 193（+2：`shell.bottom`、`plugins.add.actions`；−0）**。
  - 对我方：`sidebar-toggle.ts:265-272` 的判据是"列数 `tracks.length === 3`"，而**列数（inline `grid-template-columns`）未变**、空 bottomRow 解析为 0 高 ⇒ **不阻断**；可选硬化 = 把折叠轨道注入从"轨道数===3"升级为属性锚（登记为 P2）。
- `data-composer-stats` → `data-composer-stat`（**我方零命中**，已 grep）；新增 23 个 `data-*`。
- **`packages/experimental/inspector` 不再是组合包**（`dsh.bundle` 与 `./cordis.patch.yml` 导出整块删除，组合包角色搬去新包 `inspector-profile`）。官方**只给了 schedule-bundle 的迁移指南，没给 inspector 的**（旧选择落点未知，登记为未决）。

**（c）工具与调度面**

- `@deepseek-ai/dsh-tool-schedule` 新包承接提醒工具 + `tool-subagent` 新增 `toolFilter.deny` 字段（4 个 `schedule_*` 名）；`agent-preset-registry` 移除 `livePresetMounts`/`standingMountFor`/`serviceForAgent`/`JoinedPresetMount`、新增 `inspectCompositions()`（我方 `D/**`+`S/**` 对这些符号**零命中**）。
- **`run_code` 参数顺序反转**（`code,description` → `description,code`），`edit`/`write` 的 `file_path` 描述也加了同样顺序指示；`tool-bash`/`tool-pwsh` 把 `description` 排到 `command` 前。**模型可见的工具 schema 契约变化**——我方唯一相关命中是 `D/update-injector.ts:76` 的**注释**（发布说明排版示例），**无 schema 断言** ⇒ 🟢。
- `SessionController.Config.listWorkSliceMs`（新增，默认 16ms）、`SignInErrorCode` +`'no-response'`、desktop 默认端口 `19387 → 0`。

**（d）工具链与构建面（对 fork 构建有影响）**

- 根 build 脚本**全部加 `tsdown --config-loader native`**；新增**钉死** `vite@8.0.16` 与 `semver`；`boot/hmr` 新增**原生 addon** `node-addon-require-builtin@^0.1.6` + 新文件 `src/package-manifest.ts`（330 行，直接 monkey-patch Node 内部：`internalBinding('modules')`、ESM resolve cache、CJS `_pathCache`/`_resolveFilename`/`_load`）；`vendor/loader/src/config/entry.ts:49` 新增 public 字段 `Entry.moduleNamespace`。
  - 我方不消费 `moduleNamespace`/`loader.resolve`（已 grep），但**原生 addon 随引擎闭包物化**这一点必须在 S4/S5 观察（Electron 44 / Node 24 下能否加载）。
- 删除 4 个 invariant 门禁脚本 + 4 条根 script；`check-workspace-constraints.ts` 去掉 `./invariant` 校验、**新增**"`./icon` 与 `<subpath>/icon` 必须进 `files`"校验；typert 生成器跳过 `svg/png/jpeg/webp` 导出；`llm-retry/src/history.ts` 整文件删除（无公开导出）。
- `packages/skill/skill-office` 的 `@deepseek-ai/libreoffice-kit ^0.1.1 → ^0.1.5`（随引擎分发，我方无副本）。

**（e）明确"未变"（两 tag 同 SHA / 差集为空）——对我是好消息**

`packages/client/ui-slots/src`（tree）· `ui-chat/src/client/contract/slots.ts`(blob) · `ui-dockkit/src` · **settings 面四个**（`packages/settings/settings/src`、`ui-settings-general/src`、`SettingsRoot.tsx`、`ui-settings/src/client`、`ui-settings-models/src/client`）· `host/webserver/src` · `util/package-manifest/src/index.ts`（`dsh.bundle.patch` / `dsh.client` manifest schema）· typert `{protocol,registry,loader}/src` · `ui-sidebar-right` 契约文件与两个 controller 签名。
**槽位无任何删除；无 Remote 方法 / 事件 / 命令 id 改名或删除**（`packages/api` 仅 3 个源文件变动，`packages/host`、`packages/web`、`packages/sdk`、`apps/web` **零源码改动**）；`patches/` **零改动**；工具链版本（`pnpm@11.7.0` / `node ^22.19.0 || >=24` / `tsdown ^0.22.2` / `vitest ^4.1.8` / `typescript ^6.0.3` / `oxlint 1.76.0`）**全未变**。我方 61 个偏离文件中 **46 个上游完全未动**。

---

## 4. 我方偏离面 × 新区间 = 重合并测算

### 4.1 总量与重叠

| 项 | 值 |
|---|---|
| 我方偏离面（`kcoder/0.2.0-rc.2` vs `dsh-v0.2.0-rc.2`） | **61 文件**（清单 `.tmp/upgrade-0.2.1/divergence-rc2.txt`） |
| 其中同时被新区间改动 | **15 文件** |
| **必然冲突（`git merge-tree --write-tree` 实测 exit 1，树 `40dec8f192`）** | **3** |
| 可能冲突 | 1（`session-projection-cache/README.i18n.yaml`：内容派生哈希，双方各改一处语义 → 须跑 `verify-translation-pairing`） |
| 自动合并 | 11 |
| 无 modify/delete 冲突 | 上游区间 489 删除 ∩ 我方 61 = **空**；570 重命名 ∩ 我方 = **空** |

**理想签名已在试算树上预先达成**：`git diff --name-only 40dec8f192 5badb15009 | wc -l` = **61**，与我方 61 文件清单 `comm -3` **为空**；15/15 重叠文件的 blob 均 ≠ 上游 ⇒ **没有任何一处我方改动被静默吞掉**。

### 4.2 三个必然冲突与预定解法

| # | 文件 | 冲突内容 | 处置规则 |
|---|---|---|---|
| 1 | `packages/client/ui-plugin-manager/src/client/index.ts` | 我方把 children 抽成 `pageChildren` 常量；上游在同位点新增子槽键 `plugins.add.actions` | 保留 `children: pageChildren`，把 `'plugins.add.actions': {kind:'list',scope:'root'}` 加进 `pageChildren`；保留上游新增类型导出 `PluginAddActionsProps`；`rendersExistingChildren` 分支不改 |
| 2 | `packages/workspace/workspace/package.json` | 我方加 `dsh-fs`（+`dsh-shell` 在冲突区外已自动保留）；上游删 `dsh-invariants` | peer/dev 两处保留 `dsh-fs`、丢弃 `dsh-invariants`；上游的 `version` 戳、删 `./invariant` 导出、`files` 删 `lib/invariant.js` **已自动采纳**（已核验） |
| 3 | `pnpm-lock.yaml` | 双方各改 | 以上游锁为底，回填 (a) pi-ai 补丁哈希 `8d2124eb…`（**勿被上游/基线值 `b9bcce47…` 覆盖**）(b) `dsh-fs`/`dsh-shell` 链接；再 `CI=true pnpm install --no-frozen-lockfile`。**禁止删锁全量重解**（rc.2 轮有 zod 双实例教训） |

### 4.3 pi-ai 线与补丁存活

| 项 | 结论 | 证据 |
|---|---|---|
| pi-ai 版本 | 上游**未升** | 两侧 `packages/llm/llm-pi-ai/package.json:44` 均 `^0.87.1`；`git log 639ed01539..5badb15009 -- patches/` 为空 |
| 我方补丁 | 上游基线补丁的**严格超集**（7 vs 6 个 dist 文件，多 `openai-codex-responses.js` 的 relay 兜底），合并树 blob 与我方**逐字节相同**（`sha256 9267c10f…`） | ⇒ **relay 三修复无需重做/让位** |
| 唯一风险 | 锁文件里的补丁哈希 `8d2124eb…` | S1-GATE 有专门断言（C8） |
| 7 个 `upstream/*.patch` | 活载体**全部存活、无一需 rebase**（0002 已退役；0003/0004 活载体已迁至 0.87.1 补丁文件且上游零改） | 逐 patch 核对 |

### 4.4 重放方案（建议）

```bash
cd /Users/libing/kk_Projects/deepseek-harness
git fetch origin && git fetch upstream --tags
git checkout -b kcoder/0.2.1-alpha.1 5badb15009ae1756c3afe0ae0cef1faafc290ccc
git merge --no-ff kcoder/0.2.0-rc.2      # 整支重放；旧分支保留为回滚锚
```

**为什么 merge 而非 rebase**：重叠仅 15、冲突仅 3，而 rebase 要把一次可控的树合并拆成 56 次重复解冲突（含 6 个历史 merge）。rc.1/rc.2 两轮同法已验证。

---

## 5. P0 专题：两个**静默失效**机制

### 5.1 P0-1：调度组合包被上游退役，我方仍钉着它

**上游侧证据链**

| 环节 | 证据 |
|---|---|
| 包被移除 | `packages/experimental/schedule-bundle` 整目录删除；`git ls-tree -r 5badb15009 packages \| grep schedule-bundle` 为空 |
| 不再随安装提供 | `OPTIONAL_BUNDLES`：rc.2 `packages/boot/app-boot/src/profile.ts:213-218`（含它）→ alpha.1 `:223-228`（**被 `experimental-inspector-profile` 取代**） |
| **主动摘除机制** | `profile.ts:206-210` `RETIRED_BUNDLES = new Set(['@deepseek-ai/dsh-experimental-schedule-bundle'])`；`:663-674` `dropRetiredBundles()` 过滤并从 manifest 删除**并 `writeProfileManifest` 回写**；`:738` 在 `loadProfileDirectory` **第一步**执行；提交 `9633724b40` |
| 能力去向 | `bundle/web-app/cordis.patch.yml:139-140`（`schedule`）、`:389-390`（`ui-schedule`）；提醒工具迁到 preset 作用域的 `@deepseek-ai/dsh-tool-schedule`（`packages/schedule/tool-schedule/src/index.ts:446`），仅 standard/cordis/ptc 声明、极简与子代理 deny（`699f1a8dc1`） |
| 官方指南 | `docs/upgrade-guide/v0.2.0-rc.2/schedule-bundle-retired/guide.zh.md`（明写"由其他工具写入的 profile 目录需要自行删除该条目"） |

**我方侧证据**

| 环节 | 证据 |
|---|---|
| 声明 | `D/preset-plugins.ts:122` `'@deepseek-ai/dsh-experimental-schedule-bundle': '0.2.0-rc.2'`（`:105-121` 是大段"必须与引擎逐版本同线"的踩坑注释） |
| 现网实值 | `~/.coder/profiles/web/package.json` 的 `dsh.profile.bundles` **确实含**该名（实测 12 行列表） |
| npm | 该版本**仍在架**（止于 `0.2.0-rc.2`）→ 不会安装报错 |

**后果（精确表述，避免夸大）**：由于 `dropRetiredBundles` 在**组合层构建之前**执行，该 bundle 的 patch 永远不会应用 ⇒ ① 不会出现"插入重复行"或启动卡死；② 但**每次启动都会发生一次 manifest 互写**（我方宿主写入 → 引擎删除并回写），③ 插件管理页会看到一个"选中但没有包持有/`not-bundle`"形态的条目，④ 该包继续随 profile 安装（死重量 + 其三个子包 `dsh-schedule`/`dsh-time-context`/`dsh-client-ui-schedule` 的 `0.2.0-rc.2` 版本被拉进依赖树）。
> ⚠️ 这与 rc.2 那轮的 P0（Loader 永不结算 → 无 ready 行 → 60s 超时）**机制不同**：那轮是"行被禁行但组件仍等待服务"；这轮是"层被整块摘除"。所以判它是**必修的震荡/错误状态**，而不是"必然启动卡死"。

**修复动作**：删 `D/preset-plugins.ts:122` 一行 + 把该名加入 `RETIRED_PRESETS`（三清自愈：deps 声明 / `dsh.profile.bundles` 层叠项 / node_modules 实体），并更新相邻注释结论；`D/product-policy.ts:48-52` 关于"策略层不再持有三行"的注释**保留**（结论仍正确）。

### 5.2 P0-2：内置插件 bundle 的 peer 上界把新引擎挡在门外

**机制**：`packages/boot/app-boot/src/profile.ts:753-757`（在 `loadProfileDirectory` 的 bundle 循环里）

```ts
// A bundle is not a plugin row, so row admission never reads its own peers.
const issue = evaluatePluginCompatibility(bundleManifest, exemptions)
if (issue !== undefined && !issue.exempted) throw new Error(pluginCompatibilityWarning(issue))
```
抛错被 `catch` 收进 `skippedBundles` → `reportSkippedBundles`（`profile.ts:118-122`）在启动时打印一行
`dsh: skipping profile bundle "<name>": <reason>`（调用点 `apps/cli/src/profile-boot.ts:170`、`apps/desktop-host/src/index.ts:24`）。
判定逻辑 `plugin-compatibility.ts:77`：`semver.satisfies(runtimeVersion, requirement, { includePrerelease: true })`，runtime 版本 = 引擎自身版本（`app-boot/package.json`）。
配套：行级闸门 `compatibility-preflight.ts:82` 打印 `disabling profile plugin row "<id>"`（另有一条独立路径）。

**实测（semver 7.8.5，KCoder 仓内真跑）**

| 运行时 | 范围 | satisfies |
|---|---|---|
| `0.2.0-rc.2` | `<0.2.0` | **true** ← 一直侥幸通过的原因 |
| `0.2.1-alpha.1` | `<0.2.0` | **false** ← 跨过 `0.2.0` 即失守 |

**我方五个内置 bundle 逐个求值（`bundle/*/package.json` 实读，全部确认 `dsh.bundle.patch` 在位）**

| bundle | 版本 | 引擎 peer | `0.2.1-alpha.1` |
|---|---|---|---|
| `dsh-coding-sidebar` | 1.0.36（真源 1.0.38） | `>=0.1.7-rc.2 <1.0.0` | ✅ |
| `@kkutysllb/dsh-terminal` | 1.2.1 | `>=0.1.6-alpha.2 <0.2.0` | ❌ **整包被跳过** |
| `dsh-ssh-remote` | 0.1.3 | `>=0.1.0-rc.5 <0.2.0` | ❌ **整包被跳过** |
| `dsh-skills-bundle` | 1.0.3 | 无引擎 peer | ✅ |
| `dsh-shell-prefs` | 1.0.1 | 无引擎 peer | ✅ |

**用户可见后果**：内置终端 UI（侧栏终端 tab 的提供者）与 SSH 远程世界（远端主机/远端工作区）**整块消失**，且**不报错、不崩溃**——只有 stderr 的一行 `skipping profile bundle`。

**5.2.3 家族级波及**（同口径实测）：`dsh-animations@1.2.3`、`dsh-super-ppts@1.4.5`、`dsh-video-generator@2.0.2`（`<0.2.0 || >=3.0.0 <4.0.0`）同样不满足；`dsh-kylin-{memory,vibe,automation}` 用 `*` 不受影响；`dsh-coding-sidebar` 安全。⇒ 本次要立的是**一条家族级 peer 口径**（建议统一 `>=<当前下界> <1.0.0`，与 D5 先例同形），分两档：内置两件（阻断发布）→ 家族其余（阻断用户体验）。

**逃逸舱（不推荐）**：profile 级 `compatibility.json`（`profile-compatibility.ts:11` 定义文件名）允许按**精确** `name@version` → **精确** runtime 版本授权豁免；缺点是每次引擎升版都要重授、且把口径藏进用户目录。正解仍是改 peer 范围 + 升版本 + 重发。

### 5.3 由此得到的**启动/回归验收判据**（写进实施计划的门）

1. stderr **不得**出现 `skipping profile bundle`（P0-2 的指纹）；
2. stderr **不得**出现 `disabling profile plugin row`（行级闸门的指纹）；
3. `dsh.profile.bundles` 在**两次连续启动后稳定**（不出现互写振荡）且不再含 `@deepseek-ai/dsh-experimental-schedule-bundle`（P0-1 的指纹）；
4. stdout 出现 ready 行（沿用 rc.2 轮的 `dsh web: http://` 判据）；
5. 功能在位：内置终端可开、SSH 远程主机可解析、侧栏「任务计划」可用（schedule 现由 web-app 原生提供）。

---

## 6. 自研内置插件升级点（技能 / MCP / 侧边栏 / 终端）

### 6.1 技能线（Skills）：**零改动**

| 断言 | 证据 | 判定 |
|---|---|---|
| `packages/skill/**` 区间 28 文件，27 个是 README/package.json | 唯一非版本文件 `skill-office/tests/skill-office.spec.ts`（期望 0.1.1→0.1.5） | 仅 bump |
| `src/**` | `git diff --stat … -- 'packages/skill/*/src'` → **空** | 零改动 |
| `ctx.skills.register()` | `skill/skill/src/index.ts:439`；`SkillRegistration` `:95-100`；字段 `SkillSummary:57-74` | 未变 |
| `registerProvider()` | `:390`；`validateCandidate` `:707` | 未变 |
| rank 常量 | 100/200/300/400/500（`skill-filesystem/src/index.ts:36-40`）、`RUNTIME_RANK=250`（`skill/src/index.ts:25`）、`BUNDLED_SKILL_RANK=600`（`:28`） | 与我方 100/200/400/500 约定一致，值未变 |
| 我方 `B/dsh-skills-bundle` | `entry.js:22` `inject=['skills']`、`:48-56` 传 5 字段、不传 rank → 落 250、自剥 frontmatter（`:34-39`）；`package.json` **无 `./invariant`** | 兼容 |
| 宿主侧 | `D/kcoder-skills-bundle.ts:120-121`、`D/skills-catalog.ts:152,169-170,190`、`D/skills-settings.ts:175-176` | 兼容（目录与优先级与上游一致） |
| `.agents/skills` 7 文件 | 全部 `M`（修改）零新增，是上游自己仓库的维护者技能；载体 `skill-filesystem/src/index.ts:251`（base/head 同行） | 与我方注册无关 |
| 模式门控 | 本区间唯一新增门控是 4 个 schedule 提醒工具（`699f1a8dc1`）；极简预设工具表仍仅 `bash`（快照未变） | 技能侧无门控变化 |

### 6.2 MCP 线：**零改动**

| 断言 | 证据 | 判定 |
|---|---|---|
| `packages/mcp/**` 11 文件全是 README/package.json，**零 `src`** | `git diff --name-status` | 仅 bump |
| 服务名正则 | `mcp-client/src/index.ts:12` `SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/` vs 我方 `D/mcp-store.ts:56` | **逐字符相同** |
| transport 判别联合 | `StdioConfig :53-77` / `StreamableHttpConfig :80-103` vs 我方 `mcp-store.ts:33,121,182,203` | 一致 |
| 可选字段 | `ConfigInput` 把 `args/env/cwd/toolCallTimeoutMs/failOnStartupError` 置 `Partial :105-110` | 我方 `plainEntry():186-201` 合法且**向后兼容** |
| 引用形态 | 我方用**裸包名** `@deepseek-ai/dsh-mcp-client`（`mcp-store.ts:53,192`）⇒ 不受 D2 子路径规则影响 | 兼容 |
| 上游预置 | `packages/bundle/web-app/**` 对 mcp **零命中** | 无争抢 |
| 我方内建 5 个 MCP server | `D/mcp-builtin.ts:57-130` 全是第三方包（uvx/npx），状态文件自有（`:135`） | 不依赖上游被改面 |
| 子代理/极简的门控 | 三条 presets 的 `toolFilter.deny` 只列 4 个 `schedule_*` | 无 mcp 门控变化 |

### 6.3 侧边栏线（`dsh-coding-sidebar`）与宿主注入面

| 断言 | 证据 | 判定 |
|---|---|---|
| slot 机制冻结（第三轮） | `packages/client/ui-slots/src` tree SHA 两 tag **同值** `cce09249d61824300c6525a681a4cabcfdd83aac`（该包区间仅 README/package.json 变动） | ✅ |
| 我方注册的两个 slot | `B/dsh-coding-sidebar/src/client/index.tsx:465-466`（`settings.section`）、`src/client/intercept.tsx:221`（`conversation.chat.turnTail`）；引用数 rc.2→alpha.1：**35→35**、**135→139**（新增 inspector/settings 页） | ✅ |
| `deliverables.file.actions` | 两 tag 均 18 处、文件集相同 | ✅ |
| 右栏 API（我方包装面） | `ui-sidebar-right/src/client/service.ts:209,216,322` 两 tag **同行号同签名**（`openResource`/`openTab`） | ✅ 包装器继续有效 |
| `ui-chat/src/client/contract` | **本轮有变**（rc.2 那轮逐字节同）：仅 `contract/snapshot.ts` +2/−2（多导出一个类型 `ToolArgs` + 改注释），**slot 声明未动** | ✅ |
| 组合插件页 UX 重构（A2/C2/C5） | `ui-plugin-manager/src/client/{index,locales}.ts` 属分叉面 → 冲突；`D/style-overlay.ts:22,160` 的页内锚点需复核 | 🟠 |
| 输入契约（A3） | `ui-conversation/src/client/contract/input.ts` 改动；我方客户端半依赖该包契约面 | 🟠 待实测 |
| `./invariant` 移除（D3） | 见 §6.4 | 🟢（死声明清理项） |
| peer | `>=0.1.7-rc.2 <1.0.0` | ✅ 覆盖新引擎 |
| **全量 slot 名表对账** | D2 逐名比对 200（alpha.1）vs 198（rc.2）：**移除 0 条，仅新增 `shell.bottom` / `plugins.add.actions`**——上游本版"只加洞不删洞" | ✅ |
| `settings.section` 宿主侧 | `packages/settings/settings/src` 树 SHA 两侧同为 `23bc880e…` | ✅ |
| `conversation.chat.turnTail` 契约 | `ui-chat/src/client/contract/slots.ts` blob 两侧同为 `5c7a8e37…`，`TurnTailOwnerProps` diff 为空 | ✅ |
| 我方对上游的 24 个依赖 | D2 逐个分类：**只有 `@deepseek-ai/dsh-client-ui-conversation` 是真实客户端契约 import**（且仅 `SlotMap` 类型），其余为 `import type` 或结构性自镜像 | ✅ 契约面极窄 |
| 右栏 reveal 行为 | `8463abc59d` 有 9 行**行为**改动（页地址型 open 改走 `findPaneContentTab` + pane 局部揭示）；我方是**包装者**、不改 reveal 算法 | 🟢 不阻断 |
| **物化版本滞后（须修）** | `bundle/dsh-coding-sidebar` 实体停在 **1.0.36**，preset 声明 `^1.0.36`（`D/preset-plugins.ts:186`），真源已 **1.0.38**；`git diff --stat 0670ba1..HEAD -- src/` = **43 文件 / +3714 −278**（含 1.0.37 后台作业输出 + 1.0.38 页签标题 i18n） | 🟠 **升级动作**：物化 1.0.38 + 声明 `^1.0.38`（计划 S2/S3） |

### 6.4 终端线（`dsh-terminal`）+ SSH 远程线（`dsh-ssh-remote`）

| 断言 | 证据 | 判定 |
|---|---|---|
| **引擎 peer** | `@kkutysllb/dsh-terminal@1.2.1`：`>=0.1.6-alpha.2 <0.2.0`；`dsh-ssh-remote@0.1.3`：`>=0.1.0-rc.5 <0.2.0` | **🔴 §5.2** |
| 上游终端面改动 | `packages/terminal/**` 12 文件、`api/terminal-controller`、`ui-sidebar-terminal`；我方 `dsh-terminal` 自包含（自有 RPC `/dsh-terminal/api/*`、自有 shell 探测），**不消费** `remote.terminal.*` | 与 rc.2 轮同结论 |
| `ui-sidebar-terminal` 产品策略 | 我方仍整行禁用（`D/product-policy.ts:94-95`），前提（上游静态 import + 无条件 `$mount`）需在 S5 复核 | 待复核 |
| `dsh-shell-prefs` | 1.0.1，无引擎 peer | ✅ |
| SSH 四件套 provider | `D/preset-plugins.ts:216-219` 声明 `@deepseek-ai/dsh-{ssh,fs-ssh,subprocess-ssh,sandbox-ssh}`；npm 上四者均有 `0.2.1-alpha.1` | ✅ 可随线平移 |
| `./invariant` 移除（D3，**编码侧**） | `B/dsh-coding-sidebar/package.json:20-23`（export）、`:62`（`files`）、`:166`（devDep `@deepseek-ai/dsh-invariants: 0.2.0-rc.1`）；`src/invariant.ts` 是**空操作**伴随插件（`install = () => {}`，仅 `ctx.invariants.register`，`inject=['invariants']`），`src/context-types.ts:662,775-776` 手写镜像服务面；`D/plugins.ts:66` 列进 `DS_HOST_PEER_FALLBACK` | 🟢 **运行期无影响，且证据比"没有 patch 行"更强**：伴生插件**不是自动发现，必须按行显式 mount**——rc.2 全仓唯一 mount 点在 `packages/bundle/sdk-minimal/cordis.patch.yml:106-119`，**交付的 web/base 配置树从不 mount 它**（本机实证：`~/Library/Application Support/KCoder/kcoder-runtime` 的 `dsh-web-app`/`dsh-base` patch 里均无 invariant 行）；且我方引用是 **devDependency**（非 dependencies/peer）、`lib/invariant.js`（988 B）产物**无任何顶层 import `dsh-invariants`** ⇒ 不装进 profile、不参与 peer 闸门、服务不存在时 Cordis 直接不实例化。属**必清死声明**（插件仓下次对新引擎 `tsc` 会因缺 `invariants` 服务类型而失败），非阻断 |
| `DS_HOST_PEER_FALLBACK` 名单 | 20 项逐名核对：19 项存活；`@deepseek-ai/dsh-invariants` 在本区间消失；`@deepseek-ai/dsh-client-runtime` 自 rc.2 起就是陈旧条目（既有债） | 🟡 清理两行 |

### 6.5 产品策略层（`product-policy.ts`）：**七个覆写行 id 全部存活**

| id | rc.2 引用数 | alpha.1 引用数 |
|---|---|---|
| `session-log-deepseek` | 19 | 19 |
| `ui-sidebar-terminal` | 1 | 1 |
| `ui-sidebar-browser` | 4 | 4 |
| `ui-deliverables` | 1 | 1 |
| `ui-settings-session-log` | 1 | 1 |
| `desktop-product-telemetry` | 1 | 1 |
| `product-analytics` | 1 | 1 |

⇒ **YAML 内容零改动**；只需在 `preset-plugins.ts` 侧做 P0-1 的删除，以及（B4 相关）实测 preset 默认值变化后出厂首启的呈现。

### 6.6 宿主注入锚点小结

| 注入面 | 本区间风险 | 依据 |
|---|---|---|
| `brand-injector.ts` 运行态文案 | 🟢 锚点逐字节未变 | `RunningStatus.tsx:28,33`、`locale.ts:89,90,282,283` 两 tag 同内容（D2 复核：`'Deep diving'` / `'Deep diving for {duration} ···'` 逐字相同） |
| 其它文案/结构锚点 | 🟢 **全部存活且位置未变**（D2 逐个核） | `[data-chat-running]`（`RunningStatus.tsx:32` 同行）· `titleGroup`/`previewBadge`/`fish`（`EmptyHero.tsx:152,155` + `HeroShell.module.css:51,62`，两文件 diff 为空）· `[data-sidebar-right-expand\|panel\|session]` · `[data-rightbar-col]` · `[data-side='rightbar']` · settings 对话框双保险 · `[data-phase='hero']` 系 · `sidebarCol` · `logoRow`/`toggle`/`newSession` · `[data-slot="…header.actions"]` · `[data-conversation-composer-overlay]` |
| `style-overlay.ts`（主题覆写 + panellist 恢复） | 🟠 上游插件管理页 DOM 重构（A2/C2/C5）→ 页内锚点需复核；**样式存留风险已由上游修复消除**（§3.2） | `ui-plugin-manager/src/client/{index,locales}.ts`；`system.ts:66-71` |
| `sidebar-toggle.ts`（图标字形 + 轨道判据） | 🟢 **不阻断**：`ui-primitives/src/icons/index.tsx` **逐字节未变**（`IconPanelLeftOutline16` 字形/viewBox 无变化）；`AppFrame` 新增的 bottom 行**未改列数**（inline `grid-template-columns` 不变）⇒ `sidebar-toggle.ts:265-272` 的「`tracks.length === 3`」仍成立、空 bottomRow 解析为 0 高 | 分析文 §3.3(b)；可选硬化见计划 P2 |
| `sidebar-cluster.ts` | 🟢 与上游无关 | `[data-dsh-toggle-cluster]`/`toggleButton` 是**插件自有属性**，上游两侧零命中 |
| `plugins.ts` / `preset-plugins.ts`（账本与策略） | 🔴 P0-1（调度行）+ 🟡 陈旧名单 | §5.1、§6.4 |
| `dsh-contract.ts`（启动契约/分支名） | 🟠 分支名字面量需改；CLI flag 面 🟢 | §3.1 |

---

## 7. 风险清单与升级动作建议（**不改码，仅列项**）

### 7.1 必做（P0）
1. **删 `D/preset-plugins.ts:122` 并把该名加进 `RETIRED_PRESETS`**（P0-1）。
2. **加宽两件内置 bundle 的引擎 peer 到 `<1.0.0` 并重发**：`dsh-terminal` → 1.2.2、`dsh-ssh-remote` → 0.1.4（P0-2）；同步 bundle 物化 + `PRESET_PLUGINS` 版本线。
3. **重建集成分支 `kcoder/0.2.1-alpha.1`**（整支 merge 重放，3 冲突按 §4.2 预定规则解）。
4. **字面量平移**：`upstream/BASELINE`（首行 SHA，实测在 `:401`）+ 追加升级记录；`scripts/setup.sh:16`、`scripts/release.sh:132,136,137`、`D/dsh-contract.ts:54,61` → `kcoder/0.2.1-alpha.1`。
5. **dev profile 重新物化**并以 §5.3 五条判据验收（stderr 两句话 + bundles 稳定 + ready 行 + 三功能在位）。
6. **侧边栏物化补齐**：`bundle/dsh-coding-sidebar` 1.0.36 → **1.0.38** + `D/preset-plugins.ts:186` 声明 `^1.0.36` → `^1.0.38`（D2 实测真源领先 43 文件 / +3714 −278：1.0.37 后台作业真实输出 + 1.0.38 文件页签标题 i18n；**这些修复当前用户拿不到**）。

### 7.2 应做（P1）
6. **B5 样式归属回归**（插件页停用再启用内置插件，检查其他插件样式与我们的覆写层）——最高优先的实测项。
7. **D3 死声明清理**：真源插件仓删 `./invariant` export / `files` 条目 / devDep / `src/invariant.ts` / `lib/invariant.js` / `context-types.ts` 镜像面；`D/plugins.ts:66` 删 `dsh-invariants`（连同 `dsh-client-runtime` 这条既有陈旧项）。
8. **B10/C5 面回归**：内置 5 bundle 的启用/停用/更新 + 偏好设置页卸载按钮（`removable` 语义变化）。
9. **A3 输入契约实测**：侧栏客户端半在新 `contract/input.ts` 下是否正常（若不匹配可能升级为 🔴）。
10. **A2/C2/C5 冲突解完后复核 `style-overlay.ts` 的页内锚点**（`ui-plugin-manager` 页 DOM 结构变化）。
11. **发布说明补段**：v0.6.x 记双锚定（rc.2 → alpha.1）+ 能力变化（调度改 Web 内置、invariant 诊断面移除）+ 插件版本线变化。
12. **家族 peer 口径**：按 §5.2.3 立一条统一规则并排期其余三件（animations / super-ppts / video-generator）。

### 7.3 建议（P2）
13. **`--public-url` 能力评估**（A5）：若将来要支持反向代理/对外地址入口，这是官方通道。
14. **可选开发者工具包**（A6）：新 `inspector-profile` 已进 `OPTIONAL_BUNDLES`，是否在 KCoder 插件页开放给用户（默认关）。
15. **官方 4 份升级指南**在 S5 逐份复核一遍（我方自查已过，留证）。
16. **`node-addon-require-builtin@^0.1.6` 观察**（`boot/hmr` 新增原生 addon，monkey-patch Node 内部）：在 Electron 44 / Node 24 下加载是否正常——我方不使用 HMR 目录监听，但该 addon 随引擎闭包物化（§3.3(d)、§9#9）。
17. **`shell.bottom` 引起的一次硬化机会**：`sidebar-toggle.ts:265-272` 现按"列数 === 3"判据工作，本版未破；建议改为属性锚（`[data-shell-bottom]`/`[data-slot]`）以防未来网格再变（§3.3(b)）。
18. 若 invariant 死声明清理不在本轮做，则至少在插件仓建一条 issue 记录"对新引擎 `tsc` 会失败"（`src/context-types.ts` 的 `invariants` 镜像面）。

---

## 8. 复现命令清单

```bash
R=/Users/libing/kk_Projects/deepseek-harness      # 只读使用
A=639ed01539; B=5badb15009

# 区间与结构
git -C $R rev-list --count $A..$B                                  # 266
git -C $R diff --shortstat $A $B                                   # 4190 files, +51032 −32761
comm -13 <(git -C $R ls-tree -r -t --name-only $A -- packages | awk -F/ 'NF==3' | sort -u) \
         <(git -C $R ls-tree -r -t --name-only $B -- packages | awk -F/ 'NF==3' | sort -u)   # 新增 5 包
comm -23 <(git -C $R ls-tree -r -t --name-only $A -- packages | awk -F/ 'NF==3' | sort -u) \
         <(git -C $R ls-tree -r -t --name-only $B -- packages | awk -F/ 'NF==3' | sort -u)   # 移除 5 包

# P0-1：退役机制
git -C $R show $B:packages/boot/app-boot/src/profile.ts | grep -n -A6 'RETIRED_BUNDLES'
git -C $R show $B:packages/boot/app-boot/src/profile.ts | sed -n '732,760p'      # drop 在组合之前
git -C $R log --oneline $A..$B -S'RETIRED_BUNDLES' -- packages/boot/app-boot/src/profile.ts
git -C $R show $A:packages/boot/app-boot/src/profile.ts | sed -n '213,218p'      # rc.2 的 OPTIONAL_BUNDLES
git -C $R show $B:packages/boot/app-boot/src/profile.ts | sed -n '223,228p'      # alpha.1 的

# P0-2：peer 闸门（组合包级 vs 行级）
git -C $R show $B:packages/boot/app-boot/src/profile.ts | grep -n -B2 -A6 'A bundle is not a plugin row'
git -C $R show $B:packages/boot/app-boot/src/profile.ts | grep -n -A6 'function reportSkippedBundles'
git -C $R show $B:packages/boot/app-boot/src/compatibility-preflight.ts | sed -n '78,86p'
node -e "const s=require('semver');console.log(s.satisfies('0.2.1-alpha.1','<0.2.0',{includePrerelease:true}))"   # false

# 我方五个 bundle 的 peer 求值
cd /Users/libing/kk_Projects/KCoder
node -e "const s=require('semver');for(const d of ['dsh-coding-sidebar','dsh-terminal','dsh-ssh-remote','dsh-skills-bundle','dsh-shell-prefs']){const j=require('./bundle/'+d+'/package.json');const bad=Object.entries(j.peerDependencies||{}).filter(([k,v])=>k.startsWith('@deepseek-ai/dsh')&&!s.satisfies('0.2.1-alpha.1',v,{includePrerelease:true}));console.log(j.name,j.version,bad.length?'STALE':'ok')}"

# 契约冻结
for t in $A $B; do git -C $R rev-parse $t:packages/client/ui-slots/src; done        # 同值
for t in $A $B; do git -C $R diff --stat $t^ $t -- packages/client/ui-chat/src/client/contract; done

# npm 事实
npm view @deepseek-ai/dsh-experimental-schedule-bundle versions --json | tail -3
npm view @deepseek-ai/dsh-invariants versions --json | tail -3
npm view @deepseek-ai/dsh-tool-schedule dist-tags --json
```

---

## 9. 遗留与未决

| # | 项 | 状态 |
|---|---|---|
| 1 | **B5 样式归属对内置 bundle 的真实影响**（A/B/D2 三方均判 🟠，依据是"4 个 bundle 带客户端半"这一事实推理，**均未实跑**） | **待 S5 首条回归**（计划 §9 第 1 项） |
| 2 | ~~A3 输入契约可能 🟠→🔴~~ | **已收敛**：我方 `conversation-draft.ts` 走 `input.for(actx)` 的 `getSnapshot().draft`（**仍是 `string`**）+ `setDraft(text)`（**仍存在**）；`bindDraftMirror→bindDraftPersistence` 那个 inject 面**我方零实现**。剩余待实测项：新增 `persistDraft()` 后程序化写入的持久化时机（§3.3(a)#2） |
| 3 | ~~`sidebar-toggle.ts` 图标字形锚点~~ | **已关闭**：`ui-primitives/src/icons/index.tsx` 逐字节未变；`AppFrame` 新增 bottom 行未改列数 ⇒ 轨道判据仍成立（可选硬化登记为 P2） |
| 4 | ~~`dsh-terminal` 上游面未逐行核~~ | **已关闭**：D2 逐项核完——`packages/terminal/**`、`api/terminal-controller`、`ui-sidebar-terminal`、`subprocess-local` 的**非 README/package.json 文件数 = 0**；`dsh-terminal` 自包含（自有 `/dsh-terminal/api/*`，唯一上游 import 是 `dsh-subprocess-local`，**零命中** `remote.terminal.*`/`discoverShells`） |
| 5 | 15 个重叠文件中 `package.json` 类（`workspace-controller`/`directory-picker-browse`）大概率仅版本号行 | C 已给上界；S1 现场确认 |
| 6 | ~~`agent-preset-registry` 移除导出的触达面~~ | **已关闭**：`D/**`+`S/**` 对 `livePresetMounts`/`standingMountFor`/`serviceForAgent`/`JoinedPresetMount` **零命中**（D1 + B 双向确认） |
| 7 | `verify-package-dependencies` 在 invariants 删除后是否仍 exit 0（上游自己的 `docs/dependency-catalog.json` 仍含 2 处 `dsh-invariants`） | S1-GATE 观察（若红则记上游遗留，不阻塞我方） |
| 8 | npm `dist-tags.latest/next` 仍指旧线（`latest` 甚至指 `0.0.1-rc.1`），profile 安装必须显式指定版本 | 已知；我方物化走 bundle，不依赖 latest |
| 9 | **`node-addon-require-builtin@^0.1.6`（`boot/hmr` 新增原生 addon）在 Electron 44 / Node 24 下能否加载**（它 monkey-patch Node 内部：`internalBinding('modules')`、ESM resolve cache、CJS `_pathCache`） | **未实测**（B 的 U1/U2）；我方不用 HMR watch，但该 addon 随引擎闭包物化 → S4/S5 观察 |
| 10 | **`experimental/inspector` 失去 `dsh.bundle` 后旧选择的落点**（组合包角色搬去 `inspector-profile`；官方**只给了 schedule-bundle 的迁移指南，没给 inspector 的**） | 未决；我方未声明该包，仅登记 |
| 11 | `B4`（PTC/极简默认改 standard、coding-tools 关闭时的 preset 可见性）对我方**出厂首启 preset 呈现**的影响 | 待 S5 实测（我方逐行覆写上游组合层） |
| 12 | fork 集成分支上的**引擎版本串**是否落在侧边栏 peer 上界内（`<1.0.0`；若 fork 打 `1.0.0` 会顶到上界） | 归口 S5（我方 fork 版本串沿用上游 tag 线，预期安全） |
| 13 | B 线汇总中"`ConversationStoreState.draft: string → DraftInput`"一处表述 | **已复核修正**：`InputState.draft` 两 tag 均为 `string`（见 §3.3(a) 的修正说明） |
