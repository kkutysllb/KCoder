# 远端架构自适应（原生包按目标平台供给）

## Goal

让 KCoder 的远端连接对**目标机的 CPU / libc** 自适应，不再把 `linux-x64` 写死；并且
**装不上时必须响亮失败**，不再留下粘滞的坏状态。

验收（三条都要满足才算完成）：

1. arm64 远端在**干净 runtime** 上（无任何手工修复存量）由代码自己装出 arm64 原生包并起服务；
2. x64 远端的规格清单与改造前**逐条相同**（零回归，用断言锁死而非靠人眼）；
3. 平台无法判定或规格覆盖不足时**抛错且不写指纹**，不产生新的粘滞状态。

**状态：阶段 1–4 实施完成；实机端到端已在 26训练 验证通过（2026-10-01）。剩余事项：发版。**
应急手段见 `scripts/fix-remote-arm64-addons.sh`（不改代码，现场补齐 arm64 包）。

## Task List

### 阶段 0：事实固化 — complete（2026-10-01）

- [x] 定位事故根因并固化证据链（见 Findings F1–F4）
- [x] 证明「目标平台谓词」可行：两条 ground truth × 两棵本地树逐条相等（F5）
- [x] 查清 libc 的编码方式因包而异（F6）—— 这条直接决定下面的设计边界
- [x] 应急修复落地并实机验证（74推理 跑通，脚本入库）

### 阶段 1：断言先行（红） — complete

- [x] 新增 `scripts/check-remote-addon-specs.mjs`：25 项断言，分四层
      （纯函数 / 拒绝分支 / 命名族双向 / 覆盖度 / fixture 树 / 真实树）
- [x] 挂进 `pnpm typecheck`（无单测框架，用既有 `check-*.mjs` 形态；耗时约 1.4s）
- [x] 在**未改造**的代码上确认它红：旧谓词在同一棵真实树上对 arm64 目标给出
      **0 条**规格 ⇒ `arm64 = T2` 必红（已实测复现 F1）

### 阶段 2：判据与派生 — complete

- [x] **新增 `desktop/main/remote-target.ts`**（零依赖，可被 Node 直接 import 做断言）：
      `RemoteTarget` / `parseTarget` / `addonSuffixes` / `matchesAddonTarget` /
      `requiredAddonNames` / `missingRequiredAddons` / `localAddonSpecs`
- [x] `localAddonSpecs` 从 `remote-runtime.ts` **迁入**上述模块（原处 import 了 electron，
      断言脚本跑不动它）；谓词由常量改为按目标三元组生成
- [x] `remote-server.ts`：新增 `probeRemoteTarget(alias)`（`uname` + musl 判据），
      未知/不支持组合抛 `RemoteServerError`
- [x] 覆盖度断言：`missingRequiredAddons` 非空 ⇒ **安装之前**抛错
      （旧行为是装完再等 180 秒就绪超时）

> 与原方案的唯一偏离：判据与派生落在**新文件 `remote-target.ts`** 而不是 `remote-runtime.ts`。
> 理由是「可离线断言」这条硬要求——`remote-runtime.ts` 顶部 `import { app } from 'electron'`，
> 检查脚本无法直接加载它。附带收益：`remote-server.ts` 因此不再 import `remote-runtime`，
> 整条供给链在纯 Node 下可读可测。

### 阶段 3：状态与失败面 — complete

- [x] 指纹含目标三元组（`engineVersion|os-cpu-libc|specs`）→ 存量坏机器首连自愈
- [x] 安装脚本：`set -e` + `node_modules` 存在性 + **结果校验**（真 require 一次
      `node-addon-require-builtin`）——判据是事实而非字符串
- [x] 失败路径**不写指纹**：抛错点在指纹写入之前（旧代码在失败后照写，故永久粘滞）

### 阶段 4：可观测与验收 — complete

- [x] 日志文案带三元组（`远端 linux-arm64/gnu` / `搬运本地引擎 … + 补 7 个 …`）
- [x] `remote-connections.ts` 不再自行派生 specs（平台只有探测后才知道）
- [x] 回归：x64 清单与**旧实现的实机输出**逐条相等（在真实树上跑）
- [x] 仓库门：`pnpm typecheck`（含新断言）
- [x] **实机端到端（26训练，2026-10-01）**：装上本机新版后连接 →
      指纹由 `4aaa97a9…` 变 **`110d5c73…`**（本地按新格式复算**逐字节相同**：`0.2.0-rc.2|linux-arm64/gnu|` + 7 条规格）、
      `addon-specs.txt` 变 **7 条 linux-arm64**、`addons-install.log` = `added 8 packages in 10s`、
      `runtime/node_modules/node-addon-require-builtin-linux-arm64-gnu` 在位、
      服务日志 8226 → **1978 字节带就绪行**、监听 `127.0.0.1:30653` ⇒ **是代码自己装上的**

## Findings

### F1 直接原因：规格族写死

改造前 `desktop/main/remote-runtime.ts` 的谓词 `/-linux-x64(-gnu)?$/` 只认 x64 命名族，
`remote-server.ts` 的 `addonSpecs` 语义也是「linux-x64 原生包」。目标机 aarch64 时 7 条规格
全部被 npm 以 `EBADPLATFORM` **整单拒绝**：

```
npm error notsup Unsupported platform for @deepseek-ai/node-addon-system-linux-x64@0.1.2:
  wanted {"os":"linux","cpu":"x64"} (current: {"os":"linux","cpu":"arm64"})
```

**两台 arm64 主机复现完全一致**（确定性，非偶发）：

| | 74推理（00:22） | 26训练（15:56） |
|---|---|---|
| `addon-specs.txt` | 7 条 linux-x64 | 同（逐条相同） |
| `addons-install.log` | `EBADPLATFORM … wanted x64 (current arm64)` | 同 |
| `.engine-fingerprint` | `4aaa97a9430c909b0123043e400da1ad` | **同一值**（同版本 + 同 x64 清单） |
| 失败日志 | `server-30781.log` 8226 字节 | `server-30653.log` **8226 字节** |

后果：runtime 里一个 arm64 绑定都没有 → `dsh-app-boot` 抛
`host preparation failed: No usable native binding found for
node-addon-require-builtin-linux-arm64-gnu` → 进程退出 → 端口不监听（桌面端看到的是
「日志字节 8226 / 入口存在 是 / 监听 0」）。

### F2 失败被吞：用哨兵字符串代替退出码

**改造前** `remote-server.ts` 生成的安装脚本既不 `set -e` 也不查 npm 退出码，末尾**无条件**
`echo ADDONS_OK`；调用方只 `grep ADDONS_OK`。于是「npm 整单失败」被判成功。
实机 `addons-staging/` 只有 `package.json`、无 `node_modules` —— 铁证（两台主机皆如此）。

### F3 坏状态粘滞：指纹不含平台且在失败后仍被写

**改造前**的流程在「成功」分支写 `.engine-fingerprint`；下次连接见指纹一致即整段跳过。
实机复算 `md5("0.2.0-rc.2|" + specs.join(",")) == 4aaa97a9430c909b0123043e400da1ad`，
与两台主机的 marker **逐字节相同** ⇒ 不删 marker、不改代码，重连一万次都是「远端引擎已就位，跳过」。

### F4 架构事实无处可取

`worlds.json` 的 spec（`remote-world.ts:26-47`）只有 `node/helper/helperHash/workspace`，
无平台字段；`RemoteServerOptions` 也没有。`desktop/` 全目录搜 `arm64|aarch64|uname -m` **零命中**。
引导流程（`bundle/dsh-ssh-remote/lib/provision.js:156-176`）探测过 `uname -m`，但只用于选
Node tarball（且硬拼 `linux-` 前缀），随后**丢弃**。

### F5 「目标平台谓词」可行的实测依据

本地 runtime 树的 `optionalDependencies` **已经声明了全部平台变体**（例：
`node-addon-require-builtin` 声明 `darwin-arm64/x64`、`linux-arm64-gnu`、`linux-x64-gnu`、
`win32-*`）。因此把谓词从常量换成按目标三元组的后缀集合，就能从**同一棵树**筛出正确清单。

两条 ground truth、两棵独立的树（`staging/kcoder-runtime` 与
`~/Library/Application Support/KCoder/kcoder-runtime`）实测**全部逐条相等**：

| 目标 | 清单 |
|---|---|
| linux/x64/glibc | 与远端 `~/.kcoder-remote/addon-specs.txt`（旧代码产出）7 条逐条相等 ✅ |
| linux/arm64/glibc | 与 2026-10-01 手工验证可安装并跑通的 7 条逐条相等 ✅ |

谓词即 `endsWith('-linux-${cpu}') || endsWith('-linux-${cpu}-gnu')`。对 x64 它与现有
`/-linux-x64(-gnu)?$/` **语义等价**——这是「零回归」的依据。

### F6 libc 的编码方式因包而异（决定性约束）

| 包 | libc 怎么表达 | 实测 |
|---|---|---|
| `@deepseek-ai/node-addon-system-linux-arm64` | **与 libc 无关** | 包内 `bin/glibc/system.node` + `bin/musl/system.node` + 静态 `bin/landlock-run`；`prebuilds.json` 的 `libc` 字段逐条区分 |
| `node-addon-require-builtin-linux-arm64-gnu` | **编进包名** | 包内只有 `prebuilt/linux-arm64-gnu-napi-v9.node`；`prebuilds.json` 的 `platform` = `linux-arm64-gnu` |
| `@img/sharp-*` | 另一套命名族 | musl 变体叫 `@img/sharp-linuxmusl-arm64`（`linuxmusl-`，无连字符分隔） |
| `@koromix/koffi-*` / `@vscode/ripgrep-*` / `sherpa-onnx-*` | 无 libc 后缀 | npm 上 `-linux-arm64-musl` 名字 **404**（本就一个二进制通吃） |

⇒ **纯后缀映射不能覆盖 musl**。仅 `node-addon-require-builtin` 在 npm 上有 `-musl` 变体，
而本地树**未声明任何 musl 变体**：没有可信判据，不猜。

### F7 为什么不能只把后缀换成 arm64

下一个架构（arm64 目标之后还有谁？）又要改一次；而且写死后缀无法表达 libc 的三种编码方式、
无法在「本地树某平台变体缺失」时报警，也无法把平台并入指纹以自愈。真正要修的是**判据的来源**。

## 设计

### D1 目标三元组：连接时探测一次

放 `remote-server.ts`（它已有 `sshRun` 与 `RemoteServerError`；`remote-runtime.ts` 保持
「纯本地路径解析」，不引入 ssh 依赖）。

```ts
export interface RemoteTarget {
  os: 'linux'                        // 本轮只接受 linux（见「已否决 F」）
  cpu: 'x64' | 'arm64'
  libc: 'gnu'                        // musl 在探测阶段就被拒（见下）
}

async function probeRemoteTarget(alias: string): Promise<RemoteTarget> {
  const { stdout } = await sshRun(alias, [
    'printf "%s %s " "$(uname -s)" "$(uname -m)"',
    'if ls /lib/ld-musl-* >/dev/null 2>&1; then echo musl; else echo gnu; fi',
  ].join('\n'))
  // Linux x86_64|amd64 → x64；Linux aarch64|arm64 → arm64；其余**抛错**（不得退化成空清单）
  // musl → 抛「暂不支持 Alpine/musl 远端」并附 F6 的理由
  // Darwin → 抛「暂不支持 macOS 远端：引导流程的 Node 安装仍硬编码 linux- 前缀」
}
```

成本一次 ssh 往返（约百毫秒，相对分钟级的安装可忽略）；不引入新的状态同步面。

### D2 规格派生：谓词从常量改为函数

```ts
// remote-runtime.ts
const suffixesFor = (t: RemoteTarget): readonly string[] =>
  t.cpu === 'arm64'
    ? ['-linux-arm64', '-linux-arm64-gnu']
    : ['-linux-x64', '-linux-x64-gnu']

export function localAddonSpecs(runtimeDir: string, target: RemoteTarget): string[] { /* 其余不变 */ }
```

派生时机也一并内聚：`addonSpecs` 从 `RemoteServerOptions` 的必填项改为**可选覆盖**，
默认由 `provisionRemoteRuntime` 内部 `localAddonSpecs(opts.runtimeDir, target)` 计算。
理由：平台只有探测后才知道，留在调用方就多了「调用方忘了带 target」这一类可犯的错。

### D3 覆盖度断言（fail-loud）

```ts
const REQUIRED_ADDON_PREFIXES = ['node-addon-require-builtin-', '@deepseek-ai/node-addon-system-']
// 每条前缀都必须有命中；否则抛 RemoteServerError，消息里点明
// 「本地 runtime 树没有该平台的变体声明」+ 目标三元组。
```

这条在本轮若已存在，事故会在**安装前**就以一句人话终止（而不是 180 秒后的超时诊断）。

### D4 指纹含三元组 ⇒ 存量坏机器自愈

```ts
const engineFingerprint = `${opts.engineVersion}|${target.os}-${target.cpu}-${target.libc}|${opts.addonSpecs.join(',')}`
```

老机器（指纹不含平台）升级后首次连接即指纹不匹配 → 重跑引擎步骤 → 装上正确平台的原生包。
**这是唯一需要的迁移动作**，不必写一次性脚本。

### D5 安装判据：退出码 + 结果校验，彻底换掉哨兵

```bash
set -e                                   # ← 旧脚本没有，F2 的根因
...
npm i ... > $R/addons-install.log 2>&1
[ -d node_modules ] || { echo ADDONS_FAILED; tail -20 $R/addons-install.log; exit 1; }
for item in node_modules/*; do [ -e "$item" ] || continue; ... done   # ← 旧循环在空目录下静默空转
cd $R/runtime
node -e "require('./node_modules/node-addon-require-builtin/lib/index.js')" \
  || { echo ADDONS_FAILED; exit 1; }     # ← 判据是「事实」，不是「字符串」
echo ADDONS_OK
```

调用方仍可 `grep ADDONS_OK`——但此时它才有意义。失败路径沿用现有 `throw`
（`:352-355`），因此**天然不会写指纹**；这一点要在阶段 3 用一条断言/实机确认钉死。

### D6 可观测

`onLog` 打「远端 linux-arm64/glibc」再进安装；失败 detail 里带三元组。本次排查慢，
一半原因是日志里没有任何平台信息。

## 变更清单（均已落地）

| 文件 | 改动 | 对应 |
|---|---|---|
| `desktop/main/remote-target.ts`（新增） | 零依赖判据模块：`RemoteTarget` / `parseTarget` / 命名族 / 覆盖度 / `localAddonSpecs` | D2 D3 |
| `desktop/main/remote-runtime.ts` | 移除 `localAddonSpecs`（迁入上者）；本文件继续只管「本地路径解析」 | D2 |
| `desktop/main/remote-server.ts` | `probeRemoteTarget()`；`addonSpecs` 改内部派生（保留可选覆盖）；指纹含三元组；安装脚本 `set -e` + 结果校验 | D1 D4 D5 |
| `desktop/main/remote-connections.ts` | 不再自己派生 specs；注释说明平台来源 | D6 D2 |
| `scripts/check-remote-addon-specs.mjs`（新增） | 25 项断言：纯函数 / 拒绝分支 / 命名族双向 / 覆盖度 / fixture / 真实树等价 | 阶段 1 |
| `package.json` | `typecheck` 追加 `node scripts/check-remote-addon-specs.mjs` | 阶段 1 |

## 已否决的备选

| 备选 | 否决理由 |
|---|---|
| **A. 直接把后缀换成 `-linux-arm64`**（不探测） | 只是把写死换了个值；libc 的三种编码方式无从表达；下次再来一个架构又要改 |
| **B. 让远端 npm 自己按平台解析**：把本地树里**全部平台变体**写成 scratch 的 `optionalDependencies`，由 npm 按机器跳过不匹配的，再回收「实际落地的」 | 判据更权威、天然覆盖 libc，但落地集合不可预测（要枚举增量）、会牵入传递依赖、失败面从「显式失败」变成「静默少装」——正是 F2 的教训。**留作命名族继续漂移时的升级路径** |
| **C. 预装多平台包**（x64 + arm64 一起丢过去） | 显式指定的错平台包 npm 仍以 `EBADPLATFORM` 拒绝；改用 optionalDependencies 绕过则体积接近翻倍 |
| **D. 远端装官方引擎元包，由它拉原生依赖** | 已被 `remote-server.ts:304-309` 的注释否决：WSL2 上 npm 40+ 分钟不退 |
| **E. 把 arch 写进 `worlds.json` 并依赖它** | 双写一致性 + 存量世界无该字段；探测一次比维护一致性便宜。（可选：探测后回填，本轮不做） |
| **F. 顺手支持 macOS 远端** | 引导流程的 Node 安装仍硬编码 `linux-` 前缀（`provision.js:156-176`），macOS 远端在更早的步骤就断了；那是独立议题，混进来会让本轮的验收边界糊掉 |

## 边界与风险

| 项 | 说明 | 处置 |
|---|---|---|
| **musl / Alpine** | 本地树未声明任何 musl 变体（谓词命中 0 条）；npm 上 `node-addon-require-builtin-linux-arm64-musl` 存在，但 `node-addon-system` / `koffi` / `sherpa` / `ripgrep` 的 `-musl` 名字 404（它们的包本就与 libc 无关） | 探测到 musl **显式拒绝**并说明；支持 musl 是独立议题 |
| **命名族漂移** | 已见三种（见 F6） | 谓词只覆盖 glibc；覆盖度断言兜底；fixture 断言锁死现状，漂移时**测试先红** |
| **ABI / Node 版本** | prebuild 是 `node-v137`（Node 24）与 `napi-v9`；远端 Node 由引导流程钉 `v24.21.0`，但 `worlds.json` 的 node 路径可被别处替换 | 本轮只记录；建议后续补远端 Node 主版本校验 |
| **探测失败** | 不得退化成空清单（那会复刻「静默装 0 个包」） | 未知 `uname` 组合 → 抛错 |
| **换平台后的残留包** | 同一台机器换架构后，`node_modules` 会留下上一平台的包 | 无害（只是占空间），本轮不做清理 |
| **探测往返** | 每次连接多一次 ssh | 相对分钟级安装可忽略；与既有多次 `sshRun` 同量级 |

## 验收与验证命令

```bash
# 1) 本地门
pnpm typecheck

# 2) 新增断言（阶段 1；用 fixture，无需真实远端）
node scripts/check-remote-addon-specs.mjs

# 3) 实机（arm64，74推理）—— 必须证明是代码装的，不是吃手工存量：
#    远端先清干净：
#      rm -rf ~/.kcoder-remote/runtime ~/.kcoder-remote/addons-staging \
#             ~/.kcoder-remote/addons-arm64 ~/.kcoder-remote/*.log
#    然后在 KCoder 里连接该主机，期望日志依次出现：
#      远端 linux-arm64/glibc  →  远端引擎就绪  →  linux 原生包已补齐  →  已接通
#    若只出现「linux 原生包已补齐」却没起来，说明结果校验还不够严（回到 D5）。

# 4) 回归（x64）：断言 T1 逐条相等（已在本轮离线探针中验证过一次，落成常驻断言）
```

`scripts/fix-remote-arm64-addons.sh` 在改造完成后**仍然保留**：它是「代码修复已发布但用户
手上的旧版还坏着」时的现场手段，且与 D5 的结果校验同一套判据。

## 不在本轮范围

- musl/Alpine 支持（缺可信判据，见 F6）
- macOS 远端（引导流程本身不支持）
- 远端 Node 主版本下限校验
- `worlds.json` 的 arch 回填
- 旧平台残留包清理

## 关联缺陷

同属「远端供给通道」的另一类缺陷见 [remote-appledouble-pollution.md](remote-appledouble-pollution.md)
（macOS `._` AppleDouble 污染远端 runtime，导致插件管理页报「包元信息错误」）。那份**已经修完**
（接收端解包后 `find -delete` + 打包侧防呆），与本方案的阶段划分互不重叠、互为参照。

## 进度日志

| 日期 | 事件 |
|---|---|
| 2026-10-01 | 事故定位：74推理（aarch64）连接超时，日志 8226 字节；证据链 F1–F4 全部实机固化 |
| 2026-10-01 | 应急补齐：远端装 7 个 arm64 包 → 服务起来（就绪行 + 监听 + 带 token 200 + 页面 36KB）；本地隧道端到端验证通过 |
| 2026-10-01 | 应急脚本入库 `scripts/fix-remote-arm64-addons.sh`（派生自 `addon-specs.txt` + 退出码 + 结果校验）；沙盘 root 端到端真跑通过 |
| 2026-10-01 | 方案定稿（本文档）：F5 两条 ground truth × 两棵树全部逐条相等；F6 查清 libc 编码差异 ⇒ 本轮明确排除 musl。**实施未开始** |
| 2026-10-01 | 实测 **26训练（111.19.156.26）同为 aarch64**，且尚无 `~/.kcoder-remote` ⇒ 它一被「远端连接」连上就会原样复现 F1。应急脚本 `scripts/fix-remote-arm64-addons.sh` 对其同样适用（连一次失败 → 跑脚本 → 重连） |
| 2026-10-01 | 产品负责人指示：架构自适应**暂缓**（先不做阶段 1）。本文档停留在「方案定稿 / 实施未开始」 |
| 2026-10-01 | **阶段 1–4 实施完成**。新增零依赖判据模块 `remote-target.ts`；`probeRemoteTarget` + 指纹含三元组 + 安装脚本结果校验；新增 25 项断言并挂进 `pnpm typecheck` |
| 2026-10-01 | 红-绿证据：旧谓词在同一棵真实树上对 arm64 目标给出 **0 条**规格（断言必红）；新实现给出与 x64 对称的 7 条，且 x64 与**旧实现实机输出**逐条相等 |
| 2026-10-01 | 解析链路用真实字符串验证：`Linux aarch64 gnu` → `linux-arm64/gnu`；musl 正确拒绝。**注：74推理 当时网络不可达**（`Operation timed out`），实机端到端留到新版发布后 |
| 2026-10-01 | **26训练 独立复现同一故障**（15:56）：x64 清单、`EBADPLATFORM`、指纹 `4aaa97a9…`、失败日志 8226 字节——与 74 逐项一致 ⇒ 根因确定性成立（见 F1 对照表） |
| 2026-10-01 | 排查中发现**第二个缺陷**：引擎版本探测用裸 `node`，而 26训练 的 Node 在 `~/.dsh-remote/node/bin`（不在非交互 ssh 的 PATH）⇒ 探测恒为 `NONE` ⇒ **每次连接都重跑整个引擎步骤**（重传 485MB）。已改为用 `opts.remoteNode` 绝对路径；26 上实测由 `NONE` 变 `0.2.0-rc.2` |
| 2026-10-01 | **实机端到端通过**：本机装新版后连接 26训练，指纹 `110d5c73…`（与本地按新格式复算逐字节相同）、规格变 arm64、`added 8 packages in 10s`、绑定在位、服务就绪并监听。**代码自己装上了，不再依赖手工补丁** |
| 2026-10-01 | 遗留：74推理 仍在用手工装的那份（指纹 `4aaa97a9…`）；它下次连接会被新代码重装一遍（一次性，几分钟）。新版本尚未发版 |
