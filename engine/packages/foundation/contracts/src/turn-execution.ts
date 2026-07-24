import { z } from 'zod'

const NonEmptyString = z.string().trim().min(1)

export const ExecutionStatusSchema = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
  'aborted'
])
export type ExecutionStatus = z.infer<typeof ExecutionStatusSchema>

export const UserFacingUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative().optional(),
  costCny: z.number().nonnegative().optional()
}).strict()
export type UserFacingUsage = z.infer<typeof UserFacingUsageSchema>

export const AgentMessageViewSchema = z.object({
  key: NonEmptyString,
  sourceRef: NonEmptyString,
  role: z.enum(['assistant', 'user', 'tool']),
  content: z.string(),
  createdAt: z.string(),
  artifactKeys: z.array(NonEmptyString).default([])
}).strict()
export type AgentMessageView = z.infer<typeof AgentMessageViewSchema>

export const UserVisibleReasoningViewSchema = z.object({
  key: NonEmptyString,
  text: z.string(),
  createdAt: z.string()
}).strict()
export type UserVisibleReasoningView = z.infer<typeof UserVisibleReasoningViewSchema>

export const ToolRunViewSchema = z.object({
  key: NonEmptyString,
  toolName: NonEmptyString,
  status: ExecutionStatusSchema,
  input: z.unknown().optional(),
  result: z.unknown().optional(),
  artifactKeys: z.array(NonEmptyString).default([])
}).strict()
export type ToolRunView = z.infer<typeof ToolRunViewSchema>

export const UserFacingErrorViewSchema = z.object({
  code: NonEmptyString,
  message: z.string()
}).strict()
export type UserFacingErrorView = z.infer<typeof UserFacingErrorViewSchema>

export const RetryViewSchema = z.object({
  attempt: z.number().int().positive(),
  status: ExecutionStatusSchema,
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  error: UserFacingErrorViewSchema.optional()
}).strict()
export type RetryView = z.infer<typeof RetryViewSchema>

export const AgentExecutionViewSchema = z.object({
  key: NonEmptyString,
  parentKey: NonEmptyString.optional(),
  sequence: z.number().int().positive(),
  role: z.enum(['root', 'child', 'manager', 'specialist']),
  phase: z.enum(['planning', 'execution', 'synthesis']).optional(),
  name: NonEmptyString,
  task: z.string().optional(),
  status: ExecutionStatusSchema,
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  usage: UserFacingUsageSchema.optional(),
  messages: z.array(AgentMessageViewSchema),
  reasoning: z.array(UserVisibleReasoningViewSchema),
  toolRuns: z.array(ToolRunViewSchema),
  summary: z.string().optional(),
  error: UserFacingErrorViewSchema.optional(),
  retries: z.array(RetryViewSchema)
}).strict()
export type AgentExecutionView = z.infer<typeof AgentExecutionViewSchema>

export const RuntimeDecisionViewSchema = z.object({
  preferredMode: z.enum(['kernel_v3', 'evented_v2']),
  effectiveMode: z.enum(['classic', 'kernel_v3', 'evented_v2']),
  preference: z.enum(['standard', 'team']),
  source: z.enum(['turn', 'default', 'legacy', 'server_override']),
  reasonCode: NonEmptyString,
  reason: NonEmptyString,
  fallbackReasonCode: NonEmptyString.optional(),
  fallbackReason: NonEmptyString.optional(),
  rolloutStage: z.enum(['off', 'shadow', 'canary', 'default']),
  decidedAt: NonEmptyString
}).strict()
export type RuntimeDecisionView = z.infer<typeof RuntimeDecisionViewSchema>

export const DelegationEdgeViewSchema = z.object({
  from: NonEmptyString,
  to: NonEmptyString
}).strict()
export type DelegationEdgeView = z.infer<typeof DelegationEdgeViewSchema>

export const DelegationTreeViewSchema = z.object({
  roots: z.array(NonEmptyString),
  edges: z.array(DelegationEdgeViewSchema)
}).strict()
export type DelegationTreeView = z.infer<typeof DelegationTreeViewSchema>

export const AgentGraphNodeViewSchema = z.object({
  key: NonEmptyString,
  agentKey: NonEmptyString,
  role: z.enum(['manager', 'specialist']),
  phase: z.enum(['planning', 'execution', 'synthesis']).optional(),
  name: NonEmptyString,
  status: ExecutionStatusSchema,
  required: z.boolean(),
  childAgentKeys: z.array(NonEmptyString),
  parallelGroup: NonEmptyString.optional()
}).strict()
export type AgentGraphNodeView = z.infer<typeof AgentGraphNodeViewSchema>

export const AgentGraphEdgeViewSchema = z.object({
  from: NonEmptyString,
  to: NonEmptyString,
  condition: z.string().optional()
}).strict()
export type AgentGraphEdgeView = z.infer<typeof AgentGraphEdgeViewSchema>

export const AgentGraphHandoffViewSchema = z.object({
  from: NonEmptyString,
  to: NonEmptyString,
  status: ExecutionStatusSchema
}).strict()
export type AgentGraphHandoffView = z.infer<typeof AgentGraphHandoffViewSchema>

export const AgentGraphExecutionViewSchema = z.object({
  key: NonEmptyString,
  templateId: NonEmptyString,
  nodes: z.array(AgentGraphNodeViewSchema),
  edges: z.array(AgentGraphEdgeViewSchema),
  handoffs: z.array(AgentGraphHandoffViewSchema),
  activeAgentKeys: z.array(NonEmptyString),
  warnings: z.array(z.string())
}).strict()
export type AgentGraphExecutionView = z.infer<typeof AgentGraphExecutionViewSchema>

const AvailableTurnExecutionViewBaseSchema = z.object({
  version: z.literal(1),
  available: z.literal(true),
  revision: z.string().startsWith('sha256:'),
  status: ExecutionStatusSchema,
  decision: RuntimeDecisionViewSchema,
  agents: z.array(AgentExecutionViewSchema)
}).strict()

export const KernelV3TurnExecutionViewSchema = AvailableTurnExecutionViewBaseSchema.extend({
  mode: z.literal('kernel_v3'),
  delegation: DelegationTreeViewSchema
}).strict()
export type KernelV3TurnExecutionView = z.infer<typeof KernelV3TurnExecutionViewSchema>

export const EventedV2TurnExecutionViewSchema = AvailableTurnExecutionViewBaseSchema.extend({
  mode: z.literal('evented_v2'),
  graph: AgentGraphExecutionViewSchema
}).strict()
export type EventedV2TurnExecutionView = z.infer<typeof EventedV2TurnExecutionViewSchema>

export const ClassicTurnExecutionViewSchema = AvailableTurnExecutionViewBaseSchema.extend({
  mode: z.literal('classic'),
  compatibility: z.object({ reason: NonEmptyString }).strict()
}).strict()
export type ClassicTurnExecutionView = z.infer<typeof ClassicTurnExecutionViewSchema>

export const UnavailableTurnExecutionViewSchema = z.object({
  version: z.literal(1),
  available: z.literal(false),
  revision: z.literal('legacy:0'),
  reason: z.enum(['legacy_turn', 'not_recorded', 'legacy_mode'])
}).strict()
export type UnavailableTurnExecutionView = z.infer<typeof UnavailableTurnExecutionViewSchema>

export const TurnExecutionViewSchema = z.union([
  KernelV3TurnExecutionViewSchema,
  EventedV2TurnExecutionViewSchema,
  ClassicTurnExecutionViewSchema,
  UnavailableTurnExecutionViewSchema
])
export type TurnExecutionView = z.infer<typeof TurnExecutionViewSchema>
