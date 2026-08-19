/**
 * 品牌版本徽章 DOM 冒烟：手搓上游 sidebar logoRow 结构（忠实还原
 * .logoRow/.brand 的 overflow:hidden + flex:1 关键样式）→ 注入
 * brand-injector 的 INJECT_JS → 断言 wrapper/logo 图/版本徽章存在、
 * 徽章文本随 package.json 版本、不被 overflow:hidden 裁剪、紧贴
 * logo 右上角、pointer-events 不拦新会话点击 + 双主题截图。
 *
 * 运行：pnpm exec electron scripts/smoke-brand-badge.mjs
 */
import { app, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const BT = String.fromCharCode(96)

// 从源码提取 INJECT_JS 模板串原文，再替换插值表达式（与主进程产物同源）
const src = readFileSync(join(ROOT, 'desktop/main/brand-injector.ts'), 'utf8')
const decl = 'const INJECT_JS = ' + BT
const from = src.indexOf(decl) + decl.length
const endTick = src.indexOf('\n})()`', from)
if (from < decl.length || endTick < 0) throw new Error('无法提取 INJECT_JS')
const raw = src.slice(from, endTick + 5)

const asset = (name) =>
  `data:image/png;base64,${readFileSync(join(ROOT, 'assets', name)).toString('base64')}`
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

const injectJs = raw
  .replaceAll('${JSON.stringify(logoDataUrl)}', JSON.stringify(asset('brand-k.png')))
  .replaceAll('${JSON.stringify(logoComboDarkDataUrl)}', JSON.stringify(asset('brand-combo-dark.png')))
  .replaceAll('${JSON.stringify(logoComboLightDataUrl)}', JSON.stringify(asset('brand-combo-light.png')))
  .replaceAll('${JSON.stringify(UPSTREAM_NAME)}', JSON.stringify('DeepSeek Harness'))
  .replaceAll('${JSON.stringify(BRAND_NAME)}', JSON.stringify('KCoder'))
  .replaceAll('${JSON.stringify(LOGO_ID)}', JSON.stringify('__dsh_desktop_brand_logo'))
  .replaceAll('${JSON.stringify(TAGLINE_ZH)}', JSON.stringify('所思，皆可成码'))
  .replaceAll('${JSON.stringify(TAGLINE_EN)}', JSON.stringify('Think it, code it.'))
  .replaceAll('${JSON.stringify(APP_VERSION)}', JSON.stringify(version))

// 上游深色主题真实值（design-platform.css :root[data-theme=dark] 块子集）
const DARK_VARS = `:root {
  --dsw-alias-bg-layer-2: rgb(44, 44, 46);
  --dsw-alias-label-secondary: rgb(151, 157, 166);
  --dsw-alias-label-tertiary: rgb(97, 102, 107);
  --dsw-alias-border-l2: rgb(44, 44, 46);
}`

// 手搓上游 sidebar：.logoRow（overflow:hidden, 60px, pad 8/0/8/4）+
// .brand（flex:1, overflow:hidden, inline-flex）+ toggle（28px）。
// wordmark 占位 svg 尺寸对齐上游 BrandWordmark（高 22）。
const html = (vars, dark) => `<!doctype html><html><head><meta charset="utf-8"><style>
  ${vars}
  body { margin: 0; font-family: -apple-system, system-ui, sans-serif; background: ${dark ? '#17181a' : '#fff'}; display: flex; justify-content: center; padding-top: 40px; height: 100vh; box-sizing: border-box; }
  .side { width: 256px; height: 600px; border-right: 1px solid rgba(128,128,128,.15); }
  /* ---- 以下对齐上游 SidebarRoot.module.css 关键规则 ---- */
  .logoRow { flex: none; display: flex; align-items: center; justify-content: flex-end; gap: 8px; height: 60px; padding: 8px 0 8px 4px; margin-bottom: 8px; box-sizing: border-box; overflow: hidden; }
  .brand { flex: 1; min-width: 0; display: inline-flex; align-items: center; overflow: hidden; padding: 0; border: none; background: transparent; color: inherit; cursor: pointer; }
  .iconButton { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: none; border-radius: 50%; padding: 0; background: transparent; cursor: pointer; }
</style></head><body${dark ? ' data-ds-dark-theme=""' : ''}>
<div class="side">
  <div class="logoRow">
    <button type="button" class="brand" aria-label="新会话">
      <svg width="140" height="22" viewBox="0 0 140 22"><rect width="140" height="22" fill="currentColor" opacity=".15"/><text x="4" y="15" font-size="11" fill="currentColor">deepseek wordmark</text></svg>
    </button>
    <button type="button" class="iconButton toggle">
      <svg width="16" height="16"><rect x="1" y="1" width="14" height="14" rx="2" fill="none" stroke="currentColor"/></svg>
    </button>
  </div>
</div>
</body></html>`

async function runScenario(win, label, vars, dark) {
  const dir = mkdtempSync(join(tmpdir(), 'brand-smoke-'))
  writeFileSync(join(dir, 'index.html'), html(vars, dark))
  await win.loadFile(join(dir, 'index.html'))
  await win.webContents.executeJavaScript(injectJs, true)
  await new Promise((r) => setTimeout(r, 600))

  const probe = JSON.parse(await win.webContents.executeJavaScript(`(() => {
    const ID = '__dsh_desktop_brand_logo'
    const btn = document.querySelector('button.brand')
    const row = document.querySelector('.logoRow')
    const wrap = document.getElementById(ID + '_wrap')
    const img = document.getElementById(ID)
    const ver = document.getElementById(ID + '_ver')
    const svg = btn?.querySelector('svg')
    const r = (el) => el === null ? null : el.getBoundingClientRect().toJSON()
    // 点击穿透：徽章 pointer-events:none → 命中点应落在 brand 按钮上
    let hitTag = null
    if (ver !== null) {
      const vr = ver.getBoundingClientRect()
      const hit = document.elementFromPoint(vr.left + vr.width / 2, vr.top + vr.height / 2)
      hitTag = hit === null ? 'none' : (hit.closest('button.brand') !== null ? 'brand' : hit.tagName)
    }
    const out = {
      wrapInBtn: wrap !== null && btn.contains(wrap),
      imgInWrap: img !== null && wrap !== null && wrap.contains(img),
      verInWrap: ver !== null && wrap !== null && wrap.contains(ver),
      svgHidden: svg !== null && getComputedStyle(svg).display === 'none',
      verText: ver?.textContent ?? null,
      imgH: img?.getBoundingClientRect().height ?? 0,
      hitTag,
      rects: { row: r(row), btn: r(btn), img: r(img), ver: r(ver) },
    }
    return JSON.stringify(out)
  })()`, true))

  const fails = []
  if (!probe.wrapInBtn) fails.push('wrapper 不在 brand 按钮内')
  if (!probe.imgInWrap || !probe.verInWrap) fails.push('logo 图/徽章不在 wrapper 内')
  if (!probe.svgHidden) fails.push('上游 wordmark 未隐藏')
  if (probe.verText !== `桌面版 v${version}`) fails.push(`徽章文本=${probe.verText} 应为 桌面版 v${version}`)
  if (Math.round(probe.imgH) !== 22) fails.push(`logo 高=${probe.imgH} 应为 22`)
  if (probe.hitTag !== 'brand') fails.push(`点击穿透命中=${probe.hitTag}（pointer-events 拦截了新会话点击）`)

  // 裁剪：徽章须完全在 logoRow 与 brand 的边框盒内（overflow:hidden 裁剪边界）
  const inside = (outer, inner) =>
    inner !== null && outer !== null
      && inner.left >= outer.left - 0.5 && inner.top >= outer.top - 0.5
      && inner.right <= outer.right + 0.5 && inner.bottom <= outer.bottom + 0.5
  if (!inside(probe.rects.row, probe.rects.ver)) fails.push(`徽章被 logoRow overflow:hidden 裁剪 rects=${JSON.stringify(probe.rects)}`)
  if (!inside(probe.rects.btn, probe.rects.ver)) fails.push(`徽章被 brand overflow:hidden 裁剪 rects=${JSON.stringify(probe.rects)}`)

  // 角标位置：上标形态悬浮在 "Coder" 字标右上角——徽章顶高于 logo 上沿
  // 8~16px（顶部徽章区），底部最多轻压字标 6px，右缘与字标末尾对齐（±2px）
  const dTop = probe.rects.img.top - probe.rects.ver.top
  const overlap = probe.rects.ver.bottom - probe.rects.img.top
  const dRight = probe.rects.ver.right - probe.rects.img.right
  if (dTop < 8 || dTop > 16) fails.push(`徽章顶高于 logo=${dTop.toFixed(1)} 应在 8~16px`)
  if (overlap < -0.5 || overlap > 6) fails.push(`压入字标=${overlap.toFixed(1)} 应 ≤6px`)
  if (dRight < -0.5 || dRight > 2) fails.push(`右缘偏差=${dRight.toFixed(1)} 应对齐（±2px）`)
  // wrapper 加高后 brand 边框盒随内容撑到 ~34px（徽章不被裁的前置）
  const btnH = probe.rects.btn.height
  if (btnH < 32 || btnH > 36) fails.push(`brand 高=${btnH} 应在 32~36px`)

  console.log(`[${label}]`, fails.length === 0 ? 'PASS' : 'FAIL: ' + fails.join('; '))
  const img = await win.webContents.capturePage()
  writeFileSync(`out/brand-badge-${label === 'dark' ? 'dark' : 'light'}.png`, img.toPNG())
  return fails.length === 0
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 420, height: 760, show: false })
  const light = await runScenario(win, 'light', '', false)
  const dark = await runScenario(win, 'dark', DARK_VARS, true)
  console.log(light && dark ? 'ALL PASS' : 'SMOKE FAILED')
  app.quit()
})
