import { useRef, useEffect, useState } from 'react'
import { useChat } from '../../hooks/useChat'
import { useAppStore } from '../../stores/app-store'
import { MessageBubble } from './MessageBubble'
import { CommandInput } from '../CommandInput'
import { ExecutionView } from './ExecutionView'

export function ChatPanel() {
  const { messages, isGenerating, sendMessage } = useChat()
  const turnExecution = useAppStore((s) => s.turnExecution)
  const [showExec, setShowExec] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 有执行投影数据时自动展开侧栏
  useEffect(() => {
    if (turnExecution?.available) setShowExec(true)
  }, [turnExecution])

  return (
    <div className="flex flex-1 h-full overflow-hidden">
      {/* 消息 + 输入区 */}
      <div className="flex flex-1 flex-col min-w-0">
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto max-w-3xl space-y-6">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>
        <div className="px-6 pb-6">
          <CommandInput onSend={sendMessage} disabled={isGenerating} />
        </div>
      </div>

      {/* 执行视图侧栏（可折叠） */}
      {showExec && (
        <div className="w-[300px] shrink-0 border-l border-border-custom bg-bg-sidebar flex flex-col">
          {/* 侧栏头：标题 + 关闭 */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border-custom shrink-0">
            <span className="text-xs font-medium text-text-secondary">执行视图</span>
            <button
              onClick={() => setShowExec(false)}
              className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <ExecutionView />
          </div>
        </div>
      )}
    </div>
  )
}
