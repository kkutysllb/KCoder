/**
 * 会话统计图表面板：hover 输入框下方的 StatsLine 缩略条时，从底部
 * 向上弹出可视化面板，替代上游的纯文本 Tooltip。
 *
 * 零侵入上游：全部逻辑注入 shell 页面执行。
 * - 定位：StatsLine 的分隔符 span（class 含 _sep，root 直接子级）
 *   为结构锚，closest 到第一个 _root 即缩略条本身，三重校验
 *   （parentElement 恒等/计数组文本/高度 ≤48px），hover 热区精确；
 * - 压制上游 Tooltip：在 StatsLine 元素 capture 阶段拦 mouseover/
 *   mouseout 与 focusin/focusout 并 stopPropagation——React 合成事件
 *   走 root 委托监听，事件到不了 root，文本气泡不再触发；仅影响该
 *   元素，CSS :hover 与页面其余交互不受 JS 事件拦截影响。上游 Tooltip
 *   仅在行截断时启用（disabled={!truncated}）：agent 执行中数字增长
 *   → scrollWidth 超宽 → 原生气泡激活，即「有时出现浮动缩略条」的
 *   来源；事件拦截存在重建竞态窗口（React 重建节点到 250ms 防抖
 *   rewire 之间 mouseover 放行 → mouseenter 已派发，而后续 rewire 后
 *   mouseleave 反被拦派发不了 → 气泡弹出且卡屏），故另有气泡本体
 *   狙杀兑底（见 PAGE_JS 内 killNativeBubble：专职 observer 在微任务
 *   时机扫 span[role=tooltip]，文本命中统计行计数特征即隐藏——其他
 *   tooltip（按钮提示等）文本不含该特征，零误伤）；
 * - 数据：解析 StatsLine 的 DOM 文本（zh/en 双格式，对齐上游
 *   formatDuration/formatTokens 的真实输出：45.2s / 2m42s / 1.2K /
 *   3.4M），agent 执行中数字持续更新 → MutationObserver 实时重绘；
 * - 面板：fixed 贴底向上弹出（bottom sheet），pointer-events:none
 *   纯展示，离开缩略条 200ms 后收起；
 * - 脆性边界：上游文案/结构改动 → 解析静默失败，面板显示可解析的
 *   部分（全部失败则不弹），不崩不错位。
 *
 * @module desktop/main/stats-hover
 */

import type { BrowserWindow } from 'electron'

/** 面板样式（注入页面；id 写死避免模板串插值）。定位按可用区自适应：
    内嵌终端面板是叠在上游页面上的 WebContentsView（页面视口不缩），
    terminal-panel 的让位注入器把面板高度广播为 CSS 变量
    (--dsh-terminal-inset)，这里消费——底边抬起不钻到终端面板底下。
    变量纯 CSS 消费，拖拽面板高度时实时重算。 */
const PANEL_CSS = String.raw`
#__dsh_stats_panel {
  position: fixed;
  left: 50%;
  bottom: var(--dsh-terminal-inset, 0px);
  z-index: 2147483646;
  width: min(560px, 92vw); box-sizing: border-box; padding: 10px 14px 8px;
  border: 1px solid #DCE0E6; border-bottom: none; border-radius: 12px 12px 0 0;
  background: #FFFFFF; color: #1A1D21;
  box-shadow: 0 -10px 32px rgba(9, 16, 29, .14);
  font: 12px/1.45 -apple-system, 'PingFang SC', 'Segoe UI', sans-serif;
  opacity: 0; transform: translate(-50%, 12px); pointer-events: none;
  transition: opacity .18s ease, transform .18s ease;
}
#__dsh_stats_panel.on { opacity: 1; transform: translate(-50%, 0); }
body[data-ds-dark-theme] #__dsh_stats_panel {
  background: #212226; color: #E8EAED; border-color: #3A3C42;
  box-shadow: 0 -10px 32px rgba(0, 0, 0, .5);
}
#__dsh_stats_panel .hd { display: flex; align-items: center; gap: 7px; margin-bottom: 7px; font-size: 11px; color: #5F6672; }
body[data-ds-dark-theme] #__dsh_stats_panel .hd { color: #9AA1AC; }
#__dsh_stats_panel .hd b { font-weight: 600; }
#__dsh_stats_panel .live { display: inline-flex; align-items: center; gap: 4px; font-size: 9px; letter-spacing: .5px; }
#__dsh_stats_panel .live i { width: 5px; height: 5px; border-radius: 50%; background: #2E9E5B; animation: __dshPulse 1.6s ease infinite; }
@keyframes __dshPulse { 50% { opacity: .35; } }
#__dsh_stats_panel .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 8px; }
@media (max-width: 480px) { #__dsh_stats_panel .cards { grid-template-columns: repeat(2, 1fr); } }
#__dsh_stats_panel .card { padding: 5px 8px; border: 1px solid #EBEEF1; border-radius: 8px; background: #F9FAFB; }
body[data-ds-dark-theme] #__dsh_stats_panel .card { border-color: #33353B; background: #1A1B1E; }
#__dsh_stats_panel .card b { display: block; font-size: 15px; font-weight: 650; line-height: 1.3; font-variant-numeric: tabular-nums; }
#__dsh_stats_panel .card span { font-size: 10px; color: #5F6672; }
body[data-ds-dark-theme] #__dsh_stats_panel .card span { color: #9AA1AC; }
#__dsh_stats_panel .cols { display: flex; gap: 14px; align-items: flex-start; }
#__dsh_stats_panel .sec { flex: 1; min-width: 0; }
#__dsh_stats_panel .sec > .cap { margin: 0 0 4px; font-size: 10px; color: #5F6672; }
body[data-ds-dark-theme] #__dsh_stats_panel .sec > .cap { color: #9AA1AC; }
#__dsh_stats_panel .brow { display: flex; align-items: center; gap: 7px; margin: 3px 0; }
#__dsh_stats_panel .brow .lb { flex: none; width: 52px; font-size: 10.5px; color: #5F6672; }
body[data-ds-dark-theme] #__dsh_stats_panel .brow .lb { color: #9AA1AC; }
#__dsh_stats_panel .brow .track { flex: 1; height: 6px; border-radius: 3px; background: rgba(31, 35, 41, .08); overflow: hidden; }
body[data-ds-dark-theme] #__dsh_stats_panel .brow .track { background: rgba(232, 234, 237, .1); }
#__dsh_stats_panel .brow .fill { height: 100%; border-radius: 3px; width: 0; transition: width .4s ease; }
#__dsh_stats_panel .brow .v { flex: none; width: 48px; text-align: right; font: 10.5px ui-monospace, Menlo, monospace; font-variant-numeric: tabular-nums; }
#__dsh_stats_panel .ring { flex: none; display: flex; align-items: center; gap: 8px; }
#__dsh_stats_panel .ring svg { display: block; }
#__dsh_stats_panel .rt { font-size: 10px; color: #5F6672; }
body[data-ds-dark-theme] #__dsh_stats_panel .rt { color: #9AA1AC; }
#__dsh_stats_panel .none { margin: 4px 0 2px; font-size: 12px; color: #9AA1AC; text-align: center; }
`

/** 注入脚本（纯 JS：模板串内禁 TS 注解；String.raw 保住正则反斜杠；CSS 经 JSON.stringify 拼入避免嵌套模板串）。 */
const PAGE_JS = String.raw`(() => {
  if (window.__dshStatsHover) return
  window.__dshStatsHover = true

  const PANEL_ID = '__dsh_stats_panel'
  const STYLE_ID = '__dsh_stats_panel_style'
  const CSS = ${JSON.stringify(PANEL_CSS)}
  const DUR = '(\\d+(?:\\.\\d+)?m\\d*s?|\\d+(?:\\.\\d+)?s)'
  const NUM = '(\\d+(?:\\.\\d+)?[KMB]?)'
  const RE_COUNTS = /(\d+)\s*(?:轮|turns)\s*·\s*(\d+)\s*(?:步|steps)/
  const RE_LLM = new RegExp('LLM\\s+' + DUR)
  const RE_TOOL = new RegExp('(?:工具调用|Tool call)\\s+' + DUR)
  const RE_TTFT = new RegExp('(?:首 ?token 平均|TTFT avg)\\s+' + DUR)
  const RE_TPS = /([\d.]+)\s*tok\/s/
  const RE_CACHE = /(?:缓存命中|Cache hit)\s+(\d+)%/
  const RE_IN = new RegExp('(?:输入|Input)\\s+' + NUM + '\\s*tok')
  const RE_OUT = new RegExp('(?:输出|Output)\\s+' + NUM + '\\s*tok')

  const durToSec = (str) => {
    const m = /^(\d+(?:\.\d+)?)m(\d+(?:\.\d+)?)?s?$/.exec(str)
    if (m) return parseFloat(m[1]) * 60 + (m[2] ? parseFloat(m[2]) : 0)
    return parseFloat(str) || 0
  }
  const tokToNum = (str) => {
    const v = parseFloat(str) || 0
    if (str.endsWith('K')) return v * 1e3
    if (str.endsWith('M')) return v * 1e6
    if (str.endsWith('B')) return v * 1e9
    return v
  }
  const fmtTok = (n) => {
    if (n >= 1e6) return (Math.round(n / 1e5) / 10) + 'M'
    if (n >= 1e3) return (Math.round(n / 100) / 10) + 'K'
    return String(Math.round(n))
  }
  const fmtDur = (sec) => {
    if (sec < 60) return (Math.round(sec * 10) / 10) + 's'
    const w = Math.round(sec)
    return Math.floor(w / 60) + 'm' + (w % 60) + 's'
  }
  const parse = (text) => {
    const o = {}
    let m
    if ((m = RE_COUNTS.exec(text))) { o.turns = +m[1]; o.steps = +m[2] }
    if ((m = RE_LLM.exec(text))) o.llmSec = durToSec(m[1])
    if ((m = RE_TOOL.exec(text))) o.toolSec = durToSec(m[1])
    if ((m = RE_TTFT.exec(text))) o.ttftSec = durToSec(m[1])
    if ((m = RE_TPS.exec(text))) o.tps = parseFloat(m[1])
    if ((m = RE_CACHE.exec(text))) o.cachePct = +m[1]
    if ((m = RE_IN.exec(text))) o.inputTok = tokToNum(m[1])
    if ((m = RE_OUT.exec(text))) o.outputTok = tokToNum(m[1])
    return o
  }


  let panel = null
  let refs = null
  let hideTimer = 0
  let source = null
  let textObs = null
  let raf = 0

  const el = (parent, tag, cls, text) => {
    const n = document.createElement(tag)
    if (cls) n.className = cls
    if (text !== undefined) n.textContent = text
    parent.append(n)
    return n
  }

  const ensurePanel = () => {
    if (panel !== null) return
    let style = document.getElementById(STYLE_ID)
    if (style === null) {
      style = document.createElement('style')
      style.id = STYLE_ID
      document.head.append(style)
    }
    style.textContent = CSS
    panel = document.createElement('div')
    panel.id = PANEL_ID
    document.body.append(panel)

    refs = {}
    const hd = el(panel, 'div', 'hd')
    el(hd, 'b', '', '会话统计')
    const live = el(hd, 'span', 'live')
    el(live, 'i', '')
    el(live, 'span', '', '实时')

    refs.cards = el(panel, 'div', 'cards')
    refs.cardDefs = [
      { key: 'turns', label: '轮' },
      { key: 'steps', label: '步' },
      { key: 'ttftSec', label: '首 token 平均', fmt: fmtDur },
      { key: 'tps', label: '解码速度（tok/s）' },
    ].map((d) => {
      const c = el(refs.cards, 'div', 'card')
      return { def: d, val: el(c, 'b', '', '—'), lab: el(c, 'span', '', d.label) }
    })

    const cols = el(panel, 'div', 'cols')
    const secTime = el(cols, 'div', 'sec')
    el(secTime, 'div', 'cap', '耗时分解')
    refs.timeRows = [
      { label: 'LLM', color: '#2F6FED', dark: '#7C9BFF', key: 'llmSec', fmt: fmtDur },
      { label: '工具调用', color: '#D97706', dark: '#F5A623', key: 'toolSec', fmt: fmtDur },
    ].map((d) => {
      const row = el(secTime, 'div', 'brow')
      el(row, 'span', 'lb', d.label)
      const track = el(row, 'div', 'track')
      const fill = el(track, 'div', 'fill')
      return { def: d, fill, val: el(row, 'span', 'v', '') }
    })

    const secTok = el(cols, 'div', 'sec')
    el(secTok, 'div', 'cap', 'Token 用量')
    refs.tokRows = [
      { label: '输入', color: '#2E9E5B', dark: '#52B788', key: 'inputTok', fmt: (v) => fmtTok(v) + ' tok' },
      { label: '输出', color: '#7C6CF0', dark: '#9B8CFF', key: 'outputTok', fmt: (v) => fmtTok(v) + ' tok' },
    ].map((d) => {
      const row = el(secTok, 'div', 'brow')
      el(row, 'span', 'lb', d.label)
      const track = el(row, 'div', 'track')
      const fill = el(track, 'div', 'fill')
      return { def: d, fill, val: el(row, 'span', 'v', '') }
    })

    const ring = el(cols, 'div', 'ring')
    const NS = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('width', '40')
    svg.setAttribute('height', '40')
    svg.setAttribute('viewBox', '0 0 40 40')
    const mk = (cls) => {
      const c = document.createElementNS(NS, 'circle')
      c.setAttribute('cx', '20'); c.setAttribute('cy', '20'); c.setAttribute('r', '16')
      c.setAttribute('fill', 'none'); c.setAttribute('stroke-width', '5')
      svg.append(c)
      return c
    }
    const bg = mk()
    bg.setAttribute('stroke', 'rgba(31,35,41,.1)')
    const fg = mk()
    fg.setAttribute('stroke', '#2E9E5B')
    fg.setAttribute('stroke-linecap', 'round')
    fg.setAttribute('transform', 'rotate(-90 20 20)')
    const C = 2 * Math.PI * 16
    fg.setAttribute('stroke-dasharray', C)
    fg.setAttribute('stroke-dashoffset', C)
    ring.append(svg)
    refs.ring = {
      svg, fg, C,
      wrap: ring,
      pct: el(ring, 'b', '', ''),
      txt: el(ring, 'span', 'rt', '缓存命中率'),
    }
    const txtWrap = el(ring, 'div', 'rt-wrap')
    txtWrap.style.cssText = 'display:flex;flex-direction:column;gap:2px'
    refs.ring.pct.remove()
    refs.ring.txt.remove()
    txtWrap.append(refs.ring.pct, refs.ring.txt)
    ring.append(txtWrap)
    refs.ring.pct.style.cssText = 'font-size:14px;font-weight:650;font-variant-numeric:tabular-nums'

    refs.none = el(panel, 'div', 'none', '')
  }

  const darkMode = () => document.body !== null && document.body.hasAttribute('data-ds-dark-theme')

  const render = () => {
    if (panel === null || source === null) return
    const o = parse(source.textContent || '')
    let any = false
    for (const card of refs.cardDefs) {
      const v = o[card.def.key]
      const has = typeof v === 'number' && v > 0
      card.val.textContent = has ? (card.def.fmt ? card.def.fmt(v) : String(v)) : '—'
      card.val.parentElement.style.opacity = has ? '1' : '.45'
      if (has) any = true
    }
    const paintRows = (rows) => {
      let max = 0
      for (const r of rows) max = Math.max(max, o[r.def.key] || 0)
      for (const r of rows) {
        const v = o[r.def.key] || 0
        const has = v > 0
        r.def.has = has
        r.fill.style.width = has && max > 0 ? Math.max(3, Math.round(v / max * 100)) + '%' : '0'
        r.fill.style.background = darkMode() ? r.def.dark : r.def.color
        r.val.textContent = has ? r.def.fmt(v) : '—'
        r.val.parentElement.style.opacity = has ? '1' : '.45'
        if (has) any = true
      }
    }
    paintRows(refs.timeRows)
    paintRows(refs.tokRows)
    if (typeof o.cachePct === 'number') {
      refs.ring.wrap.style.display = ''
      refs.ring.fg.setAttribute('stroke', darkMode() ? '#52B788' : '#2E9E5B')
      refs.ring.fg.setAttribute('stroke-dashoffset', String(refs.ring.C * (1 - o.cachePct / 100)))
      refs.ring.pct.textContent = o.cachePct + '%'
      any = true
    } else {
      refs.ring.wrap.style.display = 'none'
    }
    refs.none.style.display = any ? 'none' : ''
    refs.none.textContent = '暂无统计数据（会话开始工作后此处实时更新）'
  }

  const show = () => {
    ensurePanel()
    if (source !== null) render()
    panel.classList.add('on')
  }
  const hide = () => {
    if (panel !== null) panel.classList.remove('on')
  }

  const scheduleHide = () => {
    clearTimeout(hideTimer)
    // :hover 复核：mouseout 未及触发（如元素在指针下被替换）时兜底
    hideTimer = setTimeout(() => {
      if (source !== null && source.isConnected && source.matches(':hover')) return
      hide()
    }, 200)
  }
  const cancelHide = () => clearTimeout(hideTimer)

  const watchText = (node) => {
    source = node
    if (textObs !== null) textObs.disconnect()
    textObs = new MutationObserver(() => {
      if (panel === null || !panel.classList.contains('on')) return
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(render)
    })
    textObs.observe(node, { childList: true, characterData: true, subtree: true })
  }

  /* ---------- 挂载：_sep 结构锚点定位 StatsLine ----------
     不再泛扫 _root（会话根/输入卡同名，后代文本同含统计，文本边界
     情况下仍可能 wire 到大容器，热区外溢到输入框）。StatsLine 源码
     的稳定结构锚：分隔符 span（class 含 _sep）是缩略条 root 的直接
     子级——从 sep 向上 closest 到第一个 _root 即缩略条本身，再三重
     校验：① parentElement 恒等（源码结构，closest 越过缩略条直达
     大容器时必 false——宁可不挂也不错挂，静默降级回上游原生）；
     ② 计数组文本；③ 高度 ≤48px（细条特征，输入卡容器 100px+） */
  const RE_LINE = /(\d+)\s*(?:轮|turns)\s*·\s*(\d+)\s*(?:步|steps)/
  const wire = (node) => {
    node.dataset.dshstats = '1'
    node.addEventListener('mouseover', (ev) => {
      ev.stopPropagation()
      cancelHide()
      if (source !== node) watchText(node)
      show()
    }, true)
    node.addEventListener('mouseout', (ev) => {
      ev.stopPropagation()
      if (node.contains(ev.relatedTarget)) return
      scheduleHide()
    }, true)
    // focusin/focusout 补拦：上游 Tooltip 的 onFocus 是无延迟即时显示
    // 路径（React 经 focusin 委托派发）。StatsLine 子树当前无可聚焦
    // 元素，拦之为纯预防——未来上游加 tabIndex 时仍不漏。
    node.addEventListener('focusin', (ev) => { ev.stopPropagation() }, true)
    node.addEventListener('focusout', (ev) => { ev.stopPropagation() }, true)
  }
  /* ---------- 上游原生浮动气泡狙杀（重建竞态兑底） ----------
     事件拦截的竞态窗口（re­wire 前 mouseenter 已派发、re­wire 后
     mouseleave 派发不了）会让上游气泡弹出且卡屏，事件层无法完全
     堵死，对气泡本体兑底：专职 observer 在微任务时机检查新增节点，
     是 span[role=tooltip] 且文本命中统计行计数特征（RE_LINE，上游
     label 恒为含「N 轮 · M 步」的完整行）即 inline display:none。
     React 只 patch 自己认识的 style 属性（left/top/maxWidth），
     inline display 不会被气泡位置更新清除；dataset 标记防重入，
     卸载重挂的新节点重新狙杀。agent 执行中 DOM 变更频繁，回调只看
     addedNodes（自身或后代命中），不做全量扫描；scan() 的 250ms
     节流里再全量兑一次，覆盖注入时已卡屏的现场。 */
  const killNativeBubble = (root) => {
    const tips = root !== undefined
      ? (root.getAttribute('role') === 'tooltip' ? [root] : Array.from(root.querySelectorAll('span[role="tooltip"]')))
      : Array.from(document.querySelectorAll('span[role="tooltip"]'))
    for (const tip of tips) {
      if (tip.dataset.dshstatskilled === '1') continue
      if (!RE_LINE.test(tip.textContent || '')) continue
      tip.dataset.dshstatskilled = '1'
      tip.style.display = 'none'
    }
  }
  new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType === 1) killNativeBubble(n)
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true })
  killNativeBubble()

  const scan = () => {
    // 气泡兑底全量补扫（覆盖注入时已卡屏的现场；专职 observer 只看
    // 增量，这里兑住存量）
    killNativeBubble()
    // 源元素被 SPA 导航移除：收起并断开观察（无 mouseout 可依赖）
    if (source !== null && !source.isConnected) {
      hide()
      source = null
      if (textObs !== null) textObs.disconnect()
    }
    for (const sep of document.querySelectorAll('[class*="_sep"]')) {
      const cand = sep.closest('[class*="_root"]')
      if (cand === null || cand.dataset.dshstats === '1') continue
      if (sep.parentElement !== cand) continue
      const text = cand.textContent
      if (text === null || !RE_LINE.test(text)) continue
      if (cand.getBoundingClientRect().height > 48) continue
      wire(cand)
    }
  }
  let scanTimer = 0
  new MutationObserver(() => {
    clearTimeout(scanTimer)
    scanTimer = setTimeout(scan, 250)
  }).observe(document.documentElement, { childList: true, subtree: true })
  scan()
})()`

/**
 * 给 shell 窗口挂统计图表面板（每次整页加载后重新注入，脚本自幂等；
 * 重复调用安全，窗口销毁时旧监听随窗口离开）。
 */
export function attachStatsHover(win: BrowserWindow): void {
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
