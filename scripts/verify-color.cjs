#!/usr/bin/env node
/**
 * 标题栏色值契约验证：theme-watcher 硬编码的窗口底色 token 是否仍与
 * 上游侧边栏实际渲染色一致（上游换 token 值时会漂移，此脚本即可发现）。
 *
 * 链路：读 theme-watcher.ts 中的深/浅 token → 加载上游 Web UI → 取
 * 侧边栏根元素（logoRow 的父级，背景 = --dsw-specific-sidebar-fill）
 * 的 computed backgroundColor → 逐通道比对。
 *
 * 用法：pnpm exec electron scripts/verify-color.cjs http://127.0.0.1:<port>
 */
const { app, BrowserWindow } = require('electron')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')

const ROOT = resolve(__dirname, '..')
const url = process.argv[2]
if (!url) {
  console.error('usage: electron scripts/verify-color.cjs http://127.0.0.1:<port>')
  process.exit(1)
}

// 从 theme-watcher.ts 提取 token 色值（与主进程产物同源）
const src = readFileSync(resolve(ROOT, 'desktop/main/theme-watcher.ts'), 'utf8')
const dark = src.match(/'dark'\) return '(#[0-9A-Fa-f]{6})'/)
const light = src.match(/'light'\) return '(#[0-9A-Fa-f]{6})'/)
if (dark === null || light === null) {
  console.error('✗ 无法从 theme-watcher.ts 提取 token 色值（实现变动？）')
  process.exit(1)
}

const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1400, height: 900, show: false })
  await win.loadURL(url)
  await new Promise((r) => setTimeout(r, 9000))

  // 侧边栏根 = logoRow 的父级；其背景即 --dsw-specific-sidebar-fill
  const computed = await win.webContents.executeJavaScript(`(() => {
    const row = document.querySelector('[class*="logoRow"]')
    const root = row ? row.parentElement : null
    return root === null ? null : getComputedStyle(root).backgroundColor
  })()`, true)

  if (computed === null) {
    console.error('✗ 未找到侧边栏根元素（logoRow 契约失效？）')
    app.exit(1)
    return
  }
  const m = computed.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
  if (m === null) {
    console.error('✗ 意外的 backgroundColor:', computed)
    app.exit(1)
    return
  }
  const actual = [+m[1], +m[2], +m[3]]
  const darkTok = hexToRgb(dark[1])
  const lightTok = hexToRgb(light[1])
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 1)
  const isDark = near(actual, darkTok)
  const isLight = near(actual, lightTok)
  console.log(`侧边栏实际渲染色: ${computed}（theme-watcher token：dark=${dark[1]} light=${light[1]}）`)
  const pass = isDark || isLight
  console.log(pass
    ? `✓ 一致（当前主题：${isDark ? '深色' : '浅色'}），标题栏底色与主界面无缝`
    : '✗ 色值漂移：上游 token 已变，请更新 theme-watcher.ts 的 themeBackgroundColor()')
  app.exit(pass ? 0 : 1)
}).catch((e) => {
  console.error('✗ 验证脚本异常:', e?.message ?? e)
  app.exit(1)
})
