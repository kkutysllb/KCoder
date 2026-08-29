# @kcoder/terminal

KCoder 内置嵌入式终端（dsh bundle）：主界面底部的真实终端，VS Code
同款。平移自已退役的 Electron 宿主 `desktop/main/terminal-panel.ts` +
`pty-host.ts` + `desktop/renderer/src/views/terminal.ts`，功能语义保持
一致，壳从 WebContentsView + IPC 换成 dsh web 插件（页面内 DOM 面板 +
webServer RPC/SSE）。

## 能力

- **真实 pty 多标签**：node-pty（VS Code 同款），每标签一个 shell
  进程（`$SHELL --login`，win32 powershell）；新建/关闭/重启/清屏。
- **每工作区独立**：以工作目录为桶键，每个工作区私有标签池与开合
  记忆；切工作区仅切显示——进程与 xterm buffer 全程存活不销毁。
- **工作区跟随**：选中会话 fiber 解析 + `session/list` RPC（强信号
  唯一映射；弱信号仅启动初态兜底；乱序代数防御）。
- **布局与让位**：面板 `left` 跟随侧边栏实时宽度（ResizeObserver）；
  内容列 padding-bottom + `--dsh-terminal-inset` 让对话区不被遮挡。
- **双主题**：跟随 `data-ds-dark-theme` 实时重涂（上游 token 同款）。
- **拖高记忆**：header 上缘 4px 拖条，clamp 140–620，localStorage。
- **右键菜单**：复制/粘贴/清屏/新建/关闭（navigator.clipboard）。

## 与退役宿主实现的差异

| 维度 | 宿主（退役前） | 插件 |
| --- | --- | --- |
| 面板形态 | 每工作区一个 WebContentsView | 页面内 fixed DOM（z-index 900，低于上游 modal） |
| 传输 | IPC 推送（terminal:data/exit） | SSE `/kc-terminal/api/stream`（断线 3s 重连） |
| 高度持久化 | 主进程 settings | localStorage `kc-terminal-panel-h` |
| 剪贴板 | preload bridge IPC | navigator.clipboard |
| 上下文沉浸让位 | console 上报 + ctxMode 冻结协议 | DOM 层叠天然让位（协议省略） |
| ⌘W 关标签 | 视图内拦截 | 砍掉（主页面 ⌘W 属关窗语义不可拦）；⌘T 保留 |
| xterm 依赖 | renderer node_modules | vendor/ 三件（server 白名单托管，client 懒拉 eval） |

## 结构

- `entry.js` — server 半：PtyHost（桶管理 + node-pty spawn）+ RPC
  （`POST /kc-terminal/api/rpc`：tabs/new/write/resize/restart/close）
  + SSE 输出流 + vendor 静态托管；isTrusted 与 @kcoder/git-panel 同款。
- `client.js` — 页面半：标题栏按钮（`__dsh_kc_term_btn`，right:44，
  拖拽区 no-drag）+ 底部面板 + 工作区/侧栏探针 + SSE 路由。
- `vendor/` — `xterm.js` / `addon-fit.js` / `xterm.css`（@xterm/xterm
  与 @xterm/addon-fit 官方 dist，UMD 挂 `window.Terminal` /
  `window.FitAddon`）。
- `tests/run-tests.mjs` — node 直跑：桶管理/参数校验纯逻辑 + 真 pty
  spawn 集成用例（`node tests/run-tests.mjs`）。

## 依赖

- `node-pty`：不从 bundle 携带，运行时经 `createRequire` 向上解析
  （dsh runtime 自带，dsh-tool-bash 同款依赖）。
- dsh 契约：`ctx.webServer.register`（prefix 路由，SSE 持有响应合法）。
