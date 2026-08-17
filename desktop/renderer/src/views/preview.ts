/**
 * 文件预览视图（#/preview，承载于 shell 窗口右侧的 WebContentsView）：
 * agent 读/编辑文件的活动流 + 内容预览（codex 预览面板同款）。
 *
 * - 活动数据：IPC preview:entries / preview:activity（主进程
 *   file-activity 聚合，同文件取最新，按工作区分桶——切换工作区时
 *   preview:refresh 通知重拉）；内容按需 preview:read-file
 *   读盘（跟随刷新 = 同文件新事件到达即重渲）；
 * - read 条目 → 文件当前内容（整段高亮后按行拆分，行号列）；
 *   edit 条目 → 行级 diff（上游 applied hunk：oldText/newText），
 *   可切"查看当前文件"；diff 行取对应侧的整段高亮行（颜色不失真）；
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
import type { PreviewEntry } from '@shared/ipc-contract'

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
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
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
  header.append(title, modeBtn, editorBtn, collapseBtn)

  const files = document.createElement('div')
  files.className = 'pv-files'
  const body = document.createElement('div')
  body.className = 'pv-body'
  main.append(header, files, body)
  root.append(grip, main)

  /* ---- 状态 ---- */
  let selected: string | null = null
  /** edit 条目的视图模式（read 条目恒 file）。 */
  let mode: 'diff' | 'file' = 'diff'
  let loadSeq = 0

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

  /** 代码视图（read / edit 的"查看当前文件"）。 */
  const renderFile = async (entry: PreviewEntry, content: string, truncated: boolean): Promise<void> => {
    const lines = highlightLines(content, langOf(entry))
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

  collapseBtn.onclick = () => { void bridge.previewHide() }

  /* ---- 初始列表 + 活动流（跟随刷新：同文件新事件即重渲） ---- */
  const initial = await bridge.previewEntries()
  entries.push(...initial)
  selected = entries.length > 0 ? entries[0].path : null
  render()

  // 工作区切换：主进程已换桶，重拉列表（选中文件仍在新列表则保留）
  bridge.onPreviewRefresh(async () => {
    const fresh = await bridge.previewEntries()
    entries.length = 0
    entries.push(...fresh)
    if (!fresh.some(e => e.path === selected)) {
      selected = fresh.length > 0 ? fresh[0].path : null
      mode = 'diff'
    }
    render()
  })

  bridge.onPreviewActivity((entry, focus) => {
    const wasSelected = entry.path === selected
    upsert(entry)
    if (focus) {
      // 正文链接接管 / 主进程请求选中：直接展示该文件
      selected = entry.path
      mode = 'diff'
      render()
      return
    }
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
