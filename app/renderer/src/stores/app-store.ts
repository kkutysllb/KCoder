import { create } from 'zustand'
import type {
  ApprovalRequest,
  UserInputRequest,
  TurnExecutionView,
  ThreadGoal,
  ThreadTodoList,
  BranchProjection,
  BranchStatus,
  GraphRunInspection,
  CircuitState
} from '../services/engine-api'
import type { RoiSnapshot } from '@qiongqi/contracts'

// 富内容消息部件 — assistant 消息由多个 part 组成（文本/推理/工具调用/工具结果/usage/审批）
// `branchId` 标记该 part 来自哪个持久化并行分支（root agent 的 part 无 branchId），
// 用于并发分支场景下按 (itemId, branchId) 去重与按分支分组渲染。
export type MessagePart =
  | { type: 'text'; text: string; itemId?: string; branchId?: string }
  | { type: 'reasoning'; text: string; itemId?: string; branchId?: string }
  | { type: 'tool_call'; toolName: string; status: 'running' | 'completed' | 'failed'; callId?: string; summary?: string; branchId?: string }
  | { type: 'tool_result'; toolName: string; output?: string; isError?: boolean; branchId?: string }
  | { type: 'usage'; promptTokens: number; completionTokens: number; totalTokens: number; branchId?: string }
  | { type: 'approval'; approvalId: string; toolName: string; summary?: string; status: 'pending' | 'allowed' | 'denied' | 'expired'; branchId?: string }

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

/** 浮动面板展开策略 */
export type PanelStrategy = 'manual' | 'auto'

/** 浮动面板激活的 tab */
export type PanelTab = 'execution' | 'plan' | 'env'

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
  /** 模型配置变更计数器（设置页保存后递增，触发聊天框刷新模型列表） */
  modelVersion: number

  // 交互请求（审批 + 结构化输入）— 后端发 SSE 事件，前端需用户响应
  //
  // v1.1.2: 并行分支场景下多个分支可同时各自请求审批/输入，因此除了
  // 单值的 pendingApproval/pendingUserInput（兼容旧 UI，指向最新的 pending
  // 项）外，新增 pendingApprovals/pendingUserInputs 两个 Map 容纳并发请求。
  pendingApproval: ApprovalRequest | null
  pendingUserInput: UserInputRequest | null
  pendingApprovals: Record<string, ApprovalRequest>
  pendingUserInputs: Record<string, UserInputRequest>

  // 执行投影视图（run timeline 投影 + engine stream 增量）
  activeTurnId: string | null
  turnExecution: TurnExecutionView | null
  /** v1.1.2 持久化并行分支投影：branchId -> 分支状态/agent/ROI。 */
  branches: Record<string, BranchProjection>
  /** v1.1.2 顶层 ROI 快照（来自 roi.snapshot engine stream 事件）。 */
  roiSnapshot: RoiSnapshot | null

  // 浮动信息面板
  panelOpen: boolean
  panelStrategy: PanelStrategy
  panelTab: PanelTab

  // 线程目标 + 待办（GET /v1/threads/:id/goal + /todos）
  threadGoal: ThreadGoal | null
  threadTodos: ThreadTodoList | null

  // governed graph 治理（GET /v1/engine/runs/:runId/inspect）
  graphRunInspection: GraphRunInspection | null

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
  bumpModelVersion: () => void
  setPendingNewBranch: (branch: string | null) => void
  setPendingApproval: (approval: ApprovalRequest | null) => void
  setPendingUserInput: (input: UserInputRequest | null) => void
  /** Add/replace a concurrent pending approval (keyed by approvalId). */
  addPendingApproval: (approval: ApprovalRequest) => void
  /** Mark a concurrent approval resolved and drop it from the pending map. */
  resolvePendingApproval: (approvalId: string) => void
  /** Add/replace a concurrent pending user-input (keyed by inputId). */
  addPendingUserInput: (input: UserInputRequest) => void
  /** Mark a concurrent user-input resolved and drop it from the pending map. */
  resolvePendingUserInput: (inputId: string) => void
  setActiveTurnId: (id: string | null) => void
  setTurnExecution: (view: TurnExecutionView | null) => void
  /** Upsert a durable parallel branch projection (from branch.* stream events). */
  upsertBranch: (branchId: string, patch: Partial<BranchProjection> & { status?: BranchStatus }) => void
  /** Settle a branch to a terminal status (completed/failed/aborted). */
  settleBranch: (branchId: string, status: BranchStatus) => void
  /** Replace the whole branches map (from a timeline snapshot). */
  setBranches: (branches: Record<string, BranchProjection>) => void
  /** Replace the ROI snapshot (from roi.snapshot stream event). */
  setRoiSnapshot: (roi: RoiSnapshot | null) => void
  setPanelOpen: (open: boolean) => void
  setPanelStrategy: (strategy: PanelStrategy) => void
  setPanelTab: (tab: PanelTab) => void
  setThreadGoal: (goal: ThreadGoal | null) => void
  setThreadTodos: (todos: ThreadTodoList | null) => void
  /** Set the governed graph run inspection (from inspect endpoint). */
  setGraphRunInspection: (inspection: GraphRunInspection | null) => void
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
  modelVersion: 0,
  pendingNewBranch: null,
  pendingApproval: null,
  pendingUserInput: null,
  pendingApprovals: {},
  pendingUserInputs: {},
  activeTurnId: null,
  turnExecution: null,
  branches: {},
  roiSnapshot: null,
  panelOpen: false,
  panelStrategy: 'manual',
  panelTab: 'execution',
  threadGoal: null,
  threadTodos: null,
  graphRunInspection: null,

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

        // Item-bound text/reasoning (from item_created/item_updated/item_completed):
        // the engine ships the full payload per item event with no delta stream,
        // so we dedupe by itemId and replace with the latest content rather than
        // appending. This keeps repeated item_updated events from duplicating text.
        if ((part.type === 'text' || part.type === 'reasoning') && part.itemId) {
          const idx = parts.findIndex(
            (p) => (p.type === 'text' || p.type === 'reasoning') && p.itemId === part.itemId
          )
          if (idx >= 0) {
            parts[idx] = { ...part }
            // Rebuild content from all text parts so the plain-text fallback stays in sync.
            const content = parts.filter((p) => p.type === 'text').map((p) => p.text).join('')
            return { ...msg, parts, content }
          }
          // itemId not seen yet — fall through to append below.
        }

        // Delta-style text accumulation: if the last part is a free-form text
        // part (no itemId), merge into it.
        if (part.type === 'text' && parts.length > 0) {
          const last = parts[parts.length - 1]
          if (last.type === 'text' && !last.itemId) {
            parts[parts.length - 1] = { type: 'text', text: last.text + part.text }
            return { ...msg, parts, content: msg.content + part.text }
          }
        }
        parts.push(part)
        // Sync content (for plain-text fallback rendering).
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
  bumpModelVersion: () => set((state) => ({ modelVersion: state.modelVersion + 1 })),
  setPendingNewBranch: (branch) => set({ pendingNewBranch: branch }),

  // Legacy single-value setters (kept for existing components). They sync the
  // concurrent map so the two views never disagree.
  setPendingApproval: (approval) =>
    set((state) => {
      if (!approval) {
        // Clearing the legacy pointer clears only pending items from the map.
        const remaining: Record<string, ApprovalRequest> = {}
        for (const [id, a] of Object.entries(state.pendingApprovals)) {
          if (a.status === 'pending') continue
          remaining[id] = a
        }
        return { pendingApproval: null, pendingApprovals: remaining }
      }
      return {
        pendingApproval: approval,
        pendingApprovals: { ...state.pendingApprovals, [approval.approvalId]: approval }
      }
    }),
  setPendingUserInput: (input) =>
    set((state) => {
      if (!input) {
        const remaining: Record<string, UserInputRequest> = {}
        for (const [id, i] of Object.entries(state.pendingUserInputs)) {
          if (i.status === 'pending') continue
          remaining[id] = i
        }
        return { pendingUserInput: null, pendingUserInputs: remaining }
      }
      return {
        pendingUserInput: input,
        pendingUserInputs: { ...state.pendingUserInputs, [input.inputId]: input }
      }
    }),

  // Concurrent approval/input management (v1.1.2 parallel branches).
  addPendingApproval: (approval) =>
    set((state) => ({
      pendingApprovals: { ...state.pendingApprovals, [approval.approvalId]: approval },
      // Keep the legacy pointer on the most recent pending request.
      pendingApproval: approval.status === 'pending' ? approval : state.pendingApproval
    })),
  resolvePendingApproval: (approvalId) =>
    set((state) => {
      const next = { ...state.pendingApprovals }
      delete next[approvalId]
      // Repoint the legacy field to any other still-pending approval.
      const fallback = Object.values(next).find((a) => a.status === 'pending') ?? null
      return { pendingApprovals: next, pendingApproval: fallback }
    }),
  addPendingUserInput: (input) =>
    set((state) => ({
      pendingUserInputs: { ...state.pendingUserInputs, [input.inputId]: input },
      pendingUserInput: input.status === 'pending' ? input : state.pendingUserInput
    })),
  resolvePendingUserInput: (inputId) =>
    set((state) => {
      const next = { ...state.pendingUserInputs }
      delete next[inputId]
      const fallback = Object.values(next).find((i) => i.status === 'pending') ?? null
      return { pendingUserInputs: next, pendingUserInput: fallback }
    }),

  setActiveTurnId: (id) => set({ activeTurnId: id }),
  setTurnExecution: (view) => set({ turnExecution: view }),

  // v1.1.2 durable parallel branch projection.
  upsertBranch: (branchId, patch) =>
    set((state) => {
      const prev = state.branches[branchId]
      // Merge: minimal defaults < existing record < incoming patch. branchId is
      // always forced to the key so the record can never lose its identity.
      // Built via Object.assign to avoid TS2783 (literal property overridden by
      // a spread whose type is known to carry the same key).
      const merged: BranchProjection = Object.assign(
        { agentKeys: [], status: 'queued' as BranchStatus },
        prev ?? {},
        patch,
        { branchId }
      )
      return { branches: { ...state.branches, [branchId]: merged } }
    }),
  settleBranch: (branchId, status) =>
    set((state) => {
      const prev = state.branches[branchId]
      if (!prev) return {}
      return { branches: { ...state.branches, [branchId]: { ...prev, status } } }
    }),
  setBranches: (branches) => set({ branches }),
  setRoiSnapshot: (roi) => set({ roiSnapshot: roi }),

  setPanelOpen: (open) => set({ panelOpen: open }),
  setPanelStrategy: (strategy) => set({ panelStrategy: strategy }),
  setPanelTab: (tab) => set({ panelTab: tab }),
  setThreadGoal: (goal) => set({ threadGoal: goal }),
  setThreadTodos: (todos) => set({ threadTodos: todos }),
  setGraphRunInspection: (inspection) => set({ graphRunInspection: inspection }),

  clearMessages: () =>
    set({
      messages: [],
      threadId: null,
      pendingNewBranch: null,
      branches: {},
      graphRunInspection: null,
      roiSnapshot: null
    })
}))
