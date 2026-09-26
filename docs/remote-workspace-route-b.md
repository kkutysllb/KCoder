# 远程工作区（B-β：上游 SSH 执行世界 + 插件内置化）落地方案

> **目标**：在「选择工作区」里选中**远程主机的目录**，agent 在该远端目录上完成任务；
> 工具**原生透明**（因为整个进程的执行世界就是远端），而非让 agent 改调 `ssh_*`。
> **路线**：B-β —— 挂载上游已实现的 SSH 执行世界（`dsh-ssh` + `fs-ssh` + `subprocess-ssh`
> + `sandbox-ssh`），插件内置化后承担**主机注册 / 凭据 / helper 供给 / 世界编排 / UI**。
> **核实基线**：`deepseek-harness` fork 集成分支 `kcoder/0.1.7-rc.2`（本地克隆
> `~/kk_Projects/deepseek-harness`，HEAD `323be30855`）；已安装运行时
> `~/Library/Application Support/KCoder/kcoder-runtime`，`@deepseek-ai/dsh-*` 均为 `0.1.7-rc.2`。
> 文中每条结论均标注 `文件:行号` 或实测命令。
> **最后更新**：2026-09-26（决策由 B-α 改为 B-β）。

> ## ✅ 状态：**P0 已通过**（2026-09-26）
> 已在真实目标机（远程 Windows 上的 WSL2）上端到端验证：
> headless 会话里的 `bash` **确实执行在 WSL2 上**（`uname -a` 出 `microsoft-standard-WSL2`），
> `pwd` 落在配置的远端 workspace `/home/kkutys/dsh-ws`。
> ⇒ **「让 agent 真的在远程主机上完成任务」已在引擎层被证明可行**；
> 剩余唯一缺口是 Web 层（工作区注册表仍用 `node:fs`）→ 见 §6.2 与 P1。

---

## 0. 摘要

本次调研有三个决定性发现，合起来使 B-β 从「体验最好但要动大手术」变成**改动面反而更小**：

| # | 发现 | 为什么关键 |
|---|---|---|
| **F1** | 上游 `packages/ssh/` 是完整的一等公民执行世界；内置工具**直接消费** `ctx.fs`/`ctx.shell`/`ctx.subprocess` | 挂上 provider 后，`read/write/edit/glob/grep/bash` **全部自动**在远端工作 |
| **F2** | 四个 SSH 包**已发布 npm**，且存在 `0.1.7-rc.2`（`next` tag） | **无需改 fork 即可获得 provider** —— 内置 bundle 声明依赖即可物化进 profile |
| **F3** | 上游 headless **已经给出「cwd 走 `ctx.fs`」的范式**（`fs.processPath(await fs.resolve('.'))`） | 工作区层只需**照抄这一范式**，把 3 处硬编码 `node:fs` 换成 `ctx.fs` |

**最关键的设计结论**：上一版方案（URI 化）认为 `Workspace.path` 无法承载远程位置。
B-β 下这个约束**自动消解**——因为远端路径本身就是**绝对 POSIX 路径**（`/srv/app`），
天然满足「cwd 必须 `isAbsolute`」，且 `projectKey('/srv/app')` → `-srv-app` 是干净的日志目录名。
**不需要新增 `target` 字段，也不需要 URI 方案。**

**改动面**：引擎 **5 处**（其中 3 处是同一范式的机械替换）+ 插件职责重划 + 桌面端多 sidecar。

> ### ⚠️ 前置硬门槛（从源码实测，先看这条）
>
> `dsh-ssh` 调 ssh 的实参（[ssh/src/index.ts:264](/Users/libing/kk_Projects/deepseek-harness/packages/ssh/ssh/src/index.ts:264)）：
> ```ts
> '-T','-M','-S',controlPath, '-o','ControlPersist=no', '-o','BatchMode=yes',
> '-o','StrictHostKeyChecking=yes', '-o','ForwardAgent=no', '-o','ClearAllForwardings=yes',
> '-o','ServerAliveInterval=10','-o','ServerAliveCountMax=3', this.config.host, command
> ```
> 三条推论：
> 1. **`BatchMode=yes` ⇒ 密码认证在客户端就被剔除**。这不是「不弹提示」，而是
>    `password` 与 `keyboard-interactive` 两个方法被**直接判定为不可用**：
>    OpenSSH `sshconnect2.c` 的 `authmethod_is_enabled()`——
>    *"return false if batch mode is enabled but method needs interactive mode"*——
>    而方法表 `authmethods[]` 里这两项的 `batch_flag` 均指向 `&options.batch_mode`。
>    出处：[OpenSSH master/sshconnect2.c](https://raw.githubusercontent.com/openssh/openssh-portable/master/sshconnect2.c)、
>    [V_9_8_P1 同文件:2274](https://raw.githubusercontent.com/openssh/openssh-portable/V_9_8_P1/sshconnect2.c)
>    ⇒ `userauth_passwd()` 根本不会被调用，**`SSH_ASKPASS` 也无从生效**。
>    ⇒ 目标主机**必须**公钥或 ssh-agent 认证。
> 2. **`host` 是 OpenSSH 别名**，user/port/key/known_hosts 全由 `~/.ssh/config` 决定
>    ⇒ 主机注册表必须**物化出 ssh config 别名**（见 §4-D P4）。
> 3. **`StrictHostKeyChecking=yes` ⇒ 主机键必须预先在 `known_hosts`**（否则直接失败）。
>
> > ⚠️ **两条通道要分清**：**插件自己的 ssh 调用不设 `BatchMode`**，所以它**能用密码登录**
> > —— 在 dev 里实测连通走的正是这条，与本节结论不矛盾。
> > B-β 要的是 `dsh-ssh` 那条通道，它设了 `BatchMode=yes`。
> > 两条通道的认证能力不同，**这正是 §5.5 需要「引导升级」的根本原因**。
>
> 程序流还走 `-L <本地socket>:<远端socket>` 转发（
> [ssh/src/index.ts:150](/Users/libing/kk_Projects/deepseek-harness/packages/ssh/ssh/src/index.ts:150)）
> ⇒ 服务端需 `AllowStreamLocalForwarding yes`（OpenSSH 默认即 yes）。
>
> **这恰好定义了插件的真正价值**：把一台「只有密码」的主机**引导升级**为
> 「有公钥 + 有 Node + 有 helper + 有 ssh 别名」的可无人值守主机。
> 引导阶段用插件现有通道（支持密码、可交互），运行阶段交给 `dsh-ssh`。详见 §5.5。

---

## 1. 三个发现的证据

### F1：上游 SSH 执行世界（`packages/ssh/`）

| 包 | 职责 | 提供的服务 |
|---|---|---|
| `@deepseek-ai/dsh-ssh` | OpenSSH 连接、helper 生命周期与摘要校验 | `ctx.ssh` |
| `@deepseek-ai/dsh-fs-ssh` | 远程文件身份、读取、带守卫的原子写 | **`ctx.fs`** |
| `@deepseek-ai/dsh-subprocess-ssh` | 可执行查找、进程、控制流、终端 | **`ctx.subprocess`** |
| `@deepseek-ai/dsh-sandbox-ssh` | 远端文件效果沙箱 | **`ctx.sandbox`** |

出处：[packages/ssh/README.md](/Users/libing/kk_Projects/deepseek-harness/packages/ssh/README.md)。

内置工具**直接消费这些 seam**（不是自己摸文件系统）：

| 工具 | 依赖 | 证据 |
|---|---|---|
| `read` / `write` / `edit` / `read_image` | `ctx.fs` | [tool-fs/src/index.ts:22](/Users/libing/kk_Projects/deepseek-harness/packages/fs/tool-fs/src/index.ts:22) |
| `bash` / `pwsh` | `ctx.shell` | [tool-bash/src/index.ts:34](/Users/libing/kk_Projects/deepseek-harness/packages/shell/tool-bash/src/index.ts:34) |
| `glob` / `grep` | `ctx.subprocess` | [tool-fs-search/src/index.ts:70](/Users/libing/kk_Projects/deepseek-harness/packages/fs/tool-fs-search/src/index.ts:70) |

**附带好消息**：文件树 / 改动源**已经**完全走 `ctx.fs`
（`workspace-files` 的 `static inject = ['fs','sandboxPolicy','sessions','typert']`，
用 `ctx.fs.stat/listDir/resolve/lstat/readByteRange` —— [api/workspace-files/src/index.ts:184](/Users/libing/kk_Projects/deepseek-harness/packages/api/workspace-files/src/index.ts:184)、[:317](/Users/libing/kk_Projects/deepseek-harness/packages/api/workspace-files/src/index.ts:317)）。
⇒ 远程世界里文件树**自动**列远端目录，无需专门改造。

### F2：四个包已发布 npm，含 `0.1.7-rc.2`

实测（`registry.npmjs.org`）：

```
@deepseek-ai/dsh-ssh            dist-tags: latest=0.1.6-alpha.1  alpha=0.1.7-alpha.2  next=0.1.7-rc.2   has 0.1.7-rc.2 ✓
@deepseek-ai/dsh-fs-ssh         同上                                                                  has 0.1.7-rc.2 ✓
@deepseek-ai/dsh-subprocess-ssh 同上                                                                  has 0.1.7-rc.2 ✓
@deepseek-ai/dsh-sandbox-ssh    同上                                                                  has 0.1.7-rc.2 ✓
```

**但当前 KCoder 运行时里四个包都不存在**（实测 `MISSING`）——它们没被任何 bundle 依赖。
⇒ 内置 bundle 声明这四个依赖（钉 `0.1.7-rc.2`），物化链就会把它们装进 profile。
**不需要修改 fork 的引擎代码来获得 provider。**

> 版本线要与基线同线：KCoder 既有断言
> [check-bundle-version-line.mjs](/Users/libing/kk_Projects/KCoder/scripts/check-bundle-version-line.mjs)
> 规则①「声明只指向已发布版本、且与物化同线」正好覆盖这件事。

### F3：headless 已给出 `ctx.fs` 范式

[packages/bundle/headless/src/index.ts:344](/Users/libing/kk_Projects/deepseek-harness/packages/bundle/headless/src/index.ts:344)：

```ts
const fs = ctx.get('fs')
const cwd = fs === undefined ? process.cwd() : fs.processPath(await fs.resolve('.'))
// …
meta: { cwd }        // ← 会话头 cwd 来自这里
```

即：**cwd 在世界里解析**，而不是 `process.cwd()`。上游 SSH 决策记录里的原话
「Headless records and validates cwd through `ctx.fs`」指的就是这段。
⇒ Web 侧要做的，是把同一范式搬进工作区层。

---

## 2. 关键约束与结论：远端路径可以直接当工作区路径

上一版（URI 方案）的三条硬约束仍然成立，但 **B-β 下它们不再构成障碍**：

| # | 约束 | 证据 | B-β 下为何不阻碍 |
|---|---|---|---|
| C1 | 会话头 `cwd` 必须 `isAbsolute` | [session-format-v3-to-v4/src/validation.ts:31](/Users/libing/kk_Projects/deepseek-harness/packages/session/session-format-v3-to-v4/src/validation.ts:31) | 远端路径 `/srv/app` **就是**绝对路径 ✓ |
| C2 | 会话日志目录由 `cwd` 派生（`/ \ :` 折成 `-`） | [session-persistence-jsonl/src/format.ts:225](/Users/libing/kk_Projects/deepseek-harness/packages/session/session-persistence-jsonl/src/format.ts:225)、[:267](/Users/libing/kk_Projects/deepseek-harness/packages/session/session-persistence-jsonl/src/format.ts:267) | `/srv/app` → `-srv-app`，干净的目录名 ✓ |
| C3 | attach 要求 `realpath(cwd) === record.path` | [workspace/src/entity.ts:138](/Users/libing/kk_Projects/deepseek-harness/packages/workspace/workspace/src/entity.ts:138) | 两侧都**在世界里**解析后相等即可 ✓（前提是 E1–E3） |

> 对比：`ssh://host/srv/app` **不满足** C1（含 `:` 与 `//`，且 `isAbsolute` 为假），
> 这才是上一版必须引入 `target` 字段的原因。**B-β 让 URI 变得不必要** —— 因为地址就是路径。

**工作区唯一性**也随之自然成立：远端世界里的 `realpath` 就是远端路径的规范形，
同一台主机内字符串相等即同一工作区。跨主机的同名路径不会冲突，因为**一台主机的世界一个进程**（见 §3）。

---

## 3. 架构决定：进程级世界 ⇒ 每主机一个 sidecar

上游 SSH 世界是**部署所有、进程级、单主机**的：

```ts
// packages/ssh/ssh README —— 连接 API
interface Config {
  host: string          // OpenSSH host alias（部署拥有；模型参数不可选）
  node: string          // 远端 Node 绝对路径
  helper: string        // 已安装 helper 入口绝对路径
  helperHash: string    // 该入口的 SHA-256（不匹配即拒绝连接）
  workspace: string     // 远端默认工作区（单值）
  bootstrapPath?, bootstrapHash?, requestTimeoutMs?, maxFrameBytes?, maxPending?, leaseMs?
}
```

`fs-ssh` / `subprocess-ssh` / `sandbox-ssh` 都是**单一服务名**（`ctx.fs` / `ctx.subprocess` / `ctx.sandbox`），
一个 context 只能有一个实现 ⇒ **一个进程一个世界**。
上游也把「每工作区一个世界」明确列为未完成项：

> *"The initial composition scope is POSIX headless and custom profiles. **Web workspace consumers
> with host-filesystem assumptions require their own integration.**"*
> Deferred：*"**Broader Web support needs provider-owned workspace resources.**"*
> — [posix-ssh-runtime note](/Users/libing/kk_Projects/deepseek-harness/.agents/notes/implemented/architecture/2026-09-11-posix-ssh-runtime.md)

**⇒ 决策：每台远程主机一个 sidecar（`dsh web` 进程），其 profile 把 provider 行换成 SSH 实现。**
这与上游既定 scope（custom profile）一致，也与 KCoder 既有的「宿主 + 侧车」架构一致。

**现状**：KCoder 目前是**单侧车** ——
[dsh-manager.ts:4](/Users/libing/kk_Projects/KCoder/desktop/main/dsh-manager.ts:4)
「职责：spawn `dsh web --port 0` → 从 stdout 解析就绪行 → 广播状态」。
⇒ 需要扩展为多侧车 + 连接切换（见 §4-C）。

```
KCoder 宿主（Electron）
 ├── 本地 sidecar：dsh web（现有世界：fs-local / subprocess-local / sandbox-local）
 └── 远程 sidecar ×N：dsh web
        profile overlay：fs-sandbox→fs-ssh、subprocess→subprocess-ssh、sandbox→sandbox-ssh
        config(ssh)：host/node/helper/helperHash/workspace ← 由插件供给
        ⇒ 该窗口/连接里的「选择工作区」列出的就是**远端目录**
```

---

## 4. 变更清单

### A. 引擎层（`deepseek-harness` fork）—— 5 处，全部是「`node:fs` → `ctx.fs`」

工作区包目前硬编码本机 FS（实测三处 `node:fs/promises`）：

| # | 位置 | 现状 | 改为 | 备注 |
|---|---|---|---|---|
| **E1** 🔴 | [workspace/src/paths.ts:6](/Users/libing/kk_Projects/deepseek-harness/packages/workspace/workspace/src/paths.ts:6) | `import { realpath } from 'node:fs/promises'` | `ctx.fs.resolve()` + `processPath()` | `paths.ts` 是纯模块无 ctx ⇒ 需把「规范化」上移到有 ctx 的注册表方法，`paths.ts` 只留纯字符串校验 |
| **E2** 🔴 | [workspace/src/entity.ts:11](/Users/libing/kk_Projects/deepseek-harness/packages/workspace/workspace/src/entity.ts:11) | `stat`（`status()` 与 `attachSession` 用） | `ctx.fs.stat()` | |
| **E3** 🔴 | [workspace/src/index.ts:9](/Users/libing/kk_Projects/deepseek-harness/packages/workspace/workspace/src/index.ts:9) | `mkdir, stat` | `ctx.fs` + 目录创建（见下） | `initializeDefault` 的 `mkdir` 需替代 |
| **E4** 🔴 | [directory-picker-browse/src/index.ts:12](/Users/libing/kk_Projects/deepseek-harness/packages/host/directory-picker-browse/src/index.ts:12) | `mkdir, opendir, stat` + `homedir` | `ctx.fs.listDir/stat` + 目录创建 | 否则远程世界里选择器仍列**本机**目录 |
| **E5** 🔴 | [directory-picker-auto/src/resolve.ts](/Users/libing/kk_Projects/deepseek-harness/packages/host/directory-picker-auto/src/resolve.ts) | 按 bindHost/platform/ssh 解析 | 世界为远程时**强制 `browse`** | 远程世界绝不能弹本机 OS 对话框；判据可用 `ctx.get('ssh')` 是否存在 |

**⚠️ 一个真实缺口**：`FileSystem` 抽象类**没有创建目录的方法**（实测方法表：
`resolve/processPath/fileUrl/contains/stat/lstat/readText/streamText/readBytes/readByteRange/listDir/writeText/editText`
—— [fs/fs/src/index.ts:87](/Users/libing/kk_Projects/deepseek-harness/packages/fs/fs/src/index.ts:87)）。
而 E3 与 E4 都需要建目录。两个选项：
- **(a) 走 `ctx.shell`**：SSH 世界里 `ctx.shell` 就是远端 shell，执行 `mkdir -p` 即可。改动最小，但把 fs 语义漏给了 shell。
- **(b) 给 seam 加 `mkdir`**：语义干净，但要动 `fs/fs` + `fs-local` + `fs-ssh` + `fs-sandbox` 四个包。
> 建议 (a) 先行（可逆、面小），把 (b) 记为后续整洁化。

**另有配置面（非代码）**：`sandbox-policy.workspaceRoot` 现在钉 `process.cwd()`
（[dsh-base/cordis.patch.yml:232](/Users/libing/Library/Application%20Support/KCoder/kcoder-runtime/node_modules/@deepseek-ai/dsh-base/cordis.patch.yml:232)），
远程 profile 需指向远端 workspace。

### B. profile overlay：**只能「禁用 + 插入」，不能改行**

> ⚠️ **实测纠正**：本方案早期版本写的是「按 id 覆写 name 换 provider」——**这在机制上不成立**。
>
> `applyEntryPatches`（`@deepseek-ai/cordis-plugin-include`）里 patch 行的 `name` **不是覆写值，
> 而是一条身份断言**：
> ```ts
> const { id, insert, name, ...overrides } = patch
> if (name && name !== target.name) {
>   warn('patch: name mismatch for %C (expected %C, got %C), skipping', id, target.name, name)
>   // 整条 patch 被跳过
> }
> ```
> 已用 `--dump-config` 实测：给 `subprocess` 写 `name: @deepseek-ai/dsh-subprocess-ssh` 后，
> dump 里它**仍是** `dsh-subprocess-local`。⇒ **任何 patch 层都改不了行的 `name`。**

**正确做法**：断言身份 + `disabled: true` 关掉本地行，再用**新 id** 插入 SSH 行。
服务是「可用性驱动」的（行顺序无语义），本地行一关，服务名即被 SSH 行占用。

```yaml
# 1) 断言身份 + 禁用本地 provider（腾出 ctx.subprocess / ctx.sandbox / ctx.fs）
- id: subprocess
  name: "@deepseek-ai/dsh-subprocess-local"    # 断言：不符则整条跳过（上游改名时不会误伤）
  disabled: true
- id: sandbox
  name: "@deepseek-ai/dsh-sandbox-local"
  disabled: true
- id: fs-sandbox
  name: "@deepseek-ai/dsh-fs-sandbox"
  disabled: true

# 2) 沙箱工作区根指向远端
- id: sandbox-policy
  name: "@deepseek-ai/dsh-sandbox-policy"
  config:
    mode: workspace-write
    workspaceRoot: <远端 workspace>

# 3) 插入 SSH 执行世界（新 id）
- insert:
    - id: ssh
      name: "@deepseek-ai/dsh-ssh"
      config: { host, node, helper, helperHash, workspace }   # 见 §3
    - id: subprocess-ssh
      name: "@deepseek-ai/dsh-subprocess-ssh"
    - id: sandbox-ssh
      name: "@deepseek-ai/dsh-sandbox-ssh"
    - id: fs-ssh
      name: "@deepseek-ai/dsh-fs-ssh"
```

**基座行 id 与位置**（`@deepseek-ai/dsh-base/cordis.patch.yml`，实测）：
`subprocess` 219 · `sandbox` 225 · `sandbox-policy` 228 · `fs-sandbox` 517。

**bash 为何跟着走**：`bash-sandbox`（提供 `ctx.shell`）注入 `['subprocess','sandbox','sandboxPolicy']`
——它**消费 seam**，所以三个 provider 一换，bash 自动落到远端。无需替换 `bash-sandbox` 行。

**载体**：`dsh --patch <file>`（可重复，overlay 最后应用）。已在临时 profile 上实测组合正确
（三行 `disabled: true`、SSH 四行插入、`sandbox-policy` config 生效、无 name mismatch 警告）。

### C. KCoder 桌面端

| # | 位置 | 改动 |
|---|---|---|
| **K1** 🟡 | [desktop/main/dsh-manager.ts](/Users/libing/kk_Projects/KCoder/desktop/main/dsh-manager.ts) | 单侧车 → 多 sidecar 管理器（每主机一个，独立 `--port 0` + 独立 profile 目录/overlay） |
| **K2** 🟡 | 侧车生命周期 | 就绪解析、崩溃重启、退出清理、端口分配（复用现有实现，参数化） |
| **K3** 🟡 | 连接/窗口模型 | 每个远程主机一个连接（窗口或标签页）；本地连接照旧 —— **产品决策项，见 §7** |
| **K4** 🟡 | 打包 | 把 4 个 ssh 包纳入物化（由内置 bundle 的依赖牵引，见 D） |

### D. 插件（`dsh-kylin-ssh-tunnel`，内置化）

内置化后的**职责重划**：不再以 `ssh_*` 工具为主干，而是成为「**引导与供给层**」
（把「只有密码」的主机升级为「有公钥 + 有 Node + 有 helper + 有 ssh 别名」的可无人值守主机，见 §5.5）。

| # | 职责 | 状态 |
|---|---|---|
| **P1** | 主机注册表（CRUD / 导入导出 / 批量） | 🟢 已有 |
| **P2** | 凭据库（AES-256-GCM，`SSH_ASKPASS` 注入） | 🟢 已有 |
| **P3** | **引导升级**：装公钥 → 装 Node（免 sudo，用户态）→ 投放 helper + 9 个依赖 → 校验 SHA-256 | 🟡 **新，B-β 的核心能力**（见 §5.5） |
| **P4** | **ssh config 别名物化**：由 P1 的 host/user/port/key 生成 `Host dsh-remote-<id>` 段 + 主机键入 `known_hosts` | 🟡 新（`dsh-ssh` 只吃别名，见 §0 ⚠️） |
| **P5** | **远程 profile 生成**：按 §4-B 生成 overlay（行替换 + `ssh` config）并写入 profile 目录 | 🟡 新 |
| **P6** | UI：主机管理（已有）+「连接远程主机」+ 引导进度/自检结果 + 远程目录选择（世界即远端，选择器天然可用） | 🟡 部分 |
| **P7** | `ssh_*` 工具：`ssh_hosts`/`ssh_status`/`ssh_run` 等 | 🟢 已有 → **引导与自愈通道**（B-β 的必需前置，非可选诊断）。可考虑收缩写/编辑类 | 
| **P8** | 内置化打包：`bundle/<dir>` 四件套 + `vendor/` + `cordis.patch.yml`，声明 4 个 ssh 包依赖 | 🟡 新 |

内置化路径（照抄既有 bundle 的做法）：真源仓 → `dsh-plugins` 镜像 → `sync-bundles.mjs` → `KCoder/bundle/`，
由 [kcoder-skills-bundle.ts:234](/Users/libing/kk_Projects/KCoder/desktop/main/kcoder-skills-bundle.ts:234)
`materialize()` 幂等物化到 `$DSH_HOME/profiles/web/node_modules/<包名>` 并注册进 `dsh.profile.bundles`。
参考现有 bundle 布局：[bundle/dsh-terminal](/Users/libing/kk_Projects/KCoder/bundle/dsh-terminal)（含 `vendor/` 目录与 `entry.js`/`client.js`/`cordis.patch.yml` 四件套）。

---

## 5. helper 供给（B-β 的关键新增能力）

### 5.1 helper 是什么、在哪

helper 打包在 `dsh-ssh` 内（`package.json` 的 `"./helper"` 导出 → `lib/helper.js`，实测 **30 KB**），
配套 chunk：`protocol-*.js`(9 KB) / `stream-security-*.js`(2.4 KB) / `schemas-*.js`(7.4 KB)。

### 5.2 远端依赖清单（实测：从构建产物提取的裸模块说明符）

```
@deepseek-ai/cordis          @deepseek-ai/dsh-fs           @deepseek-ai/dsh-fs-sandbox
@deepseek-ai/dsh-sandbox-local   @deepseek-ai/dsh-sandbox-policy
@deepseek-ai/dsh-session-projection
@deepseek-ai/dsh-subprocess  @deepseek-ai/dsh-subprocess-local  (+ /output)
zod                          （其余均为 node: 内建）
```

⇒ **不是单文件**：远端必须能解析这 9 个包 + `zod`。这与上游 README 的
「Install the built helper and its matching runtime dependencies on the remote host」一致。

### 5.3 体积实测（决定投放方式）

| 组件 | `du -sh` |
|---|---|
| `zod` | 5.6 MB |
| `@deepseek-ai/dsh-subprocess-local` | 1.0 MB |
| 其余 7 个 `@deepseek-ai/dsh-*` | ≈ 1.2 MB |
| helper 本体 + chunks | ≈ 50 KB |
| **合计** | **≈ 7.8 MB**（`du` 含 `.d.ts`/map，实际运行时 JS 更小） |

⇒ **可投放**。两种投放方式：

| 方式 | 前提 | 建议 |
|---|---|---|
| **T1 打包投放**（推荐） | 无（离线可用） | 插件从本地已安装的 `node_modules` 收集上述子集 → 打包 → `ssh_push` → 远端解包 → 校验 |
| **T2 远端 npm 安装** | 远端有 Node + 网络可达 npm | 远端 `npm i @deepseek-ai/dsh-ssh@0.1.7-rc.2` 等；省事但依赖网络与 registry 可达 |

> 可探索 **T3**：本地用 esbuild 把 helper + 依赖打成**单文件**，远端只需 Node。
> 收益大（供货从 7.8 MB 降到百 KB 级），但要验证 helper 的 `@deepseek-ai/cordis` 用法能否被安全打包
> ——**列为 P-helper 阶段的探针项，不作为前提**。

### 5.4 安全与同意（必须在实现前定调）

自动供给 = **向远端主机投放并执行代码**。注意：
- 插件现有能力（`ssh_run` 等）本就等于远端代码执行权限，所以不是新权限面；但**静默安装**是新的信任语义。
- 上游摘要校验的定位是「检测意外安装物」，**不是**「认证恶意 SSH 主机」
  ——原话：*"Digest verification detects an unexpected installed artifact after helper startup;
  it does not make writable deployment files safe to execute or authenticate a malicious SSH host."*
- 建议：供给动作**显式、可见、可拒绝**（用户点「为 host01 安装运行组件」），
  并展示将要投放的路径、大小、SHA-256；默认不改动远端。

### 5.5 引导流程（bootstrap）与 WSL2 目标

**目标环境（用户给定）**：远程 Windows 上的 **WSL2 主机**（`125.64.108.97:18908`，当前 `auth: password`），
期望「首次连接自动下载安装所需依赖」。

WSL2 是 Linux 用户态 ⇒ **满足上游「两端 Linux/macOS」的前提**（ssh 落在 WSL2 内的 sshd 上）。
但当前配置是**密码认证**，与 §0 的 `BatchMode=yes` 冲突 ⇒ 必须先做**引导升级**。

**两阶段分工**（这是插件在 B-β 下的核心价值）：

| 阶段 | 通道 | 能力要求 | 做什么 |
|---|---|---|---|
| **引导（一次性）** | 插件现有通道（`ssh_run` 等；支持密码 + `SSH_ASKPASS`） | 只要能密码登录 | 装公钥 → 装 Node → 投放 helper+deps → 写 ssh config 别名 → 校验 |
| **运行（长期）** | `dsh-ssh`（别名 + 公钥 + `BatchMode`） | 无人值守 | 提供 `ctx.fs`/`ctx.subprocess`/`ctx.sandbox` 的远端世界 |

> 引导阶段之所以**必须**留插件通道：`dsh-ssh` 自己做不到「首次无密钥落地」（BatchMode + 严格主机键）。
> 这也给 §7.2 第 4 项（`ssh_*` 是否收缩）一个明确答案：**`ssh_run`/`ssh_status`/`ssh_hosts` 必须保留**
> —— 它们是引导与自愈通道，不是可选诊断。

**引导步骤（拟）**：

1. **连通性 + 环境探测**：`uname -s -m`（判 Linux/架构）、`command -v node`、`sshd -T | grep -i streamlocal`（判转发）、`echo $HOME`、可写目录探测。
2. **公钥落地**：若本机无专用密钥则生成一对；把公钥追加到远端 `~/.ssh/authorized_keys`
   （幂等：按注释标记去重）。
   **密钥形态要求**（`BatchMode` 的两个连带后果，源码实证）：
   - 私钥**不能带口令**：带口令的私钥在 batch mode 下 `SSH_ERR_KEY_WRONG_PASSPHRASE` → `quit = 1`，
     ssh 直接放弃该密钥而**不提示**（[sshconnect2.c:1565](https://raw.githubusercontent.com/openssh/openssh-portable/master/sshconnect2.c)）。
   - 或者把带口令的私钥**预加载进 ssh-agent**（`ForwardAgent=no` 只禁转发到服务端，
     本机 agent 认证不受影响）。
   ⇒ 引导默认生成**无口令密钥**（`ssh-keygen -N ''`），落在专用路径并由 `IdentityFile` 指定。
3. **Node 落地**（仅当缺失）：
   - 若远端可访问外网：下载官方 Node tarball 到 `~/.dsh-remote/node/` 并解包（**免 sudo**，自带 npm）。
   - 否则：由本地中转投放（与 helper payload 同一通道）。
   - 记录绝对路径 → 即 `dsh-ssh` 的 `node` 字段。
4. **helper + 依赖落地**：布局为 `~/.dsh-remote/helper/{lib/,node_modules/}`，保证 helper 向上解析得到依赖；
   计算 helper 入口的 **SHA-256**（→ `helperHash`）。
5. **写 ssh config 别名**：`Host dsh-remote-<id>` + `HostName/Port/User/IdentityFile/IdentitiesOnly`；
   主机键入 `known_hosts`（用插件已信任的连接做 `ssh-keyscan` 或取 `ssh-keyscan -p`）。
6. **自检**：用别名以 `BatchMode=yes` 跑一次 `node -v` 与 helper 启动握手；全绿才标记该主机「就绪」。

**幂等与自愈**：每一步都可重复执行；版本/摘要不符时重新投放；引导失败的中间态不写「就绪」标记。

### 5.6 目标主机前置清单（P0 逐条核对）

| # | 检查项 | 命令（在目标机执行） | 期望 | 不满足的后果 |
|---|---|---|---|---|
| 1 | 是 Linux 用户态 | `uname -s` | `Linux` | 上游不支持（macOS 亦可，Windows 原生不行） |
| 2 | 架构 | `uname -m` | `x86_64` / `aarch64` | 决定 Node tarball 选型 |
| 3 | **streamlocal 转发** | `sshd -T \| grep -i streamlocalforwarding` | `allowstreamlocalforwarding yes` | 程序流无法建立（默认 yes，但需确认） |
| 4 | 远端 Node | `command -v node && node -v` | 有则记录绝对路径；无则走引导安装 | 无 Node 则 helper 无法运行 |
| 5 | 家目录可写 | `test -w "$HOME" && echo ok` | `ok` | helper 无处安放 |
| 6 | 外网可达（仅 T2/Node 下载需要） | `curl -sI https://nodejs.org \| head -1` | `200`/`301` | 需改走本地中转投放 |
| 7 | 本地 `ssh` 支持复用与 streamlocal | （**本机**执行）`ssh -V` | OpenSSH ≥ 6.7 | `-M/-S/-L` 不可用 |
| 8 | **公钥认证可用** | （**本机**执行）`ssh -o BatchMode=yes -o StrictHostKeyChecking=yes <别名> true` | 退出码 0 | **B-β 无法运行**（当前就是这一条不满足） |

> 第 8 条是当前的**实际阻塞项**：dev 主机是密码认证，而 `dsh-ssh` 的 `BatchMode=yes`
> 会让 OpenSSH 在客户端直接剔除 `password`/`keyboard-interactive` 方法（见 §0 ⚠️ 第 1 条的源码证据）。
> P0 的第一件事就是把它升级为公钥 + 别名 —— 这一步用**插件通道**（密码可用）完成，即 §5.5 的引导。
>
> 快速自检（不改动远端，只验证「B-β 通道现在能不能过」）：
> ```bash
> # 1) 有没有可用别名/主机键（把 <别名> 换成 ~/.ssh/config 里的 Host）
> ssh -o BatchMode=yes -o StrictHostKeyChecking=yes <别名> true && echo "B-β 通道 OK" || echo "B-β 通道不通（预期：当前为密码认证）"
> # 2) 看它到底试了哪些方法（应能看到 password 被 batch mode 剔除）
> ssh -vv -o BatchMode=yes -o PreferredAuthentications=password,keyboard-interactive <别名> true 2>&1 | grep -iE "authentications that can continue|batch|password"
> ```

---

## 6. 分阶段与验收

| 阶段 | 内容 | 验收判据 |
|---|---|---|
| **P0** 可行性探针（1d） | **先用 headless 验证世界本身，不碰 Web 工作区层**（headless 的 cwd 本就走 `ctx.fs`，见 §1-F3；Web 侧会话 cwd 来自本地工作区，会撞上「cwd 本地 / 世界远端」的不一致）。步骤：①§5.6 前置（已实测通过，见 §6.1）；②远端装 helper + 依赖；③本地 runtime 装入 4 个 ssh 包；④建 `headless` 模板 profile + §4-B overlay；⑤跑一条任务看 bash 落在哪 | **✅ 已通过**（见 §6.2）：headless 会话里 `bash` 在**远端**执行（`uname -a` 出 `microsoft-standard-WSL2`、`pwd` = `/home/kkutys/dsh-ws`） |
| **P1** 引擎 5 处改造（2d） | E1–E5 | 远程 sidecar 里能**建立工作区**（远端 `/srv/app`）；`attachSession` 不报错；会话日志落在 `-srv-app`；**本地世界零回归**（全部现有测试绿） |
| **P2** helper 供给（3d） | P2/P3：探测 Node、投放、校验、产出 config；含 T3 探针 | 在干净目标机上从 UI 一键装好运行组件；SHA-256 与配置一致；失败可读可重试；重复执行幂等 |
| **P3** 多 sidecar 编排（3d） | K1–K4 + P4 远程 profile 生成 | 同时开本地 + 2 台远程连接；各自工作区/会话/文件树互不串；退出清理干净；崩溃可重启 |
| **P4** 内置化与 UI（2d） | P5/P7：bundle 四件套 + 依赖声明 + 主机管理 UI + 连接入口 | 装机即自带；设置页可管主机；能从 UI 发起远程连接并在其中选远端目录建工作区 |
| **P5** 打磨（2d） | `ssh_*` 定位为诊断通道；文档；错误可读性；降级路径（helper 装不上时如何提示） | helper 缺失时给出明确指引而非莫名失败 |

**贯穿的回归门**：本地 sidecar 的行为与今日**完全一致**；不装任何远程主机时功能面不变。

### 6.1 P0 前置实测结果（2026-09-26，目标机为远程 Windows 上的 WSL2）

| # | 检查项 | 实测结果 | 判定 |
|---|---|---|---|
| 1 | 是 Linux 用户态 | `Linux x86_64`（Ubuntu 26.04.1 LTS） | ✅ |
| 2 | 架构 | `x86_64` | ✅ 选 `linux-x64` |
| 3 | **streamlocal 转发** | 自建 python Unix socket + `ssh -L local:remote` 穿过 → **`ECHO:ping`** | ✅ **程序流可用**（决定性） |
| 4 | 远端 Node | 初始 `NO_NODE` → 用户态装入 **Node v24.21.0**（官方 SHA-256 `sha256sum -c` 通过）于 `~/.dsh-remote/node` | ✅ |
| 5 | 家目录可写 | `yes`（磁盘余量 908G） | ✅ |
| 6 | 外网可达 | `https://nodejs.org` → `HTTP/2 307` | ✅ 可远端直接下载（T2 可行） |
| 7 | 本地 ssh 支持复用与 streamlocal | `OpenSSH_10.3p1` | ✅ |
| 8 | **公钥认证可用** | 初始为密码认证 → 生成**无口令**专用密钥 + `ssh-copy-id` + `Host dsh-wsl2` 别名 → `ssh -o BatchMode=yes -o StrictHostKeyChecking=yes dsh-wsl2 true` **成功** | ✅ |
| + | **helper 依赖树** | `~/.dsh-remote/helper` 装入 11 个包（全 `0.1.7-rc.2` + `cordis@4.0.4`）；`node helper.js </dev/null` → **SMOKE=OK (exit=0)** | ✅ |

**已固定的配置值**（overlay 直接引用）：

```
NODE  = /home/kkutys/.dsh-remote/node/bin/node
HELPER= /home/kkutys/.dsh-remote/helper/node_modules/@deepseek-ai/dsh-ssh/lib/helper.js
HASH  = 42373bff731239ab5e50bfd908fba8d7e9b9f127463586fa346715135a8ada0b
WORKSPACE = /home/kkutys/dsh-ws
```

**两个操作要点**（源码实证，别忘）：
- 私钥**必须无口令**（或有 ssh-agent）：`BatchMode` 下带口令私钥命中 `SSH_ERR_KEY_WRONG_PASSPHRASE`
  会 `quit=1`（见 §5.5 步骤 2）。
- **不要**用 `npm i` 往 `kcoder-runtime` 里装 ssh 包：该运行时**没有 lockfile**，
  `npm i` 会按 `package.json` 重算整棵树（可能动到既有 81 个依赖）。
  改用「`npm pack` 到临时目录 + 解包进 `node_modules/@deepseek-ai/`」这种外科式投放
  ——4 个包的 peer 在该运行时里**已全部存在且版本精确匹配**，不会产生重复类身份。
  （**后续修正**：包放 runtime 是**错的**——加载器的解析基准是 **profile 目录**，
  见 §6.2 的解析模型。）

### 6.2 P0 判决：**通过**（2026-09-26）✅

headless 会话里让 agent 用 bash 跑 `pwd; whoami; hostname; uname -a`，**原样输出**：

```
/home/kkutys/dsh-ws
kkutys
kkutysllb
Linux kkutysllb 6.18.33.2-microsoft-standard-WSL2 #1 SMP PREEMPT_DYNAMIC Thu Jun 18 21:54:43 UTC 2026 x86_64 GNU/Linux
退出码：0
```

**`microsoft-standard-WSL2` 是无可争议的证据**：这条 bash 执行在 WSL2 上，不在 macOS。

由此**逐环验证成立**：

| 环节 | 结论 |
|---|---|
| profile overlay（禁用本地行 + 插入 SSH 行） | ✅ 组合正确、模块可加载 |
| `dsh-ssh` 连接 + helper 握手 + `helperHash` 校验 | ✅ |
| 密钥认证 + `known_hosts` + ssh 别名（§5.5 引导） | ✅ |
| **streamlocal 转发**（程序流的承载） | ✅ bash 的 stdout 回来了 |
| helper 供给（用户态 Node + npm 装 9 依赖） | ✅ |
| **headless 的 cwd 走 `ctx.fs`**（§1-F3） | ✅ `pwd` = 远端 workspace `/home/kkutys/dsh-ws` |
| 工具面跟随世界 | ✅ `bash-sandbox`→`ctx.shell`→`ctx.subprocess`→远端 |

**⇒ 「让 agent 真的在远程主机上完成任务」在引擎层已被证明可行。剩下的唯一缺口是 Web 层**
（工作区注册表仍用 `node:fs`，见 §2 与 P1 的 E1–E5）。

#### 6.2.1 一条必须记住的解析模型（踩过一次）

裸模块名的解析基准是 **profile 目录**，不是 runtime：

- `packageDirFromParent(name, parentURL)` 用 `createRequire(parentURL).resolve.paths(name)`
  （`app-boot/src/profile-resolution/service.ts`），`parentURL` = profile 的配置文件；
- profile 层的拦截层是 `<profileParent>/node_modules`，且只对 `localPackageNames` 里的名字生效
  （`resolver.ts:186`、`:562`）；
- 安装自有包（`@deepseek-ai/dsh-base` 等）走**拦截层**（installation 作用域条目），
  所以 web profile 里 `node_modules/@deepseek-ai` 是**空的**却能正常加载。

⇒ **out-of-tree 包（含本方案的 4 个 ssh 包）必须落在 `<profile>/node_modules/` 下**，
其缺失的 peer 再回落到 installation 解析（保证共享同一个 `cordis` 实例）。

P0 的落地方式：`ln -sfn $RUNTIME/@deepseek-ai/<pkg> $PROFILE/node_modules/@deepseek-ai/<pkg>`。
用**符号链接**还有额外好处——Node 默认解析 realpath，peer 直接在 runtime 里命中同一份实现，
不会造出第二份 `FileSystem` 类身份。产品化时改为 pnpm 正常装进 profile。

#### 6.2.2 产品化时必须补的一件事

P0 是手工投放。**产品化要求内置 bundle 声明这 4 个包为依赖**，让 KCoder 的
`materialize()`/pnpm 把它们装进 profile（§4-D P8），否则每台机器都要手工摆一遍。

---

### 6.3 P1 实现记录（2026-09-26，已编译部署，待真机验收）

**改动清单（4 个文件 + 2 个 manifest/tsconfig）**

| # | 文件 | 改动 |
|---|---|---|
| E1–E3 | `packages/workspace/workspace/src/world.ts`（**新增**）、`src/index.ts`、`src/entity.ts` | 6 处规范化 + 4 处 stat + 1 处 mkdir 全部改走「挂载的执行世界」 |
| E4 | `packages/host/directory-picker-browse/src/index.ts` | 新增**世界感知路径**：`ctx.fs` 挂载时用 `resolve/listDir/stat/processPath` 列举该世界；未挂载时保留原 host 路径**一字不改** |
| E5 | （无源码改动） | overlay 里禁用 `directory-picker`(auto) 并直接挂 `-browse` 两面 |
| — | `workspace/package.json`、`directory-picker-browse/package.json` + 两个 `tsconfig.json` | 增 `dsh-fs` / `dsh-shell` peer+dev 依赖与 project references |

**两个关键设计点**

1. **世界感知 + 宿主回落**（`world.ts` 的 `worldFs(ctx)`）：
   `ctx.get('fs')` 挂载则用它，否则退回本进程文件系统。
   无世界时「宿主文件系统**就是**世界」——所以这不是兼容 hack，而是语义自洽。
   代价为零回归：两包原有测试（`77 + 13`）全绿。
2. **`FileSystem` 没有 mkdir**：建目录走**世界自己的 shell**（`ctx.shell`，
   即 `bash` 用的同一 seam，已指向该世界），命令为 `mkdir -- <quoted>`（**不加 `-p`**，
   以保住「父目录不存在就是失败」的原有语义）。

**E4 的一个取舍（如实记录）**：原 host 路径用 `opendir` 流式 + `boundedInsert` 有界窗口，
内存 O(keep)；世界路径用 `ctx.fs.listDir`，它按 seam 契约返回**整层**数组，
故超大目录的内存特性不如流式版本。seam 本来就要求后端自行界定完整结果，
后续要恢复流式需扩展 `FileSystem` 契约。

**编译与部署方式（P1 验收用，非产品化）**

- 本仓源码改动**不影响**已部署的 runtime（runtime 是 `deploy --prod` 物化出来的）。
- 本次做法：`tsc -b <pkg>` → `tsdown`（`fixedExtension:false`，产物 `lib/index.js`）
  → 外科式覆盖 `kcoder-runtime/node_modules/@deepseek-ai/<pkg>/lib/index.js`
  （原件已备份为 `lib/index.js.orig-bak`，可一键还原）。
- **产品化必须走 fork 构建**：`scripts/release.sh` 从集成分支重新物化 runtime，
  手工覆盖只是 P1 验证手段。

**E5 是上游明说的做法**：`dsh-web-app/cordis.patch.yml:91-95` 的注释写着
*"Mount -native or -browse directly in an overlay to pin the interaction."*
—— 无需改引擎。

### 6.4 P1 端到端验收：**通过**（2026-09-26，Web UI 实测）✅

**用户的目标已达成**：在 Web 的「选择工作区」里浏览并选中**远端目录**，工作区建在远端，
会话在该工作区里跑，agent 的 `bash` 真的执行在远端。

实测链路（端口 8892 的 sidecar，overlay = `.tmp/ssh-world-web-overlay.yml`）：

| 步骤 | 实测结果 |
|---|---|
| 打开「添加工作区」 | 对话框列出**远端**目录：面包屑 `/ → home → kkutys`，条目 `dsh-ws` / `miniconda3` / `models` |
| 选中远端目录建工作区 | 工作区 `dsh-ws` 出现在侧边栏（路径 `/home/kkutys/dsh-ws`） |
| 在其中新建会话 | ✅ 建成功（修复前失败，见下） |
| agent 执行 `pwd; whoami; hostname; uname -a` | `/home/kkutys/dsh-ws` · `kkutys` · `kkutysllb` · **`Linux … microsoft-standard-WSL2 … GNU/Linux`**（退出码 0） |

**旁证**：侧边栏里既有的本地工作区（`AIDC`/`素材`）在远程世界里被正确判为不可用 ——
控制台报 `its cwd '/Users/libing/AIDC' is not a directory`。这正是世界切换生效的证据。

#### 6.4.1 P1 期间发现并修掉的三个真实缺陷

三个都是「本地 cheap / 远端灾难」或「本地语义漏到远端」的典型，值得留档：

1. **启动时的 O(会话数) 远端往返**（我引入的）
   `workspaceRegistry.indexHeaders` 对**每个**已存会话头做一次世界 canonicalize。
   真实 profile 有 **1446 个会话头 / 33 个不同 cwd** ⇒ 启动变成 1446 次串行远端往返，
   web sidecar 直接卡住不出 ready 行。
   **修**：按**去重后的 cwd** 记忆化（`indexHeaders` 的 `resolutions` Map），1446 → 33。
   *症状很隐蔽*：headless 下看不出来（会话少），web 下表现为"启动无输出"。

2. **会话层还有一处 host `node:fs`**（原有代码）
   `api/session-controller/src/agent.ts:481` 用 `node:fs` 的 `mkdir(cwd)` 确保会话项目目录，
   远端 cwd 下必然 `ENOENT: mkdir '/home/kkutys'`。
   **修**：改用共享的世界助手 `ensureDirectoryInWorld(ctx, cwd)`
   （由 `@deepseek-ai/dsh-workspace` 导出；session-controller 本就 peer 依赖它，故无新依赖）。

3. **`spawn … ENOENT` 的真因是 cwd，不是缺二进制**（我一度误判）
   世界里的 shell 调用没传 `workdir`，落到 executor 默认值 = **本机 cwd**（macOS 路径）；
   远端 spawn 遇到不存在的 cwd 会报 `ENOENT`，且**错误信息指向命令名**（`spawn bwrap ENOENT`），
   极易误判成"远端没装 bubblewrap"。实测远端 `bwrap` 是有的（`/usr/bin/bwrap`，0.11.1）。
   **修**：世界 shell 调用显式传 `workdir` —— `ensureDirectoryInWorld` 用世界默认目录，
   选择器的建目录用**当前列出的父目录**。

> **教训（值得写进团队清单）**：跨世界执行时，`cwd`/`workdir` 是**世界里的路径**，
> 任何继承本机 cwd 的默认值都会在远端炸，而且报错指向命令而非目录。

#### 6.4.2 本轮仍未覆盖的边界（诚实清单）

- **只验了 POSIX 远端**：`fullyQualified` / `join` / `ancestryCrumbs` 用的是宿主 `process.platform`
  语义，macOS 宿主 + Linux 远端正确；**Windows 宿主**或不一致平台组合未验。
- **`listDir` 返回整层**：世界路径失去了原 host 路径的流式有界窗口（超大目录内存特性退化，见 §6.3）。
- **沙箱**：本轮用 `workspace-write` 通过（远端 `bwrap` 在位）。被控端若无 `bwrap`，
  受限模式会失败——这属被控端前置，需并入 §5.6 清单。
- **写死 mode 的副作用**：试过 `danger-full-access` 会让 `permission` 行激活失败
  （`composed sandbox and approval defaults match no preset`）——**不要**用它绕过沙箱问题。

### 6.5 后续推进记录（2026-09-26）

#### (a) 引擎改动已按 fork 流程落分支 ✅

分支 `fix/remote-workspace-world-resolution`（fork 仓 `~/kk_Projects/deepseek-harness`），两笔提交，
lefthook 全部门通过（lint / 第三方声明 / 空白 / vendor 守卫）：

| 提交 | 内容 |
|---|---|
| `90269de8d2` | `fix(workspace,directory-picker,session-controller)`：9 文件 +416/−40（含新增 `world.ts`） |
| `8eb68f5584` | `test(directory-picker-browse)`：新增世界路径测试 5 例（stub FileSystem，无需 SSH） |

> 按 FORK-WORKFLOW 规则 4，集成分支不接受裸提交；**合并进 `kcoder/0.1.7-rc.2` 由产品负责人决定**。

#### (b) P2 第一刀：供给流程已工具化 ✅（其余待续）

新增插件脚本 [scripts/provision-remote-world.mjs](/Users/libing/kk_Projects/dsh-kylin-ssh-tunnel/scripts/provision-remote-world.mjs)
（提交 `bfa8a2b`），把本轮手工验证过的引导流程固化：

```
node scripts/provision-remote-world.mjs --ssh dsh-wsl2 [--out overlay.yml]
  1 自检别名公钥登录（BatchMode）—— 失败时打印补公钥/写别名的具体命令
  2 探测远端 os/arch/home（非 Linux/macOS 直接拒绝，对齐上游前提）
  3 装/校验 Node（官方 tarball + sha256，免 sudo，用户态）
  4 装/校验 helper 与 peer 集（钉 0.1.7-rc.2 + cordis 4.0.4），并做依赖解析冒烟
  5 算 helperHash + 生成含 SSH 世界与 browse 选择器的 overlay YAML
```

**幂等**；在 WSL2 目标上**复现出手工流程完全相同的 helper 摘要**（`42373bff…`）。

**P2/P3 仍待做**（本轮的边界，未做）：
- 内置化打包：`bundle/<dir>` 四件套 + 声明 4 个 ssh 包为依赖 → 由 KCoder `materialize()`/pnpm 装进 profile
  （**这是产品化的关键**：现在靠手工 symlink 进 profile）；
- 供给逻辑从「运维脚本」搬进插件运行时（UI 一键引导 + 进度/自检结果）；
- 多 sidecar 编排（K1–K4）+ 连接模型。

#### (c) 边界验证结果

| 边界 | 结论 | 依据 |
|---|---|---|
| **Windows 宿主 + POSIX 远端** | ❌ **确认不可用**：`fullyQualified('/home/kkutys','win32') === false` ⇒ 选择器会拒掉 Linux 远端的路径 | 以 `platform` 参数实测（`darwin=true / win32=false`） |
| **超大目录** | ⚠️ 世界路径**无界**：helper 只转发 `ctx.fs.listDir`（[helper.ts:155](/Users/libing/kk_Projects/deepseek-harness/packages/ssh/ssh/src/helper.ts:155)），fs-local 的 `listDirectory` 全量 `readdir` ⇒ 整层跨 SSH 传回并被完整物化，失去原 host 路径的 O(keep) 流式窗口 | 代码实证 + 新增测试覆盖截断行为（`truncated` 正确） |
| 平台判据的正确落点 | 应据**世界**而非**宿主**的平台语义判断路径合法性；但 `FileSystem` seam 未携带平台事实 | 待设计决策，见 §7.2 新增项 |

> 两者都**不影响本轮已验证的 macOS 宿主 + Linux 远端**路径。

## 7. 风险与待拍板

### 7.1 风险

| 风险 | 说明 | 处置 |
|---|---|---|
| **远端部署门槛是硬门槛** | 需 Node + 允许 Unix socket 转发 + 可写安装路径；两端须 Linux/macOS | P0 先验证；给「无法满足」的目标机保留 `ssh_*` 诊断/兜底通道 |
| **多 sidecar 的资源与复杂度** | N 个 `dsh web` 进程 = N 份内存/端口/日志；会话与工作区分散在多个后端 | K3 的连接模型要在 P3 前定；限制并发连接数 |
| **fork 自有面扩张** | E1–E5 落在 `packages/workspace/workspace` 与 `packages/host/directory-picker-browse` 等上游活跃区，每次升版需重放（现自有面 47 文件） | 改动尽量小且机械；E5 若能靠配置而非代码解决优先配置 |
| **上游同区冲突** | 上述包上游仍在演进 | 落 `fix/*` 分支并记录到 `docs/upstream-*.md` 的完整性签名 |
| **`FileSystem` 无 mkdir** | E3/E4 需要建目录 | 先走 `ctx.shell`（§4-A），把 seam 扩展记为后续 |
| **helper 版本漂移** | helper 摘要与 KCoder 基线的 ssh 包版本必须同线 | `check-bundle-version-line.mjs` 覆盖；供给时校验版本 |
| **Windows 控制端** | 上游要求两端 Linux/macOS；KCoder 有 win32 构建 | Windows 上远程功能**不可用**，需 UI 明确降级而非报错 |

### 7.2 待拍板

1. **K3 连接模型**：每个远程主机开**独立窗口**（类 VS Code Remote，最省、语义最清），
   还是在**同一窗口内切换连接**（需聚合多后端的会话/工作区列表，复杂度显著更高）？
2. **helper 投放方式**：T1（打包投放，离线可靠）vs T2（远端 npm，省事但依赖网络）。
   用户期望「首次连接自动下载安装」⇒ 建议 **T2 优先、T1 兜底**（自动探测远端网络，
   不通则回退本地中转投放）。§5.6 第 6 条就是这个探测点。
3. **T3（单文件打包 helper）** 是否投入探针？（可把供货从 7.8 MB 降到百 KB 级）
4. **`ssh_*` 工具面如何收缩**：**已定必须保留引导/自愈所需的最小集**
   （`ssh_hosts` / `ssh_status` / `ssh_run` / `ssh_read` / `ssh_write` —— 引导要写
   `authorized_keys`、投放文件、跑探测命令）。可评估收缩的是 `ssh_edit` / `ssh_glob` /
   `ssh_grep` / `ssh_push` / `ssh_pull`：其中 push/pull 在 T1 投放时仍有用。
5. **是否需要「非 WSL2 目标」的降级策略**：WSL2 上的 sshd 与网络形态（Windows 端口转发到 WSL2）
   可能带来额外延迟/断连特征，需要实测连接稳定性（§6 P0 一并观察）。

---

## 8. 附录：已核实事实

| 事实 | 出处 |
|---|---|
| 上游 SSH 执行世界四包与服务名 | [packages/ssh/README.md](/Users/libing/kk_Projects/deepseek-harness/packages/ssh/README.md) |
| 四包 npm 已发布且含 `0.1.7-rc.2`（`next`） | `registry.npmjs.org` 实测 |
| 当前运行时**未安装**四包 | `kcoder-runtime/node_modules/@deepseek-ai/` 实测 `MISSING` |
| 内置工具消费 `ctx.fs`/`ctx.shell`/`ctx.subprocess` | tool-fs:22、tool-bash:34、tool-fs-search:70 |
| 文件树/改动源已全走 `ctx.fs` | [api/workspace-files/src/index.ts:184](/Users/libing/kk_Projects/deepseek-harness/packages/api/workspace-files/src/index.ts:184) |
| headless 的 cwd 走 `ctx.fs`（范式） | [bundle/headless/src/index.ts:344](/Users/libing/kk_Projects/deepseek-harness/packages/bundle/headless/src/index.ts:344) |
| 工作区包三处硬编码 `node:fs` | paths.ts:6、entity.ts:11、index.ts:9 |
| 选择器 browse 后端硬编码 `node:fs` | [directory-picker-browse/src/index.ts:12](/Users/libing/kk_Projects/deepseek-harness/packages/host/directory-picker-browse/src/index.ts:12) |
| `FileSystem` 无 mkdir | [fs/fs/src/index.ts:87](/Users/libing/kk_Projects/deepseek-harness/packages/fs/fs/src/index.ts:87) 方法表 |
| 会话头 cwd 必须 `isAbsolute` | [session-format-v3-to-v4/src/validation.ts:31](/Users/libing/kk_Projects/deepseek-harness/packages/session/session-format-v3-to-v4/src/validation.ts:31) |
| 会话日志目录由 cwd 派生 | [session-persistence-jsonl/src/format.ts:225](/Users/libing/kk_Projects/deepseek-harness/packages/session/session-persistence-jsonl/src/format.ts:225)、[:267](/Users/libing/kk_Projects/deepseek-harness/packages/session/session-persistence-jsonl/src/format.ts:267) |
| attach 要求 `realpath(cwd) === record.path` | [workspace/src/entity.ts:138](/Users/libing/kk_Projects/deepseek-harness/packages/workspace/workspace/src/entity.ts:138) |
| profile 行 id 与行号（subprocess/sandbox/fs-sandbox/sandbox-policy） | [dsh-base/cordis.patch.yml](/Users/libing/Library/Application%20Support/KCoder/kcoder-runtime/node_modules/@deepseek-ai/dsh-base/cordis.patch.yml) 219/225/517/228（行 `- id:` 所在行；`name:` 在下一行） |
| KCoder 单侧车现状 | [dsh-manager.ts:4](/Users/libing/kk_Projects/KCoder/desktop/main/dsh-manager.ts:4) |
| 内置 bundle 物化与注册机制 | [kcoder-skills-bundle.ts:234](/Users/libing/kk_Projects/KCoder/desktop/main/kcoder-skills-bundle.ts:234) |
| helper 的远端裸依赖清单 | 从 `lib/helper.js` + chunks 的 `from "…"` 实测提取 |
| helper payload 体积 ≈ 7.8 MB | `du -sh` 实测 |
| 上游明确 Web 侧 deferred | [posix-ssh-runtime note](/Users/libing/kk_Projects/deepseek-harness/.agents/notes/implemented/architecture/2026-09-11-posix-ssh-runtime.md) |
| 插件在 dev profile 以 link 安装 | `~/.kcoder-dev/profiles/web/package.json`（bundles + deps） |
| fork 交付路径（集成分支 + BASELINE + release 物化） | [upstream/FORK-WORKFLOW.md](/Users/libing/kk_Projects/KCoder/upstream/FORK-WORKFLOW.md) |
