# 全仓库审计报告 — v0.6.17

> 审计日期：2026-09-25 · 审计命令：`bash scripts/release.sh audit` · 结果：**三门 PASS**。
> 本版**无新增 LINT warning**（连续第二版 0 warning）；DEAD EXPORTS 0 项待处置；SECURITY 无 high+ 漏洞。
> 另：本版给发版链**新增了一道自保闸**（插件热补丁发版闸），结果见下「本版新增的门」。

## 硬性门

| 门 | 结果 | 说明 |
|---|---|---|
| TYPECHECK | ✅ PASS | tsc 双 project 零错误；链尾注入脚本自检通过（抽取 **20** 个注入脚本 / **42** 个源文件，零悬空引用，bundle client 半协议合规）——与 v0.6.16 同数 |
| LINT | ✅ PASS | oxlint 全仓库 **0 warning / 0 error**（83 文件 / 96 规则） |
| SECURITY | ✅ PASS | 生产依赖无 high+ 漏洞（`pnpm audit --prod`，固定走 npmjs 官方端点） |

## 发现项与逐条处置

**本版 0 条**：无新增 warning、无新增死代码、无新增漏洞。

- 上一版（v0.6.16）修复的那条 `STYLE_ID` 误报保持修复状态——本版 LINT 仍为 0 warning 即证据；该条处置理由仍有效（`oxlint-disable-next-line` 的 `--` 理由**必须与指令同行**）。
- 本版改动的文件均在既有 lint/typecheck 覆盖内（`desktop/main/*.ts`、`scripts/*.mjs`、`docs/*.md`、`bundle/**`、`release/**`），其中 `scripts/update-profile-plugins.mjs` 的改动在本版审计中同样零告警。

## 报告项（逐条沿用既有处置，本版无新增）

- **DEAD EXPORTS：0 项待处置**，另有 **3 项已知豁免**（`electron.vite.config.ts` 默认导出 = 构建链配置入口；`desktop/shared/ipc-contract.ts` ×2 = node/web 双 project 的 IPC 契约面类型）。清单与 v0.6.11~v0.6.16 完全一致。
- **UNUSED DEPS：10 项**（electron-vite, @types/node, electron, @shared/ipc-contract, semver, @types/semver, yaml, electron-updater, react, react-dom）——与 v0.6.0/v0.6.1/v0.6.11~v0.6.16 **逐项完全一致**，属 depcheck 对 Electron 应用的固有误报：`electron`/`electron-vite`/`react`/`react-dom` 经构建链与运行时消费，`semver`/`yaml`/`electron-updater` 经主进程动态路径消费，`@shared/ipc-contract` 为路径别名导入（depcheck 不解析 tsconfig paths）。**豁免沿用，不重复处置**。

## 本版新增的门（属发版链，不属 audit 输出）

**插件热补丁发版闸** —— `node scripts/update-profile-plugins.mjs --release-gate`，由 `release.sh patchgate` 调用，并挂在 **build / prepush / ship** 之前。只读校验四项：

1. 补丁分发目录非空（清单由扫描 `profiles/web/patches/` 得出，新增/退役补丁无需改脚本）；
2. **实装产物 marks 全中**（不看版本门控——门控只回答「pnpm 会不会应用」，与「修复在不在产物里」正交）；
3. **版本键零漂移**（patch 文件名版本 == 实装版本）；
4. `patchedDependencies` 声明就位、且同包无多版本键。

无 profile 的机器（CI / 干净机）上 2~4 降级为警告，仓库侧 1 仍强制。

**本版实测**：`[plugins] 补丁闸通过 ✓（1 份 patch：仓库分发 + 现场 marks + 版本键零漂移 + 声明就位）`。

## 本版改动面（审计覆盖范围）

- **上游基线**：`0.1.7-rc.1` → **`0.1.7-rc.2`**（集成分支 `kcoder/0.1.7-rc.2` @ `323be30855`；重放完整性 46 文件集合相等；语义存活审计 44/46，两处缺口即手工解的两处冲突）。
- **桌面壳**：`browser-host.ts` 浏览器宿主端口按 dev/打包分流（9224 / 9223，`KCODER_BROWSER_HOST_PORT` 可显式覆盖）；`style-overlay.ts` 原生右栏压制**改锚**（rc.2 把面板标记从布尔属性改成取值属性，旧的存在性选择器静默失效）——改锚到占地的列 `[data-rightbar-col]` 与残留分隔条 `[data-side='rightbar']`。
- **产品策略层**（`product-policy.ts`）：新增三行默认开启（`schedule` / `ui-schedule` / `time-context`）。
- **预置与补丁链**：`dsh-context` 升 `0.55.0`（含 RO 回路冷却与轮尾跳转两条常驻补丁）、预置 spec 由 `^0.38.5` 平移到与补丁线同线、退役 `dsh-context@0.38.2.patch` 并回收死行；`dsh-coding-sidebar` 预置 spec 由 `^1.0.32` **平移至 `^1.0.33`**（与随包物化同线；平移前核验：指定版本端点在 npmjs / npmmirror **双源均 200**、`dist-tags.latest` = 1.0.33）；`scripts/update-profile-plugins.mjs` 新增 `--release-gate` 与 profile 解析回退链。
- **修复**：`preset-plugins.ts` 标题栏避让配置的目标行 id（此前按**包名**当行 id 寻址，指向一个不存在的行——配置从未生效、且每次启动打一行 `entry not found`；现按真实行 id `better-sidebar` 寻址并回收死行，且只回收形状与自身输出一致的行）。
- **内置插件**：`dsh-coding-sidebar` **1.0.33**（新增「任务计划」页签的任务预览 `ScheduleTaskPreview.tsx`；`openTab` 的内容型判据补 `meta`；可选远程面改按需装配），经 `dsh-plugins` 镜像同步进 `bundle/`；`sync-bundles --check` 零差异。
- **文档**：新增 `docs/upstream-0.1.7-rc.2-analysis.md`（§0~§8，含 rc.2 全量差异与执行记录）、新增 `docs/plugin-dev-checklist.md`（内置插件开发清单）、`docs/ARCHITECTURE.md` §8 加指针、`upstream/BASELINE` 追加两段记录（基线升级 + 自有面 46 → 47）。
- **fork 自有面**：**46 → 47 文件**（新增 `packages/client/ui-schedule/src/client/index.ts`，承载「任务详情改开内置侧边栏」的产品适配）——后续每次上游升版需重放该文件，完整性断言按 47 核对。

## 结论

三门 PASS；报告项沿用既有豁免、本版无新增；发版链新增的插件补丁闸通过。**允许发布 v0.6.17**。
