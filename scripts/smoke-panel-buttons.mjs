/**
 * win32 四钮平铺让位冒烟：手搓标题栏 + 四枚面板按钮（inline right
 * 12/44/76/108px，desktop/main/panel-buttons.ts SHIFT_JS 的消费现场）
 * → 注入 SHIFT_JS → 断言：
 * - 四钮 computed right 平移至 150/182/214/246（原生 caption 按钮区
 *   138px 左侧安全位），相对间距不变；
 * - 四钮未被隐藏（offsetWidth > 0——旧 panel-menu 方案是 display:none）；
 * - 幂等：重复注入不叠加 style 元素。
 *
 * 运行：pnpm exec electron scripts/smoke-panel-buttons.mjs
 */
import { app, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')

// 从源码提取 SHIFT_JS 模板串原文（无主进程插值，原文即可执行）
const src = readFileSync(join(ROOT, 'desktop/main/panel-buttons.ts'), 'utf8')
const decl = 'const SHIFT_JS = `'
const from = src.indexOf(decl) + decl.length
const end = src.indexOf('\n})()`', from)
if (from < decl.length || end < 0) throw new Error('无法提取 SHIFT_JS')
const shiftJs = src.slice(from, end + 5)

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; font-family: -apple-system, system-ui, sans-serif; }
  #__dsh_desktop_titlebar { position: fixed; top: 0; left: 0; right: 0; height: 48px; padding-right: 138px; box-sizing: border-box; background: #f7f7f8; }
  .pbtn { all: unset; position: absolute; top: 11px; width: 26px; height: 26px; font-size: 12px; text-align: center; }
</style></head><body>
<div id="__dsh_desktop_titlebar">
  <button id="__dsh_desktop_sidebar_panel_btn" class="pbtn" style="right:12px">侧</button>
  <button id="__dsh_kc_term_btn" class="pbtn" style="right:44px">终</button>
  <button id="__dsh_desktop_context_btn" class="pbtn" style="right:76px">上</button>
  <button id="__dsh_kc_git_btn" class="pbtn" style="right:108px">G</button>
</div>
</body></html>`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const IDS = ['__dsh_desktop_sidebar_panel_btn', '__dsh_kc_term_btn', '__dsh_desktop_context_btn', '__dsh_kc_git_btn']
const EXPECT = { __dsh_desktop_sidebar_panel_btn: '150px', __dsh_kc_term_btn: '182px', __dsh_desktop_context_btn: '214px', __dsh_kc_git_btn: '246px' }

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1280, height: 800 })
  const dir = mkdtempSync(join(tmpdir(), 'panel-buttons-smoke-'))
  writeFileSync(join(dir, 'index.html'), html)
  await win.loadFile(join(dir, 'index.html'))
  await win.webContents.executeJavaScript(shiftJs, true)
  await sleep(300)

  const fails = []
  const probe = JSON.parse(await win.webContents.executeJavaScript(`(() => {
    const ids = ${JSON.stringify(IDS)}
    return JSON.stringify(ids.map((id) => {
      const el = document.getElementById(id)
      return { id, right: getComputedStyle(el).right, visible: el.offsetWidth > 0 }
    }))
  })()`, true))
  for (const r of probe) {
    if (r.right !== EXPECT[r.id]) fails.push(`${r.id} right=${r.right} 应为 ${EXPECT[r.id]}（inline 样式未被 !important 压过？）`)
    if (!r.visible) fails.push(`${r.id} 不可见（不应被隐藏）`)
  }

  // 幂等：重复注入不叠加 style 元素，right 稳定
  await win.webContents.executeJavaScript(shiftJs, true)
  await sleep(200)
  const styleCount = await win.webContents.executeJavaScript(
    `document.querySelectorAll('style[id="__dsh_desktop_panel_buttons_shift"]').length`, true,
  )
  if (styleCount !== 1) fails.push(`style 元素数=${styleCount} 应为 1（幂等守卫失效）`)

  console.log(fails.length === 0 ? `PASS ${probe.length * 2 + 1}/${probe.length * 2 + 1}（平移/可见/幂等）` : `FAIL:\n${fails.join('\n')}`)
  app.exit(fails.length === 0 ? 0 : 1)
})
