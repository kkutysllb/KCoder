// ReasoningBlock — 思考流折叠展示（参考 KStock ReasoningBlock.tsx）。
//
// - 流式中（streaming 且 endedAt 未填）：折叠态显示「思考中…」动画，展开看流式全文
// - 完成后（有 endedAt）：折叠态显示「已思考 Ns」，展开看完整思考内容
// - <1s 显示「已思考 <1s」
// 两种态默认折叠；用户点击摘要条展开/收起。

import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { ReasoningBlock as ReasoningData } from '../../lib/chatMessage'

interface ReasoningBlockProps {
  reasoning: ReasoningData
  streaming?: boolean
  thinkingMs?: number
}

export function ReasoningBlock({ reasoning, streaming, thinkingMs }: ReasoningBlockProps) {
  const [expanded, setExpanded] = useState(false)
  const inProgress = streaming && reasoning.endedAt == null

  const ms =
    thinkingMs ??
    (reasoning.endedAt != null ? reasoning.endedAt - reasoning.startedAt : 0)

  return (
    <div className="mb-2" aria-label={inProgress ? '思考中' : '已思考'}>
      <button
        type="button"
        className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-secondary transition-colors"
        aria-expanded={expanded}
        onClick={() => setExpanded((e) => !e)}
      >
        {/* 脑图标 */}
        <svg className={`w-3.5 h-3.5 ${inProgress ? 'animate-pulse text-blue-400' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
        <span>{inProgress ? '思考中…' : `已思考 ${formatDuration(ms)}`}</span>
        {/* 折叠箭头 */}
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
        <div className="mt-2 pl-4 border-l-2 border-white/[0.08] prose prose-invert prose-xs max-w-none opacity-80">
          {reasoning.text ? (
            <ReactMarkdown>{reasoning.text}</ReactMarkdown>
          ) : inProgress ? (
            <span className="text-text-muted">…</span>
          ) : null}
        </div>
      )}
    </div>
  )
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '<1s'
  const seconds = ms / 1000
  if (seconds < 1) return '<1s'
  return `${Math.round(seconds)}s`
}
