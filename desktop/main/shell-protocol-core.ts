/**
 * kcoder-app:// 协议层的纯逻辑半区：URL 映射、请求/响应头处理、HTML 注入。
 *
 * 零依赖（不 import electron），可被 Node 直接 import 做断言——判据只有一份，
 * `scripts/check-shell-protocol.mjs` 导入的是本文件本尊（参照 remote-target.ts
 * 形态）。electron 接线（protocol.handle / WS 头改写）在 shell-protocol.ts。
 *
 * 设计与上游依据见 plans/kcoder-app-protocol.md：本协议层是「宿主与侧车」
 * 边界上的纯传输替换——文档与 API 仍由 dsh web 侧车供给，这里只改变
 * 「页面 ↔ 侧车」的相遇方式（loopback loadURL → 恒定 origin + 主进程转发）。
 *
 * @module desktop/main/shell-protocol-core
 */

/** 自定义协议名（与深链 kcoder:// 同品牌族；OS 层无注册、进程内独占）。 */
export const SHELL_PROTOCOL_SCHEME = 'kcoder-app'

/** shell 页面所在主机名（协议内唯一路由；其余主机名一律 404）。 */
export const SHELL_APP_HOST = 'app'

/** shell 页面恒定 origin。 */
export const SHELL_PAGE_ORIGIN = `${SHELL_PROTOCOL_SCHEME}://${SHELL_APP_HOST}`

/** shell 页面地址前缀（重载判据 / will-navigate 守卫用）。 */
export const SHELL_PAGE_URL_PREFIX = `${SHELL_PAGE_ORIGIN}/`

/** HTML 注入的有界缓冲上限。index.html 实际几十 KB；上限只防极端响应进入
 * 字符串处理，超过则原文透传（缺 streamBaseUrl 时 WS 不可用，可见可查）。 */
export const HTML_BUFFER_LIMIT = 2 * 1024 * 1024

/**
 * 转发时从请求头剥掉的浏览器语义头：`host` 由 fetch 按 target 重造；
 * `origin`/`sec-fetch-site` 描述的是 kcoder-app origin，必须换成 Host 视角的
 * same-origin；`cookie` 由主进程统一附带（页面侧永不持有宿主 cookie）。
 */
const STRIPPED_REQUEST_HEADERS = ['host', 'origin', 'cookie', 'sec-fetch-site'] as const

/**
 * 响应扣留清单（对齐上游 apps/desktop WITHHELD_RESPONSE_HEADERS）：
 * `set-cookie` 会把宿主签名 cookie 泄进页面 cookie jar（协议模式下宿主
 * 鉴权只活在主进程）；其余描述 Node fetch 连接层（编码/长度/逐跳头），
 * undici fetch 已透明解压，Chromium 不该看到。
 */
export const WITHHELD_RESPONSE_HEADERS = [
  'set-cookie',
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'te',
  'trailer',
  'upgrade',
  'proxy-authenticate',
  'proxy-authorization',
] as const

/** 插件 bundle 路由（真实形态 `/plugins/??a/client.js,b/client.js&rev=<per-launch>`）。 */
const PLUGIN_BUNDLE_PATH = /^\/plugins\//u

/** 该地址是否是 shell 协议页（含根与任意子路径；about:blank / http 均否）。 */
export function isShellPageUrl(url: string): boolean {
  return url === SHELL_PAGE_ORIGIN || url.startsWith(SHELL_PAGE_URL_PREFIX)
}

/**
 * 把协议请求映射到侧车地址：`kcoder-app://app/path?query` → `<hostOrigin>/path?query`。
 * 主机名非 {@link SHELL_APP_HOST}、hostOrigin 非 http(s)、或任一侧解析失败
 * → null（调用方按 404/403 处理）。query 原样透传——
 * `?dsh-desktop-titlebar-inset=` 宿主占位契约就骑在它上面。
 */
export function mapForwardTarget(requestUrl: string, hostOrigin: string): URL | null {
  let source: URL
  try {
    source = new URL(requestUrl)
  } catch {
    return null
  }
  if (source.protocol !== `${SHELL_PROTOCOL_SCHEME}:` || source.host !== SHELL_APP_HOST) return null
  let base: URL
  try {
    base = new URL(hostOrigin)
  } catch {
    return null
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') return null
  const target = new URL(base)
  target.pathname = source.pathname
  target.search = source.search
  return target
}

/** 转发的 origin 白名单：无 origin（同源 GET/导航）或页面自身 origin 放行。 */
export function forwardOriginAllowed(originHeader: string | null): boolean {
  return originHeader === null || originHeader === SHELL_PAGE_ORIGIN
}

/** 剥浏览器语义头（{@link STRIPPED_REQUEST_HEADERS}），其余原样保留。 */
export function stripRequestHeaders(headers: Headers): Headers {
  const out = new Headers(headers)
  for (const name of STRIPPED_REQUEST_HEADERS) out.delete(name)
  return out
}

/**
 * 响应头扣留 + 插件 bundle 缓存覆写。`/plugins/*` 在侧车侧是
 * `public, max-age=31536000, immutable`（rev 每次启动都变）——恒定 origin 下
 * 磁盘缓存会跨启动钉住陈旧 bundle（插件「更新了没生效」），必须强写 no-store。
 */
export function sanitizeResponseHeaders(headers: Headers, pathname: string): Headers {
  const out = new Headers(headers)
  for (const name of WITHHELD_RESPONSE_HEADERS) out.delete(name)
  if (PLUGIN_BUNDLE_PATH.test(pathname)) out.set('cache-control', 'no-store')
  return out
}

/** 是否该对响应做 HTML 注入（只看 content-type；体量在拿到字节后判）。 */
export function shouldBufferHtml(contentType: string | null): boolean {
  return contentType !== null && contentType.toLowerCase().startsWith('text/html')
}

/**
 * 往 index.html 的 `<head>` 后注入传输契约全局。这是上游契约全局，两个成员：
 *
 * - `streamBaseUrl`：客户端流连接（mux WS）与账号 RPC 读
 *   `globalThis.__DSH_TRANSPORT__?.streamBaseUrl`，缺席才回落
 *   `document.baseURI`——kcoder-app origin 下回落必错（自定义 scheme 进不了
 *   WebSocket），故必须在页面 bootstrap 前置位。
 * - `ownsHost: true`：页面 authority 的回环替身。上游按「页面 origin 是否
 *   回环」判特权面（`ctx.remote.$host.isLoopback`），settings 镜像据此选
 *   host/memory 持久化——kcoder-app://app 非回环 ⇒ 镜像进 memory ⇒ 提供商
 *   目录报「settings are unavailable in this browser」（v0.6.26 现场回归）。
 *   `ownsHost` 是上游给「自己组装传输层的壳」留的显式声明位（客户端文档原文：
 *   served pages never carry the global at all），声明后 isLoopback 无视页面
 *   authority 恒真——本产品页面只能经本协议层触达侧车，声明属实。
 *
 * HTML 无 `<head>`（上游改版）时原文返回：页面可启动但流不可用，属 §7 契约
 * 破坏，靠冒烟与契约清单发现。
 */
export function injectStreamBaseUrl(html: string, hostOrigin: string): string {
  const marker = '<head>'
  if (!html.includes(marker)) return html
  const script = `<script>globalThis.__DSH_TRANSPORT__={streamBaseUrl:${JSON.stringify(hostOrigin)},ownsHost:true};</script>`
  return html.replace(marker, marker + script)
}

/**
 * shell 页面地址：恒定 origin + 宿主标题栏占位契约参数（侧栏类插件据此把
 * 顶边让到自绘条之下）。该参数原先由 legacy 路径的 `shellUrlWithTitlebarInset`
 * 追加以外的 URL 上；legacy 退役（2026-10-10）后由本函数统一自带。
 */
export function shellPageUrl(titlebarInset: number): string {
  const url = new URL(`${SHELL_PAGE_ORIGIN}/`)
  url.searchParams.set('dsh-desktop-titlebar-inset', String(titlebarInset))
  return url.href
}

/** 取 URL 的 origin；解析失败原样返回（重载判据的兑底，不抛）。 */
export function hostOriginOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}
