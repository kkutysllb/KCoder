/**
 * 内嵌终端面板：主界面（右侧内容区）底部的真实终端，VS Code 同款。
 *
 * 构成：
 * - 每个工作区持有独立的 WebContentsView（renderer 的 #/terminal 视图，
 *   xterm.js + preload），叠加在 shell 窗口底部——上游页面零修改；
 * - 不同工作区的 view 同时挂载、互不污染；切工作区 = setVisible 切换，
 *   view 实例与对应 PtyHost 桶 session 全程存活（不销毁、不 SIGTERM）；
 * - 布局：x = 侧边栏实时宽度（页面探针 ResizeObserver 上报，拖拽/收起
 *   动画期间持续跟随），y = 窗口底部，不侵占侧边栏；
 * - 让位：当前可见 view 给上游 AppFrame 的 centerCol/detailsCol 注入
 *   padding-bottom（侧边栏全高不动），对话输入框上移不被遮挡。
 *
 * 上游契约（全部运行时探测）：
 * - 侧边栏列 `[class*="sidebarCol"]`、内容列 `[class*="centerCol"]` /
 *   `[class*="detailsCol"]`（ui-layout AppFrame，CSS modules 哈希前缀
 *   不影响 `[class*=…]` 匹配）；
 * - 当前会话 → 工作区：选中行 aria-selected + React fiber props.node.id
 *   → POST /api/workspace.list → sessionIds 命中项的 path（契约细节见
 *   workspace 探针脚本内注释）；
 * - 按钮宿主：theme-watcher 注入的自绘标题栏（#__dsh_desktop_titlebar）；
 *   right 序 44（全局：侧栏面板 12 / 内嵌终端 44 / 上下文 76 / git 108）。
 *
 * 2026-08 恢复：better-sidebar 底部面板在 agent 运行态黑屏（面板状态机
 * 脱节：height:0 但挤压变量残留 220px，且无自动唤醒信号），产品决策
 * 弃用插件底面板（sidebar-cluster 不再注入其入口），自研终端回归。
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
import type { TerminalTheme } from '@shared/ipc-contract'

/** console 通道前缀（与注入脚本约定）。 */
const TERMINAL_PREFIX = '__dsh_terminal__:'

/** 上下文沉浸模式上报前缀（context-button PAGE_JS 发送，1=开/0=关）。 */
const CONTEXT_PREFIX = '__dsh_ctx__:'

/** 面板默认/界限高度（DIP）。 */
const PANEL_DEFAULT_H = 280
const PANEL_MIN_H = 140
const PANEL_MAX_H = 620

/** dev 模式下 renderer 的 vite 服务地址；生产为 out/renderer 静态文件。 */
const RENDERER_URL = process.env.ELECTRON_RENDERER_URL

/** 预加载脚本绝对路径（面板窗口同款：preload + contextIsolation）。 */
const PRELOAD = join(__dirname, '../preload/index.js')

/** 无工作区桶键（兜底：上游 workspace 探针尚未解析到时）。 */
const NO_WORKSPACE_KEY = ''

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
  // 收集全部 selected 树行的会话 id：多棵树可能同时各有 selected
  //（会话树 + 搜索结果等），取第一个会拿到另一棵树的残留选中
  const probeSessionIds = () => {
    const ids = []
    for (const el of document.querySelectorAll('[role="treeitem"][aria-selected="true"]')) {
      const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber$'))
      let fiber = fiberKey !== undefined ? el[fiberKey] : null
      while (fiber != null) {
        const node = fiber.memoizedProps != null ? fiber.memoizedProps.node : null
        if (node != null && typeof node.id === 'string') { ids.push(node.id); break }
        fiber = fiber.return
      }
    }
    return ids
  }
  let rpcSeq = 0
  // 解析代数：debounce 上报与按钮点击并发时，后发起的解析读到更新的
  // DOM；先发起的旧结果即使响应晚到也不得覆盖 → 代数不等的直接丢弃。
  // （rpcId 的 seq 只进了日志，从未校验——乱序防御在这里补齐）
  let wsGen = 0
  // 结果语义：matched=true 选中会话唯一映射到某工作区（强信号）；
  // matched=false 无任何选中行，fallback 到 updatedAt 最新（弱信号，
  // 仅启动初态可用）；null = 有选中但映射不到/映射歧义，或响应乱序——
  // 此刻任何「猜」出的工作区都可能不是用户所在（错桶的根因），
  // 宁可不上报，等 DOM/列表数据稳定后的下一次变化重解析。
  const resolveWorkspace = async () => {
    const gen = ++wsGen
    const doResolve = async () => {
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
      const ids = probeSessionIds()
      if (ids.length > 0) {
        const hits = new Set()
        for (const id of ids) {
          const w = usable.find(it => Array.isArray(it.sessionIds) && it.sessionIds.includes(id))
          if (w != null) hits.add(w)
        }
        if (hits.size !== 1) return null
        const workspace = [...hits][0]
        return { matched: true, path: workspace.path, title: typeof workspace.title === 'string' ? workspace.title : '' }
      }
      const latest = usable.slice()
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0]
      return { matched: false, path: latest.path, title: typeof latest.title === 'string' ? latest.title : '' }
    }
    const ws = await doResolve().catch(() => null)
    return gen === wsGen ? ws : null
  }

  /* ---- 工作区缓存上报：选中会话变化（或列表重挂载）时重解析 ---- */
  let debounce = 0
  const reportWorkspace = () => {
    resolveWorkspace()
      .then(ws => {
        if (ws == null) return
        if (ws.matched) report({ workspace: ws.path, workspaceTitle: ws.title })
        else report({ workspaceFallback: ws.path, workspaceTitle: ws.title })
      })
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
    '#' + BTN_ID + '{all:unset;box-sizing:border-box;position:absolute;right:44px;top:50%;transform:translateY(-50%);display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;cursor:pointer;color:rgba(26,29,33,.65);-webkit-app-region:no-drag;transition:background .15s ease}',
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
        .then(ws => report({ action: 'toggle', path: ws != null && ws.matched ? ws.path : null }))
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
 * 单工作区的面板视图：独立的 WebContentsView + 独立的可见性 + 独立的
 * 上游 padding 让位。每个工作区持久保留自己的视图（DOM 不丢、xterm
 * buffer 不丢、PtyHost session 继续跑）；切工作区只是 setVisible 切换。
 */
interface WorkspaceView {
  /** 工作区桶键（绝对路径，空串表示无工作区兜底桶）。 */
  bucket: string
  /** 视图唯一性 = bucket；用作 Map 键。 */
  view: WebContentsView
  /** 用户对该工作区面板的开合偏好（仅由用户 toggle 改变，切工作区不改）。 */
  open: boolean
  /** 真实显示状态（与 view.setVisible 同步；layout 的 pad 判断用这个）。 */
  shown: boolean
  /** 该 view 是否曾被首次打开过（懒挂载标记）。 */
  loaded: boolean
}

/**
 * 终端面板管理器：每 shell 窗口一份（单窗口应用，字段单例即可）。
 * 供 ipc.ts 的 terminal:* handlers 与菜单/快捷键调用。
 *
 * 多工作区模型：
 * - 每个工作区持有独立 WorkspaceView + PtyHost 桶，切工作区仅切换
 *   setVisible 不销毁；
 * - 当前工作区（activeBucket）= 探针缓存中最近一次解析到的路径；
 *   仅用于决定哪个 view 在窗口里当前可见；
 * - 切工作区时保持所有 view 挂载在 contentView 里（不 removeChildView），
 *   仅 setVisible，避免视图销毁重建导致 DOM/buffer 丢失。
 */
class TerminalPanel {
  private win: BrowserWindow | null = null
  /** workspace 桶键 → 该工作区的视图与状态。bucket 为空串表示无工作区桶。 */
  private readonly views = new Map<string, WorkspaceView>()
  private readonly pty = new PtyHost()
  /** 探针缓存的最近工作区路径（用于决定"当前"可见的 view）。null = 未解析。 */
  private activeBucket: string | null = null
  private activeTitle = ''
  /** 全局面板高度（用户拖拽，所有工作区共用一个值；切工作区无差别）。 */
  private panelH = clampH(getSettings().terminalHeight ?? PANEL_DEFAULT_H)
  /** 侧栏宽度（所有工作区视图共用一个值，跟随上游）。 */
  private sidebarW = 0
  /** 上下文沉浸模式（dsh-context modal 打开）：终端全员让位，
   * open 偏好保留，退出后原样恢复。 */
  private ctxMode = false

  /** 构造：pty 事件路由（带 bucket 转发到对应 workspace view）。 */
  constructor() {
    this.pty.on('data', (chunk, _id, bucket) => {
      const entry = this.views.get(bucket)
      const wc = entry?.view.webContents
      if (wc !== undefined && !wc.isDestroyed()) wc.send('terminal:data', chunk, _id)
    })
    this.pty.on('exit', (id, bucket) => {
      const entry = this.views.get(bucket)
      const wc = entry?.view.webContents
      if (wc !== undefined && !wc.isDestroyed()) wc.send('terminal:exit', id)
    })
  }

  /** shell 窗口创建后接线：页面注入 + console/resize 事件（重复调用安全）。 */
  attach(win: BrowserWindow): void {
    // 幂等：窗口重建（托盘保活再开）时先解绑旧监听
    themeEvents.off('theme-changed', this.onThemeChanged)
    this.win = win
    const { webContents } = win
    const onConsole = (event: unknown, ...rest: unknown[]): void => {
      const message = consoleMessageText(event, rest)
      // 上下文沉浸模式（context-button 上报）：modal 开关 → 终端全员
      // 让位/恢复。放终端前缀检查之前（两个前缀互不包含，顺序无耦合）。
      if (message.startsWith(CONTEXT_PREFIX)) {
        this.setContextMode(message.slice(CONTEXT_PREFIX.length).trim() === '1')
        return
      }
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
      if (typeof workspace === 'string' && workspace !== '') {
        // 探针报告当前工作区（强信号：选中会话唯一映射）：仅切换"哪个
        // view 当前可见"，不动其他工作区视图与 pty session（多任务并行：
        // A 的长任务不应被切到 B 时影响）。
        const prevBucket = this.activeBucket
        this.activeBucket = workspace
        this.activeTitle = typeof payload.workspaceTitle === 'string' ? payload.workspaceTitle : ''
        // 兕底桶键：空串对应"无工作区"桶，确保新 view 可被找到
        if (prevBucket !== this.activeBucket) this.switchVisible(this.activeBucket)
        return
      }
      const fallback = payload.workspaceFallback
      if (typeof fallback === 'string' && fallback !== '' && this.activeBucket === null) {
        // 弱信号（无任何选中会话，updatedAt 最新兑底）：仅在从未有过
        // 强信号时采纳——一旦已知工作区，绝不被猜出来的值覆盖（错桶根因）
        this.activeBucket = fallback
        this.activeTitle = typeof payload.workspaceTitle === 'string' ? payload.workspaceTitle : ''
        this.switchVisible(fallback)
        return
      }
      if (payload.action === 'toggle') {
        const path = typeof payload.path === 'string' && payload.path !== '' ? payload.path : null
        if (path !== null) this.activeBucket = path
        this.toggle()
      }
    }
    const onDidLoad = (): void => {
      if (win.isDestroyed()) return
      // 页面重载后 modal 必然不在（React 状态重置），沉浸态若因上报
      // 丢失卡住，在此复位（恢复 open 偏好的 view）
      if (this.ctxMode) this.setContextMode(false)
      webContents.executeJavaScript(PAGE_JS, true).catch(() => {
        // 页面跳转间隙执行失败属正常，下次加载会重试
      })
      // 上游 padding 让位同步（当前 active 工作区 view 真实可见时）
      const visibleEntry = this.currentEntry()
      if (visibleEntry !== null && visibleEntry.shown) {
        webContents.executeJavaScript(padScript(this.panelH), true).catch(() => {})
      }
    }
    webContents.on('console-message', onConsole)
    webContents.on('did-finish-load', onDidLoad)
    win.on('resize', () => { this.layout() })
    win.once('closed', () => {
      webContents.removeListener('console-message', onConsole)
      webContents.removeListener('did-finish-load', onDidLoad)
      this.destroyAll()
      this.win = null
    })
    // 主题切换 → 广播全部视图刷新配色
    themeEvents.on('theme-changed', this.onThemeChanged)
  }

  /** 应用退出前彻底清理（杀全部 shell 进程）。 */
  dispose(): void {
    themeEvents.off('theme-changed', this.onThemeChanged)
    this.pty.dispose()
    this.destroyAll()
  }

  /** 当前可见视图（用于 IPC 调用方反查工作区）。 */
  currentEntry(): WorkspaceView | null {
    const bucket = this.activeBucket
    if (bucket === null) return null
    return this.views.get(bucket) ?? null
  }

  /**
   * 查 view 对应工作区桶键（IPC handler 调用：按 event.sender.id 找
   * 调用方所在 view，进而定位工作区，避免 B view 误操作 A 桶 session）。
   * 返回 null 表示调用方不是任何已知 view（理论上不该发生）。
   */
  bucketOfWebContentsId(id: number): string | null {
    for (const [bucket, entry] of this.views) {
      if (entry.view.webContents.id === id) return bucket
    }
    return null
  }

  /** 所有已知工作区桶键（供 PtyHost/listAll 等使用）。 */
  knownBuckets(): string[] {
    return [...this.views.keys()]
  }

  toggle(): void {
    // 沉浸模式期间一律无操作：终端开着时 toggle 走 hide 会清掉 open
    // 偏好，退出沉浸后就不恢复了——按钮/菜单在 modal 期间点击无反应
    //（状态冻结，退出后按进入前状态原样呈现）。
    if (this.ctxMode) return
    const bucket = this.activeBucket ?? NO_WORKSPACE_KEY
    const entry = this.ensureEntry(bucket)
    if (entry.open) this.hide(bucket)
    else this.show(bucket)
  }

  /** 显示指定工作区面板：若 view 未挂载则懒建挂载+loadURL。 */
  show(bucket: string | null): void {
    // 沉浸模式（上下文 modal 打开）期间拒绝显示：终端 view 一旦可见
    // 会盖住 modal（compositor 层）；modal 关闭后按钮恢复可用。菜单 /
    // 快捷键等 main 侧入口统一被此早退拦截。
    if (this.ctxMode) return
    const win = this.win
    if (win === null || win.isDestroyed()) return
    const key = bucket ?? NO_WORKSPACE_KEY
    const entry = this.ensureEntry(key)
    entry.view.setVisible(true)
    entry.open = true
    entry.shown = true
    this.pty.ensureFirst(key)
    this.layout()
    this.syncButtonState()
    // 首次 mount（loaded=false）时渲染端在 mount 阶段已 await terminalTabs
    // 拉到当前桶 tabs，无需重发；非首次（例如切工作区后再点开同一工作区）
    // 渲染端缓存的可能还是上一桶 tabs，发 reset 让其按当前桶重拉。
    if (entry.loaded) entry.view.webContents.send('terminal:reset')
    // 焦点给当前工作区终端视图
    entry.view.webContents.focus()
  }

  hide(bucket: string | null): void {
    const key = bucket ?? NO_WORKSPACE_KEY
    const entry = this.views.get(key)
    if (entry === undefined) return
    entry.view.setVisible(false)
    entry.open = false
    entry.shown = false
    if (this.activeBucket === null || this.activeBucket === key) {
      this.pad(0)
      this.syncButtonState()
      this.win?.webContents.focus()
    } else {
      // 隐藏的不是当前 active：仅同步自己，无需碰上游 padding
      this.layout()
    }
  }

  /**
   * panel-menu 下拉打开期间的临时让位（win32）：下拉是页面 DOM，
   * compositor 层上任何 WebContentsView 都盖在它上面（z-index 无解），
   * 只能临时收视图；open/shown 偏好全部保留，关闭即原样恢复
   * （沉浸模式期间本就全部隐藏，不参与恢复）。
   */
  yieldForMenu(on: boolean): void {
    for (const entry of this.views.values()) {
      if (on) {
        if (entry.shown) entry.view.setVisible(false)
      } else if (entry.shown && !this.ctxMode) {
        entry.view.setVisible(true)
      }
    }
  }

  /** 面板高度拖拽（终端 header 上缘；dy 为向下拖正）。 */
  adjustHeight(dy: number): void {
    const next = clampH(this.panelH + dy)
    if (next === this.panelH) return
    this.panelH = next
    saveSettings({ terminalHeight: next })
    this.layout()
  }

  height(): number {
    return this.panelH
  }

  /** 请求重排（预览抽屉开合/拖宽后由布局联动回调触发）。 */
  relayout(): void {
    this.layout()
  }

  ptyHost(): PtyHost {
    return this.pty
  }

  /** 当前工作区路径（探针缓存；向后兼容 API）。 */
  currentWorkspace(): { path: string | null; title: string } {
    return { path: this.activeBucket, title: this.activeTitle }
  }

  /** 同步标题栏按钮的开合态（页面导航后/面板切换时）。 */
  syncButtonState(): void {
    const wc = this.win?.webContents
    if (wc === undefined || wc.isDestroyed()) return
    const open = [...this.views.values()].some(v => v.open)
    wc.executeJavaScript(
      `(() => { const b = document.getElementById('__dsh_desktop_terminal_btn'); if (b) b.setAttribute('data-open', ${open ? '"1"' : '"0"'}) })()`,
      true,
    ).catch(() => {})
  }

  /** 重算所有真实可见 view 的 bounds + 上游让位（pad 判断用 shown，绝不用开合记忆）。 */
  private layout(): void {
    const win = this.win
    if (win === null || win.isDestroyed()) return
    const [contentW, contentH] = win.getContentSize()
    const x = Math.min(this.sidebarW, Math.max(contentW - 200, 0))
    // 2026-08 恢复：预览抽屉已随四面板退场，宽度不再扣减
    const w = Math.max(contentW - x, 0)
    const y = Math.max(contentH - this.panelH, 0)
    let anyShown = false
    for (const entry of this.views.values()) {
      if (!entry.shown) continue
      anyShown = true
      entry.view.setBounds({ x, y, width: w, height: this.panelH })
    }
    this.pad(anyShown ? this.panelH : 0)
  }

  /** 上游内容区让位注入（面板高度变化时同步）。 */
  private pad(h: number): void {
    this.win?.webContents.executeJavaScript(padScript(h), true).catch(() => {})
  }

  private readonly onThemeChanged = (): void => {
    const theme = terminalTheme()
    for (const entry of this.views.values()) {
      if (!entry.view.webContents.isDestroyed()) entry.view.webContents.send('terminal:theme', theme)
    }
  }

  /**
   * 上下文沉浸模式：modal 打开（console 上报）时终端全员让位
   * （open 偏好保留）；modal 关闭后按各工作区开合偏好原样恢复。
   * 与手输 /context（不经 GUI）同被 MutationObserver 检测，覆盖全部
   * 打开路径；页面重载由 onDidLoad 复位兑底。
   */
  setContextMode(on: boolean): void {
    if (on === this.ctxMode) return
    this.ctxMode = on
    this.switchVisible(this.activeBucket ?? NO_WORKSPACE_KEY)
  }

  /**
   * 切工作区（active bucket 变化）时：恢复"目标工作区自己的"面板状态。
   * - 每个工作区独立记忆自己的开合偏好（entry.open）；
   * - 目标工作区若曾打开过面板（open=true）→ 恢复显示；没打开过 →
   *   保持折叠（切工作区绝不自动展开没开过的工作区，也不偷偷 spawn）；
   * - 其他工作区仅隐藏，open 记忆保留（切回时原状恢复，进程/buffer
   *   全程不动）。所有 view 继续挂载在 contentView 不销毁。
   */
  private switchVisible(newBucket: string): void {
    for (const [bucket, entry] of this.views) {
      const shouldShow = bucket === newBucket && entry.open && !this.ctxMode
      entry.view.setVisible(shouldShow)
      entry.shown = shouldShow
    }
    this.layout()
    this.syncButtonState()
  }

  /**
   * 懒建指定工作区的视图（首次访问时挂载到 contentView、loadURL 渲染端）。
   * 已经存在则直接返回。
   */
  private ensureEntry(bucket: string): WorkspaceView {
    const win = this.win
    if (win === null || win.isDestroyed()) throw new Error('TerminalPanel: window not attached')
    let entry = this.views.get(bucket)
    if (entry !== undefined) return entry
    const view = new WebContentsView({
      webPreferences: {
        preload: PRELOAD,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        // 多工作区并行：隐藏的 view 也持续接收 pty 数据写入 buffer
        //（切回时历史完整，不被渲染进程节流中断）
        backgroundThrottling: false,
      },
    })
    win.contentView.addChildView(view)
    view.setVisible(false)
    const url = RENDERER_URL !== undefined
      ? `${RENDERER_URL}/#/terminal`
      : `${pathToFileURL(join(__dirname, '../renderer/index.html')).href}#/terminal`
    void view.webContents.loadURL(url)
    entry = { bucket, view, open: false, shown: false, loaded: false }
    this.views.set(bucket, entry)
    // 渲染端挂载完成后标记 loaded
    view.webContents.once('did-finish-load', () => { entry!.loaded = true })
    return entry
  }

  /** 销毁全部视图（窗口关闭/应用退出时调用）。 */
  private destroyAll(): void {
    const win = this.win
    for (const entry of this.views.values()) {
      if (win !== null && !win.isDestroyed()) win.contentView.removeChildView(entry.view)
      entry.view.webContents.close()
    }
    this.views.clear()
  }
}

function clampH(h: number): number {
  return Math.min(PANEL_MAX_H, Math.max(PANEL_MIN_H, Math.round(h)))
}

/** 全局单例（应用级：pty 会话跨窗口保持）。 */
export const terminalPanel = new TerminalPanel()

export { dirLabel }