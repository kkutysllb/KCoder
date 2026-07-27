import type { ModelProfile, ModelCapabilitySet } from '@qiongqi/contracts'
import type { ModelRequest, ModelStreamChunk } from './model-client.js'

export interface ModelProvider {
  readonly providerId: string
  stream(profile: ModelProfile, request: ModelRequest): AsyncIterable<ModelStreamChunk>
  capabilities(profile: ModelProfile): ModelCapabilitySet | Promise<ModelCapabilitySet>
}

export type ModelCredentialResolver = (credentialRef: string | undefined) => Promise<unknown> | unknown
