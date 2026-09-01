# dsh-file-review-kcoder

> **改动审查**——把 agent 产出的文件变更（行级红绿 diff + 撤销）渲染为对话轮尾审查行与 coding-sidebar 侧边栏 Tab，两个入口同源互不干扰。

自 KCoder 内置包 @kcoder/file-review 独立发布的 dsh 插件（v1.0.0 起完全自立维护，不再以收编/fork 形态延续）。

## 功能

- 对话轮尾审查行：每个产出文件的会话自动附审查入口；
- 侧边栏 Tab：line-level diff（UnifiedDiff）、产出文件列表（ProducedFiles）、逐 hunk 撤销（undo 服务）；
- typert 描述符协议（`./typert`）与远程面（`./remote`）随包导出。

## 安装

```bash
dsh plugin install dsh-file-review-kcoder
```

## 依赖契约

- peer：dsh 生态包（`>=0.1.0-rc.5`）+ `dsh-coding-sidebar`（**optional**——未装侧边栏时仅轮尾行入口可用）+ react；
- `dsh.client.inject`：dsh-client-runtime / locale / ui-conversation / dsh-coding-sidebar。

## 构建

```bash
pnpm install
pnpm build      # tsc types + tsdown → lib/
pnpm typecheck
pnpm smoke      # prepack 自动跑
```

## Lineage

- Originally a port of [left0ver/dsh-file-review](https://github.com/left0ver/dsh-file-review)（MIT，© ZhangWenChao，署名依 MIT 保留）；
- 曾以 dsh-file-review-tab 收编于 kkutysllb/dsh-plugins，内置形态为 @kcoder/file-review；v1.0.0 起独立发布线。

## 许可

MIT © dsh-external
