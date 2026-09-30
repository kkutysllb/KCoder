# SSH provider 包「异常」修复（紧急验证 + 结构性修复）

## Goal

让 4 个 `@deepseek-ai/dsh-*-ssh`（0.2.0-rc.2）provider 包不再以「用户级插件 / 异常」形态出现在 dsh 插件管理页，且它们装不上时不再锁死 profile 的 pnpm 操作；先做紧急修复验证，再落地结构性修复并通过仓库既有校验。

**状态：已完成（代码 + 仓库门全过；真机端到端需下次发版构建验证，见进度日志「未验证面」）。**

## Task List

### 阶段 0：计划与证据固化 — complete
- [x] 建立计划文件
- [x] 固化根因证据（heal 日志 / registry 探测 / 宿主判定链 / 解析层机制）

### 阶段 1：紧急修复 + 验证 — complete
- [x] 确认产品自身的安装入口与参数（vendored pnpm 11.7.0）
- [x] 为受影响 profile 配置官方 registry（profile 级 `.npmrc`，作用面最小）
- [x] 执行 profile 安装 `pnpm install` → exit=0（+15 包，8.9s）
- [x] 验证 4 个包实体存在且版本 = 0.2.0-rc.2
- [x] 验证宿主解析链不再抛错（红-绿）
- [x] 记录验证证据

### 阶段 2：结构性修复 — complete
- [x] 方案选型（随包分发 vs 触发条件修正 vs 发版闸补齐）
- [x] 随包 runtime 供给 provider（`materialize-peers.mjs`）
- [x] 桌面侧摘除 profile 通道 + 自愈清理（`preset-plugins.ts`）
- [x] 发版闸：产物级断言 + 探针（`verify-runtime-providers.mjs` / `probe-profile-providers.mjs`）
- [x] 文档同步（`remote-workspace-route-b.md` / `kcoder-skills-bundle.ts` / `check-bundle-version-line.mjs`）
- [x] 仓库既有校验通过（typecheck / bundle-line / node --check）

## Findings

### 根因链（2026-09-30 排查结论）

1. `desktop/main/preset-plugins.ts` 的 `PRESET_RUNTIME_DEPS`（旧）把 4 个 provider 精确钉在 `0.2.0-rc.2`，写进 profile `dependencies`（用户安装通道）。
2. 这 4 个包**既不在随包 runtime**（实测 `@deepseek-ai` 下无任何 `*ssh*`），**也不在 profile node_modules** → 宿主解析不到。
3. 本机 pnpm registry = `https://registry.npmmirror.com/`（`pnpm config list` 实测）；该源**至今无 0.2.0-rc.2**（HTTP 404 实测），官方 npmjs 为 200。
4. profile `pnpm install` 失败：`plugins-heal.log` 记录 2026-09-30T10:56:27 与 12:28:33 两次 `exit=1`，及 `ERR_PNPM_NO_MATCHING_VERSION ... @deepseek-ai/dsh-fs-ssh@0.2.0-rc.2 ... registry.npmmirror.com`。
5. 宿主判定：`@deepseek-ai/dsh-plugin-manager` `listBundles()`（`lib/index.js:1456-1518`）对 profile deps 里的包 `installed=true`；`bundleManifest()` → `resolveBundleDir()`（`@deepseek-ai/dsh-app-boot/lib/index.js:901-907`）两锚点都解析不到即抛错 → catch 因 `installed` 为真入列 → `error = { code:'operation-error', diagnostic:'dsh: cannot resolve profile bundle ...' }`。
6. UI 判据：`PluginManagerPage.tsx:294-296` `pkg.error !== undefined → 'problem'` → 渲染 `statusProblem:'异常'`（`locales.ts:28`）。
7. 分组判据：`PluginManagerPage.tsx:1280-1283` —— `listed` 只保留 `installed || optional || error`，`mine = installed || !optional`；`installed` 的定义是「profile 自己的 dependencies 持有该包」⇒ **写进 deps 就必然以用户级插件出现**。截图「已安装 6」= 本 profile deps 全集（dsh-context + schedule + 4 个 ssh），数量吻合。

### 触发条件缺陷（2026-09-27 现场，日志实证）

`preset-plugins.ts` 的 `needInstall = presetNames.some(...)` 只看 `PRESET_PLUGINS`。
`plugins-heal.log` 2026-09-27T15:20:53 记录「已补写依赖声明: …@deepseek-ai/dsh-ssh, @deepseek-ai/dsh-fs-ssh, @deepseek-ai/dsh-subprocess-ssh, @deepseek-ai/dsh-sandbox-ssh」紧随「预置插件均已安装」——**声明写了但没有触发安装**，4 个包悬空三天，直到 schedule bundle（09-30 新增）因 profile 缺实体才触发一次注定失败的 install。

### 解析层机制（决定修复方案的关键，已查实）

`dsh-app-boot` 的 `collectInstallationScopePackages()`（`lib/index.js:681-725`）从**安装清单的 `dependencies` + `peerDependencies` 传递闭包**收集 installation-scope 条目，供所有 profile 解析（`createRuntimeResolution` → `scope:'installation'`）。
⇒ 设计文档 `remote-workspace-route-b.md` 旧结论「仅把包塞进 runtime 的 node_modules 不生效（P1 实测 failed to import）」的**真实条件是没登记进安装清单**；**落位 + 登记**两件一起做即可生效——这正是随包 schedule bundle 能在 profile 无实体时被解析加载的原因。

### 连带缺陷

- 幽灵依赖锁死整树：4 条 deps 装不上时 profile 内**任何** pnpm 操作都失败（整树解析）。实证：2026-09-30T11:51:02 用户点「更新 dsh-context」→ `exit=1`、版本未变。
- 发版闸不覆盖：`check-bundle-version-line.mjs` 只校验「声明与物化同线」，无 registry 探测；`PRESET_RUNTIME_DEPS` 不在其校验范围。

## Decisions

**选型：随引擎分发（不是修 profile 通道，也不是只补发版闸）。**

- 理由 1（用户判断成立）：provider 是内置 bundle `dsh-ssh-remote` 的运行前提，**不是插件**（无 `dsh.bundle` 元数据），以用户级插件身份出现是错误表述；profile 通道无法既保留声明又不在插件页出现（`installed` 语义决定）。
- 理由 2：走 profile 通道 ⇒ 能力可用性绑定用户 registry/网络（镜像滞后即整页异常 + 依赖图报废）；随引擎分发把这两类失败面一起消掉。
- 理由 3：版本对齐由构造保证——供给版本从 staging 内同线包推导（provider 的 peer 精确钉引擎版本），不再需要任何地方手工维护或平移。
- 被否方案：① 仅扩触发条件（不解决「用户级」表述，且仍绑 registry）；② 仅补发版闸（不解决存量悬空与红标）；③ 把包物化进 profile node_modules 但不声明（能隐身，但 pnpm 剪枝会冲掉、需每次启动重物化，机械面更大）。

**供给形态**：`materialize-peers.mjs` 额外做两件事——把 4 个包实体落进 staging 顶层 `node_modules`，并写进 `staging/package.json` 的 `dependencies`（后者让它们进 installation scope，并纳入该脚本末尾既有自检的强制面）。

**清单单一来源**：新增门与探针都从 `materialize-peers.mjs` 文本解析 `PROVIDER_PACKAGES`（仓内既有约定：`check-bundle-version-line.mjs` 同法解析 `PRESET_PLUGINS`），避免清单漂移。

## Progress Log

### 阶段 1（紧急修复，真机 C:\Users\13609\.dsh\profiles\web）

- 写入 profile 级 `.npmrc`：`registry=https://registry.npmjs.org/`（作用面仅该 profile；本机全局 pnpm config 指向 npmmirror）。
- `node <runtime>/tools/pnpm/bin/pnpm.mjs install`（cwd=profile，产品同款 vendored pnpm 11.7.0）→ **`EXIT=0`，`Packages: +15`，`Done in 8.9s`**。
- 版本核对：`@deepseek-ai/dsh-{ssh,fs-ssh,subprocess-ssh,sandbox-ssh}` 均 `0.2.0-rc.2`；顺带补齐 `dsh-experimental-schedule-bundle` 及其依赖。
- 宿主解析链验证（直接 import 运行时自己的 `resolveBundleDir`/`readProfileManifest`，不重写逻辑）：
  - GREEN：4/4 `OK ... installed=true enabled=false` → 判定「不入列（无 dsh.bundle 且未选中）」→ `EXIT=0`
  - RED（临时移走 `dsh-fs-ssh`）：`RESULT: 1/4 unresolvable → host reports operation-error（「异常」）` → `EXIT=1`
  - 恢复后复跑：4/4 → `EXIT=0`；目录已还原（`Test-Path` = True）
- 结论：**异常红标的直接原因（宿主解析失败）已消除**；按宿主代码路径，这 4 个包在页面上会**整体消失**（不再出现在「已安装」组）。

### 阶段 2（结构性修复，改动集）

| 文件 | 改动 |
|---|---|
| `scripts/materialize-peers.mjs` | 新增 `PROVIDER_PACKAGES` + `engineTrainVersion()` + 供给块（隔离目录 npm 安装 `--legacy-peer-deps`、只落 provider 本体、登记进 staging 清单） |
| `desktop/main/preset-plugins.ts` | 删除 `PRESET_RUNTIME_DEPS`，改 `RUNTIME_PROVIDED_PACKAGES`（仅自愈用）；`MANAGED_PROFILE_DEPS` 只含真插件；自愈扩展为「声明 + 实体 + 层叠污染」三清 |
| `desktop/main/kcoder-skills-bundle.ts` | 两处注释改述运行前提来源 |
| `scripts/release.sh` | build 段（staging）与 verify 段（打包后 tar）各加一道 provider 随包断言 |
| `scripts/verify-runtime-providers.mjs` | 新增：产物级断言（目录/tar 双模式，离线） |
| `scripts/probe-profile-providers.mjs` | 新增：复刻宿主判定链的排查探针（参数化） |
| `scripts/check-bundle-version-line.mjs` | 注释改述覆盖关系 |
| `docs/remote-workspace-route-b.md` | 增补「2026-09-30 取代」段（含机制查实结论） |

### 验证证据（本会话实跑）

| 命令 | 结果 |
|---|---|
| `pnpm typecheck`（tsc node + web + check-injected-scripts） | `EXIT=0`；注入脚本门输出「零悬空引用 / client 半协议合规」 |
| `node --check` × 3（materialize-peers / verify-runtime-providers / check-bundle-version-line） | 全部 `EXIT=0` |
| `node scripts/check-bundle-version-line.mjs` | `[bundle-line] 通过 ✓`，`EXIT=0` |
| `node scripts/verify-runtime-providers.mjs <合成 fixture 目录>` | GREEN `EXIT=0`；缺实体 / 版本不一致 / 未登记 三种 RED 均 `EXIT=1` 且报出准确原因 |
| `node scripts/verify-runtime-providers.mjs <fixture.tar.gz>`（带 `./` 前缀） | GREEN `EXIT=0`；缺实体 RED `EXIT=1`（修掉了 Windows `join()` 反斜杠 vs tar `/` 成员名的真实 bug） |
| `node scripts/verify-runtime-providers.mjs <真实 0.6.19 运行时>` | **RED `EXIT=1`**：4 处「未登记进引擎清单 dependencies」= 今天这个缺陷的形态，证明该门能在发版时拦住 |
| `node scripts/probe-profile-providers.mjs`（本机真实 profile） | 4/4 解析自 profile，判定「不入列」 |
| `node scripts/probe-profile-providers.mjs --runtime <合成锚点> --profile <自愈后 profile>` | **4/4 解析自「安装锚点（随引擎分发）」**，判定「不入列、无红标」= 结构性修复的目标态 |
| 同上，锚点抽掉一个 provider | `1/4 解析失败 → 宿主会报 operation-error`，`EXIT=1`；还原后 4/4 `EXIT=0` |

### 未验证面（诚实边界）

- **未跑整条发版构建**：`bash scripts/release.sh build` 需要上游克隆（`kcoder/0.2.0-rc.2` 集成分支）+ `pnpm deploy` + 打包，本会话未执行 ⇒ `materialize-peers.mjs` 供给块与 release.sh 两道门**未经真实构建验证**（其语法、清单文本解析、门逻辑均已单独验证）。
- **桌面侧自愈未在真实启动路径上执行**：`ensurePresetPlugins` 由 Electron 主进程在 dsh 启动前调用，纯 node 无法加载（依赖 electron 运行时）；本轮以 `tsc` 类型检查 + 代码走查 + 宿主判定链探针替代。发版后的首次启动应以 `plugins-heal.log` 出现「退役/迁移声明已清理: @deepseek-ai/dsh-ssh, …」与「已删除退役/迁移包实体: …」为验收信号。
- **插件页视觉确认**：需重启应用（本会话运行在被重启对象内部，不能自行重启）。重启后该页「已安装」应只剩 dsh-context 与 schedule bundle，4 个 ssh 条目消失。

### 回滚

- profile `.npmrc`：删除 `C:\Users\13609\.dsh\profiles\web\.npmrc` 即回到原 registry 行为。
- 代码改动：`git checkout -- desktop/main/preset-plugins.ts desktop/main/kcoder-skills-bundle.ts scripts/materialize-peers.mjs scripts/release.sh scripts/check-bundle-version-line.mjs docs/remote-workspace-route-b.md` + 删除两个新增脚本。

## Errors

| 现象 | 处置 |
|---|---|
| `node --input-type=module` 自测首次失败：fixture 目录未建 | `build()` 里补 `mkdirSync(fix, { recursive: true })` |
| 门的 tar 模式误报「实体不在产物里」 | 根因：Windows `join()` 产出 `\`，tar 成员名用 `/`；`readMember` 统一换算为 POSIX 分隔再查表 |
| `probe-profile-providers.mjs` 合成场景报 `ERR_MODULE_NOT_FOUND`（找 dsh-app-boot） | 根因：把「实现来源」与「解析锚点」混为一谈；改为实现从任一含 dsh-app-boot 的运行时导入（锚点仍取 `--runtime`），并打印来源 |
