# dsh-skills-bundle

> **方法论技能包**——激活时扫描包内 skills/ 目录注册为 runtime skill（rank 250，项目级 .dsh/skills 同名技能可覆盖）。适配自 KSkills 仓库。

自 KCoder 内置包独立发布的 dsh 插件（v1.0.0 起独立版本线）。

## 安装 / Install

```bash
# npm registry（推荐：版本可被插件管理检测，用户手动更新）
# npm registry (recommended: version detection with manual updates)
dsh plugin --profile web add dsh-skills-bundle

# GitHub 直装 / install straight from GitHub
dsh plugin --profile web add github:kkutysllb/dsh-skills-bundle

# 或从 dsh-plugins 真源仓 / or from the dsh-plugins monorepo
dsh plugin --profile web add github:kkutysllb/dsh-plugins#dsh-skills-bundle
```

> KCoder 桌面版内置本包（随版本分发，无需安装）。/ Bundled with KCoder desktop — no install needed there.

## 形态

- 纯产物直提包：`entry.js`（cordis 层挂载） + `cordis.patch.yml`（bundle 层声明）。
- client 面：否；无原生构建、无 server 依赖安装（如含 server 半则在 entry.js 内实现）。

## 开发

- 本仓为开发真源；改动后跑 `node scripts/sync-to-dsh-plugins.mjs` 同步 dsh-plugins 镜像并提交推送。
- `pnpm smoke`（prepack 自动）做契约形态校验；`node scripts/create-github-releases.mjs` 同步 release/ 到 GitHub Releases。

## 许可

MIT © dsh-external
