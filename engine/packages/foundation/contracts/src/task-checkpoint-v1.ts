import { z } from 'zod'
import { CanonicalRecordKeySchema, IsoTimestampSchema, TaskScopeSchema } from './engine-identity.js'

const NonEmptyString = z.string().trim().min(1)
const RevisionSchema = z.number().int().nonnegative()

export const TaskCheckpointStatusSchema = z.enum([
  'running',
  'waiting_approval',
  'waiting_input',
  'waiting_effect_verification',
  'waiting_model_resolution',
  'completed',
  'degraded',
  'failed',
  'aborted',
  'corrupt'
])
export type TaskCheckpointStatus = z.infer<typeof TaskCheckpointStatusSchema>

export const CheckpointProvenanceSchema = z.object({
  source: NonEmptyString,
  digest: NonEmptyString,
  recordedAt: IsoTimestampSchema
}).strict()
export type CheckpointProvenance = z.infer<typeof CheckpointProvenanceSchema>

export const DurableReferenceSchema = z.object({
  ref: NonEmptyString,
  digest: NonEmptyString,
  mediaType: NonEmptyString,
  provenance: CheckpointProvenanceSchema
}).strict()
export type DurableReference = z.infer<typeof DurableReferenceSchema>

export const TaskCheckpointActionSchema = z.object({
  actionId: NonEmptyString,
  description: NonEmptyString,
  status: z.enum(['pending', 'running', 'completed', 'failed', 'blocked']),
  dependsOn: z.array(NonEmptyString).optional()
}).strict()
export type TaskCheckpointAction = z.infer<typeof TaskCheckpointActionSchema>

export const TaskPlanCheckpointSchema = z.object({
  planId: NonEmptyString,
  digest: NonEmptyString,
  actionIds: z.array(NonEmptyString)
}).strict()
export type TaskPlanCheckpoint = z.infer<typeof TaskPlanCheckpointSchema>

export const CommittedDecisionSchema = z.object({
  decisionId: NonEmptyString,
  digest: NonEmptyString,
  summary: NonEmptyString.optional()
}).strict()
export type CommittedDecision = z.infer<typeof CommittedDecisionSchema>

export const AttemptedStrategySchema = z.object({
  strategyId: NonEmptyString,
  digest: NonEmptyString,
  revision: RevisionSchema
}).strict()
export type AttemptedStrategy = z.infer<typeof AttemptedStrategySchema>

export const WaitingStateSchema = z.object({
  status: z.enum([
    'waiting_approval',
    'waiting_input',
    'waiting_effect_verification',
    'waiting_model_resolution'
  ]),
  reason: NonEmptyString,
  requestedAt: IsoTimestampSchema
}).strict()
export type WaitingState = z.infer<typeof WaitingStateSchema>

export const TaskCheckpointV1Schema = z.object({
  version: z.literal(1),
  scope: TaskScopeSchema,
  revision: RevisionSchema,
  status: TaskCheckpointStatusSchema,
  objective: NonEmptyString,
  constraints: z.array(NonEmptyString),
  actions: z.array(TaskCheckpointActionSchema),
  activePlan: TaskPlanCheckpointSchema.optional(),
  nextAction: TaskCheckpointActionSchema.optional(),
  committedDecisions: z.array(CommittedDecisionSchema),
  evidenceRefs: z.array(DurableReferenceSchema),
  artifactRefs: z.array(DurableReferenceSchema),
  resourceVersions: z.record(CanonicalRecordKeySchema, NonEmptyString),
  attemptedStrategies: z.array(AttemptedStrategySchema),
  executionLedgerHighWater: z.number().int().nonnegative(),
  waitingState: WaitingStateSchema.optional(),
  provenance: z.array(CheckpointProvenanceSchema),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema
}).strict().superRefine((checkpoint, context) => {
  const isWaiting = checkpoint.status === 'waiting_approval'
    || checkpoint.status === 'waiting_input'
    || checkpoint.status === 'waiting_effect_verification'
    || checkpoint.status === 'waiting_model_resolution'
  if (isWaiting && !checkpoint.waitingState) {
    context.addIssue({ code: 'custom', message: 'waiting checkpoint status requires waitingState', path: ['waitingState'] })
  }
  if (isWaiting && checkpoint.waitingState && checkpoint.waitingState.status !== checkpoint.status) {
    context.addIssue({ code: 'custom', message: 'waitingState status must match checkpoint status', path: ['waitingState', 'status'] })
  }
  if (!isWaiting && checkpoint.waitingState) {
    context.addIssue({ code: 'custom', message: 'non-waiting checkpoint status must not retain waitingState', path: ['waitingState'] })
  }
})
export type TaskCheckpointV1 = z.infer<typeof TaskCheckpointV1Schema>

export const ContextIdentityComponentsSchema = z.object({
  scope: TaskScopeSchema,
  sourceHistoryDigest: NonEmptyString,
  taskRevision: RevisionSchema,
  memoryRevision: RevisionSchema,
  ledgerHighWater: z.number().int().nonnegative(),
  policyVersion: NonEmptyString
}).strict()
export type ContextIdentityComponents = z.infer<typeof ContextIdentityComponentsSchema>

/** Deterministic identity for a context snapshot's stable source inputs. */
export function deriveContextId(input: ContextIdentityComponents): string {
  const identity = ContextIdentityComponentsSchema.parse(input)
  return [
    'context-v1',
    `ownerId=${encodeURIComponent(identity.scope.ownerId)}`,
    `workspaceId=${encodeURIComponent(identity.scope.workspaceId)}`,
    `taskId=${encodeURIComponent(identity.scope.taskId)}`,
    `sourceHistoryDigest=${encodeURIComponent(identity.sourceHistoryDigest)}`,
    `taskRevision=${identity.taskRevision}`,
    `memoryRevision=${identity.memoryRevision}`,
    `ledgerHighWater=${identity.ledgerHighWater}`,
    `policyVersion=${encodeURIComponent(identity.policyVersion)}`
  ].join('|')
}

export const ContextCheckpointV1Schema = z.object({
  version: z.literal(1),
  contextId: NonEmptyString,
  scope: TaskScopeSchema,
  revision: RevisionSchema,
  sourceHistoryDigest: NonEmptyString,
  taskRevision: RevisionSchema,
  memoryRevision: RevisionSchema,
  ledgerHighWater: z.number().int().nonnegative(),
  policyVersion: NonEmptyString,
  coveredItemIds: z.array(NonEmptyString),
  coveredItemsDigest: NonEmptyString,
  cursor: NonEmptyString,
  summary: NonEmptyString.optional(),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema
}).strict().superRefine((checkpoint, context) => {
  const expectedContextId = deriveContextId({
    scope: checkpoint.scope,
    sourceHistoryDigest: checkpoint.sourceHistoryDigest,
    taskRevision: checkpoint.taskRevision,
    memoryRevision: checkpoint.memoryRevision,
    ledgerHighWater: checkpoint.ledgerHighWater,
    policyVersion: checkpoint.policyVersion
  })
  if (checkpoint.contextId !== expectedContextId) {
    context.addIssue({
      code: 'custom',
      message: 'contextId must match the deterministic context identity',
      path: ['contextId']
    })
  }
})
export type ContextCheckpointV1 = z.infer<typeof ContextCheckpointV1Schema>
