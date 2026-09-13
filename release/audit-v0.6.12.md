# 全仓库审计报告 — v0.6.12

> 审计日期：2026-09-14 · 审计命令：`bash scripts/release.sh audit` · 结果：三门 PASS，无新增发现项

## 硬性门

| 门 | 结果 | 说明 |
|---|---|---|
| TYPECHECK | ✅ PASS | tsc 双 project 零错误（含 dsh-git-panel 退役后的 kcorder-skills-bundle/plugins 改动） |
| LINT | ✅ PASS | oxlint 0 error / 0 warning |
| SECURITY | ✅ PASS | 生产依赖无 high+ 漏洞 |

## 本版改动面

- **dsh-git-panel 整线退役三清**：`desktop/main/kcoder-skills-bundle.ts`（BUNDLES 摘条目、`DSH_GIT_PANEL_BUNDLE` 常量删除、`@kkutysllb/dsh-git-panel` 列入 RETIRED_PLUGINS——启动自愈摘 bundles 层叠 + deps 声明 + 物化实体）；`bundle/dsh-git-panel/` 目录删除；`scripts/sync-bundles.mjs` 映射摘除；`electron-builder.yml` extraResources 映射摘除；`desktop/main/plugins.ts` 内置清单注释补记（清单派生自 MATERIALIZED_BUNDLES 自动收窄）。
- **内置镜像刷新**（sync-bundles 对账归零）：bundle/dsh-coding-sidebar 1.0.6 → 1.0.12 线、bundle/dsh-file-review-kcoder 1.0.0 → 1.0.3。

## 发现项与处置

- 无新增：DEAD EXPORTS 0 项待处置；UNUSED DEPS 10 项与 v0.6.0/v0.6.1/v0.6.11 完全一致（depcheck 对 Electron 应用的误报——electron/electron-vite/react 等经构建链与运行时消费，豁免理由沿用）。

## 复检结论

三门 PASS，改动面为纯退役摘除 + 镜像同步，typecheck/lint 全绿覆盖；引擎侧无变化（fork 尖端仍为 1fc823f08d，runtime tarball 沿用既有物化产物，CI 发布链按基线断言自行物化）。本版无安全修复项。
