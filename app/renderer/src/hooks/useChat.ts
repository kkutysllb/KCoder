import { useCallback, useRef } from 'react'
import { useAppStore, type Message } from '../stores/app-store'
import { getEngineAPI, type SSEEvent } from '../services/engine-api'

export function useChat() {
  const {
    enginePort,
    threadId,
    messages,
    isGenerating,
    setThreadId,
    addMessage,
    updateMessage,
    setGenerating,
    setEngineStatus,
    clearMessages
  } = useAppStore()

  const abortRef = useRef<AbortController | null>(null)

  // Initialize connection and check health
  const checkConnection = useCallback(async () => {
    const api = getEngineAPI(enginePort)
    const healthy = await api.health()
    setEngineStatus(healthy ? 'connected' : 'error')
    return healthy
  }, [enginePort, setEngineStatus])

  // Send a message
  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isGenerating) return

      const api = getEngineAPI(enginePort)

      // Add user message
      const userMessage: Message = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: content.trim(),
        timestamp: Date.now()
      }
      addMessage(userMessage)

      // Create thread if needed
      let currentThreadId = threadId
      if (!currentThreadId) {
        try {
          const thread = await api.createThread()
          currentThreadId = thread.id
          setThreadId(currentThreadId)
        } catch (error) {
          console.error('Failed to create thread:', error)
          setEngineStatus('error')
          return
        }
      }

      // Add placeholder for assistant response
      const assistantMessageId = `assistant-${Date.now()}`
      const assistantMessage: Message = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true
      }
      addMessage(assistantMessage)
      setGenerating(true)

      try {
        let accumulatedContent = ''

        await api.sendMessage(currentThreadId, content.trim(), (event: SSEEvent) => {
          // Handle different event types
          const data = event.data as Record<string, unknown>

          if (data.type === 'item.created' || data.type === 'content.delta') {
            const delta = (data.delta as string) || (data.content as string) || ''
            accumulatedContent += delta
            updateMessage(assistantMessageId, accumulatedContent)
          } else if (data.type === 'item.completed') {
            const item = data.item as Record<string, unknown>
            if (item?.content) {
              const contentArray = item.content as Array<{ text?: string }>
              const text = contentArray.map((c) => c.text || '').join('')
              if (text) {
                accumulatedContent = text
                updateMessage(assistantMessageId, accumulatedContent)
              }
            }
          }
        })
      } catch (error) {
        console.error('Failed to send message:', error)
        updateMessage(assistantMessageId, 'Error: Failed to get response from engine.')
      } finally {
        setGenerating(false)
      }
    },
    [enginePort, threadId, isGenerating, addMessage, updateMessage, setThreadId, setGenerating, setEngineStatus]
  )

  // Start a new chat
  const newChat = useCallback(() => {
    clearMessages()
  }, [clearMessages])

  return {
    messages,
    isGenerating,
    sendMessage,
    newChat,
    checkConnection
  }
}
