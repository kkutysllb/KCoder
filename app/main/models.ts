/**
 * Product-side model management.
 *
 * The new QiongQi engine is model-neutral and exposes no HTTP CRUD for
 * models. It does, however, ship a per-user `UserDataStore` that the runtime
 * consults at request time (`UserScopedModelClient` resolves each thread's
 * model from the owner's profiles). KCoder drives that store directly from
 * the main process and exposes it to the renderer over IPC.
 *
 * CRITICAL: the userId MUST match the authenticated user's id, because the
 * engine keys model profiles per user and resolves them at request time via
 * `thread.ownerUserId`. A fixed local-user id would never match threads
 * created by a logged-in user, so the runtime would fall back to the startup
 * model and never see the configured profiles.
 *
 * This is the product adapting to the engine, not the reverse: we use the
 * engine's own storage contract rather than inventing a parallel one.
 */
import { FileUserDataStore, type UserModelProfileRecord } from '@qiongqi/http'

let store: FileUserDataStore | null = null

function getStore(dataDir: string): FileUserDataStore {
  if (!store) {
    // FileUserDataStore reads/writes <workspaceRoot>/system/data/user-data.json.
    // The engine's dataDir is our workspaceRoot.
    store = new FileUserDataStore({ workspaceRoot: dataDir })
  }
  return store
}

/**
 * Input shape from the renderer when creating/updating a model profile.
 * Mirrors the engine's UserModelProfileRecord but only the fields a user
 * configures through the Settings UI.
 */
export interface ModelProfileInput {
  providerModel: string
  baseUrl: string
  apiKey?: string
  endpointFormat?: 'chat_completions' | 'responses' | 'messages'
  contextWindowTokens?: number
  supportsToolCalling?: boolean
  aliases?: string[]
}

export interface ModelListResult {
  activeModel?: string
  profiles: Record<string, UserModelProfileRecord>
}

/** List a user's model profiles. */
export async function listModels(dataDir: string, userId: string): Promise<ModelListResult> {
  return getStore(dataDir).listModelProfiles(userId)
}

/** Create or update a named model profile for a user. */
export async function saveModel(
  dataDir: string,
  userId: string,
  name: string,
  input: ModelProfileInput
): Promise<void> {
  const profile: UserModelProfileRecord = {
    providerModel: input.providerModel,
    baseUrl: input.baseUrl,
    endpointFormat: input.endpointFormat,
    contextWindowTokens: input.contextWindowTokens,
    supportsToolCalling: input.supportsToolCalling,
    aliases: input.aliases
  }
  await getStore(dataDir).saveModelProfile(userId, name, profile, {
    apiKey: input.apiKey
  })
}

/** Delete a named model profile for a user. */
export async function deleteModel(dataDir: string, userId: string, name: string): Promise<void> {
  await getStore(dataDir).deleteModelProfile(userId, name)
}

/** Activate a named model profile for a user (sets their activeModel). */
export async function activateModel(dataDir: string, userId: string, name: string): Promise<void> {
  await getStore(dataDir).activateModelProfile(userId, name)
}

export interface DiscoveredModel {
  id: string
}

export interface DiscoverResult {
  models: DiscoveredModel[]
  count: number
  source: string
}

/**
 * Discover available models from a provider by querying its `/v1/models`
 * endpoint. The new engine ships no such helper (the old KWorks compat layer
 * did), so KCoder implements it directly here.
 *
 * Auth follows the OpenAI-compatible convention with an Anthropic exception:
 * Anthropic uses `x-api-key`, everyone else uses `Bearer`.
 */
export async function discoverModels(input: {
  baseUrl: string
  apiKey?: string
  endpointFormat?: 'chat_completions' | 'responses' | 'messages'
}): Promise<DiscoverResult> {
  const url = buildProviderModelsUrl(input.baseUrl)
  const headers: Record<string, string> = {
    Accept: 'application/json'
  }
  if (input.apiKey) {
    if (isAnthropicEndpoint(input.baseUrl, input.endpointFormat)) {
      headers['x-api-key'] = input.apiKey
      headers['anthropic-version'] = '2023-06-01'
    } else {
      headers.Authorization = `Bearer ${input.apiKey}`
    }
  }

  const response = await fetch(url, { headers })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Provider returned ${response.status}: ${body.slice(0, 200)}`)
  }
  const payload = (await response.json()) as { data?: Array<{ id: string }>; models?: Array<{ id: string }> }
  const items = payload.data ?? payload.models ?? []
  const models = items
    .map((item) => ({ id: String(item.id) }))
    .filter((item) => item.id.length > 0)

  return { models, count: models.length, source: url }
}

/**
 * Build the canonical `/v1/models` URL from a base URL, stripping trailing
 * version/beta path segments (e.g. `/v1`, `/beta`, `/v2`) before appending
 * `/v1/models`.
 */
function buildProviderModelsUrl(baseUrl: string): string {
  let normalized = baseUrl.trim().replace(/\/+$/, '')
  // Strip a trailing version or beta segment if present.
  normalized = normalized.replace(/\/(v\d+|beta)(\/.*)?$/i, '')
  return `${normalized}/v1/models`
}

function isAnthropicEndpoint(
  baseUrl: string,
  endpointFormat?: string
): boolean {
  if (endpointFormat === 'messages') return true
  return /anthropic\.com/i.test(baseUrl)
}
