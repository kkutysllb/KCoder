# 全仓库审计报告 — v0.6.22

> 审计日期：2026-10-02 · 范围：v0.6.21（tag）→ 本版工作区改动面（上下文插件整线退役 + 折叠 rail 两入口压制 + 技能停用/恢复 + 设置对话框头部压制 + 发版文件）。上游基线与 v0.6.21 相同（deepseek-harness 0.2.0-rc.2 / `639ed01539`，fork 集成分支 `kcoder/0.2.0-rc.2` @ `b428f93a79`，**领先远端 0 提交**，已按 SOP 核对），本版无基线变化。

## 硬性门

| 门 | 结果 | 说明 |
|---|---|---|
| TYPECHECK | ✅ PASS | tsc 双 project 零错误；注入脚本自检（check-injected-scripts）与远端插件规格断言（check-remote-addon-specs，25 项）均通过 |
| LINT | ✅ PASS | oxlint **3 warning / 0 error**（与上一版逐项相同：`remote-connections.ts` ×1、`remote-server.ts` ×2 既有 `no-unused-vars`）；本版 diff 零新增；无安全类（eval 等） |
| SECURITY | ✅ PASS | `pnpm audit --prod --audit-level=high`（固定走 npmjs 官方 registry）无 high+ 漏洞 |

命令：`node scripts/audit.mjs` → 退出码 0；`bash scripts/release.sh prepush` → **全仓库 pre-push 通过**。

## 报告项（逐条处置）

### DEAD EXPORTS（2 项）

| 项 | 处置 |
|---|---|
| `desktop/main/remote-connections.ts:42 - openRemoteHostIds` | **豁免**：远程主机子系统的公开查询面，保留给后续远程窗口菜单消费（v0.6.19 起同项同理由） |
| `desktop/main/remote-server.ts:289 - remoteInstallReady` | **豁免**：远程安装就绪态的导出面，属远程工作区 B-β 线的预留 API（v0.6.19 起同项同理由） |

> 与上一版完全一致，本版零新增、零移除。

### UNUSED DEPS（10 项）

`electron-vite`、`@types/node`、`electron`、`@shared/ipc-contract`、`semver`、`@types/semver`、`yaml`、`electron-updater`、`react`、`react-dom` —— 全部**沿用既有豁免**（v0.6.17 起同清单）：electron/react 系为 peer 性质由 electron-vite 消费，semver/yaml 在 main 进程经 CJS 依赖图使用（审计工具按 ESM import 计）。本版无新增、无移除。

### 本版自身新增面的自查（零发现）

- `skills-catalog.ts` 新导出 `disableUserSkill` / `restoreDisabledSkill`：均被 `skills-settings.ts` 的 ops 分发消费，非死导出。
- 退役面三清经 `git status` 复核：`desktop/main/context-button.ts`、`scripts/smoke-context-tab.mjs`、`profiles/web/patches/dsh-context@0.62.2.patch` 删除，`profiles/web/patches/README.md` 新增为目录锚。

## 本版改动面（审计覆盖范围）

| 文件 | 性质 |
|---|---|
| `desktop/main/preset-plugins.ts` | PRESET_PLUGINS 移除 `dsh-context`；RETIRED_PRESETS 增补；注释历史记账 |
| `desktop/main/profile-patches.ts` | PATCH_MARKS 清空、PATCH_FALLBACKS 清空、`dsh-context` 入 RETIRED_PATCH_PKGS；空清单分支改为仍执行现场回收 + 声明兜底；KNOWN_PATCH_SENTINELS 死代码摘除 |
| `profiles/web/patches/dsh-context@0.62.2.patch` → `README.md` | 补丁删除，目录锚 README 登记注册方式 |
| `desktop/main/context-button.ts`、`scripts/smoke-context-tab.mjs` | 宿主注入入口与冒烟删除 |
| `desktop/main/{windows,open-in-app-button,panel-buttons,theme-watcher,sidebar-cluster,settings-page,index}.ts` | 退役跟随：调用点摘除、按钮槽位右移回收（108→76）、win32 平移带与平移常量同步、注释历史 |
| `electron-builder.yml`、`scripts/update-profile-plugins.mjs`、`scripts/release.sh` | 零常驻补丁稳态适配：release-gate 空清单放行（PATCH_MARKS 条件化）、verify 对空 patches 目录守卫、注释更新 |
| `desktop/main/style-overlay.ts` | 新增两段恒定压制：RAIL_BROWSER_ACTIONS_CSS（折叠 rail 的「新建工作区/搜索」）与 SETTINGS_DIALOG_HEADER_CSS（设置对话框头部「打开配置文件/×」），均带锚点防漏配论证 |
| `desktop/shared/ipc-contract.ts` | `SkillCatalogEntry.source` / 分区 id 增 `disabled` |
| `desktop/main/skills-catalog.ts` | 停车场机制：`skills-disabled/<user\|shared>/` 暂存、`disableUserSkill` / `restoreDisabledSkill`（白名单 + 同名冲突拒绝 + ExDev 兜底）、可选批去重基准含已停用名单 |
| `desktop/main/skills-settings.ts` | 行尾动作钮按来源分区（启用/停用/恢复 + 忙态/失败文案）、已停用分区渲染、`disable`/`restore` ops 与 `__dshSkillsToggled` 应答 |
| `scripts/smoke-skills-dom.mjs` | 夹具与新按钮断言扩展（注：该冒烟自 v0.5.9 起因插值提取方式不匹配挂起，沿用登记；扩展断言随脚本入库待冒烟修复后生效） |
| `release/v0.6.22.md`、`release/audit-v0.6.22.md` | 发版说明与审计报告 |

## 发版前验证

| 步骤 | 结果 |
|---|---|
| `release.sh prepush`（审计 + 补丁闸 + 内置插件版本线 + 设置页锚点冒烟 + 全量构建） | ✅ **全仓库 pre-push 通过** |
| 内置插件版本线 | ✅ 声明同线 + 内容变更伴随版本变更 |
| 热补丁闸 | ✅ 零常驻补丁稳态（补丁线整线退役后空清单放行，`profiles/web/patches` 仅存 README 锚） |
| 设置页注入锚点冒烟 | ✅ ALL PASS（本机执行需 `ELECTRON_DISABLE_SANDBOX=1`，v0.6.21 报告同款环境说明，非缺陷） |
| 折叠 rail 压制 — 浏览器级联验证 | ✅ 从源码提取真实 CSS 串注入复刻上游命名结构的夹具（playwright/Chromium 实测）：折叠态两入口 `display:none`；展开态搜索槽/头部动作保留；settings trigger、附件缩略条等三处同名 `_rail` 类不误伤（锚点全 bundle 核对：ui-settings-general `_rail` 为 trigger 钮、ui-attachment 两处缩略条 root/rail 分属两元素、dsh-coding-sidebar / dsh-terminal 零 `_rail`） |
| 设置头部压制 — 浏览器级联验证 | ✅ 同法实测：设置对话框头部隐藏；负例①同结构其他模态（无 `data-shortcut-modal='settings'`）不受影响；负例②分区自绘 header 行（无 `_close` 直子）不误伤 |
| 技能停用/恢复 — 功能测试 | ✅ **23/23**（临时 DSH_HOME/HOME 驱动编译后模块）：停用/恢复全链路、跨来源归位（user→`$DSH_HOME/skills`、shared→`~/.agents/skills`）、双向同名冲突拒绝（现役与暂存数据零覆盖）、三类白名单越权拒绝、已停用正文可读 |
| fork 推送核对（SOP 必检） | ✅ `git -C "$KCODER_UPSTREAM_DIR" status -sb`：`kcoder/0.2.0-rc.2...origin/kcoder/0.2.0-rc.2` 零领先 |

## 结论

硬性门全过；报告项全部沿用既有豁免，本版零新增发现。四处改动均有门禁或级联/功能级验证证据：上下文插件退役走零常驻补丁稳态闸，两处界面压制有真实浏览器级联断言（含负例），技能停用/恢复有 23 项功能断言。**建议发布。**
