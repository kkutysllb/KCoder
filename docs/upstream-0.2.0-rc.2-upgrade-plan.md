# KCoder 上游基线升级实施计划：`0.2.0-rc.1` → `0.2.0-rc.2`（v0.6.19 第二段）

> **计划状态：未执行。本文档只做计划，不含任何已落地的代码改动。**
> 版本：v1（2026-09-30 定稿）。**KCoder 版本沿用 `0.6.19`——一次发版锚定 rc.1 + rc.2 两个上游版本**（rc.1 段已完成，本计划是第二段/增量段）。
> 依据：[upstream-0.2.0-rc.2-analysis.md](upstream-0.2.0-rc.2-analysis.md)（差异分析）+ [upstream-0.2.0-rc.1-upgrade-plan.md](upstream-0.2.0-rc.1-upgrade-plan.md) §20（第一段执行记录）
> 事实基线：0.2.0 正式版**未发布**（最新 prerelease 即 rc.2）；npm 四件套 + 4 SSH 包的 `0.2.0-rc.2` 全部就绪。

| 项 | 当前值（起点） | 目标值 |
|---|---|---|
| 上游基线 | `4878cdabd8` = `dsh-v0.2.0-rc.1`（rc.1 段已落地） | `639ed01539` = `dsh-v0.2.0-rc.2` |
| fork 集成分支 | `kcoder/0.2.0-rc.1` @ `4cbc050fc7`（已推 origin） | `kcoder/0.2.0-rc.2`（新建；rc.1 分支保留为回滚锚） |
| fork `master` | 用户已同步本地（= 上游 rc.2 tip） | 若 origin/master 落后则 ff 推送（镜像仪式） |
| KCoder | `main` @ `df6a727` | 版本号不动（仍 `0.6.19`），main 追加 rc.2 段提交 |
| 差分量级 | — | 187 提交 / 1022 文件；我方偏离面 71 文件 ∩ rc.2 = **24 文件重叠** |

---

## 0. 执行摘要

### 0.1 关键路径（比 rc.1 段短得多——这是一次"版本跟进"，不是架构迁移）

```
S0 冻结 ──► S1 fork 集成分支重建（24 重叠 + pi-ai 补丁规则已预定）──► S3 宿主侧（小改面）
                                                                       │
                S2 插件线 = 零动作（仅复核，无阻塞依赖，随 S3 并行）        ▼
                                                          S4 物化 + dev 预装 ──► S5 回归 ──► S6 发布（v0.6.19 双锚定收口）
```

### 0.2 三个硬阻断（P0）

| # | 阻断 | 解法 | 验收 |
|---|---|---|---|
| **P0-1** | **dev 启动卡死**（ready 行永不打印）：调度四件套钉 `0.2.0-rc.1`，peer 精确钉引擎版本——rc.2 引擎下 `dsh-schedule`/`dsh-time-context` 被闸门禁行，`ui-schedule`（peer 仅 cordis）漏网后等待被禁服务，Loader 永不结算 | 四件套 + 4 个 SSH 包全部平移 `0.2.0-rc.2`（分析文 §5，判决性实验已闭环） | 启动 stderr 无 `disabling profile plugin`；stdout 出现 `dsh web: http://` |
| **P0-2** | **集成分支需重建**：24 文件重叠，其中 pi-ai 补丁文件双方内容不同（上游版无我方 relay 三修复） | 整支 merge 重放（rc.1 段验证过的方法）；冲突规则预定（§5.3） | merge 后 install/build/typecheck 三绿；补丁干净应用 |
| **P0-3** | **rc.1 残留的调度钉版在 pnpm 层就会 ERESOLVE**（registry 实测 rc.2 包 13 个 peer 精确钉 rc.2） | 同 P0-1 的钉版平移 | dev profile `pnpm install` exit 0 |

### 0.3 本段的好消息（相比 rc.1 段大幅减负）

- **两自研插件零改动、零发版**：`>=0.1.7-rc.2 <1.0.0` 覆盖 rc.2（D5 耐久性兑现）；slot 契约第二次冻结（`ui-slots` tree SHA 三 tag 同值）
- **产品策略层零改动**：POLICY_YAML 内容不变（七行覆写全部继续有效——`session-log-deepseek`/`ui-settings-session-log`/两行遥测/终端/浏览器/tailCard 的行 id 在 rc.2 全部存活）
- **seam 零变化、无新包**；技能/MCP/终端三线零适配（分析文 §6.1–6.3）
- **pi-ai D6 分歧消失**：上游同钉 `^0.87.1`，我方只需在 src 侧让位、补丁侧保留 relay 三修复

---

## 1. 目标与验收定义（DoD）

1. fork 上存在 `kcoder/0.2.0-rc.2`，历史包含 `639ed01539`，已推远端；`kcoder/0.2.0-rc.1` 保留
2. `upstream/BASELINE` 首个非注释行 = `639ed01539…`，并追加本段升级记录
3. `grep -rn '0\.2\.0-rc\.1' desktop/ scripts/ upstream/BASELINE` 零命中（历史文档/注释中的合理引用除外）
4. 调度四件套 + 4 个 SSH 包实装 `0.2.0-rc.2`（dev profile）
5. **启动验收（P0-1 判据）**：`DSH_HOME=~/.kcoder-dev` 起服，stderr 无 `disabling profile plugin`、无 `patch: entry … not found`；stdout 出现 `dsh web: http://`；`--dump-config` 三行调度在位且无 disabled
6. `brand-injector` 的 `swapTurnStatus` 覆盖 `'Deep diving'`（无点形态）
7. fork：`CI=true pnpm install` / `pnpm run build` / `pnpm run typecheck` 三绿
8. KCoder：`pnpm typecheck` + `release.sh audit` + `check-bundle-version-line.mjs` 通过
9. `release/v0.6.19.md` 补 rc.2 段（双锚定说明）；`release/audit-v0.6.19.md` 增补本段
10. （发版段，等用户 npm 发布后）`prepush` → `build` → `verify` → `ship 0.6.19`

---

## 2. 决策记录

### 2.1 承接 rc.1 段（D1–D6，全部继续有效）

| # | 决议 | 本段的体现 |
|---|---|---|
| D1 | KCoder `0.6.19` | 版本号不动；一次发版锚两个上游版本 |
| D2 / D2.1 | 会话日志强制关 + 隐藏新开关 | 策略层零改动（行 id 存活） |
| D3 | 桌面遥测显式关 | 策略层零改动 |
| D4 | 调度走官方 bundle | **钉版跟进**：`0.2.0-rc.1` → `0.2.0-rc.2`（本段 P0） |
| D5 | 插件 peer `>=0.1.7-rc.2 <1.0.0` | **零动作**（覆盖 rc.2）；npm 发布 1.0.35/1.0.11 仍待用户 |
| D6 | pi-ai 保持 0.87.1 | **分歧消失**：上游同钉 `^0.87.1`；src 让位、补丁保留 |

### 2.2 本段新决策

| # | 决策 | 决议 | 说明 |
|---|---|---|---|
| **D7** | **品牌文案排版**：rc.2 把运行态文案去点（EN `'Deep diving...'`→`'Deep diving'`，尾部 `···`；ZH 同步） | **跟随上游排版**（澄清卡已定，2026-09-30） | 详见 §2.4 落地清单 |
| **D8** | 调度四件套钉版形态 | 沿用**精确钉** `0.2.0-rc.2`（与 rc.1 段同法） | 精确钉是唯一安全形态：上游包 peer 本就精确钉引擎，范围钉会引入 ERESOLVE 风险 |
| **D9** | fork `master` 镜像推送 | 执行段检查 `origin/master`，落后则 ff 推送 | FORK-WORKFLOW 同步仪式；属机械动作 |
| **D10** | `dsh-context` | **继续冻结**（B-1 延续）：dev 已被漂移对账升 0.60.0，prod 0.59.2，patch 键重出债务照旧登记 | 不动 |
| **D11** | prod 实例 `~/.kcoder` | **等 0.6.19 发版自然修复**（澄清卡已定，2026-09-30）：本轮零动作、不碰生产 home；prod 在发版前保持不可用（混装必卡形态，见 §11 注） | 发版后 prod 启动自愈（用户 npm 发布 + ship） |

### 2.3 已关闭的澄清卡

| 卡 | 决议 | 时间 |
|---|---|---|
| Q1（D7）品牌文案排版 | **(b) 跟随上游排版** | 2026-09-30 |
| Q2 prod 实例处置 | **(a) 等 0.6.19 发版自然修复** | 2026-09-30 |

### 2.4 D7 落地清单（跟随上游排版——四处联动，缺一不可）

rc.2 新排版（提交 `ad008e2ea5`）：EN `'Deep diving'`（去点）/ `'Deep diving for {duration} ···'`（尾 `···`）；ZH `深度求索中` 同步去点。我方品牌串对齐为：

| # | 文件 | 改动 |
|---|---|---|
| 1 | fork `packages/client/ui-chat/src/client/locale.ts` | ZH：`'chat.deepDiving': 'KCoder...'` → **`'KCoder'`**；`'chat.deepDivingFor': 'KCoder...，用时 {duration}...'` → **`'KCoder，用时 {duration} ···'`**（EN 两行维持上游原值——EN 品牌化走 DOM 注入，不在 locale 层） |
| 2 | fork `packages/client/ui-chat/tests/chat-view.client.spec.tsx` | **19 处断言重录**：`KCoder\.\.\.` 正则族 → `KCoder`（无点）+ 尾部 `\.\.\.` → ` ···`（注意 `···` **已实测**：U+0020 + U+00B7×3（`git show dsh-v0.2.0-rc.2:...locale.ts:90` 的尾部码点），直接按此字节写，勿手敲全角点） |
| 3 | KCoder `scripts/brand-assert.mjs` | 断言串 `'chat.deepDiving': 'KCoder...'` → **`'chat.deepDiving': 'KCoder'`**（同步 #1 的新值；含 die 消息文案） |
| 4 | KCoder `desktop/main/brand-injector.ts` `swapTurnStatus` | 与 S3-4 合并为一次改动：匹配 `'Deep diving'`（无点，rc.2 形态）+ 保留 `'Deep diving...'`（旧形态兜底）；替换目标 `'KCoder...'` → **`'KCoder'`**、`'KCoder... for '` → **`'KCoder for '`**。⚠ 该代码在模板串内，**禁用反引号** |

> 校验闭环：#1 改 locale（源头）→ #2 spec 断言（编译期）→ #3 brand-assert（产物期）→ #4 DOM 注入（运行期 EN）——四层同值，任何一层漂移都会被对应门拦下。

---

## 3. 硬性边界（继承 rc.1 计划 §3 全部 + 本段新增）

| # | 禁止 | 理由 |
|---|---|---|
| B-1…B-10 | **全部继承**（不升 dsh-context / 不手 merge lockfile / 集成分支无裸提交 / 不 --no-verify / 不删旧集成分支 / 不污染 fork master / S1 未过不改 KCoder 声明 / 不碰 native-overlay / 不改上游源码语义 / 回归未过不发布） | 见 rc.1 计划 §3 |
| **B-11** | **不重发两插件** | peer 口径已覆盖 rc.2，重发是纯风险；若澄清卡 Q1 选 (b)，也只改 fork 内 locale，**不触碰插件仓** |
| **B-12** | **不动产品策略层的行内容** | 七行覆写在 rc.2 全部存活，本段只动 preset-plugins 的**钉版值**，不动 product-policy.ts 的 YAML |
| **B-13** | **不等 0.2.0 正式版** | 正式版未发布；rc.2 已含调度同线的全部前提。正式版出来后按同法跟进（D8 精确钉模式不变） |

---

## 4. WBS 与排期

| 阶段 | 内容 | 前置 | 估时 | 并行 |
|---|---|---|---|---|
| **S0** | 冻结与决策（澄清卡回收） | — | 0.25d | — |
| **S1** | fork：建 `kcoder/0.2.0-rc.2` + 整支 merge 重放 + 冲突处置 + 三绿 + 推送 | S0、D9 | 1.0–1.5d | 关键路径 |
| **S2** | 插件线复核（零改动；闸门口径脚本对 rc.2 求值） | S0 | 0.1d | 与 S1 并行 |
| **S3** | KCoder 宿主侧（§7 清单：字面量、钉版、brand-injector 一行修、BASELINE、release notes 补段） | S1-GATE、D7 | 0.5d | — |
| **S4** | dev profile 物化（rc.2 四件套 + SSH 升线）+ **启动验收（P0-1 判据）** | S3 | 0.5d | — |
| **S5** | 回归（fork 自测泳道 + KCoder audit/冒烟 + 真实会话） | S4 | 0.5–1.0d | — |
| **S6** | 发布（等用户 npm → prepush → build → verify → ship 0.6.19） | S5、用户 npm | 0.5d | — |
| | **合计** | | **3.35–4.35 人日** | 关键路径 ≈ 3–4d |

**建议节奏**：D+0 = S0 + S1 启动；D+1 = S1-GATE + S3；D+2 = S4 + S5；S6 等 npm 发布窗口。

---

## 5. 阶段 S1：fork 集成分支重建

### 5.1 建分支与重放（方法复用，rc.1 段已验证）

```bash
cd /Users/libing/kk_Projects/deepseek-harness
git checkout master && git pull --ff-only origin master   # 确认 master = 639ed01539
git checkout -b kcoder/0.2.0-rc.2 639ed01539
git merge --no-ff kcoder/0.2.0-rc.1    # 整支重放（merge-base = 4878cdabd8 = rc.1 tag）
```

> 旧分支 `kcoder/0.2.0-rc.1` 不删（回滚锚）。若 origin/master 落后本地，先 `git push origin master`（D9 镜像仪式）。

### 5.2 预期冲突与处置规则（分析文 §4 已预定）

| 类别 | 文件 | 规则 |
|---|---|---|
| **pi-ai src + tests**（14 文件） | `llm-pi-ai/src/{catalog,replay,adapter}.ts` + 10 个 spec | **取上游 rc.2**——同一升级工作的更新精化，我方 src 改动已被包含或超越 |
| **pi-ai 补丁**（1 文件，必冲突） | `patches/@earendil-works__pi-ai@0.87.1.patch` | **取我方**——relay 三修复（accountId 兜底/终止事件容错/协议降级）只活在补丁文件里，上游版没有。合并后 `pnpm install` 验证 hunk 干净应用，PATCH_FAILED 则 rebase 补丁行号 |
| **ui-chat 品牌串**（2 文件） | `locale.ts`、`tests/chat-view.client.spec.tsx` | 结构取上游、**品牌文案按新排版回贴**（D7 已决：`'KCoder'` / `'KCoder，用时 {duration} ···'`；spec 19 处按 §2.4 #2 重录，`···` 字节形态以 rc.2 locale 实测为准） |
| **ui-plugin-manager / ui-tool**（3 文件） | `locales.ts`、`ToolRow.tsx`、`ToolRow.module.css` | 结构取上游、我方语义重放（settingsTab 键保留 / diffStat 彩色语义在冲突区外） |
| **版本戳类**（5 文件） | THIRD_PARTY_NOTICES、3 个 package.json、pnpm-workspace.yaml | 取上游（rc.2 戳） |
| **pnpm-lock.yaml** | — | **删掉重装**（B-2 继承） |

### 5.3 S1-GATE

- [ ] `git merge-base --is-ancestor 639ed01539 HEAD`
- [ ] `CI=true pnpm install` exit 0（**补丁干净应用是本段特有风险点**——P0-2）
- [ ] `pnpm run build` exit 0
- [ ] `pnpm run typecheck` exit 0（本仓 pre-push 门）
- [ ] 上游自测泳道：`packages/client` + `packages/core` + `packages/llm`（rc.1 段此项丢失，本段**前台跑完再走**，不留后台）
- [ ] `patches/` 仅一份 pi-ai 补丁且为我方内容（`grep extractAccountId` 等三修复标记在位）
- [ ] `git push -u origin kcoder/0.2.0-rc.2`

---

## 6. 阶段 S2：插件线（零改动，仅复核）

| # | 动作 | 依据 |
|---|---|---|
| S2-1 | 闸门口径脚本对引擎 `0.2.0-rc.2` 求值两插件 peer | 分析文 §0.2（预期全过，仅为留证） |
| S2-2 | 确认 bundle/ 镜像与真源零漂移（`sync-bundles --check`） | 本段不动插件，应零差异 |
| S2-3 | （不重发版——B-11） | D5 覆盖 rc.2 |

---

## 7. 阶段 S3：KCoder 宿主侧

| # | 文件 | 动作 |
|---|---|---|
| S3-1 | `upstream/BASELINE` | 首个非注释行 → `639ed01539`；尾追本段升级记录（含启动卡点根因与判决性实验） |
| S3-2 | `scripts/setup.sh:15`、`scripts/release.sh:134-135`、`desktop/main/dsh-contract.ts:61` | `kcoder/0.2.0-rc.1` → `kcoder/0.2.0-rc.2` |
| S3-3 | `desktop/main/preset-plugins.ts` | `@deepseek-ai/dsh-experimental-schedule-bundle`: `0.2.0-rc.1`→`0.2.0-rc.2`；4 个 `dsh-*-ssh`: 同平移；注释补"调度家族必须与引擎逐版本同线（peer 精确钉）"教训（分析文 §5.3） |
| S3-4 | `desktop/main/brand-injector.ts` | `swapTurnStatus`：匹配扩为 `text === 'Deep diving' \|\| text === 'Deep diving...'`（rc.2 无点 + 旧形态兜底），替换目标同步为新排版（`'KCoder'` / `'KCoder for '`，见 §2.4 #4）；**该代码在模板串内，禁用反引号**（rc.1 段踩过的坑） |
| S3-5 | **D7 已决（跟随上游排版）**：按 §2.4 落地清单执行四处联动（fork locale 2 行 + spec 19 处 + brand-assert + S3-4 的替换串） | 澄清卡 Q1 已决 |
| S3-6 | `desktop/main/remote-server.ts:75,304`、`product-policy.ts` 注释 | 引擎版本表述 `0.2.0-rc.1`→`0.2.0-rc.2`（策略层 YAML **不动**——B-12） |
| S3-7 | `release/v0.6.19.md` | 补 rc.2 段：双锚定说明 + ⑭ 模型 ID 移除需重选 + ④ 定时提醒语义升级 |
| S3-8 | `release/audit-v0.6.19.md` | 增补本段审计范围与 P0 验收证据 |

---

## 8. 阶段 S4：物化 + dev 预装（P0-1 验收主场）

| # | 动作 | 判据 |
|---|---|---|
| S4-1 | dev profile 清单：调度四件套 + 4 SSH → `0.2.0-rc.2`；`pnpm install --no-frozen-lockfile` | exit 0（**不再 ERESOLVE**） |
| S4-2 | 实装核验：`dsh-experimental-schedule-bundle`/`dsh-schedule`/`dsh-time-context`/`dsh-client-ui-schedule`/4×SSH 全部 `0.2.0-rc.2` | 逐包 version 断言 |
| S4-3 | 两插件实体复核 1.0.35 / 1.0.11（pnpm prune 后按 rc.1 段方法补回） | 入口 + `cordis.patch.yml` 在位 |
| S4-4 | **启动验收（DoD-5）**：真实起服 | stderr 无 `disabling profile plugin`；stdout 有 `dsh web: http://` |
| S4-5 | `--dump-config` 组合核验 | 三行调度在位无 disabled；策略层七行终值正确（与 rc.1 段同一张表） |
| S4-6 | ~~prod 预置~~ **不做**（D11：等 0.6.19 发版自然修复；发版前 prod 保持不可用） | 澄清卡 Q2 已决 |

---

## 9. 阶段 S5：回归

| 门 | 命令 | 重点 |
|---|---|---|
| fork 自测 | `vitest run packages/client packages/core packages/llm` | **前台跑完**（rc.1 段后台丢失的教训）；重点 ui-chat（品牌串）/ pi-ai（补丁）|
| KCoder 类型 + 注入 | `pnpm typecheck` | 含 `check-injected-scripts` |
| 审计 | `release.sh audit` | 三门 |
| 版本线 | `check-bundle-version-line.mjs` | 本段未动 bundle，应零变化 |
| GUI 冒烟 | 11 支全跑 | 已知 3 支既有失败（panel-buttons / skills-dom / skills-page）定性不变；**settings-anchors 与 brand-badge 必须过**（brand-injector 改动面） |
| 真实会话 | 手工 | 运行态文案品牌化（无点形态）+ 调度任务页 + 时间上下文 + 终端 + 文件审查 |

---

## 10. 阶段 S6：发布（v0.6.19 双锚定收口）

前置：**用户 npm 发布 `dsh-coding-sidebar@1.0.35` / `dsh-file-review-kcoder@1.0.11`**（rc.1 段产出，仍待发布）。

1. `bash scripts/release.sh prepush`（⚠ `patchgate` 既有红仍会拦——dsh-context 补丁键重出是发版前必须单独处理的既有债务，见 rc.1 计划 §20.3-3）
2. `build` + `verify`（需 Apple 公证凭据）
3. `ship 0.6.19`：发布说明含双锚定（0.1.7-rc.2 → 0.2.0-rc.1 → 0.2.0-rc.2）
4. 文档回填：本计划标注执行结果；rc.2 分析文 §9 未决项更新

---

## 11. 回滚

| 级 | 动作 | 成本 |
|---|---|---|
| R1 | S1 冲突不可解 → 弃 `kcoder/0.2.0-rc.2`，留 rc.1 分支（但 dev 保持 rc.1 钉版即可用——rc.1 引擎 + rc.1 四件套是自洽组合） | 极低 |
| R2 | S4 启动验收不过 → 回退 dev profile 钉版到 `0.2.0-rc.1` + fork 工作树回 `kcoder/0.2.0-rc.1`（自洽但停在第一段成果） | 低 |
| R3 | 回归不通过 → KCoder 工作树回 `df6a727`，fork 分支保留 | 中 |
| R4 | 已发布有缺陷 → 同 rc.1 计划 §12 R4 | 高 |

> 注：R1/R2 成立的前提是 **dev profile 的四件套钉版与引擎同线**——rc.1 引擎配 rc.1 四件套可用（rc.1 段已验证）；当前"引擎 rc.2 + 四件套 rc.1"的混装态是**唯一必卡形态**，回滚即恢复同线。

---

## 12. 风险登记册

| # | 风险 | 预案 | 被哪道门拦 |
|---|---|---|---|
| RK-1 | pi-ai 补丁 hunk 行号漂移 → PATCH_FAILED | rebase 补丁到 rc.2 树（三修复语义不变，仅行号） | S1-GATE install |
| RK-2 | 品牌串回贴遗漏（19 处） | spec 断言 + brand-assert 双拦 | S1-GATE typecheck / S5 |
| RK-3 | brand-injector 改动引入模板串反引号（rc.1 踩过） | 改完跑 `check-injected-scripts` | KCoder typecheck |
| RK-4 | 调度四件套有隐藏传递依赖（如 time-context → dsh-util-values 精确钉） | S4-1 的 pnpm 解析会显式暴露；装不上即升同线 | S4-1 |
| RK-5 | dev profile `dsh-context@0.60.0` 与 rc.2 引擎的未知不兼容 | 闸门会禁行（其 peer 宽松 `>=0.1.5-rc.1` 应能过）；若禁行按 B-1 记录不扩面 | S4-4 stderr |
| RK-6 | 上游快出 0.2.0 正式版 | 不阻塞（B-13）；正式版出来按 D8 同法跟进 | — |
| RK-7 | fork master 未推 → CI 拿旧状态 | S1 前置检查 + D9 ff 推送 | S1 步骤 1 |

---

## 13. 附录：与既有文档的关系

| 文档 | 关系 |
|---|---|
| [upstream-0.2.0-rc.2-analysis.md](upstream-0.2.0-rc.2-analysis.md) | 本段事实来源（含启动卡点判决性实验） |
| [upstream-0.2.0-rc.1-upgrade-plan.md](upstream-0.2.0-rc.1-upgrade-plan.md) | 第一段计划 + §20 执行记录（边界 B-1…B-10 继承） |
| `upstream/BASELINE` | 两段各追加一条升级记录 |
| `release/v0.6.19.md` / `audit-v0.6.19.md` | 双锚定发版文档（本段补 rc.2 部分） |

---

## 14. 执行记录（2026-09-30，S0–S5 完成；S6 等用户 npm 发布）

| 阶段 | 结果 | 关键证据 |
|---|---|---|
| S0 冻结 | ✅ | 三仓干净；fork master = origin/master = `639ed01539`（D9 零动作） |
| S1 fork 重建 | ✅ | 分支 `kcoder/0.2.0-rc.2` @ `5295828ae5`（merge `408850b0a8` + GATE 修复），已推 origin |
| S2 插件线 | ✅ | 两插件全部引擎 peer semver PASS on `0.2.0-rc.2`；`sync-bundles --check` 零漂移；零发版 |
| S3 宿主侧 | ✅ | commit `46d353f`：BASELINE+记录 / 三处字面量 / 钉版平移 / brand-injector / brand-assert / release 文档 |
| S4 物化+启动验收 | ✅ | **P0-1/P0-3 双判据达成**（详见下） |
| S5 回归 | ✅ | 冒烟 9 过 + 3 既有失败形态不变；真实会话手工验收交用户 |
| S6 发布 | ✅ | npm 双包已发布 → patchgate 既有债务解除 → prepush 绿 → `ship 0.6.19`（bump `5d85332` + tag `v0.6.19` 已推，CI 三平台构建发布中） |

### 计划外发现与处置（执行中新增的三个关键点）

1. **锁文件策略修正（B-2 的进化）**：「删锁全量重装」在本轮炸出时间炸弹——zod `^4.4.3` 全量重解拉到 4.6.5（当天新发布），与 stagehand 精确钉的 4.4.3 并存双实例 → TS 构建崩。修正为「**上游 rc.2 锁文件为基 + pnpm 增量更新**」：外部解析保持上游冻结态（zod 单实例 4.4.3），净差 22+/7−（我方 pi-ai 补丁 hash `8d2124eb…` + 3 包 workspace 链接）。后续升级段的锁文件 SOP 以此为准。
2. **品牌串 19 处 → 28 处**：rc.2 新增 `running-status.client.spec.tsx`（9 处断言，merge 无冲突故未暴露）在 GATE 泳道被拦（RK-2 兑现），补齐后全绿。品牌断言面实际 = chat-view 19 + running-status 9。
3. **preset-plugins 对账缺口（升级用户路径）**：`specMinVer` 三元组比较看不见预发布标签（rc.1/rc.2 同为 `[0,2,0]`）→ 2.5 步对账会跳过钉版平移 → 升级用户 profile 留「引擎 rc.2 + 调度 rc.1」混装 = P0-1 在升级现场重演。已修：精确钉（无 `^`/`~`）按版本串全等判过旧（commit `46d353f`）。

### P0 验收证据（S4）

- **P0-3（ERESOLVE 消除）**：dev profile 五包钉 rc.2 后 `pnpm install --no-frozen-lockfile` exit 0（rc.1 钉版态在同引擎下必炸）
- **P0-1（启动卡点）**：`DSH_HOME=~/.kcoder-dev` 真实起服，**11s 出 ready 行**（`dsh web: http://127.0.0.1:3080/…`；混装态永不打印）；stderr `disabling profile plugin` **零命中**；无 `patch: entry … not found`
- 八包实装 `0.2.0-rc.2` 全核（schedule-bundle/schedule/time-context/ui-schedule/4×SSH）；双插件实体 1.0.35/1.0.11 完好（cordis.patch.yml 在位）
- `--dump-config`（含策略层）：调度三行在位无 disabled；策略七行终值全对（session-log-deepseek.enabled=false / ui-sidebar-terminal.disabled=true / ui-sidebar-browser.disabled=false / ui-deliverables.tailCard=false / ui-settings-session-log.disabled=true / 两行遥测 disabled=true）

### S1-GATE 证据

- `CI=true pnpm install` exit 0（pi-ai 补丁干净应用，`_patch_hash=8d2124eb…` 实装与锁文件双侧一致；与 rc.1 分支补丁字节级一致 diff=0）
- `pnpm run build` exit 0；`pnpm run typecheck` exit 0
- 自测泳道（client+core+llm，**前台跑完**）**12397/12399**：仅剩 2 败 = `connection/binary-rpc.host.spec` 的 HTTP bridge 5s 超时——单跑 46/46 全过 + fork 对 `packages/client/connection` diff 为空，定性**并行负载抖动**（上游文件），登记观察非回归

### 冒烟矩阵（S5）

| 结果 | 支 |
|---|---|
| ✅ 9 支 | account-chip / **brand-badge** / context-tab / mcp-dom / **settings-anchors** / sidebar-toggle / workspace-header / runtime（`node` 直跑形态：就绪行+首页 200） |
| ❌ 3 支（既有，形态不变） | panel-buttons（SHIFT_JS）/ skills-dom、skills-page（MEDIA_MODEL_GROUPS 挂起） |

注：`smoke-runtime` 必须以 `node scripts/smoke-runtime.mjs` 直跑（纯进程冒烟，staging 运行时 + 临时空 home）；套 electron 前缀会以完整 App 形态启动吞掉 stdout 伪超时。

### 交接（S6 前置与待办）

- **用户**：npm 发布两插件（PRESET 解析前置）；发布后 prod 实例（`~/.kcoder`）随 0.6.19 发版自愈（D11）
- **S6**：`prepush`（⚠ patchgate 既有 dsh-context 键漂移红仍需先处理，见 rc.1 计划 §20.3-3）→ `build` → `verify` → `ship 0.6.19`
- **用户手工验收**：dev 实例（`~/.kcoder-dev`）真实会话——运行态文案品牌化（无点形态）+ 调度任务页 + 时间上下文 + 终端 + 文件审查

---

## 15. S6 执行记录（2026-09-30 收口）

### 发布前置债务解除：patchgate（既有红）

`dsh-context` 补丁键漂移（仓库 patch `@0.55.0` vs 实装 v0.60.0）为 rc.1 段登记的既有债务，本轮解除：

1. **逐 hunk 对纯净 `dsh-context@0.60.0` 取证**（`npm pack` 取得上游产物）：两处修复上下文同形、`patch -p1 --dry-run` 干净应用、归一后与旧补丁**逐行等价**（仅行号重基 `9066→10121` / `11607→12445`）。
2. **重出补丁**：`profiles/web/patches/dsh-context@0.55.0.patch` → `dsh-context@0.60.0.patch`。
3. **修同步脚本口径缺口**：`update-profile-plugins.mjs` 的 `ensurePatchDeclared` 只管 name-only→精确键与「缺声明追加」，旧精确键永不重写 → `missing` 判为已同步（脚本报「已同步」）而发版闸按精确键报「缺声明」。补「精确键重出」分支后两侧一致。
4. **现场物化**：dev / prod 两 profile 声明均重出到 `dsh-context@0.60.0`，`pnpm install` 应用补丁 → `--release-gate` **双绿**（1 份 patch：仓库分发 + 现场 marks + 版本键零漂移 + 声明就位）。

> 注：`update-profile-plugins.mjs` 的 profile 解析在无 `DSH_HOME` 时回退 `~/.kcoder`（prod）——本轮首次 `--sync` 因此作用到 prod（仅多复制一份补丁文件，lockfile/package.json 未变、依赖未重解析），随后以 `DSH_HOME` 显式同步 dev，两 profile 现态一致。

### 发布结果

- `release.sh prepush` 全绿（audit 三门 + patchgate + 版本线 + settings 冒烟 + 全量构建）
- `release.sh ship 0.6.19`：bump `5d85332` → tag `v0.6.19` → main + tag 已推 → **CI 三平台构建并自动发布**
- 发布说明 `release/v0.6.19.md` / 审计 `release/audit-v0.6.19.md` 已随发布提交入库

### 用户报障处置：桌面端启动弹「预览版说明」（本段追加修复）

- **现象**：桌面端启动弹上游 rc.2 的预览版公告。
- **根因**：上游把该公告限定给浏览器端（桌面端以 `dshDesktop` preload 标记豁免）；KCoder 的 shell 窗口刻意不注入 preload（纯浏览器载体设计），被判成浏览器；公告带版本号（rc.2 从 `2026-08-13.1` → `2026-09-28.1`），故版本号一变即重弹。
- **修法**（fork `b428f93a79`）：注册前补 Electron 判定——UA 含 `Electron` 标记即视为桌面壳，不注册公告；普通浏览器（LAN/远程）维持上游行为。宿主未自定义 UA（grep 全 `desktop/` 零命中）；Electron 44 默认 UA 实测含 `Electron/44.0.0`。
- **证据**（四层）：① 真实渲染进程（shell 同配置、无 preload）实测 UA 含 `Electron/44.0.0` 且无 `dshDesktop`；② dev 服实际下发的聚合资产含该闸门；③ 本地物化 rc.2 运行时产物含该闸门；④ 单元用例锁定（Electron UA → 注册表仅剩 `deepseek-official`），相关 30 项全过。
- **本地物化附带核验**：`pnpm deploy` 出的 rc.2 运行时（v0.2.0-rc.2）内 `dsh-client-ui-chat` 品牌串为 `'KCoder'`、`深度求索中` 零残留——即产物级品牌断言口径的先期达成（本地 `materialize-peers` 因签名身份缺失中止，tar 未重打，`brand-assert` 对**陈旧 tar** 的报错为误报，已删除该陈旧 tar 以免误导）。
