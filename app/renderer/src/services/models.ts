/**
 * Model management service (renderer side).
 *
 * The new QiongQi engine is model-neutral and exposes no HTTP CRUD for
 * models. KCoder owns model configuration through the main process, which
 * drives the engine's UserDataStore over IPC. This module is the renderer's
 * bridge to that IPC surface.
 *
 * The userId passed to every call MUST be the authenticated user's id — the
 * same one the engine uses as thread.ownerUserId. Model profiles are stored
 * per user and resolved at request time via that owner id, so a mismatch
 * would cause the runtime to never find the configured profiles.
 *
 * The shape returned by `listModels` is adapted to the `ModelEntry` form the
 * existing Settings UI expects, so call sites do not need to change.
 */
import type { ModelEntry } from './engine-api'

interface ModelProfileRecord {
  providerModel?: string
  baseUrl?: string
  endpointFormat?: string
  contextWindowTokens?: number
  supportsToolCalling?: boolean
  aliases?: string[]
  apiKey?: string
}

interface ModelListResult {
  activeModel?: string
  profiles: Record<string, ModelProfileRecord>
}

interface ModelProfileInput {
  providerModel: string
  baseUrl: string
  apiKey?: string
  endpointFormat?: 'chat_completions' | 'responses' | 'messages'
  contextWindowTokens?: number
  supportsToolCalling?: boolean
  aliases?: string[]
}

interface DiscoveredModel {
  id: string
}

interface DiscoverResult {
  models: DiscoveredModel[]
  count: number
  source: string
}

interface KcoderModelsBridge {
  list: (userId: string) => Promise<ModelListResult>
  save: (userId: string, name: string, profile: ModelProfileInput) => Promise<void>
  delete: (userId: string, name: string) => Promise<void>
  activate: (userId: string, name: string) => Promise<void>
  discover: (input: {
    baseUrl: string
    apiKey?: string
    endpointFormat?: 'chat_completions' | 'responses' | 'messages'
  }) => Promise<DiscoverResult>
}

function bridge(): KcoderModelsBridge {
  const models = (window as unknown as { kcoder?: { models?: KcoderModelsBridge } }).kcoder?.models
  if (!models) {
    throw new Error('Model bridge (window.kcoder.models) is not available')
  }
  return models
}

/** List configured models for a user, shaped as the Settings UI expects. */
export async function getModels(userId: string): Promise<{ models: ModelEntry[] }> {
  const { activeModel, profiles } = await bridge().list(userId)
  const models: ModelEntry[] = Object.entries(profiles).map(([name, profile]) => ({
    id: name,
    name,
    display_name: name,
    model: profile.providerModel ?? name,
    base_url: profile.baseUrl ?? null,
    active: activeModel === name,
    context_window_tokens: profile.contextWindowTokens ?? null,
    supports_tool_calling: profile.supportsToolCalling ?? true,
    supports_vision: false,
    supports_reasoning_effort: false
  }))
  return { models }
}

/** Create or update a named model profile for a user. */
export async function createModel(
  userId: string,
  name: string,
  profile: ModelProfileInput
): Promise<void> {
  await bridge().save(userId, name, profile)
}

/** Activate a named model profile for a user. */
export async function activateModel(userId: string, name: string): Promise<void> {
  await bridge().activate(userId, name)
}

/** Discover available models from a provider's /v1/models endpoint. */
export async function discoverModels(input: {
  baseUrl: string
  apiKey?: string
  endpointFormat?: 'chat_completions' | 'responses' | 'messages'
}): Promise<{ models: Array<{ id: string; name: string }>; count: number }> {
  const result = await bridge().discover(input)
  return {
    models: result.models.map((m) => ({ id: m.id, name: m.id })),
    count: result.count
  }
}
