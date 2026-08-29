# 发布说明（Release Notes）

本目录存放 KCoder 每个正式版本的发布内容说明，是 GitHub Release 页面的唯一正文来源。

## 约定

1. **文件命名**：每个版本一个文件，命名为 `v<主.次.补丁>.md`（如 `v0.4.3.md`），与 git tag 一一对应。
2. **发布前必备**：`scripts/release.sh ship` 会校验 `release/<tag>.md` 存在，缺失即拒绝发布。说明文件随 `release: x.y.z` 提交一并入库。
3. **GitHub Release 同步**：
   - CI（`.github/workflows/release.yml`）发布时自动读取本目录对应文件作为 Release 正文；
   - 手动发布（`release.sh release create`）优先使用本目录文件；
   - 补录/修订历史版本正文：`gh release edit v<版本> -R kkutysllb/KCoder -F release/v<版本>.md`。
4. **正文内容**：写给用户看的变更摘要——新特性、修复、上游基线变化、升级注意事项；不堆提交日志。

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
