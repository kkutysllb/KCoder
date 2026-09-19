# 全仓库审计报告 — v0.6.14

> 审计日期：2026-09-19 · 审计命令：`bash scripts/release.sh audit` · 结果：三门 PASS。
> 本版是 v0.6.11 起的审计制度中**首个出现实际发现项的版本**：LINT 初检 3 条 warning，
> 全部当场处置（非豁免），处置后复检 **0 warning / 0 error**。

## 硬性门

| 门 | 结果 | 说明 |
|---|---|---|
| TYPECHECK | ✅ PASS | tsc 双 project 零错误；链尾注入脚本自检通过（抽取 21 个注入脚本 / 42 个源文件，零悬空引用，bundle client 半协议合规） |
| LINT | ✅ PASS | oxlint 78 文件 / 96 规则：初检 **3 warning** → 逐条处置后 **0 warning / 0 error**（见下表） |
| SECURITY | ✅ PASS | 生产依赖无 high+ 漏洞（`pnpm audit --prod`） |

## 发现项与逐条处置

| # | 发现项 | 性质 | 处置 |
|---|---|---|---|
| 1 | `desktop/renderer/src/views/diagnostics.ts:98` — `eslint(no-control-regex)`：`/\x00(\d+)\x00/g` 匹配控制字符 | **有意为之**：NUL 是占位法哨兵，与 `desktop/main/update-injector.ts` 的 `renderNotes` 同构（码先摘成占位符 → 在占位文本上解析链接/加粗 → 回填）；该正则**只匹配本函数自己写入的占位符**，不校验任何外部输入，无安全面 | 加**定向**抑制 `// oxlint-disable-next-line no-control-regex` + 理由注释（就地说明哨兵来源与无外部输入）。**不改语义**：换成非控制字符哨兵会与 update-injector 的同一套语法覆盖脱钩，且换字符同样是一次未被需求驱动的行为变更。复检确认指令被消费、无 unused-directive 报错 |
| 2 | `scripts/materialize-peers.mjs:30` — `no-unused-vars`：`sep` 导入未使用 | 死导入（历史重构残留） | 从 `node:path` 导入清单移除；`node --check` 通过 |
| 3 | `scripts/check-injected-scripts.mjs:38` — `no-unused-vars`：`mkdirSync` 导入未使用 | 死导入（该脚本 09-18 落地时的残留） | 从 `node:fs` 导入清单移除；脚本独立执行 exit 0（21 注入脚本 / 零悬空引用） |

> 三条均属「清干净」而非「加豁免」——审计制度允许对安全类 warning 加注豁免理由，
> 但 2/3 是零风险的真死代码、1 是语义正确的定向抑制，故不占用豁免额度。

## 报告项（逐条沿用既有处置）

- **DEAD EXPORTS：0 项待处置**，另有 3 项已知豁免（`electron.vite.config.ts` 默认导出 ×1 = 构建链配置入口；`desktop/shared/ipc-contract.ts` ×2 = node/web 双 project 的 IPC 契约面类型，按设计导出）。豁免清单与 v0.6.11/0.6.12/0.6.13 完全一致，本版无新增。
- **UNUSED DEPS：10 项**（electron-vite, @types/node, electron, @shared/ipc-contract, semver, @types/semver, yaml, electron-updater, react, react-dom）——与 v0.6.0 / v0.6.1 / v0.6.11 / v0.6.12 / v0.6.13 **逐项完全一致**，属 depcheck 对 Electron 应用的固有误报：`electron` / `electron-vite` / `react` / `react-dom` 经构建链与运行时消费，`semver` / `yaml` / `electron-updater` 经主进程动态路径消费，`@shared/ipc-contract` 为路径别名导入（depcheck 不解析 tsconfig paths）。豁免理由沿用，不重复处置。

## 本版改动面（审计覆盖范围）

- **上游基线升级** 0.1.6-alpha.1 → 0.1.6-alpha.2：`upstream/BASELINE` 钉版 `ddefc45fbc` + 升级记录；`dsh-contract.ts` / `setup.sh` / `release.sh` 分支名同步为 `kcoder/0.1.6-alpha.2`；`docs/upstream-0.1.6-alpha.2-analysis.md`（分析 + §9 执行记录 + §9.10 铁律落档）。
- **升级阻断修复**：Electron 39 → **44.0.0**（alpha.2 profile 解析 `link → runtime` 的原生 addon 按 V8 指纹精确匹配）；运行时物化链三处止血（签名跳过已合规件 + flatten 链接落实体 + 递归下探/最终 sweep）。
- **产品面**：`product-policy.ts` overlay 三行（会话日志不上传 / 原生终端整行禁用 / 原生 changed-files 尾卡关闭 tailCard:false）；`style-overlay.ts` 恢复 `NATIVE_SIDEBAR_CSS`；`sidebar-cluster.ts` 代理重写为转发插件开关簇；`open-in-app-button.ts`（状态栏第四枚，编辑器按钮图标=应用身份）；`account-chip.ts` 语言/主题子菜单（经 `bundle/dsh-shell-prefs` 桥）；`file-activity.ts` 徽章链三修（authFetch cookie / asOfSeq 游标 / workspace-changes numstat + turn-end 探针）。
- **内置镜像同步**（`sync-bundles --check` 零差异）：`bundle/dsh-coding-sidebar` → **1.0.25**（新增「智能体团队」tab；设置页移除用户自加 Tab/预览入口；链接打开认领 / 浏览器 tab 上游对齐 / 工作区外读取 / 读取作用域随页签）、`bundle/dsh-file-review-kcoder` → **1.0.6**（原生评审开法接管）、新增 `bundle/dsh-shell-prefs`；`PRESET_PLUGINS` 声明 `dsh-coding-sidebar ^1.0.21` / `dsh-file-review-kcoder ^1.0.6`（声明取**已发布**版本；coding-sidebar 实体由 bundle 物化为 1.0.25，发布后平移，见复检结论）。
- **新增验证工具**：`scripts/probe-dev-review-open.mjs`——CDP 直连 dev 实例单次点击交付卡片判定落点（活动页签 + 原生三类宿主可见性），配 `docs/upstream-0.1.6-alpha.2-analysis.md` §9.11 的根因记录。
- **开发链修复（本轮现场）**：`pnpm dev` 报 `Error: Electron uninstall`——一次隐式 `pnpm install`（pnpm 11 的 `verifyDepsBeforeRun` 门）重链 `node_modules` 后，electron 的 postinstall 因本机不可达 GitHub releases 而未落二进制（无 `path.txt` / `dist/`）。处置：`pnpm-workspace.yaml` 显式 `verifyDepsBeforeRun: false`（脚本运行不再顺带重装，实测 typecheck 全程未触碰 `node_modules`）+ 新增 `scripts/fix-electron.mjs` / `pnpm fix:electron`（从本地缓存 zip 离线恢复，幂等、`--check` 可巡检）+ 本机 `~/.zshrc` 增 `ELECTRON_MIRROR`（npmmirror 实测可达，`install.js` 走它约 100s 装完）。恢复自证：`44.0.0 / node 24.18.1 / v8 15.2.124.13-electron.0`。
- **退役**：沙箱重复审批热修整链退役（上游 `61c548e200` 已在 alpha.2 内，下游补丁成死代码）——`dsh-contract.healBundledRuntime`、materialize-peers 应用块、脚本三件与 npm script、审计白名单全数移除。
- **文档**：`ARCHITECTURE.md` 新增 **§12 产品铁律**（①不使用上游原生侧边栏功能 ②新版本适配只改插件源码）+ §7/§8/§10 交叉引用；分析文档新增 §9.10。

## 复检结论

三门 PASS，LINT 复检 0 warning。处置后复跑验证：

| 复检项 | 命令 | 结果 |
|---|---|---|
| 全仓库审计（处置后） | `bash scripts/release.sh audit` | 三门 PASS / LINT **0 warning** |
| 注入脚本自检 | `node scripts/check-injected-scripts.mjs` | exit 0（21 脚本零悬空引用、client 半协议合规） |
| 内置镜像对账 | `node scripts/sync-bundles.mjs --check` | 零差异（与 dsh-plugins 真源一致） |
| fork 集成分支门禁实质 | `pnpm --config.verify-deps-before-run=false run typecheck`（于 `kcoder/0.1.6-alpha.2`） | exit 0（含 client 契约工程 tsc -b tsconfig.client.json） |
| 引擎定向回归 | `CI=true pnpm exec vitest run ui-chat llm-pi-ai llm session-projection-cache`（于 fork 尖端 `a01f995e87`） | **84 文件 / 1657 用例全部通过 / 0 失败**（exit 0） |
| 插件侧门禁（本轮新增，铁律 2） | `pnpm typecheck && pnpm test && pnpm build && pnpm smoke`（dsh-file-review-kcoder 1.0.6 / dsh-coding-sidebar 1.0.23） | typecheck exit 0；file-review smoke **45/45** + render **13/13**；coding-sidebar `tests/run-openpath-tests.mjs` **ALL PASS**（新增 50 条：认领语义 / 链接接管独占性 / 地址策略 / 导航状态机 / 读取作用域）；两侧 build + smoke 绿 |
| 工作区外读取（活体前后对照，已复验） | `node scripts/check-sidebar-fsread.mjs`（CDP 直连 dev 调 `/sidebar/api/fs.read`） | 修前（宿主半 1.0.22）：`403 forbidden: path "/private/tmp/…" is outside workspace`（复现用户报错）；修后（宿主半 1.0.23，dev profile 实测 1.0.23 且 `lib/index.js` 含 `resolveReadPath`）：同一请求 **200 / kind=text**（两个持久化会话均通过） |

## 发版过程记录（本版特殊：一次撤回与重发）

本版首次 `ship 0.6.14` 于 2026-09-19 完成（main `662cb67` + tag `v0.6.14`），CI 三平台构建进行中由用户实测发现**漏网之鱼**：点交付卡片仍弹原生侧边栏空白区。处置（详见 `docs/upstream-0.1.6-alpha.2-analysis.md` §9.11）：

1. **撤回**：`gh run cancel` 于 2m59s 拦下 CI（未产出任何平台包）→ 删除远端与本地 `v0.6.14` tag → GitHub Releases 无 v0.6.14 产物（最新仍是 v0.6.13）。
2. **根因**：上游改动卡发 `dsh-resource://changes-review/…`，侧边栏插件的文件门只认 `dsh-resource://file/…` → 落回原生右栏（外壳被压制 → 空白）。
3. **修复**：插件侧 `dsh-file-review-kcoder` 1.0.6 接管该家族（铁律 2：适配只改插件源码）；镜像链同步到 `bundle/`，KCoder 侧零适配代码。
4. **重发**：验收通过 + 插件 npm 发布后平移 preset 声明，重跑 `ship 0.6.14`（tag 指向含修复的提交）。
| 运行时内容断言 | 本地 `staging/kcoder-runtime.tar.gz` | 版本 `0.1.6-alpha.2`；`tailCard = config.tailCard !== false` 与 `statAdded` 着色均在包内；ui-deliverables client 半无 schemastery 导入（仅注释提及） |

本版无安全修复项；发布前 fork 集成分支已推送至 `a01f995e87`（CI 从 GitHub 克隆 fork 构建运行时——tag 早于 fork push 会让发布物与本地验证脱节，这是 `brand-assert.mjs` 存在的理由，本版按该纪律先行推送）。
