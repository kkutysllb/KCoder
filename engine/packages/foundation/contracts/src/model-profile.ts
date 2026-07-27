import { z } from 'zod'

const NonEmpty = z.string().trim().min(1)

export const ModelCapabilitySetSchema = z.object({
  streaming: z.boolean(),
  toolCalling: z.boolean(),
  structuredOutput: z.boolean(),
  reasoning: z.boolean(),
  inputModalities: z.array(NonEmpty),
  outputModalities: z.array(NonEmpty)
}).strict()
export type ModelCapabilitySet = z.infer<typeof ModelCapabilitySetSchema>

export const ModelProfileSchema = z.object({
  profileId: NonEmpty,
  revision: z.number().int().nonnegative(),
  providerId: NonEmpty,
  modelId: NonEmpty,
  endpointFormat: z.enum(['chat_completions', 'responses', 'messages']),
  credentialRef: NonEmpty.optional(),
  capabilities: ModelCapabilitySetSchema,
  metadata: z.record(NonEmpty, z.string()).optional()
}).strict()
export type ModelProfile = z.infer<typeof ModelProfileSchema>

export const ModelSelectionPolicySchema = z.object({
  authorizedProfileIds: z.array(NonEmpty).min(1),
  preferredProfileId: NonEmpty.optional(),
  candidateProfileIds: z.array(NonEmpty).optional(),
  capabilityMode: z.enum(['strict', 'degrade']).optional()
}).strict()
export type ModelSelectionPolicy = z.output<typeof ModelSelectionPolicySchema>

export const ModelRouteDecisionSchema = z.object({
  profileRef: z.object({ profileId: NonEmpty, revision: z.number().int().nonnegative() }).strict(),
  requestedProfileId: NonEmpty,
  degraded: z.boolean(),
  differences: z.array(NonEmpty)
}).strict()
export type ModelRouteDecision = z.infer<typeof ModelRouteDecisionSchema>
