/**
 * 侧边栏折叠按钮迁移 + 会话导航按钮（零侵入注入器）：
 * 1. 把上游位于侧边栏 logoRow 右侧的折叠按钮（button.iconButton.toggle，
 *    React 持有、展开/收起两态同一按钮，onClick 走 toggleSidebar 驱动
 *    折叠动画与 rail）移到自绘标题栏红绿灯区域右侧（用户指定位置，
 *    macOS left 84px，按参考图"红绿灯右边第一个按钮"换算）；
 * 2. 折叠按钮右侧新增两个 26x26 箭头按钮（macOS left 128/174px，
 *    用户参考图红框内左右箭头）：左=上一个会话、右=下一个会话——
 *    在侧边栏会话树（ui-workspace WorkspaceBrowser，role="tree" 内
 *    role="treeitem" 的会话行，aria-selected 标记当前会话）中点击
 *    相邻行（React 合成事件照常驱动 onOpen 切换会话）；会话列表仅
 *    展开态挂载，收起态点箭头先展开侧边栏（rail K logo toggle）。
 *
 * 注入脚本（页面上下文）做三件事：
 * 1. 隐藏上游 toggle：inline display:none + CSS !important 兑底
 *    （React 重建的按钮不带 inline 样式，靠 CSS 兜底）；React 重渲染
 *    后由 MutationObserver 自愈重新隐藏；收起态（railMark 内含
 *    brand-injector 注入的 K logo）恢复显示——那是"折叠后红框处的
 *    logo K"，点击展开（上游设计：静息 K logo、hover 换 panelIcon）；
 * 2. 在自绘标题栏（theme-watcher 注入的 #__dsh_desktop_titlebar）
 *    注入三个按钮（macOS：折叠 84px / 左箭头 128px / 右箭头 174px，
 *    紧邻红绿灯区域右侧；Windows 无红绿灯：折叠 12px / 左箭头 46px /
 *    右箭头 80px）：
 *    - 折叠按钮点击 → 上游 toggle.click()：React 合成事件照常，
 *      折叠状态、动画、rail 图标全部由上游驱动；图标实时克隆上游
 *      toggle 内最后一个 svg（panelIcon），aria-label/title 同步；
 *    - 箭头按钮点击 → 会话树相邻行 click()，aria-label 固定
 *      （上一个会话/下一个会话）；
 * 3. 标题栏 label 让位：documentElement 设 --dsh-titlebar-extra-left
 *    = 最右按钮（右箭头）右缘 + 间距 8 - 平台 leftPad（macOS：
 *    174+34-78=130；Windows：80+34-12=102），theme-watcher 的
 *    margin-left / max-width 最小让位随之抬升（CSS 变量变化自动重算，
 *    无需重建 bar）；展开态侧边栏宽时标题仍在侧边栏右缘（max 分支
 *    取侧边栏宽度），收起态/探针失效时标题退到按钮右侧不重叠。
 *
 * 宿主时序不保证：bar 由 theme-watcher 注入（同 did-finish-load，
 * 本注入器注册在其后），轮询等待 bar 存在（与 sidebar-cluster 同款）。
 *
 * @module desktop/main/sidebar-toggle
 */
import type { BrowserWindow } from 'electron'

/** 折叠按钮左缘占位符（smoke 从源码提取后替换为平台值）。 */
const PLACEHOLDER = '${TOGGLE_BTN_LEFT}'

/** 左箭头（上一个会话）按钮左缘占位符。 */
const ARROW_PREV_PLACEHOLDER = '${TOGGLE_ARROW_PREV_LEFT}'

/** 右箭头（下一个会话）按钮左缘占位符。 */
const ARROW_NEXT_PLACEHOLDER = '${TOGGLE_ARROW_NEXT_LEFT}'

/** 标题栏 label 让位量占位符（最右按钮右缘 + 间距 8 - 平台 leftPad）。 */
const EXTRA_PLACEHOLDER = '${TOGGLE_EXTRA_LEFT}'

const PAGE_JS = `(() => {
  if (window.__dshSidebarToggleWired) return
  window.__dshSidebarToggleWired = true
  const BTN_ID = '__dsh_desktop_toggle_btn'
  const PREV_ID = '__dsh_desktop_prev_btn'
  const NEXT_ID = '__dsh_desktop_next_btn'
  const BTN_LEFT = ${PLACEHOLDER}
  const PREV_LEFT = ${ARROW_PREV_PLACEHOLDER}
  const NEXT_LEFT = ${ARROW_NEXT_PLACEHOLDER}
  const EXTRA_LEFT = ${EXTRA_PLACEHOLDER} // 最右按钮右缘 + 间距 8，折算到平台 leftPad 之后
  // 会话导航箭头图标（chevron，参考用户图中红框内左右箭头形态）
  const ARROW_LEFT_SVG =
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3 5 8l5 5"/></svg>'
  const ARROW_RIGHT_SVG =
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg>'

  // 标题栏 label 让位：theme-watcher 的 margin-left/max-width 消费此
  // 变量（CSS 变量变化自动重算，无需重建 bar）
  document.documentElement.style.setProperty('--dsh-titlebar-extra-left', EXTRA_LEFT + 'px')

  // 上游折叠按钮（展开 logoRow 右侧 / 收起 rail 图标，同一按钮）。
  // 收起态（rail）：恢复显示——railMark 内 brand-injector 注入的
  // KCoder K logo 即"折叠后红框处的 logo K"，点击展开（上游设计：
  // 静息 K logo、hover 换 panelIcon 展开提示）；展开态：隐藏，
  // 折叠交给标题栏按钮接管。
  const toggleEl = () => document.querySelector('[class*="logoRow"] button[class*="toggle"]')
  const isCollapsed = () => {
    const t = toggleEl()
    return t !== null && t.querySelector('[class*="railMark"]') !== null
  }
  const hideToggle = () => {
    const t = toggleEl()
    if (t === null) return
    if (isCollapsed()) {
      // 收起态：恢复显示（React 重建后不带 inline display，只需清掉旧值）
      if (t.style.display === 'none') t.style.display = ''
    } else if (t.style.display !== 'none') {
      t.style.display = 'none'
    }
  }
  hideToggle()

  // 兜底样式：仅隐藏展开态的上游 toggle（React 重建的按钮不带 inline
  // display，靠 :has() 兜底；收起态含 railMark 的不命中）+ 注入按钮
  // 外观（与 sidebar-cluster 代理按钮同款，三个按钮共享）
  const BTN_CSS = '#' + [BTN_ID, PREV_ID, NEXT_ID].join(',#')
  const style = document.createElement('style')
  style.id = '__dsh_desktop_toggle_style'
  style.textContent = [
    '[class*="logoRow"] button[class*="toggle"]:not(:has([class*="railMark"])){display:none !important}',
    BTN_CSS + '{all:unset;box-sizing:border-box;position:absolute;top:50%;transform:translateY(-50%);display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;cursor:pointer;color:rgba(26,29,33,.65);-webkit-app-region:no-drag;transition:background .15s ease}',
    '#' + BTN_ID + '{left:' + BTN_LEFT + 'px}',
    '#' + PREV_ID + '{left:' + PREV_LEFT + 'px}',
    '#' + NEXT_ID + '{left:' + NEXT_LEFT + 'px}',
    'body[data-ds-dark-theme] ' + BTN_CSS + '{color:rgba(232,234,237,.8)}',
    BTN_CSS + ':hover{background:color-mix(in srgb,currentColor 10%,transparent)}',
    BTN_CSS + ':active{background:color-mix(in srgb,currentColor 18%,transparent)}',
  ].join('')
  document.head.append(style)

  const bar = () => document.getElementById('__dsh_desktop_titlebar')

  // 图标/语义同步：克隆上游 toggle 最后一个 svg（panelIcon；收起态
  // railMark FishLogo 在前、panelIcon 在后），aria-label/title 同步
  const sync = () => {
    const t = toggleEl()
    const btn = document.getElementById(BTN_ID)
    if (t === null || btn === null) return
    const svgs = t.querySelectorAll('svg')
    const icon = svgs.length > 0 ? svgs[svgs.length - 1] : null
    const box = btn.firstElementChild
    if (icon !== null && box !== null && box.innerHTML !== icon.outerHTML) {
      box.innerHTML = icon.outerHTML
    }
    const label = t.getAttribute('aria-label') || t.title || ''
    if (label !== '' && btn.getAttribute('aria-label') !== label) {
      btn.setAttribute('aria-label', label)
      btn.title = label
    }
  }

  // 会话导航：在侧边栏会话树（ui-workspace WorkspaceBrowser，role="tree"
  // 内 role="treeitem" 的会话行，aria-selected 标记当前会话）中点击相邻
  // 行，React 合成事件照常驱动 onOpen 切换会话。列表仅展开态挂载：
  // 收起态点箭头先展开侧边栏（rail K logo toggle），再点即导航。
  const sessionRows = () =>
    document.querySelectorAll('[role="tree"] [role="treeitem"][class*="sessionRow"]')
  const navigateSession = (dir) => {
    const rows = sessionRows()
    if (rows.length === 0) {
      const t = toggleEl()
      if (t !== null && isCollapsed()) t.click()
      return
    }
    let current = -1
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute('aria-selected') === 'true') {
        current = i
        break
      }
    }
    const target =
      current === -1 ? (dir > 0 ? 0 : rows.length - 1) : current + dir
    if (target >= 0 && target < rows.length) rows[target].click()
  }

  const injectBtn = () => {
    if (document.getElementById(NEXT_ID) !== null) return 'present'
    const host = bar()
    if (host === null) return 'absent'
    const mkBtn = (id, aria, iconSvg, onClick) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.id = id
      if (aria !== '') {
        b.setAttribute('aria-label', aria)
        b.title = aria
      }
      const box = document.createElement('span')
      box.style.cssText = 'display:inline-flex;align-items:center;justify-content:center'
      if (iconSvg !== '') box.innerHTML = iconSvg
      b.append(box)
      b.onclick = onClick
      host.append(b)
    }
    mkBtn(BTN_ID, '', '', () => {
      const t = toggleEl()
      if (t !== null) t.click()
    })
    mkBtn(PREV_ID, '上一个会话', ARROW_LEFT_SVG, () => navigateSession(-1))
    mkBtn(NEXT_ID, '下一个会话', ARROW_RIGHT_SVG, () => navigateSession(1))
    sync()
    return 'injected'
  }

  let tries = 0
  const poll = setInterval(() => {
    const status = injectBtn()
    hideToggle()
    sync()
    if (status !== 'absent' || ++tries > 120) clearInterval(poll)
  }, 500)

  // 自愈：React 重建 toggle（状态切换/会话变化）后重新隐藏并同步图标
  new MutationObserver(() => { hideToggle(); sync() })
    .observe(document.body, { subtree: true, childList: true })
})()`

/**
 * 把折叠按钮迁移注入器挂到 shell 窗口：
 * 仅 darwin/win32（自绘标题栏存在的平台）；did-finish-load 注入
 * （每次导航后重新注入，脚本自幂等）。
 */
export function attachSidebarToggle(win: BrowserWindow): void {
  if (process.platform !== 'darwin' && process.platform !== 'win32') return
  // macOS：三个按钮紧邻红绿灯区域右侧（用户参考图：红绿灯右缘 →
  // 折叠按钮 x≈84 → 左箭头 x≈128 → 右箭头 x≈174）；Windows：从最左
  // 起排布（titleBarOverlay 控制按钮之前，无红绿灯）。leftPad 与
  // theme-watcher 一致（darwin 78/win32 12）
  const leftPad = process.platform === 'win32' ? 12 : 78
  const left = process.platform === 'win32' ? 12 : 84
  const prev = process.platform === 'win32' ? 46 : 128
  const next = process.platform === 'win32' ? 80 : 174
  const extra = next + 26 + 8 - leftPad // 最右（右箭头）右缘 + 间距 - leftPad
  const script = PAGE_JS
    .replaceAll(PLACEHOLDER, String(left))
    .replaceAll(ARROW_PREV_PLACEHOLDER, String(prev))
    .replaceAll(ARROW_NEXT_PLACEHOLDER, String(next))
    .replaceAll(EXTRA_PLACEHOLDER, String(extra))
  win.webContents.on('did-finish-load', () => {
    if (win.isDestroyed()) return
    win.webContents.executeJavaScript(script, true).catch(() => {
      // 页面跳转间隙执行失败属正常，下次加载会重试
    })
  })
}
