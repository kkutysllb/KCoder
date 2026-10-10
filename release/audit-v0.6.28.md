# 全仓库审计报告 — v0.6.28

> 审计日期：2026-10-10 · 范围：v0.6.27（tag）→ HEAD 的改动面（**30 个提交** + 本版发行文件）。
> **本版引擎基线升级**：上游 deepseek-harness `0.2.1-alpha.2`（`d743267388641bc76f17c45ce8b4c231aed1d32c`）
> + fork 集成分支 `kcoder/0.2.1-alpha.2`（`41f151ab20`，**领先远端 0 个提交**——满足 `release/README.md` 第 3 条）。

## 硬性门

| 门 | 结果 | 说明 |
|---|---|---|
| TYPECHECK | ✅ PASS | tsc 双 project 零错误；注入脚本自检（零悬空引用 + bundle client 半协议 + **新增加载器仿真**）+ 远端 addon 规格门 25 项 + shell 协议逻辑门 **65 断言**（v0.6.27 的 62 + `C6b` https 基址 + `L1/L2` 就绪行 http(s) 与回环锚定） |
| LINT | ✅ PASS | oxlint **3 warning / 0 error**（`no-unused-vars` 既有三项，v0.6.23 起同组）；无安全类警告 |
| SECURITY | ✅ PASS | `pnpm audit --prod --audit-level=high`（npmjs 官方 registry）无 high+ 漏洞 |

命令：`bash scripts/release.sh audit` → 退出码 0。

## 报告项（逐条处置）

### DEAD EXPORTS —— 本版**清零**（0 项待处置，另 3 项已知豁免）

v0.6.25–v0.6.27 的三份报告里，下列两项长期以「预留 API」豁免。本版复核确认二者**全仓零消费者**（含脚本面），
按审计口径走**修复**路径删除，不再豁免——预留但无人调用的导出只会沉淀成假契约：

| 项 | 处置 | 理由 |
|---|---|---|
| `desktop/main/remote-connections.ts` `openRemoteHostIds()` | **删除**（`34300b3`） | `connections` Map 的枚举口，远端连接改造后无任何调用方 |
| `desktop/main/remote-server.ts` `remoteInstallReady()` | **删除**（`34300b3`） | 「远端 runtime 是否就绪」已由 `provisionRemoteRuntime` 的引擎指纹/引擎态判定取代（`runtime/.engine-fingerprint` + `dsh-app-boot` 版本探测）；两条事实源只会漂移 |

### UNUSED DEPS —— 本版**清零**（报告曾长期列出 10 项，实为脚本误报，已修）

**订正历史报告**：v0.6.17–v0.6.27 的报告把 10 项依赖列为「未使用并沿用豁免」，实为 `scripts/audit.mjs`
读错 depcheck JSON 键位——`using` 是「该依赖被哪些文件用到」的**已使用**映射，「未使用」清单是
`dependencies` / `devDependencies`（同一份输出里两者均为 `[]`）。逐条核对结论：

| 依赖 | 声明 | 实际使用（depcheck `using` 实证） | 结论 |
|---|---|---|---|
| `electron-vite` / `@types/node` / `electron` | devDep | `electron.vite.config.ts`、`tsconfig.node.json`、`scripts/{fix-electron,make-icons,run-electron}.mjs` | 在用（构建期/类型/运行时二进制） |
| `semver` / `@types/semver` / `yaml` / `electron-updater` | dep / devDep | `dsh-contract.ts`、`kcoder-skills-bundle.ts`、`mcp-store.ts`、`product-policy.ts`、`updater.ts` | 在用 |
| `@shared/ipc-contract` | **非声明**（tsconfig 路径别名） | `desktop/renderer/src/**` | 非依赖，无处置 |
| `react` / `react-dom` | **非声明** | 仅 `assets/legacy/*.tsx`（原项目源码**存档**：不被任何 tsconfig 覆盖、不入构建、无在役代码 import；本机 `node_modules/react` 亦不存在） | 非我方依赖，无处置 |

修复（`c393f45`）：改读 `dependencies` + `devDependencies`，并把该坑写进脚本注释；**判别力负对照**：
向 `package.json` 塞入假依赖 `kcoder-audit-probe` ⇒ 恰好报「1 项：kcoder-audit-probe」，还原即「无」。
该修正对发版链有意义：`release.sh` 在 ship 前置会跑本审计，改写前的报告会在每次发版时给出误导性清单。

## 内置插件（bundle 线）

| bundle | 版本 | 本版变化 |
|---|---|---|
| `dsh-ssh-remote` | **0.1.5** | `ssh_edit` 期望哈希 token（bad-args / stale-edit 均在**远端写入之前**拒绝）+ 建连瞬时拒绝重试（3 次、2s→8s 退避；`_delayRef` 保证短脚本不被退避计时器放跑）；测试 T7.9–T7.12 / T19.6–T19.9；三仓（源仓 / 镜像 / KCoder bundle）已同步，npm 已发 0.1.5 |
| `dsh-shell-prefs` | **1.0.4** | `factory(require)` 契约修正 + 槽组件撤回（工作区名特性退役）；见「本版事故与修复」 |
| `dsh-skills-bundle` | 1.1.0 | 不变 |

版本线门（`check-bundle-version-line`）通过：声明同线 + 内容变更伴随版本变更。

## 本版事故与修复（如实入档）

**`dsh-shell-prefs` 插件激活失败**（用户实机回报：`Failed to load plugins` / `web boot: 1 entry did not activate` /
`import failed: require is not defined`）：

- **根因**（两处，均为本版引入）：① client-modules 契约是 `factory(require)`（上游 tsdown 同款 stamp），
  而新写的工厂是 `factory: () => {}`——没有形参，模块内 `require('react')` 即 `require is not defined`；
  ② React 取在工厂顶部且不在 `try` 内，一炸**连该 bundle 的主职责（locale/theme 偏好桥）一起带走**。
- **修复**（`88e61fa`）：工厂改为 `(require) =>`；React 改**懒取**并整段包在 `try` 内（取不到只是槽不注册）。
- **防复发**：`check-injected-scripts.mjs` 第 4 段新增两条——静态（用了 `require(...)` 则工厂必须声明形参）
  + `node:vm` **仿真真加载器**（真调 `load()` 捕获工厂 → arity ≥ 1 → 以桩模块调用不得抛错）。
  负对照实证：去掉形参 ⇒ 「✗ 工厂未声明 require 形参（arity=0）——require(...) 必炸」、exit 1。
- **为什么门没拦住**：v0.6.27 的注入面自检只覆盖「无裸 ESM export」与悬空引用，不覆盖**工厂形参**这一契约位；
  且该失败只发生在真渲染进程（静态检查与假侧车冒烟都看不见）。现已由上述仿真闸补上。

## 本版改动面（审计覆盖范围，30 提交）

| 面 | 代表提交 | 性质 |
|---|---|---|
| **引擎基线升级 alpha.2** | `fd6a908` `50ab856` | 上游 tag `d7432673` 重放（6 处冲突处置保留上游语义）；分析/计划/核对三文档落盘；铁律 3（升级总纲）新立 |
| **两项内置插件退役** | `576e3e4` `f3e8d61` | 右侧边栏（铁律 1 翻转）+ 内置终端；宿主侧三清自愈 + 四名单收口 + 打包链 extraResources 清理 |
| **实验性组合包随版打包** | `0577b46` | 11 个上游实验性 bundle 供给块（物化闭包 + 声明）+ 宿主 `optionalBundleResolvable` 实态判据 + 默认选中；构建门 `verify-runtime-experimental.mjs` |
| **协议加载唯一形态** | `9980ff6` | legacy 直连路径、`shellProtocolMode` 字段/契约/开关全删；诊断页加载形态改常量 |
| **对齐上游 `dsh-app://`** | `7cba94e` | WS 补 `wss://` + 协议匹配；就绪行接受 `http(s)`（配合上游 TLS 监听 #8）；补 `C6b`/`L1`/`L2` 断言 |
| **注入面字体跟随上游** | `9bc83a2` | 39 处写死字号改继承 + 不变量闸（豁免名单带理由） |
| **桌面改造分析（C 收敛式）** | `d63aeb6` `c712f52` `22973a8` | 拍板 Q-D1=C 并记入 ARCHITECTURE §12 配套产品决策 |
| S-D2 第一刀与其撤回 | `d15b4de` `88e61fa` `77aa831` | 工作区名按钮曾改注册官方槽 → 用户实机判断鸡肋，**整特性退役**（含槽版本撤回） |
| landing 无痕滚动条 | `b3a1a96` | 可滚动、不显示、不占宽 |
| **工具链单源收口**（外部提交，起于 Windows 现场） | `bffb99e` `999a8e5` `793984a` `a2d9e9f` `f2df96f` | 上游落点（`upstream-dir.mjs`）/ 构建 pnpm（`pnpm-pinned.mjs`）/ 集成分支名（`upstream/BRANCH`）各一份唯一实现；跨平台冒烟入口 `run-electron.mjs`；vendor pnpm 改跟上游声明（11.7.0 → 11.28.5，**下次 release 构建生效**） |
| 远端可诊断性 | `9c03d1c` | 平台探测失败不再只报「(空)」；中转拒连文案纳入传输层重试判据 |
| 审计修正 | `34300b3` `c393f45` | DEAD EXPORTS 清零 + UNUSED DEPS 键位修正 |

## 验证（本版核心风险面）

| 项 | 证据 |
|---|---|
| 仓库聚合门 | `pnpm check` **39/39**（typecheck 链含注入脚本自检 + addon 规格 25 + shell 协议逻辑门 65；版本线；同步对账；profile 自愈 F27/F28/F29） |
| 冒烟 | **13 支全绿**（GUI 12 + node 1）：titlebar / workspace-header / style-overlay 21/21 / style-overlay-lifecycle 30/30 / sidebar-toggle / settings-anchors 10 / mcp-dom / account-chip / brand-badge / **shell-protocol 21** / workspace-probe / bundle-profile |
| 升级落地核对 | `docs/upstream-0.2.1-alpha.2-verification.md`：47 条发布说明逐条判定 + 官方指南 20 主题 + 13 项未提及的结构性变更 + 6 处冲突文件逐个核 + 34 条判定表 |
| 上游 helper 归档 | 官方验证器本机实跑 **exit 0**：`runtime.checks` = executable-handshake / guarded-files-and-streams / managed-process-output / process-cancellation / native-pty / native-flock / embedded-ptc-and-deadline / **sandbox-enforcement**；`sandboxLane=required`、`restrictedWorker=true`、`readonlyInstall=true`、`concurrentColdStarts=2` |
| 远端连接 | LAN 实机 **13/13** 通过（L3.4 修复后） |
| **Windows 真机** | **用户验证通过（2026-10-10）**：插件激活（`Failed to load plugins` 消失）、协议加载唯一形态、退役面（右栏/终端交回原生）、Windows 原生控制按钮区、landing 无痕滚动条 |
| fork 锚定 | `kcoder/0.2.1-alpha.2` 领先远端 **0** 个提交 |

## 本版已知未决（非审计门）

| # | 项 | 定性 |
|---|---|---|
| 1 | `smoke-runtime` 未在本机单独跑 | 打包期产物属 CI 责任面（v0.6.24 起同项） |
| 2 | 本机未做签名/公证打包 | 正式产物由 CI 签名公证（同上） |
| 3 | `brand-assert.mjs` Windows + Git Bash tar | 既有、平台局部（v0.6.23 起同项） |
| 4 | graphrag bundle 的孤儿依赖线 / MCP 线 / 悬空 patch 条目 | alpha.2 分析 §8 已记录并观察，非本版回归 |
| 5 | S-D2 剩余（条带几何退役） | 受 D3 制约，待拍板 Q-D6（是否采用上游 `data-platform` 桌面语义） |
| 6 | 上游 alpha.2 **无 assets**（SSH helper 归档未随发布） | 我方不使用该路径（S2.1 已推翻），仅记录 |

## 结论

硬性门全过；报告项**全部清零**（两项死导出按修复删除、UNUSED DEPS 误报修正并加负对照）；
内置插件版本线与物化同线；本版完成引擎基线 alpha.2 的完整落地与两项内置插件退役，
并如实记录了 `dsh-shell-prefs` 激活失败这一**本版引入并已修复**的事故（含新常备闸与负对照）。**建议发布。**
