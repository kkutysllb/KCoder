/**
 * 内嵌终端面板：主界面（右侧内容区）底部的真实终端，VS Code 同款。
 *
 * 构成：
 * - 面板本体是 WebContentsView（renderer 的 #/terminal 视图，xterm.js +
 *   preload），叠加在 shell 窗口底部——上游页面零修改；
 * - pty 见 pty-host（node-pty 单会话，面板关闭仅隐藏不杀进程）；
 * - 布局：x = 侧边栏实时宽度（页面探针 ResizeObserver 上报，拖拽/收起
 *   动画期间持续跟随），y = 窗口底部，不侵占侧边栏；
 * - 让位：面板打开时给上游 AppFrame 的 centerCol/detailsCol 注入
 *   padding-bottom（侧边栏全高不动），对话输入框上移不被遮挡。
 *
 * 上游契约（全部运行时探测）：
 * - 侧边栏列 `[class*="sidebarCol"]`、内容列 `[class*="centerCol"]` /
 *   `[class*="detailsCol"]`（ui-layout AppFrame，CSS modules 哈希前缀
 *   不影响 `[class*=…]` 匹配）；
 * - 当前会话 → 工作区：选中行 aria-selected + React fiber props.node.id
 *   → POST /api/workspace.list → sessionIds 命中项的 path（契约细节见
 *   workspace 探针脚本内注释）；
 * - 按钮宿主：theme-watcher 注入的自绘标题栏（#__dsh_desktop_titlebar）。
 *
 * 通信：页面侧上报走 console 通道 `__dsh_terminal__:<json>`（toggle /
 * workspace 两类）；面板视图 ↔ 主进程走 IPC（ipc-contract terminal:*）。
 *
 * @module desktop/main/terminal-panel
 */

import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { WebContentsView, type BrowserWindow } from 'electron'
import { consoleMessageText } from './console-channel'
import { getSettings, saveSettings } from './store'
import { themeEvents } from './theme-watcher'
import { PtyHost, dirLabel } from './pty-host'
import { previewPanel } from './preview-panel'
import type { TerminalTheme } from '@shared/ipc-contract'

/** console 通道前缀（与注入脚本约定）。 */
const TERMINAL_PREFIX = '__dsh_terminal__:'

/** 面板默认/界限高度（DIP）。 */
const PANEL_DEFAULT_H = 280
const PANEL_MIN_H = 140
const PANEL_MAX_H = 620

/** dev 模式下 renderer 的 vite 服务地址；生产为 out/renderer 静态文件。 */
const RENDERER_URL = process.env.ELECTRON_RENDERER_URL

/** 预加载脚本绝对路径（面板窗口同款：preload + contextIsolation）。 */
const PRELOAD = join(__dirname, '../preload/index.js')

/**
 * 页面注入脚本（上游 shell 页面上下文）：
 * 1. 标题栏右上角终端按钮（点击 → 解析当前工作区 → 上报 toggle）；
 * 2. 侧边栏宽度探针（ResizeObserver + rAF 节流 → 上报 sidebar 宽度）；
 * 3. 工作区探针（选中会话变化 → debounce → 解析工作区 → 上报缓存）；
 * 4. 内容区让位 padding 的设置/清除入口（__dshTerminalPad(H)）。
 */
const PAGE_JS = `(() => {
  if (window.__dshTerminalWired) return
  window.__dshTerminalWired = true
  const PREFIX = '__dsh_terminal__:'
  const report = (obj) => { console.log(PREFIX + JSON.stringify(obj)) }
  const bar = () => document.getElementById('__dsh_desktop_titlebar')

  /* ---- 侧边栏宽度探针：面板 x 起点 + 宽度跟随 ---- */
  const sidebarEl = () => document.querySelector('[class*="sidebarCol"]')
  const watchSidebar = () => {
    const el = sidebarEl()
    if (el == null) { requestAnimationFrame(watchSidebar); return }
    let raf = 0
    const reportW = () => {
      raf = 0
      report({ sidebar: Math.round(el.getBoundingClientRect().width) })
    }
    new ResizeObserver(() => { if (raf === 0) raf = requestAnimationFrame(reportW) }).observe(el)
    reportW()
  }
  watchSidebar()

  /* ---- 当前会话 → 工作区解析（同源 RPC）---- */
  const probeSessionId = () => {
    const rows = document.querySelectorAll('[role="treeitem"][aria-selected="true"]')
    for (const el of rows) {
      const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber$'))
      let fiber = fiberKey !== undefined ? el[fiberKey] : null
      while (fiber != null) {
        const node = fiber.memoizedProps != null ? fiber.memoizedProps.node : null
        if (node != null && typeof node.id === 'string') return node.id
        fiber = fiber.return
      }
    }
    return null
  }
  let rpcSeq = 0
  const resolveWorkspace = async () => {
    const res = await fetch('/api/workspace.list', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request', rpcId: 'kcoder-terminal-' + (++rpcSeq),
        method: 'workspace.list', payload: {},
      }),
    })
    if (!res.ok) return null
    const envelope = await res.json().catch(() => null)
    const result = envelope != null && envelope.result != null ? envelope.result : null
    const items = result != null && result.ok === true && result.value != null
      && Array.isArray(result.value.items) ? result.value.items : null
    if (items == null || items.length === 0) return null
    const usable = items.filter(it => it != null && typeof it.path === 'string' && it.path !== '')
    if (usable.length === 0) return null
    const sessionId = probeSessionId()
    const bySession = sessionId !== null
      ? usable.find(it => Array.isArray(it.sessionIds) && it.sessionIds.includes(sessionId))
      : null
    const latest = usable.slice()
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0]
    const workspace = bySession != null ? bySession : latest
    return { path: workspace.path, title: typeof workspace.title === 'string' ? workspace.title : '' }
  }

  /* ---- 工作区缓存上报：选中会话变化（或列表重挂载）时重解析 ---- */
  let debounce = 0
  const reportWorkspace = () => {
    resolveWorkspace()
      .then(ws => { if (ws != null) report({ workspace: ws.path, workspaceTitle: ws.title }) })
      .catch(() => {})
  }
  const watchSelection = () => {
    // 全页观察 aria-selected（侧边栏树/搜索行都是变化源），debounce 收敛
    new MutationObserver(() => {
      window.clearTimeout(debounce)
      debounce = window.setTimeout(reportWorkspace, 600)
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['aria-selected'] })
    reportWorkspace()
  }
  if (document.body) watchSelection()
  else document.addEventListener('DOMContentLoaded', () => watchSelection(), { once: true })

  /* ---- 标题栏按钮（宿主由 theme-watcher 注入，时序不保证 → 轮询等待）---- */
  const BTN_ID = '__dsh_desktop_terminal_btn'
  const style = document.createElement('style')
  style.id = '__dsh_desktop_terminal_style'
  style.textContent = [
    '#' + BTN_ID + '{all:unset;box-sizing:border-box;position:absolute;right:12px;top:50%;transform:translateY(-50%);display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;cursor:pointer;color:rgba(26,29,33,.65);-webkit-app-region:no-drag;transition:background .15s ease}',
    'body[data-ds-dark-theme] #' + BTN_ID + '{color:rgba(232,234,237,.8)}',
    '#' + BTN_ID + ':hover{background:color-mix(in srgb,currentColor 10%,transparent)}',
    '#' + BTN_ID + ':active{background:color-mix(in srgb,currentColor 18%,transparent)}',
    '#' + BTN_ID + '[data-open="1"]{background:color-mix(in srgb,currentColor 14%,transparent)}',
  ].join('')
  document.head.append(style)
  const injectBtn = () => {
    if (document.getElementById(BTN_ID)) return 'present'
    const host = bar()
    if (host == null) return 'absent'
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.id = BTN_ID
    btn.title = '切换内嵌终端'
    btn.setAttribute('aria-label', '切换内嵌终端')
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 16 16')
    svg.setAttribute('width', '15')
    svg.setAttribute('height', '15')
    svg.setAttribute('fill', 'none')
    svg.innerHTML = '<rect x="2" y="2.5" width="12" height="11" rx="1.75" stroke="currentColor" stroke-width="1.2"/><path d="M4.9 6.3 6.6 8l-1.7 1.7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.3 9.9h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'
    btn.append(svg)
    btn.onclick = () => {
      resolveWorkspace()
        .then(ws => report(ws == null ? { action: 'toggle', path: null } : { action: 'toggle', path: ws.path }))
        .catch(() => report({ action: 'toggle', path: null }))
    }
    host.append(btn)
    return 'injected'
  }
  let tries = 0
  const poll = setInterval(() => {
    if (injectBtn() !== 'absent' || ++tries > 120) clearInterval(poll)
  }, 500)

  /* ---- 内容区让位（主进程每次布局时调用；H=0 清除）---- */
  window.__dshTerminalPad = (H) => {
    // 几何广播：自绘固定定位面板（如统计图表）按可用区自适应避让
    document.documentElement.style.setProperty('--dsh-terminal-inset', H > 0 ? H + 'px' : '0px')
    const cols = document.querySelectorAll('[class*="centerCol"], [class*="detailsCol"]')
    for (const el of cols) {
      if (H > 0) el.style.paddingBottom = H + 'px'
      else el.style.removeProperty('padding-bottom')
    }
  }
})()`

/** 让位 padding 注入（面板高度变化时随布局执行）。 */
function padScript(h: number): string {
  return `window.__dshTerminalPad ? window.__dshTerminalPad(${h}) : undefined`
}

/** 终端主题 token（上游 bg-base/sidebar-fill 系）。 */
export function terminalTheme(pref: 'system' | 'light' | 'dark' = getSettings().lastTheme): TerminalTheme {
  const dark = pref === 'dark'
  return dark
    ? { dark: true, bg: '#151517', headerBg: '#1B1B1C', fg: '#E8EAED', border: '#2C2C2E', accent: '#4D6BFE' }
    : { dark: false, bg: '#FFFFFF', headerBg: '#F9FAFB', fg: '#1A1D21', border: 'rgba(0,0,0,.10)', accent: '#4D6BFE' }
}

/**
 * 终端面板管理器：每 shell 窗口一份（单窗口应用，字段单例即可）。
 * 供 ipc.ts 的 terminal:* handlers 与菜单/快捷键调用。
 */
class TerminalPanel {
  private win: BrowserWindow | null = null
  private view: WebContentsView | null = null
  private readonly pty = new PtyHost()
  private visible = false
  private panelH = clampH(getSettings().terminalHeight ?? PANEL_DEFAULT_H)
  private sidebarW = 0
  private workspacePath: string | null = null
  private workspaceTitle = ''

  /** shell 窗口创建后接线：页面注入 + console/resize 事件（重复调用安全）。 */
  attach(win: BrowserWindow): void {
    // 幂等：窗口重建（托盘保活再开）时先解绑旧监听，避免 pty 数据双发
    themeEvents.off('theme-changed', this.onThemeChanged)
    this.pty.off('data', this.onPtyData)
    this.pty.off('exit', this.onPtyExit)
    this.win = win
    const { webContents } = win
    const onConsole = (event: unknown, ...rest: unknown[]): void => {
      const message = consoleMessageText(event, rest)
      if (!message.startsWith(TERMINAL_PREFIX)) return
      let payload: Record<string, unknown>
      try { payload = JSON.parse(message.slice(TERMINAL_PREFIX.length)) as Record<string, unknown> } catch { return }
      const sidebar = payload.sidebar
      if (typeof sidebar === 'number' && sidebar >= 0) {
        this.sidebarW = Math.round(sidebar)
        this.layout()
        return
      }
      const workspace = payload.workspace
      if (typeof workspace === 'string') {
        this.workspacePath = workspace
        this.workspaceTitle = typeof payload.workspaceTitle === 'string' ? payload.workspaceTitle : ''
        return
      }
      if (payload.action === 'toggle') {
        const path = typeof payload.path === 'string' ? payload.path : null
        if (path !== null && path !== '') this.workspacePath = path
        this.toggle()
      }
    }
    const onDidLoad = (): void => {
      if (win.isDestroyed()) return
      webContents.executeJavaScript(PAGE_JS, true).catch(() => {
        // 页面跳转间隙执行失败属正常，下次加载会重试
      })
      // 导航重载会清掉让位 padding 与探针状态；面板仍开着则恢复
      if (this.visible) {
        webContents.executeJavaScript(padScript(this.panelH), true).catch(() => {})
        this.syncButtonState()
      }
    }
    webContents.on('console-message', onConsole)
    webContents.on('did-finish-load', onDidLoad)
    win.on('resize', () => { if (this.visible) this.layout() })
    win.once('closed', () => {
      webContents.removeListener('console-message', onConsole)
      webContents.removeListener('did-finish-load', onDidLoad)
      this.destroyView()
      this.win = null
    })
    // 主题切换 → 广播终端视图刷新配色；pty → 终端视图
    themeEvents.on('theme-changed', this.onThemeChanged)
    this.pty.on('data', this.onPtyData)
    this.pty.on('exit', this.onPtyExit)
  }

  /** 应用退出前彻底清理（杀 shell 进程）。 */
  dispose(): void {
    themeEvents.off('theme-changed', this.onThemeChanged)
    this.pty.off('data', this.onPtyData)
    this.pty.off('exit', this.onPtyExit)
    this.pty.dispose()
    this.destroyView()
  }

  toggle(): void {
    if (this.visible) this.hide()
    else this.show()
  }

  show(): void {
    const win = this.win
    if (win === null || win.isDestroyed()) return
    this.visible = true
    if (this.view === null) {
      this.view = new WebContentsView({
        webPreferences: {
          preload: PRELOAD,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: false,
        },
      })
      win.contentView.addChildView(this.view)
      const url = RENDERER_URL !== undefined
        ? `${RENDERER_URL}/#/terminal`
        : `${pathToFileURL(join(__dirname, '../renderer/index.html')).href}#/terminal`
      void this.view.webContents.loadURL(url)
    }
    this.view.setVisible(true)
    this.pty.ensureFirst(this.workspacePath)
    this.layout()
    this.syncButtonState()
    // 焦点给终端（打开即可打字）
    this.view.webContents.focus()
  }

  hide(): void {
    this.visible = false
    this.view?.setVisible(false)
    this.pad(0)
    this.syncButtonState()
    // 焦点还给上游页面
    this.win?.webContents.focus()
  }

  /** 面板高度拖拽（终端 header 上缘；dy 为向下拖正）。 */
  adjustHeight(dy: number): void {
    const next = clampH(this.panelH + dy)
    if (next === this.panelH) return
    this.panelH = next
    saveSettings({ terminalHeight: next })
    if (this.visible) this.layout()
  }

  height(): number {
    return this.panelH
  }

  /** 请求重排（预览抽屉开合/拖宽后由布局联动回调触发）。 */
  relayout(): void {
    if (this.visible) this.layout()
  }

  ptyHost(): PtyHost {
    return this.pty
  }

  /** 当前工作区路径（探针缓存；ipc restart 用）。 */
  currentWorkspace(): { path: string | null; title: string } {
    return { path: this.workspacePath, title: this.workspaceTitle }
  }

  /** 同步标题栏按钮的开合态（页面导航后/面板切换时）。 */
  syncButtonState(): void {
    const wc = this.win?.webContents
    if (wc === undefined || wc.isDestroyed()) return
    wc.executeJavaScript(
      `(() => { const b = document.getElementById('__dsh_desktop_terminal_btn'); if (b) b.setAttribute('data-open', ${this.visible ? '"1"' : '"0"'}) })()`,
      true,
    ).catch(() => {})
  }

  /** 重算面板 bounds + 上游让位。 */
  private layout(): void {
    const win = this.win
    const view = this.view
    if (win === null || win.isDestroyed() || view === null || !this.visible) return
    const [contentW, contentH] = win.getContentSize()
    const x = Math.min(this.sidebarW, Math.max(contentW - 200, 0))
    // 右侧预览抽屉可见时收窄终端宽度（预览全高在上层，避免右下角遮挡）
    const w = Math.max(contentW - x - previewPanel.visibleWidth(), 0)
    view.setBounds({
      x,
      y: Math.max(contentH - this.panelH, 0),
      width: w,
      height: this.panelH,
    })
    this.pad(this.panelH)
  }

  /** 上游内容区让位注入（面板高度变化时同步）。 */
  private pad(h: number): void {
    this.win?.webContents.executeJavaScript(padScript(h), true).catch(() => {})
  }

  private readonly onThemeChanged = (): void => {
    if (this.view !== null && !this.view.webContents.isDestroyed()) {
      this.view.webContents.send('terminal:theme', terminalTheme())
    }
  }

  private readonly onPtyData = (chunk: string, id: number): void => {
    const wc = this.view?.webContents
    if (wc !== undefined && !wc.isDestroyed()) wc.send('terminal:data', chunk, id)
  }

  private readonly onPtyExit = (id: number): void => {
    const wc = this.view?.webContents
    if (wc !== undefined && !wc.isDestroyed()) wc.send('terminal:exit', id)
  }

  private destroyView(): void {
    const win = this.win
    if (this.view !== null && win !== null && !win.isDestroyed()) {
      win.contentView.removeChildView(this.view)
      this.view.webContents.close()
    }
    this.view = null
    this.visible = false
  }
}

function clampH(h: number): number {
  return Math.min(PANEL_MAX_H, Math.max(PANEL_MIN_H, Math.round(h)))
}

/** 全局单例（应用级：pty 会话跨窗口保持）。 */
export const terminalPanel = new TerminalPanel()

export { dirLabel }
