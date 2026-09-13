# dsh-file-review-kcoder

> **改动审查**——把 agent 产出的文件变更（行级红绿 diff + 撤销）渲染为对话轮尾审查行与 coding-sidebar 侧边栏 Tab，两个入口同源互不干扰。

自 KCoder 内置包 @kcoder/file-review 独立发布的 dsh 插件（v1.0.0 起完全自立维护，不再以收编/fork 形态延续）。

## 功能

- 对话轮尾审查行：每个产出文件的会话自动附审查入口；
- 交付物卡片：dsh `present` 工具声明的最终交付（含 bash 产物）与改动文件同处一行——单个交付整行、多个两列网格、超 4 个折叠；卡片点击经侧栏查看器预览，「打开」可用默认应用或文件管理器（访达 / 资源管理器 / 所在文件夹）；
- 非代码产物预览：图片 / 音视频 / Office / PDF / 文档类产出带类型徽标，点击经 dsh-coding-sidebar 的查看器管线（image / pdf / markdown / html 内置，office / video 插件懒加载）预览；bash 重定向、`curl -o`、`cp`/`mv`、`tee` 等产出按已知扩展名保守捕获；
- 侧边栏 Tab：line-level diff（UnifiedDiff）、产出文件列表（ProducedFiles）、逐 hunk 撤销（undo 服务）；
- typert 描述符协议（`./typert`）与远程面（`./remote`）随包导出。

## 安装 / Install

```bash
# npm registry（推荐：版本可被插件管理检测，更新由用户手动触发）
# npm registry (recommended: version detection with manual updates)
dsh plugin --profile web add dsh-file-review-kcoder

# GitHub 直装 / install straight from GitHub
dsh plugin --profile web add github:kkutysllb/dsh-file-review-kcoder
```

- 要求 dsh `0.1.2-alpha.1+`（对话快照路由 / 原生 deliverables 词汇），建议 `0.1.5-rc.2+`（交付物卡片）;
- 侧边栏 Tab 依赖 `dsh-coding-sidebar`（optional peer——未装时仅对话轮尾审查行可用）；
- `package.json` 的 `version` 是插件管理检测新版本的信号，更新由用户手动触发；
- npm 发线与 GitHub 发线同版本号发布，每版变更说明见 [`release/`](release/)。

## 与内置轮尾行的关系（重要）

对话轮尾槽 `conversation.chat.turnTail` 是 **CHAIN**：按 priority 升序逐个跑选择器，**首个返回非 null 的条目独占整行**。本插件在 priority `-2` 认领（早于 dsh-coding-sidebar 的 `-1` 与内置 ui-deliverables 的 `0`），因此：

- 认领必须覆盖内置行的**全部**段落，否则未渲染的那段会从对话里静默消失。dsh 0.1.5-alpha.2 起内置行除「改动文件」外还有 `present` 的**交付卡片**，本插件因此读同一份 turn data 的 `presented` 字段并自行渲染该段（见 `src/client/Deliverables.tsx`）；
- 仅当轮次既无改动也无交付时选择器才返回 `null`，把行让给链上后续条目——插件被移除/禁用时向内置于 `dsh-coding-sidebar` 的接管行回退，无需清理。
- 交付卡片的原生打开走主机同源路由 `/api/present.host` / `/api/present.open`（由内置 ui-deliverables 的 node 半边提供）；路由不存在时自动降级为仅侧栏预览，不影响其余功能。

## 依赖契约

- peer：dsh 生态包（`>=0.1.0-rc.5`）+ `dsh-coding-sidebar`（**optional**——未装侧边栏时仅轮尾行入口可用）+ react；
- `dsh.client.inject`：dsh-client-runtime / locale / ui-conversation / dsh-coding-sidebar。

## 构建

```bash
pnpm install
pnpm build      # tsc types + tsdown → lib/
pnpm typecheck
pnpm smoke      # prepack 自动跑：形态/行为 40 项 + 轮尾行渲染 13 项
pnpm smoke:render  # 只跑渲染级校验
```

## Lineage

- Originally a port of [left0ver/dsh-file-review](https://github.com/left0ver/dsh-file-review)（MIT，© ZhangWenChao，署名依 MIT 保留）；
- 曾以 dsh-file-review-tab 收编于 kkutysllb/dsh-plugins，内置形态为 @kcoder/file-review；v1.0.0 起独立发布线。

## 许可

MIT © dsh-external
