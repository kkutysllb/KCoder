# 上游 deepseek-harness 0.1.7-alpha.1 → 0.1.7-alpha.2 差异分析

> 分析日期：2026-09-23 · **仅分析，未改动任何代码**
> 消费形态：KCoder v0.6.15（桌面壳）+ 五个自研内置插件（技能 / MCP / 侧边栏 / 文件审查 / 终端）
> 前一版分析：[`docs/upstream-0.1.7-alpha.1-analysis.md`](./upstream-0.1.7-alpha.1-analysis.md)（0.1.6-alpha.2 → 0.1.7-alpha.1，结构、口径与本文一致）
> 官方发布说明：[`dsh-v0.1.7-alpha.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-alpha.2)（2026-09-22 23:49 发布，中英双语，体验优化 5 条 + 问题修复 8 条 + 其他变更 2 条）

---

## 0. 一句话结论

**这是一次「同版本内的小步补丁」，不是与上一版同级的大版本：官方发布说明只有 15 条，且全部是 UI 滚动/会话分页/代码块样式/工具结果保留预算一类的收敛修复。契约面最重要的一条结论是——我们五个插件赖以生存的四条主干契约（`ui-slots` 槽位、`ui-settings` 设置表单、`typert-protocol/registry`、`packages/skill`）在这一版里源码零变化，只有 package.json 的版本戳与依赖范围改写。**

- **好消息（已逐条核实）**：① `packages/client/ui-slots` **源码零 diff**（唯一变更是 package.json 版本戳 + `workspace:^`→`workspace:*`）——五个插件的槽位注册契约原样存活，连续第二版零变化；② `packages/client/ui-settings` 同样**源码零 diff**——侧边栏的 `settings.section` 注册面不受影响；③ `packages/typert/protocol`、`packages/typert/registry` **源码零 diff**——文件审查插件的 Typert Remote 契约零风险；④ `packages/skill` **源码零 diff**——技能包不受影响；⑤ `packages/terminal/**`（含 `tool-terminal`、`terminal-bash`）**源码零 diff**；⑥ `packages/mcp/mcp-client/src/index.ts`（Config 面）零变化——KCoder 的 MCP patch 条目形状仍然有效。
- **坏消息（已实锤，3 条）**：① **`spill-policy` 的配置键被硬改名**：`maxInlineBytes`（字节）→ `maxInlineTokens`（token），基座 bundle 默认值从 `50000` 变成 `12500`；旧键残留 = 配置校验失败（`maxInlineTokens` 为空 → 策略整体**静默自禁用**，不再有工具结果保留），发布说明原文明确要求下游改键；② **工具结果保留的语义整体重写**：从「纯文本按 UTF-8 字节 head/tail」变成「文本 + 图像按模型实际 token 计价保留首尾」，且 **`read` 工具不再是豁免项**——大文件读取现在也会被保留/截断并给出 spill 地址；③ **新增未在发布说明记载的 `ToolDefinition.projectContent` 钩子**（在 `tools/post-execute` **之前**安装工具自有内容），MCP 客户端已从 `finalizeContent` 迁移过去——虽是**纯新增**（`finalizeContent` 保留未删），但它改变了 MCP 图像结果与 spill 策略的先后次序，是理解本版行为差异的关键。
- **未记载的两处类型破坏 + 一处 DOM 属性移除（已逐条核对我方消费面：全部零实际影响，但必须记账）**：① `DiffBlockLabels` **删掉必填 `files` 并新继承 3 个必填字段**（`CodeToolbarLabels.codeLabel/wrapLabel/unwrapLabel`），`ReadBlockLabels` 同样新增 3 个必填字段；② `ClientModuleLoader` 新增必填方法 `importError(id)`，`assertEntriesActive(ctx)` 变为 `assertEntriesActive(ctx, modules)`；③ 上游桌面更新指示器与侧边栏徽标上的 `[data-error]` 被移除。三者对「自渲染 diff + 不实现该接口」的我方插件均无影响（§3.1-2/3）。
- **一个没有被发布说明提及、但对桌面壳有真实影响的行为翻转**：`tool-jobs` 的 `maxConsecutiveWakes` **默认值从 3 改成「不设上限」**（未声明即每次空闲完成都唤醒 owner）——发布说明只把它写成「修复会话停住」，没提「默认去掉了上限」。这修掉了 KCoder 现场「连续后台命令后会话停住」的 bug，但也**移除了引擎自带的防自激链**，需要在产品侧评估。
- **总账**：162 提交（非 merge 101：fix 56 / test 22 / docs 9 / feat 7 / release 3 / build 2 / perf 1 / chore 1）/ **869 个文件**——但其中 **361 个文件只被 3 个「家务提交」碰过**（版本号、依赖范围），**真实代码变更面只有 509 个文件**，且其中 **131 个是 README / `.i18n.yaml` 文档同步**。窗口 **11 小时**（2026-09-22 12:12 → 23:25，同一天）。
- **与 alpha.1 的量级对比**：alpha.1 是 1299 提交 / 4754 文件 / 窗口 5 天 / +351718 −108840；alpha.2 是 162 提交 / 869 文件（真实 509）/ 窗口 11 小时 / +21355 −11052。**本次升级的集成风险大约是上一版的 1/8。**

> **口径声明（重要）**：本版原始 `git diff` 会把 **325 个 `package.json`** 报成变更，其中 **324 个**来自 3 个家务提交（`10ea83bcc3` release 版本号、`4e6028a604` vendor/native 依赖改 `workspace:~`、`37372101b5` DSH 内部依赖钉 `workspace:*`）——这是**噪声**。本文所有「零变化 / 有变化」的判断，都以**剔除这 3 个提交后的真实文件集**为准，并逐包给出证据。这是上一版分析没有做过、而本版必须做的区分——否则会把「只有版本戳变了」误判成「契约变了」（例如 `ui-slots`、`ui-settings`、`typert/*`、`skill`、`terminal`、`session`、`fs` 这 8 个关键包在原始 diff 里都"有变更"，实际源码零变化）。

---

## 1. 对比口径

| 项 | 值 |
|---|---|
| 旧基线（当前消费态） | `c36a83ff6bb95e3f82cf79f9be7c724270a8aa61` = 上游 tag **`dsh-v0.1.7-alpha.1`**（2026-09-22 12:12，merge PR #4901） |
| 新目标 | `00102833dfaee1da9f48a3a8eae9d34005a75218` = 上游 tag **`dsh-v0.1.7-alpha.2`**（2026-09-22 23:25，merge PR #4978） |
| 集成分支现状 | 上游 fork `kkutysllb/deepseek-harness` 已 fetch 到该 tag（`refs/tags/dsh-v0.1.7-alpha.2` 存在，reflog 显示 09-23 已 `merge upstream/master: Fast-forward` 到 `master`）；**KCoder main 尖端 `e3d5d56`（无该 tag）与 QiLin（最新 tag 仍为 `dsh-v0.1.7-alpha.1`）都还没做集成分支**——本版是「先分析」 |
| 提交量 | 162（含 merge）/ 101（非 merge）：fix 56 · test 22 · docs 9 · feat 7 · release 3 · build 2 · perf 1 · chore 1 |
| 文件量 | 869 变更 → **剔除 3 个家务提交后 509**（其中 README/`.i18n.yaml` **131**、`package.json` 1） |
| 变更行数 | +21355 −11052（含 snapshots/fixtures，真实代码面远小于此） |
| 变更最重的包 | `packages/client`（176，真实）· `apps/desktop`（46）· `apps/web`（42）· `packages/api`（27）· `packages/spill`（18）· `packages/experimental`（13）· `packages/credentials`（10）· `packages/boot`（10）· `packages/subprocess`（8）· `packages/llm`（7）· `packages/shell`（6）· `packages/core`（6）· `packages/mcp`（5） |
| **源码零变化的插件关键包** | `packages/client/ui-slots` · `packages/client/ui-settings` · `packages/client/connection` · `packages/typert/protocol` · `packages/typert/registry` · `packages/skill` · `packages/terminal/**` · `packages/session` · `packages/fs` · `packages/tools`（`packages/core/tools` 除外）· `packages/preset` · `packages/extensions`（tool-cordis 目录） |
| vendor 版本 | cordis 4.0.3→**4.0.4** · cosmokit 1.8.4→**1.8.5** · group 1.0.3→**1.0.4** · hmr 1.0.18→**1.0.19** · include 1.0.8→**1.0.9** · loader 1.0.4→**1.0.5** · logger-console 1.0.3→**1.0.4** · schemastery 3.18.3→**3.18.4** · timer 1.1.5→**1.1.6**（提交 `d0dca04e22`） |
| 新增 pnpm patch | `exceljs@4.4.0`（806 行，Excel 特殊内容预览修复的载体）——上游 patch 家族第 4 个 |
| 依赖范围策略（新增硬门禁） | `workspace:*`（DSH 目标）vs `workspace:~`（vendor/native 目标）——由 `scripts/verify-package-dependencies.ts` 强制，已接入 `run-gates` |

---

## 2. 官方发布说明逐条 → 代码层核实

> 标记口径：【已核实】= 已定位到具体提交/文件并读过 diff；【部分】= 定位到提交但细节待补。
> 每条给出：发布说明原文摘要 → 代码落点（提交 + 文件）→ 对 KCoder / 五个插件的影响。

### 2.1 体验优化（5 条）

| # | 发布说明条目 | 代码落点（提交 → 文件） | 影响判定 |
|---|---|---|---|
| I1 | 稳定会话与工作过程组的滚动跟随；改善历史分页与轮次跳转，减少发送消息瞬间跳动/重复显示 | **本版最大的一条**，由 9 个提交合成：`13dfae20c3`、`2251b6189b`、`633cf7394e`、`fb02779a26`、`838eff14eb`、`1f029fc442`、`6b4055bf32`、`43a8a22824`、`50ba2c8bb2`。落点：`packages/client/ui-chat/src/client/chat/{use-scroll-follow,use-chat-viewport,use-process-scroll,use-chat-reading}.ts`、`ChatView.tsx`、`ChatView.module.css`、`ChatGroupSeat.tsx`、`TurnNavigator.module.css`；分页落在 `packages/api/session-controller/src/history.ts` | 【已核实】**对自研插件零 API 破坏**（钩子是 ui-chat 内部 hook，未导出）；但**页面 DOM 结构与滚动容器几何有实质变化**，凡依赖 ui-chat 内部 CSS 类/滚动容器做定位的插件需回归 |
| I2 | 统一会话区域各代码块样式，支持复制/换行，改善差异内容与行号展示 | `8d2cd0cf72`（feat 主体）、`f114233545`（溢出收口）、`62f816f3a5`。落点：`packages/client/ui-primitives/src/CodeToolbar.tsx`（**新增文件**）、`CodeCard.module.css`、`DiffBlock.tsx`、`markdown/CodeBlock.tsx`、`ui-tool/src/client/tool/components/{ToolRow,ToolDetails}.tsx` | 【已核实】**含一处类型级破坏**：`DiffBlockLabels` 删掉 `files: (count: number) => string` 并改为 `extends CodeToolbarLabels`；`DiffBlock` 移除底部 footer、改用新 `CodeToolbar`。详见 §3.1 |
| I3 | 重新编辑排队消息时保留换行，避免多行内容合并成一行 | `c74e36acfc`。落点：`packages/client/ui-conversation/src/client/queue/QueueDock.tsx` + `QueueDock.module.css`；`apps/web/tests/queue-actions.e2e.ts` | 【已核实】ui-conversation 内部；无导出契约变化 |
| I4 | Agent Team 成员初始任务增加「查找队友 / 联系 Lead」指引，明确按成员名称发消息 | `6ec97fa124`、`d257fa4af7`、`a79e3a2a5f`。落点：`packages/experimental/tool-agent-team/src/index.ts`（+ 测试） | 【已核实】提示词文本级；KCoder 不装 Agent Team，无影响 |
| I5 | 首次装插件且未配置源时，优先找最优可访问 npm 源；保留手动选择与私有源 | `dccf989cd8`（feat：**CN 网络出口优先大陆镜像**）、`3c50bf6b6c`（feat：**选第一个有响应的公共源**）、`8cf07ea76c`（fix：初始查询期间保留已记住的源）。落点：`packages/boot/plugin-manager/src/registry.ts` + `src/index.ts`，测试 `apps/web/tests/plugin-install-registry.e2e.ts`、`fixtures/registry-ping.mjs` | 【已核实】**对 KCoder 低影响但值得注意**：KCoder 自管物化链，不走插件安装 UI；但若用户在产品内用插件管理页装插件，会看到新的源选择行为 |

### 2.2 问题修复（8 条）

| # | 发布说明条目 | 代码落点 | 影响判定 |
|---|---|---|---|
| F1 | 修复长文件名越出气泡、拖动文件改动审阅浮窗后下拉菜单错位 | `5aa21749b9`（wrap 长文件引用 + 跟踪浮动菜单）、`c92d5ebe18`（perf：按观测尺寸适配 tooltip）。落点：`packages/client/ui-primitives/src/{user-text.tsx,Tooltip.tsx,Menu.tsx}` | 【已核实】**`Menu.tsx` 行为变更**：portal 版改为 `requestAnimationFrame` 逐帧跟踪锚点（原来只在 scroll/resize 重算）——修复「拖拽/transform 祖先时菜单不动」；props 未变，**纯内部改进** |
| F2 | 修复含特殊内容的 Excel 文件无法预览或内容丢失 | `34a0a8e81d`（OPC 路径与 XML 编码）+ **新增 `patches/exceljs@4.4.0.patch`**。落点：`packages/client/ui-sidebar-documentpreview/src/client/excel/{excel.tsx,xlsx-archive.ts}` + 大量 `tests/fixtures/excel-{opc,xml}/*.xlsx` | 【已核实】**对侧边栏是功能增强**：侧边栏自带 Excel 预览（Univer），不走上游这条链；但 `exceljs` patch 是上游第 4 个 patch——若我方 lock 里也钉 exceljs，需注意合并 |
| F3 | 修复持久 PowerShell 命令完成后仍需额外等待 | `97545d9c8f`（fix）+ `74f4c438de`（test 钉住）。落点：`packages/shell/tool-pwsh-persistent/src/index.ts` | 【已核实】**纯性能修复，无契约变化**：删掉工具自装的 `prompt` 覆盖（`SHELL_PROMPT` 常量、`stripPrompt`、`promptCompleted`、`PWSH_PROMPT_SETUP` 全部删除），改用 PTY 缝的既有 `waitReason === 'stdin_read'` 判完成。工具调用 8493/3722/3832/3759 ms → **1340/255/251/241 ms**。注意：`stdin_read` 在 alpha.1 已存在（不是新增枚举值） |
| F4 | Excel 预览随面板大小自动调整，保留当前工作表与选中单元格 | `58651b8359`。落点：`ui-sidebar-documentpreview/tests/zoom-viewport.client.spec.tsx`、excel-body 测试 | 【已核实】UI 内部 |
| F5 | 修复连续完成多个后台命令 / 一次性子代理任务后会话停住；**默认不再限制任务完成后连续唤醒 Agent 的次数** | `b6775f6d4f`（fix）+ `2d653be7b0`（回应 review）。落点：`packages/jobs/tool-jobs/src/index.ts` | 【已核实】**未记载的行为翻转 + 风险项**：`maxConsecutiveWakes` 的 schema 由 `z.number().min(1).default(3)` 改为 `z.number().min(1)`（**无默认值**），语义变为「不声明 = 不设上限」。发布说明只讲「修好停住」，没讲「去掉了上限」。详见 §3.3 |
| F6 | 修复语音输入切换识别语言/识别器时设置保存失败 | `7c84d9f790`（fix）+ `13d9606675`（test）。落点：`packages/experimental/speech-to-text/src/index.ts`、`tests/fixtures/selection.patch.yml` | 【已核实】实验线；KCoder 不装语音转写，无影响 |
| F7 | 模型发现候选列表优先显示可读名称，缺失时显示 ID；仍可按名称/ID 搜索 | `b34b5d33a1`（fix）+ `bef0869d14`（test）。落点：`packages/client/ui-settings-models/src/client/ModelListEditor.tsx`、`apps/web/tests/models-settings.e2e.ts` | 【已核实】模型设置 UI 内部 |
| F8 | 修复 Web 服务重启后显示已连接却无法继续显示回复；原页面在应用就绪后恢复连接 | `a44ced5b96`（fix：**把 Remote WebSocket 门禁挂到 application readiness 上**）。落点：`apps/web/tests/{server-restart.e2e.ts,fixtures/restart-startup.js,fixtures/restart-startup.overlay.yml}` + `packages/api/*` | 【已核实】**对桌面壳有真实意义**：KCoder 是「Electron 壳 spawn `dsh web` 子进程」形态，重启/重连场景正是它的战场。修复方向与 KCoder 的 `READY_LINE_RE` 就绪判定互补，不冲突 |

### 2.3 其他变更 / Chores（2 条）

| # | 发布说明条目 | 代码落点 | 影响判定 |
|---|---|---|---|
| C1 | 工具返回的文字和图片改按统一估算 token 预算保留首尾；修复 MCP 图片在文字截断后不可用；提供被省略内容的读取地址。**自定义 `spill-policy` 的 `maxInlineBytes` 必须改为 `maxInlineTokens`** | 主体 `ab102138c8`（fix，40+ 文件），收口 `94728ebd23`、`c4c18ef0d4`、`754733d5d1`、`b74bef5d40`、`5c1d966c3f`、`b0be6e79c2`、`670a903237`。落点：`packages/spill/spill-policy/src/{index.ts,notice.ts,retention.ts(新增)}`、`packages/core/tools/src/{index.ts,schema.ts}`、`packages/mcp/mcp-client/src/tools.ts`、`packages/bundle/base/cordis.patch.yml` | 【已核实】**本版对下游最重的一条**，含硬配置断裂 + 一处未记载的新 API。详见 §2.4 与 §3.1/§3.2 |
| C2 | 把 Cordis 等 vendor 包与 Node Addon System 的自动依赖更新限制为**同一次版本内的补丁版本** | `4e6028a604`、`37372101b5`、`b9b5f7c58e`、`7021420f29`、`4e6028a604`，决策记录 `.agents/notes/implemented/process/2026-09-22-workspace-release-ranges.md`。门禁 `scripts/verify-package-dependencies.ts`（`workspaceRange()` 函数） | 【已核实】**会咬 fork 的一条硬门禁**：新规则 = DSH 目标必须 `workspace:*`、vendor/native 目标必须 `workspace:~`；`run-gates` 已接入（`run-gates.ts:347/757`）。详见 §5.1 |

### 2.4 C1 的代码层展开（本版核心）

`packages/spill/spill-policy/src/index.ts` 被**整体重写**（227 行 → 156 行），不是打补丁：

**（a）配置键与默认值**

```diff
-export const Config: z<Config> = z.object({
-  maxInlineBytes: z.number(),
-})
+export const Config: z<Config> = z.object({ maxInlineTokens: z.number() })
```
```diff
 # packages/bundle/base/cordis.patch.yml（基座 bundle 默认值）
     - id: spill-policy
       name: '@deepseek-ai/dsh-spill-policy'
       config:
-        maxInlineBytes: 50000
+        maxInlineTokens: 12500
```

**（b）计价单位从「UTF-8 字节」变成「模型实际 token」**

```diff
-import { TextRetainer } from '@deepseek-ai/dsh-output-retention'
+import { estimateContent } from '@deepseek-ai/dsh-token-meter/estimate'
+import { createUserMessage, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
```
保留量由 `llm.imageRequestPricing(provider, model).priceImages(images)` 给出（图片的视觉 token + 描述文本 token），文本用 `estimateContent`；拿不到计价器时**抛错 → 被兜住 → 保留原文 + 记一条 warn**（不再静默截断）。

**（c）`read` 工具不再是豁免项**

```diff
-    if (decision.kind !== 'accept' || Object.hasOwn(decision, 'value')
-      || exec.parent !== undefined || exec.name === 'read') return decision
+    if (decision.kind !== 'accept' || Object.hasOwn(decision, 'value') || exec.name === 'read') return decision
```
（`exec.parent !== undefined` 的豁免也改了：现在只有**纯文本**的 PTC 子调用才走老的 log-only 路径；含图片的子调用也进保留。）

**（d）新增 `retention.ts`**：文本 + 图像**有序** head/tail 保留；图像作为**不可分块**整块保留或整块丢弃；文本按单调 token 估价二分切分，且切点避免劈开 UTF-16 代理对（`textSlice`）。

**（e）通知与可恢复地址**：`notice.ts` 增加图片计数维度；被省略内容给出 spill 读取地址；图片位置给出 `[Image: <path>; <mediaType>; <w>×<h>. Use read_image to view it.]`。

---

## 3. 发布说明未提及的代码级变更

> 本节是本文的重点增量：官方 15 条之外的变更，全部经过「剔除 3 个家务提交 → 逐文件读 diff → 归属到提交」的流程。

### 3.1 已实锤（亲手验证，高价值）

**（1）`ToolDefinition.projectContent` —— 新增的工具内容钩子，发布说明完全未提**

`packages/core/tools/src/index.ts` + `schema.ts`（提交 `ab102138c8`），新增一个**在任何 `tools/post-execute` 策略之前**安装工具自有内容的位置：

```ts
// packages/core/tools/src/index.ts（ToolDefinition，新增）
  /**
   * Install execution-prepared content before `tools/post-execute` policies.
   * ... Policy replacements remain authoritative; pipeline failures that bypass
   * post-execute skip projection.
   */
  projectContent?(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): ContentBlock[] | undefined
```

管线次序（alpha.2 实测代码）：

```
execute → projectContent（工具自有，post-execute 之前）
        → tools/post-execute（各级策略，含 spill-policy 保留）
        → finalizeContent（工具自有，materialize 之前）
        → materialize → notifyResult
```

**关键判断：这是纯新增，不是替换。** `finalizeContent` 在 alpha.2 的 `ToolDefinition` 里**仍然存在**（`index.ts:258`，alpha.1 为 `:248`），`defineTool` 两条路径都保留：

```diff
+  if (userProjectContent) {
+    tool.projectContent = (exec, result) => userProjectContent(exec, result)
+  }
   if (userFinalizeContent) {
     tool.finalizeContent = (exec, result) => userFinalizeContent(exec, result)
   }
```

唯一使用者是上游自己的 MCP 客户端（`packages/mcp/mcp-client/src/tools.ts`）：

```diff
-    finalizeContent(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>) {
+    projectContent(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>) {
```

**意义**：MCP 返回的图文结果现在在**保留策略之前**就落成最终 content，所以「文字被截断后 MCP 图片不可用」被修好；同时 `finalizeContent` 的「含 bypass post-execute 的失败也一定被调用」语义仍为插件保留。**对自研插件的实操含义**：我们没有任何插件调用 `defineTool({finalizeContent})`（五个包的 import 面已逐一核对，见 §4），因此**无需跟动**；但若将来要在 post-execute 策略**之前**安装内容，现在有了官方位置。

**（2）`DiffBlockLabels.files` 被删除 —— 而且是「删一个 + 加三个必填」的复合破坏**

```diff
 // packages/client/ui-primitives/src/DiffBlock.tsx
-export interface DiffBlockLabels {
+export interface DiffBlockLabels extends CodeToolbarLabels {
   copy: string
   copied: string
   collapseAria: string
   expandAria: (hidden: number) => string
   collapse: string
   expand: (hidden: number) => string
-  files: (count: number) => string
 }
```
```ts
// packages/client/ui-primitives/src/CodeToolbar.tsx（本版新增，字段全部必填）
export interface CodeToolbarLabels { codeLabel: string; wrapLabel: string; unwrapLabel: string }
```

**修正与补充（第二轮并行核查的结论，比首轮更完整）**：

| 符号 | 变化 | 是否破坏 |
|---|---|---|
| `CodeToolbarLabels`（type） | **新增导出**（`src/index.ts` 全量净 diff 就只有这一行，提交 `f114233545`） | 否（additive） |
| `CodeToolbar`（组件） | **新增文件，但未从 `src/index.ts` 导出** → 包内私有 | 否 |
| `DiffBlockLabels` | 删 `files` **且** 新继承 3 个必填字段 | **是，双重破坏** |
| `ReadBlockLabels` | 改为 `extends CodeToolbarLabels` → 新增 3 个必填字段 | **是，破坏**（首轮未发现） |
| `CodeBlockProps` | 新增**可选** `toolbarLabels?` / `wrap?` | 否（**有 opt-out**） |
| `MarkdownCodeLabels`（`markdown/render.tsx`） | 新增**可选** `toolbarLabels?` | 否 |
| `DiffBlockProps` / `ReadBlockProps` | **未变** | 否 |
| `Tooltip` / `Menu` / `projectUserText` / 全部 icon / `diffTotals` / `DEFAULT_*` / `languageForPath` / `writeClipboard` / `Modal` / `Toast` / `MarkdownText` … | 签名**未变** | 否 |

上游自己的迁移姿势可以作为参照（`ui-tool/src/client/tool/models/primitive-labels.ts` 新增导出 `codeToolbarLabels()`，然后 `{ ...codeToolbarLabels(t), copy: …, }` 拼出来）。**注意 `MarkdownText.tsx` 本身在两 tag 间净 diff 为空**（中间提交的改动被 master 合并覆盖），不要误报它变了。

同时**新增了 3 个共享 locale 键** `codeBlock.title` / `codeBlock.wrap` / `codeBlock.unwrap`（加在**公共词表** `packages/client/locale/src/locales/{en,zh}.ts`，不是任何 feature 命名空间），而**删除了 conversation 命名空间的 2 个键** `diff.files.one` / `diff.files.other`（`ui-conversation/src/client/locales.ts`）——**引用这两个键的插件会直接类型报错**。

> **关于那 3 个新键，不需要任何 per-namespace 工作**（第二轮核查已收口）：`ui-slots` 的 `TranslateNS` 会把每个命名空间的可译键**并上公共词表**——
> ```ts
> // packages/client/ui-slots/src/index.ts（本版零变化）
> export type CommonKeyOf = LocaleNamespaceMap extends { common: infer C } ? C & string : never
> export type LocaleKeysOf<N extends keyof LocaleNamespaceMap & string> =
>   (LocaleNamespaceMap[N] & string) | CommonKeyOf
> export type TranslateNS<N extends keyof LocaleNamespaceMap & string> = Translate<LocaleKeysOf<N>>
> ```
> 且 locale 服务的查询链「命名空间未命中后查 common」。所以任何命名空间绑定的 `t` 都能直接读 `codeBlock.*`，无需在 `ui-conversation` / `ui-chat` 的字典里补条目。

**消费影响评估（已逐一核对，含第二轮复核）**：
- `dsh-coding-sidebar` 从 ui-primitives 导入的符号为 `Button / FileTypeIcon / 24 个 Icon*Regular / Input / MarkdownText / Menu / Modal / StateDot / Tooltip / writeClipboard`——**不含 `DiffBlock` / `DiffBlockLabels` / `ReadBlockLabels` / `CodeBlock`**。侧边栏有自研 `DiffView.tsx`（`parseUnifiedDiff` 纯函数 + 自己的 `sidebar.module.css` 类），DOM 用自己的 `css.gitDiff*`。→ **编译零破坏**。
- `dsh-file-review-kcoder`：源码全仓 grep **零命中** `DiffBlockLabels` / `ReadBlockLabels` / `diff.files.`；其 `data-diff=""` 在自己的 `UnifiedDiff.tsx` 上，与上游无关。→ **编译零破坏**。
- KCoder `desktop/`：同样零命中。
- **结论**：这是本版**唯一一组真实的公共类型破坏**，但对当前三个消费方**全部无实际影响**。若将来复用上游 `DiffBlock`/`ReadBlock`/`CodeBlock`，必须按新 `CodeToolbarLabels` 提供 label，并删除 `files`。

**（3）`ClientModuleLoader` 接口新增必填方法（另一处未记载的类型破坏）**

`packages/client/modules`（`afde35880f`「recover from a failed batch script and record import errors」）：

```ts
// ClientModuleLoader 新增必填成员
importError(id: string): Error | undefined
// 以及（经 web/./src/* 可达，不在主 index）
assertEntriesActive(ctx)  →  assertEntriesActive(ctx, modules)   // 新增必填第 2 参
```

对**实现/模拟** `ClientModuleLoader` 的代码是破坏；对普通消费方不是。**我们四个插件 + KCoder desktop 全仓 grep `ClientModuleLoader` / `assertEntriesActive`：唯一命中是 `dsh-file-review-kcoder/src/client/index.tsx:456` 的一句注释**（在解释 slot 子键归属冲突的历史现场，不是调用）。→ **零破坏**；但这条注释提到的「整条 entry 随 apply 一起失败、`assertEntriesActive` 升级成整个 web boot 失败」机制在本版**依然成立**（`ui-slots` 的 `already declared` 规则零变化），仍是侧边栏/文件审查在槽位命名上必须继续避让 upstream 原生键的理由。

**（3）`ui-primitives` 其余新增/改名均为 additive**

`src/index.ts` 的唯一 diff 是**新增一行导出**：
```diff
+export type { CodeToolbarLabels } from './CodeToolbar.tsx'
```
其余 24 个文件是 CSS token/内部实现（`CodeCard.module.css`、`DiffBlock.module.css`、`ReadBlock.module.css`、`MarkdownText.module.css`、`user-text.module.css`、`markdown/{CodeBlock,render}.tsx`、`ReadBlock.tsx`、`Tooltip.tsx`、`user-text.tsx`）。**`alpha.1` 那轮「81 个图标全改名 Regular/Medium」的适配成果在本版原样有效**——侧边栏已在用 `Icon*Regular` 命名，本版无二次改名。

**（4）`ui-slots` / `ui-settings` / `typert` / `skill` / `terminal` 源码零变化的证据**

```bash
$ git diff --stat dsh-v0.1.7-alpha.1 dsh-v0.1.7-alpha.2 -- packages/client/ui-slots
 packages/client/ui-slots/package.json | 8 ++++----        # 只有版本戳 + workspace 范围

$ git diff --stat ... -- packages/client/ui-settings
 packages/client/ui-settings/package.json | 10 +++++-----   # 同上

$ git diff --stat ... -- packages/typert/protocol
 packages/typert/protocol/package.json | 8 ++++----        # 同上
$ git diff --stat ... -- packages/typert/registry
 packages/typert/registry/package.json | 8 ++++----        # 同上

$ git diff --stat ... -- packages/skill
 packages/skill/skill/package.json | 4 ++--                # 同上
$ git diff --stat ... -- packages/terminal
 packages/terminal/terminal/package.json | 4 ++--
 packages/terminal/tool-terminal/package.json | 4 ++--
 packages/terminal/terminal-bash/package.json | 4 ++--
```

**（5）vendor 全家桶补丁版本上抬 + 依赖范围策略**

| 包 | alpha.1 | alpha.2 |
|---|---|---|
| `@deepseek-ai/cordis` | 4.0.3 | **4.0.4** |
| `@deepseek-ai/cosmokit` | 1.8.4 | **1.8.5** |
| `@deepseek-ai/cordis-plugin-group` | 1.0.3 | **1.0.4** |
| `@deepseek-ai/cordis-plugin-hmr` | 1.0.18 | **1.0.19** |
| `@deepseek-ai/cordis-plugin-include` | 1.0.8 | **1.0.9** |
| `@deepseek-ai/cordis-plugin-loader` | 1.0.4 | **1.0.5** |
| `@deepseek-ai/cordis-plugin-logger-console` | 1.0.3 | **1.0.4** |
| `@deepseek-ai/schemastery` | 3.18.3 | **3.18.4** |
| `@deepseek-ai/cordis-plugin-timer` | 1.1.5 | **1.1.6** |

依赖范围语义（官方决策记录原文）：`workspace:*` 用于 DSH 目标（发布时替换为**精确版本**），`workspace:~` 用于 `vendor/` 与 `native/system` 家族（发布时替换为 `~x.y.z`，**允许同 minor 补丁更新**）。`vendor/README.md` 同步改写，并明确「工作区门禁拒绝 DSH 的 tilde 范围、以及 vendor/native 的 caret/精确范围」。

**（6）新增上游 patch：`exceljs@4.4.0`**

`pnpm-workspace.yaml` 的 `patchedDependencies` 新增 `exceljs@4.4.0: patches/exceljs@4.4.0.patch`（806 行）。这是 Excel 特殊内容预览修复的载体，**属于 side-by-side 的上游 patch 面扩张**——KCoder 侧目前 `pnpm-workspace.yaml` 只有 `node-pty / electron / esbuild / electron-winstaller` 构建许可与一条 `js-yaml` override，**没有 exceljs**，因此不构成直接冲突；但若 fork 合并后要跑上游 gate，patch 文件必须一起带过去。

**（7）新增开发侧技能 `agent-experience`（未接入任何 bundle）**

`.agents/skills/agent-experience/SKILL.md` 新增（提交 `bada62b50b`）。`git grep agent-experience` 在 `packages/` 与 `apps/` 下**零命中**——它是仓库自身的开发技能，不随产品发布。对 `dsh-skills-bundle` 无影响。

### 3.2 分域深挖汇总

| 域 | 真实变更（非版本戳） | 判定 |
|---|---|---|
| `packages/spill`（18 文件） | spill-policy 整体重写 + 新增 `retention.ts`；`spill/spill` 包仅 README | **行为重写 + 硬配置断裂**（§2.4） |
| `packages/core/tools`（6） | `src/index.ts` 新增 `projectContent` 管线位置；`src/schema.ts` 同步 `defineTool` | **纯新增**（§3.1-1） |
| `packages/mcp/mcp-client`（5） | `src/tools.ts` 钩子迁移 `finalizeContent`→`projectContent`；测试同步 | 上游内部迁移；**Config/连接/传输面零变化** |
| `packages/api/session-controller`（17） | `types.ts` 新增可选 `turnWindow`；`history.ts` 私有 `paginate` 加 turn 对齐（**无导出签名变化**）；`client/transport.ts` gap-repair 携带 `turnWindow`；`client/sessions/session.ts` 回声准入重写 + 分页改 `maxMessages: 500`；`contract/{session,snapshot}.ts` **仅 JSDoc**；`projection-store.ts` 新增 `seqOf()`（**type-only 导出**） | 【已核实】**无硬性公共 API 断裂**；两项需规划的行为变化：`loadOlder()` 单页最多 500 条（原 50）、Remote WebSocket 准入延后（见 gateway） |
| `packages/api/remotes`（4） | `src/client/index.ts` 新挂 `pluginRegistryProbeRemote`（`dccf989cd8` 引入、`3c50bf6b6c` 改名），指向新增的 `@deepseek-ai/dsh-client-ui-plugin-manager/remote` 导出 | 【已核实】**additive 但含硬失败路径**：`apply()` 在 `try` 内 mount，**任一失败即 dispose 全部并 rethrow**——该包缺失则整个 Client Remote 组装失败。详见 §3.4-1 |
| `packages/api/gateway`（4） | `src/index.ts`：`/api/remote.mux` 升级路由**改为在 `ctx.appReady` 就绪后才注册**；`tsconfig.host.json` 加 `dsh-cmdline` 引用 | 【已核实】**桌面壳可见的握手时序变化**：就绪前的升级请求命中「无路由」→ `socket.destroy()`（**不是 403/404**）。详见 §3.4-2 |
| `packages/client/ui-primitives`（25） | `CodeToolbar.tsx`（新增，未导出）+ `index.ts` 新增 1 行导出；`DiffBlockLabels`/`ReadBlockLabels` 继承 `CodeToolbarLabels`（**新增 3 必填、删 `files`**）；`CodeBlock`/`MarkdownCodeLabels` 加**可选** `toolbarLabels`；`Tooltip` 改 ResizeObserver 驱动；`Menu` portal 逐帧跟踪；diff/read 卡片 DOM 与 CSS 大改 | **本版唯一一组真实类型破坏**，但对三个消费方**全部零影响**（§3.1-2） |
| `packages/client`（原始 235 → **剔除家务后 176 = 42 README/i18n + 134 源码/测试**） | 见下方分行；`locale/src/locales/{en,zh}.ts` 新增 3 个公共键；`ui-plugin-manager` host 侧从空 `apply()` 改为默认导出的 `PluginRegistryProbe` 远程服务（`fastest()` 竞速 npmjs/npmmirror，1500ms 超时，5 分钟缓存）并**新增 `./typert`、`./remote` 子路径导出**；`ui-settings-account` 的 `contactUrl` **去掉 `uid`**（签名破坏，低相关） | 【已核实】顶层面几乎全是 additive；**两处类型破坏集中在 ui-primitives 与 modules**（§3.1-2/3） |
| `packages/client/ui-chat`（14） | 9 个滚动/跟随提交的落点（hook 重构） | 内部；DOM/滚动几何变化需回归 |
| `packages/client/ui-conversation`（7） | `QueueDock.tsx` + `locales.ts` | 内部 |
| `packages/client/ui-tool`（10） | `ToolRow.tsx`/`ToolDetails.tsx`/`primitive-labels.ts` + `spill-policy-terminal.client.spec.ts` | 内部；**测试名显示与 spill 保留联动** |
| `packages/client/ui-sidebar-documentpreview`（大量） | Excel OPC/XML 编码、fuzz 夹具、zoom viewport | 功能增强；侧边栏自带 Excel 预览不走此链 |
| `packages/client/ui-settings-models`（3） | `ModelListEditor.tsx` | 内部 |
| `packages/client/ui-settings-general`（5） | `DesktopUpdateIndicator.tsx` + locales | 内部 |
| `packages/client/ui-settings-account`（14） | 联系入口改名 Feedback、去掉问卷 URL 里的账号 UID、登录主题 | 内部；**隐私面小改动**（UID 不再拼进 URL） |
| `packages/client/modules`（4） | `manifest.ts`、`system.ts` — **`afde35880f`：批量脚本失败后恢复并记录 import 错误** | **对插件加载链有真实意义**：某个 client 模块 import 抛错不再拖垮整批 |
| `packages/boot/app-boot`（6） | **`9f9a50e553`：`installFailLoud` 现在同时接管 `uncaughtException`** | **行为收紧（风险项）**：见 §3.3 |
| `packages/boot/plugin-manager`（5） | 两个源选择 feat + 一个 fix | 新增能力 |
| `packages/credentials/*`（15） | `client platform` 请求头（`f5c96b6340`）、私有平台请求头文档、并发顺序测试 | 桌面账号面 |
| `packages/subprocess/subprocess-local`（8） | `src/{index,output,spawn}.ts`；`cfa84ed4e3`「spill 文件失败不再杀掉宿主」 | **稳定性修复**：对 KCoder 的长跑终端/命令是有利项 |
| `packages/shell/tool-pwsh-persistent`（6） | 见 F3 | 纯性能 |
| `packages/llm/token-meter`（3） | README only —— `estimateContent` 与 `imageRequestPricing` **在 alpha.1 已存在** | 证实「计量 API 不是本版新增」，本版只是**开始用它** |
| `packages/llm/llm-deepseek`（5） | README + `tests/adapter.spec.ts` | 适配器无源码变化 |
| `packages/jobs/tool-jobs`（5） | 见 F5 | **默认值行为翻转** |
| `packages/experimental/*`（13） | 语音输入语言持久化、Agent Team 指引、worker 测试 | 实验线 |
| `packages/extensions/tool-cordis` | `api-catalog.ts` 重新生成（含新 `projectContent`） | 生成物 |
| `apps/desktop`（46） | 崩溃报告新链路（`e38cca76fd`/`cafb9b93b4`/`c22b226b18`）、fatal IPC 携带 `diagnostic`（`7b2094d04d`）、响应头转发扩到 11 条 + `/plugins/*` 强制 no-store（`5864a6f6f1`）、主题 preload 解除 macOS 限制（`817623750a`）、**打包缺 `@deepseek-ai/cordis` peer 导致 app.asar 缺包**（`d8924486ad`）、Windows 安装器解压失败报告（`ab62f09c22`） | 【已核实】官方桌面应用；**其中 3 条对 KCoder 桌面壳有直接参考价值**，见 §3.4-3 ~ §3.4-6 |
| `apps/web`（42） | 绝大多数是 e2e 测试与 expected fixtures（`code-card-layout` / `chat-scroll-contract` / `excel-opc` / `plugin-install-registry` / `server-restart` 等） | 测试面；`server-restart` 与 `plugin-install-registry` 是 F8 与 I5 的证据 |
| `apps/desktop-host`（1） | `src/index.ts`：`fatal` IPC 增加可选 `diagnostic`（`util.inspect` 截断 64 KiB） | 【已核实】见 §3.4-3 |
| `packages/ssh`（2） | `ssh/src/helper-processes.ts`、`subprocess-ssh/src/index.ts` | 低相关 |
| `scripts`（4） | `gen-cordis-catalog.ts`、`gen-doc-graphs.ts`、`test-dom-environment.ts`、`vitest.config.ts` | 生成器/测试环境 |
| `docs/`（31） | 配置目录、子系统页、工具执行管线、module-graph 等同步 | 文档 |
| `.agents/notes`（49） | 7 篇新决策记录（见 §3.3） | 决策证据 |

### 3.3 行为级风险项（发布说明未充分披露）

**（1）`installFailLoud` 开始接管 `uncaughtException`（`9f9a50e553`，对应发布说明只有一条「修复源码启动初始化失败」）**

```diff
-export interface FailLoudProcess {
-  on(event: 'unhandledRejection', handler: (err: unknown) => void): unknown
-  off(event: 'unhandledRejection', handler: (err: unknown) => void): unknown
+export type FailLoudEvent = 'unhandledRejection' | 'uncaughtException'
+export interface FailLoudProcess {
+  on(event: FailLoudEvent, handler: (err: unknown) => void): unknown
+  off(event: FailLoudEvent, handler: (err: unknown) => void): unknown
```
文档注释明确：「turn an unhandled rejection **or an uncaught exception, at any point in the process lifetime**, into one labelled stderr diagnostic and `exit(1)`」，并且「Control never returns to the failed operation after either: only the throw site knows which state is intact」。诊断文本从 `err.stack` 改为 `util.inspect(err)`（保留 `code/syscall/path` 与 `cause` 链）。

**对 KCoder 的含义**：宿主进程里任何一处未捕获异常现在都会**立即 `exit(1)`**。引擎侧这是更正确的失败语义（配 `e38cca76fd` 的崩溃报告），但产品侧要意识到：**插件抛出的同步异常会变成宿主整体退出**，而不是「某个插件坏掉」。五个自研包都应确认启动路径与事件回调内不抛未捕获异常——这是本版最值得在集成时做一次冒烟的点。

**（2）`tool-jobs` 去掉连续唤醒上限（`b6775f6d4f`）**

```diff
-  maxConsecutiveWakes: z.number().min(1).default(3),
+  maxConsecutiveWakes: z.number().min(1),
```
```diff
-  const wakeBudget = config.maxConsecutiveWakes ?? 3
+  const wakeBudget = config.maxConsecutiveWakes
...
-    if (delivery === 'wakeup' && owner.status === 'idle' && spent < wakeBudget) {
-      spentWakes.set(owner, spent + 1); owner.followup(message); return
+    if (delivery === 'wakeup' && owner.status === 'idle') {
+      if (wakeBudget === undefined) { owner.followup(message); return }
+      const spent = spentWakes.get(owner) ?? 0
+      if (spent < wakeBudget) { spentWakes.set(owner, spent + 1); owner.followup(message); return }
     }
     owner.inject(message)
```

**双面性**：正面是修掉 KCoder 现场实测的「连续后台命令/子代理完成后会话停住」；代价是**默认移除了防自激链**（一个被唤醒的 turn 又启动新任务，其完成再唤醒它自己）。需要时可显式配 `maxConsecutiveWakes` 找回旧行为。

**（3）`packages/client/modules` 的批量 import 容错（`afde35880f`）**

「recover from a failed batch script and record import errors」——客户端模块批量加载中单个模块 import 失败不再让整批失败。**对自研插件是利好**：KCoder 侧有 11 个 bundle 注册进 `dsh.profile.bundles`，任何一个的 client 半 import 出错，过去可能连带影响同批其它模块。

**（4）`subprocess-local` spill 文件失败不再杀宿主（`cfa84ed4e3`）**

「contain spill file failures instead of killing the host」。KCoder 的长跑终端/命令输出落盘失败不再升级为宿主崩溃——与 §3.3-1 的「更激进 fatal」形成互补：**它能识别的失败就地收容，它不能识别的未捕获异常才 fatal**。

**（5）本版新增的 7 篇决策记录（`.agents/notes/implemented/`）**

`2026-09-22-fatal-diagnostics-and-crash-reports` · `2026-09-21-multimodal-tool-result-retention` · `2026-09-21-persistent-pwsh-keeps-controlled-prompt` · `2026-09-22-chat-scroll-follow-and-footer-geometry` · `2026-09-22-input-echo-admission-ownership` · `2026-09-22-unbounded-completion-wakes-by-default` · `2026-09-22-workspace-release-ranges`。这 7 篇是上表所有「行为级变更」的官方论证依据，也是下游排查时的第一手材料。

### 3.4 API 面与桌面壳面的深挖结论（本轮并行核查，逐条读过 diff）

**（1）`api/remotes` 新挂的 Remote 命名空间带「全组装硬失败」路径**

`packages/api/remotes/src/client/index.ts`（`dccf989cd8` 引入、`3c50bf6b6c` 改名）：

```diff
 import pluginManagerRemote from '@deepseek-ai/dsh-plugin-manager/remote'
+import pluginRegistryProbeRemote from '@deepseek-ai/dsh-client-ui-plugin-manager/remote'
...
-      pluginInventoryRemote, pluginManagerRemote, messageFeedbackRemote, sessionFeedbackRemote, fileUploadsRemote, sessionReferencesRemote,
+      pluginInventoryRemote, pluginManagerRemote, pluginRegistryProbeRemote, messageFeedbackRemote, sessionFeedbackRemote,
+      fileUploadsRemote, sessionReferencesRemote,
```

`@deepseek-ai/dsh-client-ui-plugin-manager` 的 `exports` 在 alpha.1 只有 `['.', './client', './src/*', './package.json']`，alpha.2 **新增 `'./typert'` 与 `'./remote'`**——这就是新命名空间 `pluginRegistryProbe`（`@Remote async fastest(): Promise<string | null>`）的载体。

**关键风险点**：`apply()` 把所有 contribution 放进同一个 `try`，**任一 `$mount` 失败就逆序 dispose 已经挂上的全部并 rethrow**：

```ts
  const disposers: Array<() => Promise<void>> = []
  try {
      ... pluginRegistryProbeRemote ...
      disposers.push(await ctx.remote.$mount(contribution))
  } catch (error) {
    for (const dispose of disposers.reverse()) await dispose()
    throw error
  }
```

我实测了当前 KCoder 运行时：`kcoder-runtime/node_modules/@deepseek-ai/dsh-api-remotes` 与 `dsh-client-ui-plugin-manager` **实际存在于磁盘**（说明解析闭包能拿到），且 `apps/desktop/package.json`、`api/remotes` 的 `devDependencies` 已声明该包。所以**官方构建路径下风险低**。但对该包做「手工挑包 / 精简组装」的下游（KCoder 的 staging 物化链正是这种形态）则需注意：**缺这一个包的成本不是「少一个命名空间」，而是整个 Client Remote 组装失败**。这是一条值得在集成时显式验证的依赖闭包项。

**（2）`api/gateway` 把 Remote WebSocket 准入推迟到应用就绪——桌面壳可见的时序变化**

`packages/api/gateway/src/index.ts`（`a44ced5b96`）：

```diff
-      const mux = new RemoteStreamMuxServer(
-        (endpoint, payload, uplink, peer, control) =>
-          this.openWireStream(endpoint, payload, uplink, peer, control.signal, control),
-        this.wireStream.failure,
-        resolved.websocketHeartbeatIntervalMs,
-        resolved.streamInboxBytes,
-      )
-      webCtx.effect(() => {
-        const route: WebUpgradeRoute = { path: REMOTE_STREAM_MUX_PATH, handler: (req, socket, head) => { ... } }
-        const unregister = webCtx.webServer.registerUpgrade(route)
-        return async () => { unregister(); await mux.close() }
+      const listen = (): void => { /* ...构造 mux，注册 route... */ }
+      // Existing pages reconnect before the new Host prints its URL. No stream
+      // may enter until the launcher has activated and audited its controllers.
+      const ready = webCtx.get('appReady')
+      if (ready === undefined) listen()
+      else webCtx.effect(() => {
+        let closed = false
+        const cancel = ready.onReady(() => { if (!closed) listen() })
+        return () => { closed = true; cancel() }
+      }, 'api-gateway: application readiness')
```

**没有 wire 协议变化**：`RemoteStreamMuxServer`、`REMOTE_STREAM_MUX_PATH`、帧格式、心跳、`openWireStream` 全部未动，`gateway/src/client/` 零 diff。变的是**路由何时存在**：

- 就绪前对 `/api/remote.mux` 发起 upgrade → 命中「无路由」分支 → `packages/host/webserver` 执行 `socket.destroy(); return`，即**无响应的硬断连**（不是 403/404）。
- 自带 `dsh-client-connection` 重试策略的客户端不受影响（上游 e2e 断言了这一点）；**自己开 socket 且一次失败就放弃的客户端会在启动窗口内失败**。
- `ctx.appReady` 在两个 tag 里都已存在（`packages/boot/cmdline/src/index.ts`），不是本版新增。

**对 KCoder 的直接含义**：KCoder 的宿主就绪判定是解析子进程 stdout 的 `dsh web: http://...` 就绪行（`READY_LINE_RE`），而本版把 Remote 准入推到了**更晚**的 `appReady` 之后。若桌面壳或侧边栏在「看到就绪行」后立刻自建 WebSocket 且不做重试，会撞上这个窗口。**结论：KCoder 侧应确认走的是带重试的 client-connection 通道；若有自建 socket，需要补重试。**

**（3）官方桌面壳的崩溃报告契约（可作 KCoder 的参照实现）**

新增 `apps/desktop/src/crash-report.ts`（`e38cca76fd` + `cafb9b93b4` + `c22b226b18`）：

| 常量 | 值 |
|---|---|
| 目录 | `app.getPath('logs')`（需先 `app.setAppLogsPath()`） |
| 文件名 | `crash-<ISO 时间，: 与 . 换成 ->-<source>.log`，source ∈ `host` / `web-boot` / `renderer` / `main` |
| 保留 / 清理 | 保留 10 份；只删**精确匹配** `crash-...` 正则的名字（`c22b226b18` 收紧） |
| 写盘前等待上限 | `CRASH_REPORT_WAIT_MS = 1_000`（与弹窗赛跑，超时仍出弹窗） |
| 权限 | 目录 `0o700`、文件 `0o600`、`flag: 'wx'` |
| 分节上限 | 错误段 256 KiB；渲染进程控制台尾巴 64 KiB（按字节，不劈行） |
| 弹窗 detail 预算 | 1200 字符 / 8 行尾 |

配套的 `{type:'fatal'}` IPC **新增可选 `diagnostic`**（`apps/desktop-host/src/index.ts`，`inspect(error,{depth:4,maxArrayLength:50}).slice(0, 64KiB)`）；`host-process.ts` 放宽校验器并新增 `DesktopHostFatalError`（带 `diagnostic` getter）。**注意 `apps/desktop/src/backend-controller.ts` 的 `error` 分支新增了必填 `failure: unknown`——这是 type 级破坏**（自建模 backend 状态的壳需要跟着加）。

**（4）一条「打包缺依赖」的真实事故，值得 KCoder 对号入座**

`apps/desktop/package.json`（`d8924486ad`）：

```diff
     "@deepseek-ai/dsh-api-gateway": "workspace:^",
+    "@deepseek-ai/cordis": "workspace:^"
```

提交正文说明：cordis 是 `dsh-typert-protocol`/gateway 的 peerDependency，在 app 闭包里不满足 → **electron-builder 把 cordis 排除出 app.asar → 打包后的主进程在开窗之前就以 `ERR_MODULE_NOT_FOUND` 死亡**；受影响范围是 `efbc8e26b6`（2026-09-20）之后的**每一个打包构建**，而 dev/单测通道全绿。

**对 KCoder 的含义（高价值对照）**：KCoder 同样是 electron-builder 打包 + `staging/kcoder-runtime` 手工物化依赖闭包。本版上游新引入的 `@deepseek-ai/dsh-client-ui-plugin-manager/remote` 是**新的传递依赖边**；「dev 全绿、打包才炸」正是这条事故的形态。建议把「打包后主进程能起」列为 alpha.2 集成的必过项，而不是只看 dev 冒烟。

**（5）KCoder 桌面壳可能直接受益/需要跟随的三处**

| 上游改动 | 提交 | KCoder 侧含义 |
|---|---|---|
| 响应头转发白名单 3 条 → **11 条**，且 `/plugins/*` 强制 `cache-control: no-store` | `5864a6f6f1` | KCoder 的 `browser-host.ts` 若也做 Host 响应转发，需要同款收口：否则 `fetch` 已解压的 body 会再带上 `transfer-encoding: chunked`；插件 bundle 会按每次启动都变的 `?rev=` 落进 Chromium 磁盘缓存。**HTML 注入 `__DSH_BOOT_READY__` 未变**（已证） |
| 主题 preload 解除 `platform !== darwin` 提前返回（Win/Linux 现在也上报），登录 URL 追加 `theme=light\|dark` | `817623750a`、`f50059e425` | KCoder 有自研主题注入（`theme-watcher.ts`/`style-overlay.ts`）。若产品侧复刻了这条 preload 行为，本版是对齐点；主进程侧 `ipcMain.on(nativeThemeSet)` 在 alpha.1 就已不区分平台，所以**壳侧无新增通道工作** |
| 官方 `locale.ts` 用 `{ readonly [Key in keyof typeof en]: string }` 映射类型，本版新增 **3 个必填键** `aboutProduct` / `aboutVersion` / `reportWrittenTo`，并改写 `diagnosticTruncated` / `updateDetail` 文案 | `e38cca76fd` 等 | **若 KCoder 复用了官方 locale 字典做覆写，少一个键就编译失败**。产品若有自有文案表，需补齐这 3 个键（即使值取自产品品牌） |

**（6）`plugin-manager` 的「新源选择」实际不在本包**

`packages/boot/plugin-manager/src` 在两 tag 间的全部净变化只有一行常量抽取：

```diff
+export const NPMMIRROR_REGISTRY = 'https://registry.npmmirror.com/'
-    fallbackRegistries: z.array(z.string().pattern(REGISTRY_URL)).default(['https://registry.npmmirror.com/']),
+    fallbackRegistries: z.array(z.string().pattern(REGISTRY_URL)).default([NPMMIRROR_REGISTRY]),
```

**取值完全相同 ⇒ 本包零行为变化**。β「选第一个有响应的公共源」的真实实现在 `packages/client/ui-plugin-manager/*`（`registry-probe.host.spec.ts`，且移除了 `packages/util/ip-geolocation`）。所以 §2.1-I5 的升级点是**插件管理 UI 面**的新能力，不影响 KCoder 的物化链。

---

## 4. 自研内置插件逐个升级点

### 4.0 五个插件的上游消费面（实测）

| 插件 | 版本 | 直接 import 的上游包（源码实测） |
|---|---|---|
| `dsh-skills-bundle`（技能） | 1.0.2 | **无**（`deps`/`peer` 均空，纯 `dsh.bundle.patch`） |
| 自研 MCP 体系（KCoder `desktop/main/mcp-*.ts`） | 内置 `BUILTIN_VERSION = 6` | **无 npm import**（桌面壳侧直接读写 `cordis.patch.yml`） |
| `dsh-coding-sidebar`（侧边栏） | 1.0.31 | `dsh-agent` · `dsh-client-ui-primitives` · `dsh-client-ui-settings/client` · `dsh-client-ui-slots` · `dsh-llm` · `dsh-session` · `dsh-subagent` · `dsh-tools` · `schemastery` · `cordis` |
| `dsh-file-review-kcoder`（文件审查） | 1.0.10 | `dsh-agent` · `dsh-api-remotes/client` · `dsh-api-session-controller/client` · `dsh-atomic-write` · `dsh-client-locale/client` · `dsh-client-ui-conversation/client` · `dsh-client-ui-slots` · `dsh-session/types` · `dsh-system-prompt` · `dsh-typert-protocol` · `dsh-typert-registry/types` · `cordis` |
| `@kkutysllb/dsh-terminal`（终端） | 1.1.1 | **无**（`deps` 仅 `node-pty`，`peer` 空） |
| `dsh-shell-prefs`（附加观察） | 1.0.1 | 镜像于 `bundle/`，需在集成时核对 |

**peer 版本上限的实际含义**：侧边栏与文件审查的 `@deepseek-ai/dsh-*` peer 范围目前写到 `^0.1.7-alpha.1` 一族（文件审查部分条目写 `^0.1.6-alpha.1 || 0.1.6-alpha.2 || ^0.1.7-alpha.1`）。SemVer 的 caret-预发布规则下，`^0.1.7-alpha.1` **允许 `0.1.7-alpha.2`**（同 `[major,minor,patch]` 的更大预发布），因此 **alpha.2 的具体包不会触发 peer 失配**。若要显式收口，可在下一次发版时把 `0.1.7-alpha.2` 写进 range。

### 4.1 `dsh-skills-bundle`（技能包，1.0.2）

- **上游契约面**：`packages/skill/**` **源码零变化**（只有 package.json 版本戳）。上一版（alpha.1）已核对过的技能加载/调用面在本版原样有效。
- **升级点**：**无需改动**。
- **受益但无需改码**：技能托管的工具调用同样走 §3.1-1 的新内容管线——`projectContent` 在 `tools/post-execute` **之前**安装内容，随后才轮到 spill 保留。若某个技能的工具返回大体积图文结果，现在的保留/可恢复地址行为是新语义（§2.4）。
- **可选跟进（非必需）**：上游新增了 `.agents/skills/agent-experience`（开发侧技能，未接入任何 bundle，`git grep` 零命中），其正文总结的「最小上下文起步 / 显式发现路径 / 关键约束前置 / 有界输出 + 可检索地址 / 局部上下文 / 评估总工作量」六条，可作为我方技能写作规范的参考，不构成依赖。

### 4.2 自研 MCP 体系（`desktop/main/mcp-builtin|mcp-store|mcp-settings`）

- **上游契约面**：`packages/mcp/mcp-client/src/index.ts`（**Config 面**）**零变化**；`connection.ts` / `server-context.ts` / `transport.ts` **零变化**；唯一源码改动是 `src/tools.ts` 的钩子迁移（§3.1-1）。
- **升级点（实质为零，需确认两点）**：
  1. **patch 条目形状不变**：`mcp-store.ts` 写入的 `insert: [{ id, serverName, transport, disabled, command, args, env, cwd, url, headers, toolCallTimeoutMs }]` 所对应的 Config schema 在本版未改 → **无需迁移 YAML**。
  2. **内置服务器版本钉法不变**：`mcp-builtin.ts` 的 `BUILTIN_VERSION = 6` 与 5 条精确钉版（`mcp-server-fetch==2026.8.18` / `@upstash/context7-mcp@4.1.1` / `@modelcontextprotocol/server-sequential-thinking@2026.8.31` / `@playwright/mcp@0.0.81` / `@modelcontextprotocol/server-memory@2026.8.31`）无需因本版调整。
- **行为收益（无需改代码即可获得）**：上游把 MCP 客户端的内容投射**从 `finalizeContent`（策略之后）迁到新的 `projectContent`（策略之前）**——即保留/spill 策略现在**看得见并能替换**已投射的 MCP 内容，而不是在策略之后被覆盖。这直接修掉「MCP 图片在文字截断后不可用」：图文结果先在保留前落成有序块，图片作为**不可分块**整块保留或整块丢弃，被省略的图片位置给出 `[Image: <path>; <mediaType>; <w>×<h>. Use read_image to view it.]` 的可读路径。KCoder 内置的 `playwright` MCP（截图）、`fetch`（网页含图）会实际受益。

### 4.3 `dsh-coding-sidebar`（侧边栏工作台，1.0.31）——本版工作量最小

- **上游契约面（逐包核实）**：
  - `dsh-client-ui-slots`：**源码零变化**（唯一 diff 是 `package.json`）→ 侧边栏两处槽位注册（`settings.section` @ `src/client/index.tsx:455`、`conversation.chat.turnTail` @ `src/client/intercept.tsx:220`）**原样有效**。这是连续第二版零变化。
  - `dsh-client-ui-settings/client`：**源码零变化** → `settings.section` 表单注册面不受影响。
  - `dsh-client-ui-primitives`：**additive**（新增 `CodeToolbarLabels` 导出）。侧边栏实际导入的 31 个符号（`Button / FileTypeIcon / 24 个 Icon*Regular / Input / MarkdownText / Menu / Modal / StateDot / Tooltip / writeClipboard`）**全部存活**；本版**无二次图标改名**（alpha.1 的 `Icon*Outline16` → `Icon*Regular` 适配成果继续有效）。
  - `dsh-agent` / `dsh-llm` / `dsh-session` / `dsh-subagent` / `dsh-tools` / `schemastery`：**源码零变化**（`packages/session`、`packages/tools` 均为版本戳churn；`packages/core/tools` 只有 additive 新钩子）。
- **升级点**：**无需改动**。
- **需回归而非改码的四项**：
  1. **`Tooltip` 改为 `ResizeObserver` 驱动**（`c92d5ebe18`）：props 与签名逐字节未变，但内部删掉了 `useLayoutEffect`，气泡以**内联 `visibility:hidden` 起始**，只在首次 ResizeObserver 回执后才可见；`new ResizeObserver` **没有 feature guard**。上游还断言「只测锚点几何」（`measured.mock.contexts).toEqual([anchor])`）——**任何在 hover 时测量 tooltip 几何的插件失去该时机**。在 Chromium/Electron 下正常；若产品在非 Chromium 宿主或 jsdom 式渲染环境跑，气泡会**永不显示**。
  2. **`Menu`（portal 模式）每动画帧跟踪锚点**（`5aa21749b9`）：props/导出类型未变；打开的 portal 菜单现在**每帧**做 `place()` + 锚点 `getBoundingClientRect()` + `offsetWidth/offsetHeight`（强制布局）。`setFixedPos` 有相等性守卫所以静态锚点不触发重渲染，但**同时挂多个 portal 菜单会有持续 rAF + 布局开销**。侧边栏有用到 `Menu`，需实测。
  3. **ui-chat 滚动几何（9 个提交，本版最大行为面）**：
     - `TurnNavigator` 与「回到底部」按钮**被提升到 `.scroll` 之外**，成为新外层 `.frame` 的子节点（`6b4055bf32`）；转写根节点新增 `overflow-y: clip` → **`.root` 不再是 y 轴滚动容器**（粘性 Markdown 代码横幅/压缩头改锚到真正的会话滚动口）。
     - 新增 `use-scroll-follow.ts`（导出 `ViewportMetrics`、`scrollMetrics()`、`ScrollFollow` 含静态 `WeakMap` owner 注册表、`useScrollFollow()`）与 `use-process-scroll.ts`；`ChatViewport.scrollToBottom()` **签名变为 `scrollToBottom(follow: ScrollFollow)`**（该文件经 `"./src/*"` 可达）。
     - 过程组体 `[data-step-process-body]` **新增** `onWheel`/`onTouchStart`/`onPointerDown`/`onKeyDown` 处理器；`data-scroll-up`/`data-scroll-down`/`data-step-process-content`/`data-chat-flow` 保留。
     - turn-rail 显隐阈值改为**容器查询**（`.slot` 上加 `container-type: inline-size`，`@container (max-width: 900px)` 隐藏 `.frame`）——**改变会话面板宽度或 composer 侧留白会影响 rail 显隐**。
     - **`contract/slots.ts` 与 `conversation-nodes/*` 未变** → `ChatViewSlotProps` / `ChatNode*Props` 稳定，turnTail 槽位注册面安全。
  4. **`data-error` 从上游桌面更新指示器与侧边栏徽标上移除**（`ui-settings-general`）：`.indicator[data-error]` / `.badge[data-error]` 规则被删。**实测我们不受影响**——文件审查自己的 `PresentedFiles.tsx:275` 用的是**自有组件的** `data-error`，与上游指示器无关。
  5. **新主题令牌（公共 CSS 契约，additive）**：`--dsw-static-green-500-a08/a12`、`--dsw-static-red-400-a12`、`--dsw-static-red-600-a08`，以及成对的 `--dsw-alias-code-diff-added` / `--dsw-alias-code-diff-deleted`（明暗各一套）。另注意 **`ui-tool` 删除了它对 `--dsl-code-block-content-font` 的重绑**（`.codeBody`），工具行内代码从 12/18 变回共享的 13/22——**任何复用该类的插件会看到密度变化**。

### 4.4 `dsh-file-review-kcoder`（文件审查，1.0.10）

- **上游契约面（逐包核实）**：
  - `dsh-typert-protocol` / `dsh-typert-registry`：**源码零变化**（只有 `package.json`）→ `TypertRemoteService` / `InvocationDescriptor` / `TypertRemoteContribution` / `RemoteResult` 全部原样。**这是文件审查插件的核心契约，零风险。**
  - `dsh-client-ui-slots`：零变化 → 槽位注册原样。
  - `dsh-client-ui-conversation/client`：`QueueDock.tsx` + `locales.ts` 有改动（队列换行保留）；文件审查只是**类型级注入**（`index.tsx:32` `import type {}`），无实际符号消费 → 无影响。
  - `dsh-api-session-controller/client`：**本版对文件审查唯一需要认真核对的面**（17 个文件真实改动）。**第二轮核查已把导出面收口，结论是「无硬性公共 API 断裂」**：
    - `types.ts`：新增**可选** `SessionPageRequest.turnWindow?: { minMessages; minTurns }`；`SessionFollowRequest` 由「自带 `maxMessages?`」改为 `extends Pick<SessionPageRequest, 'maxMessages' | 'turnWindow'>`。生成的 zod 是普通 `z.object`（无 `.strict()`），**两个方向的跨版本容忍都成立**（alpha.1 宿主收到 `turnWindow` 会剥离而非拒绝）。
    - `history.ts`：**该文件两 tag 间只导出一个符号 `SessionHistoryController`**，`page()`/`follow()` 签名逐字符未变；改动全在模块私有函数（`paginate` 加 `turnWindow` 参数与 turn 对齐、`validateFollowRequest`→`validateHistoryWindow` 并被 `validatePageRequest` 复用）。新增的对外可见效果只是**非法 `turnWindow` 会得到 `gateway/bad-request`**。
    - `client/transport.ts`：`follow()` 改为展开 `this.repairRequest(request)`，`repairRequest` 覆写体也携带 `turnWindow`。**没有帧类型、握手、mux 路径变化**；基类 `RemoteJournalStream.repairRequest` 签名未变，且 `gateway/src/client/` 本版零 diff。行为上是修 bug：过去 gap-repair 重发会丢掉 `turnWindow`，静默退化成按消息对齐分页。
    - `client/sessions/projection-store.ts`：新增 `seqOf(key)`。该类在公共入口**仅以 type 形式导出**（`export type { ProjectionValueStore }`），所以是**纯类型面新增**，不构成运行时新契约。
    - `client/sessions/session.ts`：**回声准入重写**（`820824edd7` 新增 `receipt.target` / `admitted` 字段、`observeSteeringInsertions`→`observeSubmissionInsertions`；`08c0e8e71b` 收窄 watermark 守卫）+ **分页改为 `HISTORY_PAGE_OPTIONS = { maxMessages: 500, turnWindow: { minMessages: 50, minTurns: 2 } }`**。导出的 `PAGE_MESSAGES`（50）/ `JUMP_PAGE_MESSAGES`（200）**值未变但语义从「每页请求量」变成「最小量」**——`loadOlder()` 单次最多可取 500 条。
    - `client/contract/{session,snapshot}.ts`：**仅 JSDoc**（`placement` 语义补充说明）。
  - `dsh-api-remotes/client`：**该文件本版只有两处**——新挂 `pluginRegistryProbeRemote`（见 §3.4-1）。对文件审查的 Typert Remote **无影响**。
  - `dsh-session/types`：**零变化**（`packages/session` 只有版本戳）。
- **升级点（已收口）**：**无需改动**。
- **需回归的两项**：
  1. 文件审查通过 `ISessions` 与 `dsh-api-session-controller/client` 交互；`loadOlder()` 单页上限由 50 变 500，**长会话历史加载的内存与渲染压力**需实测（这是性能回归，不是正确性回归）。
  2. 上游新增的「准备就绪才注册 `/api/remote.mux`」（§3.4-2）——若文件审查或侧边栏走自建 WebSocket，需确认有重试。
- **当前判定**：**风险低**（原判「中低」，因导出面已逐条收口而下调）。性质是「行为变化 + 性能回归需实测」，**不存在已知的编译或运行时断裂**。

### 4.5 `@kkutysllb/dsh-terminal`（终端插件，1.1.1）

- **上游契约面**：
  - `packages/terminal/**`（`terminal` / `tool-terminal` / `terminal-bash`）：**源码零变化**（`git diff --stat` 只有三个 `package.json`）→ PTY 缝、`TerminalWaitReason`（`'stdin_read' | 'inferred_idle' | 'timeout' | 'session_exit'`）、`TerminalSendResult` 全部原样。
  - `packages/shell/tool-pwsh-persistent`：改了，但**不经过本插件**——它消费 `ctx.terminals` 缝，不是 `dsh-terminal` 的消费者。
- **升级点**：**无需改动**。
- **顺带收益（无需改码）**：`packages/subprocess/subprocess-local` 的「spill 文件失败不再杀宿主」（`cfa84ed4e3`）对终端长跑输出落盘是稳定性增益；`tool-pwsh-persistent` 的 20× 提速（Windows 侧）若产品的终端走 PowerShell 持久会话，也在同一条体验线上。
- **风险提示**：`installFailLoud` 接管 `uncaughtException`（§3.3-1）——终端插件的 pty 事件回调是「高频、易抛」区域，**集成时建议专项检查 pty `data`/`exit` 回调内是否有未捕获异常路径**。

### 4.6 `dsh-shell-prefs`（Shell 偏好桥，1.0.1，附加观察对象）

- 上一版（alpha.1）的头号适配点是 **settings API 重排**（`SettingsProvider`→`SettingsForms`）。本版 `packages/settings/**` 与 `packages/client/ui-settings/**` **均源码零变化**。
- **升级点**：**无需改动**；但集成时仍需以 alpha.1 已完成的迁移态为准做一次设置页冒烟。

### 4.7 交叉事项（五件 + MCP 共通）

| 事项 | 来源 | 对五个插件的作用 |
|---|---|---|
| `spill-policy` 配置键改名 + 语义重写 | `ab102138c8` 等 | 若产品/用户侧有自定义 `spill-policy` 配置，**必须改键**；无则只享受行为改进 |
| `projectContent` 新钩子 | `ab102138c8` | **无插件使用 `defineTool({finalizeContent})`**（已逐一核对 import 面）→ 无需跟动；MCP 图文结果因此变好 |
| `installFailLoud` 接管 `uncaughtException` | `9f9a50e553` | 宿主级 fatal 语义收紧 → 集成时五个包各做一次启动/回调异常冒烟 |
| `tool-jobs` 唤醒无上限 | `b6775f6d4f` | 产品侧决定是否显式配 `maxConsecutiveWakes` 找回旧行为 |
| client 模块批量 import 容错 | `afde35880f` | 11 个 bundle 共存场景更健壮（利好） |
| 依赖范围硬门禁 | `4e6028a604` / `37372101b5` | 见 §5.1 |

---

## 5. 升级仪式改动面

### 5.1 依赖范围硬门禁（本版新增，会咬集成）

`scripts/verify-package-dependencies.ts`：

```diff
-function workspaceRange(name: string): 'workspace:*' | 'workspace:~' {
+function workspaceRange(name: string): 'workspace:*' | 'workspace:~' {
+  return name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-') ? 'workspace:*' : 'workspace:~'
+}
```
并对 peer+dev 成对声明、单段声明、以及**所有** `dependencies/devDependencies/optionalDependencies/peerDependencies` 逐条校验：

```
violations.push(`${manifestPath}: ${sectionName}.${name} must use ${expectedRange}, found ${range}`)
```

门禁已接入 `scripts/run-gates.ts`（两处：`:347`、`:757`，label `package dependencies`）。

**对集成的具体含义**：合并 alpha.2 后，**上游 monorepo 内所有 workspace manifest 必须满足**：DSH 目标 `workspace:*`、vendor/native 目标 `workspace:~`。我方的 fork 自有分歧若在 `pnpm-workspace.yaml` / 根 `package.json` / workspace 成员的依赖范围上保留了 `workspace:^`，会在 `run-gates` 或 `pnpm typecheck`（若链到 gate）阶段报错。这是一条**「合并后第一次跑门禁才会暴露」**的检查项，建议列进升级 SOP 的必过项。

### 5.1.1 「发布时映射成什么」——比门禁本身更重要的一条连带影响

`scripts/benchmark-npm-resolution.ts` 里固化了发布映射（本版新增/沿用）：

```ts
export function publishWorkspaceRange(range: string, targetVersion: string): string {
  if (range === 'workspace:*') return targetVersion        // ← 精确版本！
  if (range === 'workspace:^') return `^${targetVersion}`
  if (range === 'workspace:~') return `~${targetVersion}`
  ...
}
```

也就是说，本次把 DSH 内部依赖统一改成 `workspace:*` 之后，**所有 `@deepseek-ai/dsh-*` 包发布到 npm 时，对其它 DSH 包的依赖/peer 会写成精确版本**。实测样本：

```jsonc
// packages/client/connection/package.json @ alpha.2（发布后）
"peerDependencies": { "@deepseek-ai/dsh-scope": "workspace:*" }   // → 发布为 "0.1.7-alpha.2"（精确）
```

**这正是官方发布说明那句「将自动依赖更新限制为同一次版本内的补丁版本」的另一面**：vendor/native 走 `~`（允许同 minor 补丁），而 DSH 家族走**精确钉**。

**对五个自研插件的连带影响（需要规划，不是破坏）**：

- 我们插件的 peer range 目前是 `^0.1.7-alpha.1` 这一族（SemVer caret-预发布规则允许 alpha.2），所以**装 alpha.2 的具体包不会失配**。
- 但上游包之间现在是**精确钉**。考虑一个真实场景：产品 runtime 里还留着某个 alpha.1 的 DSH 包（因树未整体抬版），而它依赖的另一个 DSH 包已被抬到 alpha.2 → 精确钉无法满足 → **peer/依赖冲突告警，甚至解析出两份副本**（两份 `@deepseek-ai/dsh-*` 副本会让「共享同一单例」的契约失效，这对走 `ctx.remote` / 槽位注册的插件是硬故障，不是告警）。
- **结论**：alpha.2 集成必须**整树抬版**，不能「只升我需要的几个包」。KCoder 的 staging 物化链与 `dsh.profile.bundles` 的 11 个 bundle 应作为整体一起切到 alpha.2，并在切换后跑一次 `pnpm install --frozen-lockfile` + `pnpm ls @deepseek-ai/dsh-*` 确认没有双副本。

### 5.2 本版需要跟着改的清单（预计）

| # | 项 | 类型 | 是否必须 |
|---|---|---|---|
| 1 | `spill-policy` 配置键 `maxInlineBytes` → `maxInlineTokens` | 配置 | **仅当**产品/用户侧有自定义 spill 配置；基座默认已由上游改好 |
| 2 | 依赖范围（`workspace:*` / `workspace:~`）对齐新门禁 | 构建 | 合并后跑 gate 验证 |
| 3 | `patches/exceljs@4.4.0.patch` + `pnpm-workspace.yaml` `patchedDependencies` 条目一并带入 | 构建 | 合并时确认 |
| 4 | vendor 版本戳（9 个包）与 `pnpm-lock` 同步 | 构建 | 常规 |
| 5 | `installFailLoud` fatal 语义收紧的专项冒烟 | 回归 | 建议 |
| 6 | ui-chat 滚动几何 + 侧边栏 turnTail 注入点回归 | 回归 | 建议（上一版刚修过同区域） |
| 7 | `Menu`（portal）逐帧跟踪的定位回归 | 回归 | 建议 |
| 8 | `tool-jobs` 是否显式配 `maxConsecutiveWakes` | 产品裁决 | **已决：不配**——与上游保持一致，采用「不设上限」默认（见 §8.6） |
| 9 | **整树抬版**（不能只升部分包，见 §5.1.1 的精确钉） | 构建 | **必须** |
| 10 | 打包产物冒烟（对齐上游 `d8924486ad` 的 app.asar 缺包事故） | 回归 | **建议列入必过项** |
| 11 | 自建 WebSocket 通道补重试（对齐 §3.4-2 的准备就绪准入） | 代码 | 视实现方式 |

### 5.3 与 alpha.1 的升级工作量对比

| | alpha.1（0.1.6→0.1.7-alpha.1） | alpha.2（本文） |
|---|---|---|
| 提交 / 文件 | 1299 / 4754 | **162 / 869（真实 509）** |
| 窗口 | 5 天 | **11 小时** |
| 契约断裂 | 5 处大断裂（settings API / agent-presets 整包删除 / 2 个包被删 / 81 图标改名 / llm-deepseek Messages-only） | **1 处硬配置键**（spill）+ **2 处未记载的类型破坏**（`CodeToolbarLabels` 必填 3 键、`ClientModuleLoader.importError`）+ **1 处未记载 additive API**（`projectContent`）——**且 3 处类型级变化对当前消费方全部零影响** |
| 集成分支冲突预期 | 10 处 + 适配 6 处 | **预计极少**（主干契约全零变化） |
| 五个插件工作量 | 侧边栏最大（图标全量改名）/ 文件审查批次适配 / settings 迁移 | **均为零改动**（仅回归验证） |

---

## 6. 风险与待确认项

> 按「实锤风险 → 需规划 → 待裁决」排序。前 3 条是本文认为必须在集成前有明确结论的。
> **决策状态**：本节列出的待裁决项已于 2026-09-23 全部按「与上游保持一致」口径收敛（第 7 条就地更新，其余见 §8.6）。

1. **`spill-policy` 静默自禁用的窗口**（实锤）：若某处配置仍写 `maxInlineBytes`，`maxInlineTokens` 为 `undefined` → `apply()` 第一行 `if (cap === undefined) return` → **策略整体不注册**，表现是「工具结果不再被保留/截断」，而不是报错。这类「静默失效」比硬报错更难发现，集成后建议用一次大结果工具调用验证保留是否生效。（基座 bundle 已正确改名，风险主要来自下游自定义 patch。）
2. **DSH 家族发布后是精确钉，必须整树抬版**（实锤，§5.1.1）：上游把 DSH 内部依赖统一为 `workspace:*`，发布映射为**精确版本**。半抬版的树会出现精确钉无法满足 → peer 冲突 **或解析出两份 `@deepseek-ai/dsh-*` 副本**；双副本会让「共享同一单例」的契约失效，对走 `ctx.remote` / 槽位注册的插件是**硬故障而非告警**。
3. **`installFailLoud` + `uncaughtException` 的宿主级放大**（实锤）：KCoder 宿主进程加载 11 个 bundle，任何一处未捕获异常 → `exit(1)`，**且不发送 fatal IPC 消息**（上游桌面壳因此把它归类为「host 以 exit 1 退出 + stderr 尾巴」）。需要确认 KCoder 的自动重启（`MAX_AUTO_RESTARTS = 3`）与崩溃报告路径能正确消费这个新的退出形态；并逐个检查五个插件的事件回调（尤其 pty `data`/`exit`）内不抛未捕获异常。
4. **打包闭包新增传递依赖边**（需验证）：本版新引入 `@deepseek-ai/dsh-client-ui-plugin-manager/remote`。上游刚发生过「dev 全绿、打包后 app.asar 缺 `@deepseek-ai/cordis` → 主进程开窗前 `ERR_MODULE_NOT_FOUND`」的同类事故（`d8924486ad`，影响 2026-09-20 之后**每一个**打包构建）。**建议把「打包产物能启动」列为 alpha.2 集成的必过项**，而不是只看 dev 冒烟。
5. **`api/remotes` 的「全组装硬失败」**（实锤）：`apply()` 在单 `try` 内 mount 全部贡献，任一失败即 dispose 全部并 rethrow。手工挑包/精简组装的下游若缺 `dsh-client-ui-plugin-manager`，代价是**整个 Client Remote 组装失败**，不是「少一个命名空间」。本机 runtime 实测该包存在（风险低），但 staging 物化链需显式验证。
6. **Remote WebSocket 准入推迟**（实锤）：`/api/remote.mux` 现在要等 `ctx.appReady`；就绪前的升级请求得到的是**无响应硬断连**（`socket.destroy()`），不是 403。KCoder 若走带重试的 `dsh-client-connection` 则无感；若有自建 socket 需补重试。
7. **`tool-jobs` 无上限唤醒**（**已决：与上游一致**）：不显式设 `maxConsecutiveWakes`，采用上游新默认「不设上限」。实测确认 KCoder 侧从未设过该键（`product-policy.ts` 生成的 overlay 无 tool-jobs 行，两个实机 overlay `~/.kcoder` / `~/.kcoder-dev` 均无覆盖），上游 schema 为 `z.number().min(1)`（**无 `.default()`**）且模块注释明写 "unbounded unless `maxConsecutiveWakes` caps it per owner" ⇒ **本决策＝零改动**。残余风险（失去引擎自带防自激链）由 §8.6 登记为观察项。
8. **`session-controller` 的两项行为变化需规划**（已定性，非破坏）：`loadOlder()` 单页最多 **500** 条（原 50，且带 turn 对齐）；`PAGE_MESSAGES`/`JUMP_PAGE_MESSAGES` 的**值未变但语义从「请求量」变成「最小量」**。另外 `SessionFollowRequest` 改为 `extends Pick<SessionPageRequest, 'maxMessages'|'turnWindow'>`——若有人 `interface X extends SessionFollowRequest` 并把 `maxMessages` 重声明为必填，会编译失败（我们三个消费方均无此写法）。
9. **`packages/client` 134 个真实源码文件的 DOM/几何变更**（需回归）：导出面几乎没动，但有三项对注入式插件有实质影响——① `Tooltip` 改为**无 feature-guard 的 `ResizeObserver`** 且初始 `visibility:hidden`，首个 fit 前不可见（非 Chromium 宿主或不支持 ResizeObserver 的环境会**永不显示**）；② 打开的 portal `Menu` 现在**每动画帧**读布局；③ 会话转写根节点改为 `overflow-y: clip`，`TurnNavigator` 与「回到底部」被**提升到 `.scroll` 之外**的新 `.frame` 里。
10. **KCoder 侧未做集成**：本文核对时 KCoder main（`e3d5d56`）无 alpha.2 tag、QiLin 最新 tag 为 alpha.1，所以「合并后的真实冲突面」尚未实测，本文的冲突预期是按「主干契约零变化」推断的。

---

## 7. 建议落地顺序（供讨论）

1. **先在 fork 建 `kcoder/0.1.7-alpha.2` 集成分支**（`tag + merge --no-ff origin/kcoder/0.1.7-alpha.1`），按上一版同样的「整体重放自有提交」流程。
2. **合并后第一件事跑 `pnpm run verify-package-dependencies`**（§5.1），把依赖范围门禁过掉——这是本版最可能的新增红灯。
3. **整树抬版验证**（§5.1.1）：`pnpm install --frozen-lockfile` 后 `pnpm ls @deepseek-ai/dsh-*` 确认无 alpha.1/alpha.2 双副本。
4. **`spill-policy` 配置面全仓 grep**（本机 KCoder 工作区已实测为 0 命中），并确认 `~/.kcoder/profiles/web/cordis.patch.yml` 未写旧键；随后用一次大结果工具调用验证保留**确实生效**（防静默自禁用）。
5. **五个插件各做一次「零改动回归」**：技能（加载/调用）· MCP（内置 5 条启停 + 一次含图 MCP 调用验证图文保留）· 侧边栏（槽位渲染 + 长会话滚动 + turnTail 位置 + Tooltip/Menu）· 文件审查（diff 渲染 + open-with + Remote 调用）· 终端（pty 起停 + 输出落盘 + 回调异常面）。
6. **专项**：`uncaughtException` fatal 语义冒烟；**打包产物启动冒烟**（§6-4）；`tool-jobs` 唤醒策略产品裁决。
7. **收口文档**：在本文件追加 §8 执行记录（与 alpha.1 文档同构）。

---

## 8. 执行记录

### 8.1 第一批已执行（2026-09-23：fork 集成分支重放 + 构建阻断定位 + 三面构建）

**产物**：fork 分支 `kcoder/0.1.7-alpha.2` @ `f12a7e9ff0`（父提交 `00102833df` = tag `dsh-v0.1.7-alpha.2` × `ab438d0a03` = `kcoder/0.1.7-alpha.1` 尖端），单次 `merge --no-ff` 重放，与 alpha.1 同款流程。

**重放完整性（理想签名）**：`git diff --name-only kcoder/0.1.7-alpha.1 kcoder/0.1.7-alpha.2` = **869 文件**，与上游 `git diff dsh-v0.1.7-alpha.1 dsh-v0.1.7-alpha.2` 的 **869 文件逐数吻合**——即重放后我方分支间的差异恰为「上游本版变更」，自有面零丢失、零多余。

**冲突实况（6 处，比 §5.3 预判的「极少」略多，但全是同源一组）**：

1. `ChatView.tsx`：两侧独立改动取并集——上游结构性重构（新增 `.frame` 包裹、`TurnNavigator` 移出 `.scroll`、`ChatNodeList` 新增 `pendingInputs/lastInputTurn`）× 我方 0007 `editUserMessage` 两处（解构 + `ChatNodeList` 传参）。解法＝以上游结构为底补回我方那一行传参；`slots.ts` 的 `ChatViewInjected/ChatNodeOwnerProps` 契约零冲突自动并入。
2. `DiffBlock.tsx` / `DiffBlock.module.css` / `diff-block.client.spec.tsx` / `ui-tool/tests/{diff-card,tool-row}.client.spec.tsx`（5 处）：我方补丁「footer 计数改着色 span + 断言适配」**随上游删除 footer 一并作废**（alpha.2 `DiffBlock.module.css` 已无 `.footer`，`diffTotals` 成为唯一 +/− 出口），整组取上游。`diffTotals` 导出未动。

**构建阻断定位（本轮唯一实锤新坑，非上游问题、非合并问题）**：`pnpm run build` 在 `tsc -b tsconfig.host.json` 报 3 错——`packages/client/ui-plugin-manager/tests/registry-probe.host.spec.ts` 的 `TS1192 无默认导出` / `TS2305 无 Config` / `TS2339 Context 无 pluginRegistryProbe`。

- **根因**：该包 `src/index.ts` 在 alpha.1 是 `export function apply(): void {}` 的空宿主体，alpha.2 被 `3c50bf6b6c` 整体换成 `PluginRegistryProbe` 类（默认导出 + `Config` + module augmentation）。而 `lib/types/index.d.ts` 仍是 **19:56 的 alpha.1 产物**。`tsc -b` 对**报错的项目不产出**，于是陈旧声明文件把错误**锁死成自持循环**：每次构建都拿旧 `.d.ts` 去校验新 spec，永远报同样的 3 错，永远不会覆盖它。
- **解法**：`rm -rf packages/client/ui-plugin-manager/lib` 后重建，host 面 exit 0。
- **一般化教训**（值得进升级 SOP）：**上游「整文件替换语义」+ `tsc -b` 增量产物 = 可自持的假错误**。判据是「报错符号在源码里明明存在，但报错信息里出现 `lib/types/...` 路径」——见到就该删该包 `lib/`，而不是去改源码或改测试。（对照：alpha.2 纯净 worktree 同批次的报错是「缺子路径构建产物」，与本次不同型。）

**三面构建（全绿）**：`build:native-system` → host → client → `build:web` **exit 0**；合并后晚于 merge 时间戳的重建产物 **514 个**。构建产物四处关键标记逐点在位：`ScrollFollow`/`scrollMetrics` **13**（alpha.2 新滚动控制器）、`turnWindow` **4**（分页 turn 对齐）、`dsh-kcoder-turn-status-shimmer` **2** 与 `data-turn-running` **2**（我方 [alpha.1 文档 §8.9](./upstream-0.1.7-alpha.1-analysis.md) 的深蓝扫光，随重放存活）。

**注意**：`apps/web/dist`（侧车实际服务的 Web 壳，经 `@deepseek-ai/dsh-web-frontend` 解析）**不在** `pnpm run build` 的默认链里，必须单独 `pnpm run build:web`——只跑 `pnpm run build` 会让 dev/侧车继续吐 alpha.1 的壳。

### 8.2 第二批已执行（2026-09-23：I1 三件事的失效面回归实测）

针对本轮点名项（稳定会话与工作过程组的滚动跟随 / 历史分页与轮次跳转 / 发送消息瞬间跳动或重复显示），跑**上游为本版新增和改写的专项门**，而不是只看单测绿。

**单元/组件面（253/253 全绿，5 文件）**：`scroll-follow.client.spec.ts` **11**（alpha.2 新增的 `ScrollFollow` 控制器：跟随意图与偏移解耦、原生动画帧不算读者移动、`settle()` 按 scrollend 归属）× `chat-viewport.client.spec.ts` **41** × `chat-view.client.spec.tsx` **142**（含我方 `data-turn-running` 断言）× `session-history-journal.host.spec.ts` **28**（turn 边界分页）× `session-pending-submissions.client.spec.ts` **31**（回声准入与去重）。

**浏览器几何面（`vitest.web.config.ts`，Playwright + 真实 Web 壳）**：

| 套件 | 结果 | 覆盖 |
|---|---|---|
| `chat-scroll-contract.e2e.ts` | **9/9 通过** | 长转写滚动契约：稳定会话底部归属、工作过程组独立跟随、`scrollend` 后重定向、TurnNavigator/回到底部几何 |
| `idle-submission-handoff.e2e.ts` | **8/8 通过** | 空闲态提交交接：本地回声准入、顺序、不重复渲染 |
| `seeded-history.e2e.ts` | 15 中 **3 失败**（全为 aria golden）+ 1 skip | 功能断言全过；冷恢复历史渲染 |
| `steering.e2e.ts` | 7 中 **2 失败**（全为 aria golden） | 功能断言全过；中途转向落盘与展示 |

**5 处失败的归因（已逐条实锤为「我方自有补丁的历史性快照漂移」，不是 alpha.2 回归）**：

1. 5 个 golden diff 的**新增行只有一行**、且每次都是同一行：`+ - button "Edit this message and resend"`（另有一次 `+0/-1` 是它引起的 aria 序号位移）——即我方 0007 `editUserMessage` 链新增的按钮。
2. 全仓 `snapshots/` 下 `grep -rl "Edit this message and resend"` **零命中**——这两套 golden 从未为我方补丁刷新过，故 alpha.1 分支同样会失败（**先于本版存在**）。
3. alpha.2 本版改动的快照只有 `snapshots/web/{diff-bounded,diff-context,excel-opc,goal-multi-turn-actions,tool-details}`——**与失败的 `seeded-history`/`steering` 零交集**。
4. `steering` 另附 2 条 `llm-replay: fixture not fully consumed（consumed 1/2）` teardown 报错，是**下游产物**：golden 断言（行 139/465）先失败 → 测试提前中止 → 记录的第二次模型调用不再发生。非独立故障。

> **未做处置**：没有刷新这两套 golden。它们是上游自有快照，把「我方多一个按钮」烤进 golden 会让此后每次上游同步都产生无意义冲突，也会把「金标 = 上游行为」这一判据弄脏。**裁决（2026-09-23）：与上游保持一致——保持上游 golden 原样、登记为 fork 侧「已知稳定差集」**（成因单行、可复现），也不另立自有 golden 目录。详见 §8.6 第 1 项。

**结论**：本轮点名项的三条，上游修复**已随 fork 重放生效并全部通过专项门**；失败集与它们无关。

### 8.3 第三批已执行（2026-09-23：KCoder 侧前置同步 + staging 物化）

**失效面 grep 归零（§5.2 第 1 项）**：`maxInlineBytes` 在 KCoder 仓（排除 node_modules）+ `~/.kcoder` + `~/.kcoder-dev` 三处 **0 命中**——基座 bundle 已由上游改名，我方无自定义 spill 配置，**不存在 §6-1 的静默自禁用窗口**。

**类型级破坏的我方消费面复核（§3.1 三项）**：`DiffBlockLabels` / `ReadBlockLabels` / `CodeToolbarLabels` / `ClientModuleLoader` / `SessionFollowRequest` 在 `dsh-file-review-kcoder` 与 `dsh-coding-sidebar` 源码中**全部 0 命中**——§3.1「对我方零影响」的预判实测成立，两个插件本版**零代码改动**。

**前置同步（本批，功能引用点 4 处全覆盖）**：`desktop/main/dsh-contract.ts` 的 `UPSTREAM_BRANCH` 常量及其文档注释 → `kcoder/0.1.7-alpha.2`；`scripts/setup.sh` 的 `UPSTREAM_BRANCH`；`scripts/release.sh` 的分支断言 2 行；`upstream/BASELINE` 钉版 SHA → `00102833dfaee1da9f48a3a8eae9d34005a75218`（= tag `dsh-v0.1.7-alpha.2`）+ 追加本版升级记录。

> **记录一次自查纠错**：本节初稿只写了 `setup.sh`/`release.sh` 两处并声称「`grep desktop/main scripts` 归零」——**该断言当时是错的**：`desktop/main/dsh-contract.ts` 的 `UPSTREAM_BRANCH` 是一处**活常量**（被 `about-settings.ts` / `upstream.ts` 消费，决定界面展示的集成分支与 fork 克隆切的分支），漏改会让「关于」页与实际消费分支不一致、且 `setup.sh` 克隆分支与桌面端记录的分支错位。原因是首次 grep 只覆盖了 `.github/workflows` 与 `scripts`，**漏了 `desktop/main`**。已补齐并复核。
>
> 复核口径（可复现）：`grep -rn "kcoder/0\.1\.7-alpha\.1" desktop/main scripts | grep -vE "^\S+:[0-9]+: *\*|^\S+:[0-9]+:#|^\S+:[0-9]+: *//|<!--"` **零命中**——即功能引用点已全部切到 alpha.2；剩余提及全是**历史注释**（`product-policy.ts` 的「上游 0.1.7-alpha.1 起…」行为沿革、`workspace-header.ts` 与 `scripts/smoke-workspace-header.mjs` 的 alpha.1 诊断背景），按原样保留。另：`out/main/index.js` 里那份 `"kcoder/0.1.7-alpha.1"` 是桌面端**构建产物**（`out/` 已 gitignore、未跟踪），下次 `pnpm build` 自动重写，不入库。
>
> `bundle/*/pnpm-lock.yaml` 的 alpha.1 是插件自身 dev 锁，非消费态，见遗留 #3。

**依赖范围硬门禁（§5.1）**：`pnpm run verify-package-dependencies` **exit 0**——`70 package(s) match the published dependency policy (5 Client-only, 63 Client/Host, 2 configured Host)`。本版最可能的新增红灯**未亮**。

**staging 物化收口**：`pnpm --dir <fork> --filter=@deepseek-ai/dsh deploy --prod --legacy staging/kcoder-runtime` exit 0，产物 `package.json` 版本 **0.1.7-alpha.2**、`lib/bin.js` 在位；随后 `scripts/materialize-peers.mjs` 补 peer 闭包并出 tar.gz。（aligns §7 第 2 项。）

**桌面壳对 installFailLoud 新退出形态的消费面（§6-3）**：实测 `desktop/main/dsh-manager.ts` 已能正确消费「`exit 1` + stderr 尾巴」形态——`child.on('exit')` 记 code/signal、`child.stderr.on('data')` 逐行落日志、随后按 `MAX_AUTO_RESTARTS = 3` 指数退避重启。**无需改动**。

**§5.2 第 11 项（自建 WebSocket 补重试）＝N/A**：`grep "new WebSocket" desktop/` 零命中——KCoder 桌面壳不自建 socket，全量经 `@deepseek-ai/dsh-client-connection`（其自带重试），故 §6-6 的「准入推迟 → 硬断连」对本产品不成立。

### 8.4 第四批已执行（2026-09-23：dev 实跑 + alpha.1 两条自有修复的 alpha.2 存活复核）

**启动（自起隔离实例，不动用户正在跑的打包态 App）**：`DSH_HOME=~/.kcoder-dev node --expose-internals <fork>/apps/cli/lib/bin.js web --patch ~/.kcoder-dev/cordis.patch.kcoder.yml --port 0 --no-open` → 就绪行正常，18 行日志**零 fail/error**。

| 观测项 | 结果 |
|---|---|
| 客户端 roster | **67 行**，`__DSH_BOOT__ = {rev, entries, batches}` |
| 五个自研插件 | 客户端 4 行到位：`dsh-coding-sidebar` · `dsh-file-review-kcoder` · `@kkutysllb/dsh-terminal` · `dsh-shell-prefs`（`dsh-skills-bundle` 为宿主侧，见日志 `37 runtime skills registered`） |
| `data-slot` 槽位 | **36** 个；`conversation.session.header` **在场** |
| TurnNavigator（alpha.2 改过宽度阈值与容器查询） | 在场 |
| 控制台 | **异常 0 / error 0 / warning 0** |
| 侧边栏插件 | `[dsh-coding-sidebar] client 1.0.31 booted (nav-seam v3: uiWorkspace capture)` + `[data-dsh-panel-host]` 在位 |
| HMR 产物一致性 | `__DSH_BOOT__.rev` 变化即证明产物被重算（§8.1 三面构建的产物已生效） |

**alpha.1 页头细线修复在 alpha.2 的存活复核（实机 DOM 断言）**：

| 断言 | 实测 |
|---|---|
| `[data-slot="conversation.session.header"]` 是 `<header>` 的直接子级 | **true** |
| 修复选择器 `header:has(> [data-slot="conversation.session.header"])` 命中数 | **1** |
| 旧选择器 `header:has(> [class*="_titleRow"])` 命中数 | **0** |
| `_titleRow` 是否被 slot 容器包住 | **true**（slot 元素为 `display:contents` DIV，父即 `HEADER._header`） |

**第 3 行 = alpha.1 那个「孤立横线」的失效机制在 alpha.2 原样复现**（旧锚点因为 titleRow 进了 slot 而彻底失配），第 2 行则证明我方按 `data-slot` 重锚的修复**继续有效**。同时可见 blank 态 `_headerBlank` 的 `minHeight:0 / borderBottom:0`——与 alpha.1 诊断的「border 只在会话开始后出现」行为一致。**结论：无需为 alpha.2 改动 `desktop/main/workspace-header.ts`。**

> 口径提示：`brand-injector` 与 `workspace-header` 的 CSS 由 **Electron 主进程** `executeJavaScript` 注入，纯浏览器（CDP 直连 Web 地址）看不到——故上述 brand 相关项须在桌面壳内验收，不能用裸浏览器判定。

### 8.5 fork 远端对齐（本轮发现的**发布链路陷阱**，已修）

**发现**：本地 fork 已完成 alpha.2 重放，但 `origin/kcoder/0.1.7-alpha.2` 仍停在 `00102833df`——**就是上游 tag 本身**（本地领先 40 个提交）。用 `git grep` 在远端那棵树上核对三个自有标记：`dsh-kcoder-turn-status-shimmer` / `editUserMessage` / `fillDraft` **全部 MISSING**。

**为什么这是陷阱而不是单纯「忘了推」**——`scripts/setup.sh` 用 `git clone -b kcoder/0.1.7-alpha.2` 取树，而 `scripts/release.sh` 的两道基线断言**都会通过**：

1. `[[ "$(git branch --show-current)" == "kcoder/0.1.7-alpha.2" ]]` —— **按名字比**，克隆出来的分支名当然就叫这个；
2. `git merge-base --is-ancestor "$BASELINE_SHA" HEAD` —— 钉版 `00102833df` **正是那个尖端**，包含关系恒真。

于是「未打补丁的上游树」会**一路绿灯通过发版闸门**，产出品牌未 KCoder 化、无 `editUserMessage`、无 0.1.6/0.1.7 各项引擎修复的运行时——**且不报任何警**。本轮若不核对远端，这个坑会在下次发版时才炸，且现场表现是「发了但功能不对」，排查成本极高。

**处置**：`kcoder/0.1.7-alpha.2` 的本地尖端是远端尖端的**后代**（`origin` 那点是它的第一父），故推送是**纯 fast-forward、非破坏**——推之。同时把被取代的 `kcoder/0.1.7-alpha.1` 一并 FF 推送（远端 `e8036fb560` → `ab438d0a03`，补上 alpha.1 文档 §8.9 那次深蓝扫光修复，否则该修复只在本地而不在其所属分支上）。推送后 `git fetch` 复核：两分支 ahead/behind 均 **0/0**，三个自有标记在远端树上 **present ✓**。

**推送途中先被 fork 自己的 pre-push 门拦下一次**（`pnpm run typecheck` 失败）——**不是类型错误**：`pnpm` 的 `verify-deps-before-run` 认定 `node_modules` 与 lock 不同步（上一批 `pnpm deploy --prod` 把工作区装成了 prod-only 态），于是自动跑 `pnpm install --production`，而该 `postinstall`（`scripts/install-lefthook.mjs`）需要 devDeps 里的 `lefthook` → `ERR_MODULE_NOT_FOUND` → 退出 1。解法＝`CI=true pnpm install` 把安装态还原（lefthook 恢复、hooks 重新 sync），随后 typecheck **exit 0**（含 `tsc -b tsconfig.client.json` 客户端契约工程）、推送通过。**教训**：**跑 `deploy --prod` 之后，fork 工作树需要一次全量 `pnpm install` 复位**，否则后续任何 `pnpm run <script>` 都会踩这个自动重装。

> 附带收口：§8.1 里 fork 重放提交信息提到的「`tsc -b tsconfig.client.json` 仅 2 个错误、疑似缺构建产物」在本次完整 install + 三面构建后**归零**——证实那确实是增量产物过期，非合并引入。

### 8.6 遗留与已决（2026-09-23 用户裁决：两处决策点**与上游保持一致**）

> **裁决口径**：两个决策点一律「不偏离上游」——我们不自立标准、不加反向配置。据此两条都落到**零改动**，并各自登记为持久观察项。

| # | 项 | 状态 |
|---|---|---|
| 1 | `seeded-history`/`steering` 的 5 项 aria golden 漂移（成因＝我方 edit 按钮单行） | **已决：保持上游 golden 原样，登记为已知稳定差集**。不原地刷新（避免把自有按钮烤进上游 golden、污染「金标＝上游行为」判据），也不另立自有 golden 目录（那等于自建第二套金标，反而偏离上游）。**含义**：这两套件在 fork 上**恒有 5 项红**，读门禁结果时必须先扣除这 5 项（成因见 §8.2 的四条实锤）；`DSH_SNAPSHOT=refresh` 不得对这两个目录执行。 |
| 2 | `tool-jobs` 的 `maxConsecutiveWakes` 默认「不设上限」（§3.3、§6-7） | **已决：不显式设值，采用上游默认**。实测 KCoder 从未设过该键（overlay 无 tool-jobs 行），上游 schema `z.number().min(1)` 无默认值 ⇒ 零改动。**持久观察项**：引擎自带的防自激链本版被移除（上游修「连续后台任务后会话停住」的代价），若现场出现「后台任务自我唤醒形成长链」，第一处置是给该 owner 显式配 `maxConsecutiveWakes`，而不是回退上游。 |
| 3 | `bundle/dsh-file-review-kcoder/{package.json,pnpm-lock.yaml}` 的 devDeps 仍钉 `0.1.7-alpha.1` | **已决：不动**（同口径）。peer 范围 `^0.1.7-alpha.1` 按预发布规则已覆盖 alpha.2，运行态无碍；本版插件零代码改动，不为 dev 锁单独发版本。 |
| 4 | `upstream/BASELINE` 追加本版升级记录 | **已完成**（见 §8.3） |
| 5 | 打包产物启动冒烟（§6-4 上游 app.asar 缺包事故的对照项） | **未做**：属 release 链（`scripts/smoke-runtime.mjs` + Electron node 形态）。注：本地已对 staging 直接跑过 `smoke-runtime`（就绪行 + 首页 200 ✓），差的是**electron-builder 产出的 app.asar 内闭包**那一步，随下次发版走。 |
| 6 | `ui-deliverables.tailCard` 闸门在客户端半失效（历史遗留，非本版新增） | 维持既有决策（两卡并存、零改动）——同「不偏离上游」口径。 |

### 8.7 本批提交

- fork `kkutysllb/deepseek-harness`：分支 `kcoder/0.1.7-alpha.2` @ `f12a7e9ff0` —— **已推**（FF `00102833df..f12a7e9ff0`，pre-push typecheck ✓）；`kcoder/0.1.7-alpha.1` @ `ab438d0a03` 一并 FF 推送（`e8036fb560..ab438d0a03`）。两分支与 origin 均 0/0。
- KCoder `main`：`desktop/main/dsh-contract.ts`（`UPSTREAM_BRANCH` + 注释）· `scripts/setup.sh` · `scripts/release.sh` · `upstream/BASELINE`（钉版 + 升级记录）· 本文件 §8。质量门：`pnpm typecheck`（含注入脚本合规自检）exit 0、`pnpm build` exit 0。
- KCoder `staging/kcoder-runtime` @ **0.1.7-alpha.2**（不入库）：deploy exit 0 + materialize-peers 25,331 文件 → tar.gz 162MB、自检通过；`verify-vendor-purity --clean` 纯净；`smoke-runtime` 就绪行 + 首页 200 ✓；`brand-assert` 通过（`chat.deepDiving = KCoder...`）。
- **未改动**：五个自研插件源码（本版实测零改动面）、`desktop/main/workspace-header.ts`（实机证明锚点继续有效）、`desktop/main/dsh-manager.ts`（实机证明能消费新退出形态）。

---

## 附录 A：本版「零变化」证据速查（可直接复现）

```bash
cd /Users/libing/kk_Projects/deepseek-harness
TOP=dsh-v0.1.7-alpha.1; BOT=dsh-v0.1.7-alpha.2

# 1) 原始变更面
git diff --name-only $TOP $BOT | wc -l                     # 869

# 2) 剔除 3 个家务提交碰过的文件 → 真实变更面
{ git show --name-only --format='' 10ea83bcc3
  git show --name-only --format='' 4e6028a604
  git show --name-only --format='' 37372101b5; } | sort -u > /tmp/bump.txt
git diff --name-only $TOP $BOT | sort > /tmp/all.txt
comm -23 /tmp/all.txt /tmp/bump.txt | wc -l                # 509

# 3) 关键插件契约包：是否只有 package.json
for p in packages/client/ui-slots packages/client/ui-settings \
         packages/typert/protocol packages/typert/registry \
         packages/skill packages/terminal packages/session packages/fs; do
  echo "--- $p"; git diff --stat $TOP $BOT -- $p
done

# 4) spill 配置断裂证据
git diff $TOP $BOT -- packages/spill/spill-policy/src/index.ts
git diff $TOP $BOT -- packages/bundle/base/cordis.patch.yml

# 5) projectContent 为 additive（finalizeContent 仍在）
git show $BOT:packages/core/tools/src/index.ts | grep -n 'projectContent\|finalizeContent'

# 6) tool-jobs 默认值翻转
git diff $TOP $BOT -- packages/jobs/tool-jobs/src/index.ts

# 7) installFailLoud 接管 uncaughtException
git diff $TOP $BOT -- packages/boot/app-boot/src/index.ts

# 8) 509 的构成核对（377 其它 + 1 package.json + 131 README/i18n = 509）
R=$(comm -23 /tmp/all.txt /tmp/bump.txt)
echo "real total:      $(echo "$R" | wc -l)"                                    # 509
echo "README/i18n:     $(echo "$R" | grep -cE 'README|\.i18n\.yaml')"           # 131
echo "package.json:    $(echo "$R" | grep -c 'package\.json$')"                 # 1 (vendor/cosmokit)
echo "other:           $(echo "$R" | grep -vE 'README|\.i18n\.yaml' | grep -cv 'package\.json$')"  # 377
```

## 附录 B：本版三个「家务提交」明细

| 提交 | 主题 | 规模 | 说明 |
|---|---|---|---|
| `10ea83bcc3` | `release(dsh): 0.1.7-alpha.2` | 312 文件 / +312 −312 | 全仓 `package.json` 版本戳 α.1→α.2 |
| `37372101b5` | `build: pin internal DSH workspace dependencies` | 310 文件 / +6570 −6509 | DSH 内部依赖统一钉 `workspace:*`，新增/改写 `scripts/verify-package-dependencies.{ts,spec.ts}` |
| `4e6028a604` | `build: use tilde ranges for vendor and native workspaces` | 348 文件 / +1592 −1526 | vendor/native 依赖改 `workspace:~`，更新 `vendor/README.md` 与门禁实现 |
| `d0dca04e22` | `release(vendor): cordis 4.0.4, cosmokit 1.8.5, …` | 9 个 vendor 包 | 独立于上述三个的 vendor 版本上抬 |

> 这三个提交 + vendor 上抬共同解释了「869 文件 vs 真实 509 文件」的全部差额，也是本版必须做「噪声剔除」的原因。
