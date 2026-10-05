# 全仓库审计报告 — v0.6.25

> 审计日期：2026-10-05 · 范围：v0.6.24（tag）→ HEAD 的改动面（8 个提交 + 本版发行文件）。**本版引擎基线不变**：上游 deepseek-harness `0.2.1-alpha.1`（`5badb15009`），fork 集成分支 `kcoder/0.2.1-alpha.1`（`161c7122f6`，**领先远端 0 个提交**——满足 `release/README.md` 第 3 条）。本版为产品面与内置插件收口，无引擎升级。

## 硬性门

| 门 | 结果 | 说明 |
|---|---|---|
| TYPECHECK | ✅ PASS | tsc 双 project 零错误；注入脚本自检通过（**19 个注入脚本 / 46 个源文件**，零悬空引用，bundle client 半协议合规）；远端 addon 规格门 **25 项全过**。源文件数由 v0.6.24 的 47 降为 46，因 `file-activity.ts` 退役（下方「改动面」） |
| LINT | ✅ PASS | oxlint `desktop scripts` 作用域 **3 warning / 0 error**，全为 `no-unused-vars`：`remote-connections.ts:105`（`fail`）、`remote-server.ts:495`（`patch`）、`remote-server.ts:571`（`pickPort`）——**与 v0.6.23 / v0.6.24 同一组三项**（仅行号位移），三条所在文件的语义未在本版改动；无安全类（eval 等）警告 |
| SECURITY | ✅ PASS | `pnpm audit --prod --audit-level=high`（固定走 npmjs 官方 registry）**无 high+ 漏洞** |

命令：`bash scripts/release.sh audit` → 退出码 0。

## 报告项（逐条处置）

### DEAD EXPORTS（2 项）

| 项 | 处置 |
|---|---|
| `desktop/main/remote-connections.ts:43 - openRemoteHostIds` | **豁免**：远程主机子系统的公开查询面，保留给后续远程窗口菜单消费（v0.6.19 / v0.6.20 / v0.6.23 / v0.6.24 同项同理由） |
| `desktop/main/remote-server.ts:291 - remoteInstallReady` | **豁免**：远程安装就绪态的导出面，属远程工作区 B-β 线的预留 API（同上） |

> `desktop/shared/ipc-contract.ts` 的契约面类型由 `audit.mjs` 内置豁免规则覆盖。

### UNUSED DEPS（10 项）

`electron-vite`、`@types/node`、`electron`、`@shared/ipc-contract`、`semver`、`@types/semver`、`yaml`、`electron-updater`、`react`、`react-dom` —— 全部**沿用既有豁免**（v0.6.17 起同清单）：electron/react 系为 peer 性质由 electron-vite 消费，semver/yaml 在 main 进程经 CJS 依赖图使用（审计工具按 ESM import 计）。**本版无新增。**

### 内置插件发布核验（`PRESET_PLUGINS` 平移前提）

**判据：直查 registry 一手端点，不读 `npm view`**（见下方「本轮工具教训」）。三个内置插件本次均发布：

| 插件 | 指定版本端点（npmjs） | `dist-tags.latest` | 发布时刻 | npmmirror | 结论 |
|---|---|---|---|---|---|
| `dsh-coding-sidebar@1.0.39` | **200** | **1.0.39** | 2026-10-05T14:42:43Z | 404（滞后） | 按 v0.6.16 先例放行（见下） |
| `@kkutysllb/dsh-terminal@1.3.0` | **200** | **1.3.0** | 2026-10-05T14:40:04Z | 404（滞后） | 放行：该包为**仅物化**（无 `PRESET` 声明）⇒ 不进 profile deps、不参与 registry 解析，npmmirror 滞后无功能影响 |
| `dsh-skills-bundle@1.0.4` | **200** | **1.0.4** | 2026-10-05T14:38:49Z | **200** | 双源可见 |

**npmmirror 滞后处置依据**：v0.6.16 已立同类先例（`dsh-coding-sidebar@1.0.32` 当时 npmjs 200 / npmmirror 404，记为「该包 57MB+，镜像同步滞后，发版时仍在追赶」并放行），本版同判。**唯一会受影响的组合**是「使用 npmmirror 作 registry、且需要新装 profile 的用户」解析 `^1.0.39` —— 已写入发布说明的「升级注意」，可切回 npmjs 或稍后重试恢复。

#### 本轮工具教训（如实记录）

本轮我一度**误判 `dsh-coding-sidebar@1.0.39` 未发布**并据此宣告「发版硬阻塞」。原因：`npm view dsh-coding-sidebar versions / dist-tags` 读的是**本地缓存的 packument**，当时仍停在 1.0.38（`--prefer-online` 也在 HTTP 缓存层未刷新）。而**同一批命令里我直查的一手端点 `registry.npmjs.org/dsh-coding-sidebar/1.0.39` 返回的就是 200** —— 两个矛盾结果同屏，我未对账即下结论。

**纪律（已写进上表判据）**：发布核验**只采信 registry 指定版本端点与 packument 直读**，`npm view` 结果仅作参考；出现矛盾时以一手端点为准并追查缓存。这正是本仓一贯的「**假绿/假红都要当场对账**」在工具链层面的同一课。

## 本版改动面（审计覆盖范围）

| 面 | 文件 | 性质 |
|---|---|---|
| 宿主侧 | `desktop/main/theme-watcher.ts` | 自绘标题栏主文本**换源**（`document.title` → 面包屑当前项）；新增 `--dsh-titlebar-title-end`（主文本实测右缘外传）供页头起排 |
| 宿主侧 | `desktop/main/workspace-header.ts` | 页头由 `display:none` 改为**搬进 48px 带**（fixed 覆盖 + 只放开状态簇 + `pointer-events`）；**自补上游 app-region 削减**（作用域不依赖平台标记）+ 覆盖层 `-webkit-app-region: initial`；排布复刻上游（簇 `flex:none` / 行铺满 / 工具 `margin-left:auto`）；`--dsh-titlebar-status-w` 改**分量之和**；按产品指定收掉会话头「…」（`[class*="_moreButton"]`）；删除合成预设徽章旁路 |
| 宿主侧 | `desktop/main/workspace-probe.ts`、**新增** `workspace-base.ts`、**删除** `file-activity.ts`（488 行） | 退役 edit 的 `+n/−n` 统计徽章及整条数据链（`__dshFileStat` 通道、`statCache`/`applyStat`、`session/page` fetch 拦截、`/api/changes.summary` numstat、turn-end 探针、活动分桶表、`PreviewEntry` 契约）；`file-activity` 缩减为 `workspace-base`（只剩 `setWorkspace`/`activeKey`，技能分区的工作区项目技能依赖它）；保留类型徽章（TS/JS/MD）与工作区探针 |
| 宿主侧 | **删除** `desktop/main/media-models.ts`、`skills-settings.ts`、`skills-catalog.ts`、`dsh-manager.ts`、`windows.ts`、`ipc-contract.ts` | 退役 6 个非编码内置技能：移除设置页「多媒体模型」分区、停止向引擎注入 `media-models.env`、清理相关 IPC 契约与调用面 |
| 宿主侧 | `desktop/main/preset-plugins.ts` | 侧边栏声明 `^1.0.38` → `^1.0.39`（含一手端点核验记录） |
| 宿主侧 | `desktop/main/sidebar-toggle.ts` | 原生右栏轨道归零（修「点尾卡文件留空白」的静默回归，`c5c471c`） |
| 物化 | `bundle/**`（225 路径） | terminal `1.2.2` → **`1.3.0`**；coding-sidebar `1.0.38` → **`1.0.39`**；skills-bundle **`1.0.4`**（含 office 批 198 个脚本/模式文件首次随包，7.4 万行） |
| 镜像 | `dsh-plugins`（另仓） | `6035173`（terminal 1.3.0）→ `66bc05c`（sidebar 1.0.39，含 README 插件清单同步）；**已推送** |
| 脚本 | **新增** `scripts/smoke-titlebar.mjs`、`scripts/smoke-workspace-probe.mjs`；重写 `smoke-workspace-header.mjs` | 三支常备门（见下「验证」） |
| 脚本 | `smoke-bundle-profile.mjs`、`smoke-skills-page.mjs`、`smoke-skills-dom.mjs`、`smoke-brand-badge.mjs`、`smoke-mcp-dom.mjs` | 退役面零回流断言 / 三支补真实退出码（此前失败仍 exit 0，任何按退出码接线的门禁都会把红读成绿） |
| 脚本 | `scripts/adapt-kskills.mjs` | 移除 MEDIA/RESEARCH 批与 `MANIFEST_ORDER` 条目（防一次重跑把退役技能写回 bundle）；同步脚本排除规则改为**只在仓库根生效** + `skills/` 载荷零排除不变量断言 |
| 构建 | `package.json` | 三支冒烟挂 npm scripts（其中 `smoke:workspace-header` 此前无入口，属可发现性缺口） |
| 文档 | `docs/ARCHITECTURE.md`、`docs/qilin-anchor-feasibility.md` | §8 新增四条铁律（可点性=app-region 含三条根因与两条 Blink 实测 / 搬进自绘带必须复刻几何 / 自绘带只留产品要的控件 / 收掉上游区域前先清点槽位注册方）；§7 行档同步；麒麟换锚可行性分析 |

## 验证（本版核心风险面）

| 项 | 证据 |
|---|---|
| 仓库聚合门 | `pnpm run check`（类型检查含注入脚本门 + 内置插件版本线 + bundle 同步对账 + profile 自愈判据）**25/25 退出码 0** |
| 内置插件版本线 | `check-bundle-version-line` 通过：5 个内置插件全部「PRESET 声明同线 + 内容变更伴随版本变更」（sidebar 1.0.38→1.0.39 ✓ / terminal 1.2.2→1.3.0 ✓ / skills-bundle 1.0.3→1.0.4 ✓） |
| **冒烟全量** | **14 支全绿**（12 GUI + 2 node）= account-chip / brand-badge / mcp-dom / panel-buttons 9/9 / settings-anchors 10/10 / sidebar-toggle / skills-dom / skills-page / style-overlay 18/18 / style-overlay-lifecycle 29/29 / titlebar / workspace-header / workspace-probe / bundle-profile 25/25 |
| **红-绿对照 A（可点性）** | 常备门 `smoke:titlebar` PASS；负对照**条改回 `append`**（`KCODER_TITLEBAR_BAR_MODE=append`）⇒ **FAIL exit 1**，逐字复现用户报的故障类：`状态徽章（button）落在拖拽区里：该点可拖 ⇒ 点击到不了页面（drag=true；命中盒子 [… ,"DIV#__dsh_desktop_titlebar=drag"]）`——末位即自绘条。另有「带内可交互元素（右栏页签）被条吞掉」一条同批红 |
| **红-绿对照 B（上游形态兼容）** | 同门 `KCODER_TITLEBAR_PLATFORM=1`（平台标记在场＝上游桌面端形态）⇒ **仍 PASS**：本产品补的那层与上游原有规则**兼容且幂等** |
| **红-绿对照 C（页头搬带）** | `smoke:workspace-header` PASS；负对照用改动前那份（`WORKSPACE_HEADER_SRC=3b1f507^`）⇒ **FAIL 44 条**，含「页头仍被 `display:none` —— 状态徽章会全体消失」「行首内边距未接到标题右缘（20px ≠ 250px）」「徽章未落在标题之后（左缘 0 ≠ 250）」「会话头『…』未被移除」「让位宽度疑似量了 titleRow 整宽 —— 会把标题压成 0 宽」 |
| **红-绿对照 D（统计徽章退役）** | `smoke:workspace-probe` PASS；负对照用改动前那份（`WORKSPACE_PROBE_SRC=3b1f507^`）⇒ **FAIL**，且**精确红在退役面三条**：`样式表里仍有 .__dsh-fb-stat 规则` / `window.__dshFileStat 仍存在` / `window.fetch 仍被包装`；而「保留面」（类型徽章、工作区探针）两阶段**全绿** ⇒ 分得清「退役」与「误伤」 |
| 插件侧自测 | `dsh-terminal` 1.3.0：含「客户端不得出现 `process.platform`/`navigator.platform`」的 shell 徽标数据驱动断言；`dsh-coding-sidebar` 1.0.39：851 条地址断言，负对照恰好红在两条认领断言 |
| 镜像链一致性 | `sync-bundles --check` **零差异**（真源仓 → `dsh-plugins` → `bundle/` 三层一致，且镜像侧两个提交均已推送） |
| fork 锚定 | `kcoder/0.2.1-alpha.1`（`161c7122f6`）**领先远端 0**；`release/README.md` 第 3 条满足 |

## 本版已知未决（非审计门）

| # | 项 | 定性 |
|---|---|---|
| 1 | `smoke-runtime`（运行时冒烟）本版**未单独跑** | 其靶子 `staging/kcoder-runtime` 当前仍是**上一基线（`dsh-base` 0.2.0-rc.2）**的残留，此刻跑它验的是旧靶子；跑它属 `release.sh build`（本地打包）的第 4 步，而本次发版走 `ship → prepush`，**打包由 CI 三平台承担**（`release.yml`），CI 内会重跑同类检查。已登记（v0.6.24 同项，工作态计划 S6） |
| 2 | 本地未做签名/公证打包 | 同上：`cmd_build` 需 `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`，属本地应急路径；正式产物由 CI 签名公证 |
| 3 | `brand-assert.mjs` 在 Windows + Git Bash 下用**绝对路径**调 tar 会撞 `Cannot connect to D:` | **既有、平台局部**：CI 传相对路径故三平台不受影响；macOS 的 BSD tar 无此问题（v0.6.23 / v0.6.24 同项） |
| 4 | npmmirror 对 `dsh-coding-sidebar@1.0.39` 仍 404 | 镜像同步滞后，**非本仓问题**；已按 v0.6.16 先例放行并写入发布说明「升级注意」 |

## 结论

硬性门全过；报告项全部沿用既有豁免（本版零新增）；本版为**产品面与内置插件收口**，四个核心风险面（**原生窗口可点性**、页头搬带的排布与让位宽度、统计徽章退役的边界、内置插件三层镜像一致性）均有**带负对照的红-绿证据**，且三支新增/重写的常备门把此前「结构上不可能变红」的那类假绿变成了可回归的门。三个内置插件的 npmjs 一手端点核验通过。**建议发布。**
