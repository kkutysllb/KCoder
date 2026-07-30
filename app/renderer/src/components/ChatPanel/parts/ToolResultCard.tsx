import { useState } from 'react'
import type { MessagePart } from '../../../stores/app-store'
import { useI18n } from '../../../i18n'

interface ToolResultCardProps {
  part: Extract<MessagePart, { type: 'tool_result' }>
}

/**
 * 工具结果智能渲染。
 *
 * 根据 toolName 和 output 内容选择渲染器：
 * - diff（含 +++/---/@@）→ diff 视图（+ 绿底 / - 红底 / 文件名 header）
 * - 文件操作类（无 diff）→ 文件内容 pre
 * - 搜索类 → 文件列表样式（每行路径 chip）
 * - bash/sh 类 → 终端样式（深色背景 + 等宽）
 * - error → 红色边框
 * - 兜底 → 折叠纯文本
 */
export function ToolResultCard({ part }: ToolResultCardProps) {
  const { t } = useI18n()
  const output = part.output ?? ''
  if (!output) return null

  const name = part.toolName.toLowerCase()
  const isError = Boolean(part.isError)
  const isDiff = /(^|\n)(\+\+\+|---|@@\s)/.test(output)

  // 错误优先级最高
  if (isError) {
    return <ErrorResultView toolName={part.toolName} output={output} />
  }

  // diff 视图
  if (
    isDiff &&
    (name.startsWith('write') || name.startsWith('edit') || name.startsWith('apply') || name.startsWith('read'))
  ) {
    return <DiffResultView output={output} />
  }

  // 搜索/列表类
  if (
    name.startsWith('search') ||
    name.startsWith('grep') ||
    name.startsWith('find') ||
    name.startsWith('list_dir') ||
    name.startsWith('list_files') ||
    name.startsWith('glob')
  ) {
    return <SearchResultView output={output} />
  }

  // 终端类
  if (
    name === 'bash' ||
    name === 'sh' ||
    name === 'shell' ||
    name.startsWith('run_command') ||
    name.startsWith('exec') ||
    name.startsWith('terminal')
  ) {
    return <TerminalResultView output={output} />
  }

  // 兜底：可折叠文本
  return <DefaultResultView toolName={part.toolName} output={output} />
}

/** 错误结果 */
function ErrorResultView({ toolName, output }: { toolName: string; output: string }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="rounded-lg border border-[#ef4444]/30 bg-[#ef4444]/5 overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-xs text-[#ef4444]"
      >
        <span className={`transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
        <span>✗</span>
        <span className="font-mono">{toolName}</span>
        <span className="text-[#ef4444]/70">— 失败</span>
      </button>
      {expanded ? (
        <pre className="px-3 pb-2 text-xs text-[#ef4444]/90 whitespace-pre-wrap break-all border-t border-[#ef4444]/20 max-h-60 overflow-auto">
          {output}
        </pre>
      ) : (
        <div className="px-3 pb-1.5 text-[11px] text-[#ef4444]/70 truncate">{output.slice(0, 120)}</div>
      )}
    </div>
  )
}

/** diff 视图：解析 +++/---/@@ 块，+ 行绿底 - 行红底 */
function DiffResultView({ output }: { output: string }) {
  const [copied, setCopied] = useState(false)
  const lines = output.split('\n')
  const fileName = lines.find((l) => l.startsWith('+++') || l.startsWith('---'))?.replace(/^[+-]{3}\s*/, '')

  const handleCopy = async () => {
    await navigator.clipboard.writeText(output)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="rounded-lg border border-border-subtle overflow-hidden">
      <div className="flex items-center justify-between bg-bg-input px-3 py-1.5">
        <span className="text-[11px] font-mono text-text-muted truncate">{fileName ?? 'diff'}</span>
        <button
          onClick={handleCopy}
          className="shrink-0 text-[10px] text-text-muted hover:text-text-secondary px-1.5 py-0.5 rounded hover:bg-bg-hover"
        >
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <div className="max-h-72 overflow-auto bg-bg-surface">
        <pre className="text-[11px] font-mono leading-relaxed">
          {lines.map((line, i) => {
            const cls = line.startsWith('+') && !line.startsWith('+++')
              ? 'bg-[#22c55e]/10 text-[#86efac]'
              : line.startsWith('-') && !line.startsWith('---')
              ? 'bg-[#ef4444]/10 text-[#fca5a5]'
              : line.startsWith('@@')
              ? 'text-[#3b82f6]'
              : 'text-text-muted'
            return (
              <div key={i} className={`px-3 ${cls}`}>
                {line || ' '}
              </div>
            )
          })}
        </pre>
      </div>
    </div>
  )
}

/** 搜索/列表结果：每行识别为路径就渲染为 chip */
function SearchResultView({ output }: { output: string }) {
  const lines = output.split('\n').filter((l) => l.trim())
  const looksLikePaths = lines.length > 0 && lines.slice(0, 10).every((l) => isLikelyPath(l))

  if (!looksLikePaths) {
    // 输出不像路径列表，退化为终端样式
    return <TerminalResultView output={output} />
  }

  return (
    <div className="rounded-lg border border-border-subtle bg-bg-hover/30 max-h-60 overflow-y-auto">
      <div className="px-3 py-2 space-y-0.5">
        {lines.map((line, i) => {
          const [path, ...rest] = line.split(/\s{2,}|\s-\s/) // 尝试分离路径和匹配数
          return (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="font-mono text-[#3b82f6] truncate flex-1">{path}</span>
              {rest.length > 0 && (
                <span className="text-text-muted text-[10px] shrink-0">{rest.join(' ')}</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 终端结果：深色背景 + 等宽 */
function TerminalResultView({ output }: { output: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    await navigator.clipboard.writeText(output)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="rounded-lg border border-border-subtle overflow-hidden">
      <div className="flex items-center justify-between bg-[#0d0d0f] px-3 py-1">
        <span className="text-[10px] text-[#86efac]/70 font-mono">stdout</span>
        <button
          onClick={handleCopy}
          className="text-[10px] text-[#86efac]/50 hover:text-[#86efac] px-1.5 py-0.5 rounded"
        >
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="px-3 py-2 text-[11px] font-mono text-[#e5e5e5] bg-[#0d0d0f] whitespace-pre-wrap break-all max-h-60 overflow-auto">
        {output}
      </pre>
    </div>
  )
}

/** 默认折叠文本 */
function DefaultResultView({ toolName, output }: { toolName: string; output: string }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const preview = output.length > 200 ? output.slice(0, 200) + '…' : output

  const handleCopy = async () => {
    await navigator.clipboard.writeText(output)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="rounded-lg border border-border-subtle bg-bg-hover/30">
      <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-muted">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1.5 flex-1 hover:text-text-secondary"
        >
          <span className={`transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
          <span className="font-mono">{toolName}</span>
          <span>结果</span>
        </button>
        <button
          onClick={handleCopy}
          className="text-[10px] hover:text-text-secondary px-1.5 py-0.5 rounded hover:bg-bg-hover"
        >
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      {expanded ? (
        <pre className="px-3 pb-2 text-xs text-text-muted whitespace-pre-wrap break-all border-t border-border-subtle max-h-60 overflow-auto">
          {output}
        </pre>
      ) : (
        <div className="px-3 pb-1.5 text-[11px] text-text-muted truncate">{preview}</div>
      )}
    </div>
  )
}

/** 粗略判断一行是否像文件路径 */
function isLikelyPath(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false
  // 以 / ./ ~ 开头，或包含文件扩展名
  if (/^[/~.]/.test(trimmed)) return true
  if (/\.\w{1,10}(\s|$)/.test(trimmed)) return true
  // 或包含路径分隔符
  if (trimmed.includes('/')) return true
  return false
}
