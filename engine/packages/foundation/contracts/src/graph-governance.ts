import { z } from 'zod'
import {
  CanonicalRecordKeySchema,
  IsoTimestampSchema,
  TaskScopeSchema
} from './engine-identity.js'
import { VersionedPolicyRefSchema } from './graph-definition.js'

const Key = CanonicalRecordKeySchema

export const MemoryVisibilityPolicySchema = z.object({
  taskShared: z.enum(['none', 'read', 'publish']),
  agentPrivate: z.enum(['none', 'read_write'])
}).strict()

export const NodeExecutionPolicySchema = z.object({
  policyId: Key,
  revision: z.number().int().positive(),
  authorizedModelPolicies: z.array(VersionedPolicyRefSchema).default([]),
  toolAllow: z.array(Key).default([]),
  toolDeny: z.array(Key).default([]),
  memory: MemoryVisibilityPolicySchema,
  maxAttempts: z.number().int().positive(),
  maxFanOut: z.number().int().nonnegative(),
  maxConcurrency: z.number().int().positive(),
  requiredCapabilities: z.array(Key).default([]),
  approvalRequired: z.boolean(),
  inheritToChildren: z.boolean()
}).strict()
export type NodeExecutionPolicy = z.infer<typeof NodeExecutionPolicySchema>

export const EdgeExecutionPolicySchema = z.object({
  policyId: Key,
  revision: z.number().int().positive(),
  approvalRequired: z.boolean(),
  resourceKeys: z.array(Key).default([]),
  compensationEdgeId: Key.optional()
}).strict()
export type EdgeExecutionPolicy = z.infer<typeof EdgeExecutionPolicySchema>

export const HumanCheckpointSchema = z.object({
  checkpointId: Key,
  scope: TaskScopeSchema,
  runId: Key,
  graphId: Key,
  graphRevision: z.number().int().positive(),
  nodeId: Key,
  branchId: Key.optional(),
  policyRevision: z.number().int().positive(),
  evidenceRefs: z.array(Key),
  approvalScope: z.array(Key).min(1),
  resumeEdgeId: Key,
  resolutionToken: Key,
  status: z.enum(['pending', 'allowed', 'denied', 'expired', 'consumed']),
  expiresAt: IsoTimestampSchema,
  resolvedAt: IsoTimestampSchema.optional(),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema
}).strict()
export type HumanCheckpoint = z.infer<typeof HumanCheckpointSchema>

export const ResourceClaimSchema = z.object({
  claimId: Key,
  scope: TaskScopeSchema,
  resourceKey: Key,
  mode: z.enum(['read', 'write']),
  holderId: Key,
  conflictStrategy: z.enum(['wait', 'skip', 'escalate']),
  status: z.enum(['active', 'released', 'expired']),
  lease: z.object({
    token: Key,
    fence: z.number().int().positive().optional(),
    expiresAt: IsoTimestampSchema
  }).strict(),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema
}).strict().superRefine((claim, refinement) => {
  if (claim.mode === 'write' && claim.lease.fence === undefined) {
    refinement.addIssue({ code: 'custom', message: 'write resource claims require a fence', path: ['lease', 'fence'] })
  }
})
export type ResourceClaim = z.infer<typeof ResourceClaimSchema>

export const GraphCircuitStateSchema = z.enum(['running', 'report_only', 'paused', 'retired'])
export type GraphCircuitState = z.infer<typeof GraphCircuitStateSchema>

export const GraphCircuitPolicySchema = z.object({
  policyId: Key,
  revision: z.number().int().positive(),
  reportOnlyBudgetRatio: z.number().min(0).max(1).optional(),
  pauseDuplicateRatio: z.number().min(0).max(1).optional(),
  retireFailureCount: z.number().int().positive().optional(),
  maxOutboxAgeMs: z.number().int().positive().optional()
}).strict()
export type GraphCircuitPolicy = z.infer<typeof GraphCircuitPolicySchema>

export const GraphReadinessLevelSchema = z.enum(['draft', 'observe', 'assisted', 'autonomous'])
export type GraphReadinessLevel = z.infer<typeof GraphReadinessLevelSchema>

export const GraphReadinessEvidenceSchema = z.object({
  definitionValid: z.boolean(),
  telemetryEnabled: z.boolean(),
  productionStore: z.boolean(),
  recoveryVerified: z.boolean(),
  budgetEnforced: z.boolean(),
  approvalsEnforced: z.boolean(),
  resourcesFenced: z.boolean(),
  traceCorrelation: z.boolean(),
  cancellationVerified: z.boolean(),
  circuitConfigured: z.boolean(),
  recoveryDrillAt: IsoTimestampSchema.optional()
}).strict()
export type GraphReadinessEvidence = z.infer<typeof GraphReadinessEvidenceSchema>
