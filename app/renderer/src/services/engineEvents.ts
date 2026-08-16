/**
 * engineEvents.ts — 引擎原生 SSE 事件 → KCoder kind 事件的翻译层（JS 版）。
 *
 * 2026-08 产品层重构：删除自研 kcoder_gateway 翻译层后，前端直连引擎自带
 * gateway（app.gateway），把引擎原生 SSE 帧（metadata / messages-tuple /
 * custom / end，LangGraph Platform 协议）翻译成 KCoder reducer 期望的
 * kind 事件。本模块是 Python sse.py translate_event 的 TypeScript 移植，
 * 语义逐函数对齐。
 */

export type EngineEventKind =
  | 'turn_started'
  | 'turn_completed'
  | 'turn_failed'
  | 'turn_aborted'
  | 'assistant_text_delta'
  | 'assistant_reasoning_delta'
  | 'tool_call_started'
  | 'tool_call_args_updated'
  | 'tool_call_finished'
  | 'usage'
  | 'todos_updated'
  | 'subagent_started'
  | 'subagent_step'
  | 'subagent_completed'
  | 'subagent_failed'
  | 'compaction_completed'

export interface EngineEvent {
  kind: EngineEventKind
  [key: string]: unknown
}

/** 翻译上下文：跨帧跟踪状态（前缀 diff / 去重），与 Python ActiveRun 对齐。 */
export interface EventTranslationContext {
  threadId: string
  turnId: string
  aiTextSeen: Map<string, string>
  aiReasoningSeen: Map<string, string>
  toolCallIdsSeen: Set<string>
  toolCallArgsSeen: Map<string, Record<string, unknown>>
  aiMessageIds: Set<string>
  usageByModel: Map<string, { input: number; output: number; total: number }>
  aiMessageCount: number
}

export function createEventContext(threadId: string, turnId: string): EventTranslationContext {
  return {
    threadId,
    turnId,
    aiTextSeen: new Map(),
    aiReasoningSeen: new Map(),
    toolCallIdsSeen: new Set(),
    toolCallArgsSeen: new Map(),
    aiMessageIds: new Set(),
    usageByModel: new Map(),
    aiMessageCount: 0,
  }
}

// ────────────────────────────────────────────────────────────────
// 入口：翻译一帧引擎事件
// ────────────────────────────────────────────────────────────────

export function translateEvent(
  eventType: string,
  data: unknown,
  ctx: EventTranslationContext
): EngineEvent[] {
  if (eventType === 'metadata') {
    const runId = (data as Record<string, unknown> | null)?.run_id
    return [
      {
        kind: 'turn_started',
        turnId: ctx.turnId,
        runId: typeof runId === 'string' ? runId : undefined,
      },
    ]
  }

  if (eventType === 'custom') {
    return translateCustomEvent(data)
  }

  if (eventType === 'messages' || eventType.startsWith('messages/')) {
    if (eventType === 'messages/metadata') return []
    // messages-tuple 模式的 partial 是 [id, chunk]；complete 是 [id, full]。
    // 与 LangGraph Platform 的 messages/partial 同为「累积全文」语义，
    // 前缀 diff 处理一致。skip_text 仅用于 complete 避免与 partial 重复。
    const skipText = eventType === 'messages/complete'
    return translateMessagesEvent(data, ctx, skipText)
  }

  if (eventType === 'end') {
    return [{ kind: 'turn_completed', turnId: ctx.turnId, threadId: ctx.threadId }]
  }

  if (eventType === 'error' || eventType === 'error_code') {
    const msg = (data as Record<string, unknown> | null)?.message
    return [
      {
        kind: 'turn_completed' as EngineEventKind, // 终态由 end 兜底；error 帧前端有 error 事件通道
        turnId: ctx.turnId,
        error: typeof msg === 'string' ? msg : 'engine stream error',
      },
    ]
  }

  return []
}

// ────────────────────────────────────────────────────────────────
// custom 事件（task_tool 子代理状态）
// ────────────────────────────────────────────────────────────────

function translateCustomEvent(data: unknown): EngineEvent[] {
  if (typeof data !== 'object' || data === null) return []
  const d = data as Record<string, unknown>
  const evType = d.type
  const taskId = String(d.task_id ?? '')

  // 上下文压缩事件（SummarizationMiddleware，无 task_id，先处理）
  if (evType === 'context_compacted') {
    return [
      {
        kind: 'compaction_completed',
        removedCount: Number(d.removed_count ?? 0),
        preservedCount: Number(d.preserved_count ?? 0),
      },
    ]
  }

  if (!taskId) return []

  if (evType === 'task_started') {
    return [
      {
        kind: 'subagent_started',
        taskId,
        description: d.description,
        modelName: d.model_name,
      },
    ]
  }

  if (evType === 'task_running') {
    const message = d.message
    let text = ''
    const toolCalls: Array<Record<string, unknown>> = []
    if (typeof message === 'object' && message !== null) {
      const m = message as Record<string, unknown>
      text = extractText(m.content)
      const tcs = Array.isArray(m.tool_calls) ? m.tool_calls : []
      for (const tc of tcs) {
        if (typeof tc === 'object' && tc !== null) {
          const t = tc as Record<string, unknown>
          toolCalls.push({ id: String(t.id ?? ''), name: String(t.name ?? ''), args: t.args })
        }
      }
    } else if (typeof message === 'string') {
      text = message
    }
    return [
      {
        kind: 'subagent_step',
        taskId,
        index: Number(d.message_index ?? 0),
        text,
        toolCalls,
      },
    ]
  }

  if (evType === 'task_completed') {
    return [{ kind: 'subagent_completed', taskId, result: d.result }]
  }

  if (evType === 'task_failed') {
    return [{ kind: 'subagent_failed', taskId, error: d.error }]
  }

  return []
}

// ────────────────────────────────────────────────────────────────
// messages 事件（messages-tuple：[msg, meta]）
// ────────────────────────────────────────────────────────────────

function translateMessagesEvent(
  data: unknown,
  ctx: EventTranslationContext,
  skipText: boolean
): EngineEvent[] {
  let messages: Array<Record<string, unknown>> = []

  if (Array.isArray(data) && data.length >= 1) {
    const first = data[0]
    if (Array.isArray(first)) {
      messages = first as Array<Record<string, unknown>>
    } else if (typeof first === 'object' && first !== null) {
      messages = [first as Record<string, unknown>]
    }
  } else if (typeof data === 'object' && data !== null) {
    const d = data as Record<string, unknown>
    if (Array.isArray(d.messages)) {
      messages = d.messages as Array<Record<string, unknown>>
    }
  }

  const events: EngineEvent[] = []
  for (const msg of messages) {
    if (typeof msg !== 'object' || msg === null) continue
    events.push(...translateSingleMessage(msg, ctx, skipText))
  }
  return events
}

function translateSingleMessage(
  msg: Record<string, unknown>,
  ctx: EventTranslationContext,
  skipText: boolean
): EngineEvent[] {
  const events: EngineEvent[] = []
  const msgType = String(msg.type ?? msg.role ?? '')
  const typeLower = msgType.toLowerCase()
  const isAi = typeLower.includes('ai')
  const isHuman = typeLower.includes('human')
  const isTool = msgType === 'tool' || msgType === 'ToolMessage'

  if (isHuman) return events // 用户消息由前端 UI 展示，跳过

  if (isAi) {
    const msgId = String(msg.id ?? '')
    const usage = extractUsage(msg)
    if (usage) {
      const model = extractModelName(msg)
      const cacheRead = extractCacheRead(msg)
      if (accountUsage(ctx, msgId, usage, model, cacheRead)) {
        events.push({
          kind: 'usage',
          usage: {
            promptTokens: usage.input,
            completionTokens: usage.output,
            totalTokens: usage.total,
          },
          model,
        })
      }
    }
    if (msgId) ctx.aiMessageIds.add(msgId)

    if (!skipText) {
      const text = extractText(msg.content)
      const delta = computePrefixDelta(text, msgId, ctx.aiTextSeen)
      if (delta) events.push({ kind: 'assistant_text_delta', delta })

      const reasoning = extractReasoningText(msg)
      const reasoningDelta = computePrefixDelta(reasoning, msgId, ctx.aiReasoningSeen)
      if (reasoningDelta) events.push({ kind: 'assistant_reasoning_delta', delta: reasoningDelta })
    }

    const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : []
    for (const tc of toolCalls) {
      if (typeof tc !== 'object' || tc === null) continue
      const t = tc as Record<string, unknown>
      const name = String(t.name ?? '')
      const callId = String(t.id ?? '')
      if (!callId || !name) continue

      const payload = toolCallArgsPayload(name, t.args)
      if (ctx.toolCallIdsSeen.has(callId)) {
        // 流式 args 补全：后续帧补发缺字段
        const prev = ctx.toolCallArgsSeen.get(callId) ?? {}
        const newFields: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(payload ?? {})) {
          if (v && !prev[k]) newFields[k] = v
        }
        if (Object.keys(newFields).length > 0) {
          ctx.toolCallArgsSeen.set(callId, { ...prev, ...newFields })
          events.push({ kind: 'tool_call_args_updated', callId, args: newFields })
        }
        continue
      }
      ctx.toolCallIdsSeen.add(callId)
      const tcEvent: EngineEvent = { kind: 'tool_call_started', callId, toolName: name }
      if (payload) {
        ctx.toolCallArgsSeen.set(callId, payload)
        tcEvent.args = payload
      }
      // write_todos → todos_updated（InfoPanel「进度」段）
      if (name === 'write_todos') {
        const tcArgs = (t.args ?? {}) as Record<string, unknown>
        const rawTodos = Array.isArray(tcArgs.todos) ? tcArgs.todos : null
        if (rawTodos) {
          const now = new Date().toISOString()
          const items = rawTodos
            .map((td: unknown, idx: number) => {
              if (typeof td !== 'object' || td === null) return null
              const todo = td as Record<string, unknown>
              const status = String(todo.status ?? 'pending')
              const validStatus = ['pending', 'in_progress', 'completed'].includes(status)
                ? status
                : 'pending'
              return {
                id: `todo-${idx}`,
                content: String(todo.content ?? ''),
                status: validStatus,
                createdAt: now,
                updatedAt: now,
              }
            })
            .filter(Boolean)
          events.push({
            kind: 'todos_updated',
            todos: { threadId: ctx.threadId, items, updatedAt: now },
          })
        }
      }
      events.push(tcEvent)
    }

    const chunks = Array.isArray(msg.tool_call_chunks) ? msg.tool_call_chunks : []
    for (const tcc of chunks) {
      if (typeof tcc !== 'object' || tcc === null) continue
      const c = tcc as Record<string, unknown>
      const name = String(c.name ?? '')
      const callId = String(c.id ?? '')
      if (callId && name) {
        events.push({ kind: 'tool_call_started', callId, toolName: name })
      }
    }
  } else if (isTool) {
    const ev = translateToolMessage(msg)
    if (ev) events.push(ev)
  }

  return events
}

function translateToolMessage(msg: Record<string, unknown>): EngineEvent | null {
  const callId = String(msg.tool_call_id ?? '')
  if (!callId) return null
  const text = extractText(msg.content)
  const toolName = String(msg.name ?? '')
  const isError = String(msg.status ?? '') === 'error' || text.startsWith('Error:')
  const event: EngineEvent = {
    kind: 'tool_call_finished',
    callId,
    summary: text.slice(0, 500),
    isError,
  }
  if (toolName) event.toolName = toolName
  if (msg.artifact !== undefined && msg.artifact !== null) {
    if (toolName === 'ask_clarification' && typeof msg.artifact === 'object') {
      const art = msg.artifact as Record<string, unknown>
      event.artifact = (art as Record<string, unknown>).human_input ?? art
    } else {
      event.artifact = msg.artifact
    }
  }
  return event
}

// ────────────────────────────────────────────────────────────────
// 辅助
// ────────────────────────────────────────────────────────────────

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const block of content) {
      if (typeof block === 'object' && block !== null) {
        const b = block as Record<string, unknown>
        if (b.type === 'text') parts.push(String(b.text ?? ''))
      } else if (typeof block === 'string') {
        parts.push(block)
      }
    }
    return parts.join('')
  }
  return ''
}

function computePrefixDelta(
  text: string,
  msgId: string,
  seen: Map<string, string>
): string {
  if (!text) return ''
  if (!msgId) return text
  const prev = seen.get(msgId)
  let delta: string
  if (!prev) {
    delta = text
  } else if (text.startsWith(prev)) {
    delta = text.slice(prev.length)
  } else {
    delta = text // 异常回退（重置/分支重写）：全量重发
  }
  seen.set(msgId, text)
  return delta
}

function extractReasoningText(msg: Record<string, unknown>): string {
  const additional = msg.additional_kwargs
  if (typeof additional === 'object' && additional !== null) {
    const rc = (additional as Record<string, unknown>).reasoning_content
    if (typeof rc === 'string' && rc) return rc
  }
  const rc = msg.reasoning_content
  return typeof rc === 'string' ? rc : ''
}

function extractUsage(msg: Record<string, unknown>): { input: number; output: number; total: number } | null {
  const um = msg.usage_metadata
  if (typeof um === 'object' && um !== null) {
    const u = um as Record<string, unknown>
    return {
      input: Number(u.input_tokens ?? 0),
      output: Number(u.output_tokens ?? 0),
      total: Number(u.total_tokens ?? 0),
    }
  }
  const ak = msg.additional_kwargs
  if (typeof ak === 'object' && ak !== null) {
    const usage = (ak as Record<string, unknown>).usage
    if (typeof usage === 'object' && usage !== null) {
      const u = usage as Record<string, unknown>
      return {
        input: Number(u.prompt_tokens ?? u.input_tokens ?? 0),
        output: Number(u.completion_tokens ?? u.output_tokens ?? 0),
        total: Number(u.total_tokens ?? 0),
      }
    }
  }
  return null
}

function extractCacheRead(msg: Record<string, unknown>): number {
  const um = msg.usage_metadata
  if (typeof um === 'object' && um !== null) {
    const details = (um as Record<string, unknown>).input_token_details
    if (typeof details === 'object' && details !== null) {
      return Number((details as Record<string, unknown>).cache_read ?? 0)
    }
  }
  return 0
}

function extractModelName(msg: Record<string, unknown>): string {
  const rm = msg.response_metadata
  if (typeof rm === 'object' && rm !== null) {
    const model = (rm as Record<string, unknown>).model_name
    if (typeof model === 'string') return model
  }
  const ak = msg.additional_kwargs
  if (typeof ak === 'object' && ak !== null) {
    const model = (ak as Record<string, unknown>).model_name
    if (typeof model === 'string') return model
  }
  return ''
}

/** 按消息 id 去重累积 usage（同一消息多帧只计一次），返回是否首次计入。 */
function accountUsage(
  ctx: EventTranslationContext,
  msgId: string,
  usage: { input: number; output: number; total: number },
  model: string,
  _cacheRead: number
): boolean {
  if (!msgId || ctx.aiMessageIds.has(msgId)) return false
  ctx.aiMessageIds.add(msgId)
  ctx.aiMessageCount += 1
  const key = model || 'unknown'
  const cur = ctx.usageByModel.get(key) ?? { input: 0, output: 0, total: 0 }
  cur.input += usage.input
  cur.output += usage.output
  cur.total += usage.total
  ctx.usageByModel.set(key, cur)
  return true
}

/** 工具调用关键 args（前端展示/面板用；大 payload 不进事件流）。 */
function toolCallArgsPayload(
  name: string,
  args: unknown
): Record<string, unknown> | undefined {
  if (typeof args !== 'object' || args === null) return undefined
  const a = args as Record<string, unknown>
  const KEY_FIELDS: Record<string, string[]> = {
    task: ['subagent_type', 'description', 'prompt', 'output_type'],
    write_todos: [],
    present_plan: ['title'],
    present_delivery: ['title'],
  }
  const fields = KEY_FIELDS[name]
  if (!fields) return undefined
  const payload: Record<string, unknown> = {}
  for (const f of fields) {
    if (a[f] !== undefined && a[f] !== null) payload[f] = a[f]
  }
  // 大字段裁剪（避免超长 prompt 撑爆事件）
  for (const [k, v] of Object.entries(payload)) {
    if (typeof v === 'string' && v.length > 2000) {
      payload[k] = v.slice(0, 2000) + '…'
    }
  }
  return Object.keys(payload).length > 0 ? payload : undefined
}

// ────────────────────────────────────────────────────────────────
// 历史加载：引擎 /api/threads/{id}/messages 事件行 → KCoder TurnItem
//（移植自 kcoder_gateway/threads.py::_message_to_item）
// ────────────────────────────────────────────────────────────────

const INJECTED_MEMORY_MESSAGE_ID_SUFFIX = '__memory'
const INJECTED_USER_MESSAGE_ID_SUFFIX = '__user'

export interface HistoryItem {
  id: string
  kind: 'user_message' | 'assistant_text' | 'tool_result'
  role: string
  text?: string
  reasoning?: string
  usage?: Record<string, unknown>
  toolCalls?: Array<{ id: string; toolName: string; args: unknown }>
  toolName?: string
  callId?: string
  output?: string
  createdAt?: string
}

/** 单条 LangChain 消息 dict → KCoder TurnItem。 */
export function engineMessageToItem(msg: unknown): HistoryItem | null {
  if (typeof msg !== 'object' || msg === null) return null
  const m = msg as Record<string, unknown>
  const msgType = String(m.type ?? m.role ?? '')
  const typeLower = msgType.toLowerCase()
  const msgId = String(m.id ?? '')

  if (typeLower.includes('human')) {
    const additional = m.additional_kwargs as Record<string, unknown> | undefined
    const isHidden = Boolean(additional?.hide_from_ui)
    if (msgId.endsWith(INJECTED_MEMORY_MESSAGE_ID_SUFFIX) || isHidden) return null
    const realId = msgId.endsWith(INJECTED_USER_MESSAGE_ID_SUFFIX)
      ? msgId.slice(0, -INJECTED_USER_MESSAGE_ID_SUFFIX.length)
      : msgId
    return {
      id: realId,
      kind: 'user_message',
      role: 'user',
      text: extractText(m.content),
      createdAt: String(m.created_at ?? ''),
    }
  }

  if (typeLower.includes('ai')) {
    const item: HistoryItem = {
      id: msgId,
      kind: 'assistant_text',
      role: 'assistant',
      text: extractText(m.content),
      createdAt: String(m.created_at ?? ''),
    }
    const reasoning = extractReasoningText(m)
    if (reasoning) item.reasoning = reasoning
    const usage = extractUsage(m)
    if (usage) {
      item.usage = {
        promptTokens: usage.input,
        completionTokens: usage.output,
        totalTokens: usage.total,
      }
    }
    const toolCalls = Array.isArray(m.tool_calls) ? m.tool_calls : []
    if (toolCalls.length > 0) {
      item.toolCalls = toolCalls
        .filter((tc): tc is Record<string, unknown> => typeof tc === 'object' && tc !== null)
        .map((tc) => ({
          id: String(tc.id ?? ''),
          toolName: String(tc.name ?? ''),
          args: tc.args ?? {},
        }))
    }
    return item
  }

  if (msgType === 'tool') {
    return {
      id: msgId,
      kind: 'tool_result',
      role: 'tool',
      toolName: String(m.name ?? ''),
      callId: String(m.tool_call_id ?? ''),
      output: extractText(m.content),
      createdAt: String(m.created_at ?? ''),
    }
  }

  return null
}

/**
 * 引擎 /api/threads/{id}/messages 事件行列表 → KCoder TurnItem 列表。
 * 引擎消息行格式：{event_type, category, content: {LangChain 消息}, ...}
 */
export function engineHistoryToItems(rows: unknown[]): HistoryItem[] {
  const items: HistoryItem[] = []
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue
    const r = row as Record<string, unknown>
    const content = r.content
    // content 可能是 LangChain 消息 dict，也可能是文本
    const msg = typeof content === 'object' && content !== null ? content : { type: 'human', content }
    const item = engineMessageToItem(msg)
    if (item) {
      if (!item.createdAt) item.createdAt = String(r.created_at ?? '')
      items.push(item)
    }
  }
  return items
}
