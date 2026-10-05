# @kkutysllb/dsh-terminal

> **侧边栏嵌入式终端**——主界面底部的真实终端（xterm.js + node-pty，VS Code 同款体验）：per-workspace 面板桶、RPC（`/dsh-terminal/api/rpc` + SSE 输出流）、工作区探针与乱序防御、布局让位协议。

自 KCoder 内置包独立发布的 dsh 插件（v1.0.0 起独立版本线）。

## dsh 0.2.x 兼容声明（v1.2.0 起；v1.2.2 扩上界）

manifest 按新代插件约定声明兼容面，供 plugin-manager 的安装前检查与
app-boot 的启动准入评估（两处共用同一检查器：只看 `@deepseek-ai/dsh`
与 `@deepseek-ai/dsh-*` 前缀的 peer，`includePrerelease: true` 语义）：

- `dsh.manifestVersion: 1` —— 新 manifest 格式版本标记；
- `peerDependencies`：`@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-host-webserver`
  （插件绑定的 webServer 服务所在包）声明 `>=0.1.6-alpha.2 <1.0.0`。
  该范围在 prerelease 参与匹配的语义下同时命中 0.1.6-alpha.2（v1.1.x 线的
  适配基线）、0.2.0-rc.2（2026-10 在 KCoder 桌面实机实测：spawn/回放/面板
  几何/工作区探针全通过）与 0.2.1-alpha.1（上游 2026-10-03 prerelease）；
  **旧上界 `<0.2.0` 会把 `0.2.1-alpha.1` 判为失配**（`0.2.1-alpha.1` 不满足
  `<0.2.0`），导致 app-boot 兼容闸门**静默跳过整个 bundle**——v1.2.2 起改为
  `<1.0.0`，跨大版本时再按契约重审；
- `engines`：`node >=20`（运行时基线）、`dsh` 同 peer 范围（声明性文档，
  当前无读取方强制）。

未声明 peer 的包不受准入约束（缺省即放行）；显式声明是同仓生态
（dsh-coding-sidebar 1.0.35+ / dsh-file-review-kcoder 1.0.11+ /
dsh-super-ppts 等）的现行约定，换来管理器的兼容展示与失配拦截。
profile 侧 `autoInstallPeers: false` 下，声明的 peer 缺失只会产生
pnpm 警告，不阻断安装（KCoder 桌面壳会自动补 `peerDependencyRules`）。

### 开关按钮锚点链（v1.2.0 起）

面板开关按钮按宿主形态二选一注入：

- **KCoder 桌面壳**：主进程 `executeJavaScript` 注入的自绘标题栏
  `#__dsh_desktop_titlebar`（绝对定位 `right:44`）——v1.1.x 唯一锚点；
- **原生 dsh web/桌面壳**：上游会话头右上角动作区
  `[data-slot="conversation.session.header.corner"]`（slot 工具化 DOM，
  外层另有非哈希 `data-conversation-header-corner` 兜底）——原生壳没有
  锚点 1，v1.1.x 在此形态按钮永不出现；corner 内按钮 28px 对齐邻居、
  `no-drag`（头行整体 `data-window-drag`）、颜色随头行主题。会话头仅
  会话页渲染，其余页面按钮随路由消失属预期（5s 巡逻重建）。

## QiLin 双通道适配（v1.1.0 起）

manifest 同时声明 `qilin` 与 `dsh` 两个通道的 `bundle.patch` / `client`：
QiLin（dsh alpha.2 合并后）的插件管理器只认原生键 `qilin.bundle.patch`
（缺失会报"没有声明组合包"），DSH 宿主仍读 `dsh.*`；两通道指向同一份
`cordis.patch.yml` 与 client 交付物，行为完全一致。

## QiLin 引擎安装

```bash
# npm registry（推荐：版本可被插件管理检测，用户手动更新）
# npm registry (recommended: version detection with manual updates)
qilin plugin --profile qilin add @kkutysllb/dsh-terminal

# GitHub 直装 / install straight from GitHub
qilin plugin --profile qilin add github:kkutysllb/dsh-terminal
```

装完在 QiLin 设置 → 内置插件里可见、可启停；终端面板经标题栏
"切换内嵌终端"开关展开。

### 注意事项（QiLin）

- **必须经 `qilin plugin add` 装进 profile**：包会落到 profile 私有的
  `~/.qilin/profiles/<name>/node_modules`——裸包名原生解析的第一跳。
  **不要**手工把包目录放进共享的 `~/.qilin/profiles/node_modules`：
  dsh alpha.2 合并后的 runtime+enforce 解析把该目录划为安装保留区，
  放那里的 bundle 层包激活时直接 `failed to import`。
- **引擎版本**：运行需要带 dsh 兼容层的 QiLin 3.0.0+；插件**管理**
  （设置页展示/启停）要求 3.0.2+（alpha.2 合并后只认
  `qilin.bundle.patch` 原生键）。
- **node-pty 依赖**：契约 `^1.1.0`，与引擎生态共享同一物理包；不可解
  析时插件保持挂载并渲染降级卡（`/dsh-terminal/api/deps` 给出 cause
  与可粘贴修复命令），不拖垮宿主。
- **OpenKylin 桌面端**：内置终端由产品启动脚本自动物化（vendor 直提 +
  bundle 注册，同样落 profile 私有锚），无需手动安装。

## 真实终端语义（模式平移自 dsh-coding-sidebar 的 pty-deps / pty-manager）

- **内核级伪终端**：node-pty `spawn`（macOS/Linux 走 forkpty，Windows 走
  ConPTY），`TERM=xterm-256color` + `COLORTERM=truecolor`——vim/htop/
  配色/交互程序完整可用；
- **依赖降级**：node-pty 懒加载永不抛错；缺失/损坏时插件保持挂载，
  `GET /dsh-terminal/api/deps` 返回 cause + 可粘贴修复命令，终端面板
  渲染降级卡（复制 + 重试），不再无声失败；
- **spawn-helper 修复**：插件激活时幂等补回包管理器剥掉的 macOS prebuilt
  助手可执行位（缺失时每个 spawn 都会 `posix_spawnp failed`）；
- **transcript 回放**：每标签服务端维护 1MB 环形缓冲；页面刷新/面板重建
  后经 `snapshot` RPC 回放历史，回放在途的新输出由 client 侧 pending
  队列保序（不重不漏）；restart 清空历史；
- **shell 解析链**：POSIX `$SHELL` → passwd 登录 shell → `/bin/bash`；
  Windows `DSH_TERMINAL_SHELL` → pwsh 探测链（PATH + 已知安装目录）→
  `powershell.exe`；POSIX 以登录 shell 启动（读 profile 文件）。

node-pty 版本契约：`^1.1.0`（v1.1.1 起声明于 dependencies），与 DSH core
（`@deepseek-ai/dsh-subprocess-local`）同 range——同 range 同 integrity 让
pnpm 两侧解析到同一物理包（一份 native 绑定，无漂移）。dsh 0.1.6-alpha.2
起依赖解析默认运行时模式且共享保留区（`profiles/node_modules`）被排除，
未声明的提升副本不再可解析——声明依赖是唯一稳定入口。两种实装形态的
解析路径（0.2.0-rc.2 实测）：

- **pnpm 安装形态**（`dsh plugin add`）：node-pty@1.1.x 落 profile 根
  （`nodeLinker: hoisted`），从插件自身解析；
- **桌面物化形态**（KCoder `ensureKcoderBundles` 直提）：插件目录不经
  pnpm，`node-pty` 由运行时共享区提供（`<home>/profiles/node_modules/
  node-pty`，0.2.0-rc.2 线为 1.2.0-beta.15，prebuilt spawn-helper 在位），
  沿目录树向上解析命中。

### 面板镀铬与 shell 徽标（v1.3.0 起）

- **标签**：前置一枚终端图标（提示符母题，与标题栏开关按钮同一套笔画）。
  标签文字仍是**目录短名**——同工作区多标签时区分度最高，shell 名不重复
  占用标签宽度。
- **header 右侧的 shell 徽标**：显示当前活动标签**真实使用**的 shell 短名
  ——`zsh`（macOS 默认）、`bash`（Linux 默认 / 兜底）、`pwsh` /
  `powershell`（Windows 探测链落点）。取值来自服务端
  `shellDisplayName(s.shell)`，即上面那条解析链的**实际落点**，不是客户端
  按平台猜的：用户自定义 `$SHELL` / `DSH_TERMINAL_SHELL` 时如实反映，spawn
  回退到 bash 时也不会谎报 `zsh`。无活动标签时徽标整体收起。
- **镀铬**：面板上缘 1px 分隔线 + 10px 圆角 + 向上投影（停靠区形态）；分隔线
  与徽标底色由 `color-mix(in srgb, <fg> N%, transparent)` 从既有 token 现算，
  亮暗主题自动跟随，不再硬编码 `rgba(0,0,0,.10)`（旧值在暗色下会脏成灰线）。
  上缘拖条改为**常态隐形、悬停浮出居中胶囊**——旧版把 4px 整条刷成实心分隔
  色，亮色下就是一条突兀的灰杠（「边框痕迹粗糙」的根因）。
- **终端滚动条**：`vendor/xterm.css` 里 `.xterm-viewport` 固定
  `overflow-y:scroll`，而本仓那份 xterm.css 是**裁剪版、不含滚动条配色**——默认
  滚动条直接露出：亮色下白底白条看不出来，暗色下就是面板右缘一条 **15px 白杠**
  （实测 `offsetWidth-clientWidth=15`、设备像素 2754–2783）。现按亮暗主题给它
  一套细滚动条（track 透明 ⇒ 露终端底色，thumb 由 `color-mix(fg)` 派生）。

## 安装

```bash
# npm registry（推荐：版本可被插件管理检测，用户手动更新）
# npm registry (recommended: version detection with manual updates)
dsh plugin --profile web add @kkutysllb/dsh-terminal

# GitHub 直装 / install straight from GitHub
dsh plugin --profile web add github:kkutysllb/dsh-terminal

# 或从 dsh-plugins 真源仓 / or from the dsh-plugins monorepo
dsh plugin --profile web add github:kkutysllb/dsh-plugins#dsh-terminal
```

## 形态

- 纯产物直提包：`entry.js`（cordis 层挂载）+ `client.js`（`window.__ModuleLoader__.load({id})` 注册，经 `/plugins` combo 路由拼接执行） + `cordis.patch.yml`（bundle 层声明）。
- client 面：是；无原生构建、无 server 依赖安装（如含 server 半则在 entry.js 内实现）。

## 开发

- 本仓为开发真源；改动后跑 `node scripts/sync-to-dsh-plugins.mjs` 同步 dsh-plugins 镜像并提交推送。
- 本地跑真 pty 集成用例需 `node-pty` 可解析（开发目录可
  `ln -sfn ~/.dsh/profiles/web/node_modules/node-pty node_modules/node-pty`）；
  沙箱环境会拦 forkpty/exec（`posix_spawnp failed`），需在无沙箱终端跑。
- `pnpm smoke`（prepack 自动）做契约形态校验；`node scripts/create-github-releases.mjs` 同步 release/ 到 GitHub Releases。
- 单测：`node tests/run-tests.mjs`（依赖层 / shell 链 / transcript 回放 /
  桶管理真 pty 用例）。

## 许可

MIT © dsh-external
