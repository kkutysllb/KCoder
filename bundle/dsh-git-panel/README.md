# @kkutysllb/dsh-git-panel

> **独立 git 工作区面板**——server 只读 git 快照 RPC（`/dsh-git-panel/api/snapshot` 与 open-plan 回退）+ client 页面内浮动面板（分支/工作区/计划视图），注册进侧边栏 Tab 体系。原 KCoder 桌面端宿主 git-panel 的插件化整体替代。

自 KCoder 内置包独立发布的 dsh 插件（v1.0.0 起独立版本线）。

## 安装

```bash
dsh plugin install @kkutysllb/dsh-git-panel
```

## 形态

- 纯产物直提包：`entry.js`（cordis 层挂载）+ `client.js`（`window.__ModuleLoader__.load({id})` 注册，经 `/plugins` combo 路由拼接执行） + `cordis.patch.yml`（bundle 层声明）。
- client 面：是；无原生构建、无 server 依赖安装（如含 server 半则在 entry.js 内实现）。

## 开发

- 本仓为开发真源；改动后跑 `node scripts/sync-to-dsh-plugins.mjs` 同步 dsh-plugins 镜像并提交推送。
- `pnpm smoke`（prepack 自动）做契约形态校验；`node scripts/create-github-releases.mjs` 同步 release/ 到 GitHub Releases。

## 许可

MIT © dsh-external
