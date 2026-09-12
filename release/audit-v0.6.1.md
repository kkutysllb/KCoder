# 全仓库审计报告 — v0.6.1

> 审计日期：2026-09-12 · 审计命令：`bash scripts/release.sh audit` · 结果：三门 PASS，报告项已全部处置

## 硬性门

| 门 | 结果 | 说明 |
|---|---|---|
| TYPECHECK | ✅ PASS | tsc 双 project 零错误（含 theme-watcher.ts 两层标题栏修复） |
| LINT | ✅ PASS | oxlint 0 error / 0 warning |
| SECURITY | ✅ PASS | 生产依赖无 high+ 漏洞 |

## 本版改动面

- `desktop/main/theme-watcher.ts`：标题栏两层治理——页面自绘条自愈（主题落定后 120/400ms 重读重画、`prefers-color-scheme` 媒体查询直听、html/body class 观察、`__dshTitlebarApply` 主进程 poke 通道）；Windows overlay 重放间隔放宽 0/250/800ms + 窗口 focus/restore/show 按最近参数重放（`lastOverlay` WeakMap）。
- 引擎侧（fork 集成分支 kcoder/0.1.5-rc.2 尖端 94bbde10b3 → 1fc823f08d，随 runtime tarball 分发）：win32-process 三处受限进程创建补 `CREATE_NO_WINDOW`；7 处引擎内 `child_process` 补 `windowsHide`。fork 侧定向回归 492 + 376 全绿，oxlint 0/0，typecheck 通过，已推 fork 远端。

## 发现项与处置

- 无新增发现项：DEAD EXPORTS 0 项待处置（4 项已知豁免沿用 v0.6.0 报告）；UNUSED DEPS 10 项与 v0.6.0 完全一致，判定为 depcheck 对 Electron 应用的误报，豁免理由沿用（`electron-vite` 构建 CLI、`electron` 打包/CLI、`@types/node`/`@types/semver` 类型、`@shared/ipc-contract` tsconfig path 别名、`semver`/`yaml`/`electron-updater` 主进程运行时依赖）。

## 复检结论

三门 PASS，无新增死代码/漏洞；`release.sh build` 物化新尖端 runtime（20847 文件 → 56MB tar.gz），品牌断言通过，Electron node 形态真实起服冒烟通过（就绪行 + 首页 200）。本版无安全修复项。
