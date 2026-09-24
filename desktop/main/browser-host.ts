/**
 * Agent 浏览器宿主（CDP 实况的地基，2026-09-12 方案 2）。
 *
 * 职责：启动并守护一个 KCoder 专用的无头 Chromium，带
 * `--remote-debugging-port=0`（内核自选端口并写入 user-data-dir 下的
 * DevToolsActivePort 文件）。在其前立一个固定端口的 TCP 转发器
 * （127.0.0.1:<FWD_PORT> → 内核实际 CDP 端口），于是：
 *
 * - playwright MCP 以 `--cdp-endpoint http://127.0.0.1:<FWD_PORT>` 连接
 *   （地址恒定，agent 每轮任务连接即可，无窗运行）；
 * - coding-sidebar 浏览器 tab 连同一地址做 screencast 实况 + 输入回传；
 * - 浏览器归 KCoder 管（独立 user-data-dir），登录态跨任务持久。
 *
 * 生命周期：桌面端 ready 后 startBrowserHost()（只起转发器，浏览器按需拉起）；
 * 浏览器进程退出（crash）后由连接驱动的 ensureBrowserHost 重拉；应用
 * before-quit 调 stopBrowserHost() 停转发器并杀浏览器。
 * Chromium 未安装（发现失败）→ 转发器照常监听但连接被立即拒绝——
 * playwright 侧表现为连接错误，与「浏览器未安装」语义一致，不静默伪装。
 *
 * @module desktop/main/browser-host
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { connect, createServer, type Server, type Socket } from 'node:net'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * CDP 转发端口（playwright `--cdp-endpoint` 与侧边栏实况共同的已知地址）。
 *
 * 必须是**函数**且**随 dev/打包两态分流**（2026-09-24 现场修）：
 * `dev-isolation.ts` 让两态能同时运行（userData / 单实例锁 / DSH_HOME 三面已
 * 分离），但 **TCP 端口不是文件系统路径，隔离不了**——两边都绑 9223 时后启动
 * 那台的转发器直接 `EADDRINUSE`（现场：打包态先起，源码态报「agent 浏览实况
 * 不可用」）；更糟的是两边算出的 `--cdp-endpoint` 完全相同，源码态的 agent
 * 浏览会**连到打包态的 Chromium 上**——跨实例串线，正是隔离模块要防的事。
 *
 * 惰性函数而非模块级常量：读模块级绑定会撞 TDZ（与 dev-isolation 同因）。
 * 显式 `KCODER_BROWSER_HOST_PORT` 优先（与 dev-isolation / home-migration 的
 * 「显式 > 一切」一致），便于再开第二个源码态实例。
 */
export function browserHostPort(): number {
  const explicit = Number.parseInt((process.env.KCODER_BROWSER_HOST_PORT ?? '').trim(), 10)
  if (Number.isInteger(explicit) && explicit > 0 && explicit < 65536) return explicit
  return app.isPackaged ? 9223 : 9224
}

/** 独立 user-data-dir（应用 userData 下，登录态跨任务持久）。 */
function hostDataDir(): string {
  const dir = join(app.getPath('userData'), 'browser-host')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Chromium 可执行文件发现：系统 Chrome 优先，playwright 缓存兜底。 */
function discoverChromium(): string | null {
  const candidates: string[] = []
  switch (process.platform) {
    case 'darwin':
      candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
      break
    case 'win32':
      candidates.push(
        join(process.env['PROGRAMFILES'] ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(process.env['LOCALAPPDATA'] ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      )
      break
    default:
      candidates.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium')
  }
  // playwright 自装 chromium 缓存兜底（版本子目录名带 hash，逐个试）
  try {
    const cacheRoot = join(app.getPath('home'), '.cache', 'ms-playwright')
    if (existsSync(cacheRoot)) {
      for (const d of readdirSync(cacheRoot)) {
        if (!d.startsWith('chromium-')) continue
        candidates.push(
          join(cacheRoot, d, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
          join(cacheRoot, d, 'chrome-linux', 'chrome'),
          join(cacheRoot, d, 'chrome-win', 'chrome.exe'),
        )
      }
    }
  } catch { /* 缓存不可读则跳过兜底 */ }
  return candidates.find((p) => p !== '' && existsSync(p)) ?? null
}

/** 内核实际 CDP 端口（DevToolsActivePort 首行；未就绪返回 null）。 */
function activeDevtoolsPort(dataDir: string): number | null {
  try {
    const first = readFileSync(join(dataDir, 'DevToolsActivePort'), 'utf8').split('\n')[0]?.trim()
    const port = Number(first)
    return Number.isInteger(port) && port > 0 ? port : null
  } catch {
    return null
  }
}

let chromium: ChildProcess | null = null
let forwarder: Server | null = null
let stopped = false

/** 确保浏览器在跑（未启动/已崩溃则拉起），并等待 CDP 端口就绪。 */
export async function ensureBrowserHost(): Promise<boolean> {
  if (stopped) return false
  if (chromium !== null && chromium.exitCode === null && activeDevtoolsPort(hostDataDir()) !== null) return true
  const bin = discoverChromium()
  if (bin === null) {
    console.error('[browser-host] 未发现 Chromium/Chrome，agent 浏览不可用（可安装 Chrome 或 npx playwright install chromium）')
    return false
  }
  const dataDir = hostDataDir()
  chromium = spawn(bin, [
    '--headless=new',
    `--user-data-dir=${dataDir}`,
    '--remote-debugging-port=0',
    // Chrome 111+ 起 DevTools WS 会拒带 Origin 头的连接(页面 renderer
    // 的 WebSocket 必带)——官方开关放行全部来源;端口仅绑 127.0.0.1
    '--remote-allow-origins=*',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1440,900',
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true })
  chromium.on('exit', (code) => {
    chromium = null
    if (!stopped) console.warn(`[browser-host] Chromium 退出（code=${code}），下次连接时自动重拉`)
  })
  // DevToolsActivePort 由内核在监听后写入，轮询等就绪（上限 ~10s）
  for (let i = 0; i < 50; i++) {
    if (stopped) return false
    if (chromium.exitCode !== null) return false
    if (activeDevtoolsPort(dataDir) !== null) return true
    await new Promise((r) => setTimeout(r, 200))
  }
  return activeDevtoolsPort(dataDir) !== null
}

/** 启动固定端口转发器（浏览器按需拉起）。应用 ready 后调用一次。 */
export function startBrowserHost(): void {
  if (forwarder !== null) return
  forwarder = createServer((socket) => {
    void ensureBrowserHost()
      .then((ready) => (ready ? activeDevtoolsPort(hostDataDir()) : null))
      .then((port) => {
        if (port === null) {
          socket.destroy()
          return
        }
        const upstream: Socket = connect(port, '127.0.0.1')
        socket.pipe(upstream)
        upstream.pipe(socket)
        upstream.on('error', () => socket.destroy())
        socket.on('error', () => upstream.destroy())
        upstream.on('close', () => socket.destroy())
        socket.on('close', () => upstream.destroy())
      })
      .catch(() => socket.destroy())
  })
  const port = browserHostPort()
  forwarder.on('error', (error) => {
    console.error(`[browser-host] 转发器监听失败 127.0.0.1:${port}（端口占用？agent 浏览实况不可用）:`, error.message)
  })
  forwarder.listen(port, '127.0.0.1', () => {
    console.log(`[browser-host] CDP 转发器就绪 127.0.0.1:${port}`)
  })
  stopped = false
  // 不在启动时预热浏览器：系统 Chrome 的可执行文件在 /Applications/Google
  // Chrome.app 包内，macOS 会把这个后台实例注册成「Google Chrome」应用，
  // 于是每次启动都在 Dock 里多出一个 Chrome 图标（--headless=new 只抑制
  // 窗口，抑制不了应用注册）。改为首个 CDP 连接时按需拉起——上面的
  // connection handler 已经调用 ensureBrowserHost，agent 浏览与侧边栏
  // 实况功能不变，只是首次使用多等 1~3 秒；空闲时不再有常驻浏览器进程。
}

/** 应用退出：停转发器、杀浏览器。 */
export function stopBrowserHost(): void {
  stopped = true
  forwarder?.close()
  forwarder = null
  if (chromium !== null && chromium.exitCode === null) chromium.kill()
  chromium = null
}
