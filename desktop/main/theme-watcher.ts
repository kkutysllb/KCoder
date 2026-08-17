/**
 * 主题跟随：上游 Web UI 的主题切换 → Electron 原生外观自适应。
 *
 * 上游契约（packages/client/ui-theme/src/client/index.ts）：
 * - 深色时 `body` 带 `data-ds-dark-theme` 属性（官方注释：以该字段为准，
 *   "body[data-ds-dark-theme] from this field — never from the id"）；
 * - 同时 `documentElement.style.colorScheme = 'dark' | 'light'`；
 * - 偏好（light/dark/system）持久化在 dsh 服务端 settings（~/.dsh），
 *   随机端口不丢偏好。
 *
 * 桌面端链路（shell 窗口是纯浏览器载体，无 preload）：
 * 1. 注入观察脚本（MutationObserver）监听上述两处 DOM 变化；
 * 2. 通过 console 通道 `__dsh_theme__:<dark|light>` 回传主进程
 *    （webContents console-message 事件，CSP 不影响，零导航开销）；
 * 3. 主进程 `nativeTheme.themeSource` 同步 → 原生标题栏/红绿灯区域、
 *    菜单栏、Dock 与桌面端面板（prefers-color-scheme）全部自适应；
 * 4. 最后已知渲染主题持久化到 store，下次启动预置，避免首帧闪烁。
 *
 * @module desktop/main/theme-watcher
 */

import { EventEmitter } from 'node:events'
import { nativeTheme, type BrowserWindow } from 'electron'
import { consoleMessageText } from './console-channel'
import { getSettings, saveSettings } from './store'

/** console 通道前缀（与注入脚本约定）。 */
const THEME_PREFIX = '__dsh_theme__:'

/**
 * macOS 标题栏高度（Window Controls Overlay 覆盖条）。
 * 48px：容纳四枚 26px 图标按钮与标题的宽松状态栏；页面注入等高
 * padding 下移，保证上游 UI 不被覆盖条遮挡（终端/预览面板 bounds
 * 不消费此高度：终端贴底、预览全高，按钮 top:50% 自居中）。
 */
export const SHELL_TITLEBAR_HEIGHT = 48

/**
 * 注入脚本（页面上下文）：观察上游主题在 DOM 上的落点并上报。
 * 首次立即上报当前状态；之后任何变化（偏好切换/系统翻转）都会触发。
 */
const WATCH_JS = `(() => {
  if (window.__dshThemeWatched) return
  window.__dshThemeWatched = true
  const report = () => {
    const dark = document.body === null
      ? document.documentElement.style.colorScheme === 'dark'
      : document.body.hasAttribute('data-ds-dark-theme')
        || document.documentElement.style.colorScheme === 'dark'
    console.log('__dsh_theme__:' + (dark ? 'dark' : 'light'))
  }
  new MutationObserver(report).observe(document.documentElement, {
    attributes: true, attributeFilter: ['style'],
  })
  const watchBody = () => {
    if (document.body !== null) {
      new MutationObserver(report).observe(document.body, {
        attributes: true, attributeFilter: ['data-ds-dark-theme'],
      })
      report()
    } else {
      requestAnimationFrame(watchBody)
    }
  }
  watchBody()
})()`

/** 当前应使用的原生外观（启动时 = 上次已知渲染主题）。 */
export function currentThemePref(): 'system' | 'light' | 'dark' {
  return getSettings().lastTheme
}

/** 主题变化事件面（终端面板等跟随原生外观的组件订阅）。 */
export const themeEvents = new EventEmitter()

/** 应用原生主题：themeSource + 持久化（变化才写盘）。 */
export function applyNativeTheme(pref: 'system' | 'light' | 'dark'): void {
  nativeTheme.themeSource = pref
  if (getSettings().lastTheme !== pref) saveSettings({ lastTheme: pref })
  themeEvents.emit('theme-changed', pref)
}

/**
 * 把主题观察器挂到 shell 窗口：
 * - did-finish-load 注入观察脚本（每次导航后重新注入，脚本自幂等）；
 * - console-message 过滤通道前缀 → 同步 nativeTheme。
 */
export function attachThemeWatcher(win: BrowserWindow): void {
  const { webContents } = win
  const onConsole = (event: unknown, ...rest: unknown[]): void => {
    const message = consoleMessageText(event, rest)
    if (!message.startsWith(THEME_PREFIX)) return
    const value = message.slice(THEME_PREFIX.length)
    if (value === 'dark' || value === 'light') {
      applyNativeTheme(value)
      applyShellChromeTheme(win, value)
    }
  }
  const onDidLoad = (): void => {
    if (win.isDestroyed()) return
    // 自绘标题栏 + 页面下移仅 darwin（titleBarStyle:'hidden' 只在 mac
    // 启用，其余平台保留系统标题栏，注入会造成双标题栏）；
    // 上游 html/body/#root 均 height:100%，padding 下移不溢出
    if (process.platform === 'darwin') {
      webContents.executeJavaScript(SHELL_TITLEBAR_JS, true).catch(() => {})
    }
    webContents.executeJavaScript(WATCH_JS, true).catch(() => {
      // 页面跳转间隙执行失败属正常，下次加载会重试
    })
  }
  webContents.on('console-message', onConsole)
  webContents.on('did-finish-load', onDidLoad)
  win.once('closed', () => {
    webContents.removeListener('console-message', onConsole)
    webContents.removeListener('did-finish-load', onDidLoad)
  })
}

/**
 * 按主题给出标题栏/窗口底色（取上游精确 token：sidebar-fill）。
 * 标题栏左半下方是侧边栏、右半是对话区（bg-base，与 sidebar 仅差
 * Δ6，人眼不可辨）：
 * - 深：--dsw-static-neutral-bluish-900 = rgb(27,27,28)
 * - 浅：--dsw-static-neutral-bluish-50 = rgb(249,250,251)
 */
export function themeBackgroundColor(pref: 'system' | 'light' | 'dark' = getSettings().lastTheme): string {
  if (pref === 'light') return '#F9FAFB'
  if (pref === 'dark') return '#1B1B1C'
  return nativeTheme.shouldUseDarkColors ? '#1B1B1C' : '#F9FAFB'
}

/**
 * 自绘标题栏（页面上下文）：替代系统标题栏（WCO 覆盖条在 macOS 不渲染
 * 标题且双击缩放失效，故齐弃）。VS Code 同款方案：
 * - `-webkit-app-region: drag` 拖拽区 → 原生拖动与双击缩放；
 * - 靠左显示「工作区 / 会话标题」：主文本是 document.title（上游
 *   DocumentTitle 投射“会话标题 — 产品名”）；工作区前缀由预览抽屉
 *   注入器探测（workspace.list RPC + 会话配对）写入 --dsh-ws-name，
 *   apply() 读取拼接（preview-panel 与本脚本互不依赖，变量通道同
 *   --dsh-sidebar-w；style 变化会触发既有 observer 重渲染），
 *   起排在中间会话列左缘（侧边栏右边线 + 12px，探测 sidebarCol 实时
 *   广播为 --dsh-sidebar-w，拖宽/折叠动画平滑跟随；侧边栏收起时保底
 *   红绿灯区 78px）；max-width 自适应避让：右侧取按钮带（134px =
 *   四枚 26px 图标按钮：终端 12/预览 44/轨迹 76/日志 108px 序）与
 *   文件预览抽屉宽度（--dsh-preview-inset，抽屉是全高 WebContentsView、
 *   打开时盖住标题栏右段）之大者，长标题省略号截断不钻抽屉底下；
 * - 背景直接解析上游 token `--dsw-specific-sidebar-fill`（body 计算值），
 *   随上游主题切换实时正确，无需主进程回传；
 * - body 注入等高 padding，上游 UI 下移不被遮挡；
 * - 观察 title 变化与主题落点变化，幂等。与 WATCH_JS 共用观察点，
 *   各自独立上报互不干扰。
 */
const SHELL_TITLEBAR_JS = `(() => {
  const ID_BAR = '__dsh_desktop_titlebar'
  const ID_PAD = '__dsh_desktop_titlebar_pad'
  const H = ${SHELL_TITLEBAR_HEIGHT}
  if (document.getElementById(ID_BAR)) return
  const pad = document.createElement('style')
  pad.id = ID_PAD
  pad.textContent = 'body{padding-top:' + H + 'px;box-sizing:border-box}'
  document.head.append(pad)

  const bar = document.createElement('div')
  bar.id = ID_BAR
  bar.style.cssText = [
    'position:fixed', 'top:0', 'left:0', 'right:0', 'height:' + H + 'px',
    'z-index:2147483647',
    '-webkit-app-region:drag',
    'display:flex', 'align-items:center', 'justify-content:flex-start',
    'font:500 13px -apple-system,"PingFang SC","Segoe UI",sans-serif',
    'user-select:none',
  ].join(';')
  // 双段结构：工作区前缀（弱化色，含 " / " 分隔）+ 标题主体（省略号
  // 打在标题尾部；工作区自身过长独立截断）。flex 子项内 ellipsis 需
  // min-width:0；label 自身改 flex 容器后单行省略号下沉到子 span
  const label = document.createElement('span')
  label.style.cssText = [
    'flex:0 1 auto',
    'margin-left:max(78px, var(--dsh-sidebar-w, 0px) + 12px)',
    'max-width:calc(100% - max(78px, var(--dsh-sidebar-w, 0px) + 12px) - max(134px, var(--dsh-preview-inset, 0px)))',
    'display:flex', 'min-width:0', 'white-space:nowrap',
  ].join(';')
  const wsTag = document.createElement('span')
  wsTag.style.cssText = 'flex:none;max-width:170px;overflow:hidden;text-overflow:ellipsis;font-weight:400'
  const ttlTag = document.createElement('span')
  ttlTag.style.cssText = 'flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis'
  label.append(wsTag, ttlTag)
  bar.append(label)

  /* 侧边栏右边线探测：标题起排跟随（与终端/预览面板的 sidebarCol
     探针同款；SPA 首帧可能未挂，rAF 轮询等待）。宽度写为 CSS 变量，
     上面 margin/max-width 纯 CSS 消费，拖宽/折叠动画实时重算 */
  const watchSidebarCol = () => {
    const el = document.querySelector('[class*="sidebarCol"]')
    if (el == null) { requestAnimationFrame(watchSidebarCol); return }
    const push = () => {
      document.documentElement.style.setProperty(
        '--dsh-sidebar-w', Math.round(el.getBoundingClientRect().width) + 'px')
    }
    new ResizeObserver(push).observe(el)
    push()
  }
  watchSidebarCol()

  const apply = () => {
    let color = ''
    try { color = getComputedStyle(document.body).getPropertyValue('--dsw-specific-sidebar-fill').trim() } catch {}
    const dark = document.body.hasAttribute('data-ds-dark-theme')
      || document.documentElement.style.colorScheme === 'dark'
    bar.style.background = color || (dark ? '#1B1B1C' : '#F9FAFB')
    label.style.color = dark ? 'rgba(232,234,237,.9)' : 'rgba(26,29,33,.75)'
    wsTag.style.color = dark ? 'rgba(232,234,237,.45)' : 'rgba(26,29,33,.42)'
    let ws = ''
    try { ws = getComputedStyle(document.documentElement).getPropertyValue('--dsh-ws-name').trim() } catch {}
    wsTag.textContent = ws !== '' ? ws + ' / ' : ''
    ttlTag.textContent = (document.title || '').trim() || 'KCoder'
  }
  const mount = () => {
    document.body.append(bar)
    apply()
    new MutationObserver(apply).observe(document.documentElement, {
      attributes: true, attributeFilter: ['style'],
    })
    new MutationObserver(apply).observe(document.body, {
      attributes: true, attributeFilter: ['data-ds-dark-theme'],
    })
    const titleEl = document.querySelector('title')
    if (titleEl) new MutationObserver(apply).observe(titleEl, {
      childList: true, characterData: true, subtree: true,
    })
  }
  if (document.body) mount()
  else document.addEventListener('DOMContentLoaded', mount, { once: true })
})()`

/**
 * 同步 shell 窗口的窗口底色（加载间隙不闪色）。标题栏颜色由注入的
 * 自绘标题栏直接解析上游 token，不经过主进程。
 */
export function applyShellChromeTheme(win: BrowserWindow, pref: 'system' | 'light' | 'dark'): void {
  if (win.isDestroyed()) return
  win.setBackgroundColor(themeBackgroundColor(pref))
}
