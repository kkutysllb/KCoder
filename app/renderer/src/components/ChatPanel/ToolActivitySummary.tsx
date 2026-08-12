// ToolActivitySummary — 工具调用摘要（参考 KStock ToolActivitySummary.tsx）。
//
// 默认折叠（只显示计数 + 概要），点击展开看每个工具调用的详情。
// 流式中显示 spinner；有错误高亮。

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

/** 单个工具调用行（展开视图）。 */
function ToolCallRow({ call }: { call: ToolCall }) {
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
    <div className="flex items-start gap-2 px-2 py-1.5 rounded-md bg-bg-hover/50 text-xs">
      <span className="mt-0.5 shrink-0">{statusIcon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-text-primary">{call.name}</span>
          {call.startedAt && call.endedAt && (
            <span className="text-[10px] text-text-muted">
              {formatMs(call.endedAt - call.startedAt)}
            </span>
          )}
        </div>
        {call.summary && (
          <p className="mt-0.5 text-text-muted line-clamp-2">{call.summary}</p>
        )}
        {call.isError && call.output && (
          <pre className="mt-1 text-[10px] text-red-400/80 whitespace-pre-wrap font-mono bg-red-500/5 rounded p-1">
            {call.output}
          </pre>
        )}
      </div>
    </div>
  )
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}
