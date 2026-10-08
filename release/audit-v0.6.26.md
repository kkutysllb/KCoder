# 全仓库审计报告 — v0.6.26

> 审计日期：2026-10-08 · 范围：v0.6.25（tag）→ HEAD 的改动面（10 个提交 + 本版发行文件 + 审计期修复）。**本版引擎基线不变**：上游 deepseek-harness `0.2.1-alpha.1`（`5badb15009`），fork 集成分支 `kcoder/0.2.1-alpha.1`（`161c7122f6`，**领先远端 0 个提交**——满足 `release/README.md` 第 3 条）。本版主题是**独立桌面端改造收口**（协议化加载转正 + 技能面归原生 + landing 重设计），无引擎升级。

## 硬性门

| 门 | 结果 | 说明 |
|---|---|---|
| TYPECHECK | ✅ PASS | tsc 双 project 零错误；**typecheck 链本版扩员**：注入脚本自检（**17 个注入脚本 / 44 个源文件**，较 v0.6.25 的 19/46 减少——skills 注入器与 open-in-app 注入器退役；零悬空引用，bundle client 半协议合规）+ 远端 addon 规格门 **25 项全过** + **新增 `check-shell-protocol.mjs`（54 断言，协议层纯逻辑：scheme 特权 / 转发路由 / 头剥离与扣留 / HTML 注入 / WS 守卫判定）** |
| LINT | ✅ PASS | oxlint `desktop scripts` 作用域 **3 warning / 0 error**，全为 `no-unused-vars`：`remote-connections.ts:105`（`fail`）、`remote-server.ts:495`（`patch`）、`remote-server.ts:571`（`pickPort`）——**与 v0.6.23 / v0.6.24 / v0.6.25 同一组三项**。审计初跑时为 5 warning：多出的两条是**本版自己的工作留下的死导入**（`shell-protocol.ts` 的 `SHELL_APP_HOST`、`index.ts` 的 `authLoggedIn`），已**修复而非豁免**，回落到既有三项 |
| SECURITY | ✅ PASS | `pnpm audit --prod --audit-level=high`（固定走 npmjs 官方 registry）**无 high+ 漏洞** |

命令：`bash scripts/release.sh audit` → 退出码 0。

## 报告项（逐条处置）

### DEAD EXPORTS（2 项）

| 项 | 处置 |
|---|---|
| `desktop/main/remote-connections.ts:43 - openRemoteHostIds` | **豁免**：远程主机子系统的公开查询面，保留给后续远程窗口菜单消费（v0.6.19 / v0.6.20 / v0.6.23 / v0.6.24 / v0.6.25 同项同理由） |
| `desktop/main/remote-server.ts:291 - remoteInstallReady` | **豁免**：远程安装就绪态的导出面，属远程工作区 B-β 线的预留 API（同上） |

> `desktop/shared/ipc-contract.ts` 的契约面类型由 `audit.mjs` 内置豁免规则覆盖。**本版零新增。**

### UNUSED DEPS（10 项）

`electron-vite`、`@types/node`、`electron`、`@shared/ipc-contract`、`semver`、`@types/semver`、`yaml`、`electron-updater`、`react`、`react-dom` —— 全部**沿用既有豁免**（v0.6.17 起同清单）：electron/react 系为 peer 性质由 electron-vite 消费，semver/yaml 在 main 进程经 CJS 依赖图使用（审计工具按 ESM import 计）。**本版无新增。**

### 内置插件发布核验（`PRESET_PLUGINS` 平移前提）

**判据：直查 registry 一手端点**（v0.6.25 教训的纪律：不采信 `npm view` 缓存）。本版两个内置插件升版：

| 插件 | 指定版本端点（npmjs） | `dist-tags.latest` | 发布时刻 | npmmirror | 结论 |
|---|---|---|---|---|---|
| `dsh-skills-bundle@1.1.0` | **200** | **1.1.0** | 2026-10-07T16:20:58Z | **200** | 双源可见 |
| `dsh-coding-sidebar@1.0.40` | **200** | **1.0.40** | 2026-10-07T17:46:57Z | **200** | 双源可见——**无需 v0.6.25 的镜像滞后豁免** |
| `@kkutysllb/dsh-terminal@1.3.0` | （本版不动） | 1.3.0 | 2026-10-05（上版核验） | — | 版本线门照过：PRESET 声明同线、内容无变更 |

镜像链：`dsh-plugins` 真源仓先行入库（skills-bundle 与 sidebar 各自同步提交，sidebar 批次为 `00ebc3c`，含 pre-commit 铁律钩子要求的根 README 清单），`sync-bundles --check` 零差异。

## 本轮审计教训（如实记录）

**审计全量复跑当场拦下一支真红冒烟。** 12 支 GUI 冒烟在审计期全量复跑时，`smoke-mcp-dom` 渲染进程抛错挂死。定位：86ff622（MCP 分区重构）把卡片 DOM 契约从 `.dmi-toggle` / `.off` 类改为 `.dmi-switch` 胶囊 + `data-on` 属性，**产品行为本身经用户真机验收无恙，但专属冒烟没跟着新契约走**——该冒烟不在 prepush 门里，提交时无人复跑，红被带进了主线。处置：判定为「有意的 DOM 契约变更、冒烟未跟进」，冒烟两处断言更新到新契约（`.dmi-card[data-on=false]`、`.dmi-switch`）后 light/dark 双场景全绿。这正是发版审计「全量复跑」存在的理由：**没有门的面，就得靠审计这一道把假绿捞出来**。

## 本版改动面（审计覆盖范围）

| 面 | 文件 / 提交 | 性质 |
|---|---|---|
| **协议化加载** | **新增** `desktop/main/shell-protocol-core.ts`（零依赖纯逻辑）+ `shell-protocol.ts`（protocol.handle 接线 + WS 守卫）；`windows.ts` 双模式（协议/直连）+ hostOrigin 级重载判定；`store.ts` `shellProtocolMode`；`ipc.ts`/`preferences.ts` 设置项「工作台协议加载」；诊断页加载形态标签（`538a8e3` + 灰度翻转 `ad6b07b`） | `kcoder-app://app` 自定义协议（privileged：standard/secure/supportFetchAPI/corsEnabled/stream/codeCache）接管页面供给：文档照常转发 `dsh web` 侧车（服务端注入表不破）、HTML 注入单一全局 `__DSH_TRANSPORT__.streamBaseUrl`（**无 preload**——铁律 1 的 no-preload 前提保持）、响应扣留 `set-cookie`、WS 升级只放行「本地 shell 窗口 + 页面 origin 正确」并重写 origin/cookie。上游官方桌面壳同构而形态不同（上游打包 dist + preload 递 injections）；设计分歧与验收记录：`plans/kcoder-app-protocol.md` |
| **技能面归原生** | **删除** `skills-settings.ts`（注入器）/ `skills-catalog.ts`（目录扫描）/ `workspace-base.ts`（连带死亡）/ `smoke-skills-page|dom.mjs`；`workspace-probe.ts` 瘦身（`__dsh_wsprobe__` console 上行整链拆除，只留标题栏工作区变量 + 类型徽章）；bundle skills-bundle `1.0.4` → **`1.1.0`**（`11f5097`） | 插件 1.1.0 自带原生「技能 / 可选技能」设置分区 + 自有 fenced API（启用集自持久化），自建注入器与之并存即冲突，整链退役 |
| **侧边栏 1.0.40** | `bundle/dsh-coding-sidebar` 同步 + `preset-plugins.ts` 平移 `^1.0.40`（`3d76623`） | 上游做减法：移除「智能体团队 / 侧边对话」页签与「按功能启停」开关（全部内置开启，旧键不迁移）；KCoder 消费面零适配（toggle 语义子串 / inset 契约未动） |
| **landing 重设计** | **新增** `landing.css` + `public/shots/`（CDP 真机抓图 4 张）；`landing.ts` 重写；`app.css` 1132 → ~445 行；恒深色：`landingTheme` store 字段 / `theme:landing` IPC / preload 桥接 / 契约接口 / theme-watcher 两函数全链退役，启动恒 `applyNativeTheme('dark')` + `showBootstrap('landing')` 唯一闸口（`3d0e4bf`） | 参考 deepseek.com/harness：hero → 真实桌面截图 → 三特性卡片，动画全纯 CSS（`prefers-reduced-motion` 退场）；主题切换退役（**landing 恒深色**，工作台内仍跟随上游渲染主题） |
| **MCP 设置页重构** | `mcp-settings.ts` PAGE_JS + 样式（`86ff622`） | 对齐技能分区设计语言：网格卡片 / pill 开关（seal-fill）/ color-mix 主题自适应 / 徽章胶囊化；**DOM 契约变更**（`.dmi-toggle`→`.dmi-switch`、`.off`→`data-on`）——审计期据此修复 `smoke-mcp-dom`（见上） |
| **杂项退役** | open-in-app 注入器 + 「在本地编辑器中打开」状态栏按钮删除（`07c0173`）；麒麟换锚分析文档作废/删除（`2c0e5c0`、`ba2c615`）；麒麟遗留 staging 树删除（会话内处置） | 减法收口 |
| **Windows 修复** | `deps-freshness.mjs` 行尾归一化（CRLF 检出 vs LF 快照恒误报）+ 路径文案纠错；`sync-bundles.mjs` `filesEqual` 同类归一化；`smoke-bundle-profile.mjs` 隔离自检改「只认真 home 三个已知落点」（Windows TEMP 在主目录内 ⇒ 旧判据恒假）；landing 快捷键平台字形 + `Mod+Enter` 真实绑定（`dfb7bfd`，Windows 侧实测回传） | 三处「Windows 上永远修不好的假失败」+ 一处「任何平台都按不响的空头支票快捷键」 |
| **诊断打码** | `dsh-manager.ts` `redactReadyToken` 进 `appendLog` | 诊断日志中 `?token=…` 一律 `***`（用户问询驱动的修复：协议化加载后诊断里仍有一行明文令牌地址） |
| **发行** | `release/v0.6.26.md` + 本报告；版本号 bump 由 ship 承担 | — |

## 验证（本版核心风险面）

| 项 | 证据 |
|---|---|
| 仓库聚合门 | `pnpm run check` 退出码 0：typecheck（含注入脚本门 17/44 + addon 规格 25 项 + **shell 协议逻辑门 54 断言**）+ 内置插件版本线 + bundle 同步对账 + profile 自愈冒烟 **25/25**（含「退役非编码技能零回流」） |
| **冒烟全量** | **13 支全绿**（12 GUI + 1 node）= account-chip / brand-badge / **mcp-dom（light + dark；审计期真红 → 契约跟进 → 绿，见上）** / panel-buttons / settings-anchors / sidebar-toggle / style-overlay / style-overlay-lifecycle / titlebar / workspace-header / workspace-probe（断言已翻转：`__dsh_wsprobe__` 上行列入退役面） / **shell-protocol 18 断言** / bundle-profile 25/25 |
| **协议层红-绿** | `smoke-shell-protocol`：真 Chromium + 真协议层 + 假侧车过全链（转发 / 头剥离 / set-cookie 扣留 / streamBaseUrl 注入 / WS 头改写）；含**负对照 W5**（第二个窗口的 WS 升级 origin **不**被改写 ⇒ 守卫只认本地 shell 窗口）。逻辑半区 `check-shell-protocol` 54 断言含禁目标 / 头剥离表 / 注入点各负例。另经 CDP 真机核验：dev 应用实际以 `kcoder-app://app/?dsh-desktop-titlebar-inset=48` 加载 |
| **退役面红-绿** | `smoke-workspace-probe` 负对照（旧源）精准红在「上行必须为零」新断言；`smoke-bundle-profile` 25/25 含退役技能零回流 |
| **Windows 修复红-绿** | `deps-freshness` 反向对照（内容真不同仍判陈旧）3/3；`pnpm run check` 在 Windows 本机由 24/25 回到 **25/25**；landing 快捷键平台矩阵 **8/8**（双平台字形 × 触发/不触发） |
| fork 锚定 | `kcoder/0.2.1-alpha.1`（`161c7122f6`）**领先远端 0**；`release/README.md` 第 3 条满足 |

## 本版已知未决（非审计门）

| # | 项 | 定性 |
|---|---|---|
| 1 | `smoke-runtime` 本地**未单独跑** | 靶子 `staging/kcoder-runtime` 属打包期物化产物；跑它属 `release.sh build` 第 4 步，本版走 `ship → prepush`，打包由 CI 三平台承担（CI 内重跑同类检查）。（v0.6.24 / v0.6.25 同项） |
| 2 | 本地未做签名/公证打包 | 同上：正式产物由 CI 签名公证，本地 build 属应急路径（v0.6.24 / v0.6.25 同项） |
| 3 | `brand-assert.mjs` Windows + Git Bash 绝对路径 tar 问题 | 既有、平台局部：CI 传相对路径不受影响（v0.6.23 起同项） |
| 4 | 协议化加载的**直连退役未执行** | **设计如此**：`plans/kcoder-app-protocol.md` 阶段 4 第 2 步（7 项 legacy 清单）留待本版观察期后执行；灰度期内 `shellProtocolMode` 开关（设置页「工作台协议加载」）随时可回退直连 |

## 结论

硬性门全过；报告项全部沿用既有豁免（本版零新增，审计期顺手修掉本版自己引入的 2 条死导入）；两个升版内置插件 npmjs + npmmirror **双源一手端点核验通过**（本版无镜像滞后豁免）；本版核心风险面（协议化加载的转发/注入/WS 守卫、技能面退役的零回流、MCP 契约变更的冒烟跟进、Windows 修复的反向对照）均有**带负对照的红-绿证据**；审计全量复跑当场拦下并修复一支随上版提交就该红的过时冒烟。**建议发布。**
