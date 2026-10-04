/**
 * 侧边栏折叠按钮迁移 + 折叠无痕 DOM 冒烟：手搓上游 AppFrame frame（真实
 * grid 三轨 + data-sidebar-collapsed，轨值对齐上游 columns.ts 常量
 * SIDEBAR_COLLAPSED=56 / CENTER_MIN=400）+ sidebar logoRow + 自绘标题栏
 * （对齐 theme-watcher SHELL_TITLEBAR_JS 的 bar/label 关键样式，label 的
 * margin-left 消费 --dsh-titlebar-extra-left）→ 注入 sidebar-toggle 的
 * PAGE_JS → 断言：
 *
 * - 折叠无痕：fixture 折叠态 inline 轨 1 为 56px（上游 plain-web 行为），
 *   注入后计算值第 1 轨必须归 0px（轨 2/3 原样保留），sidebarCol 右描边
 *   计算值 0px；展开态 void 规则必须为空（textContent 空 + 描边 1px）；
 *   折叠态改写 inline 轨 2（模拟窗口缩放）→ 规则跟刷（轨 2 复制不陈旧）；
 * - 左簇两态自适应：展开 prev84/next128/toggle174 三枚可见 + new 隐藏；
 *   折叠 toggle84/new120 两枚可见 + prev/next 隐藏；display:none 不进
 *   Tab 序，DOM 序恒 prev→next→toggle→new（Tab 序基础）；
 * - 上游 toggle 两态都隐藏（rail 随无痕退役，旧「折叠态恢复显示」分支已删）；
 * - 新会话代理：静态内联 IconNewChat 矢量（气泡路径起点 M2.37091，不克隆
 *   上游）、aria-label 同步「新会话」、点击转发上游 newSession（计数 +1，
 *   与 toggle 计数隔离——折叠态点 new 不得串到 toggle）；展开态代理隐藏；
 * - 点击折叠按钮 → 上游 toggle click（React 合成事件路径照常）；折叠态
 *   点箭头（无会话列表）→ 先触发 toggle 展开；
 * - --dsh-titlebar-extra-left 随态更新：展开 mac130/win196、折叠
 *   mac76/win142 = 当前态最右按钮右缘 + 8 - leftPad；侧边栏宽 280 时标题
 *   仍在侧边栏右缘（292px），收起（56px）/探针失效（0）时标题退到按钮
 *   右侧不重叠；
 * - Windows 场景：左角装饰红绿灯（三颗 12px 圆点、间距 8，占 12~64px）
 *   + 按钮同 macOS 坐标；macOS 无装饰红绿灯；
 * - 自愈（展开态场景跑）：① React 重建 toggle（brand 移除 + aria 变化）
 *   → 保持隐藏 + 语义跟随；② 模拟折叠切换（frame 写 inline 56px +
 *   data-sidebar-collapsed + aria 换向）→ void 规则生效 + 左簇重组 +
 *   extra 切到折叠值；③ 模拟展开（attr 移除 + inline 280px）→ 规则清空
 *   + 左簇还原 + 描边恢复；
 * - 双主题双平台双态截图。
 *
 * 运行：pnpm exec electron scripts/smoke-sidebar-toggle.mjs
 */
import { app, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const BT = String.fromCharCode(96)

/**
 * 源码契约失败：打印原因并**立即退出**。
 *
 * 不能用顶层 throw：Electron 主进程未捕获异常后不会自己退，测试就这么挂到
 * 外层超时（2026-09-20 实测：排布断言抛错后进程永不退出，240s 超时才被杀）。
 * 退出码非零 = 失败，与其余冒烟的 ALL PASS/FAILED 口径一致。
 * @param {string} msg
 * @returns {never}
 */
const die = (msg) => {
  console.error(`[toggle-smoke] 源码契约失败：${msg}`)
  process.exit(1)
}

// 从源码提取 PAGE_JS 模板串原文，占位符替换出两套平台值（按钮坐标双
// 平台一致，仅装饰红绿灯开关与 EXTRA/COLLAPSED_EXTRA 不同，与主进程
// attachSidebarToggle 平台分支一致）：
// - macOS：leftPad 78（原生红绿灯在场，装饰红绿灯 false）；
// - Windows：leftPad 12（装饰红绿灯 true）。
const src = readFileSync(join(ROOT, 'desktop/main/sidebar-toggle.ts'), 'utf8')
const decl = 'const PAGE_JS = ' + BT
const from = src.indexOf(decl) + decl.length
const endTick = src.indexOf('\n})()`', from)
if (from < decl.length || endTick < 0) die('无法提取 PAGE_JS')
const baseJs = src.slice(from, endTick + 5)
// 排布值**从源码提取**，不在这里硬编码：attachSidebarToggle 的坐标常量是
// 唯一事实源。2026-09-20 实测过硬编码版的假通过——源码改了、冒烟自说自话。
// 提取后钉住的是：常量取值（渲染坐标比对）、占位符→常量的装配绑定
//（checkWiring 文本检查，NC-2 教训）、PAGE_JS 内 CSS 绑定与渲染坐标（DOM 断言）。
const layout = src.slice(src.indexOf('export function attachSidebarToggle'))
/** @param {string} name */
const layoutNum = (name) => {
  const m = new RegExp('const ' + name + ' = (\\d+)').exec(layout)
  if (m === null) die(`无法从源码提取按钮坐标常量 ${name}`)
  return Number(m[1])
}
/** 占位符必须绑定到对应常量（容忍空格换行，不容忍接错人）。 */
/** @param {string} ph @param {string} name */
const checkWiring = (ph, name) => {
  const re = new RegExp('\\.replaceAll\\(\\s*' + ph + '\\s*,\\s*String\\(\\s*' + name + '\\s*\\)\\s*\\)')
  if (!re.test(layout)) die(`attachSidebarToggle 的 ${ph} 未绑定到 String(${name})`)
}
/** 图标类占位符走 JSON.stringify 装配，单独验。 */
/** @param {string} ph @param {string} name */
const checkWiringJson = (ph, name) => {
  const re = new RegExp('\\.replaceAll\\(\\s*' + ph + '\\s*,\\s*JSON\\.stringify\\(\\s*' + name + '\\s*\\)\\s*\\)')
  if (!re.test(layout)) die(`attachSidebarToggle 的 ${ph} 未绑定到 JSON.stringify(${name})`)
}
checkWiring('PLACEHOLDER', 'toggle')
checkWiring('ARROW_PREV_PLACEHOLDER', 'prev')
checkWiring('ARROW_NEXT_PLACEHOLDER', 'next')
checkWiring('COLLAPSED_TOGGLE_PLACEHOLDER', 'collapseToggle')
checkWiring('NEW_BTN_PLACEHOLDER', 'newBtn')
checkWiring('EXTRA_PLACEHOLDER', 'extra')
checkWiring('COLLAPSED_EXTRA_PLACEHOLDER', 'collapseExtra')
checkWiringJson('TOGGLE_ICON_PLACEHOLDER', 'TOGGLE_ICON_SVG')
checkWiringJson('NEW_ICON_PLACEHOLDER', 'NEW_ICON_SVG')
const TOGGLE_LEFT = layoutNum('toggle')
const PREV_LEFT = layoutNum('prev')
const NEXT_LEFT = layoutNum('next')
const COLLAPSED_TOGGLE_LEFT = layoutNum('collapseToggle')
const NEW_LEFT = layoutNum('newBtn')
// 2026-09-20 用户指定展开态排布：导航箭头靠红绿灯，折叠按钮移到它们右侧；
// 2026-10-04 折叠态排布：折叠 → 新会话（对齐官方 seat 两枚节奏）
if (!(PREV_LEFT < NEXT_LEFT && NEXT_LEFT < TOGGLE_LEFT)) {
  die(`源码排布应 左箭头(${PREV_LEFT}) < 右箭头(${NEXT_LEFT}) < 折叠(${TOGGLE_LEFT})——展开态折叠按钮须在左右箭头右侧`)
}
if (!(COLLAPSED_TOGGLE_LEFT < NEW_LEFT)) {
  die(`源码排布应 折叠(${COLLAPSED_TOGGLE_LEFT}) < 新会话(${NEW_LEFT})——折叠态新会话按钮须在折叠按钮右侧`)
}
const LEFT_PAD_MAC = 78
const LEFT_PAD_WIN = 12
const RIGHT_EDGE = Math.max(PREV_LEFT, NEXT_LEFT, TOGGLE_LEFT) + 26 // 展开态最右按钮右缘
const COLLAPSED_RIGHT_EDGE = Math.max(COLLAPSED_TOGGLE_LEFT, NEW_LEFT) + 26 // 折叠态最右按钮右缘
const extraMac = RIGHT_EDGE + 8 - LEFT_PAD_MAC
const extraWin = RIGHT_EDGE + 8 - LEFT_PAD_WIN
const collapsedExtraMac = COLLAPSED_RIGHT_EDGE + 8 - LEFT_PAD_MAC
const collapsedExtraWin = COLLAPSED_RIGHT_EDGE + 8 - LEFT_PAD_WIN
// 静态图标（TOGGLE_ICON_SVG / NEW_ICON_SVG）：源码里是多段单引号拼接的
// 常量块，正则取出各段 join 即完整 svg 串，与主进程 replaceAll 链同构；
// 按「下一个 const 声明」切块，避免常量相邻时互相吞段。
/** @param {string} name */
const constBlock = (name) => {
  const start = src.indexOf('const ' + name + ' =')
  if (start < 0) die(`无法定位常量 ${name}`)
  let end = src.indexOf('\nconst ', start + 1)
  if (end < 0) end = src.indexOf('\nexport ', start + 1)
  if (end < 0) end = src.length
  return src.slice(start, end)
}
const segmentsOf = (block) => [...block.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]).join('')
const toggleIconSvg = segmentsOf(constBlock('TOGGLE_ICON_SVG'))
const newIconSvg = segmentsOf(constBlock('NEW_ICON_SVG'))
if (!toggleIconSvg.startsWith('<svg')) die('无法提取 TOGGLE_ICON_SVG')
if (!newIconSvg.startsWith('<svg')) die('无法提取 NEW_ICON_SVG')
/** @param {string} extraStr @param {string} collapsedExtraStr @param {string} dots */
const buildPageJs = (extraStr, collapsedExtraStr, dots) => baseJs
  .replaceAll('${PLACEHOLDER}', String(TOGGLE_LEFT))
  .replaceAll('${ARROW_PREV_PLACEHOLDER}', String(PREV_LEFT))
  .replaceAll('${ARROW_NEXT_PLACEHOLDER}', String(NEXT_LEFT))
  .replaceAll('${COLLAPSED_TOGGLE_PLACEHOLDER}', String(COLLAPSED_TOGGLE_LEFT))
  .replaceAll('${NEW_BTN_PLACEHOLDER}', String(NEW_LEFT))
  .replaceAll('${EXTRA_PLACEHOLDER}', extraStr)
  .replaceAll('${COLLAPSED_EXTRA_PLACEHOLDER}', collapsedExtraStr)
  .replaceAll('${TOGGLE_ICON_PLACEHOLDER}', JSON.stringify(toggleIconSvg))
  .replaceAll('${NEW_ICON_PLACEHOLDER}', JSON.stringify(newIconSvg))
  .replaceAll('${DOTS_PLACEHOLDER}', dots)

const pageJs = buildPageJs(String(extraMac), String(collapsedExtraMac), 'false')
const pageJsWin = buildPageJs(String(extraWin), String(collapsedExtraWin), 'true')
// 守卫：任何占位符漏替换都会让注入脚本直接 SyntaxError（${...} 非法 token），
// 与主进程 replaceAll 链不同构处在此显式断掉
if (pageJs.includes('${') || pageJsWin.includes('${')) die('PAGE_JS 存在未替换占位符')

// 手搓上游 AppFrame frame（真实 grid：inline 三轨 + data-sidebar-collapsed，
// 轨值对齐 columns.ts 的 SIDEBAR_COLLAPSED=56 / CENTER_MIN=400）+ sidebar
// （.logoRow/.iconButton/.newSession 对齐 SidebarRoot.module.css）+ 自绘
// 标题栏（#bar/.ttl 对齐 theme-watcher SHELL_TITLEBAR_JS：bar 48px fixed
// flex；label margin-left/max-width 用同一公式，内含
// var(--dsh-titlebar-extra-left)）。深色主题给 body 加 data-ds-dark-theme。
const html = (dark, collapsed = false, win32 = false) => `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; font-family: -apple-system, system-ui, sans-serif; background: ${dark ? '#17181a' : '#fff'}; padding-top: 48px; height: 100vh; box-sizing: border-box; }
  #__dsh_desktop_titlebar { position: fixed; top: 0; left: 0; right: 0; height: 48px; z-index: 2147483647; -webkit-app-region: drag; display: flex; align-items: center; justify-content: flex-start; }
  #ttl { flex: 0 1 auto; margin-left: max(calc(${win32 ? 12 : 78}px + var(--dsh-titlebar-extra-left, 0px)), var(--dsh-sidebar-w, 0px) + 12px); max-width: calc(100% - max(calc(${win32 ? 12 : 78}px + var(--dsh-titlebar-extra-left, 0px)), var(--dsh-sidebar-w, 0px) + 12px) - 134px); display: flex; align-items: center; min-width: 0; white-space: nowrap; color: ${dark ? 'rgba(232,234,237,.9)' : 'rgba(26,29,33,.75)'}; }
  /* macOS 红绿灯模拟（系统绘制，capturePage 不可见）：三颗 12px 圆、
     间距 8px；垂直居中于 48px bar，与迁移按钮（top:50%）对齐 */
  .tl { position: absolute; left: 12px; top: 18px; width: 12px; height: 12px; border-radius: 50%; }
  .tl.r { background: #ff5f57; }
  .tl.y { background: #febc2e; left: 32px; }
  .tl.g { background: #28c840; left: 52px; }
  .frame { position: relative; height: 600px; overflow: hidden; }
  .side { min-width: 0; overflow: hidden; background: ${dark ? 'rgba(255,255,255,.04)' : '#f6f6f6'}; border-right: 1px solid rgba(128,128,128,.5); }
  .centerCol { min-width: 0; overflow: hidden; padding: 8px; color: ${dark ? '#e8eaed' : '#1a1d21'}; }
  .logoRow { flex: none; display: flex; align-items: center; justify-content: flex-end; gap: 8px; height: 60px; padding: 8px 0 8px 4px; box-sizing: border-box; overflow: hidden; }
  .logoRow.collapsed { height: 36px; padding: 0; justify-content: flex-start; }
  .logoRow.collapsed .panelIcon { display: none; }
  .brand { flex: 1; min-width: 0; display: inline-flex; align-items: center; overflow: hidden; padding: 0; border: none; background: transparent; color: ${dark ? '#e8eaed' : '#1a1d21'}; cursor: pointer; }
  .iconButton { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: none; border-radius: 50%; padding: 0; background: transparent; color: ${dark ? '#e8eaed' : '#1a1d21'}; cursor: pointer; }
  .newSession { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; margin: 4px 8px; border: none; border-radius: 7px; padding: 0; background: transparent; color: ${dark ? '#e8eaed' : '#1a1d21'}; cursor: pointer; }
  .railMark { display: inline-flex; }
  .tree { padding: 8px 6px; }
  .sessionRow { padding: 6px 8px; border-radius: 6px; cursor: pointer; font-size: 13px; color: ${dark ? '#e8eaed' : '#1a1d21'}; }
  .sessionRow[aria-selected="true"] { background: rgba(128,128,128,.18); }
</style></head><body${dark ? ' data-ds-dark-theme=""' : ''}>
<div id="__dsh_desktop_titlebar">${win32 ? '' : '<i class="tl r"></i><i class="tl y"></i><i class="tl g"></i>'}<span id="ttl">KCoder / DSH Local Build</span></div>
<div class="frame" style="display:grid;grid-template-rows:100%;grid-template-columns:${collapsed ? '56px' : '280px'} minmax(400px, 1fr) minmax(0px, 0px)"${collapsed ? ' data-sidebar-collapsed="true"' : ''}>
  <div class="side sidebarCol">
    <div class="logoRow${collapsed ? ' collapsed' : ''}">
      ${collapsed
        ? `<button type="button" class="iconButton toggle" aria-label="展开侧边栏">
          <span class="railMark"><svg width="18" height="18" viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="14" rx="2" fill="none" stroke="currentColor"/></svg></span>
          <svg class="panelIcon" width="18" height="18" viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="14" rx="2" fill="none" stroke="currentColor"/></svg>
        </button>`
        : `<button type="button" class="brand" aria-label="新会话">
          <svg width="140" height="22" viewBox="0 0 140 22"><rect width="140" height="22" fill="currentColor" opacity=".15"/></svg>
        </button>
        <button type="button" class="iconButton toggle" aria-label="折叠侧边栏">
          <svg class="panelIcon" width="16" height="16" viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="14" rx="2" fill="none" stroke="currentColor"/></svg>
        </button>`}
    </div>
    <button type="button" class="newSession" aria-label="新会话"><svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor"><path d="M8 3v10M3 8h10"/></svg></button>
    ${collapsed ? '' : `<div class="tree" role="tree" aria-label="sessions">
      <div role="treeitem" class="sessionRow" data-id="s1" tabindex="-1">会话 1</div>
      <div role="treeitem" class="sessionRow" data-id="s2" aria-selected="true" tabindex="0">会话 2</div>
      <div role="treeitem" class="sessionRow" data-id="s3" tabindex="-1">会话 3</div>
    </div>`}
  </div>
  <div class="centerCol">center</div>
</div>
<script>
  window.__toggleClicks = 0
  window.__newClicks = 0
  window.__opened = []
  document.querySelector('button.toggle').addEventListener('click', () => { window.__toggleClicks++ })
  document.querySelector('button.newSession').addEventListener('click', () => { window.__newClicks++ })
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
    const NEW = '__dsh_desktop_new_btn'
    const btn = document.getElementById(ID)
    const prevBtn = document.getElementById(PREV)
    const nextBtn = document.getElementById(NEXT)
    const newBtn = document.getElementById(NEW)
    const dots = document.getElementById('__dsh_desktop_deco_lights')
    const dot0 = dots !== null ? dots.firstElementChild : null
    const bar = document.getElementById('__dsh_desktop_titlebar')
    const frame = document.querySelector('.frame')
    const side = document.querySelector('.sidebarCol')
    const toggle = document.querySelector('button[class*="toggle"]')
    const ttl = document.getElementById('ttl')
    const r = (el) => el === null ? null : el.getBoundingClientRect().toJSON()
    const disp = (el) => el === null ? null : getComputedStyle(el).display
    const toggleHidden = toggle !== null && getComputedStyle(toggle).display === 'none'
    const voidStyle = document.getElementById('__dsh_desktop_sidebar_void_style')
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
    // 右箭头 → 下一个会话行（会话 2 为当前，prev→s1、next→s3）；
    // 新会话代理 → 上游 newSession（独立计数，验证不与 toggle 串线）
    btn !== null && btn.click()
    prevBtn !== null && prevBtn.click()
    nextBtn !== null && nextBtn.click()
    newBtn !== null && newBtn.click()
    return JSON.stringify({
      frameTracks: frame !== null ? getComputedStyle(frame).gridTemplateColumns : null,
      sideBorder: side !== null ? getComputedStyle(side).borderRightWidth : null,
      voidLen: voidStyle !== null ? voidStyle.textContent.length : null,
      dotsExists: dots !== null,
      dotsInBar: dots !== null && bar !== null && bar.contains(dots),
      dotsRect: r(dots),
      dotsCount: dots !== null ? dots.children.length : 0,
      dot0Rect: r(dot0),
      btnExists: btn !== null,
      btnInBar: btn !== null && bar !== null && bar.contains(btn),
      btnRect: r(btn),
      // DOM 序（= Tab 序基础）：四枚恒定
      domOrder: bar === null ? null : [...bar.querySelectorAll('button')].map((b) => b.id),
      prevExists: prevBtn !== null,
      prevInBar: prevBtn !== null && bar !== null && bar.contains(prevBtn),
      prevRect: r(prevBtn),
      prevAria: prevBtn !== null ? prevBtn.getAttribute('aria-label') : null,
      prevDisplay: disp(prevBtn),
      nextExists: nextBtn !== null,
      nextInBar: nextBtn !== null && bar !== null && bar.contains(nextBtn),
      nextRect: r(nextBtn),
      nextAria: nextBtn !== null ? nextBtn.getAttribute('aria-label') : null,
      nextDisplay: disp(nextBtn),
      newExists: newBtn !== null,
      newInBar: newBtn !== null && bar !== null && bar.contains(newBtn),
      newRect: r(newBtn),
      newAria: newBtn !== null ? newBtn.getAttribute('aria-label') : null,
      newDisplay: disp(newBtn),
      newIcon: newBtn !== null && newBtn.firstElementChild !== null
        ? newBtn.firstElementChild.innerHTML : null,
      barRect: r(bar),
      toggleHidden,
      iconClone: btn !== null && btn.firstElementChild !== null
        ? btn.firstElementChild.innerHTML : null,
      ariaSync: btn !== null ? btn.getAttribute('aria-label') : null,
      toggleAria: toggle !== null ? toggle.getAttribute('aria-label') : null,
      extra,
      ttl0: ttl0?.left ?? null, ttl280: ttl280?.left ?? null, ttl56: ttl56?.left ?? null,
      clicks: window.__toggleClicks,
      newClicks: window.__newClicks,
      opened: window.__opened,
    })
  })()`, true))

  const fails = []
  const barTop = probe.barRect.top
  const expectTop = barTop + (48 - 26) / 2
  // 平台布局期望（与 attachSidebarToggle 平台分支一致）；collapsed 期左簇
  // 换成 toggle+new 两枚、extra 换折叠值
  const collapsedExtra = win32 ? collapsedExtraWin : collapsedExtraMac
  const expandedExtra = win32 ? extraWin : extraMac
  const leftPad = win32 ? LEFT_PAD_WIN : LEFT_PAD_MAC
  const L = {
    toggle: collapsed ? COLLAPSED_TOGGLE_LEFT : TOGGLE_LEFT,
    prev: PREV_LEFT, next: NEXT_LEFT, newLeft: NEW_LEFT,
    extra: (collapsed ? collapsedExtra : expandedExtra) + 'px',
    ttl0: leftPad + (collapsed ? collapsedExtra : expandedExtra),
    ttl280: 292,
    ttl56: leftPad + (collapsed ? collapsedExtra : expandedExtra),
  }
  // —— 折叠无痕断言 ——
  const tracks = probe.frameTracks !== null ? probe.frameTracks.split(' ') : []
  if (tracks.length !== 3) fails.push(`frame 计算轨应为 3 段，实际「${probe.frameTracks}」`)
  else if (tracks[0] !== (collapsed ? '0px' : '280px'))
    fails.push(`折叠无痕失效：轨 1 计算值=${tracks[0]} 应为 ${collapsed ? '0px' : '280px'}`)
  if (collapsed) {
    // 轨 2 原样保留：折叠后中列 minmax(400px,1fr) 撑满剩余宽（480 窗口 →
    // 计算值 480px），只要仍为正宽即证明轨 2 未被归零误伤
    if (tracks.length === 3 && !(parseFloat(tracks[1]) > 0)) fails.push(`无痕规则应原样保留轨 2（正宽），实际「${probe.frameTracks}」`)
    if (probe.sideBorder !== '0px') fails.push(`折叠态 sidebarCol 描边=${probe.sideBorder} 应为 0px`)
    if (probe.voidLen === null || probe.voidLen === 0) fails.push('折叠态 void 规则不应为空')
  } else {
    if (probe.sideBorder !== '1px') fails.push(`展开态 sidebarCol 描边=${probe.sideBorder} 应为 1px`)
    if (probe.voidLen !== 0) fails.push(`展开态 void 规则应为空，实际长度=${probe.voidLen}`)
  }
  if (probe.toggleHidden !== true) fails.push('上游 logoRow toggle 应两态隐藏（rail 随无痕退役）')
  // —— Windows 装饰红绿灯 ——
  if (win32) {
    if (!probe.dotsExists) fails.push('Windows 标题栏装饰红绿灯未注入')
    else {
      if (!probe.dotsInBar) fails.push('装饰红绿灯不在标题栏 bar 内')
      if (Math.abs(probe.dotsRect.left - 12) > 1) fails.push(`装饰红绿灯 left=${probe.dotsRect.left} 应 ≈12（与 macOS 红绿灯同位）`)
      if (probe.dotsCount !== 3) fails.push(`装饰红绿灯圆点数=${probe.dotsCount} 应为 3`)
      if (probe.dot0Rect !== null && (Math.abs(probe.dot0Rect.width - 12) > 1 || Math.abs(probe.dot0Rect.height - 12) > 1))
        fails.push(`装饰圆点尺寸=${probe.dot0Rect.width}x${probe.dot0Rect.height} 应为 12x12`)
      const dotsTop = barTop + (48 - 12) / 2
      if (Math.abs(probe.dotsRect.top - dotsTop) > 1) fails.push(`装饰红绿灯 top=${probe.dotsRect.top} 应 ≈${dotsTop}（垂直居中）`)
    }
  } else if (probe.dotsExists) {
    fails.push('macOS 不应注入装饰红绿灯（原生红绿灯在场）')
  }
  // —— 折叠按钮 ——
  if (!probe.btnExists) fails.push('标题栏折叠按钮未注入')
  else {
    if (!probe.btnInBar) fails.push('折叠按钮不在标题栏 bar 内')
    if (Math.abs(probe.btnRect.left - L.toggle) > 1) fails.push(`折叠按钮 left=${probe.btnRect.left} 应 ≈${L.toggle}（${collapsed ? '折叠态首枚' : '两枚箭头右侧'}）`)
    if (Math.abs(probe.btnRect.width - 26) > 1 || Math.abs(probe.btnRect.height - 26) > 1)
      fails.push(`折叠按钮尺寸=${probe.btnRect.width}x${probe.btnRect.height} 应为 26x26`)
    if (Math.abs(probe.btnRect.top - expectTop) > 1) fails.push(`折叠按钮 top=${probe.btnRect.top} 应 ≈${expectTop}（垂直居中）`)
  }
  // —— 左箭头（展开态可见才断言坐标；折叠态 display:none 的 rect 恒 0）——
  if (!probe.prevExists) fails.push('左箭头按钮未注入')
  else {
    if (!probe.prevInBar) fails.push('左箭头按钮不在标题栏 bar 内')
    if (!collapsed) {
      if (Math.abs(probe.prevRect.left - L.prev) > 1) fails.push(`左箭头 left=${probe.prevRect.left} 应 ≈${L.prev}`)
      if (Math.abs(probe.prevRect.top - expectTop) > 1) fails.push(`左箭头 top=${probe.prevRect.top} 应 ≈${expectTop}（垂直居中）`)
      if (probe.prevAria !== '上一个会话') fails.push(`左箭头 aria-label=${probe.prevAria} 应为 上一个会话`)
    } else if (probe.prevDisplay !== 'none') fails.push('折叠态左箭头应隐藏')
  }
  // —— 右箭头 ——
  if (!probe.nextExists) fails.push('右箭头按钮未注入')
  else {
    if (!probe.nextInBar) fails.push('右箭头按钮不在标题栏 bar 内')
    if (!collapsed) {
      if (Math.abs(probe.nextRect.left - L.next) > 1) fails.push(`右箭头 left=${probe.nextRect.left} 应 ≈${L.next}`)
      if (Math.abs(probe.nextRect.top - expectTop) > 1) fails.push(`右箭头 top=${probe.nextRect.top} 应 ≈${expectTop}（垂直居中）`)
      if (probe.nextAria !== '下一个会话') fails.push(`右箭头 aria-label=${probe.nextAria} 应为 下一个会话`)
    } else if (probe.nextDisplay !== 'none') fails.push('折叠态右箭头应隐藏')
  }
  // —— 新会话代理 ——
  if (!probe.newExists) fails.push('新会话代理按钮未注入')
  else {
    if (!probe.newInBar) fails.push('新会话代理不在标题栏 bar 内')
    if (collapsed) {
      if (probe.newDisplay === 'none') fails.push('折叠态新会话代理应可见（rail 随无痕消失，代理是唯一入口）')
      if (Math.abs(probe.newRect.left - L.newLeft) > 1) fails.push(`新会话代理 left=${probe.newRect.left} 应 ≈${L.newLeft}`)
      if (Math.abs(probe.newRect.top - expectTop) > 1) fails.push(`新会话代理 top=${probe.newRect.top} 应 ≈${expectTop}（垂直居中）`)
    } else if (probe.newDisplay !== 'none') {
      fails.push('展开态新会话代理应隐藏（logoRow brand 入口在场）')
    }
    if (probe.newAria !== '新会话') fails.push(`新会话代理 aria-label=${probe.newAria} 应为 新会话`)
    if (probe.newIcon === null || !probe.newIcon.includes('M2.37091'))
      fails.push('新会话代理图标应为静态 new-chat 矢量（不克隆上游）')
  }
  // —— 两态视觉序（可见按钮）与 DOM 序 ——
  if (collapsed) {
    if (!(probe.btnRect.left < probe.newRect.left)) fails.push(`折叠态视觉序应 折叠(${probe.btnRect.left}) < 新会话(${probe.newRect.left})`)
  } else {
    const order = [probe.prevRect.left, probe.nextRect.left, probe.btnRect.left]
    if (!(order[0] < order[1] && order[1] < order[2])) fails.push(`展开态视觉序应 左箭头 < 右箭头 < 折叠，实际 ${order.join(' ')}`)
  }
  const wantDom = ['__dsh_desktop_prev_btn', '__dsh_desktop_next_btn', '__dsh_desktop_toggle_btn', '__dsh_desktop_new_btn']
  if (JSON.stringify(probe.domOrder) !== JSON.stringify(wantDom))
    fails.push(`DOM 序应为 prev→next→toggle→new 恒定，实际 ${(probe.domOrder || []).join('→')}`)
  // —— 点击转发 ——
  if (collapsed) {
    // 三个按钮点击都触发 toggle 展开（btn + 两枚隐藏箭头的兜底展开），new 走独立转发
    if (probe.clicks !== 3) fails.push(`折叠态三按钮点击后 toggle 触发=${probe.clicks} 次（应 3，箭头先展开）`)
    if (probe.newClicks !== 1) fails.push(`折叠态新会话代理转发=${probe.newClicks} 次（应 1）`)
    if (probe.opened.length !== 0) fails.push(`折叠态不应打开会话，实际 opened=${probe.opened}`)
  } else {
    if (probe.clicks !== 1) fails.push(`点击折叠按钮后上游 toggle 触发=${probe.clicks} 次（应 1）`)
    if (probe.newClicks !== 1) fails.push(`新会话代理转发=${probe.newClicks} 次（应 1；隐藏态 click 仍可派发）`)
    if (JSON.stringify(probe.opened) !== JSON.stringify(['s1', 's3']))
      fails.push(`箭头点击应依次打开 s1（上一个）、s3（下一个），实际=${probe.opened}`)
  }
  // —— 折叠按钮图标为静态 panel-left（不克隆上游）——
  if (probe.iconClone === null || !probe.iconClone.includes('evenodd') || !probe.iconClone.includes('M9.67272'))
    fails.push('折叠按钮图标应为静态 panel-left 矢量（16px 恒定）')
  const wantAria = collapsed ? '展开侧边栏' : '折叠侧边栏'
  if (probe.ariaSync !== wantAria) fails.push(`aria-label=${probe.ariaSync} 应同步为 ${wantAria}`)
  if (probe.extra !== L.extra) fails.push(`--dsh-titlebar-extra-left=${probe.extra} 应为 ${L.extra}`)
  if (probe.ttl0 === null || Math.abs(probe.ttl0 - L.ttl0) > 1) fails.push(`探针失效时标题 left=${probe.ttl0} 应 ≈${L.ttl0}（按钮右侧）`)
  if (!collapsed && (probe.ttl280 === null || Math.abs(probe.ttl280 - L.ttl280) > 1)) fails.push(`侧边栏 280 时标题 left=${probe.ttl280} 应 ≈${L.ttl280}（仍在侧边栏右缘）`)
  if (probe.ttl56 === null || Math.abs(probe.ttl56 - L.ttl56) > 1) fails.push(`收起态标题 left=${probe.ttl56} 应 ≈${L.ttl56}（不与按钮重叠）`)

  // 干净态截图（自愈模拟前）
  const img = await win.webContents.capturePage()
  writeFileSync(`out/sidebar-toggle-${label}${collapsed ? '-collapsed' : ''}.png`, img.toPNG())

  // —— 自愈模拟 ——
  if (!collapsed) {
    // A：React 重建 toggle（brand 移除 + aria 变化）→ 保持隐藏 + 语义跟随
    const healed = JSON.parse(await win.webContents.executeJavaScript(`(async () => {
      const row = document.querySelector('.logoRow')
      row.querySelector('button.brand')?.remove()
      const t = row.querySelector('button[class*="toggle"]')
      if (t !== null) {
        t.setAttribute('aria-label', '收起侧边栏')
        t.style.display = ''
      }
      await new Promise((res) => setTimeout(res, 700))
      const btn = document.getElementById('__dsh_desktop_toggle_btn')
      const toggle = document.querySelector('button[class*="toggle"]')
      return JSON.stringify({
        hidden: toggle !== null && getComputedStyle(toggle).display === 'none',
        aria: btn !== null ? btn.getAttribute('aria-label') : null,
        iconStatic: btn !== null && btn.firstElementChild !== null && btn.firstElementChild.innerHTML.includes('evenodd'),
      })
    })()`, true))
    if (!healed.hidden) fails.push('重建后的上游 toggle 未保持隐藏（两态隐藏回归失效）')
    if (healed.aria !== '收起侧边栏') fails.push(`重建后折叠按钮 aria=${healed.aria} 应跟随上游「收起侧边栏」`)
    if (!healed.iconStatic) fails.push('重建后按钮图标应保持静态 panel-left（不随上游重建漂移）')

    // B：模拟折叠切换（React 侧行为：inline 56px + 属性 + aria 换向）
    // → void 规则生效 + 左簇重组 + extra 切换
    const collapsedSim = JSON.parse(await win.webContents.executeJavaScript(`(async () => {
      const frame = document.querySelector('.frame')
      frame.style.gridTemplateColumns = '56px minmax(400px, 1fr) minmax(0px, 0px)'
      frame.setAttribute('data-sidebar-collapsed', 'true')
      const t = document.querySelector('button[class*="toggle"]')
      if (t !== null) t.setAttribute('aria-label', '展开侧边栏')
      await new Promise((res) => setTimeout(res, 700))
      const btn = document.getElementById('__dsh_desktop_toggle_btn')
      const prevBtn = document.getElementById('__dsh_desktop_prev_btn')
      const nextBtn = document.getElementById('__dsh_desktop_next_btn')
      const newBtn = document.getElementById('__dsh_desktop_new_btn')
      const side = document.querySelector('.sidebarCol')
      const disp = (el) => el === null ? null : getComputedStyle(el).display
      return JSON.stringify({
        track1: getComputedStyle(frame).gridTemplateColumns.split(' ')[0],
        toggleLeft: btn !== null ? btn.getBoundingClientRect().left : null,
        toggleAria: btn !== null ? btn.getAttribute('aria-label') : null,
        prevDisplay: disp(prevBtn),
        nextDisplay: disp(nextBtn),
        newDisplay: disp(newBtn),
        newLeft: newBtn !== null ? newBtn.getBoundingClientRect().left : null,
        sideBorder: side !== null ? getComputedStyle(side).borderRightWidth : null,
        extra: document.documentElement.style.getPropertyValue('--dsh-titlebar-extra-left'),
      })
    })()`, true))
    if (collapsedSim.track1 !== '0px') fails.push(`模拟折叠后轨 1=${collapsedSim.track1} 应为 0px（属性切换即触发）`)
    if (Math.abs(collapsedSim.toggleLeft - COLLAPSED_TOGGLE_LEFT) > 1) fails.push(`模拟折叠后折叠按钮 left=${collapsedSim.toggleLeft} 应 ≈${COLLAPSED_TOGGLE_LEFT}`)
    if (collapsedSim.toggleAria !== '展开侧边栏') fails.push(`模拟折叠后折叠按钮 aria=${collapsedSim.toggleAria} 应为 展开侧边栏`)
    if (collapsedSim.prevDisplay !== 'none' || collapsedSim.nextDisplay !== 'none') fails.push('模拟折叠后左右箭头应隐藏')
    if (collapsedSim.newDisplay === 'none') fails.push('模拟折叠后新会话代理应显示')
    if (Math.abs(collapsedSim.newLeft - NEW_LEFT) > 1) fails.push(`模拟折叠后新会话代理 left=${collapsedSim.newLeft} 应 ≈${NEW_LEFT}`)
    if (collapsedSim.sideBorder !== '0px') fails.push(`模拟折叠后 sidebarCol 描边=${collapsedSim.sideBorder} 应为 0px`)
    if (collapsedSim.extra !== collapsedExtra + 'px') fails.push(`模拟折叠后 extra=${collapsedSim.extra} 应为 ${collapsedExtra}px`)

    // C：模拟展开（属性移除 + inline 280px）→ 规则清空 + 左簇还原
    const expandSim = JSON.parse(await win.webContents.executeJavaScript(`(async () => {
      const frame = document.querySelector('.frame')
      frame.style.gridTemplateColumns = '280px minmax(400px, 1fr) minmax(0px, 0px)'
      frame.removeAttribute('data-sidebar-collapsed')
      const t = document.querySelector('button[class*="toggle"]')
      if (t !== null) t.setAttribute('aria-label', '折叠侧边栏')
      await new Promise((res) => setTimeout(res, 700))
      const btn = document.getElementById('__dsh_desktop_toggle_btn')
      const newBtn = document.getElementById('__dsh_desktop_new_btn')
      const side = document.querySelector('.sidebarCol')
      const disp = (el) => el === null ? null : getComputedStyle(el).display
      const voidStyle = document.getElementById('__dsh_desktop_sidebar_void_style')
      return JSON.stringify({
        track1: getComputedStyle(frame).gridTemplateColumns.split(' ')[0],
        toggleLeft: btn !== null ? btn.getBoundingClientRect().left : null,
        newDisplay: disp(newBtn),
        sideBorder: side !== null ? getComputedStyle(side).borderRightWidth : null,
        voidLen: voidStyle !== null ? voidStyle.textContent.length : null,
        extra: document.documentElement.style.getPropertyValue('--dsh-titlebar-extra-left'),
      })
    })()`, true))
    if (expandSim.track1 !== '280px') fails.push(`模拟展开后轨 1=${expandSim.track1} 应为 280px（规则应清空）`)
    if (Math.abs(expandSim.toggleLeft - TOGGLE_LEFT) > 1) fails.push(`模拟展开后折叠按钮 left=${expandSim.toggleLeft} 应 ≈${TOGGLE_LEFT}`)
    if (expandSim.newDisplay !== 'none') fails.push('模拟展开后新会话代理应隐藏')
    if (expandSim.sideBorder !== '1px') fails.push(`模拟展开后 sidebarCol 描边=${expandSim.sideBorder} 应为 1px（规则清空后恢复）`)
    if (expandSim.voidLen !== 0) fails.push(`模拟展开后 void 规则应为空，实际长度=${expandSim.voidLen}`)
    if (expandSim.extra !== expandedExtra + 'px') fails.push(`模拟展开后 extra=${expandSim.extra} 应为 ${expandedExtra}px`)
  } else {
    // 折叠态：模拟窗口缩放（inline 轨 2 重写为更大的 min）→ 规则跟刷。
    // 用 500px（> 窗口可用宽）才能在计算值里与未刷新的 480px 区分开
    const resized = JSON.parse(await win.webContents.executeJavaScript(`(async () => {
      const frame = document.querySelector('.frame')
      frame.style.gridTemplateColumns = '56px minmax(500px, 1fr) minmax(0px, 0px)'
      await new Promise((res) => setTimeout(res, 700))
      return JSON.stringify({ tracks: getComputedStyle(frame).gridTemplateColumns })
    })()`, true))
    if (!resized.tracks.startsWith('0px 500px')) fails.push(`折叠态窗口缩放后无痕规则未跟刷，实际「${resized.tracks}」`)
  }

  console.log(`[${label}${collapsed ? '-collapsed' : ''}]`, fails.length === 0 ? 'PASS' : 'FAIL: ' + fails.join('; '))
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
  // 折叠态场景（macOS）：void 规则 + 两枚左簇 + 跟刷自愈
  results.push(await runScenario(win, 'dark', true, true))
  // Windows 场景：装饰红绿灯 + 双平台同坐标（展开 + 折叠各一档，extra 不同）
  results.push(await runScenario(win, 'win-dark', true, false, true))
  results.push(await runScenario(win, 'win-dark', true, true, true))
  console.log(results.every(Boolean) ? 'ALL PASS' : 'FAILED')
  app.exit(results.every(Boolean) ? 0 : 1)
})
