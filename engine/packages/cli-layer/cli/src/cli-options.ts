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
 * `baseUrl` and `apiKey` may be empty so desktop/web shells can boot before
 * the user has configured a model provider. There is intentionally no built-in
 * default provider; model calls still require a user-supplied endpoint via CLI
 * flags, environment variables, config, or a user model profile.
 */
export const ServeOptionsSchema = z.object({
  configPath: z.string().optional(),
  host: z.string().default('127.0.0.1'),
  port: z.number().int().min(0).max(65_535).default(DEFAULT_SERVE_PORT),
  dataDir: z.string().min(1),
  runtimeToken: z.string().default(''),
  /** Provider API key (e.g. DeepSeek, OpenAI, vLLM). Empty is allowed so the desktop can boot before model setup. */
  apiKey: z.string().default(''),
  /** Provider base URL (OpenAI-compatible endpoint). Empty is allowed until model setup. */
  baseUrl: z.string().default(''),
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
 * Note: `apiKey` is intentionally absent here because the parser handles its
 * empty fallback together with CLI/env/config precedence.
 */
export const DEFAULT_SERVE_OPTIONS: Omit<ServeOptions, 'apiKey'> = {
  host: '127.0.0.1',
  port: DEFAULT_SERVE_PORT,
  dataDir: '',
  runtimeToken: '',
  baseUrl: '',
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

export type QiongqiRuntimeTarget = 'desktop' | 'web'

export function defaultUserWorkspaceRoot(
  env: Record<string, string | undefined> = process.env,
  _target: QiongqiRuntimeTarget = env.QIONGQI_RUNTIME_TARGET === 'desktop' ? 'desktop' : 'web'
): string {
  if (env.QIONGQI_WORKSPACE_DIR?.trim()) return env.QIONGQI_WORKSPACE_DIR.trim()
  return join(env.HOME || env.USERPROFILE || homedir(), '.qiongqi')
}

export function defaultQiongqiRuntimeDataDir(
  env: Record<string, string | undefined> = process.env,
  target: QiongqiRuntimeTarget = env.QIONGQI_RUNTIME_TARGET === 'desktop' ? 'desktop' : 'web',
  userId = 'runtime'
): string {
  return join(defaultUserWorkspaceRoot(env, target), 'users', sanitizeUserId(userId))
}

function sanitizeUserId(userId: string): string {
  const cleaned = userId.trim().replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+$/, '_')
  return cleaned || 'default'
}
