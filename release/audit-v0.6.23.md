# 全仓库审计报告 — v0.6.23

> 审计日期：2026-10-03 · 范围：v0.6.22（`c544179` tag）→ `9b1fd99` 的改动面 + 本版发行文件。上游基线与 v0.6.22 相同（0.2.0-rc.2 / 639ed01539，fork 集成分支 `kcoder/0.2.0-rc.2` @ `b428f93a79`），**本版为插件管理的缺陷修复，无基线变化**。根因、证据与验证记录见 [plans/ssh-provider-plugin-anomaly.md](../plans/ssh-provider-plugin-anomaly.md)。

## 硬性门

| 门 | 结果 | 说明 |
|---|---|---|
| TYPECHECK | ✅ PASS | tsc 双 project 零错误；注入脚本自检通过（20 个注入脚本 / 47 个源文件，零悬空引用，bundle client 半协议合规）；远端 addon 规格门 25 项全过 |
| LINT | ✅ PASS | oxlint **3 warning / 0 error**，全为 `no-unused-vars`：`remote-server.ts:493`（patch）、`remote-server.ts:569`（pickPort）、`remote-connections.ts:102`（fail）。三条所在文件本版 diff 为空；无安全类（eval 等） |
| SECURITY | ✅ PASS | `pnpm audit --prod --audit-level=high`（固定走 npmjs 官方 registry）无 high+ 漏洞 |

命令：`node scripts/audit.mjs` → 退出码 0。

## 报告项（逐条处置）

### DEAD EXPORTS（2 项）

| 项 | 处置 |
|---|---|
| `desktop/main/remote-connections.ts:42 - openRemoteHostIds` | **豁免**：远程主机子系统的公开查询面，保留给后续远程窗口菜单消费（v0.6.19 / v0.6.20 同项同理由） |
| `desktop/main/remote-server.ts:289 - remoteInstallReady` | **豁免**：远程安装就绪态的导出面，属远程工作区 B-β 线的预留 API（同上；行号随 0.6.21/0.6.22 的远端改造位移） |

> `desktop/shared/ipc-contract.ts` 的契约面类型由 `audit.mjs` 内置豁免规则覆盖（该规则在 Windows 反斜杠路径下的失配已于 v0.6.20 修好）。

### UNUSED DEPS（10 项）

`electron-vite`、`@types/node`、`electron`、`@shared/ipc-contract`、`semver`、`@types/semver`、`yaml`、`electron-updater`、`react`、`react-dom` —— 全部**沿用既有豁免**（v0.6.17 起同清单）：electron/react 系为 peer 性质由 electron-vite 消费，semver/yaml 在 main 进程经 CJS 依赖图使用（审计工具按 ESM import 计）。本版无新增。

## 本版改动面（审计覆盖范围）

| 文件 | 性质 |
|---|---|
| `desktop/main/plugins.ts` | 插件操作并发闸（`claimPluginOp`，**任何 await 之前**占位）+ 看门狗（10 分钟杀进程树）+ 实装版本追踪回传 + 更新改精确版本（`add <pkg>@<registry latest>`） |
| `desktop/main/dsh-manager.ts` | 引擎每次 `start()` 前补齐内置 bundle 实体（首次启动 / 用户重启 / 崩溃自动重启统一） |
| `desktop/renderer/src/views/plugins.ts` | 动作按钮登记 `data-plugin-action`（在飞禁用，含**在飞期间新建**的按钮与「重启引擎」按钮）；`run()` 区分「被拒（busy）/失败」并在 `versionChange.unchanged` 时显示「⚠️ 版本未变」 |
| `desktop/shared/ipc-contract.ts` | `PluginCommandResult` 增 `busy` / `versionChange`（含成因注释） |
| `plans/ssh-provider-plugin-anomaly.md` | 根因链、决策、UI 验证记录、既存隐患修复记录 |

## 验证（本版核心风险面）

三条缺陷都用**真机证据**闭环（开发态实例 + Playwright 真 IPC；已装 0.6.22 是 asar，不含改动，故走源码态）：

| 项 | 证据 |
|---|---|
| 并发闸（主进程） | 同包并发两次 → 第二个 `busy:true` + 明确文案；首个返回自洽 `versionChange`；操作结束后闸释放（3/3） |
| 并发保护（渲染层） | 在飞期间动作按钮全禁用（已安装表 9/9）；**在飞期间重渲染出的新按钮**同样禁用；结束后解除（B1/B1b/B1c） |
| 「版本未变」显性化 | `unchanged` → 渲染「⚠️ 版本未变（1.0.36 → 1.0.36）…」而非「✅ 完成」（B2） |
| 「被拒」文案 | `busy` → 渲染「⚠️ 已拒绝：同一时刻只能进行一项插件操作…」（B3） |
| 精确版本更新 | 真实点击「更新」：`dsh-coding-sidebar 1.0.36 → 1.0.37`（heal 日志 `exit=0` + 磁盘版本一致）；registry 为 **npmmirror** ⇒ 滞后镜像上同样生效 |
| 重启补齐 bundle（本版第三处修复） | 先布置隐患态（声明+安装进 lockfile → 摘掉声明）→ 真实更新后 `dsh-coding-sidebar` / `dsh-file-review-kcoder` 实体被剪掉且仍在 `bundles` 声明里（**隐患复现**）→ 真 `dshRestart()` ⇒ **实体 2 秒内被补回**、引擎转入 starting（3/3） |

## 本版已知未决（非审计门）

| # | 项 | 定性 |
|---|---|---|
| 1 | `smoke-panel-buttons` FAIL | **既有**：`SHIFT_JS` 平移清单从未含第四枚 git 按钮（v0.4.6 起）；本版 diff 未触及该文件 |
| 2 | `smoke-skills-dom` / `smoke-skills-page` 挂起 | **既有**：`skills-settings.ts` 的构建期插值常量与冒烟提取方式不匹配（v0.5.9 起）；本版 diff 未触及该文件 |
| 3 | `brand-assert.mjs` 在 Windows + Git Bash 下用**绝对路径**调 tar 会撞 `Cannot connect to D:` | **既有、平台局部**：CI 传相对路径故三平台不受影响；macOS 的 BSD tar 无此问题。本版新增的 `verify-runtime-providers.mjs` 已用「切目录 + 基名」写法规避；建议下轮统一 |

## 结论

硬性门全过；报告项全部沿用既有豁免或给出证据性定性；本版三处修复均有真机红-绿验证（含隐患复现 → 修复生效的对照）。**建议发布。**
