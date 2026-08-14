// ToolActivitySummary — 工具调用可视化（参考 Cursor/Cline 的工具透明度）。
//
// 默认折叠（只显示计数 + 概要），点击展开看每个工具调用的详情。
// 每个工具按类型差异化渲染：
//   - terminal（bash/shell/exec）：$ 命令行 + 终端输出区（stdout/stderr 可见）
//   - file（read/write/edit/str_replace）：文件路径 + 输出
//   - search（grep/glob/find）：pattern + 命中摘要
//   - generic：工具名 + 输出
// 关键改进：成功工具的输出也展示（不止错误），长输出可折叠截断。

import { useState } from 'react'
import type { ToolCall } from '../../lib/chatMessage'

interface ToolActivitySummaryProps {
  calls: ToolCall[]
  streaming?: boolean
}

export function ToolActivitySummary({ calls, streaming }: ToolActivitySummaryProps) {
  const [expanded, setExpanded] = useState(false)
  if (calls.length === 0) return null

  const runningCount = calls.filter((c) => c.status === 'running').length
  const failedCount = calls.filter((c) => c.status === 'failed').length
  const completedCount = calls.filter((c) => c.status === 'completed').length

  // 摘要文案
  let summary: string
  if (streaming && runningCount > 0) {
    summary = `正在调用 ${runningCount} 个工具…`
  } else if (failedCount > 0) {
    summary = `${completedCount} 个工具调用完成 · ${failedCount} 个失败`
  } else {
    summary = `${calls.length} 个工具调用`
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

/** 单个工具调用行（展开视图）— 按类型差异化渲染。 */
function ToolCallRow({ call }: { call: ToolCall }) {
  const kind = classifyTool(call.name)
  const arg = primaryArg(call)
  const fileName = (() => {
    const p = call.args?.path ?? call.args?.file_path ?? call.args?.filePath ?? call.args?.file
    return typeof p === 'string' ? p : null
  })()

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
      {/* 头部：图标 + 工具名 + 主参数 + 耗时 */}
      <div className="flex items-center gap-2 px-2 py-1.5">
        <span className="shrink-0">{statusIcon}</span>
        <span className="font-mono text-text-primary shrink-0">{call.name}</span>
        {arg && (kind === 'terminal') && (
          <code className="min-w-0 truncate font-mono text-[11px] text-[#9ca3af] flex-1" title={arg}>
            <span className="text-[#6b7280]">$ </span>{arg}
          </code>
        )}
        {arg && (kind === 'file') && fileName && (
          <span className="min-w-0 truncate font-mono text-[10px] text-[#3b82f6]/80 flex-1" title={fileName}>
            {shortPath(fileName)}
          </span>
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
      </div>

      {/* 摘要（如果有） */}
      {call.summary && (
        <p className="px-2 pb-1.5 text-text-muted line-clamp-2">{call.summary}</p>
      )}

      {/* 输出区：成功/失败都展示（不止错误），终端风格块 */}
      {call.output && (
        <ToolOutput text={call.output} isError={!!call.isError} />
      )}
    </div>
  )
}

/** 工具输出区：终端风格块，长输出可折叠截断。 */
function ToolOutput({ text, isError }: { text: string; isError: boolean }) {
  const MAX_LINES = 12
  const lines = text.split('\n')
  const tooLong = lines.length > MAX_LINES
  const [expanded, setExpanded] = useState(false)
  const shown = tooLong && !expanded ? lines.slice(0, MAX_LINES).join('\n') : text

  return (
    <div className="border-t border-[#3a3a3e]/60">
      <pre
        className={`px-2 py-1.5 overflow-x-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all ${
          isError ? 'text-red-400/90 bg-red-500/5' : 'text-[#c0c0c5] bg-[#0d0d10]/60'
        }`}
      >
        {shown}
      </pre>
      {tooLong && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="w-full px-2 py-1 text-[10px] text-text-muted hover:text-text-secondary bg-bg-hover/30 transition-colors text-left"
        >
          {expanded
            ? '收起'
            : `展开全部（共 ${lines.length} 行，省略 ${lines.length - MAX_LINES} 行）`}
        </button>
      )}
    </div>
  )
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}
