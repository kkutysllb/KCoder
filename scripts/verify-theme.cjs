#!/usr/bin/env node
/**
 * 主题跟随契约验证：确认 theme-watcher 的 WATCH_JS 能捕获上游 Web UI
 * 的主题 DOM 变化并经 console 通道上报（主进程据此同步 nativeTheme）。
 *
 * 验证链路：注入真实 WATCH_JS → 模拟上游主题切换（toggle
 * body[data-ds-dark-theme] + colorScheme）→ 断言 console-message 收到
 * `__dsh_theme__:light|dark`。
 *
 * 上游 DOM 契约变更后运行本脚本即可快速复检。
 *
 * 用法：pnpm exec electron scripts/verify-theme.cjs http://127.0.0.1:<port>
 */
const { app, BrowserWindow } = require('electron')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')

const ROOT = resolve(__dirname, '..')
const url = process.argv[2]
if (!url) {
  console.error('usage: electron scripts/verify-theme.cjs http://127.0.0.1:<port>')
  process.exit(1)
}

// 从源码提取真实 WATCH_JS（与主进程产物同源，保证测的是真实逻辑）
const src = readFileSync(resolve(ROOT, 'desktop/main/theme-watcher.ts'), 'utf8')
const m = src.match(/const WATCH_JS = `([\s\S]*?)`\n\n\/\*\* 当前应使用的原生外观/)
if (m === null) {
  console.error('✗ 无法从 theme-watcher.ts 提取 WATCH_JS（模板变动？）')
  process.exit(1)
}
const watchJs = m[1]

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1400, height: 900, show: false })
  const reports = []
  // 兼容新旧 console-message 签名（新版 message 在 event 对象上）
  const onConsole = (event, ...rest) => {
    const maybe = event && typeof event.message === 'string' ? event.message : rest[2]
    if (typeof maybe === 'string' && maybe.startsWith('__dsh_theme__:')) reports.push(maybe)
  }
  win.webContents.on('console-message', onConsole)
  await win.loadURL(url)
  // 等上游插件树应用初始主题
  await new Promise((r) => setTimeout(r, 9000))

  await win.webContents.executeJavaScript(watchJs, true)
  await new Promise((r) => setTimeout(r, 800))

  // 模拟上游切到浅色（还原上游 publish 的两处 DOM 落点）
  await win.webContents.executeJavaScript(`(() => {
    document.body.removeAttribute('data-ds-dark-theme')
    document.documentElement.style.colorScheme = 'light'
  })()`, true)
  await new Promise((r) => setTimeout(r, 800))

  // 再切回深色
  await win.webContents.executeJavaScript(`(() => {
    document.body.setAttribute('data-ds-dark-theme', '')
    document.documentElement.style.colorScheme = 'dark'
  })()`, true)
  await new Promise((r) => setTimeout(r, 800))

  console.log('console 通道上报序列:', JSON.stringify(reports))
  const hasInitial = reports.length > 0
  const sawLight = reports.includes('__dsh_theme__:light')
  const sawDark = reports.includes('__dsh_theme__:dark')
  const pass = hasInitial && sawLight && sawDark
  console.log(pass
    ? '✓ 主题跟随链路正常：初始上报 + 深→浅→深切换均被捕获'
    : '✗ 链路异常（需检查注入脚本或上游 DOM 契约）')
  app.exit(pass ? 0 : 1)
}).catch((e) => {
  console.error('✗ 验证脚本异常:', e?.message ?? e)
  app.exit(1)
})
