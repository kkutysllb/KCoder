# dsh 0.2.1-alpha.2 升级核对报告（铁律 3 首次执行）

> **目的**：把 [`docs/upstream-0.2.1-alpha.2-analysis.md`](upstream-0.2.1-alpha.2-analysis.md) 里的
> 「**待核**」逐条转成**事实**，并对「代码变了但发布说明/指南没写」做**反向抽检**。
> **方法**：只用可直接复现的代码级判据（源码 grep / 构建产物 / CLI `--help` / tag 对照）；
> 无法在无 GUI 下判定的，明确留守并写清判据归属（GUI 由用户实测，§8 协作惯例）。
> 采集：2026-10-09，工作树 = `kcoder/0.2.1-alpha.2`（`41f151ab20`）。

## 0. 结论摘要（先看这五条）

1. ⚠️ **终端工具「可选化」已确证（本轮最高优先级）**：agent 面向的 `tool-terminal` 从
   `packages/terminal/tool-terminal`（**整包删除**）迁到 `packages/experimental/tool-terminal`
   （`src/index.ts:28 export const name = 'tool-terminal'`），而它在默认组合里**没有任何挂载点**——
   唯一插入点在可选包 `experimental/terminal-bundle` 的 `optional-tool-terminal` 行
   （`cordis.patch.yml`，与 `@deepseek-ai/dsh-terminal` + bash/pwsh 行同组 `isolate: {terminals:true}`）。
   默认 `web-app` 组合只保留 `terminal-controller`（API）与 `ui-sidebar-terminal`（UI）两行。
   ⇒ **不预选该可选包，agent 就没有终端工具**。澄清卡 Q3 由「假设」升级为「已确证」。
2. ✅ **会话格式版本未变**：`packages/session/session-format-catalog/src/generated.ts` 的
   `currentVersion: 4`（v3→v4 迁移函数在，且该包**本轮只改了 package.json**）⇒ **无历史会话迁移风险**。
3. ✅ **RPC `session/list` 仍在**：`packages/api/session-controller/lib/typert.remote-client.d.ts:49`
   与 `lib/typert.host.js:1353`（`@deepseek-ai/dsh-api-session-controller#session/list`）⇒ 我方
   `workspace-probe` 的一次性 RPC 不受影响。
4. ✅ **`dsh web` 监听/信任 flag 全在**：`--host / --port / --no-open / --public-url / --trusted-host /
   --tls-cert / --tls-key`（`node apps/cli/lib/bin.js web --help` 实测）⇒ 指南
   `web-listener-trust-config` 不影响我方 spawn 形态（`S1.1` 可关闭）。
5. ✅ **会话头「…」隐藏锚仍有效**：`packages/session-query/session-log-export/src/client/HeaderAction.tsx:55`
   `className={css.moreButton}` + `HeaderAction.module.css:2 .moreButton`；该包本轮**仅 package.json 变更**
   ⇒ 我方 `[class*="_moreButton"]` 规则继续命中（`S1` 无需为它改动）。

## 1. 逐项核对表

| # | 断言（来自分析/计划） | 核对方法 | 结果 |
|---|---|---|---|
| V1 | `tool-terminal` 并入可选 `terminal-bundle`（Q3） | 三处：包位置 `experimental/tool-terminal`；`terminal-bundle/cordis.patch.yml` 的 `optional-tool-terminal`；`bundle/web-app/cordis.patch.yml` 无 `tool-terminal` 行 | ⚠️ **确认（且是能力缺口）** |
| V2 | 会话格式版本可能提升 | `generated.ts` 的 `currentVersion: 4` + 本轮该包 diff 仅 package.json | ✅ **未变** |
| V3 | RPC 路由可能改名（`session/list`、`workspace.list`） | 构建产物 typert 描述符 grep | ✅ **`session/list` 在**；`workspace.list` 早于 alpha.1 已移除（我方已改用它者） |
| V4 | 指南 `web-listener-trust-config` 影响我方 spawn 参数 | `dsh web --help` 实测 | ✅ **flag 齐全**（S1.1 关闭） |
| V5 | `_moreButton` 锚可能在 alpha.2 失效 | `session-log-export` 源码类名 + 本轮该包 diff | ✅ **锚在**（无需改动） |
| V6 | 会话头新增 `lineage` 槽、注册方未知 | 全仓 grep | ✅ 注册方 = `client/ui-subagent`（`SubagentHeaderLineage`）；我方搬整块页头 ⇒ 自动跟随，仅需列入槽位清点 |
| V7 | 就绪行同前缀警告行会否被误吞 | 我方 `READY_LINE_RE` 要求 `http://127.0.0.1:<port>` 前缀 + 上游 `index.ts:243` 警告文本 | ✅ **不会误吞**（警告行是 `dsh web: listening on …`） |
| V8 | 布局第三列 `detailsCol` 是否还在 | `AppFrame.module.css` 类名清单 | ⚠️ **已改名 `rightbarCol`**（文档/清单需改；我方结构锚 `[data-rightbar-col]` 仍有效） |
| V9 | `DocumentTitle` 位置 | 全仓 grep | ⚠️ **迁到 `client/ui-layout/src/client/DocumentTitle.tsx`**（README §7 路径过期） |
| V10 | `packages/host/apiproxy` 仍是 RPC 落点 | 目录列举 | ❌ **该包已不存在**（现为 `host/webserver`、`api/*`）⇒ README §7 该行必须重写 |
| V11 | 技能核心服务面是否破坏 | `packages/skill/skill/src/index.ts` 的 tag diff | ✅ **diff 为空**（破坏面在 `skill-badge` 迁包、`skill-filesystem`/`skill-office`/`tool-skill` 的局部改动） |
| V12 | 我方 MCP 面是否受影响 | `packages/mcp` 的 tag diff（3 文件，仅 `mcp-client` 依赖与 `mcp-resources` 测试） | ✅ **不涉及协议实现**（我方只消费配置面） |
| V13 | shell-prefs 依赖的 locale/theme 服务面 | `locale.getSnapshot()` / `theme.getTheme()` / `themes` 源码 | ✅ **均在**（字体设置不改这两个服务面） |
| V14 | `dsh-ssh-remote` 对旧键（`bootstrapPath`/`bootstrapHash`/`nodeExecutable`）的依赖量 | 我方 bundle `lib/*.js` 全量 grep | ✅ **0 命中**（唯一相关键是 `helperHash`，1 处）⇒ S2.1 范围收窄：**版本线 + helper 产物契约 + 远端链路判据**，不是大改 |
| V15 | 外部插件 `dsh-kylin-automation` 命中 `run_in_background` 的语义 | 读 `src/executor.ts:37` | ⚠️ **确认命中**：`args['run_in_background'] === true` —— 该参数已按指南移除 ⇒ 分支永不成立（静默失效，不崩） |
| V16 | 兼容闸门口径是否变化 | `plugin-compatibility.ts` / `compatibility-preflight.ts` 的 tag diff | ✅ **diff 为空**（判定口径未变；peer `<1.0.0` 类声明继续放行） |
| V17 | 新增可选包 7 条是否只是「新能力」 | `OPTIONAL_BUNDLES` 现表 + 包目录 | ⚠️ **不全是**：`terminal-bundle` 携带**原有**的 agent 终端工具（见 V1） |
| V18 | pi-ai 补丁是否只剩我方 relay hunk | 我方 patch（94 行 / 7 文件）vs 上游 patch（73 行 / 6 文件） | ✅ 上游 6 文件 hunk 全保留 + 我方 `openai-codex-responses`（accountId 回退） |

## 2. 反向抽检：**改动很大但没有发布说明条目**的面

方法：把「本轮改动最集中的目录」与「47 条发布说明 + 20 篇指南」逐面比对，找**无主的大改**。

| 区域 | 规模 | 对应条目 | 判定 |
|---|---|---|---|
| `experimental/hook-protocol` | 19 文件 **+1913** | 仅指南 `experimental-package-composition` 间接提到「CLI/Python 安装面不再带 hook 桥」 | ⚠️ **未提及的大改** ⇒ 分析 §5 增补 |
| `subagent/*` | 54 文件 | #38 + 指南 `subagent-activations`（有） | ✅ 有条目 |
| `client/ui-chat` | 68 文件 | #9 / #22 / #30 分散覆盖 | ✅ 基本覆盖 |
| `api/session-controller` | 23 文件 +1209/−155 | #3（working_directory）+ #11（Session 状态记录） | ✅ 覆盖 |
| `fs/tool-fs` | 19 文件 +273/−125 | #3 / #35（沙箱） | 🟡 仅间接 |
| `workflow/workflow-ptc` | 15 文件 | #20 / #35 | 🟡 仅间接 |
| `client/ui-primitives` | 21 文件 | #31（超长行）+ #43（Markdown Content Factory） | ✅ 覆盖 |
| `boot/plugin-manager` | 13 文件 **+583** | #5 / #42 / #45 + 指南 `experimental-package-composition` | ✅ 覆盖（安装语义显式化） |
| `.agents/notes/implemented` | 177 文件 | — | 🟢 上游内部笔记，非运行面 |

## 3. 对分析文档的修正（已同步落盘）

1. §5 增补第 13 条：`experimental/hook-protocol` +1913 行的未提及大改（我方不消费 hooks 组合，仅登记）。
2. §5.2 由「疑似」改为「**确证**」：终端工具在可选包内，默认组合无挂载点（附三处判据）。
3. §6 表：会话格式、RPC、CLI 信任 flag、`_moreButton`、`lineage` 五行的「待核」→「✅已核」；
   新增两行修正：`packages/host/apiproxy` **已不存在**、`DocumentTitle` 新路径。
4. §1 事实表补一行：会话格式 `currentVersion = 4`（未变）。

## 4. 对实施计划的修正（已同步落盘）

| 项 | 修正 |
|---|---|
| **Q3** | 由「先实测再定」升级为「**已确证**」：选项 A（预选 `@deepseek-ai/dsh-experimental-terminal-bundle`）＝保留 agent 终端能力；选项 B＝接受能力缺失，必须在发布说明列明 |
| S1.1 | **关闭**（flag 齐全，实测证据） |
| S1.5 | **关闭**（`session/list` 在构建产物中确证） |
| S2.1 | 范围收窄：我方插件对旧键 **0 命中**；改动 = 版本线与 peer 线、helper 产物/`helperHash` 契约、远端链路判据（不是重写引导链） |
| S1.3 | 增补：README §7 里 `host/apiproxy` 行重写、`detailsCol` → `rightbarCol`、`DocumentTitle` 路径 |
| 新增 S4.6 | `hook-protocol` 未提及大改的登记与「我方不消费」结论留档 |
| 新增 S1.7 | 会话头「…」锚已核（无需动作，但留档证据：`HeaderAction.tsx:55`） |

## 5. 仍未闭合（诚实列出，附判据归属）

| 项 | 为什么还没闭合 | 判据/归属 |
|---|---|---|
| 字体设置对我方注入 CSS 的实际影响 | 需真实渲染观感 | GUI 实测（用户）；我给「自持值 × 上游 token」对照清单（S1.4） |
| `_moreButton` 隐藏后的视觉结果 | 同上 | 同上 |
| 终端 tab 在 alpha.2 的可用性 | 同上 | 用户实测（S2.6） |
| `dsh-animations` / `dsh-super-ppts` 的**运行期**表现 | 只验证过启动 | 用户逐项点开（S3.2） |
| `ui-open-in-app` / `ui-schedule` 新进 utilities 座位对自绘带的影响 | 需真实层叠观测 | GUI 实测 + `smoke:titlebar` 夹具扩展（S4.2） |
| 三条新持久化记录类型是否要引擎侧配置 | 本轮未追到消费方 | 升级后旧会话可读 + 新记录可见（S4.5 判据） |
