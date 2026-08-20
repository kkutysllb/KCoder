/**
 * better-sidebar 开关簇收纳（零侵入代理注入器）：插件右上角的开关簇
 * （fixed 宿主层内 absolute，z-45）与 KCoder 自绘状态栏（z 最高、48px）
 * 在同一区域叠死，且层级被状态栏物理盖住——纯 CSS 挪位进状态栏不可行。
 * 因此与 sidebar-toggle（上游折叠按钮迁移）同构：
 *
 * - 隐藏插件开关簇本体（CSS，display:none 兑底）；
 * - 状态栏右侧按钮序列末尾注入两枚 KCoder 同款代理按钮（图标克隆
 *   插件按钮 svg，语义 = 插件底部面板 / 右侧面板的开合）；
 * - 点击转发插件真实按钮（React 合成事件照常，开关状态、面板动画
 *   全部由插件驱动）；disabled / aria-label / 图标实时同步；
 * - 插件缺席（未装/禁用/host 未挂载）→ 代理按钮隐藏，不残留死按钮；
 *   无会话（noSession）→ 插件按钮 disabled，代理同步置灰。
 *
 * 上游契约（全部运行时探测，哈希前缀无关）：
 * - 开关簇宿主 `[data-dsh-panel-host]`（插件 fixed 覆盖层，data 属性
 *   是插件的稳定 API 面）；簇 `[class*="toggleCluster"]`、按钮
 *   `[class*="toggleButton"]`（CSS modules 导出名稳定，哈希前缀随
 *   版本漂移不影响 `[class*=…]` 匹配）；
 * - 簇内按钮顺序：底部面板在前、右侧面板在后（宽屏两枚；窄屏
 *   ≤767px 只渲染右侧面板一枚——取最后一枚恒为右侧面板，首枚仅在
 *   枚举 ≥2 时作底部面板，两平台语义皆稳）；
 * - 按钮宿主：theme-watcher 注入的自绘状态栏（#__dsh_desktop_titlebar）。
 *
 * right 序（预览/轨迹/日志/git 四钮已删除，仅剩本注入器两枚代理）：
 * 侧栏面板 12 / 底部面板 44；标题避让带同步见 theme-watcher。
 *
 * 宿主时序不保证：bar 由 theme-watcher 注入（同 did-finish-load，
 * 本注入器注册在其后），轮询等待 bar 存在（与 sidebar-toggle 同款）。
 *
 * @module desktop/main/sidebar-cluster
 */
import type { BrowserWindow } from 'electron'

/** 代理按钮：右侧面板开合（插件主开关）。 */
const PANEL_BTN_ID = '__dsh_desktop_sidebar_panel_btn'

/** 代理按钮：底部面板开合。 */
const BOTTOM_BTN_ID = '__dsh_desktop_sidebar_bottom_btn'

/** 代理按钮右缘 right 偏移（DIP，全局 right 序：侧栏面板 12 / 底部面板 44
 * ——状态栏仅剩这两枚，四枚自研面板钮已随面板删除）。 */
const PANEL_BTN_RIGHT = 12
const BOTTOM_BTN_RIGHT = 44

const PAGE_JS = `(() => {
  if (window.__dshSidebarClusterWired) return
  window.__dshSidebarClusterWired = true
  const PANEL_BTN = '${PANEL_BTN_ID}'
  const BOTTOM_BTN = '${BOTTOM_BTN_ID}'
  const bar = () => document.getElementById('__dsh_desktop_titlebar')
  // 插件开关簇与按钮（CSS modules 导出名稳定，哈希前缀无关）
  const cluster = () => document.querySelector('[data-dsh-panel-host] [class*="toggleCluster"]')
  const pluginBtns = () => Array.from(cluster()?.querySelectorAll('button[class*="toggleButton"]') ?? [])
  // 语义映射：最后一枚恒为右侧面板（窄屏唯一一枚也是它）；首枚仅在
  // 枚举 ≥2 时是底部面板（宽屏顺序：底部在前、右侧在后）
  const panelSrc = () => { const b = pluginBtns(); return b.length > 0 ? b[b.length - 1] : null }
  const bottomSrc = () => { const b = pluginBtns(); return b.length >= 2 ? b[0] : null }

  const style = document.createElement('style')
  style.id = '__dsh_desktop_sidebar_cluster_style'
  const BTN_CSS = '#' + [PANEL_BTN, BOTTOM_BTN].join(',#')
  style.textContent = [
    // 隐藏插件开关簇本体（代理接管；代理缺席的平台 Linux 不注入本样式）
    '[data-dsh-panel-host] [class*="toggleCluster"]{display:none !important}',
    BTN_CSS + '{all:unset;box-sizing:border-box;position:absolute;top:50%;transform:translateY(-50%);display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;cursor:pointer;color:rgba(26,29,33,.65);-webkit-app-region:no-drag;transition:background .15s ease}',
    '#' + PANEL_BTN + '{right:${PANEL_BTN_RIGHT}px}',
    '#' + BOTTOM_BTN + '{right:${BOTTOM_BTN_RIGHT}px}',
    'body[data-ds-dark-theme] ' + BTN_CSS + '{color:rgba(232,234,237,.8)}',
    BTN_CSS + ':hover:not(:disabled){background:color-mix(in srgb,currentColor 10%,transparent)}',
    BTN_CSS + ':active:not(:disabled){background:color-mix(in srgb,currentColor 18%,transparent)}',
    BTN_CSS + ':disabled{opacity:.4;cursor:default}',
  ].join('')
  document.head.append(style)

  // 单枚代理同步：缺席隐藏；disabled / aria-label / 图标克隆插件按钮
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
    syncOne(document.getElementById(PANEL_BTN), panelSrc())
    syncOne(document.getElementById(BOTTOM_BTN), bottomSrc())
  }

  const injectBtns = () => {
    if (document.getElementById(BOTTOM_BTN) != null) return 'present'
    const host = bar()
    if (host == null) return 'absent'
    const mkBtn = (id, srcOf) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.id = id
      b.style.display = 'none' // 插件簇出现前隐藏（sync 负责点亮）
      const box = document.createElement('span')
      box.style.cssText = 'display:inline-flex;align-items:center;justify-content:center'
      b.append(box)
      b.addEventListener('click', () => { srcOf()?.click() })
      host.append(b)
    }
    mkBtn(PANEL_BTN, panelSrc)
    mkBtn(BOTTOM_BTN, bottomSrc)
    sync()
    return 'injected'
  }

  let tries = 0
  const poll = setInterval(() => {
    const status = injectBtns()
    sync()
    if (status !== 'absent' || ++tries > 120) clearInterval(poll)
  }, 500)

  // 自愈：插件重挂开关簇（React 重建）/ 按钮态变化后重新同步
  new MutationObserver(sync)
    .observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'aria-label'] })
})()`

/**
 * 把开关簇收纳注入器挂到 shell 窗口：
 * 仅 darwin/win32（自绘状态栏存在的平台；Linux 无状态栏，插件开关簇
 * 原样显示）；did-finish-load 注入（每次导航后重新注入，脚本自幂等）。
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
