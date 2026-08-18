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
import { nativeTheme, shell, type BrowserWindow } from 'electron'
import { consoleMessageText } from './console-channel'
import { getSettings, saveSettings } from './store'

/** console 通道前缀（与注入脚本约定）。 */
const THEME_PREFIX = '__dsh_theme__:'
/** 工作区按钮上行通道（打开工作区目录）。 */
const WS_PREFIX = '__dsh_ws__:'

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
    if (message.startsWith(THEME_PREFIX)) {
      const value = message.slice(THEME_PREFIX.length)
      if (value === 'dark' || value === 'light') {
        applyNativeTheme(value)
        applyShellChromeTheme(win, value)
      }
      return
    }
    // 工作区按钮：打开工作区目录（Finder/资源管理器；路径来自预览
    // 抽屉注入器写入的 --dsh-ws-path，非任意输入）
    if (message.startsWith(WS_PREFIX)) {
      try {
        const payload = JSON.parse(message.slice(WS_PREFIX.length)) as { action?: unknown; path?: unknown }
        if (payload.action === 'reveal' && typeof payload.path === 'string' && payload.path !== '') {
          void shell.openPath(payload.path)
        }
      } catch { /* 非 JSON 忽略 */ }
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
 * - 靠左显示「工作区 / 会话标题 〔预设〕」：主文本是 document.title
 *   （上游 DocumentTitle 投射“会话标题 — 产品名”）；工作区前缀由预览
 *   抽屉注入器探测（workspace.list RPC + 会话配对）写入 --dsh-ws-name，
 *   并做成实体按钮（文件夹图标，点击打开工作区目录；路径读
 *   --dsh-ws-path，上报 __dsh_ws__ 通道由主进程 shell.openPath 执行），
 *   agent 预设徽章读 --dsh-agent-preset（workspace-header 读取被收纳
 *   的 AgentPresetLabel 文本写入）；两变量均由 apply() 读取拼接
 *   （写入方与本脚本互不依赖，通道同 --dsh-sidebar-w；style 变化
 *   会触发既有 observer 重渲染），
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
    'max-width:calc(100% - max(78px, var(--dsh-sidebar-w, 0px) + 12px) - max(134px, calc(var(--dsh-preview-inset, 0px) + var(--dsh-git-inset, 0px))))',
    'display:flex', 'align-items:center', 'min-width:0', 'white-space:nowrap',
  ].join(';')
  // 工作区段：实体按钮（文件夹图标 + 名字；点击打开工作区目录）。
  // no-drag 使拖拽区内的点击可达；hover 靠下方注入的 style 规则
  const wsBtn = document.createElement('button')
  wsBtn.id = '__dsh_ws_btn'
  wsBtn.style.cssText = [
    'all:unset', 'box-sizing:border-box', 'flex:none', 'display:inline-flex', 'align-items:center', 'gap:5px',
    'max-width:240px', 'min-width:0', 'padding:3px 7px', 'border-radius:7px',
    'cursor:pointer', '-webkit-app-region:no-drag',
  ].join(';')
  const wsIco = document.createElement('span')
  wsIco.style.cssText = 'flex:none;display:inline-flex;width:16px;height:16px'
  wsIco.innerHTML = '<svg viewBox="0 0 16 16" fill="none"><path d="M1.8 4.4c0-.7.6-1.3 1.3-1.3h2.8c.4 0 .8.2 1 .5l1 1.1h3.9c.7 0 1.3.6 1.3 1.3v5.6c0 .7-.6 1.3-1.3 1.3H3.1c-.7 0-1.3-.6-1.3-1.3V4.4Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>'
  const wsName = document.createElement('span')
  wsName.style.cssText = 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:400;line-height:1;display:block'
  wsBtn.append(wsIco, wsName)
  const wsSep = document.createElement('span')
  wsSep.style.cssText = 'flex:none;font-weight:400'
  wsSep.textContent = ' / '
  // 点击 → 上报主进程打开目录（路径在 apply() 从 --dsh-ws-path 刷进 dataset）
  wsBtn.onclick = () => {
    const p = wsBtn.dataset.path || ''
    if (p === '') return
    console.log('__dsh_ws__:' + JSON.stringify({ action: 'reveal', path: p }))
  }
  const ttlTag = document.createElement('span')
  ttlTag.style.cssText = 'flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis'
  // agent 预设标记：小徽章（上游 AgentPresetLabel 本显示在会话标题旁，
  // 随顶栏收纳迁到这里；workspace-header 读 headerActions 写变量）。
  // inline-flex + line-height:1：文本 10px 但行盒继承 13px 字号的
  // normal 行高，不压行盒则文本在徽章内偏上、徽章在标题行里偏移
  const presetTag = document.createElement('span')
  presetTag.style.cssText = 'flex:none;display:inline-flex;align-items:center;line-height:1;max-width:150px;overflow:hidden;text-overflow:ellipsis;margin-left:9px;padding:3px 8px;border-radius:99px;font-size:10px;font-weight:500;letter-spacing:.2px;background:color-mix(in srgb,currentColor 12%,transparent);opacity:.82;cursor:default'
  label.append(wsBtn, wsSep, ttlTag, presetTag)
  bar.append(label)

  // 工作区按钮 hover/图标（cssText 设不了 :hover/后代选择器，注入规则）。
  // svg 16px + display:block + translateY(.5px)：块化消除基线间隙，
  // 微下移补字体字形光学中心偏下（flex 只对齐几何盒中心，
  // 13px 字在行盒内视觉中心偏低，不补则图标显得略高）
  const wsStyle = document.createElement('style')
  wsStyle.textContent = [
    '#__dsh_ws_btn{transition:background .12s ease}',
    '#__dsh_ws_btn:hover{background:color-mix(in srgb,currentColor 10%,transparent)}',
    '#__dsh_ws_btn svg{width:16px;height:16px;display:block;transform:translateY(.5px)}',
  ].join('')
  document.head.append(wsStyle)

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
    let ws = ''
    try { ws = getComputedStyle(document.documentElement).getPropertyValue('--dsh-ws-name').trim() } catch {}
    let wsp = ''
    try { wsp = getComputedStyle(document.documentElement).getPropertyValue('--dsh-ws-path').trim() } catch {}
    wsName.textContent = ws
    wsBtn.dataset.path = wsp
    wsBtn.title = wsp !== '' ? '打开工作区目录：' + wsp : ''
    // 恢复显示必须写回 inline-flex：置 '' 会清除 cssText 里的 display，
    // 残留的 all:unset 把按钮打回 inline，文字掉到第二行
    wsBtn.style.display = ws !== '' ? 'inline-flex' : 'none'
    wsSep.style.display = ws !== '' ? '' : 'none'
    ttlTag.textContent = (document.title || '').trim() || 'KCoder'
    let preset = ''
    try { preset = getComputedStyle(document.documentElement).getPropertyValue('--dsh-agent-preset').trim() } catch {}
    presetTag.textContent = preset
    presetTag.style.display = preset !== '' ? '' : 'none'
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
