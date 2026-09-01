# dsh-language-bundle

> **「强制中文回答」指令包**——system-prompt section 插件（默认 disabled）；宿主或用户层可经 cordis patch 行 `kcoder-language` 热切换 enabled。

自 KCoder 内置包独立发布的 dsh 插件（v1.0.0 起独立版本线）。

## 安装

```bash
dsh plugin install dsh-language-bundle
```

## 形态

- 纯产物直提包：`entry.js`（cordis 层挂载） + `cordis.patch.yml`（bundle 层声明）。
- client 面：否；无原生构建、无 server 依赖安装（如含 server 半则在 entry.js 内实现）。

## 开发

- 本仓为开发真源；改动后跑 `node scripts/sync-to-dsh-plugins.mjs` 同步 dsh-plugins 镜像并提交推送。
- `pnpm smoke`（prepack 自动）做契约形态校验；`node scripts/create-github-releases.mjs` 同步 release/ 到 GitHub Releases。

## 许可

MIT © dsh-external
