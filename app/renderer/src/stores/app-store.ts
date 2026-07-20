import { create } from 'zustand'

// Message types
export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  isStreaming?: boolean
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

  // Workspace
  workspacePath: string | null

  // Actions
  initializeEngine: (port: number) => void
  setEngineStatus: (status: EngineStatus) => void
  setThreadId: (id: string | null) => void
  addMessage: (message: Message) => void
  updateMessage: (id: string, content: string) => void
  setGenerating: (generating: boolean) => void
  setWorkspacePath: (path: string | null) => void
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

  setGenerating: (generating) => set({ isGenerating: generating }),

  setWorkspacePath: (path) => set({ workspacePath: path }),

  clearMessages: () => set({ messages: [], threadId: null })
}))
