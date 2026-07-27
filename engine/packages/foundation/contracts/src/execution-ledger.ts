import { z } from 'zod'
import { CanonicalRecordKeySchema, GraphCorrelationIdentitySchema, IsoTimestampSchema, TaskScopeSchema } from './engine-identity.js'
import { UsageSnapshotSchema } from './usage.js'

const NonEmptyString = z.string().trim().min(1)
const RevisionSchema = z.number().int().nonnegative()

const DurableUsageSnapshotSchema = UsageSnapshotSchema.strict()

export const ExecutionLedgerStatusSchema = z.enum([
  'prepared',
  'running',
  'completed',
  'failed',
  'replayed',
  'suppressed',
  'uncertain'
])
export type ExecutionLedgerStatus = z.infer<typeof ExecutionLedgerStatusSchema>

export const ImmutableProfileRefSchema = z.object({
  profileId: NonEmptyString,
  revision: z.number().int().nonnegative()
}).strict()
export type ImmutableProfileRef = z.infer<typeof ImmutableProfileRefSchema>

export const ModelPricingSchema = z.object({
  currency: NonEmptyString,
  inputPerMillion: z.number().nonnegative(),
  outputPerMillion: z.number().nonnegative()
}).strict()
export type ModelPricing = z.infer<typeof ModelPricingSchema>

export const EffectPolicySchema = z.enum([
  'safe',
  'idempotent-with-key',
  'verify-before-replay',
  'never-replay'
])
export type EffectPolicy = z.infer<typeof EffectPolicySchema>

export const ReplayValiditySchema = z.enum(['unknown', 'valid', 'invalid'])
export type ReplayValidity = z.infer<typeof ReplayValiditySchema>

export const ProgressCheckpointSchema = z.object({
  taskRevision: RevisionSchema,
  progressFingerprint: NonEmptyString,
  evidenceDigests: z.array(NonEmptyString),
  artifactDigests: z.array(NonEmptyString),
  decisionDigests: z.array(NonEmptyString),
  resourceDigests: z.record(CanonicalRecordKeySchema, NonEmptyString),
  attemptedStrategyDigests: z.array(NonEmptyString),
  noProgressCount: z.number().int().nonnegative()
}).strict()
export type ProgressCheckpoint = z.infer<typeof ProgressCheckpointSchema>

export const ModelExecutionLedgerEntrySchema = z.object({
  kind: z.literal('model'),
  operationId: CanonicalRecordKeySchema,
  scope: TaskScopeSchema,
  kernelRunId: CanonicalRecordKeySchema,
  graph: GraphCorrelationIdentitySchema.optional(),
  logicalRequestKey: NonEmptyString,
  requestFingerprint: NonEmptyString,
  taskRevision: RevisionSchema,
  contextRevision: RevisionSchema,
  strategyRevision: RevisionSchema,
  strategyDigest: NonEmptyString,
  profileRef: ImmutableProfileRefSchema,
  capabilities: z.array(NonEmptyString).optional(),
  pricing: ModelPricingSchema.optional(),
  routeReason: NonEmptyString.optional(),
  status: ExecutionLedgerStatusSchema,
  resultRef: NonEmptyString.optional(),
  usage: DurableUsageSnapshotSchema.optional(),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema
}).strict()
export type ModelExecutionLedgerEntry = z.infer<typeof ModelExecutionLedgerEntrySchema>

export const ToolExecutionLedgerEntrySchema = z.object({
  kind: z.literal('tool'),
  operationId: CanonicalRecordKeySchema,
  scope: TaskScopeSchema,
  kernelRunId: CanonicalRecordKeySchema,
  graph: GraphCorrelationIdentitySchema.optional(),
  exactFingerprint: NonEmptyString,
  semanticKey: NonEmptyString,
  preconditionVersions: z.record(CanonicalRecordKeySchema, NonEmptyString),
  observedPostconditions: z.record(CanonicalRecordKeySchema, NonEmptyString),
  effectPolicy: EffectPolicySchema,
  replayValidity: ReplayValiditySchema,
  status: ExecutionLedgerStatusSchema,
  resultRef: NonEmptyString.optional(),
  noProgressCount: z.number().int().nonnegative(),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema
}).strict()
export type ToolExecutionLedgerEntry = z.infer<typeof ToolExecutionLedgerEntrySchema>

export const ExecutionLedgerEntrySchema = z.discriminatedUnion('kind', [
  ModelExecutionLedgerEntrySchema,
  ToolExecutionLedgerEntrySchema
])
export type ExecutionLedgerEntry = z.infer<typeof ExecutionLedgerEntrySchema>
