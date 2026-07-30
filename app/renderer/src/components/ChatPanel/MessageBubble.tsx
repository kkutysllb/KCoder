import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Message, MessagePart } from '../../stores/app-store'
import { CodeBlock } from '../CodeBlock'
import { useChat } from '../../hooks/useChat'
import { useAppStore } from '../../stores/app-store'
import { StageProgress } from './parts/StageProgress'
import { BranchGroup } from './parts/BranchGroup'
import { TurnMeta } from './parts/TurnMeta'
import { CompactionNotice } from './parts/CompactionNotice'
import { StreamingDots } from './parts/icons'

interface MessageBubbleProps {
  message: Message
}

/**
 * 消息气泡 —— Claude/ChatGPT 对话流风格。
 *
 * 用户消息：右对齐浅灰气泡，纯文本。
 * AI 消息：左侧 K 头像 + 右侧 turn 容器，parts 按语义分区：
 *   1. 阶段进度条（仅生成中）
 *   2. 分支组（reasoning / tool_call / tool_result / approval / compaction）
 *   3. 正文文本（markdown）
 *   4. turn 元信息（usage + 模型 + 耗时，turn 完成时）
 */
export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user'

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-xl px-4 py-3 bg-bg-hover text-text-primary">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
        </div>
      </div>
    )
  }

  // AI 消息
  const parts = message.parts ?? []
  const branches = useAppStore((s) => s.branches)
  const selectedModel = useAppStore((s) => s.selectedModel)

  // 把 parts 分成三类：text 正文单独提取，其他进 BranchGroup，compaction 单独处理
  const textParts: Extract<MessagePart, { type: 'text' }>[] = []
  const interactiveParts: MessagePart[] = []
  for (const p of parts) {
    if (p.type === 'text') {
      textParts.push(p)
    } else if (p.type === 'usage') {
      // usage 不在主流程渲染，交给 TurnMeta
      continue
    } else {
      interactiveParts.push(p)
    }
  }
  const fullText = textParts.map((p) => p.text).join('')

  return (
    <div className="flex gap-3">
      {/* 左侧头像 */}
      <KAvatar streaming={message.isStreaming === true && parts.length === 0} />

      {/* 右侧 turn 容器 */}
      <div className="flex-1 min-w-0">
        {/* 1. 阶段进度条 */}
        <StageProgress parts={parts} isGenerating={message.isStreaming === true} />

        {/* 2. 分支组（reasoning/tool_call/tool_result/approval/compaction）*/}
        {interactiveParts.length > 0 && (
          <div className="space-y-2 mb-2">
            <BranchGroup
              parts={interactiveParts}
              branches={branches}
              renderApproval={(p) => <ApprovalPartCard approvalId={p.approvalId} toolName={p.toolName} summary={p.summary} status={p.status} />}
            />
          </div>
        )}

        {/* 3. 正文文本 */}
        {fullText && (
          <div className="prose prose-invert prose-sm max-w-none">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({ className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className || '')
                  const codeString = String(children).replace(/\n$/, '')
                  if (match) {
                    return <CodeBlock language={match[1]} code={codeString} />
                  }
                  return (
                    <code className="px-1.5 py-0.5 rounded bg-bg-hover text-text-primary text-[13px]" {...props}>
                      {children}
                    </code>
                  )
                }
              }}
            >
              {fullText}
            </ReactMarkdown>
          </div>
        )}

        {/* 生成中占位（空 parts + 空 text 时显示三点动画）*/}
        {message.isStreaming && !fullText && parts.length === 0 && (
          <div className="flex items-center gap-1 pt-1 text-text-muted">
            <StreamingDots />
          </div>
        )}

        {/* 4. turn 元信息 */}
        <TurnMeta message={message} fallbackModel={selectedModel} />
      </div>
    </div>
  )
}

/** K 字母圆形头像 —— 流式中带呼吸光晕 */
function KAvatar({ streaming }: { streaming: boolean }) {
  return (
    <div
      className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white ${
        streaming
          ? 'bg-gradient-to-br from-[#3b82f6] to-[#6366f1] shadow-[0_0_0_3px_rgba(59,130,246,0.15)] animate-pulse'
          : 'bg-gradient-to-br from-[#3b82f6] to-[#6366f1]'
      }`}
    >
      K
    </div>
  )
}

/**
 * 审批卡片 —— 保留原有交互（允许/拒绝按钮 + 状态徽章），仅从 PartRenderer 中内联。
 * 状态：pending 时显示按钮，resolved 显示结果徽章。
 */
function ApprovalPartCard({ approvalId, toolName, summary, status }: {
  approvalId: string
  toolName: string
  summary?: string
  status: 'pending' | 'allowed' | 'denied' | 'expired'
}) {
  const { resolveApproval } = useChat()
  const [submitting, setSubmitting] = useState(false)

  const handleDecision = async (decision: 'allow' | 'deny') => {
    setSubmitting(true)
    try {
      await resolveApproval(approvalId, decision)
    } finally {
      setSubmitting(false)
    }
  }

  const statusBadge = status === 'allowed'
    ? { text: '已允许', cls: 'text-[#22c55e] bg-[#22c55e]/10 border-[#22c55e]/30' }
    : status === 'denied'
    ? { text: '已拒绝', cls: 'text-[#ef4444] bg-[#ef4444]/10 border-[#ef4444]/30' }
    : status === 'expired'
    ? { text: '已过期', cls: 'text-text-muted bg-bg-hover border-border-custom' }
    : null

  return (
    <div className="rounded-lg border border-[#f59e0b]/30 bg-[#f59e0b]/5 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <svg className="w-4 h-4 shrink-0 text-[#f59e0b]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
        <span className="text-xs font-medium text-text-primary">{toolName}</span>
        <span className="text-[10px] text-text-muted">请求审批</span>
        {statusBadge && (
          <span className={`ml-auto px-1.5 py-0.5 rounded text-[10px] font-medium border ${statusBadge.cls}`}>
            {statusBadge.text}
          </span>
        )}
      </div>
      {summary && (
        <p className="text-xs text-text-secondary mt-1.5 leading-relaxed">{summary}</p>
      )}
      {status === 'pending' && (
        <div className="flex items-center gap-2 mt-2.5">
          <button
            onClick={() => handleDecision('allow')}
            disabled={submitting}
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-[#22c55e] text-white hover:bg-[#16a34a] transition-colors disabled:opacity-50"
          >
            允许
          </button>
          <button
            onClick={() => handleDecision('deny')}
            disabled={submitting}
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-[#ef4444] text-white hover:bg-[#dc2626] transition-colors disabled:opacity-50"
          >
            拒绝
          </button>
          {submitting && (
            <svg className="w-3.5 h-3.5 animate-spin text-text-muted" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
        </div>
      )}
    </div>
  )
}
