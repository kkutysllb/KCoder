#!/usr/bin/env node
/**
 * 注入契约验证：确认 update-injector 的 SHOW_JS 能在上游真实 Web UI
 * DOM 中定位侧边栏 logoRow 并插入可见的安装按钮。
 *
 * 上游 DOM 变更（SidebarRoot 的 CSS modules 类名 logoRow / collapsed）
 * 后运行本脚本即可快速验证注入器是否仍然有效。
 *
 * 用法：pnpm exec electron scripts/verify-inject.cjs http://127.0.0.1:<port>
 * （端口取自运行中的 dsh web；也可在应用诊断面板看到）
 */
const { app, BrowserWindow } = require('electron')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')

const ROOT = resolve(__dirname, '..')
const url = process.argv[2]
if (!url) {
  console.error('usage: electron scripts/verify-inject.cjs http://127.0.0.1:<port>')
  process.exit(1)
}

// 从源码提取真实 SHOW_JS（与主进程产物同源，保证测的是真实逻辑）
const src = readFileSync(resolve(ROOT, 'desktop/main/update-injector.ts'), 'utf8')
const m = src.match(/const SHOW_JS = `([\s\S]*?)`\n\n\/\*\* 移除注入/)
if (m === null) {
  console.error('✗ 无法从 update-injector.ts 提取 SHOW_JS（模板变动？）')
  process.exit(1)
}
const showJs = m[1].replaceAll('${JSON.stringify(BTN_ID)}', JSON.stringify('__dsh_desktop_update_btn'))

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1400, height: 900, show: false })
  await win.loadURL(url)
  // 等上游插件树把侧边栏挂出来
  await new Promise((r) => setTimeout(r, 9000))

  await win.webContents.executeJavaScript(showJs, true)
  // 给轮询/重插留一点时间（若首查时侧边栏未挂载）
  await new Promise((r) => setTimeout(r, 2500))

  const result = await win.webContents.executeJavaScript(`(() => {
    const btn = document.getElementById('__dsh_desktop_update_btn')
    if (btn === null) return { ok: false, reason: '按钮不存在' }
    const row = document.querySelector('[class*="logoRow"]')
    const inRow = btn.parentElement === row
    const visible = btn.offsetWidth > 0 && btn.offsetHeight > 0
    const rail = row?.closest('[class*="collapsed"]') !== null
    return { ok: inRow && visible, inRow, visible, rail, rowClass: row?.className ?? null, size: btn.offsetWidth + 'x' + btn.offsetHeight }
  })()`, true)

  console.log('注入验证结果:', JSON.stringify(result))
  const pass = result.ok === true
  console.log(pass ? '✓ 注入成功：按钮位于侧边栏 logoRow 内且可见' : '✗ 注入失败')
  app.exit(pass ? 0 : 1)
}).catch((e) => {
  console.error('✗ 验证脚本异常:', e?.message ?? e)
  app.exit(1)
})
