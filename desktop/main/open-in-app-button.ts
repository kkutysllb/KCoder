/**
 * 状态栏「在本地编辑器中打开」按钮：上游原生 open-in-app 能力的入口。
 *
 * 上游形态（packages/host/open-in-app + client/ui-open-in-app）：host 半
 * 探测已装编辑器并服务三个路由——GET /open-in-app/apps（id 列表）、
 * GET /open-in-app/icon/<id>（PNG 图标）、POST /open-in-app/open
 * {app, path}（启动）；client 半把分体按钮注册进会话头部的
 * headerUtilities 槽。KCoder 的顶栏收纳（workspace-header.ts）把整个
 * titleRow display:none——原生按钮随之不可见。
 *
 * 本注入器把入口补进自绘状态栏右上角按钮组（侧边栏/终端/上下文左侧，
 * right:108px）。**不复制上游的探测与启动逻辑**：列表与图标直读上游
 * 路由（同源 fetch 带 cookie），启动直接 POST open 路由——检测与启动
 * 的唯一事实源仍是上游 host（应用增减、启动参数变化自动跟随）。
 *
 * 交互：点击弹菜单（account-chip 同款自绘菜单，含外部点击捕获期守卫）
 * 列出检测到的应用（图标 + 上游同名文案）；点选即启动并记忆
 * （localStorage，键 __kcoderOpenInApp）——记忆仅用于菜单里标出
 * 「上次使用」，不做单击直达（选择器语义，与用户的「打开本地编辑器
 * 选择」诉求一致）。打开目标为当前工作区目录（--dsh-ws-path 变量，
 * 与自绘标题栏的工作区按钮同一来源）；无工作区（变量空）时按钮隐藏。
 *
 * 失败静默面：apps 路由失败/空列表 → 菜单显示「未检测到可用的本地
 * 编辑器」；启动 POST 失败 → 按钮下方短暂提示。上游路由改名 → 菜单
 * 空态，不崩不错位。
 *
 * @module desktop/main/open-in-app-button
 */

import type { BrowserWindow } from 'electron'
import { SHELL_TITLEBAR_HEIGHT } from './theme-watcher'

/** 状态栏按钮 id。 */
const BTN_ID = '__dsh_desktop_open_in_app'
/** 菜单 id。 */
const MENU_ID = '__dsh_desktop_open_in_app_menu'
/** 右侧偏移：侧边栏 ~12 / 终端 44 / 上下文 76 之后的下一格。 */
const BTN_RIGHT = 108
/** 记忆键（localStorage）。 */
const STORE_KEY = '__kcoderOpenInApp'

/** 应用 id → 显示名（与上游 ui-open-in-app 的 zh 文案同表；未列出的 id 原样展示）。 */
const APP_LABELS: Record<string, string> = {
  vscode: 'VS Code',
  vscodeinsiders: 'VS Code Insiders',
  cursor: 'Cursor',
  xcode: 'Xcode',
  finder: '访达',
  terminal: '终端',
  windowsterminal: 'Windows Terminal',
  gnometerminal: 'GNOME Terminal',
}

/**
 * 文件管理器类目（上游 open-in-app 目录里排在编辑器之前：finder →
 * explorer → filemanager → cursor → vscode …）。选"默认应用图标"时跳过
 * 它们——按钮语义是"在编辑器中打开"，首个编辑器才是指代对象；只剩文件
 * 管理器时仍取其首项，不空手。
 */
const FILE_MANAGER_IDS = ['finder', 'explorer', 'filemanager']

/** 按钮图标（无记忆应用时的通用形：&lt;/&gt; 代码字形——「在编辑器中打开」
 * 的直观隐喻；v1 用外链箭头被读作「分享」，否决）。有记忆应用后换其
 * 真实图标（icon 路由），此形退为菜单项图标加载失败的兜底。 */
const FALLBACK_ICON =
  '<svg viewBox="0 0 16 16" fill="none"><path d="M6.2 4.6 3.4 8l2.8 3.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.8 4.6 12.6 8l-2.8 3.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'

/** 注入脚本（页面上下文执行；模板字符串内禁 TS 注解与反引号）。 */
const PAGE_JS = `(() => {
  if (window.__dshOpenInAppWired) return
  window.__dshOpenInAppWired = true
  // 图标形内插（脚本自含——模板里引用模块侧常量是悬空引用，
  // 注入脚本静态自检的第一批战果就是本文件自己的这处）
  const FALLBACK_ICON = ${JSON.stringify(FALLBACK_ICON)}
  const FILE_MANAGER_IDS = ${JSON.stringify(FILE_MANAGER_IDS)}
  const BTN = ${JSON.stringify(BTN_ID)}
  const MENU = ${JSON.stringify(MENU_ID)}
  const RIGHT = ${String(BTN_RIGHT)}
  const H = ${String(SHELL_TITLEBAR_HEIGHT)}
  const STORE = ${JSON.stringify(STORE_KEY)}
  const LABELS = ${JSON.stringify(APP_LABELS)}

  const bar = () => document.getElementById('__dsh_desktop_titlebar')
  const labelOf = (id) => LABELS[id] || id
  const remembered = () => { try { return localStorage.getItem(STORE) || '' } catch { return '' } }

  // 图标 URL（同源，带 cookie；失败时 img 自身 onerror 隐藏，行内仍显示）
  const iconUrl = (id) => '/open-in-app/icon/' + encodeURIComponent(id)

  const style = document.createElement('style')
  style.id = '__dsh_desktop_open_in_app_style'
  style.textContent = [
    '#' + BTN + '{all:unset;box-sizing:border-box;position:absolute;top:50%;transform:translateY(-50%);right:' + RIGHT + 'px;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;cursor:pointer;color:rgba(26,29,33,.65);-webkit-app-region:no-drag;transition:background .15s ease}',
    'body[data-ds-dark-theme] #' + BTN + '{color:rgba(232,234,237,.8)}',
    '#' + BTN + ':hover{background:color-mix(in srgb,currentColor 10%,transparent)}',
    '#' + BTN + ':active{background:color-mix(in srgb,currentColor 18%,transparent)}',
    '#' + BTN + ' svg{width:16px;height:16px;display:block;flex:none}',
    '#' + BTN + ' img{width:16px;height:16px;display:block;flex:none}',
    // 菜单（自绘，与账号菜单同款视觉基底）
    '#' + MENU + '{position:fixed;top:' + H + 'px;right:12px;z-index:2147483000;min-width:170px;padding:4px;border-radius:10px;box-sizing:border-box;background:var(--dsw-alias-bg-layer-2,#fff);border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25));box-shadow:0 8px 24px rgba(0,0,0,.18);font:500 12px -apple-system,"PingFang SC","Segoe UI",sans-serif;color:var(--dsw-alias-label-primary,#111)}',
    '#' + MENU + ' .oia-head{padding:6px 10px 4px;opacity:.6;font-weight:400}',
    '#' + MENU + ' .oia-item{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;padding:6px 10px;border-radius:7px;cursor:pointer}',
    '#' + MENU + ' .oia-item:hover{background:color-mix(in srgb,currentColor 8%,transparent)}',
    '#' + MENU + ' .oia-item img{width:16px;height:16px;flex:none;display:block}',
    '#' + MENU + ' .oia-item .oia-ico{width:16px;height:16px;flex:none;display:inline-flex;align-items:center;justify-content:center;color:inherit;opacity:.7}',
    '#' + MENU + ' .oia-item .oia-ico svg{width:14px;height:14px;display:block}',
    '#' + MENU + ' .oia-last{margin-left:auto;font-size:10px;opacity:.55}',
    '#' + MENU + ' .oia-empty{padding:8px 10px;opacity:.6;font-weight:400}',
    '#' + MENU + ' .oia-tip{padding:4px 10px 6px;opacity:.5;font-size:11px;font-weight:400}',
  ].join('')
  document.head.append(style)

  /**
   * 按钮图标 = 应用身份（而非通用字形）：优先**记忆应用**（最近一次用它
   * 打开过），无记忆时退到**菜单首项**（探测到的第一个可用编辑器）——
   * 与"菜单里第一项就是默认动作"的直觉一致。两者都拿不到（列表为空）
   * 才回通用 </> 形。用户诉求（2026-09-19）：默认就该是编辑器图标。
   */
  const setBtnIcon = (b, appId) => {
    b.textContent = ''
    if (appId === '') { b.innerHTML = FALLBACK_ICON; b.title = '在本地编辑器中打开当前工作区'; return }
    const img = document.createElement('img')
    img.src = iconUrl(appId)
    img.alt = ''
    img.onerror = () => { b.textContent = ''; b.innerHTML = FALLBACK_ICON }
    b.append(img)
    b.title = '在 ' + labelOf(appId) + ' 中打开当前工作区（点击更换）'
  }

  /**
   * 当前应展示的应用：记忆（若仍在列表）→ **首个编辑器**（跳过文件管理器
   * 类目，否则会拿访达/资源管理器当默认）→ 列表首项 → 空串（通用形）。
   */
  const displayApp = (apps) => {
    const last = remembered()
    if (last !== '' && (apps === null || apps.includes(last))) return last
    if (apps === null) return ''
    const editor = apps.find((id) => !FILE_MANAGER_IDS.includes(id))
    if (editor !== undefined) return editor
    return apps.length > 0 ? apps[0] : ''
  }

  const ensureBtn = () => {
    if (document.getElementById(BTN) !== null) return
    const host = bar()
    if (host === null) return
    const b = document.createElement('button')
    b.type = 'button'
    b.id = BTN
    b.title = '在本地编辑器中打开当前工作区'
    b.innerHTML = FALLBACK_ICON
    host.append(b)
    // 探测成功后回填图标（记忆应用 → 菜单首项；列表为空保持通用形）
    void loadApps().then((apps) => {
      const app = displayApp(apps)
      if (app !== '') setBtnIcon(b, app)
    })
    b.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu() })
  }

  // —— 数据面：全部走上游路由（检测/启动唯一事实源）——
  let appsCache = null
  const loadApps = async () => {
    if (appsCache !== null) return appsCache
    try {
      const r = await fetch('/open-in-app/apps')
      if (!r.ok) return null
      const v = await r.json()
      appsCache = Array.isArray(v && v.apps) ? v.apps.filter((x) => typeof x === 'string') : null
    } catch { appsCache = null }
    return appsCache
  }

  const launch = async (app, path) => {
    try {
      const r = await fetch('/open-in-app/open', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ app, path }),
      })
      return r.ok
    } catch { return false }
  }

  // —— 菜单（自绘；捕获期外部点击守卫是账号菜单的同款教训）——
  const menuEl = () => document.getElementById(MENU)
  const closeMenu = () => { const m = menuEl(); if (m !== null) m.remove() }
  const wsPath = () => {
    try { return getComputedStyle(document.documentElement).getPropertyValue('--dsh-ws-path').trim() } catch { return '' }
  }

  const toggleMenu = async () => {
    if (menuEl() !== null) { closeMenu(); return }
    const path = wsPath()
    if (path === '') return // 无工作区：不弹（按钮此刻也已隐藏）
    const apps = await loadApps()
    const m = document.createElement('div')
    m.id = MENU
    const head = document.createElement('div')
    head.className = 'oia-head'
    head.textContent = '在本地应用中打开工作区'
    m.append(head)
    if (apps === null || apps.length === 0) {
      const e = document.createElement('div')
      e.className = 'oia-empty'
      e.textContent = '未检测到可用的本地编辑器'
      m.append(e)
    } else {
      const last = remembered()
      for (const id of apps) {
        const it = document.createElement('button')
        it.type = 'button'
        it.className = 'oia-item'
        const img = document.createElement('img')
        img.src = iconUrl(id)
        img.alt = ''
        img.onerror = () => { img.remove(); const ico = document.createElement('span'); ico.className = 'oia-ico'; ico.innerHTML = FALLBACK_ICON; it.insertBefore(ico, it.firstChild) }
        const name = document.createElement('span')
        name.textContent = labelOf(id)
        it.append(img, name)
        if (id === last) {
          const tag = document.createElement('span')
          tag.className = 'oia-last'
          tag.textContent = '上次使用'
          it.append(tag)
        }
        it.addEventListener('click', (e) => {
          e.stopPropagation()
          try { localStorage.setItem(STORE, id) } catch { /* 隐私模式等：不记忆也能用 */ }
          closeMenu()
          void launch(id, path).then((ok) => {
            if (!ok) flashButton('启动失败，请重试')
            else refreshBtnIcon()
          })
        })
        m.append(it)
      }
    }
    const tip = document.createElement('div')
    tip.className = 'oia-tip'
    tip.textContent = path.length > 42 ? path.slice(0, 18) + '…' + path.slice(-22) : path
    tip.title = path
    m.append(tip)
    document.body.append(m)
  }

  // 启动结果轻提示（按钮下方短现即逝）
  let flashTimer = 0
  const flashButton = (text) => {
    const b = document.getElementById(BTN)
    if (b === null) return
    b.title = text
    b.style.outline = '2px solid rgba(207,34,46,.55)'
    b.style.outlineOffset = '1px'
    clearTimeout(flashTimer)
    flashTimer = setTimeout(() => {
      b.style.outline = ''
      b.title = '在本地编辑器中打开当前工作区'
    }, 1800)
  }

  const refreshBtnIcon = () => {
    const b = document.getElementById(BTN)
    if (b === null) return
    setBtnIcon(b, displayApp(appsCache))
  }

  // 外部点击关闭：监听在捕获期（账号菜单同款——冒泡 stopPropagation 拦不住捕获）
  document.addEventListener('click', (e) => {
    const m = menuEl()
    if (m === null) return
    if (e.target instanceof Node && (m === e.target || m.contains(e.target))) return
    closeMenu()
  }, true)
  window.addEventListener('blur', closeMenu)

  // 挂载与自愈：标题栏可能晚于本脚本（整页加载时序）或被 React 重建——
  // rAF 轮询等宿主 + 工作区变量驱动可见性（无工作区隐藏，与标题栏
  // 工作区按钮同一来源 --dsh-ws-path）
  const ensureVisible = () => {
    const b = document.getElementById(BTN)
    if (b !== null) b.style.display = wsPath() === '' ? 'none' : 'inline-flex'
  }
  let queued = false
  const tick = () => {
    queued = false
    ensureBtn()
    ensureVisible()
  }
  const onMutate = () => {
    if (queued) return
    queued = true
    requestAnimationFrame(tick)
  }
  const start = () => {
    new MutationObserver(onMutate).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] })
    onMutate()
  }
  if (document.body !== null) start()
  else document.addEventListener('DOMContentLoaded', start, { once: true })
})()`

/**
 * 把「在本地编辑器中打开」按钮挂到 shell 窗口（每次整页加载后注入；
 * 脚本自幂等，窗口销毁随 webContents 释放）。
 */
export function attachOpenInAppButton(win: BrowserWindow): void {
  const { webContents } = win
  const onDidLoad = (): void => {
    if (win.isDestroyed()) return
    webContents.executeJavaScript(PAGE_JS, true).catch(() => {
      // 页面跳转间隙执行失败属正常，下次加载会重试
    })
  }
  webContents.on('did-finish-load', onDidLoad)
  win.once('closed', () => {
    webContents.removeListener('did-finish-load', onDidLoad)
  })
}
