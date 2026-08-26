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
| `0002-pi-ai-0.84.3-upgrade.patch` | pi-ai 0.82.1 → 0.84.3 升级：模型目录补齐（glm-5.3 等）+ drift gate 适配（baseten/thinking.budget/新 compat 字段/pending/deferred stop reason/abort 走 error 事件改信号判定）+ 依赖范围放宽为 >=0.84.3 <1.0.0（后续 `pnpm update @earendil-works/pi-ai --filter @deepseek-ai/dsh-llm-pi-ai` 即可跟最新 0.x）；含 lockfile 与测试适配 | 待建 fork 分支 `chore/pi-ai-0.84.3-upgrade`（分支提交前 patch 先行，dev/构建已验证 940/940 绿） |
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
