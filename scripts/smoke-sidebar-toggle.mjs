/**
 * 侧边栏折叠按钮迁移 DOM 冒烟：手搓上游 sidebar logoRow + 自绘
 * 标题栏（对齐 theme-watcher SHELL_TITLEBAR_JS 的 bar/label 关键
 * 样式，label 的 margin-left 消费 --dsh-titlebar-extra-left）→ 注入
 * sidebar-toggle 的 PAGE_JS → 断言：
 * - 上游 toggle（logoRow 内 button.iconButton.toggle）隐藏；
 * - 标题栏红绿灯右侧（left 78px）注入 26x26 折叠按钮，垂直居中、
 *   在 bar 内；
 * - 点击注入按钮 → 上游 toggle 的 click 被触发（React 合成事件
 *   路径照常）；
 * - 图标实时克隆上游 toggle 的 panelIcon svg、aria-label 同步；
 * - --dsh-titlebar-extra-left=34px：侧边栏宽 280 时标题仍在侧边栏
 *   右缘（292px），收起（56px）/探针失效（0）时标题退到按钮右侧
 *   （112px）不重叠；
 * - 自愈：模拟 React 重建 toggle（收起态：brand 移除 + railMark
 *   svg + aria-label 变化）→ 按钮图标/语义自动跟随、新 toggle 隐藏；
 * - 双主题截图。
 *
 * 运行：pnpm exec electron scripts/smoke-sidebar-toggle.mjs
 */
import { app, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const BT = String.fromCharCode(96)

// 从源码提取 PAGE_JS 模板串原文（占位符 ${PLACEHOLDER} → 78px：
// macOS 红绿灯区 rightPad 之后的让位点；Windows 12px 由主进程替换）
const src = readFileSync(join(ROOT, 'desktop/main/sidebar-toggle.ts'), 'utf8')
const decl = 'const PAGE_JS = ' + BT
const from = src.indexOf(decl) + decl.length
const endTick = src.indexOf('\n})()`', from)
if (from < decl.length || endTick < 0) throw new Error('无法提取 PAGE_JS')
const pageJs = src.slice(from, endTick + 5).replaceAll('${PLACEHOLDER}', '78')

// 手搓上游 sidebar（.logoRow/.iconButton 对齐 SidebarRoot.module.css）
// + 自绘标题栏（#bar/.ttl 对齐 theme-watcher SHELL_TITLEBAR_JS：
// bar 48px fixed flex；label margin-left/max-width 用同一公式，内含
// var(--dsh-titlebar-extra-left)）。深色主题给 body 加
// data-ds-dark-theme（fixture 冒烟以深色为主，浅色仅截图对照）
const html = (dark) => `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; font-family: -apple-system, system-ui, sans-serif; background: ${dark ? '#17181a' : '#fff'}; padding-top: 48px; height: 100vh; box-sizing: border-box; }
  #__dsh_desktop_titlebar { position: fixed; top: 0; left: 0; right: 0; height: 48px; z-index: 2147483647; -webkit-app-region: drag; display: flex; align-items: center; justify-content: flex-start; }
  #ttl { flex: 0 1 auto; margin-left: max(calc(78px + var(--dsh-titlebar-extra-left, 0px)), var(--dsh-sidebar-w, 0px) + 12px); max-width: calc(100% - max(calc(78px + var(--dsh-titlebar-extra-left, 0px)), var(--dsh-sidebar-w, 0px) + 12px) - 134px); display: flex; align-items: center; min-width: 0; white-space: nowrap; color: ${dark ? 'rgba(232,234,237,.9)' : 'rgba(26,29,33,.75)'}; }
  /* macOS 红绿灯模拟（系统绘制，capturePage 不可见）：三颗 12px 圆、
     间距 8px；默认按修复后位置——垂直居中于 48px bar（trafficLightPosition
     y:18 → 圆 y18-30），与迁移按钮（top:50%）对齐 */
  .tl { position: absolute; left: 12px; top: 18px; width: 12px; height: 12px; border-radius: 50%; }
  .tl.r { background: #ff5f57; }
  .tl.y { background: #febc2e; left: 32px; }
  .tl.g { background: #28c840; left: 52px; }
  .side { width: 256px; height: 600px; border-right: 1px solid rgba(128,128,128,.15); }
  .logoRow { flex: none; display: flex; align-items: center; justify-content: flex-end; gap: 8px; height: 60px; padding: 8px 0 8px 4px; box-sizing: border-box; overflow: hidden; }
  .brand { flex: 1; min-width: 0; display: inline-flex; align-items: center; overflow: hidden; padding: 0; border: none; background: transparent; color: ${dark ? '#e8eaed' : '#1a1d21'}; cursor: pointer; }
  .iconButton { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: none; border-radius: 50%; padding: 0; background: transparent; color: ${dark ? '#e8eaed' : '#1a1d21'}; cursor: pointer; }
</style></head><body${dark ? ' data-ds-dark-theme=""' : ''}>
<div id="__dsh_desktop_titlebar"><i class="tl r"></i><i class="tl y"></i><i class="tl g"></i><span id="ttl">KCoder / DSH Local Build</span></div>
<div class="side">
  <div class="logoRow">
    <button type="button" class="brand" aria-label="新会话">
      <svg width="140" height="22" viewBox="0 0 140 22"><rect width="140" height="22" fill="currentColor" opacity=".15"/></svg>
    </button>
    <button type="button" class="iconButton toggle" aria-label="折叠侧边栏">
      <svg class="panelIcon" width="16" height="16" viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="14" rx="2" fill="none" stroke="currentColor"/></svg>
    </button>
  </div>
</div>
<script>
  window.__toggleClicks = 0
  document.querySelector('button.toggle').addEventListener('click', () => { window.__toggleClicks++ })
</script>
</body></html>`

async function runScenario(win, label, dark) {
  const dir = mkdtempSync(join(tmpdir(), 'toggle-smoke-'))
  writeFileSync(join(dir, 'index.html'), html(dark))
  await win.loadFile(join(dir, 'index.html'))
  await win.webContents.executeJavaScript(pageJs, true)
  await new Promise((r) => setTimeout(r, 700))

  const probe = JSON.parse(await win.webContents.executeJavaScript(`(() => {
    const ID = '__dsh_desktop_toggle_btn'
    const btn = document.getElementById(ID)
    const bar = document.getElementById('__dsh_desktop_titlebar')
    const toggle = document.querySelector('button[class*="toggle"]')
    const ttl = document.getElementById('ttl')
    const r = (el) => el === null ? null : el.getBoundingClientRect().toJSON()
    const toggleHidden = toggle !== null && getComputedStyle(toggle).display === 'none'
    const iconClone = btn !== null && btn.firstElementChild !== null
      ? btn.firstElementChild.innerHTML : null
    const iconSrc = toggle !== null ? (toggle.querySelectorAll('svg').length > 0
      ? toggle.querySelectorAll('svg')[toggle.querySelectorAll('svg').length - 1].outerHTML : null) : null
    const extra = document.documentElement.style.getPropertyValue('--dsh-titlebar-extra-left')
    const setSidebarW = (px) => {
      document.documentElement.style.setProperty('--dsh-sidebar-w', px)
    }
    setSidebarW('0px')
    const ttl0 = r(ttl)
    setSidebarW('280px')
    const ttl280 = r(ttl)
    setSidebarW('56px')
    const ttl56 = r(ttl)
    setSidebarW('0px')
    // 点击注入按钮 → 上游 toggle click 计数
    btn !== null && btn.click()
    return JSON.stringify({
      btnExists: btn !== null,
      btnInBar: btn !== null && bar !== null && bar.contains(btn),
      btnRect: r(btn),
      barRect: r(bar),
      toggleHidden,
      iconClone, iconSrc,
      ariaSync: btn !== null ? btn.getAttribute('aria-label') : null,
      toggleAria: toggle !== null ? toggle.getAttribute('aria-label') : null,
      extra,
      ttl0: ttl0?.left ?? null, ttl280: ttl280?.left ?? null, ttl56: ttl56?.left ?? null,
      clicks: window.__toggleClicks,
    })
  })()`, true))

  const fails = []
  const btnLeft = probe.btnRect?.left ?? null
  const btnTop = probe.btnRect?.top ?? null
  if (!probe.btnExists) fails.push('标题栏折叠按钮未注入')
  else {
    if (!probe.btnInBar) fails.push('折叠按钮不在标题栏 bar 内')
    if (Math.abs(btnLeft - 78) > 1) fails.push(`折叠按钮 left=${btnLeft} 应 ≈78（红绿灯右侧）`)
    if (Math.abs(probe.btnRect.width - 26) > 1 || Math.abs(probe.btnRect.height - 26) > 1)
      fails.push(`折叠按钮尺寸=${probe.btnRect.width}x${probe.btnRect.height} 应为 26x26`)
    const barTop = probe.barRect.top
    const expectTop = barTop + (48 - 26) / 2
    if (Math.abs(btnTop - expectTop) > 1) fails.push(`折叠按钮 top=${btnTop} 应 ≈${expectTop}（垂直居中）`)
  }
  if (!probe.toggleHidden) fails.push('上游 logoRow toggle 未隐藏')
  if (probe.iconClone !== probe.iconSrc) fails.push('折叠按钮图标未克隆上游 panelIcon svg')
  if (probe.ariaSync !== '折叠侧边栏') fails.push(`aria-label=${probe.ariaSync} 应同步为 折叠侧边栏`)
  if (probe.extra !== '34px') fails.push(`--dsh-titlebar-extra-left=${probe.extra} 应为 34px`)
  if (probe.ttl0 === null || probe.ttl0 < 110) fails.push(`探针失效时标题 left=${probe.ttl0} 应 ≥112（按钮右侧）`)
  if (probe.ttl280 === null || Math.abs(probe.ttl280 - 292) > 1) fails.push(`侧边栏 280 时标题 left=${probe.ttl280} 应 ≈292（仍在侧边栏右缘）`)
  if (probe.ttl56 === null || probe.ttl56 < 110) fails.push(`收起态标题 left=${probe.ttl56} 应 ≥112（不与按钮重叠）`)
  if (probe.clicks !== 1) fails.push(`点击注入按钮后上游 toggle 触发=${probe.clicks} 次（应 1）`)

  // 自愈：模拟 React 重建 toggle（收起态：brand 移除 + railMark svg
  // 插到 panelIcon 前 + aria-label 变化）→ 等待 observer → 复查
  const healed = JSON.parse(await win.webContents.executeJavaScript(`(async () => {
    const ID = '__dsh_desktop_toggle_btn'
    const btn = document.getElementById(ID)
    const row = document.querySelector('.logoRow')
    row.querySelector('button.brand')?.remove()
    const t = row.querySelector('button[class*="toggle"]')
    if (btn === null || t === null) return JSON.stringify({
      hidden: t !== null && getComputedStyle(t).display === 'none',
      aria: btn !== null ? btn.getAttribute('aria-label') : null,
      iconSynced: false, lastIsPanel: false,
    })
    const rail = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    rail.setAttribute('width', '18'); rail.setAttribute('height', '18')
    rail.setAttribute('class', 'railMark')
    rail.innerHTML = '<circle cx="9" cy="9" r="6" fill="currentColor"/>'
    t.prepend(rail)
    t.setAttribute('aria-label', '展开侧边栏')
    await new Promise((res) => setTimeout(res, 700))
    const svgs = t.querySelectorAll('svg')
    const lastSvg = svgs[svgs.length - 1]
    return JSON.stringify({
      hidden: getComputedStyle(t).display === 'none',
      aria: btn.getAttribute('aria-label'),
      iconSynced: btn.firstElementChild.innerHTML === lastSvg.outerHTML,
      lastIsPanel: lastSvg.getAttribute('class') !== 'railMark',
    })
  })()`, true))

  if (!healed.hidden) fails.push('自愈后新 toggle 未隐藏')
  if (healed.aria !== '展开侧边栏') fails.push(`自愈后 aria-label=${healed.aria} 应为 展开侧边栏`)
  if (!healed.iconSynced) fails.push('自愈后按钮图标未跟随新 panelIcon svg')
  if (!healed.lastIsPanel) fails.push('克隆图标取错（应取 panelIcon 非 railMark）')

  console.log(`[${label}]`, fails.length === 0 ? 'PASS' : 'FAIL: ' + fails.join('; '))
  const img = await win.webContents.capturePage()
  writeFileSync(`out/sidebar-toggle-${label === 'dark' ? 'dark' : 'light'}.png`, img.toPNG())
  return fails.length === 0
}

// 注意：不要在 Electron 主进程 ESM 顶层 await app.whenReady() ——
// module evaluation 未完成会阻塞主进程启动序列，与 whenReady 互等死锁。
// 必须用 whenReady().then() 链。另：用户可能正运行 KCoder 应用，把
// userData 指到临时目录，避免与其 profile 争用。
app.setPath('userData', mkdtempSync(join(tmpdir(), 'kcoder-toggle-smoke-')))
console.error('[toggle-smoke] boot')
app.whenReady().then(async () => {
  console.error('[toggle-smoke] app ready')
  const win = new BrowserWindow({ width: 480, height: 720, show: false })
  const results = []
  for (const [label, dark] of [['dark', true], ['light', false]]) {
    results.push(await runScenario(win, label, dark))
  }
  console.log(results.every(Boolean) ? 'ALL PASS' : 'FAILED')
  app.exit(results.every(Boolean) ? 0 : 1)
})
