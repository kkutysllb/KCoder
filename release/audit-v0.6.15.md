# 全仓库审计报告 — v0.6.15

> 审计日期：2026-09-20 · 审计命令：`bash scripts/release.sh audit` · 结果：**三门 PASS**。
> 本版无新增发现项：LINT 0 warning、DEAD EXPORTS 0 项待处置、SECURITY 无 high+ 漏洞。

## 硬性门

| 门 | 结果 | 说明 |
|---|---|---|
| TYPECHECK | ✅ PASS | tsc 双 project 零错误；链尾注入脚本自检通过（抽取 **20** 个注入脚本 / **41** 个源文件，零悬空引用，bundle client 半协议合规）。较 v0.6.14 少 1 脚本 / 1 源文件 = 本版删除的 `desktop/main/style-settings.ts` |
| LINT | ✅ PASS | oxlint 全仓库 **0 warning / 0 error** |
| SECURITY | ✅ PASS | 生产依赖无 high+ 漏洞（`pnpm audit --prod`） |

## 发现项与逐条处置

**本版无新增发现项**（v0.6.14 的 3 条 LINT warning 已在其版本内处置完毕，本版未回归）。

## 报告项（逐条沿用既有处置）

- **DEAD EXPORTS：0 项待处置**，另有 3 项已知豁免（`electron.vite.config.ts` 默认导出 ×1 = 构建链配置入口；`desktop/shared/ipc-contract.ts` ×2 = node/web 双 project 的 IPC 契约面类型，按设计导出）。清单与 v0.6.11~v0.6.14 完全一致。
  - 本版删除了 `style-settings.ts`（其唯一导出 `attachStyleSettingsInjector` 的消费点在 `windows.ts` 同步摘除）与 `style-overlay.ts` 的 `buildOverlayCss` / `refreshStyleOverlay` 导出——**未新增未消费导出**：`buildOverlayCss` 改为模块内函数、注入入口收敛为唯一导出 `attachStyleOverlay`。
- **UNUSED DEPS：10 项**（electron-vite, @types/node, electron, @shared/ipc-contract, semver, @types/semver, yaml, electron-updater, react, react-dom）——与 v0.6.0/v0.6.1/v0.6.11~v0.6.14 **逐项完全一致**，属 depcheck 对 Electron 应用的固有误报：`electron`/`electron-vite`/`react`/`react-dom` 经构建链与运行时消费，`semver`/`yaml`/`electron-updater` 经主进程动态路径消费，`@shared/ipc-contract` 为路径别名导入（depcheck 不解析 tsconfig paths）。豁免沿用，不重复处置。

## 本版改动面（审计覆盖范围）

- **修复**：`account-chip.ts` 折叠态点击（漏点在绘制/命中顺序，补 z-index + 注释固化为"必要条件"）；`scripts/dev.mjs` 启动前剥离继承的 `ELECTRON_RUN_AS_NODE`；`scripts/smoke-sidebar-toggle.mjs` 保真度（排布值改从源码提取 + 三层断言 + 顶层 throw 改 `die()`——throw 会让 Electron 主进程不退出，实测挂到 240s 超时）。
- **功能下线**：`style-settings.ts` 整删（270 行）；`style-overlay.ts` 400 → 153 行，保留原生右侧栏外壳压制、侧栏「插件」入口压制、空会话 K 水印（三段恒定生效）；随之移除 `StyleSettings` 契约、`store` 的 `style` 字段与 `DEFAULT_STYLE`、`ipc.ts` 档位校验与样式写回分支、`about-settings` 功能条目、`preset-plugins` 之外的悬空注释（含两处 2026-09-11 已退役的「回答语言」残留）。
- **菜单**：`menu.ts` 工具子菜单与托盘菜单各移除「设置（上游初始化）」「同步上游仓库」；面板路由与窗口类型保留；README / ARCHITECTURE 入口说明同步。
- **上游 alpha.2 适配物化**：`bundle/` 五包同步 + `PRESET_PLUGINS` 平移 `^1.0.26` / `^1.0.7`（双源可见已核）。
- **文档/工具**：新增 `scripts/smoke-account-chip.mjs`（189 行）；README 增 `ELECTRON_RUN_AS_NODE` 排障条目；ARCHITECTURE 模块表与契约表同步。

## 复检结论

| 复检项 | 命令 | 结果 |
|---|---|---|
| 全仓库审计 | `bash scripts/release.sh audit` | 三门 PASS / LINT 0 warning |
| 注入脚本自检 | `node scripts/check-injected-scripts.mjs` | exit 0（20 脚本 / 41 源文件，零悬空引用，client 半协议合规） |
| 内置镜像对账 | `node scripts/sync-bundles.mjs --check` | **零差异**。复检前报 4 处（bundle/ 停在 09-19 12:19，插件仓 15:41~15:55 又有提交并已镜像）：terminal 补 `pnpm-workspace.yaml`（pnpm 11 allowBuilds 放行 node-pty 构建脚本）+ lockfile + 测试套件，file-review `lib/client.js`——后者逐行核为**纯 key 重排**（9347 行；真新增/移除各 8 行全部由末位键尾逗号位置造成，键值对集合一致），非逻辑变更 |
| 插件侧门禁（终态） | dsh-terminal `npm run smoke` / dsh-file-review-kcoder `npm run smoke` | terminal **15/15**；file-review smoke + render **13/13** |
| 桌面侧冒烟 | `smoke-sidebar-toggle` / `smoke-account-chip` / `smoke-brand-badge` | 三套 **ALL PASS**（含排布三层断言与命中归属断言） |
| 产物核对 | 构建后逐项 grep `out/main/index.js` | 已移除：桌面样式定制/正文密度/消息列宽/正文字号/`__dsh_desktop_style_item`/`--dsw-font-markdown-base`/`toBottomSlot`；在位：两段外壳压制 + K 水印三段、`attachStyleOverlay`、`__dsh_desktop_style_override` |
| dev 启动（脏环境） | `ELECTRON_RUN_AS_NODE=1 node scripts/dev.mjs build` | 打印剥离提示且 exit 0；干净环境无提示 exit 0 |
| 发版硬前提 | `git -C ~/kk_Projects/deepseek-harness status -sb` | fork 集成分支 `kcoder/0.1.6-alpha.2` 与 origin 齐平（领先 0），符合"fork 先推送"约定 |
