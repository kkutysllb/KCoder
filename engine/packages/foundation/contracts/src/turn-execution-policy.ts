import { createHash } from 'node:crypto'
import { z } from 'zod'

const NonEmptyString = z.string().trim().min(1)
const Sha256Digest = z.string().regex(/^[a-f0-9]{64}$/)
const CanonicalStringList = z.array(NonEmptyString).default([])

export const OutputValidatorRefSchema = z.object({
  validatorId: NonEmptyString,
  revision: z.number().int().positive(),
  digest: Sha256Digest
}).strict()
export type OutputValidatorRef = z.infer<typeof OutputValidatorRefSchema>

export const TurnExecutionPolicyRefSchema = z.object({
  policyId: NonEmptyString,
  revision: z.number().int().positive(),
  digest: Sha256Digest
}).strict()
export type TurnExecutionPolicyRef = z.infer<typeof TurnExecutionPolicyRefSchema>

export const TurnExecutionPolicyInputSchema = z.object({
  policyId: NonEmptyString,
  revision: z.number().int().positive(),
  skills: z.object({
    allowedSkillIds: CanonicalStringList,
    requiredSkillIds: CanonicalStringList
  }).strict(),
  tools: z.object({
    allowedToolNames: CanonicalStringList
  }).strict(),
  output: z.object({
    validatorRef: OutputValidatorRefSchema
  }).strict().optional()
}).strict().superRefine((policy, context) => {
  const allowed = new Set(policy.skills.allowedSkillIds)
  for (const skillId of policy.skills.requiredSkillIds) {
    if (!allowed.has(skillId)) {
      context.addIssue({
        code: 'custom',
        path: ['skills', 'requiredSkillIds'],
        message: `required skill ${skillId} must be included in allowedSkillIds`
      })
    }
  }
})
export type TurnExecutionPolicyInput = z.input<typeof TurnExecutionPolicyInputSchema>

export const TurnExecutionPolicySnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  policyId: NonEmptyString,
  revision: z.number().int().positive(),
  skills: z.object({
    allowedSkillIds: z.array(NonEmptyString),
    requiredSkillIds: z.array(NonEmptyString)
  }).strict(),
  tools: z.object({
    allowedToolNames: z.array(NonEmptyString)
  }).strict(),
  output: z.object({
    validatorRef: OutputValidatorRefSchema
  }).strict().optional(),
  digest: Sha256Digest
}).strict()
export type TurnExecutionPolicySnapshot = z.infer<typeof TurnExecutionPolicySnapshotSchema>

export const TurnOutputValidationRecordSchema = z.object({
  validatorRef: OutputValidatorRefSchema,
  status: z.enum(['accepted', 'rejected', 'error']),
  validatedAt: NonEmptyString,
  reason: NonEmptyString.optional()
}).strict()
export type TurnOutputValidationRecord = z.infer<typeof TurnOutputValidationRecordSchema>

export function createTurnExecutionPolicySnapshot(
  input: TurnExecutionPolicyInput
): TurnExecutionPolicySnapshot {
  const parsed = TurnExecutionPolicyInputSchema.parse(input)
  const canonical = {
    schemaVersion: 1 as const,
    policyId: parsed.policyId,
    revision: parsed.revision,
    skills: {
      allowedSkillIds: canonicalStrings(parsed.skills.allowedSkillIds),
      requiredSkillIds: canonicalStrings(parsed.skills.requiredSkillIds)
    },
    tools: {
      allowedToolNames: canonicalStrings(parsed.tools.allowedToolNames)
    },
    ...(parsed.output ? { output: parsed.output } : {})
  }
  return TurnExecutionPolicySnapshotSchema.parse({
    ...canonical,
    digest: createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
  })
}

export function turnExecutionPolicyRef(
  snapshot: TurnExecutionPolicySnapshot
): TurnExecutionPolicyRef {
  const parsed = TurnExecutionPolicySnapshotSchema.parse(snapshot)
  return TurnExecutionPolicyRefSchema.parse({
    policyId: parsed.policyId,
    revision: parsed.revision,
    digest: parsed.digest
  })
}

function canonicalStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort()
}
