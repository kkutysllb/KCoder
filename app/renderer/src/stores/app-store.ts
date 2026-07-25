import { create } from 'zustand'
import type { ApprovalRequest, UserInputRequest } from '../services/engine-api'

// 富内容消息部件 — assistant 消息由多个 part 组成（文本/推理/工具调用/工具结果/usage/审批）
export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool_call'; toolName: string; status: 'running' | 'completed' | 'failed'; callId?: string; summary?: string }
  | { type: 'tool_result'; toolName: string; output?: string; isError?: boolean }
  | { type: 'usage'; promptTokens: number; completionTokens: number; totalTokens: number }
  | { type: 'approval'; approvalId: string; toolName: string; summary?: string; status: 'pending' | 'allowed' | 'denied' | 'expired' }

// Message types
export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  isStreaming?: boolean
  /** 富内容部件（assistant 消息）。向后兼容：若无 parts 则用 content 渲染纯文本。 */
  parts?: MessagePart[]
}

// Engine connection status
export type EngineStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

// App state
interface AppState {
  // Engine
  enginePort: number
  engineToken: string
  engineStatus: EngineStatus

  // Chat
  threadId: string | null
  messages: Message[]
  isGenerating: boolean

  // Workspace / task context（输入框上方窄条的选择状态）
  workspacePath: string | null
  selectedBranch: string | null
  selectedModel: string | null
  /** 新建任务时使用的分支名（非空表示要在创建线程前新建该分支） */
  pendingNewBranch: string | null

  // 交互请求（审批 + 结构化输入）— 后端发 SSE 事件，前端需用户响应
  pendingApproval: ApprovalRequest | null
  pendingUserInput: UserInputRequest | null

  // Actions
  initializeEngine: (port: number) => void
  setEngineStatus: (status: EngineStatus) => void
  setThreadId: (id: string | null) => void
  addMessage: (message: Message) => void
  updateMessage: (id: string, content: string) => void
  appendMessagePart: (id: string, part: MessagePart) => void
  updateLastToolCall: (id: string, callId: string, patch: Partial<Extract<MessagePart, { type: 'tool_call' }>>) => void
  updateApprovalPart: (messageId: string, approvalId: string, status: 'pending' | 'allowed' | 'denied' | 'expired') => void
  setGenerating: (generating: boolean) => void
  setWorkspacePath: (path: string | null) => void
  setSelectedBranch: (branch: string | null) => void
  setSelectedModel: (model: string | null) => void
  setPendingNewBranch: (branch: string | null) => void
  setPendingApproval: (approval: ApprovalRequest | null) => void
  setPendingUserInput: (input: UserInputRequest | null) => void
  clearMessages: () => void
}

export const useAppStore = create<AppState>((set) => ({
  // Initial state
  enginePort: 18899,
  engineToken: '',
  engineStatus: 'disconnected',
  threadId: null,
  messages: [],
  isGenerating: false,
  workspacePath: null,
  selectedBranch: null,
  selectedModel: null,
  pendingNewBranch: null,
  pendingApproval: null,
  pendingUserInput: null,

  // Actions
  initializeEngine: (port) =>
    set({ enginePort: port, engineStatus: 'connecting' }),

  setEngineStatus: (status) => set({ engineStatus: status }),

  setThreadId: (id) => set({ threadId: id }),

  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

  updateMessage: (id, content) =>
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === id ? { ...msg, content, isStreaming: false } : msg
      )
    })),

  appendMessagePart: (id, part) =>
    set((state) => ({
      messages: state.messages.map((msg) => {
        if (msg.id !== id) return msg
        const parts = msg.parts ? [...msg.parts] : []
        // 文本 part 累加：若最后一个 part 是 text，则合并
        if (part.type === 'text' && parts.length > 0) {
          const last = parts[parts.length - 1]
          if (last.type === 'text') {
            parts[parts.length - 1] = { type: 'text', text: last.text + part.text }
            return { ...msg, parts, content: msg.content + part.text }
          }
        }
        parts.push(part)
        // 同步 content（用于纯文本回退渲染）
        const contentUpdate = part.type === 'text' ? msg.content + part.text : msg.content
        return { ...msg, parts, content: contentUpdate }
      })
    })),

  updateLastToolCall: (id, callId, patch) =>
    set((state) => ({
      messages: state.messages.map((msg) => {
        if (msg.id !== id || !msg.parts) return msg
        const parts = [...msg.parts]
        // 找到匹配 callId 的最后一个 tool_call part 并更新
        for (let i = parts.length - 1; i >= 0; i--) {
          const p = parts[i]
          if (p.type === 'tool_call' && p.callId === callId) {
            parts[i] = { ...p, ...patch }
            break
          }
        }
        return { ...msg, parts }
      })
    })),

  updateApprovalPart: (messageId, approvalId, status) =>
    set((state) => ({
      messages: state.messages.map((msg) => {
        if (msg.id !== messageId || !msg.parts) return msg
        return {
          ...msg,
          parts: msg.parts.map((p) =>
            p.type === 'approval' && p.approvalId === approvalId ? { ...p, status } : p
          )
        }
      })
    })),

  setGenerating: (generating) => set({ isGenerating: generating }),

  setWorkspacePath: (path) => set({ workspacePath: path }),
  setSelectedBranch: (branch) => set({ selectedBranch: branch }),
  setSelectedModel: (model) => set({ selectedModel: model }),
  setPendingNewBranch: (branch) => set({ pendingNewBranch: branch }),
  setPendingApproval: (approval) => set({ pendingApproval: approval }),
  setPendingUserInput: (input) => set({ pendingUserInput: input }),

  clearMessages: () => set({ messages: [], threadId: null, pendingNewBranch: null })
}))
