import { z } from 'zod'
import { BudgetStateSchema } from './runtime-kernel.js'
import { PeerArtifactSchema } from './agent-identity.js'

const NonEmptyString = z.string().trim().min(1)

export const AgentNodeSchema = z.object({
  id: NonEmptyString,
  kind: z.literal('agent'),
  agentId: NonEmptyString,
  label: z.string().optional(),
  model: z.string().optional(),
  capabilities: z.array(NonEmptyString).default([])
}).strict()
export type AgentNode = z.infer<typeof AgentNodeSchema>

export const HandoffNodeSchema = z.object({
  id: NonEmptyString,
  kind: z.literal('handoff'),
  targetAgentId: NonEmptyString
}).strict()

export const ToolNodeSchema = z.object({
  id: NonEmptyString,
  kind: z.literal('tool'),
  toolName: NonEmptyString
}).strict()

export const JudgeNodeSchema = z.object({
  id: NonEmptyString,
  kind: z.literal('judge'),
  policy: NonEmptyString
}).strict()

export const JoinNodeSchema = z.object({
  id: NonEmptyString,
  kind: z.literal('join'),
  requiredBranchIds: z.array(NonEmptyString).default([])
}).strict()

export const WaitNodeSchema = z.object({
  id: NonEmptyString,
  kind: z.literal('wait'),
  waitFor: z.enum(['mailbox', 'user_input', 'approval', 'external_event'])
}).strict()

export const RetryNodeSchema = z.object({
  id: NonEmptyString,
  kind: z.literal('retry'),
  maxAttempts: z.number().int().nonnegative().default(1)
}).strict()

export const TerminateNodeSchema = z.object({
  id: NonEmptyString,
  kind: z.literal('terminate')
}).strict()

export const AgentGraphNodeSchema = z.discriminatedUnion('kind', [
  AgentNodeSchema,
  HandoffNodeSchema,
  ToolNodeSchema,
  JudgeNodeSchema,
  JoinNodeSchema,
  WaitNodeSchema,
  RetryNodeSchema,
  TerminateNodeSchema
])
export type AgentGraphNode = z.infer<typeof AgentGraphNodeSchema>

export const AgentGraphEdgeSchema = z.object({
  from: NonEmptyString,
  to: NonEmptyString,
  condition: NonEmptyString
}).strict()
export type AgentGraphEdge = z.infer<typeof AgentGraphEdgeSchema>

export const AgentGraphSchema = z.object({
  version: z.literal(1),
  graphId: NonEmptyString,
  startNodeId: NonEmptyString,
  nodes: z.array(AgentGraphNodeSchema).min(1),
  edges: z.array(AgentGraphEdgeSchema).default([])
}).strict()
export type AgentGraph = z.infer<typeof AgentGraphSchema>

export const TaskEnvelopeSchema = z.object({
  envelopeId: NonEmptyString,
  kind: z.enum(['handoff', 'delegation']),
  sourceAgentId: NonEmptyString,
  targetAgentId: NonEmptyString,
  threadId: NonEmptyString,
  turnId: NonEmptyString,
  parentRunId: NonEmptyString,
  payload: z.object({ prompt: NonEmptyString }).passthrough(),
  createdAt: NonEmptyString
}).strict()
export type TaskEnvelope = z.infer<typeof TaskEnvelopeSchema>

export const AgentRunSchema = z.object({
  agentRunId: NonEmptyString,
  agentId: NonEmptyString,
  nodeId: NonEmptyString,
  status: z.enum(['queued', 'running', 'completed', 'failed', 'aborted', 'suspended']),
  startedAt: NonEmptyString,
  updatedAt: NonEmptyString,
  completedAt: NonEmptyString.optional(),
  summary: z.string().optional(),
  error: z.string().optional(),
  peerArtifact: PeerArtifactSchema.optional()
}).strict()
export type AgentRun = z.infer<typeof AgentRunSchema>

export const MultiAgentEventSchema = z.object({
  eventId: NonEmptyString,
  type: z.enum([
    'run_started',
    'node_started',
    'node_completed',
    'handoff_requested',
    'handoff_delivered',
    'run_completed',
    'run_failed'
  ]),
  nodeId: NonEmptyString.optional(),
  agentId: NonEmptyString.optional(),
  envelopeId: NonEmptyString.optional(),
  payload: z.unknown().optional(),
  timestamp: NonEmptyString
}).strict()
export type MultiAgentEvent = z.infer<typeof MultiAgentEventSchema>

export const MailboxClaimLeaseSchema = z.object({
  holderId: NonEmptyString,
  expiresAt: NonEmptyString,
  epoch: z.number().int().positive(),
  token: NonEmptyString
}).strict()
export type MailboxClaimLease = z.infer<typeof MailboxClaimLeaseSchema>

export const MailboxMessageSchema = z.object({
  messageId: NonEmptyString,
  envelopeId: NonEmptyString,
  runId: NonEmptyString,
  fromAgentId: NonEmptyString,
  toAgentId: NonEmptyString,
  status: z.enum(['queued', 'delivered', 'completed', 'failed', 'aborted']),
  claimLease: MailboxClaimLeaseSchema.optional(),
  payload: z.object({ prompt: NonEmptyString }).passthrough(),
  createdAt: NonEmptyString,
  updatedAt: NonEmptyString
}).strict()
export type MailboxMessage = z.infer<typeof MailboxMessageSchema>

export const EventedV2WorkerRoleSchema = z.enum(['remote_agent'])
export type EventedV2WorkerRole = z.infer<typeof EventedV2WorkerRoleSchema>

export const EventedV2WorkerStatusSchema = z.enum(['online', 'expired'])
export type EventedV2WorkerStatus = z.infer<typeof EventedV2WorkerStatusSchema>

export const EventedV2WorkerRecordSchema = z.object({
  workerId: NonEmptyString,
  role: EventedV2WorkerRoleSchema,
  status: EventedV2WorkerStatusSchema,
  agentIds: z.array(NonEmptyString).default([]),
  startedAt: NonEmptyString,
  heartbeatAt: NonEmptyString,
  expiresAt: NonEmptyString,
  updatedAt: NonEmptyString
}).strict()
export type EventedV2WorkerRecord = z.infer<typeof EventedV2WorkerRecordSchema>

export const MailboxEnqueueOutboxIntentSchema = z.object({
  outboxId: NonEmptyString,
  kind: z.literal('mailbox_enqueue'),
  status: z.enum(['pending', 'published']),
  message: MailboxMessageSchema,
  createdAt: NonEmptyString,
  updatedAt: NonEmptyString,
  publishedAt: NonEmptyString.optional()
}).strict()

export const MailboxCompleteOutboxIntentSchema = z.object({
  outboxId: NonEmptyString,
  kind: z.literal('mailbox_complete'),
  status: z.enum(['pending', 'published']),
  messageId: NonEmptyString,
  mailboxStatus: z.enum(['completed', 'failed', 'aborted']),
  claimLease: MailboxClaimLeaseSchema.optional(),
  createdAt: NonEmptyString,
  updatedAt: NonEmptyString,
  publishedAt: NonEmptyString.optional()
}).strict()

export const MultiAgentOutboxIntentSchema = z.discriminatedUnion('kind', [
  MailboxEnqueueOutboxIntentSchema,
  MailboxCompleteOutboxIntentSchema
])
export type MultiAgentOutboxIntent = z.infer<typeof MultiAgentOutboxIntentSchema>

export const MultiAgentRunSchema = z.object({
  version: z.literal(1),
  runId: NonEmptyString,
  threadId: NonEmptyString,
  turnId: NonEmptyString,
  workspaceKey: NonEmptyString,
  status: z.enum(['created', 'running', 'suspended', 'completed', 'failed', 'aborted']),
  graphId: NonEmptyString,
  activeNodeId: NonEmptyString,
  activeAgentStack: z.array(NonEmptyString).default([]),
  branchStatus: z.record(
    NonEmptyString,
    z.enum(['queued', 'running', 'completed', 'failed', 'aborted'])
  ).default({}),
  agentRuns: z.array(AgentRunSchema).default([]),
  events: z.array(MultiAgentEventSchema).default([]),
  outbox: z.array(MultiAgentOutboxIntentSchema).default([]),
  retryCounters: z.record(NonEmptyString, z.number().int().nonnegative()).default({}),
  budgets: BudgetStateSchema,
  createdAt: NonEmptyString,
  updatedAt: NonEmptyString
}).strict()
export type MultiAgentRun = z.infer<typeof MultiAgentRunSchema>
