# 全仓库审计报告 — v0.6.30

> 审计日期：2026-10-10 · 范围：v0.6.29（tag）→ HEAD（**1 个提交** + 本版发行文件）。
> 引擎基线不变：`0.2.1-alpha.2`（`d7432673`）/ 集成分支 `kcoder/0.2.1-alpha.2`（`41f151ab20`，领先远端 0）。

## 硬性门

| 门 | 结果 |
|---|---|
| TYPECHECK | ✅ PASS（含 `check-orphan-bundles` 10 项、`check-profile-patch-normalize` 11 项、shell 协议 65 断言） |
| LINT | ✅ PASS（3 warning 既有同组） |
| SECURITY | ✅ PASS（无 high+ 漏洞） |

## 报告项

- DEAD EXPORTS：0 项待处置（沿用 v0.6.28 的修复结论）。
- UNUSED DEPS：无（沿用 v0.6.28 的键位修正）。

## 本版事故事实与修复（如实入档）

**现象**：用户自装 `@kkutysllb/dsh-git-panel` 可用，但**每次重启后消失**、需重装。

**定位过程（可复核）**：
1. 安装日志（`.plugin-manager/logs/*/pnpm.log`）中该插件的操作**全是 `+`、无 `-`** ⇒ 排除「被 pnpm 卸载」；
2. profile 的 `package.json`/`node_modules` 在重启后同时失去它 ⇒ 指向「清单被重写 + 实体被删」；
3. 隔离复现（真启动函数 + 临时 `DSH_HOME` + 真 profile 拷贝）：`ensureKcoderBundles()` 打印
   `清除 profile 退役/孤儿插件残留: deps=[@kkutysllb/dsh-git-panel] bundles=[@kkutysllb/dsh-git-panel]`，
   随后 deps/bundles/实体三者尽失 ⇒ **确认为我方 `RETIRED_PLUGINS` 名单命中现行全名**；
4. 该插件 2026-09-14 的退役理由（右侧栏 Git 面板覆盖）已被 **2026-10-09 右侧栏整线退役**推翻。

**修复**：从 `RETIRED_PLUGINS` 移除 `@kkutysllb/dsh-git-panel`（un-retire）+ 静态断言「名单不得含 git-panel 系（含现行全名）」；
同一复现中三者**全部存活**。

**判据教训（写入名单注释）**：退役理由被后续退役动作推翻时，必须同步复查所有依赖该理由的名单——本次即「名单项的理由已失效、名单却仍在每次启动执行」。

## 已知未决（非审计门）

1. `@kkutysllb/dsh-terminal` 仍在退役名单且同为现行名——**有意的产品级退役**（终端交回上游原生），用户自装同样每次启动被三清；是否改为「退役一次即不再管」需产品拍板。
2. `smoke-runtime` / 签名公证属 CI 责任面；S-D2 剩余受 D3 制约（Q-D6）。

## 结论

硬性门全过；本版修掉一处**静默删除用户插件**的缺陷，且已用隔离复现给出前后对照。**建议发布。**
