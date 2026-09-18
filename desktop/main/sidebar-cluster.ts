/**
 * 原生右侧栏开关代理（零侵入转发注入器）：原生 ui-sidebar-right 的开关
 * 按钮一个在会话头部角落（收起态 data-sidebar-right-expand，展开态不
 * 渲染）、一个在面板右上 chrome 条（展开态 data-sidebar-right-toggle），
 * 都不在 KCoder 自绘状态栏里——与自绘状态栏（z 最高、48px）不在同一
 * 视觉序列。因此沿用 sidebar-toggle / 旧 coding-sidebar 开关簇代理
 * （2026-09-18 退役）同款手法：
 *
 * - 状态栏右侧按钮序列末尾注入一枚 KCoder 同款代理按钮（right 12，
 *   原侧栏面板代理位）；点击转发给原生真实按钮（React 合成事件照常）；
 * - 转发目标按存在性二选一：展开态优先 [data-sidebar-right-toggle]
 *   （toggleExpanded 收起），收起态回落 [data-sidebar-right-expand]
 *   （setExpanded 展开）；
 * - disabled / aria-label / 图标实时同步自当前目标；目标缺席（无会话
 *   态等）→ 代理按钮隐藏，不残留死按钮；
 * - 会话头部的原生展开按钮隐藏（display:none，代理接管其可见语义）；
 *   面板 chrome 条内的收起按钮保留（面板自身 UI 的一部分）。
 *
 * 代理缺席的平台（Linux 无自绘状态栏，本注入器不注入）→ 页面内原生
 * 按钮原样保留，功能不受损。
 *
 * 上游契约（全部运行时探测，data-* 属性是上游稳定 API 面；CSS modules
 * 导出名稳定、哈希前缀随版本漂移不影响）：
 * - 展开态：面板 chrome 条 `[data-sidebar-right-toggle]`（SidebarRight.tsx
 *   PanelChrome，actions.toggleExpanded）；
 * - 收起态：会话头角落 `[data-sidebar-right-expand]`（ExpandButton.tsx，
 *   仅收起态渲染，actions.setExpanded(true)）；
 * - 按钮宿主：theme-watcher 注入的自绘状态栏（#__dsh_desktop_titlebar）。
 *
 * 历史：本注入器原服务于 dsh-coding-sidebar 的开关簇收纳与底面板压制
 * 看门狗（[data-dsh-panel-host] / [class*="toggleCluster"] /
 * [class*="bottomPanel"] 契约）——插件已于 2026-09-18 退役（右侧栏回归
 * 原生），看门狗随簇契约一并拆除。
 *
 * right 序：侧栏面板 12（本注入器）/ 内嵌终端 44（dsh-terminal 按钮）/
 * 上下文 76（context-button）；标题避让带同步见 theme-watcher。
 *
 * 宿主时序不保证：bar 由 theme-watcher 注入（同 did-finish-load，
 * 本注入器注册在其后），轮询等待 bar 存在（与 sidebar-toggle 同款）。
 *
 * @module desktop/main/sidebar-cluster
 */
import type { BrowserWindow } from 'electron'

/** 代理按钮：右侧面板开合（原生侧栏开关代理）。 */
const PANEL_BTN_ID = '__dsh_desktop_sidebar_panel_btn'

/** 代理按钮右缘 right 偏移（DIP，全局 right 序：侧栏面板 12（本注入器）/
 * 内嵌终端 44（dsh-terminal 按钮）/ 上下文 76（context-button）。 */
const PANEL_BTN_RIGHT = 12

const PAGE_JS = `(() => {
  if (window.__dshSidebarClusterWired) return
  window.__dshSidebarClusterWired = true
  const PANEL_BTN = '${PANEL_BTN_ID}'
  const bar = () => document.getElementById('__dsh_desktop_titlebar')
  // 原生开关二锚点（data-* 是上游稳定 API 面）：展开态面板内 toggle
  // 优先（语义 = 收起），收起态会话头 expand 回落（语义 = 展开）
  const nativeBtn = () =>
    document.querySelector('[data-sidebar-right-toggle]') ??
    document.querySelector('[data-sidebar-right-expand]')

  const style = document.createElement('style')
  style.id = '__dsh_desktop_sidebar_cluster_style'
  style.textContent = [
    // 会话头部原生展开按钮隐藏（代理接管；代理缺席的平台 Linux 不注入本样式）
    '[data-sidebar-right-expand]{display:none !important}',
    '#' + PANEL_BTN + '{all:unset;box-sizing:border-box;position:absolute;right:${PANEL_BTN_RIGHT}px;top:50%;transform:translateY(-50%);display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;cursor:pointer;color:rgba(26,29,33,.65);-webkit-app-region:no-drag;transition:background .15s ease}',
    // 图标统一 clamp：克隆原生按钮 svg 时压到 16px，与侧边栏顶部
    // 三枚按钮（sidebar-toggle）同级，避免大图标撑大代理按钮、两处不一致。
    '#' + PANEL_BTN + ' svg{width:16px;height:16px;display:block;flex:none}',
    'body[data-ds-dark-theme] #' + PANEL_BTN + '{color:rgba(232,234,237,.8)}',
    '#' + PANEL_BTN + ':hover:not(:disabled){background:color-mix(in srgb,currentColor 10%,transparent)}',
    '#' + PANEL_BTN + ':active:not(:disabled){background:color-mix(in srgb,currentColor 18%,transparent)}',
    '#' + PANEL_BTN + ':disabled{opacity:.4;cursor:default}',
  ].join('')
  document.head.append(style)

  // 单枚代理同步：缺席隐藏；disabled / aria-label / 图标克隆原生按钮
  const syncOne = (proxy, src) => {
    if (proxy == null) return
    if (src == null) {
      if (proxy.style.display !== 'none') proxy.style.display = 'none'
      return
    }
    if (proxy.style.display === 'none') proxy.style.display = ''
    if (proxy.disabled !== src.disabled) proxy.disabled = src.disabled
    const label = src.getAttribute('aria-label') || ''
    if (label !== '' && proxy.title !== label) {
      proxy.title = label
      proxy.setAttribute('aria-label', label)
    }
    const svg = src.querySelector('svg')
    const box = proxy.firstElementChild
    if (svg != null && box != null && box.innerHTML !== svg.outerHTML) {
      box.innerHTML = svg.outerHTML
    }
  }
  const sync = () => {
    syncOne(document.getElementById(PANEL_BTN), nativeBtn())
  }

  const injectBtns = () => {
    if (document.getElementById(PANEL_BTN) != null) return 'present'
    const host = bar()
    if (host == null) return 'absent'
    const b = document.createElement('button')
    b.type = 'button'
    b.id = PANEL_BTN
    b.style.display = 'none' // 原生按钮出现前隐藏（sync 负责点亮）
    const box = document.createElement('span')
    box.style.cssText = 'display:inline-flex;align-items:center;justify-content:center'
    b.append(box)
    b.addEventListener('click', () => { nativeBtn()?.click() })
    host.append(b)
    sync()
    return 'injected'
  }

  let tries = 0
  const poll = setInterval(() => {
    const status = injectBtns()
    sync()
    if (status !== 'absent' || ++tries > 120) clearInterval(poll)
  }, 500)

  // 自愈：原生按钮重挂（React 重建）/ 按钮态变化后重新同步
  new MutationObserver(sync)
    .observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'aria-label'] })
})()`

/**
 * 把开关代理注入器挂到 shell 窗口：
 * 仅 darwin/win32（自绘状态栏存在的平台；Linux 无状态栏，原生展开
 * 按钮原样显示且代理不注入——功能不受损）；did-finish-load 注入
 * （每次导航后重新注入，脚本自幂等）。
 */
export function attachSidebarCluster(win: BrowserWindow): void {
  if (process.platform !== 'darwin' && process.platform !== 'win32') return
  win.webContents.on('did-finish-load', () => {
    if (win.isDestroyed()) return
    win.webContents.executeJavaScript(PAGE_JS, true).catch(() => {
      // 页面跳转间隙执行失败属正常，下次加载会重试
    })
  })
}
