# 退役内置终端插件 @kkutysllb/dsh-terminal（dsh 0.2.1-alpha.2 升级第二步）

## Goal

把 KCoder 内置终端插件 `@kkutysllb/dsh-terminal`（`bundle/dsh-terminal`，v1.3.0，
页面内底部 DOM 面板 + node-pty 服务端 RPC/SSE）整线退役，**终端交回上游原生右侧栏
终端 tab**（上一步已解除对 `ui-sidebar-terminal` 的禁用）。退役后 KCoder 不再自带任何
终端形态：不自绘终端按钮、不带 node-pty 依赖、不带 xterm 依赖、不保留 `/dsh-terminal/api`
路由消费面。

## 决策（2026-10-09）

1. **终端归属**：唯一终端 = 上游原生右栏终端 tab（第一步已放开）；上游终端随会话目录启动
   （alpha.2 已具备）。
2. **菜单项与快捷键一并退役**：「工具 → 切换内嵌终端」（`Control+\```）删掉——它转发的是
   插件自绘按钮；上游终端 tab 由用户在右栏自行开关，宿主不代理。
3. **依赖清账**：`node-pty` / `@xterm/xterm` / `@xterm/addon-fit` 三枚宿主依赖随宿主终端面板
   的最后一处消费者（本插件）退役而删除；`electron.vite.config.ts` 的 external 与
   `electron-builder.yml` 的 asarUnpack 同步摘除。
4. **不提交**：与第一步同批交付验证清单，提交由用户决定（建议拆两个 commit）。

## Task List

### Phase 1 — 双账本 + 四名单 + 物化面 ✅
- [x] P1.1 `kcoder-skills-bundle.ts`：删 `DSH_TERMINAL_BUNDLE` 常量与 `BUNDLES` 条目；
      `RETIRED_PLUGINS` 加 `'@kkutysllb/dsh-terminal'`（旧中间态名已在册）；文件头计数与条目改写
- [x] P1.2 `electron-builder.yml`：extraResources 映射摘除 + `node-pty/**` asarUnpack 摘除
- [x] P1.3 `scripts/sync-bundles.mjs`：映射与头部说明摘除
- [x] P1.4 `remote-server.ts` `PROFILE_BUNDLES` 与 `remote-connections.ts` `REMOTE_BUNDLES` 摘除
- [x] P1.5 `scripts/check-bundle-version-line.mjs` 的 MATERIALIZE_ONLY 摘除两个终端名
- [x] P1.6 删除 `bundle/dsh-terminal/`

### Phase 2 — 宿主面 ✅
- [x] P2.1 `panel-buttons.ts` 整模块退役（最后一条规则就是终端钮让位）+ `windows.ts` 接线摘除
- [x] P2.2 `menu.ts` 删「切换内嵌终端」项与 `Control+`\`` 快捷键
- [x] P2.3 `theme-watcher.ts`：`TITLEBAR_RIGHT_BAND` 70 → **0** 并改注释（无自绘按钮了）
- [x] P2.4 注释清扫：`windows.ts` 终端段、`ipc.ts`/`ipc-contract.ts`/`renderer/main.ts`
      的历史说明、`preset-plugins.ts` 的 node-pty 举例

### Phase 3 — 依赖清账 ✅
- [x] P3.1 `package.json`：删 `node-pty`/`@xterm/xterm`/`@xterm/addon-fit`
- [x] P3.2 `electron.vite.config.ts`：external 列表删 `node-pty`

### Phase 4 — 门与冒烟 ✅
- [x] P4.1 `scripts/smoke-panel-buttons.mjs` 删除（被测对象消失）
- [x] P4.2 `scripts/smoke-bundle-profile.mjs`：`BUILTINS` 摘终端 + 退役名断言
- [x] P4.3 `scripts/check-injected-scripts.mjs` 的协议举例改用 `dsh-shell-prefs/client.js`

### Phase 5 — 文档 ✅
- [x] P5.1 `docs/ARCHITECTURE.md`：§4 模块表（panel-buttons 行删除、theme-watcher/终端相关行）、
      §12 铁律 1 的「底面板终端去留另议」定案、§4 的 terminal-panel 历史行
- [x] P5.2 `README.md` 目录树与终端相关表述；`docs/plugin-dev-checklist.md` 适用清单

### Phase 6 — 验证 ✅
- [x] P6.1 `pnpm typecheck` / `pnpm check` / `pnpm build` + 产物关键串断言
- [x] P6.2 GUI 冒烟（titlebar / style-overlay / bundle-profile；panel-buttons 已删）
- [x] P6.3 引擎真跑一次（`DSH_HOME=~/.kcoder-dev` 起 web），确认终端包的层叠/实体被三清

## Findings

### F1 退役面比第一步窄（无铁律翻转）
本插件是「KCoder 自持终端形态」，不是产品铁律的执行点：退役不翻转任何铁律，
只回收**消费接线 + 宿主按钮/菜单/依赖**三块。上游原生右栏终端 tab 上一步已放开，
因此本步是纯粹的「减法 + 归属确认」。

### F2 标题栏按钮带随之归零
第一步删`sidebar-cluster`代理钮、本步删终端钮；本地编辑器钮（open-in-app-button）
2026-10-08 已退役 ⇒ 自绘标题栏右端**再无宿主注入按钮**，`--dsh-titlebar-right-reserve`
只剩 Windows 原生控制按钮区让位（`TITLEBAR_RIGHT_BAND` 70 → 0）。

### F3 死依赖确认
`@xterm/*` 与 `node-pty` 在 KCoder 树内除本插件与其配置项外**零消费者**
（宿主终端面板 `terminal-panel.ts`/`pty-host.ts` 2026-08 已退役，renderer 的
`#/terminal` 视图同期删除）。三枚依赖随本步清账。

### F4 自愈面
dev/打包 profile 的 `dsh.profile.bundles` 现含 `@kkutysllb/dsh-terminal`；
退役自愈（`RETIRED_PLUGINS` 三清 = bundles 层叠 + deps 声明 + node_modules 实体）
在下次启动生效，无需手工改 profile。

## Progress Log

- 2026-10-09 侦察：引用面清单（双账本/四名单/宿主按钮/菜单/依赖/冒烟/文档）落定；
  确认标题栏带宽与三枚依赖的归零事实。
- 2026-10-09 建立本计划文件。

### 计划外发现（本步一并处置）

- **F5 上游 alpha.2 的 OPTIONAL_BUNDLES 名单漂移（4 → 11 条）**：切换引擎后
  `smoke-bundle-profile` 第 6 节当场报红。新增七条 = badge-skill /
  cot-translation / ralph / session-search / session-titles / terminal-bundle /
  tool-worktree。**已同步 `UPSTREAM_OPTIONAL_BUNDLES` 镜像**——漏列会把用户开启的
  可选能力当「无来源层叠项」在下次启动删掉。印证：用户 dev profile 里正开着
  `tool-worktree` / `terminal-bundle` / `session-search` 三条，本次对账后**均保留**。
- **F6 退役三清是宿主侧动作，引擎自跑不触发**：直接起引擎（DSH_HOME=~/.kcoder-dev）
  不会清 profile —— 三清在 KCoder 主进程的 `ensureKcoderBundles()` 里，发生在 spawn
  引擎之前。故本轮验证改用**宿主同一路径**（esbuild 编译 `kcoder-skills-bundle.ts` +
  electron 影子 + 真 dev home）实跑，日志实录
  `清除 profile 退役/孤儿插件残留: deps=[] bundles=[@kkutysllb/dsh-terminal]`，
  终态：deps {} / bundles 无终端 / 实体删除。

### Phase 6 验证证据（全绿）

| 门 | 结果 |
|---|---|
| `pnpm check`（typecheck + 版本线 + 镜像对账 + 自愈冒烟） | **PASS 36/36**（自愈冒烟已扩到两条退役包：无 scope 与作用域包各一） |
| 真实 dev home 宿主对账 | 终端层叠 + 实体三清，用户可选包零误伤 |
| `pnpm build` | exit 0 |
| 产物关键串 | 零命中：`__dsh_kc_term_btn` / `attachPanelButtons` / `__dsh_desktop_sidebar_panel_btn` / `/dsh-terminal/api`（`node-pty`/`@xterm` 仅剩退役注释文本）；在位：`__dsh_desktop_toggle_btn` / `ensureKcoderBundles` |
| GUI 冒烟 11 支 | 全 PASS（titlebar / style-overlay 21 / lifecycle 30 / sidebar-toggle / workspace-header / workspace-probe / brand-badge / account-chip / mcp-dom / settings-anchors 10 / shell-protocol 21） |
| KCoder 锁 | `pnpm install --no-frozen-lockfile` exit 0（三枚依赖摘除） |

**未执行**：真机 GUI 实测（后端到端由用户重启 app 验证：终端只在原生右栏、无自绘按钮、菜单无「切换内嵌终端」）。

## Errors

（暂无）

## 追加修复：右侧状态簇贴边（2026-10-09，用户实测）

**症状**：退役宿主注入按钮后，标题栏右上状态簇（SSH 胶囊、原生右栏展开按钮等）
贴到窗口右缘（用户截图 + 「右边的按钮太靠近边界了」）。

**根因**：`--dsh-titlebar-right-reserve` 由 theme-watcher 发布（旧值 = 按钮带宽
70 + Windows padRight），而 `workspace-header` 把它当**会话页头的 padding-right**
（`padding: 0 var(--dsh-titlebar-right-reserve, …) 0 …`）。本步把按钮带宽归零 ⇒
padding-right 0 ⇒ 状态簇顶到右缘。**归零是错的语义**：按钮没了不等于右侧不需要留白。

**处置**：带宽改为 **12px 尾部呼吸位**（theme-watcher `TITLEBAR_RIGHT_BAND = 12`；
workspace-header 的兜底字面同步 70 → 12）。取值依据：与左侧「侧边栏右缘 + 12px」
同节奏，且等于上游 `_headerCorner` 自身的右缘留白（28px 右内边距 + margin-right:-16px
= 12px）。Windows 仍由 padRight(138) 叠加原生控制按钮区。

**顺带修的测试债（真·假绿）**：`smoke-titlebar` 与 `smoke-workspace-header` 把该
常量**写死在自己的作用域里**（70）用于还原模板插值 ⇒ 源码把常量改成 0/12 后两支
冒烟照样报绿。已改为**从源码读常量**；并新增「发布语句必须绑定常量」静态断言
（`setProperty('\${TITLEBAR_RIGHT_VAR}', '\${TITLEBAR_RIGHT_BAND + TP.padRight}px')`）。
负对照实证判别力：把发布语句改成字面量 `'0px'` → 冒烟 exit 1 并打印
「发布语句未绑定 TITLEBAR_RIGHT_BAND」。

**回归**：`pnpm check` 36/36；11 支 GUI 冒烟全绿（含上述两支 + 负对照）；
`pnpm build` exit 0。
