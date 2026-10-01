# 全仓库审计报告 — v0.6.21

> 审计日期：2026-10-01 · 范围：v0.6.20（tag）→ 本版工作区改动面（远端架构自适应 + 内置插件同步 + 热补丁重出 + 发版文件）。上游基线与 v0.6.20 相同（deepseek-harness 0.2.0-rc.2 / `639ed01539`，fork 集成分支 `kcoder/0.2.0-rc.2` @ `b428f93a79`，**领先远端 0 提交**），本版无基线变化。远端缺陷的根因、证据与实机验证见 [plans/remote-arch-adaptation.md](../plans/remote-arch-adaptation.md)、[plans/remote-appledouble-pollution.md](../plans/remote-appledouble-pollution.md)。

## 硬性门

| 门 | 结果 | 说明 |
|---|---|---|
| TYPECHECK | ✅ PASS | tsc 双 project 零错误；注入脚本自检通过；**新增** `scripts/check-remote-addon-specs.mjs`（25 项断言：目标归一 / 拒绝分支 / 命名族双向 / 覆盖度 / 真实树零回归）已接入 `pnpm typecheck` 并通过 |
| LINT | ✅ PASS | oxlint **3 warning / 0 error**（上一版为 5）；3 条全为既有 `no-unused-vars`（`remote-connections.ts` ×1、`remote-server.ts` ×2），本版 diff 未新增；本版重构遗留的 `readdirSync` 未用导入已顺手修掉（5 → 4 → 3，见下）；无安全类（eval 等） |
| SECURITY | ✅ PASS | `pnpm audit --prod --audit-level=high`（固定走 npmjs 官方 registry）无 high+ 漏洞 |

命令：`node scripts/audit.mjs` → 退出码 0；`bash scripts/release.sh prepush` → **全仓库 pre-push 通过**。

## 报告项（逐条处置）

### DEAD EXPORTS（2 项）

| 项 | 处置 |
|---|---|
| `desktop/main/remote-connections.ts:42 - openRemoteHostIds` | **豁免**：远程主机子系统的公开查询面，保留给后续远程窗口菜单消费（v0.6.19 / v0.6.20 报告同项同理由） |
| `desktop/main/remote-server.ts:289 - remoteInstallReady` | **豁免**：远程安装就绪态的导出面，属远程工作区 B-β 线的预留 API（v0.6.19 / v0.6.20 报告同项同理由） |

> 行号随本版 `remote-server.ts` 改动平移（260 → 289），项与理由不变。

### UNUSED DEPS（10 项）

`electron-vite`、`@types/node`、`electron`、`@shared/ipc-contract`、`semver`、`@types/semver`、`yaml`、`electron-updater`、`react`、`react-dom` —— 全部**沿用既有豁免**（v0.6.17 起同清单）：electron/react 系为 peer 性质由 electron-vite 消费，semver/yaml 在 main 进程经 CJS 依赖图使用（审计工具按 ESM import 计）。本版无新增、无移除。

### 本版修掉的自身遗留（1 项）

| 项 | 处置 |
|---|---|
| `desktop/main/remote-server.ts:22 - readdirSync 导入但未使用` | **修复**：本版把 `localAddonSpecs` 迁往 `remote-target.ts` 后该导入失去消费点，直接摘除（不留「本版新增的既有警告」） |

## 本版改动面（审计覆盖范围）

| 文件 | 性质 |
|---|---|
| `desktop/main/remote-target.ts`（新增） | 零依赖目标判据模块：`parseTarget` 归一三元组、`addonSuffixes` / `requiredAddonNames` / `missingRequiredAddons` 覆盖度断言、`localAddonSpecs(runtimeDir, target)`（自 `remote-runtime.ts` 迁入） |
| `desktop/main/remote-server.ts` | 新增 `probeRemoteTarget`（uname + musl 探测）；`addonSpecs` 改为内部按目标派生（保留可选覆盖）；安装前覆盖度硬断言；指纹改为 `引擎|目标三元组|规格`；版本探测改用远端 Node **绝对路径**；addon 安装脚本 `set -e` + 真实 `require` 验活 + 失败即抛（不再无条件报成功） |
| `desktop/main/remote-runtime.ts` | `localAddonSpecs` 迁出，只保留运行时路径/版本/引导探测 |
| `desktop/main/remote-connections.ts` | 不再自行派生规格与传入 |
| `desktop/main/preset-plugins.ts` | 声明线平移 `^1.0.35` → `^1.0.36`（与 bundle 物化同线，附本轮变更摘要注释） |
| `scripts/check-remote-addon-specs.mjs`（新增） | 25 项断言，含「旧谓词在 arm64 上得 0 条」的红-绿对照与真实树零回归 |
| `scripts/fix-remote-arm64-addons.sh`（新增） | 应急补齐脚本（现场不改代码即可修），已入仓备查 |
| `package.json` | `typecheck` 挂上新增断言脚本 |
| `bundle/*`（同步） | `dsh-coding-sidebar` 1.0.35 → **1.0.36**、`@kkutysllb/dsh-terminal` 1.1.1 → **1.2.1**（`sync-bundles.mjs` 镜像同步，`--check` 零差异） |
| `profiles/web/patches/dsh-context@0.62.2.patch` | 热补丁重出到当前实装版本键（`git mv` 保历史，另同步本机 profile 的物化与声明） |
| `release/v0.6.21.md`、`plans/remote-arch-adaptation.md`、`plans/remote-appledouble-pollution.md` | 发版说明与排查/决策记录 |

## 发版前验证

| 步骤 | 结果 |
|---|---|
| `release.sh prepush`（审计 + 补丁闸 + 内置插件版本线 + 设置页锚点冒烟 + 全量构建） | ✅ **全仓库 pre-push 通过** |
| 内置插件版本线 | ✅ 声明同线 + 内容变更伴随版本变更（`dsh-coding-sidebar` 运行时面 19 文件 ⇒ 1.0.35→1.0.36；`dsh-terminal` 4 文件 ⇒ 1.1.1→1.2.1） |
| bundle 对账 `sync-bundles.mjs --check` | ✅ 零差异 |
| 热补丁闸 | ✅ 「1 份 patch：仓库分发 + 现场 marks + 版本键零漂移 + 声明就位」 |
| 设置页注入锚点冒烟 | ✅ 10 项 ALL PASS（本机执行需 `ELECTRON_DISABLE_SANDBOX=1`，见下） |
| **远端实机端到端（26训练，aarch64）** | ✅ 指纹 `4aaa97a9…` → **`110d5c73…`**（与本地按新格式复算逐字节相同）、`addon-specs.txt` 变 7 条 linux-arm64、`addons-install.log` = `added 8 packages in 10s`、`…-linux-arm64-gnu` 绑定在位、服务日志 8226 → **1978 字节带就绪行**、监听 30653 —— **是代码自己装上的** |
| **热补丁重出取证** | ✅ 三方 md5：pristine `dsh-context@0.62.2` = `d8ac91e7…` → 打本 patch 后 `72dd3194…` = **实装产物 `72dd3194…`**（逐字节一致），证明补丁内容对当前版本键完全适用，仅版本键过期 |

> **环境说明（非缺陷）**：设置页冒烟要起真实 Electron，本机在 DSH 文件沙箱下 Chromium 进程无法初始化（`sandbox initialization failed: Operation not permitted`）。加 `ELECTRON_DISABLE_SANDBOX=1` 后 10 项全 PASS，说明断言本身无回归；脚本与 CI 未做任何改动（CI 三平台 runner 无此限制）。

## 结论

硬性门全过；报告项全部沿用既有豁免或已修；本版两个远端缺陷均有**实机端到端证据**（含指纹级复算），热补丁重出有**逐字节取证**。顺带清掉一条自身重构遗留的 lint 警告，并把 v0.6.20 说明里挂账的「声明线平移待下一轮」了结（补丁链不再哑、版本线不再漂移）。**建议发布。**
