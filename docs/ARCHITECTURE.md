# KCoder 架构与变更说明（v0.1.0 基线重建版）

> **本文的读者**：未来在 KCoder 仓库单独开工的开发者或 AI 会话。这份文档自包含——
> 不需要 DSH-Desktop 仓库的会话历史即可无缝承接开发。
>
> 最后更新：2026-08-17（基线重建提交 `ecc2ced`）

## 1. 项目沿革（为什么代码长这样）

KCoder 经历了三个时代，当前是第三时代：

| 时代 | 形态 | 引擎接入方式 | 结局 |
|---|---|---|---|
| 一、QiLin 时代 | `app/` 自研 React + Tailwind + Monaco IDE 客户端 | QiLin runtime manager（`app/main/qilin-*.ts`） | 已全部删除 |
| 二、submodule 时代 | 同上 | deepseek-harness 以 git submodule 引入（`d4e58bb`） | 客户端未完成，submodule 已解除 |
| 三、**基线重建时代（当前）** | DSH-Desktop v0.1.4 整仓拷贝 | **宿主与侧车**：spawn `dsh web` 独立进程，HTTP 侧车（见 §3） | `ecc2ced` 起步 |

2026-08-17 的重建决策：放弃未完成的自研客户端路线，以同作者的
[DSH-Desktop](https://github.com/kkutysllb/DSH-Desktop) v0.1.4（提交 `f29f852`）
为基线整仓拷贝——它是已发布、验证过的 deepseek-harness 桌面壳。KCoder 在此之上
做产品化定制，**两仓库从此独立演进、双线维护**。

**基线增量同步**：DSH-Desktop v0.1.5 的通用能力（`f29f852..65026a8` 中三个功能
提交）已于同日手动移植同步——会话日志导出、样式定制迁入上游设置面板、跳到底部
按钮居中。KCoder 功能面与基线 v0.1.5 一致；版本轴仍独立（KCoder 自 0.1.0 起）。

## 2. 重建变更明细（`ecc2ced`，412 文件 +12790/−44131）

### 删除

- `app/`：QiLin 时代自研客户端全部（组件、ChatPanel、Monaco、终端、构建配置）
- `skills/`：随 QiLin 携带的 skills 集
- submodule：`.gitmodules` + `deepseek-harness` 的 gitlink（克隆本体保留，见 §5）

### 保留（KCoder 自有资产）

- `build/icon.icns|ico|png`：KCoder 品牌应用图标（继承原项目）
- `assets/legacy/`：原项目源码存档——**WelcomeScreen**（欢迎屏，已移植，见 §6）、
  **CommandInput**、**i18n**（约 1500 行中英文案，后续产品化移植素材）
- `upstream/`：上游补丁存档（`0001-markdown-model-sanitize.patch`，待推上游）

### 引入（DSH-Desktop v0.1.4 基线全套）

上游侧车管理、面板体系（设置/诊断/同步/插件/偏好）、内嵌终端（node-pty）、
文件活动预览抽屉、插件桥、自动更新、发布流水线（GitHub Actions 三平台）。
（状态栏四面板——文件预览/会话轨迹/日志导出/Git——已于 2026-08-20 删除，
功能由预置插件 dsh-better-sidebar 承接；内嵌终端同日删除后于 2026-08-22
恢复——插件底面板在 agent 运行态黑屏且无唤醒信号，产品决策弃用其
入口（sidebar-cluster 压制看门狗）回归自研；Git 面板于 2026-08-23 恢复
——浮动卡片（`#/git`）承载状态/提交/推送/分支/计划文档/子代理轨迹，
按钮 win32/macOS 均平铺在按钮组左侧——win32 因原生控制按钮区遮挡由 panel-buttons 整体平移 +138px 让位（2026-08-30 取代下拉收纳）。）

### 品牌替换矩阵（品牌层换了，引擎层没换）

| 项 | 基线值 | KCoder 值 |
|---|---|---|
| name / productName | dsh-desktop / DSH Desktop | kcoder / KCoder |
| appId | com.kkutysllb.dsh-desktop | **com.kcoder.app**（沿用原 KCoder 值） |
| version | 0.1.4 | **0.1.0**（版本轴重开） |
| 发布通道 | kkutysllb/DSH-Desktop | kkutysllb/KCoder |
| 深链协议 | dsh-desktop:// | kcoder:// |
| 图标 | DeepSeek 官方鲸鱼 | KCoder 自有品牌 |
| 欢迎屏 | dsh 产品落地页（约 1900 行 CSS） | WelcomeScreen 移植版（app.css 2243→367 行） |

**保留不动的引擎层命名**（是上游机制名，不是品牌）：`dsh-contract.ts`、
`DshManager`、`dsh web` 就绪行、`window.dshDesktop`
桥、`DSH_BIN`/`DSH_HOME` 环境变量、上游包名 `@deepseek-ai/dsh`。**不要**把这些
也“品牌化”——它们是与上游对齐的契约词汇。（已品牌化的目录命名：打包链
staging/包内归档/首启解压统一为 `kcoder-runtime`；引擎数据目录与上游共享
默认 `~/.dsh`，不另行品牌化。）

## 3. 当前架构总览

```
Electron 主进程 (desktop/main/)
 ├─ DshManager ──spawn──▶ dsh web --port 0（上游侧车，OS 分配端口）
 │                         └─ stdout 就绪行 "dsh web: http://127.0.0.1:<port>"
 ├─ shell 窗口 ──loadURL──▶ 上游 Web UI（sandbox、无 preload、零修改）
 │     └─ 唯一加载形态 kcoder-app://app 恒定 origin（2026-10-08 灰度翻转，
 │        2026-10-10 legacy 直连路径与其偏好开关退役）
 │        └─ shell-protocol ──protocol.handle 内部转发──▶ 侧车（cookie 只在
 │           主进程；HTML 注入 streamBaseUrl；WS 升级头改写，见 §7 新行）
 ├─ 面板窗口 ──preload 白名单 IPC──▶ 本地 hash 路由页面（desktop/renderer/）
 └─ 注入体系 ──executeJavaScript──▶ 向上游 Web UI 叠加桌面端能力
```

三条铁律（源自基线，不可动摇）：

1. **`deepseek-harness/` 是纯克隆**：绝不修改、绝不提交其中任何文件（.gitignore
   已排除）。对上游的一切定制走官方扩展点（插件 / profile / patch）。
2. **上游 UI 零侵入**：桌面端能力（标题栏、主题、面板让位、统计悬浮、更新按钮、
   附件按钮改造）全部通过主进程注入叠加上去，不改上游一行代码。上游升级时注入
   仍可用（契约检查清单见 §7）。
3. **数据统一**：会话/凭据/插件在 `~/.dsh`（上游默认，不预置
   `DSH_HOME`，见 index.ts；用户显式设置 DSH_HOME 时从之）。与
   dsh CLI / `npx dsh web` / 插件市场完全同一套数据，安装与更新
   全链互通。
4. **端口不冲突**：侧车恒以 `dsh web --port 0` 启动（dsh-manager），
   OS 从临时端口段（macOS 49152-65535）随机分配，内核保证与同机
   DSH-Desktop 的侧车（同样 `--port 0`）及用户自起的 `dsh web`（默认
   3080，低位端口不在临时段）永不撞车；实际端口从就绪行解析。
   websocket/mux 复用同一 HTTP server，全进程仅此一个监听；桌面壳
   自身（Electron/pty/更新器）零监听端口。
5. **上游基线钉版**：产品基于固定上游提交开发（`upstream/BASELINE`，
   当前 = 0.1.0-rc.5）。上游 RC 迭代期契约会破坏性变化（rc.7 把
   `settings.plugin.item` slot 从 list 改 keyed，旧插件启动即挂），
   绝不浮动跟 master。`setup.sh` 克隆后 reset 到基线；`release.sh`
   build 断言 HEAD 命中基线后才物化运行时；升级 = 改 BASELINE →
   `setup.sh` → 全量回归 → 提交（详见该文件头注释）。

## 4. 主进程模块导览（desktop/main/）

| 文件 | 职责 | 动它前先看 |
|---|---|---|
| `index.ts` | 入口：单实例锁、启动流程、退出序列 | — |
| `dsh-contract.ts` | ★ 上游契约适配层：就绪行、bin 路径、DSH_HOME、Node 版本探测 | **升级上游时唯一必查** |
| `dsh-manager.ts` | dsh 侧车生命周期：spawn/就绪解析/崩溃重启（指数退避×3）/优雅退出 | — |
| `windows.ts` | shell 窗口与面板窗口创建；各注入器的接线点 | 各注入模块 |
| `style-overlay.ts` | 宿主注入 CSS（**三段**，恒定生效、无偏好档位）：折叠 rail「新建工作区/搜索」入口压制 `RAIL_BROWSER_ACTIONS_CSS`（折叠无痕后退居幂等兑底）、设置对话框头部压制 `SETTINGS_DIALOG_HEADER_CSS`、空会话 K 水印 `HERO_WATERMARK_CSS`（品牌落点，`assets/brand-k.png` 内嵌 data URL）。**已退役两段**：侧栏「插件」panellist 入口压制（2026-10-04 拍板恢复上游入口）、**原生右侧栏外壳压制 `NATIVE_SIDEBAR_CSS`（2026-10-09，铁律 1 翻转：右侧工作台交回上游原生）**。⚠ 留档纪律：**压制元素 ≠ 收回占宽**——承载它的布局层（网格轨道）必须一起处理，接回上游时也要一起撤（见 §12 铁律 1 历史段） | §8 类名匹配策略 |
| `shell-protocol.ts` + `shell-protocol-core.ts` | shell 协议层（2026-10-07，`plans/kcoder-app-protocol.md`）：`kcoder-app://app` 恒定 origin 加载形态（**唯一形态**：2026-10-08 灰度翻转 → **2026-10-10 legacy 退役**，偏好开关与 `shellProtocolMode` 字段一并删除）——`protocol.handle` 把页面请求转发给侧车（cookie 只在主进程，响应扣留 set-cookie/逐跳头，`/plugins/*` 强 no-store）；text/html 有界缓冲注入 `__DSH_TRANSPORT__.streamBaseUrl`（上游契约全局，页面 WS/账号 RPC 的侧车地址）；`ws://127.0.0.1/*` 升级头改写仅认本地 shell 窗口。**无 preload、不写 `data-platform`**（自持几何的前提）；远程窗口不经过本层。core 半区零依赖可断言（check-shell-protocol.mjs），集成面走 smoke-shell-protocol（发版门） | §7 协议层契约两行 |
| `console-channel.ts` | console 通道：页面注入脚本 → 主进程 的上行通信约定（`__dsh_*:` 前缀） | 各注入模块 |
| `sidebar-toggle.ts` | 标题栏左簇 + 折叠无痕（2026-10-04，对齐官方 macOS 折叠形态——官方 preload 写 `data-platform="darwin"` 使折叠整列归零，KCoder 无 preload 走 plain-web 留 56px rail，故自持归零）：上游 logoRow 折叠按钮迁移至自绘标题栏（展开 prev84/next128/toggle174，折叠 toggle84/new120，两态自适应，label 让位变量随态 76↔130 / 142↔196）；无痕 = frame（sidebarCol 父节点）inline grid **轨 1 折叠时归零**的 `!important` 规则（轨 2/3 原样复制，锚为 `:has(> [data-rightbar-col])`，`data-sidebar-collapsed` 属性锚兑底，解析失败退化 rail 不崩；**展开态不产出任何规则**）+ sidebarCol 0.5px 边线压制；新会话代理（`__dsh_desktop_new_btn`）静态内联 IconNewChat 转发上游 newSession，缺席隐藏。**原「原生右栏轨道归零」已随 2026-10-09 铁律 1 翻转拆除**（见 §12 铁律 1 历史段） | §8 点击转发、§12 自绘标题栏契约 |
| `terminal-panel.ts` + `pty-host.ts` | 内嵌终端（2026-08-22 自研回归）：每工作区独立 WebContentsView + node-pty 桶（多标签），切工作区仅 setVisible 不销毁；标题栏按钮 right 44 + 快捷键 Control+\`；让位几何广播 --dsh-terminal-inset（bundle/kcoder-stats-panel 消费）。**历史行**：宿主终端面板 2026-08 退役（改由内置插件 `@kkutysllb/dsh-terminal` 承担），该插件又于 **2026-10-09 整线退役** ⇒ 终端现为**上游原生右侧栏的终端 tab**，宿主侧不再有终端模块（plans/retire-terminal-plugin.md） | — |
| `git-panel.ts` + `subagent-monitor.ts` | Git 环境面板（2026-08-23 恢复）：透明 WebContentsView 浮动卡片（`#/git`）——仓库状态/提交/推送/分支切换/计划文档（shell.openPath 系统应用打开）/子代理轨迹（session.list 轮询 + mux `session/event` 帧聚合）；probeQueue 串行探测与写操作；按钮 right 108 + 徽章 `+N −M`；自动展开三重门槛（当前工作区/实时活动非 replay/git 仓库） | **历史行**：该面板与这两个文件已随预览/Git 面删除；其 `file-activity` 帧观察面亦随 2026-10-05 的统计徽章退役一并消失 |
| ~~`panel-buttons.ts`~~ | **历史行（模块已删除，2026-10-09）**：win32 面板按钮平铺让位（2026-08-30 取代下拉收纳 panel-menu，无转发层）——把自绘标题栏内注入按钮的 right 整体 +138px 移出原生控制按钮区。注入按钮逐个退役（本地编辑器 2026-10-08、侧栏开关代理与内嵌终端 2026-10-09）后**已无让位对象**，模块与其冒烟同批删除 | — |
| `workspace-probe.ts` | 页面级存续功能（预览面板删除后迁出）：正文文件**类型**徽章（TS/JS/MD… + 链接配色）。**2026-10-05 退役**：edit 的 `+n/−n` 统计徽章与它的整条数据链（`window.__dshFileStat` 通道、`statCache`/`applyStat`、`session/page` fetch 拦截、`/api/changes.summary` numstat、turn-end 微型探针、按工作区分桶的活动表、`PreviewEntry` 契约）——理由：**与上游 `client-ui-tool` 的 `ToolRow` 自带 diff 统计（`diffTotals` → `+added -removed`）在同一行重复**，同一行出现两枚；保留上游那份。**2026-10-08 退役**：`workspace-base.ts` 工作区基准与 `__dsh_wsprobe__:` console 上行整链拆除——唯一读者是自建「技能」设置分区（skills-catalog 工作区项目技能探位），而技能设置面已归 `dsh-skills-bundle` 1.1.0 原生设置页（settings.section 插槽 + 插件自有 fenced API `/kcoder-skills/api`），KCoder 注入器（`skills-settings.ts`/`skills-catalog.ts`/`workspace-base.ts` 及 `smoke-skills-page/dom.mjs`）随之退役，**两条技能目录/开关来源并存即冲突**。**2026-10-10 退役**：工作区探针（`session/list` → `--dsh-ws-name`/`--dsh-ws-path` → 自绘标题栏的工作区名前缀与那枚按钮）随用户判定「鸡肋」整体拆除；曾短暂搬到官方槽 `conversation.session.header.utilities`（`dsh-shell-prefs` v1.0.2），用户实机后仍要求删除，故槽版本一并撤回 | 上游已渲染的状态不得重复渲染 |
| `plugins.ts` | 插件桥：profile 层叠清单 + GitHub `topic:dsh-plugin` 发现 + `dsh plugin` CLI 转发；内置层禁卸载但可更新（2026-09-02）：统一入口 updatePlugin 按包属选路——内置可更新层 `add <pkg>@latest`、用户插件 `update --latest`，引擎层（dsh-base/dsh-web-app）不开放（与内置运行时整体耦合） | 物化让位（kcoder-skills-bundle） |
| `native-overlay.ts` | 原生 in-box 包增强覆盖：增强版构建产物整文件覆盖到运行时实际解析到的安装树（`$DSH_HOME/profiles/node_modules` 扁平兑底 symlink → 真实位置；版本门 + mark 幂等 + 签名锚，双锚解析决定了 profile 内副本无法遮蔽安装树）。当前对象：dsh-client-ui-deliverables（原生产物面板 + 审查变更 +A/−R 与 hunk 红删绿增 + 纯审计轮结论卡）；overlay 源在 `native-overlay/`，原版快照在 `.patches/` | 上游 rc 升级须对照快照重制 overlay |
| `updater.ts` + `update-injector.ts` | electron-updater + 向上游 logoRow 注入安装按钮（`kcoder://install-update` 深链） | — |
| `brand-injector.ts` | 品牌化：侧边栏展开态鲸鱼换 KCoder 分体字标 + 版本徽章（rail 换标已随折叠无痕退役，`assets/brand-k.png` 仍供展开态嵌入）、新会话 hero 鲸鱼+slogan（中「所思，皆可成码」/英 "Think it, code it."，CJK 自适应；预览徽章藏起）、`document.title` 产品名替换（拦截 setter）。⚠ 只能藏起+旁插/改 .data，不能 replaceWith/改 textContent（React removeChild 崩树） | §8；“再生成品牌图”同源 |
| `attach-picker.ts` | 附件按钮改造：拦截 drag-to-attachment 插件的模式按钮 → 原生文件对话框 → 合成 drop → 插件 fast path | §8 自毁坑 |
| `workspace-header.ts` | 会话页头收纳（**2026-10-05 起不再是 `display:none`**）：整块 `position:fixed` 覆盖进 48px 自绘标题栏带内（透明 + `pointer-events:none` + **`-webkit-app-region:initial`（不参与合成，2026-10-05 第三轮；`no-drag`/`none` 都会把整条带的拖拽权削光）** + z-index 比条高 1），只把状态簇座位（`_titleRow` / `_headerActions` / `_headerUtilities` / `_headerCorner`）放开可交互并**自补 `-webkit-app-region:no-drag`（上游那份削减的作用域挂在 `html[data-platform='darwin']` 下，本壳永不落该标记 ⇒ 真机上不生效）**——于是上游注册在 `conversation.session.header.actions` 槽里的**四类徽章全部可见且可点**（`client-ui-agent-preset` 预设 / `experimental/client-ui-agent-team` 智能体团队 / `client-ui-subagent` 子代理 / `client-ui-jobs` 后台任务）。**排布复刻上游（2026-10-05 第二轮）**：行首内边距＝`--dsh-titlebar-title-end`+10 ⇒ 徽章紧跟标题之后，`_titleCluster` 压 `flex:none`，`_headerRow` 铺满整行、`_headerUtilities` 靠 `margin-left:auto` 顶到行末（角位贴按钮带）；同一改动里按 `[class*="_moreButton"]` 收掉上游会话头「…」（会话日志/反馈菜单，用户指定不要）。`_crumbs`、`_tabs`、`[data-conversation-header-leading]`（上游窗口控件座位，全仓零注册方）仍收纳。另发布 `--dsh-titlebar-status-w`（**分量之和**，非整行宽）并在面包屑文本变化时派发 `__dsh_title_changed`。**2026-10-09 起它还是原生右栏展开按钮（会话头角位）可点的保证**——那是进入右侧工作台的唯一入口 | §12 自绘标题栏契约 / 铁律 1 |
| `theme-watcher.ts` | 深浅色跟随（`body[data-ds-dark-theme]`）+ **自绘标题栏**（`titleBarStyle:'hidden'` 下的 48px 拖拽条，VS Code 同款）：左段只剩**会话标题**（2026-10-10 起工作区名前缀与工作区按钮退役：用户判定鸡肋），**主文本读面包屑当前项 `[class*=_crumbCurrent]`（2026-10-05 改）**：改前读 `document.title`，而上游 `DocumentTitle` 投射的是「会话标题 — 产品名」，产品名是**构建期内联**的 `DSH_CLIENT_TITLE`（本产品构建未内联 → 回退 locale 键 `brand.localBuild`＝「DSH 本地构建」），于是条上一直挂着与产品无关的字；右段让位带（2026-10-09 起**自绘按钮带宽归零**——宿主注入的三枚按钮已随各自退役摘除，只剩 Windows 原生控制按钮区，`TITLEBAR_RIGHT_BAND = 0`）；几何通道 `--dsh-titlebar-h` / `--dsh-titlebar-right-reserve` 写 documentElement 供 workspace-header 消费，`max-width` 再减去 `--dsh-titlebar-status-w`，**并把主文本实测右缘以 `--dsh-titlebar-title-end` 外传**（2026-10-05 第二轮：页头据此把状态徽章起排到标题之后）。⚠ 条 z-index 比页头覆盖层低 1（**绘制**层级：徽章必须画在条的背景之上）；**能不能点与 z-index 无关**——条作为 drag 基座必须**排在 `#root` 之前**（DOM 顺序决定 app-region 归属，见 §12「自绘标题栏契约」的「可点的前提是 app-region」） | §12 自绘标题栏契约 |
| `upstream.ts` | 上游状态检测 + 同步流水线（fetch→脏检查→ff-only→install→build） | — |
| `menu.ts` / `ipc.ts` / `store.ts` | 菜单与托盘 / IPC 分发 / 持久化 | — |

渲染端（`desktop/renderer/src/views/`）：`landing`（KCoder 欢迎屏）、`splash`、
`setup`、`diagnostics`、`sync`、`plugins`、`preferences`
（`terminal`/`git` 两个面板窗口视图已分别随宿主终端面板 2026-08 与 Git 面退役摘除；
shell 窗口走注入器，不走这些路由），
hash 路由，无框架，纯 TS + 手写 DOM。

## 5. 上游克隆的特殊性（重建时踩过）

KCoder 的 `deepseek-harness/` 原是 submodule，重建时已**扶正为独立克隆**：

- `.git` 是真实目录（曾是指向 `.git/modules/` 的文件，导致 `scripts/setup.sh` 的
  `-d "$UPSTREAM/.git"` 判定失败——若未来再遇到「克隆已存在但仍重新 clone」报错，
  检查这里）；
- HEAD 与基线验证过的上游 commit 一致（`47f9438`），remote 指向官方
  `deepseek-ai/deepseek-harness`；
- 上游依赖已装、已构建（`apps/cli/lib/bin.js` 在位）；
- **依赖陈旧哨兵**：`pnpm dev` 启动前对本仓与克隆各体检一次
  （`scripts/deps-freshness.mjs`：`node_modules/.pnpm/lock.yaml` 锁文件快照比对
  + 工作区包依赖可解析性），命中即打印可照抄的修复命令。起因 = 2026-10-04
  升级上游后漏跑 install：克隆 52 包缺 60 条 `workspace:*` 软链，
  `file-upload` import 失败（`Cannot find package '@deepseek-ai/dsh-scope'`）
  → 宿主 `fileUploads` 缺失 → `session-controller` 永远 pending → 客户端
  33 条插件条目全部 pending，上屏只有一句「Failed to load plugins」（宿主侧
  错误不进终端，故此前是纯静默故障）；
- **store 复用**：克隆的 store 路径记录在 `node_modules/.modules.yaml`，
  `setup.sh` 安装前按记录传 `--store-dir`——不一致时 pnpm 要求清空
  `node_modules`，非交互环境直接
  `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`。

**升级上游**：应用内「设置（上游初始化）」页的「重新构建上游」按钮，或 `pnpm sync-upstream`；
上游是 developer preview，破坏性变更后先查 §7 清单。

## 6. 欢迎屏（landing.ts）

移植自原项目 `assets/legacy/WelcomeScreen`：时段问候（5-12/12-18/18-23/夜）+
品牌光晕（`--accent` 蓝与原项目 #3B82F6 同系）+ KCoder logo 蓝投影 + 三张示例卡
（arch/code/search，文案取自原 i18n `welcome.tip1-3`）。

- 原版的主输入区由「进入工作台」按钮替代（真正输入发生在上游 Web UI）；
- 按钮状态机走 `window.dshDesktop` 桥：`dshStatus()` + `onDshStateChanged`，
  ready 后可点，点击 `showShell()`；
- 示例卡点击 = 直接进工作台（文案仅作灵感提示）；
- 样式在 `app.css` 的 `.welcome-*` 段（app.css 已从 2243 行裁到 367 行，旧 dsh
  产品页样式已删）。

## 7. 上游契约检查清单

> 本节说「上游变了改哪里」；**哪些事我们不做**见 §12 产品铁律（效力更高）。

上游若变更以下约定，只需更新对应位置（完整版含上游源码依据见根 README）：

| 契约 | 落点 |
|---|---|
| 就绪行 `dsh web: http(s)://127.0.0.1:<port>`（2026-10-10 对齐上游 TLS 监听）/ bin 路径 / DSH_HOME / Node engines | `dsh-contract.ts`（`check-shell-protocol` L1/L2 钉住） |
| `dsh plugin --profile web …` CLI 形态 / `dsh.profile.bundles` 层叠 | `plugins.ts` |
| 侧边栏 `logoRow`/`collapsed`、布局列 `sidebarCol/centerCol/detailsCol`、会话行 fiber `props.node.id` | 各注入模块（`scripts/verify-inject.cjs` 可自动化验证）。**2026-10-09 起原生右栏的 `[data-rightbar-col]` / `[data-sidebar-right-*]` 不再是压制锚点**（只作 `sidebar-toggle` 的结构锚与 probe 的判据），上游改它们不会造成产品级失配 |
| 主题落点 `body[data-ds-dark-theme]` / sidebar-fill token | `theme-watcher.ts`（`scripts/verify-theme.cjs`） |
| 协议层：`__DSH_TRANSPORT__.streamBaseUrl` 全局（stream-client 与 ui-settings-account 读，缺席回落 `document.baseURI`）；index.html 含 `<head>` 字面量 | `shell-protocol-core.ts`（注入行；上游改名 = 页面可启动但 WS 断，静默） |
| 协议层转发面：`/api/*` 全量、`/plugins/*`（侧车 immutable 缓存须覆写 no-store）、text/html 首文档；WS upgrade 走 `ws://127.0.0.1/*` 头改写 | `shell-protocol.ts`（真机断言在 smoke-shell-protocol） |

## 8. 开发惯例与经验坑（基线会话沉淀，务必继承）

> **动内置插件（`bundle/` 下任何一个）之前先读 [`plugin-dev-checklist.md`](plugin-dev-checklist.md)**：
> 那份清单只收「用实机测试换来」的四条跨层默认语义——可选面（服务/remote 面）只能走
> `ctx.get`/`ctx.inject`、插件改动必须 bump 版本（物化判据是版本比较）、`openTab` 里
> 带 `meta` 才算内容型才会展开面板、预置 spec 只指向已发布版本。三条坑的共同点是
> **静态检查全绿而实机不生效**。

### 验证链（每次改动的标准收尾）

```sh
pnpm typecheck && pnpm build
# 产物关键串断言（防陈旧产物——压缩会改变量名，断言要用裸字符串而非属性链）
grep -c -F "关键串" out/main/*.js
```

typecheck 链尾已含 `scripts/check-injected-scripts.mjs`：抽取 desktop/main 全部
注入脚本模板做 no-undef 分析 + bundle client 半协议检查（见坑记 5/6），改注入器后无需额外动作即被覆盖。

**GUI 注入面另有一道：`scripts/smoke-settings-anchors.mjs`**（设置页注入锚点）。注入类改动
靠「产物关键串断言」看不出**锚点是否还匹配上游 DOM**——上游把类名或层级一改，表现是原生 UI
在注入页下**重复出现**：不崩、不错位、控制台无声，只有肉眼能发现（KCoder 的「关于」与
「数据迁移」两个注入页就靠 `[role="dialog"][aria-modal="true"]` +
`[class*="_options"] > div[data-slot="settings.section"]` 这两级锚点）。该冒烟跑**真注入脚本**
（从 `desktop/main/*.ts` 抽 `PAGE_JS`）+ 与上游编译产物同构的 fixture，并自带判别力自检
（把锚点类名改成上游改名后的形态，主断言必须失败）。
⚠️ 抽取模板字面量时**必须复现模板求值的转义折叠**（`\\n` → `\n`）：漏掉这一步，页面拿到的是
双重转义脚本，CSS 被拼成 `…}\n[role=…]` 而 CSS 把 `\n` 当转义 ⇒ 第二条起的选择器全变成元素名
`n[role=…]`、规则静默失效（首版冒烟就是这么误报的）。

GUI 冒烟统一只进**本机发版门**（`release.sh prepush`），不进 CI——CI 只跑不开窗口的
`smoke-runtime`（既有 11 支 GUI 冒烟同此策）。

### 协作惯例

- GUI 不由 AI 验证：AI 交付验证清单 → 用户重启 app 实测 → 用户说提交才提交；
  push 永远由用户执行。**唯一例外是发版链**：按 `release/README.md` 的发布
  约定跑 `scripts/release.sh ship <版本>` 时，commit / tag / push 属该流程的
  既定步骤（含 CI 依赖的 fork 集成分支推送——tag 早于 fork push 会让发布物
  与本地验证脱节，见 `brand-assert.mjs` 的由来）。
- 注入脚本是模板字符串：**内部禁写 TS 注解**（纯 JS，构建不转译模板内容）。

### 坑记

1. **拦截匹配特征自毁**：注入拦截若依赖 title 等可变属性识别目标，拦截处理中又
   改写了该属性 → 二次点击失配穿透，第三方原 onClick 复活（attach-picker 首版
   中招：模式切换穿透导致绝对路径插进草稿）。改写后的值必须纳入匹配集（原始值
   ∪ 改写值 ∪ 文本兜底），优先用不可变结构特征。
2. **产物类名匹配**：上游 CSS modules 哈希前缀不可预测，匹配用
   `[class*="semanticName"]` 或结构锚点属性（如轨迹页的
   `data-conversation-composer-overlay` 全上游唯一）。
3. **mux 事件流**包含所有会话的活动，消费必须带 sessionId→工作区归属维度，否则
   预览抽屉跨工作区互串（归属唯一来源是 workspace.list 的 items[].sessionIds）。
4. **shell 陷阱**：zsh 下 `for f in $files` 不做单词拆分（整段当成一个文件名），
   批量处理用 `xargs`；`pnpm setup` 是 pnpm 内置命令，项目脚本要 `pnpm run setup`。
5. **注入脚本的模板字符串是 typecheck 盲区**（2026-09-18 账号菜单一轮连中三次，
   全部同构）：desktop/main 的注入器把页面脚本写在 TS 模板字符串里，tsc 不检查
   字符串内容、`new Function` 只查语法——悬空标识符（删了 `busy`/
   `settingsTrigger` 的定义但调用还留着 → 运行时 ReferenceError，「点外部不关
   菜单」「点设置进不去」两个用户可见故障静默存活数轮）、bundle client 半裸
   ESM export（加载器不认，顶层声明还会与其它 client 模块撞标识符）都从这里
   漏过。修复不止于修 bug：`scripts/check-injected-scripts.mjs` 挂进 typecheck
   链尾（词法抽取模板 → 语法门 → oxlint no-undef → 定位映射回源文件行号；
   `__全大写__` 形态是挂载侧文本替换占位符，自动豁免并打印清单）。注回 bug
   实测可抓到、干净树通过，退出码直接核验。**改任何注入器后，标准收尾即覆盖。**
   两个子雷（2026-09-19 更新说明渲染轮再中）：① **模板内注释写反引号**
   ——注释里的字面反引号同样终结模板（本轮把示例语法写进注释即中）；
   ② **模板内正则的单反斜杠被求值吞掉**——文件层必须双反斜杠（\s→s、
   \*→*、\x60→反引号本身），且注入自检的语法门读的是文件原文而非模板
   求值结果，对 ② 有盲区——改注入器里的正则/转义后，务必按"模板求值
   语义"（双反斜杠解码回单）抽取后再语法验证。
6. **外置 bundle 的 client 半有专属协议与服务面事实**（同轮实测）：
   - client 交付物必须 `window.__ModuleLoader__.load({ id, factory })`，工厂
     返回 `exports.inject` / `exports.apply`，所有实现收在 factory 作用域内
     （参照 `bundle/dsh-shell-prefs/client.js`——原举例的
     `@kkutysllb/dsh-terminal/client.js` 已随该插件 2026-10-09 退役）；
   - 上游两个偏好服务的读法**不同名**：locale 是 `getSnapshot()`，theme 是
     `getTheme()`——按一个的形状读另一个，异常会被 try/catch 吞成 null，
     表现为"当前值读不出"而非报错；
   - theme 的 `themes` 注册表只含 light/dark，**system 是偏好档不是主题**，
     按 options 渲染三档会丢「跟随系统」；
   - 桌面壳注入脚本**够不到 client 插件服务**（上游无 window 级服务桥），
     要让壳的 UI 走上游唯一写入口，就学 `dsh-shell-prefs`：client 半
     `inject: ['locale','theme']` 后把窄接口发布到 window，壳注入脚本消费。
     显示侧同理：当前语言/主题等状态**每次实时取**（桥优先、DOM 兜底），
     不能烘焙成脚本注入时的常量。

## 9. 与 DSH-Desktop 的同步策略

- **独立演进**：无自动同步。DSH-Desktop 是通用 dsh 桌面壳主线；KCoder 是产品化
  分支。共享的是"上游契约知识"（§7 清单两边通用）而非代码流。
- **想把 DSH-Desktop 的新功能搬过来**：对照该仓库的提交，手动移植对应模块 +
  接线点（`windows.ts`），品牌串按 §2 矩阵替换。中大规模迁移前先跑 §8 验证链。
- **反向**：KCoder 的产品化改动（欢迎屏等 renderer 层）一般不回流 DSH-Desktop；
  通用修复（如注入坑修复）值得回流。

## 10. 后续开发入口速查

| 想做什么 | 去哪里 |
|---|---|
| 改欢迎屏视觉/文案 | `renderer/src/views/landing.ts` + `app.css` `.landing-*` 段 |
| 移植原项目组件 | 素材在 `assets/legacy/`（i18n 文案、CommandInput 等） |
| 加/改 CSS 注入（上游外壳压制） | `main/style-overlay.ts`（注意锚点策略） |
| 加面板页面 | `renderer/src/main.ts` 路由表 + `views/` 新文件 + `shared/ipc-contract.ts` + `main/ipc.ts` |
| 升级上游 | `pnpm sync-upstream` → 查 §7 清单 → `scripts/verify-*.cjs` |
| ⚠ 上游动了侧边栏/侧栏契约 | **2026-10-09 起右侧工作台就是上游原生右栏**：上游改它，我们**什么都不做**（不压制、不代理、不自持，见 §12 铁律 1）；要动上游侧栏形态，走插件路线（铁律 2），不把压制加回来 |
| 重新生成品牌图 | app 图标 `assets/icon.png`/`renderer kcoder.png` 是手动放置的自有品牌图（勿覆盖）；托盘/侧边栏图由它派生：`python3 scripts/make-tray-icons.py`（黑底 keying 取 K 形状 alpha → 包围盒裁剪 → 32px 托盘双产物 + 64px `brand-k.png` 供 brand-injector 嵌入） |
| ⚠ 托盘图覆盖坑 | `pnpm icons`（make-icons.cjs 产上游鲸鱼图）会覆盖已品牌化的 `assets/tray*.png`——运行后需重跑 make-tray-icons.py |
| 发布 | `package.json` 版本 → 提交 → tag push（CI 三平台，见根 README） |

## 11. Roadmap

- [x] 品牌化：托盘/侧边栏/新会话 hero/窗口标题（`make-tray-icons.py` + `brand-injector.ts`）
- [ ] 全局快捷键唤起、deep link（`kcoder://`）
- [ ] 面向 KCoder 产品定位的交互迭代（基于 `assets/legacy/` 逐步移植）
- [ ] Windows / Linux 打包验证

## 12. 产品铁律（不可回退的产品决策）

> 与 §7 配套：§7 说「上游变了改哪里」，本节说「哪些事我们不做」。
> 铁律的效力高于单次升级的便利——上游的能力再顺手，也不改变下列路线；
> 要改铁律，必须由产品负责人显式拍板并在本节留下日期与理由。

### 铁律 1：右侧工作台归上游原生侧边栏（2026-09-19 定 → **2026-10-09 翻转**）

> **本条已由产品负责人于 2026-10-09 拍板翻转**：右侧工作台**交回上游原生右侧栏**
> （`ui-sidebar-right` 及其 files / documentpreview / terminal / browser tab），
> 自研插件 `dsh-coding-sidebar` **整线退役**。撤销理由：上游新版本的原生右侧栏
> 已覆盖产品所需能力。执行记录（双账本 + 四名单 + 宿主压制面的完整拆除）见
> [`plans/retire-coding-sidebar.md`](../plans/retire-coding-sidebar.md)。

**翻转后的现行准则**：

- **不压制、不代理、不自持**：原生右栏的外壳、网格轨道、开关入口一律按上游原样工作。
  入口是上游会话头角位的展开按钮（注册在 `conversation.session.header.corner`），
  由 `workspace-header.ts` 保证该座位在有可见注册方时**照常可交互**。
- **原生终端 tab 一并交回**（同日拍板）：`product-policy.ts` 不再禁用
  `ui-sidebar-terminal`。自研底面板终端（`@kkutysllb/dsh-terminal`）的「另议」当日即定案
  ——**整线退役**（升级第二步，plans/retire-terminal-plugin.md）：宿主依赖（node-pty/xterm）、
  自绘按钮、菜单项与让位模块一并拆除，**终端唯一形态 = 上游原生右栏终端 tab**。
- **再出现「想换掉原生右栏」的诉求时**：按 §12 铁律 2 走插件路线（新插件、新版本），
  **不把压制加回来**——下一段就是那两次尝试的完整代价记录，先读完再动手。

#### 历史记录（2026-09-19 立 → 2026-10-09 撤销）

- **服务层保留、外壳收掉**：`ui-sidebar-right` 的包与服务契约**始终必须保留**
  （`ui-chat` / `ui-reference` / `ui-skill` / `ui-sidebar-files` /
  `ui-sidebar-documentpreview` / `ui-sidebar-terminal` 在 `dsh.client.inject`
  里硬声明它，禁用会让主对话链整体挂掉）。当年只压用户可见外壳；如今外壳也保留——
  这一条**退役后依然成立**（"保留服务"那半是硬约束，"外壳收掉"那半已撤销）。
- **轨道也要收（2026-10-05，用户实测「点尾卡文件弹出右栏空白区」）**：
  当年的 `NATIVE_SIDEBAR_CSS` 只压得住**元素**——AppFrame 的 inline 第三轨是
  `minmax(0px, <右栏宽>px)`，**元素 `display:none` 之后轨道照旧按增长上限预留**
  （真实 Chromium 实测：面板隐藏、第三轨仍是 480px，中列只拿到剩余宽，右侧留一条
  空白）。所以 `sidebar-toggle.ts`（frame 轨道覆盖的唯一所有者）在折叠无痕之外
  **恒把第三轨写 0px**。触发链实证：退役 `dsh-file-review-kcoder` 后**没人再认领**
  `dsh-resource://changes-review/…` → 尾卡「变更」手势落到引擎默认通道 →
  面板被压制看不见、**预留出来的空白看得见**。
  **通用结论（已内化为纪律）**：CSS 压制不足以收回空间——承载它的布局层（这里是
  grid 轨道）必须一起处理；**反向接回上游时这条覆盖也必须一起撤**，否则原生右栏会
  「看得见、却被压成 0 宽」。
- **打开动作归插件 / 不属于「文件」的打开手势也要认领（2026-10-05，用户实测
  「点交付物文件不进侧边栏」）**：当年文件、`@` 引用、`/技能` 引用的打开走插件
  `openpath` 拦截（重定向进自家编辑器）；上游变更文件卡把
  `dsh-resource://changes-review/…` **地址**交给原生右栏，于是由插件在
  `openResource` 门上加第二族地址的认领（`review-address.ts`：解析地址 → 读宿主
  `api/changes.summary` → 该行文件进自家编辑器）。**同源的通用判据（翻转后仍然
  有效）**：上游把任何「打开什么」的手势交给 `sidebarRight` 时，先问一句
  「这个地址谁认领」——无人认领就没人渲染，用户看见空白。
- **已知副作用（当年）**：本条生效期间，上游侧栏新能力（如 `ui-sidebar-browser`
  侧栏浏览器）在 KCoder 不可见，能力落差一律在 release notes 的「未启用 / 已由内置
  实现替代」段列明。**翻转后该副作用消失**；反向落差（自研插件独有能力：Git 面板、
  Office / 视频预览、轨迹图、任务计划等）改由发版说明列明。

### 自绘标题栏契约（2026-10-05 定；独立于铁律 1，**仍然全效**）

> 本节条目原属铁律 1，讲的全是**自绘标题栏**自身的可用性契约——与「用谁的侧边栏」
> 无关；2026-10-09 铁律 1 翻转时抽为独立小节，效力不变。

- **可点的前提是 app-region，不是 z-index / pointer-events（2026-10-05，用户实测
  「这些无法点击」）**：Electron 合成窗口拖拽区是「按几何 + **DOM 顺序**、
  **忽略层叠**，最后被收集的盒子决定该点是否可拖」，可拖即拖窗、**点击到不了页面**。
  契约的可执行表述在上游 `ui-web/window-drag/regions.ts`（`isDraggableAt`），其 e2e
  注释亦明说这一类**不能用「点一下试试」来判**（CDP 注入的点击判不出，吞发生在原生
  窗口层）——上一版冒烟的「徽章可点」是用 `elementFromPoint` 判的，**结构上不可能
  发现该故障**，故报绿而现场点不动。三层根因与本仓对策：
  ① **本壳从不落 `html[data-platform='darwin']`**：上游整张 app-region 表（drag 行、
     可交互元素削减、四簇削减）**全部作用域在该标记下**，而写它的是上游桌面壳的
     preload；KCoder shell **无 preload**，引擎 web bundle 只读不写（`AppFrame.tsx:168`
     读 `dataset.platform`）⇒ 真机上上游那层**一条都不生效**。对策：`workspace-header.ts`
     按上游同一语义**自补**簇级 `no-drag`（作用域不依赖该标记）。
  ② 自绘标题栏（drag 基座）必须**排在 `#root` 之前**：排在之后即成为最后一个盒子，
     吞掉其后一切（上游规矩同义反写：要「保持可点」的覆盖层挂 `#root` **之后**，
     靠 `no-drag` 自我削减）。
  ③ 全宽 fixed 覆盖层（会话页头）必须**不参与合成**（`-webkit-app-region: initial`）：
     带 `drag` 会吞掉排在它之前的盒子（首当其冲是自绘条自己的按钮），带 `no-drag`
     会把整条带的拖拽权削光。两条 Blink 实测（本机 Electron 44，**与上游注释不符，
     以实测为准**）：**`none` 被解析成 `no-drag`（不是「无」）**；该属性**会继承**
     （`drag`/`no-drag` 都继承，`initial` 可显式退出）——所以给容器标错一个值，
     整棵子树的拖拽权一起变。
  **判据（常备门 `smoke:titlebar`）**：收集所有 `computed -webkit-app-region ≠ none`
  的盒子（DOM 顺序）→ 用上游 `isDraggableAt` 判点。夹具默认**不带**平台标记（真实
  宿主形态），负对照两条：条改回 `append`、平台标记在场。**任何「能不能点」的主张都
  走这条判据；`elementFromPoint` 只证明 DOM 命中，不得再当可点证据。**

- **搬进自绘带的区域必须复刻上游几何（2026-10-05 第二轮，用户实测「徽章应该
  在标题之后（箭头处），而不是堆在右侧」）**：把上游某区域「收进」自绘带时，
  **排布本身是它语义的一部分**。上游 `conversation.session.header` 的几何是
  `[标题][状态徽章] …… [工具][角位]`（`.titleCluster{flex:1}` 吃满行宽、簇内
  `.crumbs` 占左可省略号、`.headerActions{flex:none}` 紧随；`.headerUtilities`
  与 `.headerCorner` 因簇已吃满而落在行末）。首版只保住「可见 + 可点」，把整行
  `justify-content:flex-end` 靠右，徽章于是堆到按钮带左侧——**信息在、语义丢了**。
  正解是**互为反向的两条 CSS 变量**：`--dsh-titlebar-status-w`（标题右侧必须让出
  的宽度＝徽章簇+工具+角位+固定间距之和，主文本 `max-width` 依此收窄）与
  `--dsh-titlebar-title-end`（主文本实测右缘，页头行首内边距依此起排），箭头单向
  ⇒ 无环不抖。⚠ 让位宽度**不能量 `.titleRow` 整宽**：整宽含把工具顶到行末的
  `auto` 外边距，量整宽会把标题压成 0 宽（首版靠右时侥幸成立，改回左起排即暴露）。
  **判据**：凡「把上游某区域收进自绘带」的改动，先照抄它的**排布**（谁跟着谁、
  谁吸剩余空间、谁省略号），再谈可见性；只做后者＝半成品。

- **自绘带上只保留产品要的控件（2026-10-05 第二轮，用户指定「那个…不要」）**：
  会话头右上角的「…」不是自绘按钮，是上游 `session-log-export` 的
  `SessionLogDownloadHeaderAction`（注册在 `conversation.session.header.utilities`，
  锚 `_moreButton`，图标 `IconEllipsisOutlineRegular`；`aria-label` 取本地化串
  `header.more`、不可作稳定锚）。产品按「不要」处置 ⇒ `workspace-header` 在该
  **会话页头作用域内**按 `[class*="_moreButton"]` 隐藏（外科式：同一座位里的另一枚
  工具按钮保留，冒烟钉住这一点）。⚠ 代价如实登记：隐藏后「下载会话日志」与
  「反馈」两项在会话头不再可达；要恢复只需删掉那一条选择器。

- **按钮与入口自持**：自绘标题栏右端的按钮由各注入方自持。**2026-10-09 起宿主注入数为 0**
  （本地编辑器注入器 2026-10-08 退役、侧栏开关代理与内嵌终端 2026-10-09 随插件退役，
  `panel-buttons.ts` 让位模块同批删除）；红线开关本体由 `sidebar-toggle.ts` 自持，
  会话头角位的原生展开按钮由上游渲染。**侧栏
  panellist 的「插件」入口 2026-10-04 恢复**（原 `SIDEBAR_PLUGIN_ENTRY_CSS`
  压制已删）：该条目是上游 `ui-plugin-manager` 自带的 workspace 插件菜单，
  点开在主列渲染 `PluginManagerPage`；产品侧「设置 → 内置插件 → 插件管理」
  tab（fork 侧 `settings.plugins.tab` 贡献）**同期保留不变**——两者是同一个
  页面，双入口并存，产品决策（插件管理落在设置）未变。
  （2026-10-09 起侧栏开关**不再由宿主代理**：入口回到上游原生会话头角位的展开
  按钮，`sidebar-cluster.ts` 整模块退役。）

- **收掉一块上游区域前，先清点它的槽位注册方（2026-10-05 定）**：为换纵向
  空间，KCoder 把上游会话页头整块 `display:none`，于是注册在
  `conversation.session.header.actions` 槽里的徽章**全体消失**——
  `client-ui-agent-preset`（预设）、`experimental/client-ui-agent-team`
  （智能体团队）、`client-ui-subagent`（子代理）、`client-ui-jobs`（后台任务）
  四家，其中只有预设被一条「读文本 → 写 `--dsh-agent-preset` → 自绘条复刻
  合成徽章」的旁路补了回来。**合成副本不是对齐**：每多一个注册方就要多一条
  旁路，且副本不可点、不随状态变化。正解是把槽位座位搬进标题栏带
  （`workspace-header.ts`：页头 `position:fixed` 覆盖 + 只放开状态簇
  `pointer-events`），上游加多少徽章就自动显示多少。
  **判据**：凡「把上游某区域收掉以换空间」的改动，先列出该区域内**所有**
  槽位的注册方（`ctx.slots` 声明 + 全仓注册点），只要还有一个没搬过来，
  就不算对齐。同源教训：2026-09-23 的空带、2026-09-18 的裸 `_titleRow` 误伤。

- **上游改动怎么办（通用）**：**只改插件仓 → 发新版本**（见铁律 2）——
  宿主侧不接上游实现细节，只在 §7 的契约面（就绪行 / CLI / 注入锚点 / 协议层）对账。

### 铁律 2：新版本适配只改插件源码（2026-09-19 定）

上游版本适配**只在插件仓（`~/kk_Projects/dsh-plugins` 系）改源码并发新版本**，
不在 KCoder 里为插件补适配层。KCoder 只做三件事：

1. **消费接线**：`BUNDLES` / `PRESET_PLUGINS` / `sync-bundles.mjs` 映射；
2. **宿主侧产品压制**：`product-policy.ts` / `style-overlay.ts` / 注入器；
3. **本仓自有功能**：renderer、主进程模块、发布链。

例外：**宿主自身契约**（就绪行 / CLI 形态 / DSH_HOME / 注入锚点 / Electron ABI）
的适配仍在 KCoder——那属于 §7 清单范畴，不是插件内部实现。

> 配套纪律：preset 依赖声明必须指向**已发布且与物化实体同线**的版本
> （声明未发布的版本会让 `pnpm install` 在启动期失败，见坑记之外的 0.6.12/0.6.13 现场）。

### 铁律 3：版本升级总纲（2026-10-09 定）

上游同步**不是改一个基线数字**，而是四条硬轴的强制举证。每次升级（含 prerelease）
都按本节执行；**先落盘文档，再动代码**。

**0. 前置（缺一不可）**

- fork 集成分支重建：`kcoder/<上游版本>` = 上游 tag + `git merge --no-ff` 上一集成分支
  （重放我方偏离面）；**集成分支推送 fork 之后才允许打 tag/发版**（`release/README.md` 约定 3：
  tag 早于 fork push 会把旧 fork 状态打进安装包）；
- 本地克隆切到该分支，`pnpm install` + `pnpm run build` 全绿（构建半成品态会被误判成
  产品缺陷：2026-10-09 的 `pnpm dev` 起不来即由此而来）；
- `upstream/BASELINE` 的推进与「回归证据」段在**发版同批**写入。

**1. 分析文档（先落盘）：`docs/upstream-<版本>-analysis.md` 必须逐条覆盖**

| 轴 | 要求 |
|---|---|
| 官方发布说明 | GitHub Release 正文（中/英）**逐条** → 代码级落点（包/文件/契约面）+ 影响分级（🟢无 / 🟡需复核 / 🔴需改动） |
| 官方升级指南 | 上游 `docs/upgrade-guide/<版本>/` 若存在则**逐主题**摘录 Change/Migration + 我方影响；不存在时在文档中显式记录「上游未提供」 |
| 官方**未提及**的结构性变更 | 包增删、契约改名、槽位变化、CLI/就绪行/RPC/持久化格式变化——由全量 diff 归纳，并标注「本轮新发现」 |
| 引擎/内核差异 | boot/profile（`OPTIONAL_BUNDLES`/`RETIRED_BUNDLES`/兼容闸门）、plugin-manager（安装与官方目录）、RPC/远程面、SDK、LLM 与 pi-ai 线 |
| 自研内置插件逐项 | 现役（技能 `dsh-skills-bundle`、MCP、`dsh-ssh-remote`、`dsh-shell-prefs`）与已退役线（`dsh-coding-sidebar`、`@kkutysllb/dsh-terminal`）各一条：需不需要动、动哪个仓、判据是什么 |
| 破坏性变更的外部插件影响 | 以**本机真实安装的插件**为准逐个体检（peer 与启动闸门、被移除 API、语义变更），列出命中文件与处置归属 |
| 我方偏离面 ∩ 上游改动 | 文件级风险表（重叠文件、冲突极性、处置） |

**2. 实施计划（同一轮落盘）：`docs/upstream-<版本>-upgrade-plan.md`**

阶段划分（S0…Sn）＋每步**判据/验收/回滚点**＋owner（宿主 / 插件仓 / 外部仓）。
计划里的每一项都必须可判真假——不允许「视情况优化」这类无判据条目。

**3. 澄清卡纪律**

需要产品拍板或跨仓协作的点，写成澄清卡：**问题 / 背景与事实 / 选项 / 我的建议 /
影响面 / 需谁拍板**。先抛卡再动手；卡未拍板不得以「顺手做掉」的方式落地。

**4. 不变量**

- `deepseek-harness/` 仍是纯克隆（不改、不提交）；适配只落**插件仓**（铁律 2）与**宿主契约面**（§7）；
- 未验证的推断必须标注「待核」并附验证方法（命令/文件/判据）；
- GUI 事实由用户实测确认（§8 协作惯例），AI 不代验。

### 配套产品决策：上游实验性功能随版打包（2026-10-09 定）

**决策**：上游 `app-boot` 的 `OPTIONAL_BUNDLES` 全表（当前 11 条实验性组合包）**随 KCoder
发版打包并默认选中**——不再要求用户逐个在插件页开启。

**两侧机制**（缺一不可，都以「跟随实态」为准）：

| 侧 | 落点 | 判据 |
|---|---|---|
| 产物侧：把实体供进 runtime | `scripts/materialize-peers.mjs` 的 `EXPERIMENTAL_BUNDLE_PACKAGES` 供给块（申报进 staging 清单 + 按**整棵解析闭包**补齐，实验 bundle 自带行包依赖） | `scripts/verify-runtime-experimental.mjs`（构建期硬门，离线可跑；负对照：空清单 runtime 必须红） |
| 宿主侧：把 bundle 声明进 profile | `desktop/main/kcoder-skills-bundle.ts` 的 `UPSTREAM_OPTIONAL_BUNDLES` + `optionalBundleResolvable()`（**只有解析树里真有才写**，两态解析根不同：源码态 = 上游克隆工作区，打包态 = 首启解压的 `<userData>/kcoder-runtime`） | `smoke:bundle-profile` 的 **F29** 双向量断言（实态在位必须被声明 / 不在位**不得**被声明）+ 幂等 |

**为什么必须「跟随实态」**：`dsh.profile.bundles` 的每一项都会在 profile 组成期解析成
实体目录——声明了而解析不到即**启动失败**。旧 runtime + 新名单 = 用户下次启动直接崩；
故顺序恒为「先随包，再默认选中」，且宿主侧声明永远以解析实态为准（新 runtime 随包后
下一次启动自动补声明，幂等）。

**上游 dormant 行不翻**：bundle 内部 `disabled: true` 的行（如 session-titles 的唯一行、
agent-team 的四行）仍由上游决定，本决策只做「bundle 级」的随包与选中。

### 配套产品决策：桌面端「收敛式」改造（2026-10-10 定）

**决策（Q-D1=C）**：桌面端不再走「Web 套壳 + DOM 注入」的老路，也**不**整体切换到上游桌面链；
取**收敛式**——以上游原生原语与官方 slot/桥为地基，**把现有的自绘/注入面逐步收敛掉**。

**已建成的底座**（决策前提，不是从零开始）：`kcoder-app://` 协议化加载（特权 scheme + 主进程
转发 + WS 头改写，页面不暴露 loopback）、加载形态灰度（2026-10-08 默认 true → **2026-10-10 legacy
退役，开关与字段已删**）、原生窗口 chrome 三件套（`titleBarStyle: hidden` + `trafficLightPosition` +
`titleBarOverlay`）、原生菜单/更新器/preload 桥。设计与验收见 `plans/kcoder-app-protocol.md`。

**收敛顺序**（每步带判据）：S-D1 Electron 对齐 → S-D2 页头改官方槽（退役条带几何与页头搬移）
→ S-D3 桥语义对齐 → S-D4 UI 面插件化（设置页/MCP/品牌/账号/关于）→ S-D5 协议收尾（legacy 退役）。
详见 `docs/desktop-native-overhaul.md` §5。

**不变量**：每处退役都必须**先让替代物跑通**（无「先删后补」）；GUI 观感由用户实测（§8）；
上游 prerelease 节奏由铁律 3 的逐轮复核兜底。
