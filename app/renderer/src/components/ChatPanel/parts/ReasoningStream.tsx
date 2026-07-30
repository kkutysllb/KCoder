import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { MessagePart } from '../../../stores/app-store'
import { useI18n } from '../../../i18n'
import { StreamingDots } from './icons'

interface ReasoningStreamProps {
  part: Extract<MessagePart, { type: 'reasoning' }>
}

/**
 * 推理过程展示。
 *
 * - 流式中（isStreaming === true）：默认展开，带头像 +「思考中」+ 三点动画，
 *   内容实时追加，用柔和的 text-text-muted 色渲染 markdown。
 * - 完成后（isStreaming === false 或无标记）：折叠为「💭 已思考 Ns」摘要条，
 *   点击切换展开/收起。历史消息无时间戳时只显示「展开查看」。
 */
export function ReasoningStream({ part }: ReasoningStreamProps) {
  const { t } = useI18n()
  const streaming = part.isStreaming === true
  // 已完成的 reasoning 默认折叠；流式中的默认展开
  const [expanded, setExpanded] = useState(streaming)

  const durationSec =
    part.startedAt && part.completedAt
      ? Math.max(1, Math.round((part.completedAt - part.startedAt) / 1000))
      : null

  // 流式中：始终展开 + 头像 + 动画
  if (streaming) {
    return (
      <div className="rounded-lg border border-[#3b82f6]/20 bg-[#3b82f6]/[0.04]">
        <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-[#3b82f6]">
          <span className="shrink-0">💭</span>
          <span className="font-medium">{t('chat.thinking.inProgress')}</span>
          <span className="text-[#3b82f6]/60">
            <StreamingDots />
          </span>
        </div>
        <div className="px-3 pb-2 text-xs text-text-muted leading-relaxed border-t border-[#3b82f6]/10">
          <div className="prose prose-invert prose-sm max-w-none prose-headings:text-text-muted prose-p:text-text-muted prose-strong:text-text-secondary">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text || '…'}</ReactMarkdown>
          </div>
        </div>
      </div>
    )
  }

  // 已完成：折叠摘要条
  return (
    <div className="rounded-lg border border-border-subtle bg-bg-hover/30">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-xs text-text-muted hover:text-text-secondary transition-colors"
      >
        <span className={`transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
        <span>💭</span>
        {durationSec !== null ? (
          <span>
            {t('chat.thinking.completed')} · {durationSec}s
          </span>
        ) : (
          <span>{t('chat.thinking.expand')}</span>
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-2 text-xs text-text-muted leading-relaxed whitespace-pre-wrap border-t border-border-subtle max-h-[400px] overflow-y-auto">
          {part.text}
        </div>
      )}
    </div>
  )
}
