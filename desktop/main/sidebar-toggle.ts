/**
 * 侧边栏折叠按钮迁移（零侵入注入器）：把上游位于侧边栏 logoRow
 * 右侧的折叠按钮（button.iconButton.toggle，React 持有、展开/收起
 * 两态同一按钮，onClick 走 toggleSidebar 驱动折叠动画与 rail）移到
 * 自绘标题栏红绿灯右侧（用户指定位置）。
 *
 * 注入脚本（页面上下文）做三件事：
 * 1. 隐藏上游 toggle：inline display:none + CSS !important 兑底
 *    （React 重建的按钮不带 inline 样式，靠 CSS 兜底）；React 重渲染
 *    后由 MutationObserver 自愈重新隐藏；
 * 2. 在自绘标题栏（theme-watcher 注入的 #__dsh_desktop_titlebar）
 *    注入 26x26 折叠按钮——macOS 侧边栏右缘（left 254px，用户标注
 *    目标：红绿灯右侧空隙、label 之前）/Windows 最左（left 12px）：
 *    - 点击 → 上游 toggle.click()：React 合成事件照常，折叠状态、
 *      动画、rail 图标全部由上游驱动，不触碰 React 内部状态；
 *    - 图标实时克隆上游 toggle 内最后一个 svg（panelIcon：展开态
 *      16px / 收起态 18px，保留 hash class 与 width/height，上游
 *      样式表对其生效），aria-label/title 同步（展开态=折叠语义、
 *      收起态=展开语义，tooltip 文案随状态）；
 * 3. 标题栏 label 让位：documentElement 设 --dsh-titlebar-extra-left
 *    = 按钮右缘 + 间距 8 - 平台 leftPad（macOS：254+34-78=210；
 *    Windows：12+34-12=34），theme-watcher 的 margin-left /
 *    max-width 最小让位随之抬升（CSS 变量变化自动重算，无需重建
 *    bar）；展开态侧边栏宽时标题仍在侧边栏右缘（max 分支取侧边栏
 *    宽度），收起态/探针失效时标题退到按钮右侧不重叠。
 *
 * 宿主时序不保证：bar 由 theme-watcher 注入（同 did-finish-load，
 * 本注入器注册在其后），轮询等待 bar 存在（与 terminal-panel 同款）。
 *
 * @module desktop/main/sidebar-toggle
 */
import type { BrowserWindow } from 'electron'

/** 注入按钮左缘占位符（smoke 从源码提取后替换为平台值）。 */
const PLACEHOLDER = '${TOGGLE_BTN_LEFT}'

/** 标题栏 label 让位量占位符（按钮右缘 + 间距 8 - 平台 leftPad）。 */
const EXTRA_PLACEHOLDER = '${TOGGLE_EXTRA_LEFT}'

const PAGE_JS = `(() => {
  if (window.__dshSidebarToggleWired) return
  window.__dshSidebarToggleWired = true
  const BTN_ID = '__dsh_desktop_toggle_btn'
  const BTN_LEFT = ${PLACEHOLDER}
  const EXTRA_LEFT = ${EXTRA_PLACEHOLDER} // 按钮右缘 + 间距 8，折算到平台 leftPad 之后

  // 标题栏 label 让位：theme-watcher 的 margin-left/max-width 消费此
  // 变量（CSS 变量变化自动重算，无需重建 bar）
  document.documentElement.style.setProperty('--dsh-titlebar-extra-left', EXTRA_LEFT + 'px')

  // 上游折叠按钮（展开 logoRow 右侧 / 收起 rail 图标，同一按钮）
  const toggleEl = () => document.querySelector('[class*="logoRow"] button[class*="toggle"]')
  const hideToggle = () => {
    const t = toggleEl()
    if (t !== null && t.style.display !== 'none') t.style.display = 'none'
  }
  hideToggle()

  // 兜底样式：隐藏上游 toggle（React 重建的按钮不带 inline display，
  // 靠 !important 兜底）+ 注入按钮外观（与 terminal-panel 按钮同款）
  const style = document.createElement('style')
  style.id = '__dsh_desktop_toggle_style'
  style.textContent = [
    '[class*="logoRow"] button[class*="toggle"]{display:none !important}',
    '#' + BTN_ID + '{all:unset;box-sizing:border-box;position:absolute;left:' + BTN_LEFT + 'px;top:50%;transform:translateY(-50%);display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;cursor:pointer;color:rgba(26,29,33,.65);-webkit-app-region:no-drag;transition:background .15s ease}',
    'body[data-ds-dark-theme] #' + BTN_ID + '{color:rgba(232,234,237,.8)}',
    '#' + BTN_ID + ':hover{background:color-mix(in srgb,currentColor 10%,transparent)}',
    '#' + BTN_ID + ':active{background:color-mix(in srgb,currentColor 18%,transparent)}',
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

  const injectBtn = () => {
    if (document.getElementById(BTN_ID) !== null) return 'present'
    const host = bar()
    if (host === null) return 'absent'
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.id = BTN_ID
    const box = document.createElement('span')
    box.style.cssText = 'display:inline-flex;align-items:center;justify-content:center'
    btn.append(box)
    btn.onclick = () => {
      const t = toggleEl()
      if (t !== null) t.click()
    }
    host.append(btn)
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
  // macOS：用户标注的目标位置（红绿灯右侧空隙、label 之前，箭头尖端
  // x≈267 → 按钮中心对齐，left 254）；Windows：最左（titleBarOverlay
  // 控制按钮之前）。leftPad 与 theme-watcher 一致（darwin 78/win32 12）
  const leftPad = process.platform === 'win32' ? 12 : 78
  const left = process.platform === 'win32' ? 12 : 254
  const extra = left + 26 + 8 - leftPad // 按钮右缘 + 间距 - leftPad
  const script = PAGE_JS
    .replaceAll(PLACEHOLDER, String(left))
    .replaceAll(EXTRA_PLACEHOLDER, String(extra))
  win.webContents.on('did-finish-load', () => {
    if (win.isDestroyed()) return
    win.webContents.executeJavaScript(script, true).catch(() => {
      // 页面跳转间隙执行失败属正常，下次加载会重试
    })
  })
}
