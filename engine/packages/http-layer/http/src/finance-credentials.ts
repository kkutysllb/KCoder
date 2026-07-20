import type { KWorksUserDataStore } from './kworks-user-data-store.js'

export const FINANCE_CREDENTIALS_SECRET_KEY = 'finance.credentials.secrets'
export const FINANCE_DATA_SOURCE_CONFIG_KEY = 'finance.credentials.config'

export type FinanceCredentialSecrets = {
  tushareToken?: string
  iwencaiApiKey?: string
}

export type FinanceDataSourceConfig = {
  apiBaseUrl: string
  queryEndpoint: string
  comprehensiveEndpoint: string
  webUrl: string
}

export type FinanceCredentialStatus = {
  iwencai: boolean
  tushare: boolean
  sources: { iwencai: 'user' | 'environment' | 'missing'; tushare: 'user' | 'environment' | 'missing' }
  config: FinanceDataSourceConfig
}

export type ResolvedFinanceDataSource = {
  config: FinanceDataSourceConfig
  environment: Record<string, string>
  status: FinanceCredentialStatus
}

export const DEFAULT_FINANCE_DATA_SOURCE_CONFIG: FinanceDataSourceConfig = {
  apiBaseUrl: 'https://openapi.iwencai.com',
  queryEndpoint: '/v1/query2data',
  comprehensiveEndpoint: '/v1/comprehensive/search',
  webUrl: 'https://www.iwencai.com/unifiedwap/chat'
}

export function resolveFinanceDataSource(
  secrets: FinanceCredentialSecrets = {},
  config: Partial<FinanceDataSourceConfig> = {},
  environment: NodeJS.ProcessEnv = process.env
): ResolvedFinanceDataSource {
  const tushareToken = nonEmpty(secrets.tushareToken) ?? nonEmpty(environment.TUSHARE_TOKEN)
  const iwencaiApiKey = nonEmpty(secrets.iwencaiApiKey) ?? nonEmpty(environment.IWENCAI_API_KEY)
  const resolvedConfig: FinanceDataSourceConfig = {
    apiBaseUrl: normalizeUrl(config.apiBaseUrl ?? environment.IWENCAI_API_BASE_URL, DEFAULT_FINANCE_DATA_SOURCE_CONFIG.apiBaseUrl),
    queryEndpoint: normalizeEndpoint(config.queryEndpoint ?? environment.IWENCAI_QUERY_ENDPOINT, DEFAULT_FINANCE_DATA_SOURCE_CONFIG.queryEndpoint),
    comprehensiveEndpoint: normalizeEndpoint(config.comprehensiveEndpoint ?? environment.IWENCAI_COMPREHENSIVE_ENDPOINT, DEFAULT_FINANCE_DATA_SOURCE_CONFIG.comprehensiveEndpoint),
    webUrl: normalizeUrl(config.webUrl ?? environment.IWENCAI_WEB_URL, DEFAULT_FINANCE_DATA_SOURCE_CONFIG.webUrl)
  }
  const outputEnvironment: Record<string, string> = {
    IWENCAI_API_BASE_URL: resolvedConfig.apiBaseUrl,
    IWENCAI_QUERY_ENDPOINT: resolvedConfig.queryEndpoint,
    IWENCAI_COMPREHENSIVE_ENDPOINT: resolvedConfig.comprehensiveEndpoint,
    IWENCAI_WEB_URL: resolvedConfig.webUrl
  }
  if (tushareToken) outputEnvironment.TUSHARE_TOKEN = tushareToken
  if (iwencaiApiKey) outputEnvironment.IWENCAI_API_KEY = iwencaiApiKey
  return {
    config: resolvedConfig,
    environment: outputEnvironment,
    status: {
      iwencai: Boolean(iwencaiApiKey),
      tushare: Boolean(tushareToken),
      sources: {
        iwencai: sourceOf(secrets.iwencaiApiKey, environment.IWENCAI_API_KEY),
        tushare: sourceOf(secrets.tushareToken, environment.TUSHARE_TOKEN)
      },
      config: resolvedConfig
    }
  }
}

export async function loadFinanceDataSource(
  store: KWorksUserDataStore | undefined,
  userId: string | undefined,
  environment: NodeJS.ProcessEnv = process.env
): Promise<ResolvedFinanceDataSource> {
  if (!store || !userId) return resolveFinanceDataSource({}, {}, environment)
  const [rawSecrets, rawConfig] = await Promise.all([
    store.getUserSetting(userId, FINANCE_CREDENTIALS_SECRET_KEY),
    store.getUserSetting(userId, FINANCE_DATA_SOURCE_CONFIG_KEY)
  ])
  return resolveFinanceDataSource(asSecrets(rawSecrets), asConfig(rawConfig), environment)
}

export async function saveFinanceDataSource(
  store: KWorksUserDataStore,
  userId: string,
  input: { secrets: FinanceCredentialSecrets; config: Partial<FinanceDataSourceConfig> }
): Promise<void> {
  await Promise.all([
    store.setUserSetting(userId, FINANCE_CREDENTIALS_SECRET_KEY, cleanSecrets(input.secrets)),
    store.setUserSetting(userId, FINANCE_DATA_SOURCE_CONFIG_KEY, cleanConfig(input.config))
  ])
}

function asSecrets(value: unknown): FinanceCredentialSecrets {
  if (!isRecord(value)) return {}
  const tushareToken = nonEmpty(value.tushareToken)
  const iwencaiApiKey = nonEmpty(value.iwencaiApiKey)
  return {
    ...(tushareToken ? { tushareToken } : {}),
    ...(iwencaiApiKey ? { iwencaiApiKey } : {})
  }
}

function asConfig(value: unknown): Partial<FinanceDataSourceConfig> {
  if (!isRecord(value)) return {}
  return {
    ...(typeof value.apiBaseUrl === 'string' ? { apiBaseUrl: value.apiBaseUrl } : {}),
    ...(typeof value.queryEndpoint === 'string' ? { queryEndpoint: value.queryEndpoint } : {}),
    ...(typeof value.comprehensiveEndpoint === 'string' ? { comprehensiveEndpoint: value.comprehensiveEndpoint } : {}),
    ...(typeof value.webUrl === 'string' ? { webUrl: value.webUrl } : {})
  }
}

function cleanSecrets(value: FinanceCredentialSecrets): FinanceCredentialSecrets {
  return asSecrets(value)
}

function cleanConfig(value: Partial<FinanceDataSourceConfig>): FinanceDataSourceConfig {
  return {
    apiBaseUrl: normalizeUrl(value.apiBaseUrl, DEFAULT_FINANCE_DATA_SOURCE_CONFIG.apiBaseUrl),
    queryEndpoint: normalizeEndpoint(value.queryEndpoint, DEFAULT_FINANCE_DATA_SOURCE_CONFIG.queryEndpoint),
    comprehensiveEndpoint: normalizeEndpoint(value.comprehensiveEndpoint, DEFAULT_FINANCE_DATA_SOURCE_CONFIG.comprehensiveEndpoint),
    webUrl: normalizeUrl(value.webUrl, DEFAULT_FINANCE_DATA_SOURCE_CONFIG.webUrl)
  }
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeUrl(value: unknown, fallback: string): string {
  const candidate = nonEmpty(value)
  if (!candidate) return fallback
  try {
    const parsed = new URL(candidate)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return fallback
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return fallback
  }
}

function normalizeEndpoint(value: unknown, fallback: string): string {
  const candidate = nonEmpty(value)
  if (!candidate) return fallback
  return candidate.startsWith('/') ? candidate : `/${candidate}`
}

function sourceOf(userValue: unknown, environmentValue: unknown): 'user' | 'environment' | 'missing' {
  if (nonEmpty(userValue)) return 'user'
  if (nonEmpty(environmentValue)) return 'environment'
  return 'missing'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
