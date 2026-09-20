# @kkutysllb/dsh-terminal

> **侧边栏嵌入式终端**——主界面底部的真实终端（xterm.js + node-pty，VS Code 同款体验）：per-workspace 面板桶、RPC（`/dsh-terminal/api/rpc` + SSE 输出流）、工作区探针与乱序防御、布局让位协议。

自 KCoder 内置包独立发布的 dsh 插件（v1.0.0 起独立版本线）。

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
未声明的提升副本不再可解析——声明依赖是唯一稳定入口。

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
