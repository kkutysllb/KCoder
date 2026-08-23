/**
 * 侧边栏折叠按钮迁移 DOM 冒烟：手搓上游 sidebar logoRow + 自绘
 * 标题栏（对齐 theme-watcher SHELL_TITLEBAR_JS 的 bar/label 关键
 * 样式，label 的 margin-left 消费 --dsh-titlebar-extra-left）→ 注入
 * sidebar-toggle 的 PAGE_JS → 断言：
 * - 上游 toggle（logoRow 内 button.iconButton.toggle）仅展开态隐藏
 *   （收起态恢复显示——railMark 内 brand-injector 注入的 K logo 即
 *   "折叠后 rail 顶部的 logo K"，点击展开，标题栏按钮不重复隐藏它）；
 * - 标题栏注入三个 26x26 按钮（macOS：折叠 84px / 左箭头 128px /
 *   右箭头 174px，紧邻红绿灯区域右侧；垂直居中、在 bar 内）；
 * - Windows 场景：最左注入 K logo（24px，与 rail K 同尺寸；按钮带
 *   右移——折叠 44 / 左箭头 78 / 右箭头 112，extra 134）断言 logo
 *   尺寸/位置/垂直居中 + 新坐标；macOS 断言无 logo（红绿灯区域）；
 * - 点击折叠按钮 → 上游 toggle 的 click 被触发（React 合成事件
 *   路径照常）；
 * - 图标实时克隆上游 toggle 的 panelIcon svg、aria-label 同步；
 * - 箭头按钮 → 会话树（role="tree" 内 role="treeitem" 的 sessionRow，
 *   aria-selected 标记当前会话）相邻行 click：左=上一个、右=下一个；
 *   收起态无会话列表（列表仅展开态挂载）→ 先触发 toggle 展开；
 * - --dsh-titlebar-extra-left=130px（右箭头右缘 174+26=200 + 间距 8
 *   - leftPad 78）：侧边栏宽 280 时标题仍在侧边栏右缘（292px），收起
 *   （56px）/探针失效（0）时标题退到按钮右侧（208px）不重叠；
 * - 自愈：模拟 React 重建 toggle（收起态：brand 移除 + railMark
 *   svg + aria-label 变化）→ 收起态 toggle 恢复显示（rail K logo
 *   可见可点）、按钮图标/语义自动跟随；
 * - 收起态场景：fixture 初始即 rail（railMark 内 K logo img +
 *   panelIcon，模拟 brand-injector 注入结果）→ toggle 显示、K logo
 *   img 可见、点击转发、双主题外加收起态截图；
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

// 从源码提取 PAGE_JS 模板串原文，占位符替换出两套平台值：
// - macOS（红绿灯右侧）：折叠 84 / 左箭头 128 / 右箭头 174，EXTRA
//   130 = 最右按钮右缘 200 + 间距 8 - leftPad 78，logo -1 不注入；
// - Windows（K logo 布局）：logo 12（24px 宽 + 间距 8）+ 按钮带右移
//   折叠 44 / 左箭头 78 / 右箭头 112，EXTRA 134 = 138 + 8 - 12（与
//   主进程 attachSidebarToggle 的 win32 分支一致）。LOGO_IMG 用占位
//   dataURL（断言不校验像素内容，只验注入与几何）。
const src = readFileSync(join(ROOT, 'desktop/main/sidebar-toggle.ts'), 'utf8')
const decl = 'const PAGE_JS = ' + BT
const from = src.indexOf(decl) + decl.length
const endTick = src.indexOf('\n})()`', from)
if (from < decl.length || endTick < 0) throw new Error('无法提取 PAGE_JS')
const LOGO_TINY = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAAFElEQVR4nGP8z8Dwn4EIwESMolEAAGJpAgEqGvm/AAAAAElFTkSuQmCC'
const baseJs = src.slice(from, endTick + 5)
// 折叠按钮静态图标：PAGE_JS 里 TOGGLE_ICON_PLACEHOLDER（源码插值原文）
// 需替换为 TOGGLE_ICON_SVG 常量的求值结果——该常量是多段单引号拼接
// （位于其声明与 PAGE_JS 之间的文本内），正则取出各段 join 即完整
// svg 串，与主进程 replaceAll 链同构；漏掉此替换会让注入脚本直接
// SyntaxError（${...} 非法 token）
const iconBlock = src.slice(src.indexOf('const TOGGLE_ICON_SVG ='), src.indexOf('const PAGE_JS'))
const toggleIconSvg = [...iconBlock.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]).join('')
if (!toggleIconSvg.startsWith('<svg')) throw new Error('无法提取 TOGGLE_ICON_SVG')
const pageJs = baseJs
  .replaceAll('${PLACEHOLDER}', '84')
  .replaceAll('${ARROW_PREV_PLACEHOLDER}', '128')
  .replaceAll('${ARROW_NEXT_PLACEHOLDER}', '174')
  .replaceAll('${EXTRA_PLACEHOLDER}', '130')
  .replaceAll('${TOGGLE_ICON_PLACEHOLDER}', JSON.stringify(toggleIconSvg))
  .replaceAll('${LOGO_LEFT_PLACEHOLDER}', '-1')
  .replaceAll('${LOGO_IMG_PLACEHOLDER}', JSON.stringify(LOGO_TINY))
const pageJsWin = baseJs
  .replaceAll('${PLACEHOLDER}', '44')
  .replaceAll('${ARROW_PREV_PLACEHOLDER}', '78')
  .replaceAll('${ARROW_NEXT_PLACEHOLDER}', '112')
  .replaceAll('${EXTRA_PLACEHOLDER}', '134')
  .replaceAll('${TOGGLE_ICON_PLACEHOLDER}', JSON.stringify(toggleIconSvg))
  .replaceAll('${LOGO_LEFT_PLACEHOLDER}', '12')
  .replaceAll('${LOGO_IMG_PLACEHOLDER}', JSON.stringify(LOGO_TINY))

// 手搓上游 sidebar（.logoRow/.iconButton 对齐 SidebarRoot.module.css）
// + 自绘标题栏（#bar/.ttl 对齐 theme-watcher SHELL_TITLEBAR_JS：
// bar 48px fixed flex；label margin-left/max-width 用同一公式，内含
// var(--dsh-titlebar-extra-left)）。深色主题给 body 加
// data-ds-dark-theme（fixture 冒烟以深色为主，浅色仅截图对照）
const html = (dark, collapsed = false, win32 = false) => `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; font-family: -apple-system, system-ui, sans-serif; background: ${dark ? '#17181a' : '#fff'}; padding-top: 48px; height: 100vh; box-sizing: border-box; }
  #__dsh_desktop_titlebar { position: fixed; top: 0; left: 0; right: 0; height: 48px; z-index: 2147483647; -webkit-app-region: drag; display: flex; align-items: center; justify-content: flex-start; }
  #ttl { flex: 0 1 auto; margin-left: max(calc(${win32 ? 12 : 78}px + var(--dsh-titlebar-extra-left, 0px)), var(--dsh-sidebar-w, 0px) + 12px); max-width: calc(100% - max(calc(${win32 ? 12 : 78}px + var(--dsh-titlebar-extra-left, 0px)), var(--dsh-sidebar-w, 0px) + 12px) - 134px); display: flex; align-items: center; min-width: 0; white-space: nowrap; color: ${dark ? 'rgba(232,234,237,.9)' : 'rgba(26,29,33,.75)'}; }
  /* macOS 红绿灯模拟（系统绘制，capturePage 不可见）：三颗 12px 圆、
     间距 8px；默认按修复后位置——垂直居中于 48px bar（trafficLightPosition
     y:18 → 圆 y18-30），与迁移按钮（top:50%）对齐 */
  .tl { position: absolute; left: 12px; top: 18px; width: 12px; height: 12px; border-radius: 50%; }
  .tl.r { background: #ff5f57; }
  .tl.y { background: #febc2e; left: 32px; }
  .tl.g { background: #28c840; left: 52px; }
  .side { width: 256px; height: 600px; border-right: 1px solid rgba(128,128,128,.15); }
  .logoRow { flex: none; display: flex; align-items: center; justify-content: flex-end; gap: 8px; height: 60px; padding: 8px 0 8px 4px; box-sizing: border-box; overflow: hidden; }
  .logoRow.collapsed { height: 36px; padding: 0; justify-content: flex-start; }
  .logoRow.collapsed .panelIcon { display: none; }
  .brand { flex: 1; min-width: 0; display: inline-flex; align-items: center; overflow: hidden; padding: 0; border: none; background: transparent; color: ${dark ? '#e8eaed' : '#1a1d21'}; cursor: pointer; }
  .iconButton { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: none; border-radius: 50%; padding: 0; background: transparent; color: ${dark ? '#e8eaed' : '#1a1d21'}; cursor: pointer; }
  .railMark { display: inline-flex; }
  .tree { padding: 8px 6px; }
  .sessionRow { padding: 6px 8px; border-radius: 6px; cursor: pointer; font-size: 13px; color: ${dark ? '#e8eaed' : '#1a1d21'}; }
  .sessionRow[aria-selected="true"] { background: rgba(128,128,128,.18); }
</style></head><body${dark ? ' data-ds-dark-theme=""' : ''}>
<div id="__dsh_desktop_titlebar">${win32 ? '' : '<i class="tl r"></i><i class="tl y"></i><i class="tl g"></i>'}<span id="ttl">KCoder / DSH Local Build</span></div>
<div class="side">
  <div class="logoRow${collapsed ? ' collapsed' : ''}">
    ${collapsed
      ? `<button type="button" class="iconButton toggle" aria-label="展开侧边栏">
        <span class="railMark"><img width="24" height="24" alt="K" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAAFElEQVR4nGP8z8Dwn4EIwESMolEAAGJpAgEqGvm/AAAAAElFTkSuQmCC"></span>
        <svg class="panelIcon" width="18" height="18" viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="14" rx="2" fill="none" stroke="currentColor"/></svg>
      </button>`
      : `<button type="button" class="brand" aria-label="新会话">
        <svg width="140" height="22" viewBox="0 0 140 22"><rect width="140" height="22" fill="currentColor" opacity=".15"/></svg>
      </button>
      <button type="button" class="iconButton toggle" aria-label="折叠侧边栏">
        <svg class="panelIcon" width="16" height="16" viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="14" rx="2" fill="none" stroke="currentColor"/></svg>
      </button>`}
  </div>
  ${collapsed ? '' : `<div class="tree" role="tree" aria-label="sessions">
    <div role="treeitem" class="sessionRow" data-id="s1" tabindex="-1">会话 1</div>
    <div role="treeitem" class="sessionRow" data-id="s2" aria-selected="true" tabindex="0">会话 2</div>
    <div role="treeitem" class="sessionRow" data-id="s3" tabindex="-1">会话 3</div>
  </div>`}
</div>
<script>
  window.__toggleClicks = 0
  window.__opened = []
  document.querySelector('button.toggle').addEventListener('click', () => { window.__toggleClicks++ })
  document.querySelectorAll('[role="treeitem"]').forEach((el) => {
    el.addEventListener('click', () => { window.__opened.push(el.dataset.id) })
  })
</script>
</body></html>`

async function runScenario(win, label, dark, collapsed = false, win32 = false) {
  const dir = mkdtempSync(join(tmpdir(), 'toggle-smoke-'))
  writeFileSync(join(dir, 'index.html'), html(dark, collapsed, win32))
  await win.loadFile(join(dir, 'index.html'))
  await win.webContents.executeJavaScript(win32 ? pageJsWin : pageJs, true)
  await new Promise((r) => setTimeout(r, 700))

  const probe = JSON.parse(await win.webContents.executeJavaScript(`(() => {
    const ID = '__dsh_desktop_toggle_btn'
    const PREV = '__dsh_desktop_prev_btn'
    const NEXT = '__dsh_desktop_next_btn'
    const btn = document.getElementById(ID)
    const prevBtn = document.getElementById(PREV)
    const nextBtn = document.getElementById(NEXT)
    const logo = document.getElementById('__dsh_desktop_title_logo')
    const bar = document.getElementById('__dsh_desktop_titlebar')
    const toggle = document.querySelector('button[class*="toggle"]')
    const ttl = document.getElementById('ttl')
    const r = (el) => el === null ? null : el.getBoundingClientRect().toJSON()
    const toggleHidden = toggle !== null && getComputedStyle(toggle).display === 'none'
    const railImg = toggle !== null ? toggle.querySelector('[class*="railMark"] img') : null
    const railImgVisible = railImg !== null ? (() => {
      const s = getComputedStyle(railImg)
      const rr = railImg.getBoundingClientRect()
      return s.display !== 'none' && s.visibility !== 'hidden' && rr.width > 0 && rr.height > 0
    })() : false
    const iconClone = btn !== null && btn.firstElementChild !== null
      ? btn.firstElementChild.innerHTML : null
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
    // 点击：折叠按钮 → 上游 toggle click；左箭头 → 上一个会话行；
    // 右箭头 → 下一个会话行（会话 2 为当前，prev→s1、next→s3）
    btn !== null && btn.click()
    prevBtn !== null && prevBtn.click()
    nextBtn !== null && nextBtn.click()
    return JSON.stringify({
      logoExists: logo !== null,
      logoInBar: logo !== null && bar !== null && bar.contains(logo),
      logoRect: r(logo),
      btnExists: btn !== null,
      btnInBar: btn !== null && bar !== null && bar.contains(btn),
      btnRect: r(btn),
      prevExists: prevBtn !== null,
      prevInBar: prevBtn !== null && bar !== null && bar.contains(prevBtn),
      prevRect: r(prevBtn),
      prevAria: prevBtn !== null ? prevBtn.getAttribute('aria-label') : null,
      nextExists: nextBtn !== null,
      nextInBar: nextBtn !== null && bar !== null && bar.contains(nextBtn),
      nextRect: r(nextBtn),
      nextAria: nextBtn !== null ? nextBtn.getAttribute('aria-label') : null,
      barRect: r(bar),
      toggleHidden,
      railImgVisible,
      iconClone,
      ariaSync: btn !== null ? btn.getAttribute('aria-label') : null,
      toggleAria: toggle !== null ? toggle.getAttribute('aria-label') : null,
      extra,
      ttl0: ttl0?.left ?? null, ttl280: ttl280?.left ?? null, ttl56: ttl56?.left ?? null,
      clicks: window.__toggleClicks,
      opened: window.__opened,
    })
  })()`, true))

  const fails = []
  const barTop = probe.barRect.top
  const expectTop = barTop + (48 - 26) / 2
  // 平台布局期望（与 attachSidebarToggle 平台分支一致）：macOS 红绿灯
  // 右侧 84/128/174、extra 130、无 logo；Windows K logo 12 + 按钮带
  // 右移 44/78/112、extra 134；label 让位 = leftPad(12/78) + extra
  const L = win32
    ? { toggle: 44, prev: 78, next: 112, extra: '134px', ttl0: 146, ttl280: 292, ttl56: 146 }
    : { toggle: 84, prev: 128, next: 174, extra: '130px', ttl0: 208, ttl280: 292, ttl56: 208 }
  if (win32) {
    if (!probe.logoExists) fails.push('Windows 标题栏 K logo 未注入')
    else {
      if (!probe.logoInBar) fails.push('K logo 不在标题栏 bar 内')
      if (Math.abs(probe.logoRect.left - 12) > 1) fails.push(`K logo left=${probe.logoRect.left} 应 ≈12（折叠按钮左侧）`)
      if (Math.abs(probe.logoRect.width - 24) > 1 || Math.abs(probe.logoRect.height - 24) > 1)
        fails.push(`K logo 尺寸=${probe.logoRect.width}x${probe.logoRect.height} 应为 24x24（与 rail K 同尺寸）`)
      const logoTop = barTop + (48 - 24) / 2
      if (Math.abs(probe.logoRect.top - logoTop) > 1) fails.push(`K logo top=${probe.logoRect.top} 应 ≈${logoTop}（垂直居中）`)
    }
  } else if (probe.logoExists) {
    fails.push('macOS 不应注入 K logo（红绿灯区域不可侵占）')
  }
  if (!probe.btnExists) fails.push('标题栏折叠按钮未注入')
  else {
    if (!probe.btnInBar) fails.push('折叠按钮不在标题栏 bar 内')
    if (Math.abs(probe.btnRect.left - L.toggle) > 1) fails.push(`折叠按钮 left=${probe.btnRect.left} 应 ≈${L.toggle}${win32 ? '（logo 右侧）' : '（红绿灯区域右侧）'}`)
    if (Math.abs(probe.btnRect.width - 26) > 1 || Math.abs(probe.btnRect.height - 26) > 1)
      fails.push(`折叠按钮尺寸=${probe.btnRect.width}x${probe.btnRect.height} 应为 26x26`)
    if (Math.abs(probe.btnRect.top - expectTop) > 1) fails.push(`折叠按钮 top=${probe.btnRect.top} 应 ≈${expectTop}（垂直居中）`)
  }
  if (!probe.prevExists) fails.push('左箭头按钮未注入')
  else {
    if (!probe.prevInBar) fails.push('左箭头按钮不在标题栏 bar 内')
    if (Math.abs(probe.prevRect.left - L.prev) > 1) fails.push(`左箭头 left=${probe.prevRect.left} 应 ≈${L.prev}`)
    if (Math.abs(probe.prevRect.width - 26) > 1 || Math.abs(probe.prevRect.height - 26) > 1)
      fails.push(`左箭头尺寸=${probe.prevRect.width}x${probe.prevRect.height} 应为 26x26`)
    if (Math.abs(probe.prevRect.top - expectTop) > 1) fails.push(`左箭头 top=${probe.prevRect.top} 应 ≈${expectTop}（垂直居中）`)
    if (probe.prevAria !== '上一个会话') fails.push(`左箭头 aria-label=${probe.prevAria} 应为 上一个会话`)
  }
  if (!probe.nextExists) fails.push('右箭头按钮未注入')
  else {
    if (!probe.nextInBar) fails.push('右箭头按钮不在标题栏 bar 内')
    if (Math.abs(probe.nextRect.left - L.next) > 1) fails.push(`右箭头 left=${probe.nextRect.left} 应 ≈${L.next}`)
    if (Math.abs(probe.nextRect.width - 26) > 1 || Math.abs(probe.nextRect.height - 26) > 1)
      fails.push(`右箭头尺寸=${probe.nextRect.width}x${probe.nextRect.height} 应为 26x26`)
    if (Math.abs(probe.nextRect.top - expectTop) > 1) fails.push(`右箭头 top=${probe.nextRect.top} 应 ≈${expectTop}（垂直居中）`)
    if (probe.nextAria !== '下一个会话') fails.push(`右箭头 aria-label=${probe.nextAria} 应为 下一个会话`)
  }
  if (collapsed) {
    if (probe.toggleHidden) fails.push('收起态上游 toggle 被错误隐藏（rail K logo 应显示可点）')
    if (!probe.railImgVisible) fails.push('收起态 railMark 内 K logo img 不可见（红框处缺 logo K）')
    // 收起态无会话列表：三个按钮点击都应触发 toggle 展开（各 +1）
    if (probe.clicks !== 3) fails.push(`收起态三按钮点击后 toggle 触发=${probe.clicks} 次（应 3，箭头先展开）`)
    if (probe.opened.length !== 0) fails.push(`收起态不应打开会话，实际 opened=${probe.opened}`)
  } else {
    if (!probe.toggleHidden) fails.push('展开态上游 logoRow toggle 未隐藏')
    if (probe.clicks !== 1) fails.push(`点击折叠按钮后上游 toggle 触发=${probe.clicks} 次（应 1）`)
    if (JSON.stringify(probe.opened) !== JSON.stringify(['s1', 's3']))
      fails.push(`箭头点击应依次打开 s1（上一个）、s3（下一个），实际=${probe.opened}`)
  }
  // 折叠按钮图标为静态 panel-left（不克隆上游——上游 panelIcon 随状态
  // 漂移尺寸，克隆会把漂移带进按钮）；断言写入的 panel-left 矢量特征
  // （evenodd fillRule + 首 path 起点 M9.67272），与上游 panelIcon 无关
  if (probe.iconClone === null || !probe.iconClone.includes('evenodd') || !probe.iconClone.includes('M9.67272'))
    fails.push('折叠按钮图标应为静态 panel-left 矢量（16px 恒定）')
  const wantAria = collapsed ? '展开侧边栏' : '折叠侧边栏'
  if (probe.ariaSync !== wantAria) fails.push(`aria-label=${probe.ariaSync} 应同步为 ${wantAria}`)
  if (probe.extra !== L.extra) fails.push(`--dsh-titlebar-extra-left=${probe.extra} 应为 ${L.extra}`)
  if (probe.ttl0 === null || Math.abs(probe.ttl0 - L.ttl0) > 1) fails.push(`探针失效时标题 left=${probe.ttl0} 应 ≈${L.ttl0}（按钮右侧）`)
  if (probe.ttl280 === null || Math.abs(probe.ttl280 - L.ttl280) > 1) fails.push(`侧边栏 280 时标题 left=${probe.ttl280} 应 ≈${L.ttl280}（仍在侧边栏右缘）`)
  if (probe.ttl56 === null || Math.abs(probe.ttl56 - L.ttl56) > 1) fails.push(`收起态标题 left=${probe.ttl56} 应 ≈${L.ttl56}（不与按钮重叠）`)

  // 自愈：模拟 React 重建 toggle（收起态：brand 移除 + railMark svg
  // 插到 panelIcon 前 + aria-label 变化）→ 等待 observer → 复查：
  // 收起态 toggle 应恢复显示（rail K logo 可见）、按钮图标/语义跟随。
  // 仅展开态场景跑（收起态场景已是收起布局，无"展开→收起"转换）
  if (!collapsed) {
  const healed = JSON.parse(await win.webContents.executeJavaScript(`(async () => {
    const ID = '__dsh_desktop_toggle_btn'
    const btn = document.getElementById(ID)
    const row = document.querySelector('.logoRow')
    row.querySelector('button.brand')?.remove()
    const t = row.querySelector('button[class*="toggle"]')
    if (btn === null || t === null) return JSON.stringify({
      shown: false, hasRail: false,
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
      shown: getComputedStyle(t).display !== 'none',
      hasRail: t.querySelector('[class*="railMark"]') !== null,
      aria: btn.getAttribute('aria-label'),
      iconStatic: btn.firstElementChild !== null && btn.firstElementChild.innerHTML.includes('evenodd'),
      lastIsPanel: lastSvg.getAttribute('class') !== 'railMark',
    })
  })()`, true))

  if (!healed.shown) fails.push('收起态新 toggle 未恢复显示（rail K logo 应可见可点）')
  if (!healed.hasRail) fails.push('收起态 toggle 缺少 railMark（isCollapsed 判定失效）')
  if (healed.aria !== '展开侧边栏') fails.push(`自愈后 aria-label=${healed.aria} 应为 展开侧边栏`)
  if (!healed.iconStatic) fails.push('自愈后按钮图标应保持静态 panel-left（不随上游重建漂移）')
  if (!healed.lastIsPanel) fails.push('fixture 语义错误：toggle 最后一个 svg 应为 panelIcon 非 railMark')

  // 再模拟展开态重建（railMark 移除 → brand 恢复）→ toggle 重新隐藏
  const reexpanded = JSON.parse(await win.webContents.executeJavaScript(`(async () => {
    const t = document.querySelector('button[class*="toggle"]')
    if (t === null) return JSON.stringify({ hidden: false, hasRail: true })
    t.querySelector('[class*="railMark"]')?.remove()
    await new Promise((res) => setTimeout(res, 300))
    return JSON.stringify({
      hidden: getComputedStyle(t).display === 'none',
      hasRail: t.querySelector('[class*="railMark"]') !== null,
    })
  })()`, true))

  if (!reexpanded.hidden) fails.push('再展开态 toggle 未重新隐藏（仅收起态显示 K logo）')
  if (reexpanded.hasRail) fails.push('再展开态 toggle 仍有 railMark（isCollapsed 判定失效）')
  }

  console.log(`[${label}${collapsed ? '-collapsed' : ''}]`, fails.length === 0 ? 'PASS' : 'FAIL: ' + fails.join('; '))
  const img = await win.webContents.capturePage()
  writeFileSync(`out/sidebar-toggle-${collapsed ? 'collapsed' : label}.png`, img.toPNG())
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
  // 收起态场景：fixture 初始即 rail（railMark 内 K logo img + panelIcon），
  // 断言 toggle 显示、K logo 可见、点击可展开 + 截图
  results.push(await runScenario(win, 'dark', true, true))
  // Windows 场景：K logo + 按钮带右移布局（展开态深色一档；收起态行为
  // 平台无关，已由上面 macOS 收起场景覆盖）
  results.push(await runScenario(win, 'win-dark', true, false, true))
  console.log(results.every(Boolean) ? 'ALL PASS' : 'FAILED')
  app.exit(results.every(Boolean) ? 0 : 1)
})
