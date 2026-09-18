# @kkutysllb/dsh-terminal

> **侧边栏嵌入式终端**——主界面底部的真实终端（xterm.js + node-pty，VS Code 同款体验）：per-workspace 面板桶、RPC（`/dsh-terminal/api/rpc` + SSE 输出流）、工作区探针与乱序防御、布局让位协议。

自 KCoder 内置包独立发布的 dsh 插件（v1.0.0 起独立版本线）。

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

node-pty 版本契约：`^1.1.0`，与 DSH core（`@deepseek-ai/dsh-subprocess-local`）
同 range——同 range 同 integrity 让 pnpm 两侧解析到同一物理包（一份
native 绑定，无漂移）。

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
