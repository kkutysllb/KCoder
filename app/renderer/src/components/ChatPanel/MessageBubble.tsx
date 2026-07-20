import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Message } from '../../stores/app-store'
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
            ? 'bg-[#2a2a2c] text-[#e4e4e7]'
            : 'bg-transparent text-[#e4e4e7]'
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap text-sm">{message.content}</p>
        ) : (
          <div className="prose prose-invert prose-sm max-w-none">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({ className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className || '')
                  const codeString = String(children).replace(/\n$/, '')

                  if (match) {
                    return (
                      <CodeBlock language={match[1]} code={codeString} />
                    )
                  }

                  return (
                    <code className="px-1.5 py-0.5 rounded bg-[#2a2a2c] text-[#e4e4e7] text-[13px]" {...props}>
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
        {message.isStreaming && !message.content && (
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
