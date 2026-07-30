/**
 * Product-side model management.
 *
 * KCoder owns its per-user model profile storage (FileUserDataStore — a
 * local file-backed implementation). Profiles are injected into QiLin's
 * config.yaml at save/delete/activate time so the engine picks them up on
 * the next request (QiLin auto-reloads config on file signature change).
 *
 * CRITICAL: the userId MUST match the authenticated user's id so profiles
 * stay isolated per user.
 */
import { FileUserDataStore, type UserModelProfileRecord } from './user-data-store'
import { syncEngineModels } from './qilin-config-injector'

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
 * Mirrors UserModelProfileRecord; the QiLin-aligned fields (use, thinking,
 * vision, ...) come from the preset selected in the Settings UI and are
 * forwarded verbatim so the engine injection step can build a complete
 * ModelConfig entry.
 */
export interface ModelProfileInput {
  providerModel: string
  baseUrl: string
  apiKey?: string
  endpointFormat?: 'chat_completions' | 'responses' | 'messages'
  contextWindowTokens?: number
  supportsToolCalling?: boolean
  aliases?: string[]
  // ── QiLin ModelConfig 对齐字段（预设驱动）──
  use?: string
  displayName?: string
  supportsThinking?: boolean
  supportsVision?: boolean
  supportsReasoningEffort?: boolean
  whenThinkingEnabled?: Record<string, unknown>
  whenThinkingDisabled?: Record<string, unknown>
  maxTokens?: number
  temperature?: number
  useResponsesApi?: boolean
  outputVersion?: string
  pricing?: {
    currency: string
    inputPerMillion: number
    outputPerMillion: number
    inputCacheHitPerMillion?: number
  }
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
    aliases: input.aliases,
    // 透传预设驱动的 QiLin 字段（undefined 的会被 JSON.stringify 跳过）
    use: input.use,
    displayName: input.displayName,
    supportsThinking: input.supportsThinking,
    supportsVision: input.supportsVision,
    supportsReasoningEffort: input.supportsReasoningEffort,
    whenThinkingEnabled: input.whenThinkingEnabled,
    whenThinkingDisabled: input.whenThinkingDisabled,
    maxTokens: input.maxTokens,
    temperature: input.temperature,
    useResponsesApi: input.useResponsesApi,
    outputVersion: input.outputVersion,
    pricing: input.pricing
  }
  await getStore(dataDir).saveModelProfile(userId, name, profile, {
    apiKey: input.apiKey
  })

  // 注入 config.yaml — 失败不阻塞（user-data.json 已写入，下次引擎启动补偿）
  try {
    await syncEngineModels(dataDir, userId)
  } catch (err) {
    console.warn(`[KCoder] Failed to sync engine config after saving model ${name}:`, err)
  }
}

/** Delete a named model profile for a user. */
export async function deleteModel(dataDir: string, userId: string, name: string): Promise<void> {
  await getStore(dataDir).deleteModelProfile(userId, name)

  // 重新注入（删除后 models 列表更新）— 失败不阻塞
  try {
    await syncEngineModels(dataDir, userId)
  } catch (err) {
    console.warn(`[KCoder] Failed to sync engine config after deleting model ${name}:`, err)
  }
}

/** Activate a named model profile for a user (sets their activeModel). */
export async function activateModel(dataDir: string, userId: string, name: string): Promise<void> {
  await getStore(dataDir).activateModelProfile(userId, name)

  // 重新注入（active profile 决定 models[0]，即引擎默认模型）— 失败不阻塞
  try {
    await syncEngineModels(dataDir, userId)
  } catch (err) {
    console.warn(`[KCoder] Failed to sync engine config after activating model ${name}:`, err)
  }
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
