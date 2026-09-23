# 全仓库审计报告 — v0.6.16

> 审计日期：2026-09-23 · 审计命令：`bash scripts/release.sh audit` · 结果：**三门 PASS**。
> 本版**发现 1 条 LINT warning（脚本类），已在本版内修复**；DEAD EXPORTS 0 项待处置；SECURITY 无 high+ 漏洞。

## 硬性门

| 门 | 结果 | 说明 |
|---|---|---|
| TYPECHECK | ✅ PASS | tsc 双 project 零错误；链尾注入脚本自检通过（抽取 **20** 个注入脚本 / **42** 个源文件，零悬空引用，bundle client 半协议合规）。较 v0.6.15 多 1 个源文件 |
| LINT | ✅ PASS | oxlint 全仓库 **0 warning / 0 error**（83 文件 / 96 规则）。见下「发现项」——本版修复了 1 条 |
| SECURITY | ✅ PASS | 生产依赖无 high+ 漏洞（`pnpm audit --prod`） |

## 发现项与逐条处置（本版 1 条，已修复）

**LINT：`scripts/smoke-workspace-header.mjs:49` `no-unused-vars`（`STYLE_ID` 声明未使用）**

- **性质**：**误报**，但值得显式处置——`STYLE_ID` 的唯一用途是让紧随其后那段 **被 `eval` 的模板字面量** 解析 `${STYLE_ID}` 插值（该冒烟按挂载侧同值还原页面注入源码）。静态分析看不到 `eval` 内部的引用，故必然报「未使用」。
- **为什么本版才出现**：该冒烟是 0.1.7-alpha.1 轮为「会话页头孤立横线」回归新增的（v0.6.15 时尚不存在）。
- **处置（修复，非豁免）**：保留原解释注释，并在声明处补单行
  `// oxlint-disable-next-line no-unused-vars -- 供下面被 eval 的模板字面量解析 ${STYLE_ID}，静态分析看不到该引用`。
  **踩坑记录**：该指令的 `--` 理由**必须与指令同处一行注释**——首版把理由写成两行注释，指令不生效、warning 照报（实测 1 warning → 改为单行后 0 warning）。
- **回归确认**：`env -u ELECTRON_RUN_AS_NODE electron scripts/smoke-workspace-header.mjs` → **ALL PASS**（注释改动未影响夹具行为）。

## 报告项（逐条沿用既有处置，本版无新增）

- **DEAD EXPORTS：0 项待处置**，另有 3 项已知豁免（`electron.vite.config.ts` 默认导出 ×1 = 构建链配置入口；`desktop/shared/ipc-contract.ts` ×2 = node/web 双 project 的 IPC 契约面类型，按设计导出）。清单与 v0.6.11~v0.6.15 完全一致。
- **UNUSED DEPS：10 项**（electron-vite, @types/node, electron, @shared/ipc-contract, semver, @types/semver, yaml, electron-updater, react, react-dom）——与 v0.6.0/v0.6.1/v0.6.11~v0.6.15 **逐项完全一致**，属 depcheck 对 Electron 应用的固有误报：`electron`/`electron-vite`/`react`/`react-dom` 经构建链与运行时消费，`semver`/`yaml`/`electron-updater` 经主进程动态路径消费，`@shared/ipc-contract` 为路径别名导入（depcheck 不解析 tsconfig paths）。**豁免沿用，不重复处置**。

## 本版改动面（审计覆盖范围）

本版是**上游基线大版本跨越**（0.1.6-alpha.2 → 0.1.7-rc.1，经 alpha.1 / alpha.2 / rc.1 三段完成），产品侧改动面如下：

- **桌面壳**：`platform-monitor` 放开 `webviewTag` + guest 加固（内置浏览器载体前提）；`workspace-header.ts` 页头收纳改为按 `data-slot` 重锚（0.1.7 把页头拆成两层后旧 `> _titleRow` 锚点失效，表现为「会话一开始跑就冒出一条孤立横线」）。
- **预置/镜像**：`PRESET_PLUGINS` 两条声明与 `bundle/` 五包物化版本同步（见发布说明的「内置插件」条）；`sync-bundles --check` 零差异。
- **契约适配**：`product-policy.ts` overlay 四行在 rc.1 生效组合下逐行复验（`session-log-deepseek` disabled / `ui-sidebar-terminal` disabled / `ui-deliverables.tailCard:false` / `ui-sidebar-browser` 放开）。
- **文档**：新增 `docs/upstream-0.1.7-{alpha.1,alpha.2,rc.1}-analysis.md`（三份逐条核实 + §8 执行记录）；`upstream/BASELINE` 追加三段升级记录；`docs/upstream-0.1.7-alpha.2-analysis.md` 与 BASELINE 就地更正一处早期错误断言（`apps/web/dist` 与构建链的关系）。
- **脚本**：`scripts/smoke-workspace-header.mjs`（新增，页头收纳回归）；`setup.sh` / `release.sh` / `dsh-contract.ts` 集成分支名切至 `kcoder/0.1.7-rc.1`。
- **内置插件（随包物化，实体终态）**：`dsh-coding-sidebar` **1.0.32**（本版新增：任务管理页两条数据缝迁移 + 版本号）· `dsh-file-review-kcoder` **1.0.10** · `@kkutysllb/dsh-terminal` **1.1.1** · `dsh-skills-bundle` **1.0.2** · `dsh-shell-prefs` **1.0.1**。

## 复检结论

| 复检项 | 命令 | 结果 |
|---|---|---|
| 全仓库审计 | `bash scripts/release.sh audit` | **三门 PASS / LINT 0 warning** |
| 注入脚本自检 | `node scripts/check-injected-scripts.mjs` | exit 0（20 脚本 / 42 源文件，零悬空引用，client 半协议合规） |
| 内置镜像对账 | `node scripts/sync-bundles.mjs --check` | **零差异** |
| 插件侧门禁（终态） | `dsh-coding-sidebar` `pnpm smoke` / `pnpm test` | 冒烟全通过；`tests/run-openpath-tests.mjs` ALL PASS |
| 插件侧门禁（终态） | `dsh-file-review-kcoder` `pnpm smoke` | render **25/25** |
| 桌面侧冒烟 | `smoke-workspace-header.mjs` | **ALL PASS**（含判别力自检：旧直接子级锚点版本必须 FAIL） |
| fork 发版硬前提 | `git -C ~/kk_Projects/deepseek-harness status -sb` | 集成分支 `kcoder/0.1.7-rc.1` 与 origin **齐平（领先 0）**，符合 release/README.md 第 3 条 |
| 上游运行时冒烟 | `scripts/smoke-runtime.mjs`（staging 0.1.7-rc.1） | 就绪行 + 首页 200 通过 |
| 品牌断言 | `scripts/brand-assert.mjs` | 通过（`chat.deepDiving = KCoder...`） |
| 内置插件发布核验（`PRESET_PLUGINS` 平移前提） | 直查**指定版本端点**（绕开 packument 的 CDN 缓存） | `dsh-coding-sidebar@1.0.32`：npmjs **200** ✓ / `dist-tags.latest`=1.0.32；npmmirror 404（该包 57MB+，镜像同步滞后，发版时仍在追赶）。`dsh-file-review-kcoder@1.0.10`：npmjs **200** ✓ + npmmirror **200** ✓（双源可见，`latest` 均已指向） |
| 预置声明与物化同线 | 比对 `PRESET_PLUGINS` 与 `bundle/*/package.json` | **同线**：`^1.0.32` ↔ 1.0.32；`^1.0.10` ↔ 1.0.10 |

## 遗留（非本报告结论，转入发布说明「升级注意」）

- `seeded-history` / `steering` 两套上游浏览器快照在 fork 上**恒有 5 项红**（成因＝我方 0007「编辑并重发」按钮多出一行 aria 节点）。**已决：与上游保持一致——保持上游 golden 原样**，登记为已知稳定差集，**不得对这两个目录执行 `DSH_SNAPSHOT=refresh`**。
- `tool-jobs` 的 `maxConsecutiveWakes` 本版起**不设上限**（上游行为，KCoder 不覆盖）。已登记为持久观察项：若现场出现「后台任务自我唤醒长链」，第一处置是给该 owner 显式配该键，而非回退上游。
