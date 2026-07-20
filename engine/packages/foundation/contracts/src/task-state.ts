import { z } from 'zod'
import { RunIdentitySchema } from './runtime-kernel.js'

const NonEmptyString = z.string().trim().min(1)

export const TaskActionSchema = z.object({
  id: NonEmptyString,
  text: NonEmptyString,
  status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'blocked']),
  evidenceItemIds: z.array(NonEmptyString).default([])
}).strict()
export type TaskAction = z.infer<typeof TaskActionSchema>

export const TaskArtifactRefSchema = z.object({
  path: NonEmptyString,
  kind: z.enum(['file', 'artifact', 'report', 'dashboard']),
  producedByCallId: NonEmptyString.optional()
}).strict()
export type TaskArtifactRef = z.infer<typeof TaskArtifactRefSchema>

export const ToolObservationSchema = z.object({
  callId: NonEmptyString,
  toolName: NonEmptyString,
  effect: z.enum(['read', 'idempotent-write', 'non-idempotent-write']),
  capabilityClass: NonEmptyString,
  resourceKeys: z.array(NonEmptyString),
  canonicalArgumentsDigest: NonEmptyString,
  resultDigest: NonEmptyString,
  resultItemId: NonEmptyString,
  artifactRefs: z.array(TaskArtifactRefSchema),
  failed: z.boolean(),
  replayed: z.boolean()
}).strict()
export type ToolObservation = z.infer<typeof ToolObservationSchema>

export const TaskToolLedgerEntrySchema = z.object({
  callId: NonEmptyString,
  toolName: NonEmptyString,
  status: z.enum(['prepared', 'committed', 'failed', 'suspended']),
  resultDigest: NonEmptyString.optional()
}).strict()
export type TaskToolLedgerEntry = z.infer<typeof TaskToolLedgerEntrySchema>

export const TaskStateV1Schema = z.object({
  version: z.literal(1),
  identity: RunIdentitySchema,
  revision: z.number().int().positive(),
  source: z.object({
    objectiveItemId: NonEmptyString,
    sourceItemIds: z.array(NonEmptyString).min(1),
    sourceDigest: NonEmptyString
  }).strict(),
  objective: NonEmptyString,
  constraints: z.array(NonEmptyString),
  completedActions: z.array(TaskActionSchema),
  pendingActions: z.array(TaskActionSchema),
  activePlan: z.object({
    planId: NonEmptyString,
    relativePath: NonEmptyString.optional()
  }).strict().optional(),
  activeSkillIds: z.array(NonEmptyString),
  artifacts: z.array(TaskArtifactRefSchema),
  toolLedger: z.array(TaskToolLedgerEntrySchema),
  progress: z.object({
    strongDigest: NonEmptyString.optional(),
    weakDigest: NonEmptyString.optional(),
    evidenceCount: z.number().int().nonnegative(),
    artifactCount: z.number().int().nonnegative(),
    lastObservationDigests: z.array(NonEmptyString).max(64)
  }).strict().optional(),
  compaction: z.object({
    itemId: NonEmptyString,
    taskRevision: z.number().int().positive(),
    sourceDigest: NonEmptyString,
    sourceItemIds: z.array(NonEmptyString).min(1),
    replacedTokens: z.number().int().positive()
  }).strict().optional(),
  waitingFor: z.object({
    kind: z.enum(['approval', 'user_input', 'effect_verification']),
    id: NonEmptyString
  }).strict().optional(),
  migration: z.object({
    source: z.literal('legacy_thread'),
    sourceDigest: NonEmptyString,
    confidence: z.enum(['high', 'medium'])
  }).strict().optional(),
  createdAt: NonEmptyString,
  updatedAt: NonEmptyString
}).strict().superRefine((state, context) => {
  const actionIds = new Set<string>()
  for (const [field, actions] of [
    ['completedActions', state.completedActions],
    ['pendingActions', state.pendingActions]
  ] as const) {
    actions.forEach((action, index) => {
      if (actionIds.has(action.id)) {
        context.addIssue({
          code: 'custom',
          message: `duplicate task action id: ${action.id}`,
          path: [field, index, 'id']
        })
      }
      actionIds.add(action.id)
    })
  }

  const callIds = new Set<string>()
  state.toolLedger.forEach((entry, index) => {
    if (callIds.has(entry.callId)) {
      context.addIssue({
        code: 'custom',
        message: `duplicate tool ledger call id: ${entry.callId}`,
        path: ['toolLedger', index, 'callId']
      })
    }
    callIds.add(entry.callId)
  })
})
export type TaskStateV1 = z.infer<typeof TaskStateV1Schema>

export function makeTaskState(input: Omit<TaskStateV1, 'version'>): TaskStateV1 {
  return TaskStateV1Schema.parse({ version: 1, ...input })
}
