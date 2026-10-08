#!/usr/bin/env node
/**
 * shell 协议层判据断言 —— `plans/kcoder-app-protocol.md` 阶段 1 的落点。
 *
 * ## 为什么需要它
 *
 * kcoder-app:// 协议层的全部风险集中在「头处理」与「HTML 注入」这两段纯逻辑：
 * 扣漏一个 `set-cookie` 宿主 cookie 就泄进页面；`/plugins/*` 忘写 no-store，
 * 恒定 origin 的磁盘缓存会把陈旧 bundle 钉到永久（插件「更新了没生效」）；
 * streamBaseUrl 注入失败，页面能启动但 WS 永远连不上——全是静默故障。这层
 * 没有单测框架，按仓库惯例用 check-*.mjs 钉住。
 *
 * 本脚本导入 `desktop/main/shell-protocol-core.ts` 本尊（Node ≥22.18 原生
 * 类型擦除），不是副本——判据只有一份。electron 接线半区不在此测
 * （protocol.handle / webRequest 属 GUI 面，归 smoke-shell-protocol）。
 *
 * ## 用法
 *
 *   node scripts/check-shell-protocol.mjs
 *
 * 退出码：0 = 全过；1 = 有断言失败。
 */

const core = await import(new URL('../desktop/main/shell-protocol-core.ts', import.meta.url).href)

let failed = 0
let passed = 0

/** 断言助手：eq = 深相等比较（JSON 序列化足够本层形状）；ok = 真值。 */
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) {
    passed += 1
  } else {
    failed += 1
    console.error(`✗ ${name}\n    期望: ${b}\n    实际: ${a}`)
  }
}
const ok = (name, truthy) => check(name, Boolean(truthy), true)

/* ---- A. 常量形状（scheme/origin 契约的锚点，改动即故意断言失败） ---- */
check('A1 scheme 名', core.SHELL_PROTOCOL_SCHEME, 'kcoder-app')
check('A2 页面 origin', core.SHELL_PAGE_ORIGIN, 'kcoder-app://app')
check('A3 页面前缀', core.SHELL_PAGE_URL_PREFIX, 'kcoder-app://app/')
ok('A4 缓冲上限 ≥ 1MiB', core.HTML_BUFFER_LIMIT >= 1024 * 1024)
ok('A5 扣留清单含 set-cookie', core.WITHHELD_RESPONSE_HEADERS.includes('set-cookie'))
ok('A6 扣留清单含逐跳头', core.WITHHELD_RESPONSE_HEADERS.includes('transfer-encoding')
  && core.WITHHELD_RESPONSE_HEADERS.includes('connection'))

/* ---- B. shell 页面判定 ---- */
ok('B1 页面根', core.isShellPageUrl('kcoder-app://app/'))
ok('B2 页面子路径', core.isShellPageUrl('kcoder-app://app/session/x?y=1'))
ok('B3 带参数根', core.isShellPageUrl('kcoder-app://app/?dsh-desktop-titlebar-inset=48'))
ok('B4 about:blank 否', !core.isShellPageUrl('about:blank'))
ok('B5 http 否', !core.isShellPageUrl('http://127.0.0.1:63332/'))
ok('B6 他主机名否', !core.isShellPageUrl('kcoder-app://evil/'))
ok('B7 深链族不同名', !core.isShellPageUrl('kcoder://install-update'))

/* ---- C. 转发地址映射 ---- */
check('C1 路径+搜索透传',
  core.mapForwardTarget('kcoder-app://app/api/session/list?x=1', 'http://127.0.0.1:63332')?.href,
  'http://127.0.0.1:63332/api/session/list?x=1')
check('C2 根路径',
  core.mapForwardTarget('kcoder-app://app/', 'http://127.0.0.1:63332')?.href,
  'http://127.0.0.1:63332/')
check('C3 插件 combo 路径（? 与 & 都在 search 里）',
  core.mapForwardTarget('kcoder-app://app/plugins/??a/client.js,b/client.js&rev=abc', 'http://127.0.0.1:63332')?.href,
  'http://127.0.0.1:63332/plugins/??a/client.js,b/client.js&rev=abc')
check('C4 标题栏占位参数透传',
  core.mapForwardTarget('kcoder-app://app/?dsh-desktop-titlebar-inset=48', 'http://127.0.0.1:63332')?.search,
  '?dsh-desktop-titlebar-inset=48')
ok('C5 非 shell 主机拒绝', core.mapForwardTarget('kcoder-app://evil/x', 'http://127.0.0.1:1') === null)
ok('C6 非 http 侧车基址拒绝', core.mapForwardTarget('kcoder-app://app/x', 'ws://127.0.0.1:1') === null)
ok('C7 垃圾基址拒绝', core.mapForwardTarget('kcoder-app://app/x', 'not a url') === null)
ok('C8 垃圾请求地址拒绝', core.mapForwardTarget('::::', 'http://127.0.0.1:1') === null)

/* ---- D. origin 白名单 ---- */
ok('D1 页面 origin 放行', core.forwardOriginAllowed('kcoder-app://app'))
ok('D2 无 origin 放行（导航/同源 GET）', core.forwardOriginAllowed(null))
ok('D3 http origin 拒绝', !core.forwardOriginAllowed('http://127.0.0.1:63332'))
ok('D4 他协议主机名拒绝', !core.forwardOriginAllowed('kcoder-app://evil'))

/* ---- E. 请求头剥离 ---- */
{
  const headers = new Headers({
    host: 'app', origin: 'kcoder-app://app', cookie: 'dsh-auth-x=v1', 'sec-fetch-site': 'cross-site',
    accept: 'text/html', 'user-agent': 'smoke', 'content-type': 'application/json', range: 'bytes=0-10',
  })
  const out = core.stripRequestHeaders(headers)
  ok('E1 host 剥离', !out.has('host'))
  ok('E2 origin 剥离', !out.has('origin'))
  ok('E3 cookie 剥离', !out.has('cookie'))
  ok('E4 sec-fetch-site 剥离', !out.has('sec-fetch-site'))
  ok('E5 业务头保留', out.get('accept') === 'text/html' && out.get('range') === 'bytes=0-10')
  ok('E6 大小写不敏感', out.get('User-Agent') === 'smoke')
}

/* ---- F. 响应头扣留与插件 no-store ---- */
{
  const headers = new Headers({
    'content-type': 'text/html; charset=utf-8',
    'set-cookie': 'dsh-auth-x=v1; HttpOnly',
    'content-encoding': 'gzip',
    'content-length': '123',
    'transfer-encoding': 'chunked',
    connection: 'keep-alive',
    'cache-control': 'no-store',
    'x-custom': 'keep-me',
  })
  const doc = core.sanitizeResponseHeaders(headers, '/')
  ok('F1 set-cookie 扣留', !doc.has('set-cookie'))
  ok('F2 content-encoding 扣留', !doc.has('content-encoding'))
  ok('F3 content-length 扣留', !doc.has('content-length'))
  ok('F4 transfer-encoding 扣留', !doc.has('transfer-encoding'))
  ok('F5 connection 扣留', !doc.has('connection'))
  ok('F6 业务头保留', doc.get('x-custom') === 'keep-me' && doc.get('cache-control') === 'no-store')
  ok('F7 原头不被就地修改', headers.has('set-cookie'))

  const plugin = new Headers({
    'content-type': 'text/javascript',
    'cache-control': 'public, max-age=31536000, immutable',
  })
  const out = core.sanitizeResponseHeaders(plugin, '/plugins/??a/client.js&rev=x')
  check('F8 插件 bundle 强 no-store（防恒定 origin 钉死陈旧 rev）', out.get('cache-control'), 'no-store')
  const api = core.sanitizeResponseHeaders(new Headers({ 'cache-control': 'no-store' }), '/api/session/list')
  ok('F9 非 plugins 路径不覆写', api.get('cache-control') === 'no-store')
}

/* ---- G. HTML 注入判定 ---- */
ok('G1 text/html 命中', core.shouldBufferHtml('text/html; charset=utf-8'))
ok('G2 大小写不敏感', core.shouldBufferHtml('Text/HTML'))
ok('G3 javascript 不命中', !core.shouldBufferHtml('text/javascript; charset=utf-8'))
ok('G4 缺席不命中', !core.shouldBufferHtml(null))

/* ---- H. 传输契约全局注入（streamBaseUrl + ownsHost）---- */
{
  const html = '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>'
  const out = core.injectStreamBaseUrl(html, 'http://127.0.0.1:63332')
  ok('H1 注入在 <head> 之后', out.startsWith('<!doctype html><html><head><script>'))
  ok('H2 全局为合法 JSON 字面量', out.includes('globalThis.__DSH_TRANSPORT__={streamBaseUrl:"http://127.0.0.1:63332",ownsHost:true};'))
  ok('H3 原文档内容保留', out.endsWith('<meta charset="utf-8"></head><body></body></html>'))
  check('H4 注入只发生一次', out.split('__DSH_TRANSPORT__').length - 1, 1)
  check('H5 无 <head> 原样返回（§7 契约破坏的可观察形态）',
    core.injectStreamBaseUrl('<html><body>x</body></html>', 'http://127.0.0.1:1'),
    '<html><body>x</body></html>')
  // 判别力自检：origin 带特殊字符时必须被 JSON 转义（脚本注入面）
  const evil = core.injectStreamBaseUrl(html, 'http://127.0.0.1:1/x"onload="')
  ok('H6 特殊字符 JSON 转义', !evil.includes('"onload') || evil.includes('\\"onload'))
  // ownsHost 缺席 = 非回环 origin 下 settings 镜像进 memory 持久化，
  // 提供商目录/设置文档全族静默降级（v0.6.26 现场回归的根因），契约位必须在场
  ok('H7 ownsHost 在场（壳声明自有传输，isLoopback 无视页面 authority）', out.includes(',ownsHost:true};'))
  // 负对照：按 v0.6.26 旧注入模板（无 ownsHost）重建输出，H7 的锚必须在其上变红
  const oldOut = html.replace('<head>',
    '<head><script>globalThis.__DSH_TRANSPORT__={streamBaseUrl:"http://127.0.0.1:63332"};</script>')
  ok('H8 负对照：旧注入形态（无 ownsHost）过不了 H7', !oldOut.includes(',ownsHost:true};'))
}

/* ---- I. 页面地址构造 ---- */
check('I1 标题栏占位参数在位', core.shellPageUrl(48), 'kcoder-app://app/?dsh-desktop-titlebar-inset=48')
check('I2 其他高度', core.shellPageUrl(0), 'kcoder-app://app/?dsh-desktop-titlebar-inset=0')

/* ---- J. origin 兑底 ---- */
check('J1 正常 origin', core.hostOriginOf('http://127.0.0.1:63332/x'), 'http://127.0.0.1:63332')
check('J2 垃圾输入原样返回', core.hostOriginOf('not a url'), 'not a url')

/* ---- 汇总 ---- */
console.log(`check-shell-protocol: ${String(passed)} passed, ${String(failed)} failed`)
if (failed > 0) process.exit(1)
