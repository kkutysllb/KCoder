// messageAdapter — 旧 Message 模型到新 ChatMessage 模型的适配层。
//
// 由于 useChat.ts（768 行）深度依赖旧 store API（addMessage / appendMessagePart /
// updateLastToolCall 等），一次性全部迁移到 turnReducer 风险高。本模块提供
// 转换函数，让新的 ChatFeed / AssistantTurn / UserBubble 等组件可以直接消费
// 旧 store 的 Message[] 数据，实现"组件层先迁移，数据层渐进迁移"。
//
// 转换规则：
//   - user 消息：Message{content} → ChatMessage{content}（直接复制）
//   - assistant 消息：Message{parts[]} → ChatMessage{text/reasoning/toolCalls/...}
//     按 part.type 聚合到平铺字段

import type { Message, MessagePart } from '../stores/app-store'
import type {
  ChatMessage,
  ReasoningBlock,
  ToolCall,
  TurnStatus,
  TurnUsage
} from './chatMessage'
import { isInternalOnlyText, sanitizeAssistantText } from './chatMessage'

/**
 * 把旧 Message 转为新 ChatMessage。
 * 纯函数，无副作用；每次调用都返回新对象。
 *
 * 关键：所有 role 都过一遍 sanitizeAssistantText 兜底——防止 QiLin 注入的
 * <memory>...</memory> 等内部块经任何路径（loadThread / SSE / 历史回放）
 * 泄漏到 UI。如果净化后内容为空，整条消息直接丢（返回 null 时由
 * adaptMessages / 调方过滤）。
 */
export function adaptMessage(msg: Message): ChatMessage | null {
  if (msg.role === 'user') {
    // 用户自己发的消息理论上不含内部块，但仍走净化兜底（防止 gateway 误把
    // system reminder 标记为 user role 注入）
    if (isInternalOnlyText(msg.content)) return null
    return {
      id: msg.id,
      role: 'user',
      createdAt: msg.timestamp,
      content: sanitizeAssistantText(msg.content)
    }
  }

  if (msg.role === 'system') {
    // system reminder 整条都是 internal → 整条丢
    if (isInternalOnlyText(msg.content)) return null
    return {
      id: msg.id,
      role: 'system',
      createdAt: msg.timestamp,
      content: sanitizeAssistantText(msg.content)
    }
  }

  // assistant：聚合 parts 到平铺字段
  return adaptAssistantMessage(msg)
}

/** 批量适配。返回的数组已过滤掉整条都是 internal 的消息。 */
export function adaptMessages(messages: Message[]): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const m of messages) {
    const a = adaptMessage(m)
    if (a !== null) out.push(a)
  }
  return out
}

/** assistant 消息适配——把 parts[] 聚合到 ChatMessage 平铺字段。 */
function adaptAssistantMessage(msg: Message): ChatMessage {
  const parts = msg.parts ?? []
  let text = ''
  let reasoning: ReasoningBlock | undefined
  let reasoningStartedAt: number | undefined
  const toolCalls: ToolCall[] = []
  let usage: TurnUsage | undefined
  let stage: string | undefined
  let error: string | undefined
  let status: TurnStatus | undefined

  for (const part of parts) {
    switch (part.type) {
      case 'text': {
        text += part.text
        break
      }
      case 'reasoning': {
        // 多个 reasoning part → 累积成一个 ReasoningBlock
        if (!reasoning) {
          reasoning = {
            text: part.text,
            startedAt: part.startedAt ?? msg.timestamp
          }
          reasoningStartedAt = part.startedAt
        } else {
          reasoning = {
            ...reasoning,
            text: reasoning.text + part.text
          }
        }
        // isStreaming=false 表示收尾
        if (part.isStreaming === false && reasoning) {
          reasoning = {
            ...reasoning,
            endedAt: part.completedAt ?? Date.now()
          }
        }
        break
      }
      case 'tool_call': {
        toolCalls.push({
          id: part.callId ?? `tc_${toolCalls.length}`,
          name: part.toolName,
          args: part.args,
          status:
            part.status === 'completed' ? 'completed' :
            part.status === 'failed' ? 'failed' : 'running',
          startedAt: part.startedAt,
          endedAt: part.completedAt,
          summary: part.summary
        })
        break
      }
      case 'tool_result': {
        // 回填到匹配的 tool_call（按 name 匹配最后一个 running 的同名调用）
        const targetIdx = findLastIndex(
          toolCalls,
          (tc) => tc.name === part.toolName && tc.status === 'running'
        )
        if (targetIdx >= 0) {
          toolCalls[targetIdx] = {
            ...toolCalls[targetIdx],
            status: part.isError ? 'failed' : 'completed',
            output: part.output,
            isError: part.isError || undefined,
            endedAt: Date.now()
          }
        }
        break
      }
      case 'usage': {
        usage = {
          promptTokens: part.promptTokens,
          completionTokens: part.completionTokens,
          totalTokens: part.totalTokens
        }
        break
      }
      case 'compaction': {
        status = 'compacted'
        break
      }
      case 'approval': {
        // 审批作为特殊 tool_call 渲染
        toolCalls.push({
          id: part.approvalId,
          name: part.toolName,
          summary: part.summary,
          status:
            part.status === 'allowed' ? 'completed' :
            part.status === 'denied' || part.status === 'expired' ? 'failed' : 'running',
          startedAt: Date.now()
        })
        break
      }
    }
  }

  // 旧 content 字段兼容（如果 parts 为空但 content 有值）
  if (!text && msg.content) {
    text = msg.content
  }

  // 推断 stage（简单规则：有 tool_call running → executing；否则 streaming 时 → planning）
  if (toolCalls.some((tc) => tc.status === 'running')) {
    stage = 'executing'
  } else if (msg.isStreaming && !text && !reasoning) {
    stage = 'planning'
  } else if (msg.isStreaming) {
    stage = 'executing'
  }

  // 推断 status
  if (!status) {
    if (msg.isStreaming) {
      status = 'streaming'
    } else if (error) {
      status = 'error'
    } else {
      status = 'done'
    }
  }

  return {
    id: msg.id,
    role: 'assistant',
    createdAt: msg.timestamp,
    text: text || undefined,
    reasoning,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    usage,
    stage,
    status,
    isStreaming: msg.isStreaming,
    thinkingMs: reasoning?.startedAt != null && reasoning.endedAt != null
      ? reasoning.endedAt - reasoning.startedAt
      : undefined
  }
}

/** findLastIndex 工具函数（ES2023 之前无原生支持）。 */
function findLastIndex<T>(arr: T[], predicate: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i])) return i
  }
  return -1
}
