# 上游补丁存档

内嵌的 `deepseek-harness/` checkout 必须保持纯克隆（零本地改动）：
runtime 物化直接取其工作区文件，任何未提交改动都会随打包混入产物，
破坏"产物 = 纯上游"的承诺。

有价值但暂未推上游的改动以 patch 形式存档于此。推上游的正确路径：
fork deepseek-ai/deepseek-harness → 新分支 → `git apply <patch>` →
提交 → PR。上游合并后随正常升级流水线回到本仓库。

## 补丁清单

| Patch | 内容 | 状态 |
|---|---|---|
| `0001-markdown-model-sanitize.patch` | 模型输出 markdown 修复：跨行 `**` 强调 与跨行行内 code（不合法 CommonMark，渲染成字面星号/断码）在解析管线合并回单行；fence 代码块跳过；含 73 行实现 + 73 行测试 | 待推上游 |
| `upstream-projection-cache-isolate.patch` | session-projection-cache 非 JSON 投影单元逐单元隔离而非整条记录失败（对应 fork 分支 fix/session-projection-cache-per-unit-isolation 的 commit 5bef8cf；该修复为 dsh-context 插件缓存失败 bug 的引擎层根因） | 待推上游（fork 分支已有，归档防分支存活性依赖） |

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
