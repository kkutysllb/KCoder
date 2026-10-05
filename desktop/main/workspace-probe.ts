/**
 * 工作区探针 + 正文文件类型徽章（零侵入注入器）。自 preview-panel 迁出：
 * 文件预览抽屉/Git 面板删除后仍独立存续的两个页面级功能——
 *
 * 1. 工作区探针：选中会话变化（aria-selected，debounce 600ms）→
 *    同源 session/list RPC 解析当前工作目录（选中会话 SessionSummary.cwd，
 *    无会话取最近活跃会话的 cwd）→ 写入 --dsh-ws-name / --dsh-ws-path
 *    （自绘标题栏消费：工作区名前缀 + 工作区按钮）+ console `__dsh_wsprobe__:`
 *    上报主进程转喂 workspaceBase.setWorkspace——skills-catalog 的
 *    工作区项目技能目录以它为当前基准；
 * 2. 正文文件类型徽章：工具卡片文件路径按钮（scoped 类名含 _fileLink，
 *    文本即路径）与正文文件 mention（_fileMention）——按扩展名前置类型
 *    徽章（TS/JS/MD…）与链接配色。React 只管理首文本节点，前置徽章 span
 *    与 dataset 属性不受意；行重挂会重建按钮，MutationObserver 重扫补回。
 *
 * 通道：页面 → 主进程走 console `__dsh_wsprobe__:<json>`（theme-watcher
 * 的 __dsh_ws__ 是工作区按钮 reveal 上报，勿混用）；主进程 → 页面走
 * executeJavaScript 注入 {@link PAGE_JS}。
 *
 * ## 退役记录（2026-10-05）
 *
 * 本文件原有三件事；第 3 件的一半（edit 的 +n/−n 统计徽章）与第 2 件
 * （fetch /api/session/page 拦截 → 上报 sessionId 触发历史补拉）已随该徽章
 * 一并退役：
 *
 * - **为什么退役**：那枚统计徽章与上游 `client-ui-tool` 的 `ToolRow` 自带的
 *   同一行 diff 统计重复（`diffTotals(diff.card.diffs)` → `+added -removed`，
 *   见 `ui-tool/src/client/tool/components/ToolRow.tsx:248-250`）——同一行出现
 *   两枚 +n/−n，用户判定冲突并要求退役（保留上游那份，本产品不再插一份）。
 * - **随之删除**：`window.__dshFileStat` 通道、`statCache`/`applyStat`、
 *   fetch 拦截、以及主进程侧整条只服务于它的数据链（session/page 历史补拉、
 *   /api/changes.summary numstat、turn-end 微型探针、按工作区分桶的活动表）——
 *   见 `workspace-base.ts` 的退役记录与 ARCHITECTURE.md §8。
 * - **不在此列**：类型徽章（TS/JS/MD…）与链接配色**保留**，它们与上游无重复。
 *
 * @module desktop/main/workspace-probe
 */

import type { BrowserWindow } from 'electron'
import { consoleMessageText } from './console-channel'
import { workspaceBase } from './workspace-base'

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
      debounce = window.setTimeout(() => { reportWorkspace() }, 600)
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['aria-selected'] })
    reportWorkspace()
  }
  if (document.body) watchSelection()
  else document.addEventListener('DOMContentLoaded', () => watchSelection(), { once: true })

  /* ---- 正文文件类型徽章 ----
   * 目标：工具卡片文件路径按钮（scoped 类名含 _fileLink 子串，文本即
   * 路径）与正文文件 mention（_fileMention）——两个类名全仓唯一，
   * 按「_+类名」子串匹配对 hash 位置无感（dsh 即时编译产物 hash 在前
   * （_96PAOq_fileLink），vite build 产物 hash 在后，均能命中）。
   * React 只管理首文本节点（单字符串 children 走 nodeValue 更新），
   * 前置徽章 span 与 dataset 属性不受意；行重挂会重建按钮，
   * MutationObserver 重扫补回。
   *
   * 2026-10-05：本段只留**类型徽章 + 链接配色**。原先附在文件路径后的
   * edit +n/−n 统计已退役（上游 ui-tool 的 ToolRow 自带同一行的 diff
   * 统计，同一行出现两枚 → 用户判定冲突），连带 window.__dshFileStat
   * 通道与主进程数据链一并删除；理由与清单见本文件头与 workspace-base.ts。
   * ⚠ 本段在模板串内：注释里禁写裸反引号（会提前截断模板串，TS1005）。 */
  const fbStyle = document.createElement('style')
  fbStyle.id = '__dsh_desktop_filebadge_style'
  fbStyle.textContent = [
    '[class*="_fileLink"], [class*="_fileMention"] { color: #2F6FED !important; font-weight: 500; }',
    'body[data-ds-dark-theme] [class*="_fileLink"], body[data-ds-dark-theme] [class*="_fileMention"] { color: #7C9BFF !important; }',
    '.__dsh-fb { display: inline-block; margin-right: 5px; padding: 1px 4px; border-radius: 4px; font: 600 9px/1.4 ui-monospace, Menlo, monospace; letter-spacing: .3px; background: rgba(47,111,237,.12); color: #2F6FED; vertical-align: .5px; }',
    'body[data-ds-dark-theme] .__dsh-fb { background: rgba(124,155,255,.16); color: #7C9BFF; }',
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
  const extOf = (text) => { const m = /\\.([A-Za-z0-9]{1,5})\\s*$/.exec(text); return m !== null ? m[1].toLowerCase() : null }
  const fbScan = () => {
    const targets = document.querySelectorAll('[class*="_fileLink"], [class*="_fileMention"]')
    for (const btn of targets) {
      const text = (btn.textContent || '').trim()
      if (btn.dataset.dshfb !== '1') {
        const ext = extOf(text)
        if (ext !== null && FB_EXTS[ext] !== undefined) {
          const b = document.createElement('span')
          b.className = '__dsh-fb'
          b.textContent = FB_EXTS[ext]
          btn.insertBefore(b, btn.firstChild)
        }
        btn.dataset.dshfb = '1'
      }
    }
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
 * - console 通道：workspace 上报 → workspaceBase.setWorkspace（当前工作区
 *   基准；skills-catalog 的工作区项目技能目录据此探位）；
 * - did-finish-load：注入 {@link PAGE_JS}（工作区探针 + 正文文件类型徽章）。
 *
 * 2026-10-05：原先还挂 `fileActivity 'activity'` → `window.__dshFileStat`
 * 的 +n/−n 推送与整页回放，随统计徽章一并退役（见文件头退役记录）。
 */
export function attachWorkspaceProbe(win: BrowserWindow): void {
  // 先捕获：closed 时窗口已销毁，再访问 win.webContents getter 会抛
  //（theme-watcher/workspace-header 同款防御）
  const { webContents } = win
  const onConsole = (event: unknown, ...rest: unknown[]): void => {
    const message = consoleMessageText(event, rest)
    if (!message.startsWith(PROBE_PREFIX)) return
    let payload: Record<string, unknown>
    try { payload = JSON.parse(message.slice(PROBE_PREFIX.length)) as Record<string, unknown> } catch { return }
    if (typeof payload.workspace === 'string' || payload.workspace === null) {
      // 工作区基准（skills-catalog 的工作区项目技能目录据此探位）
      const ws = payload.workspace
      workspaceBase.setWorkspace(typeof ws === 'string' && ws !== '' ? ws : null)
    }
  }
  const onDidLoad = (): void => {
    if (win.isDestroyed()) return
    webContents.executeJavaScript(PAGE_JS, true).catch(() => {
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
