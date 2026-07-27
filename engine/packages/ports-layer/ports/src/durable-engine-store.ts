import { z } from 'zod'
import {
  BudgetStateSchema,
  CanonicalRecordKeySchema,
  ContextCheckpointV1Schema,
  CostEntrySchema,
  EngineStreamChannelSchema,
  ExecutionLedgerEntrySchema,
  GraphCorrelationIdentitySchema,
  GraphRevisionSchema,
  GraphRunRecordSchema,
  HumanCheckpointSchema,
  ImmutableProfileRefSchema,
  IsoTimestampSchema,
  TaskCheckpointStatusSchema,
  TaskCheckpointV1Schema,
  TaskScopeSchema,
  ValueEventSchema,
  RunOutcomeSchema,
  ModelSelectionPolicySchema,
  ResourceClaimSchema,
  WorkGraphEventSchema,
  type ContextCheckpointV1,
  type CostEntry,
  type EngineStreamEvent,
  type ExecutionLedgerEntry,
  type GraphRevision,
  type GraphRunRecord,
  type HumanCheckpoint,
  type ImmutableProfileRef,
  type TaskCheckpointV1,
  type TaskScope,
  type ModelSelectionPolicy,
  type ResourceClaim,
  type WorkGraphEventRecord,
  type ValueEvent
} from '@qiongqi/contracts'

const RevisionSchema = z.number().int().nonnegative()

export const EngineRunRecordSchema = z.object({
  runId: CanonicalRecordKeySchema,
  scope: TaskScopeSchema,
  multiAgentRunId: CanonicalRecordKeySchema,
  agentRunId: CanonicalRecordKeySchema.optional(),
  kernelRunId: CanonicalRecordKeySchema.optional(),
  graph: GraphCorrelationIdentitySchema.optional(),
  version: RevisionSchema,
  status: z.union([z.literal('created'), TaskCheckpointStatusSchema]),
  desiredState: z.enum(['running', 'cancelled']),
  cursor: z.object({
    nodeId: CanonicalRecordKeySchema,
    stepIndex: RevisionSchema,
    checkpointSeq: RevisionSchema
  }).strict(),
  parentRef: z.object({
    kind: z.enum(['multi_agent', 'agent', 'kernel']),
    runId: CanonicalRecordKeySchema
  }).strict().optional(),
  budgets: BudgetStateSchema,
  budgetLimits: BudgetStateSchema.optional(),
  outcome: RunOutcomeSchema.optional(),
  suspension: z.object({
    token: CanonicalRecordKeySchema,
    reason: z.string().trim().min(1),
    revision: RevisionSchema,
    requestedAt: IsoTimestampSchema
  }).strict().optional(),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema
}).strict()
export type EngineRunRecord = z.infer<typeof EngineRunRecordSchema>

export const EngineEventInputSchema = z.object({
  eventId: CanonicalRecordKeySchema,
  runId: CanonicalRecordKeySchema,
  scope: TaskScopeSchema,
  kind: z.string().trim().min(1),
  payload: z.unknown(),
  timestamp: IsoTimestampSchema
}).strict()
export type EngineEventInput = z.infer<typeof EngineEventInputSchema>

export const EngineEventRecordSchema = EngineEventInputSchema.extend({
  seq: z.number().int().positive()
}).strict()
export type EngineEventRecord = z.infer<typeof EngineEventRecordSchema>

export const EngineStreamEventInputSchema = z.object({
  streamId: CanonicalRecordKeySchema,
  timestamp: IsoTimestampSchema,
  scope: TaskScopeSchema,
  multiAgentRunId: CanonicalRecordKeySchema.optional(),
  agentRunId: CanonicalRecordKeySchema.optional(),
  kernelRunId: CanonicalRecordKeySchema.optional(),
  graph: GraphCorrelationIdentitySchema.optional(),
  channel: EngineStreamChannelSchema,
  kind: z.string().trim().min(1),
  payload: z.unknown()
}).strict().superRefine((event, context) => {
  if (event.agentRunId && !event.multiAgentRunId) {
    context.addIssue({ code: 'custom', message: 'agentRunId requires multiAgentRunId', path: ['agentRunId'] })
  }
  if (event.kernelRunId && (!event.multiAgentRunId || !event.agentRunId)) {
    context.addIssue({ code: 'custom', message: 'kernelRunId requires multiAgentRunId and agentRunId', path: ['kernelRunId'] })
  }
})
export type EngineStreamEventInput = z.infer<typeof EngineStreamEventInputSchema>

export const EngineOutboxIntentSchema = z.object({
  workId: CanonicalRecordKeySchema,
  scope: TaskScopeSchema,
  kind: CanonicalRecordKeySchema,
  payloadRef: z.string().trim().min(1),
  status: z.enum(['pending', 'claimed', 'completed']),
  availableAt: IsoTimestampSchema,
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
  completedAt: IsoTimestampSchema.optional(),
  payload: z.unknown().optional()
}).strict()
export type EngineOutboxIntent = z.infer<typeof EngineOutboxIntentSchema>

export const EngineLeaseSchema = z.object({
  runId: CanonicalRecordKeySchema,
  holderId: CanonicalRecordKeySchema,
  fence: z.number().int().positive(),
  token: CanonicalRecordKeySchema,
  expiresAt: IsoTimestampSchema
}).strict()
export type EngineLease = z.infer<typeof EngineLeaseSchema>

export const EngineOutboxRecordSchema = EngineOutboxIntentSchema.extend({
  claim: EngineLeaseSchema.optional()
}).strict()
export type EngineOutboxRecord = z.infer<typeof EngineOutboxRecordSchema>

export const WorkClaimSchema = z.object({
  workId: CanonicalRecordKeySchema,
  kind: CanonicalRecordKeySchema,
  payloadRef: z.string().trim().min(1),
  lease: EngineLeaseSchema,
  payload: z.unknown().optional()
}).strict()
export type WorkClaim = z.infer<typeof WorkClaimSchema>

export const RunMutationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('put'), record: EngineRunRecordSchema }).strict(),
  z.object({ type: z.literal('delete'), recordId: CanonicalRecordKeySchema }).strict()
])
export type RunMutation = z.infer<typeof RunMutationSchema>

export const TaskCheckpointMutationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('put'), record: TaskCheckpointV1Schema }).strict(),
  z.object({ type: z.literal('delete'), recordId: CanonicalRecordKeySchema }).strict()
])
export type TaskCheckpointMutation = z.infer<typeof TaskCheckpointMutationSchema>

export const ContextCheckpointMutationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('put'), record: ContextCheckpointV1Schema }).strict(),
  z.object({ type: z.literal('delete'), recordId: CanonicalRecordKeySchema }).strict()
])
export type ContextCheckpointMutation = z.infer<typeof ContextCheckpointMutationSchema>

export const LedgerMutationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('append'), record: ExecutionLedgerEntrySchema }).strict(),
  z.object({ type: z.literal('put'), record: ExecutionLedgerEntrySchema }).strict(),
  z.object({ type: z.literal('delete'), recordId: CanonicalRecordKeySchema }).strict()
])
export type LedgerMutation = z.infer<typeof LedgerMutationSchema>

export const EngineEventMutationSchema = z.object({
  type: z.literal('append'),
  record: EngineEventInputSchema
}).strict()
export type EngineEventMutation = z.infer<typeof EngineEventMutationSchema>

export const EngineStreamEventMutationSchema = z.object({
  type: z.literal('append'),
  record: EngineStreamEventInputSchema
}).strict()
export type EngineStreamEventMutation = z.infer<typeof EngineStreamEventMutationSchema>

export const OutboxMutationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('put'), record: EngineOutboxIntentSchema }).strict(),
  z.object({
    type: z.literal('complete'),
    recordId: CanonicalRecordKeySchema,
    claim: EngineLeaseSchema.optional(),
    payload: z.unknown().optional()
  }).strict(),
  z.object({ type: z.literal('delete'), recordId: CanonicalRecordKeySchema }).strict()
])
export type OutboxMutation = z.infer<typeof OutboxMutationSchema>

export const CostMutationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('append'), record: CostEntrySchema }).strict(),
  z.object({ type: z.literal('delete'), recordId: CanonicalRecordKeySchema }).strict()
])
export type CostMutation = z.infer<typeof CostMutationSchema>

export const ValueMutationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('append'), record: ValueEventSchema }).strict(),
  z.object({ type: z.literal('delete'), recordId: CanonicalRecordKeySchema }).strict()
])
export type ValueMutation = z.infer<typeof ValueMutationSchema>

export const BudgetReservationStatusSchema = z.enum(['reserved', 'settled', 'released'])
export type BudgetReservationStatus = z.infer<typeof BudgetReservationStatusSchema>

export const BudgetReservationRecordSchema = z.object({
  reservationId: CanonicalRecordKeySchema,
  scope: TaskScopeSchema,
  parentRunId: CanonicalRecordKeySchema,
  childRunId: CanonicalRecordKeySchema,
  status: BudgetReservationStatusSchema,
  reserved: BudgetStateSchema,
  actual: BudgetStateSchema.optional(),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema
}).strict()
export type BudgetReservationRecord = z.infer<typeof BudgetReservationRecordSchema>

export const BudgetReservationMutationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('reserve'), record: BudgetReservationRecordSchema }).strict(),
  z.object({
    type: z.literal('settle'),
    recordId: CanonicalRecordKeySchema,
    actual: BudgetStateSchema,
    updatedAt: IsoTimestampSchema
  }).strict(),
  z.object({
    type: z.literal('release'),
    recordId: CanonicalRecordKeySchema,
    updatedAt: IsoTimestampSchema
  }).strict()
])
export type BudgetReservationMutation = z.infer<typeof BudgetReservationMutationSchema>

export const GraphRevisionMutationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('put'), record: GraphRevisionSchema }).strict(),
  z.object({ type: z.literal('delete'), graphId: CanonicalRecordKeySchema, revision: z.number().int().positive() }).strict()
])
export type GraphRevisionMutation = z.infer<typeof GraphRevisionMutationSchema>

export const GraphRunMutationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('put'), record: GraphRunRecordSchema }).strict(),
  z.object({ type: z.literal('delete'), recordId: CanonicalRecordKeySchema }).strict()
])
export type GraphRunMutation = z.infer<typeof GraphRunMutationSchema>

export const WorkGraphEventMutationSchema = z.object({
  type: z.literal('append'),
  record: WorkGraphEventSchema
}).strict()
export type WorkGraphEventMutation = z.infer<typeof WorkGraphEventMutationSchema>

export const TaskModelPolicyRecordSchema = z.object({
  scope: TaskScopeSchema,
  revision: z.number().int().positive(),
  policy: ModelSelectionPolicySchema,
  validatedProfileRefs: z.array(ImmutableProfileRefSchema),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema
}).strict()
export type TaskModelPolicyRecord = z.infer<typeof TaskModelPolicyRecordSchema>

export const TaskModelPolicyMutationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('put'), record: TaskModelPolicyRecordSchema }).strict(),
  z.object({ type: z.literal('delete') }).strict()
])
export type TaskModelPolicyMutation = z.infer<typeof TaskModelPolicyMutationSchema>

export const HumanCheckpointMutationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('put'), record: HumanCheckpointSchema }).strict(),
  z.object({
    type: z.literal('resolve'),
    recordId: CanonicalRecordKeySchema,
    resolutionToken: CanonicalRecordKeySchema,
    graphRevision: z.number().int().positive(),
    status: z.enum(['allowed', 'denied']),
    resolvedAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema
  }).strict(),
  z.object({
    type: z.literal('expire'),
    recordId: CanonicalRecordKeySchema,
    graphRevision: z.number().int().positive(),
    resolvedAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema
  }).strict(),
  z.object({ type: z.literal('delete'), recordId: CanonicalRecordKeySchema }).strict()
])
export type HumanCheckpointMutation = z.infer<typeof HumanCheckpointMutationSchema>

export function applyHumanCheckpointMutation(
  current: HumanCheckpoint,
  mutation: Extract<HumanCheckpointMutation, { type: 'resolve' | 'expire' }>
): HumanCheckpoint {
  if (current.status !== 'pending') {
    throw new EngineStoreConflictError(`checkpoint ${current.checkpointId} is not pending; token already consumed`)
  }
  if (current.graphRevision !== mutation.graphRevision) {
    throw new EngineStoreConflictError(`checkpoint ${current.checkpointId} graph revision mismatch`)
  }
  if (mutation.type === 'resolve') {
    if (current.resolutionToken !== mutation.resolutionToken) {
      throw new EngineStoreConflictError(`checkpoint ${current.checkpointId} resolution token mismatch`)
    }
    if (Date.parse(mutation.resolvedAt) >= Date.parse(current.expiresAt)) {
      throw new EngineStoreConflictError(`checkpoint ${current.checkpointId} expired`)
    }
  }
  return HumanCheckpointSchema.parse({
    ...current,
    status: mutation.type === 'expire' ? 'expired' : mutation.status,
    resolvedAt: mutation.resolvedAt,
    updatedAt: mutation.updatedAt
  })
}

export const ResourceClaimMutationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('put'), record: ResourceClaimSchema }).strict(),
  z.object({ type: z.literal('delete'), resourceKey: CanonicalRecordKeySchema, claimId: CanonicalRecordKeySchema }).strict()
])
export type ResourceClaimMutation = z.infer<typeof ResourceClaimMutationSchema>

export const ResourceClaimRequestSchema = z.object({
  claimId: CanonicalRecordKeySchema,
  scope: TaskScopeSchema,
  resourceKey: CanonicalRecordKeySchema,
  mode: z.enum(['read', 'write']),
  holderId: CanonicalRecordKeySchema,
  conflictStrategy: z.enum(['wait', 'skip', 'escalate']),
  ttlMs: z.number().int().positive()
}).strict()
export type ResourceClaimRequest = z.infer<typeof ResourceClaimRequestSchema>

export function resourceClaimConflicts(
  requestedMode: ResourceClaimRequest['mode'],
  activeClaims: readonly ResourceClaim[]
): boolean {
  return activeClaims.some((claim) => requestedMode === 'write' || claim.mode === 'write')
}

export const EngineCommitSchema = z.object({
  scope: TaskScopeSchema,
  runId: CanonicalRecordKeySchema,
  aggregateKind: z.literal('governed_root').optional(),
  expectedRunVersion: RevisionSchema,
  expectedTaskRevision: RevisionSchema,
  expectedModelPolicyRevision: RevisionSchema.optional(),
  leaseFence: z.number().int().positive().optional(),
  runMutation: RunMutationSchema.optional(),
  taskCheckpointMutation: TaskCheckpointMutationSchema.optional(),
  contextCheckpointMutation: ContextCheckpointMutationSchema.optional(),
  ledgerMutations: z.array(LedgerMutationSchema).default([]),
  events: z.array(EngineEventMutationSchema).default([]),
  streamEvents: z.array(EngineStreamEventMutationSchema).default([]),
  outboxIntents: z.array(OutboxMutationSchema).default([]),
  costMutations: z.array(CostMutationSchema).default([]),
  valueMutations: z.array(ValueMutationSchema).default([]),
  budgetReservationMutations: z.array(BudgetReservationMutationSchema).default([]),
  graphRevisionMutations: z.array(GraphRevisionMutationSchema).default([]),
  graphRunMutation: GraphRunMutationSchema.optional(),
  workGraphEvents: z.array(WorkGraphEventMutationSchema).default([]),
  taskModelPolicyMutation: TaskModelPolicyMutationSchema.optional(),
  humanCheckpointMutations: z.array(HumanCheckpointMutationSchema).default([]),
  resourceClaimMutations: z.array(ResourceClaimMutationSchema).default([])
}).strict().superRefine((commit, context) => {
  if (commit.aggregateKind !== 'governed_root') return
  if (!commit.runMutation || !commit.graphRunMutation) {
    context.addIssue({
      code: 'custom',
      message: 'governed root commit requires both graph and engine projections'
    })
    return
  }
  if (commit.runMutation.type !== commit.graphRunMutation.type) {
    context.addIssue({
      code: 'custom',
      message: 'governed root mutations must use the same operation'
    })
  }
})
export type EngineCommit = z.input<typeof EngineCommitSchema>
export type ParsedEngineCommit = z.output<typeof EngineCommitSchema>

export const EngineCommitResultSchema = z.object({
  runVersion: RevisionSchema,
  taskRevision: RevisionSchema,
  eventHighWater: RevisionSchema,
  streamHighWater: RevisionSchema
}).strict()
export type EngineCommitResult = z.infer<typeof EngineCommitResultSchema>

export const LedgerQuerySchema = z.object({
  scope: TaskScopeSchema,
  kind: z.enum(['model', 'tool']).optional(),
  operationId: CanonicalRecordKeySchema.optional(),
  kernelRunId: CanonicalRecordKeySchema.optional(),
  logicalRequestKey: z.string().trim().min(1).optional(),
  exactFingerprint: z.string().trim().min(1).optional(),
  semanticKey: z.string().trim().min(1).optional(),
  status: z.enum(['prepared', 'running', 'completed', 'failed', 'replayed', 'suppressed', 'uncertain']).optional()
}).strict()
export type LedgerQuery = z.infer<typeof LedgerQuerySchema>

export class EngineStoreConflictError extends Error {
  readonly code = 'ENGINE_STORE_CONFLICT'

  constructor(message: string) {
    super(message)
    this.name = 'EngineStoreConflictError'
  }
}

export class EngineStoreCorruptError extends Error {
  readonly code = 'ENGINE_STORE_CORRUPT'

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'EngineStoreCorruptError'
  }
}

export function assertGovernedRootCommit(input: ParsedEngineCommit): void {
  if (input.aggregateKind !== 'governed_root') return
  const runMutation = input.runMutation
  const graphMutation = input.graphRunMutation
  if (!runMutation || !graphMutation || runMutation.type !== graphMutation.type) {
    throw new EngineStoreConflictError('governed root commit requires both projections with the same operation')
  }
  if (runMutation.type === 'delete' && graphMutation.type === 'delete') {
    if (runMutation.recordId !== input.runId || graphMutation.recordId !== input.runId) {
      throw new EngineStoreConflictError('governed root deletion targets another run')
    }
    return
  }
  if (runMutation.type !== 'put' || graphMutation.type !== 'put') {
    throw new EngineStoreConflictError('governed root mutations must use the same operation')
  }
  const engine = runMutation.record
  const graph = graphMutation.record
  const assignedVersion = input.expectedRunVersion + 1
  const sameScope = engine.scope.ownerId === graph.scope.ownerId
    && engine.scope.workspaceId === graph.scope.workspaceId
    && engine.scope.taskId === graph.scope.taskId
  const sameGraph = engine.graph?.graphId === graph.graphId
    && engine.graph.graphRevision === graph.graphRevision
    && engine.graph.graphDigest === graph.graphDigest
  if (engine.runId !== input.runId
    || graph.runId !== input.runId
    || engine.multiAgentRunId !== graph.runId
    || engine.version !== assignedVersion
    || graph.version !== assignedVersion
    || !sameScope
    || !sameGraph) {
    throw new EngineStoreConflictError('governed root projections have incompatible identity or version')
  }
  if (!engine.budgetLimits) {
    throw new EngineStoreConflictError('governed root engine projection requires caller budget limits')
  }
}

export interface DurableEngineStore {
  commit(input: EngineCommit): Promise<EngineCommitResult>
  loadRun(runId: string): Promise<EngineRunRecord | undefined>
  loadTask(scope: TaskScope): Promise<TaskCheckpointV1 | undefined>
  loadContext(scope: TaskScope, contextId: string): Promise<ContextCheckpointV1 | undefined>
  loadBudgetReservations(parentRunId: string): Promise<BudgetReservationRecord[]>
  findLedger(input: LedgerQuery): Promise<ExecutionLedgerEntry[]>
  listCosts(scope: TaskScope): Promise<CostEntry[]>
  listValues(scope: TaskScope): Promise<ValueEvent[]>
  readStream(streamId: string, afterSeq: number, limit: number): Promise<EngineStreamEvent[]>
  ackStream(streamId: string, subscriberId: string, throughSeq: number): Promise<void>
  acquireLease(runId: string, holderId: string, ttlMs: number): Promise<EngineLease | undefined>
  renewLease(runId: string, lease: EngineLease, ttlMs: number): Promise<EngineLease | undefined>
  releaseLease(runId: string, lease: EngineLease): Promise<void>
  claimWork(workerId: string, kinds: readonly string[], ttlMs: number): Promise<WorkClaim | undefined>
  renewWorkClaim(workId: string, lease: EngineLease, ttlMs: number): Promise<EngineLease | undefined>
  loadGraphRevision(graphId: string, revision: number): Promise<GraphRevision | undefined>
  loadGraphRun(runId: string): Promise<GraphRunRecord | undefined>
  listGraphRuns(scope?: TaskScope): Promise<GraphRunRecord[]>
  listWorkGraphEvents(runId: string, afterSeq: number, limit: number): Promise<WorkGraphEventRecord[]>
  loadTaskModelPolicy(scope: TaskScope): Promise<TaskModelPolicyRecord | undefined>
  loadHumanCheckpoint(checkpointId: string): Promise<HumanCheckpoint | undefined>
  listResourceClaims(resourceKey: string): Promise<ResourceClaim[]>
  claimResource(input: ResourceClaimRequest): Promise<ResourceClaim | undefined>
  renewResourceClaim(claim: ResourceClaim, ttlMs: number): Promise<ResourceClaim | undefined>
  releaseResourceClaim(claim: ResourceClaim): Promise<void>
  loadOutboxIntent(workId: string): Promise<EngineOutboxRecord | undefined>
  listOutboxIntents(scope: TaskScope): Promise<EngineOutboxRecord[]>
}
