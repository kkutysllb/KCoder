import { useRef, useEffect } from 'react'
import { useChat } from '../../hooks/useChat'
import { MessageBubble } from './MessageBubble'
import { CommandInput } from '../CommandInput'

export function ChatPanel() {
  const { messages, isGenerating, sendMessage, stopGeneration, steer } = useChat()
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="flex flex-1 flex-col h-full">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input area */}
      <div className="px-6 pb-6">
        <CommandInput
          onSend={sendMessage}
          disabled={isGenerating}
          isGenerating={isGenerating}
          onStop={stopGeneration}
          onSteer={steer}
        />
      </div>
    </div>
  )
}
