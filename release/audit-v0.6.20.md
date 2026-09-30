# 全仓库审计报告 — v0.6.20

> 审计日期：2026-10-01 · 范围：v0.6.19（`5d85332` tag）→ `ef4dc54` 的改动面 + 本版未提交的发行文件。上游基线与 v0.6.19 相同（0.2.0-rc.2 / 639ed01539，fork 集成分支 `kcoder/0.2.0-rc.2` @ `b428f93a79`），**本版为纯缺陷修复，无基线变化**。根因分析、证据与验证记录见 [plans/ssh-provider-plugin-anomaly.md](../plans/ssh-provider-plugin-anomaly.md)。

## 硬性门

| 门 | 结果 | 说明 |
|---|---|---|
| TYPECHECK | ✅ PASS | tsc 双 project 零错误；注入脚本自检通过（20 个注入脚本 / 47 个源文件，零悬空引用，bundle client 半协议合规） |
| LINT | ✅ PASS | oxlint **5 warning / 0 error**；5 条全为 `no-unused-vars`（`remote-server.ts` ×4、`remote-connections.ts` ×1），均为既有项、本版 diff 未触及这两个文件；无安全类（eval 等） |
| SECURITY | ✅ PASS | `pnpm audit --prod --audit-level=high`（固定走 npmjs 官方 registry）无 high+ 漏洞 |

命令：`node scripts/audit.mjs` → 退出码 0。

## 报告项（逐条处置）

### DEAD EXPORTS（2 项）

| 项 | 处置 |
|---|---|
| `desktop/main/remote-connections.ts:42 - openRemoteHostIds` | **豁免**：远程主机子系统的公开查询面，保留给后续远程窗口菜单消费（v0.6.19 报告同项同理由） |
| `desktop/main/remote-server.ts:260 - remoteInstallReady` | **豁免**：远程安装就绪态的导出面，属远程工作区 B-β 线的预留 API（v0.6.19 报告同项同理由） |

> `desktop/shared/ipc-contract.ts` 的契约面类型由 `audit.mjs` 内置豁免规则覆盖（本次同时修好了该规则在 Windows 反斜杠路径下的失配，见下）。

### UNUSED DEPS（10 项）

`electron-vite`、`@types/node`、`electron`、`@shared/ipc-contract`、`semver`、`@types/semver`、`yaml`、`electron-updater`、`react`、`react-dom` —— 全部**沿用既有豁免**（v0.6.17 起同清单）：electron/react 系为 peer 性质由 electron-vite 消费，semver/yaml 在 main 进程经 CJS 依赖图使用（审计工具按 ESM import 计）。本版无新增。

## 本版改动面（审计覆盖范围）

| 文件 | 性质 |
|---|---|
| `desktop/main/preset-plugins.ts` | 删除 `PRESET_RUNTIME_DEPS` 的 profile 依赖通道，改 `RUNTIME_PROVIDED_PACKAGES` 仅作自愈三清（声明 + 实体 + 层叠污染） |
| `scripts/materialize-peers.mjs` | 新增内置 provider 供给块（版本自 staging 同线包推导、隔离目录安装、登记进引擎清单） |
| `scripts/verify-runtime-providers.mjs`（新增） | 产物级随包断言（目录 / tar.gz 双模式，离线） |
| `scripts/probe-profile-providers.mjs`（新增） | 复刻宿主判定链的排查探针 |
| `scripts/release.sh` | build 段（staging）与 verify 段（打包归档）各接一道 provider 断言 |
| `.github/workflows/release.yml` | 同断言的 CI 平价版（该工作流自行走 deploy + materialize，不经 release.sh） |
| `desktop/main/kcoder-skills-bundle.ts`、`scripts/check-bundle-version-line.mjs`、`docs/remote-workspace-route-b.md` | 注释 / 设计记录同步（含机制查实结论） |
| `plans/ssh-provider-plugin-anomaly.md`（新增） | 排查、决策与验证记录 |
| `scripts/audit.mjs` | 本次修掉的两处 Windows 路径处理（见下） |

## 发版前验证（本机复现 CI 构建链）

在上游 fork 克隆（`kcoder/0.2.0-rc.2` @ `b428f93a79`，含基线 `639ed01539`）上逐段复现 `release.yml` 的构建链，**这是「供给块 + 新门」首次在真实构建产物上执行**：

| 步骤 | 结果 |
|---|---|
| `patchgate` | ✅ 通过（1 份 patch：仓库分发 + 现场 marks + 版本键零漂移 + 声明就位） |
| `verify-vendor-purity.sh` | ✅ 通过（vendor/ 全在白名单） |
| `pnpm deploy --prod --legacy` | ✅ 通过（507 包；平台二进制按当前平台过滤） |
| `materialize-peers.mjs` | ✅ `内置 provider 已登记进引擎清单：…@0.2.0-rc.2` → `已随包供给：4 个` → `自检通过：所有非可选依赖可达且版本满足`；归档 21743 文件 / 147 MB |
| provider 随包门（staging 目录 / 归档） | ✅ 通过（pwsh + bsdtar 与 Git Bash + GNU tar 两种环境均验） |
| 品牌断言 | ✅ 通过（CI 形态：相对路径调用） |
| 运行时冒烟（Electron node 形态） | ✅ 通过（`就绪行 + 首页 200`） |

> 归档破坏性对照：对本机真实 v0.6.19 运行时执行同一道门 → 红（4 处「未登记进引擎清单」），即本版所修缺陷在产物层的形态；对新产物 → 绿。

## 附带修掉的工具链缺陷（Windows）

`release.sh` 在本机 Windows 上无法走完前置门，两处均为**既有缺陷、与本次业务改动无关**，本版一并修掉（对 macOS / CI 行为无影响）：

1. `scripts/audit.mjs`：`new URL('..', import.meta.url).pathname` 在 Windows 上得到 `/D:/…`，`spawnSync` 的 `cwd` 解析失败 → **三门全部误报 FAIL**。改用 `fileURLToPath`。
2. `scripts/audit.mjs`：ts-prune 在 Windows 输出反斜杠路径，而内置豁免规则按 `/` 书写 → 同一份豁免失配、多报 2 项 ipc-contract 契约面类型。匹配前归一。

修后本机审计与 macOS 口径一致（5 warning / 2 dead exports / 10 unused deps / 无 high+ 漏洞）。

**登记但未修**（不在本版范围，未影响 macOS 发布）：`brand-assert.mjs` 在 Windows + Git Bash 下若收到**绝对路径**会撞 `tar: Cannot connect to D:`（GNU tar 把盘符当远端主机）；`release.yml` 传相对路径故 CI 三平台不受影响，macOS 的 BSD tar 亦无此问题。`release.sh build/verify` 本地 Windows 路径因缺 Apple 公证凭据在更后一步终止，故被掩盖。建议下轮统一「切目录 + 基名」调用式。

## 结论

硬性门全过；报告项全部沿用既有豁免或给出证据性定性；本版修复的验证覆盖到真实构建产物（deploy → 供给 → 门 → 品牌断言 → 运行时冒烟全绿），并已在产物层做过红-绿对照。**建议发布。**
