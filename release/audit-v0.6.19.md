# 全仓库审计报告 — v0.6.19

> 审计日期：2026-09-29 · 范围：上游基线 0.1.7-rc.2 → **0.2.0-rc.1** 升级提交（`2276e2f` + 文档回填）与随包 bundle 同步。分析依据：[docs/upstream-0.2.0-rc.1-analysis.md](../docs/upstream-0.2.0-rc.1-analysis.md)，执行记录：[docs/upstream-0.2.0-rc.1-upgrade-plan.md §20](../docs/upstream-0.2.0-rc.1-upgrade-plan.md)。

## 硬性门

| 门 | 结果 | 说明 |
|---|---|---|
| TYPECHECK | ✅ PASS | tsc 双 project 零错误；注入脚本自检通过（**20** 个注入脚本 / **47** 个源文件，零悬空引用，bundle client 半协议合规） |
| LINT | ✅ PASS | oxlint **5 warning / 0 error**（数量与升级前一致，无安全类新增） |
| SECURITY | ✅ PASS | 生产依赖无 high+ 漏洞 |

## 升级专项验收（本版核心风险面）

| 项 | 结果 | 证据 |
|---|---|---|
| fork 集成分支 `kcoder/0.2.0-rc.1` @ `4cbc050f` | ✅ | install / build / typecheck 三绿；5 处 merge 冲突全部按「结构以上游为基底、语义以我方为准重放」处置 |
| 两自研插件 peer 兼容闸门 | ✅ | peer 统一 `>=0.1.7-rc.2 <1.0.0`，两引擎版本下逐条 semver 求值全过；**真实引擎实证**：升级前旧插件被 `skipping profile bundle` 跳过（warning、进程照常），换新插件后 stderr 全空 |
| 策略层组合结果 | ✅ | `DSH_HOME=~/.kcoder-dev dsh --profile web --dump-config --patch <策略层>` exit 0、无告警；10 行终值逐条核对（三行调度由 schedule bundle 插入且未禁用 / session-log 强制关 / 新开关隐藏 / 两行遥测显式关 / 原有四项不变） |
| GUI 冒烟（10 支） | ✅ 7 过 | settings-anchors（10/10 含判别力自检）、brand-badge、sidebar-toggle、mcp-dom、context-tab、workspace-header、account-chip |
| bundle 版本线 | ✅ | `check-bundle-version-line.mjs` 通过（声明同线 + 内容变更伴随版本变更） |

## 报告项（逐条处置）

### DEAD EXPORTS（2 项）

| 项 | 处置 |
|---|---|
| `desktop/main/remote-connections.ts:42 - openRemoteHostIds` | **豁免**：远程主机子系统的公开查询面，保留给后续远程窗口菜单消费；与升级无关（升级未触碰该文件逻辑，仅注释） |
| `desktop/main/remote-server.ts:260 - remoteInstallReady` | **豁免**：远程安装就绪态的导出面，属远程工作区 B-β 线的预留 API；与升级无关 |

### UNUSED DEPS（10 项）

全部**沿用既有豁免**（v0.6.17 同清单）：`electron-vite`、`@types/node`、`electron`、`@shared/ipc-contract`、`semver`、`@types/semver`、`yaml`、`electron-updater`、`react`、`react-dom` —— 其中 electron/react 系为 peer 性质由 electron-vite 消费，semver/yaml 在 main 进程经 CJS 依赖图使用（审计工具按 ESM import 计）。本版无新增。

## 本版已知未决（非审计门）

| # | 项 | 定性 |
|---|---|---|
| 1 | `patchgate` 红：prod profile `dsh-context` 已漂 0.59.2，补丁键仍 `@0.55.0` | **既有债务**（prod 清单在升级前即为 `^0.59.2`）；按升级计划 B-1 本轮冻结；发版前需按 `update-profile-plugins.mjs --check` 指引逐 hunk 取证重出 patch |
| 2 | `smoke-panel-buttons` FAIL | **既有**：`SHIFT_JS` 平移清单（panel-buttons.ts:46-48）从未含第四枚 git 按钮；涉事文件在 `2e762f5..HEAD` diff 为空 |
| 3 | `smoke-skills-dom` / `smoke-skills-page` 挂起 | **既有**：`skills-settings.ts:77` 的 `MEDIA_MODEL_GROUPS` 为构建期插值，冒烟按原文提取 eval 必然未定义引用；涉事文件 diff 为空 |

## 本版改动面（审计覆盖范围）

- `upstream/BASELINE`、`scripts/setup.sh`、`scripts/release.sh`、`desktop/main/{dsh-contract,preset-plugins,product-policy,brand-injector,remote-server}.ts`（6 处版本字面量 + 策略层 + 锚点）
- `bundle/{dsh-coding-sidebar,dsh-file-review-kcoder,dsh-ssh-remote}`（镜像同步，1.0.35 / 1.0.11 / 0.1.3）
- fork 侧 `kcoder/0.2.0-rc.1`（73 文件偏离面重放，详见 BASELINE 升级记录）
- 两插件仓 `>=0.1.7-rc.2 <1.0.0` peer 重写 + 侧边栏任务计划递归扫描

## 结论

升级提交通过全部硬性门与升级专项验收；报告项全部沿用既有豁免或给出门禁外定性与证据。三个已知未决均为既有技术债（涉事文件在本版 diff 为空或显式冻结），不阻塞本版发布，已登记至升级计划 §20.3 交接项。
