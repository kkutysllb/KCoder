# 全仓库审计报告 — v0.6.11

> 审计日期：2026-09-12 · 审计命令：`bash scripts/release.sh audit` · 结果：三门 PASS，无新增发现项

## 硬性门

| 门 | 结果 | 说明 |
|---|---|---|
| TYPECHECK | ✅ PASS | tsc 双 project 零错误（含 theme-watcher.ts 偏好一致性门与 chrome 解耦） |
| LINT | ✅ PASS | oxlint 0 error / 0 warning |
| SECURITY | ✅ PASS | 生产依赖无 high+ 漏洞 |

## 本版改动面

- `desktop/main/theme-watcher.ts`（仅此一处）：
  - WATCH_JS `reportPref` 加一致性门——偏好档与页面实色必须自洽（`system` 恒自洽），不一致延迟 500ms 重读（≤3 次）等持久化落盘后再上报；正则空白写法 `[ \t]` 在模板串内改 `\\t` 传递（页面侧仍为 `\t` 转义，行为等价）；
  - 主进程 `THEME_PREF_PREFIX` 分支移除 `applyShellChromeTheme(win, value)`，偏好档只驱动 `applyNativeTheme`；窗口 chrome 跟随实色通道 + `nativeTheme 'updated'` 兜底（v0.6.1 已建立的 focus/restore/show 重放与 0/250/800ms 波次不变）。

## 发现项与处置

- 无新增：DEAD EXPORTS 0 项待处置；UNUSED DEPS 10 项与 v0.6.0/v0.6.1 完全一致（depcheck 对 Electron 应用的误报，豁免理由沿用）。

## 复检结论

三门 PASS，改动面单一且在 typecheck/lint 全绿覆盖内；引擎侧无变化（fork 尖端仍为 1fc823f08d，runtime tarball 沿用 0.6.1 物化产物，CI 发布链按基线断言自行物化）。本版无安全修复项。
