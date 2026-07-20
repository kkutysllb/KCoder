import type { ModelClient, ModelRequest, ModelStreamChunk } from '@qiongqi/ports'
import { ModelCompatClient } from '@qiongqi/adapter-model'
import type { ThreadService } from '@qiongqi/services'
import type { ModelConfig } from '@qiongqi/contracts'
import type { KWorksUserDataStore } from './kworks-user-data-store.js'

export class UserScopedModelClient implements ModelClient {
  readonly provider = 'user-scoped-model'
  readonly model: string

  constructor(private readonly input: {
    fallback: ModelClient
    threadService: ThreadService
    userDataStore: KWorksUserDataStore
    fetchImpl?: typeof fetch
    streamIdleTimeoutMs?: number
  }) {
    this.model = input.fallback.model
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    const route = await this.resolveRoute(request)
    if (!route) {
      yield* this.input.fallback.stream(request)
      return
    }
    yield* new ModelCompatClient({ ...route, ...(this.input.fetchImpl ? { fetchImpl: this.input.fetchImpl } : {}) }).stream({ ...request, model: route.model })
  }

  private async resolveRoute(request: ModelRequest): Promise<{
    baseUrl: string
    apiKey: string
    endpointFormat?: NonNullable<NonNullable<ModelConfig['profiles']>[string]>['endpointFormat']
    model: string
    streamIdleTimeoutMs?: number
  } | null> {
    const thread = await this.input.threadService.get(request.threadId)
    const userId = thread?.ownerUserId
    if (!userId) return null
    const userModels = await this.input.userDataStore.listModelProfiles(userId)
    const match = findProfile(userModels.profiles, request.model)
    if (!match) return null
    const profile = match.profile
    if (!profile.baseUrl) return null
    return {
      baseUrl: profile.baseUrl,
      apiKey: profile.apiKey ?? '',
      endpointFormat: profile.endpointFormat,
      model: profile.providerModel ?? match.name,
      ...(this.input.streamIdleTimeoutMs !== undefined ? { streamIdleTimeoutMs: this.input.streamIdleTimeoutMs } : {})
    }
  }
}

function findProfile(
  profiles: Record<string, NonNullable<NonNullable<ModelConfig['profiles']>[string]>>,
  requestedModel: string
): { name: string; profile: NonNullable<NonNullable<ModelConfig['profiles']>[string]> } | null {
  const key = requestedModel.trim()
  const normalized = key.toLowerCase()
  for (const [name, profile] of Object.entries(profiles)) {
    if (name === key || name.toLowerCase() === normalized) return { name, profile }
  }
  const secondaryMatches: Array<{ name: string; profile: NonNullable<NonNullable<ModelConfig['profiles']>[string]> }> = []
  for (const [name, profile] of Object.entries(profiles)) {
    if (profile.providerModel === key || profile.providerModel?.toLowerCase() === normalized) {
      secondaryMatches.push({ name, profile })
      continue
    }
    if ((profile.aliases ?? []).some((alias) => alias === key || alias.toLowerCase() === normalized)) {
      secondaryMatches.push({ name, profile })
    }
  }
  if (secondaryMatches.length === 1) return secondaryMatches[0]!
  return null
}
