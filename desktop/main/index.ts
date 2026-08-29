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
import { closePanels, markQuitting, showBootstrap, showLanding, showShellWindow } from './windows'
import { authLoggedIn, initAuthSession } from './auth'
import { terminalPanel } from './terminal-panel'
import { bundledRuntimeArchive, upstreamBuilt, upstreamCloned } from './dsh-contract'
import { ensureKcoderBundles } from './kcoder-skills-bundle'
import { syncLanguagePatch } from './language-settings'
import { ensureBuiltinMcpServers } from './mcp-builtin'
import { ensureProfilePatches } from './profile-patches'
import { ensurePresetPlugins } from './preset-plugins'
import { initUpdater } from './updater'
import { applyNativeTheme, currentLandingTheme, currentThemePref } from './theme-watcher'
import { getSettings } from './store'
import { homedir } from 'node:os'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

// 诊断开关（临时）：KC_REMOTE_DEBUG_PORT=9333 pnpm dev 开 CDP，
// 供渲染进程死循环现场抓 Profiler 热点；不动打包默认行为。
if (process.env.KC_REMOTE_DEBUG_PORT !== undefined) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.KC_REMOTE_DEBUG_PORT)
}

// 引擎用户数据目录：与上游共享默认 `~/.dsh`（不预置 DSH_HOME）——
// 会话/凭据/插件/profile 与 dsh CLI / npx dsh web 完全同一套，插件
// 市场安装与更新全链统一；用户显式设置 DSH_HOME 时上游自行尊重之
//（排障/有意隔离数据的场景）。目录创建无需干预：各物化链与 dsh 启
// 动均 recursive mkdir。

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
  const regDirs: string[] = []
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
  if (process.platform === 'win32') {
    // Windows 环境块是进程启动时的快照：winget 等安装器把新工具目录写
    // 注册表（HKCU/HKLM Environment），已运行的终端/IDE 及其子进程
    // （pnpm dev → electron）即使新开 tab 也只继承宿主进程的旧快照
    // （重开终端窗口不够，须重宿主；GUI 启动的打包版同理）。
    //
    // 两个真实语义缺口（v0.2.9 插件更新 ERR_PNPM_UNEXPECTED_STORE 根因）：
    // ①注册表 PATH 里的 %VAR%（如 %PNPM_HOME%\bin）不能只靠 process.env
    // 展开——快照里没有该变量时条目展开失败被丢弃（用户自装 pnpm 在
    // User PATH 首条，丢了它 dsh 就调到 Roaming\npm 的旧版 pnpm，store
    // v10 vs profile 已链接的 v11 直接冲突）；②顺序：真实新进程 PATH =
    // 注册表 Machine+User 拼接，注册表顺序就是用户新终端里的优先级，
    // 旧快照只做去重补充——与 macOS login shell 增强同构。
    const regEnv = (key: string): Array<[string, string]> => {
      try {
        const r = spawnSync('reg', ['query', key], { timeout: 3000, encoding: 'utf8', windowsHide: true })
        if (r.status !== 0 || typeof r.stdout !== 'string') return []
        const out: Array<[string, string]> = []
        // reg.exe 输出恒 CRLF：split 按行尾正则切掉 \r——行尾残留 \r 会让
        // (.*)$ 失配（JS 的 . 不匹配 \r，无 m 标志的 $ 只认串尾），
        // 变量表整个丢拼（v0.2.9 %PNPM_HOME% 展不开即此坑）
        for (const line of r.stdout.split(/\r?\n/)) {
          const m = /^\s+(\S+)\s+REG_(?:EXPAND_)?SZ\s+(.*)$/.exec(line)
          if (m !== null) out.push([m[1], m[2].trim()])
        }
        return out
      } catch {
        return []
      }
    }
    const HKLM_ENV = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'
    const HKCU_ENV = 'HKCU\\Environment'
    // 变量表：process.env 优先，注册表兜底（Machine 先读——Windows 语义
    // 上 User 变量可引用 Machine 变量，反向不行）
    const regVars = new Map<string, string>()
    for (const key of [HKLM_ENV, HKCU_ENV]) {
      for (const [k, v] of regEnv(key)) {
        if (!regVars.has(k)) regVars.set(k, v)
      }
    }
    const expandVars = (s: string): string =>
      s.replace(/%([^%]+)%/g, (_, k) => process.env[k] ?? regVars.get(k) ?? `%${k}%`)
    const regPath = (key: string): string[] => {
      try {
        const r = spawnSync('reg', ['query', key, '/v', 'Path'], { timeout: 3000, encoding: 'utf8', windowsHide: true })
        if (r.status !== 0 || typeof r.stdout !== 'string') return []
        const m = /^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/m.exec(r.stdout)
        if (m === null) return []
        return expandVars(m[1].trim()).split(delim).filter((d) => d !== '' && existsSync(d))
      } catch {
        return []
      }
    }
    // 保序去重（Machine+User 可能有重复条目）
    for (const d of [...regPath(HKLM_ENV), ...regPath(HKCU_ENV)]) {
      if (!regDirs.includes(d)) regDirs.push(d)
    }
  }
  const home = homedir()
  // 兜底：常见 pnpm 安装位（login shell 不可用时仍能找到 pnpm）
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
  if (process.platform === 'win32') {
    // 注册表序在前（真实新进程语义），旧快照去重补充，兜底最后
    const have = new Set(regDirs)
    const tail = current.filter(d => !have.has(d))
    const back = [...extra].filter(d => !have.has(d) && !tail.includes(d))
    if (tail.length > 0 || back.length > 0) {
      process.env.PATH = [...regDirs, ...tail, ...back].join(delim)
    }
  } else {
    const have = new Set(current)
    const add = [...extra].filter(d => !have.has(d))
    if (add.length > 0) process.env.PATH = [...current, ...add].join(delim)
  }
}

/** splash 窗口引用（切到 shell 后关闭）。 */
let bootstrap: Electron.BrowserWindow | null = null

app.whenReady().then(() => {
  // 鉴权会话恢复先行：登录态用上游最后已知主题（马上进 shell），
  // 未登录用 landing 自己的主题选择（马上显示 landing，与上游解耦）。
  // 原生标题栏/菜单栏在首个窗口出现前就对色
  initAuthSession()
  applyNativeTheme(authLoggedIn() ? currentThemePref() : currentLandingTheme())
  registerIpc()
  installMenu()
  installTray()
  wireMenuRefresh() // dsh/更新状态变化 → 重建菜单与托盘
  initUpdater() // 自动更新：启动后静默检测，下载完成侧边栏出现安装按钮

  // 启动即显示 landing（单例入口）：服务在后台准备，用户决定何时进入工作台
  bootstrap = showLanding()

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
  // KCoder 内置 dsh bundle（技能包 + 语言指令）物化进 web profile
  // （幂等；dsh 读取 profile 清单在此之前完成注册）
  ensureKcoderBundles()
  // 「强制中文回答」开关同步 home patch 层（幂等；必须在 dsh 启动前，
  // 组合树首次挂载即带上该行覆盖）
  syncLanguagePatch()
  // 内置 MCP 服务器物化（幂等；首次启动写入全部条目，升级时只追加新增项）
  ensureBuiltinMcpServers()
  // 上游插件缺陷补丁物化（幂等；跨平台——Windows 无 launchd，随包分发
  // 的唯一通道；插件已装但补丁未生效时触发一次 pnpm install）
  ensureProfilePatches()
  // 预置第三方插件物化（幂等；Windows 全新安装 profile 为空模板，开箱
  // 即预置 vision-router / context / better-sidebar，含缺陷补丁自动应用）
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
