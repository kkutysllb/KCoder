# 全仓库审计报告 — v0.6.24

> 审计日期：2026-10-04 · 范围：v0.6.23（tag）→ HEAD 的改动面（14 个提交 + 本版发行文件）。**本版基线变化**：上游 deepseek-harness `0.2.0-rc.2`（`639ed01539`）→ **`0.2.1-alpha.1`**（`5badb15009`），fork 集成分支 `kcoder/0.2.0-rc.2`（`b428f93a79`）→ **`kcoder/0.2.1-alpha.1`（`161c7122f6`）**。差异分析、升级计划与执行记录见 [docs/upstream-0.2.1-alpha.1-analysis.md](../docs/upstream-0.2.1-alpha.1-analysis.md) 与 [plans/upgrade-0.2.1-alpha.1.md](../plans/upgrade-0.2.1-alpha.1.md)。

## 硬性门

| 门 | 结果 | 说明 |
|---|---|---|
| TYPECHECK | ✅ PASS | tsc 双 project 零错误；注入脚本自检通过（**19 个注入脚本 / 47 个源文件**，零悬空引用，bundle client 半协议合规）；远端 addon 规格门 **25 项全过** |
| LINT | ✅ PASS | oxlint **3 warning / 0 error**，全为 `no-unused-vars`：`remote-connections.ts:103`（`fail`）、`remote-server.ts:494`（`patch`）、`remote-server.ts:570`（`pickPort`）——**与 v0.6.23 同一组三项**（仅行号位移 +1），三条所在文件的语义未在本版改动；无安全类（eval 等） |
| SECURITY | ✅ PASS | `pnpm audit --prod --audit-level=high`（固定走 npmjs 官方 registry）无 high+ 漏洞 |

命令：`bash scripts/release.sh audit` → 退出码 0。

## 报告项（逐条处置）

### DEAD EXPORTS（2 项）

| 项 | 处置 |
|---|---|
| `desktop/main/remote-connections.ts:43 - openRemoteHostIds` | **豁免**：远程主机子系统的公开查询面，保留给后续远程窗口菜单消费（v0.6.19 / v0.6.20 / v0.6.23 同项同理由） |
| `desktop/main/remote-server.ts:290 - remoteInstallReady` | **豁免**：远程安装就绪态的导出面，属远程工作区 B-β 线的预留 API（同上） |

> `desktop/shared/ipc-contract.ts` 的契约面类型由 `audit.mjs` 内置豁免规则覆盖。

### UNUSED DEPS（10 项）

`electron-vite`、`@types/node`、`electron`、`@shared/ipc-contract`、`semver`、`@types/semver`、`yaml`、`electron-updater`、`react`、`react-dom` —— 全部**沿用既有豁免**（v0.6.17 起同清单，v0.6.23 同）：electron/react 系为 peer 性质由 electron-vite 消费，semver/yaml 在 main 进程经 CJS 依赖图使用（审计工具按 ESM import 计）。本版无新增。

### 本版自己引入又清掉的 2 条 lint warning（如实记录）

`smoke-skills-dom.mjs` / `smoke-skills-page.mjs` 里为修复「自 v0.5.9 起挂起」而新增的
`MEDIA_MODEL_GROUPS` 提取，被 oxlint 报为 `no-unused-vars` —— **静态误报**：该常量只被
**下一行 eval 的模板字符串** `${JSON.stringify(MEDIA_MODEL_GROUPS)}` 消费（eval 在词法
作用域里查找），静态分析看不见。处置**不是删变量**（删了脚本立刻回到挂起症状，已实测：
换成 `undefined` 后 `smoke-skills-dom` 重新挂起），而是在紧邻代码行加
`no-eval, no-unused-vars` 豁免注释并写明理由。首版注释写在说明文字之上
（`disable-next-line` 只作用于**紧邻下一行**）导致三条都没生效，已改正——重新计数为 3/0。

## 本版改动面（审计覆盖范围）

| 面 | 文件 | 性质 |
|---|---|---|
| 基线 | `upstream/BASELINE`、`scripts/setup.sh`、`scripts/release.sh` | 基线钉版推进到 `5badb15009`；分支名 5 处平移到 `kcoder/0.2.1-alpha.1` |
| 宿主侧 | `desktop/main/preset-plugins.ts` | 退役调度组合包（声明摘除 + 入 `RETIRED_PRESETS` + 陈旧 peer 名单）；侧边栏声明 `^1.0.36` → `^1.0.38` |
| 宿主侧 | `desktop/main/kcoder-skills-bundle.ts` | **三处 profile 自愈修复**：退役清理触发 pnpm 收敛（F26）、牵引包 deps 声明无条件保留（F27）、上游 `OPTIONAL_BUNDLES` 纳入 `managed`（F28） |
| 宿主侧 | `desktop/main/product-policy.ts`、`dsh-contract.ts` | 策略注释同步（交付卡渲染器自持）；合同面注释与基线对齐 |
| 宿主侧 | `desktop/main/style-overlay.ts` | **移除**侧栏插件入口压制段（5 段 → 4 段），恢复上游入口；原段转历史注释 |
| 物化 | `bundle/**`（29 路径） | terminal `1.2.2` / ssh-remote `0.1.4` / coding-sidebar `1.0.38` / skills-bundle `1.0.3`；删 `bundle/dsh-file-review-kcoder`（95 个跟踪文件） |
| 脚本 | `scripts/deps-freshness.mjs`（新）、`dev.mjs`、`setup.sh` | 依赖陈旧哨兵 + store 复用 |
| 脚本 | `scripts/smoke-bundle-profile.mjs`（新）、`smoke-style-overlay-lifecycle.mjs`（新） | 两支常备门（profile 自愈判据 19 项 / 覆盖层注入生命周期 29 项） |
| 脚本 | `smoke-panel-buttons.mjs`、`smoke-skills-dom.mjs`、`smoke-skills-page.mjs` | 三支坏测试修复（陈旧 fixture 对齐 / 插值常量取真源） |
| 构建 | `package.json`、`electron-builder.yml`、`remote-server.ts`、`remote-connections.ts` | 内置清单四名单同步（退役包摘除）；三支校验脚本挂 npm scripts |
| 文档 | `docs/ARCHITECTURE.md`、`docs/plugin-dev-checklist.md`、`docs/upstream-0.2.1-*.md`、`plans/*.md` | 铁律 1 改写为「双入口并存」；升级分析/计划/工作态计划 |

## 验证（本版核心风险面）

| 项 | 证据 |
|---|---|
| fork 集成分支三绿 | `install` / `build` / `typecheck` 退出码均 0；`apps/web/dist` 在位 |
| 补丁与偏离面存活 | 7 份 patches 全部应用、`openai-codex-responses.js` ×3、零 `0.84.3`；**集合断言 61 = 61，`comm -3` 空** |
| 上游自测 | vitest **12569 通过 / 2 红**；用**纯净上游工作树**独立 install+build 复跑 ⇒ 两条同断言同一行失败 ⇒ **上游既有，非本次引入**（该 worktree 已移除，仓库无残留） |
| 上游侧门 | `verify-translation-pairing` 860 对一致；`verify-package-dependencies` 74 包合规（**R-8 未成立**） |
| 真机启动（dev profile） | `skipping profile bundle` **0** / `disabling profile plugin row` **0** / 就绪行 ✓ / 连续两次启动 manifest **SHA 一致**；内置终端与 SSH 远程实体在位 |
| profile 自愈（F26 对照） | 把退役组合包**回写复现老 profile**（lock 7 处引用 + 两实体在位）→ 修复前无 install、引擎禁 5 行 rc.2 包；修复后出现 `执行 pnpm install`、lock **7→0**、两实体 **PRUNED**、引擎复跑两条指纹 **0/0** |
| profile 自愈（F27/F28 对照） | 常备门正跑 **PASS 19/19**；负对照（仓内副本 + `c172765^`）**FAIL 11/17** 且**红在对的断言上**（`deps={}` + 两个可选包被摘），并复刻出真机原话日志 |
| 样式覆盖层（R-2） | 常备门 **PASS 29/29**；负对照移除幂等复用后 **FAIL 25/29**（含整页重载后恰好一份 / 被抹掉能自愈） |
| 冒烟全量 | **12 支全绿** = 10 GUI + 2 node（含本轮新修 3 支、新增 2 支） |
| 用户真机验收 | 侧栏页签 / 任务计划 / explorer 插入引用 / 家族插件安装 / 真实会话（终端、SSH 远程、侧栏插件入口、设置页插件管理、品牌文案）——**用户 2026-10-04 确认通过** |

## 本版已知未决（非审计门）

| # | 项 | 定性 |
|---|---|---|
| 1 | `smoke-runtime`（运行时冒烟）本版**未跑** | 其靶子 `staging/kcoder-runtime` 仍是**旧运行时（0.2.0-rc.2）**，此刻跑它验的是旧靶子；待新运行时 staging 后执行（已登记在工作态计划 S6） |
| 2 | `brand-assert.mjs` 在 Windows + Git Bash 下用**绝对路径**调 tar 会撞 `Cannot connect to D:` | **既有、平台局部**：CI 传相对路径故三平台不受影响；macOS 的 BSD tar 无此问题（v0.6.23 同项） |
| 3 | 上游 `tool.call.toolview` slot 与 `ui-conversation` 草稿契约重构的**残留暴露面** | 我方偏离面 61 文件里零命中（集合断言已证）；注入层的 DOM 锚点依赖这些组件渲染出的属性，本版已用 12 支冒烟覆盖现行锚点——若上游后续改动这些 slot 的渲染结构，冒烟会红 |

> v0.6.23 登记的「已知问题」三条（`smoke-panel-buttons` 失败、`smoke-skills-dom`/`smoke-skills-page` 挂起）**本版已全部修复**，不再登记。

## 结论

硬性门全过；报告项全部沿用既有豁免或给出证据性定性；本版为**引擎基线升级**，核心风险面（补丁存活、偏离面完整、peer 口径、profile 自愈、样式注入）均有真机红-绿对照，且新增两支带负对照的常备门把两类**静默**缺陷变成可回归的门。**建议发布。**
