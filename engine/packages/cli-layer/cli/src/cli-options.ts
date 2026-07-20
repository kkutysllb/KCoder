import { z } from 'zod'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  ApprovalPolicySchema,
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_SANDBOX_MODE,
  SandboxModeSchema
} from '@qiongqi/contracts'
import {
  ContextCompactionConfigSchema,
  DEFAULT_QIONGQI_MODEL,
  DEFAULT_STORAGE_CONFIG,
  ModelConfigSchema,
  ObservabilityConfigSchema,
  type RuntimeTuningConfig,
  RuntimeTuningConfigSchema,
  StorageConfigSchema,
  TokenEconomyConfigSchema
} from '@qiongqi/contracts'
import {
  DEFAULT_QIONGQI_CAPABILITIES_CONFIG,
  QiongqiCapabilitiesConfig
} from '@qiongqi/contracts'
import {
  DEFAULT_MODEL_ENDPOINT_FORMAT,
  MODEL_ENDPOINT_FORMATS,
  normalizeModelEndpointFormat
} from '@qiongqi/contracts'

export const DEFAULT_SERVE_PORT = 8899
export const DEFAULT_SERVE_MODEL = DEFAULT_QIONGQI_MODEL
export const DEFAULT_SERVE_RUNTIME_TUNING: RuntimeTuningConfig = {
  modelStreamIdleTimeoutMs: 180_000,
  kernelRollout: {
    enabled: true,
    defaultMode: 'kernel_v3'
  }
}

/**
 * Built-in agent presets available via `--preset`.
 *
 * - `coding` — injects the coding-focused system prompt and pinned
 *   constraints from `@qiongqi/preset-coding`. This is the default
 *   because the CLI's primary use case is driving an IDE coding
 *   assistant.
 * - `generic` — uses the plain Qiongqi system prompt with no
 *   industry-specific specialisation. Use this when you want a
 *   domain-neutral agent or when you supply your own `systemPrompt`.
 */
export const SERVE_PRESETS = ['coding', 'generic'] as const
export type ServePreset = (typeof SERVE_PRESETS)[number]

/**
 * Validated CLI options for `qiongqi serve`.
 *
 * `host` and `port` decide the bind address. `dataDir` is the on-disk root
 * for thread JSONL logs and indexes. `runtimeToken` is the bearer token
 * the GUI must send for `/v1/*` requests. The optional `insecure` flag
 * disables the token check (only allowed when the GUI is local).
 *
 * `baseUrl` and `apiKey` are **required** — the CLI intentionally has no
 * built-in default model provider. Stage 1.5 removed the legacy
 * `https://api.deepseek.com/beta` default so the framework stays
 * provider-neutral. Users must supply them via CLI flags, environment
 * variables (`QIONGQI_BASE_URL` / `QIONGQI_API_KEY`), or a config file.
 */
export const ServeOptionsSchema = z.object({
  configPath: z.string().optional(),
  host: z.string().default('127.0.0.1'),
  port: z.number().int().min(0).max(65_535).default(DEFAULT_SERVE_PORT),
  dataDir: z.string().min(1),
  runtimeToken: z.string().default(''),
  /** Provider API key (e.g. DeepSeek, OpenAI, vLLM). Empty is allowed so the desktop can boot before model setup. */
  apiKey: z.string().default(''),
  /** Provider base URL (OpenAI-compatible endpoint). Required. */
  baseUrl: z.string().min(1),
  endpointFormat: z.preprocess(normalizeModelEndpointFormat, z.enum(MODEL_ENDPOINT_FORMATS)).default(DEFAULT_MODEL_ENDPOINT_FORMAT),
  model: z.string().default(DEFAULT_SERVE_MODEL),
  approvalPolicy: ApprovalPolicySchema.default(DEFAULT_APPROVAL_POLICY),
  sandboxMode: SandboxModeSchema.default(DEFAULT_SANDBOX_MODE),
  tokenEconomyMode: z.boolean().default(false),
  tokenEconomy: TokenEconomyConfigSchema.optional(),
  insecure: z.boolean().default(false),
  storage: StorageConfigSchema.default(DEFAULT_STORAGE_CONFIG),
  models: ModelConfigSchema.optional(),
  contextCompaction: ContextCompactionConfigSchema.optional(),
  runtime: RuntimeTuningConfigSchema.default(DEFAULT_SERVE_RUNTIME_TUNING),
  observability: ObservabilityConfigSchema.optional(),
  capabilities: QiongqiCapabilitiesConfig.default(DEFAULT_QIONGQI_CAPABILITIES_CONFIG),
  /**
   * Which built-in preset to use for the system prompt and pinned
   * constraints. Defaults to `'coding'`. See {@link SERVE_PRESETS}.
   */
  preset: z.enum(SERVE_PRESETS).default('coding')
})
export type ServeOptions = z.infer<typeof ServeOptionsSchema>

/**
 * Default values for fields that have schema-level defaults.
 *
 * Note: `baseUrl` and `apiKey` are intentionally absent — they are
 * required and have no defaults. See {@link ServeOptionsSchema}.
 */
export const DEFAULT_SERVE_OPTIONS: Omit<ServeOptions, 'baseUrl' | 'apiKey'> = {
  host: '127.0.0.1',
  port: DEFAULT_SERVE_PORT,
  dataDir: '',
  runtimeToken: '',
  endpointFormat: DEFAULT_MODEL_ENDPOINT_FORMAT,
  model: DEFAULT_SERVE_MODEL,
  approvalPolicy: DEFAULT_APPROVAL_POLICY,
  sandboxMode: DEFAULT_SANDBOX_MODE,
  tokenEconomyMode: false,
  insecure: false,
  storage: DEFAULT_STORAGE_CONFIG,
  runtime: DEFAULT_SERVE_RUNTIME_TUNING,
  capabilities: DEFAULT_QIONGQI_CAPABILITIES_CONFIG,
  preset: 'coding'
}

export type KWorksRuntimeTarget = 'desktop' | 'web'

export function defaultKWorksWorkspaceRoot(
  env: Record<string, string | undefined> = process.env,
  target: KWorksRuntimeTarget = env.KWORKS_RUNTIME_TARGET === 'desktop' ? 'desktop' : 'web'
): string {
  if (env.KWORKS_WORKSPACE_DIR?.trim()) return env.KWORKS_WORKSPACE_DIR.trim()
  return join(env.HOME || env.USERPROFILE || homedir(), target === 'desktop' ? '.kworks-workspace' : '.kworks-workspace-web')
}

export function defaultKWorksRuntimeDataDir(
  env: Record<string, string | undefined> = process.env,
  target: KWorksRuntimeTarget = env.KWORKS_RUNTIME_TARGET === 'desktop' ? 'desktop' : 'web',
  userId = 'runtime'
): string {
  return join(defaultKWorksWorkspaceRoot(env, target), 'users', sanitizeKWorksUserId(userId))
}

function sanitizeKWorksUserId(userId: string): string {
  const cleaned = userId.trim().replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+$/, '_')
  return cleaned || 'default'
}
