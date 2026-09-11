# 全仓库审计报告 — v0.5.9

> 审计日期：2026-09-11 · 审计命令：`bash scripts/release.sh audit` · 结果：三门 PASS，报告项已全部处置

## 硬性门

| 门 | 结果 | 说明 |
|---|---|---|
| TYPECHECK | ✅ PASS | tsc 双 project 零错误 |
| LINT | ✅ PASS | oxlint 0 error / 0 warning（本版处置前为 13 warning，全部修复，见下） |
| SECURITY | ✅ PASS | 生产依赖无 high+ 漏洞（本版处置前 js-yaml@4.3.1 high，已修复，见下） |

## 发现项与处置

### 安全（已修复）

- **js-yaml@4.3.1 — high（GHSA-2883-xcg3-v3hh）**，路径 `. > electron-updater > js-yaml`。
  处置：pnpm overrides `js-yaml@<4.3.2: ^4.3.2` 强制提升（pnpm 11 起该设置迁移至 pnpm-workspace.yaml），lock 收敛后官方 audit 端点复检「No known vulnerabilities found」。

### 死代码（已修复）

- `desktop/main/upstream.ts` 导出函数 `isSyncing()`：全仓零消费者，删除（连带确认内部 `syncing` 状态变量仍被同步流程使用，保留）。
- `scripts/runtime-sandbox-hotfix.d.mts`：ts-prune 误报——实为 `scripts/runtime-sandbox-hotfix.mjs` 的类型声明文件，`dsh-contract.ts` 导入 .mjs 时消费，**保留**并加入审计豁免清单。
- smoke 脚本（smoke-mcp-dom / smoke-skills-dom / smoke-skills-page）13 处 lint 警告清零：移除未使用导入（menu.ts `UpdateStatus`、store.ts `existsSync`、make-icons.cjs `nativeImage`）、删除死变量（cdp-profile `MEDIA_MODEL_GROUPS`、smoke-skills-dom `MEDIA_MODEL_GROUPS`/`mts` 死块、smoke-mcp-dom `radioProbe` 未用赋值）、cdp-profile 三元语句改 if/else、update-profile-plugins 模板内多余转义；4 处测试夹具有意的 `eval`（按模板字符串语义还原页面注入源码）加 `oxlint-disable-next-line` 注释并注明理由。

### 已知豁免（有意的公开面/工具入口，非遗留）

- `electron.vite.config.ts` default 导出——electron-vite 配置入口。
- `desktop/shared/ipc-contract.ts` 的 `LanguageSettings` / `SkillCatalogGroup` / `PreviewEntry`——IPC 契约面类型，跨进程载荷的文档面，按设计导出。

### 冗余依赖（报告项，判定为 depcheck 对 Electron 应用的误报，豁免）

`electron-vite`（构建 CLI）、`electron`（打包/CLI）、`@types/node` / `@types/semver`（类型）、`@shared/ipc-contract`（tsconfig path 别名）、`semver` / `yaml` / `electron-updater`（主进程运行时依赖，depcheck 无法识别其动态/类型化消费）。

## 复检结论

处置后复跑 `node scripts/audit.mjs`：三门 PASS、死导出 0 项（5 项已知豁免）、无新增发现。
