# KCoder 上游基线升级实施计划：`0.2.0-rc.2` → `0.2.1-alpha.1`

> **计划状态：执行中（2026-10-04）。S1 / S2.1 / S2.2 / S3 已完成；S4–S6 未开始。**
> 进度与逐条证据见工作态计划 [plans/upgrade-0.2.1-alpha.1.md](../plans/upgrade-0.2.1-alpha.1.md)。
> S1 结果：fork `kcoder/0.2.1-alpha.1` = `161c7122f6`（已推 origin），S1-GATE A–G 全过；
> 上游泳道 12569 通过 / 2 红，**两红已用纯净上游 worktree 实证为上游既有问题**（非本次引入）。
> S3 结果：`upstream/BASELINE` 钉版 → `5badb15009…`（914 → 987 行，含本段升级记录）；
> 分支名 5 处平移归零；调度组合包退役（声明摘除 + 入 `RETIRED_PRESETS`，表内真实键只剩
> `dsh-coding-sidebar`）；`DS_HOST_PEER_FALLBACK` 清两个陈旧条目（`dsh-invariants` /
> `dsh-client-runtime`）；**S3-5 判定无需动作**（4 个 SSH provider 由
> `materialize-peers` 的 `engineTrainVersion()` 自动对齐引擎线，不在声明面）；
> **S3-8 锚点复核零改动**（承载锚点的 9 个文件区间内未变；AppFrame 新增 `shell.bottom`
> 行改 `grid-template-rows` 而**列数未改** ⇒ 侧栏折叠与样式覆写判据均成立）；
> S3-9 12 支冒烟对已退役名 0 命中；S3-10（release 文档）按计划归入 S6。
> 门禁：`pnpm run check` exit 0、`smoke:style-overlay` 18/18。
> 版本：v1（2026-10-04 定稿）。**KCoder 目标版本 `0.6.24`**（单锚定 `0.2.1-alpha.1`）。
> 依据：[upstream-0.2.1-alpha.1-analysis.md](upstream-0.2.1-alpha.1-analysis.md)（差异分析，五路取证）
> 事实基线：官方 prerelease `dsh-v0.2.1-alpha.1` 已发布（2026-10-03）；npm 侧 `dsh-schedule`/`dsh-tool-schedule`/4 个 SSH 包/`dsh-base`/`dsh-web-app` 均有 `0.2.1-alpha.1`（已 `npm view` 实查）；**0.2.1 正式版未发布**。

| 项 | 当前值（起点） | 目标值 |
|---|---|---|
| 上游基线 | `639ed01539` = `dsh-v0.2.0-rc.2` | `5badb15009ae1756c3afe0ae0cef1faafc290ccc` = `dsh-v0.2.1-alpha.1` |
| fork 集成分支 | `kcoder/0.2.0-rc.2` @ `b428f93a79` | **新建** `kcoder/0.2.1-alpha.1`（rc.2 分支保留为回滚锚） |
| fork `master` | 已 = `5badb15009` | 无需动作（若 origin 落后则 ff 推送） |
| KCoder | `main` @ `a542b1e`，版本 `0.6.23` | 版本 → `0.6.24`，main 追加本段提交 |
| 差分量级 | — | **266 提交 / 4190 文件 / +51032 −32761**；我方偏离 61 文件 ∩ 区间 = **15 重叠 / 3 硬冲突** |
| 内置插件线 | sidebar 1.0.36 物化（真源 1.0.38）、terminal 1.2.1、ssh-remote 0.1.3、skills-bundle 1.0.3、shell-prefs 1.0.1 | sidebar 1.0.38、**terminal 1.2.2**、**ssh-remote 0.1.4**、其余不动 |

---

## 0. 执行摘要

### 0.1 关键路径

```
S0 冻结与决策（澄清卡回收）
      │
      ├─► S1 fork 集成分支重建（整支 merge 重放 + 3 冲突 + 三绿 + 推送）   ← 关键路径
      │
      ├─► S2 插件线（peer 口径加宽 → 两件内置重发 → 物化/版本线同步）      ← 与 S1 并行（不依赖 fork）
      │                                                                      │
      └──────────────────────────────► S3 KCoder 宿主侧（字面量/声明/注释）─┘
                                            │
                                            ▼
                                   S4 物化 + dev 预装 + 启动验收（P0-1/P0-2 判据）
                                            │
                                            ▼
                                   S5 回归（B5 样式 → 冲突面 → 家族 → 冒烟）
                                            │
                                            ▼
                                   S6 发布 v0.6.24
```

### 0.2 两个硬阻断（P0，必须先做）

| # | 阻断 | 解法 | 验收 |
|---|---|---|---|
| **P0-1** | **调度组合包被上游退役，我方仍在钉它**：`desktop/main/preset-plugins.ts:122` 精确钉 `@deepseek-ai/dsh-experimental-schedule-bundle@0.2.0-rc.2`，而上游新增 `RETIRED_BUNDLES`（`packages/boot/app-boot/src/profile.ts:206-210` + `:667-674` + 入口 `:738`）**每次加载都把它从 profile 摘除并回写 manifest** → 与 KCoder 宿主的写入互搏（启动震荡）+ 持续安装停产包 | 删除该行 + 把该名加入 `RETIRED_PRESETS` 三清（deps / bundles 层叠 / node_modules 实体）；`product-policy.ts:48-52` 的注释结论保留 | 连续两次启动后 `dsh.profile.bundles` **稳定**且不含该名；插件页无异常条目 |
| **P0-2** | **两个内置 bundle 的引擎 peer 上界把新引擎挡在门外**：`@kkutysllb/dsh-terminal@1.2.1` 与 `dsh-ssh-remote@0.1.3` 的 peer 为 `…<0.2.0`，`0.2.1-alpha.1` **不满足**（semver 实测）→ 组合包兼容闸门（`profile.ts:753-757`）整个跳过该 bundle → **内置终端与 SSH 远程静默消失** | 两插件 peer 上界改 `<1.0.0` → 升版本（terminal 1.2.2 / ssh-remote 0.1.4）→ 发 npm → 同步 `bundle/` + `PRESET_PLUGINS` | stderr **无** `skipping profile bundle`；内置终端可开；SSH 远程主机可解析 |

### 0.3 与 rc.2 那轮相比的减负（分析文 §0.3 的工程含义）

- **技能线、MCP 线、终端线（插件侧）、产品策略层、slot 契约、启动 CLI、pi-ai 线**：全部零改动或仅加法；
- **7 个 upstream patch 无一需要 rebase**；pi-ai 分歧消失（上游未升版）；
- **槽位只增不减**（191→193，+`shell.bottom`/`plugins.add.actions`，0 删除）；
- **锚点面全存活**（`[data-chat-running]`、`'Deep diving'`、`EmptyHero` 系、`icons/index.tsx` 逐字节未变）；
- 我方 61 偏离文件中 **46 个**上游完全未动。

---

## 1. 目标与验收定义（DoD）

1. fork 上存在 `kcoder/0.2.1-alpha.1`，历史含 `639ed01539` **与** `5badb15009`，已推 origin；`kcoder/0.2.0-rc.2` 保留。
2. `upstream/BASELINE` 首个非注释行 = `5badb15009ae1756c3afe0ae0cef1faafc290ccc`（现位于 `:401`），并追加本段升级记录注释块。
3. `grep -rn 'kcoder/0\.2\.0-rc\.2' desktop/ scripts/` **零命中**（`D/dsh-contract.ts:54,61`、`scripts/setup.sh:16`、`scripts/release.sh:132,136,137` 全部平移）。
4. **P0-1 落地**：`desktop/main/preset-plugins.ts` 不再声明调度组合包，且该名在 `RETIRED_PRESETS` 中；连续两次启动后 profile manifest 稳定。
5. **P0-2 落地**：`bundle/dsh-terminal` 与 `bundle/dsh-ssh-remote` 的引擎 peer 上界 = `<1.0.0`，版本分别 ≥ 1.2.2 / ≥ 0.1.4，且已发 npm 并在 `PRESET_PLUGINS`/bundle 物化同线。
6. **启动验收（P0 判据，分析文 §5.3）**：真实起服 →
   - stderr **无** `skipping profile bundle`、**无** `disabling profile plugin row`；
   - stdout 出现 ready 行（`dsh web: http://`）；
   - `--dump-config` 下 `schedule`/`ui-schedule` 两行在位（现由 web-app 原生提供）、`time-context` 属 preset 层；
   - 策略层七行覆写终值正确（与 rc.2 轮同一张表，逐行核对）。
7. **功能在位**：内置终端可开、SSH 远程工作区可解析、侧栏「任务计划」可用、侧栏插件入口与设置页插件管理并存。
8. **B5 样式回归通过**：插件页停用→再启用任一内置插件后，其他插件样式与 `style-overlay.ts` 的主题覆写层均完好（无需刷新）。
9. fork：`CI=true pnpm install` / `pnpm run build`（整链） / `pnpm run typecheck` **三绿**；集合断言 61 = 61（`comm -3` 为空）。
10. KCoder：`pnpm typecheck` + `release.sh audit` + `release.sh prepush` + `check-bundle-version-line.mjs` 全绿。
11. `release/v0.6.24.md` + `release/audit-v0.6.24.md` 落盘（含能力变化：调度改 Web 内置、invariant 诊断面移除、两插件 peer 口径）。

---

## 2. 决策记录

### 2.1 承接既有决议（继续有效）

| # | 决议 | 本段的体现 |
|---|---|---|
| D-old-1 | 产品策略层固定七行覆写（会话日志强制关 / 终端行禁用 / 浏览器放开 / tailCard 恢复 / 遥测两行禁用） | **七个 id 全部存活，YAML 零改动**（分析文 §6.5） |
| D-old-2 | 自研插件 peer 用范围口径 `>=<下界> <1.0.0` | 本段把这条**扩成家族级规则**（terminal/ssh-remote 原先用 `<0.2.0`，是历史遗留，本次必须纠正） |
| D-old-3 | file-review 已退役 | profile 里该行由既有三清自愈回收，本轮无需动作 |
| D-old-4 | 集成分支整支 merge 重放（非 rebase） | 本段沿用（冲突仅 3，rebase 无收益） |
| D-old-5 | 侧边栏物化跟随真源 + preset 范围钉 | 本段执行（1.0.36 → **1.0.38**，声明 `^1.0.36` → `^1.0.38`）——这正是上一轮挂起未执行的那条 |

### 2.2 决策记录（澄清卡已回收，2026-10-04）

| # | 决策点 | 决议 | 影响 |
|---|---|---|---|
| **D1** | 版本号 | ✅ **`0.6.24` 单锚定 `0.2.1-alpha.1`** | rc.2 段已随 0.6.23 发布，无需双锚定 |
| **D2** | 调度组合包处置 | ✅ **删 `preset-plugins.ts:122` + 把该名加入 `RETIRED_PRESETS` 三清** | 与上游自愈同向；老 profile 的 deps/层叠/实体自动回收（P0-1 解法） |
| **D3** | 插件 peer 口径范围 | ✅ **两件内置必修 + 家族三件（`dsh-animations`/`dsh-super-ppts`/`dsh-video-generator`）同批** | 口径一次立清；S2 工作量从 2 件扩到 5 件 |
| **D4** | 侧边栏插件版本 | ✅ **物化 1.0.38 + 声明 `^1.0.38`** | 兑现 1.0.37（后台作业输出）+ 1.0.38（页签标题 i18n），共 43 文件/+3714−278 |
| **D5** | invariant 死声明清理时机 | ✅ **并入 1.0.39 同批**：删 `./invariant` export / `files` 条目 / devDep / `src/invariant.ts` / `lib/invariant.js` / `context-types.ts` 镜像面；`desktop/main/plugins.ts:66` 的删行**本次必做**（宿主侧） | 插件仓对新引擎 `tsc` 不再失败 |
| **D6** | 是否启用新能力 | ✅ 暂不启用 `--public-url`（A5）与可选开发者工具包（A6）；登记为后续评估项 | 本轮范围外 |
| **D7** | `dsh-client-runtime` 这条**既有**陈旧条目 | ✅ 顺手一并从 `DS_HOST_PEER_FALLBACK` 删除 | 低风险清理，与 D5 的宿主侧删行同批 |

---

## 3. 硬性边界

| # | 禁止 | 理由 |
|---|---|---|
| B-1 | 不手改 `pnpm-lock.yaml` 合并结果（必须以上游锁为底回填我方哈希与链接，**不得删锁全量重解**） | rc.2 轮有 zod 双实例教训 |
| B-2 | 不在集成分支上裸提交（一切改动走 merge 重放 + 独立修复提交） | `upstream/FORK-WORKFLOW.md` 规则 4 |
| B-3 | 不删 `kcoder/0.2.0-rc.2`（回滚锚） | 规则 7 |
| B-4 | 不污染 fork `master`（它镜像上游） | 同上 |
| B-5 | 不改上游源码语义（除既有 7 个补丁） | 同上 |
| B-6 | S1-GATE 未过不动 KCoder 声明 | 顺序纪律 |
| B-7 | 不绕过 pre-push / 不用 `--no-verify` | 同上 |
| B-8 | **不在 peer 修复未落地时启动新引擎**（会得到"静默缺能力"的假象） | P0-2 |

---

## 4. WBS 与排期

| 阶段 | 内容 | 前置 | 估时 | 并行 |
|---|---|---|---|---|
| **S0** | 冻结与决策（澄清卡回收） | — | 0.25d | — |
| **S1** | fork：建 `kcoder/0.2.1-alpha.1` + 整支 merge 重放 + 3 冲突处置 + 三绿 + 推送 | S0 | 1.0–1.5d | 关键路径 |
| **S2** | 插件线：peer 加宽 → 两件（+家族）重发 → 物化/版本线同步 + invariant 死声明清理 | S0 | 0.5–1.0d | 与 S1 并行 |
| **S3** | KCoder 宿主侧：BASELINE / 分支名 / preset 声明 / 陈旧名单 / 注释 | S1-GATE | 0.5d | — |
| **S4** | dev profile 物化 + 预装 + **启动验收（P0-1/P0-2 判据）** | S2、S3 | 0.5d | — |
| **S5** | 回归（B5 样式首条 → 冲突面 → 家族 → 冒烟） | S4 | 0.5–1.0d | — |
| **S6** | 发布（`prepush` → `build` → `verify` → `ship 0.6.24`） | S5 | 0.5d | — |
| | **合计** | | **3.75–5.25 人日** | 关键路径 ≈ 3–4d |

---

## 5. 阶段 S1：fork 集成分支重建

### 5.1 建分支与重放

```bash
cd /Users/libing/kk_Projects/deepseek-harness
git fetch origin && git fetch upstream --tags
git log --oneline -1 upstream/master                 # 期望 = 5badb15009
git checkout -b kcoder/0.2.1-alpha.1 5badb15009ae1756c3afe0ae0cef1faafc290ccc
git merge --no-ff kcoder/0.2.0-rc.2                  # 整支重放（merge-base = 639ed01539）
```

### 5.2 冲突与处置规则（已用 `git merge-tree --write-tree` 预演，树 `40dec8f192`，exit 1）

| 类别 | 文件 | 规则 |
|---|---|---|
| **硬冲突 1** | `packages/client/ui-plugin-manager/src/client/index.ts` | 保留我方 `children: pageChildren`；把上游新增子槽键 `'plugins.add.actions': {kind:'list',scope:'root'}` **加进 `pageChildren`**；保留上游新增类型导出 `PluginAddActionsProps`；`rendersExistingChildren` 分支不改 |
| **硬冲突 2** | `packages/workspace/workspace/package.json` | peer/dev 两处**保留 `dsh-fs`**（`dsh-shell` 在冲突区外自动保留）、**丢弃 `dsh-invariants`**；上游的 `version` 戳 / 删 `./invariant` 导出 / `files` 删 `lib/invariant.js` **已自动采纳**（复核确认） |
| **硬冲突 3** | `pnpm-lock.yaml` | 以上游锁为底，回填 (a) pi-ai 补丁哈希 `8d2124eb…`（**勿被 `b9bcce47…` 覆盖**）(b) `dsh-fs`/`dsh-shell` 链接；再 `CI=true pnpm install --no-frozen-lockfile` |
| 可能冲突 | `packages/session/session-projection-cache/README.i18n.yaml` | 内容派生哈希 → 跑 `pnpm run verify-translation-pairing`；不一致则 `--write` 重录 |
| 真代码冲突（我方未改但需复核语义） | `packages/llm/llm/src/index.ts`（删 `INVARIANT` 重抛）、`packages/client/ui-chat/src/client/apply.ts`（dock 双注册）、`packages/bundle/web-app/src/index.ts`（`publicUrl` 穿透 `apply()`） | 取上游结构 + 保留我方语义（`kittyProtocolFallbacks` 类的前例做法） |
| 版本戳类 | 其余 10 个重叠文件（`package.json`/README） | 取上游 |

> 参考：`git diff --name-only 40dec8f192 5badb15009 | wc -l` = **61**，与我方清单 `comm -3` 为空 ⇒ 试算树上已达成理想签名。

### 5.3 S1-GATE（逐条可执行）

```bash
# A 结构
git merge-base --is-ancestor 639ed01539 HEAD && git merge-base --is-ancestor 5badb15009 HEAD
git status --porcelain                                   # 空

# B 三绿
CI=true pnpm install ; pnpm run build ; pnpm run typecheck          # 均 exit 0（build 走整链，禁止拆补跑）
test -d apps/web/dist

# C 补丁存活（7 份，无 0.84.3）
ls patches/ | wc -l
grep -c openai-codex-responses.js patches/@earendil-works__pi-ai@0.87.1.patch
grep -q codexProtocolFallbacks packages/llm/llm-pi-ai/src/adapter.ts
grep -q x-opencode-session   packages/llm/llm-pi-ai/src/adapter.ts
grep -q sanitizeModelMarkdown packages/client/ui-primitives/src/**/parse.ts
grep -q rendersExistingChildren packages/client/ui-slots/src/index.ts
grep -q editUserMessage packages/client/ui-chat/src/client/apply.ts
grep -c "pi-ai@0.87.1': 8d2124eb" pnpm-lock.yaml         # =1（本区间唯一真风险点）

# D invariants 面清零
git ls-tree -r HEAD packages/runtime-diagnostics/ | wc -l                       # 0
git grep -c dsh-invariants -- 'packages/*/*/package.json'                        # 0

# E 集合断言
comm -3 <(git diff --name-only dsh-v0.2.0-rc.2 kcoder/0.2.0-rc.2 | sort) <(git diff --name-only HEAD 5badb15009 | sort)   # 空

# F 上游自测泳道（前台跑完，不挂后台）
npx vitest run packages/client packages/core packages/llm
pnpm run verify-translation-pairing ; pnpm run verify-package-dependencies

# G 推送
git push -u origin kcoder/0.2.1-alpha.1
```

---

## 6. 阶段 S2：插件线（本次真正的代码工作）

### 6.1 peer 口径加宽（P0-2）

| 插件 | 现在 | 改为 | 版本 | 发布 |
|---|---|---|---|---|
| `dsh-terminal`（`@kkutysllb/dsh-terminal`） | `@deepseek-ai/dsh` / `dsh-host-webserver`: `>=0.1.6-alpha.2 <0.2.0` | `>=0.1.6-alpha.2 **<1.0.0**` | 1.2.1 → **1.2.2** | npm + 镜像 + bundle |
| `dsh-ssh-remote` | `@deepseek-ai/dsh` / `dsh-tools`: `>=0.1.0-rc.5 <0.2.0` | `>=0.1.0-rc.5 **<1.0.0**` | 0.1.3 → **0.1.4** | 同上 |
| （D3 家族）`dsh-animations` / `dsh-super-ppts` / `dsh-video-generator` | 各自 `…<0.2.0`（后者 `…<0.2.0 \|\| >=3.0.0 <4.0.0`） | 同上口径 | 各自 +1 patch | 按 D3 决定 |

同步动作：`bundle/*`（`sync-bundles.mjs`）→ `desktop/main/preset-plugins.ts` 的 `PRESET_PLUGINS` 范围钉 → `check-bundle-version-line.mjs` 通过。

### 6.2 侧边栏版本线（D4）

`bundle/dsh-coding-sidebar` 物化 1.0.36 → **1.0.38**（真源 `ca48ad0`，含 1.0.37 后台作业输出 + 1.0.38 页签标题 i18n）；`preset-plugins.ts:186` 声明 `^1.0.36` → `^1.0.38`。

### 6.3 invariant 死声明清理（D5）

| 位置 | 动作 |
|---|---|
| 真源 `dsh-coding-sidebar`（1.0.39） | 删 `package.json` 的 `exports["./invariant"]`、`files` 里的 `lib/invariant.js`、`devDependencies["@deepseek-ai/dsh-invariants"]`；删 `src/invariant.ts`、`lib/invariant.js`、`lib/types/invariant.d.ts`；删 `src/context-types.ts` 的 `invariants` 服务镜像面（`:662`、`:775-776`） |
| KCoder `desktop/main/plugins.ts:66` | 删 `@deepseek-ai/dsh-invariants`（连同 D7 的 `dsh-client-runtime`） |
| 复核 | `grep -rn invariant desktop/ bundle/*/package.json` 后仅剩注释性说明 |

> 依据：官方升级指南 `docs/upgrade-guide/v0.2.0-rc.2/remove-runtime-invariants/guide.zh.md` 迁移步骤 1/3；**运行期零影响**（该 companion 从不被 mount）。

### 6.4 复核（零改动项，仅留证）

技能线（`packages/skill/**` src 未变）、MCP 线（`packages/mcp/**` src 未变）、`dsh-shell-prefs`（`ui-theme/src` 树 SHA 同值）、`dsh-skills-bundle`（无引擎 peer）。

---

## 7. 阶段 S3：KCoder 宿主侧

| # | 文件 | 动作 |
|---|---|---|
| S3-1 | `upstream/BASELINE`（` :401` 首行） | → `5badb15009ae1756c3afe0ae0cef1faafc290ccc`；尾追本段升级记录（P0-1/P0-2 根因 + 官方 4 份指南 + 证据） |
| S3-2 | `scripts/setup.sh:16`、`scripts/release.sh:132,136,137`、`desktop/main/dsh-contract.ts:54,61` | `kcoder/0.2.0-rc.2` → `kcoder/0.2.1-alpha.1` |
| S3-3 | `desktop/main/preset-plugins.ts:122` + `RETIRED_PRESETS`（`:261`） | **删调度组合包行 + 入退役三清**（P0-1）；`:105-121` 注释改写为"已随上游 Web 内置化退役" |
| S3-4 | `desktop/main/preset-plugins.ts:186` | `^1.0.36` → `^1.0.38`（D4） |
| S3-5 | `desktop/main/preset-plugins.ts:216-219` | 4 个 SSH 包随引擎线平移（若走 npm 声明）；bundle 侧由 S2 物化 |
| S3-6 | `desktop/main/plugins.ts:66` | 删 `@deepseek-ai/dsh-invariants`（+ `dsh-client-runtime`，D7） |
| S3-7 | `desktop/main/product-policy.ts:48-52` | 注释结论保留；补一句"上游已把 schedule/ui-schedule 内置进 web-app"（与 S3-3 同批） |
| S3-8 | `desktop/main/style-overlay.ts:22,160` | 复核 `ui-plugin-manager` 页锚点（A2/C2/C5 重构后 DOM 变化）→ 必要时更新选择器（**不改语义**） |
| S3-9 | `scripts/smoke-*.mjs` | 复核与组合包/schedule 相关的冒烟（`smoke-runtime`、`smoke-settings-anchors`、`smoke-panel-buttons`） |
| S3-10 | `release/v0.6.24.md` / `release/audit-v0.6.24.md` | 新建（能力变化 + 审计证据） |

---

## 8. 阶段 S4：物化 + dev 预装 + 启动验收

| # | 动作 | 判据 |
|---|---|---|
| S4-1 | dev profile 清单：移除调度组合包；插件实体按 S2 新版本（P0-1/P0-2 落地后） | `dsh.profile.bundles` 不含退役名 |
| S4-2 | `pnpm install --no-frozen-lockfile`（profile 侧） | exit 0，无 ERESOLVE |
| S4-3 | 实装核验 | `dsh-terminal ≥1.2.2`、`dsh-ssh-remote ≥0.1.4`、`dsh-coding-sidebar ≥1.0.38`、`dsh-skills-bundle 1.0.3`、`dsh-shell-prefs 1.0.1` 逐包 version 断言 |
| S4-4 | **启动验收** | 分析文 §5.3 五条（stderr 两句不出现 / ready 行 / bundles 稳定 / 三功能在位 / `--dump-config` 组合正确） |
| S4-5 | 策略层终值核验 | 七行覆写逐行比对（与 rc.2 同一张表） |
| S4-6 | 连续启动两次 | manifest 稳定（P0-1 的震荡消失） |

---

## 9. 阶段 S5：回归

| 顺序 | 门 | 命令/动作 | 重点 |
|---|---|---|---|
| 1 | **B5 样式归属** | 桌面端：插件页停用→再启用内置插件 | 其他插件样式 + `style-overlay.ts` 覆写层均完好（本次最高风险实测项） |
| 2 | 冲突面语义 | 手工 | `ui-plugin-manager` 页（新增子槽键/来源段/版本提示文案）、`ui-chat/apply.ts`（dock 双注册）、`web-app/index.ts`（`publicUrl` + 我方 `windowsHide`） |
| 3 | 侧栏客户端半 | 实际使用 | 页签/任务计划/explorer 插入引用（`conversation-draft.ts` 的 `getSnapshot().draft` + `setDraft`）在新 `InputState`（仍为 string）与新增 `persistDraft()` 下正常；`bindDraftMirror→bindDraftPersistence` 我方未实现该 inject 面（已核零命中） |
| 4 | 家族插件 | 各装一遍 | 启停、样式、锚点（D3 范围） |
| 5 | KCoder 门 | `pnpm typecheck` / `release.sh audit` / `release.sh prepush` / `check-bundle-version-line.mjs` | 全绿 |
| 6 | GUI 冒烟 | 11 支全跑 | 已知 3 支既有失败（panel-buttons / skills-dom / skills-page）定性不变；`settings-anchors`、`brand-badge` 必须过 |
| 7 | 真实会话 | 手工 | 终端、SSH 远程、任务计划、侧栏插件入口、设置页插件管理、品牌文案 |

**观察项（不阻塞）**：`boot/hmr` 新增原生 addon `node-addon-require-builtin@^0.1.6`（monkey-patch Node 内部）在 Electron 44 下的加载；我方不使用 HMR 目录监听，但要确认随引擎物化的闭包能正常解析该 addon。

---

## 10. 阶段 S6：发布

1. `bash scripts/release.sh audit` → 写 `release/audit-v0.6.24.md`
2. `bash scripts/release.sh prepush`（含 patchgate / 版本线 / 设置页锚点 / 全量构建）
3. `bash scripts/release.sh build`（+ 公证凭据）
4. `bash scripts/release.sh ship 0.6.24`（发布说明含：上游锚定 `0.2.1-alpha.1`、调度改 Web 内置、invariant 诊断面移除、两插件 peer 口径纠正、侧边栏 1.0.38）
5. CI 三平台构建 + Release 上线核验（沿用 v0.6.23 的核验方式）

---

## 11. 回滚

| 级 | 动作 | 成本 |
|---|---|---|
| R1 | S1 冲突不可解 → 弃 `kcoder/0.2.1-alpha.1`，KCoder 保持 `0.6.23`（dev 继续用 rc.2 分支） | 极低 |
| R2 | S4 启动验收不过 → dev profile 回退 rc.2 钉版 + fork 工作树回 `kcoder/0.2.0-rc.2` | 低 |
| R3 | S5 回归不过 → KCoder 工作树回 `a542b1e`；插件新版本可保留（peer 加宽对 rc.2 无害） | 中 |
| R4 | 已发布有缺陷 → 发 `0.6.25` 修复；必要时 `0.6.24` 从 Release 下架 | 高 |

> R2/R3 成立的前提：**插件 peer 加宽是向后兼容的**（`<1.0.0` 同时覆盖 `0.2.0-rc.2`），所以插件线可以在 S1 之前独立完成并单独验证。

---

## 12. 风险登记册

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R-1 | P0-2 修复遗漏（只改 bundle 未改 npm 声明，或反之） | 用户端仍静默禁用 | DoD-5 三处（bundle 实体 / npm 版本 / PRESET 声明）同线断言 |
| R-2 | B5 样式归属在新引擎下有未预期表现 | 插件启停后样式残留/丢失 | S5 第 1 项；必要时在 `style-overlay.ts` 增加重注入守卫 |
| R-3 | `pnpm-lock` 回填错误（pi-ai 补丁哈希被覆盖） | 补丁不生效 → relay 三修复丢失 | S1-GATE C8 断言；安装后 `grep` 复核 |
| R-4 | `boot/hmr` 原生 addon 在 Electron 44 加载失败 | 运行时闭包解析失败 → 启动失败 | S4 启动验收；必要时在物化层排除/锁定 |
| R-5 | 上游 alpha 版本身有回归（prerelease） | 功能异常 | 先跑 dev 全量回归再发版；保留 rc.2 回滚锚 |
| R-6 | `ui-plugin-manager` 冲突解错导致我方 settingsTab 语义丢失 | 设置页插件管理入口异常 | S5 第 2 项 + `settings.section` 冒烟 |
| R-7 | 家族 peer 修复排期过长 | 用户侧插件被静默禁用 | D3 决定同批则无此风险；否则登记于发版说明 |
| R-8 | `verify-package-dependencies` 因上游自身 catalog 仍含 `dsh-invariants` 而红 | 挡住 S1-GATE | 已在 S1-GATE 列出；若红则记录为上游遗留并在 KCoder 侧不阻塞 |

---

## 13. 澄清卡回收结果（2026-10-04，四项全部采纳推荐项）

| 卡 | 问题 | 用户决议 |
|---|---|---|
| Q1 | 调度组合包（P0-1）如何处置 | ✅ **删行 + 入 `RETIRED_PRESETS` 三清** |
| Q2 | 插件 peer 口径修复范围（P0-2） | ✅ **两件内置必修 + 家族三件同批** |
| Q3 | 侧边栏版本与 invariant 清理 | ✅ **物化 1.0.38 + 声明 `^1.0.38`；invariant 清理并入 1.0.39 同批** |
| Q4 | KCoder 版本号 | ✅ **`0.6.24` 单锚定 `0.2.1-alpha.1`** |

> **本阶段的交付物到此为止：两份文档（本计划 + 差异分析）。在你明确"开工"之前，我不会改动任何代码。**
> 开工后的第一条命令是 S2 的插件 peer 加宽（不依赖 fork，可先独立验证），同时并行启动 S1 的集成分支重建。
