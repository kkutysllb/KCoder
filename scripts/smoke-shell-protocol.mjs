/**
 * shell 协议层 GUI 冒烟 —— `plans/kcoder-app-protocol.md` 阶段 3 的落点。
 *
 * ## 测的是什么
 *
 * check-shell-protocol.mjs 钉住了纯逻辑（头处理/HTML 注入/URL 映射），但协议层
 * 的集成面只有真 Chromium 能证：scheme 特权注册（standard/secure/fetch/stream）、
 * protocol.handle 真分发、转发响应在渲染进程可读、streamBaseUrl 注入赶上页面
 * bootstrap、WS upgrade 头改写在 onBeforeSendHeaders 里真的发生。本冒烟用
 * **真协议层 + 假侧车**（本进程内 node http server 冒充 dsh web）过一遍。
 *
 * dshManager 只在边缘打桩（status.url / authCookieValue / authFetch 三个读面），
 * installShellProtocol 的接线原样——断言的是本层行为，不是引擎。
 *
 * ## 断言面
 *
 * - 页面 origin = kcoder-app://app 且 secure context（特权注册生效）；
 * - `__DSH_TRANSPORT__.streamBaseUrl` 指向假侧车（HTML 注入经真 handler 落地）；
 * - `/api` 转发：路径/查询透传、浏览器语义头（host/origin/cookie）被剥；
 * - POST 体经 duplex half 流式往返；
 * - `/plugins/*` 的 immutable 缓存被覆写为 no-store；set-cookie 不进页面 cookie jar；
 * - WS upgrade：本地 shell 窗口的请求被改写 origin/cookie/sec-fetch-site；
 *   **第二个窗口的同类请求原样放行**（webContentsId 门的负对照——改写只认
 *   本地 shell，远程窗口/其他面不受影响）；
 * - 侧车未就绪 → 页面拿到可见 503。
 *
 * 与既有 GUI 冒烟同策：只进本机发版门（release.sh prepush），不进 CI。
 * 用法：`pnpm smoke:shell-protocol`。退出码 0 = 全过。
 */

import { createServer } from 'node:http'
import { doesNotThrow } from 'node:assert'
import { registerHooks } from 'node:module'

// 源码直载的解析钩子：desktop/main 的 TS 模块间是 extensionless 相对导入
// （`./dsh-manager`）——打包器认，Node ESM 不认。这里补 .ts / index.ts 解析；
// 类型擦除由 Electron 44 内置 Node 24 原生承担（process.features.typescript
// = 'strip'）。type-only 导入（如 @shared/ipc-contract）在擦除后不参与解析。
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.')) {
      try {
        return nextResolve(specifier, context)
      } catch {
        try {
          return nextResolve(`${specifier}.ts`, context)
        } catch {
          return nextResolve(`${specifier}/index.ts`, context)
        }
      }
    }
    return nextResolve(specifier, context)
  },
})

// 源码按打包器语义写（CJS 全局可用）：dsh-contract 顶层 `resolve(__dirname,
// '..','..')` 求 PROJECT_ROOT。直载 ESM 无此全局，供 desktop/main 的值。
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
globalThis.__dirname = dirname(fileURLToPath(new URL('../desktop/main', import.meta.url).href))

const { app, BrowserWindow } = await import('electron')

// 兜底：任何未捕获异常/拒绝都要响亮退出，绝不留一个无声挂死的 electron
process.on('uncaughtException', (error) => {
  console.error('SMOKE-CRASH uncaughtException:', error)
  app.exit(1)
})
process.on('unhandledRejection', (reason) => {
  console.error('SMOKE-CRASH unhandledRejection:', reason)
  app.exit(1)
})
// 看门狗：45s 未走完全程 = 某处静默等待，打印阶段现场后失败退出
const STAGE = { at: 'boot' }
setTimeout(() => {
  console.error(`SMOKE-TIMEOUT 停在阶段「${STAGE.at}」`)
  app.exit(1)
}, 45_000).unref()

const {
  installShellProtocol,
  registerShellProtocolScheme,
} = await import(new URL('../desktop/main/shell-protocol.ts', import.meta.url).href)
const { dshManager } = await import(new URL('../desktop/main/dsh-manager.ts', import.meta.url).href)
const { shellPageUrl } = await import(new URL('../desktop/main/shell-protocol-core.ts', import.meta.url).href)

let passed = 0
let failed = 0
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { passed += 1; console.log(`  ✅ ${name}`) } else {
    failed += 1
    console.error(`  ❌ ${name}\n     期望: ${b}\n     实际: ${a}`)
  }
}
const ok = (name, truthy) => check(name, Boolean(truthy), true)

STAGE.at = 'fake-host-listen'
/* ---------- 假侧车：捕获面 + 响应面 ---------- */

const captured = { api: null, upgrade: [] }
const fake = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    // 路由只看 pathname：转发会原样带上查询串（如 ?dsh-desktop-titlebar-inset=48），
    // 精确匹配 req.url 会把带参文档落 404（真实侧车按 pathname 路由，同此语义）
    const path = new URL(req.url, 'http://fake').pathname
    if (path === '/') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'set-cookie': 'dsh-auth-fakeseed=v1; HttpOnly; Path=/',
      })
      res.end('<!doctype html><html><head><meta charset="utf-8"><title>fake-dsh</title></head><body>fake-dsh-doc</body></html>')
      return
    }
    if (path.startsWith('/api/ping')) {
      captured.api = {
        method: req.method,
        url: req.url,
        origin: req.headers.origin ?? null,
        host: req.headers.host ?? null,
        cookie: req.headers.cookie ?? null,
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ pong: true, via: 'fake-dsh' }))
      return
    }
    if (path.startsWith('/plugins/')) {
      res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'public, max-age=31536000, immutable' })
      res.end('export const fake = 1')
      return
    }
    if (path === '/echo' && req.method === 'POST') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end(`echo:${body}`)
      return
    }
    res.writeHead(404)
    res.end()
  })
})
// WS upgrade：只捕获头，随即断开（页面侧 onclose 即达，无需真握手）
fake.on('upgrade', (req, socket) => {
  captured.upgrade.push({ url: req.url, headers: req.headers })
  socket.destroy()
})
await new Promise((resolve) => { fake.listen(0, '127.0.0.1', resolve) })
const fakeOrigin = `http://127.0.0.1:${String(fake.address().port)}`

STAGE.at = 'stub-manager'
/* ---------- dshManager 边缘打桩（own property 遮蔽原型 getter/方法） ---------- */

doesNotThrow(() => {
  Object.defineProperty(dshManager, 'status', {
    configurable: true,
    get: () => ({ state: 'ready', url: fakeOrigin, source: 'env', error: null, restartsLeft: 3 }),
  })
  Object.defineProperty(dshManager, 'authCookieValue', {
    configurable: true,
    get: () => 'dsh-auth-fake=v1',
  })
  dshManager.authFetch = (url, init) => fetch(url, init)
}, 'dshManager 打桩失败')

/* ---------- 注册（必须 ready 前）+ 接线 ---------- */

// scheme 注册必须留在顶层（ready 前）；⚠️ 后续流程全部进 whenReady().then()
// ——Electron ESM 主进程的 ready 事件要等主模块顶层求值结束才发，顶层
// await whenReady() 与之互等 = 死锁（smoke-settings-anchors.mjs 同款警告）。
STAGE.at = 'scheme-register'
registerShellProtocolScheme()
STAGE.at = 'when-ready'
void app.whenReady().then(async () => {
STAGE.at = 'install-protocol'
installShellProtocol(() => shellWindow)

const shellWindow = new BrowserWindow({
  show: false,
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    // 与生产 shell 窗口同款单桥（windows.ts）：铁律 1 唯一例外
    preload: join(__dirname, '../out/preload/host-paths.js'),
  },
})
shellWindow.webContents.on('preload-error', (_e, p, err) => {
  console.error(`[preload-error] ${p}: ${String(err)}`)
})
const pageLoaded = new Promise((resolve, reject) => {
  shellWindow.webContents.once('did-finish-load', resolve)
  shellWindow.webContents.once('did-fail-load', (_e, code, desc) => reject(new Error(`did-fail-load ${String(code)} ${desc}`)))
})
STAGE.at = 'load-page'
await shellWindow.loadURL(shellPageUrl(48))
await pageLoaded
STAGE.at = 'page-asserts'

console.log('── 文档加载与注入面 ──')
{
  const page = await shellWindow.webContents.executeJavaScript(`({
    origin: location.origin,
    href: location.href,
    secure: window.isSecureContext === true,
    streamBase: globalThis.__DSH_TRANSPORT__?.streamBaseUrl ?? null,
    ownsHost: globalThis.__DSH_TRANSPORT__?.ownsHost === true,
    hostPaths: (() => {
      const bridge = globalThis.__DSH_HOST_PATHS__
      if (bridge === undefined) return null
      // 合成 File 无真实路径 ⇒ 上游契约必须回空串（回落字节上传）
      const synthetic = new File(['x'], 'a.txt')
      return { keys: Object.keys(bridge), syntheticPath: bridge.pathFor(synthetic) }
    })(),
    desktopLeak: {
      boot: globalThis.dshDesktopBoot !== undefined,
      product: globalThis.dshDesktop !== undefined,
      platform: document.documentElement.getAttribute('data-platform'),
    },
    cookieLeak: document.cookie,
    doc: document.body.textContent,
  })`)
  check('P1 页面 origin', page.origin, 'kcoder-app://app')
  ok('P2 secure context（secure 特权）', page.secure)
  check('P3 streamBaseUrl 注入并指向侧车', page.streamBase, fakeOrigin)
  ok('P3b ownsHost 注入（settings 镜像 host 持久化的前提；缺它提供商目录报 unavailable）', page.ownsHost)
  check('P3c host-paths 单桥在场且合成 File 回空串（上游契约）', JSON.stringify(page.hostPaths), JSON.stringify({ keys: ['pathFor'], syntheticPath: '' }))
  ok('P3d 桥最小性负对照：data-platform / dshDesktopBoot / dshDesktop 一概不在场（铁律 1 语义保持）',
    page.desktopLeak.boot === false && page.desktopLeak.product === false && page.desktopLeak.platform === null)
  ok('P4 文档体经转发到达', page.doc.includes('fake-dsh-doc'))
  check('P5 set-cookie 扣留（不进页面 cookie jar）', page.cookieLeak, '')
}

STAGE.at = 'api-asserts'
console.log('── API 转发面 ──')
{
  const ping = await shellWindow.webContents.executeJavaScript(
    `fetch('/api/ping?x=1').then(r => r.json())`,
  )
  ok('P6 /api 响应体经转发到达', ping?.pong === true && ping?.via === 'fake-dsh')
  ok('P7 路径+查询透传', captured.api?.url === '/api/ping?x=1')
  check('P8 origin 头被剥（侧车视角无页面 origin）', captured.api?.origin, null)
  ok('P9 host 头按目标重造', (captured.api?.host ?? '').startsWith('127.0.0.1:'))

  const echo = await shellWindow.webContents.executeJavaScript(
    `fetch('/echo', { method: 'POST', body: 'payload-123' }).then(r => r.text())`,
  )
  check('P10 POST 体流式往返（duplex half）', echo, 'echo:payload-123')

  const cache = await shellWindow.webContents.executeJavaScript(
    `fetch('/plugins/??a/client.js&rev=1').then(r => r.headers.get('cache-control'))`,
  )
  check('P11 插件 bundle 覆写 no-store（防恒定 origin 钉死 rev）', cache, 'no-store')
}

STAGE.at = 'ws-asserts'
console.log('── WS 头改写与 webContentsId 门 ──')
{
  // 轮询到目标条数：upgradeWaiters 的一次性唤醒会被前一条 upgrade 抢先（竞态）
  const waitForUpgrade = async (min) => {
    for (let i = 0; i < 100 && captured.upgrade.length < min; i++) {
      await new Promise((resolve) => { setTimeout(resolve, 50) })
    }
  }
  // 主角：本地 shell 窗口的 WS —— 应被改写
  void shellWindow.webContents.executeJavaScript(`new WebSocket('ws://127.0.0.1:${String(fake.address().port)}/mux').addEventListener('close', () => {})`)
  await waitForUpgrade(1)
  const main = captured.upgrade[0]
  ok('W1 upgrade 到达假侧车', main !== undefined)
  check('W2 origin 改写为侧车 origin', main?.headers.origin, fakeOrigin)
  check('W3 cookie 附上（主进程持有）', main?.headers.cookie, 'dsh-auth-fake=v1')
  check('W4 sec-fetch-site 改写 same-origin', main?.headers['sec-fetch-site'], 'same-origin')

  // 负对照：第二个窗口（不同 webContentsId）的同类请求必须原样放行——
  // 证明改写只认本地 shell 窗口，远程窗口 / 其他面不被这层守卫碰到
  const before = captured.upgrade.length
  const win2 = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } })
  await win2.loadURL(`${shellPageUrl(48)}&neg=1`)
  void win2.webContents.executeJavaScript(`new WebSocket('ws://127.0.0.1:${String(fake.address().port)}/mux').addEventListener('close', () => {})`)
  await waitForUpgrade(2)
  const second = captured.upgrade[before]
  check('W5 第二窗口 origin 原样（未改写）', second?.headers.origin, 'kcoder-app://app')
  check('W6 第二窗口 cookie 未附', second?.headers.cookie ?? null, null)
  win2.destroy()
}

STAGE.at = 'unready-asserts'
console.log('── 侧车未就绪面 ──')
{
  Object.defineProperty(dshManager, 'status', {
    configurable: true,
    get: () => ({ state: 'stopped', url: null, source: null, error: null, restartsLeft: 3 }),
  })
  const status = await shellWindow.webContents.executeJavaScript(
    `fetch('/api/anything').then(r => r.status, () => -1)`,
  )
  check('S1 侧车未就绪 → 可见 503（非挂死）', status, 503)
}

fake.close()
app.exit(failed === 0 ? 0 : 1)
console.log(`\nsmoke-shell-protocol: ${String(passed)} passed, ${String(failed)} failed → exit ${String(failed === 0 ? 0 : 1)}`)
})
