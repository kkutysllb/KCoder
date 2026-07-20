import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FINANCE_DATA_SOURCE_CONFIG,
  resolveFinanceDataSource,
  type FinanceCredentialSecrets,
  type FinanceDataSourceConfig
} from '../packages/http-layer/http/src/finance-credentials.js'

describe('finance data-source credentials', () => {
  it('uses user-scoped values before process environment fallbacks', () => {
    const resolved = resolveFinanceDataSource(
      {
        tushareToken: 'user-tushare',
        iwencaiApiKey: 'user-iwencai'
      },
      {
        apiBaseUrl: 'https://proxy.example',
        queryEndpoint: '/query',
        comprehensiveEndpoint: '/search'
      },
      {
        TUSHARE_TOKEN: 'env-tushare',
        IWENCAI_API_KEY: 'env-iwencai',
        IWENCAI_API_BASE_URL: 'https://env.example'
      }
    )

    expect(resolved.environment).toMatchObject({
      TUSHARE_TOKEN: 'user-tushare',
      IWENCAI_API_KEY: 'user-iwencai',
      IWENCAI_API_BASE_URL: 'https://proxy.example',
      IWENCAI_QUERY_ENDPOINT: '/query',
      IWENCAI_COMPREHENSIVE_ENDPOINT: '/search'
    })
    expect(resolved.status.sources).toEqual({ iwencai: 'user', tushare: 'user' })
  })

  it('keeps official defaults when no user config is present', () => {
    const resolved = resolveFinanceDataSource({}, {}, {})
    expect(resolved.config).toEqual(DEFAULT_FINANCE_DATA_SOURCE_CONFIG)
    expect(resolved.environment.IWENCAI_API_BASE_URL).toBe(DEFAULT_FINANCE_DATA_SOURCE_CONFIG.apiBaseUrl)
    expect(resolved.status).toMatchObject({ iwencai: false, tushare: false })
  })

  it('never exposes secret values in the public status projection', () => {
    const resolved = resolveFinanceDataSource(
      { tushareToken: 'secret-a', iwencaiApiKey: 'secret-b' },
      {},
      {}
    )
    expect(JSON.stringify(resolved.status)).not.toContain('secret-a')
    expect(JSON.stringify(resolved.status)).not.toContain('secret-b')
  })
})
