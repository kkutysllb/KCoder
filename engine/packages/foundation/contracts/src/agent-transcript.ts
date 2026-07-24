import { z } from 'zod'

const NonEmptyString = z.string().trim().min(1)

export const AgentTranscriptMessageSchema = z.object({
  key: NonEmptyString,
  sourceRef: NonEmptyString,
  role: z.enum(['assistant', 'user', 'tool']),
  content: z.string(),
  createdAt: z.string(),
  artifactRefs: z.array(NonEmptyString).default([])
}).strict()
export type AgentTranscriptMessage = z.infer<typeof AgentTranscriptMessageSchema>

export const AgentTranscriptReasoningSchema = z.object({
  key: NonEmptyString,
  text: z.string(),
  userVisible: z.boolean(),
  createdAt: z.string()
}).strict()
export type AgentTranscriptReasoning = z.infer<typeof AgentTranscriptReasoningSchema>

export const AgentTranscriptToolRunSchema = z.object({
  key: NonEmptyString,
  toolName: NonEmptyString,
  status: z.enum(['queued', 'running', 'completed', 'failed', 'aborted']),
  publicInput: z.unknown().optional(),
  publicResult: z.unknown().optional(),
  secretKeys: z.array(NonEmptyString).default([]),
  artifactRefs: z.array(NonEmptyString).default([])
}).strict()
export type AgentTranscriptToolRun = z.infer<typeof AgentTranscriptToolRunSchema>

/**
 * Agent 对话记录 — 执行投影适配器通过 transcriptRef 加载，渲染 agent 的消息/推理/工具调用。
 * revision 单调递增，用于乐观并发。
 * 来源：KWorks agent-transcript.ts（AgentTranscriptSchema）。
 */
export const AgentTranscriptSchema = z.object({
  version: z.literal(1),
  transcriptRef: NonEmptyString,
  threadId: NonEmptyString,
  turnId: NonEmptyString,
  ownerPublicKey: NonEmptyString,
  messages: z.array(AgentTranscriptMessageSchema).default([]),
  reasoning: z.array(AgentTranscriptReasoningSchema).default([]),
  toolRuns: z.array(AgentTranscriptToolRunSchema).default([]),
  revision: z.number().int().nonnegative(),
  updatedAt: z.string()
}).strict()
export type AgentTranscript = z.infer<typeof AgentTranscriptSchema>
