/**
 * coding-sidebar 开关簇代理（零侵入转发注入器）。
 *
 * 为什么必须代理而不能纯 CSS 搬家：插件开关簇在**它自己的宿主层**里
 *（data-dsh-panel-host，fixed 覆盖层，z-25 一带），子元素 z-index 再高
 * 也逃不出父级 stacking context——2026-09-19 实测：给簇 `position:fixed;
 * top:24px; z-index:2147483900` 仍被自绘标题栏（z 2147483647）物理盖住，
 * 点击落在标题栏上。整层抬 z 则会连面板一起压过标题栏（标题栏按钮被盖），
 * 不可取。
 *
 * 因此沿用 sidebar-toggle（上游折叠按钮迁移）同款手法：
 * - 隐藏插件开关簇本体（CSS display:none 兜底）；
 * - 自绘标题栏右侧按钮序列首格（right 12，终端 44 / 上下文 76 / 编辑器
 *   108 之前）注入一枚 KCoder 同款代理按钮，图标与语义克隆插件按钮；
 * - 点击转发插件真实按钮（display:none 不影响 HTMLElement.click() 派发，
 *   React 合成事件照常）——开关状态、面板动画、持久化全部由插件驱动；
 * - disabled / aria-label / 图标实时同步；插件缺席（未装/禁用/host 未挂
 *   载）→ 代理隐藏，不残留死按钮；无会话 → 插件按钮 disabled（插件语义：
 *   「选择一个会话以使用侧边栏」），代理同步置灰。
 *
 * 历史：本注入器 09-18 曾改写为「原生右侧栏开关代理」（插件退役期），
 * 09-19 插件 un-retire 后恢复为本职（代理插件簇）；原生外壳改由
 * style-overlay 的 NATIVE_SIDEBAR_CSS 压制。
 *
 * 本注入器是「产品铁律 1：不使用上游原生侧边栏功能」的执行点之一
 * （docs/ARCHITECTURE.md §12）：开关永远转发**插件自己的**按钮，上游若
 * 改动原生侧栏开关契约，不在本文件为它加分支。
 *
 * 代理缺席的平台（Linux 无自绘标题栏，本注入器不注入）→ 插件簇原样保留，
 * 功能不受损（仅位置在 web 落点）。
 *
 * 上游契约（全部运行时探测）：插件簇 `[data-dsh-toggle-cluster]`（插件
 * 自己的稳定 data 属性，两个渲染分支——无会话占位与常规——都带）；
 * 按钮 `[class*="toggleButton"]`（CSS modules 导出名稳定，哈希前缀随版本
 * 漂移不影响子串匹配；1.0.19 起簇内恒一枚，取唯一一枚即可）。
 *
 * right 序：侧栏面板 12（本注入器）/ 终端 44（dsh-terminal client）/
 * 上下文 76（context-button）/ 本地编辑器 108（open-in-app-button）；
 * Windows 原生控制按钮区的 +138 平移见 panel-buttons。
 *
 * 宿主时序不保证：bar 由 theme-watcher 注入（同 did-finish-load，本注入器
 * 注册在其后），轮询等待 bar 存在（与 sidebar-toggle 同款）。
 *
 * @module desktop/main/sidebar-cluster
 */
import type { BrowserWindow } from 'electron'

/** 代理按钮：右侧面板开合（插件主开关）。 */
const PANEL_BTN_ID = '__dsh_desktop_sidebar_panel_btn'

/** 代理按钮右缘 right 偏移（DIP）。 */
const PANEL_BTN_RIGHT = 12

const PAGE_JS = `(() => {
  if (window.__dshSidebarClusterWired) return
  window.__dshSidebarClusterWired = true
  const PANEL_BTN = '${PANEL_BTN_ID}'
  const bar = () => document.getElementById('__dsh_desktop_titlebar')
  // 插件开关簇（data 属性是插件自己的稳定锚）与簇内按钮
  const cluster = () => document.querySelector('[data-dsh-toggle-cluster]')
  const panelSrc = () => cluster()?.querySelector('button[class*="toggleButton"]') ?? null

  const style = document.createElement('style')
  style.id = '__dsh_desktop_sidebar_cluster_style'
  style.textContent = [
    // 隐藏插件开关簇本体（代理接管；代理缺席的平台不注入本样式）
    '[data-dsh-toggle-cluster]{display:none !important}',
    '#' + PANEL_BTN + '{all:unset;box-sizing:border-box;position:absolute;right:${PANEL_BTN_RIGHT}px;top:50%;transform:translateY(-50%);display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;cursor:pointer;color:rgba(26,29,33,.65);-webkit-app-region:no-drag;transition:background .15s ease}',
    '#' + PANEL_BTN + ' svg{width:16px;height:16px;display:block;flex:none}',
    'body[data-ds-dark-theme] #' + PANEL_BTN + '{color:rgba(232,234,237,.8)}',
    '#' + PANEL_BTN + ':hover:not(:disabled){background:color-mix(in srgb,currentColor 10%,transparent)}',
    '#' + PANEL_BTN + ':active:not(:disabled){background:color-mix(in srgb,currentColor 18%,transparent)}',
    '#' + PANEL_BTN + ':disabled{opacity:.4;cursor:default}',
  ].join('')
  document.head.append(style)

  // 代理同步：缺席隐藏；disabled / aria-label / 图标克隆插件按钮
  const syncOne = (proxy, src) => {
    if (proxy == null) return
    if (src == null) {
      if (proxy.style.display !== 'none') proxy.style.display = 'none'
      return
    }
    if (proxy.style.display === 'none') proxy.style.display = ''
    // 无会话时插件渲染的是 aria-disabled 占位（无 onClick），代理必须一并
    // 置灰——只镜像 disabled 属性会留下一枚"看着能点、点了没反应"的死按钮
    const off = src.disabled === true || src.getAttribute('aria-disabled') === 'true'
    if (proxy.disabled !== off) proxy.disabled = off
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
  const sync = () => { syncOne(document.getElementById(PANEL_BTN), panelSrc()) }

  const injectBtn = () => {
    if (document.getElementById(PANEL_BTN) != null) return 'present'
    const host = bar()
    if (host == null) return 'absent'
    const b = document.createElement('button')
    b.type = 'button'
    b.id = PANEL_BTN
    b.style.display = 'none' // 插件簇出现前隐藏（sync 负责点亮）
    const box = document.createElement('span')
    box.style.cssText = 'display:inline-flex;align-items:center;justify-content:center'
    b.append(box)
    b.addEventListener('click', () => { panelSrc()?.click() })
    host.append(b)
    sync()
    return 'injected'
  }

  let tries = 0
  const poll = setInterval(() => {
    const status = injectBtn()
    sync()
    if (status !== 'absent' || ++tries > 120) clearInterval(poll)
  }, 500)

  // 自愈：插件簇重挂（React 重建）/ 开关态变化（图标与 aria-label 换向）
  // 后重新同步；attributes 监听到 disabled 与 aria-label 两类即可覆盖
  // 插件的全部可见状态。
  new MutationObserver(sync)
    .observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'aria-label'] })
})()`

/**
 * 把代理注入器挂到 shell 窗口：仅 darwin/win32（自绘标题栏存在的平台；
 * Linux 无标题栏，插件簇原样保留、代理不注入——功能不受损）；
 * did-finish-load 注入（每次导航后重新注入，脚本自幂等）。
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
