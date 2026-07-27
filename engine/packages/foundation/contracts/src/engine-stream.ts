import { z } from 'zod'
import { GraphCorrelationIdentitySchema, IsoTimestampSchema, TaskScopeSchema } from './engine-identity.js'
import { ImmutableProfileRefSchema } from './execution-ledger.js'
import { DurableReferenceSchema } from './task-checkpoint-v1.js'
import { GraphAttributionQuerySchema, GraphAttributionSchema } from './usage.js'

const NonEmptyString = z.string().trim().min(1)

export const EngineStreamChannelSchema = z.enum(['public', 'private', 'diagnostic'])
export type EngineStreamChannel = z.infer<typeof EngineStreamChannelSchema>

export const EngineStreamReasoningPolicySchema = z.object({
  collect: z.boolean(),
  persist: z.boolean(),
  subscribe: z.boolean(),
  retain: z.boolean()
}).strict()
export type EngineStreamReasoningPolicy = z.infer<typeof EngineStreamReasoningPolicySchema>

export const EngineStreamEventSchema = z.object({
  streamId: NonEmptyString,
  seq: z.number().int().positive(),
  timestamp: IsoTimestampSchema,
  scope: TaskScopeSchema,
  multiAgentRunId: NonEmptyString.optional(),
  branchId: NonEmptyString.optional(),
  agentRunId: NonEmptyString.optional(),
  kernelRunId: NonEmptyString.optional(),
  graph: GraphCorrelationIdentitySchema.optional(),
  channel: EngineStreamChannelSchema,
  kind: NonEmptyString,
  payload: z.unknown()
}).strict().superRefine((event, context) => {
  if (event.agentRunId && !event.multiAgentRunId) {
    context.addIssue({ code: 'custom', message: 'agentRunId requires multiAgentRunId', path: ['agentRunId'] })
  }
  if (event.branchId && !event.multiAgentRunId) {
    context.addIssue({ code: 'custom', message: 'branchId requires multiAgentRunId', path: ['branchId'] })
  }
  if (event.kernelRunId && (!event.multiAgentRunId || !event.agentRunId)) {
    context.addIssue({ code: 'custom', message: 'kernelRunId requires multiAgentRunId and agentRunId', path: ['kernelRunId'] })
  }
})
export type EngineStreamEvent = z.infer<typeof EngineStreamEventSchema>

export const CostEntrySchema = z.object({
  costId: NonEmptyString,
  scope: TaskScopeSchema,
  parentCostId: NonEmptyString.optional(),
  profileRef: ImmutableProfileRefSchema.optional(),
  amount: z.number().nonnegative(),
  currency: NonEmptyString,
  source: NonEmptyString,
  graph: GraphAttributionSchema.optional(),
  incurredAt: IsoTimestampSchema
}).strict()
export type CostEntry = z.infer<typeof CostEntrySchema>

export const ValueEventSchema = z.object({
  valueId: NonEmptyString,
  scope: TaskScopeSchema,
  amount: z.number(),
  currency: NonEmptyString,
  source: NonEmptyString,
  confidence: z.number().min(0).max(1),
  evidenceRefs: z.array(DurableReferenceSchema),
  graph: GraphAttributionSchema.optional(),
  recordedAt: IsoTimestampSchema
}).strict()
export type ValueEvent = z.infer<typeof ValueEventSchema>

export const RoiStatusSchema = z.enum(['available', 'incomplete', 'unavailable'])
export type RoiStatus = z.infer<typeof RoiStatusSchema>

export const EngineEfficiencySchema = z.object({
  logicalAttempts: z.number().int().nonnegative(),
  physicalAttempts: z.number().int().nonnegative(),
  replayedAttempts: z.number().int().nonnegative(),
  suppressedAttempts: z.number().int().nonnegative(),
  progressPerCost: z.number().nonnegative().optional(),
  evidencePerCost: z.number().nonnegative().optional(),
  artifactPerCost: z.number().nonnegative().optional(),
  estimatedWasteAvoided: z.number().nonnegative()
}).strict()
export type EngineEfficiency = z.infer<typeof EngineEfficiencySchema>

export const GraphNodeAttributionMetricsSchema = z.object({
  cost: z.number().nonnegative(),
  businessValue: z.number(),
  attempts: z.number().int().nonnegative(),
  retries: z.number().int().nonnegative(),
  suppressedAttempts: z.number().int().nonnegative(),
  avoidedCost: z.number().nonnegative(),
  latencyMs: z.number().int().nonnegative()
}).strict()
export type GraphNodeAttributionMetrics = z.infer<typeof GraphNodeAttributionMetricsSchema>

export const GraphEdgeAttributionMetricsSchema = z.object({
  cost: z.number().nonnegative(),
  businessValue: z.number(),
  selected: z.number().int().nonnegative(),
  traversals: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative()
}).strict()
export type GraphEdgeAttributionMetrics = z.infer<typeof GraphEdgeAttributionMetricsSchema>

export const BranchRoiSnapshotSchema = z.object({
  roiStatus: RoiStatusSchema,
  currency: NonEmptyString.optional(),
  incurredCost: z.number().nonnegative(),
  businessValue: z.number(),
  netValue: z.number().optional(),
  roiRatio: z.number().optional(),
  engineEfficiency: EngineEfficiencySchema,
  updatedAt: IsoTimestampSchema
}).strict()
export type BranchRoiSnapshot = z.infer<typeof BranchRoiSnapshotSchema>

export const RoiSnapshotSchema = z.object({
  scope: TaskScopeSchema,
  revision: z.number().int().nonnegative(),
  roiStatus: RoiStatusSchema,
  currency: NonEmptyString.optional(),
  incurredCost: z.number().nonnegative(),
  businessValue: z.number(),
  netValue: z.number().optional(),
  roiRatio: z.number().optional(),
  engineEfficiency: EngineEfficiencySchema,
  graph: GraphAttributionQuerySchema.optional(),
  byNode: z.record(NonEmptyString, GraphNodeAttributionMetricsSchema).optional(),
  byEdge: z.record(NonEmptyString, GraphEdgeAttributionMetricsSchema).optional(),
  byBranch: z.record(NonEmptyString, BranchRoiSnapshotSchema).optional(),
  fanOut: z.number().int().nonnegative().optional(),
  retryAmplification: z.number().nonnegative().optional(),
  suppressedPhysicalAttempts: z.number().int().nonnegative().optional(),
  avoidedCost: z.number().nonnegative().optional(),
  criticalPathLatencyMs: z.number().int().nonnegative().optional(),
  updatedAt: IsoTimestampSchema
}).strict()
export type RoiSnapshot = z.infer<typeof RoiSnapshotSchema>
