/**
 * shell 协议层 electron 接线：`kcoder-app://` 自定义协议 + 主进程内部转发
 * + WebSocket 头改写。纯逻辑在 shell-protocol-core.ts（零依赖，可断言）。
 *
 * 与上游官方桌面壳（apps/desktop）同构而形态不同：文档与 API 全部转发给
 * `dsh web` 侧车（上游是打包 dist 磁盘供给 + IPC 递 injections），HTML 由
 * 本层注入 streamBaseUrl 全局而非 preload 递送——shell 维持 sandbox、无
 * preload、`data-platform` 永不落地（KCoder 自持几何的前提，见 ARCHITECTURE.md
 * §12 铁律 1）。设计、验收与上游分歧记录：plans/kcoder-app-protocol.md。
 *
 * 安全面：宿主签名 cookie 只活在主进程（authFetch 兑换附带，响应扣留
 * set-cookie）；HTTP 转发只认 kcoder-app origin；WS 升级仅放行「本地 shell
 * 窗口 + 页面 origin 正确」的请求并重写 origin/cookie 后交给侧车。
 *
 * @module desktop/main/shell-protocol
 */

import { protocol, session, type BrowserWindow } from 'electron'
import { dshManager } from './dsh-manager'
import {
  HTML_BUFFER_LIMIT,
  SHELL_PAGE_ORIGIN,
  SHELL_PROTOCOL_SCHEME,
  forwardOriginAllowed,
  injectStreamBaseUrl,
  mapForwardTarget,
  sanitizeResponseHeaders,
  shouldBufferHtml,
  stripRequestHeaders,
} from './shell-protocol-core'

/** 本地 shell 窗口供给器（守卫的 webContents 判定用；windows.ts 持有实例）。 */
type ShellWindowGetter = () => BrowserWindow | null

const textResponse = (status: number, body: string): Response =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } })

/**
 * 单次转发：剥浏览器语义头 → authFetch 附宿主 cookie（未兑换的旧版侧车
 * 自动降级裸 fetch，与 legacy 同语义）→ 扣留响应头 → text/html 有界缓冲
 * 注入 streamBaseUrl，其余（API、/plugins bundle、事件流）原样流式透传。
 */
async function forwardShellRequest(request: Request, target: URL): Promise<Response> {
  const response = await dshManager.authFetch(target.href, {
    method: request.method,
    headers: stripRequestHeaders(request.headers),
    body: request.body,
    signal: request.signal,
    redirect: 'manual',
    // 流式请求体（undici RequestInit 拓展；TS DOM lib 未收录）
    duplex: 'half',
  } as RequestInit)
  const headers = sanitizeResponseHeaders(response.headers, target.pathname)
  if (!shouldBufferHtml(response.headers.get('content-type'))) {
    return new Response(response.body, { status: response.status, headers })
  }
  const body = Buffer.from(await response.arrayBuffer())
  if (body.byteLength > HTML_BUFFER_LIMIT) {
    return new Response(body, { status: response.status, headers })
  }
  const html = injectStreamBaseUrl(body.toString('utf8'), target.origin)
  return new Response(html, { status: response.status, headers })
}

/** 注册特权 scheme。必须在 app ready 之前调用（Chromium 启动期固化）。 */
export function registerShellProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SHELL_PROTOCOL_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        codeCache: true,
      },
    },
  ])
}

/**
 * 安装协议处理器与 WS 头改写。app ready 后调用一次（依赖 default session）。
 * @param getLocalShellWindow - 本地 shell 窗口供给器；远程连接窗口不经本层
 *   （它们加载远端真实地址），守卫按 webContentsId 只认本地 shell。
 */
export function installShellProtocol(getLocalShellWindow: ShellWindowGetter): void {
  protocol.handle(SHELL_PROTOCOL_SCHEME, (request) => {
    const hostUrl = dshManager.status.url
    let target: URL | null = null
    try {
      target = mapForwardTarget(request.url, hostUrl ?? '')
    } catch {
      target = null
    }
    // 侧车未就绪：页面拿到可见的 503 而非挂死（landing 状态机本来就等
    // ready 才 showShell，此分支只兜 dsh 重启间隙的零星请求）
    if (hostUrl === null) return Promise.resolve(textResponse(503, 'dsh engine is not ready'))
    if (target === null) return Promise.resolve(textResponse(404, 'not found'))
    if (!forwardOriginAllowed(request.headers.get('origin'))) {
      return Promise.resolve(textResponse(403, 'cross-origin shell request rejected'))
    }
    return forwardShellRequest(request, target).catch((error: unknown) => {
      console.error('[shell-protocol] forward failed:', error)
      return textResponse(502, `shell forward failed: ${String(error)}`)
    })
  })

  // WS 凭据改写（对齐上游 apps/desktop/src/main.ts:712-724）：页面照常连
  // ws(s)://127.0.0.1:<port>（streamBaseUrl 指明，TLS 侧车下即 wss），Chromium
  // 发出的 upgrade 带 kcoder-app origin、无宿主 cookie——此处重写为 Host 视角的
  // same-origin。仅本地 shell 窗口；其余（远程窗口 / webview guest / 主进程自身）
  // 原样放行。
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['ws://127.0.0.1/*', 'wss://127.0.0.1/*'] }, (details, callback) => {
    const shell = getLocalShellWindow()
    const hostUrl = dshManager.status.url
    const cookie = dshManager.authCookieValue
    if (shell === null || shell.isDestroyed() || hostUrl === null || cookie === null
      || details.webContentsId !== shell.webContents.id) {
      callback({})
      return
    }
    const target = new URL(hostUrl)
    const requested = new URL(details.url)
    // 对齐上游：host 与**协议**都要对上（TLS 侧车 ↔ wss，明文侧车 ↔ ws），
    // 防「同 host 的另一协议请求」被误改写。
    if (requested.host !== target.host
      || requested.protocol !== (target.protocol === 'https:' ? 'wss:' : 'ws:')) {
      callback({})
      return
    }
    const headers = Object.fromEntries(
      Object.entries(details.requestHeaders).map(([name, value]) => [name.toLowerCase(), value]),
    )
    // origin 不对 = 不是 shell 页面在连（页面被注入后的越权尝试），掐断
    if (headers.origin !== SHELL_PAGE_ORIGIN) {
      callback({ cancel: true })
      return
    }
    callback({
      requestHeaders: { ...headers, origin: target.origin, cookie, 'sec-fetch-site': 'same-origin' },
    })
  })
}
