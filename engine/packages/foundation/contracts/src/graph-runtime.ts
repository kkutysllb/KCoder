import { z } from 'zod'
import { BudgetStateSchema } from './runtime-kernel.js'
import {
  CanonicalRecordKeySchema,
  IsoTimestampSchema,
  TaskScopeSchema
} from './engine-identity.js'
import { MultiAgentRunSchema } from './multi-agent-runtime.js'

const Key = CanonicalRecordKeySchema
const Digest = z.string().regex(/^[a-f0-9]{64}$/)

export const ResolvedCallerIdentitySchema = z.object({
  kind: z.enum(['user', 'service', 'agent']),
  callerId: Key
}).strict()
export type ResolvedCallerIdentity = z.infer<typeof ResolvedCallerIdentitySchema>

export const ExecutionParentContextSchema = z.object({
  scope: TaskScopeSchema,
  graphId: Key,
  graphRevision: z.number().int().positive(),
  graphDigest: Digest,
  multiAgentRunId: Key,
  nodeId: Key.optional(),
  edgeId: Key.optional(),
  agentRunId: Key.optional(),
  kernelRunId: Key.optional(),
  attemptId: Key,
  callerIdentity: ResolvedCallerIdentitySchema,
  policyRevision: z.number().int().positive()
}).strict()
export type ExecutionParentContext = z.infer<typeof ExecutionParentContextSchema>

export const ExecutionContextSchema = ExecutionParentContextSchema.extend({
  parent: ExecutionParentContextSchema.optional()
}).strict().superRefine((context, refinement) => {
  const parent = context.parent
  if (!parent) return
  const sameScope = parent.scope.ownerId === context.scope.ownerId
    && parent.scope.workspaceId === context.scope.workspaceId
    && parent.scope.taskId === context.scope.taskId
  if (!sameScope
    || parent.graphId !== context.graphId
    || parent.graphRevision !== context.graphRevision
    || parent.graphDigest !== context.graphDigest
    || parent.multiAgentRunId !== context.multiAgentRunId) {
    refinement.addIssue({
      code: 'custom',
      message: 'child execution context must preserve parent graph identity',
      path: ['parent']
    })
  }
})
export type ExecutionContext = z.infer<typeof ExecutionContextSchema>

export const RootRunAggregateErrorCodeSchema = z.enum([
  'ROOT_RUN_AGGREGATE_INCOMPLETE',
  'ROOT_RUN_AGGREGATE_DIVERGED',
  'ROOT_RUN_BUDGET_MISSING'
])
export type RootRunAggregateErrorCode = z.infer<typeof RootRunAggregateErrorCodeSchema>

export const WorkGraphEventKindSchema = z.enum([
  'run_started', 'run_completed', 'run_failed', 'run_cancelled',
  'node_started', 'node_completed', 'node_failed', 'node_cancelled',
  'edge_selected', 'edge_traversed', 'edge_rejected',
  'child_spawned', 'child_joined', 'child_retried', 'child_compensated',
  'branch_spawned', 'branch_started', 'branch_completed', 'branch_failed', 'branch_cancelled', 'branch_late_result',
  'join_waiting', 'join_completed',
  'model_route_resolved', 'model_route_degraded',
  'approval_requested', 'approval_resolved', 'approval_expired',
  'resource_claimed', 'resource_released', 'resource_conflicted',
  'budget_reserved', 'budget_settled', 'budget_released', 'budget_exhausted',
  'circuit_degraded', 'circuit_paused', 'circuit_retired', 'circuit_resumed',
  'compatibility_deprecated', 'root_run_repaired'
])
export type WorkGraphEventKind = z.infer<typeof WorkGraphEventKindSchema>

const edgeEventKinds = new Set<WorkGraphEventKind>(['edge_selected', 'edge_traversed', 'edge_rejected'])

export const WorkGraphEventSchema = z.object({
  eventId: Key,
  scope: TaskScopeSchema,
  runId: Key,
  graphId: Key,
  graphRevision: z.number().int().positive(),
  nodeId: Key.optional(),
  branchId: Key.optional(),
  edgeId: Key.optional(),
  attemptId: Key,
  kind: WorkGraphEventKindSchema,
  payload: z.unknown(),
  timestamp: IsoTimestampSchema
}).strict().superRefine((event, refinement) => {
  if (edgeEventKinds.has(event.kind) && !event.edgeId) {
    refinement.addIssue({ code: 'custom', message: 'edge work events require edgeId', path: ['edgeId'] })
  }
})
export type WorkGraphEvent = z.infer<typeof WorkGraphEventSchema>

export const WorkGraphEventRecordSchema = WorkGraphEventSchema.safeExtend({
  seq: z.number().int().positive()
})
export type WorkGraphEventRecord = z.infer<typeof WorkGraphEventRecordSchema>

export const GraphRunRecordSchema = z.object({
  schemaVersion: z.literal(1),
  scope: TaskScopeSchema,
  runId: Key,
  threadId: Key,
  turnId: Key,
  workspaceKey: Key,
  graphId: Key,
  graphRevision: z.number().int().positive(),
  graphDigest: Digest,
  version: z.number().int().positive(),
  status: z.enum(['created', 'running', 'suspended', 'completed', 'failed', 'aborted']),
  circuitState: z.enum(['running', 'report_only', 'paused', 'retired']),
  activeNodeIds: z.array(Key).default([]),
  budgets: BudgetStateSchema,
  eventedV2Run: MultiAgentRunSchema.optional(),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema
}).strict()
export type GraphRunRecord = z.infer<typeof GraphRunRecordSchema>
