/**
 * KCoder 主进程入口。
 *
 * 启动流程：单实例锁 → app ready → 菜单/托盘/IPC → landing 窗口 →
 * 启动 dsh 侧车；用户从 landing 主动进入 shell 窗口。
 * 失败则停留在 setup 引导页。退出时优雅关停 dsh。
 *
 * @module desktop/main
 */

import { app, autoUpdater } from 'electron'
import { dshManager } from './dsh-manager'
import { registerIpc } from './ipc'
import { installMenu, installTray, wireMenuRefresh } from './menu'
import { closePanels, markQuitting, showBootstrap, showShellWindow } from './windows'
import { terminalPanel } from './terminal-panel'
import { previewPanel } from './preview-panel'
import { fileActivity } from './file-activity'
import { bundledRuntimeArchive, upstreamBuilt, upstreamCloned } from './dsh-contract'
import { ensureKcoderSkillsBundle } from './kcoder-skills-bundle'
import { ensureBuiltinMcpServers } from './mcp-builtin'
import { ensureProfilePatches } from './profile-patches'
import { ensurePresetPlugins } from './preset-plugins'
import { initUpdater } from './updater'
import { applyNativeTheme, currentThemePref } from './theme-watcher'
import { getSettings } from './store'
import { homedir } from 'node:os'
import { mkdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

// 引擎用户数据目录：独立于同机 dsh-desktop / dsh CLI 的 ~/.dsh——两产品
// 并存时会话/凭据/插件会互串，KCoder 落自己的 ~/.kcoder。必须在任何
// spawn dsh / dshHome() 之前设置：侧车与 dsh CLI 转发都继承主进程 env。
// 用户显式设置了 DSH_HOME 时尊重之（排障/有意共享数据的场景）。
if (process.env.DSH_HOME === undefined) {
  process.env.DSH_HOME = join(homedir(), '.kcoder')
}
mkdirSync(process.env.DSH_HOME, { recursive: true })

// npm registry 透传：GUI 应用不经 shell 启动，引擎进程拿不到用户 npm
// 配置；插件（如 dsh-vision-router）的更新检查读 npm_config_registry，
// 缺省时直连 registry.npmjs.org——国内网络/代理环境下间歇超时即报
//「更新检查失败：unknown」。从 ~/.npmrc 读镜像源预置给引擎（pnpm
// 安装本身会自行读 npmrc，这里只为进程内 fetch）。未配置则不干预。
if (process.env.npm_config_registry === undefined) {
  try {
    const npmrc = readFileSync(join(homedir(), '.npmrc'), 'utf8')
    const m = /^registry\s*=\s*(\S+)/m.exec(npmrc)
    if (m !== null) process.env.npm_config_registry = m[1]
  } catch {
    // 无 ~/.npmrc：不干预，维持默认官方源
  }
}

// PATH 增强：GUI 应用不经用户 shell 启动，PATH 只有系统默认
// （/usr/bin 等），插件管理链 dsh plugin → spawnSync('pnpm') 直接
// ENOENT——「一键更新失败: pnpm not found on PATH」。上游无 pnpm
// 路径定制口子，PATH 是唯一通道；且 brew 版 pnpm 的 shim 还要
// PATH 上有 node。从 login shell 取用户完整 PATH（含 brew/pnpm/
// node），超时/异常时常见 pnpm 安装位兜底；追加去重，不动原有顺序。
{
  const delim = process.platform === 'win32' ? ';' : ':'
  const extra = new Set<string>()
  if (process.platform !== 'win32') {
    const sh = process.platform === 'darwin' && existsSync('/bin/zsh') ? '/bin/zsh' : '/bin/bash'
    try {
      const r = spawnSync(sh, ['-l', '-c', 'printf %s "$PATH"'], { timeout: 3000, encoding: 'utf8' })
      if (r.status === 0 && typeof r.stdout === 'string') {
        for (const dir of r.stdout.split(delim)) if (dir !== '') extra.add(dir)
      }
    } catch {
      // 用户 shell 配置异常（rc 报错/超时）：走兜底
    }
  }
  const home = homedir()
  // 兑底：常见 pnpm 安装位（login shell 不可用时仍能找到 pnpm）
  for (const dir of [
    join(home, 'Library', 'pnpm'),         // pnpm 自装默认（macOS）
    join(home, '.local', 'share', 'pnpm'), // pnpm 自装默认（Linux）
    join(home, 'AppData', 'Local', 'pnpm'),// pnpm 自装默认（Windows）
    '/opt/homebrew/bin',                   // Apple Silicon brew
    '/usr/local/bin',                      // Intel brew / 手装
  ]) {
    const bin = process.platform === 'win32' ? join(dir, 'pnpm.cmd') : join(dir, 'pnpm')
    if (existsSync(bin)) extra.add(dir)
  }
  const current = (process.env.PATH ?? '').split(delim).filter(d => d !== '')
  const have = new Set(current)
  const add = [...extra].filter(d => !have.has(d))
  if (add.length > 0) process.env.PATH = [...current, ...add].join(delim)
}

/** splash 窗口引用（切到 shell 后关闭）。 */
let bootstrap: Electron.BrowserWindow | null = null

app.whenReady().then(() => {
  // 预置上次已知主题：原生标题栏/菜单栏在首个窗口出现前就对色
  applyNativeTheme(currentThemePref())
  registerIpc()
  installMenu()
  installTray()
  wireMenuRefresh() // dsh/更新状态变化 → 重建菜单与托盘
  initUpdater() // 自动更新：启动后静默检测，下载完成侧边栏出现安装按钮

  // 启动即显示 landing：服务在后台准备，用户决定何时进入工作台
  bootstrap = showBootstrap('landing')

  const onStateChanged = (status: { state: string; url: string | null }): void => {
    if (status.state === 'ready') {
      dshManager.removeListener('state-changed', onStateChanged)
    } else if (status.state === 'failed') {
      if (bootstrap !== null && !bootstrap.isDestroyed()) {
        void bootstrap.loadURL(
          process.env.ELECTRON_RENDERER_URL !== undefined
            ? `${process.env.ELECTRON_RENDERER_URL}/#/setup`
            : `file://${__dirname}/../renderer/index.html#/setup`,
        )
      }
    }
  }
  dshManager.on('state-changed', onStateChanged)

  // 上游未就绪时先打开 setup（仍会尝试 PATH dsh / DSH_BIN）；
  // 打包态以内置运行时为准（resources/kcoder-runtime.tar.gz 首启解压），
  // 不依赖本地克隆
  if (bundledRuntimeArchive() === null && (!upstreamCloned() || !upstreamBuilt())) {
    bootstrap?.close()
    bootstrap = showBootstrap('setup')
  }
  // KCoder 内置技能 bundle 物化进 web profile（幂等；dsh 读取 profile
  // 清单在此之前完成注册）
  ensureKcoderSkillsBundle()
  // 内置 MCP 服务器物化（幂等；首次启动写入全部条目，升级时只追加新增项）
  ensureBuiltinMcpServers()
  // 上游插件缺陷补丁物化（幂等；跨平台——Windows 无 launchd，随包分发
  // 的唯一通道；插件已装但补丁未生效时触发一次 pnpm install）
  ensureProfilePatches()
  // 预置第三方插件物化（幂等；Windows 全新安装 profile 为空模板，开箱
  // 即预置 vision-router / context，含缺陷补丁自动应用；genui 已改为
  // 用户经插件市场自行安装，其缺陷补丁仍随自愈链覆盖）
  ensurePresetPlugins()
  dshManager.start()

  app.on('activate', () => {
    // macOS dock 图标点击/Cmd+Tab 切回：优先回到 landing；工作台由
    // 用户从 landing 打开（showShellWindow 对同实例只聚焦不重载）
    if (bootstrap !== null && !bootstrap.isDestroyed()) {
      if (bootstrap.isMinimized()) bootstrap.restore()
      bootstrap.show()
    } else {
      const url = dshManager.status.url
      if (url !== null) showShellWindow(url)
    }
  })
})

/* ---------- 单实例 ---------- */
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (bootstrap !== null && !bootstrap.isDestroyed()) {
      if (bootstrap.isMinimized()) bootstrap.restore()
      bootstrap.show()
    } else {
      const url = dshManager.status.url
      if (url !== null) showShellWindow(url)
    }
  })
}

/* ---------- 退出序列：优雅关停 dsh，绝不留孤儿进程 ---------- */
// 更新安装链路：quitAndInstall 会先关窗口、再 app.quit()——关窗阶段
// before-quit 尚未触发，托盘保活的 close 拦截（hide）会挡住关窗，
// app.quit() 永不执行 → 进程不退（现象：点击安装按钮后 app 卡死，
// 必须手动退出才触发 ShipIt 安装）。before-quit-for-update 恰在关窗
// 前发出（原生 autoUpdater 事件，Electron 文档钦定用于该场景），
// 此处置位退出标志放行。
autoUpdater.on('before-quit-for-update', () => {
  markQuitting()
})

app.on('before-quit', (event) => {
  markQuitting() // 首位置位：主窗口 close 拦截放行，退出不被托盘保活挡死
  terminalPanel.dispose() // 杀内嵌终端 shell（SIGTERM 发出即离开）
  previewPanel.dispose()
  fileActivity.dispose() // 断开 mux 订阅
  if (dshManager.status.state === 'stopped' || dshManager.status.state === 'failed') return
  event.preventDefault()
  void dshManager.stop().then(() => {
    closePanels()
    app.exit(0)
  })
})

app.on('window-all-closed', () => {
  // 托盘常驻：由菜单/托盘“退出”收尾；非 macOS 直接退出。
  // macOS + 偏好设置关掉保活：主窗口销毁即整链退出（停 dsh）
  if (process.platform !== 'darwin' || !getSettings().keepRunningInTray) app.quit()
})

/* ---------- 终端信号兑底：dev 下 Ctrl+C 也不留孤儿 dsh ---------- */
const signalShutdown = (signal: NodeJS.Signals): void => {
  process.removeAllListeners(signal)
  void dshManager.stop().finally(() => app.exit(0))
}
process.on('SIGINT', () => signalShutdown('SIGINT'))
process.on('SIGTERM', () => signalShutdown('SIGTERM'))

/* ---------- 开发期主进程崩溃可读 ---------- */
process.on('uncaughtException', (error) => {
  console.error('[main] uncaught exception:', error)
})
