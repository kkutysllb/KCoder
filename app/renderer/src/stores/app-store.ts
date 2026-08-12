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
import type { RoiSnapshot } from '../services/contracts'
import type { ChatMessage } from '../lib/chatMessage'

// 富内容消息部件 — assistant 消息由多个 part 组成（文本/推理/工具调用/工具结果/usage/审批）
// `branchId` 标记该 part 来自哪个持久化并行分支（root agent 的 part 无 branchId），
// 用于并发分支场景下按 (itemId, branchId) 去重与按分支分组渲染。
export type MessagePart =
  | { type: 'text'; text: string; itemId?: string; branchId?: string }
  | {
      type: 'reasoning'
      text: string
      itemId?: string
      branchId?: string
      /** 流式标记：收到 reasoning_delta 时为 true，文本流开始时收尾为 false */
      isStreaming?: boolean
      startedAt?: number
      completedAt?: number
    }
  | {
      type: 'tool_call'
      toolName: string
      status: 'running' | 'completed' | 'failed'
      callId?: string
      summary?: string
      branchId?: string
      startedAt?: number
      completedAt?: number
      /** 工具调用参数（从 data.args 提取）*/
      args?: Record<string, unknown>
    }
  | { type: 'tool_result'; toolName: string; output?: string; isError?: boolean; branchId?: string }
  | {
      type: 'usage'
      promptTokens: number
      completionTokens: number
      totalTokens: number
      branchId?: string
      model?: string
    }
  | {
      type: 'approval'
      approvalId: string
      toolName: string
      summary?: string
      status: 'pending' | 'allowed' | 'denied' | 'expired'
      branchId?: string
    }
  | { type: 'compaction'; kind: 'started' | 'completed'; branchId?: string }

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

/** 浮动面板展开策略 —— 已废弃（面板开合完全由用户控制，见 InfoPanel） */

// App state
interface AppState {
  // Engine
  enginePort: number
  engineToken: string
  engineStatus: EngineStatus

  // Chat
  threadId: string | null
  messages: Message[]
  /**
   * turn-based 消息列表（新架构）。与 messages 并行维护：
   *   - useChat.handleSseEvent 调 reduceSseEvent → applyTurnUpdate 写入这里
   *   - 渲染层（ChatFeed）优先读 messages_v2，缺失时 fallback 到 messages
   *   - addMessage 同时写两份（保持同步），turnReducer 只写 messages_v2
   */
  messages_v2: ChatMessage[]
  isGenerating: boolean

  /** 排队消息队列（queue 交互模式下，turn 运行中用户输入的消息入队，turn 完成后自动发送） */
  queuedMessages: string[]

  // Workspace / task context（输入框上方窄条的选择状态）
  workspacePath: string | null
  selectedBranch: string | null
  selectedModel: string | null
  /** 新建任务时使用的分支名（非空表示要在创建线程前新建该分支） */
  pendingNewBranch: string | null
  /** 模型配置变更计数器（设置页保存后递增，触发聊天框刷新模型列表） */
  modelVersion: number
  /** 侧边栏宽度（拖拽持久化） */
  sidebarWidth: number
  /** 设置面板左侧 nav 宽度（拖拽持久化） */
  settingsNavWidth: number
  /** 推理深度（每次 turn 生效）：auto=默认 / off=关闭思考 / low|medium|high=显式强度 */
  reasoningMode: 'auto' | 'off' | 'low' | 'medium' | 'high'

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
  /** 当前会话累计用量（来自 usage SSE 事件，供输入框底部 ROI 缩略条展示）。 */
  sessionUsage: { promptTokens: number; completionTokens: number; totalTokens: number; runs: number }

  // 浮动信息面板
  panelOpen: boolean
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
  /** 收尾流式 reasoning：把最后一个 isStreaming:true 的 reasoning part 标记为完成。 */
  settleStreamingReasoning: (id: string) => void
  updateLastToolCall: (id: string, callId: string, patch: Partial<Extract<MessagePart, { type: 'tool_call' }>>) => void
  updateApprovalPart: (messageId: string, approvalId: string, status: 'pending' | 'allowed' | 'denied' | 'expired') => void

  // ── turn-based (messages_v2) 新 API ──
  /** 添加一条 ChatMessage（同时同步到旧 messages 数组，保持双写）。 */
  addChatMessage: (msg: ChatMessage) => void
  /**
   * 用 turnReducer 产出的 partial state 更新 messages_v2 中指定 id 的消息。
   * 调用方负责先调 reduceSseEvent 得到 partial，再调本方法回写。
   * 同时把 text 同步到旧 messages 的 content 字段（向后兼容）。
   */
  applyTurnUpdate: (id: string, partial: Partial<ChatMessage>) => void
  /** 批量加载历史消息（loadThread 用）。输入旧 Message[]，内部双写 v2。 */
  setChatMessages: (msgs: Message[]) => void
  setGenerating: (generating: boolean) => void
  /** 入队一条消息（queue 模式）。 */
  enqueueMessage: (text: string) => void
  /** 出队首条消息并返回（无消息返回 undefined）。 */
  dequeueMessage: () => string | undefined
  setWorkspacePath: (path: string | null) => void
  setSelectedBranch: (branch: string | null) => void
  setSelectedModel: (model: string | null) => void
  bumpModelVersion: () => void
  setPendingNewBranch: (branch: string | null) => void
  setReasoningMode: (mode: 'auto' | 'off' | 'low' | 'medium' | 'high') => void
  setSidebarWidth: (width: number) => void
  setSettingsNavWidth: (width: number) => void
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
  /** 累加一次 turn 的用量到会话总量。 */
  addSessionUsage: (usage: { promptTokens: number; completionTokens: number; totalTokens: number }) => void
  setPanelOpen: (open: boolean) => void
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
  messages_v2: [],
  isGenerating: false,
  queuedMessages: [],
  workspacePath: null,
  selectedBranch: null,
  selectedModel: null,
  modelVersion: 0,
  reasoningMode: 'auto',
  sidebarWidth: 240,
  settingsNavWidth: 200,
  pendingNewBranch: null,
  pendingApproval: null,
  pendingUserInput: null,
  pendingApprovals: {},
  pendingUserInputs: {},
  activeTurnId: null,
  turnExecution: null,
  branches: {},
  roiSnapshot: null,
  sessionUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, runs: 0 },
  panelOpen: false,
  threadGoal: null,
  threadTodos: null,
  graphRunInspection: null,

  // Actions
  initializeEngine: (port) =>
    set({ enginePort: port, engineStatus: 'connecting' }),

  setEngineStatus: (status) => set({ engineStatus: status }),

  setThreadId: (id) => set({ threadId: id }),

  addMessage: (message) =>
    set((state) => ({
      messages: [...state.messages, message],
      // 同步到 messages_v2（把旧 Message 适配成 ChatMessage）
      messages_v2: [...state.messages_v2, adaptLegacyToChat(message)]
    })),

  updateMessage: (id, content) =>
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === id ? { ...msg, content, isStreaming: false } : msg
      ),
      messages_v2: state.messages_v2.map((msg) =>
        msg.id === id
          ? { ...msg, text: content, isStreaming: false, status: msg.status === 'streaming' ? 'done' : msg.status }
          : msg
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
        // Delta-style reasoning accumulation: mirror the text merge above so
        // assistant_reasoning_delta streams build one continuous reasoning part
        // rather than a fragment per delta (which used to spam dozens of parts).
        if (part.type === 'reasoning' && !part.itemId && parts.length > 0) {
          const last = parts[parts.length - 1]
          if (
            last.type === 'reasoning' &&
            !last.itemId &&
            last.isStreaming !== false
          ) {
            parts[parts.length - 1] = {
              ...last,
              text: last.text + part.text,
              isStreaming: part.isStreaming ?? true,
              startedAt: last.startedAt ?? part.startedAt,
              completedAt: part.completedAt
            }
            return { ...msg, parts }
          }
        }
        parts.push(part)
        // Sync content (for plain-text fallback rendering).
        const contentUpdate = part.type === 'text' ? msg.content + part.text : msg.content
        return { ...msg, parts, content: contentUpdate }
      })
    })),

  settleStreamingReasoning: (id) =>
    set((state) => ({
      messages: state.messages.map((msg) => {
        if (msg.id !== id || !msg.parts) return msg
        let settled = false
        const parts = msg.parts.map((p) => {
          if (p.type === 'reasoning' && p.isStreaming === true && !settled) {
            settled = true
            return { ...p, isStreaming: false, completedAt: p.completedAt ?? Date.now() }
          }
          return p
        })
        return settled ? { ...msg, parts } : msg
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

  enqueueMessage: (text) =>
    set((state) => ({ queuedMessages: [...state.queuedMessages, text] })),
  dequeueMessage: () => {
    let result: string | undefined
    set((state) => {
      if (state.queuedMessages.length === 0) {
        result = undefined
        return {}
      }
      const [first, ...rest] = state.queuedMessages
      result = first
      return { queuedMessages: rest }
    })
    return result
  },

  setWorkspacePath: (path) => set({ workspacePath: path }),
  setSelectedBranch: (branch) => set({ selectedBranch: branch }),
  setSelectedModel: (model) => set({ selectedModel: model }),
  bumpModelVersion: () => set((state) => ({ modelVersion: state.modelVersion + 1 })),
  setPendingNewBranch: (branch) => set({ pendingNewBranch: branch }),
  setReasoningMode: (mode) => set({ reasoningMode: mode }),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  setSettingsNavWidth: (width) => set({ settingsNavWidth: width }),

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
  addSessionUsage: (usage) => set((state) => ({
    sessionUsage: {
      promptTokens: state.sessionUsage.promptTokens + usage.promptTokens,
      completionTokens: state.sessionUsage.completionTokens + usage.completionTokens,
      totalTokens: state.sessionUsage.totalTokens + usage.totalTokens,
      runs: state.sessionUsage.runs + 1
    }
  })),

  setPanelOpen: (open) => set({ panelOpen: open }),
  setThreadGoal: (goal) => set({ threadGoal: goal }),
  setThreadTodos: (todos) => set({ threadTodos: todos }),
  setGraphRunInspection: (inspection) => set({ graphRunInspection: inspection }),

  clearMessages: () =>
    set({
      messages: [],
      messages_v2: [],
      threadId: null,
      pendingNewBranch: null,
      branches: {},
      graphRunInspection: null,
      roiSnapshot: null,
      sessionUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, runs: 0 }
    }),

  // ── turn-based (messages_v2) 新 API 实现 ──────────────────────────
  addChatMessage: (msg) =>
    set((state) => ({
      messages_v2: [...state.messages_v2, msg],
      // 同步写旧 messages 数组（保持双写，便于渐进迁移）
      messages: [...state.messages, adaptChatToLegacy(msg)]
    })),

  applyTurnUpdate: (id, partial) =>
    set((state) => ({
      messages_v2: state.messages_v2.map((msg) => {
        if (msg.id !== id) return msg
        const merged = { ...msg, ...partial }
        return merged
      }),
      // 同步 text 到旧 messages.content（向后兼容渲染）
      messages: state.messages.map((msg) => {
        if (msg.id !== id) return msg
        const newText = partial.text ?? msg.content
        const newStreaming = partial.isStreaming ?? msg.isStreaming
        return { ...msg, content: newText, isStreaming: newStreaming }
      })
    })),

  setChatMessages: (msgs) =>
    set({
      messages: msgs,
      messages_v2: msgs.map(adaptLegacyToChat)
    })
}))

// ── 适配函数（旧 Message <-> 新 ChatMessage 互转） ──────────────────

/** 旧 Message → 新 ChatMessage（最简映射，不含 parts 聚合）。 */
function adaptLegacyToChat(m: Message): ChatMessage {
  return {
    id: m.id,
    role: m.role,
    createdAt: m.timestamp,
    content: m.content,
    text: m.role === 'assistant' ? m.content : undefined,
    isStreaming: m.isStreaming,
    status: m.isStreaming ? 'streaming' : 'done'
  }
}

/** 新 ChatMessage → 旧 Message（最简映射）。 */
function adaptChatToLegacy(m: ChatMessage): Message {
  return {
    id: m.id,
    role: m.role,
    content: m.content ?? m.text ?? '',
    timestamp: m.createdAt,
    isStreaming: m.isStreaming
  }
}
