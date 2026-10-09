# 全仓库审计报告 — v0.6.27

> 审计日期：2026-10-09 · 范围：v0.6.26（tag）→ HEAD 的改动面（2 个提交 + 本版发行文件）。**本版引擎基线不变**：上游 deepseek-harness `0.2.1-alpha.1`（`5badb15009`），fork 集成分支 `kcoder/0.2.1-alpha.1`（`161c7122f6`，**领先远端 0 个提交**——满足 `release/README.md` 第 3 条）。本版是 **v0.6.26 现场回归的修复版 + 拖拽引用补能**，无插件升版（registry 无需重验）、无引擎升级。

## v0.6.26 事故记录（本版的由来，如实入档）

v0.6.26 发布约 1 小时后用户现场回报：协议形态下提供商目录报「加载提供商目录失败： settings are unavailable in this browser」。

- **根因**：上游客户端按「页面 origin 是否回环」判特权面 `ctx.remote.$host.isLoopback`（`packages/client/connection` + `loopback-hostname.ts`），ui-settings 镜像据此选 host/memory 持久化（`ui-settings/src/client/index.ts:39`）。`kcoder-app://app` 非回环 ⇒ 镜像进 memory ⇒ `ensure()` 空转、describe 视图永缺（同批两路 RPC 却都成功）⇒ 兜底成该文案。settings 文档控制器、聊天设置作用域同族静默降级。
- **修复**（`1a7306f`）：注入全局按上游 `ClientTransportHooks` 的显式声明位补第二成员 `ownsHost:true`（上游自家 worker 组合 `apps/web/src/main.ts:25-26` 同款双成员），`isLoopback` 无视页面 authority 恒真——本产品页面只能经协议层触达侧车，声明属实。一处修复覆盖全族消费方（ui-settings / ui-settings-general / ui-chat 读的是同一个 `$host.isLoopback`；`isLoopbackHostname` 无绕过 connection 包的直接消费方）。
- **现场负对照**：用户打包版关「工作台协议加载」回直连即恢复——根因判定被现场反向钉死。
- **为什么门没拦住（如实记）**：提供商目录面无任何冒烟覆盖；灰度验证（聊天/流/landing/MCP/技能）没人开过模型页；故障形态是纯逻辑静默（不崩、无报错日志），假侧车冒烟看不见引擎语义。防复发：`check-shell-protocol` H7/H8 把注入契约钉死（含 v0.6.26 旧注入形态必红的负对照）、`smoke-shell-protocol` P3b 真渲染进程断言；`plans/kcoder-app-protocol.md` 新增 F6b 契约条目。同轮全类扫描（isLoopback / location / baseURI / SW / SSE / `__DSH_*` 全局 / wss 分叉）确认**无第二个同族回归**（详见该轮排查记录：上游无 SW、SSE 仅上游开发期 HMR、`streamBaseUrl.origin` 在账号页只是 RPC 字符串参数与直连同值、localStorage 在恒定 origin 下可用）。

## 硬性门

| 门 | 结果 | 说明 |
|---|---|---|
| TYPECHECK | ✅ PASS | tsc 双 project 零错误（含新 `desktop/preload/host-paths.ts`，sandboxed preload 的 location 类型面以本地 declare 声明）；注入脚本自检 **17 / 44**（与 v0.6.26 持平）+ 远端 addon 规格门 25 项 + shell 协议逻辑门 **62 断言**（v0.6.26 的 54 + ownsHost 契约 H7/H8 + host-paths 源码守卫 K1–K6） |
| LINT | ✅ PASS | oxlint **3 warning / 0 error**，全为 `no-unused-vars` 既有三项（`remote-connections.ts:105` fail / `remote-server.ts:495` patch / `remote-server.ts:571` pickPort，v0.6.23 起同组）；无安全类警告 |
| SECURITY | ✅ PASS | `pnpm audit --prod --audit-level=high`（固定 npmjs 官方 registry）无 high+ 漏洞 |

命令：`bash scripts/release.sh audit` → 退出码 0。

## 报告项（逐条处置）

### DEAD EXPORTS（2 项）——与 v0.6.25 / v0.6.26 完全同清单，零新增

| 项 | 处置 |
|---|---|
| `desktop/main/remote-connections.ts:43 - openRemoteHostIds` | **豁免**：远程主机子系统的公开查询面，保留给后续远程窗口菜单消费（v0.6.19 起同项同理由） |
| `desktop/main/remote-server.ts:291 - remoteInstallReady` | **豁免**：远程工作区 B-β 线预留 API（同上） |

### UNUSED DEPS（10 项）——沿用既有豁免（v0.6.17 起同清单）

`electron-vite`、`@types/node`、`electron`、`@shared/ipc-contract`、`semver`、`@types/semver`、`yaml`、`electron-updater`、`react`、`react-dom`。electron/react 系为 peer 性质由 electron-vite 消费，semver/yaml 在 main 进程经 CJS 依赖图使用（审计工具按 ESM import 计）。**本版无新增。**

### 内置插件

**本版零插件升版**（PRESET 声明不动）：terminal 1.3.0 / coding-sidebar 1.0.40 / skills-bundle 1.1.0 维持 v0.6.26 已核验态（npmjs + npmmirror 双源可见，见 `release/audit-v0.6.26.md`）。版本线门照过。

## 本版改动面（审计覆盖范围）

| 面 | 文件 / 提交 | 性质 |
|---|---|---|
| **ownsHost 修复** | `desktop/main/shell-protocol-core.ts`（注入全局补第二成员）+ `check-shell-protocol.mjs`（H2 契约串更新 + H7/H8）+ `smoke-shell-protocol.mjs`（P3b）+ `plans/kcoder-app-protocol.md` F6b（`1a7306f`） | 见上「事故记录」 |
| **拖拽引用桥** | **新增** `desktop/preload/host-paths.ts` + `electron.vite.config.ts` 双 preload 入口 + `windows.ts` shell 窗口接线 + check K1–K6 + smoke P3c/P3d + plans D3 例外记录（`bf4e1d5`） | composer 把有真实路径的拖入/选取文件转 `@绝对路径` 引用（不走字节上传），依赖壳侧 `__DSH_HOST_PATHS__.pathFor`；`webUtils.getPathForFile` 必须在能持有页面 File 对象的 electron 上下文里调，注入器体系（页面主世界）无此能力——上游官方桌面（同为自定义 scheme + `sandbox:true`）即同款单桥。**铁律 1 唯一例外**：origin 门（仅 kcoder-app://app）、恰好一个方法、无宿主通道、`data-platform`/`dshDesktopBoot`/`window.desktop` 一概不进引擎页——上游 web 形态保持，注入器自持几何的前提不变 |
| 发行 | `release/v0.6.27.md` + 本报告；版本号 bump 由 ship 承担 | — |

## 验证（本版核心风险面）

| 项 | 证据 |
|---|---|
| 仓库聚合门 | `pnpm run check` 退出码 0：typecheck（注入脚本门 + addon 规格 25 + shell 协议逻辑门 62）+ 版本线 + 同步对账 + profile 自愈 25/25 |
| 冒烟 | **13 支全绿**（12 GUI + 1 node）；其中 shell 协议层 **21 断言**（18 + P3b ownsHost + P3c/P3d 桥） |
| **协议语义红-绿** | ownsHost：dev 实机 CDP 驱动 设置→模型 页——提供商目录完整渲染（v0.6.26 报错面，修复后含用户真实配置 5 个 provider）；现场负对照（直连恢复）由用户打包版提供 |
| **拖拽链红-绿** | CDP 模拟真实 OS 文件拖放（dragEnter→dragOver→drop 带真实路径）→ composer 落 `reference` 引用芯片（pathFor→相对化→mention 链路，非上传）；P3c 合成 File 回空串（无路径回落上传契约）；P3d 负对照（三个桌面分支全局运行时缺席）；**用户访达真实拖拽 GUI 验收通过**（2026-10-09） |
| fork 锚定 | `kcoder/0.2.1-alpha.1` 领先远端 0 |

## 本版已知未决（非审计门）

| # | 项 | 定性 |
|---|---|---|
| 1 | `smoke-runtime` 本地未单独跑 | 打包期产物属 CI 责任面（v0.6.24 起同项） |
| 2 | 本地未做签名/公证打包 | 正式产物由 CI 签名公证（同上） |
| 3 | `brand-assert.mjs` Windows + Git Bash tar 问题 | 既有、平台局部（v0.6.23 起同项） |
| 4 | 「从文件树拖进 composer」手势任何端都不存在 | 原生树 dragstart 只放 `text/plain`（树内重排），composer 只认 `Files` 类型——与官方桌面行为一致，**非回归**；若要补属插件侧功能（铁律 2） |
| 5 | 阶段 4 第 2 步（直连路径退役） | 设计如此：待协议形态观察期后执行（7 项清单在 plans） |
| 6 | v0.6.26 仍挂在 Releases | 已知带病版本；0.6.27 上线后自动更新即覆盖，存量 0.6.26 用户若关了协议开关不受影响 |

## 结论

硬性门全过；报告项全部沿用既有豁免（零新增）；本版修复 v0.6.26 的协议语义回归（一处契约位覆盖全族消费方，带实机红-绿与现场负对照）并以最小单桥补上拖拽引用能力（源码级最小性守卫 + 真渲染进程断言 + 用户 GUI 验收）；全类环境分叉扫描确认无同族残留。**建议发布。**
