import type { ModelProfile, ModelCapabilitySet } from '@qiongqi/contracts'
import type { ModelProvider, ModelCredentialResolver, ModelRequest, ModelStreamChunk } from '@qiongqi/ports'
import { ModelCompatClient } from './model-compat-client.js'

export type ProviderCredentials = {
  baseUrl: string
  apiKey: string
  headers?: Record<string, string>
  fetchImpl?: typeof fetch
}

export class CompatModelProvider implements ModelProvider {
  constructor(
    readonly providerId: string,
    private readonly endpointFormat: 'chat_completions' | 'responses' | 'messages',
    private readonly resolveCredentials: ModelCredentialResolver
  ) {}

  async *stream(profile: ModelProfile, request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    if (profile.endpointFormat !== this.endpointFormat) {
      throw new Error(`profile ${profile.profileId} requires ${profile.endpointFormat}, provider uses ${this.endpointFormat}`)
    }
    const credentials = await this.resolveCredentials(profile.credentialRef)
    if (!isProviderCredentials(credentials)) throw new Error(`credentials unavailable for ${profile.profileId}`)
    const client = new ModelCompatClient({
      ...credentials,
      model: profile.modelId,
      endpointFormat: profile.endpointFormat
    })
    yield* client.stream({ ...request, model: profile.modelId })
  }

  capabilities(profile: ModelProfile): ModelCapabilitySet {
    return profile.capabilities
  }
}

function isProviderCredentials(value: unknown): value is ProviderCredentials {
  return Boolean(value)
    && typeof value === 'object'
    && typeof (value as ProviderCredentials).baseUrl === 'string'
    && typeof (value as ProviderCredentials).apiKey === 'string'
}
