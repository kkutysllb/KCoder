# KCoder

KCoder 桌面端：AI 编码工作台。基于 [DSH-Desktop](https://github.com/kkutysllb/DSH-Desktop) v0.1.4 基线构建，引擎为 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）——"一切皆插件"的开源 agent harness，运行时是由 profile 组装出的 Cordis 插件树。

KCoder 遵循同一理念——**宿主与侧车（host & sidecar）关系，而不是 fork**：零修改复用上游的 Web UI、API 网关（Typert Remote + `/api` 桥）、会话持久化（`~/.dsh`）与插件生态（[`dsh-plugin` 社区](https://github.com/topics/dsh-plugin)），自己只负责进程托管、窗口、托盘、上游同步与插件管理的桌面化呈现。

```
┌───────────────────────────── KCoder（Electron）──────────────────────────────┐
│  主进程                                                                        │
│   ├─ DshManager ──spawn──▶ dsh web --port 0（上游侧车，OS 分配端口）            │
│   │                          └─ stdout: "dsh web: http://127.0.0.1:<port>"     │
│   ├─ shell 窗口 ──loadURL──▶ http://127.0.0.1:<port>（上游 Web UI，零改动）    │
│   ├─ 面板窗口（preload 白名单 IPC）：设置 / 诊断 / 同步上游 / 插件             │
│   └─ Upstream/Plugins ──▶ git pull + pnpm build / dsh plugin --profile web …   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## 与 DSH-Desktop 的关系

KCoder 以 DSH-Desktop（v0.1.4，`f29f852`）为基线整仓拷贝起步，两仓库各自独立演进：

- DSH-Desktop 继续作为通用 dsh 桌面壳主线维护；
- KCoder 在此之上做产品化定制（欢迎屏、品牌、面向 KCoder 定位的交互迭代）；
- 上游同步、插件机制、注入契约等基础设施与基线同源，升级检查清单通用（见下文）；
- 原项目（QiLin 时代）的有价值资产保留在 `assets/legacy/`（WelcomeScreen 等源码存档）与 `upstream/`（上游补丁存档）。

## 快速开始

前置：Node.js（≥ 上游要求，见 `deepseek-harness/package.json` 的 `engines.node`）、pnpm、git。

```sh
pnpm install          # 安装桌面端依赖
pnpm setup            # 克隆上游（若缺）+ pnpm install + pnpm run build
pnpm dev              # 开发模式启动
# 或
pnpm build && pnpm start
```

也可在应用内完成：首次启动会进入"设置"页，一键初始化上游。

- 会话/凭据/插件数据在 `~/.dsh`（`DSH_HOME` 可覆盖），与 `dsh` CLI / `npx dsh web` 完全共享。
- 本地打包（仅当前平台）：`pnpm dist`（electron-builder，macOS dmg）。

## 发布与自动更新

发布由 GitHub Actions 驱动（`.github/workflows/release.yml`）：

1. 三平台（macOS / Windows / Linux）matrix 并行构建：CI 现拉上游 `deepseek-harness` 并构建（`scripts/setup.sh`），再 electron-builder 打包；
2. macOS 产物 Developer ID 签名 + 公证（secrets 同基线）；构建后自动校验签名与公证票据，坏包直接失败；
3. 产物汇合后统一发布 GitHub Release（安装包 + `latest*.yml` + blockmap，electron-updater 的发现/增量更新入口）；
4. 发布流程：`package.json` 版本号 → 提交 → `git tag v<x.y.z> && git push origin v<x.y.z>`；
5. 自动更新：应用启动 8s 后静默检测 → 后台下载 → 侧边栏安装按钮/菜单 → 重启安装。

## 图标

KCoder 使用自有品牌图标（继承自原 KCoder 项目）：

- `build/icon.icns` / `icon.ico` / `icon.png`：应用图标（打包用）；
- `desktop/renderer/public/kcoder.png`：欢迎屏 logo 与启动页标志（`build/icon.png` 的副本）；
- `assets/icon.png`：窗口图标；
- `assets/tray.png` / `trayTemplate.png`：托盘图标暂沿用基线资产，后续替换为 KCoder 品牌。

## 目录结构

```
desktop/
├── main/            # Electron 主进程
│   ├── index.ts     # 入口：单实例锁、启动流程、退出序列
│   ├── dsh-contract.ts  # ★ 上游契约适配层（升级上游时唯一要检查的文件）
│   ├── dsh-manager.ts   # dsh 侧车：spawn/就绪解析/崩溃重启/优雅退出
│   ├── upstream.ts  # 上游状态检测 + 同步流水线（fetch→ff-only→install→build）
│   ├── plugins.ts   # 插件桥：profile 层叠清单 + GitHub dsh-plugin 发现 + 安装转发
│   ├── windows.ts   # shell 窗口（无 preload，纯浏览器）与面板窗口
│   ├── terminal-panel.ts # 内嵌终端面板（WebContentsView + 布局跟随）
│   ├── pty-host.ts  # node-pty 会话管理（内嵌终端的真实 shell）
│   ├── menu.ts / ipc.ts / store.ts
├── preload/         # contextBridge 白名单（window.dshDesktop）
├── renderer/        # 本地面板（hash 路由，无框架；views/landing.ts = KCoder 欢迎屏）
└── shared/          # IPC 契约类型（主/渲染两侧唯一事实源）
assets/
├── legacy/          # 原 KCoder 项目资产存档（WelcomeScreen / CommandInput / i18n）
└── *.png            # 窗口/托盘图标
scripts/
├── setup.sh         # 终端版首次引导
├── sync-upstream.sh # 终端版上游同步
└── make-icons.cjs   # 图标栅格化工具（Electron 离屏渲染）
upstream/            # 上游补丁存档（待推上游的改动以 patch 形式留存）
deepseek-harness/    # 上游克隆（.gitignore 排除，绝不提交、绝不修改）
```

## 关键设计

### 集成点：HTTP 侧车而非 fork

上游 Web 前端依赖 host 注入的 `window.__DSH_BOOT__` 启动清单与同源 `/api` 路由、WebSocket 事件流。因此桌面端以 `--port 0` 拉起 `dsh web`，从 stdout 就绪行解析地址后 `loadURL`——所有上游功能零改动可用，上游升级自动跟随。

### 安全边界

- shell 窗口：`sandbox: true`、无 preload、`webSecurity` 开启；`will-navigate` 只允许停留在 `127.0.0.1`，外链转系统浏览器；权限请求一律拒绝。
- 面板窗口：contextIsolation + 白名单 IPC（见 `desktop/shared/ipc-contract.ts`），渲染端零 Node 能力。

### 进程纪律

- `--port 0` 由 OS 分配端口，不与用户自起的 `dsh web`（默认 3080）冲突。
- 退出序列：SIGTERM → 5s 宽限 → SIGKILL，绝不留孤儿 dsh 进程。
- 崩溃自动重启（指数退避，最多 3 次），失败转设置页引导。

### 一切皆插件的桌面化

- 已装插件 = profile 层叠（`~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles`）。
- 安装/卸载/更新直接转发上游 CLI：`dsh plugin --profile web add|remove|update <pkg>`。
- 社区发现：GitHub Search API（`topic:dsh-plugin`），5 分钟内存缓存规避限额。
- 插件变更属于 profile 组合，面板提供"重启 dsh 生效"。

### 自动更新（electron-updater + GitHub Releases）

发布源为本仓库（kkutysllb/KCoder）的 GitHub Releases：启动后 8s 静默检测 → 后台下载 → 侧边栏安装按钮（注入上游 Web UI 的 `logoRow`，零修改上游代码）→ 优雅关停 dsh 后 `quitAndInstall`。

## 跟进上游

上游处于 developer preview，会有破坏性变更。同步流程：

```sh
# 应用内：菜单「上游 → 同步上游仓库…」，或终端：
pnpm sync-upstream
```

### 升级契约检查清单（`desktop/main/dsh-contract.ts`）

上游若变更以下约定，只需更新该文件：

| 契约 | 依据 |
|---|---|
| 就绪行 `dsh web: http://127.0.0.1:<port>` | `packages/bundle/web-app/src/index.ts` `printUrl` |
| CLI flags `web --port 0` | `packages/bundle/web-app/src/startup.ts` |
| 构建产物 `apps/cli/lib/bin.js` | `apps/cli/package.json` `bin` |
| Harness home `~/.dsh` / `DSH_HOME` | `packages/util/home-paths` |
| 插件管理 `dsh plugin --profile <name> <pnpm args>` | `apps/cli/src/plugin.ts` |
| Profile 层叠 `dsh.profile.bundles` | `packages/boot/app-boot/src/profile.ts` |
| 侧边栏 `logoRow` / `collapsed` DOM 类名 | `packages/client/ui-sidebar/src/client/SidebarRoot.tsx`（`scripts/verify-inject.cjs` 可验证） |
| 主题落点 `body[data-ds-dark-theme]` + `documentElement.style.colorScheme` | `packages/client/ui-theme/src/client/index.ts`（`scripts/verify-theme.cjs` 可验证） |
| 标题栏色 token sidebar-fill 与根布局 `html,body,#root{height:100%}` | `packages/client/ui-theme/src/styles/design-platform.css` + `packages/client/web/src/base.css` |
| 标题栏文字 = `document.title` | `packages/client/web/src/DocumentTitle.tsx` |
| 会话行选中态 `[role="treeitem"][aria-selected]` + React fiber `props.node.id` | `packages/client/ui-workspace/src/client/rows/Rows.tsx` |
| workspace RPC `POST /api/workspace.list` | `packages/host/apiproxy/src/fetch/handler.ts` UNARY_ROUTES |
| 布局列 `[class*="sidebarCol"]` / `[class*="centerCol"]` / `[class*="detailsCol"]` | `packages/client/ui-layout/src/client/AppFrame.tsx` |
| Node 版本要求 `engines.node` | 根 `package.json` |

### 仓库卫生

- `deepseek-harness/` 被 `.gitignore` 排除：上游是独立 git 克隆（remote 指向 deepseek-ai），本仓库不提交、不修改其中任何文件（含 lockfile）。
- 对上游的一切定制通过官方扩展点（patch / 插件 / profile）实现，不做 vendor fork。
- 有价值但暂未推上游的改动存档于 `upstream/`（见其 README），推上游后随正常升级流水线回到本仓库。

## 环境变量

| 变量 | 作用 |
|---|---|
| `DSH_BIN` | 显式指定 dsh 启动命令（优先于本地克隆与 PATH） |
| `DSH_HOME` | 覆盖 dsh 数据目录（默认 `~/.dsh`） |

## Roadmap

- [ ] 托盘图标品牌化
- [ ] 全局快捷键唤起、deep link（`kcoder://`）
- [ ] 面向 KCoder 产品定位的交互迭代（基于 `assets/legacy/` 原项目资产逐步移植）
- [ ] Windows / Linux 打包

## License

MIT（上游 deepseek-harness 亦为 MIT，见其 THIRD_PARTY_NOTICES.md；基线 DSH-Desktop 为 MIT）
