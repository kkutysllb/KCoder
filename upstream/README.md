# 上游补丁存档

内嵌的 `deepseek-harness/` checkout 必须保持纯克隆（零本地改动）：
runtime 物化直接取其工作区文件，任何未提交改动都会随打包混入产物，
破坏"产物 = 纯上游"的承诺。

有价值但不进上游的改动以 patch 形式存档于此（上游仓库不对外开放
PR，无合并通道）。长期维护载体是我们 fork（kkutysllb/deepseek-
harness）上的 `fix/*` 分支——patch 与分支一一对应、双向同步：
分支是可追溯的提交历史（作者/动机/上游 lint 与测试门），patch 是
KCoder 仓库内的随包分发形态（setup.sh 钉版后 apply，CI 与本地共用）。
改动一个修复时两边都要更新（分支重建提交 → format-patch 覆盖归档）。

## 补丁清单

| Patch | 内容 | 状态 |
|---|---|---|
| `0001-markdown-model-sanitize.patch` | 模型输出 markdown 修复：跨行 `**` 强调 与跨行行内 code（不合法 CommonMark，渲染成字面星号/断码）在解析管线合并回单行；fence 代码块跳过；含 73 行实现 + 73 行测试 | fork 分支 `fix/markdown-model-sanitize`（625720a，含上游 lint 合规收敛：non-null assertion 改判空） |
| `0002-pi-ai-0.84.3-upgrade.patch` | pi-ai 0.82.1 → 0.84.3 升级：模型目录补齐（glm-5.3 等）+ drift gate 适配（baseten/thinking.budget/新 compat 字段/pending/deferred stop reason/abort 走 error 事件改信号判定）+ 依赖范围放宽为 >=0.84.3 <1.0.0（后续 `pnpm update @earendil-works/pi-ai --filter @deepseek-ai/dsh-llm-pi-ai` 即可跟最新 0.x）；含 lockfile 与测试适配 | fork 分支 `chore/pi-ai-0.84.3-upgrade`（e1a0698，基于基线 rc.2，dev/构建已验证 940/940 绿） |
| `0003-codex-relay-accountid.patch` | openai-codex 中转兼容：pi-ai 的 openai-codex-responses 流无条件把 key 当 OpenAI OAuth JWT 解 `chatgpt_account_id`，中转/代理的普通 API key 每轮必抛 `Failed to extract accountId from token`（PI_AI_ERROR）。pnpm patch `@earendil-works/pi-ai@0.84.3`：提取失败回退 token 派生稳定 id（只填 chatgpt-account-id 头与 WS 会话缓存 key，对中转无意义；真 OAuth JWT 走原路径）；含 patchedDependencies 声明、lockfile 与 THIRD_PARTY_NOTICES 登记 | fork 分支 `fix/codex-relay-accountid`（0552d34，基于 0002 分支尖 e1a0698 叠一个提交——与 0002 共享 lockfile，串行应用顺序敏感；差异探针验证：补丁前 accountId 错、补丁后越过提取直达网络层） |
| `0004-relay-missing-terminal-event.patch` | 中转缺终止事件兼容：翻译型中转（上游 chat completions 翻成 Responses 线路格式）发完增量后 `[DONE]` 直接关流，不发 `response.done/completed`（合成需完整 response 对象，翻译层没有）；pi-ai 三协议共用的 processResponsesStream 硬校验终止事件，缺了就丢弃已落地内容并每轮烧完整个退避重试梯（官方 codex 客户端容忍此形态）。扩展 0003 的 pnpm patch：流结束无终止事件但已有内容时合成 completed 收尾（stopReason stop，工具调用落地时 toolUse）；空流仍严格抛错不掩盖真故障，官方端点必发终止事件不受影响；含 lockfile patch hash | fork 分支 `fix/relay-missing-terminal-event`（8bedd6e5，基于 0003 分支尖叠一个提交——共享 pnpm patch 文件与 lockfile，串行应用顺序敏感；mock relay 差异探针：补丁前 terminal 错、补丁后文本落地 stopReason=stop，空流探针仍抛错） |
| `0005-codex-protocol-auto-fallback.patch` | codex 协议自动降级：new-api 类网关没有 codex 专属通道（`/codex/responses` 回首页 HTML 或 404），openai-codex 路由挂上去每轮空流报错，而同一网关的 `/v1/responses` 完全正常；前端设置页不暴露协议选择，用户无法自救。llm-pi-ai adapter 在配置协议于**零内容落地前**以“协议错配”签名（terminal-event 错/HTML 错误体/404/405）失败时，透明改用 openai-responses 重发（先配置地址、再补 `/v1` 前缀两个候选）；健康 codex 端点与非 codex 路由保持单次尝试不受影响；含 4 个 mock relay 测试（无 /v1 降级、带 /v1 直接降级、健康 codex 不降级、非 codex 不降级） | fork 分支 `fix/codex-protocol-auto-fallback`（0002a42c，基于 0004 分支尖叠一个提交；268/268 测试绿 + tsc/oxlint 干净；worktree 串行应用 0001→0005 全过且与开发树逐字节对账） |
| `upstream-projection-cache-isolate.patch` | session-projection-cache 非 JSON 投影单元逐单元隔离而非整条记录失败（该修复为 dsh-context 插件缓存失败 bug 的引擎层根因） | fork 分支 `fix/session-projection-cache-per-unit-isolation`（5bef8cf）；0.2.3 产物未含此修复（归档前所发），0.2.4 起包含 |

## 应用方法

`scripts/setup.sh` 在钉版到 `upstream/BASELINE` 后会自动 `git apply` 本目录
所有 `*.patch`（可应用才应用，不可应用时警告跳过）——CI 与本地构建共用
该脚本，运行时产物因此含全部补丁。

手工验证（不依赖 setup.sh）时：

```bash
cd deepseek-harness
git apply ../upstream/0001-markdown-model-sanitize.patch
# 验证：pnpm -C packages/client/ui-primitives test
```

注意：应用后**不要**保留在内嵌 checkout 中（验证完即 `git checkout -- .`
并删除新增文件）；长期使用应等上游合并。setup.sh 自动应用路径因每次钉版
都 reset 到基线，无此残留问题。
