# 上游 deepseek-harness 0.1.7-rc.1 → 0.1.7-rc.2 差异分析

> 分析日期：2026-09-24 · 消费形态：KCoder v0.6.16（桌面壳）+ 五个自研内置插件（技能 / MCP / 侧边栏 / 文件审查 / 终端）
> 前置分析：[`upstream-0.1.7-rc.1-analysis.md`](./upstream-0.1.7-rc.1-analysis.md)（含 §8.8 事后补记的「数据缝必检项」）
> 官方发布说明：[`dsh-v0.1.7-rc.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-rc.2)（2026-09-24 21:39 发布）

---

## 0. 一句话结论

**rc.2 是 0.1.7 系列最大的一个版本（224 个非 merge 提交 / 3429 变更文件 / 24.6 小时窗口，提交数是前两版的 2.2 倍），但对 KCoder 的适配面反而是历轮最小的：五个内置插件全部无需升版、注入锚点全存活、数据缝零缺口、零处必须改的产品代码。唯一被我方发现的真实破坏在合并阶段就被抓出并当场修掉（「设置 → 插件管理」tab 会因上游把页面视图状态搬进 slot `store` 而崩）。**

- **好消息（逐条已实测）**：① **兼容门三个源文件逐字节零变化**（blob hash 全同），五个插件在 `0.1.7-rc.2` 下**全部准入**（已用上游同版本 semver + `{includePrerelease:true}` 复现）；② **槽位契约连续第四版稳定**——`ui-slots` 与 `ui-renderer` 本版源码零变化；③ **数据缝零缺口**——rc.1 §8.8 新增的 SOP 必检项本版第一次「按流程走完并且真的没问题」（旧缝 13 处引用全在注释里，实际消费的 6 个缝在 rc.2 **源码与产物双双在位**）；④ **锚点全存活**（16 组 grep 计数逐条核对，含 `railMark`/`brandName`/`sidebarCol`/`turnTail`/`settings.general.item`/`shell.overlay` 等）；⑤ 我方三个内核补丁所在文件（`ui-primitives/src/markdown/parse.ts`、`ui-chat/.../TurnProcessNodeView.*`、`session-projection-cache/src/index.ts`）**上游本版零改动**⇒ 补丁无需重新取证；⑥ 几何门 5 项失败与 rc.1/alpha.2 **逐测试、逐行号、逐计数完全一致** ⇒ **零新增失败**；⑦ staging 产物**反而更小**（24,653 文件 / 144 MB，rc.1 为 25,203 / 146 MB）。
- **坏消息 / 必须记账（7 条）**：
  1. **口径澄清（易误记）**：「Web 和桌面端默认关闭定时任务与时间上下文」描述的是**最终态不是 delta**——rc.1 里这两行**根本不存在**；净变化只是「从缺席、无从开启」变成「在场、默认关、可手动启用」。
  2. **工具描述/系统提示词瘦身是本版最大的未提及变更**：4 个提交、365 文件、**净删 3658 行**，标准预设**首轮提示 7985 → 6551 tokens（−18%）**，且**压缩阈值快照同步下调了 context window**。KCoder 侧无 token/预设 golden（已 grep 确认），但自研工具描述措辞与用户可感行为需按新规则对齐。
  3. **Electron 菜单加速键吞掉上游新快捷键（真实功能缺口）**：KCoder `menu.ts` 的 `CmdOrCtrl+,`（`:87`/`:153`）与 `CmdOrCtrl+N`（`:108`）会被 Electron 在渲染进程之前吃掉，而上游 rc.2 新注册的 `settings.open`（⌘,）与 `session.new`（⌘N）**还会在侧边栏 Tooltip 里宣传它们** ⇒ 用户会遇到「说好的快捷键按了没用」。
  4. **设置弹窗改为 portal 到 `document.body` + 新 `useModalLayer` 焦点模型**：KCoder 的 `inset:48px 0 0 0` 重定位与焦点进入点**必须实机核对**。
  5. **base bundle 的 `llm-deepseek` 行换了包**（id 未变、`name` → `@deepseek-ai/dsh-llm-deepseek-api-key`）并新增 `llm-deepseek-account` 行 ⇒ `--dump-config` 内容 delta（结构不变；KCoder **无 dump 断言**，已实测确认）。
  6. **上游 `apps/desktop` 与 KCoder 的 Electron 壳是两套独立实现**（模块名交集仅 1 个通用名）⇒ 上游桌面修复（安装包启动失败 / 更新提示 / 关窗后台运行 / 原生菜单图标）**不会流入 KCoder**，同类症状须自研。
  7. **一处事实更正**：「代码工作工具」这次改名**是上游自己做的**（`1103c1a7dd`，rc.2 新增提交），KCoder 全仓 `代码工作工具` **0 命中**——此前「我们在 rc.1 轮更名」的说法在代码层不成立。
- **两道天然闸门让 rc.2 大量客户端大改动归零**（重要，解释了「改动巨大但适配面很小」）：`html[data-platform='darwin']`（只由上游桌面的 preload 写入，KCoder 的 dsh UI 窗口**刻意不注入 preload**）与 `'dshDesktop' in globalThis` ——窗口拖拽机制整体重写、`MenuSurface` macOS 背板、`ui-settings-account` 的**全部**账号/额度/Platform 面与桌面首次使用引导，**在 KCoder 中结构性不可达**。
- **唯一真实破坏（合并时发现并修复）**：上游把插件管理页的视图状态从组件内 `useState` 搬进 slot `store`（`PluginManagerPage.tsx:1159` 读 `props.useStore(state => state.view)`），而我方「设置 → 插件管理」的第二处注册**没传 `store`** ⇒ 该 tab 渲染即 `TypeError`。已为该注册补自建 store（沿用上游 `handle.create()` + 复写 `create` 的惯用法）。
- **总账**：346 提交（含 merge）/ **224 非 merge**：fix **117** · test 36 · feat 26 · refactor 14 · docs 14 · chore 4 · revert 3 · build 3 · style 1 · release 1 · 无前缀 5。窗口 **约 24.6 小时**。
- **口径警告（读完再读 diff）**：3429 文件里 **1138 个是 `.i18n.yaml` 翻译配对记录**，由**单个机械提交** `e7def469e1`（+48928/−8947）整体重键；另有 317 个仅版本戳的 `package.json`、285 个 snapshots、118 个设计笔记。**真实代码+测试面约 1538 + 579 文件**。`native/**` 与 `.github/**` 本版**源码零变更**（只有 i18n 记录）。
- **与 rc.1 的量级对比**：rc.1 是 102 非 merge / 933 文件 / 22 h / 合并冲突 1 处；**rc.2 是 224 / 3429 / 24.6 h / 冲突 2 处**。但 rc.1 的适配面（Peer 硬门禁 + 工具调用三态化 + `TranscriptViewMode` 重构）比 rc.2 **更大**——**版本越大不等于适配越多**，适配量由「是否打在我方消费面上」决定，rc.2 恰好没打到。

---

## 1. 对比口径

| 项 | 值 |
|---|---|
| 旧基线（当前消费态） | `46a7f68b09` = 上游 tag **`dsh-v0.1.7-rc.1`**（2026-09-23 21:03，merge PR #5073）· KCoder 集成分支尖端 `a56eabbd02` |
| 新目标 | `477b4f4205` = 上游 tag **`dsh-v0.1.7-rc.2`**（2026-09-24 21:39，merge PR #5180；release 提交 `787b746b80`） |
| 集成分支 | `kcoder/0.1.7-rc.2` @ `a1a2affcab`（= tag + 单次 `merge --no-ff kcoder/0.1.7-rc.1`）。推送前 `git ls-remote origin refs/heads/kcoder/0.1.7-rc.2` **为空** ⇒ 新建分支，**结构上不可能**出现 alpha.2 轮那个「远端分支指着裸 tag、两道断言却全过」的陷阱 |
| 时间窗口 | **约 24.6 小时**（2026-09-23 21:03 → 2026-09-24 21:39） |
| 提交量 | 346（含 merge）/ **224（非 merge）**：fix **117** · test 36 · feat **26** · refactor 14 · docs 14 · chore 4 · revert 3 · build 3 · style 1 · release 1 · 无前缀中文 5 |
| 原始变更面 | 3429 文件 / **+136313 −24518** |
| 剔除纯版本戳提交 | `787b746b80`（`release(dsh): 0.1.7-rc.2`）独占 **317 个 package.json**（各 1 行）→ **3112 真实变更文件** |
| 再剔除文档面 | 其中 **1510 个**是 `.agents/notes` / `docs` / `README` / `.i18n.yaml` ⇒ **代码+测试+快照面约 1602 文件** |
| **口径警告（重要）** | 原始 3429 文件里 **1138 个是 `.i18n.yaml` 翻译配对记录**，由**单个机械提交** `e7def469e1`（+48928/−8947）整体重键（格式从「整文件 blob 哈希」改为「按标题分节哈希」）——占窗口文件数 **33.7%**、插入行数约 **36%**。另 `native/**`（7 文件）与 `.github/**`（2 文件）**全部是 i18n 记录，源码零变更**。**读 diff 前必须先扣掉这 1138 + 285 snapshots + 118 笔记**，否则任何「改动巨大」的判断都是噪声 |
| 真实代码面 | 剔除 i18n/snapshots/docs/笔记后：**1538 文件 +37233 −10934**（另有测试面 579 文件 +44062 −4677） |
| 变更最重的包（代码面） | `ui-schedule` +20449 · `ui-settings-account` +6175 · `ui-primitives` +1434 · `schedule/schedule` +8222/−3127 · `ui-chat` · `ui-conversation` · `ui-sidebar-right` · `llm-deepseek` 族 · `ui-workspace` · `ui-plugin-manager` |
| 新增 workspace 包 | **5 个，零删除**：`client/shortcuts`（+3035）· `client/ui-shortcuts`（+2453）· `llm/llm-deepseek-account`（+422）· `llm/llm-deepseek-api-key`（+348）· `util/code-language`（+552） |
| `vendor/` | **零变化**（本版无 vendor 上抬） |
| 新增 pnpm patch | **无**；仅修改既有 `patches/@fortune-sheet__core@1.0.4.patch`（+8/−2，表格滚动同步） |
| 依赖上抬 | LibreOffice Kit `0.1.0 → 0.1.1`（6 个平台包，`pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 同步） |
| 量级对比 | alpha.2：102 非 merge / 869 文件 / 11 h · rc.1：102 / 933 / 22 h · **rc.2：224 / 3429 / 24.6 h** ⇒ 提交数是前两版的 **2.2 倍**，是 0.1.7 系列**最大的一个版本** |

---

## 2. 集成分支重放（已执行，见 §8.1）

**冲突 2 处**（rc.1 轮为 1 处）：`ui-plugin-manager/src/client/index.ts` 与 `session-projection-cache/README.i18n.yaml`。**两侧交集 13 文件全部自动合并或解冲突成功**，其余 33 个自有面文件上游未触碰。

**重放完整性（理想签名）**：`git diff --name-only dsh-v0.1.7-rc.2 a1a2affcab` = **46 文件**，与「上游 alpha.2 vs 我方 alpha.2」的 46 文件**集合完全相等（`diff` 为空）** ⇒ 合并 = rc.2 + 我方自有面，**零多余、零丢失**。

**语义存活审计（本轮新增的更强断言）**：逐文件比对「我方新增行」在合并树中的存活率——

```
参照面 = git diff dsh-v0.1.7-rc.1 a56eabbd02   （rc.1 轮已验收的自有面）
合并面 = git diff dsh-v0.1.7-rc.2 a1a2affcab
判据   = 参照面的每一行新增，必须逐字出现在合并面里
```

结果：**46 个面文件中 44 个的我方新增行 100% 存活**；仅 2 处缺口，且**正是两处手工解的冲突**——`ui-plugin-manager` 2 行（`inject(...)` 箭头体改箭头块，结构性改写）、`README.i18n.yaml` 2 行（旧格式哈希被新格式取代）。⇒ **零静默语义丢失**（自动合并最容易被吞语义，故本审计列为常规项）。

---

## 3. 官方发布说明逐条 → 代码层核实

> rc.2 的说明是 **rc.1→rc.2 的 delta 口径**（与 rc.1 那版「累积自 v0.1.5-rc.3」不同），已逐条找到提交与代码落点。

### 3.1 新增

| notes 条目 | 提交 | 代码落点 | KCoder 判定 |
|---|---|---|---|
| 定时任务提醒/运行记录/重启保留/最短每分钟 | `7a362b263b` `e896737840` `955a706d33` `5c768e3c8a` | `packages/schedule/schedule/src/{storage,delivery-history,update,domain}.ts`（`persistence/projection/transaction.ts` 被删）· `packages/client/ui-schedule/**` | **需实测**（但 roster 默认 `disabled: true`，见 §4.5） |
| 桌面端首次使用引导 | `93b832f1b0` `82fe79a7b1` `ad86306feb` … | `ui-settings-account/src/client/DesktopOnboarding*.tsx` + `onboarding-state.tsx` + 14 个二进制资产 | **零影响（已实证）**：KCoder 的 dsh UI 窗口刻意不注入 preload，`dshDesktop` 不存在 ⇒ 该插件整体 early-return |
| 快捷键查看/搜索/自定义/恢复 + 侧边栏键位 | `91423ea1b4` `64d401c820` `d6006c5547` … | **新包** `client/shortcuts` + `client/ui-shortcuts`；roster `packages/bundle/web-app/cordis.patch.yml:236,239`（**默认启用**） | **需适配（最高优先）** 见 §4.6 |
| 进行中的对话可直接用新启用的工具 | `bc8c0dbf40` `f6848ee921` `1b0c2e5760` … | `packages/llm/llm/src/*` · `packages/core/agent-loop/src/**` · `packages/core/session/src/**` | **需实测**（涉 agent-loop / 提示历史保留） |
| 自动审阅拒绝后由用户决定 | `409fb145af` `0a134ef94e` | `experimental/auto-review/src/index.ts` · `interaction/permission-presets/**` | **需实测** |
| 关窗后任务继续后台运行、退出前提示 | `4745934683` `e6f135f15c` `5637311d5a` | `apps/desktop/src/{main,quit-confirmation,background-notice,tray}.ts` · `apps/desktop-host/src/{quit-inspection,update-tasks}.ts` | **零影响（不被复用）**：上游 `apps/desktop` 与 KCoder `desktop/` 是两套独立壳，模块名交集仅 1 个通用名（`ipc`），且 web bundle 不引用 `desktop-host` |

### 3.2 修复（择要）

| notes 条目 | 提交 | 落点 | KCoder |
|---|---|---|---|
| Windows 文件菜单图标与应用打开 | `d685383ee6` `f35db51bee` … | `util/native-command/**` · `client/ui-open-in-app` | 需实测（KCoder 有 `open-in-app-button.ts`） |
| 部分桌面安装包启动失败 | `037bed1f41` `0126d5be20` … | `apps/desktop/src/main.ts` · `apps/desktop/scripts/**` | **零继承**——KCoder 若同类症状须自研 |
| 部分插件详情/设置页无法显示插件信息 | `a3480857dd` | `experimental/inspector/src/client/plugin.ts` · `client/ui-plugin-manager/**` | 直接受益（§2 冲突同域） |
| 桌面聊天本地 Markdown 图片可预览放大 | `7f0a53dfb3` `e39b0c307c` | `client/ui-primitives/src/markdown/parse.ts` | 直接受益（**与 0007 补丁同文件**，但 rc.2 该文件上游零改动，见 §4.1） |
| 账号模型可在设置页直接编辑 | `cc478ac70a` `17825ee8c0` `40da69ff75` … | `client/ui-settings-accounts/**` · `ui-model-selection/**` · `credentials/deepseek-account-platform` | 需实测（模型入口） |
| 异常退出/安装中断后插件安装与配置保存持续失败 | `7e7ba139fd` `910711e6c1` | `util/atomic-write/src/**`（接管持有者已退出的 writer lock，PID-only 记录） | 直接受益（**KCoder Windows 现场强相关**） |
| 过长工具输出字符残缺并可能致后续对话失败 | `dc07e5a50d` | `util/output-retention/src/index.ts:456` 新增 `truncateWithoutSplittingSurrogatePair`；三处调用点（bash/pwsh/str_replace） | 直接受益（**纠正**：`maxInlineTokens` 本版**未改**） |
| 部分长对话持续无法发送消息 | `193f9ce413`(#5168) | `llm/llm-deepseek/src/request-extensions.ts`（超大 request extension 阻塞请求） | 直接受益 |
| 切换语言不改默认工作区文件夹名 | `ff1c7d415f` `ce5ef7a17b` | `api/workspace-controller/**` | 需实测（KCoder 有 `home-migration.ts`） |

### 3.3 调整 / 优化（择要）

| notes 条目 | 提交 | 落点 | KCoder |
|---|---|---|---|
| 插件页可启用自动审阅；**Inspector 不再默认提供** | `a3480857dd` | `ui-plugin-manager` · `experimental/inspector`；`OPTIONAL_BUNDLES` 新增 `experimental-auto-review`（进 `apps/cli` 的 **dependencies** ⇒ 进 deploy 闭包） | 需实测 |
| 账号任务与 API Key 任务独立模型入口 | `17825ee8c0` `40da69ff75` | **新包** `llm-deepseek-account`（provider `deepseek-account`）+ `llm-deepseek-api-key`（provider `deepseek-official`）；base bundle 的 `llm-deepseek` 行 **`name` 换包**（id 未变） | 需实测（§4.4） |
| 「代码工作工具」统一控制轨迹/差异/新模式 | `1103c1a7dd`(#5149) `a44534e274` | `ui-settings-general` · `ui-agent-preset` · `ui-trajectory` | **零影响**（§4.7：改名是**上游自己**做的，slot id 未变，我方零 override） |
| Web 与桌面端默认关闭定时任务与时间上下文 | `cad6fef2fd` `374b9cc1fb` | `bundle/web-app/cordis.patch.yml:123,127,372` 三行 `disabled: true` | **零影响（口径已澄清，见下）** |
| 减少标准模式每轮固定提示 token 开销 | `321a6fa740` `ab2f5d3009` `341023a9e7` `8f86c22a9a` | 365 文件**净删 3658 行**工具描述/系统提示词 | **需实测（高优先）** §4.2 |
| 语法高亮更一致并支持更多文件类型 | `6945da14cb` 等 | **新包** `util/code-language` · `ui-primitives/src/markdown/highlight.ts` | 零影响（内部）/ 需实测（预览） |
| 界面圆角/菜单/悬停更统一 | `6000dcdda5` `64352df324` | **新增标准文档** `docs/ui-radius.md` · `client/web/src/base.css` | 需实测（§4.6 锚点） |
| 键盘焦点提示更一致 | `08b310b5a8` 等 8 提交 | `ui-primitives` ring token · `ui-conversation` · `ui-sidebar` | 需实测 |
| 不兼容插件跳过提示每次启动只显示一次 | `c8b10a16be` `0a6de62671` `473f381420` | `boot/app-boot/**`（新 `Profile.skippedBundles` 必填字段 + `reportSkippedBundles` 导出） | **零影响**（§4.3） |
| 中文插件管理与设置页统一用「子智能体」 | `cf8fe108d5` `259534c2c7` | zh locales | 零影响 |
| 折叠的网页抓取卡片可直接点网址 | `61a0ed487e` `b8e30bf599` | `web/tool-web/src/fetch.ts` | 零影响 |
| 审批卡片跟随界面语言 | `12c9dd599e`(#4793) | `interaction/permission-presets/**` | 零影响 |

> **口径澄清（易误记，务必记账）**：「Web 和桌面端默认关闭定时任务与时间上下文」描述的是**最终态，不是 rc.1→rc.2 的 delta**。rc.1 的 `bundle/web-app/cordis.patch.yml` 里 **`time-context` 与 `schedule` 两行根本不存在**（`ui-schedule` 存在且已是 `disabled: true`）；窗口内 `e896737840` 先启用三行，`cad6fef2fd` 再加回 `disabled: true`。**净变化 = 从「缺席、用户无从开启」变成「在场、默认关、插件管理页可手动启用」**，功能面在 rc.1 下同样没有运行。副作用：`--dump-config` 多出三行（内容 delta，结构不变）。
>
> **另注**：notes 里「Agent 帮助用户启用插件和功能的操作指引」在全窗口只对应 **8 行 `SKILL.md` 文本**（`preset/agent-preset/skills/cordis-plugin-development/SKILL.md`），无代码/契约变更——属提示词措辞级。

---

## 4. 发布说明未提及 / 需展开的代码级变更

> 本节是本文的主要交付。rc.2 有大量改动**完全没上 notes**，按对 KCoder 的风险排序。

### 4.1 我方内核补丁面：本版上游零触碰（好消息，已实测）

我方 46 文件自有面里，**上游在 rc.1→rc.2 只碰了 13 个**，且全部是「上游也改同一文件」的邻近改动；其中**并非全部自动合并**——见 §2。关键结论：

- `ui-primitives/src/markdown/parse.ts`（0007 语义并集补丁所在）**上游零改动** ⇒ rc.1 那条「sanitize → 解析 → recover 次序有语义」的约束**原样有效**，无需重新取证。
- `ui-chat/src/client/chat/TurnProcessNodeView.tsx` / `.module.css`（回合运行态深蓝扫光）**上游零改动** ⇒ 补丁存活。
- `session-projection-cache/src/index.ts`（projection-isolate 补丁）**上游零改动**（只有 README/i18n 变了）。

### 4.2 工具描述 / 系统提示词瘦身 —— **本版对 KCoder 风险最高的一条未提及变更**

四个提交、365 文件、**净删 3658 行**：`321a6fa740`(−2537，122 文件)、`ab2f5d3009`(−763，164 文件)、`8f86c22a9a`(−212，71 文件)、`341023a9e7`(−177，8 文件)。

做法：删掉「模型能从调用结果里学到的约束」、把逐参数规则挪进参数描述、删除系统提示词中对工具定义的重复、把 bash/pwsh/fs 的 `sandbox_permissions` 描述**收敛成 `dsh-sandbox` 里的一份**。

**量化（提交信息自带）**：标准预设**首轮提示 7985 → 6551 tokens（−1434，−18%）**；工具 schema 估计 −1548 tokens；系统提示词 −370 tokens。**压缩阈值快照同步下调 context window** 以保持触发位置不变，fixture 迁移到 v4 generation。

**对 KCoder 的影响路径（必须实测）**：① 若 KCoder 侧有预设提示词 / token 预算 / 压缩阈值的 golden 或断言，**必须同批重算**；② 上游同步下调了 compaction 阈值快照的 context window——KCoder 若有同类快照需同批更新；③ 自研插件的工具描述应遵循新规则（`.agents/skills/agent-experience/SKILL.md` 已更新）；④ `sandbox_permissions` 描述被集中，**KCoder 若曾覆盖该描述会冲突**。

### 4.3 boot / profile / 跳过机制：三个提交，KCoder 不可达

- `0a6de62671`：**删除导出** `skippedProfileBundles(profile, manifest)`（全仓零命中）；`generateConfigSchema(binName, profile, …)` → **去首参**（`apps/cli/src/dump-config-schema.ts:38` 同步）；不再调 `readProfileManifest`（`--dump-config-schema` 少了「profile manifest 缺失即抛」的守卫，其单测被删）。**KCoder 全仓无 `@deepseek-ai/dsh-app-boot` import**（只 spawn CLI）⇒ 不可达。
- `c8b10a16be`：`Profile` 新增**必填** `skippedBundles: SkippedBundle[]`；新增导出 `reportSkippedBundles(binName, profile)`；加载循环不再直接打印。**输出通道与文案不变**（仍 stderr、仍 `dsh: skipping profile bundle "<pkg>": <reason>`），只是从「每次加载都打」收敛为「每次启动一次」。`--dump-config` 写 **stdout** ⇒ **KCoder 任何按 stdout 解析的启动前验证不受影响**。
- **overlay 会不会被误判为 skipped？不会，且机制上不可能**：`skippedBundles.push` 只在 bundle 级 resolve/manifest/compat/patch **抛错**的 catch 里，而 KCoder 的四条 overlay 行（`product-policy.ts` 的 `session-log-deepseek` / `ui-sidebar-terminal` / `ui-sidebar-browser` / `ui-deliverables`）是**行级** `disabled`，根本不经过 bundle 循环。两侧 id 集合**交集为空**。
  **反向推论（记账）**：overlay **无法救回一个被跳过的 bundle**——被跳过的 bundle 不产出任何行，overlay 没有可寻址的 id。

### 4.4 模型/供应商层按鉴权方式拆包（未上 notes 的结构性变更）

base bundle 的 `llm-deepseek` 行 **`name` 从 `@deepseek-ai/dsh-llm-deepseek` 换成 `@deepseek-ai/dsh-llm-deepseek-api-key`**（**id 未变**），并新增行 `llm-deepseek-account`。两个新包的 provider id 分别是 `deepseek-official`（API key）与 `deepseek-account`（账号 token）。旧包 `llm-deepseek` 仍在仓内（被 16 个包依赖），但 **bundle 不再挂载它**。

⇒ 对「按 id 寻址」的验证安全；**「按包名寻址」的断言会断**。KCoder 自有代码对三者**零引用**（已 grep），但「会话里模型 provider 的身份来源」变了，需实机确认模型目录与 provider 名称非空。

### 4.5 定时任务：单包 +20449，但默认关

`packages/client/ui-schedule`（72 文件 +20449/−346）是全窗口**最大单包改动**，`schedule/schedule` 的存储引擎被重写（删 `persistence.ts`/`projection.ts`/`transaction.ts`，新增 `storage.ts`/`delivery-history.ts`/`update.ts`）。notes 只有一句「定时任务提醒与运行记录」。

**但三行 roster 全部 `disabled: true`** ⇒ KCoder 侧功能面**零影响**。需要时最干净的开关是 overlay 反向覆盖（补丁层序 `bundle → profile → home → overlay`，overlay 最后应用、同名 key 整份替换），与现有 `ui-sidebar-browser: disabled: false` 同款手法。

> **注**：`apps/cli/config/examples/schedule/cordis.yml` 被**删除**（-12 行），上游理由是「再插一遍会让两个 Host 插件挂载两次」。KCoder 不消费 `config/examples/`；若将来要开这三行，**必须走 overlay**，不要照抄那份已删示例。

### 4.6 快捷键体系：新包 + 抢占 `settings.general.item` + 新 `shell.overlay` —— **KCoder 最高优先适配项**

- 两个全新包：`client/shortcuts`（+3035，命令注册表 + 物理键路由）、`client/ui-shortcuts`（+2453，参考/编辑 UI）。
- roster 两行**默认启用**（`bundle/web-app/cordis.patch.yml:236,239`）。
- `ui-shortcuts/src/client/index.ts:42` 注册 **`settings.general.item`**（`id: 'shortcuts'`，`order: 20`）；`:46` 注册 **`shell.overlay`**。
- **`client/shortcuts` 是硬依赖，不可禁用**：`ui-layout/src/client/index.ts:143`、`ui-sidebar/…:39`、`ui-workspace/…:96`、`ui-sidebar-right/…:82`、`ui-settings-general/…:68` 都 `inject('shortcuts')` ⇒ **若为省事在 overlay 里关掉这一行，侧边栏与布局会直接起不来**（rc.2 新增的启动期耦合，记账）。
- **冲突点一（真实功能缺口）**：KCoder `desktop/main/menu.ts` 的 Electron 菜单加速键 **`CmdOrCtrl+,`（`:87`、`:153`）与 `CmdOrCtrl+N`（`:108`）会吞掉上游新注册的全局键**（`settings.open` = ⌘, 见 `ui-settings-general/…/index.ts:180-186`；`session.new` = ⌘N 见 `ui-workspace/…/shortcuts.ts:87`）。Electron 加速键在渲染进程之前处理 ⇒ 这两条上游快捷键**在桌面壳内不可达**，而侧边栏 Tooltip 会照常宣传 ⌘N / ⌘,（`SidebarRoot.tsx:182-184,244`）⇒ **用户会看到"说好的快捷键按了没用"**。`Cmd+B`（`sidebar.left.toggle`）未被占用，正常。**最小改动**：把菜单的 `CmdOrCtrl+N` 改为「转发到页面内新建会话」或去掉该 accelerator；`CmdOrCtrl+,` 同理（它开的 `openPanel('preferences')` 并非上游设置面板）。
- **冲突点二（视觉/焦点）**：rc.2 把设置弹窗改为 **portal 到 `document.body`**（`SettingsRoot.tsx:60-104`）并引入 `useModalLayer` 统一 Escape/Tab 所有权，新增 `data-shortcut-modal="settings"` / `data-modal-autofocus`。KCoder `settings-page.ts` 的重定位（`position:absolute;inset:48px 0 0 0`）在新的 `body > div.overlay` 宿主下**是否仍贴合**、以及焦点进入点变化（原先打开即聚焦关闭按钮）**必须实机看**。
- **新增卡片的样式面**：KCoder `settings-page.ts:80-89` 用 `[role="dialog"] [data-slot="settings.general.item"] > *` 给**每一行**套 960px 卡片——新加快捷键行会自动被同一套规则命中，**结构上自洽**；风险只在该行是否为 `> *` 单节点（录键 UI 可能更宽）⇒ 实测溢出/滚动。

### 4.6b 两道 KCoder 天然不满足的上游闸门（本轮大量改动因此归零，重要）

rc.2 的客户端大改动有相当一部分落在**两道 KCoder 结构性不可能满足的闸门**之后，这解释了为什么「改动巨大」但适配面很小：

| 闸门 | 写入方 | KCoder 状态 | 因此归零的面 |
|---|---|---|---|
| `html[data-platform='darwin']` | **仅**上游 `apps/desktop/src/preload-platform.ts:11` | KCoder `desktop/main/windows.ts:4` 明示 dsh UI 窗口**刻意不注入 preload**；全仓 `data-platform` **0 命中** | 窗口拖拽机制整体重写（`client/web/src/base.css:43,55,67` + 新 `window-drag/`）、`MenuSurface` macOS 背板、`isDarwinDesktop()` 的 span/button 分支 |
| `'dshDesktop' in globalThis` | 上游 `apps/desktop/src/preload-app.ts` | KCoder `dshDesktop` **0 命中** | `ui-settings-account` 的**全部**账号/额度/Platform 面 + 桌面首次使用引导（`index.ts:43` 首行 early-return，**rc.1 就有同一道闸**） |

> **记账一条上游副作用**（`.agents/notes/implementation/…/2026-09-16-desktop-onboarding.md`）：上游 onboarding 在升级首启会**覆写** `ui-chat.transcriptView` / `performanceUsage` / `ui-settings.enabled`。KCoder 因闸门**不适用**；但**若将来 KCoder 壳补上 `dshDesktop`，这条会立刻变成产品事故**（用户的工作过程档位会被引导流程改掉）。

### 4.7 「代码工作工具」统一（**一处我方表述的事实更正**）

`1103c1a7dd`(#5149) `a44534e274` `5577becafe` `4c4108ef1b`：统一控制轨迹、代码差异与**新任务模式选择**，**原独立模式选择开关移除**，新任务用已保存的默认模式。落点 `ui-settings-general` / `ui-agent-preset` / `ui-trajectory`。

> **事实更正（本轮实地取证推翻此前表述）**：「开发者工具 / 显示用于调试…」→「代码工作工具 / 开启后显示轨迹、本轮代码差异，新对话中的 Agent 预设切换」这次改名**是上游自己做的**（`ui-settings-general/src/client/locales.ts` zh `:31,33` / en `:72,74`），提交 `1103c1a7dd` **不在 rc.1 里、是 rc.2 新增**。KCoder 全仓 grep `代码工作工具` **0 命中**（唯一 `开发者工具` 命中是 `desktop/main/menu.ts:145` 的 Electron 原生 `role:'toggleDevTools'` 菜单项，与应用内设置开关无关）；fork 内 `git log --all -S"代码工作工具"` 只有上游那一条。⇒ **此前「我们在 rc.1 轮把它更名为代码工作工具」的说法在代码层不成立，属误记**；本版我方**零 override、零重复、零语义撞车**。
>
> **锚点安全**：该开关的 slot id **未变**（仍 `id: 'developer-tools'`, `order: 15`）⇒ `settings.general.item` 锚点面零影响。被摘的只有 `ui-agent-preset` 里的独立选择器开关（locales 删 4 键，`enablePickerToSetDefault/Create` → **`enableDevToolsToSetDefault/Create`**）。

### 4.8 其它未提及但值得记账的条目

| # | 变更 | 规模 | KCoder |
|---|---|---|---|
| A | **`ui-primitives` 公开导出被搬走**：`OnboardingSurface` 从 `ui-primitives/src/index.ts:33` 删除（迁至 `ui-settings-account`）；`ui-deliverables/src/client/icons.tsx` 删除，字形并入 ui-primitives（94 个公开 glyph） | +1434/−398 | **破坏性公开 API 变更，notes 未提**。我方 `ui-deliverables` 补丁面需复核（§4.1：该文件上游已改，自动合并成功） |
| B | **`client/web/src/window-drag/` 新模块**（macOS 拖动重写，含 506 行测试） | +314 代码 | 需实测（KCoder 有自绘标题栏与拖动区） |
| C | **plugin-manager 新增 `<profileDir>/.plugin-manager/run.json`**（记 `{pid, grouped}`，原子写 0600，操作前查、finally 删；等待上界 5s） | +385/−83 | **需适配（低优先）**：KCoder 自己的 pnpm 入口不写这个记录 ⇒ 这道保护**对 KCoder 自愈链不生效**，强杀留下的孤儿 pnpm 仍会与上游操作撞车。建议 KCoder 在跑 install 前**只读**该文件（存在且 PID 存活则跳过 + `healLog`），**不写**（避免与上游互相接管） |
| D | `resolver.ts` 错误信息替换改为可重定义 stack | 内部 | 零影响（副产品：模块解析错误文案更可信） |
| E | `patches/@fortune-sheet__core@1.0.4.patch` +8/−2 | 1 文件 | 需实测（若 KCoder 用表格预览） |
| F | `utf-16` 代理对截断修复引入新依赖边 `tool-str-replace-editor → dsh-output-retention` | 1 边 | `verify-package-dependencies` 需接受该新边（本版读数已含） |
| G | `@deepseek-ai/dsh-experimental-auto-review` 进 `apps/cli` 的 **dependencies** + `OPTIONAL_BUNDLES` 扩容 | — | staging 闭包变大（§8.3 实测） |
| H | Python SDK 面新增 `test_account_provider_snapshot.py` + `expected/account-provider-signout.json` | 跨语言契约 | 零影响（KCoder 不消费） |
| I | **新根槽 `shell.quota-notice`（chain）** + `QuotaNoticeHost`（`ui-chat/…/contract/slots.ts:322-328` + 新组件） | +61 行 | 零影响（KCoder 不注册该槽） |
| J | **`ui-deliverables` 的 `present` 工具提示词删掉整句**「Usually select the 1-2 most important deliverables; include more when needed, but at most 4 files…」（`src/index.ts`） | −1 句 | **模型行为面变更，notes 未提**；与我方 `present` 相关产品行为需注意 |
| K | **token 语义翻转**：浅色 `--dsw-alias-bg-document-preview` `750→100`、`--dsw-alias-label-document-preview` `200→700`（文档预览由深底浅字改浅底深字）；`--dsw-specific-menu` **从 `client/web/src/base.css` 迁到 `ui-theme/src/styles/design-platform.css:386-392`**；新增 `--dsw-radius-xs/sm/md/lg/xl/panel`、`--dsw-focus-ring-width/color`、`--dsw-font-family-brand` | 多文件 | 需实测（KCoder 自绘卡片圆角 16px 与新 `--dsw-radius-lg` 数值相同；`--dsw-specific-menu` 迁址后 computed value 需确认） |
| L | `ui-sidebar-right` DOM 契约：**删 `data-sidebar-right-region-nudge`**（同名测试删）、**新增 `data-sidebar-right-occurrence`**；契约新增 `bindCommands` / `refreshShortcut` | +20 契约行 | 零影响（KCoder `style-overlay.ts` 用的是 `data-sidebar-right-expand/-panel`，均存活） |
| M | **`ui-slots` 与 `ui-renderer` 本版源码零变化**（两 tag 只有 README + 版本戳） | 0 | **槽位契约连续第四版稳定** —— 本轮最重要的正面结论之一 |
| N | `ui-conversation` 新增 Escape 停止序列（`stop-shortcut.ts`/`stop-sequence.ts`）+ 新 DOM 属性 `data-conversation-session` / `data-conversation-region` | 新增 | 零影响 |
| O | `ui-primitives/src/OnboardingSurface.{tsx,module.css}` **删除**并从 `index.ts` 导出面移除（迁至 `ui-settings-account`） | 破坏性公开 API 变更 | 零影响（KCoder 与五插件 grep 0 命中），但**属破坏性变更且 notes 未提** |
| P | `ui-workspace` 新增槽 `sidebar.session.row.leading` + 会话行 hover 分段（导出 `SessionRowScheduleOwnerProps`） | +159 | 需实测（KCoder 有侧边栏注入） |

### 4.9 明确「不进 KCoder」的上游改动面

**上游 `apps/desktop`（91 文件 +4821/−339）与 KCoder 的 Electron 壳是两套独立实现**：模块名交集仅 1 个通用名（`ipc`）；`@deepseek-ai/dsh-desktop-host` 无任何消费者，web bundle 也不引用它；KCoder 的 dsh UI 窗口刻意不注入 preload（`windows.ts` 明载「纯浏览器载体」），因此 `dshDesktop` 不存在，上游 onboarding / Platform overlay 等桌面专属面**在 KCoder 中整体 early-return**。

⇒ **两个方向都要记账**：① 上游桌面修复（安装包启动失败、更新提示、关窗后台运行、原生菜单图标）**不会流入 KCoder**，同类症状须自行定位；② 反过来 `packages/client/**` 的内核修复（macOS 拖动、本地 Markdown 图片、focus ring、圆角、归档三态）**会随内核进入**，需实测。

---

## 5. 五个内置插件的升级点

### 5.0 消费面实测（**数据缝验存**——rc.1 §8.8 新增的 SOP 必检项，本版已执行）

方法（与 §8.8 同）：对每个插件，把它消费的上游成员逐个拿到 **rc.2 的源码树与构建产物** 双双验存。判据：可选链调用是静默失败高风险面；**「src 与产物双双 0 命中」即静默失效**（既不进类型检查、也不进兼容门，只会让功能少一块）。

**`dsh-coding-sidebar@1.0.32`**：插件内对旧缝 `subagentsByParent` / `jobsBySession` / `setSubagentCatalogOpen` / `refreshSubagents` 共 **13 处引用全部落在注释里**（记述迁移来源与替代面），**无一处活调用**；它实际消费的 6 个缝在 rc.2 **源码与产物双双在位**：

| 成员 | 插件内引用 | rc.2 源码 | **rc.2 构建产物** |
|---|---|---|---|
| `projectionsBySession` | 8 | 61 | 13 |
| `refreshProjections` | 9 | 16 | 9 |
| `watchRows`（`ctx.jobs` 客户服务） | 7 | 9 | 5 |
| `uiConversation` | 5 | 63 | 46 |
| `selectProducedFiles` | 3 | 3 | 3 |
| `producedForClosing` | 3 | 2 | 2 |
| `subagentsByParent` / `jobsBySession`（旧缝） | 0 活调用 | **0** | **0**（已正确移除，插件不再需要） |

**`dsh-file-review-kcoder@1.0.10`**：`uiConversation` 11/63/46 · `sessionController` 1/33/12 · `typert` 16/359/187 · `argsRaw` 15/69/30 · `producedForClosing` 1/2/2 **全部在位**。`RunningToolCall` 是**类型**（构建后不入 `.js`，故产物 0 命中属正常）——其 **export 行两版逐字相同**，且它经 `@deepseek-ai/dsh-client-ui-conversation/client` 解析的 `ui-conversation/src/client/index.ts` 与 `contract/records.ts` **两版 blob 全同** ⇒ 零破坏。

**`dsh-skills-bundle@1.0.2` / `dsh-terminal@1.1.1` / `dsh-shell-prefs@1.0.1`**：均**不 import 任何 `@deepseek-ai/dsh-*` 契约面**（terminal 仅运行时用 `dsh-subprocess-local`；skills-bundle 是 290 个技能资产 + `entry.js`；shell-prefs 是纯 `client.js`/`entry.js`）⇒ 结构上不在这条风险面内。

⇒ **数据缝面 rc.2 零缺口**。对照 rc.1：rc.1 在数据缝面有**实质改动**（两条列表快照缝被移除，插件静默降级）；本轮该面是**干净的**——这正是 §8.8 那条 SOP 必检项被固化后第一次「按流程走完并且真的没问题」。

### 5.1 结论表

| 插件 | 兼容门 | 锚点 | 数据缝 | **判定** |
|---|---|---|---|---|
| `dsh-coding-sidebar@1.0.32` | 准入 ✓（11 peer） | 全存活 | 零缺口 | **无需升版** |
| `dsh-file-review-kcoder@1.0.10` | 准入 ✓（12 peer） | 全存活 | 零缺口 | **无需升版** |
| `dsh-skills-bundle@1.0.2` | 无 DSH peer | — | 不在面内 | **无需改动** |
| `dsh-terminal@1.1.1` | 无 DSH peer | — | 不在面内 | **无需改动** |
| `dsh-shell-prefs@1.0.1` | 无 DSH peer | — | 不在面内 | **无需改动** |

### 5.3 升级后追加的产品改动：**自有面 46 → 47 文件**（定时任务详情不再开原生右栏）

§2 的重放完整性签名（46 文件 = 集成分支 vs `dsh-v0.1.7-rc.2`）成立于**合并那一刻**。此后为修一条用户实测缺陷，集成分支追加了**第 47 个自有面文件**：

| 项 | 值 |
|---|---|
| 新增文件 | `packages/client/ui-schedule/src/client/index.ts` |
| 改动 | 两处 `openTaskDetail` 统一走新助手：优先 `ctx.get('betterSidebar')?.openTab({type:'plans', meta:{kcScheduleTask:{sessionId,taskId}}})` + `updateTab`；**插件缺席时回落**原来的 `ctx.sidebarRight.openTab(SCHEDULE_TASK_KIND, …)` |
| 动机 | 轮尾卡「打开」会展开**原生右栏列**——该列一展开就在主对话区旁留一大片空白（与 dsh-context 同源，产品要求屏蔽）。数据面与导航面分离：引擎只传身份，任务数据由侧边栏插件经 `schedule` Remote 自取 |
| 代价 | **每次上游升版都要重放这个文件**（它已属自有面，冲突面 +1） |

⇒ **后续轮次的完整性断言应写成 47 文件**（或按「46 + 本条」核对）；`upstream/BASELINE` 已同步记录。

### 5.2 交叉事项（插件相关，但不是插件代码本身）

1. **槽位契约连续第四版稳定**：`ui-slots` 与 `ui-renderer` 本版**源码零变化**（两 tag 只有 README + 版本戳）——这是我方插件注册面最重要的正面结论。
2. **`ui-deliverables` 两处变更**：`src/client/icons.tsx` **被删**（字形并入 ui-primitives，本版共 94 个公开 glyph）；`src/index.ts` 的 `present` 提示词**删掉整句**「Usually select the 1-2 most important deliverables… at most 4 files…」。涉及文件审查的 `selectProducedFiles`/`producedForClosing`（**签名未变**）与 `present` 的产品行为（**模型侧行为变更，notes 未提**）。
3. **`ui-open-in-app` 本版大改**（16 文件 +395/−91：新增 34 项应用目录 `applications.ts`，重写 `OpenInAppAction`/`OpenTargetButton`/controller）。文件审查把自研分体控件作为该子槽的 **fallback** 传入、与 `ui-open-in-app` 独立工作 ⇒ 设计上容忍其变化；但我方注释引用的读取形状（`FileOpenRouteAction.tsx` 一带）已变 ⇒ **建议实机看一次「用其它应用打开 / 显示文件位置」**。
4. **我方 `ui-plugin-manager` 的「设置 → 插件管理」tab 在 rc.2 下会崩**——页面视图状态从组件内 `useState` 搬进 slot `store`（`PluginManagerPage.tsx:1159` 读 `props.useStore(state => state.view)`），而我们的第二处注册没传 `store` ⇒ `props.useStore` 为 `undefined`。**已在合并时修复**（为该注册补自建 store，见 §2），这是本轮**唯一被我方发现的真实破坏**，且它**恰好落在上游本轮修的那条 bug 同域**（release notes「部分插件详情和设置页无法正常显示插件信息」）。

---

## 6. 升级面与依赖

### 6.1 依赖范围

`workspace:*`（DSH）/ `workspace:~`（vendor/native）的约定**不变**；`verify-package-dependencies` **exit 0** —— **72 package(s) match the published dependency policy (5 Client-only, 65 Client/Host, 2 configured Host)**（rc.1 为 70：5 + 63 + 2）⇒ **本版未引入新的范围红灯**。

本版新增的依赖边：`packages/fs/tool-str-replace-editor → @deepseek-ai/dsh-output-retention`（代理对截断修复的副作用）；`apps/cli` 的 **dependencies** 新增 `@deepseek-ai/dsh-experimental-auto-review`（进 deploy 闭包）；`packages/bundle/web-app` 的 runtime deps 从 `{ui-schedule}` 变为 `{ui-schedule, schedule, time-context, client-shortcuts, ui-shortcuts}`。**5 个新包零删除**，`vendor/` 零变化。

### 6.2 本版需要跟着改的清单

| # | 项 | 类型 | 状态 |
|---|---|---|---|
| 1 | 建 `kcoder/0.1.7-rc.2` 集成分支 + 重放 + 冲突处置 | 升级 | **已完成**（§8.1） |
| 2 | KCoder 前置同步 4 处（`dsh-contract.ts` ×2 · `setup.sh` · `release.sh` ×3 · `upstream/BASELINE` 钉版） | 升级 | **已完成**（§8.3） |
| 3 | staging 物化 + vendor 纯净 + 品牌断言 + 运行时冒烟 | 升级 | **已完成**（§8.3） |
| 4 | 五个内置插件的 rc.2 适配 | 插件 | **无需升版**——兼容门全过、锚点全存活、数据缝见 §5 |
| 5 | Electron 菜单加速键让位（⌘, / ⌘N 与上游新快捷键冲突） | 适配（建议） | **待做**（§4.6 冲突点一）——不阻断发版，但用户会看到"Tooltip 宣传的键按了没用" |
| 6 | 读 `.plugin-manager/run.json` 后再跑 install（避免与上游插件管理器并发撞车） | 适配（低优先） | **待做**（§4.8-C） |
| 7 | 设置弹窗 portal + `useModalLayer` 焦点模型变更的实机核对 | 实测 | **待做**（§4.6 冲突点二） |
| 8 | 通用设置页新第 11 张卡（快捷键）的渲染核对 | 实测 | **待做**（§4.6） |
| 9 | 文档更正：「代码工作工具」改名**是上游行为**，非我方改动 | 文档 | **已完成**（§4.7） |
| 10 | `verify-vendor-purity.sh --clean` 对「0 文件空骨架」的误判 | 工具（建议） | **待做**（§8.6） |

### 6.3 与前三版的升级工作量对比

| 版本 | 非 merge 提交 | 变更文件 | 窗口 | 合并冲突 | client 产物 | staging（文件 / tar.gz） |
|---|---|---|---|---|---|---|
| 0.1.7-alpha.2 | 102 | 869 | 11 h | — | 263 | — |
| 0.1.7-rc.1 | 102 | 933 | 22 h | **1 处** | 263 | 25,203 / 146 MB |
| **0.1.7-rc.2** | **224** | **3429**（真实代码 1538） | **24.6 h** | **2 处** | **343** | **24,653 / 144 MB** |

⇒ **rc.2 是 0.1.7 系列最大的版本**（提交数是前两版的 2.2 倍），但由于大量改动落在两道 KCoder 天然不满足的上游闸门之后（§4.6b），**适配面反而很小**：**零处必须改的代码**，只有 2 项建议适配 + 3 项待实测。

---

## 7. 风险与待确认项

| # | 风险 | 判据 | 严重度 |
|---|---|---|---|
| 1 | **peer 三元组悬崖（跨版本结构性风险）** | `^0.1.7-alpha.1` 一族在 `0.1.8-*` 下全 FAIL ⇒ 侧边栏与文件审查**静默消失**（门禁 `disabled: true`） | 高（下一版触发） |
| 2 | Electron 加速键吞掉上游 `settings.open` / `session.new` | 实机按 ⌘, / ⌘N，看是否只触发 KCoder 原生菜单行为而页面无反应 | 中 |
| 3 | 设置弹窗 portal + 焦点模型变更 | 实机打开设置 → 返回按钮焦点、`inset:48px` 贴合、Escape 归属 | 中 |
| 4 | 工具描述瘦身（首轮提示 −18%） | KCoder 侧**无 token/预设 golden**（已 grep 确认），风险主要在自研工具描述措辞与用户可感行为 | 低-中 |
| 5 | 模型 provider 身份链路（`llm-deepseek` 行换包） | 实机「设置 → 模型」目录非空、provider 名称正常 | 中 |
| 6 | `--dump-config` 内容 delta | **无 KCoder 断言**（已 grep），结构不变 ⇒ 仅记账 | 低 |
| 7 | 通用设置页新增卡片渲染 | 实机看快捷键行的卡片包裹是否溢出 | 低 |
| 8 | `--dsw-alias-bg-document-preview` 语义翻转 / `--dsw-specific-menu` 迁址 | 实机浅色主题看文档预览与菜单 computed value | 低 |
| 9 | KCoder 自愈链与上游插件管理器并发（`.plugin-manager/run.json`） | 同时装插件 + 触发 install 回退，看 `plugins-heal.log` | 低 |
| 10 | 上游桌面壳修复**不流入** KCoder | 安装包启动失败/更新提示/关窗后台运行/原生菜单图标须自研 | 记账 |

**建议落地顺序**：① 提交基线同步 + 分析文档 → ② 推送 fork 集成分支（本轮已做）→ ③ **本版先发**（零必须改动，风险 1 与本版无关）→ ④ 下一轮窗口内做 §6.2 的第 5~10 项（建议适配 + 实机核对）→ ⑤ 把「peer 预演 + 数据缝验存 + 锚点计数」三条固化为 CI 断言（§8.6）。

---

## 8. 执行记录

### 8.1 第一批已执行（2026-09-24：fork 集成分支重放 + 构建）

**建分支与重放**：`git checkout -b kcoder/0.1.7-rc.2 dsh-v0.1.7-rc.2` → `git merge --no-ff kcoder/0.1.7-rc.1`。推送前 `git ls-remote origin refs/heads/kcoder/0.1.7-rc.2` **为空**（新建分支）⇒ 结构上避开 alpha.2 轮那个陷阱。

**冲突 2 处**（详见 §2）：`ui-plugin-manager/src/client/index.ts`（语义并集 + 暴露一处**真实破坏**）、`session-projection-cache/README.i18n.yaml`（上游 i18n 记录格式换代，取新格式后按合并后正文重录）。

**完整性断言（理想签名）**：`git diff --name-only dsh-v0.1.7-rc.2 a1a2affcab` = **46 文件**，与参照集 `git diff --name-only dsh-v0.1.7-alpha.2 kcoder/0.1.7-alpha.2`（46 文件）**`diff` 为空** ⇒ 零多余、零丢失。

**语义存活审计（本轮新增）**：46 个面文件中 **44 个的我方新增行逐字存活**；2 处缺口即两处手工解冲突处（结构性改写 + 格式换代）⇒ **零静默语义丢失**。

**依赖重收敛与构建**：`CI=true pnpm install` **exit 0**（29.3 s，lefthook 钩子同步）；`pnpm run build` **整链 exit 0**（`build:native-system → build:lib → build:web`）→ **`build: recorded 343 client artifact(s)`**（rc.1 为 **263**，+80 与新增包面吻合）。

### 8.2 第二批已执行（2026-09-24：失效面回归实测）

| 门 | rc.1 读数 | **rc.2 读数** | 判定 |
|---|---|---|---|
| 定向单测（6 文件：markdown-model-sanitize 12 / plugin-compatibility 62 / session-history-journal 28 / scroll-follow 11 / presentation-policy 6 / chat-view 142） | 261/261 | **261/261** | **逐项同数** |
| `verify-package-dependencies` | exit 0（70 包：5 + 63 + 2） | **exit 0（72 包：5 + 65 + 2）** | 无新增范围红灯 |
| `chat-scroll-contract.e2e.ts` | 9/9 | **9/9** | 一致 |
| `idle-submission-handoff.e2e.ts` | 8/8 | **8/8** | 一致 |
| `seeded-history.e2e.ts` | 15 中 3 失败（429/747/784）+1 skip | **同样 3 项、同三行号** | 一致 |
| `steering.e2e.ts` | 7 中 2 失败（139/465） | **同样 2 项、同两行号** | 一致 |
| **几何门合计** | 5 failed / 33 passed / 1 skipped | **5 failed / 33 passed / 1 skipped** | **零新增失败** |

> 几何门 5 项失败的**唯一新增行**仍是 `+ button "Edit this message and resend"`（我方 0007 的既有漂移）⇒ 按既定决策**保持上游 golden 原样、登记为已知稳定差集、不得对这两个目录跑 `DSH_SNAPSHOT=refresh`**。

**peer 兼容门预演（用上游同版本 `semver` + `{includePrerelease:true}`，判据与 `plugin-compatibility.ts:75` 一致：只查 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*`）**：

| 插件 | DSH peer 数 | rc.2 判定 |
|---|---|---|
| `dsh-coding-sidebar@1.0.32` | 11 | **准入 ✓** |
| `dsh-file-review-kcoder@1.0.10` | 12 | **准入 ✓**（其 `dsh-coding-sidebar >=0.12.0` 是**非 DSH** peer，门禁不看） |
| `dsh-shell-prefs@1.0.1` / `dsh-skills-bundle@1.0.2` / `dsh-terminal@1.1.1` | 0 | 无约束 |

**兼容门三源文件逐字节零变化**（`plugin-compatibility.ts` / `compatibility-preflight.ts` / `profile-compatibility.ts`，连同两侧 spec 的 blob hash 全同）⇒ 本版唯一变化是**输入**（运行时版本字符串 `0.1.7-rc.1` → `0.1.7-rc.2`）。**结构性风险未改善**：`^0.1.7-alpha.1` 一族靠「同 `[0,1,7]` 三元组」放行，上游一进 `0.1.8-*` 即全 FAIL ⇒ 侧边栏与文件审查会在升级当天**静默消失**；该 SOP 必检项必须继续逐版本执行。

**锚点存活核对（我方注入面，逐条对 rc.1/rc.2 两树 grep 计数）**：**全部存活，零处必须改**。

| 锚点 | rc.1 文件数 | rc.2 文件数 |
|---|---|---|
| `railMark` / `brandName` | 3 / 5 | 3 / 5（同） |
| `sidebarCol` / `centerCol` | 5 / 43 | 5 / 44 |
| `overlayLayer` / `navCell` | 2 / 2 | 2 / 2（同） |
| `turnTail` / `conversation.chat.turnTail` | 18 / 14 | 24 / 20 |
| `composer-overlay` / `toBottomSlot` | 4 / 2 | 4 / 2（同） |
| `selectProducedFiles` / `producedForClosing` | 3 / 2 | 3 / 2（同，**签名未变**） |
| `settings.general.item` / `sidebar.panellist` | 31 / 11 | 34 / 14 |
| `shell.overlay` · `deliverables.file.actions` | 25 · 12 | 50 · 12 |

逐条更细的核对（含 `data-*` 属性、slot 名、`_header`/`_titleRow`/`_overlay`/`_options` 等 CSS Module 类、23 个 `--dsw-*` token）结论一致：**KCoder 使用的锚点无一条消失**；两处**既有死锚点**（`settings.plugin.item` 与 `data-sidebar-right-float-host`，两版都不存在）与本版无关。`ui-chat/src/client/chat/TurnProcessNodeView.tsx` / `.module.css` / `ChatView.tsx` / `ChatNodeSeat.tsx` 上游本版**零变化**，我方扫光补丁原样成立、一行都不用改。

**页头面**：`ConversationHeader.tsx` 本版唯一改动是 `<header>` 加 `data-window-drag`（`:18`，仅 darwin 生效）；`ConversationSession.tsx` 只改注释，`data-conversation-tabs` 保留 ⇒ **`smoke-workspace-header.mjs` 断言仍成立**。被删的 `ConversationMarker` / `data-shell-leading-band` / `.leadingBand` 我方 grep **0 命中**。

**工作过程档位**：`ui-chat/src/chat-settings.ts` 两版**逐字节相同**（`:12` 四档、`:32` 默认 `standard`、`:64` `.loose()`；legacy `expanded→detailed` 映射不变）⇒ rc.1 轮定的档位口径**继续有效**。

**重放未吞上游新面（显式复核）**：合并树上 `shell.quota-notice`（12 文件）、`QuotaNoticeHost`（4）、`stopShortcut`（3）、`data-turn-running`（3）、`dsh-kcoder-turn-status-shimmer`（1）**全部在位**。

**`--dump-config` 第一手实测**（rc.2 合并树 + 全新 `DSH_HOME`，`node apps/cli/lib/bin.js web --dump-config`）：**exit 0 / 1246 行 / stderr 完全为空**（无任何 skipped-bundle 行 ⇒ 无 bundle 被跳过、无插件被禁用）。七行 delta 与预测**逐行吻合**：

| 行 id | 实测 |
|---|---|
| `time-context`（:445） | 存在，`disabled: true` |
| `schedule`（:448） | 存在，`disabled: true` |
| `ui-schedule`（:575） | `disabled: true`（同值） |
| `shortcuts`（:504） / `ui-shortcuts`（:506） | 存在，**启用** |
| `llm-deepseek`（:402） | **id 未变，`name` = `@deepseek-ai/dsh-llm-deepseek-api-key`** |
| `llm-deepseek-account`（:404） | 存在，**启用** |

**KCoder 无 `dump-config` 断言**（`grep -rn 'dump-config' scripts/ desktop/ .github/` 仅命中 `dsh-manager.ts:137` 的一条注释）⇒ 结构不变 + 无断言 = **零影响**（内容 delta 已记账）。

### 8.3 第三批已执行（2026-09-24：KCoder 前置同步 + staging 物化）

**前置同步 4 处（功能引用点全覆盖）**：`desktop/main/dsh-contract.ts` 的 `UPSTREAM_BRANCH` 常量 + 文档注释（2 处）· `scripts/setup.sh`（1 处）· `scripts/release.sh`（3 处）· `upstream/BASELINE` 钉版 SHA → `477b4f420553e8a52c2fbccc464d7561b239c443`（= tag `dsh-v0.1.7-rc.2`）+ 追加本版升级记录。KCoder `pnpm run typecheck` **exit 0**（含 20 个注入脚本零悬空引用检查）。

**staging 物化收口**：`pnpm --dir <fork> --filter=@deepseek-ai/dsh deploy --prod --legacy staging/kcoder-runtime` **exit 0** → 产物 `package.json` 版本 **0.1.7-rc.2**；`scripts/materialize-peers.mjs` → **24,653 文件 → tar.gz 144 MB**（rc.1 为 25,203 / 146 MB），目录 **498 MB**（rc.1 为 535 MB）——**闭包增大但产物体积反而缩小**（`materialize-peers` 本轮删掉 18,113 个 `.map`/`.d.ts`，并新签 17 个实体）；`self-check` 通过（所有非可选依赖可达且版本满足）。

**vendor 纯净**：`verify-vendor-purity.sh --clean` 报 `vendor/KCoder` 含"真实文件"——**复核为已知误判**：该骨架实测 **0 文件 / 0 字节 / 6 个空目录 + 2 个悬空符号链接**（指向仓外 `KCoder/staging/…`），`rmdir` 因非空而拒删。手工 `rm -rf vendor/KCoder` 后重跑 **`vendor/ 全部条目在白名单内` ✓**，fork 工作树仍 `dirty 0`（`vendor/` 不入库）。⇒ 该误判仍是待修项（见 §8.6）。

**品牌断言**：`brand-assert.mjs` ✓（`chat.deepDiving = KCoder...`）。
**运行时冒烟**（Electron node 形态，真实起服）：✓ **就绪行 + 首页 200**（`http://127.0.0.1:58103/`）。

### 8.4 fork 推送与远端核对

推送受阻一次并已处置：fork 的 `pre-push` 钩子跑 `pnpm run typecheck` 时，pnpm 的 `verify-deps-before-run` 判定 `node_modules` 与 lock 不同步（**`deploy --prod` 之后的必然残留**，本陷阱已第三次复发），自动 `install` 因无 TTY 中止（`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`）。既定处置 `CI=true pnpm install` 后重推成功。

```
 * [new branch]            kcoder/0.1.7-rc.2 -> kcoder/0.1.7-rc.2
summary: ✓ typecheck (16.19 seconds)
```

**远端核对（防 alpha.2 轮那个「远端指着裸 tag、两道断言却全过」的陷阱）**：

| 检查 | 结果 |
|---|---|
| `git rev-parse kcoder/0.1.7-rc.2` ＝ `origin/kcoder/0.1.7-rc.2` | ✓ 一致（`a1a2affcab`） |
| 远端是否含 rc.2 tag | ✓ `dsh-v0.1.7-rc.2` 是祖先 |
| 远端 ≠ 裸 tag（我方提交在位） | ✓ |
| 我方标记物在远端树 | `dsh-kcoder-turn-status-shimmer` 1 文件 · `data-turn-running` 3 · `recoverLocalImages` 2 —— 全部 present |
| ahead / behind | **0 / 0** |

> 注：`kcCtxJumpViaTab` 是 **KCoder 侧**的 profile 补丁标记（`profiles/web/patches/dsh-context@0.55.0.patch` + `profile-patches.ts`），不在引擎 fork 树里，故此处 0 命中属预期。

### 8.5 §6.2 清单收口

| # | 项 | 状态 |
|---|---|---|
| 1 | 集成分支 + 重放 + 完整性断言 + 语义存活审计 | **完成** |
| 2 | KCoder 前置同步 4 处 + KCoder typecheck | **完成** |
| 3 | staging 物化 / vendor 纯净 / brand-assert / smoke-runtime | **完成** |
| 4 | 五个插件适配判定 | **完成**：全部无需升版（§5） |
| 5 | 重放完整性 46 文件集合相等 | **完成** |
| 6 | peer 门禁预演 + 数据缝验存 + 锚点计数 | **完成**（三条 SOP 必检项全部执行） |
| 7 | `--dump-config` 第一手实测 | **完成**（exit 0 / 无 stderr / 七行吻合） |
| 8 | Electron 加速键让位 / `.plugin-manager/run.json` 让位 / 设置弹窗焦点实测 / 新卡片渲染实测 | **待做**（§6.2 第 5~8 项；不阻断本版） |

### 8.6 遗留与待办

1. **peer 三元组悬崖（跨版本，最高优先）**：`^0.1.7-alpha.1` 一族在 `0.1.8-*` 下全 FAIL ⇒ 侧边栏与文件审查**静默消失**。建议在本轮窗口内把两个插件的 DSH peer 范围改成**含 prerelease 的开放上界**（如 `>=0.1.7-alpha.1 <0.2.0`）——这是一次性消除该风险，而不是每版本重新预演。另：**禁止**写 `^0.1.7` 这类裸 minor。
2. **三条 SOP 必检项建议固化为 CI 断言**：① peer 预演（用引擎自带 semver + 目标运行时的取值）；② 数据缝验存（插件消费成员在目标 tag 的 **src 与产物**双双非零）；③ 锚点计数（我方注入锚点文件数不减少）。三条都已在 rc.1/rc.2 两轮**人工执行过**，脚本化即可自动拦回归。
3. **`verify-vendor-purity.sh --clean` 的空骨架误判仍未修**（第二次遇到）：`vendor/KCoder` 是 0 文件 / 0 字节的空目录树 + 悬空符号链接，脚本按「非空即拒删」报错，需人工 `rm -rf`。建议在 `--clean` 分支加一条：**递归删除空目录后若树已空则整体删除**（`find <dir> -depth -type d -empty -delete`），或显式识别「仅含空目录与悬空链接」的骨架为可回收。
4. **`.plugin-manager/run.json` 并发面**（§4.8-C）：KCoder 的 install 回退不写该记录，与上游插件管理器的操作可能撞车；建议实现「跑 pnpm 前只读该文件、PID 存活则跳过」。
5. **上游桌面能力不流入**（§4.9）：若 KCoder 出现安装包启动失败、更新提示、关窗后台运行、原生菜单图标类症状，**必须自行定位**，不要指望随基线继承。
6. **`ui-deliverables` 的 `present` 提示词删句**（§5.2-2）需产品侧确认是否与我方交付物选择体验一致。
