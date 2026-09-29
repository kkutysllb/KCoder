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
| 1 | ~~`patchgate` 红：`dsh-context` 补丁键仍 `@0.55.0`，实装已 v0.60.0~~ | **已解决（2026-09-30）**：对纯净 `dsh-context@0.60.0` 逐 hunk 取证——两处修复（RO 回路冷却 / kcCtxJumpViaTab）上下文同形、`patch -p1 --dry-run` 干净应用、归一后与旧补丁**逐行等价**（仅行号重基）→ 重出 `profiles/web/patches/dsh-context@0.60.0.patch`；同步修 `update-profile-plugins.mjs` 的精确键重出口径（旧键不重写导致「脚本报已同步 / 闸门报缺声明」矛盾）；dev + prod 声明均已重出，`--release-gate` 双绿 |
| 2 | `smoke-panel-buttons` FAIL | **既有**：`SHIFT_JS` 平移清单（panel-buttons.ts:46-48）从未含第四枚 git 按钮；涉事文件在 `2e762f5..HEAD` diff 为空 |
| 3 | `smoke-skills-dom` / `smoke-skills-page` 挂起 | **既有**：`skills-settings.ts:77` 的 `MEDIA_MODEL_GROUPS` 为构建期插值，冒烟按原文提取 eval 必然未定义引用；涉事文件 diff 为空 |

## 本版改动面（审计覆盖范围）

- `upstream/BASELINE`、`scripts/setup.sh`、`scripts/release.sh`、`desktop/main/{dsh-contract,preset-plugins,product-policy,brand-injector,remote-server}.ts`（6 处版本字面量 + 策略层 + 锚点）
- `bundle/{dsh-coding-sidebar,dsh-file-review-kcoder,dsh-ssh-remote}`（镜像同步，1.0.35 / 1.0.11 / 0.1.3）
- fork 侧 `kcoder/0.2.0-rc.1`（73 文件偏离面重放，详见 BASELINE 升级记录）
- 两插件仓 `>=0.1.7-rc.2 <1.0.0` peer 重写 + 侧边栏任务计划递归扫描

## 结论

升级提交通过全部硬性门与升级专项验收；报告项全部沿用既有豁免或给出门禁外定性与证据。三个已知未决均为既有技术债（涉事文件在本版 diff 为空或显式冻结），不阻塞本版发布，已登记至升级计划 §20.3 交接项。

---

## rc.2 增量段审计（2026-09-30 追加：v0.6.19 双锚定收口）

本段在 rc.1 段之上把基线推到 0.2.0-rc.2（639ed01539，fork 集成分支 `kcoder/0.2.0-rc.2` @ 5295828ae5）。**KCoder 版本号不动（0.6.19），一次发版锚定两个上游版本。**

### 本段改动面（增量）

- `upstream/BASELINE`（钉版行 + 升级记录）、`scripts/setup.sh`、`scripts/release.sh`、`desktop/main/{dsh-contract,remote-server}.ts`（分支/引擎字面量）
- `desktop/main/preset-plugins.ts`：调度 bundle + 4 SSH 钉版 `0.2.0-rc.1` → `0.2.0-rc.2`；**2.5 步对账补精确钉预发布标签感知**（三元组比较看不见 rc 后缀，升级现场会留混装 → 启动卡死；精确钉按版本串全等判过旧）
- `desktop/main/brand-injector.ts` `swapTurnStatus`：匹配 rc.2 无点形态 `'Deep diving'`（旧带点形态保留兜底），替换目标 `'KCoder'` / `'KCoder for '`（D7 跟随上游排版）
- `scripts/brand-assert.mjs`：断言串同步 `'KCoder'`（无点）
- fork 侧 24 文件重叠重放（pi-ai src/tests/补丁、ui-chat 品牌串、ToolRow 收敛、版本戳）；锁文件=上游 rc.2 基座+我方补丁 hash（净差 22+/7-）

### P0 验收证据

| 项 | 证据 |
|---|---|
| 集成分支三绿 | install / build / typecheck 全 exit 0（BASELINE 升级记录留档） |
| 上游自测泳道（前台） | 12397/12399；仅剩 2 败 = `connection/binary-rpc.host.spec` HTTP bridge 5s 超时——单跑 46/46 全过、fork 对该包 diff 为空，定性并行负载抖动 |
| pi-ai 补丁 | 与 rc.1 分支字节一致（diff=0）；`_patch_hash=8d2124eb…` 双侧（node_modules 实装 + 锁文件记录） |
| 插件零发版 | 两插件全部引擎 peer 在 rc.2 下 semver 求值 PASS（D5 耐久范围兑现）；bundle 镜像零漂移 |
| 品牌四层同值 | locale（源头）→ spec 19+9 处（编译期）→ brand-assert（产物期）→ DOM 注入（运行期） |

### 未决（承接 + 本段新增）

1-3 承接 rc.1 段不变（patchgate dsh-context 键漂移 / panel-buttons / skills 冒烟）。
4. `binary-rpc.host.spec` 2 例并行负载抖动：上游文件、非本版引入（如上定性），登记观察，不在本版处理。

## 补充：桌面公告抑制（用户报障）验证证据（2026-09-30 追加）

| 层 | 证据 |
|---|---|
| 前提（真实渲染进程） | 以 KCoder shell 同配置（`sandbox:true` + `contextIsolation:true` + **无 preload**）真实加载 dev 服：`navigator.userAgent` 含 `Electron/44.0.0` ✓、`'dshDesktop' in globalThis` = false ✓（即上游原判定会注册公告，我方 Electron 判定会跳过） |
| 生效（服务产物） | dev 服实际下发的 `@deepseek-ai/dsh-client-ui-settings-models` 聚合资产（186 KB）含 `userAgent.includes("Electron")` ×1 ✓ |
| 生效（打包运行时） | 本地物化 rc.2 运行时（`staging/kcoder-runtime`，v0.2.0-rc.2）内 `dsh-client-ui-settings-models/lib/client.js` 含该闸门 ✓；同时 `dsh-client-ui-chat/src/client/locale.ts` = `'chat.deepDiving': 'KCoder'` 且 `深度求索中` 零残留 ✓ |
| 行为（单元） | 新增用例：Electron UA → `settings.onboarding` 注册表仅剩 `deepseek-official` ✓（相关 30 项全过） |

> 本地 `release.sh build` 的签名/公证段需凭据（CI 专用），本地不做；`materialize-peers.mjs` 在无 `CSC_LINK` 时不进入钥匙串导入分支（无系统状态改动），仅 `security find-identity` 只读查询。
