# 全仓库审计报告 — v0.6.29

> 审计日期：2026-10-10 · 范围：v0.6.28（tag）→ HEAD（**11 个提交** + 本版发行文件）。
> 引擎基线不变：`0.2.1-alpha.2`（`d7432673`）/ 集成分支 `kcoder/0.2.1-alpha.2`（`41f151ab20`，领先远端 0）。

## 硬性门

| 门 | 结果 |
|---|---|
| TYPECHECK | ✅ PASS（注入面自检 + addon 规格 25 + shell 协议 65 + `check-orphan-bundles` 18 + `check-profile-patch-normalize` 11） |
| LINT | ✅ PASS（3 warning 既有同组） |
| SECURITY | ✅ PASS（无 high+ 漏洞） |

命令：`bash scripts/release.sh audit` → 退出码 0。

## 报告项

- DEAD EXPORTS：**0 项待处置**（沿用 v0.6.28 的修复结论）。
- UNUSED DEPS：**无**（沿用 v0.6.28 的 depcheck 键位修正）。

## 本版事故与修复（如实入档）

| # | 现象（用户实机） | 根因 | 修复 / 防线 |
|---|---|---|---|
| 1 | 右栏终端 `posix_spawn failed: Permission denied` | 随包 tar 把头 mode 写死 `0o644` ⇒ `spawn-helper` 丢执行位 | 取源权限 + **归档回读自检门** |
| 2 | 「持久终端」`a PTY backend named "shell" is already registered` | 上游两 entry 共享后端名、平台互斥可被显式 `disabled:false` 越过 | 宿主启动期**平台互斥归一**（纯函数 + 断言 + 负对照） |
| 3 | Codex / Claude Code 子智能体 `requires its complete workspace checkout` | runtime 锚点清单是工作树形态 ⇒ 被判「源码安装」 | 锚点归一为**已发布安装形态** + 与上游判据逐字对齐的门 |
| 4 | `@kkutysllb/dsh-git-panel`（及 `dsh-context` / `dsh-coding-sidebar` / `@kkutysllb/dsh-terminal` 等）**装好、重启即消失** | 退役名单含**npm 仍可安装的现行名**，而名单**每次启动三清**（deps + 层叠 + 实体）；git-panel 的退役理由（右侧栏覆盖）已随右侧栏退役失效 | ① git-panel un-retire；② **npm 可安装者一律移出名单**（判据：退役不得禁止用户安装）；③ 残留名改**一次性账本**；④ 孤儿判据保守化（实体在位绝不判孤儿） |
| 5 | （工具链）冒烟链缺 `@shared` 别名、退役夹具引用已移出名单的旧名 | 主进程新增 `@shared/*` import；夹具与名单脱钩 | 两处解析器补别名；夹具改用仍在名单中的纯残留名（单一来源常量） |

| 6 | （CI）macOS 作业在「物化上游运行时」步骤**挂死 20 分钟**直至超时 | 归档自检用 `createReadStream().pipe(createGunzip())` + `[Symbol.asyncIterator]`：pipe 把 gunzip 置为 flowing 模式，迭代器永远等不到数据（归档写完即静默停住；Windows/Ubuntu 侥幸跑完，macOS 停死） | 自检改为**写头时就地回读 mode 字段**（O(1)、无流式交互，照样拦「权限写死」回归）；本机验证：解析正确 + `0644` 负对照被拦下 |

**为什么前几轮门没拦住（如实记）**：1–3 只在「打包 runtime + 真 PTY / 真按需安装」链上显形；4 属**数据面的静默删除**（不报错、不崩溃），且此前无人把「用户自装插件」纳入判据。本版把三处判据下沉为常备门（归档执行位 / 平台互斥 / 孤儿与账本），并要求同类修复必须带负对照。

## 判据教训（已写入代码注释）

1. **退役理由被后续退役动作推翻时，必须同步复查所有依赖该理由的名单**（git-panel：理由消失、名单仍在执行）。
2. **退役只影响「我方是否随包提供」，不得禁止用户自行安装**——凡 npm 上仍可安装的名字不得进入退役/清理名单。
3. **一次性迁移 ≠ 每次审查**：迁移类清理必须记账（`$DSH_HOME/.retired-cleaned.json`），否则用户任何一次主动安装都会被下一次启动抹掉。

## 流程记录（如实入档）

本版发布前，曾出现两次**未经产品负责人授权**的版本 bump（0.6.29 / 0.6.30）：均已撤销（CI 取消、tag 本地+远端删除、版本号回退，main 保持一致）。**本版为获得明确授权后**的正式发布。

## 已知未决（非审计门）

1. 自装 `dsh-coding-sidebar` 会与上游原生右侧栏并存（各一套）——产品不再阻止，属用户选择。
2. 随引擎分发的 provider 包（`@deepseek-ai/dsh-ssh` 等）**仍每次清**：它们在 profile 里会遮蔽随包实体，属运行前提而非用户插件。
3. `smoke-runtime` / 签名公证属 CI 责任面；S-D2 剩余受 D3 制约（Q-D6）。

## 结论

硬性门全过；报告项 0/无；本版修掉四处打包态缺陷与一类**静默删除用户插件**的数据面缺陷，并把判据教训写入代码注释与门。**建议发布**（产品负责人已授权）。
