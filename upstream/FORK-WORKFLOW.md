# Fork 协作约定（deepseek-harness fork）

本仓库是官方 `deepseek-ai/deepseek-harness` 的 fork，作为**多产品共享的上游修复池**。
官方仓库不对外开放 PR，所有对上游的修改在本仓库维护；各产品以「集成分支」为唯一消费态。
参与开发前请完整阅读本约定，避免破坏其他产品的消费态。

> 本文档常驻 `docs/fork-workflow` 分支（`git show docs/fork-workflow:FORK-WORKFLOW.md` 查看）。
> `master` 保持官方上游纯净镜像，不承载任何自有提交。

## 分支模型

```
upstream/master ──(fetch+ff)──► origin/master（纯净镜像，零自有提交）
        │
        ├── 基线提交（各产品按需钉版）
        │        │
        │  fix/* / chore/*  ◄── 修复分支（产品无关的共享资产）
        │        │（各产品分别 merge）
        │        ▼
        │  <product>/<baseline>  = 各产品集成分支（该产品唯一消费态）
        │  例：kcoder/alpha.1 = 基线 cd5ef814 + 六修复分支的 merge
        │
docs/fork-workflow  ◄── 本约定文档（永久分支）
```

| 分支 | 用途 | 谁可以推 |
| --- | --- | --- |
| `master` | 官方上游主线的纯净镜像（见同步仪式） | **仅维护者，且只允许 ff 同步** |
| `fix/*`、`chore/*` | 上游缺陷修复 / 依赖升级，跨产品共享 | 任何开发者 |
| `<product>/<baseline>` | 产品集成分支（如 `kcoder/alpha.1`） | **仅该产品负责人** |
| `docs/fork-workflow` | 本约定文档 | 维护者 |

## master 同步仪式（跟踪官方上游）

`master` 永远等于官方上游 `master` 的某个提交，只快进、零自有提交：

```bash
git fetch upstream master
git checkout master
git merge --ff-only upstream/master     # 出现非 ff 说明 master 被污染，需排查
git push origin master                  # 正常情况必为 fast-forward
```

若 `merge --ff-only` 失败，说明有人向 master 推了自有提交——按「硬性规则」追责并
`git reset --hard upstream/master` + `push --force-with-lease` 修复，不得把自有提交留在主线。

## 硬性规则

1. **绝不直接推送官方上游**（`upstream` remote 只 fetch，不 push）。
2. **master 零污染**：任何产品开发、修复、文档提交一律不进 master；产品开发在各自的
   `<product>/<baseline>` 分支，共享修复在 `fix/*`，文档在 `docs/*`。
3. **绝不向其他产品的集成分支直接提交**。共享修复必须走修复分支：
   `fix/* 提交 → 各产品负责人各自 merge 进自己的集成分支`。
4. **集成分支上不允许裸提交**——所有修改先落修复分支（保留作者、动机与质量门记录），再以 `merge --no-ff` 合入，保证谱系可追溯。
5. **提交必须过质量门**：正常 `git commit`（lefthook 会跑 oxlint 等）；禁止 `--no-verify` 绕过。曾被拦下的提交**并未创建**，此时勿用 `git commit --amend`（会错改当前 HEAD）。
6. **基线不同时修复需重放**：修复分支基于 A 基线，产品钉 B 基线时，用 `git rebase --onto <B基线> <A基线> <修复分支>` 重放后 force-with-lease 推远端，再供消费。
7. **集成分支重建**（换基线）= 新建 `<product>/<新版本>` 分支 + 依次 merge 修复分支，**不要在旧集成分支上 reset**；消费端锚点（分支名/基线断言）同步更新后旧分支方可删除。
8. **本地工作树各产品独立**：每个产品使用自己的本地克隆路径（或 `git worktree`），不共用同一工作树——`node_modules` 与构建产物随分支切换互相污染。
9. **未验证的上游提交不进任何产品发布**：产品侧以「集成分支 + 基线包含断言」把关（如 KCoder 的 `upstream/BASELINE` + release.sh 断言）。

## 新增修复的标准流程

```bash
git checkout -b fix/<主题> <基线提交>      # 从产品钉的基线拉分支
# 修改 → 测试 → 正常提交（过 lefthook）
git push origin fix/<主题>                # force-with-lease 重建亦用此
# 各产品负责人：
git checkout <product>/<baseline>
git merge --no-ff origin/fix/<主题>
git push origin <product>/<baseline>
```

## 升级产品基线（以 KCoder 为例）

1. 在 fork 上确认新基线提交（官方 release 分支的 merge 提交）。
2. `git checkout -b kcoder/<新版本> <新基线>`，依次 `merge --no-ff` 各修复分支
   （基线跨度大时修复分支先按规则 6 重放）。
3. 推远端；消费端更新分支锚点与 `BASELINE` 文件，走各自的构建与回归仪式。
