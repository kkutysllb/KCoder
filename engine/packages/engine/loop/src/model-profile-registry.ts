import {
  ModelProfileSchema,
  ModelRouteDecisionSchema,
  ModelSelectionPolicySchema,
  type ModelCapabilitySet,
  type ModelProfile,
  type ModelRouteDecision,
  type ModelSelectionPolicy
} from '@qiongqi/contracts'
import type { ModelProvider } from '@qiongqi/ports'

export class ModelProfileSelectionError extends Error {
  readonly code = 'MODEL_PROFILE_SELECTION_FAILED'
}

export class ModelProfileRegistry {
  private readonly profiles = new Map<string, Map<number, ModelProfile>>()
  private readonly providers = new Map<string, ModelProvider>()

  register(profile: ModelProfile, provider: ModelProvider): void {
    const parsed = ModelProfileSchema.parse(profile)
    if (provider.providerId !== parsed.providerId) {
      throw new ModelProfileSelectionError(`provider ${provider.providerId} does not match ${parsed.providerId}`)
    }
    const revisions = this.profiles.get(parsed.profileId) ?? new Map<number, ModelProfile>()
    const existing = revisions.get(parsed.revision)
    if (existing && JSON.stringify(existing) !== JSON.stringify(parsed)) {
      throw new ModelProfileSelectionError(`model profile revision already exists: ${parsed.profileId}@${parsed.revision}`)
    }
    revisions.set(parsed.revision, parsed)
    this.profiles.set(parsed.profileId, revisions)
    this.providers.set(profileKey(parsed.profileId, parsed.revision), provider)
  }

  list(): ModelProfile[] {
    return [...this.profiles.values()]
      .flatMap((revisions) => [...revisions.values()])
      .sort((left, right) => left.profileId.localeCompare(right.profileId) || left.revision - right.revision)
      .map((profile) => structuredClone(profile))
  }

  resolve(policyInput: ModelSelectionPolicy, required?: Partial<ModelCapabilitySet>): ModelRouteDecision {
    const policy = ModelSelectionPolicySchema.parse(policyInput)
    const authorized = new Set(policy.authorizedProfileIds)
    const candidates = (policy.candidateProfileIds ?? policy.authorizedProfileIds)
      .filter((profileId) => authorized.has(profileId))
    if (candidates.length === 0) throw new ModelProfileSelectionError('model candidates must be authorized')
    const requested = policy.preferredProfileId ?? candidates[0]
    if (!authorized.has(requested)) throw new ModelProfileSelectionError(`model profile is not authorized: ${requested}`)
    const ordered = [requested, ...candidates.filter((candidate) => candidate !== requested)]
    for (const candidate of ordered) {
      const profile = latestProfile(this.profiles.get(candidate))
      if (!profile) continue
      const differences = capabilityDifferences(profile.capabilities, required)
      if (differences.length === 0) return decision(profile, requested, false, differences)
      if ((policy.capabilityMode ?? 'strict') === 'degrade') return decision(profile, requested, true, differences)
    }
    throw new ModelProfileSelectionError(`no authorized model satisfies required capabilities for ${requested}`)
  }

  provider(profileRef: { profileId: string; revision: number }): ModelProvider {
    const profile = this.profiles.get(profileRef.profileId)?.get(profileRef.revision)
    if (!profile) throw new ModelProfileSelectionError('model profile revision is unavailable')
    const provider = this.providers.get(profileKey(profileRef.profileId, profileRef.revision))
    if (!provider) throw new ModelProfileSelectionError(`model provider is unavailable: ${profile.providerId}`)
    return provider
  }

  validatePolicy(policyInput: ModelSelectionPolicy): Array<{ profileId: string; revision: number }> {
    const policy = ModelSelectionPolicySchema.parse(policyInput)
    return policy.authorizedProfileIds.map((profileId) => {
      const profile = latestProfile(this.profiles.get(profileId))
      if (!profile) throw new ModelProfileSelectionError(`model profile is unavailable: ${profileId}`)
      return { profileId, revision: profile.revision }
    })
  }
}

function latestProfile(revisions: Map<number, ModelProfile> | undefined): ModelProfile | undefined {
  return revisions ? [...revisions.values()].sort((left, right) => right.revision - left.revision)[0] : undefined
}

function profileKey(profileId: string, revision: number): string {
  return `${profileId}\u0000${revision}`
}

function decision(profile: ModelProfile, requestedProfileId: string, degraded: boolean, differences: string[]): ModelRouteDecision {
  return ModelRouteDecisionSchema.parse({
    profileRef: { profileId: profile.profileId, revision: profile.revision },
    requestedProfileId,
    degraded,
    differences
  })
}

function capabilityDifferences(capabilities: ModelCapabilitySet, required: Partial<ModelCapabilitySet> | undefined): string[] {
  if (!required) return []
  const differences: string[] = []
  for (const key of ['streaming', 'toolCalling', 'structuredOutput', 'reasoning'] as const) {
    if (required[key] === true && capabilities[key] !== true) differences.push(key)
  }
  for (const key of ['inputModalities', 'outputModalities'] as const) {
    if (required[key] && required[key]!.some((value) => !capabilities[key].includes(value))) differences.push(key)
  }
  return differences
}
