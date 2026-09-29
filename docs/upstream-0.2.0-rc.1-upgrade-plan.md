# KCoder 上游基线升级实施计划：`0.1.7-rc.2` → `0.2.0-rc.1`

> **计划状态：未执行。本文档只做计划，不含任何已落地的代码改动。**
> 版本：**v2**（2026-09-28 定稿：6 条决策已采纳并落地为决议记录；新增派生决策 D2.1、D5 口径实测修正、边界清单、风险→门禁映射、产物清单、发布说明大纲、排期）
> 依据：[upstream-0.2.0-rc.1-analysis.md](upstream-0.2.0-rc.1-analysis.md)（差异分析）+ 本仓发布仪式实测 + npm registry 实查

| 项 | 当前值（起点） | 目标值 |
|---|---|---|
| 上游基线 | `477b4f4205` = `dsh-v0.1.7-rc.2`（2026-09-24） | `4878cdabd8` = `dsh-v0.2.0-rc.1`（2026-09-28） |
| fork 集成分支 | `kcoder/0.1.7-rc.2` @ `3376ee9896` | `kcoder/0.2.0-rc.1`（新建，保留旧分支作回滚锚） |
| fork `master` | 已 ff 到 `4878cdabd8` | 保持纯净镜像（零自有提交） |
| **KCoder 版本** | `0.6.18` | **`0.6.19`**（D1 已定） |
| 差分量级 | — | 261 提交 / 47 干线提交 / 1109 文件 |

> **范围声明**：本计划的上游链**只有一条** —— `upstream` = `deepseek-ai/deepseek-harness`（官方）、`origin` = `kkutysllb/deepseek-harness`（我们的 fork）；交付物只有 KCoder。
> 麒麟引擎的迁移属**后续远期的独立规划**，不在本轮范围内，本文档也不为它预留分支、接口或流程。

---

## 0. 执行摘要

### 0.1 关键路径

```
S0 冻结与决策 ──┬──► S1 fork 集成分支重建 ──► S4 物化验收 ──► S5 回归 ──► S6 发布
                │            （关键路径）
                └──► S2-a 插件仓改造与发布 ──► S2-b KCoder 侧同步（随 S1 落）
                              （外部依赖，最早启动）
                              S3 宿主侧改造（依赖 S1 契约结论）
```

**关键路径 = S1 → S4 → S5**。唯一有技术不确定性的是 S1 的 4 个真冲突与 pi-ai 线；**S2-a 是外部依赖，最先启动**（因 D5 采用双兼容口径，它可安全地先于 S1 完成）。

### 0.2 三个硬阻断（P0）

| # | 阻断 | 性质 | 不解的后果 |
|---|---|---|---|
| **P0-1** | **两个自研插件被上游兼容闸门拒载** | 外部（发 npm） | `dsh-coding-sidebar@1.0.34`（11 条 peer 全不命中）与 `dsh-file-review-kcoder@1.0.10`（`dsh-session`、`dsh-api-session-controller` 两条裸 `^0.1.7-alpha.1`）在 0.2.0-rc.1 下被 `row.disabled = true` —— **不崩、stderr 一行警告、功能区整片消失** |
| **P0-2** | **调度三行策略覆写打空** | 内部（改常量） | 三行已从默认组合删除，覆写遇到不存在的 id 时 **warn 后跳过** ⇒「定时任务/时间上下文开箱即用」静默消失 |
| **P0-3** | **pi-ai 线必须保持 0.87.1** | 内部（merge 纪律） | 上游 0.2.0-rc.1 **仍钉 `^0.85.1`**；被覆盖则三条 relay 兼容补丁与 opencode session 头全部失效 |

### 0.3 一条本轮新发现的产品完整性问题（P1）

**新一轮的「Session Log 上传」设置页开关，在我方策略下是死控件。** 证据链：

1. 我方策略层是 **CLI overlay**：`productPolicyArgs()` 返回 `['--patch', <file>]`（`desktop/main/product-policy.ts:159-162`）
2. 上游层级序（`packages/boot/app-boot/src/config-schema/document.ts:159` 的 `$comment` 原文）："Bundle, profile, home, and CLI layers apply in that order. **A patch config replaces the whole config.**"
3. `config` 是**整份替换**而非合并：`vendor/include/src/index.ts:120-123` 的 `target[key] = value`
4. 用户从设置页写 `enabled: true` 落到 **profile 层**；CLI overlay 在**之后**把整个 `config` 替换回 `{enabled: false}` ⇒ 有效值恒为关
5. `Volatile` 的提交条件是"**所有普通字段的有效值仍一致**"（`docs/cordis-tutorial/05-config.zh.md:93`）；候选被 overlay 掩蔽后与原值相等 ⇒ 不提交、不通知

⇒ 用户点开关"写入成功"，但**永不生效**；UI 还可能显示"已开"而运行时是"关"。**派生决策 D2.1**：把 `ui-settings-session-log` 行 `disabled: true`（隐藏该开关）。

### 0.4 已验证的好消息（不需要动）

- 技能 seam 零变更（`packages/skill/*` 除 version 外逐 blob 相同）
- MCP 子系统零代码变更（`packages/mcp/*` 仅两个 version 行）
- 会话格式未变（`docs/session-format-status.md` 无 diff）
- `ui-slots/src`、`ui-deliverables/src` 两 tag 的 tree SHA 完全相同 ⇒ slot 契约冻结
- 终端面零 diff；`dsh-terminal` / `dsh-shell-prefs` **不触发** peer 闸门
- 我方 73 个偏离文件中与上游重叠仅 18 个，**行级真冲突只有 4 个**
- **所有新包已发 npm**（实查 `registry.npmjs.org`）：`dsh-experimental-schedule-bundle@0.2.0-rc.1`（其三个依赖精确钉 `0.2.0-rc.1`，无跨线混装风险）、`dsh-otel`、`dsh-client-ui-settings-session-log`、`dsh-client-product-analytics`、4 个 `dsh-*-ssh`、`dsh` CLI 全部有 `0.2.0-rc.1`

---

## 1. 目标与验收定义（DoD）

1. fork 上存在 `kcoder/0.2.0-rc.1`，历史包含 `4878cdabd8`，已推远端；旧分支 `kcoder/0.1.7-rc.2` 保留
2. `upstream/BASELINE` 首行 = `4878cdabd8…`，并追加本轮升级记录段
3. §14 附录 A 的 6 处版本字面量全部对齐，`grep -rn '0\.1\.7-rc\.2' desktop/ scripts/ upstream/BASELINE` **零命中**
4. 两个自研插件新版本已发 npm，peer 口径 = `>=0.1.7-rc.2 <1.0.0`（D5 过渡值）；在 0.2.0-rc.1 上**不被 deny**
5. `dsh web --dump-config` 输出符合产品意图，且**无** `patch: entry … not found`、**无** `disabling profile plugin`
6. `bash scripts/release.sh prepush` 全绿
7. `bash scripts/release.sh build` 全绿
8. `bash scripts/release.sh verify` 全绿
9. §16 验收清单全部勾选（含人工视觉回归）
10. `release/v0.6.19.md` 与 `release/audit-v0.6.19.md` 入库
11. 本轮新增文档回填完成（§附录 D）

---

## 2. 决策记录（**2026-09-28 定稿**）

### 2.1 主决策（D1–D6，已采纳）

| # | 决策 | **决议** | 落地动作 | 验收 |
|---|---|---|---|---|
| **D1** | KCoder 版本号 | **`0.6.19`** | `package.json` bump；新增 `release/v0.6.19.md`、`release/audit-v0.6.19.md` | `release.sh ship 0.6.19` 通过；`release/README.md` 命名约定满足 |
| **D2** | 会话日志上传策略 | **维持强制关闭**（产品决策 D2 不变） | 保留 `session-log-deepseek` 的 `config: {enabled: false}` 覆写 | `--dump-config` 中该行 `enabled: false` 在位 |
| **D3** | 桌面遥测 | **加显式 `disabled: true` 覆写两行** | `product-policy.ts` 新增 `desktop-product-telemetry`、`product-analytics` 两行 | `--dump-config` 两行 `disabled: true`；不再依赖 profile 名巧合 |
| **D4** | 调度的启用方式 | **走官方 bundle 路径** | profile 的 `dsh.profile.bundles` + `dependencies` 增 `@deepseek-ai/dsh-experimental-schedule-bundle@0.2.0-rc.1`（npm 已确认存在，其依赖精确钉 0.2.0-rc.1） | 三行由该 bundle 插入且未 disabled；任务页可用 |
| **D5** | 插件 peer 口径 | **过渡期 `>=0.1.7-rc.2 <1.0.0`**（见 2.3 实测依据） | 两个插件的全部 dsh peer 改为该范围 | 闸门对 0.1.7-rc.2 与 0.2.0-rc.1 **均通过** |
| **D6** | pi-ai 线 | **保持 0.87.1 领先** | merge 纪律：删上游 `patches/@earendil-works__pi-ai@0.85.1.patch`，保留 0.87.1 补丁与 `patchedDependencies` 换键 | `patches/` 只剩一份 pi-ai patch；`llm-pi-ai` 全包绿 |

### 2.2 派生决策（D2.1，采纳 D2 后新出现）

| # | 决策 | **决议** | 依据 | 验收 |
|---|---|---|---|---|
| **D2.1** | 新的 `ui-settings-session-log` 设置页行 | **`disabled: true`（隐藏该开关）** | §0.3 的五步证据链：CLI overlay 整份替换 config ⇒ 开关写入永不生效 | 设置 → 通用下**无**「上传 Session Log」开关；用户不会遇到点了没用的控件 |

> **替代方案（不推荐，记录备查）**：把策略从 CLI overlay **下移到 profile 层**。这样用户写入会覆盖策略 ⇒ 等于放开自选，与 D2 冲突。**不采用。**

### 2.3 决策依据补录：D5 的口径为什么不是 `^0.2.0`

实测（semver 7.8.5，与上游 `app-boot` 同版依赖；闸门调用为 `semver.satisfies(runtime, range, { includePrerelease: true })`，`plugin-compatibility.ts:78`）：

| 口径 | 0.1.7-rc.2（旧） | **0.2.0-rc.1（目标）** | 0.2.0 稳定 | 0.3.0-rc.1（下次引擎升级） | 评价 |
|---|---|---|---|---|---|
| `^0.2.0` | ✗ | **✗** | ✓ | ✗ | ❌ **错解**：desugar `>=0.2.0 <0.3.0-0`，而 `0.2.0-rc.1 < 0.2.0`，**连目标 rc 都不接受**；且下次 minor 升级再踩 |
| `^0.2.0-rc.1` | ✗ | ✓ | ✓ | ✗ | 能用，但不耐久 |
| `>=0.2.0-0 <1.0.0` | ✗ | ✓ | ✓ | **✓** | ✅ **耐久解**（下界带 `-0` 才收 rc） |
| **`>=0.1.7-rc.2 <1.0.0`** | **✓** | ✓ | ✓ | **✓** | ✅ **本轮采用（过渡双兼容）** |
| `^0.1.7-rc.2 \|\| ^0.2.0` | ✓ | ✗ | ✓ | ✗ | ❌ 本轮踩坑的模式本身，勿再复制 |

**为什么采用双兼容而不是只认 0.2**：老版本（v0.6.14–v0.6.18）的 `PRESET_PLUGINS` 是 caret 的 `^1.0.34`。一旦我们发布 `1.0.35`，**老版本的新装用户会被 pnpm 解析到 1.0.35**；若其 peer 不含 0.1.x，这些用户一装 app 侧边栏就消失（物化闸是 `gt(源版本, 实装版本)`，bundle 里的 1.0.34 不会覆盖已装的 1.0.35）。双兼容口径同时保护新旧两端。

**收窄时机**：v0.6.19 发布、老版本退场后，**下一轮插件发版**收窄为 `>=0.2.0-0 <1.0.0`。此待办登记在 §15 产物清单。

---

## 3. 本轮硬性边界（禁止动作清单）

> 升级期间**明确不做**的事，防止顺手改动扩大风险面。

| # | 禁止 | 理由 |
|---|---|---|
| B-1 | **不升 `dsh-context`** | 它带两条常驻补丁（`profiles/web/patches/dsh-context@0.55.0.patch`），一升版必须重出 patch 到新版本键，否则 `patchgate` 拦或降级放行导致断供。本轮冻结版本，把变量降到最少 |
| B-2 | **不手工 merge `pnpm-lock.yaml`** | 必须删除后重新 `pnpm install` 生成 |
| B-3 | **不在集成分支上打裸提交** | FORK-WORKFLOW 规则 4：所有修改先落 `fix/*`，再 `merge --no-ff` |
| B-4 | **不 `--no-verify`** | 曾被 lefthook 拦下的提交并未创建，`--amend` 会错改 HEAD |
| B-5 | **不删旧集成分支 `kcoder/0.1.7-rc.2`** | 回滚锚（§11） |
| B-6 | **不向 fork `master` 提交任何东西** | master 是上游纯净镜像，只允许 ff |
| B-7 | **不在 S1 未通过时把 KCoder 声明改到插件新版本** | 见 §11 的陷阱说明 |
| B-8 | **不触碰 `native-overlay/` 与 `.patches/`** | 已是零引用死目录（`native-overlay/dsh-client-ui-deliverables/lib/` 为空）；清理列为可选项（§14 A.4），不属本轮必需 |
| B-9 | **不改上游包源码**（除已归档的 `fix/*` 分支语义） | 本轮是基线升级，不是上游改造 |
| B-10 | **不在回归未过时发布** | §11 R4 成本最高 |

---

## 4. WBS 与依赖

| 阶段 | 内容 | 前置 | 估时（人日） | 可并行 |
|---|---|---|---|---|
| **S0** | 冻结与准备 | — | 0.5 | — |
| **S1** | fork 集成分支重建 | S0、D6 | 1.5–2.0 | 与 S2-a 并行 |
| **S2-a** | 插件仓改造与发布（外部） | S0、D5 | 0.5–1.0 | **最先启动** |
| **S2-b** | KCoder 侧同步（镜像/声明） | S1-GATE、S2-a | 0.25 | — |
| **S3** | KCoder 宿主侧改造 | S1-GATE、D2/D2.1/D3/D4 | 1.0 | 与 S2-b 同期 |
| **S4** | 物化与本地验收 | S1、S2-b、S3 | 1.0 | — |
| **S5** | 全量回归矩阵 | S4 | 1.0–1.5 | — |
| **S6** | 发布仪式 | S5 | 0.5 | — |
| | **合计** | | **6.25–7.75 人日** | 关键路径 ≈ 5.0–6.0 |

### 4.1 建议日历

> 假设：团队按国庆假期 **10-01（周四）～10-07（周三）** 休假。若不休假，把"10-08"整体前移到 10-01。

| 日期 | 阶段 | 内容 |
|---|---|---|
| 09-28（一） | — | **本计划定稿**（当日） |
| 09-29（二） | S0 + S2-a 启动 | 冻结、决策落档、基线绿验证；插件仓开分支改 peer |
| 09-30（三） | S1（第 1 天） | 建分支 + 依次 merge 修复分支 + 解 4 个真冲突 |
| 10-01 ～ 10-07 | — | 假期（S2-a 可异步：等 npm 发版窗口） |
| 10-08（四） | S1 收尾 + **S1-GATE** | 重放完整性、构建、上游自测、推分支 |
| 10-08 ～ 10-09 | S2-b + S3 | 镜像/声明同步；宿主侧 6 处字面量 + 策略层 + 锚点切换 |
| 10-09（五） | S4 | 物化 + 三查 + 品牌断言 + 双验收（P0-1/P0-2） |
| 10-10 ～ 10-12 | S5 | 自动化门 + 十项人工回归 |
| 10-12 ～ 10-13 | S6 | 发布说明 + 审计报告 + ship |

**冷静期（建议强制）**：S1-GATE 通过后、S3 开始前留**半天**，用**真实会话**（不是脚本）跑一遍。这是发现"静默失效"类问题最有效的窗口——本轮三个 P0 里有两个正是"不崩、只是功能消失"。

---

## 5. 阶段 S0：冻结与准备

| # | 动作 | 命令 / 位置 | 产出 |
|---|---|---|---|
| S0-1 | 记录回滚锚 | `git -C <fork> rev-parse kcoder/0.1.7-rc.2 master dsh-v0.2.0-rc.1`；`git -C KCoder rev-parse HEAD` | 锚点表（写入 v0.6.19 发布说明） |
| S0-2 | 确认工作树干净 | `git -C KCoder status --porcelain`、`git -C <fork> status --porcelain` | 均空 |
| S0-3 | 确认上游对象在本地 | `git -C <fork> cat-file -e 4878cdabd8^{commit}` | 缺失则 `git fetch upstream` |
| S0-4 | **跑到基线全绿** | `bash scripts/release.sh prepush` | 基线绿（此后任何红都能归因本次升级） |
| S0-5 | 决策落档 | 本文档 §2 | 决议记录（已完成） |
| S0-6 | 确认 npm 侧新包可用 | `curl registry.npmjs.org` 七个包（§0.4 已实查） | 记录 |
| S0-7 | 通知插件侧排期 | 两个插件仓 | 发版窗口 |

**出口条件**：S0-2 空 + S0-4 绿 + §2 已定。**门禁**：无。

---

## 6. 阶段 S1：fork 侧集成分支重建

### 6.1 建分支（FORK-WORKFLOW 规则 7）

```bash
cd /Users/libing/kk_Projects/deepseek-harness
git fetch upstream --tags
git checkout -b kcoder/0.2.0-rc.1 4878cdabd8
```
> 旧分支不删（B-5）。

### 6.2 依次 merge 修复分支（顺序敏感）

| 序 | 分支 | 内容 | 本轮提示 |
|---|---|---|---|
| 1 | `fix/markdown-model-sanitize` | 跨行 `**` / 行内 code 合并 | 目标文件无重叠，预期干净 |
| 2 | `fix/session-projection-cache-per-unit-isolation` | projection cache 逐单元隔离 | 无重叠 |
| 3 | `fix/codex-relay-accountid` | pi-ai：accountId 兜底 | **与 4/5/6 共享同一 pnpm patch 文件，必须串行** |
| 4 | `fix/relay-missing-terminal-event` | pi-ai：终止事件容错 | 同上 |
| 5 | `fix/codex-protocol-auto-fallback` | pi-ai：协议自动降级 | 同上 |
| 6 | `fix/opencode-session-header` | pi-ai：`x-opencode-session` 头 | 同上 |
| 7 | `chore/pi-ai-0.87.1-upgrade` | 0.85.1 → 0.87.1 + drift gate 适配 | **P0-3**：保留；删上游 `@0.85.1.patch` |
| 8 | `fix/workspace-*` / `fix/directory-picker-browse` / `fix/session-controller`（远端工作区 3 分支） | world 解析、默认工作区、world-aware browse | 与上游有重叠（§6.3） |
| 9 | `fix/win32-console-window-hide` | Windows 控制台窗口隐藏 | `sandbox-local/src/index.ts` 行号不相交，预期干净 |
| 10 | 品牌化 `b11bd42` | 品牌文案 | **待验证**是否仍需 cherry-pick（附录 D-7） |
| 11 | `imageRequestPricing` `0e9953c` | 图片请求计价 | 同上 |

**准入纪律**：每个 merge 用 `--no-ff` 保留谱系；基线跨度大时先按规则 6 `rebase --onto`。

### 6.3 4 个真冲突与处置决策规则

判定：两侧 `git diff -U0` 的**旧侧行号区间求交**（同基线，行号可比）。

**统一决策规则（先定好，避免逐个争论）**：
> **结构以上游为基底，语义以我方为准重放。** 即：先接受上游的新结构/新hook，再把我方偏离的**语义**逐条重放到新结构上；若我方语义已被上游原生吸收，则**整体撤销**我方改动并在提交信息里注明「上游已吸收」。

| # | 文件 | 我方 hunk | 上游 hunk | 处置 |
|---|---|---|---|---|
| C1 | `packages/client/ui-chat/src/client/locale.ts` | 65 90 154 347 | 60 65 90 253 258 283 | 以上游为新基底；逐个检查我方删除的键是否真无消费者 |
| C2 | `packages/client/ui-chat/tests/chat-view.client.spec.tsx` | 1622 2206 2274 2456 3206…3315 | 507 1622 1624 2274 2456…4091 | 以上游快照为基底重录，我方 `editUserMessage` / `toolDetail` 断言按现状重写 |
| C3 | `packages/client/ui-plugin-manager/src/client/index.ts` | 99 109 137 | 9 23 99 108 | 逐 hunk 保留双方语义（我方 +57/-10 是本地增强，上游 +11/-2 是安装引导） |
| C4 | `packages/client/ui-tool/src/client/tool/components/ToolRow.tsx` | 189 248 | 216 224 235 245 249 | 以我方 `expandable`/`detail` 语义为准，重放到上游新结构 |

**14 个"可自动合并"文件**：git 干净合并，但语义仍需复核，重点是 `ui-chat/src/client/apply.ts`（行号不相交但在同一 apply 函数内）、`ui-chat/chat/{ChatView,MessageItem,TurnProcessNodeView}*`、`ui-plugin-manager/client/locales.ts`。

**`pnpm-lock.yaml`**：删掉重装（B-2）。

### 6.4 重放完整性校验

```bash
git diff --name-only dsh-v0.2.0-rc.1 kcoder/0.2.0-rc.1 | wc -l   # 与"偏离面文件数"对账
git diff --shortstat dsh-v0.2.0-rc.1 kcoder/0.2.0-rc.1
```
惯例：把文件数与偏离面清单做成断言（参考 v0.6.17 的「46 文件集合相等」签名）。

### 6.5 阶段门 S1-GATE 与失败处置

- [ ] `git merge-base --is-ancestor 4878cdabd8 HEAD`
- [ ] `CI=true pnpm install` exit 0
- [ ] `pnpm run build` exit 0（Host / Client / Web）
- [ ] 上游自测泳道绿（至少 `packages/client`、`packages/core`、`packages/llm`）
- [ ] `pnpm run test:docs`（翻译配对门）
- [ ] `packages/llm/llm-pi-ai` 全包绿（含 relay / opencode / e2e）
- [ ] `patches/` 只剩一份 pi-ai patch；`pnpm-workspace.yaml` 换键一致
- [ ] 分支已推远端 `git push -u origin kcoder/0.2.0-rc.1`

| 失败项 | 处置 |
|---|---|
| 4 个真冲突解不出 | 回到 §6.3 决策规则；仍不行则**评估放弃对应我方偏离**（记入 release note 的"能力变化"） |
| `llm-pi-ai` 红 | 检查是否被新基线的 0.85.1 覆盖；按 D6 重放 |
| 上游自测红 | 判定是上游自身 flake 还是我方偏离引入；前者记录并跳过（附证据），后者必须修 |
| 构建红 | 查 `verify-vendor-purity.sh`（物化残留会让 tsdown 当假成员） |

---

## 7. 阶段 S2：插件侧改造与发布

### 7.1 影响面（按闸门口径实测 6 个随包 bundle）

| bundle | 版本 | dsh peer 条数 | `0.2.0-rc.1` 判定 |
|---|---|---|---|
| `dsh-coding-sidebar` | 1.0.34 | 11 | ❌ 被拒（11 条全不命中） |
| `dsh-file-review-kcoder` | 1.0.10 | 12 | ❌ 被拒（2 条不命中） |
| `dsh-ssh-remote` | 0.1.2 | 2 | ✅ 通过 |
| `dsh-shell-prefs` / `dsh-skills-bundle` / `dsh-terminal` | — | 0 | ✅ 不触发 |

### 7.2 S2-a 需改的 peer 清单（实施清单）

**`dsh-coding-sidebar`（11 条，全部同款范围）**：

`@deepseek-ai/dsh-agent`、`dsh-client-locale`、`dsh-client-ui-conversation`、`dsh-client-ui-primitives`、`dsh-client-ui-settings`、`dsh-client-ui-slots`、`dsh-host-webserver`、`dsh-llm`、`dsh-session`、`dsh-subagent`、`dsh-tools`
（现均为 `^0.1.5-rc.2 || ^0.1.6-alpha.1 || ^0.1.6-alpha.2 || ^0.1.7-alpha.1`）

**`dsh-file-review-kcoder`（12 条，两类）**：

- ⚠️ **必须改的 2 条**（裸 caret，无 `||` 兜底）：`@deepseek-ai/dsh-session`、`@deepseek-ai/dsh-api-session-controller`（现均为 `^0.1.7-alpha.1`）
- 收口 10 条（现为 `>=0.1.0-rc.5 <0.2.0 || ^0.1.6-alpha.1 || 0.1.6-alpha.2 || ^0.1.7-alpha.1`）：`dsh-agent`、`dsh-api-remotes`、`dsh-atomic-write`、`dsh-client-locale`、`dsh-client-ui-conversation`、`dsh-client-ui-primitives`、`dsh-client-ui-slots`、`dsh-system-prompt`、`dsh-typert-protocol`、`dsh-typert-registry`

**目标值（D5）**：全部改为 `>=0.1.7-rc.2 <1.0.0`

### 7.3 动作序列

| # | 动作 | 归属 | 备注 |
|---|---|---|---|
| S2-1 | 两个插件仓改 peer（§7.2 清单） | 插件侧 | 一次性改完，勿留半改 |
| S2-2 | `devDependencies` 里上游包对齐可安装版本 | 插件侧 | 需能装到 `0.2.0-rc.1` 以跑新基线单测 |
| S2-3 | 跑各自 `typecheck` + spec（**在 0.2.0-rc.1 基线上**） | 插件侧 | 这是"契约面兼容"升级为"编译级兼容"的关键一步 |
| S2-4 | 版本 bump：`1.0.34 → 1.0.35`、`1.0.10 → 1.0.11` | 插件侧 | — |
| S2-5 | `npm publish` | 插件侧 | 发布后**不可撤回**，建议先 `--dry-run` |
| S2-6 | 真源 → `dsh-plugins` 镜像 | 插件侧 | `sync-bundles.mjs` 的中间层 |
| S2-7 | `dsh-plugins` → KCoder `bundle/` | KCoder（S2-b） | `node scripts/sync-bundles.mjs` |
| S2-8 | `PRESET_PLUGINS` 下界对齐新版本 | KCoder（S2-b） | 规则①：必须**等于** bundle 版本且指向**已发布**版本 ⇒ 顺序不能倒 |
| S2-9 | 对账 | KCoder（S2-b） | `sync-bundles.mjs --check` + `check-bundle-version-line.mjs` |

> **S2-a 与 S1 的关系（v2 修正）**：因 D5 采用双兼容口径，**S2-a 可在 S1 之前/并行进行**——新版本对旧基线同样有效，不存在"发布后老版本新装用户被拒"的风险。但 **S2-b（KCoder 侧镜像与声明）必须与 S1 一起落**，否则会出现"声明新版本 + 引擎还是旧基线"的窗口期。这条取代 v1 中"插件必须等 S1"的说法。

### 7.4 阶段门 S2-GATE 与失败处置

- [ ] `npm view <pkg>@<ver> peerDependencies` 中所有 dsh peer = `>=0.1.7-rc.2 <1.0.0`
- [ ] 闸门口径复核：对 `0.1.7-rc.2` **与** `0.2.0-rc.1` 均通过（用 §15 的复核脚本）
- [ ] 两个插件在新基线上 `typecheck` + spec 绿
- [ ] `check-bundle-version-line.mjs` 通过；`sync-bundles.mjs --check` 零漂移

| 失败项 | 处置 |
|---|---|
| 新基线上编译失败 | 说明不只是 peer 面不兼容；按编译错误逐个适配（升级为 S3 级别的改造） |
| npm 已发布但 peer 写错 | **不能撤回**；发 `1.0.36` 修正（并在 release note 记录） |
| 声明与 bundle 不同线 | 规则①会拦；按 S2-7→S2-8 顺序补做 |

---

## 8. 阶段 S3：KCoder 宿主侧改造

### 8.1 版本字面量对齐（6 处硬 + 2 处注释）

| 文件:行 | 现值 | 目标 | 不改的后果 |
|---|---|---|---|
| `upstream/BASELINE:1` | `477b4f4205…` | `4878cdabd8…` | `release.sh build:133-137` 断言失败 ⇒ **发不出包** |
| `scripts/setup.sh:15` | `kcoder/0.1.7-rc.2` | `kcoder/0.2.0-rc.1` | 新克隆切旧分支 |
| `scripts/release.sh:134-135` | `kcoder/0.1.7-rc.2` | 同上 | 同上断言失败 |
| `desktop/main/dsh-contract.ts:61` | `kcoder/0.1.7-rc.2` | 同上 | 桌面端分支探测/关于页错 |
| `desktop/main/preset-plugins.ts:188-191` | 4× `@deepseek-ai/dsh-*-ssh` `@0.1.7-rc.2` | `@0.2.0-rc.1` | **远端工作区整链 failed to import** |
| `desktop/main/preset-plugins.ts`（`PRESET_PLUGINS`） | `^1.0.34` / `^1.0.10` | `^1.0.35` / `^1.0.11` | 版本线闸拦；实体到不了用户 |
| `package.json:version` | `0.6.18` | `0.6.19` | 发版 |
| `desktop/main/product-policy.ts:47,101`（注释） | 「上游 0.1.7-rc.2」 | 更新 | 文档准确性 |
| `desktop/main/remote-server.ts:75,304`（注释） | 引擎版本表述 | 更新 | 同上 |

### 8.2 产品策略层（`desktop/main/product-policy.ts`）

| # | 动作 | 决议依据 | 失败/遗漏后果 |
|---|---|---|---|
| S3-1 | **删除** `time-context` / `schedule` / `ui-schedule` 三行覆写（`:109-114`） | 三行已迁出默认组合 | 保留 ⇒ 每次启动 3 条 `patch: entry … not found` warning（功能仍丢） |
| S3-2 | 更新文件头注释（`:47`）说明调度改由 bundle 提供 | 文档一致性 | — |
| S3-3 | profile 的 `dsh.profile.bundles` + `dependencies` 增 `@deepseek-ai/dsh-experimental-schedule-bundle@0.2.0-rc.1` | **D4** | 漏做 ⇒ 定时任务/时间上下文**真丢**（S3-1 删了旧路径） |
| S3-4 | **保留** `session-log-deepseek` 的 `config: {enabled: false}` | **D2** | 移除 ⇒ 会话日志会上传，违背产品承诺 |
| S3-5 | **新增** `ui-settings-session-log` 行 `disabled: true` | **D2.1**（§0.3 证据链） | 漏做 ⇒ 用户看到一个点了没用的开关，甚至 UI 显示"已开"而实际关 |
| S3-6 | **新增** `desktop-product-telemetry` 与 `product-analytics` 两行 `disabled: true` | **D3** | 漏做 ⇒ 靠 profile 名巧合隔离；上游改默认即静默开启遥测 |
| S3-7 | 保留 `ui-sidebar-terminal`（`disabled: true`）、`ui-sidebar-browser`（`disabled: false`）、`ui-deliverables`（`config.tailCard: false`）三行**不变** | 行 id 在新版仍存在；`tailCard` 是我方 fork 字段 | — |

### 8.3 注入锚点与自绘状态栏

| # | 动作 | 原因 | 证据 |
|---|---|---|---|
| S3-8 | **切锚**：`brand-injector.ts:284` 的 `[class*="_turnStatus"]` → `[data-chat-running]`（兜底 `[class*="runningText"]`） | 旧锚**基线即死**（`turnStatus` 类名 0.1.7-rc.1 起消失）；新版恰好引入更稳的新锚 | `ui-chat/src/client/chat/RunningStatus.tsx` + `RunningWhaleTail.tsx`（新文件）；`ChatView.module.css:116-164` |
| S3-9 | 按 §16 C.3 全量核验锚点存活 | 上游改了 28 个 client 文件 | 除 `_turnStatus` 外全部旧=新（已核） |
| S3-10 | CSS 变量改名：`--dsh-frame-top-clearance` → `--dsh-frame-overlay-top` | 上游 #5268 改设置面板几何 | `SettingsRoot.module.css:73,90`；与 `titleBarCompat` / `titleBarStripPx` 同一战区 |
| S3-11 | （可选）文档预览选区新 token `--dsw-alias-bg-document-selection` | 上游 #5312 一行 CSS，新 token 0.2.0 才引入 | 我方若复刻需带 fallback |

### 8.4 物化链与打包清单

| # | 检查项 | 位置 |
|---|---|---|
| S3-12 | `BUNDLES` 表 6 项与 `bundle/` 目录一致 | `desktop/main/kcoder-skills-bundle.ts:125-147` |
| S3-13 | `electron-builder.yml` 的 `extraResources` 8 项与 `bundle/` 一致 | `:24-54`、`:63-70` |
| S3-14 | `profiles/web/patches/dsh-context@0.55.0.patch` 不被触碰 | 与 B-1 绑定 |
| S3-15 | `desktop/main/remote-server.ts` 引擎装载链与 4 个 SSH 包同线 | — |

### 8.5 阶段门 S3-GATE 与失败处置

- [ ] `grep -rn '0\.1\.7-rc\.2' desktop/ scripts/ upstream/BASELINE` 零命中
- [ ] `node scripts/check-bundle-version-line.mjs` 通过
- [ ] `pnpm typecheck` 通过
- [ ] `pnpm exec electron-vite build` 通过

| 失败项 | 处置 |
|---|---|
| 版本线闸拦（声明与 bundle 不同线） | 回到 S2-b 顺序补做 |
| 设置页锚点冒烟红 | `settings_smoke` 会指出哪个锚点失配；按上游新 DOM 修注入器 |

---

## 9. 阶段 S4：产物物化与本地验收

| # | 动作 | 命令 | 期望 |
|---|---|---|---|
| S4-1 | 物化上游运行时 | `pnpm --dir <fork> --filter=@deepseek-ai/dsh deploy --prod --legacy "$PWD/staging/kcoder-runtime"` | 产出 `lib/bin.js` |
| S4-2 | **补 peer + native 三查** | `node scripts/materialize-peers.mjs` | 版本 + 补丁标记 + 目录三查（**Koffi 本轮从 `^3.1.0` 改精确 pin `3.1.1`**，必跑） |
| S4-3 | 打运行时 tar | `release.sh build` 内置 | `staging/kcoder-runtime.tar.gz` |
| S4-4 | 品牌断言 | `node scripts/brand-assert.mjs staging/kcoder-runtime.tar.gz` | 品牌文案真实进产物 |
| S4-5 | 运行时冒烟 | `node scripts/smoke-runtime.mjs --dir staging/kcoder-runtime --exec <electron>` | 就绪行 + 首页 200 |
| S4-6 | **P0-1 验收**（兼容闸门） | 真实起服并抓 stderr | **不得出现** `disabling profile plugin` |
| S4-7 | **P0-2 验收**（策略层） | `dsh web --dump-config` | 四行符合意图；**不得出现** `patch: entry … not found`；三行调度由新 bundle 提供且未 disabled；`session-log-deepseek` = `enabled: false`；`ui-settings-session-log` / 两行遥测 = `disabled: true` |
| S4-8 | bundle 随包对账 | `node scripts/verify-bundles-shipped.mjs <resources>` | 无缺项 |
| S4-9 | **冷静期真实会话冒烟** | 手工：开一个真实会话跑几轮 | 对话/侧边栏/终端/文件审查可用 |

**阶段门 S4-GATE**：S4-2、S4-4、S4-5、S4-6、S4-7、S4-8、S4-9 全绿。

| 失败项 | 处置 |
|---|---|
| 出现 `disabling profile plugin` | 读警告里的插件名与 peer 明细 ⇒ 回到 S2 修 peer |
| 出现 `patch: entry … not found` | 该 id 已从上游移除 ⇒ 回到 S3-1/S3-6 核对策略行 |
| 三行调度缺失 | profile bundles 未生效 ⇒ 查 S3-3 的 `dependencies` 是否可解析 |
| 物化三查失败 | 检查 `materialize-peers` 的补丁体选择（历史事故）；必要时临时改回 `findExternal` 语义排查 |

---

## 10. 阶段 S5：全量回归矩阵

### 10.1 自动化门（本机）

| 门 | 命令 | 覆盖 |
|---|---|---|
| 全仓库审计 | `bash scripts/release.sh audit` | typecheck / lint / 生产依赖漏洞 |
| 插件热补丁闸 | `bash scripts/release.sh patchgate` | 补丁清单 / marks / 版本键零漂移 |
| 内置插件版本线 | `bash scripts/release.sh bundleline` | 声明同线 + 内容变更伴随版本变更 |
| 设置页注入锚点 | `bash scripts/release.sh settings_smoke` | dialog + `settings.section` |
| pre-push 全门 | `bash scripts/release.sh prepush` | 以上四项 + 全量构建 |
| 打包与校验 | `bash scripts/release.sh build` → `verify` | 物化 / 签名 / 公证 / 包内起服 |

> **11 支 GUI 冒烟**（只进本机发版门，不进 CI）：`smoke-account-chip` / `smoke-brand-badge` / `smoke-context-tab` / `smoke-mcp-dom` / `smoke-panel-buttons` / `smoke-runtime` / `smoke-settings-anchors` / `smoke-sidebar-toggle` / `smoke-skills-dom` / `smoke-skills-page` / `smoke-workspace-header`。**本轮全部要跑**（上游改了 312 个 client 文件）。

### 10.2 人工回归重点（按「上游改了什么 × 我方碰过什么」排序）

| 优先 | 面 | 为什么 | 检查点 |
|---|---|---|---|
| 1 | **侧边栏与文件审查** | P0-1 直接命中 + 上游改了 `ui-sidebar`/`ui-theme`/`ui-tool` | 文件树 / CM6 编辑 / 预览 / Git / 子代理全可用；改动审查卡在三档工作过程下都正常 |
| 2 | **对话运行态** | 上游新增鲸尾动画 + `TextShimmer` + 过程行间距；我方 `ui-chat` 偏离最深 | 运行/完成态动画、用时信息、过程组折叠、四档展示切换、用户消息编辑按钮 |
| 3 | **插件管理页** | 上游 4 个 PR 改这页 | 安装引导 / 注册表选择 / 卡片布局 / 深色开关区分度 |
| 4 | **设置页** | CSS 变量改名 + 新会话日志开关（应被隐藏）+ MCP 注入区 | 原生分区**不重复**；无 Session Log 开关；MCP 分区正常；关于/数据迁移注入页正常 |
| 5 | **终端** | 上游仅 pty 尾宽限变更，但终端是我方自研 | 多标签 / Shell 选择 / 刷新恢复 |
| 6 | **定时任务**（新路径） | 从"出厂即开"变"bundle 提供" | 任务页在位、能建提醒、时间上下文生效 |
| 7 | **Office/PDF 预览** | 上游改了选区配色与几何 | 浅/深主题选区可见、缩放控件、窄面板 |
| 8 | **远端工作区** | 4 个 SSH 包升版 | 连 Linux 主机、远端终端/文件/Git |
| 9 | **品牌面** | 品牌注入锚点（含切锚后的运行态） | 标题栏 / 关于页 / 欢迎页 / 状态栏集群；**运行中会话的鲸尾锚点命中** |
| 10 | **账号与网页搜索** | 上游 #5228 账号 token 走搜索 | 账号态下网页搜索可用 |

### 10.3 阶段门 S5-GATE 与失败处置

- [ ] §10.1 全部命令绿
- [ ] §10.2 十项人工回归通过（留截图/录屏）
- [ ] 无新增 console error / 无 `disabling profile plugin` / 无 `patch: entry … not found`

| 失败项 | 处置 |
|---|---|
| 人工回归发现功能缺失 | 先判"是我的策略行没落"还是"上游行为变化"；前者回 S3，后者评估接受并写进 release note |
| 冒烟脚本本身 flake | 重跑两次；稳定复现才当回归 |

---

## 11. 阶段 S6：发布仪式

| # | 动作 | 命令 / 产物 | 备注 |
|---|---|---|---|
| S6-1 | 写发布说明 | `release/v0.6.19.md`（大纲见 §11.1） | 模板见 `release/README.md` |
| S6-2 | 写审计报告 | `release/audit-v0.6.19.md` | `ship` 强制校验 |
| S6-3 | 确认 fork 已推 | `git -C <fork> status -sb` 领先远端 = 0 | **0.4.5 事故**：tag 早于 fork push |
| S6-4 | 一键发布 | `bash scripts/release.sh ship 0.6.19` | 前置门通过后 bump + commit + tag + push |
| S6-5 | CI 产物校验 | `.github/workflows/release.yml` | 品牌断言 / 冒烟 / verify-bundles-shipped / 签名公证 / 包内起服 |
| S6-6 | 发布后复核 | `gh release edit v0.6.19 -R kkutysllb/KCoder -F release/v0.6.19.md` | — |
| S6-7 | 文档回填 | §附录 D | 把"未验证"改成实测结论 |

### 11.1 `release/v0.6.19.md` 大纲

```markdown
# KCoder v0.6.19

> 发布日期：2026-10-13 · 上游基线：deepseek-harness 0.2.0-rc.1 (4878cdabd8)

## 上游基线变化
- 从 0.1.7-rc.2 跨入 0.2.0 系列（261 提交 / 1109 文件），逐项核实后落地。

## 升级注意（用户可见变化）
- **定时任务与时间上下文改为可选组件**：上游把这三行抽成独立可选包，
  现在可在「设置 → 插件」里自行开关；默认仍为开启。（对应上游发布说明的
  「自动化任务改由可选插件包提供」）
- **侧边栏（dsh-coding-sidebar）与改动审查（dsh-file-review-kcoder）升级**
  到兼容 0.2 引擎的版本。
- 会话日志上传保持关闭，本次未改变该产品策略。
- 若之前手动关过定时任务，升级后设置会被重置为开启。

## 新特性（承接上游）
- 对话运行态动画与过程信息优化
- 插件管理界面与安装引导改进
- Office / PDF 预览文字选区在浅色/深色下更清晰
- 账号模型网页搜索无需额外 API Key
- 工具调度异常后对话可继续（结果未知的操作会先提示核实副作用）

## 修复
- （KCoder 侧本轮修复项，若有）

## 已知变化 / 取舍
- 本版采用双兼容 peer 口径（>=0.1.7-rc.2 <1.0.0），计划在下一轮插件发版收窄为 0.2 线。
```

---

## 12. 回滚方案（按止损成本分级）

| 级 | 时机 | 动作 | 成本 |
|---|---|---|---|
| **R1** | S1 中（冲突难解 / 构建崩） | 丢弃 `kcoder/0.2.0-rc.1`，留在 `kcoder/0.1.7-rc.2`；KCoder 侧零改动 | 极低 |
| **R2** | S2/S3 后 | 回退 KCoder 工作树到 S0 锚点；fork 分支保留不推；插件新版本**不必撤回**（旧版本 `1.0.34`/`1.0.10` 仍在 npm，且**新版本因 D5 双兼容对旧基线同样有效**） | 低 |
| **R3** | S5 回归不通过 | 同 R2，另把 4 处分支字面量回退 | 中 |
| **R4** | 已发布后发现致命缺陷 | ① 撤回 release + 删 tag（`release.sh release delete v0.6.19 --with-tag`）<br>② 若已扩散：发 hotfix 回退基线 | 高 |

> **v2 修正**：v1 曾担心"插件 peer 改成 `^0.2.0` 后旧基线无法回滚"。**D5 采用 `>=0.1.7-rc.2 <1.0.0` 后该陷阱消失** —— 新插件版本对旧基线同样有效，回滚不再受插件制约。**但仍禁止 B-7**（在 S1 未过时改 KCoder 的声明与镜像），否则窗口期内会出现"声明新版 + 实体旧版/基线旧版"的不一致。

---

## 13. 风险登记册

| # | 风险 | 触发条件 | 影响 | 预案 | 被哪道门/动作拦住 |
|---|---|---|---|---|---|
| RK-1 | 插件 peer 改错或漏改 | 漏某条 / 写成 `^0.2.0` | 功能区消失 | 按 §7.2 清单逐条改；用 §15 复核脚本 | S2-GATE（闸门口径复核） |
| RK-2 | pi-ai 线被新基线覆盖 | merge 时误取 | relay/opencode 全挂 | 按 D6 保留 0.87.1 | S1-GATE（`patches/` 断言 + `llm-pi-ai` 全包） |
| RK-3 | native 物化选错补丁体 | `materialize-peers` 版本盲选（历史事故） | 静默覆盖新补丁体 | Koffi 本轮改精确 pin，重点看 | S4-2 三查 |
| RK-4 | lockfile 手工 merge 残留 | 图省事 | 依赖树与 lock 不一致 | 删掉重装 | B-2 + S1-GATE |
| RK-5 | `ui-chat` 4 个真冲突解错 | 直接取 ours/theirs | 对话区回归 | §6.3 决策规则 | S5 第 2 项人工回归 |
| RK-6 | 调度改 bundle 后行为变化未告知 | 漏 release note | 用户困惑 | S6-1 大纲已含 | S6-1 |
| RK-7 | 会话日志开关被用户打开 | 新设置页可见 | 违背 D2 承诺 | **D2.1 直接隐藏该行** | S4-7（`--dump-config` 断言） |
| RK-8 | 上游 0.2.0 正式版很快发布 | 时间窗口 | 刚升 rc 又要升 | D5 耐久口径可平滑接；本轮不追求完美 | — |
| RK-9 | CI 拿到未推送的 fork 状态 | tag 早于 fork push | 产物与 dev 脱节（0.4.5 事故） | S6-3 显式检查 | S6-3 |
| RK-10 | `dsh-context` 被顺手升版 | 无意识 `pnpm update` | 补丁断供 | **B-1 冻结版本** | `patchgate` |
| RK-11 | 老版本新装用户被新插件版本拒载 | peer 不含 0.1.x | 老版本侧边栏消失 | **D5 双兼容口径** | S2-GATE（对 0.1.7-rc.2 也要通过） |
| RK-12 | 新设置页开关"显示已开但实际关" | 未做 D2.1 | 误导用户 | D2.1 隐藏该行 | S4-7 + 人工回归第 4 项 |

---

## 14. 附录 A：文件级改动清单

### A.1 KCoder 版本字面量与门禁

| 文件 | 位置 | 现值 | 目标 | 强制度 |
|---|---|---|---|---|
| `upstream/BASELINE` | 首行 | `477b4f420553e8a52c2fbccc464d7561b239c443` | `4878cdabd87d4041bdaff61d04c966883b9fd07a` | **硬**（build 断言） |
| `upstream/BASELINE` | 尾部 | — | 追加「升级记录：2026-10-13 0.1.7-rc.2 → 0.2.0-rc.1」段 | 惯例 |
| `scripts/setup.sh` | `:15` | `kcoder/0.1.7-rc.2` | `kcoder/0.2.0-rc.1` | **硬** |
| `scripts/release.sh` | `:130`（注释）`/:134`/`:135` | 同上 | 同上 | **硬** |
| `desktop/main/dsh-contract.ts` | `:54`（注释）`/:61` | 同上 | 同上 | **硬** |
| `desktop/main/preset-plugins.ts` | `:185`（注释）`/:188-191` | 4× `@deepseek-ai/dsh-*-ssh` `@0.1.7-rc.2` | `@0.2.0-rc.1` | **硬**（远端工作区） |
| `desktop/main/preset-plugins.ts` | `PRESET_PLUGINS` 两键 | `^1.0.34` / `^1.0.10` | `^1.0.35` / `^1.0.11` | **硬**（版本线闸） |
| `desktop/main/product-policy.ts` | `:47`/`:101`（注释）、`:109-114`（三行）、新增 3 行 | 见 §8.2 | 见 §8.2 | **硬**（P0-2） |
| `desktop/main/remote-server.ts` | `:75`/`:304`（注释） | 引擎版本表述 | 更新 | 惯例 |
| `package.json` | `version` | `0.6.18` | `0.6.19` | 硬 |
| `release/` | — | — | 新增 `v0.6.19.md`、`audit-v0.6.19.md` | **硬**（ship 校验） |

### A.2 fork 侧（集成分支）

| 类别 | 数量 | 处置 |
|---|---|---|
| 新增文件（我方） | 8 | 随修复分支带入 |
| 重命名 | 1 | pi-ai patch `@0.85.1` → `@0.87.1`；**删除上游那份 0.85.1** |
| 真冲突文件 | 4 | C1–C4（§6.3） |
| 可自动合并但需语义复核 | 14 | 尤其 `ui-chat/src/client/apply.ts` |
| 需重新生成 | 1 | `pnpm-lock.yaml` |
| 与上游无重叠的我方文件 | 55 | 预期干净合并 |

### A.3 插件侧

| 插件 | 文件 | 改动 |
|---|---|---|
| `dsh-coding-sidebar` | `package.json` | 11 条 dsh peer → `>=0.1.7-rc.2 <1.0.0`；version `1.0.34 → 1.0.35` |
| `dsh-file-review-kcoder` | `package.json` | 2 条必改 + 10 条收口（同口径）；version `1.0.10 → 1.0.11` |
| 两仓 | `devDependencies` | 上游包对齐可安装版本 |
| KCoder | `bundle/dsh-coding-sidebar`、`bundle/dsh-file-review-kcoder` | `sync-bundles.mjs` 同步 |

### A.4 可选清理（本轮可做可不做）

| 项 | 状态 | 建议 |
|---|---|---|
| `native-overlay/` | 空目录（`lib/` 无文件）、全仓零引用 | 可删；不删无害（B-8） |
| `.patches/` | 历史归档 | 保留 |
| `upstream/*.patch`（0001–0007） | 已退役归档形态 | 保留为历史 |
| 把闸门口径复核脚本接进 CI | 尚无 | **登记为后续改进**（本轮不做，避免扩大改动面） |

---

## 15. 附录 B：命令手册（按阶段）

> 设 `R=/Users/libing/kk_Projects/deepseek-harness`，`K=/Users/libing/kk_Projects/KCoder`，`SEM="<runtime>/node_modules/semver"`。

```bash
# ── S0 冻结 ──────────────────────────────────────────────
git -C $R rev-parse kcoder/0.1.7-rc.2 master dsh-v0.2.0-rc.1
git -C $R status --porcelain && git -C $K status --porcelain   # 均应空
bash $K/scripts/release.sh prepush                             # 基线绿

# ── S1 fork 集成分支 ────────────────────────────────────
cd $R && git fetch upstream --tags
git checkout -b kcoder/0.2.0-rc.1 4878cdabd8
for b in fix/markdown-model-sanitize fix/session-projection-cache-per-unit-isolation \
         fix/codex-relay-accountid fix/relay-missing-terminal-event \
         fix/codex-protocol-auto-fallback fix/opencode-session-header \
         chore/pi-ai-0.87.1-upgrade; do git merge --no-ff "$b"; done
rm -f pnpm-lock.yaml && pnpm install      # B-2：不手工 merge
pnpm run build
git diff --name-only dsh-v0.2.0-rc.1 kcoder/0.2.0-rc.1 | wc -l   # 重放完整性
git push -u origin kcoder/0.2.0-rc.1

# ── S2 闸门口径复核（对两个引擎版本都要过）─────────────
node -e "
const s=require('$SEM');
const pkgs=['$K/bundle/dsh-coding-sidebar','$K/bundle/dsh-file-review-kcoder'];
for(const p of pkgs){
  const j=require(p+'/package.json');
  const peers=Object.entries(j.peerDependencies||{}).filter(([k])=>k.startsWith('@deepseek-ai/dsh'));
  for(const eng of ['0.1.7-rc.2','0.2.0-rc.1']){
    const bad=peers.filter(([k,r])=>!s.satisfies(eng,r,{includePrerelease:true}));
    console.log(j.name, eng, bad.length? ('❌ '+bad.map(b=>b[0]).join(',')) : '✅');
  }
}"
cd $K && node scripts/sync-bundles.mjs && node scripts/sync-bundles.mjs --check
node scripts/check-bundle-version-line.mjs

# ── S3 宿主侧 ───────────────────────────────────────────
grep -rn '0\.1\.7-rc\.2' $K/desktop $K/scripts $K/upstream/BASELINE    # 应零命中
cd $K && pnpm typecheck && pnpm exec electron-vite build

# ── S4 物化与产物验收 ───────────────────────────────────
pnpm --dir $R --filter=@deepseek-ai/dsh deploy --prod --legacy "$K/staging/kcoder-runtime"
node $K/scripts/materialize-peers.mjs
node $K/scripts/brand-assert.mjs $K/staging/kcoder-runtime.tar.gz
node $K/scripts/smoke-runtime.mjs --dir $K/staging/kcoder-runtime --exec "$ELECTRON_BIN"
# P0 双验收（关键）：stderr 不得有 disabling profile plugin
dsh web --dump-config | grep -E 'time-context|schedule|ui-schedule|session-log|product-analytics|ui-deliverables'
node $K/scripts/verify-bundles-shipped.mjs <resources>

# ── S5 回归 ─────────────────────────────────────────────
for c in audit patchgate bundleline settings_smoke prepush; do bash $K/scripts/release.sh $c; done
bash $K/scripts/release.sh build && bash $K/scripts/release.sh verify

# ── S6 发布 ─────────────────────────────────────────────
git -C $R status -sb          # 领先远端必须为 0
bash $K/scripts/release.sh ship 0.6.19
```

---

## 16. 附录 C：验收清单（可勾选）

### C.1 硬门禁

- [ ] `upstream/BASELINE` 首行 = `4878cdabd8…`
- [ ] `kcoder/0.2.0-rc.1` 已推远端，`merge-base --is-ancestor 4878cdabd8 HEAD` 成立
- [ ] `grep -rn '0\.1\.7-rc\.2' desktop/ scripts/ upstream/BASELINE` 零命中
- [ ] 两个插件新版本 peer = `>=0.1.7-rc.2 <1.0.0`
- [ ] 闸门口径复核：对 `0.1.7-rc.2` **与** `0.2.0-rc.1` 均通过
- [ ] `check-bundle-version-line.mjs` 通过；`sync-bundles.mjs --check` 零漂移
- [ ] `release.sh prepush` / `build` / `verify` 通过
- [ ] `release/v0.6.19.md`、`release/audit-v0.6.19.md` 入库

### C.2 运行时证据（P0 验收）

- [ ] 启动 stderr **无** `disabling profile plugin …`
- [ ] `--dump-config` **无** `patch: entry … not found`
- [ ] `session-log-deepseek` 的 `config.enabled` = `false`
- [ ] `ui-settings-session-log` 行 `disabled: true`（D2.1）
- [ ] `desktop-product-telemetry` / `product-analytics` 两行 `disabled: true`（D3）
- [ ] `ui-sidebar-browser` / `ui-sidebar-terminal` / `ui-deliverables` 符合产品意图
- [ ] `time-context` / `schedule` / `ui-schedule` 由 schedule bundle 提供且**未** disabled
- [ ] profile 的 `dsh.profile.bundles` 含 `@deepseek-ai/dsh-experimental-schedule-bundle`

### C.3 注入锚点（除 `_turnStatus` 外应全部旧=新）

- [ ] `body[data-ds-dark-theme]`
- [ ] `[data-slot="settings.section"]`
- [ ] `[data-slot="conversation.session.header"]`
- [ ] `[data-composer-input]` / `[data-composer-card]`
- [ ] `logoRow` / `brandName` / `railMark` / `headline` / `fish` / `titleGroup` / `previewBadge` / `settingsArea`
- [ ] `AccountMenu.module.css` 的 `_trigger` / `SettingsRoot.module.css` 的 `_navTitle` / `_titleRow`
- [ ] `AppFrame.module.css` 的 `overlayLayer` / `sidebarCol`
- [ ] `[role="tree"] … sessionRow`
- [ ] **新锚 `[data-chat-running]` 命中运行态**（切锚后的验证）
- [ ] 自有锚仍在：`#__dsh_desktop_titlebar`、`[data-dsh-toggle-cluster]`、`[data-dsh-panel-host]`

### C.4 人工回归（十项，§10.2）

- [ ] 侧边栏与文件审查　- [ ] 对话运行态　- [ ] 插件管理页　- [ ] 设置页　- [ ] 终端
- [ ] 定时任务（新路径）　- [ ] Office/PDF 预览　- [ ] 远端工作区　- [ ] 品牌面　- [ ] 账号与网页搜索

---

## 17. 附录 D：产物清单与文档回填

### D.1 本轮产物（落点）

| 产物 | 落点 | 归属阶段 |
|---|---|---|
| 集成分支 `kcoder/0.2.0-rc.1` | fork 远端 | S1 |
| 重放完整性签名（文件数 + shortstat） | release note / BASELINE 升级记录 | S1 |
| `dsh-coding-sidebar@1.0.35` | npm | S2-a |
| `dsh-file-review-kcoder@1.0.11` | npm | S2-a |
| 两个 bundle 镜像 | `KCoder/bundle/` | S2-b |
| 策略层新版本 | `~/.kcoder/cordis.patch.kcoder.yml`（由代码生成） | S3 |
| `staging/kcoder-runtime.tar.gz` | KCoder | S4 |
| 安装包 | `dist/` → GitHub Release | S6 |
| `release/v0.6.19.md`、`release/audit-v0.6.19.md` | KCoder | S6 |

### D.2 文档回填清单

| 文档 | 回填内容 | 阶段 |
|---|---|---|
| `upstream/BASELINE` | 追加升级记录段（改动清单 + 重放完整性 + 遇坑） | S1/S6 |
| [upstream-0.2.0-rc.1-analysis.md](upstream-0.2.0-rc.1-analysis.md) §8 | 把"未验证"改成实测结论；补 peer 口径最终值 | S6-7 |
| [upstream-0.2.0-rc.1-upgrade-plan.md](upstream-0.2.0-rc.1-upgrade-plan.md) | 标注执行结果与偏差 | S6-7 |
| `release/v0.6.19.md` | 用户可见变化（§11.1 大纲） | S6-1 |
| `release/audit-v0.6.19.md` | 审计发现项处置 | S6-2 |
| [plugin-dev-checklist.md](plugin-dev-checklist.md) | 新增「peer 口径」一节（本轮教训） | 后续 |
| [remote-workspace-route-b.md](remote-workspace-route-b.md) | 4 个 SSH 包版本 0.1.7-rc.2 → 0.2.0-rc.1 | S3 |

### D.3 遗留待办（本轮不做，登记）

| # | 待办 | 触发时机 |
|---|---|---|
| T-1 | 插件 peer 收窄为 `>=0.2.0-0 <1.0.0` | v0.6.19 发布、老版本退场后，下一轮插件发版 |
| T-2 | 把闸门口径复核脚本接进 CI（`.github/workflows/plugin-contract.yml`） | 后续 |
| T-3 | 清理 `native-overlay/` 死目录 | 空闲时 |
| T-4 | 把「CLI overlay 整份替换 config ⇒ 会被后续用户写入掩盖」写进 `product-policy.ts` 文件头 | 随 S3-2 一并 |

---

## 18. 附录 E：未决与待验证

| # | 项 | 状态 | 验证方式 |
|---|---|---|---|
| 1 | 两个插件在 0.2.0-rc.1 上的**编译级**兼容 | 未验证 | S2-3 在新基线上跑 `typecheck` + spec |
| 2 | 哈希前缀锚点（`_trigger` / `_navTitle` / `_close`）在**实机 built 产物**的存活 | 源码层已核，产物层未核 | 装包后 DevTools 查 `class` 实际值 |
| 3 | 兼容闸门在 KCoder **桌面集成路径**上的实际行为 | 机制已读死，未实机跑 deny | S4-6 抓 stderr |
| 4 | `session-log-download` / `session-log-export` 行是否与我方"不上传"口径冲突 | 未展开 | 读该包 README + 实机看设置页 |
| 5 | `ctx.otel` 是否构成新出口 | 设计上不建连接，未实测 | 实机看 OTel 导出日志 |
| 6 | 品牌化 `b11bd42` 与 `imageRequestPricing` `0e9953c` 是否仍需 cherry-pick | 未核 | 在新基线上 grep 对应语义 |
| 7 | 上游 0.2.0 正式版发布时间 | 未知 | 跟踪 releases |
| 8 | 我方 `dsh-context` 的 `^0.55.0` 与 npm latest `0.59.1` 的差距是否已构成缺陷 | 本轮冻结不动（B-1） | 后续专项 |

---

## 19. 附：本计划与既有文档的关系

| 文档 | 关系 |
|---|---|
| [upstream-0.2.0-rc.1-analysis.md](upstream-0.2.0-rc.1-analysis.md) | **差异分析**（是什么变了、为什么）——本计划的事实来源 |
| 本文档 | **实施计划**（怎么做、按什么顺序、什么算完成） |
| `upstream/BASELINE` | 执行完毕后的**事实记录** |
| [../upstream/FORK-WORKFLOW.md](../upstream/FORK-WORKFLOW.md) | 分支与 merge 纪律（S1 必须遵守） |
| [plugin-dev-checklist.md](plugin-dev-checklist.md) | 插件版本线规则（S2 必须遵守） |
| [remote-workspace-route-b.md](remote-workspace-route-b.md) | 远端工作区设计（S3 的 4 个 SSH 包即其运行时前提） |

---

## 20. 执行记录（2026-09-29）

### 20.1 已完成

| 阶段 | 结果 | 证据 |
|---|---|---|
| **S0** | 清除 `qilin-upstream` remote；确认 npm 鉴权可用（`npm owner ls` 成功，`whoami` 端点受限）、`git push` 通、仓外写入按会话策略放行 | `git remote -v` 只剩 origin；fork 与 QiLin 工作树 pristine |
| **S1** | 集成分支 `kcoder/0.2.0-rc.1` @ `4cbc050fc7`（`48fd977e1e` 重放 merge + `4cbc050fc7` 扫光撤销），已推 fork | `git ls-remote origin refs/heads/kcoder/0.2.0-rc.1` |
| **S1-GATE** | `CI=true pnpm install` exit 0（pi-ai 0.87.1 补丁干净应用）、`pnpm run build` exit 0（Host/Client/Web，347 client 产物）、`pnpm run typecheck` exit 0 | 见 `upstream/BASELINE` 本轮升级记录 |
| **S2-a** | 两插件 peer 改 `>=0.1.7-rc.2 <1.0.0`；devDeps 对齐 0.2.0-rc.1；版本 1.0.35 / 1.0.11；各自 `tsc --noEmit` exit 0 | `dsh-coding-sidebar@dd7bc4d`、`dsh-file-review-kcoder@8b8ac2c` |
| **S2-a 特征** | **侧边栏附带新需求：任务计划递归扫描次级目录**（`PLAN_SCAN_MAX_DEPTH=6` + 跳过 `node_modules` + 不跟随符号链接）；夹具按仓内文档用 tsc 重生成，断言由「嵌套应被忽略」改写为「递归收录」 | `321334a`；`tests/run-openpath-tests.mjs` ALL PASS；`check:contract` / `check:artifacts`（178 文件字节不变）/ `smoke` 全过 |
| **S2-a 发布** | GitHub：`main` + tag `v1.0.35` / `v1.0.11` + Release 页；**npm 未发布（按用户要求由用户自行发布）** | github.com/kkutysllb/dsh-coding-sidebar/releases/tag/v1.0.35 等 |
| **S2-b** | `dsh-plugins` 镜像更新并推送（只提交本次两个插件目录，避开他人在途的 `dsh-video-generator`）；KCoder `bundle/` 同步（`--check` 零差异）；`bundle/dsh-ssh-remote` 随镜像 0.1.2 → 0.1.3 | `dsh-plugins@2a3c269`；`check-bundle-version-line.mjs` 通过 |
| **S3** | 6 处版本字面量 + `PRESET_PLUGINS` 平移 + 新增 schedule bundle 选中 + 策略层四项改动 + 运行态锚点切换 | KCoder `2276e2f`（19 文件），已推 `kkutysllb/KCoder` |
| **S4 预装** | `~/.kcoder-dev/profiles/web`：两插件 1.0.35 / 1.0.11、schedule bundle 0.2.0-rc.1（含 dsh-schedule / dsh-time-context / dsh-client-ui-schedule）、4 个 SSH 包 0.2.0-rc.1；策略层按新内容写入 | §20.2 |
| **S4 P0 双验收** | **真实引擎** `DSH_HOME=~/.kcoder-dev dsh --profile web --dump-config --patch <策略层>`：exit 0、**stderr 全空**；10 行终值逐条核对通过 | §20.2 |
| **S5（部分）** | `pnpm typecheck` exit 0；`release.sh audit` exit 0；`check-bundle-version-line.mjs` 通过 | 本轮 |

### 20.2 P0 验收证据（真实引擎）

**升级前（prod `~/.kcoder`，旧插件 + 新引擎）** —— 实证了分析里的故障预测：

```
dsh: skipping profile bundle "dsh-coding-sidebar": Plugin dsh-coding-sidebar@1.0.34 is
  incompatible with dsh 0.2.0-rc.1: peerDependencies {...}. Exact-version exemption: not active.
dsh: skipping profile bundle "dsh-file-review-kcoder": Plugin dsh-file-review-kcoder@1.0.10 is
  incompatible with dsh 0.2.0-rc.1: peerDependencies {"@deepseek-ai/dsh-api-session-controller":
  "^0.1.7-alpha.1","@deepseek-ai/dsh-session":"^0.1.7-alpha.1"}. Exact-version exemption: not active.
```

注意是 **skipping profile bundle**（整个 bundle 被跳过）且**只是 warning、进程照常** —— 与分析结论一致（不崩、静默失效）。

**升级后（dev `~/.kcoder-dev`，新插件 + 新策略层）** —— stderr 全空，组合结果逐行核对：

| 行 | 终值 | 对应决策 |
|---|---|---|
| `time-context` / `schedule` / `ui-schedule` | 由 schedule bundle 插入，**无 `disabled`** | P0-2 / D4 |
| `session-log-deepseek` | `enabled: false` | D2 |
| `ui-settings-session-log` | `disabled: true` | D2.1 |
| `desktop-product-telemetry` / `product-analytics` | `disabled: true` | D3 |
| `ui-sidebar-terminal` / `ui-sidebar-browser` / `ui-deliverables` | `true` / `false` / `tailCard: false` | 不变 |

### 20.3 未完成 / 交接项

| # | 项 | 状态 | 说明 |
|---|---|---|---|
| 1 | **npm 发布** `dsh-coding-sidebar@1.0.35` / `dsh-file-review-kcoder@1.0.11` | **留给用户**（明确要求） | 未发布前 `PRESET_PLUGINS` 的 `^1.0.35` / `^1.0.11` 在 registry 上无解，新装 profile 会解析失败；dev 实例已本地预置种子，可用 |
| 2 | **prod 实例 `~/.kcoder` 当前处于「侧边栏/审查被跳过」状态** | 待第 1 项 | 其插件仍是 1.0.34 / 1.0.10 而引擎已是 0.2.0-rc.1；npm 发布后启动一次即由宿主自愈装上新版（或按 dev 的做法手工预置） |
| 3 | **`patchgate` 红（既有债务，非本次引入）** | 阻塞发布仪式 | prod profile 的 `dsh-context` 已漂到 **0.59.2**（清单里即 `^0.59.2`），而补丁键仍是 `dsh-context@0.55.0.patch` → 需按 `update-profile-plugins.mjs --check` 的指引逐 hunk 取证后重出 patch 并改名。本轮按 B-1 冻结 `dsh-context` |
| 4 | `release.sh build` / `verify`（打包 + 签名 + 公证） | 未跑 | 需 Apple 凭据与长时间，且应在 npm 发布之后 |
| 5 | §16 C.4 十项人工回归 | 留给用户 | 待验证 |
| 6 | `release/v0.6.19.md`、`release/audit-v0.6.19.md`、版本 bump | 未做 | 发布仪式阶段，等用户验证通过 |
| 7 | 上游自测泳道（`packages/client` + `core` + `llm`） | **结果丢失** | 该后台任务随会话中断丢失，未取证；本仓 pre-push 门（typecheck，含 `tsc -b tsconfig.client.json`）已绿。如需补证可重跑 |
| 8 | **GUI 冒烟 10 支已跑 10 支**（S5 §10.1） | **7 过 / 3 既有失败** | 过：settings-anchors（10/10，含判别力自检）、brand-badge、sidebar-toggle、mcp-dom、context-tab、workspace-header、account-chip。三个既有失败与升级无关（`git diff 2e762f5..HEAD` 对涉事文件均为空）：① panel-buttons——`SHIFT_JS` 平移清单（panel-buttons.ts:46-48）**从未包含** `__dsh_kc_git_btn`，第四钮恒为 108px；②③ skills-dom / skills-page——skills-settings.ts:77 的 `var MEDIA = ${JSON.stringify(MEDIA_MODEL_GROUPS)}` 是**构建期插值**，而冒烟按「原文即可执行」提取 PAGE_JS 源文本直接 eval，裸文本里 `MEDIA_MODEL_GROUPS` 即未定义引用，抛错后 Electron 不退出（表现为挂起）。三支均为待修的既有技术债 |

