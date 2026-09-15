# 上游 deepseek-harness 0.1.5-rc.2 → 0.1.6-alpha.1 差异分析

> 分析日期：2026-09-15 · 仅分析，未改动任何代码
> 消费形态：KCoder v0.6.12（桌面壳），上游 fork = `kkutysllb/deepseek-harness`

---

## 0. 一句话结论

**这是一次"客户端体验大版本 + 两条新原生体系（右侧栏/终端）+ 一次隐私默认值翻转"的升级，而不是契约破坏性升级。**

- **好消息**：slot 注册表（`ui-slots`）、布局（`ui-layout`）、左栏（`ui-sidebar`）**源码零改动**；Session 格式版本**仍是 3**；我们全部注入锚点存活。
- **坏消息**：① 上游原生"右侧栏 + 终端"这次变成了**其它核心插件的硬依赖**（`ui-chat` 等直接 `inject: ui-sidebar-right`），想摘掉不是"不挂载"那么简单；② `ui-primitives` **删除了 `IconSendOutline16`**，我们的 `dsh-coding-sidebar` 编译会直接断；③ **会话日志上传默认值从 `false` 翻成 `true`**（隐私面）。
- **总账**：800 提交 / 3942 文件 / +784113 −47018（代码面 2787 文件，其余是 `.agents/notes` 与 `snapshots/` 录制）。

---

## 1. 对比口径

| 项 | 值 |
|---|---|
| 旧基线（当前消费态） | `fb2c4b9e698e30edb738bca4cf0618587db7d203` = 上游 tag `dsh-v0.1.5-rc.2`（2026-09-10 21:50） |
| 当前集成分支 | `kcoder/0.1.5-rc.2` 尖端 `1fc823f08d`（= 基线 + merge `fix/win32-console-window-hide`） |
| 新目标 | `0a15e36e7f82b6ed45af6fa9759f29b40dcd965d` = 上游 tag `dsh-v0.1.6-alpha.1`（2026-09-15 10:42） |
| fork master 现状 | HEAD `0d1f50007f`（已越过 tag 5 个提交；master 仍是官方纯净镜像） |
| 提交量 | 800（非 merge 550）· fix 194 / test 133 / docs 72 / **feat 67** / refactor 47 |
| 文件量 | 3942（含 notes/snapshots）· 代码面 2787 |
| 变更最重的包 | `llm-deepseek`(58) `ui-conversation`(48) `ssh`(35) `api-session-controller`(35) `ptc-runtime-node`(33) `ui-sidebar-documentpreview`(31) `subprocess-local`(29) `ui-sidebar-terminal`(29) |

---

## 2. 上游新增功能（按域）

### 2.1 右侧栏体系（**上游原生，我们决定不用**）

- 新增包 **`@deepseek-ai/dsh-client-ui-sidebar-terminal`**（29 文件）+ **`@deepseek-ai/dsh-api-terminal-controller`**（22 文件）。
- web-app 组合新增三行：`terminal-controller`、`ui-sidebar-terminal`、`ui-settings-unarchive-sessions`。
- 终端五连发（feat）：交互式侧栏终端 → 选择并记住 shell → 跟随应用主题/光标对比度 → 从 provider guide 菜单启动终端 → 面板对齐/快照恢复。
- `ui-sidebar-right` 契约扩展：
  - 新 slot **`sidebar.right.tab.guide.entry`**（keyed / session / `SidebarRightGuideEntryOwnerProps`）
  - `SidebarRightGuideEntry` 增必填 `id`；`SidebarRightGuideBox` 增 `providerId`；`SidebarRightTabDefinition` 增可选 `multiple`（同 kind 多实例）
  - 注册表校验 guide entry id 去重
- `ui-sidebar-files`：切换 tab 恢复文件树滚动位置。

> 注：`ui-sidebar-right` 本体是 0.1.5-rc.1 引入的（我们现基线**已挂载**）；0.1.6 是**加深耦合 + 加壳**。

### 2.2 引擎 / 运行时

| 变化 | 说明 |
|---|---|
| **profile 解析三代模式** | `link`（普通 Node 默认，保持落盘 symlink 行为）/ `runtime`（pkg 与 Electron Host 强制，进程内 ESM+CJS resolver 注入，**不再落盘**）/ `dual`（对照）。新增 `ctx.pluginPackages` 服务、`app-boot/src/profile-resolution/`、Worker 代际继承。CLI 增 `resolutionMode` 参数。 |
| **Cordis Loader 回退为非事务** | 回滚 #932 五个提交：**插件加载失败不再自动回滚**，可能留下半生效插件树。消费方必须自己审计（"await Loader.create() 不等于激活成功"）。 |
| **code-runtime → PTC Node 运行时** | 删包 `code-runtime-worker-thread`；新增 `ptc-runtime-node`，Node 程序在受限进程内执行（landlock/seatbelt 沙箱），PTC 术语体系统一。 |
| **e2b 整线移除** | 删 `packages/e2b`。 |
| **SSH 体系** | 新增 `packages/ssh/ssh` + `packages/ssh/fs-ssh`，远端进程树清理与流鉴权。 |
| subprocess 控制管道 | managed 启动带双工控制管道，前台超时/异步受限失败测试补齐。 |
| 启动失败分级 | `feat(boot): distinguish required startup failures` + 消费方自有启动严格性。 |

### 2.3 会话与持久化

- `SESSION_FORMAT_VERSION` **保持 3**（无迁移链改动）✅
- **新契约：插件自有的 message projection** —— `@messageProjection` 标记 + `ctx.sessions.registerMessageProjection()`；缺失解释器会拒绝 append / restore / fork；投影事件不得同时声明 surface operation。首个消费者是 `compaction-image-offload`。
- **durable image offload**（新包 `compaction/compaction-image-offload`）：图片卸载决策作为可重放事件，不替换消息节点。
- `feat(attachment-local): move request images into shared cache` + `dshCachePath`。
- 归档会话恢复：`WorkspaceRegistry.unarchiveSession` + `@Remote('unarchiveSession')` + `IWorkspaces/UiWorkspace.unarchiveSession`，配套新设置页 `ui-settings-unarchive-sessions`。
- 同步读取弃用：`deprecate-synchronous-session-event-reads`。

### 2.4 模型层

- 新增 **DeepSeek Anthropic Messages 适配器**；默认 provider 改用 Messages（Files 等价 parity），Web 侧保留 Chat Completions 配置面；`deepseek-v41` catalog 同步；历史内 system prompt 更新支持。
- 默认模型仍是 `deepseek-official / deepseek-flash`。
- pi-ai 线在本窗口未再换代（仍 0.85.x 族）。

### 2.5 权限与安全

- 新增 **实验性 Auto review**（`packages/experimental/auto-review`）：每次工具调用前一次模型审查，low 放行 / medium 需显式授权 / high 拒绝；与 Full access 共用 `danger-full-access + never` 旋钮，独立 `permission/preset:auto` 身份。**默认组合不含它**，需显式安装。
- composer 新增 **`conversation.input.permission`** slot（权限选择从骨架组件改为 slot）。
- `fix(permission)` 一串：目录读取失败可重试、只在真实代际变化时打勾、撤销过期 Auto 选择。

### 2.6 MCP / 扩展生态

- 新包 **`mcp/mcp-resources`**：三个共享工具（列资源 / 列模板 / 读 URI）+ 每服务器作用域 system-prompt 指令段；MCP 服务器不再必须提供 tools。
- MCP 客户端改用官方 SDK 做现代协议协商。
- 插件清单新增作者元数据：`dsh.manifestVersion`(1) / `dsh.categories` / `dsh.engines.dsh`。**仅类型声明，安装器与加载器均不强制**。

### 2.7 客户端 UI / 体验优化（多数零成本随基线获得）

- **Think / compaction 代码头滚动吸顶**（sticky），修 compaction 横幅被钉住头部遮挡。
- **composer 命令菜单重做**：Add / Commands 两个分区、图标、左对齐标题 + 右对齐描述、中文本地化可搜、中文 claim token（`/计划`）、**纸夹按钮并入菜单 File 行**（菜单取代独立回形针按钮）；`/model` 行免重注册即可本地化。
- **composer 引用（@）预览走侧栏**：文件与 skill 引用在右侧栏预览；skill 引用有 pending/linked 状态。
- **轨迹页**：PTC 代码查看器、JSON 字符串包装偏好记忆、展开字符串按原文显示、折叠图标、中文角色列收窄、turn/序数步标题、时间来源从概览移出。
- **chat 呈现**：reasoning-only 输出默认展开（随后 `fix(chat): restore collapsed thinking by default` 部分回退，最终态按 settled 折叠）；turn 时长标签增加"小时"。
- **交付物卡片**：点击/内联代码引用改为**在右侧栏预览**（不再直接调系统默认程序打开）；文案统一为 `presented.previewButton`。
- diff 卡片渲染真实变更 + 上下文 diff 计算量收敛；markdown 表格 hover 高度稳定；连接指示器状态与重连文案精简。
- 文档站新增全屏 Mermaid 查看器。

### 2.8 打包 / 发布

- **上游自带 Electron 桌面链**：`apps/desktop`（77 文件，+4612 −2238）+ `apps/desktop-host`，构建期物化生产依赖图随包分发；外部插件必须把宿主共享包声明为 peer，校验拒绝不兼容/嵌套/别名副本。`feat(desktop): run runtime host from asar`。
- 实验包全量发布 + 私有 denylist 机制。
- macOS 并行公证、CI 加速。

---

## 3. 核心契约层变更（**决定我们要改什么**）

### 3.1 稳定（零改动，可放心）

| 契约 | 状态 |
|---|---|
| `ui-slots` 注册表 API | 仅 package.json / README 变化 ✅ |
| `ui-layout` / `ui-sidebar` 源码 | 零改动 ✅ |
| `conversation.chat.turnTail` slot（chain/session/`TurnTailOwnerProps`） | 定义零改动 ✅ |
| `SESSION_FORMAT_VERSION` | 仍 3 ✅ |
| `settings.plugin.item` keyed 契约 / `settings.section` | 零改动 ✅ |
| KCoder DOM 锚点 | `data-composer-card`、`data-conversation-scroll`、`data-conversation-composer-overlay`、`toBottomSlot`（`ChatView.module.css:174`）、`data-slot="conversation.session"`、`railMark/brandName` 全部存活 ✅ |

### 3.2 断点清单（按影响等级）

| # | 契约 | 变化 | 命中我们的谁 | 等级 |
|---|---|---|---|---|
| 1 | **`ui-primitives` 图标** | **删除 `IconSendOutline16`**，新增 `IconPaperPlaneOutline14`/`IconWrapLinesOutline16`/`IconPlanOutline14`/`IconCompactOutline16`/`IconShieldOutline16` | **`dsh-coding-sidebar`**（`SidecarView.tsx:30/646` 直接 import）→ **编译即断** | 🔴 硬断 |
| 2 | **`ui-chat` 硬依赖原生右侧栏** | `package.json` 的 `dsh.client.inject` 含 `@deepseek-ai/dsh-client-ui-sidebar-right`；`apply.ts` 里 `openFile` 直调 `ctx.sidebarRight.openResource(...)`，**无 fallback** | 任何"禁用 `ui-sidebar-right`"的设想 | 🔴 架构级 |
| 3 | **`ui-deliverables` 预览语义** | `ChatFileMentions.forClosing(owner, sessionId)` → **`forClosing(owner)`**；交付路径改走 `owner.openFile`（侧栏预览）；删除 locale key `presented.open`（"在默认程序中打开…"），统一 `presented.previewButton` | `dsh-file-review-kcoder`（声明自己"claim 内置 deliverables turn data"）、KCoder 的桌面"用系统程序打开"链路 | 🟠 高 |
| 4 | **`ui-conversation` composer 重构** | 新增 slot `conversation.input.permission`；**删除 `ComposerBarInjected.command`**；`ComposerKeyboard`/`EditSelection` 迁到新 `contract/draft-editor.ts`；删组件 `PermissionSelect.tsx/.module.css`；编辑器重写为 `DraftEditor`+`view-binding`；`contract/context-provenance.ts` → **`context-producer.ts`**（改名） | composer 注入链 / `style-overlay` 的权限选择器类名锚点 / 深类型 import | 🟠 高 |
| 5 | **`ui-chat` 客户端注入面** | `ChatNodeOwnerProps.openSkill`（**必填，新增**）、`ChatViewInjected.openSkill`（**必填，新增**） | 任何自造 chat 注入对象的测试/插件（我们主要是接收方，成本低） | 🟡 中 |
| 6 | **`ui-reference` / `ui-skill` 新入 `sidebarRight` 消费群** | 0.1.6 新增两个消费方；引用预览默认落原生右侧栏 | `dsh-coding-sidebar` 的拦截面（已有 `openpath-intercept.ts`，需覆盖新流量） | 🟡 中 |
| 7 | **Cordis Loader 非事务化** | 插件激活失败不再回滚，可能留半生效树 | 插件管理页 UX / `profile-patches` 自愈链 / 预置物化 | 🟡 中 |
| 8 | **`session-log-deepseek.enabled` 默认 `false → true`** | 每次 DeepSeek 请求上报完整未接受会话日志后缀（消息正文、工具参数与结果、工作区路径、反馈） | **隐私面**：KCoder 继承即默认开启 | 🟠 高（产品决策） |
| 9 | `ui-sidebar-right` 契约扩展 | 新 slot `sidebar.right.tab.guide.entry`；`id`/`providerId`/`multiple` | 仅在我们真要往原生侧栏注册 tab 时相关 | 🟢 低 |
| 10 | 插件清单元数据 | `manifestVersion`/`categories`/`engines.dsh`（**不强制**） | 可选：给我们四个内置 bundle 补声明 | 🟢 低（机会） |
| 11 | profile 解析模式 | `link`/`dual`/`runtime`；CLI 新参数 | KCoder 走普通 Node 启动 → 默认 `link` 行为不变；`--no-open` 门保留 | 🟢 低 |
| 12 | 包版本戳 | 全 `@deepseek-ai/*` `0.1.5-rc.2` → `0.1.6-alpha.1` | **四个内置插件的 peer/dev 版本键**必须同步 | 🟠 高（机械但广） |

---

## 4. 内置插件逐个适配清单

### 4.1 `dsh-coding-sidebar`（bundle 1.0.12 / 真源仓 1.0.15）

**现状（关键发现）**：它**已经是拦截式接管**，不是平行实现——
`src/client/openpath-intercept.ts` 头部明确写了三道门：
1. `ctx.workspaces.openPath`（0.1.2 前，已死，保留无害）
2. `ctx.remote.session.openWorkspacePath`（0.1.2-alpha.1，chat 已不再调用）
3. **`ctx.sidebarRight.openResource`（0.1.5 起，当前唯一有效门）**

即：**上游 `sidebarRight` 服务保留在树上，我们把它的 `openResource` 包一层，把打开动作重定向进自家编辑器/资源管理器**——"不改上游一行"。

→ 0.1.6 的适配等于**把同一个拦截面扩到新增流量**（`ui-reference`、`ui-skill`、交付卡预览语义变化），而不是重做。

必做项：
- [ ] **图标改写**：`IconSendOutline16` → `IconPaperPlaneOutline14`（或仓内自持图标，防下次再被改）
- [ ] peer/dev 版本键 `^0.1.5-rc.2` → `^0.1.6-alpha.1`（`dsh-invariants` 同步）
- [ ] 复核 `./invariant` 子路径（0.1.5-rc.1 已从 `ui-slots` 移除的历史遗留排查）
- [ ] 拦截面覆盖：`ui-reference` / `ui-skill` 的 `dsh-resource://` 地址族、`openSkill` 路径
- [ ] 与上游 `ui-sidebar-right` **外壳共存策略**确认（见 §6 决策 D1）

### 4.2 `@kkutysllb/dsh-terminal`（1.0.1）

- 与上游新 `terminal-controller` **天然撞车面**：路由前缀不同（我们 `/dsh-terminal/api/*`，上游走 Typert Remote `terminal-controller`），但都在同一右侧栏/底栏语义位。
- [ ] 显式禁用上游 `terminal-controller` + `ui-sidebar-terminal` 两行（否则双终端入口）
- [ ] peer 版本核对（其 package.json 无 `@deepseek-ai/*` peer，风险低）
- [ ] 复核 `ui-sidebar-terminal` 移除后 `ui-sidebar-right` 的 guide 页/菜单是否残留空位

### 4.3 `dsh-file-review-kcoder`（1.0.3）

- 它的 `turn-deliverables.ts` 是**自有拷贝**（mirror 内置 `presentedForClosing`），不 import 内置实现 → 内置签名改动**不直接编译断**，但**语义必须跟上**：
  - [ ] "预览"语义从"系统默认程序打开"改为"侧栏预览" —— 与 coding-sidebar 重定向一致；否则交付卡点击与内联引用行为分叉
  - [ ] `presented.open` locale key 已从上游删除 → 我们自定义文案不要回引
  - [ ] `chatFileMentions` 若参与，签名收窄为单参
- [ ] peer 范围 `>=0.1.0-rc.5 <0.2.0` **恰好覆盖 0.1.6** ✅ 无需改
- [ ] 复核 `ui-chat` 的 `openSkill` 新增必填 prop 是否影响其自造注入对象

### 4.4 `dsh-skills-bundle`（1.0.1）

- 无 `@deepseek-ai/*` 依赖，仅 `ctx.skills` 注册面 → **预期零改动** ✅

### 4.5 镜像同步债

- `dsh-plugins/dsh-coding-sidebar` 已是 **1.0.15**，KCoder `bundle/` 仍是 **1.0.12** → `scripts/sync-bundles.mjs` 对账会红。新版本发版前必须同步（`--check` 归零）。

---

## 5. 升级仪式改动面（与上次 0.1.5 升级同形）

| 落点 | 现值 | 需改为 |
|---|---|---|
| `upstream/BASELINE` | `fb2c4b9e…` | `0a15e36e7f…`（或 fork 集成分支基础提交） |
| fork 集成分支 | `kcoder/0.1.5-rc.2` | 新建 `kcoder/0.1.6-alpha.1`（= 新 tag + 依次 merge 修复分支；**不要 reset 旧分支**） |
| `desktop/main/dsh-contract.ts` `UPSTREAM_BRANCH` | `kcoder/0.1.5-rc.2` | `kcoder/0.1.6-alpha.1` |
| `scripts/setup.sh` / `scripts/release.sh` | 同上 | 同上（两处分支名断言） |
| 修复分支重放 | `fix/win32-console-window-hide` 等 | 基线跨度小（5 天），大概率直接 merge；重放按 FORK-WORKFLOW 规则 6 |
| `profile-patches` | `dsh-context@0.38.2.patch` + 锄点 | pnpm patch 键需按新版本核对；`dsh-context` 若升版，patch 与锄点都会失配（自愈链已能容忍，但要重新生成） |
| `native-overlay` | 目录已空（`native-overlay/dsh-client-ui-deliverables/lib` 无语义文件） | 确认已退役；若仍宣称生效，文档要清 |
| `preset-plugins` | `^1.0.0` 牵引 dsh-coding-sidebar / dsh-context | 版本策略复核（`^0.x` 只跟 patch，安全） |
| `release/v0.6.x` 说明 | — | 新版本发布说明需列本文件 §2–§3 |

---

## 6. 风险与待确认项

**R1 · 原生右侧栏抽不抽得掉（最高风险）**
`ui-chat`、`ui-reference`、`ui-skill`、`ui-sidebar-documentpreview`、`ui-sidebar-files`、`ui-sidebar-terminal` 全部在 `dsh.client.inject` 里硬声明 `@deepseek-ai/dsh-client-ui-sidebar-right`。抽掉它 → `ui-chat` 激活失败 → **主对话界面整体挂掉**。
可选路线：
- **D1a（推荐，成本最低）** 保留 `ui-sidebar-right` 的服务与外壳包，用我们的 `openpath-intercept` 继续重定向 + 外壳视觉压制（我们已有 sidebar-cluster / style-overlay 的成熟手法）。
- **D1b** 由 `dsh-coding-sidebar` **`provide('sidebarRight')`** 接管服务，禁用上游包 —— 需要重实现 `openResource/openResourceIn/toggleExpanded` + `sidebar.right.*` 全部 slot + dockkit 语义；上游每次扩契约都要跟。**长期维护成本高**。
- **D1c** 维持现状（两套并存，各自管各自入口）—— 与"我们只用自己插件"的意图冲突。

**R2 · 隐私默认值翻转**
`session-log-deepseek.enabled` 默认 `true`（上游 base 组合无覆写，base README 自述 "default-on"）。会话正文、工具参数与结果、工作区路径、反馈都会随请求上报到所连 DeepSeek 端点/网关。**这是产品决策，不是技术细节**：要么在 profile 组合里显式 `enabled: false`，要么在设置页给用户一个明确开关 + 首次启动告知。

**R3 · Loader 非事务化**
插件装坏 → 半生效树，不再自动回滚。KCoder 的插件管理页（`plugins.ts`）当前只有安装/更新/卸载，**没有"启动自愈/回滚"叙述**。需要评估是否加"加载失败检测 + 一键禁用"。

**R4 · 菜单化纸夹按钮**
回形针按钮并入 `+` 菜单的 File 行（`ui-attachment` 的 drop 链也抽到 `drop-events.ts`）。KCoder 的 `attach-picker` 注入器**已于早前退役**（文件不存在），所以无直接断点；但要复核 `style-overlay` / `sidebar-cluster` 是否还有对旧 composer 结构的类名假设。

**R5 · 上游自带 Electron 桌面链**
`apps/desktop` + `apps/desktop-host` 已成为上游一等公民（bundled runtime、peer 校验、asar host）。与 KCoder 的打包链（staging/materialize/asar 热补丁）**目标重合**。短期无冲突（不同 appId/产物），中期值得评估"是否复用其 runtime 物化器"。

**R6 · 待现场确认**
- 当前 `~/.dsh/profiles/web` 里 `ui-sidebar-right` 与 `dsh-coding-sidebar` 是否同时在渲染（我未启动 app 验证，只做了静态分析）。
- `dsh-context` 当前实装版本（0.52.0 与 patch 键 0.38.2 已知失配，靠锄点兜底）。

---

## 7. 讨论：新版本"要增加什么"

### 7.1 必做（升级成本内，不做就发不出版）

1. 四个内置 bundle 的 peer/dev 版本键统一到 `0.1.6-alpha.1`
2. `dsh-coding-sidebar` 图标断点修复 + bundle 镜像同步到 1.0.15
3. `ui-deliverables` 预览语义跟进（`forClosing` 单参、`presented.previewButton`）
4. 升级仪式七件套（BASELINE / 分支名 / setup.sh / release.sh / 集成分支重建 / patch 键复核 / 发布说明）
5. `terminal-controller` + `ui-sidebar-terminal` 显式禁用决策落地

### 7.2 建议新增（产品价值排序，待你拍板）

| # | 候选功能 | 理由 | 成本 |
|---|---|---|---|
| A | **会话日志上传开关**（默认关 / 设置页显式开启 + 文案） | 隐私面必须由我们表态；上游默认开 | 低 |
| B | **归档会话恢复页**（`ui-settings-unarchive-sessions`） | 上游白送；我们设置面板加一行导航即可；此前"归档即消失"是真痛点 | 低 |
| C | **MCP 资源能力**（`mcp-resources` 三工具 + 服务器指令段） | 我们的 `mcp-settings.ts` 已有管理面，补资源开关/预览即可显著扩能 | 中 |
| D | **composer 命令菜单本地化**（我们做中文 claim token / File 行） | 上游已做，我们只需复核注入不冲突 + 我们自有命令接线 | 低 |
| E | **Auto review 权限预设**（实验） | 与我们"危险操作前确认"的产品调性契合；但需信任模型审查 | 中 |
| F | **轨迹 PTC 代码查看器 + JSON 包装偏好** | 零成本获得，只做品牌/主题适配 | 低 |
| G | **插件加载失败可见化 + 一键禁用/回滚**（应对 R3） | 上游取消自动回滚，风险转嫁到宿主，我们补 UX | 中 |
| H | **`dsh.manifestVersion/categories/engines.dsh` 声明**（内置 bundle） | 为将来插件市场/兼容性检查铺路，零风险 | 低 |
| I | **原生终端彻底禁用 + 我们终端入口归位** | 避免双入口；我们底面板/标题栏按钮已是唯一入口 | 中 |

### 7.3 明确不做

- 上游原生右侧栏**外壳**（保留服务层做契约）
- 上游原生终端（`terminal-controller` + `ui-sidebar-terminal`）
- 上游 `apps/desktop` / `apps/desktop-host` 打包链（KCoder 自有链足够）
- browser-use / computer-use 实验包（按需用户自装）

---

## 8. 建议的落地顺序（供讨论）

```
阶段 0  本分析评审 → 拍板 D1 路线（A/B/C）与 A/B/C/D/E/F/G/H/I 取舍
阶段 1  fork 上重建集成分支 kcoder/0.1.6-alpha.1（merge 修复分支，推远端）
阶段 2  KCoder 侧升级仪式（BASELINE/分支名/setup/release）+ 全量回归
阶段 3  内置插件适配三件：coding-sidebar（图标+拦截面）、file-review（预览语义）、terminal（禁用上游）
阶段 4  bundle 镜像同步 1.0.15 + release audit 对账归零
阶段 5  新功能批次（按 §7.2 排序）
阶段 6  打包链 smoke（ABI/原生物化/asar）+ 发布说明
```

---

## 9. 决策记录（2026-09-15，产品方拍板）

| # | 议题 | 决策 | 落地要点 |
|---|---|---|---|
| D1 | 右侧栏路线 | **采用 D1a** | 保留上游 `ui-sidebar-right` 包（服务层 + 契约），继续用 `dsh-coding-sidebar` 的 `openpath-intercept` 重定向打开动作；不重实现 `sidebarRight` 服务，不禁用上游包。外壳视觉压制沿用既有注入链。 |
| D2 | 会话日志上传 | **本产品不上传** | 必须在 profile 组合里显式 `session-log-deepseek.config.enabled: false`（上游 base 组合默认 `true`，见 §2.3/§3.2 #8）。注意上游 base 组合无覆写，**不能依赖默认值**，要落成我们自己的补丁行。 |
| D3 | fork 分支纪律 | 新集成分支 **`kcoder/0.1.6-alpha.1`**；**master 保持官方纯净镜像，不做任何修改** | 基线 = tag `0a15e36e7f`（`dsh-v0.1.6-alpha.1`）；重建方式沿用既有配方：新分支基于 tag → `merge --no-ff` 旧集成分支 `kcoder/0.1.5-rc.2` 整体重放。 |

### 9.1 已执行（本地，未 push）

- 备份并清理 fork 工作树残留：`pnpm-workspace.yaml` 脏改动（= 旧集成分支版本 + 本地 `confirmModulesPurge: false`）已 `git stash`，副本存 `.tmp/upstream-0.1.6/pnpm-workspace.yaml.dirty-backup`。
- 在 `0a15e36e7f` 上创建分支 `kcoder/0.1.6-alpha.1`（**未 push，按惯例由用户执行**）。分支尖端：**`048a116f7b`**（= tag + 一个 merge 提交，无裸提交）。
- `git merge --no-ff kcoder/0.1.5-rc.2` 重放，产生 6 处冲突并已全部解决：

| 冲突文件 | 解决方式 |
|---|---|
| `ui-chat/.../ChatNodeSeat.tsx`（2 处） | 取并集：上游新增必填 `openSkill` + 我们 0007 的 `editUserMessage` |
| `ui-chat/.../ChatView.tsx` | 同上（`openSkill` + `editUserMessage`） |
| `ui-chat/.../MessageItem.tsx` | 参数取并集 `node, editUserMessage, renderMessageImages, openFile, openSkill, t`；body 的 `references={{ openFile, openSkill }}` 由 git 自动合并保留 |
| `session-projection-cache/README.zh.md` | 采纳上游术语「当前运行单元」+ 保留我们的纯 JSON 隔离条款 |
| `session-projection-cache/README.i18n.yaml` | 用 `git hash-object` 重录双侧 blob 哈希（与工具同源算法） |
| `pnpm-lock.yaml` | 取 HEAD 侧后由 `CI=true pnpm install --no-frozen-lockfile` 重收敛（precedent 同 0.1.5 升级） |

### 9.1.1 完整性断言（本次实测）

- 我们自己的提交全部保住：`b13e950d94`（0007 编辑重发）、`facdc190a2`（0006 opencode 会话头）、`dd1529d8aa`（win32 控制台黑窗）均为 HEAD 祖先 ✅
- 文件集合对比 `fb2c4b9e..HEAD` vs `fb2c4b9e..0a15e36e7f`：集成侧 3961 / 上游侧 3942，
  **"仅上游有" 为空**（零丢失）；"仅集成有" 19 个文件，全部是我们自有补丁面
  （`.gitignore`、`apps/cli/src/plugin.ts`、`MessageIconActions.tsx`+spec、`conversation/assembly.ts`、
  `markdown/modelSanitize.ts`+`parse.ts`+spec、`llm-pi-ai` 4 文件、`llm/topology.spec.ts`、`sdk/client.ts`、
  `session-projection-cache/src/index.ts`、`subprocess-local/process-inspector.ts`、`win32-process/abi.ts`、
  `patches/@earendil-works__pi-ai@0.85.1.patch`）——符合预期，无意外增删。
- 重收敛后的锁文件确认带上我们的 pi-ai 补丁，patch 哈希 `4e4bd7a9…` 与 `upstream/BASELINE` 历史记录一致 ✅
- 工作树仅剩 4 个历史遗留未跟踪截图（`qilin-seal*.png`），与本升级无关。

### 9.2 第二批已执行（2026-09-15：① 升级仪式 + ③ D1a + ② D2）

**① 升级仪式（KCoder 侧）**
- `upstream/BASELINE`：新增 0.1.5-rc.2 → 0.1.6-alpha.1 升级记录；钉版 SHA 改
  `0a15e36e7f82b6ed45af6fa9759f29b40dcd965d`（文件末唯一非注释行，setup.sh/release.sh 断言读的就是它）。
- `desktop/main/dsh-contract.ts`：`UPSTREAM_BRANCH` 与注释改 `kcoder/0.1.6-alpha.1`。
- `scripts/setup.sh`、`scripts/release.sh`：分支名 3 处同步。验证：`grep -rn "kcoder/0.1.5-rc.2" desktop scripts` 归零。

**③ D1a 落地**

*(a) 拦截覆盖复核 —— 结论：不需要改代码。* 0.1.6 全部 `ctx.sidebarRight.openResource` 调用点只有三处，
且**都传 `dsh-resource://file/...` 地址、都不带 `options.kind`**，正好落在 `wrapSidebarRight` 的接管分支：

| 调用点 | 形态 | 覆盖 |
|---|---|---|
| `ui-chat/src/client/apply.ts:136-137`（openFile：交付卡/tool 链/prose） | file 地址 + `{params:{line}}` | ✅ |
| `ui-reference/src/client/index.ts:115`（`@` 引用预览，0.1.6 新增消费方） | file 地址，无 options | ✅ |
| `ui-skill/src/client/index.ts:184`（`/技能` 引用与 openSkill，0.1.6 新增消费方） | file 地址，无 options | ✅ |

（`ui-sidebar-files/src/client/FilesBody.tsx:218` 用的是 dockkit 内部的 `tabActions.openResource`，
属原生侧栏自身，不经过该服务。）

*(b) 原生右侧栏外壳压制* —— `desktop/main/style-overlay.ts` 新增 `NATIVE_SIDEBAR_CSS`：

```css
[data-sidebar-right-expand],
[data-sidebar-right-panel],
[data-sidebar-right-float-host] { display: none !important; }
```

- 锚点全部是上游公开 `data-*` 属性，非 CSS Modules 哈希类名。
- **与 `style.enabled` 总开关解耦**：关掉样式定制只回退排版覆盖，压制常驻（否则一关开关原生侧栏就复活）。
- 安全性依据：`ExpandButton.tsx:42` 是上游全包**唯一**的 `setExpanded(sid, true)` 入口；面板状态是内存态
  （`stores.ts` `init: { bySession: {} }`，无持久化），整页加载后 `cols.rightbar` 恒为 0，
  隐藏绝对定位的面板不会留下空白列。
- 为什么不直接禁用 `ui-sidebar-right` 行：`ui-chat` 等 6 个包在 `dsh.client.inject` 里硬声明它，
  禁用会让 ui-chat 激活失败、主对话界面整体挂掉（§3.2 #2）。

**② D2 会话日志不上传** —— 改用 **`dsh web --patch` 产品 overlay**：

- 新模块 `desktop/main/product-policy.ts`：幂等物化 `$DSH_HOME/cordis.patch.kcoder.yml`
  （KCoder 独占文件名；内容未变不写盘；带「顶层数组」硬自检）。
- `dsh-contract.ts` 增 `webPatch` 门（与 `webNoOpen` 同款 `>= 0.1.0-rc.8`；`--patch` 实际 rc.7 即有，保守对齐）。
- `dsh-manager.ts` spawn 参数追加 `...productPolicyArgs()`；`index.ts` 在 `dshManager.start()` 前调 `ensureProductPolicy()`。
- 层内容（两条产品决策）：
  - `- id: session-log-deepseek` + `config: { enabled: false }` —— 会话日志不上传（D2）
  - `- id: ui-sidebar-terminal` + `disabled: true` —— 原生终端 UI 整行禁用（D1a 补强）
    ⚠️ 同族行的 `api-terminal-controller` **必须保留**：`packages/api/remotes/src/client/index.ts`
    静态 import 并 `$mount` 它的 remote，禁用会让 api-remotes 挂载失败、主对话链全挂。
    该行在 0.1.5 及更早不存在，此时补丁只产出一条 "not found" 警告后被跳过（非致命）。

*为什么不用 profile / home 补丁文件*：① 上游层序 bundle → profile → home → **overlay**
（`apps/cli/src/profile-boot.ts` composeEntries），overlay 最后应用最稳；②
`$DSH_HOME/profiles/web/cordis.patch.yml` 被 `mcp-store.ts` 整份 YAML 重新序列化（注释不保），
托管块会被反复抹掉；③ 不动共享 `~/.dsh` 里 dsh CLI 自己的文件。

*端到端实测*（用 fork 构建出的 CLI 导出组合树）：
```
DSH_HOME=/tmp/dsh-dump node apps/cli/lib/bin.js web --dump-config --patch /tmp/p.kcoder.yml
```
输出确认两行都已覆写：
- 第 17–20 行 `- id: session-log-deepseek` / `name: '@deepseek-ai/dsh-session-log-deepseek'` /
  `config:` / `enabled: false`
- 第 490–492 行 `- id: ui-sidebar-terminal` / `name: '@deepseek-ai/dsh-client-ui-sidebar-terminal'` /
  `disabled: true`

即 overlay 确实覆写到这两行，且 stderr 无 "not found" 警告。
另：`CI=true pnpm typecheck && pnpm build` 全绿；产物断言 `out/main/index.js` 含
`data-sidebar-right-expand` / `data-sidebar-right-panel` / `cordis.patch.kcoder.yml` ✅

> 坑记：`pnpm typecheck` 会触发依赖状态检查并跑 `pnpm install`，无 TTY 时硬报
> `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` —— 必须 `CI=true pnpm typecheck`。

### 9.3 第三批已执行（2026-09-15：内置插件兼容性维护）

> 产品决策（2026-09-15）：**保留自研侧边栏插件**——git / 文件编辑 / 任务管理 / 轨迹图
> 上游原生仍无等价物；但**只做兼容性维护、不再新增功能**，直到上游原生完全对齐。

| 项 | 结果 |
|---|---|
| `dsh-coding-sidebar` 图标断点 | 把 `IconSendOutline16` 自持进 `src/client/icons.tsx`（上游 0.1.6-alpha.1 已删该导出）；产物核对：`primitives.IconSendOutline16` 属性访问残留 **0**。发布 1.0.15 → **1.0.16** |
| peer 版本键 | `^0.1.5-rc.2` → `^0.1.5-rc.2 \|\| ^0.1.6-alpha.1`（12 处）。**实测确认**：npm semver 的预发布规则下 `^0.1.5-rc.2` **不满足** `0.1.6-alpha.1` |
| `dsh-file-review-kcoder` | 同类问题：`>=0.1.0-rc.5 <0.2.0` 同样不满足 `0.1.6-alpha.1`（11 处改为 `… \|\| ^0.1.6-alpha.1`）；发布 1.0.3 → **1.0.4** |
| `dsh-terminal` / `dsh-skills-bundle` | 无 `@deepseek-ai/*` peer，**零改动** |
| 镜像链 | 独立仓 → `dsh-plugins` → `bundle/`：`bundle/dsh-coding-sidebar` 1.0.12 → **1.0.16**、`dsh-file-review-kcoder` 1.0.3 → **1.0.4**；`sync-bundles --check` **零差异** |

**失败模式更正**：我先前说该图标「编译即断」不准确。发布产物是 CJS `require` + 属性访问，
缺失导出变成 `undefined` —— 插件**照常加载**，只有渲染 sidechat 面板时 React 抛
「Element type is invalid」；只有**从源码重建**时 `tsc` 才报错。

**未做（留待依赖刷新批次）**：插件仓 devDependencies 仍钉 `0.1.5-rc.2`——需联网重装、
调整 `minimumReleaseAgeExclude`，且本机 npm 缓存需修复（`~/.npm/_cacache` 写入被拒）。

**新发现（待决策）**：`bundle/dsh-coding-sidebar` 从 1.0.12 的 24MB 涨到 **99MB**——
1.0.13–1.0.15 的 Office/视频预览带来 `client-office.js` 22MB + **source map 35MB**。
map 对运行无用，可考虑在 `sync-bundles.mjs` 的排除面里摘掉 `lib/**/*.map`，
约省 40MB+ 装机体积。

### 9.4 第四批已执行（2026-09-15：提交与发布 0.6.13）

**推送（均由用户执行，已与 origin 同步）**

| 仓 | 提交 |
|---|---|
| `dsh-coding-sidebar` | `877892f` 1.0.16 |
| `dsh-file-review-kcoder` | `a34762b` 1.0.4 |
| `dsh-plugins`（镜像） | `1a3ff33` |
| fork 集成分支 | `kcoder/0.1.6-alpha.1` = `b88abcad16` |

**KCoder 提交串**

| 提交 | 内容 |
|---|---|
| `066db46` | feat: 升级上游基线 0.1.5-rc.2 → 0.1.6-alpha.1 |
| `d7b5ae2` | chore: sync-bundles 同步内置镜像（sidebar 1.0.12→1.0.16、file-review 1.0.3→1.0.4） |
| `0fb54c2` | fix(release): 回收 deploy 残留 vendor/ —— 守卫加 `--clean`，物化后无条件清 |
| `44e04e2` | release: 0.6.13（版本号 + tag，含 `release/v0.6.13.md` 与 `release/audit-v0.6.13.md`） |

**发布**：tag `v0.6.13` → `44e04e2`，本地与远端均在。CI（`.github/workflows/release.yml`）按 tag 拉集成分支做三平台构建 + 签名公证 → GitHub Release，正文取 `release/v0.6.13.md`。

**本批踩到并修掉的坑（下轮升级直接复用）**

1. **`dsh web` 子命令选项必须排在 web-app 选项之前**：`web` 启用 commander `passThroughOptions`，第一个 app 选项（`--port`）之后的参数全部透传给 web app；`--patch` 放最后会以 `error: unknown option` 退出。**新 flag 必须在真实参数位验证，不能单独试**（`web --dump-config --patch X` 通过是假阳性）。
2. **merge 之后必须 rebuild，不能只 install**：只 install 会让 `lib/` 停在旧基线——0.1.6 新增包无产物报 `ERR_MODULE_NOT_FOUND`；陈旧产物里的旧 import 报「找不到包」（如 `@modelcontextprotocol/sdk` 已被拆成 `@modelcontextprotocol/{client,server,node}`）。判据：`packages/*/*/` 有 `lib/index.js` 的比例应为 **283/283**。
3. **`release.sh build` 的 deploy 会在上游 `vendor/` 留假成员**（`vendor/KCoder/staging/…`）：命中 tsdown workspace glob `vendor/*`、**以根包名义**报 `Cannot find entry`，炸掉后续任何上游构建（含 fork 侧 pre-push）——第四次复发，已在 `0fb54c2` 加 `--clean` 回收（只删空壳/孤儿链接，非空拒删）。
4. **跑 `scripts/verify-*.cjs` / `smoke-*.mjs` 必须 `env -u ELECTRON_RUN_AS_NODE`**：本机 shell 继承该变量会让 electron 以纯 Node 启动，`require` 拿到的是二进制路径字符串 → `Cannot read properties of undefined (reading whenReady)`。临时 dsh 实例要用**受管后台作业**起，`&` detach 的会随调用结束被回收。
5. **`pnpm run <script>` 的依赖状态检查可能触发 `pnpm install --production`**（现场移除 789 个包、含全部 devDependencies）。恢复：`rm -rf node_modules && CI=true pnpm install`（~10s）。热态下 pre-push 门 `pnpm run typecheck` 实测 **9s**；冷态（`lib/` 或 `*.tsbuildinfo` 缺失）退化为全量 workspace 重建（分钟级）。

### 9.5 下一批待办

| # | 事项 | 性质 / 依据 |
|---|---|---|
| 1 | CI 发布链结果核对：三平台产物齐否、macOS 公证、Windows 打包版任务执行无黑窗 | 发布收尾 |
| 2 | 装机后按 §10 清单过 GUI（原生侧栏入口消失、会话日志不上传、内置终端正常） | 产品验收 |
| 3 | `scripts/smoke-mcp-dom.mjs` triage：注入脚本渲染期抛错后挂住 | 非发布门；**判不了**是陈旧夹具还是 0.1.6 的 MCP 层改动 |
| 4 | `scripts/smoke-skills-page.mjs` / `smoke-skills-dom.mjs` 抽取夹具修复 | 自 `6ba648a` 起即失效（`PAGE_JS` 含插值后不可直接 eval），非本次引入 |
| 5 | bundle 剔除 `lib/**/*.map`（`sync-bundles.mjs` 排除面） | 待决策，约省 40MB+ 装机体积 |
| 6 | Office/视频 6 个依赖钉精确版本 | 落实「自持、不追第三方升级」政策 |
| 7 | 插件仓 devDependencies 上移至 0.1.6-alpha.1 | 需联网重装 + 调整 `minimumReleaseAgeExclude`；本机 npm 缓存需修复 |
| 8 | `release.sh` 3.2 步后补一次 `pnpm install` 收尾 | 防第 5 条的 `--production` 事故；**推测，未证因果** |
| 9 | §7.2 功能候选 B/A/G/C/I 取舍 | 产品决策（建议序：B 归档恢复 → A 上传开关 → G 插件加载失败可见化 → C MCP 资源 → I 终端入口归位） |

---

## 10. GUI 验收清单（由用户重启 app 实测）

> 项目惯例：GUI 不由 AI 验证；以下为本次改动的验收点。

**原生右侧栏压制（D1a）**
- [ ] 会话头部右侧**不再出现**「面板展开」按钮（原 `IconPanelLeftOutline16` 圆角小按钮）。
- [ ] 右侧窗口**没有空白列 / 留白**（隐藏面板未占网格轨道）。
- [ ] 我们的 `dsh-coding-sidebar` 仍能正常打开（状态栏代理按钮）。
- [ ] 点交付卡 / 内联代码文件引用 / `@` 引用 / `/技能` 引用 → 打开进**我们的侧边栏编辑器**
      （不是原生侧栏，也不是系统默认程序）。
- [ ] 深/浅色主题下标题栏与右侧按钮位置无异常。

**会话日志不上传（D2）**
- [ ] 正常发一轮消息（含一次工具调用）→ 请求体**不含** `dsh_session_log` 字段。
- [ ] `$DSH_HOME/cordis.patch.kcoder.yml` 已生成，内容为 `session-log-deepseek` + `enabled: false`。
- [ ] 诊断面板启动命令行可见 `web --port 0 --no-open --patch …/cordis.patch.kcoder.yml`。
- [ ] 关掉「样式定制」开关并重启 → 原生右侧栏入口**依旧不出现**（压制与样式开关解耦）。

**原生终端行禁用（D1a 补强）**
- [ ] 项目/工作区右键或引导菜单里**没有**「新建终端（原生）」这类入口。
- [ ] 内置终端（`@kkutysllb/dsh-terminal`）开关、多标签、切工作区仍正常。
- [ ] `$DSH_HOME/cordis.patch.kcoder.yml` 内含 `ui-sidebar-terminal: disabled true`。
- [ ] 启动日志无 `patch: entry ... not found`（0.1.6 运行时下应当没有）。

**回归**
- [ ] 会话列表/切换、插件管理页、设置页、MCP 页正常。
- [ ] 侧边栏文件树 / 编辑器 / Git / 子代理面板功能不受影响。

---

*本文件为分析产物。§1–§8 结论可由 `git diff fb2c4b9e 0a15e36e7f` 复核；§9 记录实际执行的分支/合并/落地操作；§10 为 GUI 验收清单。*
