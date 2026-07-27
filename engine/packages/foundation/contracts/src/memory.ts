import { z } from 'zod'
import { IsoTimestampSchema, TaskScopeSchema } from './engine-identity.js'
import { CheckpointProvenanceSchema, DurableReferenceSchema } from './task-checkpoint-v1.js'

const NonEmptyString = z.string().trim().min(1)

export const LegacyMemoryScopeSchema = z.enum(['user', 'workspace', 'project'])
export const MemoryScope = z.enum(['user', 'workspace', 'project', 'task_shared', 'agent_private'])
export type MemoryScope = z.infer<typeof MemoryScope>

export const TaskSharedMemoryKindSchema = z.enum([
  'objective',
  'constraint',
  'committed_decision',
  'evidence',
  'artifact',
  'plan_state',
  'blocker',
  'failed_strategy_summary'
])
export type TaskSharedMemoryKind = z.infer<typeof TaskSharedMemoryKindSchema>

export const AgentPrivateMemoryKindSchema = z.enum([
  'dialogue',
  'reasoning_draft',
  'tool_observation',
  'transient_output',
  'working_note'
])
export type AgentPrivateMemoryKind = z.infer<typeof AgentPrivateMemoryKindSchema>

export const MemoryRetentionSchema = z.enum(['indefinite', 'task', 'agent_run'])
export type MemoryRetention = z.infer<typeof MemoryRetentionSchema>

const memoryLifecycleFields = {
  id: NonEmptyString,
  content: NonEmptyString,
  tags: z.array(NonEmptyString).default([]),
  confidence: z.number().min(0).max(1).default(1),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
  disabledAt: IsoTimestampSchema.optional(),
  deletedAt: IsoTimestampSchema.optional()
}

const LegacyMemoryRecordSchema = z.object({
  ...memoryLifecycleFields,
  ownerUserId: NonEmptyString.optional(),
  scope: LegacyMemoryScopeSchema,
  workspace: NonEmptyString.optional(),
  project: NonEmptyString.optional(),
  sourceThreadId: NonEmptyString.optional(),
  sourceTurnId: NonEmptyString.optional()
}).strict()

export const TaskSharedMemoryRecordSchema = z.object({
  ...memoryLifecycleFields,
  scope: z.literal('task_shared'),
  taskScope: TaskScopeSchema,
  checkpointRevision: z.number().int().positive(),
  kind: TaskSharedMemoryKindSchema,
  provenance: CheckpointProvenanceSchema,
  evidenceRefs: z.array(DurableReferenceSchema).default([]),
  retention: z.literal('task'),
  publishedAt: IsoTimestampSchema
}).strict()
export type TaskSharedMemoryRecord = z.infer<typeof TaskSharedMemoryRecordSchema>

export const AgentPrivateMemoryRecordSchema = z.object({
  ...memoryLifecycleFields,
  scope: z.literal('agent_private'),
  taskScope: TaskScopeSchema,
  agentId: NonEmptyString,
  agentRunId: NonEmptyString,
  kind: AgentPrivateMemoryKindSchema,
  provenance: CheckpointProvenanceSchema,
  retention: z.literal('agent_run')
}).strict()
export type AgentPrivateMemoryRecord = z.infer<typeof AgentPrivateMemoryRecordSchema>

export const MemoryRecord = z.discriminatedUnion('scope', [
  LegacyMemoryRecordSchema,
  TaskSharedMemoryRecordSchema,
  AgentPrivateMemoryRecordSchema
])
export type MemoryRecord = z.infer<typeof MemoryRecord>

export const LegacyMemoryCreateRequestSchema = z.object({
  ownerUserId: NonEmptyString.optional(),
  content: NonEmptyString,
  scope: LegacyMemoryScopeSchema.default('workspace'),
  workspace: NonEmptyString.optional(),
  project: NonEmptyString.optional(),
  sourceThreadId: NonEmptyString.optional(),
  sourceTurnId: NonEmptyString.optional(),
  tags: z.array(NonEmptyString).default([]),
  confidence: z.number().min(0).max(1).default(1)
}).strict()
export type LegacyMemoryCreateRequest = z.input<typeof LegacyMemoryCreateRequestSchema>

export const TaskSharedMemoryCreateRequestSchema = TaskSharedMemoryRecordSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  disabledAt: true,
  deletedAt: true
})
export type TaskSharedMemoryCreateRequest = z.input<typeof TaskSharedMemoryCreateRequestSchema>

export const AgentPrivateMemoryCreateRequestSchema = AgentPrivateMemoryRecordSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  disabledAt: true,
  deletedAt: true
})
export type AgentPrivateMemoryCreateRequest = z.input<typeof AgentPrivateMemoryCreateRequestSchema>

export const MemoryCreateRequest = z.union([
  TaskSharedMemoryCreateRequestSchema,
  AgentPrivateMemoryCreateRequestSchema,
  LegacyMemoryCreateRequestSchema
])
export type MemoryCreateRequest = z.input<typeof MemoryCreateRequest>

export const MemoryUpdateRequest = z.object({
  content: NonEmptyString.optional(),
  tags: z.array(NonEmptyString).optional(),
  confidence: z.number().min(0).max(1).optional(),
  disabled: z.boolean().optional()
}).strict()
export type MemoryUpdateRequest = z.input<typeof MemoryUpdateRequest>

const QueryFields = {
  query: z.string(),
  limit: z.number().int().nonnegative()
}

export const MemoryQuerySchema = z.discriminatedUnion('namespace', [
  z.object({
    namespace: z.literal('legacy'),
    ...QueryFields,
    workspace: NonEmptyString.optional(),
    threadId: NonEmptyString.optional(),
    ownerUserId: NonEmptyString.optional()
  }).strict(),
  z.object({
    namespace: z.literal('task_shared'),
    ...QueryFields,
    taskScope: TaskScopeSchema
  }).strict(),
  z.object({
    namespace: z.literal('agent_private'),
    ...QueryFields,
    taskScope: TaskScopeSchema,
    agentId: NonEmptyString,
    agentRunId: NonEmptyString
  }).strict()
])
export type MemoryQuery = z.infer<typeof MemoryQuerySchema>

export const MemoryListQuerySchema = z.discriminatedUnion('namespace', [
  z.object({
    namespace: z.literal('legacy'),
    workspace: NonEmptyString.optional(),
    includeDeleted: z.boolean().default(false),
    ownerUserId: NonEmptyString.optional()
  }).strict(),
  z.object({
    namespace: z.literal('task_shared'),
    taskScope: TaskScopeSchema,
    includeDeleted: z.boolean().default(false)
  }).strict(),
  z.object({
    namespace: z.literal('agent_private'),
    taskScope: TaskScopeSchema,
    agentId: NonEmptyString,
    agentRunId: NonEmptyString,
    includeDeleted: z.boolean().default(false)
  }).strict()
])
export type MemoryListQuery = z.infer<typeof MemoryListQuerySchema>

export const MemoryDiagnostics = z.object({
  enabled: z.boolean(),
  rootDir: z.string(),
  activeCount: z.number().int().nonnegative(),
  tombstoneCount: z.number().int().nonnegative(),
  lastInjectedIds: z.array(z.string()).default([])
}).strict()
export type MemoryDiagnostics = z.infer<typeof MemoryDiagnostics>
