/**
 * KCoder 主进程入口。
 *
 * 启动流程：单实例锁 → app ready → 菜单/托盘/IPC → landing 窗口 →
 * 启动 dsh 侧车；用户从 landing 主动进入 shell 窗口。
 * 失败则停留在 setup 引导页。退出时优雅关停 dsh。
 *
 * @module desktop/main
 */

import { app } from 'electron'
import { dshManager } from './dsh-manager'
import { registerIpc } from './ipc'
import { installMenu, installTray, wireMenuRefresh } from './menu'
import { closePanels, markQuitting, showBootstrap, showShellWindow } from './windows'
import { terminalPanel } from './terminal-panel'
import { previewPanel } from './preview-panel'
import { fileActivity } from './file-activity'
import { bundledRuntimeArchive, upstreamBuilt, upstreamCloned } from './dsh-contract'
import { initUpdater } from './updater'
import { applyNativeTheme, currentThemePref } from './theme-watcher'
import { getSettings } from './store'

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
  // 打包态以内置运行时为准（resources/dsh-runtime.tar.gz 首启解压），
  // 不依赖本地克隆
  if (bundledRuntimeArchive() === null && (!upstreamCloned() || !upstreamBuilt())) {
    bootstrap?.close()
    bootstrap = showBootstrap('setup')
  }
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
