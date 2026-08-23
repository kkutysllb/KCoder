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
 *    紧邻红绿灯区域右侧，红绿灯区域 12~64px 不可侵占；Windows 无红
 *    绿灯：最左先排 K logo 品牌图标（24px，用户需求：侧边栏顶部折
 *    叠按钮左侧的 logo），按钮带整体右移——折叠 44px / 左箭头 78px /
 *    右箭头 112px）：
 *    - 折叠按钮点击 → 上游 toggle.click()：React 合成事件照常，
 *      折叠状态、动画、rail 图标全部由上游驱动；图标实时克隆上游
 *      toggle 内最后一个 svg（panelIcon），aria-label/title 同步；
 *    - 箭头按钮点击 → 会话树相邻行 click()，aria-label 固定
 *      （上一个会话/下一个会话）；
 * 3. 标题栏 label 让位：documentElement 设 --dsh-titlebar-extra-left
 *    = 最右按钮（右箭头）右缘 + 间距 8 - 平台 leftPad（macOS：
 *    174+34-78=130；Windows：112+34-12=134），theme-watcher 的
 *    margin-left / max-width 最小让位随之抬升（CSS 变量变化自动重算，
 *    无需重建 bar）；展开态侧边栏宽时标题仍在侧边栏右缘（max 分支
 *    取侧边栏宽度），收起态/探针失效时标题退到按钮右侧不重叠。
 *
 * 宿主时序不保证：bar 由 theme-watcher 注入（同 did-finish-load，
 * 本注入器注册在其后），轮询等待 bar 存在（与 sidebar-cluster 同款）。
 *
 * @module desktop/main/sidebar-toggle
 */
import { readFileSync } from 'node:fs'
import type { BrowserWindow } from 'electron'
import { resolveAsset } from './dsh-contract'

/** 折叠按钮左缘占位符（smoke 从源码提取后替换为平台值）。 */
const PLACEHOLDER = '${TOGGLE_BTN_LEFT}'

/** 左箭头（上一个会话）按钮左缘占位符。 */
const ARROW_PREV_PLACEHOLDER = '${TOGGLE_ARROW_PREV_LEFT}'

/** 右箭头（下一个会话）按钮左缘占位符。 */
const ARROW_NEXT_PLACEHOLDER = '${TOGGLE_ARROW_NEXT_LEFT}'

/** 标题栏 label 让位量占位符（最右按钮右缘 + 间距 8 - 平台 leftPad）。 */
const EXTRA_PLACEHOLDER = '${TOGGLE_EXTRA_LEFT}'

/**
 * 折叠按钮静态图标占位符：构建时替换为完整 panel-left path（取自上游
 * dsh-client-ui-primitives 的 IconPanelLeftOutline16，viewBox 0 0 16 16、
 * fillRule evenodd、fill currentColor，固定 16×16）。放占位符是因为
 * 2151 字符的 path 数据内嵌会让源码这一行不可读；真值由下方
 * TOGGLE_ICON_SVG 常量（模块装配段）注入。
 */
const TOGGLE_ICON_PLACEHOLDER = '${TOGGLE_ICON_SVG}'

/** 标题栏 K logo 左缘占位符（Windows 品牌图标；macOS 为 -1 = 不注入，红绿灯区域不可侵占）。 */
const LOGO_LEFT_PLACEHOLDER = '${TOGGLE_LOGO_LEFT}'

/** 标题栏 K logo 图占位符（brand-k.png 的 dataURL，构建时注入）。 */
const LOGO_IMG_PLACEHOLDER = '${TOGGLE_LOGO_IMG}'

/** 标题栏 K logo（Windows 折叠按钮左侧品牌图标；brand-injector 同款 64px 透明 K，与 rail 态 K 同尺寸 24px 展示）。 */
const logoDataUrl = `data:image/png;base64,${readFileSync(resolveAsset('brand-k.png')).toString('base64')}`

/** 折叠按钮静态图标（与上游 IconPanelLeftOutline16 逐字形一致，恒 16px）。 */
const TOGGLE_ICON_SVG =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" fill="currentColor" d="' +
  'M9.67272 0.522841C10.8339 0.522841 11.76 0.522714 12.4963 0.602493C13.2453 0.683657 13.8789 0.854248 14.4264 1.25197C14.7504 1.48739 15.0355 1.77247 15.2709 2.0965C15.6686 2.64394 15.8392 3.27758 15.9204 4.02655C16.0002 4.7629 16 5.68895 16 6.85014V9.14986C16 10.3111 16.0002 11.2371 15.9204 11.9735C15.8392 12.7224 15.6686 13.3561 15.2709 13.9035C15.0355 14.2275 14.7504 14.5126 14.4264 14.748C13.8789 15.1458 13.2453 15.3163 12.4963 15.3975C11.76 15.4773 10.8339 15.4772 9.67272 15.4772H6.3273C5.16611 15.4772 4.24006 15.4773 3.50371 15.3975C2.75474 15.3163 2.1211 15.1458 1.57366 14.748C1.24963 14.5126 0.964549 14.2275 0.729131 13.9035C0.331407 13.3561 0.160817 12.7224 0.0796529 11.9735C-0.000126137 11.2371 1.25338e-09 10.3111 1.25338e-09 9.14986V6.85014C1.25329e-09 5.68895 -0.000126137 4.7629 0.0796529 4.02655C0.160817 3.27758 0.331407 2.64394 0.729131 2.0965C0.964549 1.77247 1.24963 1.48739 1.57366 1.25197C2.1211 0.854248 2.75474 0.683657 3.50371 0.602493C4.24006 0.522714 5.16611 0.522841 6.3273 0.522841H9.67272Z' +
  'M5.54303 1.88715V14.1118C5.78636 14.1128 6.04709 14.1169 6.3273 14.1169H9.67272C10.8639 14.1169 11.7032 14.1164 12.3493 14.0465C12.9824 13.9779 13.3497 13.8494 13.6268 13.6482C13.8354 13.4966 14.0195 13.3125 14.1711 13.1039C14.3723 12.8268 14.5007 12.4595 14.5693 11.8264C14.6393 11.1803 14.6398 10.341 14.6398 9.14986V6.85014C14.6398 5.65896 14.6393 4.81967 14.5693 4.1736C14.5007 3.54048 14.3723 3.17318 14.1711 2.89609C14.0195 2.68747 13.8354 2.50337 13.6268 2.35179C13.3497 2.1506 12.9824 2.02212 12.3493 1.95353C11.7032 1.88358 10.8639 1.88307 9.67272 1.88307H6.3273C6.04709 1.88307 5.78636 1.8862 5.54303 1.88715Z' +
  'M4.1828 1.91166C3.99125 1.9216 3.8148 1.93577 3.65076 1.95353C3.01764 2.02212 2.65034 2.1506 2.37325 2.35179C2.16463 2.50337 1.98052 2.68747 1.82895 2.89609C1.62776 3.17318 1.49928 3.54048 1.43069 4.1736C1.36074 4.81967 1.36023 5.65896 1.36023 6.85014V9.14986C1.36023 10.341 1.36074 11.1803 1.43069 11.8264C1.49928 12.4595 1.62776 12.8268 1.82895 13.1039C1.98052 13.3125 2.16463 13.4966 2.37325 13.6482C2.65034 13.8494 3.01764 13.9779 3.65076 14.0465C3.81478 14.0642 3.99127 14.0774 4.1828 14.0873V1.91166Z' +
  '"/></svg>'

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
  const LOGO_LEFT = ${LOGO_LEFT_PLACEHOLDER} // Windows ≥0：logo 左缘；macOS -1：不注入（红绿灯区域）
  const LOGO_IMG = ${LOGO_IMG_PLACEHOLDER}
  const LOGO_ID = '__dsh_desktop_title_logo'
  // 会话导航箭头图标（chevron，参考用户图中红框内左右箭头形态）
  const ARROW_LEFT_SVG =
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3 5 8l5 5"/></svg>'
  const ARROW_RIGHT_SVG =
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg>'
  // 折叠按钮固定图标：与上游 IconPanelLeftOutline16 同字形（path 完整取自
  // dsh-client-ui-primitives 产物，viewBox 0 0 16 16 / fillRule evenodd /
  // currentColor），固定 16×16。不再克隆上游 svg——上游 panelIcon 随状态
  // 漂移尺寸（展开 size=16 / 折叠 rail spec size=18 / 宽屏 iconButton
  // 36px），克隆会把漂移带进按钮（折叠态图标变大的根因）；两态字形恒为
  // 同一 panel-left 矢量，静态内联与克隆视觉等价且尺寸恒定——与上下箭头
  // 同款做法（箭头自注入以来从未出过尺寸问题）。
  const TOGGLE_ICON_SVG = ${TOGGLE_ICON_PLACEHOLDER}

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
  const style = document.createElement('style')
  style.id = '__dsh_desktop_toggle_style'
  // 按钮选择器组：前缀/后缀必须应用到每个 id——直接用逗号组字符串
  // 拼 ' svg'/':hover' 只会作用于最后一个选择器（#A,#B,#C svg 实为
  // #A、#B、#C svg 三个选择器：svg 钳制直接命中前两个按钮本体，把它们
  // 压成 16×16 + display:block；深色前缀同坑，箭头逃出作用域颜色不变；
  // hover 同理只有末位按钮有反馈）
  const btnSel = (prefix, suffix) => [BTN_ID, PREV_ID, NEXT_ID].map((id) => prefix + '#' + id + suffix).join(',')
  const rules = [
    '[class*="logoRow"] button[class*="toggle"]:not(:has([class*="railMark"])){display:none !important}',
    btnSel('', '') + '{all:unset;box-sizing:border-box;position:absolute;top:50%;transform:translateY(-50%);display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;cursor:pointer;color:rgba(26,29,33,.65);-webkit-app-region:no-drag;transition:background .15s ease}',
    // 图标尺寸钳制（双保险）：三枚按钮内 svg 一律 16×16——折叠按钮已改静态
    // 图标（恒 16px），此规则同时兜住两枚箭头与任何未来注入内容；!important
    // + max-* 击败属性与内联 style，与状态栏右端代理按钮图标同级。
    btnSel('', ' svg') + '{width:16px !important;height:16px !important;max-width:16px;max-height:16px;display:block;flex:none}',
    '#' + BTN_ID + '{left:' + BTN_LEFT + 'px}',
    '#' + PREV_ID + '{left:' + PREV_LEFT + 'px}',
    '#' + NEXT_ID + '{left:' + NEXT_LEFT + 'px}',
    btnSel('body[data-ds-dark-theme] ', '') + '{color:rgba(232,234,237,.8)}',
    btnSel('', ':hover') + '{background:color-mix(in srgb,currentColor 10%,transparent)}',
    btnSel('', ':active') + '{background:color-mix(in srgb,currentColor 18%,transparent)}',
  ]
  // Windows：K logo 样式（24px，与 rail 态 K 同尺寸，垂直居中与按钮同
  // 款 top:50%）；纯装饰 pointer-events:none——点击穿透到 bar 的拖拽
  // 区，logo 区域拖动即拖动窗口；-webkit-user-drag 禁原生图片拖拽鬼影。
  // macOS 不注入此规则（LOGO_LEFT=-1，红绿灯区域零接触）。
  if (LOGO_LEFT >= 0) {
    rules.push('#' + LOGO_ID + '{position:absolute;left:' + LOGO_LEFT + 'px;top:50%;transform:translateY(-50%);width:24px;height:24px;pointer-events:none;user-select:none;-webkit-user-drag:none}')
  }
  style.textContent = rules.join('')
  document.head.append(style)

  const bar = () => document.getElementById('__dsh_desktop_titlebar')

  // 图标/语义同步：折叠按钮图标为静态内联（注入时一次写入，见 mkBtn
  // 调用），sync 只同步 aria-label/title——绝不能在此回写 innerHTML：
  // TOGGLE_ICON_SVG 的 path 是自闭合写法，innerHTML 写入后读回为展开
  // 形态（<path></path>），「读回 !== 源串」恒真；而本注入器的自愈
  // observer 监听 body childList，innerHTML 赋值（删子树+重建）必然
  // 触发变更记录 → sync 再写 → 再触发 → 无限微任务风暴，主线程 100%
  // 冻结（0.15.0 当晚的渲染进程卡死根因；克隆时代无此问题：插件
  // svg 是展开形态、往返相等收敛）。aria-label/title 语义仍从上游
  // toggle 实时同步（展开=收起侧边栏 / 折叠=展开侧边栏）。
  const sync = () => {
    const t = toggleEl()
    const btn = document.getElementById(BTN_ID)
    if (t === null || btn === null) return
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
    // Windows：K logo 先于按钮注入（macOS LOGO_LEFT=-1 跳过；bar 为
    // 自注入元素非 React 持有，注入后无需 observer 自愈）
    if (LOGO_LEFT >= 0 && document.getElementById(LOGO_ID) === null) {
      const logo = document.createElement('img')
      logo.id = LOGO_ID
      logo.src = LOGO_IMG
      logo.alt = ''
      logo.draggable = false
      host.append(logo)
    }
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
    mkBtn(BTN_ID, '', TOGGLE_ICON_SVG, () => {
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
  // 折叠按钮 x≈84 → 左箭头 x≈128 → 右箭头 x≈174），无 logo——红绿灯
  // 区域 12~64px 不可侵占；Windows：最左 K logo（12px 起，24px 宽 +
  // 间距 8），按钮带右移（折叠 44 / 左箭头 78 / 右箭头 112；
  // titleBarOverlay 控制按钮在右侧，左侧无冲突）。leftPad 与
  // theme-watcher 一致（darwin 78/win32 12）
  const leftPad = process.platform === 'win32' ? 12 : 78
  const logoLeft = process.platform === 'win32' ? 12 : -1
  const left = process.platform === 'win32' ? 44 : 84
  const prev = process.platform === 'win32' ? 78 : 128
  const next = process.platform === 'win32' ? 112 : 174
  const extra = next + 26 + 8 - leftPad // 最右（右箭头）右缘 + 间距 - leftPad
  const script = PAGE_JS
    .replaceAll(PLACEHOLDER, String(left))
    .replaceAll(ARROW_PREV_PLACEHOLDER, String(prev))
    .replaceAll(ARROW_NEXT_PLACEHOLDER, String(next))
    .replaceAll(EXTRA_PLACEHOLDER, String(extra))
    .replaceAll(LOGO_LEFT_PLACEHOLDER, String(logoLeft))
    .replaceAll(LOGO_IMG_PLACEHOLDER, JSON.stringify(logoDataUrl))
    .replaceAll(TOGGLE_ICON_PLACEHOLDER, JSON.stringify(TOGGLE_ICON_SVG))
  win.webContents.on('did-finish-load', () => {
    if (win.isDestroyed()) return
    win.webContents.executeJavaScript(script, true).catch(() => {
      // 页面跳转间隙执行失败属正常，下次加载会重试
    })
  })
}
