// ── turn-based 对话数据模型 ────────────────────────────────────────────
//
// 参考 KStock 项目 lib/sessionStore.ts 的设计，按 KCoder 的 SSE 事件协议
// （assistant_text_delta / tool_call_started / approval_requested 等）调整。
//
// 设计原则：
//   1. user 消息用 content（字符串）；assistant turn 用流式累积字段
//      （text / reasoning / toolCalls / subagents）全部平铺
//   2. 替代旧的 Message.parts[] 数组——整体对象模型更直观、TS 推断更友好
//   3. 向后兼容：保留旧 Message 类型和 parts 字段，渲染层 fallback 到 parts
//   4. status 标记生命周期：streaming / done / error / needs_input / compacted

export type ChatRole = 'user' | 'assistant' | 'system'

/**
 * 有序 turn 片段——按执行到达顺序交错记录正文与工具调用，
 * 供 Cursor/Cline 风格的「分阶段」渲染（正文 → 工具 → 正文 → 工具…）。
 * text 片段连续到达时合并到同一片段；每次 tool_call_started 推入一个 tool 片段。
 */
export type TurnSegment =
  | { type: 'text'; text: string }
  | { type: 'tool'; callId: string }

/** assistant 的思考流（reasoning）。流式中 startedAt 已填，完成后填 endedAt。 */
export interface ReasoningBlock {
  text: string
  startedAt: number
  endedAt?: number
}

/** 工具调用：模型发起（status=running）→ 引擎回填结果（status=completed/failed）。 */
export interface ToolCall {
  id: string
  name: string
  args?: Record<string, unknown>
  status: 'running' | 'completed' | 'failed'
  startedAt?: number
  endedAt?: number
  summary?: string
  /** 工具返回的输出文本（如果有）。 */
  output?: string
  /** 工具返回的结构化产物（如果有）。 */
  artifact?: unknown
  /** 是否错误（status=failed 时为 true）。 */
  isError?: boolean
}

/** 并行子代理单步进展。 */
export interface SubagentStep {
  /** 步骤序号（1-based）。 */
  index: number
  /** subagent 正文（完整内容，非增量）。 */
  text?: string
  /** subagent 自己发起的工具调用。 */
  toolCalls?: ToolCall[]
}

/** 并行子代理任务（按 taskId 分组）。 */
export interface SubagentTask {
  taskId: string
  description?: string
  model?: string
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'timed_out'
  steps: SubagentStep[]
}

/** 引擎 lead agent 的 Todo 状态。 */
export interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

/** ask_clarification 的结构化 payload（引擎 ClarificationMiddleware 生成）。 */
export interface ClarificationOption {
  id: string
  label: string
  value: string
}

export interface ClarificationFormField {
  name: string
  label?: string
  type: 'text' | 'textarea' | 'number' | 'select' | 'multi_select' | 'checkbox' | 'date'
  required?: boolean
  options?: string[]
  placeholder?: string
}

export interface HumanInputPayload {
  kind: 'human_input_request'
  source: 'ask_clarification'
  request_id?: string
  clarification_type?: string
  question: string
  input_mode: 'free_text' | 'choice_with_other' | 'form'
  context?: string | null
  options?: ClarificationOption[]
  fields?: ClarificationFormField[]
}

/** 单轮 token 用量。 */
export interface TurnUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/** 单文件变更状态（对应 gateway workspace_changes 的 WorkspaceChangeStatus）。 */
export type FileChangeStatus = 'created' | 'modified' | 'deleted' | 'symlink_created'

/** 单文件变更（对应 gateway WorkspaceFileChange.to_dict()）。 */
export interface FileChange {
  path: string
  root: string
  status: FileChangeStatus
  binary: boolean
  sensitive: boolean
  size_before: number | null
  size_after: number | null
  diff: string
  diff_truncated: boolean
  diff_unavailable_reason: 'binary' | 'large' | 'sensitive' | 'truncated' | 'symlink' | null
  additions: number
  deletions: number
  symlink: boolean
}

/** 一轮 turn 的 workspace 变更摘要（对应 gateway WorkspaceChangeSummary）。 */
export interface FileChangeSummary {
  created: number
  modified: number
  deleted: number
  symlink_created: number
  additions: number
  deletions: number
  truncated: boolean
}

/** turn_completed 事件携带的 fileChanges 载荷。 */
export interface FileChangesPayload {
  summary: FileChangeSummary
  files: FileChange[]
}

/** turn 生命周期状态。 */
export type TurnStatus =
  | 'streaming'     // 流式中
  | 'needs_input'   // 等待用户输入（审批 / 澄清）
  | 'done'          // 正常完成
  | 'error'         // 异常结束
  | 'compacted'     // 引擎压缩了上下文

/**
 * turn-based 消息模型（替代旧的 Message.parts[]）。
 *
 * - user / system 消息：只填 content
 * - assistant turn：text + reasoning + toolCalls + subagents 平铺
 */
export interface ChatMessage {
  id: string
  role: ChatRole
  createdAt: number

  // ── user / system 消息正文 ──
  content?: string

  // ── assistant turn 流式累积字段 ──
  /** AI 正文（markdown，流式增量拼接到此字段）。 */
  text?: string
  /** 思考流（reasoning_content，独立于正文）。 */
  reasoning?: ReasoningBlock
  /** 工具调用列表（按时间顺序）。 */
  toolCalls?: ToolCall[]
  /** 有序片段（正文 ↔ 工具调用交错，按到达顺序）。无则回退到平铺渲染。 */
  segments?: TurnSegment[]
  /** 并行子代理任务列表。 */
  subagents?: SubagentTask[]
  /** 引擎 values 快照的 Todo 列表。 */
  todos?: TodoItem[]
  /** 该 turn 的 token 用量（完成时填）。 */
  usage?: TurnUsage
  /** 该 turn 的 workspace 文件变更（turn_completed 时由 gateway 计算并附带）。 */
  fileChanges?: FileChangesPayload
  /** reasoning 耗时（ms），完成后由 reducer 填充。 */
  thinkingMs?: number

  // ── 生命周期 ──
  /** 引擎 pipeline_stage（前端推断兜底）。 */
  stage?: string
  status?: TurnStatus
  /** 是否正在流式（rendering 层用，等价于 status === 'streaming'）。 */
  isStreaming?: boolean
  /** 错误信息（status === 'error' 时填）。 */
  error?: string

  // ── 兼容字段（旧 parts 数组，新代码不应再写入）──
  /**
   * @deprecated 使用 text / reasoning / toolCalls 等平铺字段替代。
   * 保留是为了过渡期渲染旧消息；新消息不再写入 parts。
   */
  parts?: unknown[]
  /** @deprecated 旧字段，等价于 text。 */
  content_text?: string
}

/** 创建 user 消息。 */
export function createUserMessage(content: string, id?: string): ChatMessage {
  return {
    id: id ?? `u_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    role: 'user',
    createdAt: Date.now(),
    content
  }
}

/** 创建空的 assistant turn（streaming）。 */
export function createAssistantTurn(id?: string): ChatMessage {
  return {
    id: id ?? `a_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    role: 'assistant',
    createdAt: Date.now(),
    text: '',
    status: 'streaming',
    isStreaming: true
  }
}

/** 是否为可编辑的 user 消息（has content & not streaming）。 */
export function isEditableUserMessage(msg: ChatMessage): boolean {
  return msg.role === 'user' && typeof msg.content === 'string' && msg.content.length > 0
}

// ── 内部消息净化（防止历史线程/回放时泄漏 QiLin 注入的 reminder 块）───────
//
// QiLin 在每个 turn 之前会往 context 注入 memory reminder（格式：
//   <memory>User Context: ... History: ... Facts: ... </memory>
// 这是给 LLM 看的"工作记忆"，**不应该** 渲染给用户。
// 但 turn history API 回放时这些块可能混入 assistant_text item.text，
// 需要在前端剥掉以免用户看到原始 <memory> 标签。
//
// 匹配策略：
//   - 匹配成对的 <memory>...</memory>（贪婪，可能多行）
//   - 也匹配 <reminder>...</reminder>（未来扩展）
//   - 也匹配历史上有过的 <scratchpad>...</scratchpad> 等
//
// 行为：返回净化后的 text（剥掉内部块）；如果净化后为空，返回空串，
// 调用方可据此决定是否丢弃整条消息。

const INTERNAL_BLOCK_RE = /<(memory|reminder|scratchpad|system_reminder)>[\s\S]*?<\/\1>/gi

/**
 * 剥掉 assistant text 中所有内部消息块（<memory> 等）。
 * @returns 净化后的 text；如果净化后为空返回 ''
 */
export function sanitizeAssistantText(text: string | undefined | null): string {
  if (!text) return ''
  return text.replace(INTERNAL_BLOCK_RE, '').trim()
}

/**
 * 判断整条 text 是否完全是内部消息（净化后为空）。
 * 用于 loadThread 决定是否丢弃整条 assistant 消息。
 */
export function isInternalOnlyText(text: string | undefined | null): boolean {
  if (!text) return true
  return sanitizeAssistantText(text) === ''
}
