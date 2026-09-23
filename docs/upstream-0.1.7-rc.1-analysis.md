# 上游 deepseek-harness 0.1.7-alpha.2 → 0.1.7-rc.1 差异分析

> 分析日期：2026-09-23 · **仅分析，未改动任何产品代码**
> 消费形态：KCoder v0.6.15（桌面壳）+ 五个自研内置插件（技能 / MCP / 侧边栏 / 文件审查 / 终端）
> 前置分析：[`upstream-0.1.7-alpha.1-analysis.md`](./upstream-0.1.7-alpha.1-analysis.md) · [`upstream-0.1.7-alpha.2-analysis.md`](./upstream-0.1.7-alpha.2-analysis.md)
> 官方发布说明：[`dsh-v0.1.7-rc.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-rc.1)（2026-09-23 21:30 发布）
> **本次包含一节决策记录**：§10「插件退役评估——已评估，决定不退役」

---

## 0. 一句话结论

**rc.1 是 0.1.7 系列的第一个候选版，它带来一项此前没有的「硬门禁」——DSH peer 版本兼容性检查（已在插件启动、bundle 加载、安装三个环节强制），同时把工具调用生命周期从两态改成三态（preparing/start/result），这是本版对第三方插件最大的契约冲击。但我们五个插件逐一核对后：全部不受影响、无需改动。**

- **好消息（已逐条实测）**：① **新的 peer 兼容性门禁不咬我们**——五个插件声明的 DSH peer 范围（`^0.1.7-alpha.1` / `>=0.1.0-rc.5 <0.2.0`）对运行时 `0.1.7-rc.1` **全部 PASS**（已用上游同版本 `semver@7.8.5` + `{includePrerelease:true}` 复现门禁判定）；② `ui-slots` 本版**仍为版本戳零变化**——槽位契约连续第三版稳定；③ `ui-sidebar-right` / `ui-sidebar-files` / `ui-sidebar-terminal` / `ui-sidebar-browser` / `ui-dockkit` / `ui-open-in-app` / `ui-plan` 源码**逐字节零变化**；④ 我们**不注册** `tool.call.toolview` 槽位，因此本版最大的破坏性变更（`ToolCallOwnerProps` 拆分）不适用；⑤ 侧边栏/文件审查的 `argsRaw` 是自有数据模型字段，不读上游 `ToolCallBlock`。
- **坏消息 / 必须记账（3 条）**：① **peer 门禁是硬拒绝**——第三方 bundle 若声明过时 peer 范围，会在启动时被 `disabled:true`、在安装时被**在 pnpm 运行之前**拒绝（`incompatible-version`）；用户可授精确版本例外（需 `--accept-risk`）。我方现状安全，但**将来新增 DSH peer 时不能写成 `^0.1.7` 这种不含 prerelease 的范围**（实测 FAIL）；② **`ToolCallOwnerProps` 分裂为 `ToolCallCommonProps & ToolCallPhaseProps`**（`phase` 判别联合）——任何读 `block.argsRaw` 的上游 toolview **编译失败**，且 toolview 每调用由 2 次变 **3 次**；③ **`TranscriptViewMode` 重构**：`expanded` 退役、新增 `standard`/`verbose`，默认值 `compact`→`standard`，`stepGrouping` 联合新增 `'history'`。
- **两组「引入即撤销」**（易误记，已逐条复验，见下）：① `b09dd94827`↔`7c8a44ac31`（process-row polish）——**整体净零**，`git diff b09dd94827^ 7c8a44ac31 --stat` 为空；② `2aa3a469db`↔`3bf6d738f1`（agent-team）——**仅部分净零**：`2aa3a469db` 引入的 `session-projection/definitions-changed` 事件被后者删掉（`control.ts`、`docs/subsystems/session-projection.md`、README、测试两版差异**均为 0 行**，且该事件在 **alpha.2 与 rc.1 都不存在**），但两个提交整体仍有 79+/195− 留在树里（在 `TeamAction.tsx`/`mount.ts`/locales/测试等其它文件）。**纪律：`session-projection/definitions-changed` 不得写入任何文档或代码。**
- **总账**：156 提交（含 merge）/ **102 非 merge**：fix 52 · test 19 · feat 14 · docs 12 · perf 2 · release 1 · refactor 1 · revert 1。窗口 **约 22 小时**（2026-09-22 23:25 → 2026-09-23 21:03，跨一天）。
- **口径**：933 文件变更 → 剔除纯版本戳提交 `a60af51e80`（独占 312 个 package.json）→ **621 个真实变更文件**（其中 README/`.i18n.yaml` 142 个）。注：另有约 8 个文件仅含文档哈希改动，按「含真实 hunk」的更严口径可记为 629——本文统一用**可直接复现的 621**。
- **与 alpha.2 的量级对比**：alpha.2 是 102 非 merge / 869 文件（真实 509）/ 11 小时；rc.1 是 102 非 merge / 933 文件（真实 621）/ 22 小时。**提交数相同，但 rc.1 的 feat 是 alpha.2 的两倍（14 vs 7），实质内容更多。**

> **发布说明口径警告（重要）**：rc.1 的说明是 **`dsh-v0.1.5-rc.3 → 0.1.7-rc.1` 的累积说明**，不是 alpha.2→rc.1 的 delta。其中「侧边栏集成终端、网页、子智能体会话和提交计划…」等条目**我们在 alpha.1/alpha.2 阶段就已经消化过**（相关包在两版之间源码逐字节相同）。本文只把**真正新出现在 alpha.2 之后**的条目标为新账，其余标为「旧账复核」。

---

## 1. 对比口径

| 项 | 值 |
|---|---|
| 旧基线（当前消费态） | `00102833df` = 上游 tag **`dsh-v0.1.7-alpha.2`**（2026-09-22 23:25，merge PR #4978）· KCoder 集成分支尖端 `f12a7e9ff0`（已推 fork origin） |
| 新目标 | `46a7f68b09` = 上游 tag **`dsh-v0.1.7-rc.1`**（2026-09-23 21:03，merge PR #5073） |
| 集成分支 | `kcoder/0.1.7-rc.1` @ `a56eabbd02`（= tag + 单次 `merge --no-ff kcoder/0.1.7-alpha.2`；**已建并已推**，见 §8.1/§8.5）。注：fork 上另有历史遗留的 `kcoder/0.1.5-rc.1` 与 `kcoder/rc.1`，故本版分支名必须带 `0.1.7-` 前缀 |
| 提交量 | 156（含 merge）/ **102（非 merge）**：fix 52 · test 19 · feat 14 · docs 12 · perf 2 · release 1 · refactor 1 · revert 1 |
| 文件量 | 933 → 剔除 `a60af51e80` 的 312 个 package.json → **621 真实变更**（README/`.i18n.yaml` 142） |
| 变更行数 | +13851 −3101（含 snapshots/fixtures） |
| 变更最重的域 | `packages/client`（219）· `packages/experimental`（59）· `apps/web`（52）· `snapshots`（47）· `.agents`（41）· `docs`（38）· `packages/boot`（31）· `apps/desktop`（19）· `packages/extensions`（18）· `packages/api`（15） |
| `packages/client` 内最重 | `ui-chat`(40) · `ui-tool`(38) · `ui-primitives`(24) · `ui-conversation`(12) · `ui-deliverables`(9) |
| 四个簇 | **A** 聊天/工作过程/工具生命周期 · **B** 插件兼容性强制 · **C** agent-team/experimental · **D** preset/skill/document/office/desktop |
| 新增 pnpm patch | **无**（`patches/` 只**修改**了 2 个既有的 `@fortune-sheet/*` 补丁） |

---

## 2. 官方发布说明逐条 → 代码层核实

> 标记口径：【新账】= alpha.2 之后真正新增；【旧账复核】= 累积说明里已在前两版消化的条目，本版仅确认状态。
> 每条给出：发布说明摘要 → 代码落点（提交/文件）→ 对 KCoder / 五插件的影响。

### 2.1 新增功能

| # | 发布说明条目 | 口径 | 代码落点 | 影响 |
|---|---|---|---|---|
| N1 | 侧边栏集成终端、网页、子智能体会话和提交计划，支持文档/表格/文件改动预览与审阅；预览随会话或本地文件变化更新，可在系统应用中打开 | **旧账复核** | `ui-sidebar-terminal` / `ui-sidebar-browser` / `ui-subagent` / `ui-plan` / `ui-sidebar-documentpreview` / `ui-deliverables` / `ui-open-in-app`——**除 `ui-deliverables` 外，其余在 alpha.2↔rc.1 之间源码零变化** | **已被铁律 1 按「不使用」处理**；详见 §10 |
| N2 | 会话支持置顶、归档、筛选和恢复；归档运行中会话前提示受影响任务 | 旧账复核 | alpha.1 已消化（`ui-session` / `session-controller`） | 无新增 |
| N3 | 插件管理页支持安装、配置、启停、卸载，可选官方源/镜像/自定义源 | 旧账复核 + **本版强化** | 源选择在 alpha.2 已消化；**本版新增兼容性强制与镜像恢复**（§3.2） | 见 §3.2 |
| N4 | Agent Team 面板实时展示成员与任务，支持从会话页头查看切换 | **新账** | `1dc518f217`（面板改由 `agentTeam` 投影驱动）、`86e3e0e448`、`2b44a4b657` | KCoder 不装 Agent Team，无影响 |
| N5 | 实验性语音转写支持准备本地模型，可自动/手动选择下载源 | **新账** | `d40dbef91b`、`1498b01923`、`speech-to-text/model-sources.ts`（新增 `modelOrigins` 默认含 hf-mirror） | 实验线，不装 |
| N6 | MCP 支持资源读取与 URI 模板，兼容新版协议协商与工具分页 | 旧账复核 | alpha.1 已消化 | 无新增 |
| N7 | Headless 支持 stdin 任务、续接会话、JSON 事件；文件与命令工具可经 SSH 用远端工作区 | 旧账复核 | alpha.1 已消化 | 无新增 |
| N8 | 实验性浏览器与计算机操作；实验性自动审阅模式 | 旧账复核 | alpha.1 已消化 | 无新增 |
| N9 | 工作步骤可按简洁/标准/详细/完全展开查看；工具生成时显示准备进度；思考与工具过程可折叠 | **新账（本版最大）** | `015a9b202c`（四档 + 旧值映射）、`d3086e6571`（preparing/start/result 三态）、`b660f72d4e`（准备进度 hook）、`1b55f5bea3`、`d6fb1351b3`、`913aa2289b` | **含破坏性契约**，见 §3.1；我方不受影响，但需视觉回归 |
| N10 | 聊天中本地图片可查看放大，图片链接悬停预览 | **新账** | `7fe9c06fa6`、`4839239954`、`bd2a49a2ca`；新增导出 `ImageLightbox`/`ImageLightboxLabels` | additive；`ImagePreview` 导出**加了又撤**，rc.1 不在导出面 |
| N11 | Office 任务默认使用随应用安装的 LibreOffice 运行环境 | **新账** | `5e25475857`：`@deepseek-ai/libreoffice-kit` `0.0.1`→`^0.1.0`；`skill-office.Config` 新增 `node`/`cli` | **对 Electron 壳是breaking级配置**，见 §3.4 |

### 2.2 体验优化

| # | 条目 | 口径 | 落点 | 影响 |
|---|---|---|---|---|
| I1 | 长会话加载/滚动/轮次跳转更流畅，发送消息减少跳动 | 旧账复核 | alpha.2 的 9 个滚动提交 | 无 |
| I2 | 长时间命令与工作流可转后台，任务面板显示实时输出 | 旧账复核 | alpha.1/alpha.2 已消化 | 无 |
| I3 | 模型设置集中添加提供商并查看模型 ID；Safari 中模型菜单可选可收 | 旧账复核 + 微调 | `5124a2a310`（ID 等宽、名称 hover）、`06ef26a80f`/`6613660223`（焦点保持） | 无 |
| I4 | Windows 可通过系统关联应用打开配置文件及本地文件 | **新账** | `68e43b173e`、`95611fbc63`、`2b9923fede`、`b73031be9b`：`packages/util/native-command/path-opener` 从 PowerShell `Invoke-Item` 改为 **Explorer** | 见 §3.4；KCoder 的 `browser-host`/open-in-app 链路可参照 |

### 2.3 问题修复

| # | 条目 | 口径 | 落点 |
|---|---|---|---|
| F1 | Web 重启后会话在应用就绪时恢复连接与回复，保留历史与草稿 | 旧账复核 | alpha.2 `a44ced5b96` |
| F2 | 新建空白会话不复用旧历史/不被其它实例占用，刷新后状态正确 | 旧账复核 | alpha.1/alpha.2 |
| F3 | 插件启动失败区分可选/必需并保留可处理错误；安装卸载停滞不再占用 Profile 配置 | **新账** | `747c98b0db`、`ccaa0dc11c`（`run-tree.ts` 修复 pnpm 子进程不退导致 profile 写锁永占，#4981） |
| F4 | Windows 沙箱阻止删除授权目录外及其它工作区文件 | 旧账复核 | alpha.1 |
| F5 | 修复 Web 部署在反向代理子路径下无法访问 | 旧账复核 | alpha.1 |
| F6 | 修复旧子智能体完成通知导致父会话无法通过 Messages API 继续 | 旧账复核 | alpha.1 |
| F7 | 改善启动错误诊断，修复并发首次加载原生模块崩溃 | 旧账复核 | alpha.2 |
| F8 | 修复长时间使用双向流时 Gateway 内存持续增长 | **新账** | `4cfd292a7b` + `45f5cd34b0`：`stream-client.ts` 的 `stopped` 改逐读 resolver，`UplinkDecoder.interrupted` 由单 Promise 改 `Set`。**内部实现，无导出变化** |

### 2.4 其他变更 / Chores

| # | 条目 | 口径 | 影响判定 |
|---|---|---|---|
| C1 | DeepSeek 适配器仅 Messages API，支持复用已上传图片 | 旧账复核 | alpha.1 已改 |
| C2 | Session 日志 V4 + 批量迁移；自定义事件附件规则变化 | 旧账复核 | alpha.1 已改 |
| C3 | Agent 预设改由插件组合包声明安装 | 旧账复核 + **本版强化** | `mountPreset` 改为**兼容性门控**（`2c67633990`）：预设里被 profile 拒绝的插件行以 disabled 挂载 |
| C4 | 设置改由 profile 插件配置保存，旧 settings.yaml 仅导入一次 | 旧账复核 | alpha.1 已改 |
| C5 | PTC 运行时与工作流执行器改名，Node PTC 独立进程 | 旧账复核 | alpha.1 已改 |
| C6 | 默认不再启用 Ralph，移除内置 E2B 后端 | 旧账复核 | alpha.1 已改 |
| C7 | Remote 双向流与二进制；工作区读取改 `readBytes` | 旧账复核 | alpha.1 已改 |
| C8 | 组合包支持多 patch 与免重载配置字段，可导出配置 JSON Schema | 旧账复核 | alpha.1 已改 |
| C9 | Agent 生命周期、会话历史、Shell 沙箱接口改异步 | 旧账复核 | alpha.1 已改 |
| C10 | Team 模式统一 `spawn_teammate`，原子代理创建工具不再提供 | 旧账复核 | alpha.1 已改 |
| C11 | 工具结果按统一 token 预算截断，spill-policy 需改 `maxInlineTokens` | 旧账复核 | **alpha.2 已改**（见 alpha.2 文档 §2.4） |
| C12 | **插件安装与启动检查与当前 DSH 版本的兼容性；不兼容时提示原因，可针对确切版本授予例外** | **新账（本版头号）** | 见 §3.2 |

---

## 3. 发布说明未提及 / 需展开的代码级变更

### 3.1 簇 A：工具调用生命周期三态化（本版最大契约冲击）

**（1）`ToolCallOwnerProps` 分裂（`d3086e6571`）——破坏性**

```diff
-export interface ToolCallOwnerProps {
+interface ToolCallCommonProps {
   useDisclosure: UseDisclosure
   callId: string
   toolName: string
-  block: ToolCallBlock
   cwd?: string | undefined
   home?: string | undefined
   openFile: (path: string, options?: OpenFileOptions) => void
   loadImage: MessageImageLoader
   inspect?: (() => void) | undefined
 }
+export type ToolCallPhaseProps =
+  | { readonly phase: 'preparing'; readonly block: PreparingToolCall }
+  | { readonly phase: 'start';     readonly block: StartedToolCall }
+  | { readonly phase: 'result';    readonly block: ToolResultNode }
+export type ToolCallOwnerProps = ToolCallCommonProps & ToolCallPhaseProps
+export type StartedToolCallViewProps = Exclude<ToolCallViewProps, { readonly phase: 'preparing' }>
```

配套 `ui-conversation` 的 peer 契约：

```diff
-export interface RunningToolCall { callId; parentCallId?; name; argsRaw: string; turn; step; time; subCalls }
+interface ToolCallHead { callId; parentCallId?; name; turn; step; time; subCalls }
+export interface PreparingToolCall extends ToolCallHead { readonly phase: 'preparing' }
+export interface StartedToolCall   extends ToolCallHead { readonly phase: 'start'; readonly argsRaw: string }
+export type RunningToolCall = PreparingToolCall | StartedToolCall
 export type ToolCallBlock = RunningToolCall | ToolResultNode
```

**影响**：任何注册 `tool.call.toolview` 并直接读 `block.argsRaw` 的插件**编译失败**（`PreparingToolCall` 上没有该字段），必须按 `phase` 收窄或用 `StartedToolCallViewProps`；toolview 每调用由 2 次调用变 **3 次**。

**对 KCoder**：**不受影响**。已核对——侧边栏 `TrajectoryGraph.tsx` 与文件审查 `artifacts.ts` 中的 `argsRaw` 是**自有数据模型字段**（`trajectory-graph.ts:159/208/229` 自定义类型；`definition.ts:95` 从 `match.event.data.arguments` 解析），两者**均不注册** `tool.call.toolview`。将来若要做工具行自定义视图，必须按三态写。

**（2）`TranscriptViewMode` 重构（`015a9b202c`）——破坏性**

```diff
-export const TRANSCRIPT_VIEW_MODES = ['compact', 'detailed', 'expanded'] as const
+export const TRANSCRIPT_VIEW_MODES = ['compact', 'standard', 'detailed', 'verbose'] as const
-export const DEFAULT_TRANSCRIPT_VIEW_MODE: TranscriptViewMode = 'compact'
+export const DEFAULT_TRANSCRIPT_VIEW_MODE: TranscriptViewMode = 'standard'
+export const LEGACY_EXPANDED_TRANSCRIPT_VIEW_MODE = 'expanded'
-  readonly stepGrouping: 'collapsed' | 'none'
+  readonly stepGrouping: 'collapsed' | 'history' | 'none'
```

`expanded` 退役（保留为 legacy 别名）、新增 `standard`/`verbose`；旧值 `'normal'` 现映射到 `'standard'` 而非 `'detailed'`；schema 加 `.loose()`，未知历史值静默回落而非校验失败。**穷举 switch 与 `satisfies` 字典会编译失败。**

**（3）其余簇 A 变更**

| 提交 | 内容 | 定性 |
|---|---|---|
| `660f72d4e`/`b660f72d4e` | 新增 slot `hookContext`/`inject`、`UseToolCallArgumentsPartial`、`ToolCallHookContext`、`ToolCallInjected` | additive（用到的 slot 框架能力在 alpha.2 **已存在**，`ui-slots` 本版仍零变化） |
| `1b55f5bea3` | 成功消息保留 live anchor 直至 `step/end`；新增 `message.stepProcess.prepare.*` 13 个 locale 键 | additive/内部 |
| `913aa2289b` | `ProcessActivity` 新增 `readImage`/`write`；**MCP 三个 read 类工具不再归类为 `read`**；`ProcessActivitySummary` 新增 `preparing?` | **破坏性（枚举）** |
| `d550f1c4af` | `ConversationStartMatch` 放宽；**删除**「多个 start Match」「瞬态 start Match」两处硬错误，重复 start 变为合法 | **语义破坏** |
| `b2817d77fb` / `5840898e07` | 按动画帧发布、未变化返回同一节点 | 内部性能 |
| `7fe9c06fa6` / `4839239954` | `HoverCard` 新增 `inline?`；`ImageLightbox`/`ImageLightboxLabels` **新导出**；`ImagePreview` **导出后撤销** | additive（`ImagePreview` 不在 rc.1 导出面） |

### 3.2 簇 B：插件版本兼容性强制（本版头号新机制）

**（1）比对什么**

只比对插件 manifest 的 `peerDependencies` 中**名字为 `@deepseek-ai/dsh` 或以 `@deepseek-ai/dsh-` 开头**的条目，对照 **`packages/boot/app-boot/package.json` 自身的 `version`** 作为运行时版本：

```ts
export function getDshRuntimeVersion(): string {
  const filename = fileURLToPath(new URL('../package.json', import.meta.url))
  const manifest = objectOf(JSON.parse(fs.readFileSync(filename, 'utf8')), 'app-boot package.json')
  return runtimeVersionOf(Object.hasOwn(manifest, 'version') ? manifest.version : undefined)
}
export function evaluatePluginCompatibility(manifest, exemptions = {}, runtimeVersion = getDshRuntimeVersion()) {
  const fields = objectOf(manifest, 'Plugin manifest')
  if (!Object.hasOwn(fields, 'peerDependencies')) return undefined
  const dependencies = objectOf(fields.peerDependencies, 'Plugin manifest peerDependencies')
  const peers: Record<string, string> = {}
  for (const [name, range] of Object.entries(dependencies)) {
    if (typeof range !== 'string') throw new Error(`… must be a string`)
    if (name !== '@deepseek-ai/dsh' && !name.startsWith('@deepseek-ai/dsh-')) continue
    const requirement = ['workspace:^', 'workspace:~', 'workspace:*'].includes(range) ? runtimeVersion : range
    if (requirement.trim() === '' || !semver.satisfies(runtimeVersion, requirement, { includePrerelease: true })) peers[name] = range
  }
  if (Object.keys(peers).length === 0) return undefined
  …
}
```

判定语法：`semver.satisfies(runtime, range, { includePrerelease: true })`；`workspace:^|~|*` 重写为运行时版本（**恒通过**）；空/空白范围 = 不兼容；**非字符串范围直接抛错**。

**（2）三个强制点**

| 环节 | 行为 | 代码 |
|---|---|---|
| 启动行准入 | 行被置 `disabled: true` + `group: false`，stderr 报告，**不抛错**；`cordis:include` 文件若指向被拒插件则**整文件拒载** | `compatibility-preflight.ts`（新） |
| Profile bundle 加载 | bundle **不是**行，行准入读不到它的 peer → `747c98b0db` 补上：bundle 自身 dsh peer 不被豁免则**跳过** | `app-boot/src/profile.ts` |
| 安装期 | **在 pnpm 运行之前**拒绝，包不落盘（"nothing was installed"）；装后组件检查失败会 `restore()` 再重装 | `plugin-manager/src/operations.ts` |

类型化拒绝（`51d70c5f5c`）：新增 `ManagementError.code += 'incompatible-version'`、`IncompatiblePlugin { name, version, runtimeVersion, peers }`、`PackageResult.incompatible`。拒绝会短路源循环——"A compatibility refusal is the package's own answer, so no other registry is asked"。

**（3）例外机制：可以，但必须精确版本 + 显式承担风险**

存储在 `<profileDir>/compatibility.json`（独立 profile 元数据，**不是** manifest 字段、**不是** Cordis patch），形状 `{ "<pkg>@<exact-ver>": ["<exact-dsh-ver>", …] }`。四道闸：两侧都须精确 SemVer；须 `acceptRisk: true`；授予时的 runtime 必须**等于当前** runtime（撤销可指历史版本）；文件须可重写。三个入口：CLI `dsh plugin --profile <p> allow-version <pkg@ver> --dsh-version <exact> --accept-risk`（含 `revoke-version` / `version-exemptions`）、agent 工具 `plugin_manager` 的 `list_version_exemptions`/`set_version_exemption`、Web `@Remote listVersionExemptions()`/`setVersionExemption(...)`。

**（4）对我们五个插件的实测结论：全部通过**

用上游同版本 **`semver@7.8.5`** + `{ includePrerelease: true }` 复现门禁判定，运行时取 `0.1.7-rc.1`：

| 我方声明的范围 | 判定 |
|---|---|
| `^0.1.7-alpha.1`（侧边栏全部条目；文件审查部分条目） | ✅ **PASS** |
| `^0.1.6-alpha.1 \|\| 0.1.6-alpha.2 \|\| ^0.1.7-alpha.1`（文件审查部分条目） | ✅ PASS |
| `>=0.1.0-rc.5 <0.2.0 \|\| ^0.1.6-alpha.1 \|\| 0.1.6-alpha.2 \|\| ^0.1.7-alpha.1`（文件审查主条目） | ✅ PASS |
| `>=0.1.0-rc.5 <0.2.0`（独立子句） | ✅ PASS |
| **`^0.1.7`（含 prerelease 无、且未声明的写法）** | ❌ **FAIL** |

**原理**：`includePrerelease` 下，预发布版本只满足「比较器集合中存在**同 `[major,minor,patch]` 元组**的预发布」的范围。`0.1.7-rc.1` 与 `0.1.7-alpha.1` 同元组，且 `rc.1` 优先级更高 → 放行；而 `^0.1.7` 展开后不含任何预发布比较器 → 拒绝。

**行动项（预防性）**：将来新增 DSH peer 时，**必须写成含 prerelease 的范围**（如 `^0.1.7-rc.1` 或 `>=0.1.7-alpha.1 <0.2.0`），**禁止**写 `^0.1.7` / `^0.1.6` 这类裸 minor。这是本版唯一需要写入插件开发规范的新约束。

**（5）簇 B 其余**

| 提交 | 内容 | 定性 |
|---|---|---|
| `ccaa0dc11c` | 新增 `run-tree.ts`：修复 pnpm 子进程打印完成行却不退出、永久占住 profile 写锁（#4981）；新增 `PackageResult.timedOut`、`lookupTimeoutMs` | additive |
| `0edfe83573` + `75d74a055e` | 新增 `github-connection.ts`：安装前用 `git ls-remote` 做**有界**连通性检查（禁用交互式提示、SIGKILL 收尾） | additive |
| `d6e5b7e41a` | GitHub 安装失败提供镜像恢复 | additive（client） |
| `f64c57dbb2` | 移除面向用户的 agent 例外提示文案 | cosmetic |

### 3.3 簇 C：agent-team / experimental

| 提交 | 内容 | 定性 |
|---|---|---|
| `1dc518f217` | `TeamView` → `TeamProjection`；新增 `agentTeam` Session 投影；`mountAgentTeamUi` → `registerAgentTeamUi`；`apply` 由 async 改同步；`inject` 去掉 `'remote'`；`TeamActionResult` 导出删除；`openTeammate` 签名改为 `(sessionId, childSessionId)`；slot `order` 20→−20 | **破坏性** |
| `df7fa8945c` | `TeamMemberProjection` **精确删掉 3 个字段**：`description`/`provider`/`context`；`projectTaskView(rootId, state, task)` → `(state, task)` | **破坏性** |
| `86e3e0e448` | `Tooltip` 新增 `gap?: number`；新增图标 `IconUsersOutlineRegular`/`Medium`；`ui-subagent` slot order 30→−30 | additive |
| `2b44a4b657` | `ui-subagent` 新增 locale 键 `open.sidebar.aria`（`open.sidebar` 去掉 `{label}` 占位符）→ `Record<SubagentKey,string>` 字典须补键 | additive（类型级必补） |
| `2aa3a469db` + `3bf6d738f1` | **部分净零**：前者引入的 `session-projection/definitions-changed` 事件被后者删除——`control.ts`、`docs/subsystems/session-projection.md`、`session-controller/README.md`、`control-queue.host.spec.ts` 的**两版差异均为 0 行**，且该事件在 alpha.2 与 rc.1 **都不存在**。但两提交整体非净零（79+/195− 留在 `TeamAction.tsx`/`mount.ts`/locales/测试） | 该事件**不得写入**任何文档/代码；其余改动为真实变更 |
| 语音输入 | `SpeechPreparationOptions { downloadSource? }`；`prepare(options?)`；`modelOrigins: string[]` 默认 `['https://huggingface.co','https://hf-mirror.com']` | additive |

### 3.4 簇 D：preset / skill / document / office / desktop / util / python

**（1）LibreOffice Kit 0.1.0（`5e25475857`）——对 Electron 壳是 breaking 级配置**

```diff
 # packages/document/office-to-pdf/package.json 与 packages/bundle/web-app/package.json
-    "@deepseek-ai/libreoffice-kit": "0.0.1",
+    "@deepseek-ai/libreoffice-kit": "^0.1.0",
 # packages/skill/skill-office/package.json（新增依赖）
+    "@deepseek-ai/libreoffice-kit": "^0.1.0",
```
```diff
 export interface Config {
   assetRoot?: string
+  /** Standalone Node executable; defaults to the current executable outside Electron and SEA. */
+  node?: string
+  /** Absolute LibreOffice Kit CLI entry; false explicitly disables CLI access. */
+  cli?: string | false
 }
```
```ts
function officeRuntime(config: Config): string {
  if (config.cli === false) return '\n\nLibreOffice Kit is disabled in this deployment.'
  if (config.node === undefined && (isSea() || process.versions.electron !== undefined)) {
    throw new Error('skill-office: packaged applications must supply a standalone Node executable')
  }
  …
}
```

**影响**：`skill-office` 在 **Electron/SEA 且未提供 `node` 时 `apply()` 直接抛错**。KCoder 是 Electron 壳 → **若产品的 preset 组合里挂了 `skill-office`，必须提供 `skill-office.config.node`（或用 `cli: false` 显式关闭）**。这是本版对桌面壳最具体的一处适配要求，需在集成时确认产品是否启用该技能。

**（2）`packages/document` 是什么**：它是**工作区目录不是包**，两个 tag 下都只含 `office-to-pdf/`（= `@deepseek-ai/dsh-office-to-pdf`，Office→PDF 转换，含队列与缓存），文件集在两版之间**完全相同**，本版只改了 Kit 依赖与一个测试。

**（3）Windows 打开路径改走 Explorer（`packages/util/native-command/path-opener`）**

```diff
-async function openWindowsPath(path, signal, run) {
-  await run('powershell.exe', ['-NoProfile','-Command', `Invoke-Item -LiteralPath ${powershellLiteral(path)}`], signal)
-}
+async function openWindowsPath(path, signal, run) {
+  await runExplorer([explorerTarget(path)], signal, run)
+}
+function explorerTarget(windowsPath: string): string {
+  const href = pathToFileURL(windowsPath, { windows: true }).href
+  return href.replace(/(?:%[89A-F][0-9A-F])+/gi, escaped => decodeURIComponent(escaped))
+    .replaceAll(',', '%2C').replaceAll('=', '%3D')
+}
```
Explorer 以 `,`/`=` 切分命令行（两者都被转义）；非 ASCII 的百分号转义被解回（「Explorer 拒绝 file URI 里的百分号编码非 ASCII，会打开用户的文档文件夹」）。`revealNativePath` 复用同一函数加 `/select,`。**`powershellLiteral` 已删除**（模块私有）。KCoder 的「在资源管理器中显示」链路可对照此实现。

**（4）`python/` 载荷校验收紧——破坏性**

```diff
-    required = [executable, root / "office-skills/scripts/check_office.py"]
+    node = root / "primary-runtime/dependencies/node/bin" / ("node.exe" if platform == "win32" else "node")
+    required = [executable, node, root / "office-skills/scripts/check_office.py"]
```
即每个 wheel 必须携带**独立 Node**（与 CPython、Office Python 库、pnpm 并列），且校验可执行位。**自定义纯 Python 载荷必须设 `skill-office.config.cli: false` 或提供 `config.node`。**

**（5）`apps/desktop`：新增必需环境变量（破坏性）**

```diff
+function developmentPrimaryRuntime(): string {
+  const directory = process.env.DSH_DESKTOP_PRIMARY_RUNTIME_DIR
+  if (directory === undefined || directory === '') {
+    throw new Error('dsh desktop: DSH_DESKTOP_PRIMARY_RUNTIME_DIR is required for an unpackaged launch')
+  }
+  return directory
+}
   const development = !app.isPackaged
+  const primaryRuntime = development ? developmentPrimaryRuntime()
+    : join(process.resourcesPath, 'runtime', 'primary-runtime')
```
**非打包启动必须设 `DSH_DESKTOP_PRIMARY_RUNTIME_DIR`**；新增公共脚本模块 `apps/desktop/scripts/desktop-build-paths.mjs`。KCoder 有自己的 dev 启动链（`scripts/dev.mjs`），**不受影响**，但可参照该模块的路径解析。

**（6）`packages/preset`**：`agent-preset-registry` 的 `@deepseek-ai/dsh-app-boot` 从 devDeps 移入 deps、新增 `@deepseek-ai/cordis-plugin-include: workspace:~` 到 **peerDependencies**（消费者需满足）；新增 `@Remote('read') readDocument` 与 `AgentPresetDocument` 类型、新拒绝码 `agent-preset/not-found`；`mountPreset` 改兼容性门控。

**（7）`patches/`**：**没有新增补丁文件**（两版都是同样 7 个文件名），只**修改**了 `@fortune-sheet/core@1.0.4` 与 `@fortune-sheet/react@1.0.4` 两个既有补丁（只读表格的双轴触控板平移 + 冻结线在 `allowEdit === false` 时不绘制）。

### 3.5 分域深挖汇总

| 域 | 真实变更 | 判定 |
|---|---|---|
| `packages/client/ui-chat`（40） | 四档视图模式、preparing 阶段、anchor 保留、图片预览 | **含 2 处破坏**（§3.1） |
| `packages/client/ui-tool`（38） | `ToolCallOwnerProps` 拆分、准备进度 hook、`PreparingToolRow`、标题统一 | **含 1 处破坏**（§3.1-1） |
| `packages/client/ui-primitives`（24） | `ImageLightbox` 新导出、`HoverCard.inline`、diff 配色 token | additive |
| `packages/client/ui-conversation`（12） | `RunningToolCall` 联合拆分、start match 放宽 | **含破坏** |
| `packages/client/ui-deliverables`（9） | diff 配色 token 拆分、preparing 阶段、行内图片 prompt | additive |
| `packages/experimental`（59） | agent-team 投影化、语音下载源 | **含 2 处破坏**（§3.3） |
| `packages/boot`（31） | 兼容性门禁全套 + `run-tree` + `github-connection` | **本版头号**（§3.2） |
| `apps/web`（52） | 测试与 snapshots 为主 | 测试面 |
| `apps/desktop`（19） | 新环境变量、构建路径模块、安装器 | 见 §3.4-5 |
| `snapshots`（47） | 跟随上述变更的期望值刷新 | 测试面 |
| `.agents`（41）/`docs`（38） | 决策记录与文档同步 | 文档 |

---

## 4. 五个自研插件的升级点

### 4.0 消费面实测

| 插件 | 版本 | 直接 import 的上游包 | 本版升级点 |
|---|---|---|---|
| `dsh-skills-bundle` | 1.0.2 | **无** | **无需改动** |
| 自研 MCP 体系（`desktop/main/mcp-*.ts`） | `BUILTIN_VERSION = 6` | **无 npm import** | **无需改动** |
| `dsh-coding-sidebar` | 1.0.31 | `dsh-agent` · `dsh-client-ui-primitives` · `dsh-client-ui-settings/client` · `dsh-client-ui-slots` · `dsh-llm` · `dsh-session` · `dsh-subagent` · `dsh-tools` · `schemastery` · `cordis` | **无需改动**（peer 门禁实测 PASS） |
| `dsh-file-review-kcoder` | 1.0.10 | `dsh-agent` · `dsh-api-remotes/client` · `dsh-api-session-controller/client` · `dsh-atomic-write` · `dsh-client-locale/client` · `dsh-client-ui-conversation/client` · `dsh-client-ui-slots` · `dsh-session/types` · `dsh-system-prompt` · `dsh-typert-protocol` · `dsh-typert-registry/types` · `cordis` | **无需改动**（peer 门禁实测 PASS） |
| `@kkutysllb/dsh-terminal` | 1.1.1 | 无（仅 `node-pty`） | **无需改动** |
| `dsh-shell-prefs` | 1.0.1 | 镜像于 bundle/ | 集成时核对 |

### 4.1 `dsh-skills-bundle`（技能）

- 上游 `packages/skill/**` 本版**只有 `skill-office` 有真实源码变更**（§3.4-1），其余 5 个包为版本戳零变化。
- **升级点：零。** 但**若产品 preset 启用了 `skill-office`，必须处理 `node`/`cli` 配置**（Electron 下不给会抛错）——这是本次唯一可能需要动配置的地方。

### 4.2 自研 MCP 体系

- `packages/mcp/mcp-client` 本版**零变化**（不在 621 个真实变更文件内）。
- **升级点：零。** `mcp-builtin.ts` 的 `BUILTIN_VERSION = 6` 与 5 条精确钉版无需因本版调整。

### 4.3 `dsh-coding-sidebar`（侧边栏）

- `ui-slots` **仍为版本戳零变化** → 两处槽位注册（`settings.section`、`conversation.chat.turnTail`）原样有效，**连续第三版稳定**。
- `ui-settings/**` 无真实变更（`ui-settings-models` 7 个文件属模型设置 UI，侧边栏不消费）。
- `ui-primitives` 变更 **additive**：侧边栏导入的 31 个符号全部存活；`ImageLightbox`/`ImageLightboxLabels` 是新增，`ImagePreview` 不在导出面。
- `dsh-agent`/`dsh-session`/`dsh-subagent`/`dsh-llm`/`dsh-tools`：本版**无真实源码变更**。
- **升级点：零。**
- **需回归**：`Tooltip` 新增 `gap` prop（默认 8，仅 bottom/top 生效）；`ui-chat` 的四档视图模式与 preparing 阶段会改变会话区过程行渲染——侧边栏 turnTail 注入点落在其中，建议做「四档模式 × 长会话 × 折叠」组合冒烟。

### 4.4 `dsh-file-review-kcoder`（文件审查）

- **核心契约零风险**：`typert-protocol`/`typert-registry` 本版无真实变更；`ui-slots` 零变化；`ui-conversation` 有变更但**文件审查只做类型级注入**。

  > ⚠ **一处需确认**：`ui-conversation` 的 `records.ts` 把 `RunningToolCall` 拆成了 `PreparingToolCall | StartedToolCall` 联合（§3.1-1）。文件审查的 `definition.ts` 从 `match.event.data.arguments` 自取参数（不走该联合），但**若它有用到 `RunningToolCall` 类型的地方，需按新联合收窄**。建议集成时跑一次 `tsc` 确认（本版我方源码未变，属"编译期验证"而非"需改代码"）。
- `ui-deliverables` 本版有 9 个文件变更，但**全是配色 token 与 preparing 阶段**；文件审查走自有渲染（`UnifiedDiff.tsx`），不受影响。
- **升级点：零**（待 `tsc` 验证）。
- **需回归**：长会话 `loadOlder()`（alpha.2 已把单页上限 50→500）；原生 review tab 的 `changes-review` 地址与 `priority: 'builtin'` 注册（见 §10）。

### 4.5 `@kkutysllb/dsh-terminal`（终端）

- `packages/terminal/**` 与 `packages/api/terminal-controller/**` 本版**无真实变更**（`ui-sidebar-terminal` 源码零变化）。
- **升级点：零。**

### 4.6 `dsh-shell-prefs`

- `packages/settings/**`、`ui-settings/**` 本版无真实变更。
- **升级点：零。**

### 4.7 交叉事项

| 事项 | 来源 | 对五个插件的作用 |
|---|---|---|
| **DSH peer 兼容性门禁** | `2c67633990`（比对+例外）/ `747c98b0db`（bundle 拒载）/ `51d70c5f5c`（类型化拒绝） | 实测**全部 PASS**；但**新增 peer 时禁止写裸 minor 范围**（§3.2-4） |
| `ToolCallOwnerProps` 三态化 | `d3086e6571` | 我方**不注册** `tool.call.toolview` → 不适用；将来新写须按三态 |
| `TranscriptViewMode` 四档化 | `015a9b202c` | 无契约影响，但需视觉回归 |
| `ProcessActivity` 新增成员 | `913aa2289b` | 无影响（我方不消费） |
| `skill-office` 的 `node`/`cli` | `5e25475857` | **若产品启用该技能必须配 `node` 或 `cli:false`** |
| `ImagePreview` 导出加了又撤 | `7fe9c06fa6`/`4839239954` | 不要依赖该导出 |

---

## 5. 升级仪式改动面

### 5.1 依赖范围

rc.1 **没有**像 alpha.2 那样重写依赖范围策略（那是 `37372101b5`/`4e6028a604` 引入的，本版沿用）。**`workspace:*`（DSH）/ `workspace:~`（vendor/native）的约定不变**，`verify-package-dependencies` 门禁继续生效。

### 5.2 本版需要跟着改的清单

| # | 项 | 类型 | 是否必须 |
|---|---|---|---|
| 1 | `skill-office` 的 `node` / `cli:false` 配置（Electron 下不给会抛错） | 配置 | **仅当产品 preset 启用 `skill-office`** |
| 2 | 跑一次 `tsc` 确认 `ui-conversation` 的 `RunningToolCall` 联合拆分不咬文件审查 | 验证 | 建议 |
| 3 | peer 范围写法规范（禁裸 minor） | 规范 | 写入插件开发约定 |
| 4 | 侧边栏/文件审查的视觉回归（四档模式、preparing 阶段、diff 配色、`Tooltip.gap`） | 回归 | 建议 |
| 5 | 不要引入 `session-projection/definitions-changed`（rc.1 不存在） | 纪律 | 必须 |
| 6 | 整树抬版（沿用 alpha.2 的精确钉结论） | 构建 | **必须** |

### 5.3 与前三版的升级工作量对比

| | alpha.1 | alpha.2 | **rc.1（本文）** |
|---|---|---|---|
| 非 merge 提交 | ~786 | 101 | **102** |
| 真实文件 | ~3905 | 509 | **621** |
| 契约断裂 | 5 处大断裂 | 1 处硬配置键 + 2 处类型破坏（对本方零影响） | **1 处硬门禁（已实测 PASS）+ 3 处类型破坏（对本方零影响）** |
| 五个插件工作量 | 侧边栏最大 | 全部零改动 | **全部零改动** |
| 唯一需动配置 | — | spill 键（本机 0 命中） | **`skill-office` 的 `node`/`cli`（仅当启用）** |

---

## 6. 风险与待确认项

1. **peer 门禁的范围写法陷阱**（实锤）：`^0.1.7` 这类**不含 prerelease** 的范围在 `0.1.7-rc.1` 下**判定 FAIL**。我方现有范围全部安全，但这是新写 peer 时的第一号坑。已实测：`^0.1.7-alpha.1`、`>=0.1.0-rc.5 <0.2.0`、`^0.1.7-rc.1` 均 PASS。
2. **`skill-office` 在 Electron 下的启动抛错**（实锤）：`config.node` 缺失且 `isSea() || electron` → `apply()` 抛错。**需确认产品 preset 是否启用该技能**。这是本版对 KCoder 唯一可能的实质阻断。
3. **`ToolCallOwnerProps` 三态化**（实锤）：我方当前不受影响，但这是一条**已生效的上游契约**——将来做工具行自定义视图必须按 `phase` 收窄，不能读 `block.argsRaw`。
4. **`ui-conversation` 的 `RunningToolCall` 联合拆分**（需 tsc 确认）：文件审查若在类型层引用该联合，需收窄。属编译期验证项。
5. **`ui-chat` 四档视图 + preparing 阶段的 DOM 变化**（需回归）：侧边栏 turnTail 注入点在该区域内。
6. **`Window` 打开路径改 Explorer**（参照项）：KCoder 的「显示文件位置」链路可对照上游新实现（转义 `,`/`=`、解回非 ASCII 百分号转义）以避免同类问题。
7. ~~**集成分支尚未建立**~~ **（已消除，见 §8.1）**：本轮已建 `kcoder/0.1.7-rc.1` 并重放 alpha.2 尖端，**真实冲突面已实测**——预期交集 9 文件，**实际真冲突仅 1 处**（`ui-primitives/src/markdown/parse.ts` 的语义并集），完整性断言 46 ≡ 46。原预判「冲突集中在 `ui-chat`/`ui-tool`」**偏悲观**：这两个域全部自动合并成功。

---

## 7. 建议落地顺序

1. **建 `kcoder/0.1.7-rc.1` 集成分支**（基于 rc.1 tag + 重放 `kcoder/0.1.7-alpha.2` 尖端 `f12a7e9ff0`）。预期冲突面比 alpha.2 小：侧栏一族源码零变化，冲突集中在 `ui-chat`/`ui-tool`（上游大改 × 我方 `editUserMessage` 链）。
2. **合并后跑门禁**：`verify-package-dependencies` + 整树抬版（`pnpm ls @deepseek-ai/dsh-*` 确认无双副本）。
3. **确认 `skill-office` 是否在产品 preset 中**；若在，配 `node` 或 `cli: false`。
4. **`tsc` 验证 `ui-conversation` 联合拆分**对文件审查无影响。
5. **五个插件零改动回归**：技能（含 `skill-office` 若启用）· MCP（内置 5 条 + 含图调用）· 侧边栏（四档视图 × 长会话 × turnTail）· 文件审查（diff 渲染 + 撤销 + Remote）· 终端（pty 起停）。
6. **专项**：打包产物启动冒烟（沿用 alpha.2 结论）。
7. **收口文档**：本文件追加 §11 执行记录。

---

## 8. 执行记录

### 8.1 第一批已执行（2026-09-23：fork 集成分支重放 + 构建）

**产物**：`kcoder/0.1.7-rc.1` @ `a56eabbd02` = 父提交 `46a7f68b09`（tag `dsh-v0.1.7-rc.1`）× `f12a7e9ff0`（`kcoder/0.1.7-alpha.2` 尖端），单次 `merge --no-ff` 重放。**已推**（见 §8.5）。

**冲突实况（§7 第 1 项预判"比 alpha.2 小"——实测比预判更小）**：预期交集 9 文件 → **实际真冲突仅 1 处**，其余 8 个自动合并成功（`ChatNodeSeat.tsx`、`ChatView.tsx`、`TurnProcessNodeView.tsx`、`locale.ts`、`chat-view.client.spec.tsx`、`ui-plugin-manager/client/locales.ts`、`ToolRow.tsx`、`pnpm-lock.yaml`）。

**唯一真冲突：`ui-primitives/src/markdown/parse.ts` —— 语义冲突，且次序有约束**

两侧各自在**同一个表达式**上加了一层包裹：

```diff
-  我方：fromMarkdown(sanitizeModelMarkdown(text), { … })
-  上游：recoverLocalImages(fromMarkdown(text, { … }), text)     # rc.1 新增图片功能
+  并集：const source = sanitizeModelMarkdown(text)
+        recoverLocalImages(fromMarkdown(source, { … }), source)
```

**为什么不能随便套**：`recoverLocalImages(root, source)` 用 `source.slice(child.position…) === child.value` 做**逐字对应**校验，以此区分「作者原写」与「转义示例」（`local-image-syntax.ts`）。而 `sanitizeModelMarkdown` 会**跨行合并**（把断行的 `**`/反引号接到上一行）**从而改变偏移**。故必须：sanitize（文本级）→ 用 sanitize 后文本解析 → 把**同一份文本**传给 `recoverLocalImages`。若图省事把原始 `text` 传进去，**带空格的本地图片路径会静默漏检**（不报错）。已把该约束写成**代码内中文注释**固化（产物里可见），防止后续被"优化"掉。

**逐个复核自动合并结果**（防"合并成功但语义错位"）：`TurnProcessNodeView.tsx` 的上游新门控（`open = !foldable || open`、`canCollapse` 增 `foldable`、null 守卫改 `turn?.start === undefined && status !== 'closed'`）与我方 `data-turn-running` + `.label` 裸 span **并存**；`locale.ts` 的四档标签与我方 `chat.deepDiving`/`deepDivingFor`/`message.edit` **并存**；`ChatView.tsx` 的上游 `fileImages` 与我方 `editUserMessage` 传参**互不重叠**。

**完整性断言（理想签名）**：`git diff --name-only dsh-v0.1.7-rc.1 <合并树>` = **46 文件**，与 `git diff --name-only dsh-v0.1.7-alpha.2 kcoder/0.1.7-alpha.2` 的 46 文件**集合完全相等（`diff` 为空）** ⇒ 合并 = rc.1 + 我方自有面，**零多余、零丢失**。

**构建**：`pnpm install --no-frozen-lockfile` 重收敛（exit 0）→ `pnpm run build` **整链 exit 0**（`build:native-system → build:lib → build:web`），记录 **263 个 client 产物**；pre-commit 门全绿（translation pairing / lint 0 error / third-party notices / whitespace / vendor manifest）。本版**未触发** alpha.2 轮那个「陈旧声明锁死」陷阱（rc.1 未整体替换任何 `src/index.ts` 入口，已核）。

**产物标记逐点在位**：`ui-chat/lib/client.js` 内 `useScrollFollow` 3 · `data-turn-running` 2 · `dsh-kcoder-turn-status-shimmer` 2 · `verbose` 6；`ui-primitives/lib/types/markdown/parse.js` 内 `sanitizeModelMarkdown` 与 `recoverLocalImages` **同在**（并集按序编译，含约束注释）；`app-boot/lib/types/plugin-compatibility.*` 与 `profile.js` 在位（新门禁已构建）。

> **更正一处更早的历史错误（本轮实地发现）**：alpha.2 轮文档与 `upstream/BASELINE` 都写过「`apps/web/dist` **不在** `pnpm run build` 默认链里，必须单独 `build:web`」——**该断言是错的**。`scripts/build.ts` 三步本就含 `build:web`（alpha.2 与 rc.1 该文件逐字节相同）。当时 `dist` 陈旧的真因是 **`build:lib` 因陈旧声明文件失败退出，而 `runScript()` 失败即 `throw`，链在 `build:web` 之前就断**；随后只单独补跑 `build:lib:*`，缺口便一直存在。
> **正确教训**：**构建链中途失败后要重跑整条 `pnpm run build`，不要单独补跑子步骤**——否则链尾阶段静默缺失，而每个子步骤单独看都是绿的。已在 `docs/upstream-0.1.7-alpha.2-analysis.md` §8.1 与 `upstream/BASELINE` 就地更正。

### 8.2 第二批已执行（2026-09-23：失效面回归实测）

**peer 门禁预演（§7 第 2/5 项、§6-1）** —— 以门禁自身的 `semver@7.8.5` 与同一判定式（`includePrerelease: true`、只查 `@deepseek-ai/dsh` 前缀、`workspace:*` 视为当前运行时）对 **dev home 内引擎真正会读的那份 manifest** 逐个预演：`dsh-coding-sidebar@1.0.31`（11 个 DSH peer）· `dsh-file-review-kcoder@1.0.10`（12 个）· `@kkutysllb/dsh-terminal@1.1.1` / `dsh-skills-bundle@1.0.2` / `dsh-shell-prefs@1.0.1`（各 0 个，未声明 DSH peer）→ **五个全部 admitted，0 处不兼容、0 个豁免需求**。与 §0/§2.1 的独立结论一致。

**定向单测 261/261 全绿（6 文件）**：`markdown-model-sanitize` **12**（我方 sanitize × 上游 recover 的并集行为）× `plugin-compatibility` **62**（上游自带门禁单测，等于用上游用例二次确认了 §3.2 的语义解读）× `scroll-follow` **11** × `chat-view` **142**（含我方 `data-turn-running` 断言）× `presentation-policy` **6**（四档）× `session-history-journal` **28**。

**浏览器几何门（与 alpha.2 轮同 4 套，逐项对照）**：

| 套件 | rc.1 | alpha.2 | 对照 |
|---|---|---|---|
| `chat-scroll-contract.e2e.ts` | **9/9 通过** | 9/9 通过 | 一致 |
| `idle-submission-handoff.e2e.ts` | **8/8 通过** | 8/8 通过 | 一致 |
| `seeded-history.e2e.ts` | 15 中 3 失败（429/747/784 行）+1 skip | 同样 3 项、同三行号 | **一致** |
| `steering.e2e.ts` | 7 中 2 失败（139/465 行） | 同样 2 项、同两行号 | **一致** |
| 合计 | **5 failed / 33 passed / 1 skipped** | 同 | **一致** |

**5 项失败的归因（与 alpha.2 轮逐字节相同的证据）**：所有 golden diff 的新增行**只有一行**——`+ - button "Edit this message and resend"`（5 次）+ 由其引起的 `+0/-1` aria 序号位移（1 次）。alpha.2 轮已实锤该串在全仓 `snapshots/` **零命中**（从未为我方补丁刷新），且本版改动的快照是 `diff-bounded`/`diff-context`/`excel-opc`/`goal-multi-turn-actions`/`tool-details`，与这两个套件**零交集**。
⇒ **本版零新增失败**；5 项仍是既定的「已知稳定差集」（**已决：保持上游 golden 原样**，见 alpha.2 文档 §8.6 第 1 项）。

### 8.3 第三批已执行（2026-09-23：KCoder 前置同步 + staging 物化）

**前置同步（功能引用点 4 处全覆盖）**：`desktop/main/dsh-contract.ts` 的 `UPSTREAM_BRANCH` **常量 + 文档注释**（2 处）· `scripts/setup.sh`（1 处）· `scripts/release.sh`（3 处）· `upstream/BASELINE` 钉版 SHA → `46a7f68b0922371ce7144b668b90e377d8e799f4`（= tag `dsh-v0.1.7-rc.1`）+ 追加本版升级记录。
复核：`grep -rn "kcoder/0\.1\.7-alpha\.2" desktop/main scripts` **零命中**（本轮直接覆盖 `desktop/main`，未重犯 alpha.2 轮「只 grep scripts 与 .github」的漏改错误）。

**依赖范围门禁（§5.1 / §7 第 2 项）**：`pnpm run verify-package-dependencies` **exit 0** —— `70 package(s) match the published dependency policy (5 Client-only, 63 Client/Host, 2 configured Host)`。**rc.1 未引入新的范围红灯**。
> 过程中先失败一次，且**不是门禁本身的问题**：`pnpm` 的 `verify-deps-before-run` 认定 `node_modules` 与 lock 不同步（本批 `deploy --prod` 把工作区装成 prod-only 态）而自动跑 `install --production`，其 `postinstall`（`install-lefthook.mjs`）需要 devDeps 的 `lefthook` → 崩。`CI=true pnpm install` 复位后 exit 0 ⇒ **`deploy --prod` 之后必须复位安装态**（此教训 alpha.2 轮已记，本轮复现并再次确认）。

**staging 物化收口**：`pnpm --dir <fork> --filter=@deepseek-ai/dsh deploy --prod --legacy staging/kcoder-runtime` exit 0 → 产物 `package.json` 版本 **0.1.7-rc.1**；`scripts/materialize-peers.mjs` → **25,203 文件 → tar.gz 146 MB**，自检通过；`verify-vendor-purity --clean` 回收 deploy 留下的 `vendor/KCoder`（**实测 0 文件 / 0 字节**，纯空目录骨架）后 `vendor/` 纯净；`smoke-runtime`（Electron node 形态）**就绪行 + 首页 200**；`brand-assert` 通过（`chat.deepDiving = KCoder...`）。

**尺寸对照（§3.4 的验证项）**：

| | alpha.2 | **rc.1** |
|---|---|---|
| staging 解包 | 592 MB | **535 MB** |
| tar.gz | 162 MB | **146 MB** |

⇒ LibreOffice Kit `0.0.1 → ^0.1.0` **无膨胀，反而缩小 16 MB** ⇒ §3.4-1 的"体积影响"疑虑**实测消除**。

### 8.4 §7 清单逐项收口

| §7 步骤 | 状态 | 证据 |
|---|---|---|
| 1 建集成分支并重放 | **完成** | §8.1（冲突 1 处，完整性 46≡46） |
| 2 跑门禁 + 整树抬版 | **完成** | §8.3（exit 0 / 70 包） |
| 3 确认 `skill-office` 是否在产品 preset | **完成 → 结论：不在，无需配置** | 见下 |
| 4 `tsc` 验证 `ui-conversation` 联合拆分不咬文件审查 | **完成（结论同，但**证据被更正**）** | 见下 |
| 5 五个插件零改动回归 | **完成** | §8.2（peer 预演全过 + 261 单测 + 几何门与 alpha.2 逐项一致） |
| 6 打包产物启动冒烟 | **部分** | staging 直接冒烟已过（就绪行 + 首页 200）；**app.asar 闭包级冒烟随发版走** |
| 7 收口文档 | **完成** | 本节 |

**§7-3 `skill-office`**：`grep skill-office packages/bundle/web-app/` **零命中**——它只出现在 `packages/bundle/sdk-app/cordis.patch.yml`（SDK 应用 bundle，KCoder 不用）。它确实作为**传递依赖**存在于 rc.1 staging 的 `node_modules`，但**没有任何补丁层挂载它**。用 `--dump-config` 取**生效组合**（1429 行）实证：只有 `office-to-pdf` 行（597–598），**没有 `skill-office` 行** ⇒ `apply()` 永不执行 ⇒ §3.4-1 那段 Electron 下 `throw new Error('skill-office: packaged applications must supply a standalone Node executable')` **不可能触发**。**本项零动作。**
同次 dump 顺带复核我方 overlay 四行的解析结果，全部符合预期：`session-log-deepseek → enabled: false` · `ui-sidebar-terminal → disabled: true` · `ui-deliverables → config.tailCard: false` · `ui-sidebar-browser → disabled: false`。

**§7-4 类型面的证据更正（结论不变，但原推理不严谨）**：§3.1-1 写「文件审查的 `argsRaw` 是**自有数据模型字段**，不读上游 `ToolCallBlock`」。实测**并非如此**——`dsh-file-review-kcoder/src/client/dsh-contracts.ts:33` **确实从 `@deepseek-ai/dsh-client-ui-conversation/client` 导入了 `RunningToolCall`**，并在同文件 `:81` 用作 `readonly runningCalls: readonly RunningToolCall[]`。所以"不受影响"需要**真正的理由**，逐点核实如下：

1. `RunningToolCall` 在 rc.1 **仍然导出**（只是由 interface 变成 `PreparingToolCall | StartedToolCall` 联合），故 import 本身不会失败；
2. 我方对该类型的**唯一消费**是 `session-changes.ts:143` 的 `snapshot.runningCalls[0]?.turn`，而 `turn` 定义在 `ToolCallHead` 上，**两个分支都有** ⇒ 无需收窄，安全；
3. 插件里读 `argsRaw` 的地方（`session-changes.ts:215/219/224`）走的是 **`ToolResultNode.call`**（该函数以 `node.kind !== 'tool-result'` 过滤后取 `node.call`），而 rc.1 的 `ToolResultNode.call` 类型是**内联结构 `{ name: string; argsRaw: string } | null`**（`ui-conversation/src/client/contract/records.ts:163`）——**不是**那个联合，故 `call.argsRaw` 完全合法；
4. 我方**不注册** `tool.call.toolview` 槽位（实测 0 命中），故"toolview 每调用由 2 次变 3 次"亦不适用。

⇒ 结论（**不受影响**）成立；但理由应记作「**读的是 tool-result 节点的内联 call 结构 + 联合分支都有 `turn`**」，而不是「自有数据模型字段」。已在 §8.6 记为措辞更正项。

### 8.5 fork 推送与远端核对

`git ls-remote origin refs/heads/kcoder/0.1.7-rc.1` **为空**（该分支尚不存在；fork 上只有历史遗留的 `kcoder/0.1.5-rc.1` 与 `kcoder/rc.1`）⇒ 本次是**新建分支**，**结构上不可能**出现 alpha.2 轮那个「远端分支指着裸 tag、两道断言却全过、静默发出未打补丁产物」的陷阱。

推送：`* [new branch] kcoder/0.1.7-rc.1 -> kcoder/0.1.7-rc.1`（pre-push 门 `✓ typecheck 14.36s`）。推送后 `git fetch` 复核：

| 断言 | 结果 |
|---|---|
| 本地 vs 远端 | **0 / 0**（同步） |
| 远端树上 `dsh-kcoder-turn-status-shimmer` / `editUserMessage` / `fillDraft` / `sanitizeModelMarkdown` | 全部 **present ✓** |
| 远端树上 `recoverLocalImages` / `evaluatePluginCompatibility`（rc.1 新特性） | 全部 **present ✓** |

⇒ 远端 = rc.1 + 我方自有面，两个方向都核过。

### 8.6 遗留与待办

| # | 项 | 状态 |
|---|---|---|
| 1 | §8.4 的措辞更正（§3.1-1 对"为何文件审查不受影响"的推理） | **本文已更正**；§3.1-1 原文建议同步（本轮未回改正文，避免与已定稿章节冲突） |
| 2 | 补一条「带空格本地图片路径 + 跨行 `**`」组合用例，固化 §8.1 的并集次序契约 | **建议**（当前靠代码注释约束） |
| 3 | 把 peer 门禁预演纳入 SOP / CI 断言（防"三元组悬崖"：`^0.1.7-alpha.1` 在 0.1.8 起失效 ⇒ 两插件静默消失） | **建议**（本版最高价值的制度化项，§6-1） |
| 4 | peer 范围写法规范（禁裸 minor，如 `^0.1.7`）写入插件开发约定 | **建议**（§5.2-3） |
| 5 | `verify-vendor-purity.sh --clean` 对「仅含空目录的骨架」判为"含真实文件"而拒删（实测 0 文件却报错，需人工 `rm -rf`）；**每次 deploy 都会复现** | **建议**（可改为只删空目录链：`find -depth -type d -empty -delete`），本轮仍手工回收 |
| 6 | 打包产物（app.asar）闭包级启动冒烟 | 未做，随发版走 |
| 7 | 用户验收：四档模式术语与"同名不同档"、新默认 `standard` 的观感、运行中过程组不可折叠、Electron 壳内品牌注入与页头收纳（**裸浏览器看不到**） | **待用户** |
| 8 | `seeded-history`/`steering` 的 5 项 golden 漂移 | **已决**：保持上游原样；本轮复核**无新增** |
| 9 | §9 决策记录（插件退役评估）与本轮升级正交，维持「不退役」 | **已决** |

### 8.7 本批提交

- fork `kkutysllb/deepseek-harness`：`kcoder/0.1.7-rc.1` @ `a56eabbd02` —— **已推**（新建分支，pre-push typecheck ✓，远端核对 §8.5）。
- KCoder `main`：`desktop/main/dsh-contract.ts` · `scripts/setup.sh` · `scripts/release.sh` · `upstream/BASELINE`（钉版 + 升级记录 + **上轮 `apps/web/dist` 错误断言的更正**）· `docs/upstream-0.1.7-alpha.2-analysis.md`（§8.1 同项更正）· **本文件 §8**。
- KCoder `staging/kcoder-runtime` @ **0.1.7-rc.1**（不入库；146 MB tar.gz）。
- **未改动**：五个自研插件源码（本版实测零改动面）· `desktop/main/workspace-header.ts` · `desktop/main/dsh-manager.ts` · 产品 overlay（`skill-office` 无需配置，且已实证不在生效组合内）。

### 8.8 事后补记：一条被三轮升级漏检的回归（用户现场发现，已修）

> 本节是**执行后由用户实测反馈触发的补记**，它推翻了本文 §4「五个插件零改动」的一条隐含结论——**「零改动」只对类型/契约面成立，对「我方插件调用的上游成员是否还在」不成立**。

**现场**：rc.1 下侧边栏「任务管理」页把整棵子代理拓扑渲染成一列 disabled 行、每行都写「加载中…」（该会话 36 个子代理全如此），永不恢复，**且控制台零报错**。用户判断「以前没有」——完全正确。

**根因（逐行闭合）**：我们的插件还在读 **0.1.6 时代的两个列表快照字段**，而 0.1.7 已移除：

| 我们读的字段/成员 | 0.1.5-rc.2 | **0.1.6-alpha.2** | 0.1.7-alpha.1 / alpha.2 / **rc.1** |
|---|---|---|---|
| `list.subagentsByParent`（子代理目录） | 39 | **43** | **0** |
| `list.jobsBySession`（作业名册） | — | **44** | **0**（运行时产物 0 命中） |
| `sessions.setSubagentCatalogOpen` | 10 | **12** | **0** |
| `sessions.refreshSubagents` | — | **12** | **0** |

调用点全是**可选链**（`setSubagentCatalogOpen?.(…)`、`refreshSubagents?.(…)`），缺失时**静默 no-op**：`catalogs = {}` → `rootCatalog === undefined` → `summaryBackedLoading` 恒真 → 走 `CatalogLoadingRows`（按摘要镜像逐个子会话渲染 `aria-disabled` 占位行，标签固定 `t('loading')`）。**既不报错也不自愈。**

**为什么三轮都没抓到（三条，都值得记）**：

1. **兼容性闸门只管版本范围，看不见 API 删除**——我方 `^0.1.7-alpha.1` 合法满足 rc.1，闸门如实放行。闸门保证的是「版本可比」，不是「成员还在」。
2. **「控制台 0 error」在这类回归上是无效证据**——降级是**设计成静默**的（可选链 + 空态兜底），我在 §8.2 报的 0 error 恰恰因为它坏得安静。
3. **我的回归面全是我们自己的锚点**（槽位 / 品牌 / 页头 / 滚动 / `data-turn-running`），**没有一面覆盖「插件依赖的上游数据缝」**。

**上游契约的替代面（已核实，非猜测）**：目录改为标准逐 Session **投影值** `projectionsBySession[parentId].values.subagentCatalog`；未打开的目录分支用 **`refreshProjections(sessionId)`** 显式读取（它取代了 0.1.6 的 observe/unobserve 对，**没有 un-observe 对端**）。依据是上游决策记录 `.agents/notes/implemented/simplification/2026-09-08-web-subagent-catalog-projections.md`：「功能消费者从 `projectionsBySession` 中选择 `subagentCatalog`」「本决策**取代**…专用成员刷新机制」。作业名册改为 `ctx.jobs` 客户服务（`state` 快照 + 按会话 `watchRows`）。两个快照的**构造点**给了最直观的对照：

```
0.1.6: this.list.set({ ids, byId, phase, subagentsByParent, jobsBySession })
rc.1 : this.list.set({ ids, byId, phase, projectionsBySession })
```

**修复与实测**：`dsh-coding-sidebar` **1.0.32**（两缝迁移 + 顺带修掉同一 bug 类的第三处 `TeamView` 的 `refreshSubagents`）。rc.1 dev 隔离实例实测：修复前 = 36 个 `role=treeitem[aria-disabled=true]` 全「加载中…」；修复后 = **36 个 treeitem、aria-disabled 0**、显示真实条目（如「Implement Task 1 builtin templates · 一次性 · 当前」，来自 catalog `label` + 摘要活动态）。⇒ 确实从摘要兜底分支回到了目录分支。

**⇒ 新增验证面（建议固化进升级 SOP，与 §8.4 的 peer 预演并列）**：

对**每个自带插件**，把它调用的上游成员逐个拿到目标 tag 上验存：

```bash
# 以 dsh-coding-sidebar 为例：先列出它读的上游面（可选成员是高风险集），再逐个核对
cd /Users/libing/kk_Projects/dsh-coding-sidebar
grep -nE "^\s+[a-zA-Z]+\?[(:]" src/context-types.ts          # 可选成员 = 静默失败风险面
# 再对每个名字查目标 tag（同时查 src 与构建产物，产物才是在跑的真相）
for m in subagentsByParent setSubagentCatalogOpen refreshSubagents jobsBySession \
         projectionsBySession refreshProjections watchRows; do
  printf '%-24s src=%s runtime=%s\n' "$m" \
    "$(git -C ../deepseek-harness grep -c "$m" dsh-v0.1.7-rc.1 -- packages/ 2>/dev/null | wc -l | tr -d ' ')" \
    "$(grep -rl "$m" ../deepseek-harness/packages/api/session-controller/lib 2>/dev/null | wc -l | tr -d ' ')"
done
```

**判据**：凡我方**可选链调用**的成员，在目标 tag 上「src 与 runtime 双双 0」即**静默失效**——它不会让任何门禁变红，只会让功能少一块。**这条检查必须逐版本做**，因为它既不进类型检查（可选成员合法缺席），也不进兼容性闸门（只看版本范围）。

### 8.9 本批补记的提交

- `dsh-coding-sidebar` **1.0.32** @ `8a2c493`（两缝迁移 + TeamView 第三处 + 版本号）。
- `dsh-plugins` @ `8a76774`（镜像）；KCoder `bundle/` @ `e20a4d4`（镜像同步 + 既有 `sync-bundles --check` 零差异）。
- **撤回 §4 的一条措辞**：§4.0「五个插件本版零改动」应读作「**类型/契约面**零改动」；数据缝面本版**有实质改动**（1.0.32）。

---

# 9. 【决策记录】插件退役评估——已评估，**决定不退役**（2026-09-23）

> 本节是一份**决策记录**，不是待办。结论：**不退役 `dsh-coding-sidebar` 与 `dsh-file-review-kcoder`，维持现状**。
> 触发：上游 rc.1 发布说明以 `v0.1.5-rc.3 → rc.1` 累积口径重述了「侧边栏集成终端/网页/子智能体会话/提交计划 + 文档表格文件改动预览审阅」，因此重新评估「是否可用上游原生替代自有插件」。

## 9.1 结论

**不退役。核心理由是三条硬约束，其中两条与本次升级无关。**

## 9.2 前提纠正：「退役 = 用上游原生替代」这个等式不成立

上游原生侧栏**已经在运行**，我方压着的是它的**可见外壳**：

| 层 | 现状 |
|---|---|
| 原生**服务层** `ui-sidebar-right` | **必须保留**。`ui-chat` 的 `dsh.client.inject` 硬声明它（`packages/client/ui-chat/package.json:40`），`ui-deliverables`、`ui-plan`、`ui-reference`、`ui-sidebar-*` 等同样依赖。禁用它 = 主对话链整体挂掉 |
| 原生**可见外壳** | 已由 `style-overlay.ts` 的 `NATIVE_SIDEBAR_CSS` 压制（`data-sidebar-right-{expand,panel,float-host}`） |
| 我方 `dsh-coding-sidebar` | 承担**用户可见**的右侧工作台 |

所以「退役」的真实含义是**放开压制、推翻铁律 1**——不是剪掉一个多余插件。

## 9.3 为什么与本次升级正交

逐包核对 alpha.2 → rc.1 的**非 package.json 变更数**：

| 包 | 源码变更 |
|---|---|
| `ui-sidebar-right` · `ui-sidebar-browser` · `ui-sidebar-terminal` · `ui-sidebar-files` · `ui-dockkit` · `ui-open-in-app` · `ui-plan` | **全部 0（源码逐字节相同）** |
| `ui-deliverables` | 9（diff 配色 token + preparing 阶段 + 图片说明） |

**推论**：原生侧栏的能力面在 rc.1 **一次都没长**。铁律 1 定于 2026-09-19，当时 KCoder 消费的就是 alpha.2——而 rc.1 的侧栏与 alpha.2 相同。因此：

- **若 09-19 判定「原生不足以替代」，该判定在 rc.1 依然成立**；
- rc.1 发布说明里那条醒目的侧边栏条目是**累积口径**，相关能力在 alpha.2 就已在位；
- **要翻案不是"rc.1 给了新理由"，而是"产品负责人改主意"**。

## 9.4 硬约束一：铁律 1（需产品负责人显式拍板才能改）

`docs/ARCHITECTURE.md §12`（2026-09-19 定，产品负责人原话）：

> **铁律 1：不使用上游原生侧边栏功能**——右侧工作台只由自研插件 `dsh-coding-sidebar` 承担；上游原生右侧栏不作为产品功能使用。后续针对上游变化，只迭代完善我们的侧边栏插件，不接回原生侧栏。
> **要改铁律，必须由产品负责人显式拍板并在本节留下日期与理由。**

且**两天前刚试过并推翻**：`70dcbc7`（09-18 右侧栏回归原生 + 退役三自研插件）→ `95e7a83`（09-19 un-retire dsh-coding-sidebar）。

## 9.5 硬约束二：上一次翻案的完整理由（§9.9「评估盲区修正」）

09-18 的退役决策被推翻，理由是**评估本身有盲区**：

1. **版本认知过时**：09-18 评估基于**仓内退役残档（1.0.16）**，而真源已到 **1.0.17**；
2. **机制面变化**：上游已把插件升为一等公民（`9ddef327a4` 默认解析 link→runtime、`fb0fb48033` 客户端插件免重载），"fork 追踪成本"论据被方向性削弱；
3. **活体实测**：npm 装包实跑，host/client 半加载与宿主渲染全部正常，唯一断点是 turnTail 槽位 `chain→list`（修复面全在插件侧）。

盲区修正后列出的**不可替代能力**（上游原生**无**且**不会有**）：

- **Git 面板**：变更/diff/历史/分支/暂存/提交/还原/上游距离/推送/GitHub 操作 → 上游**无**任何 in-app git/source-control UI
- **代码编辑器**：CodeMirror 可改可存 → 上游 `packages/client` 与 `apps/web` 下 `monaco`/`codemirror` **零命中**（预览只读）
- **视频预览**：16 种格式 + Range 流式 → 上游文档预览**无视频**
- **轨迹图**：真实轨迹账本三列泳道图 + 时间间距回放 + token 分桶 → 上游**无**
- **侧边对话 / 分栏 / 自由窗口 / 固定终端** → 上游只有 docked pane/tab，**无分栏与浮动窗口**
- **QiLin 通道设置接管**（自有场景，上游永远不会有）

## 9.6 硬约束三：文件审查的撤销能力无原生对应（已实锤）

全上游 rc.1 检索 `undoHunk` / `revertHunk` / `hunk.*undo` / `applyUndo`，以及 `packages/deliverables`、`ui-deliverables`、`ui-tool` 域内 `undo` —— **全部零命中**。而我方 `file-review-service.ts` 是 "Host-side, workspace-contained undo / redo service for produced text diffs"（含 `applied`/`undone` 状态机与 redo）。**这是真差异化。**

且**撤销独立于侧边栏**：它活在 Host 侧 Typert 服务里，侧边栏 Tab 只是入口之一 → **退 Tab 也退不掉撤销**。

## 9.7 能力差集全表（评估留痕）

> 核对基准：rc.1 tag。原生侧标注了具体包。

| 能力 | 上游原生 | 我方插件 | 差集归属 |
|---|---|---|---|
| 右侧停靠面板 / tab / 浮动 | ✅ `ui-sidebar-right` + `ui-dockkit` | ✅ | 重叠 |
| 文件树 | ✅ `ui-sidebar-files` | ✅ | 重叠 |
| 终端（xterm + PTY） | ✅ `ui-sidebar-terminal`（KCoder **已禁用**，防双入口） | ✅ `dsh-terminal` | 重叠（产品已裁决归自有） |
| 浏览器（iframe / Electron webview） | ✅ `ui-sidebar-browser`（KCoder **已放开**） | ✅ 多 Tab + 历史 + 接管 | 重叠 |
| Markdown / 代码 / 图片 / PDF / HTML 预览 | ✅ | ✅ | 重叠 |
| 表格预览（xlsx/xls/csv/tsv） | ✅ 只读 FortuneSheet + 公式栏 | ✅ Univer | 重叠 |
| **Office 预览（doc/docx/ppt/pptx→PDF）** | ✅ `office/` + `packages/document/office-to-pdf` | ✅ | **重叠**（注：上一轮分析曾误记为"原生无 Office"，本表已更正） |
| **视频预览（16 格式 + Range）** | ❌ **无** | ✅ | **我方独有** |
| **Git 面板** | ❌ 无 | ✅ | **我方独有** |
| **代码编辑器（可改可存）** | ❌ 无（预览只读） | ✅ CodeMirror | **我方独有** |
| **轨迹图** | ❌ 无 | ✅ | **我方独有** |
| **侧边对话 / 分栏 / 自由窗口** | ❌ 无 | ✅ | **我方独有** |
| 子智能体会话 tab | ✅ `ui-subagent` | ✅ | 重叠 |
| 计划 / 提交计划 tab | ✅ `ui-plan` | ✅ | 重叠 |
| 任务计划与后台任务 | 部分（Jobs 面板） | ✅ 含 `plans/` 约定目录 | 我方略宽 |
| 轮尾 changed-files 卡 | ✅ `ui-deliverables`（KCoder **已关** `tailCard:false`） | ✅ | 重叠（产品已裁决归自有） |
| 审查 tab（统一 / 双侧 diff） | ✅ `changes-review`，双侧更完整 | ✅ 仅统一 | 原生略强 |
| 行 hover diff 预览 | ✅（500ms） | ❌ | 原生独有 |
| 交付卡 + 原生打开 | ✅ + `ui-open-in-app` | ✅ | 重叠 |
| **逐 hunk 撤销 / 重做** | ❌ **全上游零命中** | ✅ | **我方独有** |
| bash 产物保守捕获 | 部分（`present` 工具内置） | ✅ 重定向/curl -o/cp/mv/tee | 我方略宽 |
| 在系统应用中打开 / 显示位置 | ✅ catalog 覆盖编辑器/Git GUI/终端/文件管理器 | ✅ | 重叠 |

**净结论**：重叠区大，但**六个我方独有项**（git、编辑器、视频、轨迹图、分栏/侧边对话、hunk 撤销）**没有任何原生替代**。退役将直接损失这六项。

## 9.8 附带的量化事实

- `dsh-file-review-kcoder` 源码规模 **26 个文件 / 5818 行**——退役节省的维护面有限，而损失的是唯一无替代的撤销能力。
- 原生 review tab 注册为 `id: '@deepseek-ai/dsh-client-ui-deliverables'`、`kind: 'changes-review'`、`pattern: 'dsh-resource://changes-review/**'`、`priority: 'builtin'`。**若将来要共用该地址，需注意 builtin 优先级与 `list` 语义下原生条目无法被抢占**（KCoder 文档已记录该约束）。

## 9.9 已考虑并否决的中间方案

**「只退审查 Tab，保留轮尾卡 + 撤销」**——技术上可行（撤销活在 Host 服务，不依赖 Tab；原生 review tab 更强且已可用），但**否决**，理由：

1. 产品已显式裁决**原生 changed-files 尾卡关闭**（`ui-deliverables.tailCard: false`，防同 turn 双行），走"共存规则取代抢占"路线；退我方 Tab 会让审查入口在两个产品决策之间出现空档；
2. 收益有限（只是少一个 Tab），却要新增"已退 Tab 但保留服务"的不对称状态，增加后续集成的心智负担；
3. 与铁律 1「右侧工作台只由自研插件承担」自洽性下降。

**结论：保持现状。** 若将来要重估，按 §9.5 的方式先复核我方插件**当前真源版本**（09-18 翻车的直接原因就是拿退役残档当评估基线）。

---

## 附录 A：本版「零变化 / 关键断言」证据速查（可直接复现）

```bash
cd /Users/libing/kk_Projects/deepseek-harness
TOP=dsh-v0.1.7-alpha.2; BOT=dsh-v0.1.7-rc.1

# 1) 原始变更面与噪声
git diff --name-only $TOP $BOT | wc -l                        # 933
git show --name-only --format='' a60af51e80 | sort -u > /tmp/bump2.txt   # 312 个 package.json
git diff --name-only $TOP $BOT | sort > /tmp/all2.txt
comm -23 /tmp/all2.txt /tmp/bump2.txt | wc -l                 # 621（可直接复现；更严口径可记 629）

# 2) 侧栏一族源码零变化
for p in ui-sidebar-right ui-sidebar-browser ui-sidebar-terminal ui-sidebar-files \
         ui-dockkit ui-open-in-app ui-plan; do
  echo -n "$p: "; git diff --name-only $TOP $BOT -- packages/client/$p | grep -vc 'package\.json$'
done                                                          # 全部 0

# 3) 两组「引入即撤销」——注意第 2 组只是部分净零
git diff b09dd94827^ 7c8a44ac31 --stat                        # 空 → 整组净零
git diff 2aa3a469db^ 3bf6d738f1 -- packages/api/session-controller docs/subsystems/session-projection.md
                                                              # 空 → definitions-changed 已被撤销
git grep -n "definitions-changed" $BOT -- packages docs       # 空 → 该事件在 rc.1 不存在

# 4) peer 门禁判定（需用上游同版本 semver）
node -e "
const s=require('./node_modules/.pnpm/semver@7.8.5/node_modules/semver');
for (const r of ['^0.1.7-alpha.1','>=0.1.0-rc.5 <0.2.0','^0.1.7-rc.1','^0.1.7'])
  console.log(s.satisfies('0.1.7-rc.1', r, {includePrerelease:true}) ? 'PASS' : 'FAIL', r);
"                                                             # PASS PASS PASS FAIL

# 5) 上游无 hunk 撤销
git grep -lin "undoHunk\|revertHunk\|hunk.*undo\|applyUndo" $BOT -- packages apps   # 空

# 6) 我方不注册 tool.call.toolview
grep -rn "tool.call.toolview" /Users/libing/kk_Projects/dsh-{coding-sidebar,file-review-kcoder}/src  # 空
```

## 附录 B：本版「新账 / 旧账」速查

| 分类 | 条目 |
|---|---|
| **新账（alpha.2 之后真正新增）** | 插件兼容性强制（C12/§3.2）· 工具生命周期三态 + 四档视图（N9/§3.1）· 聊天图片悬停放大（N10）· LibreOffice Kit 0.1.0 + `skill-office` 配置（N11/§3.4-1）· Agent Team 投影化（N4）· 语音下载源（N5）· Windows 打开改 Explorer（I4）· 插件停滞与 Gateway 内存修复（F3/F8）· 镜像恢复（§3.2-5） |
| **旧账复核（累积说明重述，前两版已消化）** | 侧边栏集成终端/网页/子智能体/计划（N1）· 会话置顶归档（N2）· 插件管理页三分源（N3 主体）· MCP 资源（N6）· Headless/SSH（N7）· 浏览器与自动审阅（N8）· 长会话滚动（I1）· 后台任务（I2）· Session V4（C2）· 设置迁移（C4）· PTC 改名（C5）· Ralph/E2B（C6）· readBytes（C7）· Agent 生命周期异步（C9）· spill `maxInlineTokens`（C11） |
| **净零（不得引用）** | `b09dd94827`↔`7c8a44ac31`（process-row polish）· `2aa3a469db`↔`3bf6d738f1`（**`session-projection/definitions-changed` 事件不存在**） |
