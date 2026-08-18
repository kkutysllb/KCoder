/**
 * 文件预览视图（#/preview，承载于 shell 窗口右侧的 WebContentsView）：
 * agent 读/编辑文件的活动流 + 内容预览（codex 预览面板同款），
 * 双模式展示——文件（活动流）/ 轨迹（当前会话的消息与工具时间线）。
 *
 * - 模式：主进程 previewPanel.mode（状态栏两枚按钮切换，抽屉头也有
 *   文件/轨迹两枚 chip 同步切换）；onPreviewMode 跟随；
 * - 活动数据：IPC preview:entries / preview:activity（主进程
 *   file-activity 聚合，同文件取最新，按工作区分桶——切换工作区时
 *   preview:refresh 通知重拉）；内容按需 preview:read-file
 *   读盘（跟随刷新 = 同文件新事件到达即重渲）；
 * - read 条目 → 文件当前内容（整段高亮后按行拆分，行号列）；
 *   edit 条目 → 行级 diff（上游 applied hunk：oldText/newText），
 *   可切"查看当前文件"；diff 行取对应侧的整段高亮行（颜色不失真）；
 * - 轨迹数据：trajectory:fetch / trajectory:update（当前会话的
 *   user/assistant/tool 事件摘要，回合分组；新事件实时追加，
 *   用户停在底部时自动跟随滚动）；
 * - 高亮：highlight.js common 集；语言来自上游 read 视图提示或扩展名
 *   推断，未知语言降级纯文本；
 * - 主题：prefers-color-scheme 双套 token（theme-watcher 已把
 *   nativeTheme 与上游主题同步）；token 色自写（不引 hljs 官方主题，
 *   避免亮暗双主题样式冲突）；
 * - 左缘 4px 拖条调宽度（增量上报，主进程 clamp + 持久化）。
 *
 * @module desktop/renderer/src/views/preview
 */

import hljs from 'highlight.js/lib/common'
import { bridge } from '../bridge'
import type { PreviewEntry, PreviewMode, TrajectoryRow, TrajectorySnapshot } from '@shared/ipc-contract'

/** 视图内样式（独立于 app.css：此页是预览抽屉专用布局）。 */
const PAGE_CSS = `
html, body { height: 100%; margin: 0; overflow: hidden; }
#app { height: 100%; display: flex; flex-direction: row; font: 400 12px/1.55 -apple-system, "PingFang SC", "Segoe UI", sans-serif; color: var(--pv-fg); background: var(--pv-bg); }
#app { --pv-bg: #FFFFFF; --pv-header: #F9FAFB; --pv-fg: #1A1D21; --pv-border: rgba(0,0,0,.10); --pv-muted: rgba(26,29,33,.55); --pv-chip: rgba(128,128,128,.14); --pv-code-bg: #FBFBFC; --pv-add-bg: rgba(46,160,67,.13); --pv-add-fg: #1A7F37; --pv-del-bg: rgba(248,81,73,.13); --pv-del-fg: #CF222E; --pv-line: rgba(128,128,128,.38); --pv-hover: rgba(128,128,128,.12); }
@media (prefers-color-scheme: dark) {
#app { --pv-bg: #151517; --pv-header: #1B1B1C; --pv-fg: #E8EAED; --pv-border: #2C2C2E; --pv-muted: rgba(232,234,237,.55); --pv-chip: rgba(128,128,128,.18); --pv-code-bg: #131315; --pv-add-bg: rgba(46,160,67,.16); --pv-add-fg: #3FB950; --pv-del-bg: rgba(248,81,73,.15); --pv-del-fg: #F85149; --pv-line: rgba(128,128,128,.32); --pv-hover: rgba(128,128,128,.16); }
}
.pv-grip { width: 4px; flex: none; cursor: col-resize; background: var(--pv-border); }
.pv-grip:hover, .pv-grip[data-drag="1"] { background: var(--pv-muted); }
.pv-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.pv-header { flex: none; height: 34px; display: flex; align-items: center; gap: 8px; padding: 0 8px 0 12px; background: var(--pv-header); border-bottom: 1px solid var(--pv-border); user-select: none; }
.pv-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; font-size: 12px; }
.pv-title .pv-kind { font-weight: 400; color: var(--pv-muted); margin-right: 6px; }
.pv-btn { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; height: 22px; padding: 0 9px; border-radius: 6px; cursor: pointer; font-size: 11px; color: var(--pv-muted); flex: none; }
.pv-btn:hover { background: var(--pv-hover); color: var(--pv-fg); }
.pv-btn[data-on="1"] { background: var(--pv-chip); color: var(--pv-fg); }
.pv-files { flex: none; display: flex; align-items: center; gap: 4px; padding: 5px 8px; border-bottom: 1px solid var(--pv-border); overflow-x: auto; scrollbar-width: none; background: var(--pv-header); }
.pv-files::-webkit-scrollbar { display: none; }
.pv-chip { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 8px; border-radius: 7px; cursor: pointer; flex: none; font-size: 11px; max-width: 190px; }
.pv-chip:hover { background: var(--pv-hover); }
.pv-chip[data-active="1"] { background: var(--pv-chip); }
.pv-chip .pv-chip-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pv-badge { display: inline-flex; gap: 4px; font-family: Menlo, Monaco, "DejaVu Sans Mono", monospace; font-size: 10px; flex: none; }
.pv-badge .pv-a { color: var(--pv-add-fg); }
.pv-badge .pv-d { color: var(--pv-del-fg); }
.pv-body { flex: 1; min-height: 0; overflow: auto; font: 400 12px/1.6 Menlo, Monaco, "DejaVu Sans Mono", "Courier New", monospace; background: var(--pv-code-bg); }
.pv-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; height: 100%; color: var(--pv-muted); font-size: 12px; }
.pv-note { padding: 6px 12px; color: var(--pv-muted); font-size: 11px; background: var(--pv-bg); border-bottom: 1px solid var(--pv-border); font-family: -apple-system, "PingFang SC", sans-serif; user-select: none; }
.pv-table { width: 100%; border-collapse: collapse; }
.pv-table td { padding: 0; vertical-align: top; border-bottom: none; text-align: left; }
.pv-ln { width: 1%; min-width: 40px; padding: 0 8px 0 10px !important; text-align: right; color: var(--pv-line); user-select: none; white-space: nowrap; }
.pv-ln2 { border-left: 1px solid var(--pv-border); border-right: 1px solid var(--pv-border); }
.pv-code { padding: 0 12px 0 10px !important; white-space: pre; }
.pv-row-add .pv-code, .pv-row-add .pv-ln { background: var(--pv-add-bg); }
.pv-row-del .pv-code, .pv-row-del .pv-ln { background: var(--pv-del-bg); }
.pv-mark { display: inline-block; width: 14px; text-align: center; color: var(--pv-add-fg); user-select: none; }
.pv-row-del .pv-mark { color: var(--pv-del-fg); }
/* highlight.js token 色（亮暗两套，替代官方主题避免双主题冲突） */
.hljs-comment, .hljs-quote { color: #6A737D; font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-literal, .hljs-section, .hljs-doctag, .hljs-type, .hljs-name, .hljs-strong { color: #D73A49; }
.hljs-string, .hljs-regexp, .hljs-addition, .hljs-attribute, .hljs-meta .hljs-string { color: #032F62; }
.hljs-number, .hljs-symbol, .hljs-bullet, .hljs-variable, .hljs-template-variable, .hljs-selector-attr, .hljs-selector-pseudo, .hljs-link { color: #E36209; }
.hljs-title, .hljs-title.class_, .hljs-title.function_ { color: #6F42C1; }
.hljs-built_in, .hljs-class .hljs-title { color: #E36209; }
.hljs-attr, .hljs-property { color: #005CC5; }
.hljs-meta { color: #6A737D; }
@media (prefers-color-scheme: dark) {
.hljs-comment, .hljs-quote { color: #8B949E; }
.hljs-keyword, .hljs-selector-tag, .hljs-literal, .hljs-section, .hljs-doctag, .hljs-type, .hljs-name, .hljs-strong { color: #FF7B72; }
.hljs-string, .hljs-regexp, .hljs-addition, .hljs-attribute, .hljs-meta .hljs-string { color: #A5D6FF; }
.hljs-number, .hljs-symbol, .hljs-bullet, .hljs-variable, .hljs-template-variable, .hljs-selector-attr, .hljs-selector-pseudo, .hljs-link { color: #FFA657; }
.hljs-title, .hljs-title.class_, .hljs-title.function_ { color: #D2A8FF; }
.hljs-built_in, .hljs-class .hljs-title { color: #FFA657; }
.hljs-attr, .hljs-property { color: #79C0FF; }
.hljs-meta { color: #8B949E; }
}
/* markdown 渲染视图（read 条目/“查看当前文件”的 .md 分流；计划文档
   主战场）：文档型排版替代行号表格，代码块沿用 hljs token 色 */
.pv-md { padding: 16px 18px 28px; font-family: -apple-system, "PingFang SC", "Segoe UI", sans-serif; font-size: 14px; line-height: 22px; background: var(--pv-bg); color: var(--pv-fg); }
.pv-md h1, .pv-md h2, .pv-md h3, .pv-md h4 { margin: 18px 0 8px; line-height: 1.35; }
.pv-md h1 { font-size: 21px; padding-bottom: 6px; border-bottom: 1px solid var(--pv-border); }
.pv-md h2 { font-size: 19px; padding-bottom: 5px; border-bottom: 1px solid var(--pv-border); }
.pv-md h3 { font-size: 17px; }
.pv-md h4 { font-size: 15px; color: var(--pv-muted); }
.pv-md h1:first-child, .pv-md h2:first-child, .pv-md h3:first-child { margin-top: 2px; }
.pv-md p { margin: 8px 0; }
.pv-md ul, .pv-md ol { margin: 8px 0; padding-left: 22px; }
.pv-md li { margin: 3px 0; }
.pv-md li.pv-task { list-style: none; margin-left: -18px; }
.pv-md .pv-box { display: inline-block; width: 13px; height: 13px; border-radius: 3.5px; border: 1.5px solid var(--pv-muted); margin-right: 7px; vertical-align: -2px; }
.pv-md .pv-box[data-x="1"] { background: var(--pv-add-fg); border-color: var(--pv-add-fg); }
.pv-md .pv-box[data-x="1"]::after { content: ''; display: inline-block; width: 3.5px; height: 7px; border-right: 1.8px solid #FFF; border-bottom: 1.8px solid #FFF; transform: rotate(40deg) translateY(-.5px); margin: 1px auto 0; }
.pv-md blockquote { margin: 8px 0; padding: 2px 12px; border-left: 3px solid var(--pv-border); color: var(--pv-muted); background: var(--pv-code-bg); border-radius: 0 6px 6px 0; }
.pv-md blockquote p { margin: 6px 0; }
.pv-md code { font-family: Menlo, Monaco, "DejaVu Sans Mono", monospace; font-size: 12px; background: var(--pv-chip); border-radius: 4px; padding: 1.5px 5px; }
.pv-md pre { margin: 10px 0; padding: 10px 12px; background: var(--pv-code-bg); border: 1px solid var(--pv-border); border-radius: 8px; overflow-x: auto; }
.pv-md pre code { background: none; padding: 0; font-size: 12px; line-height: 1.65; }
.pv-md hr { border: none; border-top: 1px solid var(--pv-border); margin: 14px 0; }
.pv-md a { color: var(--pv-fg); text-decoration: underline; text-underline-offset: 2px; }
.pv-md table { margin: 10px 0; border-collapse: collapse; font-size: 13px; }
.pv-md th, .pv-md td { border: 1px solid var(--pv-border); padding: 5px 10px; text-align: left; }
.pv-md th { background: var(--pv-header); font-weight: 600; }
.pv-md strong { font-weight: 650; }
/* 兼容性兜底：未识别成标签的原文长串（URL/哈希等）不撑破抽屉 */
.pv-md p, .pv-md li, .pv-md td, .pv-md th { overflow-wrap: break-word; }
.pv-md img { max-width: 100%; border-radius: 6px; }
/* 轨迹时间线（抽屉的轨迹模式；语义色块：问=蓝 / 答=紫 / 工具=状态色；
   非等宽字体，覆盖 .pv-body 的 mono；左侧色条用 inset box-shadow
   （border 全行 1px 占位恒定，不挤内容） */
.tj-list { flex: 1; min-height: 0; overflow-y: auto; background: var(--pv-bg); padding: 4px 10px 16px; font-family: -apple-system, "PingFang SC", "Segoe UI", sans-serif; }
/* 回合分隔：前圆点 + 文字 + 渐隐线 */
.tj-turn { display: flex; align-items: center; gap: 7px; margin: 16px 0 7px; color: var(--pv-muted); font-size: 10px; letter-spacing: .5px; user-select: none; }
.tj-turn::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: var(--pv-muted); flex: none; }
.tj-turn::after { content: ''; flex: 1; height: 1px; background: linear-gradient(to right, var(--pv-border), transparent); }
.tj-turn.tj-first { margin-top: 2px; }
/* 行基座（1px 透明边框占位，语义色覆盖） */
.tj-row { display: flex; gap: 8px; padding: 6px 9px; border-radius: 9px; align-items: flex-start; margin-bottom: 4px; border: 1px solid transparent; }
/* 问（用户消息）：蓝色块 */
.tj-user { background: color-mix(in srgb, #2F6FED 7%, transparent); border-color: color-mix(in srgb, #2F6FED 16%, transparent); box-shadow: inset 3px 0 0 #2F6FED; }
/* 答（助手消息）：紫色块 */
.tj-assistant { background: color-mix(in srgb, #8250DF 5%, transparent); border-color: color-mix(in srgb, #8250DF 12%, transparent); box-shadow: inset 3px 0 0 #8250DF; }
/* 标签徽章：实心语义色 */
.tj-tag { flex: none; margin-top: 1px; padding: 0 6px; border-radius: 5px; font-size: 9px; font-weight: 600; line-height: 16px; user-select: none; }
.tj-user .tj-tag { background: #2F6FED; color: #FFF; }
.tj-assistant .tj-tag { background: #8250DF; color: #FFF; }
.tj-text { flex: 1; min-width: 0; font-size: 12px; line-height: 1.55; color: var(--pv-fg); white-space: pre-wrap; word-break: break-word; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.tj-assistant .tj-text { opacity: .82; }
/* 工具行：紧凑卡片，运行/失败行级着色（data-s 同步在行上） */
.tj-tool { font-family: Menlo, Monaco, "DejaVu Sans Mono", monospace; font-size: 11px; align-items: center; color: var(--pv-fg); padding: 4px 9px; margin-bottom: 3px; background: color-mix(in srgb, var(--pv-fg) 2.5%, transparent); border-color: var(--pv-border); }
.tj-row.tj-tool:hover { background: color-mix(in srgb, var(--pv-fg) 5%, transparent); }
.tj-row.tj-tool[data-s="running"] { border-color: color-mix(in srgb, #D29922 35%, transparent); }
.tj-row.tj-tool[data-s="error"] { background: color-mix(in srgb, var(--pv-del-fg) 6%, transparent); border-color: color-mix(in srgb, var(--pv-del-fg) 22%, transparent); }
.tj-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--pv-muted); }
.tj-dot[data-s="running"] { background: #D29922; animation: tj-pulse 1.1s ease-in-out infinite; }
.tj-dot[data-s="ok"] { background: var(--pv-add-fg); }
.tj-dot[data-s="error"] { background: var(--pv-del-fg); }
@keyframes tj-pulse { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
.tj-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.tj-ms { margin-left: auto; flex: none; padding: 0 5px; border-radius: 4px; background: color-mix(in srgb, var(--pv-fg) 5%, transparent); color: var(--pv-muted); font-size: 10px; line-height: 16px; }
@media (prefers-color-scheme: dark) {
.tj-user { background: color-mix(in srgb, #7C9BFF 8%, transparent); border-color: color-mix(in srgb, #7C9BFF 18%, transparent); box-shadow: inset 3px 0 0 #7C9BFF; }
.tj-assistant { background: color-mix(in srgb, #D2A8FF 6%, transparent); border-color: color-mix(in srgb, #D2A8FF 14%, transparent); box-shadow: inset 3px 0 0 #D2A8FF; }
.tj-user .tj-tag { background: #7C9BFF; color: #151517; }
.tj-assistant .tj-tag { background: #D2A8FF; color: #151517; }
.tj-tool { background: color-mix(in srgb, #FFF 3%, transparent); }
.tj-row.tj-tool:hover { background: color-mix(in srgb, #FFF 6%, transparent); }
.tj-ms { background: color-mix(in srgb, #FFF 6%, transparent); }
}
`

/** 渲染行数上限（DOM 保护：超出截断提示）。 */
const MAX_RENDER_LINES = 5000

/** diff DP 单侧行数上限（超出退化全删全加）。 */
const MAX_DIFF_LINES = 4000

/* ---------- 行级 diff（首尾 trim + LCS 回溯） ---------- */

interface DiffRow {
  type: 'ctx' | 'add' | 'del'
  oldNo: number | null
  newNo: number | null
  text: string
}

function diffRows(oldText: string | null, newText: string): DiffRow[] {
  const oldLines = oldText === null ? [] : oldText.split('\n')
  const newLines = newText.split('\n')
  // 首尾公共行直接透传
  let head = 0
  while (head < oldLines.length && head < newLines.length && oldLines[head] === newLines[head]) head++
  let tail = 0
  while (
    tail < oldLines.length - head && tail < newLines.length - head
    && oldLines[oldLines.length - 1 - tail] === newLines[newLines.length - 1 - tail]
  ) tail++
  const rows: DiffRow[] = []
  const push = (type: DiffRow['type'], i: number, j: number, text: string): void => {
    rows.push({ type, oldNo: i >= 0 ? i + 1 : null, newNo: j >= 0 ? j + 1 : null, text })
  }
  for (let i = 0; i < head; i++) push('ctx', i, i, newLines[i])
  const a = oldLines.slice(head, oldLines.length - tail)
  const b = newLines.slice(head, newLines.length - tail)
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    for (let i = 0; i < a.length; i++) push('del', head + i, -1, a[i])
    for (let j = 0; j < b.length; j++) push('add', -1, head + j, b[j])
  } else if (a.length === 0 || b.length === 0) {
    for (let i = 0; i < a.length; i++) push('del', head + i, -1, a[i])
    for (let j = 0; j < b.length; j++) push('add', -1, head + j, b[j])
  } else {
    // LCS 长度矩阵 + 回溯（hunk 尺寸可控）
    const n = a.length
    const m = b.length
    const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
      }
    }
    const out: DiffRow[] = []
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (a[i] === b[j]) { out.push({ type: 'ctx', oldNo: head + i + 1, newNo: head + j + 1, text: b[j] }); i++; j++ }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', oldNo: head + i + 1, newNo: null, text: a[i] }); i++ }
      else { out.push({ type: 'add', oldNo: null, newNo: head + j + 1, text: b[j] }); j++ }
    }
    while (i < n) { out.push({ type: 'del', oldNo: head + i + 1, newNo: null, text: a[i] }); i++ }
    while (j < m) { out.push({ type: 'add', oldNo: null, newNo: head + j + 1, text: b[j] }); j++ }
    rows.push(...out)
  }
  for (let k = 0; k < tail; k++) {
    const idx = newLines.length - tail + k
    push('ctx', oldLines.length - tail + k, idx, newLines[idx])
  }
  return rows
}

/* ---------- 高亮（整段 → 行拆分，跨行 span 由 DOM 重建闭合） ---------- */

function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

/** 高亮 HTML → 每行独立合法 HTML（DOM 遍历，嵌套 span 逐行重建）。 */
function splitHighlightedLines(html: string): string[] {
  const host = document.createElement('div')
  host.innerHTML = html
  const lines: string[] = []
  let current = ''
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const parts = (node.textContent ?? '').split('\n')
      parts.forEach((part, idx) => {
        if (idx > 0) { lines.push(current); current = '' }
        current += escapeHtml(part)
      })
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element
      const tag = el.tagName.toLowerCase()
      const attrs = [...el.attributes].map(a => ` ${a.name}="${a.value}"`).join('')
      current += `<${tag}${attrs}>`
      for (const child of el.childNodes) walk(child)
      current += `</${tag}>`
    }
  }
  for (const child of host.childNodes) walk(child)
  lines.push(current)
  return lines
}

/** 代码 → 高亮行数组（未知语言降级纯文本转义）。 */
function highlightLines(code: string, lang: string | null): string[] {
  if (lang !== null && lang !== '' && hljs.getLanguage(lang)) {
    try {
      const out = hljs.highlight(code, { language: lang, ignoreIllegals: true })
      return splitHighlightedLines(out.value)
    } catch { /* 降级纯文本 */ }
  }
  return code.split('\n').map(escapeHtml)
}

/** 扩展名 → 语言（主进程 lang 提示缺失时兜底；与 file-activity 同表）。 */
const EXT_LANG: Record<string, string> = {
  ts: 'ts', tsx: 'ts', mts: 'ts', cts: 'ts',
  js: 'js', mjs: 'js', cjs: 'js', jsx: 'js',
  json: 'json', jsonc: 'json',
  css: 'css', scss: 'scss', less: 'less',
  html: 'xml', xml: 'xml', svg: 'xml',
  md: 'md', mdx: 'md',
  py: 'py', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
  c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp', cxx: 'cpp',
  cs: 'cs', swift: 'swift', kt: 'kotlin',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini',
  sql: 'sql', lua: 'lua', php: 'php',
}

function langOf(entry: PreviewEntry): string | null {
  if (entry.lang !== null && entry.lang !== '') return entry.lang
  const dot = entry.path.lastIndexOf('.')
  if (dot < 0) return null
  return EXT_LANG[entry.path.slice(dot + 1).toLowerCase()] ?? null
}

/* ---------- 轻量 markdown 渲染（.md 分流；手写保零依赖原则） ---------- */

/** markdown 渲染行数上限（防御性；计划文档通常远小于此）。 */
const MD_MAX_LINES = 3000

/** 行内元素：先整体 escape 再注入标签（输入已不可携带 HTML）。 */
function inlineMd(text: string): string {
  let out = escapeHtml(text)
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>')
  // 图片先于链接（否则 ![alt](url) 被链接正则吃成 "!<a>" 破相）
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m0, alt: string, u: string) => {
    if (!/^(https?:\/\/|\/|\.\/)/.test(u)) return m0
    return `<img src="${u}" alt="${alt}" loading="lazy">`
  })
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m0, t: string, u: string) => {
    const url = u.replace(/&amp;/g, '&')
    // 链接协议白名单：http(s)/锄点/相对——并防 javascript: 等注入
    if (!/^(https?:\/\/|#|\/|\.\/)/.test(url)) return m0
    return `<a href="${u}" target="_blank" rel="noreferrer">${t}</a>`
  })
  // 裸链接自动成链：前导限空白/行首/括号——已生成的 href 属性与其后
  // 的 URL 前是引号/尖括号，不会被二次包裹
  out = out.replace(/(^|[\s（(])(https?:\/\/[^\s<>()）]+)/g,
    '$1<a href="$2" target="_blank" rel="noreferrer">$2</a>')
  out = out.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*])\*([^*][^*]*?)\*/g, '$1<em>$2</em>')
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  return out
}

/**
 * markdown → HTML（块级状态机）：标题/段落/引用/无序有序任务列表/
 * 围栏代码（hljs 高亮）/表格/水平线。所有文本经 escape，仅结构出标签。
 */
function renderMarkdown(src: string): { html: string; truncated: boolean } {
  const lines = src.split('\n')
  const capped = lines.length > MD_MAX_LINES
  const out: string[] = []
  let para: string[] = []
  let quote: string[] = []
  let list: { kind: 'ul' | 'ol'; items: string[] } | null = null
  let code: { lang: string; buf: string[] } | null = null
  const flushPara = (): void => {
    if (para.length > 0) { out.push(`<p>${inlineMd(para.join(' '))}</p>`); para = [] }
  }
  const flushQuote = (): void => {
    if (quote.length > 0) { out.push(`<blockquote><p>${inlineMd(quote.join(' '))}</p></blockquote>`); quote = [] }
  }
  const flushList = (): void => {
    if (list !== null) {
      out.push(`<${list.kind}>${list.items.join('')}</${list.kind}>`)
      list = null
    }
  }
  const flushAll = (): void => { flushPara(); flushQuote(); flushList() }
  const n = capped ? MD_MAX_LINES : lines.length
  for (let i = 0; i < n; i++) {
    const raw = lines[i] ?? ''
    const line = raw.replace(/\s+$/, '')
    // 围栏代码块：内部原样（只 escape），有语言则 hljs
    const fence = /^```(.*)$/.exec(line)
    if (code !== null) {
      if (fence !== null) {
        const body = escapeHtml(code.buf.join('\n'))
        const lang = code.lang.trim().toLowerCase()
        const hl = lang !== '' && hljs.getLanguage(lang)
          ? hljs.highlight(code.buf.join('\n'), { language: lang, ignoreIllegals: true }).value
          : body
        out.push(`<pre><code class="hljs">${hl}</code></pre>`)
        code = null
      } else code.buf.push(raw)
      continue
    }
    if (fence !== null && (fence[1] ?? '').length <= 20) {
      flushAll()
      code = { lang: fence[1] ?? '', buf: [] }
      continue
    }
    if (line === '') { flushAll(); continue }
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h !== null) {
      flushAll()
      const lvl = (h[1] ?? '#').length
      out.push(`<h${lvl}>${inlineMd(h[2] ?? '')}</h${lvl}>`)
      continue
    }
    // setext 标题：段落文字 + 紧随的 ===/--- 下划线（先于 hr 判定，
    // 否则标题下划线被吃成 hr、标题文字落回段落——典型"乱码"来源）
    const sx = /^\s*(=+|-+)\s*$/.exec(line)
    if (sx !== null && para.length > 0) {
      const lvl = (sx[1] ?? '=')[0] === '=' ? 1 : 2
      out.push(`<h${lvl}>${inlineMd(para.join(' '))}</h${lvl}>`)
      para = []
      continue
    }
    if (/^(---+|\*\*\*+)$/.test(line.replace(/\s/g, '')) && line.trim() !== '') {
      flushAll(); out.push('<hr>'); continue
    }
    const q = /^>\s?(.*)$/.exec(line)
    if (q !== null) { flushPara(); flushList(); quote.push(q[1] ?? ''); continue }
    // 任务/无序/有序列表项
    const t = /^[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line)
    const u = /^[-*+]\s+(.*)$/.exec(line)
    const o = /^(\d+)[.)]\s+(.*)$/.exec(line)
    if (t !== null || u !== null || o !== null) {
      flushPara(); flushQuote()
      const kind = o !== null ? 'ol' : 'ul'
      if (list === null || list.kind !== kind) { flushList(); list = { kind, items: [] } }
      if (t !== null) {
        const done = (t[1] ?? ' ') !== ' '
        list.items.push(`<li class="pv-task"><span class="pv-box"${done ? ' data-x="1"' : ''}></span>${inlineMd(t[2] ?? '')}</li>`)
      } else if (u !== null) {
        list.items.push(`<li>${inlineMd(u[1] ?? '')}</li>`)
      } else if (o !== null) {
        list.items.push(`<li>${inlineMd(o[2] ?? '')}</li>`)
      }
      continue
    }
    // 表格：当前行含 | 且下一行是分隔行（|---|---|）
    const next = (lines[i + 1] ?? '').trim()
    if (line.includes('|') && /^\|?[\s:|-]+\|?[\s:|-]*$/.test(next) && next.includes('-')) {
      flushAll()
      const cells = (l: string): string[] => l.replace(/^\|/, '').replace(/\|$/, '').split('|')
      const head = cells(line).map(c => `<th>${inlineMd(c.trim())}</th>`).join('')
      let j = i + 2
      const rows: string[] = []
      while (j < n && (lines[j] ?? '').includes('|')) {
        rows.push(`<tr>${cells(lines[j] ?? '').map(c => `<td>${inlineMd(c.trim())}</td>`).join('')}</tr>`)
        j++
      }
      out.push(`<table><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table>`)
      i = j - 1
      continue
    }
    para.push(line.trim())
  }
  if (code !== null) out.push(`<pre><code class="hljs">${escapeHtml(code.buf.join('\n'))}</code></pre>`)
  flushAll()
  return { html: out.join('\n'), truncated: capped || lines.length > n }
}

function basename(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts.pop() ?? path
}

/* ---------- 视图 ---------- */

export async function mountPreview(root: HTMLElement): Promise<void> {
  const style = document.createElement('style')
  style.textContent = PAGE_CSS
  document.head.append(style)

  const grip = document.createElement('div')
  grip.className = 'pv-grip'
  const main = document.createElement('div')
  main.className = 'pv-main'

  const header = document.createElement('div')
  header.className = 'pv-header'
  const title = document.createElement('div')
  title.className = 'pv-title'
  // 模式切换（按钮显示目标模式名；主进程是模式的唯一真源）
  const modeTabBtn = document.createElement('button')
  modeTabBtn.className = 'pv-btn'
  modeTabBtn.type = 'button'
  modeTabBtn.onclick = () => { void bridge.previewSetMode(pvMode === 'files' ? 'trajectory' : 'files') }
  const modeBtn = document.createElement('button')
  modeBtn.className = 'pv-btn'
  modeBtn.type = 'button'
  const editorBtn = document.createElement('button')
  editorBtn.className = 'pv-btn'
  editorBtn.type = 'button'
  editorBtn.title = '用外部编辑器打开'
  editorBtn.setAttribute('aria-label', '用外部编辑器打开')
  editorBtn.innerHTML = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none"><path d="M9.5 2.5h4v4M13.5 2.5 7 9M13 9.5v3a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1h3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  const collapseBtn = document.createElement('button')
  collapseBtn.className = 'pv-btn'
  collapseBtn.type = 'button'
  collapseBtn.title = '折叠预览面板'
  collapseBtn.setAttribute('aria-label', '折叠预览面板')
  collapseBtn.innerHTML = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  header.append(modeTabBtn, title, modeBtn, editorBtn, collapseBtn)

  const files = document.createElement('div')
  files.className = 'pv-files'
  const body = document.createElement('div')
  body.className = 'pv-body'
  // 轨迹时间线容器（与文件两区互斥展示，renderMode 切换）
  const tjList = document.createElement('div')
  tjList.className = 'tj-list'
  tjList.style.display = 'none'
  main.append(header, files, body, tjList)
  root.append(grip, main)

  /* ---- 状态 ---- */
  let selected: string | null = null
  /** edit 条目的视图模式（read 条目恒 file）。 */
  let mode: 'diff' | 'file' = 'diff'
  let loadSeq = 0
  /** 抽屉展示模式（主进程唯一真源，onPreviewMode 跟随）。 */
  let pvMode: PreviewMode = 'files'
  /** 轨迹快照（轨迹模式渲染源；文件模式下只更新数据不渲染）。 */
  let trajState: TrajectorySnapshot | null = null

  editorBtn.onclick = () => {
    if (selected === null) return
    void bridge.previewOpenEditor(selected)
  }

  const entries: PreviewEntry[] = []
  const upsert = (entry: PreviewEntry): void => {
    const idx = entries.findIndex(e => e.path === entry.path)
    if (idx >= 0) entries.splice(idx, 1)
    entries.unshift(entry)
  }

  const emptyOf = (text: string): void => {
    body.replaceChildren()
    const empty = document.createElement('div')
    empty.className = 'pv-empty'
    empty.textContent = text
    body.append(empty)
  }

  /** 代码视图（read / edit 的“查看当前文件”；.md 分流到渲染视图）。 */
  const renderFile = async (entry: PreviewEntry, content: string, truncated: boolean): Promise<void> => {
    const lang = langOf(entry)
    if (lang === 'md' || lang === 'markdown') {
      // markdown 渲染视图（计划文档主场景）：文档排版替代行号表格；
      // innerHTML 安全——renderMarkdown 内部全量 escape，仅结构出标签。
      // 产品兜底：渲染器异常时全量转义按纯文本展示（不白屏不破版）
      let md: { html: string; truncated: boolean }
      try {
        md = renderMarkdown(content)
      } catch {
        const raw = document.createElement('div')
        raw.className = 'pv-md'
        const pre = document.createElement('pre')
        pre.textContent = content
        raw.append(pre)
        body.replaceChildren(raw)
        return
      }
      body.replaceChildren()
      if (truncated || md.truncated) {
        const note = document.createElement('div')
        note.className = 'pv-note'
        note.textContent = truncated
          ? '文件较大（已按 1MB 截断）'
          : `文档较长，仅渲染前 ${String(MD_MAX_LINES)} 行`
        body.append(note)
      }
      const wrap = document.createElement('div')
      wrap.className = 'pv-md'
      wrap.innerHTML = md.html
      body.append(wrap)
      return
    }
    const lines = highlightLines(content, lang)
    const table = document.createElement('table')
    table.className = 'pv-table'
    const frag = document.createDocumentFragment()
    const cap = Math.min(lines.length, MAX_RENDER_LINES)
    for (let i = 0; i < cap; i++) {
      const tr = document.createElement('tr')
      const ln = document.createElement('td')
      ln.className = 'pv-ln'
      ln.textContent = String(i + 1)
      const code = document.createElement('td')
      code.className = 'pv-code'
      code.innerHTML = lines[i] === '' ? '&nbsp;' : lines[i]
      tr.append(ln, code)
      frag.append(tr)
    }
    table.append(frag)
    body.replaceChildren()
    if (truncated || lines.length > cap) {
      const note = document.createElement('div')
      note.className = 'pv-note'
      note.textContent = `文件较大${truncated ? '（已按 1MB 截断）' : ''}，仅显示前 ${String(cap)} 行`
      body.append(note)
    }
    body.append(table)
  }

  /** diff 视图（上游 applied hunk；行取对应侧整段高亮，颜色不失真）。 */
  const renderDiff = (entry: PreviewEntry): void => {
    const diffs = entry.diffs ?? []
    body.replaceChildren()
    let rendered = 0
    for (const d of diffs) {
      if (diffs.length > 1) {
        const note = document.createElement('div')
        note.className = 'pv-note'
        note.textContent = d.path
        body.append(note)
      }
      const oldHl = d.oldText !== null ? highlightLines(d.oldText, langOf(entry)) : []
      const newHl = highlightLines(d.newText, langOf(entry))
      const rows = diffRows(d.oldText, d.newText)
      const table = document.createElement('table')
      table.className = 'pv-table'
      const frag = document.createDocumentFragment()
      for (const row of rows) {
        if (rendered >= MAX_RENDER_LINES) break
        rendered++
        const tr = document.createElement('tr')
        tr.className = row.type === 'add' ? 'pv-row-add' : row.type === 'del' ? 'pv-row-del' : ''
        const lno = document.createElement('td')
        lno.className = 'pv-ln'
        lno.textContent = row.oldNo !== null ? String(row.oldNo) : ''
        const lnn = document.createElement('td')
        lnn.className = 'pv-ln pv-ln2'
        lnn.textContent = row.newNo !== null ? String(row.newNo) : ''
        const code = document.createElement('td')
        code.className = 'pv-code'
        const mark = document.createElement('span')
        mark.className = 'pv-mark'
        mark.textContent = row.type === 'add' ? '+' : row.type === 'del' ? '−' : ' '
        const span = document.createElement('span')
        const html = row.type === 'del'
          ? row.oldNo !== null ? oldHl[row.oldNo - 1] : ''
          : row.newNo !== null ? newHl[row.newNo - 1] : ''
        span.innerHTML = html === '' || html === undefined ? '&nbsp;' : html
        code.append(mark, span)
        tr.append(lno, lnn, code)
        frag.append(tr)
      }
      table.append(frag)
      body.append(table)
      if (rendered >= MAX_RENDER_LINES) {
        const note = document.createElement('div')
        note.className = 'pv-note'
        note.textContent = '差异过大，仅显示前部分'
        body.append(note)
      }
    }
    if (diffs.length === 0) emptyOf('无 diff 数据')
  }

  /** 读盘渲染（带竞态防护）。 */
  const loadFile = (entry: PreviewEntry): void => {
    const seq = ++loadSeq
    emptyOf('读取中…')
    void bridge.previewReadFile(entry.path).then(result => {
      if (seq !== loadSeq) return
      if (!result.ok || result.content === null) {
        emptyOf(result.error ?? '读取失败')
        return
      }
      void renderFile(entry, result.content, result.truncated)
    })
  }

  const render = (): void => {
    renderFiles()
    const entry = entries.find(e => e.path === selected)
    if (entry === undefined) {
      selected = null
      title.textContent = ''
      modeBtn.style.display = 'none'
      emptyOf(entries.length === 0 ? '等待 agent 的文件活动…' : '选择一个文件')
      return
    }
    const kind = document.createElement('span')
    kind.className = 'pv-kind'
    kind.textContent = entry.kind === 'edit' ? '编辑' : '读取'
    const name = document.createElement('span')
    name.textContent = entry.path
    title.replaceChildren(kind, name)
    title.title = entry.path
    if (entry.kind === 'edit') {
      modeBtn.style.display = ''
      modeBtn.textContent = mode === 'diff' ? '查看当前文件' : '查看 diff'
      modeBtn.onclick = () => {
        mode = mode === 'diff' ? 'file' : 'diff'
        render()
      }
      if (mode === 'diff') {
        renderDiff(entry)
        return
      }
    } else {
      modeBtn.style.display = 'none'
    }
    loadFile(entry)
  }

  const renderFiles = (): void => {
    files.replaceChildren()
    for (const entry of entries) {
      const chip = document.createElement('button')
      chip.className = 'pv-chip'
      chip.type = 'button'
      chip.dataset.active = entry.path === selected ? '1' : '0'
      chip.title = entry.path
      const label = document.createElement('span')
      label.className = 'pv-chip-label'
      label.textContent = basename(entry.path)
      chip.append(label)
      if (entry.kind === 'edit' && (entry.added > 0 || entry.removed > 0)) {
        const badge = document.createElement('span')
        badge.className = 'pv-badge'
        const a = document.createElement('span')
        a.className = 'pv-a'
        a.textContent = `+${String(entry.added)}`
        const d = document.createElement('span')
        d.className = 'pv-d'
        d.textContent = `−${String(entry.removed)}`
        badge.append(a, d)
        chip.append(badge)
      } else if (entry.kind === 'read') {
        const badge = document.createElement('span')
        badge.className = 'pv-badge'
        badge.textContent = '读'
        chip.append(badge)
      }
      chip.onclick = () => {
        if (selected === entry.path) return
        selected = entry.path
        mode = 'diff'
        render()
      }
      files.append(chip)
    }
  }

  /** 轨迹时间线渲染（回合分组；用户停在底部时新内容自动跟随滚动）。 */
  const renderTrajectory = (): void => {
    const snap = trajState
    title.textContent = snap !== null && snap.title !== '' ? snap.title : '会话轨迹'
    title.title = ''
    const follow = tjList.scrollHeight - tjList.scrollTop - tjList.clientHeight < 40
    tjList.replaceChildren()
    if (snap === null || snap.rows.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'pv-empty'
      empty.textContent = snap === null ? '加载会话轨迹…' : '等待会话消息…'
      tjList.append(empty)
      return
    }
    let lastTurn: number | null = null
    let first = true
    for (const row of snap.rows) {
      if (row.turn !== lastTurn) {
        lastTurn = row.turn
        const sep = document.createElement('div')
        sep.className = first ? 'tj-turn tj-first' : 'tj-turn'
        sep.textContent = `回合 ${String(row.turn)}`
        tjList.append(sep)
        first = false
      }
      const el = document.createElement('div')
      if (row.kind === 'tool') {
        el.className = 'tj-row tj-tool'
        // 状态同步在行上（CSS 行级着色：running 描边 / error 淡红底）
        el.dataset.s = row.tool?.status ?? 'ok'
        const dot = document.createElement('span')
        dot.className = 'tj-dot'
        dot.dataset.s = row.tool?.status ?? 'ok'
        const name = document.createElement('span')
        name.className = 'tj-name'
        const label = row.tool !== null && row.tool.name !== ''
          ? (row.text !== null && row.text !== '' ? `${row.tool.name} · ${row.text}` : row.tool.name)
          : (row.text ?? '')
        name.textContent = label
        el.title = label
        el.append(dot, name)
        if (row.tool !== null && row.tool.ms !== null) {
          const ms = document.createElement('span')
          ms.className = 'tj-ms'
          ms.textContent = `${String(row.tool.ms)}ms`
          el.append(ms)
        }
      } else {
        el.className = row.kind === 'user' ? 'tj-row tj-user' : 'tj-row tj-assistant'
        const tag = document.createElement('span')
        tag.className = 'tj-tag'
        tag.textContent = row.kind === 'user' ? '问' : '答'
        const text = document.createElement('span')
        text.className = 'tj-text'
        text.textContent = row.text ?? ''
        el.title = row.text ?? ''
        el.append(tag, text)
      }
      tjList.append(el)
    }
    if (follow) tjList.scrollTop = tjList.scrollHeight
  }

  /** 模式切换渲染（两套内容区互斥显隐 + 各自首渲）。 */
  const renderMode = (): void => {
    const isFiles = pvMode === 'files'
    modeTabBtn.textContent = isFiles ? '轨迹' : '文件'
    files.style.display = isFiles ? '' : 'none'
    body.style.display = isFiles ? '' : 'none'
    tjList.style.display = isFiles ? 'none' : ''
    editorBtn.style.display = isFiles ? '' : 'none'
    if (isFiles) render()
    else renderTrajectory()
  }

  collapseBtn.onclick = () => { void bridge.previewHide() }

  /* ---- 初始列表 + 活动流（跟随刷新：同文件新事件即重渲） ---- */
  const initial = await bridge.previewEntries()
  entries.push(...initial)
  selected = entries.length > 0 ? entries[0].path : null
  // 双模式：初始拉取当前模式并渲染对应内容区；轨迹快照预取一份
  // （文件模式下只存数据，切模式即有内容可渲）
  pvMode = await bridge.previewMode()
  void bridge.trajectoryFetch().then(snap => {
    trajState = snap
    if (pvMode === 'trajectory') renderTrajectory()
  })
  renderMode()
  bridge.onPreviewMode(m => {
    pvMode = m
    renderMode()
  })
  bridge.onTrajectoryUpdate(snap => {
    trajState = snap
    if (pvMode === 'trajectory') renderTrajectory()
  })

  // 工作区切换：主进程已换桶，重拉列表（选中文件仍在新列表则保留）
  bridge.onPreviewRefresh(async () => {
    const fresh = await bridge.previewEntries()
    entries.length = 0
    entries.push(...fresh)
    if (!fresh.some(e => e.path === selected)) {
      selected = fresh.length > 0 ? fresh[0].path : null
      mode = 'diff'
    }
    // 轨迹模式：仅更新数据（隐藏的文件区不重渲，切回时统一渲染）
    if (pvMode !== 'files') return
    render()
  })

  bridge.onPreviewActivity((entry, focus) => {
    const wasSelected = entry.path === selected
    upsert(entry)
    if (focus) {
      // 正文链接接管 / 主进程请求选中：直接展示该文件（接管时主进程
      // 已先切回文件模式并推模式事件；此处兜底更新选中即可）
      selected = entry.path
      mode = 'diff'
      if (pvMode === 'files') render()
      return
    }
    // 轨迹模式：仅更新数据（同上，切回时统一渲染）
    if (pvMode !== 'files') return
    if (!wasSelected) {
      renderFiles()
      return
    }
    // 当前预览的文件有新活动 → 跟随刷新（edit 换 diff、read 重读盘）
    render()
  })

  /* ---- 左缘拖条：调面板宽度（增量上报，主进程 clamp + 持久化） ---- */
  let dragging = false
  let lastX = 0
  let pending = 0
  let raf = 0
  grip.onpointerdown = e => {
    dragging = true
    lastX = e.clientX
    pending = 0
    grip.dataset.drag = '1'
    grip.setPointerCapture(e.pointerId)
    e.preventDefault()
  }
  grip.onpointermove = e => {
    if (!dragging) return
    pending += lastX - e.clientX // 向左拖（正）= 变宽
    lastX = e.clientX
    if (raf === 0) {
      raf = requestAnimationFrame(() => {
        raf = 0
        if (pending !== 0) {
          const sent = pending
          pending = 0
          void bridge.previewPanelResize(sent)
        }
      })
    }
  }
  const endDrag = (): void => {
    dragging = false
    delete grip.dataset.drag
  }
  grip.onpointerup = endDrag
  grip.onpointercancel = endDrag
}
