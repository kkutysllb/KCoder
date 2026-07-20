import type {
  ModelCapabilityMetadata,
  ModelInputModality,
  ModelMessagePartSupport
} from '@qiongqi/contracts'

export type ModelContextThresholds = {
  softThreshold: number
  hardThreshold: number
}

export type ModelContextCompactionProfileConfig = {
  softRatio?: number
  hardRatio?: number
  softThreshold?: number
  hardThreshold?: number
}

export type ModelContextProfile = ModelContextThresholds & {
  canonicalModel: string
  modelIds: readonly string[]
  contextWindowTokens: number
  inputModalities: readonly ModelInputModality[]
  outputModalities: readonly ModelInputModality[]
  supportsToolCalling: boolean
  messageParts: readonly ModelMessagePartSupport[]
}

export type ModelContextProfileConfig = {
  aliases?: readonly string[]
  contextWindowTokens?: number
  contextCompaction?: ModelContextCompactionProfileConfig
  /** @deprecated Use contextCompaction.softRatio. */
  softRatio?: number
  /** @deprecated Use contextCompaction.hardRatio. */
  hardRatio?: number
  /** @deprecated Use contextCompaction.softThreshold. */
  softThreshold?: number
  /** @deprecated Use contextCompaction.hardThreshold. */
  hardThreshold?: number
  inputModalities?: readonly ModelInputModality[]
  outputModalities?: readonly ModelInputModality[]
  supportsToolCalling?: boolean
  messageParts?: readonly ModelMessagePartSupport[]
  providerModel?: string
  baseUrl?: string
  apiKey?: string
  endpointFormat?: string
}

export type ModelConfig = {
  profiles?: Record<string, ModelContextProfileConfig>
}

export type ContextCompactionConfig = {
  defaultSoftThreshold?: number
  defaultHardThreshold?: number
  summaryMode?: 'heuristic' | 'model'
  summaryTimeoutMs?: number
  summaryMaxTokens?: number
  summaryInputMaxBytes?: number
  /**
   * @deprecated Model-specific context windows and compaction thresholds belong
   * in top-level models.profiles. This field is still read for compatibility.
   */
  modelProfiles?: Record<string, ModelContextProfileConfig>
}

export type ModelProfileConfigSource = {
  models?: ModelConfig
  contextCompaction?: ContextCompactionConfig
}

type InferredModelDefaults = Pick<
  ModelContextProfile,
  'contextWindowTokens' | 'inputModalities' | 'outputModalities' | 'messageParts'
> & Partial<ModelContextThresholds>

export const DEFAULT_CONTEXT_THRESHOLDS: ModelContextThresholds = {
  softThreshold: 16_000,
  hardThreshold: 24_000
}

const DEEPSEEK_V4_CONTEXT_WINDOW_TOKENS = 1_000_000
const DEEPSEEK_V4_SOFT_THRESHOLD_RATIO = 0.98
const DEEPSEEK_V4_HARD_THRESHOLD_RATIO = 0.99
const DEFAULT_CONTEXT_WINDOW_SOFT_THRESHOLD_RATIO = 0.8
const DEFAULT_CONTEXT_WINDOW_HARD_THRESHOLD_RATIO = 0.9
const DEFAULT_MODEL_INPUT_MODALITIES: readonly ModelInputModality[] = ['text']
const DEFAULT_MODEL_OUTPUT_MODALITIES: readonly ModelInputModality[] = ['text']
const DEFAULT_MODEL_MESSAGE_PARTS: readonly ModelMessagePartSupport[] = ['text']
const DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS = DEFAULT_CONTEXT_THRESHOLDS.hardThreshold
const KNOWN_MODEL_CONTEXT_WINDOWS: ReadonlyArray<{
  pattern: RegExp
  contextWindowTokens: number
}> = [
  // OpenAI
  { pattern: /\bgpt-4o\b/, contextWindowTokens: 128_000 },
  { pattern: /\bgpt-4\.1\b/, contextWindowTokens: 1_000_000 },
  { pattern: /\bo3\b/, contextWindowTokens: 200_000 },
  { pattern: /\bo4\b/, contextWindowTokens: 200_000 },
  // Anthropic
  { pattern: /\bclaude-3\b/, contextWindowTokens: 200_000 },
  { pattern: /\bclaude-4\b/, contextWindowTokens: 200_000 },
  // Google
  { pattern: /\bgemini-1\.5\b/, contextWindowTokens: 1_000_000 },
  { pattern: /\bgemini-2\b/, contextWindowTokens: 1_000_000 },
  // Zhipu GLM (specific before generic)
  { pattern: /\bglm-5\.2\b/, contextWindowTokens: 1_000_000 },
  { pattern: /\bglm-5\b/, contextWindowTokens: 128_000 },
  { pattern: /\bglm-4\b/, contextWindowTokens: 128_000 },
  // MiniMax
  { pattern: /\bminimax-m3\b/, contextWindowTokens: 1_000_000 },
  { pattern: /\bminimax-01\b/, contextWindowTokens: 4_000_000 },
  // Xiaomi MiMo
  { pattern: /\bmimo-2\.5\b/, contextWindowTokens: 1_000_000 },
  // Alibaba Qwen (Qwen3 / QwQ support 1M)
  { pattern: /\bqwen3\b/, contextWindowTokens: 1_000_000 },
  { pattern: /\bqwq\b/, contextWindowTokens: 1_000_000 },
  { pattern: /\bqwen2\.5\b/, contextWindowTokens: 1_000_000 },
  { pattern: /\bqwen\b/, contextWindowTokens: 1_000_000 }
]
const VISION_MODEL_ID_PATTERNS: readonly RegExp[] = [
  /\bgpt-4o\b/,
  /\bgpt-4\.1\b/,
  /\bo[34]\b/,
  /\bclaude-3\b/,
  /\bclaude-3[-.]5\b/,
  /\bclaude-3[-.]7\b/,
  /\bclaude-4\b/,
  /\bgemini\b/,
  /\bglm-4v\b/,
  /\bglm-4\.5v\b/,
  /\bglm-5\.2\b/,
  /\bminimax-m3\b/,
  /\bmimo-2\.5\b/,
  /\bqwen-vl\b/,
  /\bqwen2\.5-vl\b/,
  /\bvision\b/,
  /\bvl\b/
]

export const VISION_MODEL_CAPABILITY_DEFAULTS: Pick<
  ModelContextProfile,
  'inputModalities' | 'outputModalities' | 'messageParts'
> = {
  inputModalities: ['text', 'image'],
  outputModalities: DEFAULT_MODEL_OUTPUT_MODALITIES,
  messageParts: ['text', 'image_url']
}

export const MODEL_CONTEXT_PROFILES: readonly ModelContextProfile[] = [
  deepseekV4Profile('deepseek-v4-pro', ['deepseek-v4-pro']),
  deepseekV4Profile('deepseek-v4-flash', [
    'deepseek-v4-flash',
    // Back-compat aliases currently routed by DeepSeek to v4-flash modes.
    'deepseek-chat',
    'deepseek-reasoner'
  ])
]

export function resolveModelContextProfile(
  model: string | undefined,
  profiles: readonly ModelContextProfile[] = MODEL_CONTEXT_PROFILES
): ModelContextProfile | null {
  const normalized = normalizeModelId(model)
  if (!normalized) return null
  return profiles.find((profile) =>
    profile.modelIds.some((modelId) => normalized === modelId || normalized.endsWith(`/${modelId}`))
  ) ?? null
}

export function contextThresholdsForModel(
  model: string | undefined,
  fallback: ModelContextThresholds = DEFAULT_CONTEXT_THRESHOLDS,
  profiles: readonly ModelContextProfile[] = MODEL_CONTEXT_PROFILES
): ModelContextThresholds {
  const profile = resolveModelContextProfile(model, profiles)
  if (profile) {
    return {
      softThreshold: profile.softThreshold,
      hardThreshold: profile.hardThreshold
    }
  }
  // Infer thresholds from the known context window registry so that
  // models without an explicit profile still avoid the tiny 16K/24K defaults.
  const normalized = normalizeModelId(model)
  if (normalized) {
    const known = KNOWN_MODEL_CONTEXT_WINDOWS.find((entry) => entry.pattern.test(normalized))
    if (known) {
      return {
        softThreshold: Math.floor(known.contextWindowTokens * DEFAULT_CONTEXT_WINDOW_SOFT_THRESHOLD_RATIO),
        hardThreshold: Math.floor(known.contextWindowTokens * DEFAULT_CONTEXT_WINDOW_HARD_THRESHOLD_RATIO)
      }
    }
  }
  return fallback
}

export function modelCapabilitiesForModel(
  model: string | undefined,
  profiles: readonly ModelContextProfile[] = MODEL_CONTEXT_PROFILES
): ModelCapabilityMetadata {
  const profile = resolveModelContextProfile(model, profiles)
  if (profile) {
    return {
      id: model?.trim() || profile.canonicalModel || 'auto',
      inputModalities: [...profile.inputModalities],
      outputModalities: [...profile.outputModalities],
      supportsToolCalling: profile.supportsToolCalling,
      contextWindowTokens: profile.contextWindowTokens,
      messageParts: [...profile.messageParts]
    }
  }
  // Infer capabilities from the known model registries so that models
  // without an explicit profile still get proper context window and
  // vision support metadata.
  const inferred = inferModelCapabilityDefaults(model?.trim() || 'auto')
  return {
    id: model?.trim() || 'auto',
    inputModalities: [...inferred.inputModalities],
    outputModalities: [...inferred.outputModalities],
    supportsToolCalling: true,
    contextWindowTokens: inferred.contextWindowTokens,
    messageParts: [...inferred.messageParts]
  }
}

export function modelContextProfilesFromConfig(
  config?: ContextCompactionConfig | ModelConfig | ModelProfileConfigSource
): readonly ModelContextProfile[] {
  const byCanonical = new Map<string, ModelContextProfile>()
  for (const profile of MODEL_CONTEXT_PROFILES) {
    byCanonical.set(normalizeModelId(profile.canonicalModel), profile)
  }
  const profileGroups = modelProfileGroupsFromConfig(config)
  if (profileGroups.length === 0) return [...byCanonical.values()]
  for (const profiles of profileGroups) {
    for (const [modelId, rawProfile] of Object.entries(profiles)) {
      const canonicalModel = normalizeModelId(modelId)
      if (!canonicalModel) continue
      const current = byCanonical.get(canonicalModel)
      const next = mergeModelContextProfile(canonicalModel, current, rawProfile)
      byCanonical.set(canonicalModel, next)
    }
  }
  return [...byCanonical.values()]
}

function deepseekV4Profile(
  canonicalModel: string,
  modelIds: readonly string[]
): ModelContextProfile {
  return {
    canonicalModel,
    modelIds,
    contextWindowTokens: DEEPSEEK_V4_CONTEXT_WINDOW_TOKENS,
    softThreshold: Math.floor(DEEPSEEK_V4_CONTEXT_WINDOW_TOKENS * DEEPSEEK_V4_SOFT_THRESHOLD_RATIO),
    hardThreshold: Math.floor(DEEPSEEK_V4_CONTEXT_WINDOW_TOKENS * DEEPSEEK_V4_HARD_THRESHOLD_RATIO),
    inputModalities: DEFAULT_MODEL_INPUT_MODALITIES,
    outputModalities: DEFAULT_MODEL_OUTPUT_MODALITIES,
    supportsToolCalling: true,
    messageParts: DEFAULT_MODEL_MESSAGE_PARTS
  }
}

function mergeModelContextProfile(
  canonicalModel: string,
  current: ModelContextProfile | undefined,
  input: ModelContextProfileConfig
): ModelContextProfile {
  const compaction = input.contextCompaction ?? {}
  const inferred = inferModelCapabilityDefaults(canonicalModel, [
    canonicalModel,
    ...(current?.modelIds ?? []),
    ...(input.aliases ?? []),
    ...(input.providerModel ? [input.providerModel] : [])
  ])
  const configuredContextWindowTokens =
    input.contextWindowTokens ??
    current?.contextWindowTokens ??
    inferred.contextWindowTokens
  const shouldUseInferredThresholds =
    input.contextWindowTokens === undefined &&
    current?.contextWindowTokens === undefined &&
    inferred.softThreshold !== undefined &&
    inferred.hardThreshold !== undefined
  const softThreshold =
    compaction.softThreshold ??
    input.softThreshold ??
    (shouldUseInferredThresholds ? inferred.softThreshold : undefined) ??
    thresholdFromWindow({
      contextWindowTokens: configuredContextWindowTokens,
      ratio: compaction.softRatio ?? input.softRatio,
      fallbackRatio: current
        ? current.softThreshold / current.contextWindowTokens
        : DEFAULT_CONTEXT_WINDOW_SOFT_THRESHOLD_RATIO,
      fallbackThreshold: current?.softThreshold
    })
  const hardThreshold =
    compaction.hardThreshold ??
    input.hardThreshold ??
    (shouldUseInferredThresholds ? inferred.hardThreshold : undefined) ??
    thresholdFromWindow({
      contextWindowTokens: configuredContextWindowTokens,
      ratio: compaction.hardRatio ?? input.hardRatio,
      fallbackRatio: current
        ? current.hardThreshold / current.contextWindowTokens
        : DEFAULT_CONTEXT_WINDOW_HARD_THRESHOLD_RATIO,
      fallbackThreshold: current?.hardThreshold
    })
  const contextWindowTokens =
    configuredContextWindowTokens ?? Math.max(softThreshold ?? 0, hardThreshold ?? 0)
  if (!contextWindowTokens || !softThreshold || !hardThreshold) {
    throw new Error(`model context profile "${canonicalModel}" needs a context window or thresholds`)
  }
  if (hardThreshold < softThreshold) {
    throw new Error(`model context profile "${canonicalModel}" hard threshold must be >= soft threshold`)
  }
  const modelIds = uniqueModelIds([
    canonicalModel,
    ...(current?.modelIds ?? []),
    ...(input.aliases ?? [])
  ])
  return {
    canonicalModel,
    modelIds,
    contextWindowTokens,
    softThreshold,
    hardThreshold,
    inputModalities: uniqueModelCapabilityValues(input.inputModalities ?? current?.inputModalities ?? inferred.inputModalities),
    outputModalities: uniqueModelCapabilityValues(input.outputModalities ?? current?.outputModalities ?? inferred.outputModalities),
    supportsToolCalling: input.supportsToolCalling ?? current?.supportsToolCalling ?? true,
    messageParts: uniqueModelCapabilityValues(input.messageParts ?? current?.messageParts ?? inferred.messageParts)
  }
}

export function inferModelCapabilityDefaults(
  canonicalModel: string,
  candidates: readonly string[] = [canonicalModel]
): InferredModelDefaults {
  const ids = [canonicalModel, ...candidates].map(normalizeModelId).filter(Boolean)
  const supportsVision = ids.some((id) => VISION_MODEL_ID_PATTERNS.some((pattern) => pattern.test(id)))
  const knownContextWindowTokens = KNOWN_MODEL_CONTEXT_WINDOWS.find((entry) =>
    ids.some((id) => entry.pattern.test(id))
  )?.contextWindowTokens
  const thresholds = knownContextWindowTokens
    ? {}
    : {
        softThreshold: DEFAULT_CONTEXT_THRESHOLDS.softThreshold,
        hardThreshold: DEFAULT_CONTEXT_THRESHOLDS.hardThreshold
      }
  const contextWindowTokens = knownContextWindowTokens ?? DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS
  if (!supportsVision) {
    return {
      ...thresholds,
      contextWindowTokens,
      inputModalities: DEFAULT_MODEL_INPUT_MODALITIES,
      outputModalities: DEFAULT_MODEL_OUTPUT_MODALITIES,
      messageParts: DEFAULT_MODEL_MESSAGE_PARTS
    }
  }
  return {
    ...thresholds,
    contextWindowTokens,
    ...VISION_MODEL_CAPABILITY_DEFAULTS
  }
}

function thresholdFromWindow(input: {
  contextWindowTokens: number | undefined
  ratio: number | undefined
  fallbackRatio: number
  fallbackThreshold: number | undefined
}): number | undefined {
  if (!input.contextWindowTokens) return input.fallbackThreshold
  return Math.floor(input.contextWindowTokens * (input.ratio ?? input.fallbackRatio))
}

function modelProfileGroupsFromConfig(
  config: ContextCompactionConfig | ModelConfig | ModelProfileConfigSource | undefined
): Array<Record<string, ModelContextProfileConfig>> {
  if (!config) return []
  if ('models' in config || 'contextCompaction' in config) {
    return [
      ...(config.contextCompaction?.modelProfiles ? [config.contextCompaction.modelProfiles] : []),
      ...(config.models?.profiles ? [config.models.profiles] : [])
    ]
  }
  if ('profiles' in config) {
    return config.profiles ? [config.profiles] : []
  }
  if ('modelProfiles' in config) {
    return config.modelProfiles ? [config.modelProfiles] : []
  }
  return []
}

function uniqueModelIds(values: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const normalized = normalizeModelId(value)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

function uniqueModelCapabilityValues<T extends string>(values: readonly T[]): T[] {
  const out: T[] = []
  const seen = new Set<T>()
  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

function normalizeModelId(model: string | undefined): string {
  const normalized = model?.trim().toLowerCase() ?? ''
  return normalized === 'auto' ? '' : normalized
}
