/**
 * win32 面板收纳菜单：四枚面板按钮收进标题栏下拉菜单。
 *
 * 背景（Windows titleBarOverlay 遮挡缺陷）：四枚面板按钮
 * （sidebar-cluster/terminal-panel/context-button 注入，
 * `position:absolute; right:12/44/76px`；git 由 @kcoder/git-panel
 * 插件 client 注入 right:108px）挂在自绘标题栏内——
 * absolute 定位基于包含块 padding box（≈窗口右缘），标题栏为避让
 * 原生控制按钮区（titleBarOverlay 右侧 138px，绘制在窗口层最顶）
 * 加的 padding-right:138px 对 absolute 子元素无效 → 按钮带整段
 * （108+26=134 < 138）落在原生按钮区内被盖。
 *
 * 方案：win32 下四钮 display:none，由一枚菜单按钮（right:150px，
 * 原生区左侧安全位）下拉收纳。菜单项点击转发 .click() 到原按钮——
 * 原生 onclick 不依赖可见性，display:none 照常触发（workspace-header
 * 的 tab 兑底同款事实）；菜单项图标与开关态实时克隆自原按钮
 * （svg/disabled）；点击转发原按钮 .click()。macOS/Linux 不注入
 * 本模块，四钮平铺现状不变。
 *
 * 与 WebContentsView 面板的冲突：下拉是页面 DOM，compositor 层上
 * 任何独立视图（内嵌终端）都盖在它上面（z-index 无效），
 * 故下拉开合经 console 通道（`__dsh_panel_menu:`）通知主进程：
 * 打开 → 相关面板 yieldForMenu 临时收视图（开合态/让位 pad 全保留），
 * 关闭 → 按原开合态恢复。git 面板已插件化（纯 DOM，无 compositor
 * 冲突），不再参与让位。
 *
 * @module desktop/main/panel-menu
 */

import type { BrowserWindow } from 'electron'
import { consoleMessageText } from './console-channel'
import { terminalPanel } from './terminal-panel'

/** console 通道前缀：下拉开合上报（见模块头注释冲突段）。 */
const MENU_PREFIX = '__dsh_panel_menu:'

/** 注入脚本（页面上下文；模板串内无主进程插值，全部为页面代码）。 */
const MENU_JS = `(() => {
  if (window.__dshPanelMenuWired) return
  window.__dshPanelMenuWired = true
  const PANELS = [
    { id: '__dsh_desktop_sidebar_panel_btn', label: '侧边栏' },
    { id: '__dsh_desktop_terminal_btn', label: '内嵌终端' },
    { id: '__dsh_desktop_context_btn', label: '上下文' },
    { id: '__dsh_kc_git_btn', label: 'Git 面板' },
  ]
  const BTN = '__dsh_desktop_panel_menu_btn'
  const POP = '__dsh_desktop_panel_menu_pop'
  const STYLE = '__dsh_desktop_panel_menu_style'

  let styleEl = document.getElementById(STYLE)
  if (styleEl === null) {
    styleEl = document.createElement('style')
    styleEl.id = STYLE
    document.head.append(styleEl)
  }
  styleEl.textContent = [
    /* 两枚原按钮整体让位（本脚本仅 win32 注入，不影响其他平台） */
    PANELS.map((p) => '#' + p.id).join(',') + '{display:none !important}',
    /* 菜单按钮：与代理按钮同款视觉，right:150px 在原生按钮区左侧 */
    '#' + BTN + '{all:unset;box-sizing:border-box;position:absolute;right:150px;top:50%;transform:translateY(-50%);display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;cursor:pointer;color:rgba(26,29,33,.65);-webkit-app-region:no-drag;transition:background .15s ease}',
    'body[data-ds-dark-theme] #' + BTN + '{color:rgba(232,234,237,.8)}',
    '#' + BTN + ':hover{background:color-mix(in srgb,currentColor 10%,transparent)}',
    '#' + BTN + ':active{background:color-mix(in srgb,currentColor 18%,transparent)}',
    '#' + BTN + '[data-open="1"]{background:color-mix(in srgb,currentColor 14%,transparent)}',
    /* 下拉面板：按钮正下方，右缘对齐按钮右缘 */
    '#' + POP + '{position:fixed;top:52px;right:150px;z-index:2147483647;min-width:190px;padding:5px;border-radius:11px;box-shadow:0 8px 28px rgba(9,12,16,.18),0 0 0 1px rgba(9,12,16,.07);display:none}',
    '#' + POP + '[data-show="1"]{display:block}',
    '#' + POP + ' .mi{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:9px;width:100%;padding:7px 10px;border-radius:8px;cursor:pointer;color:rgba(26,29,33,.8);font:400 12.5px -apple-system,"PingFang SC","Segoe UI",sans-serif}',
    '#' + POP + ' .mi:hover{background:color-mix(in srgb,currentColor 8%,transparent)}',
    '#' + POP + ' .mi[aria-disabled="true"]{opacity:.45;cursor:default}',
    '#' + POP + ' .mi svg{width:15px;height:15px;flex:none}',
    '#' + POP + ' .mi .st{margin-left:auto;flex:none;width:6px;height:6px;border-radius:50%;background:transparent}',
    '#' + POP + ' .mi[data-on="1"] .st{background:#2F6FED}',
    'body[data-ds-dark-theme] #' + POP + '{box-shadow:0 8px 28px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.08)}',
    'body[data-ds-dark-theme] #' + POP + ' .mi{color:rgba(232,234,237,.85)}',
    'body[data-ds-dark-theme] #' + POP + ' .mi[data-on="1"] .st{background:#7C9BFF}',
  ].join('')

  /* 主题：与标题栏同源（--dsw-specific-sidebar-fill），随落点变化刷新 */
  const applyTheme = () => {
    const pop = document.getElementById(POP)
    if (pop === null) return
    let color = ''
    try { color = getComputedStyle(document.body).getPropertyValue('--dsw-specific-sidebar-fill').trim() } catch {}
    const dark = document.body.hasAttribute('data-ds-dark-theme')
      || document.documentElement.style.colorScheme === 'dark'
    pop.style.background = color || (dark ? '#1B1B1C' : '#FFFFFF')
  }
  new MutationObserver(applyTheme).observe(document.documentElement, {
    attributes: true, attributeFilter: ['style'],
  })
  new MutationObserver(applyTheme).observe(document.body, {
    attributes: true, attributeFilter: ['data-ds-dark-theme'],
  })

  let openObs = null
  const closeMenu = () => {
    const pop = document.getElementById(POP)
    const was = pop !== null && pop.getAttribute('data-show') === '1'
    if (pop !== null) pop.setAttribute('data-show', '0')
    if (openObs !== null) { openObs.disconnect(); openObs = null }
    const btn = document.getElementById(BTN)
    if (btn !== null) btn.setAttribute('data-open', '0')
    /* 仅真的关了才通知：WebContentsView 面板（终端）恢复 */
    if (was) console.log('__dsh_panel_menu:close')
  }
  /* 菜单项构建：图标克隆原按钮 svg；开关态读 data-open/data-on；
     禁用态跟随原按钮 disabled/.dim；点击转发原按钮 .click() */
  const rebuild = () => {
    const pop = document.getElementById(POP)
    if (pop === null) return
    pop.replaceChildren()
    for (const p of PANELS) {
      const src = document.getElementById(p.id)
      const item = document.createElement('button')
      item.className = 'mi'
      item.type = 'button'
      const svg = src !== null ? src.querySelector('svg') : null
      if (svg !== null) item.append(svg.cloneNode(true))
      const txt = document.createElement('span')
      txt.textContent = p.label
      txt.style.cssText = 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
      const st = document.createElement('span')
      st.className = 'st'
      item.append(txt, st)
      if (src === null || src.disabled || src.classList.contains('dim')) {
        item.setAttribute('aria-disabled', 'true')
      } else {
        if (src.getAttribute('data-open') === '1' || src.getAttribute('data-on') === '1') {
          item.setAttribute('data-on', '1')
        }
        item.onclick = (ev) => {
          ev.stopPropagation()
          closeMenu()
          src.click()
        }
      }
      pop.append(item)
    }
    applyTheme()
  }
  const openMenu = () => {
    const pop = document.getElementById(POP)
    if (pop === null) return
    rebuild()
    pop.setAttribute('data-show', '1')
    const btn = document.getElementById(BTN)
    if (btn !== null) btn.setAttribute('data-open', '1')
    /* 打开期间：原按钮属性变化（面板开合/禁用/徽标）→ 实时重渲 */
    openObs = new MutationObserver(rebuild)
    for (const p of PANELS) {
      const src = document.getElementById(p.id)
      if (src !== null) openObs.observe(src, { attributes: true, childList: true, subtree: true })
    }
    /* 通知主进程：WebContentsView 面板（终端）临时让位 */
    console.log('__dsh_panel_menu:open')
  }
  const toggleMenu = (ev) => {
    ev.stopPropagation()
    const pop = document.getElementById(POP)
    if (pop !== null && pop.getAttribute('data-show') === '1') closeMenu()
    else openMenu()
  }

  const mount = () => {
    const host = document.getElementById('__dsh_desktop_titlebar')
    if (host === null || document.getElementById(BTN) !== null) return false
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.id = BTN
    btn.title = '面板菜单'
    btn.setAttribute('aria-label', '面板菜单')
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 16 16')
    svg.setAttribute('width', '15')
    svg.setAttribute('height', '15')
    svg.setAttribute('fill', 'none')
    svg.innerHTML = '<rect x="2" y="2" width="5" height="5" rx="1.2" stroke="currentColor" stroke-width="1.3"/><rect x="9" y="2" width="5" height="5" rx="1.2" stroke="currentColor" stroke-width="1.3"/><rect x="2" y="9" width="5" height="5" rx="1.2" stroke="currentColor" stroke-width="1.3"/><rect x="9" y="9" width="5" height="5" rx="1.2" stroke="currentColor" stroke-width="1.3"/>'
    btn.append(svg)
    btn.onclick = toggleMenu
    host.append(btn)

    const pop = document.createElement('div')
    pop.id = POP
    pop.setAttribute('data-show', '0')
    document.body.append(pop)

    /* 外点关闭（捕获先于目标）与 ESC */
    document.addEventListener('click', (ev) => {
      const t = ev.target
      if (!(t instanceof Node)) return
      const popEl = document.getElementById(POP)
      const btnEl = document.getElementById(BTN)
      if (btnEl !== null && btnEl.contains(t)) return
      if (popEl !== null && popEl.contains(t)) return
      closeMenu()
    }, true)
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeMenu() }, true)

    applyTheme()
    return true
  }
  /* 标题栏由 theme-watcher 注入（可能晚于本脚本）：rAF 轮询挂载 */
  const waitBar = () => { if (!mount()) requestAnimationFrame(waitBar) }
  waitBar()
})()`

/**
 * 挂载面板收纳菜单（仅 win32；其他平台为 no-op，四钮平铺不变）。
 */
export function attachPanelMenu(win: BrowserWindow): void {
  if (process.platform !== 'win32') return
  const wc = win.webContents
  // 下拉开合 → WebContentsView 面板让位/恢复（compositor 层冲突，
  // 见模块头注释）
  const onConsole = (event: unknown, ...rest: unknown[]): void => {
    const message = consoleMessageText(event, rest)
    if (!message.startsWith(MENU_PREFIX)) return
    const on = message.slice(MENU_PREFIX.length) === 'open'
    terminalPanel.yieldForMenu(on)
  }
  wc.on('console-message', onConsole)
  const onDidLoad = (): void => {
    if (win.isDestroyed()) return
    wc.executeJavaScript(MENU_JS, true).catch(() => {
      // 页面跳转间隙执行失败属正常，下次加载重试
    })
  }
  wc.on('did-finish-load', onDidLoad)
  win.on('closed', () => {
    wc.removeListener('did-finish-load', onDidLoad)
    wc.removeListener('console-message', onConsole)
  })
}
