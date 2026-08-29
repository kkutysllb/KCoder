/**
 * 工作区探针 + 正文文件徽章（零侵入注入器）。自 preview-panel 迁出：
 * 文件预览抽屉/Git 面板删除后仍独立存续的三个页面级功能——
 *
 * 1. 工作区探针：选中会话变化（aria-selected，debounce 600ms）→
 *    同源 session/list RPC 解析当前工作目录（选中会话 SessionSummary.cwd，
 *    无会话取最近活跃会话的 cwd）→ 写入 --dsh-ws-name / --dsh-ws-path
 *    （自绘标题栏消费：工作区名前缀 + 工作区按钮）+ console `__dsh_wsprobe__:`
 *    上报主进程转喂 fileActivity.setWorkspace——skills-catalog 的
 *    工作区项目技能目录与正文徽章的活动分桶都以它为当前基准；
 *    选中会话变化同时上报 sessionId（首屏/路由直开会话不经 fetch 时
 *    兜住历史补拉触发源；主进程短窗去重，重复无害）；
 * 2. 历史补拉拦截：fetch /api/session/page（页面打开/翻页会话时；
 *    alpha.1 起 session.history 已换）→ 从 typert 命名参提取
 *    address.sessionId → fileActivity.fetchHistory（mux 不重放历史，
 *    徽章的历史 +n/−n 靠这里补回；请求本身放行）；
 * 3. 正文文件徽章：工具卡片文件路径按钮（scoped 类名含 _fileLink，
 *    文本即路径）与正文文件 mention（_fileMention）——类型徽章 +
 *    edit 增删行数（+n/−n）。实时数据由主进程 fileActivity 'activity'
 *    事件推送（按工作区分桶过滤），整页加载后全量回放（会话恢复的
 *    历史消息也能拿到最近 stat）。React 只管理首文本节点，前置徽章
 *    span 与 dataset 属性不受意；行重挂会重建按钮，MutationObserver
 *    重扫补回。
 *
 * 通道：页面 → 主进程走 console `__dsh_wsprobe__:<json>`（theme-watcher
 * 的 __dsh_ws__ 是工作区按钮 reveal 上报，勿混用）；主进程 → 页面走
 * executeJavaScript 调 window.__dshFileStat。
 *
 * @module desktop/main/workspace-probe
 */

import type { BrowserWindow } from 'electron'
import { consoleMessageText } from './console-channel'
import { fileActivity } from './file-activity'
import type { PreviewEntry } from '@shared/ipc-contract'

/** console 通道前缀（与注入脚本约定；独立于 theme-watcher 的 __dsh_ws__）。 */
const PROBE_PREFIX = '__dsh_wsprobe__:'

/**
 * 页面注入脚本（上游 shell 页面上下文；纯 JS：模板串内禁 TS 注解）。
 * 工作区探针 + 历史补拉拦截 + 正文文件徽章（无状态栏按钮——面板已删）。
 */
const PAGE_JS = `(() => {
  if (window.__dshWsProbeWired) return
  window.__dshWsProbeWired = true
  const report = (obj) => { console.log('__dsh_wsprobe__:' + JSON.stringify(obj)) }

  /* ---- 当前会话 → 工作区解析（同源 RPC） ---- */
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
  // alpha.1 契约：workspace.list 一次性 RPC 已移除（仅剩流式 follow，
  // 浏览器侧流走 WebSocket mux，裸 fetch 不可达）；改调一次性 session/list，
  // SessionSummary 自带 cwd。wire：endpoint 路径段以 / 分隔（段内禁 .），
  // typert payload 须 { args: { _request: {...} } } 命名参格式（均已实测）。
  const resolveWorkspace = async () => {
    const res = await fetch('/api/session/list', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request', rpcId: 'kcoder-probe-' + (++rpcSeq),
        method: 'session/list', payload: { args: { _request: {} } },
      }),
    })
    if (!res.ok) return null
    const envelope = await res.json().catch(() => null)
    const result = envelope != null && envelope.result != null ? envelope.result : null
    const items = result != null && result.ok === true && result.value != null
      && Array.isArray(result.value.items) ? result.value.items : null
    if (items == null || items.length === 0) return null
    const usable = items.filter(it => it != null && typeof it.sessionId === 'string'
      && typeof it.cwd === 'string' && it.cwd !== '')
    if (usable.length === 0) return null
    const sessionId = probeSessionId()
    const bySession = sessionId !== null
      ? usable.find(it => it.sessionId === sessionId) ?? null
      : null
    const latest = usable.slice()
      .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))[0]
    const workspace = bySession != null ? bySession : latest
    return { path: workspace.cwd, title: '' }
  }

  let debounce = 0
  const reportWorkspace = () => {
    resolveWorkspace()
      .then(ws => {
        // 工作区名写 CSS 变量：自绘标题栏拼接「工作区 / 标题」前缀
        //（--dsh-sidebar-w 同款跨注入器通道；style 属性变化会触发
        // 标题栏既有 observer 重渲染；title 空时兜底 path 尾段）
        const segs = ws == null ? [] : ws.path.split('/').filter(Boolean)
        const name = ws != null && ws.title !== '' ? ws.title
          : segs.length > 0 ? segs[segs.length - 1] : ''
        document.documentElement.style.setProperty('--dsh-ws-name', name)
        // 完整路径同步写入：标题栏工作区按钮的点击目标（打开目录）
        document.documentElement.style.setProperty('--dsh-ws-path', ws != null ? ws.path : '')
        report(ws == null ? { workspace: null } : { workspace: ws.path })
      })
      .catch(() => {})
  }
  const watchSelection = () => {
    new MutationObserver(() => {
      window.clearTimeout(debounce)
      debounce = window.setTimeout(() => {
        reportWorkspace()
        // 会话打开/切换的历史补拉兜底：首屏或路由直开会话不经 fetch，
        // 选中会话直接从 treeitem fiber 上报（主进程短窗去重，重复无害）
        const sid = probeSessionId()
        if (sid !== null) report({ action: 'session', sessionId: sid })
      }, 600)
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['aria-selected'] })
    reportWorkspace()
  }
  if (document.body) watchSelection()
  else document.addEventListener('DOMContentLoaded', () => watchSelection(), { once: true })

  /* ---- 历史会话补拉：拦 session/page RPC → 上报 sessionId ----
   * （alpha.1 起 session.history 换成 session/page：address + throughSeq
   * 语义，sessionId 藏在 typert 命名参 payload.args.request.address；
   * mux 不重放历史，主进程自己发同一 RPC 补回活动与徽章数据，
   * diff 内容可能很大不走 console 通道；请求本身放行） */
  const origFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    try {
      const url = typeof input === 'string' ? input
        : input instanceof Request ? input.url : String(input)
      if (!url.includes('/api/') || url.includes('/api/events.')) return origFetch(input, init)
      const method = (init != null && typeof init.method === 'string' ? init.method
        : input instanceof Request ? input.method : 'GET').toUpperCase()
      if (method !== 'POST') return origFetch(input, init)
      const bodyText = input instanceof Request
        ? input.clone().text()
        : Promise.resolve(init != null && typeof init.body === 'string' ? init.body : '')
      return bodyText.then(text => {
        let rpc = null
        try { rpc = JSON.parse(text) } catch { /* 非 JSON 放行 */ }
        const m = rpc !== null && typeof rpc.method === 'string' ? rpc.method : null
        if (m === 'session/page') {
          // 仅主会话地址上报（kind==='session'）；子代理地址需 parent 且
          // 主进程 fetchHistory 对非 session- 前缀直接跳过，不上报省噪音
          const addr = rpc != null && rpc.payload != null && typeof rpc.payload === 'object'
            && rpc.payload.args != null && typeof rpc.payload.args === 'object'
            && rpc.payload.args.request != null && typeof rpc.payload.args.request === 'object'
            && rpc.payload.args.request.address != null && typeof rpc.payload.args.request.address === 'object'
            ? rpc.payload.args.request.address : null
          const sid = addr !== null && addr.kind === 'session'
            && typeof addr.sessionId === 'string' ? addr.sessionId : null
          if (sid !== null) report({ action: 'session', sessionId: sid })
        }
        return origFetch(input, init)
      }).catch(() => origFetch(input, init))
    } catch { return origFetch(input, init) }
  }

  /* ---- 正文文件徽章：类型徽章 + edit +n/−n ----
   * 目标：工具卡片文件路径按钮（scoped 类名含 _fileLink 子串，文本即
   * 路径）与正文文件 mention（_fileMention）——两个类名全仓唯一，
   * 按「_+类名」子串匹配对 hash 位置无感（dsh 即时编译产物 hash 在前
   * （_96PAOq_fileLink），vite build 产物 hash 在后，均能命中）。
   * React 只管理首文本节点（单字符串 children 走 nodeValue 更新），
   * 前置徽章 span 与 dataset 属性不受意；行重挂会重建按钮，
   * MutationObserver 重扫补回。 */
  const fbStyle = document.createElement('style')
  fbStyle.id = '__dsh_desktop_filebadge_style'
  fbStyle.textContent = [
    '[class*="_fileLink"], [class*="_fileMention"] { color: #2F6FED !important; font-weight: 500; }',
    'body[data-ds-dark-theme] [class*="_fileLink"], body[data-ds-dark-theme] [class*="_fileMention"] { color: #7C9BFF !important; }',
    '.__dsh-fb { display: inline-block; margin-right: 5px; padding: 1px 4px; border-radius: 4px; font: 600 9px/1.4 ui-monospace, Menlo, monospace; letter-spacing: .3px; background: rgba(47,111,237,.12); color: #2F6FED; vertical-align: .5px; }',
    'body[data-ds-dark-theme] .__dsh-fb { background: rgba(124,155,255,.16); color: #7C9BFF; }',
    '.__dsh-fb-stat { display: inline-block; margin-left: 6px; font: 500 10px/1.4 ui-monospace, Menlo, monospace; white-space: nowrap; }',
    '.__dsh-fb-stat .a { color: #1A7F37; }',
    'body[data-ds-dark-theme] .__dsh-fb-stat .a { color: #3FB950; }',
    '.__dsh-fb-stat .d { color: #CF222E; margin-left: 3px; }',
    'body[data-ds-dark-theme] .__dsh-fb-stat .d { color: #F85149; }',
  ].join('')
  document.head.append(fbStyle)

  const FB_EXTS = {
    ts: 'TS', tsx: 'TSX', mts: 'TS', cts: 'TS',
    js: 'JS', jsx: 'JSX', mjs: 'JS', cjs: 'JS',
    json: 'JSON', css: 'CSS', scss: 'SCSS', less: 'LESS',
    html: 'HTML', xml: 'XML', svg: 'SVG', md: 'MD',
    py: 'PY', rb: 'RB', go: 'GO', rs: 'RS', java: 'JAVA',
    c: 'C', h: 'H', cpp: 'C++', cc: 'C++', hpp: 'C++', cs: 'C#',
    swift: 'SWIFT', kt: 'KT', sh: 'SH', zsh: 'SH',
    yml: 'YAML', yaml: 'YAML', toml: 'TOML', sql: 'SQL', lua: 'LUA', php: 'PHP',
  }
  const statCache = new Map() /* basename(lower) -> {a, d} */
  const baseOf = (p) => { const parts = String(p).split('/'); return parts[parts.length - 1].toLowerCase() }
  const extOf = (text) => { const m = /\\.([A-Za-z0-9]{1,5})\\s*$/.exec(text); return m !== null ? m[1].toLowerCase() : null }
  const applyStat = (btn, stat) => {
    let el = btn.querySelector('.__dsh-fb-stat')
    if (stat === null) { if (el !== null) el.remove(); return }
    if (el === null) { el = document.createElement('span'); el.className = '__dsh-fb-stat'; btn.append(el) }
    el.replaceChildren()
    const a = document.createElement('span'); a.className = 'a'; a.textContent = '+' + stat.a
    const d = document.createElement('span'); d.className = 'd'; d.textContent = '\\u2212' + stat.d
    el.append(a, d)
  }
  const fbScan = () => {
    const targets = document.querySelectorAll('[class*="_fileLink"], [class*="_fileMention"]')
    for (const btn of targets) {
      const text = (btn.textContent || '').trim()
      if (btn.dataset.dshfb !== '1') {
        // 首见：记录原始 basename（后续 textContent 含徽章文本，不可重提）
        btn.dataset.dshname = baseOf(text)
        const ext = extOf(text)
        if (ext !== null && FB_EXTS[ext] !== undefined) {
          const b = document.createElement('span')
          b.className = '__dsh-fb'
          b.textContent = FB_EXTS[ext]
          btn.insertBefore(b, btn.firstChild)
        }
        btn.dataset.dshfb = '1'
      }
      if (btn.dataset.dshname !== undefined) {
        applyStat(btn, statCache.get(btn.dataset.dshname) ?? null)
      }
    }
  }
  window.__dshFileStat = (path, added, removed) => {
    statCache.set(baseOf(path), { a: added, d: removed })
    fbScan()
  }
  let fbDebounce = 0
  const fbObserve = () => {
    new MutationObserver(() => {
      clearTimeout(fbDebounce)
      fbDebounce = setTimeout(fbScan, 300)
    }).observe(document.body, { childList: true, subtree: true })
    fbScan()
  }
  if (document.body) fbObserve()
  else document.addEventListener('DOMContentLoaded', () => fbObserve(), { once: true })
})()`

/**
 * 把探针挂到 shell 窗口：
 * - console 通道：workspace 上报 → fileActivity.setWorkspace（当前
 *   工作区基准）；session 上报 → fileActivity.fetchHistory（补历史）；
 * - did-finish-load：注入 PAGE_JS + 正文徽章全量回放（页面脚本
 *   就绪后 statCache 重建，会话恢复的历史消息也拿到最近 stat）；
 * - fileActivity 'activity'：当前工作区的 edit 活动 → 页面
 *   __dshFileStat（+n/−n；其他工作区的后台活动不进当前正文，防互串）。
 */
export function attachWorkspaceProbe(win: BrowserWindow): void {
  // 先捕获：closed 时窗口已销毁，再访问 win.webContents getter 会抛
  //（theme-watcher/workspace-header 同款防御）
  const { webContents } = win
  const pushFileStat = (path: string, added: number, removed: number): void => {
    if (win.isDestroyed()) return
    webContents.executeJavaScript(
      `window.__dshFileStat && window.__dshFileStat(${JSON.stringify(path)}, ${String(added)}, ${String(removed)})`,
      true,
    ).catch(() => {
      // 页面跳转间隙执行失败属正常，下次活动/加载会重推
    })
  }
  const onConsole = (event: unknown, ...rest: unknown[]): void => {
    const message = consoleMessageText(event, rest)
    if (!message.startsWith(PROBE_PREFIX)) return
    let payload: Record<string, unknown>
    try { payload = JSON.parse(message.slice(PROBE_PREFIX.length)) as Record<string, unknown> } catch { return }
    if (typeof payload.workspace === 'string' || payload.workspace === null) {
      // 工作区缓存：file-activity 的当前工作区基准（技能目录/徽章分桶）
      const ws = payload.workspace
      fileActivity.setWorkspace(typeof ws === 'string' && ws !== '' ? ws : null)
      return
    }
    if (payload.action === 'session') {
      // 页面打开/切换会话：补拉该会话历史的活动（含徽章数据）
      const sid = typeof payload.sessionId === 'string' && payload.sessionId !== '' ? payload.sessionId : null
      if (sid !== null) void fileActivity.fetchHistory(sid)
    }
  }
  const onActivity = (entry: PreviewEntry, wsKey: string): void => {
    if (wsKey !== fileActivity.activeKey()) return
    if (entry.kind === 'edit') pushFileStat(entry.path, entry.added, entry.removed)
  }
  const onDidLoad = (): void => {
    if (win.isDestroyed()) return
    webContents.executeJavaScript(PAGE_JS, true).catch(() => {
      // 页面跳转间隙执行失败属正常，下次加载会重试
    })
    // 正文文件徽章：当前工作区历史活动的 +n/−n 全量回放
    for (const e of fileActivity.list()) {
      if (e.kind === 'edit') pushFileStat(e.path, e.added, e.removed)
    }
  }
  webContents.on('console-message', onConsole)
  webContents.on('did-finish-load', onDidLoad)
  fileActivity.on('activity', onActivity)
  win.once('closed', () => {
    webContents.removeListener('console-message', onConsole)
    webContents.removeListener('did-finish-load', onDidLoad)
    fileActivity.removeListener('activity', onActivity)
  })
}
