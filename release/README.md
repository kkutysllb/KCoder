# 发布说明（Release Notes）

本目录存放 KCoder 每个正式版本的发布内容说明，是 GitHub Release 页面的唯一正文来源。

## 约定

1. **文件命名**：每个版本一个文件，命名为 `v<主.次.补丁>[-<预发布标识>].md`（如 `v0.4.3.md`、`v0.5.7-rc.1.md`），与 git tag 一一对应。
2. **发布前必备**：`scripts/release.sh ship` 会校验 `release/<tag>.md` 存在，缺失即拒绝发布。说明文件随 `release: x.y.z` 提交一并入库。
3. **上游 fork 必须先推送（2026-09-19 规定）**：发布物的内置运行时由 **CI 从 GitHub 克隆 fork** 现场构建
   （`release.yml` 的 `KCODER_UPSTREAM_REPO`），本地 `release.sh` **不校验**这一项——
   若 fork 集成分支（`upstream/BASELINE` 里那个 `kcoder/<版本>`）还有未推提交，CI 会把**旧 fork 状态**打进
   dmg（0.4.5 现场：tag 推送早于 fork push，`b11bd42095` 的品牌修复没进产物，dev 现象与发布物脱节）。
   故发版前先 `git -C "$KCODER_UPSTREAM_DIR" status -sb` 确认领先远端的提交为 0；
   `brand-assert.mjs` 只是最后一道产物层断言，救不了语义性回归（如 fork 上的产品闸门缺失）。
4. **发版前置审计（2026-09-11 规定，ship 强制校验）**：发版前必须完成全仓库审计——
   `bash scripts/release.sh audit`（typecheck / lint / 生产依赖安全漏洞三门硬性失败即拒绝；
   死代码 / 冗余依赖报告项逐条修复或在报告中豁免），处置完成后写
   `release/audit-v<版本>.md`（发现项清单 + 修复/豁免理由）随发版提交入库；
   ship 会重跑审计与全量构建（pre-push 门），任一失败即拒绝发布。缺失报告文件同样拒绝发布。
5. **GitHub Release 同步**：
   - CI（`.github/workflows/release.yml`）发布时自动读取本目录对应文件作为 Release 正文；
   - 手动发布（`release.sh release create`）优先使用本目录文件；
   - 补录/修订历史版本正文：`gh release edit v<版本> -R kkutysllb/KCoder -F release/v<版本>.md`。
6. **正文内容**：写给用户看的变更摘要——新特性、修复、上游基线变化、升级注意事项；不堆提交日志。

## 模板

```markdown
# KCoder vX.Y.Z

> 发布日期：YYYY-MM-DD · 上游基线：deepseek-harness <基线版本> (<短SHA>)

## 新特性

- …

## 修复

- …

## 升级注意

- （可选）
```

## 说明

- 仅收录 KCoder 产品线版本（v0.1.0 起）。仓库内另有 `v1.0.0`/`v2.0.0` 两个 tag，为前身 QiLin 引擎时代的历史遗留，不属于 KCoder 发布线。
- 上游基线升级记录详见 `upstream/BASELINE`。
