# dsh-skills-bundle

> **方法论技能包**——两批技能：**core**（skills/manifest.json，31 项）激活即注册为 runtime skill（rank 250，项目级 `.dsh/skills` 同名技能可覆盖；QiLin 侧对应 `.qilin/skills` 与 `.agents/skills`）；**optional**（skills/optional/，40 项）随包分发但默认不注册，用户在设置页「可选技能」分区按需启用。适配自 KSkills 仓库。

自 KCoder 内置包独立发布的 dsh 插件（v1.0.0 起独立版本线）。

## 可选技能（v1.1.0 起）

- 设置页新增「可选技能」分区（`settings.section` 插槽）：开关卡片列出
  40 个长尾技能，打开即对该引擎的所有会话生效（模型按 description 匹配
  加载，或 `/技能名` 显式调用），关闭即注销。
- 状态面：宿主插件经 `webServer.register({ kind: 'prefix' })` 挂 fenced
  JSON API（`/kcoder-skills/api`，Host 回环信任边界）——`GET catalog`
  出两批清单与启用态，`POST set-enabled` 改启用集并就地重注册（dispose
  旧 optional → 注册新集合），**即时生效、无需重启**。DSH/QiLin 的
  settings RPC 不服务第三方命名空间（dsh-coding-sidebar 同款结论），
  所以读写走插件自有路由。
- 持久化：启用集存 `$QILIN_HOME/kcoder-skills.json`（0600），引擎重启
  后按文件恢复；web 端与桌面端共享同一引擎，状态一致。
- 元数据流水线：`pnpm gen:manifest` 扫 `skills/optional/*/SKILL.md` 的
  frontmatter 生成 `manifest.optional`（core 批保持人工精选，本脚本从不
  改写）；client 侧无法读盘，清单由 manifest 单一事实源对账。

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

- 纯产物直提包：`entry.js`（cordis 层挂载：技能注册 + fenced API） +
  `client.js`（设置分区，HAND-MAINTAINED ModuleLoader 形态，dsh-animations
  同款零构建） + `cordis.patch.yml`（bundle 层声明）。
- client 面：是（设置页「可选技能」分区）；无原生构建、无 server 依赖安装。

## 开发

- 本仓为开发真源；改动后跑 `node scripts/sync-to-dsh-plugins.mjs` 同步 dsh-plugins 镜像并提交推送。
- 技能批变动后跑 `pnpm gen:manifest` 刷新 optional 清单（client 无法读盘，靠 manifest 对账）。
- `pnpm smoke`（prepack 自动）做契约形态校验（含 optional 与目录对账）；
  `pnpm selftest` 跑宿主侧行为自测（mock ctx 全流程：注册数 / fence /
  启停 / 持久化 / dispose）；`node scripts/create-github-releases.mjs` 同步 release/ 到 GitHub Releases。

## 许可

MIT © dsh-external
