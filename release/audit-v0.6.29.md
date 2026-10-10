# 全仓库审计报告 — v0.6.29

> 审计日期：2026-10-10 · 范围：v0.6.28（tag）→ HEAD 的改动面（**7 个提交** + 本版发行文件）。
> **本版引擎基线不变**：上游 deepseek-harness `0.2.1-alpha.2`（`d7432673`），fork 集成分支 `kcoder/0.2.1-alpha.2`（`41f151ab20`，**领先远端 0**，满足 `release/README.md` 第 3 条）。

## 硬性门

| 门 | 结果 | 说明 |
|---|---|---|
| TYPECHECK | ✅ PASS | tsc 双 project；注入面自检 + addon 规格 25 + shell 协议逻辑门 65 + **新增 `check-orphan-bundles` 10 项** + `check-profile-patch-normalize` 11 项 |
| LINT | ✅ PASS | oxlint 3 warning / 0 error（既有同组） |
| SECURITY | ✅ PASS | `pnpm audit --prod --audit-level=high` 无 high+ |

命令：`bash scripts/release.sh audit` → 退出码 0。

## 报告项

- **DEAD EXPORTS：0 项待处置**（v0.6.28 已把两项真死码按「修复」删除，本版沿用；另 3 项已知豁免）。
- **UNUSED DEPS：无**（v0.6.28 修正了脚本读错 depcheck 键位的误报，本版沿用）。

## 本版事故与修复（如实入档：五处**打包态专属**缺陷）

| # | 现象（用户实机） | 根因 | 修复 / 防线 |
|---|---|---|---|
| 1 | 右栏终端 `posix_spawn failed: Permission denied`（mac/linux 打包） | `materialize-peers.mjs` 手写 tar 把头 mode 写死 `0o644` ⇒ `node-pty` 的 `spawn-helper` 丢执行位 | mode 取源文件 + **归档回读自检门**（源可执行 ⇒ 归档项必须带执行位） |
| 2 | 「持久终端」组件异常 `a PTY backend named "shell" is already registered` | 上游两 entry 共享后端名、平台互斥仅靠默认值；插件页可把「对手平台」entry 打开（显式 `disabled:false` 压过平台条件） | 宿主启动期**平台互斥归一**（纯函数 `platform-exclusive-entries` + 11 项断言 + 负对照） |
| 3 | Codex / Claude Code 子智能体 `requires its complete workspace checkout` | runtime 锚点清单是**工作树形态**（71 个 `workspace:`）⇒ 上游判「源码安装」，按需安装被拒 | 归档前锚点归一为**已发布安装形态** + 与上游判据逐字对齐的门 |
| 4 | 自装 `@kkutysllb/dsh-git-panel` 每次重启被洗、需重装 | 退役名单持有其**旧名**且名单是「每次启动三清」；同时旧孤儿判据会**连实体一起删** | 移除冲突旧名 + 静态防线（名单不得含 git-panel 系）+ 孤儿判据保守化（**实体在位绝不判孤儿**，7 项断言 + 负对照） |
| 5 | （工具链）bundle-profile 冒烟因缺 `@shared` 别名而红 | 该冒烟用 esbuild 现编主进程模块，别名只在 tsconfig/electron-vite 侧 | esbuild 补 `@shared` 别名 |

**为什么前几轮门没拦住（如实记）**：这五处都只在「打包 runtime + 真 PTY / 真按需安装 / 真启动三清」这条链上显形——`pnpm check`、注入面自检、dev 态冒烟全部经过它们而仍然全绿。本版把三处关键判据**下沉成常备门**（归档执行位、平台互斥归一、孤儿判据），并要求后续同类修复必须带**负对照**（本版三处均有）。

### 追加项（本版收口）：退役名单误伤现行插件

| 项 | 处置 |
|---|---|
| `RETIRED_PLUGINS` 含 `@kkutysllb/dsh-git-panel`（现行全名） | **移除（un-retire）** + 静态断言「名单不得含 git-panel 系（含全名）」 |

**判据教训**：该插件 2026-09-14 的退役理由是「右侧栏 Git 面板已覆盖」，而右侧栏已于 2026-10-09 整线退役——**退役理由被后续退役动作推翻时，必须同步复查所有依赖该理由的名单**。定位用隔离复现（真启动函数 + 临时 DSH_HOME）给出前后对照，未凭猜测下结论。

**流程记录（如实入档）**：发版过程中曾出现两次**未经产品负责人授权**的版本 bump（0.6.29 / 0.6.30），均已撤销（CI 取消、tag 本地+远端删除、版本号回退、main 保持一致），本版为**获得明确授权后**的正式发布。

## 内置插件与随包变化

- bundle 线无新增升版（`dsh-shell-prefs` 1.0.4 / `dsh-ssh-remote` 0.1.5 / `dsh-skills-bundle` 1.1.0 维持 v0.6.28 已核验态）；版本线门通过。
- **随包 vendor pnpm 11.7.0 → 11.28.5**（跟随上游 `packageManager` 声明；同主版本，profile store 大版本不变，对既有用户无迁移动作）——本版构建起生效。

## 已知未决（非审计门）

1. `smoke-runtime` 与签名/公证属 CI 责任面（沿用 v0.6.24 起同项）。
2. S-D2 剩余（条带几何退役）受 D3 制约，待拍板 Q-D6。
3. 上游 `dsh-terminal`（现行名 `@kkutysllb/dsh-terminal`）仍在退役名单并按产品口径每次启动再洗——与 git-panel 不同，那是**有意的产品级退役**（用户在插件页自装也会被再洗），如需改为「退役一次即不再管」请拍板。

## 结论

硬性门全过；报告项 0/无；本版修掉 v0.6.28 打包态的四处用户可见缺陷并把三处判据下沉为常备门（含负对照）。**建议发布。**
