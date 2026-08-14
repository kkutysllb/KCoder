// ── turnReducer：SSE 事件 → assistant turn 状态 ──────────────────────
//
// 纯函数 reducer，UI 流式的核心。每收到一帧 KCoder gateway SSE 事件调用
// reduceSseEvent，产出新的 turn 局部状态（不直接修改 store；调用方负责回写）。
//
// 参考 KStock lib/turnReducer.ts 的设计，但事件协议适配 KCoder gateway
// （sse.py 翻译后的事件：assistant_text_delta / tool_call_started /
// approval_requested / usage / item_* 等，不是 LangGraph 原生事件）。
//
// 关键差异（vs KStock）：
//   - KStock 用 reduceFrame(state, sseFrame) 接收 LangGraph 原生 messages 事件
//   - KCoder 用 reduceSseEvent(state, kind, data) 接收 gateway 翻译后的命名事件
//   - 两者的输出状态结构相似（text/reasoning/toolCalls 平铺），但输入处理不同

import type {
  ChatMessage,
  FileChangesPayload,
  ReasoningBlock,
  ToolCall,
  TurnSegment,
  TurnStatus
} from './chatMessage'

/** 把文本增量追加到 segments：末尾若是 text 片段则合并，否则新建 text 片段。 */
function appendTextSegment(segments: TurnSegment[] | undefined, delta: string): TurnSegment[] {
  if (!delta) return segments ?? []
  const segs = segments ?? []
  const last = segs[segs.length - 1]
  if (last && last.type === 'text') {
    return [...segs.slice(0, -1), { type: 'text', text: last.text + delta }]
  }
  return [...segs, { type: 'text', text: delta }]
}

/** 推入一个 tool 片段（同一 callId 幂等，防重复）。 */
function pushToolSegment(segments: TurnSegment[] | undefined, callId: string): TurnSegment[] {
  const segs = segments ?? []
  if (segs.some((s) => s.type === 'tool' && s.callId === callId)) return segs
  return [...segs, { type: 'tool', callId }]
}

/** KCoder gateway SSE 事件类型（与 sse.py translate_event 对齐）。 */
export type SseEventKind =
  | 'turn_started'
  | 'assistant_text_delta'
  | 'assistant_reasoning_delta'
  | 'tool_call_started'
  | 'tool_call_finished'
  | 'item_created'
  | 'item_updated'
  | 'item_completed'
  | 'usage'
  | 'approval_requested'
  | 'user_input_requested'
  | 'compaction_started'
  | 'compaction_completed'
  | 'turn_completed'
  | 'turn_failed'
  | 'error'
  // 兼容旧事件名（gateway 可能同时发两套）
  | 'text_delta'
  | 'reasoning_delta'

/** SSE 事件 data 字段（任意结构，reducer 内部按 kind 窄化）。 */
export type SseEventData = Record<string, unknown> | undefined

/**
 * 把一帧 SSE 事件应用到 turn 状态，返回新状态（不可变）。
 *
 * @param state 当前 turn 状态（Partial<ChatMessage>）
 * @param kind SSE 事件类型
 * @param data SSE 事件 data 字段
 * @param now 当前时间戳（reasoning 计时用，传 Date.now()）
 * @returns 新的 turn 状态（不可变；如果事件不改变状态则返回原 state）
 */
export function reduceSseEvent(
  state: Partial<ChatMessage>,
  kind: SseEventKind,
  data: SseEventData,
  now: number
): Partial<ChatMessage> {
  switch (kind) {
    // ── 文本增量 ─────────────────────────────────────────────────
    case 'assistant_text_delta':
    case 'text_delta': {
      // 收到正文增量意味着推理阶段结束：把仍在流式的 reasoning 收尾
      const reasoning = settleReasoning(state.reasoning, now)
      const delta = (data?.delta as string) ?? ''
      if (!delta && reasoning === state.reasoning) return state
      return {
        ...state,
        text: (state.text ?? '') + delta,
        segments: appendTextSegment(state.segments, delta),
        reasoning
      }
    }

    // ── 推理增量 ─────────────────────────────────────────────────
    case 'assistant_reasoning_delta':
    case 'reasoning_delta': {
      const delta = (data?.delta as string) ?? (data?.text as string) ?? ''
      if (!delta) return state
      const reasoning = appendReasoningDelta(state.reasoning, delta, now)
      return { ...state, reasoning }
    }

    // ── 工具调用生命周期 ─────────────────────────────────────────
    case 'tool_call_started': {
      const callId = (data?.callId as string) ?? ''
      const toolName = (data?.toolName as string) ?? 'tool'
      if (!callId) return state
      // 幂等：同一 callId 的 started 事件可能重复到达（langgraph partial
      // 帧重复携带累积 tool_calls），已存在则跳过，避免重复 key 与重复行。
      if ((state.toolCalls ?? []).some((c) => c.id === callId)) return state
      const call: ToolCall = {
        id: callId,
        name: toolName,
        status: 'running',
        startedAt: now,
        args: (data?.args as Record<string, unknown> | undefined) ?? undefined
      }
      return {
        ...state,
        toolCalls: [...(state.toolCalls ?? []), call],
        segments: pushToolSegment(state.segments, callId)
      }
    }

    case 'tool_call_finished': {
      const callId = (data?.callId as string) ?? ''
      if (!callId) return state
      const isError = Boolean(data?.isError)
      const toolCalls = (state.toolCalls ?? []).map((c) =>
        c.id === callId
          ? {
              ...c,
              status: isError ? ('failed' as const) : ('completed' as const),
              endedAt: now,
              summary: (data?.summary as string) ?? undefined,
              output: (data?.output as string) ?? undefined,
              artifact: data?.artifact,
              isError: isError || undefined
            }
          : c
      )
      return { ...state, toolCalls }
    }

    // ── item 事件（携带完整 TurnItem，兼容旧协议） ──────────────
    case 'item_created':
    case 'item_updated':
    case 'item_completed': {
      const item = data?.item as Record<string, unknown> | undefined
      if (!item) return state
      return reduceItemEvent(state, item, now)
    }

    // ── token 用量 ───────────────────────────────────────────────
    case 'usage': {
      const usage = data?.usage as Record<string, unknown> | undefined
      if (!usage) return state
      return {
        ...state,
        usage: {
          promptTokens: (usage.promptTokens as number) ?? 0,
          completionTokens: (usage.completionTokens as number) ?? 0,
          totalTokens: (usage.totalTokens as number) ?? 0
        }
      }
    }

    // ── 审批 / 用户输入请求（需要用户响应） ──────────────────────
    case 'approval_requested':
    case 'user_input_requested':
      return { ...state, status: 'needs_input' as TurnStatus, isStreaming: false }

    // ── compaction ────────────────────────────────────────────────
    case 'compaction_started':
    case 'compaction_completed':
      return { ...state, status: 'compacted' as TurnStatus }

    // ── turn 结束 ────────────────────────────────────────────────
    case 'turn_completed': {
      const fileChanges = (data?.fileChanges as FileChangesPayload | undefined) ?? undefined
      return {
        ...state,
        status: 'done' as TurnStatus,
        isStreaming: false,
        reasoning: settleReasoning(state.reasoning, now),
        fileChanges,
        // 收尾 thinkingMs
        thinkingMs:
          state.reasoning?.startedAt != null
            ? now - state.reasoning.startedAt
            : state.thinkingMs
      }
    }

    case 'turn_failed':
    case 'error': {
      const message = (data?.message as string) ?? (data?.error as string) ?? '发生错误'
      return {
        ...state,
        status: 'error' as TurnStatus,
        isStreaming: false,
        error: message,
        reasoning: settleReasoning(state.reasoning, now)
      }
    }

    // ── turn_started（run 开始，无状态变化） ─────────────────────
    case 'turn_started':
    default:
      return state
  }
}

// ── 内部工具函数 ──────────────────────────────────────────────────────

/**
 * 把"正在流式的 reasoning"收尾（填 endedAt）。
 * 如果 reasoning 已经收尾或不存在，返回原对象。
 */
function settleReasoning(
  reasoning: ReasoningBlock | undefined,
  now: number
): ReasoningBlock | undefined {
  if (!reasoning) return reasoning
  if (reasoning.endedAt != null) return reasoning
  return { ...reasoning, endedAt: now }
}

/**
 * 追加 reasoning 增量。如果当前没有 reasoning 或已收尾，新建一个；
 * 如果存在且未收尾，追加 text。
 */
function appendReasoningDelta(
  current: ReasoningBlock | undefined,
  delta: string,
  now: number
): ReasoningBlock {
  if (!current || current.endedAt != null) {
    return {
      text: delta,
      startedAt: now
    }
  }
  return {
    ...current,
    text: current.text + delta
  }
}

/**
 * 处理 item_* 事件（完整 TurnItem）。
 * 兼容旧引擎协议——item 可能含 text / reasoning / tool_call 字段。
 */
function reduceItemEvent(
  state: Partial<ChatMessage>,
  item: Record<string, unknown>,
  now: number
): Partial<ChatMessage> {
  const next = { ...state }
  const itemType = item.type as string | undefined

  // text 内容
  const text = item.text as string | undefined
  if (text) {
    next.text = (next.text ?? '') + text
    next.segments = appendTextSegment(next.segments, text)
  }

  // reasoning 内容
  const reasoningText = item.reasoning as string | undefined
  if (reasoningText) {
    next.reasoning = appendReasoningDelta(next.reasoning, reasoningText, now)
  }

  // tool_call（item 完整携带工具调用）
  const toolCall = item.tool_call as Record<string, unknown> | undefined
  if (toolCall && typeof toolCall.id === 'string') {
    const call: ToolCall = {
      id: toolCall.id,
      name: (toolCall.name as string) ?? 'tool',
      status: itemType === 'item_completed' ? 'completed' : 'running',
      startedAt: now,
      args: toolCall.args as Record<string, unknown> | undefined,
      summary: toolCall.summary as string | undefined,
      output: toolCall.output as string | undefined
    }
    next.toolCalls = [...(next.toolCalls ?? []), call]
    next.segments = pushToolSegment(next.segments, call.id)
  }

  return next
}
