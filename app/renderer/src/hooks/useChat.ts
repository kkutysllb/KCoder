import { useCallback, useRef } from 'react'
import { useAppStore, type Message, type MessagePart } from '../stores/app-store'
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
    appendMessagePart,
    updateLastToolCall,
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

  /**
   * 处理后端 SSE 事件（按 RuntimeEventKind 分发）。
   * 富内容写入 message.parts，文本同时同步到 content（向后兼容）。
   */
  const handleSseEvent = useCallback(
    (assistantMessageId: string, event: SSEEvent) => {
      const { kind, data } = event

      switch (kind) {
        // —— 文本流式增量 ——
        case 'assistant_text_delta': {
          const delta = (data.delta as string) ?? ''
          if (delta) appendMessagePart(assistantMessageId, { type: 'text', text: delta })
          break
        }

        // —— 推理流式增量 ——
        case 'assistant_reasoning_delta': {
          const delta = (data.delta as string) ?? (data.text as string) ?? ''
          if (delta) appendMessagePart(assistantMessageId, { type: 'reasoning', text: delta })
          break
        }

        // —— item 事件（携带完整 TurnItem）——
        case 'item_created':
        case 'item_updated':
        case 'item_completed': {
          const item = data.item as Record<string, unknown> | undefined
          if (!item) break
          handleItemEvent(assistantMessageId, item, kind, appendMessagePart, updateLastToolCall)
          break
        }

        // —— 工具调用生命周期 ——
        case 'tool_call_started': {
          const callId = (data.callId as string) ?? ''
          const toolName = (data.toolName as string) ?? 'tool'
          if (callId) {
            appendMessagePart(assistantMessageId, { type: 'tool_call', toolName, status: 'running', callId })
          }
          break
        }
        case 'tool_call_finished': {
          const callId = (data.callId as string) ?? ''
          if (callId) {
            updateLastToolCall(assistantMessageId, callId, {
              status: data.isError ? 'failed' : 'completed',
              summary: (data.summary as string) ?? undefined
            })
          }
          break
        }

        // —— token 用量 ——
        case 'usage': {
          const usage = data.usage as Record<string, unknown> | undefined
          if (usage) {
            appendMessagePart(assistantMessageId, {
              type: 'usage',
              promptTokens: (usage.promptTokens as number) ?? 0,
              completionTokens: (usage.completionTokens as number) ?? 0,
              totalTokens: (usage.totalTokens as number) ?? 0
            })
          }
          break
        }

        // —— 错误 ——
        case 'error': {
          const msg = (data.message as string) ?? '发生错误'
          appendMessagePart(assistantMessageId, { type: 'text', text: `\n\n⚠️ ${msg}` })
          break
        }

        // turn 终止事件由 subscribeToThread 处理（resolve promise）
        case 'turn_completed':
        case 'turn_failed':
        case 'turn_aborted':
        case 'heartbeat':
        case 'pipeline_stage':
        case 'tool_call_ready':
        case 'tool_result_upload_wait':
        case 'tool_storm_suppressed':
        case 'tool_catalog_changed':
        case 'thread_created':
        case 'thread_updated':
        case 'turn_started':
        case 'turn_steered':
        case 'compaction_started':
        case 'compaction_completed':
        case 'goal_updated':
        case 'goal_cleared':
        case 'todos_updated':
        case 'todos_cleared':
        case 'approval_requested':
        case 'approval_resolved':
        case 'user_input_requested':
        case 'user_input_resolved':
        case 'agent_message_delta':
        case 'agent_message_completed':
          // 这些事件暂不渲染（后续迭代），静默忽略
          break
      }
    },
    [appendMessagePart, updateLastToolCall]
  )

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

      // Add placeholder for assistant response（带空 parts 数组）
      const assistantMessageId = `assistant-${Date.now()}`
      const assistantMessage: Message = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
        parts: []
      }
      addMessage(assistantMessage)
      setGenerating(true)

      try {
        await api.sendMessage(currentThreadId, content.trim(), (event: SSEEvent) => {
          handleSseEvent(assistantMessageId, event)
        })
      } catch (error) {
        console.error('Failed to send message:', error)
        appendMessagePart(assistantMessageId, {
          type: 'text',
          text: '⚠️ 无法连接到引擎，请检查引擎状态后重试。'
        })
      } finally {
        updateMessage(assistantMessageId, useAppStore.getState().messages.find((m) => m.id === assistantMessageId)?.content ?? '')
        setGenerating(false)
      }
    },
    [enginePort, threadId, isGenerating, addMessage, updateMessage, appendMessagePart, setThreadId, setGenerating, setEngineStatus, handleSseEvent]
  )

  // 加载历史会话
  const loadThread = useCallback(
    async (loadThreadId: string) => {
      const api = getEngineAPI(enginePort)
      try {
        const thread = (await api.getThread(loadThreadId)) as {
          turns?: Array<{ items?: Array<Record<string, unknown>> }>
        }
        clearMessages()
        setThreadId(loadThreadId)
        const newMessages: Message[] = []
        for (const turn of thread.turns ?? []) {
          for (const item of turn.items ?? []) {
            const role = (item.role as string) ?? 'assistant'
            const kind = (item.kind as string) ?? ''
            if (role === 'user' || kind === 'user_message') {
              newMessages.push({
                id: (item.id as string) ?? `msg-${Date.now()}-${Math.random()}`,
                role: 'user',
                content: (item.text as string) ?? '',
                timestamp: Date.parse((item.createdAt as string) ?? '') || Date.now()
              })
            } else if (kind === 'assistant_text') {
              newMessages.push({
                id: (item.id as string) ?? `msg-${Date.now()}-${Math.random()}`,
                role: 'assistant',
                content: (item.text as string) ?? '',
                timestamp: Date.parse((item.createdAt as string) ?? '') || Date.now(),
                parts: [{ type: 'text', text: (item.text as string) ?? '' }]
              })
            }
          }
        }
        // 批量加入（绕过逐条 addMessage 的多次 set）
        useAppStore.setState((state) => ({ messages: [...state.messages, ...newMessages] }))
      } catch (error) {
        console.error('Failed to load thread:', error)
      }
    },
    [enginePort, clearMessages, setThreadId]
  )

  // Start a new chat
  const newChat = useCallback(() => {
    clearMessages()
  }, [clearMessages])

  return {
    messages,
    isGenerating,
    threadId,
    sendMessage,
    newChat,
    loadThread,
    checkConnection
  }
}

/**
 * 处理 item_created/item_updated/item_completed 事件中的 TurnItem。
 * 按 item.kind 分发到对应的 message part。
 */
function handleItemEvent(
  assistantMessageId: string,
  item: Record<string, unknown>,
  kind: string,
  appendPart: (id: string, part: MessagePart) => void,
  updateToolCall: (id: string, callId: string, patch: Partial<Extract<MessagePart, { type: 'tool_call' }>>) => void
) {
  const itemKind = (item.kind as string) ?? ''
  const isCompleted = kind === 'item_completed'

  switch (itemKind) {
    case 'assistant_text': {
      // item_completed 时追加完整文本（delta 已增量追加的不重复）
      if (isCompleted) {
        const text = (item.text as string) ?? ''
        // 仅当 parts 中没有该文本时追加（避免重复）
        appendPart(assistantMessageId, { type: 'text', text: '' }) // no-op 占位，实际靠 delta
      }
      break
    }
    case 'assistant_reasoning': {
      // 推理块在 item_completed 时完整加入（若 delta 未覆盖）
      break
    }
    case 'tool_call': {
      const callId = (item.callId as string) ?? ''
      const toolName = (item.toolName as string) ?? 'tool'
      const status = (item.status as string) ?? 'running'
      if (callId) {
        const mappedStatus = status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'running'
        updateToolCall(assistantMessageId, callId, {
          status: mappedStatus as 'running' | 'completed' | 'failed',
          summary: (item.summary as string) ?? undefined
        })
      } else if (isCompleted) {
        appendPart(assistantMessageId, {
          type: 'tool_call',
          toolName,
          status: 'completed',
          summary: (item.summary as string) ?? undefined
        })
      }
      break
    }
    case 'tool_result': {
      const toolName = (item.toolName as string) ?? 'tool'
      const output = item.output
      const isError = (item.isError as boolean) ?? false
      appendPart(assistantMessageId, {
        type: 'tool_result',
        toolName,
        output: typeof output === 'string' ? output : JSON.stringify(output),
        isError
      })
      break
    }
  }
}
