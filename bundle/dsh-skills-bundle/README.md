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

## QiLin（麒麟）双通道适配（v1.0.2 起）

manifest 同时声明 `qilin` 与 `dsh` 两个通道的 `bundle.patch`（本包无
client 交付物）：QiLin（dsh 0.1.6-alpha.2 合并后）的插件管理器只认
原生键 `qilin.bundle.patch`（缺失会报「没有声明组合包」），DSH 宿主
仍读 `dsh.*`；两通道指向同一份 `cordis.patch.yml`，行为完全一致。

## 麒麟（QiLin）引擎安装

```bash
# npm registry（推荐：版本可被插件管理检测，用户手动更新）
qilin plugin --profile qilin add dsh-skills-bundle

# GitHub 直装 / install straight from GitHub
qilin plugin --profile qilin add github:kkutysllb/dsh-skills-bundle
```

装完在 QiLin 设置 → 插件里可见、可启停；技能集注册进工作台技能面；
KCoder 桌面版仍随版本内置分发。

### 注意事项（QiLin）

- **必须经 `qilin plugin add` 装进 profile**：包会落到 profile 私有的
  `~/.qilin/profiles/<name>/node_modules`——裸包名原生解析的第一跳。
  **不要**手工把包目录放进共享的 `~/.qilin/profiles/node_modules`：
  dsh alpha.2 合并后的 runtime+enforce 解析把该目录划为安装保留区，
  放那里的 bundle 层包激活时直接 `failed to import`。
- **引擎版本**：运行需要带 dsh 兼容层的 QiLin 3.0.0+；插件**管理**
  （设置页展示/启停）要求 3.0.2+（alpha.2 合并后只认
  `qilin.bundle.patch` 原生键）。
- **运行时解析**：dsh alpha.2 起依赖解析默认运行时模式（PR #4471），
  插件运行期导入由 profile 安装图经进程内 generation 解析；本仓
  host 侧零 npm 运行时依赖，天然兼容。

## 形态

- 纯产物直提包：`entry.js`（cordis 层挂载） + `cordis.patch.yml`（bundle 层声明）。
- client 面：否；无原生构建、无 server 依赖安装（如含 server 半则在 entry.js 内实现）。

## 开发

- 本仓为开发真源；改动后跑 `node scripts/sync-to-dsh-plugins.mjs` 同步 dsh-plugins 镜像并提交推送。
- `pnpm smoke`（prepack 自动）做契约形态校验；`node scripts/create-github-releases.mjs` 同步 release/ 到 GitHub Releases。

## 许可

MIT © dsh-external
