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
| `0001-markdown-model-sanitize.patch` | 模型输出 markdown 修复：跨行 `**` 强调与跨行行内 code（不合法 CommonMark，渲染成字面星号/断码）在解析管线合并回单行；fence 代码块跳过；含 73 行实现 + 73 行测试 | 待推上游 |

## 应用方法

```bash
cd deepseek-harness
git apply ../upstream/0001-markdown-model-sanitize.patch
# 验证：pnpm -C packages/client/ui-primitives test
```

注意：应用后**不要**保留在内嵌 checkout 中（验证完即 `git checkout -- .`
并删除新增文件）；长期使用应等上游合并。
