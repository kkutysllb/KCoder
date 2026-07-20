import { z } from 'zod'
import { basename, join } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'
import {
  DEFAULT_SERVE_PORT,
  DEFAULT_SERVE_OPTIONS,
  defaultKWorksRuntimeDataDir,
  ServeOptionsSchema,
  type ServeOptions
} from './cli-options.js'
import {
  qiongqiConfigPathForDataDir,
  readQiongqiConfigFile,
  readOptionalQiongqiConfigFile,
  type LoadedQiongqiConfig
} from '@qiongqi/contracts'

/**
 * Parse the `qiongqi serve` command line into validated options.
 *
 * Supports `--key=value` and `--key value` shapes, repeating flags
 * override defaults. Returns the parsed and validated options. Throws
 * a ZodError when the value is malformed.
 */
export function parseServeOptions(
  argv: readonly string[],
  env: Record<string, string | undefined> = {}
): ServeOptions {
  const raw: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const eqIndex = token.indexOf('=')
    const key = eqIndex >= 0 ? token.slice(2, eqIndex) : token.slice(2)
    let value: string | boolean = 'true'
    if (eqIndex >= 0) {
      value = token.slice(eqIndex + 1)
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      value = argv[i + 1]
      i += 1
    }
    raw[key] = value
  }
  const loadedConfig = loadServeConfig(raw, env)
  const configServe = loadedConfig?.config.serve ?? {}
  const portEnv = env.QIONGQI_PORT
  const tokenEconomyMode =
    booleanFlag(raw, 'token-economy') ??
    booleanFlag(raw, 'token-economy-mode') ??
    booleanFlag(raw, 'tokenEconomyMode') ??
    envBoolean(env.QIONGQI_TOKEN_ECONOMY_MODE) ??
    configServe.tokenEconomy?.enabled ??
    configServe.tokenEconomyMode ??
    DEFAULT_SERVE_OPTIONS.tokenEconomyMode
  const merged: Record<string, unknown> = {
    ...DEFAULT_SERVE_OPTIONS,
    ...(loadedConfig ? { configPath: loadedConfig.path } : {}),
    host:
      typeof raw.host === 'string'
        ? raw.host
        : env.QIONGQI_HOST ?? configServe.host ?? DEFAULT_SERVE_OPTIONS.host,
    port:
      typeof raw.port === 'string'
        ? Number(raw.port)
        : portEnv
          ? Number(portEnv)
          : configServe.port ?? DEFAULT_SERVE_OPTIONS.port,
    dataDir:
      typeof raw['data-dir'] === 'string'
        ? raw['data-dir']
        : typeof raw.dataDir === 'string'
          ? raw.dataDir
          : env.QIONGQI_DATA_DIR ??
            configServe.dataDir ??
            defaultKWorksRuntimeDataDir(env),
    runtimeToken:
      typeof raw['runtime-token'] === 'string'
        ? raw['runtime-token']
        : typeof raw.runtimeToken === 'string'
          ? raw.runtimeToken
          : env.QIONGQI_RUNTIME_TOKEN ??
            configServe.runtimeToken ??
            DEFAULT_SERVE_OPTIONS.runtimeToken,
    apiKey: resolveApiKey(raw, env, configServe) ?? '',
    baseUrl: resolveBaseUrl(raw, env, configServe),
    endpointFormat:
      typeof raw['endpoint-format'] === 'string'
        ? raw['endpoint-format'] as ServeOptions['endpointFormat']
        : typeof raw.endpointFormat === 'string'
          ? raw.endpointFormat as ServeOptions['endpointFormat']
          : env.QIONGQI_ENDPOINT_FORMAT as ServeOptions['endpointFormat'] | undefined ??
            configServe.endpointFormat ??
            DEFAULT_SERVE_OPTIONS.endpointFormat,
    model:
      typeof raw.model === 'string'
        ? raw.model
        : env.QIONGQI_MODEL ?? configServe.model ?? DEFAULT_SERVE_OPTIONS.model,
    approvalPolicy:
      typeof raw['approval-policy'] === 'string'
        ? (raw['approval-policy'] as ServeOptions['approvalPolicy'])
        : configServe.approvalPolicy ?? DEFAULT_SERVE_OPTIONS.approvalPolicy,
    sandboxMode:
      typeof raw['sandbox-mode'] === 'string'
        ? (raw['sandbox-mode'] as ServeOptions['sandboxMode'])
        : configServe.sandboxMode ?? DEFAULT_SERVE_OPTIONS.sandboxMode,
    tokenEconomyMode,
    tokenEconomy: {
      ...(configServe.tokenEconomy ?? {}),
      enabled: tokenEconomyMode
    },
    insecure:
      typeof raw.insecure === 'string'
        ? raw.insecure !== 'false' && raw.insecure !== '0'
        : raw.insecure === true
          ? true
          : configServe.insecure ?? DEFAULT_SERVE_OPTIONS.insecure,
    storage: {
      backend:
        storageBackendFromRawOrEnv(raw, env) ??
        configServe.storage?.backend ??
        DEFAULT_SERVE_OPTIONS.storage.backend,
      ...((storageSqlitePathFromRawOrEnv(raw, env) ?? configServe.storage?.sqlitePath)
        ? { sqlitePath: storageSqlitePathFromRawOrEnv(raw, env) ?? configServe.storage?.sqlitePath }
        : {})
    },
    models: loadedConfig?.config.models,
    contextCompaction: loadedConfig?.config.contextCompaction,
    runtime: {
      ...(DEFAULT_SERVE_OPTIONS.runtime ?? {}),
      ...(loadedConfig?.config.runtime ?? {})
    },
    observability: observabilityFromConfigOrEnv(configServe, env),
    capabilities: capabilitiesFromConfigOrEnv(loadedConfig?.config.capabilities, env),
    preset:
      typeof raw.preset === 'string'
        ? (raw.preset as ServeOptions['preset'])
        : env.QIONGQI_PRESET as ServeOptions['preset'] | undefined ??
          DEFAULT_SERVE_OPTIONS.preset
  }
  return ServeOptionsSchema.parse(merged)
}

/**
 * Validate a pre-constructed options object. Used by tests and by the
 * main process when Qiongqi is started programmatically.
 */
export function validateServeOptions(input: unknown): ServeOptions {
  return ServeOptionsSchema.parse(input)
}

export function qiongqiRuntimeListeningMessage(host: string, port: number): string {
  return `qiongqi runtime listening on http://${host}:${port}`
}

export function qiongqiRuntimeStartupInfo({
  host,
  port,
  info
}: {
  host: string
  port: number
  info: {
    configPath?: string
    dataDir: string
    model?: string
    approvalPolicy?: string
    insecure?: boolean
    startedAt: string
    pid?: number
    [key: string]: unknown
  }
}): Record<string, unknown> {
  return {
    service: 'qiongqi',
    mode: 'serve',
    host,
    port,
    configPath: info.configPath,
    dataDir: info.dataDir,
    approvalPolicy: info.approvalPolicy,
    insecure: info.insecure,
    startedAt: info.startedAt,
    pid: info.pid,
    message: qiongqiRuntimeListeningMessage(host, port)
  }
}

/** Human-readable usage string, used by the CLI when no args are given. */
export const SERVE_USAGE = `qiongqi serve [options]

Options:
  --config <path>          JSON config file (default: {data-dir}/config.json when present)
  --host <host>            Bind address (default 127.0.0.1)
  --port <port>            HTTP port (default ${DEFAULT_SERVE_PORT})
  --data-dir <path>        Root directory for threads, events, and usage
  --runtime-token <token>  Bearer token for /v1/* requests
  --api-key <key>          Provider API key (required, or set QIONGQI_API_KEY)
  --base-url <url>         Provider base URL (required, or set QIONGQI_BASE_URL)
  --endpoint-format <f>    chat_completions | responses | messages
  --model <model>          Default model id
  --preset <name>          Agent preset: coding (default) | generic
  --approval-policy <p>    on-request | untrusted | never | auto | suggest
  --sandbox-mode <mode>    read-only | workspace-write | danger-full-access | external-sandbox
  --token-economy          Compress safe tool context before model calls
  --insecure               Disable bearer token check (local dev only)
  --storage-backend <b>    hybrid | file (default hybrid)
  --sqlite-path <path>     SQLite index path for hybrid storage
`

export const ServeExitCode = {
  ok: 0,
  usage: 64,
  config: 78,
  runtime: 70
} as const

export type ServeExitCode = (typeof ServeExitCode)[keyof typeof ServeExitCode]

/**
 * Convenience helper for CLI entrypoints: parse argv and return the final options or a
 * structured error.
 */
export type ParseServeResult =
  | { ok: true; options: ServeOptions }
  | { ok: false; exitCode: ServeExitCode; message: string; issues?: unknown }

export function parseServeOptionsSafe(
  argv: readonly string[],
  env: Record<string, string | undefined> = {}
): ParseServeResult {
  try {
    const parsed = parseServeOptions(argv, env)
    return { ok: true, options: parsed }
  } catch (error) {
    if (error instanceof z.ZodError) {
      const requiredFields = error.issues.filter(
        (issue) =>
          issue.code === 'invalid_type' &&
          issue.path[0] === 'baseUrl'
      )
      if (requiredFields.length > 0) {
        const labels = requiredFields.map(() => '--base-url')
        return {
          ok: false,
          exitCode: ServeExitCode.config,
          message: `serve requires ${labels.join(' and ')} <value> (pass the flag, set QIONGQI_API_KEY / QIONGQI_BASE_URL, or use a config file)`
        }
      }
      return {
        ok: false,
        exitCode: ServeExitCode.config,
        message: 'invalid serve options',
        issues: error.issues
      }
    }
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, exitCode: ServeExitCode.config, message }
  }
}

function capabilitiesFromConfigOrEnv(
  config: ServeOptions['capabilities'] | undefined,
  env: Record<string, string | undefined>
): ServeOptions['capabilities'] {
  const base = config ?? DEFAULT_SERVE_OPTIONS.capabilities
  const skillRoots = kworksSkillRootsFromEnv(env)
  if (skillRoots.length === 0) return base
  return {
    ...base,
    skills: {
      ...(base.skills ?? DEFAULT_SERVE_OPTIONS.capabilities.skills),
      enabled: true,
      legacySkillMd: true,
      roots: uniqueStrings([
        ...skillRoots,
        ...(base.skills?.roots ?? [])
      ])
    }
  }
}

function kworksSkillRootsFromEnv(env: Record<string, string | undefined>): string[] {
  const raw = env.KWorks_SKILLS_PATH ?? env.KWORKS_SKILLS_PATH ?? env.QIONGQI_SKILLS_PATH
  if (!raw?.trim()) return []
  const roots = raw
    .split(process.platform === 'win32' ? ';' : ':')
    .map((item) => item.trim())
    .filter(Boolean)
  return roots.flatMap(skillRootsFromKWorksRoot)
}

function skillRootsFromKWorksRoot(root: string): string[] {
  const unified = [
    join(root, 'builtin', 'core'),
    join(root, 'builtin', 'task'),
    join(root, 'builtin', 'coding'),
    join(root, 'builtin', 'finance'),
    join(root, 'custom', 'shared')
  ]
  const legacy = [join(root, 'public'), join(root, 'custom')]
  const existingLegacy = legacy.filter((candidate) => existsSync(candidate))
  const hasUnifiedRoots = unified.some((candidate) => existsSync(candidate))
  if (existingLegacy.length > 0 && !hasUnifiedRoots) return existingLegacy
  const unifiedSkillIds = skillPackageIds(unified)
  const missingLegacyPackages = existingLegacy.flatMap((legacyRoot) =>
    skillPackageRoots(legacyRoot).filter((candidate) => !unifiedSkillIds.has(basename(candidate)))
  )
  return uniqueStrings([...unified, ...missingLegacyPackages])
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}

function skillPackageIds(roots: readonly string[]): Set<string> {
  return new Set(roots.flatMap(skillPackageRoots).map((candidate) => basename(candidate)))
}

function skillPackageRoots(root: string): string[] {
  if (!existsSync(root)) return []
  const packages: string[] = []
  if (isSkillPackage(root)) packages.push(root)
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const candidate = join(root, entry.name)
      if (isSkillPackage(candidate)) packages.push(candidate)
    }
  } catch {
    return packages
  }
  return packages
}

function isSkillPackage(root: string): boolean {
  return existsSync(join(root, 'skill.json')) || existsSync(join(root, 'SKILL.md'))
}

/**
 * Resolve the API key from CLI flags, env vars, or config.
 *
 * Priority: `--api-key` flag > `QIONGQI_API_KEY` env > legacy
 * `DEEPSEEK_API_KEY` env (kept for backward compat) > config file.
 * Returns `undefined` when nothing is set so the schema reports a
 * required-field error.
 */
function resolveApiKey(
  raw: Record<string, string | boolean>,
  env: Record<string, string | undefined>,
  configServe: NonNullable<LoadedQiongqiConfig['config']['serve']>
): string | undefined {
  const flagValue = stringFlag(raw, 'api-key') ?? stringFlag(raw, 'apiKey')
  if (flagValue) return flagValue
  const envValue = env.QIONGQI_API_KEY ?? env.DEEPSEEK_API_KEY
  if (envValue) return envValue
  if (configServe.apiKey) return configServe.apiKey
  return undefined
}

/**
 * Resolve the base URL from CLI flags, env vars, or config.
 *
 * Priority: `--base-url` flag > `QIONGQI_BASE_URL` env > legacy
 * `DEEPSEEK_BASE_URL` env (kept for backward compat) > config file.
 * Returns `undefined` when nothing is set so the schema reports a
 * required-field error.
 */
function resolveBaseUrl(
  raw: Record<string, string | boolean>,
  env: Record<string, string | undefined>,
  configServe: NonNullable<LoadedQiongqiConfig['config']['serve']>
): string | undefined {
  const flagValue = stringFlag(raw, 'base-url') ?? stringFlag(raw, 'baseUrl')
  if (flagValue) return flagValue
  const envValue = env.QIONGQI_BASE_URL ?? env.DEEPSEEK_BASE_URL
  if (envValue) return envValue
  if (configServe.baseUrl) return configServe.baseUrl
  return undefined
}

function loadServeConfig(
  raw: Record<string, string | boolean>,
  env: Record<string, string | undefined>
): LoadedQiongqiConfig | null {
  const explicitConfigPath =
    stringFlag(raw, 'config') ??
    stringFlag(raw, 'config-file') ??
    env.QIONGQI_CONFIG
  if (explicitConfigPath) {
    return readQiongqiConfigFile(explicitConfigPath)
  }
  const dataDir = dataDirFromRawOrEnv(raw, env)
  return readOptionalQiongqiConfigFile(qiongqiConfigPathForDataDir(dataDir))
}

function dataDirFromRawOrEnv(
  raw: Record<string, string | boolean>,
  env: Record<string, string | undefined>
): string | undefined {
  return stringFlag(raw, 'data-dir') ??
    stringFlag(raw, 'dataDir') ??
    env.QIONGQI_DATA_DIR ??
    defaultKWorksRuntimeDataDir(env)
}

function storageBackendFromRawOrEnv(
  raw: Record<string, string | boolean>,
  env: Record<string, string | undefined>
): ServeOptions['storage']['backend'] | undefined {
  const value =
    stringFlag(raw, 'storage-backend') ??
    stringFlag(raw, 'storageBackend') ??
    env.QIONGQI_STORAGE_BACKEND
  if (value === 'hybrid' || value === 'file') return value
  return value ? (value as ServeOptions['storage']['backend']) : undefined
}

function storageSqlitePathFromRawOrEnv(
  raw: Record<string, string | boolean>,
  env: Record<string, string | undefined>
): string | undefined {
  return stringFlag(raw, 'sqlite-path') ??
    stringFlag(raw, 'sqlitePath') ??
    env.QIONGQI_SQLITE_PATH
}

function observabilityFromConfigOrEnv(
  configServe: NonNullable<LoadedQiongqiConfig['config']['serve']>,
  env: Record<string, string | undefined>
): ServeOptions['observability'] | undefined {
  const config = configServe.observability
  const enabled = envBoolean(env.QIONGQI_OTEL_ENABLED)
  const exporter = openTelemetryExporterFromEnv(env.QIONGQI_OTEL_EXPORTER)
  const endpoint = env.QIONGQI_OTEL_ENDPOINT
  const serviceName = env.QIONGQI_OTEL_SERVICE_NAME
  if (
    enabled === undefined &&
    !exporter &&
    !endpoint &&
    !serviceName
  ) {
    return config
  }
  return {
    ...(config ?? {}),
    openTelemetry: {
      ...(config?.openTelemetry ?? {}),
      ...(enabled !== undefined ? { enabled } : {}),
      ...(exporter ? { exporter } : {}),
      ...(endpoint ? { endpoint } : {}),
      ...(serviceName ? { serviceName } : {})
    }
  }
}

function openTelemetryExporterFromEnv(
  value: string | undefined
): NonNullable<NonNullable<ServeOptions['observability']>['openTelemetry']>['exporter'] | undefined {
  if (value === 'otlp-http' || value === 'console' || value === 'none') return value
  return value ? (value as NonNullable<NonNullable<ServeOptions['observability']>['openTelemetry']>['exporter']) : undefined
}

function stringFlag(
  raw: Record<string, string | boolean>,
  key: string
): string | undefined {
  const value = raw[key]
  return typeof value === 'string' && value !== 'true' ? value : undefined
}

function booleanFlag(
  raw: Record<string, string | boolean>,
  key: string
): boolean | undefined {
  const value = raw[key]
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return undefined
  return envBoolean(value)
}

function envBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined
  const normalized = value.trim().toLowerCase()
  if (!normalized) return undefined
  if (normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'no') {
    return false
  }
  return true
}
