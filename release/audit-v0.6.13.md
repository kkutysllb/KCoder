# 全仓库审计报告 — v0.6.13

> 审计日期：2026-09-15 · 审计命令：`bash scripts/release.sh audit` · 结果：三门 PASS，无新增发现项

## 硬性门

| 门 | 结果 | 说明 |
|---|---|---|
| TYPECHECK | ✅ PASS | tsc 双 project 零错误（含基线升级后的 desktop/main 与新增 product-policy.ts 改动） |
| LINT | ✅ PASS | oxlint 0 error / 0 warning |
| SECURITY | ✅ PASS | 生产依赖无 high+ 漏洞 |

## 本版改动面

- **上游基线升级**：0.1.5-rc.2 (fb2c4b9e) → 0.1.6-alpha.1 (0a15e36e7f)。`upstream/BASELINE` 钉版与新升级记录；`desktop/main/dsh-contract.ts`、`scripts/setup.sh`、`scripts/release.sh` 的分支名同步为 `kcoder/0.1.6-alpha.1`。
- **原生右侧栏外壳压制**：`desktop/main/style-overlay.ts` 新增 `NATIVE_SIDEBAR_CSS`（隐藏 `data-sidebar-right-{expand,panel,float-host}`），与样式偏好开关解耦。
- **产品策略层**：新增 `desktop/main/product-policy.ts`——幂等物化 `$DSH_HOME/cordis.patch.kcoder.yml`，经 `dsh web --patch` 注入（会话日志不上传、原生终端整行禁用）；`dsh-contract.ts` 增 `webPatch` 版本门；`dsh-manager.ts` 参数顺序修正（web 子命令选项必须排在 web-app 选项之前）。
- **内置镜像刷新**（sync-bundles 对账归零）：bundle/dsh-coding-sidebar 1.0.12 → 1.0.16、bundle/dsh-file-review-kcoder 1.0.3 → 1.0.4。

## 发现项与处置

- 无新增：DEAD EXPORTS 0 项待处置；UNUSED DEPS 10 项与 v0.6.0 / v0.6.1 / v0.6.11 / v0.6.12 完全一致（depcheck 对 Electron 应用的误报——electron / electron-vite / react 等经构建链与运行时消费，豁免理由沿用）。

## 复检结论

三门 PASS；改动面为基线升级 + 产品策略层 + 镜像同步，typecheck/lint 全绿覆盖。引擎侧集成分支尖端 b88abcad16（含针对上游新增品牌断言的一处适配），runtime tarball 已按新基线重新物化（21497 文件 / 58MB，自检通过，brand-assert 与 smoke-runtime 均通过）。本版无安全修复项。
