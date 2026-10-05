# 引擎换锚可行性分析：deepseek-harness → QiLin（麒麟）—— ⛔ 全文已作废（VOID）

> **用户 2026-10-05 晚间指示：昨天（本文）「对齐麒麟引擎」的结论全部作废。**
>
> **作废原因**：改为**等麒麟本次大改版升级到 `3.1.x` 后再对齐**。届时麒麟将有
> **「通用 / 编码」两种工作台**，分别对应**右侧边栏**，内置 agent，且**用户侧安装的插件
> 将相对绑定不同的内部插件实现**——即**契约面与插件模型在 3.1.x 都会变**。本文基于麒麟
> **`3.0.10`** 的一切判断（含 §0 结论摘要、§9 风险等级、**§10 五项决策**）**均不再适用**：
> **不得引用、不得据以施工。**
>
> **作废时的实际状态**（本文下列内容仅作历史记录保留）：
> - 引擎**继续锚定 dsh**，产品线正常升级：`main` = `a7e6e65`（release **0.6.25**）。
> - `KCoder-DSH` 已**对齐到同一提交**（`ea5dee2` → `a7e6e65`），远端 `origin/KCoder-DSH` 已推送。
> - 唯一仍然成立的方向性一条：**等麒麟**——等的是 **3.1.x**，不是 3.0.10。
>
> **3.1.x 复评时必须重新回答的问题**（这三点会直接改写 §2/§3/§4 的判据）：
> 1. 「通用 / 编码」双工作台如何挂载、如何绑定右侧边栏；
> 2. 内置 agent 的预设 / roster 形态（与本文假定的 `agent-presets` 是否同形）；
> 3. 用户侧插件的安装模型——「相对绑定不同内部插件实现」的确切语义。
>
> 本文的**取证方法**（只读勘察 + 一次性 `QILIN_HOME` 真机闸门）可作为 3.1.x 复评时的
> **探针参考**；但**所有数值与结论必须重跑**，不得直接沿用。
>
> ---
>
> 以下为 2026-10-05 原文（**已作废**，仅供追溯）：
>
> 取证方式：只读勘察 + 一次性 `QILIN_HOME`（`/tmp/kcoder-gate/home`）真机闸门。
> 真用户 `~/.qilin`（323M，mtime 未变）与 KCoder / QiLin 两仓工作树全程 **0 改动**。
> 原抬头为「已定案」，并据 §10 五项拍板；**该抬头与 §10 现均已作废**。

---

## 0. 结论摘要 —— ⛔ 本节结论已作废（见文首）

| 维度 | 判定 | 依据 |
|---|---|---|
| **机制可行性** | ✅ **高（~95%）** | 真机端到端跑通：KCoder 的真实 argv 形状 + 一层覆写层，在麒麟上启动并就绪行被本仓正则原样命中 |
| **契约改动面** | ✅ **极小 —— 必改的代码只有 1 行** | 家目录取值（`dsh-contract.ts:159`）；另有 2 处需同步（profile 键、accounts 门） |
| **承重面** | ✅ **3 个确认失效 + 3 个待定** | 12 个「only-in-dsh slot」与 KCoder 无关（代码只用 4 个，全存活） |
| **前序版本隔离** | ✅ 已隔离**并推送** | `KCoder-DSH` @ `ea5dee2`（release 0.6.24）→ 已推 `origin/KCoder-DSH`（决策④） |
| **供应链** | ⚠️ 唯一实质取舍 → **已接受**（决策①） | 麒麟当前 dsh 内容天花板 = `0.2.0-rc.2`；`0.2.1-alpha.1` 在麒麟缺席且无对齐计划；取向＝**等麒麟**，不建自有 backport 清单 |

**一句话**：技术侧已无「能不能」的悬念——KCoder 与麒麟之间只隔**一行家目录**和一层身份；
真正要你接受的，是把上游供给交给麒麟的选择性移植节奏——**此项已由决策①接受**。

---

## 1. 事实基线：麒麟不是 dsh 的 fork

以下均由本机实测（`/Users/libing/kk_Projects/QiLin`，HEAD `d5f0f247ed`）：

| 检查 | 实测输出 |
|---|---|
| `git merge-base main dsh/master` | **空，exit 1** —— 零共同祖先 |
| `main` 的根提交 | **3 个互不相关**：`fcd7a5b39c` / `9df342d25c` / `f821a9e9b3` |
| `rev-list --left-right --count main...dsh/master` | `699  20470`（对称差，非 ahead/behind） |
| 唯一一次 "Merge upstream dsh-v0.1.6-alpha.2" | 第二父是一个**根提交**，非 dsh 标签对象 ⇒ 装饰性合并 |
| 内容基线 | `3083f37c3f`（2026-09-12）「以 dsh-v0.1.5-rc.2 源码作为 QiLin 3.0.0 核心基线」 |
| 麒麟已有内容的最新 dsh 标签 | **`dsh-v0.2.0-rc.2`**（`639ed01539`）；`0.2.1-alpha.1` 缺席 |
| `v3.0.10` 注解标签 | 对象 `302ff513ddf6…` → 提交 **`206a48dab3…`** |

麒麟 `plans/2026-09-30-upstream-0.2.0-rc.2-alignment.md:11` 把方法写明：
**「沿用批次法选择性移植（从上游 tag 逐块取材 + rescope 到 `@qilin`），不做裸 git merge」**；
红线六条：brand-official、账号栈、product-analytics、**全部桌面应用**、wire headers、`SESSION_FORMAT_VERSION`。

**推论**：不存在「换 fork 点」这回事。换锚 = **更换整条上游身份 + 命名空间口径**（`@deepseek-ai/` → `@qilin/`），
按批次消费，不是 rebase。

---

## 2. 现状：KCoder 目前的锚定机制

| 机制 | 事实 | 证据 |
|---|---|---|
| 钉版 | `upstream/BASELINE` 首个非注释行 = `5badb15009…`（= dsh **0.2.1-alpha.1**） | `scripts/setup.sh:45`、`scripts/release.sh:135` |
| 消费态 | fork 集成分支 **`kcoder/0.2.1-alpha.1`** | `desktop/main/dsh-contract.ts:61`、`scripts/release.sh:136-139` |
| fork 三支模型 | `master` 纯净镜像（零自有提交）/ `fix/*` 共享修复 / `<product>/<baseline>` 集成分支 | `upstream/FORK-WORKFLOW.md:12-24,47-59` |
| 发布断言 | 克隆必须在该集成分支上，且 `merge-base --is-ancestor <BASELINE_SHA>` | `scripts/release.sh:136-139` |
| 契约收敛点 | **`desktop/main/dsh-contract.ts` 自称「桌面端对这些约定的唯一引用点」** | `dsh-contract.ts:5` |
| 产品策略层 | 以 `--patch` 引入 overlay（`productPolicyArgs()`），受 `webPatch` 版本门控制 | `dsh-manager.ts:160-166` |
| 引擎载荷 | `pnpm --filter=@deepseek-ai/dsh deploy --prod --legacy` → `staging/kcoder-runtime` → tar.gz → `extraResources` | `scripts/release.sh:140-145`、`electron-builder.yml:15-16` |
| 随包插件 | `bundle/` 5 个：`dsh-coding-sidebar` / `dsh-shell-prefs` / `dsh-skills-bundle` / `dsh-ssh-remote` / `dsh-terminal` | `electron-builder.yml:24-53` |
| vendor 纯净守卫 | 防 `vendor/*` 空骨架被上游 tsdown workspace glob 当成员而炸构建 | `scripts/verify-vendor-purity.sh:1-14` |
| 版本 | `package.json` → `kcoder@0.6.24` | `package.json:2,5` |

**关键利好**：本仓的 fork 模型（纯净镜像 + 共享修复 + 每产品一条集成分支）**与麒麟自己的多产品模型同形**
（麒麟 origin 上 `ksrw/3.0.10`、`kstock/3.0.10`、`lingshu/3.0.10` 各一条）。换锚不是换范式，
**是把同一个范式换一个 hub 仓**。

---

## 3. 真机闸门结果（一次性 `QILIN_HOME`，零 install）

| 门 | 判据 | 结果 |
|---|---|---|
| G0 | `QILIN_HOME=<tmp> node apps/cli/lib/bin.js --version` | `3.0.10` rc=0；真用户 `~/.qilin` 未参与 |
| G1 | shipped `web-app/cordis.patch.yml` **不含 `label`**（由 schema 默认 `'qilin web'` 供给） | 一层 `--patch` 即可覆写成 `dsh web`（dump 第 468/474 行实证） |
| G2 | `QILIN_HOME=X DSH_HOME=诱饵` | profile 落在 `X`，**诱饵目录空** ⇒ 麒麟家目录**不读 `DSH_HOME`** |
| G3 | 真机启动 | `qilin web: http://127.0.0.1:51490/workspace?token=…`；**零 install 可起**（`profiles/web/node_modules` 不存在） |
| G4 | KCoder 代码消费的 `data-slot` | 仅 **4** 个：`conversation.session.header` 145 / `.header.actions` 39 / `settings.general.item` 87 / `settings.section` 141 —— **全存活** |
| G5 | `qilin plugin doctor` | `dsh-coding-sidebar` → `degraded`，**给出可执行修法**（补 `peerDependencies`）；SRW 的 warn 命中在 `.survey/` 噪音区 |
| G6 | `qilin plugin add link:` + 带插件启动 | 283ms、零网络；自动记账进 `dependencies` **与 `qilin.profile.bundles`**；启动零告警 |
| G7 | 浏览器闭环 | 应用面完整渲染，本页 **0 error / 0 warning**；`dsh-coding-sidebar/client.js` → **200 OK** |
| G8 | 版本门（本仓真依赖 semver 实测） | `gte('3.0.10','0.1.0-rc.8')` = **true** |
| G9 | KCoder 真实 argv 形状 + 覆写层 | `… bin.js web --patch <overlay> --port 0 --no-open` 启动成功 |

**G9 是决定性的一条**，原始输出：

```
dsh web: http://127.0.0.1:52804/workspace?token=FX5mSK3Qt7i9DIAa9FaGJ4zUKRUVDx-GGOBxa480PSs
MATCH  base=http://127.0.0.1:52804  rest=/workspace?token=FX5mSK3Qt7i9DIAa9FaGJ4zUKRUVDx-GGOBxa480PSs
=> KCoder READY_LINE_RE 命中
```

含义：`--patch` 在 `--port` 之前的**顺序要求沿用有效**；覆写层在启动时真正生效；
`READY_LINE_RE` 的组 2 本就设计为「查询尾部」，而 `dsh-manager.ts:192` 用的是
`onReady(match[1], match[1] + match[2])` ⇒ **`/workspace` 路径自动随组 2 带上，抓取器无需加宽**。

---

## 4. 契约断裂清单（已按实测收敛）

> 说明：早前勘察（含本文早期版本）曾列出「5 处断裂」，其中两处经本机实测**证伪并撤销**。

| # | 项 | 判定 | 处置 |
|---|---|---|---|
| 1 | 就绪行 label 前缀 `qilin web` | ✅ 可解 | 一层 `--patch` 覆写 `web-runtime` 行的 `label: dsh web`（注意 patch 是**整行替换 config**，需重述该行全部键）。**无需改麒麟** |
| 2 | 入口路径 `/workspace` | ✅ **证伪，非问题** | `READY_LINE_RE` 组 2 已承载；`onReady` 用 `match[1]+match[2]`。不需改抓取器 |
| 3 | 版本门 `gte(…,'0.1.0-rc.8')` | ✅ **证伪，非问题** | 实测 `true` ⇒ `--no-open` / `--patch` 照常传 |
| 4 | 家目录 | ❗ **必改（唯一必改代码行）** | `dsh-contract.ts:159` 的 `process.env.DSH_HOME ?? … ?? ~/.kcoder` 在麒麟下无效——麒麟只认 `QILIN_HOME` 并强制 `process.env.DSH_HOME = <自身 home>`。**改为设 `QILIN_HOME`**，并同步 `home-migration.ts` 语义 |
| 5 | profile 清单键 | ⚠️ 需同步 | KCoder 读/写 `dsh.profile.bundles`；麒麟读它作回退但**回写到 `qilin.profile.bundles`** 并前插 base/web-app（实测：`link:` 装插件后记账写的是 `qilin` 键）。涉及 `plugins.ts:6,108,314`、`kcoder-skills-bundle.ts:43,269`、`preset-plugins.ts:23`、`product-policy.ts:54` —— **建议双读，不写死单键** |
| 6 | 账号门（新发现） | ⚠️ 需同步 | 新 profile 默认 `accounts.enabled: true`，launch token 会被弹到落地页 `/?next=/workspace`（→ `/setup`）。token 直通需在自己 patch 层写 `accounts.enabled: false` |
| 7 | cookie 前缀 | ⚠️ 低危 | `dsh-auth-*` → `qilin-auth-*`（旧 cookie 残留） |

---

## 5. 承重面：真实伤亡 3 个，不是 12 个

KCoder **代码**只消费 4 个 `data-slot`（全存活，见 G4）。麒麟相对 dsh 缺失的 12 个 slot
（`shell.bottom` / `shell.leading` / `deliverables.file.actions` / `plugins.add.actions` /
`plugins.detail.*` / `settings.launcher` / `settings.trigger` / `sidebar.workspaces.session.*`）
在 KCoder 代码里 **零消费**——早前把它们标为「承重」是误判，**已撤回**。

真实失效清单（源码 + 现场 DOM 双重判定）：

| 锚点 | 用途 | 判定 |
|---|---|---|
| `.titleGroup` / `.previewBadge`（哈希类） | hero 品牌注入（`brand-injector.ts:307,314`） | ❌ **确认失效**（麒麟改为 `.greeting`/`.tagline`/`.watermark`） |
| `data-conversation-composer-overlay` | composer 覆层 | ❌ **确认失效** |
| `_turnStatus` / `_navTitle` / `_fileMention` | turn 状态 / 导航标题 / 文件提及 | ⏳ 待定（本页无会话，需含会话页面裁定） |

另：`dsh-coding-sidebar` 的麒麟旁路通道（`cordis.qilin.patch.yml` + `sync-to-qilin.mjs`）
在麒麟仓**当前无落点**（`vendor/coding-sidebar` 于 2026-09-15 引入、同日退役；政策「不 vendor」，
改为一方 `ui-sidebar-*` 包）。**但 G6/G7 证明它经兼容层仍能装、能跑、能渲染。**

---

## 6. 载荷与打包差异（换锚的实际工作量集中处）

| 项 | KCoder 现状 | 麒麟侧 |
|---|---|---|
| 闭包 deploy 目标 | `pnpm --filter=@deepseek-ai/dsh deploy --prod --legacy` | `@qilin/cli`；麒麟另有 `qilin-python-runtime-closure` manifest |
| 参考实现 | —— | KStock `scripts/local/materialize-runtime-closure.mjs` 三阶段（deploy → `restoreLegacyHoists` 保证**全局单例 Cordis** → `materializeStagedLinks` 去 symlink） |
| 包管理器 | `scripts/` 内自建 | KStock 钉 **pnpm 11.7.0**（`qilin-pnpm.sh`） |
| 品牌断言 | `brand-assert.mjs` 断言 tar 内含 fork 专属 locale 与 `'chat.deepDiving': 'KCoder'` | 需重做或退役 |
| provider 断言 | `verify-runtime-providers.mjs` 断言 4 个 `@deepseek-ai/dsh-*-ssh` 随包 | 需按 `@qilin/*` 重述 |
| 上游构建坑 | `verify-vendor-purity.sh` 已被同类坑咬过 4 次 | 麒麟同源 tsdown，该守卫**建议保留** |

---

## 7. 供应链：唯一的实质取舍

| 事实 | 含义 |
|---|---|
| 麒麟当前已有 dsh 内容 = **`0.2.0-rc.2`** | 正好是 KCoder **上上次**同步前的基线 |
| KCoder 已同步到 **`0.2.1-alpha.1`**（266 提交） | 换锚 = 这批内容**暂时回退**，直到麒麟移植 0.2.1 |
| 麒麟 `plans/` 中**无 0.2.1 对齐计划** | 只能报告「计划缺席」，不能推断意图 |
| 麒麟正在升级、之后会做独立修改 | 用户判断的「版本相对稳定」来源即在此 |

**可接受性取决于产品取向**：若 KCoder 需要 0.2.1 引入的能力（如 `shell.bottom`、
`plugins.add.actions`、`settings.plugin.item` 双触点），换锚后**要等麒麟**；
若这些不是产品依赖（G4 显示当前代码**零消费**它们），则换锚的即时损失接近于零。

---

## 8. 迁移方案（建议，尚未执行任何一步）

采用 **KStock 已固化的工序**（`KStock/docs/引擎分支工作流.md`），它是本机最完整的麒麟接入先例：

| 阶段 | 动作 | 闸门 |
|---|---|---|
| M0 隔离 | ✅ **已完成**：`KCoder-DSH` @ `ea5dee2`（未推送） | `git branch -vv` 双分支并存 |
| M1 定锁 | 把 `upstream/BASELINE` 升级为 **`upstream.lock.json`**：`repo=QiLin`、`branch=kcoder/<基线>`、`commit`、`base_tag`、`base_commit=206a48da`、`version`、`patches[]` | lock 可被脚本解析；`base_commit` 是 HEAD 祖先 |
| M2 基建 | 麒麟 origin 建 `kcoder/<基线>`（= `v3.0.10` 基线 + 覆写）；`engine-bootstrap.sh` 克隆/校验/`--prune`（麒麟克隆 3.5G → prune 后源码树 ~203MB）；导出 `format-patch` + `git bundle` 双档案 | 克隆 `HEAD == lock.commit` 且跟踪文件零修改 |
| M3 契约 | 改家目录取值（`QILIN_HOME`）、profile 键双读、`accounts` 门、label 覆写层 | G1/G2/G9 三条真机判据复跑 |
| M4 载荷 | 闭包 deploy 切 `@qilin/*`；`brand-assert` / `verify-runtime-providers` 按新命名重述。**口径不变（决策③）**：仍由本仓 `pnpm --filter=… deploy --prod --legacy` 物化，**不引入** KStock 的 `materialize-runtime-closure.mjs` 三阶段（§6 仅作差异对照） | 打包后 `kcoder-runtime.tar.gz` 首启可跑 |
| M5 承重面 | 修 hero 品牌注入——**已定案（决策②）：改走麒麟开放 slot** `sidebar.brand.mark`（规格 `{kind:'single',scope:'root'}`，两引擎一致，属受支持契约），**放弃**对 `.titleGroup`/`.previewBadge` 的哈希类名 DOM 注入；`data-conversation-composer-overlay` 同批处置；裁定 3 个待定锚点 | 含会话页面的浏览器实拍 |
| M6 身份 | **版本重置 `1.0.0`（已定案，决策⑤）**；按需重命名 `dsh-*` 面 | 发布链断言全绿 |

**建议的强断言（取自 KStock 的 `verify_engine_contract.py`，13 项）**——尤其这一条：
**每补丁的 marker-still-present**（上游可能**静默吃掉**我们的定制；KStock 历史上 patches
14/15/21/22 就是这样丢的，LingShu 也有 `b5d862a` 整文件覆盖事故）。

---

## 9. 风险登记

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| R1 | 目标平台改 `--patch`/`--no-open` 语义 ⇒ 产品策略层静默失效 | 中 | 已实测通过；纳入每版闸门（启动后断言覆写行 id 在生效配置中） |
| R2 | 家目录未切 `QILIN_HOME` ⇒ 壳写 `~/.kcoder`、引擎读 `~/.qilin`，静默读空 | **高** | M3 唯一必改行 + 真机断言（G2） |
| R3 | profile 键单读 `dsh` ⇒ 插件页静默显示零层 | 中 | 双读 + 断言 |
| R4 | 麒麟缺 0.2.1 能力 ⇒ 功能诉求被上游节奏卡住 | 中 | **决策①：等麒麟**。缓解改为「维护产品依赖清单 + 版本门可观测」；某能力若成为硬阻塞，届时单独立项 backport（不预先建清单） |
| R5 | 定制补丁被上游静默吃掉 | **高** | marker-still-present 断言（KStock 先例） |
| R6 | 命名空间散点（`@deepseek-ai/*` 包名、cookie、资源 scheme） | 中 | 逐面包 `plugin doctor` 生成清单；别名表仅覆盖**装载期**，源码说明符仍需改 |
| R7 | 桌面应用被麒麟红线排除 | 低 | 桌面壳本就是我们自己的，不受影响 |

---

## 10. 拍板结果（2026-10-05，用户逐条确认）—— ⛔ **全部作废**（见文首）

| # | 议题 | 决策 | 落地含义 |
|---|---|---|---|
| ① | 供应链取向 | **等麒麟** | 接受「dsh 内容停在 `0.2.0-rc.2`，随麒麟移植节奏前进」；**不建自有 backport 清单**。G4 已证明当前代码**零消费** 0.2.1 新增面（`shell.bottom` / `plugins.add.actions` / `settings.plugin.item`），即时损失≈0 |
| ② | 承重面策略 | **改走麒麟开放 slot** | hero 品牌注入不再依赖哈希类名 DOM（`.titleGroup` / `.previewBadge` 已确认失效）。改用 `sidebar.brand.mark`——规格 `{kind:'single',scope:'root'}` 两引擎逐字一致，属**受支持契约**，抗上游重构；退役 `brand-injector.ts` 的对应 DOM 路径 |
| ③ | 产物口径 | **沿用 KCoder 现制** | 闭包仍由本仓 `pnpm --filter=… deploy --prod --legacy` 物化（`scripts/release.sh:140-145`）。KStock 的三阶段实现**仅作差异对照**，不替代（§6） |
| ④ | `KCoder-DSH` 推送 | **推送** | 已推 `origin/KCoder-DSH` = `ea5dee2`（DSH 时代历史留存；该分支不含本文，保持历史原样） |
| ⑤ | 版本线 | **按 `1.0.0` 重置** | 现 `0.6.24`；重置动作在 **M6** 执行，本文不预先改版本号 |

**决策后的判据（不变）**：技术侧无「能不能」的悬念；剩余工作全部是 §8 的 M1–M6 机械迁移 + §9 风险登记项的逐条消解。

---

## 11. 未能确定（诚实登记）

1. **麒麟对 0.2.1 的意图**：`plans/` 无计划；`git fetch` 被沙箱拒（`.git/FETCH_HEAD` 在工作区外），
   本地 `dsh/master` 跟踪引用停在 `639ed01539`，**0.2.1 之后的真实漂移未测**。
2. **麒麟非命名空间散度**：main 与 `dsh-v0.2.0-rc.2` 的 10585 文件差被全局改名**灌水**，非干净度量。
3. **3 个待定锚点**：需**含会话**的页面才能裁定（本闸门无会话）。
4. **9 个锚点的视觉影响**：属 KCoder 桌面壳（`desktop/main/*`）注入，须让**KCoder 自己的 Electron 壳**
   指向该麒麟实例才能实测；本闸门只证明源码/DOM 层面是否存在。
5. **`@qilin/coding-sidebar` 是否已在 npm 可解析**（曾有 404 记录，本轮未联网复查）。
