import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import {
  ApprovalPolicySchema,
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_SANDBOX_MODE,
  SandboxModeSchema
} from './policy.js'
import {
  DEFAULT_QIONGQI_CAPABILITIES_CONFIG,
  QiongqiCapabilitiesConfig,
  ModelInputModality,
  ModelMessagePartSupport
} from './capabilities.js'
import {
  DEFAULT_MODEL_ENDPOINT_FORMAT,
  MODEL_ENDPOINT_FORMATS,
  normalizeModelEndpointFormat
} from './model-endpoint-format.js'
import { AgentGraphSchema } from './multi-agent-runtime.js'

export const QIONGQI_CONFIG_FILENAME = 'config.json'
export const DEFAULT_QIONGQI_MODEL = 'deepseek-v4-pro'

const PositiveInt = z.number().int().positive()
const PositiveRatio = z.number().positive().max(1)
const NonNegativeRatio = z.number().min(0).max(1)
const NonEmptyString = z.string().trim().min(1)

export const ModelContextCompactionProfileConfigSchema = z
  .object({
    softRatio: PositiveRatio.optional(),
    hardRatio: PositiveRatio.optional(),
    softThreshold: PositiveInt.optional(),
    hardThreshold: PositiveInt.optional()
  })
  .strict()
  .superRefine((profile, ctx) => {
    if (
      profile.softThreshold !== undefined &&
      profile.hardThreshold !== undefined &&
      profile.hardThreshold < profile.softThreshold
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'hardThreshold must be greater than or equal to softThreshold'
      })
    }
  })

export const ModelContextProfileConfigSchema = z
  .object({
    aliases: z.array(z.string().min(1)).optional(),
    contextWindowTokens: PositiveInt.optional(),
    contextCompaction: ModelContextCompactionProfileConfigSchema.optional(),
    softRatio: PositiveRatio.optional(),
    hardRatio: PositiveRatio.optional(),
    softThreshold: PositiveInt.optional(),
    hardThreshold: PositiveInt.optional(),
    inputModalities: z.array(ModelInputModality).optional(),
    outputModalities: z.array(ModelInputModality).optional(),
    supportsToolCalling: z.boolean().optional(),
    messageParts: z.array(ModelMessagePartSupport).optional(),
    providerModel: z.string().min(1).optional(),
    baseUrl: z.string().min(1).optional(),
    apiKey: z.string().optional(),
    endpointFormat: z.preprocess(
      normalizeModelEndpointFormat,
      z.enum(MODEL_ENDPOINT_FORMATS)
    ).optional()
  })
  .strict()
  .superRefine((profile, ctx) => {
    const hasRatio =
      profile.softRatio !== undefined ||
      profile.hardRatio !== undefined ||
      profile.contextCompaction?.softRatio !== undefined ||
      profile.contextCompaction?.hardRatio !== undefined
    if (hasRatio && profile.contextWindowTokens === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'softRatio and hardRatio require contextWindowTokens'
      })
    }
    const softThreshold = profile.contextCompaction?.softThreshold ?? profile.softThreshold
    const hardThreshold = profile.contextCompaction?.hardThreshold ?? profile.hardThreshold
    if (softThreshold !== undefined && hardThreshold !== undefined && hardThreshold < softThreshold) {
      ctx.addIssue({
        code: 'custom',
        message: 'hardThreshold must be greater than or equal to softThreshold'
      })
    }
  })

export const ModelConfigSchema = z
  .object({
    profiles: z.record(z.string().min(1), ModelContextProfileConfigSchema).optional()
  })
  .strict()

export const ContextCompactionConfigSchema = z
  .object({
    defaultSoftThreshold: PositiveInt.optional(),
    defaultHardThreshold: PositiveInt.optional(),
    summaryMode: z.enum(['heuristic', 'model']).optional(),
    summaryTimeoutMs: PositiveInt.optional(),
    summaryMaxTokens: PositiveInt.optional(),
    summaryInputMaxBytes: PositiveInt.optional(),
    modelProfiles: z.record(z.string().min(1), ModelContextProfileConfigSchema).optional()
  })
  .strict()
  .superRefine((config, ctx) => {
    if (
      config.defaultSoftThreshold !== undefined &&
      config.defaultHardThreshold !== undefined &&
      config.defaultHardThreshold < config.defaultSoftThreshold
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'defaultHardThreshold must be greater than or equal to defaultSoftThreshold'
      })
    }
  })

export const RuntimeTuningConfigSchema = z
  .object({
    orchestrationMode: z.enum(['classic', 'evented', 'evented_v2', 'kernel_v3']).optional(),
    kernelRollout: z.object({
      enabled: z.boolean().optional(),
      defaultMode: z.enum(['classic', 'kernel_v3']).optional(),
      fallbackBeforeEffect: z.boolean().optional()
    }).strict().optional(),
    eventedV2Rollout: z.object({
      stage: z.enum(['off', 'shadow', 'canary', 'default']).optional(),
      canaryPercent: z.number().int().min(0).max(100).optional(),
      shadowSamplePercent: z.number().int().min(0).max(100).optional(),
      fallbackMode: z.enum(['classic', 'kernel_v3']).optional(),
      autoFallback: z.object({
        enabled: z.boolean().optional(),
        windowSize: PositiveInt.optional(),
        minRuns: PositiveInt.optional(),
        failureRateThreshold: NonNegativeRatio.optional(),
        consecutiveFailures: PositiveInt.optional(),
        cooldownMs: PositiveInt.optional()
      }).strict().optional()
    }).strict().optional(),
    eventedV2OutboxReconciler: z.object({
      enabled: z.boolean().optional(),
      intervalMs: PositiveInt.optional()
    }).strict().optional(),
    eventedV2AgentGraph: AgentGraphSchema.optional(),
    eventedV2AgentPeers: z.record(z.string().min(1), z.string().min(1)).optional(),
    eventedV2RemoteAgent: z.object({
      timeoutMs: PositiveInt.optional(),
      leaseTtlMs: PositiveInt.optional(),
      workerId: z.string().min(1).optional(),
      heartbeatTtlMs: PositiveInt.optional(),
      scheduler: z.object({
        enabled: z.boolean().optional(),
        intervalMs: PositiveInt.optional()
      }).strict().optional(),
      compensation: z.object({
        statusConditions: z.object({
          completed: NonEmptyString.optional(),
          failed: NonEmptyString.optional(),
          aborted: NonEmptyString.optional()
        }).strict().optional()
      }).strict().optional()
    }).strict().optional(),
    modelStreamIdleTimeoutMs: PositiveInt.optional(),
    toolStorm: z
      .object({
        enabled: z.boolean().optional(),
        windowSize: PositiveInt.optional(),
        threshold: z.number().int().min(2).optional()
      })
      .strict()
      .optional(),
    toolArgumentRepair: z
      .object({
        maxStringBytes: PositiveInt.optional()
      })
      .strict()
      .optional()
  })
  .strict()

export const RequestHistoryHygieneConfigSchema = z
  .object({
    maxToolResultLines: PositiveInt.optional(),
    maxToolResultBytes: PositiveInt.optional(),
    maxToolResultTokens: PositiveInt.optional(),
    maxToolArgumentStringBytes: PositiveInt.optional(),
    maxToolArgumentStringTokens: PositiveInt.optional(),
    maxArrayItems: PositiveInt.optional()
  })
  .strict()

export const TokenEconomyConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    compressToolDescriptions: z.boolean().optional(),
    compressToolResults: z.boolean().optional(),
    conciseResponses: z.boolean().optional(),
    historyHygiene: RequestHistoryHygieneConfigSchema.optional()
  })
  .strict()

export const StorageConfigSchema = z
  .object({
    backend: z.enum(['hybrid', 'file']).default('hybrid'),
    sqlitePath: z.string().min(1).optional()
  })
  .strict()

export const OpenTelemetryConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    serviceName: z.string().min(1).optional(),
    exporter: z.enum(['otlp-http', 'console', 'none']).optional(),
    endpoint: z.string().url().optional(),
    headers: z.record(z.string().min(1), z.string()).optional()
  })
  .strict()

export const ObservabilityConfigSchema = z
  .object({
    openTelemetry: OpenTelemetryConfigSchema.optional()
  })
  .strict()

export const DEFAULT_STORAGE_CONFIG: StorageConfig = {
  backend: 'hybrid'
}

export const QiongqiServeConfigSchema = z
  .object({
    host: z.string().optional(),
    port: z.number().int().min(0).max(65_535).optional(),
    dataDir: z.string().min(1).optional(),
    runtimeToken: z.string().optional(),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    endpointFormat: z.preprocess(
      normalizeModelEndpointFormat,
      z.enum(MODEL_ENDPOINT_FORMATS)
    ).default(DEFAULT_MODEL_ENDPOINT_FORMAT).optional(),
    model: z.string().min(1).optional(),
    approvalPolicy: ApprovalPolicySchema.default(DEFAULT_APPROVAL_POLICY).optional(),
    sandboxMode: SandboxModeSchema.default(DEFAULT_SANDBOX_MODE).optional(),
    tokenEconomyMode: z.boolean().optional(),
    tokenEconomy: TokenEconomyConfigSchema.optional(),
    insecure: z.boolean().optional(),
    storage: StorageConfigSchema.optional(),
    observability: ObservabilityConfigSchema.optional()
  })
  .strict()

export const QiongqiConfigSchema = z
  .object({
    serve: QiongqiServeConfigSchema.optional(),
    models: ModelConfigSchema.optional(),
    contextCompaction: ContextCompactionConfigSchema.optional(),
    runtime: RuntimeTuningConfigSchema.optional(),
    capabilities: QiongqiCapabilitiesConfig.default(DEFAULT_QIONGQI_CAPABILITIES_CONFIG)
  })
  .strict()

export type QiongqiConfig = z.infer<typeof QiongqiConfigSchema>
export type QiongqiServeConfig = z.infer<typeof QiongqiServeConfigSchema>
export type ModelConfig = z.infer<typeof ModelConfigSchema>
export type ContextCompactionConfig = z.infer<typeof ContextCompactionConfigSchema>
export type RuntimeTuningConfig = z.infer<typeof RuntimeTuningConfigSchema>
export type KernelRolloutConfig = NonNullable<RuntimeTuningConfig['kernelRollout']>
export type TokenEconomyConfig = z.infer<typeof TokenEconomyConfigSchema>
export type StorageConfig = z.infer<typeof StorageConfigSchema>
export type OpenTelemetryConfig = z.infer<typeof OpenTelemetryConfigSchema>
export type ObservabilityConfig = z.infer<typeof ObservabilityConfigSchema>

export type LoadedQiongqiConfig = {
  path: string
  config: QiongqiConfig
}

export function readQiongqiConfigFile(path: string): LoadedQiongqiConfig {
  const resolvedPath = expandHomePath(path)
  const text = readFileSync(resolvedPath, 'utf8')
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to parse Qiongqi config JSON at ${resolvedPath}: ${message}`)
  }
  const parsed = QiongqiConfigSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error(
      `Invalid Qiongqi config at ${resolvedPath}: ${JSON.stringify(parsed.error.issues, null, 2)}`
    )
  }
  return { path: resolvedPath, config: parsed.data }
}

export function readOptionalQiongqiConfigFile(path: string | undefined): LoadedQiongqiConfig | null {
  if (!path) return null
  const resolvedPath = expandHomePath(path)
  if (!existsSync(resolvedPath)) return null
  return readQiongqiConfigFile(resolvedPath)
}

export function qiongqiConfigPathForDataDir(dataDir: string | undefined): string | undefined {
  const trimmed = dataDir?.trim()
  if (!trimmed) return undefined
  return join(expandHomePath(trimmed), QIONGQI_CONFIG_FILENAME)
}

export function expandHomePath(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) {
    return join(homedir(), path.slice(2).replace(/\\/g, '/'))
  }
  return path
}
