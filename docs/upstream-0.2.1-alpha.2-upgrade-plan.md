# dsh 0.2.1-alpha.2 升级实施计划（KCoder）

> 事实底座：[`docs/upstream-0.2.1-alpha.2-analysis.md`](upstream-0.2.1-alpha.2-analysis.md)。
> 举证要求与流程纪律：[`docs/ARCHITECTURE.md`](ARCHITECTURE.md) §12 **铁律 3（版本升级总纲）**。
> 本轮升级 = KCoder **第三轮**上游对齐（前两轮：0.2.0-rc.2、0.2.1-alpha.1）。
>
> **核对状态**：计划的待核项已按 [`docs/upstream-0.2.1-alpha.2-verification.md`](upstream-0.2.1-alpha.2-verification.md)
> （铁律 3 首次执行的核对报告）修正——S1.1/S1.5 关闭、Q3 升格为「已确证」、S2.1 范围收窄。
>
> 口径：**本计划先落盘，未获澄清卡答复前不动代码**（铁律 3 §1/§3）。
> 每步都必须有**判据**（可判真假）＋**回滚点**；判据里的「待核」项必须在执行时转成事实。

## 0. 已完成（S0，登记备查）

| 项 | 状态 | 证据 |
|---|---|---|
| 内置右侧边栏插件 `dsh-coding-sidebar` 退役（铁律 1 翻转） | ✅ | `plans/retire-coding-sidebar.md`；`pnpm check` 36/36；11 支 GUI 冒烟全绿 |
| 内置终端插件 `@kkutysllb/dsh-terminal` 退役 | ✅ | `plans/retire-terminal-plugin.md`；宿主对账实录 `deps=[] bundles=[@kkutysllb/dsh-terminal]` |
| fork 集成分支 `kcoder/0.2.1-alpha.2` 重放 | ✅ | 尖端 `41f151ab20`；6 处冲突处置见分析 §2；**未推送** |
| 克隆构建修复（81 包缺 `lib/index.js`） | ✅ | `pnpm run build` exit 0；331/331 包就位 |
| `UPSTREAM_OPTIONAL_BUNDLES` 镜像 4 → 11 | ✅ | `smoke-bundle-profile` 第 6 节由红转绿；用户已开的三个可选包未被误删 |
| 引擎实跑（alpha.2 + dev home） | ✅ | 就绪行打印、零 FAIL/ERROR |

## 1. 阶段计划

### S1 宿主契约对齐（KCoder 宿主，🔴 必做）

| # | 动作 | 判据 |
|---|---|---|
| S1.1 | ~~复核 `dsh web` spawn 参数~~ **✅ 已关闭（核对 V4）**：`--host/--port/--no-open/--public-url/--trusted-host/--tls-cert/--tls-key` 全在，`dsh-manager` 传参形态不变 | — |
| S1.2 | 就绪行解析补注释（同前缀警告行 `dsh web: listening on …`） | `READY_LINE_RE` 单测式断言：喂入警告行必须不匹配（`dsh-contract` 加一条断言或冒烟） |
| S1.3 | §7 清单与 README/ARCHITECTURE 更新：`detailsCol` → `rightbarCol`；`DocumentTitle` 新路径；新增 `conversation.session.header.lineage` | 文档一致性 grep：三处旧词零命中 |
| S1.4 | 字体体系复核：`ui-theme` 27 文件新增字号/字体面 × 我方写死字号的注入 CSS | 逐条列出「自持值 vs 上游 token」，能替换的替换；不能替换的写进文档（判据：自绘标题栏/页头在改字体设置后不破版——GUI 由用户实测） |
| S1.5 | ~~RPC 面复核~~ **✅ 已关闭（核对 V3）**：`session/list` 在构建产物 typert 描述符中确证；README §7 的 `host/apiproxy` 行改写成新包名（并入 S1.3） | — |
| S1.6 | Node engines 对齐（上游 `^22.19.0 \|\| >=24.0.0`） | `package.json` engines + `scripts/setup.sh` 断言同值；本机 `node -v` 满足 |
| S1.7 | 会话头「…」隐藏锚留档（核对 V5：`session-log-export/src/client/HeaderAction.tsx:55` 的 `css.moreButton` 仍在） | 无需动作；把该证据写进 `workspace-header` 注释，避免下次再当待核 |

**回滚点**：S1 全部为宿主侧小改，逐步提交、每步可单独 revert。

### S2 自研内置插件适配（🔴 主体）

| # | 插件 | 动作 | 判据 |
|---|---|---|---|
| S2.1 | ~~`dsh-ssh-remote` 适配 `launch`~~ **✅ 已核：无需适配**（2026-10-09 代码级核对，**推翻**早前 🔴 判断） | 证据三条：①插件自带 `cordis.patch.yml` 只 insert 自己的行（`ssh-remote`），**从不写 `dsh-ssh` 行配置**；②`worlds.json` 的 `node`/`helper`/`helperHash` 只有**一个写者**（插件 `provision.js`）与**存在性校验读者**（`remote-world.ts`），**无值消费者**；③世界切换走 `startRemoteServer({alias, remoteNode: remoteDshBin(spec)})` = **在远端跑引擎**（装 runtime+profile），不经 `ctx.ssh` 的 helper。⇒ 指南 `ssh-helper-launch` 的破坏面（`node`/`bootstrapPath`/`bootstrapHash` → `launch`、protocol 2）在 KCoder 链路上**无落点** | 判据：`rg -n 'bootstrapPath|nodeExecutable|helperHash' desktop/main bundle/dsh-ssh-remote` 仅剩上述写入/校验（已核）；远端世界连接与文件/终端可用（用户实测） |
| S2.2 | bundle 物化与版本线 | `bundle/dsh-ssh-remote` 同步新版（`sync-bundles.mjs` + `electron-builder.yml` 已就位）；`check-bundle-version-line` 通过 | `pnpm check` 绿；实体版本 == bundle 版本 |
| S2.3 | 技能 `dsh-skills-bundle` | 预期**零代码改动**：跑一遍技能注册/设置分区/`/技能` 调用 | `packages/skill/skill/src/index.ts` 与 `tool-skill` 注册/调用面逐条比对（diff 结论：核心面未变）；技能页 + 可选技能开关 + 会话内 `/技能名` 实测 |
| S2.4 | MCP | 预期**零改动**：`smoke:mcp-dom` + 真机启用一个 MCP 服务器 | MCP 工具在会话内可见可调 |
| S2.5 | `dsh-shell-prefs` | 预期**零改动** | 账号菜单切语言/主题（走 `getSnapshot`/`getTheme`）实测 |
| S2.8 | **SSH helper 归档的获取路径**（#12 的前置，2026-10-09 核对发现） | 事实：`@deepseek-ai/dsh-ssh-helper-runtime` 是**产出发布归档的私有包**（`dsh-ssh-helper-<ver>-<os>-<arch>.tar.gz` + `.sha256` + `manifest.json`，含可执行文件与嵌入 Node），**不发 npm、不是插件**；上游 workflow 只在 `publish=true` 时把归档挂到对应 `dsh-v<版本>` release——**alpha.2 的 release 附件为空**（已核 API），即当前下载不到 | 定策二选一：**随包**（把所需平台 4 份打进 runtime/extraResources；体量大但离线可用）或**按需下载**（插件从上游 release 取，需网络 + 校验 sha256）。判据：断网环境下仍能把 helper 部署到远端并跑通 L1 验证器 |
| S2.7 | **实验性组合包随版打包并默认选中**（2026-10-09 决策） | 产物侧：`materialize-peers.mjs` 的 `EXPERIMENTAL_BUNDLE_PACKAGES` 供给块（申报 + 整棵闭包补齐）；宿主侧：`optionalBundleResolvable()` 实态判据 + 声明进 bundles | 构建期：`verify-runtime-experimental.mjs` 绿（11/11 在位 + 行包可达）；`pnpm check` 绿（含 F29）；真机：插件页显示这些能力已启用、且旧的打包 runtime 不会被写崩 |
| S2.6 | 已退役两线 | 不动作；但在验收里覆盖「上游右栏终端 + 原生右栏」的稳定性 | 终端 tab 开/跑/关；右栏文件/预览可用 |

**回滚点**：S2.1 单独发版（旧版本仍在 npm）；PRESET 线回退即回滚。

> 注（核对 V14）：我方 `dsh-ssh-remote` 对旧键（`bootstrapPath`/`bootstrapHash`/`nodeExecutable`）
> **0 命中**，唯一相关键是 `helperHash`（`lib/provision.js:233`）⇒ 本步**不是重写引导链**，
> 而是版本线 + helper 产物契约 + 远端链路判据。

### S3 外部/第三方自研插件修复（🔴 归属待拍板 → 澄清卡 Q5）

| # | 插件 | 命中面 | 动作 |
|---|---|---|---|
| S3.1 | `dsh-kylin-automation` | `src/executor.ts:37` 读 `run_in_background` | 按 `subagent-activations` 改为「`{kind:'activation', subagentId}` + 完成通知」模型；判据：后台委派路径不再依赖被移除的字段 |
| S3.2 | `dsh-animations` / `dsh-super-ppts` / `dsh-kylin-memory` / `dsh-kylin-images` / `dsh-kylin-srw` / `dsh-kylin-ssh-tunnel` | 扫描无命中 | 逐个真机点开一次（GUI，用户实测）；命中再立卡 |
| S3.3 | Agent Team 消费方 | 指南 `team-direct-inbox` | 若插件读 `team/message/queued` 或 `maxPendingMessagesPerMember`，改直投 Inbox 语义 |
| S3.4 | `TerminalBlock` 渲染方 / Python PTC 组合方 | 指南 `terminal-command-labels` / `python-ptc-sandbox` | 有则补 `commandLine` 标签/沙箱服务；无则记录 |
| S3.7 | 用户 profile 补丁的悬挂项清理（dump-config 警告） | dev：`better-sidebar`（已退役插件的残留段，第 90-96 行）、`dsh-kylin-memory`（未选 bundle）；packed：`llm-deepseek` 名不符被静默跳过（alpha.2 同时有 `llm-deepseek` 与 `llm-deepseek-api-key`，补丁两条同 id 混用）、`graphrag-provider-local`/`dsh-kylin-memory` 悬挂 | 逐条删或改名对齐；判据：`dsh --profile web --dump-config` 输出**零 `patch:` 警告**，且自定义模型清单在设置页可见（用户实测） |
| S5.8 | **SSH helper 运行时（#12）的验证剧本**（上游自带两套验证器，引擎级可独立跑） | ①构建本机平台归档：`pnpm exec tsx scripts/build-exe-for-ssh-helper.ts`（本机 Node v24.18.0 + clang ✓，`--dry-run` 已验：target `node24-macos-arm64` → `dist-exe/ssh-helper/`）；②`pnpm exec tsx scripts/verify-ssh-helper-artifact.ts --archive=<tgz> --sandbox=required --backend=sandbox-exec --report=<json>`——校验 sha256/manifest/payload → 只读安装 → **两份并发 Loader 组合实测 files / processes / PTY / native flock / PTC**，macOS 另跑「拒绝 checkout 与宿主 Node」的受限 worker；③「远端无 Node」专项（**Linux + Docker**）：`scripts/verify-ssh-helper-ssh.ts --archive=<linux tgz>` 自建 glibc 2.28、无 Node 的 sshd 容器走生产连接 | ①`--dry-run` exit 0（已验）；②归档验证器 `--sandbox=required` exit 0 且 report 各项通过；③Linux 车道 exit 0。~~KCoder 内端到端须先完成 S2.1~~（S2.1 已核为无需适配）。**L1 实跑结果（2026-10-09，本机 macOS arm64）**：归档 `dsh-ssh-helper-0.2.1-alpha.2-macos-arm64.tar.gz`（39MB；manifest：protocol **2**、嵌入 Node **v24.21.0**、commit `41f151ab…`）→ 官方验证器 **exit 0**，report：`runtime.checks` = executable-handshake / guarded-files-and-streams / managed-process-output / process-cancellation / native-pty / native-flock / embedded-ptc-and-deadline / **sandbox-enforcement**；`sandboxLane=required`、`expectedBackend=sandbox-exec`、`restrictedWorker=true`（拒绝 checkout 与宿主 Node）、`readonlyInstall=true`、`concurrentColdStarts=2` |
| S5.7 | 工具类新能力的验证剧本（发布说明条目的「形态」分类） | #4 Git Worktrees 等是**模型工具**（`create_worktree`）而非 UI：#4 在源码态已挂载、打包态未选；#3 `working_directory`、#10/#11 等同理 | 在发布说明/验收表里给「怎么验」：Git 仓库会话 → 让 Agent 建 worktree → 看工具卡 + `<repo>/.agents/worktrees/<name>` + `git worktree list` + 会话工作区切换 |
| S3.6 | 源码态 playwright MCP 端点串到打包态 | dev profile 的 `mcp-playwright` 行写死 `--cdp-endpoint http://127.0.0.1:9223`，而源码态 browser-host 在 **9224**（`browserHostPort()` 按 `app.isPackaged` 分流）——实测今天 22:48 dev 起的 playwright 进程就连在 9223（打包态）上 | 把 dev profile 该行的端点改为 **9224**（或删掉该行的 `--cdp-endpoint` 两参，让内置同步按态生成——注意内置 `mcp-builtin-state.json` 的 synced 名单已含 playwright，不会自动重写，故直接编辑该行更稳）；判据：重启源码态后 `ps` 里 playwright 进程的 `--cdp-endpoint` 为 9224，且 9223 上只剩打包态一个连接 |
| S3.5 | `graphrag-provider-local` 孤儿行（真机日志核对项） | **既有配置问题**（2026-10-01 起，与 alpha.2 无关）：用户补丁只挂了 provider 行，未挂提供 `graphrag` 服务的 `graphrag-seam` 行，且 `dsh-kylin-vibe` 未进 `dsh.profile.bundles` | 二选一：**A（要 graphrag）** 在用户补丁的 `insert:` 里补 `{id: graphrag-seam, name: 'dsh-kylin-vibe'}` 且**排在 provider 行之前**（需要工具面时再加 `graphrag-rpc`/`graphrag-tools`）；**B（不用 graphrag）** 删掉该 orphan `insert:` 块。判据：重启后 `dsh: warning: N entry did not activate` 不再出现该行 |

**回滚点**：外部插件各自发版，KCoder 只改 PRESET/文档。

### S4 门与冒烟扩展（🟡）

| # | 动作 | 判据 |
|---|---|---|
| S4.1 | `smoke-bundle-profile` 增加「可选包镜像 = 上游名单」的反向断言（已有一条 deepEqual，保持） | 改上游名单不改本地 ⇒ 红（负对照：删一条本地镜像） |
| S4.2 | 新增/改造冒烟覆盖本轮新面：字体设置生效（标题栏字号）、终端 tab 存在、`session-search`/`worktree`/`cot-translation` 可选包启用后不崩 | 每支冒烟自带判别力自检（负对照必红） |
| S4.3 | `tool-presentation` `both` 残留扫描：`rg "mode: *both" product-policy.ts profiles/ bundle/` | 零命中或有则改 `native`/`ptc` |
| S4.4 | profile 补丁 `dshHome` 残留扫描（#37） | 零命中 |
| S4.5 | ~~会话格式版本核对~~ **✅ 已关闭（核对 V2）**：`currentVersion = 4` 未变 ⇒ 无迁移风险 | — |
| S4.6 | `hook-protocol` 未提及大改（+1913 行）的登记与「我方不消费 hooks 组合」结论留档 | 分析 §5.13 在位；`rg 'hook-protocol' src/bundle/` 我方零消费 |

### S5 产品决策面（🟡 → 澄清卡 Q2/Q3/Q4/Q7）

| # | 动作 |
|---|---|
| S5.1 | 11 个上游可选包在 KCoder 的默认策略（跟随官方默认 / 产品预选）落文档 + 设置页文案 |
| S5.2 | 「终端工具去哪了」：确认 `@deepseek-ai/dsh-experimental-terminal-bundle` 是否为 agent 终端工具的新家（分析 §5.2）——决定是否预选 |
| S5.3 | 模型发现空目录（#`deepseek-model-discovery`）：未配 key 时 DeepSeek 分组隐藏——发布说明需写清 |
| S5.4 | 右栏能力落差清单（退役两步的产物）与上游新增能力（lineage/终极端/字体）合并成 release notes 的「变化」段 |

### S6 基线与文档（🔴 发版同批）

| # | 动作 | 判据 |
|---|---|---|
| S6.1 | `upstream/BASELINE` 推进到 `0.2.1-alpha.2(d7432673)` + 追加升级记录段 | `release.sh build` 断言 HEAD 命中基线 |
| S6.2 | README §7 清单表、ARCHITECTURE §4/§7/§12 同步 | 文档一致性 grep |
| S6.3 | 发版说明（`release/v<版本>.md`）：破坏性变更 + 已退役能力 + 新能力 | 发布审计 `release.sh audit` 通过 |

### S7 发版门（🔴）

| # | 动作 | 判据 |
|---|---|---|
| S7.1 | 确认 fork 集成分支**已推送** | `git ls-remote origin kcoder/0.2.1-alpha.2` 有值 |
| S7.2 | `bash scripts/release.sh audit` → `ship <版本>` | 审计硬门全绿；三平台 CI 绿 |

## 2. 澄清卡（待拍板；未拍板不动代码）

> 每张卡：**问题 / 事实 / 选项 / 建议 / 影响面 / 谁拍板**。

### Q1 目标版本与冻结时点
- **事实**：本机 alpha.2 分支已重放 + 构建 + 实跑通过；上游 prerelease 节奏约 1–2 天/版（10-03 alpha.1 → 10-09 alpha.2）。
- **选项**：A 现在按 alpha.2 推进（推荐）；B 等下一版（alpha.3/rc）一起做；C 只做兼容性预研、暂不发版。
- **建议**：A —— 退役两步已把最大的产品面变化吃下，越晚做冲突面越大。
- **影响面**：整轮节奏、发布排期。**拍板**：产品负责人。

### Q2 上游 11 个可选包在 KCoder 的默认策略
- **事实**：`OPTIONAL_BUNDLES` 4 → 11；官方默认**不预选**；KCoder 的 profile 骨架只写 base/web。
- **选项**：A 完全跟随官方默认（不预选，设置页可开）；B 产品预选若干（如 terminal-bundle / session-search）；C 预选全部。
- **建议**：A + 对「预选才有等价能力」的包做例外（见 Q3）。
- **影响面**：开箱能力面、发布说明。**拍板**：产品负责人。
- ✅ **已拍板（2026-10-09，产品负责人）：全部随版打包并默认选中** —— 不只
  terminal-bundle：11 条实验性组合包全表随包 + 默认写进 `dsh.profile.bundles`
  （机制与判据见 ARCHITECTURE §12「配套产品决策」）。**已落地**：产物侧供给块 +
  `verify-runtime-experimental.mjs` 构建门；宿主侧 `optionalBundleResolvable()`
  实态判据 + `smoke:bundle-profile` 的 F29 双向量断言（39/39）。

### Q3 终端工具的新家（⚠ **已确证**，核对 V1 —— 必答）
- **事实（代码级确证）**：`packages/terminal/tool-terminal` **整包删除**；`tool-terminal` 现居
  `packages/experimental/tool-terminal`（`src/index.ts:28`），**唯一挂载点**是可选包
  `experimental/terminal-bundle` 的 `optional-tool-terminal` 行；默认 `web-app` 组合里没有它
  （只有 `terminal-controller` API 行与 `ui-sidebar-terminal` UI 行）。
- **结论**：**KCoder 不预选该可选包 ⇒ agent 没有终端工具**（而我方终端插件刚退役）。
- **选项**：A 预选 `@deepseek-ai/dsh-experimental-terminal-bundle`（保留 agent 终端能力）；B 不预选，接受能力缺失并在发布说明列明。
- **建议**：**A** —— 终端是 agent 的基础能力，且该包同时提供注册表与 shell 方言行（`isolate:{terminals:true}` 分组），无替代来源。
- **影响面**：agent 的终端能力（产品级）。**拍板**：产品负责人。
- ✅ **已拍板（2026-10-09，产品负责人）：选 A** —— KCoder 预选
  `@deepseek-ai/dsh-experimental-terminal-bundle`，保留 agent 终端能力；落地位置见
  S5.2（profile 预选清单）+ S6.3（发布说明「新增预选能力」段）。

### Q4 字体设置与我方注入 CSS 的关系
- **事实**：`ui-theme` 新增界面/代码/侧栏终端三套字体字号；我方自绘标题栏与压制段里写死了字号。
- **选项**：A 全面改吃上游 token（统一视觉）；B 仅标题栏跟随界面字号；C 维持自持（视觉稳定，但用户改字体时条上文字不动）。
- **建议**：B（最小改动、消除最明显的不一致）。
- **影响面**：自绘条/页头视觉。**拍板**：产品负责人（我给差异清单）。

### Q5 外部自研插件修复的归属与节奏
- **事实**：`dsh-kylin-automation` 命中被移除的 `run_in_background`；其余外部插件扫描无命中但只跑过启动。
- **选项**：A 我改（跨仓，需你给仓权限/节奏）；B 你改，我出改造清单与判据；C 暂缓，先列入已知问题。
- **建议**：B（我出清单）+ 对 `kylin-automation` 优先（它是我方工作流插件，坏了影响日常）。
- **影响面**：外部插件可用性。**拍板**：产品负责人。

### Q6 已退役两步的提交与推送时序
- **事实**：工作区压着两步退役（528 项改动）未提交；fork 分支 `41f151ab20` 未推送。
- **选项**：A 先提交两步退役（拆 2 commit）+ 推 fork，再进 S1（推荐）；B 全部做完再一次性提交；C 你手动提交。
- **建议**：A —— 给升级一个干净回滚点，且发版链要求集成分支先推送。
- **影响面**：仓库历史与回滚点。**拍板**：产品负责人。
- ✅ **已拍板（2026-10-09）：拆 commit 并已落地**——`576e3e4`（侧栏退役，505 文件）、
  `f3e8d61`（终端退役，39 文件）、`f90c740`（升级文档 + 铁律 3 + 可选包名单镜像，6 文件）。
  **fork 集成分支 `kcoder/0.2.1-alpha.2`（`41f151ab20`）尚未推送**（产品负责人：先真机验证、
  不着急推送；推送时按 S7.1 硬门在打 tag 之前完成）。

### Q7 Agent Team 队列语义变更的运维提示
- **事实**：指南 `team-direct-inbox`：升级前**未投递**的排队消息升级后**永不投递**；`maxPendingMessagesPerMember` 移除。
- **选项**：A KCoder 在升级后首次启动弹一次提示（「升级前请确认团队消息已送达」——但升级已完成，只能提示补发）；B 只在发布说明写；C 不做提示。
- **建议**：B + 在 profile 自愈里清理该配置键（若存在）。
- **影响面**：使用 Agent Team 的用户。**拍板**：产品负责人。

### Q8 pi-ai relay 修复的自持策略
- **事实**：上游 1.0.2 自带 patch（3 处流式解析）；我方的 relay 修复（`extractAccountId` 回退）**未被上游采纳**，已重新并入我方 patch（哈希 `d3b9a833…`）。
- **选项**：A 继续自持（推荐）；B 推上游后跟随；C 放弃（relay 用户会炸）。
- **建议**：A + 顺手把该 hunk 提给上游（issue/PR）。
- **影响面**：走 relay/代理的 Codex 路由用户。**拍板**：产品负责人（是否投入推上游）。

### Q9 SSH helper 运行时（#12）是否采用「远端零依赖」模型
- **背景（2026-10-09 核对 + L1 实跑）**：上游新 helper 是**独立可执行归档**（39MB，嵌入 Node v24.21.0、protocol 2、manifest.json 全量摘要），远端**无需装 Node/npm** 即可跑文件/进程/终端/沙箱/Node PTC——本机已用官方验证器跑通（8 项检查全绿、sandboxLane=required、含拒绝宿主 Node 的受限 worker）。而 KCoder 现状是：**在远端装用户态 Node + 277MB runtime 并跑一个引擎**（startRemoteServer），链路上**不使用** helper（已核，见 S2.1）。
- **问题**：是否把远端世界改为「本地引擎 + dsh-ssh helper」模型？
- **选项**：
  - **A 保持现状**（远端跑引擎）：功能面最广（远端有自己的 DSH_HOME/插件/会话），代价是每台远端要装 Node + 277MB runtime 且版本须与本机同线；
  - **B 改用 helper 模型**：远端零安装、归档 39MB、能力面 = 文件/进程/终端/沙箱/PTC；代价是**远端不再有自己的引擎**（多主机并发、远端专属插件/会话、离线远端等要重新设计），且需先定归档获取路径（见 S2.8）；
  - **C 双模**：默认 A，需要时按主机选 B。
- **建议**：**先 A**（不在本轮升级里改架构），把 B 作为独立立项评估——这是产品级架构选择，不是升级适配项。
- **影响面**：远端世界架构、安装体积、多主机能力。**拍板**：产品负责人。

## 3. 风险与回滚

| 风险 | 触发条件 | 处置 |
|---|---|---|
| 宿主注入锚点静默失效（外壳复现/条上文字不动） | 上游改类名/属性形态 | 常备门：`smoke:titlebar` / `smoke:style-overlay*` / `smoke:workspace-header`；判据失配即红 |
| ssh-remote 新版本未就绪 | S2.1 未完成 | PRESET 线保持旧版（与引擎不兼容时功能降级而非启动失败） |
| 外部插件在 alpha.2 上启动炸 | 未逐个实测 | 启动日志零 FAIL 为门；命中即立卡 |
| 用户历史会话不可读 | 会话格式版本提升 | S4.5 先核；若提升，发布说明给备份/迁移指引 |
| 发布物与本地验证脱节 | tag 早于 fork push | S7.1 硬门（`release/README.md` 约定 3） |

## 4. 验收总表（完成判据）

1. `pnpm check` 全绿（含自愈冒烟 36/36 + 新增断言）；
2. 全部 GUI 冒烟绿（含新增/改造过的）；
3. 引擎实跑：dev + 打包 home 各一次，零 FAIL/ERROR；
4. §7 锚点表逐项复核完毕、无「待核」残留；
5. 自研内置插件四条线各自判据通过（技能/MCP/shell-prefs/ssh-remote 新版）；
6. 外部插件清单逐个有结论（🟢 实测过 / 🔴 已修 / ⚪ 已退役）；
7. `upstream/BASELINE` + README/ARCHITECTURE 更新、发布说明成稿；
8. fork 集成分支已推送、`release.sh audit` 全绿。
