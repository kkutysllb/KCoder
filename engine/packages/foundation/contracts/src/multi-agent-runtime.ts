import { z } from 'zod'
import { BudgetStateSchema } from './runtime-kernel.js'
import { PeerArtifactSchema } from './agent-identity.js'
import { AgentRunIdentitySchema, KernelRunIdentitySchema } from './engine-identity.js'
import { RunOutcomeSchema } from './runtime-kernel.js'
import { ModelPolicyRefSchema, VersionedPolicyRefSchema } from './graph-definition.js'
import { BranchRoiSnapshotSchema } from './engine-stream.js'
import { TurnExecutionPolicyRefSchema } from './turn-execution-policy.js'

const NonEmptyString = z.string().trim().min(1)

export const AgentNodeSchema = z.object({
  id: NonEmptyString,
  kind: z.literal('agent'),
  agentId: NonEmptyString,
  label: z.string().optional(),
  model: z.string().optional(),
  modelPolicyRef: ModelPolicyRefSchema.optional(),
  executionPolicyRef: TurnExecutionPolicyRefSchema.optional(),
  nodePolicyRef: VersionedPolicyRefSchema.optional(),
  capabilities: z.array(NonEmptyString).default([])
}).strict()
export type AgentNode = z.infer<typeof AgentNodeSchema>

export const HandoffNodeSchema = z.object({
  id: NonEmptyString,
  kind: z.literal('handoff'),
  targetAgentId: NonEmptyString,
  nodePolicyRef: VersionedPolicyRefSchema.optional()
}).strict()

export const ToolNodeSchema = z.object({
  id: NonEmptyString,
  kind: z.literal('tool'),
  toolName: NonEmptyString,
  nodePolicyRef: VersionedPolicyRefSchema.optional()
}).strict()

export const JudgeNodeSchema = z.object({
  id: NonEmptyString,
  kind: z.literal('judge'),
  policy: NonEmptyString,
  modelPolicyRef: ModelPolicyRefSchema.optional(),
  executionPolicyRef: TurnExecutionPolicyRefSchema.optional(),
  nodePolicyRef: VersionedPolicyRefSchema.optional()
}).strict()

export const ParallelBranchSchema = z.object({
  branchId: NonEmptyString,
  startNodeId: NonEmptyString
}).strict()
export type ParallelBranch = z.infer<typeof ParallelBranchSchema>

export const ParallelNodeSchema = z.object({
  id: NonEmptyString,
  kind: z.literal('parallel'),
  branches: z.array(ParallelBranchSchema).min(2),
  joinNodeId: NonEmptyString,
  failurePolicy: z.enum(['wait_all', 'fail_fast']).default('wait_all'),
  nodePolicyRef: VersionedPolicyRefSchema.optional()
}).strict()
export type ParallelNode = z.infer<typeof ParallelNodeSchema>

export const JoinNodeSchema = z.object({
  id: NonEmptyString,
  kind: z.literal('join'),
  requiredBranchIds: z.array(NonEmptyString).default([]),
  sourceParallelNodeId: NonEmptyString.optional(),
  outputPolicy: z.enum(['all', 'successful', 'selected']).default('all'),
  selectedBranchIds: z.array(NonEmptyString).optional(),
  nodePolicyRef: VersionedPolicyRefSchema.optional()
}).strict()
export type JoinNode = z.infer<typeof JoinNodeSchema>

export const WaitNodeSchema = z.object({
  id: NonEmptyString,
  kind: z.literal('wait'),
  waitFor: z.enum(['mailbox', 'user_input', 'approval', 'external_event']),
  nodePolicyRef: VersionedPolicyRefSchema.optional()
}).strict()

export const RetryNodeSchema = z.object({
  id: NonEmptyString,
  kind: z.literal('retry'),
  maxAttempts: z.number().int().nonnegative().default(1),
  nodePolicyRef: VersionedPolicyRefSchema.optional()
}).strict()

export const TerminateNodeSchema = z.object({
  id: NonEmptyString,
  kind: z.literal('terminate'),
  nodePolicyRef: VersionedPolicyRefSchema.optional()
}).strict()

export const AgentGraphNodeSchema = z.discriminatedUnion('kind', [
  AgentNodeSchema,
  HandoffNodeSchema,
  ToolNodeSchema,
  JudgeNodeSchema,
  ParallelNodeSchema,
  JoinNodeSchema,
  WaitNodeSchema,
  RetryNodeSchema,
  TerminateNodeSchema
])
export type AgentGraphNode = z.infer<typeof AgentGraphNodeSchema>

export const AgentGraphEdgeSchema = z.object({
  from: NonEmptyString,
  to: NonEmptyString,
  condition: NonEmptyString,
  edgePolicyRef: VersionedPolicyRefSchema.optional()
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
  branchId: NonEmptyString.optional(),
  agentId: NonEmptyString,
  nodeId: NonEmptyString,
  status: z.enum(['queued', 'running', 'completed', 'degraded', 'failed', 'aborted', 'suspended']),
  startedAt: NonEmptyString,
  updatedAt: NonEmptyString,
  completedAt: NonEmptyString.optional(),
  summary: z.string().optional(),
  error: z.string().optional(),
  peerArtifact: PeerArtifactSchema.optional(),
  executionRef: KernelRunIdentitySchema.optional(),
  outcome: RunOutcomeSchema.optional()
}).strict()
export type AgentRun = z.infer<typeof AgentRunSchema>

export const KernelDispatchPayloadV1Schema = z.object({
  schemaVersion: z.literal(1),
  identity: AgentRunIdentitySchema,
  reservationId: NonEmptyString,
  requestedBudget: BudgetStateSchema,
  role: z.enum(['agent', 'judge']),
  inputRef: NonEmptyString,
  sharedEvidenceRefs: z.array(NonEmptyString).default([]),
  modelPolicyRef: ModelPolicyRefSchema.optional()
}).strict()
export type KernelDispatchPayloadV1 = z.infer<typeof KernelDispatchPayloadV1Schema>

export const KernelDispatchPayloadV2Schema = z.object({
  schemaVersion: z.literal(2),
  identity: AgentRunIdentitySchema,
  reservationId: NonEmptyString,
  requestedBudget: BudgetStateSchema,
  role: z.enum(['agent', 'judge']),
  inputRef: NonEmptyString,
  sharedEvidenceRefs: z.array(NonEmptyString).default([]),
  modelPolicyRef: ModelPolicyRefSchema.optional(),
  executionPolicyRef: TurnExecutionPolicyRefSchema.optional()
}).strict()
export type KernelDispatchPayloadV2 = z.infer<typeof KernelDispatchPayloadV2Schema>

export const KernelDispatchPayloadV3Schema = z.object({
  schemaVersion: z.literal(3),
  identity: AgentRunIdentitySchema,
  reservationId: NonEmptyString,
  requestedBudget: BudgetStateSchema,
  role: z.enum(['agent', 'judge']),
  inputRef: NonEmptyString,
  sharedEvidenceRefs: z.array(NonEmptyString).default([]),
  threadId: NonEmptyString,
  turnId: NonEmptyString,
  workspaceKey: NonEmptyString,
  nodePolicyRef: VersionedPolicyRefSchema.optional(),
  modelPolicyRef: ModelPolicyRefSchema.optional(),
  executionPolicyRef: TurnExecutionPolicyRefSchema.optional()
}).strict()
export type KernelDispatchPayloadV3 = z.infer<typeof KernelDispatchPayloadV3Schema>

export const KernelDispatchPayloadSchema = z.discriminatedUnion('schemaVersion', [
  KernelDispatchPayloadV1Schema,
  KernelDispatchPayloadV2Schema,
  KernelDispatchPayloadV3Schema
])
export type KernelDispatchPayload = z.infer<typeof KernelDispatchPayloadSchema>

export const KernelCompletionPayloadSchema = z.object({
  executionRef: KernelRunIdentitySchema,
  outcome: RunOutcomeSchema,
  usageRefs: z.array(NonEmptyString),
  artifactRefs: z.array(NonEmptyString)
}).strict()
export type KernelCompletionPayload = z.infer<typeof KernelCompletionPayloadSchema>

export const KernelCancellationPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  executionRef: KernelRunIdentitySchema,
  branchId: NonEmptyString.optional(),
  reason: z.enum(['fail_fast', 'root_cancel'])
}).strict()
export type KernelCancellationPayload = z.infer<typeof KernelCancellationPayloadSchema>

export const MultiAgentEventSchema = z.object({
  eventId: NonEmptyString,
  type: z.enum([
    'run_started',
    'node_started',
    'node_completed',
    'handoff_requested',
    'handoff_delivered',
    'branch_spawned',
    'branch_started',
    'branch_completed',
    'branch_failed',
    'branch_cancelled',
    'branch_late_result',
    'join_waiting',
    'join_completed',
    'run_completed',
    'run_failed',
    'run_cancelled'
  ]),
  nodeId: NonEmptyString.optional(),
  agentId: NonEmptyString.optional(),
  branchId: NonEmptyString.optional(),
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

export const DurableBranchRunSchema = z.object({
  branchId: NonEmptyString,
  parallelNodeId: NonEmptyString,
  joinNodeId: NonEmptyString,
  status: z.enum(['queued', 'running', 'suspended', 'completed', 'failed', 'aborted']),
  activeNodeId: NonEmptyString,
  agentRunIds: z.array(NonEmptyString).default([]),
  output: z.unknown().optional(),
  error: z.string().optional(),
  usageRefs: z.array(NonEmptyString).default([]),
  artifactRefs: z.array(NonEmptyString).default([]),
  roiSnapshot: BranchRoiSnapshotSchema.optional(),
  startedAt: NonEmptyString.optional(),
  completedAt: NonEmptyString.optional(),
  updatedAt: NonEmptyString
}).strict()
export type DurableBranchRun = z.infer<typeof DurableBranchRunSchema>

export const JoinBranchResultSchema = DurableBranchRunSchema.pick({
  status: true,
  output: true,
  error: true,
  usageRefs: true,
  artifactRefs: true,
  roiSnapshot: true
}).extend({
  status: z.enum(['completed', 'failed', 'aborted'])
}).strict()

export const JoinResultSchema = z.object({
  parallelNodeId: NonEmptyString,
  joinNodeId: NonEmptyString,
  branches: z.record(NonEmptyString, JoinBranchResultSchema)
}).strict().superRefine((result, context) => {
  if (Object.keys(result.branches).length === 0) {
    context.addIssue({ code: 'custom', message: 'join result requires at least one branch', path: ['branches'] })
  }
})
export type JoinResult = z.infer<typeof JoinResultSchema>

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
  branches: z.record(NonEmptyString, DurableBranchRunSchema).default({}),
  agentRuns: z.array(AgentRunSchema).default([]),
  events: z.array(MultiAgentEventSchema).default([]),
  outbox: z.array(MultiAgentOutboxIntentSchema).default([]),
  retryCounters: z.record(NonEmptyString, z.number().int().nonnegative()).default({}),
  budgets: BudgetStateSchema,
  createdAt: NonEmptyString,
  updatedAt: NonEmptyString
}).strict()
export type MultiAgentRun = z.infer<typeof MultiAgentRunSchema>
