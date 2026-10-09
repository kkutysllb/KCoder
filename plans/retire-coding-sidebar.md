# 退役内置右侧边栏插件 dsh-coding-sidebar（dsh 0.2.1-alpha.2 升级第一步）

## Goal

把 KCoder 内置右侧边栏插件 `dsh-coding-sidebar` 整线退役，右侧工作台**交回上游原生右侧栏**
（`ui-sidebar-right` 及其 files / documentpreview / terminal / browser tab），并据此**正式翻转
`docs/ARCHITECTURE.md` §12 铁律 1**（记日期与理由）。退役后 KCoder 侧不再有任何指向该插件的
物化、预置、压制、代理与打包面；原生右栏的压制（元素 + 网格第三轨）与代理按钮一并撤除。

## 决策（产品负责人已拍板，2026-10-09）

1. **目标版本**：本轮升级目标 = `dsh-v0.2.1-alpha.2`（上游 master `d7432673`，2026-10-09 17:31 发布；
   本机克隆 20:59 已 fetch 到该 tag）。本计划只覆盖**第一步**（插件退役），完整升级分析/计划另行开工。
2. **铁律 1 翻转**：退役后**接回上游原生右侧栏**。撤 `NATIVE_SIDEBAR_CSS` 压制、撤 `sidebar-toggle`
   第三轨归零、退役 `sidebar-cluster` 代理，右栏入口回到上游会话头角位展开按钮。
3. **原生右栏终端 tab 一并解除**（`product-policy.ts` 的 `ui-sidebar-terminal` disabled 行撤除）。
   `@kkutysllb/dsh-terminal` 底面板的去留本轮不动、另议。
4. **不提交**：按 §8 协作惯例，AI 交付验证清单 → 用户重启 app 实测 → 用户说提交才提交。

## Task List

### Phase 0 — 基线冻结（前置证据）✅
- [x] P0.1 工作树干净；`check-bundle-version-line` 5 插件同线通过；`sync-bundles --check` 通过
- [x] P0.2 dev profile：deps `dsh-coding-sidebar: ^1.0.39`，bundles 含该包；
      打包 profile：deps `^1.0.40`，bundles 含该包（退役三清的真实输入）

### Phase 1 — 双账本 + 四名单（物化/预置/打包/远端）✅
- [x] P1.1 `desktop/main/kcoder-skills-bundle.ts`：`DSH_CODING_SIDEBAR` 常量与 `BUNDLES` 条目摘除 →
      `RETIRED_PLUGINS` 加名；`tractionDeps` 的 coding-sidebar 例外摘除；文件头形态清单同步
- [x] P1.2 `desktop/main/preset-plugins.ts`：`PRESET_PLUGINS` 摘 `'^1.0.40'`（表自此为空）→
      `RETIRED_PRESETS` 加名；`ensureSidebarCompatPatch` + `SIDEBAR_ROW_ID(_LEGACY)` +
      `SIDEBAR_COMPAT_KEYS` + `isOwnCompatRow` + `SHELL_TITLEBAR_HEIGHT` 依赖一并拆除；空表消费面核对
- [x] P1.3 四名单：`electron-builder.yml` extraResources、`scripts/sync-bundles.mjs` 映射、
      `desktop/main/remote-server.ts` `PROFILE_BUNDLES`、`desktop/main/remote-connections.ts` `REMOTE_BUNDLES`
- [x] P1.4 `scripts/update-profile-plugins.mjs` 的 `VERSION_ALIGNS` 条目摘除
- [x] P1.5 `scripts/smoke-bundle-profile.mjs` 的 F27「牵引例外」夹具与断言改造（该例外随插件消亡）
- [x] P1.6 删除 `bundle/dsh-coding-sidebar/`（含 `.pnpm-store` 等未跟踪物）
- [x] P1.7 残留引用清扫：`index.ts` / `dsh-manager.ts` / `plugins.ts` 的注释与接线

### Phase 2 — 宿主压制/代理面退役（铁律 1 的代码面）✅
- [x] P2.1 `style-overlay.ts`：`NATIVE_SIDEBAR_CSS` 段与相关注释摘除（其余三段保留）
- [x] P2.2 `sidebar-toggle.ts`：**第三轨恒 0px** 归零逻辑与注释摘除（轨 1 折叠无痕、标题栏、新会话代理保留）
- [x] P2.3 `sidebar-cluster.ts` 整模块退役 + `windows.ts` 接线摘除
- [x] P2.4 `panel-buttons.ts`：侧栏代理按钮的 win32 让位条目摘除并同步注释
- [x] P2.5 `product-policy.ts`：撤「原生右侧栏终端 tab 禁用」行（决策 3）

### Phase 3 — 门与冒烟 ✅
- [x] P3.1 `scripts/smoke-style-overlay.mjs`：`EXPECTED` 段清单 + 「原生右侧栏外壳 5/5」断言改造
- [x] P3.2 `scripts/smoke-style-overlay-lifecycle.mjs`：同上
- [x] P3.3 `scripts/smoke-sidebar-toggle.mjs`：「原生右栏轨道归零」场景（含 fixture 与需宽窗口的实机段）改造
- [x] P3.4 `scripts/probe-dev-review-open.mjs`：judgement 极性随原生右栏接回翻转
- [x] P3.5 `scripts/check-remote-addon-specs.mjs` / `check-injected-scripts.mjs` / `release.sh` 的 bundle 清单核对

### Phase 4 — 文档 ✅
- [x] P4.1 `docs/ARCHITECTURE.md` §12 铁律 1：**正式翻转**（日期 + 理由 + 入口变更），历史段保留
- [x] P4.2 `docs/ARCHITECTURE.md` §4 模块表（style-overlay / sidebar-cluster / sidebar-toggle）、§7 契约行、§10 入口表
- [x] P4.3 `docs/plugin-dev-checklist.md`、`README.md` 相关段同步
- [x] P4.4 登记「能力落差」清单（供发布说明「未启用/已由上游替代」段使用）

### Phase 5 — 验证与交付 ✅
- [x] P5.1 `pnpm typecheck`（含注入脚本自检 + 远端规格）
- [x] P5.2 `pnpm check`（typecheck + check:bundle-version-line + check:sync-bundles + smoke:bundle-profile）
- [x] P5.3 `pnpm build` + 产物关键串断言（防陈旧产物）
- [x] P5.4 真机冒烟（GUI 门）：`smoke:style-overlay` / `smoke:style-overlay-lifecycle` / `smoke:sidebar-toggle` / `smoke:titlebar`
- [x] P5.5 输出人工验证清单（用户重启 app 实测项），提交与否交用户

## Findings

### F1 目标插件身份（已确证）
- 「内置右边侧边栏插件」= `bundle/dsh-coding-sidebar`（npm `dsh-coding-sidebar@1.0.40`，
  fork 自 DSH-better-sidebar 0.17.2，KCoder 维护线）。bundle/ 下其余四个
  （`dsh-shell-prefs` / `dsh-skills-bundle` / `dsh-ssh-remote` / `dsh-terminal`）与之无关。
- 它是 `PRESET_PLUGINS`（preset-plugins.ts）**唯一**一条正式声明；
  `BUNDLES`（kcoder-skills-bundle.ts）五个物化条目之一。
- 插件真源仓 `~/kk_Projects/dsh-coding-sidebar` 同时是 **QiLin 的第一方内置工作台**
  ⇒ 退役只发生在 KCoder 消费侧；插件仓与 npm 包不动（用户仍可经插件管理页自装，
  但产品级退役口径下启动三清会再洗）。

### F2 现行产品约束（退役即翻转）
- 铁律 1（ARCHITECTURE §12，2026-09-19 定）：右侧工作台只由该插件承担；原生
  `ui-sidebar-right` 外壳由 `style-overlay.ts` 的 `NATIVE_SIDEBAR_CSS` 压制
  （`data-sidebar-right-{expand,panel,session}` + `[data-rightbar-col]`），
  网格第三轨由 `sidebar-toggle.ts` 恒写 `0px`（2026-10-05 补的第二半）。
- 开关入口：`sidebar-cluster.ts` 隐藏插件开关簇、在自绘标题栏 right:12 注入代理按钮
  （win32 由 `panel-buttons.ts` 平移到 150）。
- `product-policy.ts` 另有一条 overlay：禁用原生右栏终端 tab（防与自研终端双入口）。
- 历史：2026-09-18 曾做过一次同向退役（`70dcbc7`），次日 `95e7a83` un-retire；
  `RETIRED_PRESETS` 内仍留该次的历史注释。

### F3 退役模板（前例 commit `a542b1e`，dsh-file-review-kcoder）
「**双账本 + 四名单**」：`kcoder-skills-bundle.ts`（BUNDLES → RETIRED_PLUGINS）+
`preset-plugins.ts`（PRESET_PLUGINS → RETIRED_PRESETS）；四名单 =
`electron-builder.yml` extraResources / `scripts/sync-bundles.mjs` 映射 /
`remote-server.ts` PROFILE_BUNDLES / `remote-connections.ts` REMOTE_BUNDLES。
漏摘后果（该 commit 记录）：打包多带死重量 / 下次 sync 把产物拉回来 /
远端世界安装名单指向已删目录。

### F4 本插件独有的退役面（比前例多一整个宿主注入族）
除双账本 + 四名单外，本插件还是 **铁律 1 的压制/代理对象**：`style-overlay.ts`、
`sidebar-cluster.ts`、`sidebar-toggle.ts`（第三轨）、`panel-buttons.ts`、`product-policy.ts`。
四支冒烟（style-overlay / style-overlay-lifecycle / sidebar-toggle / titlebar）与
一支 probe（probe-dev-review-open）钉住了这些行为，必须同批改造。

### F5 上游基线状态
- 上游克隆 `/Users/libing/kk_Projects/deepseek-harness` 分支 `kcoder/0.2.1-alpha.1`（尖端
  `161c7122f6`）；`upstream/master` = `d743267388` = tag `dsh-v0.2.1-alpha.2`。
- 本仓 `upstream/BASELINE` 当前记录到 `0.2.1-alpha.1(5badb15009)`。
- alpha.1→alpha.2：512 提交 / 3226 文件 / +114987 −28177（属完整升级的输入，本步不消费）。

### F6 上游原生右栏能力（退役交回的对象）
`packages/client/ui-sidebar-right`（对接面 `ctx.sidebarRight` + `ctx.sidebarRightTabs`）+
`ui-sidebar-files` / `ui-sidebar-documentpreview` / `ui-sidebar-terminal` /
`ui-sidebar-browser`。alpha.2 内该族仅小改（`ui-sidebar-terminal` 终端按会话目录启动等）。

## Progress Log

- 2026-10-09 侦察：定位插件身份与全部引用点（`rg` 命中 desktop/scripts/bundle/docs）；
  读 `preset-plugins.ts` / `kcoder-skills-bundle.ts` 头部 / `sidebar-cluster.ts` /
  `panel-buttons.ts` / `style-overlay.ts` 头部 / `electron-builder.yml` / `sync-bundles.mjs` /
  `update-profile-plugins.mjs` / `remote-*.ts`；读 ARCHITECTURE §4/§7/§8/§12。
- 2026-10-09 与产品负责人确认三项决策（见上「决策」节）。
- 2026-10-09 建立本计划文件。
- 2026-10-09 **Phase 0/1 完成**。双账本：`kcoder-skills-bundle.ts`（删
  `DSH_CODING_SIDEBAR` 常量与 BUNDLES 条目 → RETIRED_PLUGINS 加名；删
  `tractionDeps` 白名单并把判据/教训留档）、`preset-plugins.ts`（PRESET_PLUGINS
  减 88 行历史后清空、RETIRED_PRESETS 加名、`ensureSidebarCompatPatch` 及
  SIDEBAR_ROW_ID/_LEGACY/COMPAT_KEYS/isOwnCompatRow/yaml import/
  SHELL_TITLEBAR_HEIGHT 全拆）。四名单：electron-builder extraResources、
  sync-bundles 映射、remote-server PROFILE_BUNDLES、remote-connections
  REMOTE_BUNDLES。另：update-profile-plugins 的 VERSION_ALIGNS 清空、
  smoke-bundle-profile 的 F27 判据翻为「退役三清」、`bundle/dsh-coding-sidebar`
  删除（477 个跟踪文件）、宿主注释清扫（index/plugins/dsh-manager/browser-host/
  release.sh/remote-server）。
  **验证**：`tsc -p tsconfig.node.json` exit 0；bundle-line 通过（bundle/ 4 个）；
  `sync-bundles --check` 通过；`smoke-bundle-profile` PASS 26/26（真跑
  `ensureKcoderBundles`，日志实录 `清除 profile 退役/孤儿插件残留:
  deps=[dsh-coding-sidebar] bundles=[dsh-coding-sidebar]`）。

### Phase 5 验证证据（全绿）

| 门 | 命令 | 结果 |
|---|---|---|
| typecheck（node+web+注入脚本+远端规格+协议） | `pnpm check` 的 typecheck 段 | exit 0 |
| 版本线 | `node scripts/check-bundle-version-line.mjs` | 通过（bundle/ 4 个，全"仅物化"） |
| 镜像对账 | `node scripts/sync-bundles.mjs --check` | 通过 |
| profile 自愈冒烟（真跑 ensureKcoderBundles） | `node scripts/smoke-bundle-profile.mjs` | **PASS 26/26**（日志实录退役三清 deps+bundles） |
| 构建 | `pnpm build` | exit 0 |
| 产物关键串 | `out/main/index.js` 断言 | 退役标识零命中（\_\_dsh_desktop_sidebar_panel_btn / attachSidebarCluster / titleBarCompat / SIDEBAR_SERVICE_VERSION）；现役标识在位（void_style / ensurePresetPlugins / \_\_dsh_kc_term_btn） |
| GUI 冒烟 12 支 | `electron --no-sandbox --disable-gpu <script>` | 全 PASS：style-overlay 21/21、lifecycle 30/30、sidebar-toggle ALL PASS、titlebar ALL PASS、panel-buttons 6/6、workspace-header、workspace-probe、brand-badge、account-chip、mcp-dom、settings-anchors 10 项、shell-protocol 21/21 |
| 无法执行的门 | `node scripts/smoke-runtime.mjs` | exit=2 —— 前置 `staging/kcoder-runtime` 不在位（需 setup/发版 staging），非本次回归 |
| 缓存 | — | — |

**未执行**：真机 GUI 实测（本仓惯例：GUI 由用户重启 app 验证，AI 不代跑）；
发版链（`release.sh audit/ship`）与 `upstream/BASELINE` 推进属本轮升级后续步骤。

## Errors

（见 Progress Log 的 Errors 段）

### 新增 Findings（执行期）

- **F7（panel-buttons 抓到的真错误）**：改 `SHIFT_JS` 时把终端钮从
  `right:182px` 写成 `150px`——那是**丢了 +138 的变换语义**（原表是
  12/44/76 → 150/182/214，每枚都 +138 = 原生 caption 区宽）。冒烟
  `scripts/smoke-panel-buttons.mjs` 当场报红（"应为 182px"），已改回 182
  并同步夹具（该冒烟 2026-10-04 刚修过一轮「坏测试」问题，这次直接受益）。
- **F8（GUI 冒烟在本机沙箱跑不起来）**：agent 的 bash 沙箱下 Electron 报
  `sandbox initialization failed: Operation not permitted` + GPU 进程 FATAL。
  加 `--no-sandbox --disable-gpu` 后**可跑**，本步全部 GUI 冒烟即以此形态执行
  （属执行手段，不进产品代码）。
- **F9（能力落差清单，供发版说明）**：退役后交回上游原生右栏的能力面为
  文件树/搜索（`ui-sidebar-files`）、文档预览（`ui-sidebar-documentpreview`）、
  终端（`ui-sidebar-terminal`，本轮已解除禁用）、浏览器（`ui-sidebar-browser`）、
  分栏/浮动（`ui-dockkit`）；**自研插件独有面需在 release notes 列明**：
  CM6 面板内编辑与保存（上游是 `ui-open-in-app` 交系统编辑器）、
  Office（docx/xlsx/pptx）与视频预览、Git 面板（变更/diff/历史/分支/提交/推送/
  GitHub）、轨迹图、任务计划与后台任务 tab。**这些落差未经真机实测确认**——
  由用户按下方验证清单逐项核对后再定稿发版说明。
- **F10（`smoke-runtime` 无法在本机跑）**：它要求 `staging/kcoder-runtime` 在位
  （需 `pnpm setup`/发版 staging），本机缺该目录 ⇒ exit=2（前置缺失，非回归）。

## Errors

1. **`product-policy.ts` 模板串被自己写坏**：把 `ui-sidebar-terminal` 的行内
   YAML 说明写成含**裸反引号**的文本，落在 `POLICY_YAML` 模板字面量里 →
   `tsc` 报 TS1005（product-policy.ts:101）。修法：去掉反引号 + 补回被吃掉的
   `#` 空行分隔；修后 `tsc` exit 0，并用 node+yaml 解析 POLICY_YAML 复核
   （顶层数组、6 条，无 `ui-sidebar-terminal`）。**教训：改模板字面量内容时，
   别在拼装串里引入模板自身的定界符。**
2. **先删模块后改引用**：删 `sidebar-cluster.ts` 与改 `windows.ts` 接线分成两次
   调用，删除先成功、编辑因"未读文件"被拒 → 短暂出现 import 悬空。已立即补上
   （`tsc` 随后 exit 0）。**教训：删除与引用清理同批完成，别跨步。**
3. **`smoke-panel-buttons.mjs` 报红**（F7，见上）——这是**有效红**，直接抓出
   我改错的产品值。
