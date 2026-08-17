/**
 * 内嵌终端视图（#/terminal，承载于 shell 窗口底部的 WebContentsView）：
 * xterm.js 渲染 + IPC 桥接主进程 pty（node-pty）。
 *
 * 多标签：header 即标签栏（每个标签一个 shell 进程 = 主进程 PtyHost
 * 的一个会话 id），"+" 新建、× 关闭；每个标签独立 Terminal 实例，
 * display 切换保留各自 buffer；隐藏标签持续接收数据（write 安全），
 * 激活时 refit + 尺寸上报补差。右键菜单：复制/粘贴/清屏/新建/关闭
 * （剪贴板走 preload IPC，无 navigator.clipboard 权限问题）。
 *
 * header 上缘 4px 拖条调面板高度（主进程 clamp 并持久化）。主题色由
 * 主进程推送（上游 token），随主题切换实时刷新全部标签。
 *
 * @module desktop/renderer/src/views/terminal
 */

import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { bridge } from '../bridge'
import type { TerminalTab, TerminalTheme } from '@shared/ipc-contract'

/** 视图内样式（独立于 app.css：此页是终端面板专用布局）。 */
const PAGE_CSS = `
html, body { height: 100%; margin: 0; overflow: hidden; }
#app { height: 100%; display: flex; flex-direction: column; font: 500 12px -apple-system, "PingFang SC", "Segoe UI", sans-serif; }
.tm-grip { height: 4px; flex: none; cursor: row-resize; }
.tm-header { flex: none; height: 32px; display: flex; align-items: stretch; gap: 6px; padding: 0 8px 0 8px; user-select: none; }
.tm-tabs { flex: 1; min-width: 0; display: flex; align-items: stretch; gap: 2px; overflow-x: auto; scrollbar-width: none; }
.tm-tabs::-webkit-scrollbar { display: none; }
.tm-tab { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 7px; padding: 0 7px 0 11px; max-width: 170px; border-radius: 7px; cursor: pointer; flex: none; }
.tm-tab .tm-tab-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: .55; }
.tm-tab[data-active="1"] { background: rgba(128, 128, 128, .14); }
.tm-tab[data-active="1"] .tm-tab-label { opacity: 1; font-weight: 600; }
.tm-tab .tm-x { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 4px; cursor: pointer; opacity: 0; flex: none; }
.tm-tab:hover .tm-x, .tm-tab[data-exited="1"] .tm-x { opacity: .7; }
.tm-tab .tm-x:hover { background: rgba(128, 128, 128, .25); opacity: 1; }
.tm-tab[data-exited="1"] .tm-tab-label { opacity: .35; font-style: italic; }
.tm-btn { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; margin-top: 4px; border-radius: 6px; cursor: pointer; }
.tm-btn:hover { background: rgba(128, 128, 128, .18); }
.tm-btn svg { display: block; }
.tm-term { flex: 1; min-height: 0; position: relative; }
.tm-term .tm-page { position: absolute; inset: 0; padding: 2px 8px 6px; }
.tm-term .tm-page[hidden] { display: none; }
.tm-term .xterm { height: 100%; }
.tm-exit { flex: none; display: none; align-items: center; gap: 10px; padding: 6px 12px; font-size: 12px; opacity: .8; }
.tm-menu { position: fixed; z-index: 99; min-width: 148px; padding: 4px; border-radius: 8px; box-shadow: 0 6px 24px rgba(0, 0, 0, .28); font-size: 12px; }
.tm-menu button { all: unset; box-sizing: border-box; display: flex; width: 100%; padding: 5px 10px; border-radius: 5px; cursor: pointer; }
.tm-menu button:hover { background: rgba(128, 128, 128, .18); }
.tm-menu button:disabled { opacity: .35; cursor: default; }
.tm-menu button:disabled:hover { background: transparent; }
.tm-menu .tm-sep { height: 1px; margin: 4px 6px; }
`

/** 渲染端标签状态（对应主进程 PtyHost 的一个会话）。 */
interface TabState {
  id: number
  term: Terminal
  fit: FitAddon
  host: HTMLElement
  el: HTMLButtonElement
  exited: boolean
}

function applyPalette(theme: TerminalTheme, header: HTMLElement, grip: HTMLElement, exit: HTMLElement, menu: HTMLElement): ITheme {
  document.body.style.background = theme.bg
  header.style.background = theme.headerBg
  header.style.color = theme.fg
  header.style.borderBottom = `1px solid ${theme.border}`
  grip.style.background = theme.border
  exit.style.background = theme.bg
  exit.style.color = theme.fg
  menu.style.background = theme.headerBg
  menu.style.color = theme.fg
  menu.style.border = `1px solid ${theme.border}`
  menu.querySelectorAll<HTMLElement>('.tm-sep').forEach(sep => { sep.style.background = theme.border })
  return {
    background: theme.bg,
    foreground: theme.fg,
    cursor: theme.accent,
    cursorAccent: theme.bg,
    selectionBackground: theme.accent + '59',
  }
}

/** 标签文字：目录短名（区分度最高；shell 名在 title 属性里）。 */
function tabLabel(tab: TerminalTab): string {
  const parts = tab.cwd.split('/').filter(Boolean)
  return parts.pop() ?? tab.cwd
}

export async function mountTerminal(root: HTMLElement): Promise<void> {
  const style = document.createElement('style')
  style.textContent = PAGE_CSS
  document.head.append(style)

  const grip = document.createElement('div')
  grip.className = 'tm-grip'
  const header = document.createElement('div')
  header.className = 'tm-header'

  const tabsBar = document.createElement('div')
  tabsBar.className = 'tm-tabs'
  const newBtn = iconButton(
    '新建终端标签（⌘T）',
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="none"><path d="M8 3.2v9.6M3.2 8h9.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  )
  const restartBtn = iconButton(
    '重启 shell（在当前工作区目录）',
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="none"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M13.7 1.8v2.7h-2.7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  )
  const closeBtn = iconButton(
    '关闭终端面板（会话保留）',
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="none"><path d="m4.5 4.5 7 7m0-7-7 7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  )
  header.append(tabsBar, newBtn, restartBtn, closeBtn)

  const termHost = document.createElement('div')
  termHost.className = 'tm-term'

  const exitBar = document.createElement('div')
  exitBar.className = 'tm-exit'
  const exitText = document.createElement('span')
  exitText.textContent = 'shell 进程已退出'
  const relaunch = document.createElement('button')
  relaunch.textContent = '重新启动'
  relaunch.style.cssText = 'all:unset;cursor:pointer;padding:3px 10px;border-radius:6px;font-weight:600'
  relaunch.onmouseenter = () => { relaunch.style.background = 'rgba(128,128,128,.25)' }
  relaunch.onmouseleave = () => { relaunch.style.background = 'transparent' }
  exitBar.append(exitText, relaunch)

  const menu = document.createElement('div')
  menu.className = 'tm-menu'
  menu.style.display = 'none'

  root.append(grip, header, termHost, exitBar, menu)

  /* ---- 主题（初始拉取 + 订阅推送，应用到全部标签） ---- */
  let palette = applyPalette(await bridge.terminalTheme(), header, grip, exitBar, menu)
  bridge.onTerminalTheme(theme => {
    palette = applyPalette(theme, header, grip, exitBar, menu)
    for (const st of tabs.values()) st.term.options.theme = palette
  })

  /* ---- 标签管理 ---- */
  const tabs = new Map<number, TabState>()
  let activeId = -1

  const makeTerm = (): { term: Terminal; fit: FitAddon } => {
    const term = new Terminal({
      fontFamily: 'Menlo, Monaco, "DejaVu Sans Mono", "Courier New", monospace',
      fontSize: 13,
      cursorBlink: true,
      convertEol: false,
      scrollback: 4000,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    return { term, fit }
  }

  /** 快捷键：⌘W 关标签（最后一个放行关窗）、⌘T 新建。 */
  const keyHandler = (event: KeyboardEvent): boolean => {
    if (event.metaKey && event.key === 'w') {
      if (tabs.size > 1) { void closeTab(activeId); return false }
      return false // 放行给应用菜单关窗
    }
    if (event.metaKey && event.key === 't') {
      void newTab()
      return false
    }
    return true
  }

  const registerTab = (tab: TerminalTab): TabState => {
    const host = document.createElement('div')
    host.className = 'tm-page'
    host.hidden = true
    termHost.append(host)
    const { term, fit } = makeTerm()
    term.options.theme = palette
    term.open(host)
    term.attachCustomKeyEventHandler(keyHandler)

    const el = document.createElement('button')
    el.className = 'tm-tab'
    el.type = 'button'
    el.title = `${tab.title} — ${tab.cwd}`
    const label = document.createElement('span')
    label.className = 'tm-tab-label'
    label.textContent = tabLabel(tab)
    const x = document.createElement('button')
    x.className = 'tm-x'
    x.type = 'button'
    x.title = '关闭标签'
    x.innerHTML = '<svg viewBox="0 0 16 16" width="10" height="10" fill="none"><path d="m4.5 4.5 7 7m0-7-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'
    el.append(label, x)
    tabsBar.append(el)

    const st: TabState = { id: tab.id, term, fit, host, el, exited: !tab.alive }
    el.dataset.exited = st.exited ? '1' : '0'
    el.onclick = () => setActive(st.id)
    x.onclick = e => { e.stopPropagation(); void closeTab(st.id) }
    term.onData(data => { void bridge.terminalWrite(st.id, data) })
    term.onResize(({ cols, rows }) => { void bridge.terminalResize(st.id, cols, rows) })
    tabs.set(st.id, st)
    return st
  }

  const setActive = (id: number): void => {
    const st = tabs.get(id)
    if (st === undefined) return
    activeId = id
    for (const t of tabs.values()) {
      t.el.dataset.active = t.id === id ? '1' : '0'
      t.host.hidden = t.id !== id
    }
    exitBar.style.display = st.exited ? 'flex' : 'none'
    // 隐藏期间尺寸可能滞后：激活即补 fit + 上报（pty 端补 resize）
    if (termHost.clientWidth !== 0 && termHost.clientHeight !== 0) {
      try { st.fit.fit() } catch { /* 容器暂不可测 */ }
    }
    st.term.focus()
  }

  const newTab = async (): Promise<void> => {
    const tab = await bridge.terminalNew()
    const st = registerTab(tab)
    setActive(st.id)
    st.term.focus()
  }

  const closeTab = async (id: number): Promise<void> => {
    if (id === -1) return
    const st = tabs.get(id)
    if (st === undefined) return
    const remaining = await bridge.terminalClose(id)
    st.term.dispose()
    st.host.remove()
    st.el.remove()
    tabs.delete(id)
    // 对齐主进程剩余标签（防御：本地与远端应一致）
    const ids = new Set(remaining.map(t => t.id))
    for (const [kid, kst] of tabs) {
      if (!ids.has(kid)) { kst.term.dispose(); kst.host.remove(); kst.el.remove(); tabs.delete(kid) }
    }
    if (tabs.size === 0) {
      // 全部关闭 → 隐藏面板（下次打开 ensureFirst 新建全新会话）
      activeId = -1
      await bridge.terminalHide()
      return
    }
    if (id === activeId) {
      const last = [...tabs.keys()].pop()
      if (last !== undefined) setActive(last)
    }
  }

  const markExited = (id: number): void => {
    const st = tabs.get(id)
    if (st === undefined) return
    st.exited = true
    st.el.dataset.exited = '1'
    if (id === activeId) exitBar.style.display = 'flex'
  }

  /* ---- 初始标签（面板打开时主进程已 ensureFirst） ---- */
  const initial = await bridge.terminalTabs()
  for (const tab of initial) {
    const st = registerTab(tab)
    if (activeId === -1 || tab.alive) activeId = st.id
  }
  if (activeId !== -1) setActive(activeId)

  /* ---- 数据/退出（按 id 路由；隐藏标签持续写入安全） ---- */
  bridge.onTerminalData((chunk, id) => { tabs.get(id)?.term.write(chunk) })
  bridge.onTerminalExit(id => markExited(id))

  /* ---- 尺寸：容器变化只 refit 活动标签（隐藏的激活时补） ---- */
  const refit = (): void => {
    if (termHost.clientWidth === 0 || termHost.clientHeight === 0) return
    const st = tabs.get(activeId)
    if (st === undefined) return
    try { st.fit.fit() } catch { /* 忽略瞬时不可测 */ }
  }
  const ro = new ResizeObserver(() => refit())
  ro.observe(termHost)
  refit()

  /* ---- header 动作 ---- */
  newBtn.onclick = () => { void newTab() }
  restartBtn.onclick = async () => {
    if (activeId === -1) return
    const tab = await bridge.terminalRestartTab(activeId)
    const st = tabs.get(activeId)
    if (tab === null || st === undefined) return
    st.exited = false
    st.el.dataset.exited = '0'
    st.el.title = `${tab.title} — ${tab.cwd}`
    st.el.querySelector<HTMLElement>('.tm-tab-label')!.textContent = tabLabel(tab)
    st.term.reset()
    exitBar.style.display = 'none'
    st.term.focus()
  }
  closeBtn.onclick = () => { void bridge.terminalHide() }
  relaunch.onclick = () => { restartBtn.click() }

  /* ---- 右键菜单（终端区；剪贴板走 preload IPC） ---- */
  const closeMenu = (): void => { menu.style.display = 'none' }
  const menuItem = (label: string, action: () => void, disabled = false): HTMLButtonElement => {
    const item = document.createElement('button')
    item.type = 'button'
    item.textContent = label
    item.disabled = disabled
    item.onclick = () => { closeMenu(); action() }
    return item
  }
  const menuSep = (): HTMLElement => {
    const sep = document.createElement('div')
    sep.className = 'tm-sep'
    return sep
  }
  const openMenu = (x: number, y: number): void => {
    const st = tabs.get(activeId)
    if (st === undefined) return
    const hasSel = st.term.hasSelection()
    menu.innerHTML = ''
    menu.append(
      menuItem('复制', () => {
        const sel = st.term.getSelection()
        if (sel !== '') void bridge.clipboardWriteText(sel)
        st.term.clearSelection()
      }, !hasSel),
      menuItem('粘贴', () => {
        void bridge.clipboardReadText().then(text => { if (text !== '') st.term.paste(text) })
      }),
      menuItem('清屏', () => { st.term.clear() }),
      menuSep(),
      menuItem('新建标签', () => { void newTab() }),
      menuItem('关闭标签', () => { void closeTab(st.id) }, tabs.size <= 1),
    )
    menu.style.display = 'block'
    // 视口边缘翻转（右/下溢出时向左/上展开）
    const rect = menu.getBoundingClientRect()
    menu.style.left = `${Math.max(2, Math.min(x, window.innerWidth - rect.width - 2))}px`
    menu.style.top = `${Math.max(2, Math.min(y, window.innerHeight - rect.height - 2))}px`
  }
  termHost.addEventListener('contextmenu', e => {
    e.preventDefault()
    openMenu(e.clientX, e.clientY)
  })
  document.addEventListener('pointerdown', e => {
    if (menu.style.display === 'none') return
    if (e.target instanceof Node && menu.contains(e.target)) return
    closeMenu()
  }, true)
  window.addEventListener('blur', closeMenu)

  /* ---- 上缘拖条：调面板高度（增量上报，主进程 clamp + 持久化） ---- */
  let dragging = false
  let lastY = 0
  let pending = 0
  let raf = 0
  grip.onpointerdown = e => {
    dragging = true
    lastY = e.clientY
    pending = 0
    grip.setPointerCapture(e.pointerId)
    e.preventDefault()
  }
  grip.onpointermove = e => {
    if (!dragging) return
    pending += e.clientY - lastY
    lastY = e.clientY
    if (raf === 0) {
      raf = requestAnimationFrame(() => {
        raf = 0
        if (pending !== 0) {
          // 向下拖（正）= 面板变矮：主进程 adjustHeight(dy) 是"加"
          const sent = pending
          pending = 0
          void bridge.terminalPanelResize(-sent)
        }
      })
    }
  }
  const endDrag = (): void => {
    dragging = false
    // pointerup/pointercancel 后浏览器自动释放捕获，无需手动
  }
  grip.onpointerup = endDrag
  grip.onpointercancel = endDrag
}

function iconButton(label: string, svg: string): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.className = 'tm-btn'
  btn.type = 'button'
  btn.title = label
  btn.setAttribute('aria-label', label)
  btn.innerHTML = svg
  return btn
}
