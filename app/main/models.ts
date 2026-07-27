/**
 * Product-side model management.
 *
 * The new QiongQi engine is model-neutral and exposes no HTTP CRUD for
 * models. It does, however, ship a per-user `UserDataStore` that the runtime
 * consults at request time (`UserScopedModelClient` resolves each thread's
 * model from the owner's profiles). KCoder — a single-user desktop app —
 * drives that store directly from the main process and exposes it to the
 * renderer over IPC.
 *
 * This is the product adapting to the engine, not the reverse: we use the
 * engine's own storage contract rather than inventing a parallel one.
 */
import { FileUserDataStore, type UserModelProfileRecord } from '@qiongqi/http'

// KCoder is a single-user desktop app. We reuse the same fixed local-user
// id the engine uses in insecure/single-user mode so model profiles resolve
// consistently at request time.
export const LOCAL_USER_ID = 'insecure-local-user'

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

/** List the local user's model profiles. */
export async function listModels(dataDir: string): Promise<ModelListResult> {
  return getStore(dataDir).listModelProfiles(LOCAL_USER_ID)
}

/** Create or update a named model profile. */
export async function saveModel(
  dataDir: string,
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
  await getStore(dataDir).saveModelProfile(LOCAL_USER_ID, name, profile, {
    apiKey: input.apiKey
  })
}

/** Delete a named model profile. */
export async function deleteModel(dataDir: string, name: string): Promise<void> {
  await getStore(dataDir).deleteModelProfile(LOCAL_USER_ID, name)
}

/** Activate a named model profile (sets the user's activeModel). */
export async function activateModel(dataDir: string, name: string): Promise<void> {
  await getStore(dataDir).activateModelProfile(LOCAL_USER_ID, name)
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
