import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Message, MessagePart } from '../../stores/app-store'
import { CodeBlock } from '../CodeBlock'

interface MessageBubbleProps {
  message: Message
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-xl px-4 py-3 ${
          isUser
            ? 'bg-bg-hover text-text-primary'
            : 'bg-transparent text-text-primary'
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap text-sm">{message.content}</p>
        ) : message.parts && message.parts.length > 0 ? (
          <div className="space-y-2">
            {message.parts.map((part, index) => (
              <PartRenderer key={index} part={part} />
            ))}
          </div>
        ) : (
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
              {message.content || (message.isStreaming ? '...' : '')}
            </ReactMarkdown>
          </div>
        )}

        {/* Streaming indicator */}
        {message.isStreaming && !message.content && (!message.parts || message.parts.length === 0) && (
          <div className="flex items-center gap-1 pt-1">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#71717a] [animation-delay:-0.3s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#71717a] [animation-delay:-0.15s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#71717a]" />
          </div>
        )}
      </div>
    </div>
  )
}

/** 渲染单个消息部件 */
function PartRenderer({ part }: { part: MessagePart }) {
  switch (part.type) {
    case 'text':
      // 文本 part 用 markdown 渲染
      return (
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
            {part.text}
          </ReactMarkdown>
        </div>
      )

    case 'reasoning':
      return <ReasoningBlock text={part.text} />

    case 'tool_call':
      return (
        <div className="flex items-center gap-2 rounded-lg border border-border-subtle bg-bg-hover/50 px-3 py-2">
          <ToolStatusIcon status={part.status} />
          <span className="text-xs font-medium text-text-secondary">{part.toolName}</span>
          {part.summary && <span className="text-xs text-text-muted truncate">— {part.summary}</span>}
          {part.status === 'running' && (
            <span className="ml-auto text-[10px] text-text-muted animate-pulse">执行中…</span>
          )}
        </div>
      )

    case 'tool_result':
      return <ToolResultBlock toolName={part.toolName} output={part.output} isError={part.isError} />

    case 'usage':
      return (
        <div className="flex items-center gap-3 text-[10px] text-text-muted border-t border-border-subtle pt-1.5 mt-1">
          <span>输入 {part.promptTokens}</span>
          <span>输出 {part.completionTokens}</span>
          <span>共 {part.totalTokens} tokens</span>
        </div>
      )

    default:
      return null
  }
}

/** 推理块 — 可折叠 */
function ReasoningBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="rounded-lg bg-bg-hover/30 border border-border-subtle">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-xs text-text-muted hover:text-text-secondary"
      >
        <span className={`transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
        思考过程
      </button>
      {expanded && (
        <div className="px-3 pb-2 text-xs text-text-muted whitespace-pre-wrap border-t border-border-subtle">
          {text}
        </div>
      )}
    </div>
  )
}

/** 工具结果块 — 可折叠 */
function ToolResultBlock({ toolName, output, isError }: { toolName: string; output?: string; isError?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  if (!output) return null
  const preview = output.length > 200 ? output.slice(0, 200) + '…' : output
  return (
    <div className={`rounded-lg border ${isError ? 'border-red-500/30 bg-red-500/5' : 'border-border-subtle bg-bg-hover/30'}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-xs text-text-muted hover:text-text-secondary"
      >
        <span className={`transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
        {toolName} 结果 {isError && <span className="text-red-400">（失败）</span>}
      </button>
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

/** 工具状态图标 */
function ToolStatusIcon({ status }: { status: 'running' | 'completed' | 'failed' }) {
  if (status === 'running') {
    return <span className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
  }
  if (status === 'completed') {
    return <span className="h-2 w-2 rounded-full bg-green-500" />
  }
  return <span className="h-2 w-2 rounded-full bg-red-500" />
}
