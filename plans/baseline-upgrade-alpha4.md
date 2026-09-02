# KCoder 上游基线升级：0.1.2-alpha.3 → 0.1.2-alpha.4

## Goal
按 `upstream/BASELINE` 记载的惯例流程，将 KCoder 的上游基线从 0.1.2-alpha.3 (dd6322d6) 升级到 0.1.2-alpha.4（tag `dsh-v0.1.2-alpha.4`）：fork 上重建集成分支 `kcoder/alpha.4` → 更新 KCoder 锚点文件 → setup.sh 构建 → 全量回归 → 提交。

## Task List

### Phase 1: 状态收集与 diff 分析
- [ ] fork 克隆 fetch origin，确认 `dsh-v0.1.2-alpha.4` 指向的基线提交 SHA
- [ ] 统计 alpha.3 → alpha.4 提交数 / 文件数
- [ ] 解剖 `kcoder/alpha.3` 集成分支组成（merge 的修复分支 + cherry-pick 提交）
- [ ] alpha.3→alpha.4 diff 逐项核对 KCoder 注入锚点（railMark/brandName、turnTail、settings.plugin.item、sendSession 5 参、webServer.register、composer 骨架 data-composer-*、selectProducedFiles/producedForClosing、sidebarCol/centerCol、dsw 变量体系）
- [ ] 检查 KCoder 仓库内对 alpha.3 / 版本门的引用点（native-overlay 等）

### Phase 2: fork 重建集成分支
- [x] 基于 alpha.4 基线提交新建 `kcoder/alpha.4`
- [x] 依次 `merge --no-ff` 五个修复分支（与 alpha.3 组成一致）
  - 冲突 1：merge#1 llm-pi-ai/package.json（peer/dev dsh-invariants × pi-ai 范围）——alpha.4 起丢弃 dsh-invariants（#3367 后源码零引用），pi-ai 取 >=0.84.3 <1.0.0
  - 冲突 2：merge#4 projection-cache tests/cache.spec.ts 类型声明 map——secret 与 bad-only 各自保留（同 alpha.3）
  - 冲突 3：merge#5 llm-pi-ai/package.json 范围收口 ^0.84.4 + 保留上游 brand/util-values
- [x] cherry-pick 品牌化（98a16b2406）、imageRequestPricing（e6fe08a320）
- [x] 集成分支适配提交 a52870abea：projection-cache 隔离测试补 cachedSnapshot 第二参 SessionLogOffset(0)（alpha.4 签名变更，pre-push typecheck 门拦下后修复）
- [x] 完整性断言：kcoder/alpha.3↔alpha.4 差异文件列表与上游 alpha.3→alpha.4 一致（2371=2371，comm 零差）
- [x] 推送 `kcoder/alpha.4` 到 fork origin（a52870abea 本地=远端；pre-push typecheck 通过）

### Phase 3: KCoder 仓库锚点更新
- [x] `upstream/BASELINE`：末行 SHA → 4e84901e6471b79ec0338099867ebb4606d12bb5 + 追加 alpha.4 升级记录
- [x] `desktop/main/dsh-contract.ts`：UPSTREAM_BRANCH → kcoder/alpha.4（含注释）
- [x] `scripts/setup.sh`：UPSTREAM_BRANCH → kcoder/alpha.4
- [x] `scripts/release.sh`：集成分支断言注释+die 消息 → kcoder/alpha.4

### Phase 4: 构建 + 回归
- [x] `bash scripts/setup.sh`（exit 0：checkout 断言 + vendor 纯净闸 + install + build 三阶段，220 client 产物）
- [x] install 后无 lock 漂移（fork 工作树 HEAD = a52870abea，仅历史遗留未跟踪 png）
- [x] 定向回归：vitest llm-pi-ai + session-projection-cache + ui-chat = **614/614 通过**
- [x] Web UI 冒烟：`dsh web --port 0 --no-open` 就绪行含 token、未认证探测 401（BrowserAuth 门禁）、kcoder-skills 37 runtime skills 注册零错误
- [x] 打包链 smoke：`pnpm deploy --prod --legacy` + materialize-peers（瘦身 16683 map、签名 11 二进制、归档 57MB tar.gz、自检"非可选依赖可达且版本满足"）+ `bin.js --version` = 0.1.2-alpha.4
- 附注：KCoder 仓 `pnpm typecheck` 首跑因 pnpm `verifyDepsBeforeRun` 无 TTY 清 node_modules 中止（环境坑，与本次改动无关）；`--config.verifyDepsBeforeRun=false` 绕过后 tsc 双 config 零错误

### Phase 5: 提交
- [x] KCoder 仓库提交 `f928c4b`（feat(baseline): 上游基线升级 0.1.2-alpha.3 → 0.1.2-alpha.4，4 文件，与 e852828 同款形态）并推送 origin/main
- [x] smoke 临时物清理（/tmp deploy 目录、日志、diff 清单）

## Findings
- fork 本地克隆：`/Users/libing/kk_Projects/deepseek-harness`（origin=kkutysllb/deepseek-harness，upstream=官方）
- KCoder 当前钉版：dd6322d6 (0.1.2-alpha.3)，集成分支 `kcoder/alpha.3`（fork 本地克隆当前在其上，有若干未跟踪 png 截图，不影响分支操作）
- **新基线：tag `dsh-v0.1.2-alpha.4` = 4e84901e6471b79ec0338099867ebb4606d12bb5**（Merge PR #3427 release/dsh-0.1.2-alpha.4，上游根版本 0.1.2-alpha.4，pnpm@11.7.0）
- diff 规模：alpha.3→alpha.4 = **297 提交 / 2371 文件**
- **kcoder/alpha.3 复制配方**（first-parent 链，自底向上）：
  1. merge origin/chore/pi-ai-0.84.3-upgrade
  2. merge origin/fix/codex-protocol-auto-fallback
  3. merge origin/fix/markdown-model-sanitize
  4. merge origin/fix/session-projection-cache-per-unit-isolation
  5. merge chore/pi-ai-0.84.4-upgrade（本地分支 = 远端）
  6. cherry-pick 972beeb5c9（品牌化）→ 97c465b6cf（imageRequestPricing）
- 修复分支本地仅 chore/pi-ai-0.84.4-upgrade 在本地，其余用 origin/* 远端 ref
- **注入锚点核对（alpha.4 树 grep + diff 核对）——全部存活**：
  - railMark/brandName：SidebarRoot.tsx 未动；module.css 仅 +`corner-shape: round`（CSS 哈希会变）
  - turnTail：TurnTailNodeView.tsx 未在 diff；slot 链在
  - settings.plugin.item：ui-settings-plugins src 仅 CSS+invariant.ts；AgentLoopCard.tsx 未动
  - sendSession：KCoder 无活依赖（drag-to-attachment 已退役，仅注释引用）；service.ts diff 是 SessionSeq branded type 包装（atSeq），非签名破坏
  - webServer.register / rpc-host.ts：不在 diff
  - composer：data-composer-card=InputBar.tsx:390 存活；data-composer-input=ComposerContentEditable.tsx 不在 diff
  - selectProducedFiles/producedForClosing：turn-deliverables.ts 被动但两导出存活（buildLocationData 加了 previous 参数——上游内部用法）
  - sidebarCol/centerCol：AppFrame.tsx 未动，module.css 锚点行在（25/32 行）
  - data-conversation-composer-overlay：TrajectoryView.tsx:507 同位存活；ConversationRoot.module.css 4 处 :has 引用在
  - 注意：InputBar 移除 overlay/leftItems/rightItems/footer props 改为 slot（conversation.input.overlay/left/right、conversation.composer.dock）——上游内部 shell 重构，KCoder 无 props 级依赖（DOM 锚点注入），无影响
- KCoder 侧引用点：dsh-contract.ts:53-60（注释+UPSTREAM_BRANCH）、setup.sh:15、release.sh:107-112、verify-vendor-purity.sh 与 profile-patches.ts 仅注释提及 alpha.3 无需改
- profile-patches.ts 补丁目标为用户 profile 第三方插件（dsh-video-preview/dsh-context），与上游基线无关
- alpha.4 上游 PR 清单：#3425 ptc-disable-workflow-plugin、#3391 worktree-chatperf、#3418 ptc-note-cloudflare-link、#3415 turn-rail-preview-layer、#3346 session-format-02-seq-brands、#3411 smooth-corners、#3382 sdk-default-web-fetch、#3403 model-discovery-profile-headers、#3250 steer-service、#3367 omit-unneeded-invariants、#1148 code-runtime-python-backend、#2907 session-log-read-api
- 沙箱限制：fork 克隆在会话工作区外，一切写操作（fetch/merge/push/setup.sh 构建）需提权 danger-full-access

## Progress Log
- 2026-09-02 会话开始：确认惯例流程（BASELINE 尾部"升级基线的正确姿势"）与 fork 克隆位置
- 2026-09-02 Phase 1 完成：新基线 4e84901e64 确认、297 提交/2371 文件、锚点全部存活、复制配方固定（见 Findings）。git fetch 与 merge-tree 均被沙箱拒绝（fork 克隆在工作区外），Phase 2 需提权执行
- 2026-09-02 Phase 2 完成：kcoder/alpha.4 = 4e84901e + 五 merge（6e992887/dc7f627d/251df698/f037ac69/f532bb5e）+ 两 cherry-pick（98a16b24/e6fe08a3）+ 测试适配 a52870ab；完整性断言 2371=2371 零差；pre-push typecheck 通过后推送 origin
- 2026-09-02 Phase 3 完成：BASELINE（SHA + 升级记录）、dsh-contract.ts、setup.sh、release.sh 四处锚点更新
- 2026-09-02 Phase 4 完成：setup.sh exit 0（install+build 三阶段）；定向 vitest 614/614；Web 冒烟（就绪行/401 门禁/插件加载）；打包链 deploy+materialize-peers 自检通过，bin --version=0.1.2-alpha.4
- 2026-09-02 Phase 5 完成：KCoder 提交 f928c4b 已推 origin/main；/tmp 临时物已清理。**任务闭环**

## Errors
- 沙箱拒绝 fork 克隆（工作区外）一切写操作（fetch/merge-tree/merge/push/测试/物化）→ 逐段提权 danger-full-access 解决
- merge#1 llm-pi-ai/package.json 冲突：peer/dev 出现 dsh-invariants——alpha.4 #3367 已移除该依赖且合并后源码零引用，故弃用 alpha.3 的"保留"解法改为丢弃（记录进 BASELINE）
- merge#5 解决脚本 python 断言失败（冲突块 HEAD 侧多两行导致模式失配）→ 先诊断 git 状态确认 merge 仍在进行、文件含 3 个冲突块，改用完整块匹配解决；教训：heredoc python 与后续 git 命令未用 && 链，失败后仍继续执行了 add/commit 尝试
- pre-push typecheck 拦下 push：projection-cache 隔离测试 cachedSnapshot 单参旧签名（alpha.4 加必选 SessionLogOffset）→ 补第二参，适配提交 a52870ab
- 首次 deploy smoke 在 materialize-peers 之前手动 --version 探测 → ERR_MODULE_NOT_FOUND(cosmokit)——deploy 的 peer 盲区，release.sh 本就安排 materialize-peers 兜底；跑完整链后自检通过
- KCoder 仓 pnpm typecheck 触发 verifyDepsBeforeRun 无 TTY 清 modules 中止（环境坑）→ --config.verifyDepsBeforeRun=false 绕过，tsc 实际零错误
