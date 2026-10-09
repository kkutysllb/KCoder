# 桌面端改造分析：从「Web 套壳 + DOM 注入」到「一等桌面应用」（与 0.2.1-alpha.2 升级结合）

> 背景（产品负责人 2026-10-09）：**本次升级前就定了「专门桌面端改造」，不再走以前的 web 套壳方式**。
> 本文把我方现状、上游自带桌面链的事实、以及本轮升级暴露的成本放在一起，给出路径与判据。
> 事实基线：上游 tag `dsh-v0.2.1-alpha.2`（集成分支 `kcoder/0.2.1-alpha.2` @ `41f151ab20`，已推 fork）；
> 采集 2026-10-09。

## 1. 我方现状：套壳机制的维护面

| 维度 | 事实 |
|---|---|
| 主进程体量 | `desktop/main` **42 个模块 / 13,318 行** |
| 页面注入面 | **12 个注入器 / 4,996 行**：`style-overlay`(253) / `theme-watcher`(598) / `workspace-header`(392) / `workspace-probe`(210) / `sidebar-toggle`(530) / `brand-injector`(358) / `account-chip`(625) / `about-settings`(459) / `settings-page`(147) / `mcp-settings`(572) / `home-migration`(738) / `clipboard-fix`(114) |
| 集成契约 | ARCHITECTURE §7「上游契约锚点」**8 条**（就绪行 / CLI / 侧边栏与布局类名 / 主题落点 / workspace RPC / 协议层全局 / 协议转发面） |
| 自绘标题栏 | 隐藏原生标题栏 → 自绘条（`--dsh-titlebar-h` 由 `theme-watcher` **量测**）+ 右侧让位（`--dsh-titlebar-right-reserve` = 尾部呼吸位 + **Windows 138px** 原生控制区）+ 会话页头搬移与类名收编（`_titleRow`/`_moreButton`…） |
| 守护成本 | 12 支 GUI 冒烟（titlebar / workspace-header / style-overlay ×2 / sidebar-toggle / brand-badge / account-chip / mcp-dom / settings-anchors / shell-protocol / workspace-probe / bundle-profile） |
| 本轮升级暴露的脆弱点（实证） | `detailsCol` → **`rightbarCol`** 改名；`DocumentTitle` 从 `client/web` **迁到** `client/ui-layout`；`_moreButton` 的所属包与类名需重新定位；会话头新增 `conversation.session.header.lineage` 槽；`host/apiproxy` 包**消失**（README §7 行需改写）；右侧让位带需从 0 手调到 12px |

**一句话**：我们维护的是一层「把上游 Web UI 改造成桌面外观」的**注入适配层**，它随上游每次 UI 迭代都要按锚点复核——本轮就有 6 处漂移。

### 1.5 已经完成的部分（2026-10-10 用户指出并核实；此前本文低估了进度）

| 已完成 | 实证 |
|---|---|
| **`kcoder-app://` 协议化加载**（特权 scheme + 主进程内部转发 + WS 头改写 + HTML 注入） | `desktop/main/index.ts:42/253`（ready 前注册）、`shell-protocol-core.ts`（纯逻辑）、`shell-protocol.ts`（Electron 接线）；页面全程看不到 `127.0.0.1`，鉴权 cookie 收在主进程 |
| **灰度开关与逃生门** | 偏好设置「工作台协议加载」（`desktop/renderer/src/views/preferences.ts:87`，键 `shellProtocolMode`）；2026-10-08 已翻默认 **true**；关闭即回退 legacy 直连模式（回归闸） |
| 该工程有**自己的设计与验收** | `plans/kcoder-app-protocol.md`：验收 5 条、阶段 0–3 完成（2026-10-07）、check 54 项 + smoke 18 项全绿、实机回归通过（2026-10-08）；**剩余：观察一个版本后执行阶段 4 第二步（legacy 退役）** |
| **原生窗口 chrome 三件套已用** | `desktop/main/windows.ts:98/106/109`：`titleBarStyle: 'hidden'` + `trafficLightPosition`（macOS）+ `titleBarOverlay`（Windows 原生控制按钮） |
| 原生菜单 / 更新器 / preload 桥 | `menu.ts`、`updater.ts`、`desktop/preload/{index,host-paths}.ts` |

**因此本改造的性质变了**：不是「从 Web 套壳从零做原生壳」，而是——**把剩余的自绘/注入面收敛到已建成的原生底座上**。
特别是协议层：我们的 `kcoder-app://` 与上游 `dsh-app://` 是**同一设计意图的两套实现**（自定义协议 + 主进程转发 + WS 凭据），
差异是刻意的（见 `plans/kcoder-app-protocol.md` 的 D2/D3：上游要求打包 dist 供给文档 + preload boot 桥，
我方坚持「零修改复用 + 不向 harness 页面注入 boot 桥」）。

## 2. 上游自带桌面链：事实清单（本轮升级后才进入可评估状态）

| 项 | 事实 |
|---|---|
| 包 | `apps/desktop`（`@deepseek-ai/dsh-desktop` 0.2.1-alpha.2，**electron ^44.7.0**）+ `apps/desktop-host`（共享 profile runner 宿主） |
| 架构 | 官方描述：**Electron shell around the complete dsh Web application**——RunAsNode 子进程启动 profile runner，Electron 直接加载打包 Web 入口（`dsh-app://app/`），**Node IPC 承载 boot injections / readiness / shutdown**；桌面监听 OS 分配端口，自带 WS 凭据过滤 |
| **原生窗口 chrome** | macOS：`titleBarStyle: hiddenInset` + `trafficLightPosition`；Windows：`titleBarStyle: hidden` + **`titleBarOverlay`**（原生控制按钮覆盖在 Web 内容上，含 `WINDOWS_TITLEBAR_HEIGHT`） |
| 渲染层桥 | 一等 preload：`window.dshDesktop`（shortcuts / keyboard）、`dshDesktopBoot`、`__DSH_DIRECTORY_PICKER__`、`__DSH_HOST_PATHS__`、`dshOnboarding`、`dshMandatoryUpdate` |
| 原生能力 | 应用菜单 / welcome 窗 / 强制更新窗 / 更新器 / 崩溃上报 / 设备信息 / **原生目录对话框**（挂到应用窗）/ 命令安装与管理 / 后台通知 / fatal recovery / 本地化 |
| 分发链 | 仓内 `electron-builder.config.mjs` + `installer/` + 自带 pnpm 发行（`resources/runtime/.../pnpm`，包操作不依赖 PATH） |
| 客户端已内建分流 | `runtime: 'desktop' | 'web'`（shortcuts/keybindings 双配置）、`'dshDesktop' in globalThis`（product-analytics）⇒ **上游 UI 自己知道「我在桌面里」** |
| 本轮发布说明对它的投入 | #24 Windows 图片预览遮罩/圆角、#27 安装器盘根校验、#29 Windows PTY 清理、#41 测试版默认关更新网关鉴权弹窗、#44 未签名 DMG 打包入口——**这条链在被持续维护** |

## 3. 逐项映射：我方注入项 vs 上游原生面

| 我方注入项 | 上游对应物 | 结论 |
|---|---|---|
| 自绘标题栏（**我们已用** `titleBarStyle: 'hidden'` + `trafficLightPosition` + `titleBarOverlay`；剩下的自绘部分是**条带内容**：量测高度、Windows 138px 让位、会话页头搬移、类名收编） | 上游同款原生三件套 + **官方 header 槽**（`conversation.session.header.*`，本轮又新增 `lineage`） | **部分可退役**：原生控制按钮/拖拽已在用；退役目标是**条带内容与页头搬移**（改用官方槽 + 原生布局），而非「自绘标题栏」整体 |
| `theme-watcher` 的主题落点/事件（`body[data-ds-dark-theme]`、`colorScheme`） | 客户端在 desktop 运行时下自管；桥可推系统主题 | 退役注入，改桥或上游设置面 |
| `workspace-header`（搬会话页头进自绘条、收编类名） | 上游原生条 + 页头自带槽（`conversation.session.header.*`，本轮**又新增** `lineage`） | 退役；产品要加的 header 元素改走**官方槽**注册 |
| `workspace-probe`（页面侧探针解析工作区名/路径） | 客户端 API/RPC（`session/list` 已是官方 RPC）+ desktop 桥可给宿主路径 | 退役探针，改走 RPC/桥 |
| `sidebar-toggle`（折叠/展开与占宽保全） | 上游原生侧栏 + `data-rightbar-col` 等官方结构（本轮原生右栏已成熟） | 退役；产品级开关走设置面 |
| `brand-injector` / `account-chip` | 官方 slot（如 `conversation.hero.brand.mark`）+ desktop 桥（账号/设备信息） | 改**插件化的 slot 组件** |
| `settings-page` / `about-settings` / `mcp-settings` / `home-migration` | 官方设置分区/`settings.section` 槽 + 原生对话框 + `dshOnboarding` | 改插件化（分区注册），不再 DOM 注入 |
| `clipboard-fix` | 桌面运行时下的原生剪贴板/快捷键桥 | 退役（在 desktop 运行时下由壳处理） |
| `style-overlay`（压制段） | 无——它存在的理由是「我们在 Web 里假装桌面」 | 随退役面收窄直至删除 |
| 协议面（`shell-protocol` / `shell-protocol-core`）——**已建成并在跑**（`kcoder-app://`，灰度默认 true） | 上游 `dsh-app://` + Host 转发 + WS 凭据过滤 | **不是缺口而是收敛点**：二者同意图、实现不同（我方 D2/D3 刻意分歧）。剩余动作 = 收尾阶段 4（legacy 退役）+ 评估是否对齐上游实现 |

## 4. 三条路径

| | A 现状加固 | B 全面采用上游桌面链 | C 混合（推荐） |
|---|---|---|---|
| 做法 | 继续 Web 套壳 + 注入；把 §7 锚点与 12 注入器维护下去 | KCoder 变成**上游 desktop 的发行版**：品牌/策略/插件分层，删掉注入层与自绘壳 | **以上游原生原语与桥为地基**，分阶段把注入项改成插件化 slot / 桥；保留我们的打包与产品面 |
| 收益 | 改动小、当下可控 | 与上游同构，长期维护成本最低 | 逐步收敛，风险可控，收益同 B |
| 代价/风险 | 每轮升级按锚点复核（本轮 6 处漂移）；天花板是「像桌面」而非「是桌面」 | 产品面（SSH 远端、技能、shell-prefs、Kylin 插件、中文产品壳）要**全部插件化重做**；依赖上游 prerelease 节奏；自研更新/安装链要重估 | 过渡期两套并存（包体/复杂度上升）；需明确「退役顺序」 |
| Electron | 44.0.0 | 上游 ^44.7.0（**同大版本** ✓ ABI 面接近） | 同 B（升级到上游同版） |

**推荐 C**，理由：① 本轮升级已证明注入层的锚点漂移是**持续成本**；② 上游桌面链已把「桌面」做成一等公民（原生 chrome/桥/安装器/更新器），继续手工模拟没有收益；③ 但我们的产品面（远端世界、技能、shell-prefs、中文壳）**是 KCoder 的价值**，不能丢——它们的正确形态是**插件 + 官方 slot/桥**，而不是注入。

## 5. 分阶段迁移草案（每步带判据）

| 阶段 | 动作 | 判据 |
|---|---|---|
| S-D1 | 对齐 Electron 版本到上游同线（^44.7） | 打包/签名/原生模块全绿；`pnpm check` + 冒烟 |
| S-D2 | 换**原生窗口 chrome**（`hiddenInset`/`hidden` + `titleBarOverlay`/trafficLight），退役自绘标题栏 | 三平台窗口控制/拖拽/双击最大化正常；`theme-watcher`/`workspace-header` 的条几何代码删除；GUI 冒烟改造 |
| S-D3 | 引入 **`window.dshDesktop` 级桥**与 `runtime: 'desktop'` 分流（对齐上游语义） | 客户端识别为 desktop；快捷键/目录对话框走桥；我们的 preload 与上游桥对齐或合并 |
| S-D4 | 产品 UI 插件化：设置页/MCP/品牌/账号/关于 → 官方 slot 注册 | 各 UI 面在**无注入**下可见可用；注入器逐个删除（每删一个跑一次冒烟） |
| S-D5 | 协议层收尾：**执行 `plans/kcoder-app-protocol.md` 阶段 4 第二步（legacy 退役）**；再评估与上游 `dsh-app://` 的实现差异是否值得对齐 | 退役后仅剩协议一条加载路径；dev/prod 隔离、插件缓存 no-store、WS 凭据三条判据不退化；`check`/`smoke` 双模式断言改单模式 |

## 6. 风险与开放问题

1. **上游 prerelease 节奏**：桌面链在 alpha 期迭代快（本轮 5 条桌面条目）；跟随意味着我们与其发布节奏绑定——需要「钉版 + 每轮升级按铁律 3 复核」的既有机制继续兜底。
2. **自研更新/安装链**：上游有更新网关与 `updates.*` 设置（含测试版鉴权弹窗策略），KCoder 有自己的 updater/installer；两条链合并或并存需要产品决策。
3. **产品面迁移工作量**：SSH 远端世界（自有 bundle + sidecar 引擎）、技能 bundle、shell-prefs、Kylin 系列插件——它们与「桌面壳」耦合不深，但 UI 面要按 slot 重写。
4. **过渡期双重维护**：迁移期内两套窗口/标题栏机制并存，需要明确的「谁在跑」开关与回滚点。
5. **本轮升级的即时关系**：alpha.2 的修复**不依赖**该改造；但若决定走 B/C，`docs/ARCHITECTURE.md` §12 铁律 1 的「自绘标题栏契约」小节、§7 锚点表、以及 12 支 GUI 冒烟的范围都会随之改写。

## 7. 澄清卡（待拍板）

- **Q-D1 路径**：✅ **已拍板（2026-10-10，产品负责人）：C 混合（收敛式）** —— 以上游原生原语与官方 slot/桥为地基，把现有自绘/注入面逐步收敛掉；既不整体切上游桌面链，也不继续加固套壳。落地顺序见 §5 的 S-D1..S-D5（每步带判据）。
- **Q-D2 时点**：本轮 alpha.2 升级**先发版**、桌面改造另立项目；还是先把桌面改造做进这一轮（会推迟发版）？建议**先发版**（升级面已收敛，桌面改造是产品级工程）。
- **Q-D3 标题栏**：是否接受「直接删掉自绘标题栏，改用原生 chrome」带来的视觉变化（原生控制按钮位置/高度由 Electron 定）？
- **Q-D4 产品面优先级**：设置页 / MCP / 品牌 / 账号 / 关于 五块，先迁哪一块？建议先迁**设置页 + MCP**（面最大、最常被上游改动影响）。
- **Q-D5 协议层**：是否接受把 `shell-protocol` 的转发面换成上游 `dsh-app://` 体系？