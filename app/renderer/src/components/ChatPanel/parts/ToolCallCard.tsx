import { useState } from 'react'
import type { MessagePart } from '../../../stores/app-store'
import { useI18n } from '../../../i18n'
import { toolIconFor, CheckIcon, XIcon, StreamingDots } from './icons'

interface ToolCallCardProps {
  part: Extract<MessagePart, { type: 'tool_call' }>
}

/**
 * 工具调用紧凑卡片。
 *
 * 单行默认态：[类型图标] toolName · 参数摘要 ... [状态]
 * 点击整行展开完整 args（JSON pre，可复制）。
 * 状态指示：
 *   running  → 蓝色 spinner + Ns
 *   completed → 绿色 ✓ + 耗时
 *   failed   → 红色 ✗
 */
export function ToolCallCard({ part }: ToolCallCardProps) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const Icon = toolIconFor(part.toolName)

  const durationSec =
    part.startedAt && part.completedAt
      ? Math.max(1, Math.round((part.completedAt - part.startedAt) / 1000))
      : part.startedAt && part.status === 'running'
      ? Math.max(1, Math.round((Date.now() - part.startedAt) / 1000))
      : null

  const argSummary = extractArgSummary(part.args, part.summary)
  const hasArgs = Boolean(part.args && Object.keys(part.args).length > 0)

  const statusColor =
    part.status === 'completed'
      ? 'text-[#22c55e]'
      : part.status === 'failed'
      ? 'text-[#ef4444]'
      : 'text-[#3b82f6]'

  return (
    <div className="rounded-lg border border-border-subtle bg-bg-hover/40 overflow-hidden">
      <button
        onClick={() => hasArgs && setExpanded((v) => !v)}
        className={`flex w-full items-center gap-2 px-3 py-2 text-xs ${
          hasArgs ? 'cursor-pointer hover:bg-bg-hover/60' : 'cursor-default'
        } transition-colors`}
      >
        {/* 类型图标 */}
        <Icon className={`w-3.5 h-3.5 shrink-0 ${statusColor}`} />

        {/* 工具名 */}
        <span className="font-mono font-medium text-text-secondary shrink-0">{part.toolName}</span>

        {/* 参数摘要 */}
        {argSummary && (
          <span className="text-text-muted truncate flex-1 text-left">— {argSummary}</span>
        )}

        {/* 状态指示 */}
        <span className={`shrink-0 ml-auto flex items-center gap-1 ${statusColor}`}>
          {part.status === 'running' && (
            <>
              <span className="inline-block w-3 h-3">
                <StreamingDots />
              </span>
              {durationSec !== null && <span className="text-[10px]">{durationSec}s</span>}
            </>
          )}
          {part.status === 'completed' && (
            <>
              <CheckIcon className="w-3 h-3" />
              {durationSec !== null && <span className="text-[10px]">{durationSec}s</span>}
            </>
          )}
          {part.status === 'failed' && <XIcon className="w-3 h-3" />}
        </span>
      </button>

      {/* 展开的完整 args */}
      {expanded && hasArgs && part.args && (
        <div className="border-t border-border-subtle bg-bg-surface">
          <pre className="px-3 py-2 text-[11px] font-mono text-text-muted overflow-x-auto max-h-48 overflow-y-auto">
            {JSON.stringify(part.args, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

/**
 * 从 args 里提取首条有信息量的参数作为摘要。
 * 优先级：file_path > command > query > path > pattern > url > summary。
 * 截断到 60 字符。
 */
function extractArgSummary(
  args: Record<string, unknown> | undefined,
  fallbackSummary?: string
): string {
  if (!args) return fallbackSummary ?? ''
  const keys = ['file_path', 'filepath', 'path', 'command', 'query', 'pattern', 'url', 'name']
  for (const k of keys) {
    const v = args[k]
    if (typeof v === 'string' && v) {
      const short = v.length > 60 ? v.slice(0, 57) + '…' : v
      return short
    }
  }
  return fallbackSummary ?? ''
}
