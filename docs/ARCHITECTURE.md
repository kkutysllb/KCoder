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
（内嵌终端与状态栏四面板——文件预览/会话轨迹/日志导出/Git——已于
2026-08-20 删除，功能由预置插件 dsh-better-sidebar 承接。）

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
| `style-overlay.ts` | CSS 注入：标题栏、主题 token、轨迹页美化（锚点 `data-conversation-composer-overlay`）、跳到底部按钮居中（`toBottomSlot`） | §8 类名匹配策略 |
| `console-channel.ts` | console 通道：页面注入脚本 → 主进程 的上行通信约定（`__dsh_*:` 前缀） | 各注入模块 |
| `sidebar-cluster.ts` | better-sidebar 开关簇收纳：插件开关簇隐藏，状态栏右侧两枚代理按钮（点击转发插件真实按钮，disabled/图标/label 实时同步） | §8 点击转发 |
| `workspace-probe.ts` + `file-activity.ts` | 页面级存续功能（预览/Git 面板删除后迁出）：工作区探针（workspace.list → 标题栏工作区名/按钮 + fileActivity 工作区基准）、正文文件徽章（类型 + edit 增删行数）、历史会话补拉拦截；file-activity 为 mux 流按工作区分桶的聚合存储（sessionId→workspace 归属） | mux 流消费必须带归属维度 |
| `plugins.ts` | 插件桥：profile 层叠清单 + GitHub `topic:dsh-plugin` 发现 + `dsh plugin` CLI 转发 | — |
| `updater.ts` + `update-injector.ts` | electron-updater + 向上游 logoRow 注入安装按钮（`kcoder://install-update` 深链） | — |
| `brand-injector.ts` | 品牌化：侧边栏展开/rail 鲸鱼换 KCoder 标（`assets/brand-k.png`）、新会话 hero 鲸鱼+slogan（中「所思，皆可成码」/英 "Think it, code it."，CJK 自适应；预览徽章藏起）、`document.title` 产品名替换（拦截 setter）。⚠ 只能藏起+旁插/改 .data，不能 replaceWith/改 textContent（React removeChild 崩树） | §8；“再生成品牌图”同源 |
| `attach-picker.ts` | 附件按钮改造：拦截 drag-to-attachment 插件的模式按钮 → 原生文件对话框 → 合成 drop → 插件 fast path | §8 自毁坑 |
| `style-settings.ts` | 样式定制设置行：上游设置面板通用区注入密度/列宽方块行（console 通道写回 → `refreshStyleOverlay` 即时生效） | §8 类名克隆 |
| `stats-hover.ts` | 会话统计图表面板：hover 输入框下方 StatsLine 缩略条 → 视口底部弹出自绘图表 | — |
| `theme-watcher.ts` | 深浅色跟随（`body[data-ds-dark-theme]`） | — |
| `upstream.ts` | 上游状态检测 + 同步流水线（fetch→脏检查→ff-only→install→build） | — |
| `menu.ts` / `ipc.ts` / `store.ts` | 菜单与托盘 / IPC 分发 / 持久化 | — |

渲染端（`desktop/renderer/src/views/`）：`landing`（KCoder 欢迎屏）、`splash`、
`setup`、`diagnostics`、`sync`、`plugins`、`preferences`，
hash 路由，无框架，纯 TS + 手写 DOM。

## 5. 上游克隆的特殊性（重建时踩过）

KCoder 的 `deepseek-harness/` 原是 submodule，重建时已**扶正为独立克隆**：

- `.git` 是真实目录（曾是指向 `.git/modules/` 的文件，导致 `scripts/setup.sh` 的
  `-d "$UPSTREAM/.git"` 判定失败——若未来再遇到「克隆已存在但仍重新 clone」报错，
  检查这里）；
- HEAD 与基线验证过的上游 commit 一致（`47f9438`），remote 指向官方
  `deepseek-ai/deepseek-harness`；
- 上游依赖已装、已构建（`apps/cli/lib/bin.js` 在位）。

**升级上游**：应用内菜单「上游 → 同步上游仓库…」或 `pnpm sync-upstream`；
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

上游若变更以下约定，只需更新对应位置（完整版含上游源码依据见根 README）：

| 契约 | 落点 |
|---|---|
| 就绪行 `dsh web: http://…` / bin 路径 / DSH_HOME / Node engines | `dsh-contract.ts` |
| `dsh plugin --profile web …` CLI 形态 / `dsh.profile.bundles` 层叠 | `plugins.ts` |
| 侧边栏 `logoRow`/`collapsed`、布局列 `sidebarCol/centerCol/detailsCol`、会话行 fiber `props.node.id` | 各注入模块（`scripts/verify-inject.cjs` 可自动化验证） |
| 主题落点 `body[data-ds-dark-theme]` / sidebar-fill token | `theme-watcher.ts`、`style-overlay.ts`（`scripts/verify-theme.cjs`） |
| workspace RPC `POST /api/workspace.list`（sessionIds 归属） | `workspace-probe.ts`（页面侧探针）、`file-activity.ts`（主进程归属映射） |

## 8. 开发惯例与经验坑（基线会话沉淀，务必继承）

### 验证链（每次改动的标准收尾）

```sh
pnpm typecheck && pnpm build
# 产物关键串断言（防陈旧产物——压缩会改变量名，断言要用裸字符串而非属性链）
grep -c -F "关键串" out/main/*.js
# 注入脚本（PAGE_JS 模板字符串）语法检查：从源文件抠出模板串再 new Function 校验
```

### 协作惯例

- GUI 不由 AI 验证：AI 交付验证清单 → 用户重启 app 实测 → 用户说提交才提交；
  push 永远由用户执行。
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
| 加/改 CSS 注入 | `main/style-overlay.ts`（注意锚点策略） |
| 加面板页面 | `renderer/src/main.ts` 路由表 + `views/` 新文件 + `shared/ipc-contract.ts` + `main/ipc.ts` |
| 升级上游 | `pnpm sync-upstream` → 查 §7 清单 → `scripts/verify-*.cjs` |
| 重新生成品牌图 | app 图标 `assets/icon.png`/`renderer kcoder.png` 是手动放置的自有品牌图（勿覆盖）；托盘/侧边栏图由它派生：`python3 scripts/make-tray-icons.py`（黑底 keying 取 K 形状 alpha → 包围盒裁剪 → 32px 托盘双产物 + 64px `brand-k.png` 供 brand-injector 嵌入） |
| ⚠ 托盘图覆盖坑 | `pnpm icons`（make-icons.cjs 产上游鲸鱼图）会覆盖已品牌化的 `assets/tray*.png`——运行后需重跑 make-tray-icons.py |
| 发布 | `package.json` 版本 → 提交 → tag push（CI 三平台，见根 README） |

## 11. Roadmap

- [x] 品牌化：托盘/侧边栏/新会话 hero/窗口标题（`make-tray-icons.py` + `brand-injector.ts`）
- [ ] 全局快捷键唤起、deep link（`kcoder://`）
- [ ] 面向 KCoder 产品定位的交互迭代（基于 `assets/legacy/` 逐步移植）
- [ ] Windows / Linux 打包验证
