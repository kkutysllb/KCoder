# 全仓库审计报告 — v0.6.0

> 审计日期：2026-09-12 · 审计命令：`bash scripts/release.sh audit` · 结果：三门 PASS，报告项已全部处置

## 硬性门

| 门 | 结果 | 说明 |
|---|---|---|
| TYPECHECK | ✅ PASS | tsc 双 project 零错误 |
| LINT | ✅ PASS | oxlint 0 error / 0 warning（本版处置前为 4 warning，全部修复，见下） |
| SECURITY | ✅ PASS | 生产依赖无 high+ 漏洞（js-yaml high 已于本版修复，见下） |

## 发现项与处置

### 安全（已修复）

- **js-yaml@4.3.1 — high（GHSA-2883-xcg3-v3hh）**，路径 `. > electron-updater > js-yaml`。
  处置：pnpm overrides `js-yaml@<4.3.2: ^4.3.2` 强制提升（设置落位 pnpm-workspace.yaml，pnpm 11 不再读 package.json 的 pnpm 字段），lock 收敛后官方 audit 端点复检「No known vulnerabilities found」。

### 死代码（已修复）

- `desktop/main/upstream.ts` 导出函数 `isSyncing()`：全仓零消费者，删除（内部 `syncing` 状态变量仍被同步流程使用，保留）。
- `desktop/main/mcp-builtin.ts`：playwright 切 CDP 端点后 `chromeCandidates` / `chromeAvailable` / `chromeAvailableCache` 成死代码，删除（浏览器发现职责移至 browser-host.ts）。
- smoke 脚本 13 处 lint 警告清零：未使用导入（menu.ts `UpdateStatus`、store.ts `existsSync`、make-icons.cjs `nativeImage`）、死变量（cdp-profile `MEDIA_MODEL_GROUPS`、smoke-skills-dom `MEDIA_MODEL_GROUPS`/`mts` 死块、smoke-mcp-dom `radioProbe` 未用赋值）、cdp-profile 三元语句改 if/else、update-profile-plugins 模板内多余转义；4 处测试夹具有意的 `eval`（按模板字符串语义还原页面注入源码）加 `oxlint-disable-next-line` 注释并注明理由。

### 正则误用（已修复）

- `theme-watcher.ts` 偏好解析正则 `\s` 被 lint 判为多余转义（语义上 `\s` 在该位置合法，属 lint 对正则字符类的保守判定）——改为 `[ \t]` 等价写法规避告警，boot 脚本为单行空格，行为不变。

### 已知豁免（有意的公开面/工具入口，非遗留）

- `electron.vite.config.ts` default 导出——electron-vite 配置入口。
- `desktop/shared/ipc-contract.ts` 的 `LanguageSettings` / `SkillCatalogGroup` / `PreviewEntry`——IPC 契约面类型。注：`LanguageSettings` 随 language-bundle 退役已从契约移除；豁免清单按文件维度覆盖剩余契约类型。

### 冗余依赖（报告项，判定为 depcheck 对 Electron 应用的误报，豁免）

`electron-vite`（构建 CLI）、`electron`（打包/CLI）、`@types/node` / `@types/semver`（类型）、`@shared/ipc-contract`（tsconfig path 别名）、`semver` / `yaml` / `electron-updater`（主进程运行时依赖，depcheck 无法识别其动态/类型化消费）。

## 复检结论

处置后复跑 `node scripts/audit.mjs`：三门 PASS、LINT 0 error 0 warning、死导出 0 项（4 项已知豁免）、无新增发现。
