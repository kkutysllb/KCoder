// ToolActivitySummary — 工具调用可视化（参考 Cursor/Cline 的工具透明度）。
//
// 默认折叠（只显示计数 + 概要），点击展开看每个工具调用的详情。
// 每个工具按类型差异化渲染：
//   - terminal（bash/shell/exec）：$ 命令行 + 终端输出区（stdout/stderr 可见）
//   - file（read/write/edit/str_replace）：文件路径 + 输出
//   - search（grep/glob/find）：pattern + 命中摘要
//   - generic：工具名 + 输出
// 关键改进：成功工具的输出也展示（不止错误），长输出可折叠截断。

import { useState, useEffect } from 'react'
import type { ToolCall } from '../../lib/chatMessage'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/app-store'
import { highlight } from '../../lib/highlighter'

interface ToolActivitySummaryProps {
  calls: ToolCall[]
  streaming?: boolean
}

export function ToolActivitySummary({ calls, streaming }: ToolActivitySummaryProps) {
  const [expanded, setExpanded] = useState(false)
  const { t } = useI18n()
  if (calls.length === 0) return null

  const runningCount = calls.filter((c) => c.status === 'running').length
  const failedCount = calls.filter((c) => c.status === 'failed').length
  const completedCount = calls.filter((c) => c.status === 'completed').length

  // 摘要文案
  let summary: string
  if (streaming && runningCount > 0) {
    summary = t('tools.calling', { n: runningCount })
  } else if (failedCount > 0) {
    summary = t('tools.doneWithFail', { n: completedCount, f: failedCount })
  } else {
    summary = t('tools.calls', { n: calls.length })
  }

  const hasError = failedCount > 0

  return (
    <div className="mb-2">
      <button
        type="button"
        className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-secondary transition-colors"
        aria-expanded={expanded}
        onClick={() => setExpanded((e) => !e)}
      >
        {/* 工具图标 */}
        <svg
          className={`w-3.5 h-3.5 ${streaming && runningCount > 0 ? 'animate-spin text-blue-400' : hasError ? 'text-red-400' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.8}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z" />
        </svg>
        <span className={hasError ? 'text-red-400' : ''}>{summary}</span>
        <svg
          className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {expanded && (
        <div className="mt-2 space-y-1.5">
          {calls.map((call) => (
            <ToolCallRow key={call.id} call={call} />
          ))}
        </div>
      )}
    </div>
  )
}

/** 工具分类（决定如何渲染参数与输出）。 */
type ToolKind = 'terminal' | 'file' | 'search' | 'generic'

const TERMINAL_TOOLS = new Set([
  'bash', 'shell', 'sh', 'zsh', 'exec', 'run_command', 'terminal', 'execute_bash',
  'powershell', 'cmd',
])
const FILE_TOOLS = new Set([
  'read', 'read_file', 'view', 'view_file', 'cat', 'write', 'write_file',
  'create_file', 'edit', 'str_replace', 'replace', 'str_replace_editor',
  'patch', 'multiedit', 'multi_edit', 'save_file', 'update_file',
])
const SEARCH_TOOLS = new Set([
  'grep', 'glob', 'find', 'search', 'search_files', 'list', 'ls', 'rg',
  'find_files', 'list_files',
])

function classifyTool(name: string): ToolKind {
  const lower = name.toLowerCase()
  if (TERMINAL_TOOLS.has(lower)) return 'terminal'
  if (FILE_TOOLS.has(lower)) return 'file'
  if (SEARCH_TOOLS.has(lower)) return 'search'
  // MCP 工具名形如 server_tool，按子串兜底
  if (/bash|shell|exec|terminal/.test(lower)) return 'terminal'
  if (/read|write|edit|file|save|patch/.test(lower)) return 'file'
  if (/grep|glob|search|find/.test(lower)) return 'search'
  return 'generic'
}

/** 从 args 提取主要展示参数（命令/文件路径/pattern）。 */
function primaryArg(call: ToolCall): string | null {
  const a = call.args ?? {}
  const candidates = ['command', 'cmd', 'script', 'path', 'file_path', 'filePath', 'file', 'pattern', 'query', 'regex']
  for (const k of candidates) {
    const v = a[k]
    if (typeof v === 'string' && v.trim()) return v
  }
  return null
}

function shortPath(p: string): string {
  // 取最后两段路径，完整路径放 title
  const parts = p.split('/')
  if (parts.length <= 2) return p
  return '…/' + parts.slice(-2).join('/')
}

// 工具名 → 中文标签 i18n key（按工具语义归类，匹配 exact + 子串）。
const TOOL_LABEL_RULES: Array<{ test: RegExp; key: string }> = [
  { test: /^(bash|execute_bash|run_command|shell|exec|terminal|powershell|cmd|zsh|sh)$/, key: 'tool.bash' },
  { test: /^(read|read_file|readfile|view|view_file|cat|get_file|read_file_tool)$/, key: 'tool.read' },
  { test: /^(write|write_file|writefile|create_file|save_file|new_file)$/, key: 'tool.write' },
  { test: /^(multiedit|multi_edit)$/, key: 'tool.multiedit' },
  { test: /^(edit|str_replace|str_replace_editor|replace|patch|update_file|edit_file)$/, key: 'tool.edit' },
  { test: /^(grep|search|search_files|rg|content_search)$/, key: 'tool.search' },
  { test: /^(glob|find|find_files|list_files|list|ls)$/, key: 'tool.glob' },
  { test: /^(task|delegate_task|delegate|dispatch_agent)$/, key: 'tool.task' },
  { test: /^(todo_write|todowrite|update_todos)$/, key: 'tool.todo' },
]

/** 工具友好名：命中规则 → 中文化；否则保留原名（MCP 工具等）。 */
function toolDisplayName(name: string, t: (k: string) => string): string {
  const lower = name.toLowerCase()
  for (const r of TOOL_LABEL_RULES) {
    if (r.test.test(lower)) return t(r.key)
  }
  return name
}

// 扩展名 → shiki 语言（覆盖 highlighter 注册的常用集）
const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript',
  py: 'python', json: 'json', md: 'markdown', yml: 'yaml', yaml: 'yaml', sh: 'bash',
  sql: 'sql', css: 'css', html: 'html', xml: 'xml', go: 'go', rs: 'rust', java: 'java',
  c: 'c', cpp: 'cpp',
}

/** 推断工具输出的高亮语言：编辑类→diff，终端类→bash，文件类→按扩展名，否则 text。 */
function inferToolLang(name: string, kind: ToolKind, fileName: string | null): string {
  const lower = name.toLowerCase()
  if (/edit|str_replace|replace|patch|multiedit|multi_edit/.test(lower)) return 'diff'
  if (kind === 'terminal') return 'bash'
  if (fileName) {
    const ext = fileName.split('.').pop()?.toLowerCase() || ''
    if (EXT_LANG[ext]) return EXT_LANG[ext]
  }
  return 'text'
}

/** 计算编辑类工具的增删行数（+N -M）：优先从 output diff 行，其次从 str_replace 参数。 */
function computeEditStats(call: ToolCall): { add: number; del: number } | null {
  if (call.output) {
    let add = 0
    let del = 0
    for (const line of call.output.split('\n')) {
      if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('\\')) continue
      if (line.startsWith('+')) add++
      else if (line.startsWith('-')) del++
    }
    if (add || del) return { add, del }
  }
  const oldS = call.args?.old_string ?? call.args?.oldString
  const newS = call.args?.new_string ?? call.args?.newString
  if (typeof oldS === 'string' && typeof newS === 'string') {
    return {
      del: oldS.split('\n').filter((l) => l.trim()).length,
      add: newS.split('\n').filter((l) => l.trim()).length,
    }
  }
  return null
}

/** 单个工具调用行（展开视图）— 头部默认折叠内部信息，点击展开。 */
export function ToolCallRow({ call }: { call: ToolCall }) {
  const { t } = useI18n()
  const kind = classifyTool(call.name)
  const arg = primaryArg(call)
  const fileName = (() => {
    const p = call.args?.path ?? call.args?.file_path ?? call.args?.filePath ?? call.args?.file
    return typeof p === 'string' ? p : null
  })()
  const displayName = toolDisplayName(call.name, t)
  const outLang = inferToolLang(call.name, kind, fileName)
  // 失败的工具默认展开（便于直接看错误），成功的默认折叠
  const [open, setOpen] = useState(call.status === 'failed')
  const hasDetails = !!(call.summary || call.output)
  const workspacePath = useAppStore((s) => s.workspacePath)
  const openFilePreview = useAppStore((s) => s.openFilePreview)

  // 点击文件名 → 在右侧预览栏打开该文件（相对路径按工作区解析）
  const openFile = (e: React.MouseEvent) => {
    e.stopPropagation() // 防止触发行折叠/展开
    if (!fileName) return
    const resolved =
      fileName.startsWith('/') ? fileName
        : workspacePath ? `${workspacePath}/${fileName}`.replace(/\/+/g, '/') : fileName
    openFilePreview(resolved)
  }
  // 编辑类工具的增删统计（+N -M 徽标）
  const isEditTool = /edit|str_replace|replace|patch|write|create|multiedit|multi_edit/.test(call.name.toLowerCase())
  const editStats = isEditTool && kind === 'file' ? computeEditStats(call) : null

  const statusIcon =
    call.status === 'running' ? (
      <svg className="w-3 h-3 animate-spin text-blue-400" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    ) : call.status === 'failed' ? (
      <svg className="w-3 h-3 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    ) : (
      <svg className="w-3 h-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    )

  return (
    <div className="rounded-md bg-bg-hover/50 text-xs overflow-hidden">
      {/* 头部：图标 + 工具名（中文）+ 主参数 + 耗时；有详情时点击展开/折叠 */}
      <div
        className={`flex items-center gap-2 px-2 py-1.5 ${hasDetails ? 'cursor-pointer hover:bg-bg-hover' : ''}`}
        onClick={hasDetails ? () => setOpen((o) => !o) : undefined}
      >
        {hasDetails && (
          <svg
            className={`w-3 h-3 shrink-0 text-text-muted transition-transform ${open ? 'rotate-90' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        )}
        <span className="shrink-0">{statusIcon}</span>
        <span className="text-text-primary shrink-0">{displayName}</span>
        {arg && (kind === 'terminal') && (
          <code className="min-w-0 truncate font-mono text-[11px] text-[#9ca3af] flex-1" title={arg}>
            <span className="text-[#6b7280]">$ </span>{arg}
          </code>
        )}
        {arg && (kind === 'file') && fileName && (
          <button
            type="button"
            onClick={openFile}
            title={fileName}
            className="min-w-0 truncate font-mono text-[10px] text-[#3b82f6] hover:text-[#60a5fa] hover:underline flex-1 text-left cursor-pointer"
          >
            {shortPath(fileName)}
          </button>
        )}
        {arg && (kind === 'search' || kind === 'generic') && (
          <span className="min-w-0 truncate font-mono text-[11px] text-[#9ca3af] flex-1" title={arg}>
            {arg}
          </span>
        )}
        {call.startedAt && call.endedAt && (
          <span className="text-[10px] text-text-muted shrink-0">
            {formatMs(call.endedAt - call.startedAt)}
          </span>
        )}
        {/* 编辑类工具的增删统计 +N -M */}
        {editStats && (
          <span className="shrink-0 font-mono text-[10px] tabular-nums">
            <span className="text-[#22c55e]">+{editStats.add}</span>{' '}
            <span className="text-[#ef4444]">-{editStats.del}</span>
          </span>
        )}
      </div>

      {/* 内部信息（摘要 + 输出）默认折叠，点击头部展开 */}
      {open && (
        <>
          {call.summary && (
            <p className="px-2 pb-1.5 text-text-muted line-clamp-2">{call.summary}</p>
          )}
          {call.output && (
            <ToolOutput text={call.output} isError={!!call.isError} language={outLang} />
          )}
        </>
      )}
    </div>
  )
}

/** 工具输出区：卡片包裹 + Shiki 语法高亮（按语言），长输出可折叠截断。 */
function ToolOutput({ text, isError, language }: { text: string; isError: boolean; language: string }) {
  const { t } = useI18n()
  const MAX_LINES = 14
  const lines = text.split('\n')
  const tooLong = lines.length > MAX_LINES
  const [expanded, setExpanded] = useState(false)
  const shown = tooLong && !expanded ? lines.slice(0, MAX_LINES).join('\n') : text
  const [html, setHtml] = useState<string | null>(null)

  // 异步高亮：错误输出不高亮（保持红色可读）；成功输出按推断语言着色。
  // shown 变化（展开/截断）时重新高亮。失败回退纯文本。
  useEffect(() => {
    if (isError) {
      setHtml(null)
      return
    }
    let cancelled = false
    setHtml(null)
    highlight(shown, language).then((h) => {
      if (!cancelled) setHtml(h)
    })
    return () => {
      cancelled = true
    }
  }, [shown, language, isError])

  return (
    <div className="mx-1.5 mb-1.5 overflow-hidden rounded-lg border border-border-custom bg-[#0d0d10]">
      {isError || !html ? (
        <pre
          className={`overflow-x-auto px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all ${
            isError ? 'text-red-400/90 bg-red-500/5' : 'text-[#c0c0c5]'
          }`}
        >
          {shown}
        </pre>
      ) : (
        <div
          className="overflow-x-auto px-3 py-2 text-[11px] leading-relaxed [&_.line]:block [&>pre.shiki]:!m-0 [&>pre.shiki]:!bg-transparent"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
      {tooLong && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="w-full border-t border-border-custom px-3 py-1 text-left text-[10px] text-text-muted transition-colors hover:bg-bg-hover hover:text-text-secondary"
        >
          {expanded
            ? t('tools.collapse')
            : t('tools.truncated', { n: lines.length, m: lines.length - MAX_LINES })}
        </button>
      )}
    </div>
  )
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}
