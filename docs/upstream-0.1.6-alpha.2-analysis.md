# 上游 deepseek-harness 0.1.6-alpha.1 → 0.1.6-alpha.2 差异分析

> 分析日期：2026-09-18 · 仅分析，未改动任何代码
> 消费形态：KCoder v0.6.13（桌面壳），上游 fork = `kkutysllb/deepseek-harness`
> 前一版分析：`docs/upstream-0.1.6-alpha.1-analysis.md`（结构、口径、升级仪式与本文一致）

---

## 0. 一句话结论

**这是一次「插件管理器大版本 + 交付物 git 快照体系 + 侧栏浏览器 + boot 隔离韧性」的巩固性升级，不是契约破坏性升级；但它有一发命中我们两个自研插件的硬断点。**

- **好消息**：SESSION 格式版本**仍是 3**；`ui-slots` 导出**零删除**（新增 factory 体系）；settings 壳、MCP 层、CLI 契约（`--patch`/`--no-open`/就绪行/`passThroughOptions`）、全部 DOM/CSS 锚点、D2 overlay 的两个目标行 id **全部原样存活**；插件 peer 键 `^0.1.6-alpha.1` 按 npm 预发布规则**直接覆盖 alpha.2，无需改动**。
- **坏消息**：① **`conversation.chat.turnTail` 从 `chain` 改为 `list`**——`dsh-file-review-kcoder` 整个「-2 优先级抢占」模型失效（list 下两家都渲染），`dsh-coding-sidebar` 的 -1 拦截行同样要跟；② 新插件管理器开始**写 profile 的 `cordis.patch.yml`**，与 `mcp-store.ts` 成为同文件双写者（双方都是保真编辑，冲突面可控但有两条新规则要看）；③ 外部 bundle 行 id 与隔防规则重定（对我们最终是利好，但重建后必须 `--dump-config` 复验）。
- **总账**：887 提交 / 2622 文件 / +101460 −23708（约 350 文件是 `.agents/notes`，代码面 ~2270）。窗口仅 2 天，提交量与上一版 5 天窗口（800 提交）相当。

---

## 1. 对比口径

| 项 | 值 |
|---|---|
| 旧基线（当前消费态） | `0a15e36e7f82b6ed45af6fa9759f29b40dcd965d` = 上游 tag `dsh-v0.1.6-alpha.1`（2026-09-15 10:42） |
| 当前集成分支 | `kcoder/0.1.6-alpha.1` 尖端 `b88abcad16`（= tag + merge `kcoder/0.1.5-rc.2` 整体重放） |
| 新目标 | `ddefc45fbc7f8e46dd73185e68295696d1297887` = 上游 tag `dsh-v0.1.6-alpha.2`（2026-09-17 21:19，fork 已同步该 tag） |
| 提交量 | 887（非 merge 548）· **fix 207 / feat 99 / test 78 / refactor 68 / docs 56 / chore 14 / perf 7 / style 6 / revert 4+** |
| 文件量 | 2622（含 notes）· 代码面 ~2300 |
| 变更最重的包 | `ui-sidebar-documentpreview`(57) `ui-conversation`(47) `api/session-controller`(38) `ui-primitives`(36) `ui-deliverables`(34) `ui-settings-plugins`(32) `ui-sidebar-browser`(27，新包) `subprocess-local`(25) |
| 新增包 | `boot/plugin-manager` `boot/hmr` `client/ui-plugin-manager` `client/ui-sidebar-browser` `deliverables/workspace-changes` `deliverables/tool-present`（自 `fs/tool-present` 迁入） `document/office-to-pdf` `skill/skill-office` `util/lazy-require` |
| 删除包 | `fs/tool-present`（迁走） `desktop-host/config` |

---

## 2. 上游新增功能（按域）

### 2.1 插件管理器体系（本版最重的主题）

- **`pluginManager` 服务**（`boot/plugin-manager`，9 文件）+ **`ui-plugin-manager`**（21 文件）：安装/卸载/启停/重试 bundle，按包聚合 manifest + probe 记录 + 活树为单一视图；pnpm 安装流按 CLI 同款方式转发，输出经 `plugins/install-log` 流式呈现（每个 pnpm run 一块终端），每次变更发 `plugins/changed`，api-remotes 转发两者。
- **UI 归宿大迁移**：插件管理从设置页 tab 移到**侧栏 Plugins 面板**（`feat(web): move plugin management to the sidebar's Plugins panel`），设置页插件 tab 被砍（`simplify the plugin manager and drop the plugin list tab`）；每包一页、按 pack/插件分组、行精简为名字+一句话+开关；preset 的能力与设置整体搬到 preset 详情页（新 `ui-agent-preset` 交互）。
- **patch-file writer**（`plugin-manager/src/patch.ts`）：启停不再改 profile `package.json`，而是把 `- id / disabled` 行**写进 profile 的 `cordis.patch.yml`**（解析保注释、`writeFileAtomic` 原子写、按 id `findLast` 匹配、不匹配则追加）。
- **preset 用户补丁层**：每个 agent preset 可有自己的 `cordis.patch.yml`（本地产出组合旁，或 shipped preset 的 `.agent-presets/<id>/` 下）；发现/挂载/评审/继承/removal 全链支持，组合清单报告每行的 `source` 与 `disabledBy`。
- **安装判定与恢复**：pnpm 跑完后判定安装成败、失败还原 manifest、一次只做一个变更；可取消（进程+文件清理后）；预安装检查 + 失败分类；被拦截的安装脚本可从安装对话框批准；Host 拒绝变更时说明原因与被移除内容。
- **boot 侧配套**（`feat(boot): isolate external bundles and expose the booted profile` + `feat(boot): own row ids across the stack instead of prefixing external bundles`，详见 §3.2 #3）：外部 bundle 层挂成 `cordis:contained-group`，**单个 bundle 挂载失败只记入根 `pluginFailures` 注册表，不再拒掉整个 Loader 事务**；profile 管理经新包 `boot/hmr` 与 `dsh-hmr` 协调；`ctx.profileRuntime` 暴露 boot 住的 profile；client 插件变更**免重载应用**。
- Auto review 以**可选 bundle** 随线发布，默认关、安装对话框引导（alpha.1 的实验包转正路径）。

### 2.2 交付物体系（第二重主题）

- 新包 **`deliverables/workspace-changes`**：Host 侧**按 turn 记录文件变更的 git 快照**（快照对象存 Harness home 下的私有仓；非 git 目录退化为 file-tool 编辑摘要；摘要随 Session 生命周期留在 Host）。
- 交付卡升级：changed-files 卡片渲染真实变更、**卡片内逐文件 diff**（`compare each changed file from the card`）、**单 tab 评审一个 turn 的全部变更文件**；turn 级代码 diff 卡片起步（#3501）。
- 会话事件族新增 `workspace/changes`（`DeliverablesTurnData` 增 `changes`，见 §3.2 #6）。
- `tool-present` 从 `fs/` 迁到 `deliverables/`（包名不变 `@deepseek-ai/dsh-tool-present`，import 路径不变）。

### 2.3 侧栏浏览器（Sidebar Browser）

- 新包 **`ui-sidebar-browser`**（27 文件）：消息里的 HTTP(S) 链接默认在侧栏浏览器 tab 打开（`ctx.sidebarRight.openTab('browser', …)`；无 browser tab 时回退 `window.open`）；主流站点 link mark（站点自有图标）；Markdown 文件链接进侧栏预览；控制条细化。
- ⚠️ 我们的 `openpath-intercept` 拦的是 `ctx.sidebarRight.openResource`（文件地址族），**不覆盖 browser tab 流量**；浏览器行为是上游内部路由，不经我们拦截面（无断，但产品上多个原生 tab 形态，见 §6 R4）。

### 2.4 引擎 / 运行时

| 变化 | 说明 |
|---|---|
| resolution mode `link → runtime` | `feat: resolution mode link to runtime`——profile 解析默认模式推进（0.1.6-alpha.1 引入三代模式后的默认值切换）；KCoder 打包态固定 Electron node + 自管物化链，不受影响，升级后需实测启动（§8 阶段 4） |
| 子代理限额后端化 | 委托限额由后端持有、插件设置页可编辑；每根最多 16 个活跃可续激活 |
| `util/lazy-require` | caller-relative 懒 require 工具（内部依赖面） |
| subprocess / win32 | `subprocess-local` 25 文件、`win32-process` 16 文件——与我们的黑窗修复分支有重放交集（§5 冲突预判） |
| **MCP 层零变化** | `packages/mcp` 仅版本戳 + 测试夹具——上一轮「钉版本 + prefer-offline」启动提速修复对 alpha.2 完全适用，无需重做 |

### 2.5 模型层

- **默认目录收缩**：`feat(llm): remove the V4 Flash and V4 Flash Vision Exp defaults`——缺省目录只剩 `deepseek-flash`（默认模型不变）+ `deepseek-v4-pro`；被移除的 id 显式配置时仍按 text-only 路由透传。KCoder 未钉目录（用上游缺省），用户可见的模型选择列表会变短。
- Messages endpoint suffix 修复（#4241）；畸形历史 Messages tool input 容错；模型图片输入设置；模型输入控件统一 + catalog 继承。

### 2.6 客户端 UI / 体验（多数零成本随基线获得）

- composer：Enter/Tab/Escape 接受/离开模型；context 用量移入 composer stats；文件引用冒号标签。
- plan：提交的 plan 保留在 chat、artifact 卡片自动打开、侧栏打开、评审卡摘要。
- 工作区树：按父文件夹分组（可选）；侧栏会话标题裁切 hover 展开；恢复侧栏布局 + 收回无人值守终端。
- 懒加载 PDF / terminal 运行时（documentpreview 57 文件重构的一部分）。
- ui-primitives：顶层导出**仅新增**（`Checkbox`、`MarkdownDelegateProvider`、`isDarwinDesktop`）；`LinkIcon`/`MarkdownText` 为移动重构，**图标零删除**（我们自持的 `IconSendOutline16` 不受影响）。

### 2.7 上游桌面链（`apps/desktop`，与 KCoder 打包链目标继续重合）

- 原生 About 菜单/面板；**普通 + 强制两级更新流**；Windows 原生安装器设计 + caption 导航 + 本地化菜单；macOS 隐藏标题栏 + vibrancy 侧栏；**后端就绪前先加载 Web UI**（白屏体验优化）；失败页换原生恢复对话框；随包**独立 Python Office runtime** + release-bound workspace runtimes；打包配置 dotenv 化；设计器图标。
- 结论同上一版 R5：短期无冲突（不同 appId/产物），中期继续评估复用其 runtime 物化器。

### 2.8 回退记录（revert，避免误判为缺失）

- `Revert "feat(client): optimize code block previews and source highlighting"` + `revert(client): remove eager chunk scanning`
- `Revert "fix(web): insert pasted composer text as line-break nodes"`
- `revert: restore original CLI profile boot exports`（CLI 导出面恢复）
- `fix: revert desktop`（桌面侧一次返工）

---

## 3. 核心契约层变更

### 3.1 稳定（零改动或纯增量，可放心）

| 契约 | 状态 |
|---|---|
| `SESSION_FORMAT_VERSION` | 仍 **3** ✅（`packages/core/session/src/types.ts:88`） |
| `ui-slots` 导出面 | **零删除**；新增 factory slot 体系（`SlotFactoryMap` 等 18 个新导出）✅ |
| `ui-layout` / `ui-sidebar` 服务 | railMark/brandName 存活；`SidebarRoot` 有 UI 增量（HeaderLeadingControls）但锚点在 ✅ |
| settings 壳（`ui-settings/src`） | **源码零改动**；`settings.section` slot（list/root）与 DOM 锚点安全 ✅（coding-sidebar 的 Side card 设置节不受影响） |
| `settings.plugin.item` | 本就是 models 页局部契约，状态不变 ✅ |
| CLI 契约 | `--patch`（可重复）/`--dump-config`/`passThroughOptions`（args.ts:150，参数顺序约束仍硬）✅；就绪行 `dsh web: http://127.0.0.1:<port>/?token=…` 格式不变 ✅；bin 仍 `lib/bin.js` ✅ |
| KCoder DOM 锚点 | `data-composer-card`、`data-conversation-scroll`、`data-conversation-composer-overlay`、`toBottomSlot`、`data-slot="conversation.session"`、`railMark/brandName` 全部存活 ✅ |
| 右侧栏压制锚点 | `data-sidebar-right-expand/panel/float-host` 仍在（ExpandButton/SidebarRight）→ `NATIVE_SIDEBAR_CSS` 继续有效 ✅ |
| **D2 overlay 目标行** | `- id: session-log-deepseek`（base patch:43）、`- id: ui-sidebar-terminal`（web-app patch:240）行 id 不变；`session-log-deepseek` 默认**仍为 `true`**（README + zod `.default(true)`）→ `cordis.patch.kcoder.yml` 两条产品决策行原样有效 ✅ |
| api-remotes 静态依赖 | 仍静态 import `api-terminal-controller/remote`（remotes/src/client/index.ts:21）→ 「不得禁用 `terminal-controller`」约束继续成立 ✅ |
| MCP 层 | 零功能变化 ✅ |

### 3.2 断点清单（按影响等级）

| # | 契约 | 变化 | 命中我们的谁 | 等级 |
|---|---|---|---|---|
| 1 | **`conversation.chat.turnTail` 槽位类型** | **`kind: 'chain'` → `kind: 'list'`**（ui-chat contract/slots.ts）：selector 路由（第一个接受的 entry 独占渲染）改为有序贡献（每个 entry 各自渲染、无内容返回 null）。`chain` 机制本身保留在 ui-slots 里，改的是这一个槽位的声明 | **`dsh-file-review-kcoder`** 的注册模型整个建立在 chain 抢占上（-2 优先级 elect、coding-sidebar -1 被压制）→ list 语义下**两家同时渲染**，出现重复 UI；**`dsh-coding-sidebar`** 的 -1 拦截行同样要改 | 🔴 硬断 |
| 2 | **插件管理器写 profile patch 层** | `writePluginEnabled()` 直接改 `$DSH_HOME/profiles/web/cordis.patch.yml`（原子写、保注释）；`diskState()` 把该文件纳入变更检测 | `mcp-store.ts` 同文件双写者（详下） | 🟠 高 |
| 3 | **外部 bundle 行 id 与隔离** | 先引入 `<package>/<id>` 前缀（isolate external bundles），随后**撤销前缀**（own row ids）——最终态：**外部 bundle 保留其 patch 声明的 id**；所有权在 `composeProfileStack` 先裁：内建/boot 层撞 id = boot 失败，contained bundle 撞 id = **整包剔除**（pluginFailures 记 conflict），**用户层 insert 撞已占 id = 静默丢弃**；boot/热重载/`--dump-config` 走同一函数 | 我们四个内置 bundle 都是外部 bundle：保留 id → patch 寻址行为与 alpha.1 相同 ✅；「用户层 insert 撞 id 丢弃」是新失败模式——我们 mcp 条目 id 是 `mcp-<serverName>` 前缀，与内建行 id 无撞车面 ✅；单 bundle 挂载失败不再炸整个 Loader = alpha.1 R3 的官方解药 ✅。**重建后必须 `--dump-config` 复验**（§8） | 🟠 高（半利好） |
| 4 | `ChatViewInjected` 新必填 `openExternalLink`；ui-chat `inject` 增 `uiWorkspace`；`forkAt` 改走 `ctx.uiWorkspace.openSession` | 接收方成本低 | 🟡 中 |
| 5 | `ui-conversation` 契约增量 | `conversation.session` slot 增 `owner {view?}`；新 slot `conversation.session.header.leading`；`hero.agentPreset` scope root→session-maybe；`MessageImageSource` 增 `label`、`MessageImagesOwnerProps` 增 `thumbnail`；draft-editor/input/queue 小改 | 我们是接收方；style-overlay 用公开 data-* 锚点不受 CSS 哈希变化影响 | 🟡 中 |
| 6 | `ui-deliverables` 新事件族 | `workspace/changes` 事件 + `DeliverablesTurnData.changes` + review-definition/review-store/changes-summary | `dsh-file-review-kcoder` 自有 turn-deliverables 拷贝需**语义跟进**（同 alpha.1 §4.3 遗留） | 🟡 中 |
| 7 | ui-chat `apply.ts` / `ChatView.tsx` / slots 增量 | openExternalLink、uiWorkspace、ReasoningRow/StatsPills/TurnTailNodeView 小改 | 与我们 0007 `editUserMessage` 的重放交集（§5） | 🟡 中 |
| 8 | 包版本戳 | 全 `@deepseek-ai/*` `0.1.6-alpha.1` → `0.1.6-alpha.2` | 插件 peer 键 `^0.1.6-alpha.1`：npm 预发布规则下 `^0.1.6-alpha.1` ⇒ `>=0.1.6-alpha.1 <0.2.0`，`0.1.6-alpha.2` 与下界比较器同 tuple (0,1,6) → **满足，无需改** ✅；`dsh-file-review` 的 `… \|\| ^0.1.6-alpha.1` 分支同理覆盖 ✅ | 🟢 低（本次免改） |
| 9 | 插件清单元数据 / resolution mode 默认推进 | 延续 alpha.1，无新增强制 | — | 🟢 低 |

**#2 详注（mcp-store 与插件管理器的同文件双写）**：上一版分析中「cordis.patch.yml 被 mcp-store 整份重序列化」的描述**已过时**——现行 mcp-store 用 yaml Document API 只增删改匹配节点（保注释/保其他行/解析失败不写回），与插件管理器的保真写入**同构**。剩余真实差异两条：
1. **写入原子性**：mcp-store 用 `writeFileSync`，管理器用 `writeFileAtomic`——两边同时写存在丢更新窗口（触发条件：插件页启停与 MCP 页保存在同一瞬间，概率低）。建议顺手把 mcp-store 的落盘换成 `writeFileAtomic` 同款（非升级必需）。
2. **新失败模式**：用户层 insert 撞已占 id 会被**静默丢弃**（boot 时打印 conflict）。我们 `mcp-` 前缀 id 无撞车面；未来新增条目时保持前缀约定即可。

---

## 4. 内置插件逐个适配清单

### 4.1 `dsh-file-review-kcoder`（bundle 1.0.4）

- 🔴 **turnTail chain → list 重构**（本升级唯一硬断）：现状 `index.tsx:248` 以 selector 注册、依赖「-2 先于 coding-sidebar -1 elect、独占渲染」的 chain 语义；`turn-deliverables.ts` 头部注释整段是 chain 语义文档。list 化后需要：每个关注点拆成独立 entry（id 唯一）、无内容返回 null；与 coding-sidebar 的互斥/分工逻辑从「优先级抢占」改为「内容协商」（各自渲染各自部分，或显式约定谁渲染什么）。
- 🟡 `workspace/changes` 语义跟进：上游 changed-files 卡片改由 Host git 快照供数；我们自有拷贝的 `presentedForClosing` 镜像 + produced 词汇继续有效，但「turn 改了哪些文件」的事实来源多了一套（§7 候选 B 评估是否直接采用）。
- ✅ peer 键 `>=0.1.0-rc.5 <0.2.0 || ^0.1.6-alpha.1` 覆盖 alpha.2，免改。

### 4.2 `dsh-coding-sidebar`（bundle 1.0.16 / 真源仓 1.0.16）

- 🟡 `intercept.tsx:140` 的 turnTail -1 拦截行同步 list 语义（与 4.1 同一批做）。
- ✅ `settings.section`（Side card 设置节）：ui-settings 壳源码零改动，免改。
- ✅ 图标：上游零图标删除，自持 `IconSendOutline16` 不受影响；`openpath-intercept` 三道门照旧（`ctx.sidebarRight.openResource` 调用点仍传 file 地址族；browser tab 是新流量但不走该服务）。

### 4.3 `@kkutysllb/dsh-terminal` / `dsh-skills-bundle`

- ✅ 无 `@deepseek-ai/*` peer，预期零改动。上游原生终端行仍被 D2 overlay 禁用（行 id 未变）。

### 4.4 插件仓遗留债（不阻塞本升级）

- devDependencies 仍钉 `0.1.6-alpha.1`（alpha.1 遗留待办 §9.5 #7，需联网重装）。

---

## 5. 升级仪式改动面（同 alpha.1 七件套）

| 落点 | 现值 | 需改为 |
|---|---|---|
| `upstream/BASELINE` | 末行 `0a15e36e7f…` | `ddefc45fbc7f8e46dd73185e68295696d1297887` + 追加 alpha.2 升级记录 |
| fork 集成分支 | `kcoder/0.1.6-alpha.1` | 新建 `kcoder/0.1.6-alpha.2`（基于 tag → `merge --no-ff kcoder/0.1.6-alpha.1` 整体重放；**不 reset 旧分支**） |
| `desktop/main/dsh-contract.ts` `UPSTREAM_BRANCH` | `kcoder/0.1.6-alpha.1` | `kcoder/0.1.6-alpha.2` |
| `scripts/setup.sh` / `scripts/release.sh` | 同上 | 同上（3 处断言；完成后 `grep -rn "kcoder/0.1.6-alpha.1" desktop scripts` 归零） |
| peer/dev 版本键 | `… \|\| ^0.1.6-alpha.1` | **免改**（§3.2 #8，本次特有省项） |
| profile-patches | `dsh-context` 锄点 | 不涉及上游（dsh-context 不在上游树），免改 |
| overlay 验证 | — | rebuild 后 `web --dump-config --patch` 复验两行（新 contained-group 组装路径必须实测，见 §3.2 #3） |

**重放冲突预判**（我们集成侧 delta 与上游 alpha.2 delta 的文件交集，实测 19 个）：

```
apps/cli/src/plugin.ts                    # 我们的 pnpm 转发器改动
ui-chat: apply.ts / ChatView.tsx / contract/slots.ts + chat-view spec   # 0007 editUserMessage × 上游
ui-conversation: conversation/assembly.ts # 0006 opencode 会话头 × 上游
llm-pi-ai: adapter.ts + catalog.spec      # 我们的 pi-ai 线 × 上游
llm: index.ts + topology.spec
subprocess-local: process-inspector.ts    # 我们的文件 × 上游
win32-process: abi.ts / process.ts + 两 spec  # 黑窗修复 × 上游 16 文件大改
.gitignore / pnpm-lock.yaml / pnpm-workspace.yaml / THIRD_PARTY_NOTICES.md
```

处置同 alpha.1 §9.1：并集取语义、锁文件取 HEAD 侧后 `CI=true pnpm install --no-frozen-lockfile` 重收敛；**merge 后必须 `pnpm build`**（alpha.1 §9.4 坑 #2：只 install 会停在旧基线产物）。

---

## 6. 风险与待确认项

**R1 · turnTail list 化的分工设计（本次最大工作量）**
file-review 与 coding-sidebar 在 list 下都渲染，需要一次产品级分工拍板：变更文件评审归谁渲染、轨迹/其它 entry 是否保留。建议趁势把「turn 尾部」拆成明确的产品归属，而不是继续两插件各答一遍。

**R2 · 插件管理器 UI 与我们侧栏的关系**
插件管理移入侧栏 Plugins 面板 + 每包一页。我们侧栏是自研 cluster（原生右侧栏已压制）——上游这套 UI 挂在**原生右侧栏**上，被我们压制的壳会不会连带藏掉插件管理入口，需装机实测（§10）；若被藏，评估在自研侧栏补入口或放行该面板。

**R3 · 撞 id 静默丢弃**
用户层 insert 撞已占 id → 丢弃 + boot 打印 conflict。现有 `mcp-` 前缀安全；把「新增 MCP 条目必须带 `mcp-` 前缀」写进 mcp-store 校验（低成本加固，随批次）。

**R4 · resolution mode 默认推进 `link → runtime`**
打包态 spawn 固定 Electron node；alpha.1 的三代模式在 KCoder 实际走哪条需实测确认（起一个打包 runtime `--dump-config` 看解析模式行），无先验风险但属「必须看过」项。

**R5 · 上游桌面链继续加码**
更新流/安装器/Web UI 先行加载与我们无关（不同 appId），但「bundled release-bound workspace runtimes + 独立 Python Office runtime」与我们的 materialize 链目标进一步重合，中期决策点同 alpha.1 R5。

---

## 7. 讨论：新版本「要增加什么」

### 7.1 必做（升级成本内）

1. fork 重建 `kcoder/0.1.6-alpha.2` + 升级仪式七件套 + rebuild
2. file-review / coding-sidebar 的 turnTail list 化（含分工拍板，R1）
3. `--dump-config` overlay 复验 + 打包链 smoke + 装机 GUI 验收
4. （顺手）mcp-store 落盘换原子写 + 新增条目前缀校验（R3）

### 7.2 建议新增（产品价值排序，待拍板）

| # | 候选 | 理由 | 成本 |
|---|---|---|---|
| A | **changed-files 卡片对齐上游语义**（Host git 快照供数） | 上游把「turn 改了哪些文件」做成了可信事实源；file-review 的评审清单可换数据源后大幅简化 | 中 |
| B | **插件加载失败可见化**（读 `pluginFailures`） | 上游 isolated contained-group 把失败集中在该注册表；宿主诊断面板透出即得，替代 alpha.1 §7.2 G 的自研方案 | 低 |
| C | **子代理委托限额设置接线** | 上游已有后端持有 + 设置面；我们只需复核入口可达 | 低 |
| D | **Sidebar Browser 放行评估** | 消息链接进侧栏浏览器 vs 我们「链接进系统浏览器/自研侧栏」的既有行为，需拍板 | 决策 |
| E | **模型目录收缩的用户提示** | V4 Flash 族移出默认目录，设置页模型列表变短；无需代码，验收时确认默认体验 | 低 |

### 7.3 明确不做

- 上游桌面链 / 原生终端（D2 维持禁用）/ 原生右侧栏外壳（D1a 维持压制）——与 alpha.1 §7.3 同。

---

## 8. 建议的落地顺序（供讨论）

```
阶段 0  本分析评审 → R1 分工拍板 / §7.2 取舍
阶段 1  fork 重建 kcoder/0.1.6-alpha.2（tag + merge --no-ff 旧集成，19 文件交集按 §5 处置）
阶段 2  KCoder 升级仪式（BASELINE / UPSTREAM_BRANCH / setup.sh / release.sh）+ rebuild + 定向回归
阶段 3  file-review / coding-sidebar turnTail list 化 → 插件仓发版 → bundle 镜像同步 --check 归零
阶段 4  --dump-config 复验 D2 两行 + resolution mode 实测（R4）+ 打包 smoke（ABI/物化/asar）
阶段 5  提交与发布（沿用 0.6.13 流程；踩坑清单见 alpha.1 §9.4，全部适用）
```

---

## 9. 执行记录

### 9.1 第一批已执行（2026-09-18：fork 重建 + 升级仪式）

**fork 集成分支重建**（尖端 `94cddcf99d` = tag `ddefc45fbc` + 一个 merge 提交，无裸提交；**未 push，按惯例由用户执行**）

- 基于 tag 新建 `kcoder/0.1.6-alpha.2` → `git merge --no-ff kcoder/0.1.6-alpha.1`。19 个交集文件中 15 个自动合并，4 处冲突并集解决：

| 冲突文件 | 解决方式 |
|---|---|
| `apps/cli/src/plugin.ts` | **取上游重写**：alpha.2 把 `dsh plugin` 改为薄委托新 plugin-manager 的 `runPluginCommand`（execa 拉起 pnpm，execa 10 默认 `windowsHide: true`）——我方唯一 delta（黑窗修复单行 `windowsHide: true`）被新架构吸收，无残留必要 |
| `ui-chat/ChatView.tsx` | 并集：上游 `openExternalLink`（解构 + `MarkdownDelegateProvider` 包裹）× 我方 0007 `editUserMessage`（解构 + ChatNodeList 透传）；并集解构行 147 字符超 max-len 140 → 拆两行 |
| `llm-pi-ai/adapter.ts` | 保我方 `randomUUID` / `openAIResponsesApi` 两条 import（函数体仍在用）；`createModels/getSupportedThinkingLevels` 让位上游新本地模块 `./models.ts`（perf：避免聚合 pi-ai 运行时导入；双方 pi-ai 均钉 `^0.85.1`，语义等价） |
| `win32-process/process.spec.ts` | abi 侧保 `CREATE_NO_WINDOW`（我方黑窗修复，src 4 处使用自动合并存活）；ffi 侧用上游新 accessor（`processInformationType/startupInfoType`，裸 `PROCESS_INFORMATION` 导出已被重构掉且合并测试体无引用，不 import） |

- **合并适配 1 处**：`ptc-runtime-python/src/index.ts` 摘除一对 `oxlint-disable/enable typescript/no-unnecessary-condition` 抑制——合并后的全程序类型图下 `settled` 收窄不复现，type-aware lint 判定 Unused directive（按 **error** 拦 pre-commit）；同文件我方另两行 `windowsHide: true` 无问题保留。隔离实验确认该 error 仅在合并树出现（纯净 tag 同命令 0 error）。
- 锁文件 auto-merge 后 `CI=true pnpm install --no-frozen-lockfile` 重收敛（23.5s，无 patch 失配）。

**完整性断言（全绿）**

- 自有提交 `b13e950d94`（0007）/ `facdc190a2`（0006）/ `dd1529d8aa`（win32 黑窗）/ `b88abcad16`（旧集成尖端）均为新尖端祖先 ✅
- 新 delta（tag_a2..HEAD）vs 旧 delta（tag_a1..旧集成）文件集差**恰为 `apps/cli/src/plugin.ts`**（按上述决策取上游）✅
- 上游侧文件零删除（`--diff-filter=D` 为空）✅
- `pnpm run build` exit 0（248 client 产物）；`lib/index.js` 覆盖率 **299/299**；`CI=true pnpm run typecheck` 通过 ✅
- lefthook pre-commit 全绿（修复 max-len 与 lint 抑制后）

**KCoder 侧仪式 + 验证**

- `upstream/BASELINE` 钉版 `ddefc45fbc…` + 追加升级记录；`dsh-contract.ts` / `setup.sh` / `release.sh` 分支名同步（旧名残留仅 BASELINE 历史记录，属应保留）。
- `bash scripts/setup.sh` exit 0（基线包含断言 + vendor 纯净闸 + install + build）。
- **`--dump-config` overlay 复验**（`web --dump-config --patch`，新 contained-group 组装路径下）：`session-log-deepseek → enabled: false`（行 22–25）、`ui-sidebar-terminal → disabled: true`（行 499–501）均覆写；`terminal-controller` 行存活未禁用（api-remotes 静态依赖约束成立）；新行 `ui-sidebar-browser` / `ui-plugin-manager` / `workspace-changes` 均入树；stderr 零警告 ✅
- **Web UI 冒烟**（临时 home，受管后台作业）：`web --patch … --port 0 --no-open`（⚠️ 再次踩到 passThroughOptions 顺序坑，`--patch` 必须在 app 选项之前）→ 就绪行 `dsh web: http://127.0.0.1:<port>/?token=…` 正常；未认证探测 401（BrowserAuth 门禁）；验毕受控停止，零残留进程。
- **定向回归**：`CI=true pnpm vitest run`（ui-chat + llm-pi-ai + llm + session-projection-cache）**82 文件 / 1624 用例全部通过** ✅

**KCoder 提交**：`d6c0692` feat: 升级上游基线 0.1.6-alpha.1 → 0.1.6-alpha.2（本文件 + BASELINE + 分支名三件套）。

### 9.2 下一批待办

| # | 事项 | 性质 |
|---|---|---|
| 1 | turnTail chain→list 适配（file-review 抢占模型重构 + coding-sidebar -1 行），先拍板 R1 分工 | 🔴 必做（本升级唯一硬断） |
| 2 | 推送 `kcoder/0.1.6-alpha.2` 到 fork 远端（pre-push typecheck 门会再跑一次） | 用户执行 |
| 3 | 装机 GUI 验收（§10 清单，重点：turn 尾部当前会双渲染——适配前的已知状态） | 产品验收 |
| 4 | mcp-store 落盘换原子写 + 新增条目 `mcp-` 前缀校验（R3 加固，低成本） | 建议随手 |
| 5 | §7.2 功能候选（B changed-files 数据源 / B pluginFailures 透出 / C 子代理限额 / D Sidebar Browser / E 模型目录收缩提示）取舍 | 产品决策 |
| 6 | 插件仓 devDependencies 上移 alpha.2（同 alpha.1 遗留债，需联网） | 债 |

---

## 10. GUI 验收清单（由用户重启 app 实测）

> 项目惯例：GUI 不由 AI 验证；以下为本次升级的验收点。

**回归基线（D1a / D2 不回退）**
- [ ] 原生右侧栏入口不出现；自研侧栏正常；交付卡/`@` 引用/`/技能` 引用仍进自研编辑器。
- [ ] `cordis.patch.kcoder.yml` 两行生效：请求体无 `dsh_session_log`；无原生终端入口。
- [ ] 启动日志无 `patch: entry ... not found`、无 pluginFailures conflict 打印。

**本版专项**
- [ ] **turn 尾部无重复 UI**：一轮产出文件后，变更评审只出现一份（file-review 或拍板后的归属），无两份卡片。
- [ ] MCP 页保存正常；在插件管理 UI 停用某第三方 bundle → 重启后仍停用（patch 行由管理器写入，mcp-store 未抹掉）。
- [ ] 设置页模型列表为收缩后目录（deepseek-flash / v4-pro），默认对话可用。
- [ ] 消息内链接行为符合 R2/D 拍板结果（侧栏浏览器 or 既有行为）。
- [ ] 插件管理入口可达（若被右侧栏压制藏掉，记录并按 R2 处理）。
- [ ] 启动时长不劣化（上轮钉版本 + prefer-offline 修复继续生效；MCP 层零变化，预期持平）。

---

*本文件为分析产物。§1–§8 结论可由 `git diff 0a15e36e7f ddefc45fbc` 复核；执行记录与 GUI 验收结果回填 §9/§10。*
