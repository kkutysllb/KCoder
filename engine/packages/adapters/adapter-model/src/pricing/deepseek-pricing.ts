import { isDeepSeekHost } from '../model-error-probe.js'
import type { CostEstimate, PricingInput, PricingProvider } from './types.js'

/**
 * DeepSeek pricing provider.
 *
 * Implements {@link PricingProvider} for the official DeepSeek API
 * price table. Returns null for non-DeepSeek hosts (OpenRouter,
 * llama.cpp, OpenAI, etc.) because we don't have authoritative prices
 * for third-party deployments.
 *
 * Price source: official DeepSeek API documentation, as of 2026-06-02.
 * `deepseek-chat` / `deepseek-reasoner` are aliases for v4-flash modes.
 */
export class DeepseekPricingProvider implements PricingProvider {
  readonly id = 'deepseek'

  estimateCost(input: PricingInput): CostEstimate | null {
    if (input.providerHost !== undefined && !isDeepSeekHost(input.providerHost)) {
      return null
    }
    const tier = pricingTierForModel(input.model)
    if (!tier) return null
    const prices = DEEPSEEK_V4_PRICES[tier]
    return {
      costUsd: computeCost(prices.usd, input.cacheHitTokens, input.cacheMissTokens, input.outputTokens),
      costCny: computeCost(prices.cny, input.cacheHitTokens, input.cacheMissTokens, input.outputTokens)
    }
  }

  estimateCacheSavings(input: {
    model: string
    providerHost?: string
    cacheHitTokens: number
  }): CostEstimate | null {
    if (input.providerHost !== undefined && !isDeepSeekHost(input.providerHost)) {
      return null
    }
    const tier = pricingTierForModel(input.model)
    if (!tier) return null
    const prices = DEEPSEEK_V4_PRICES[tier]
    return {
      cacheSavingsUsd: (input.cacheHitTokens / TOKENS_PER_MILLION) *
        Math.max(0, prices.usd.inputCacheMiss - prices.usd.inputCacheHit),
      cacheSavingsCny: (input.cacheHitTokens / TOKENS_PER_MILLION) *
        Math.max(0, prices.cny.inputCacheMiss - prices.cny.inputCacheHit)
    }
  }
}

// ---------------------------------------------------------------------------
// Backward-compatible function exports
//
// These keep the old `estimateDeepseekCost` / `estimateDeepseekCacheSavings`
// / `estimateDeepseekInputTokenCost` function signatures working for
// existing test code. Internally they delegate to {@link DeepseekPricingProvider}.
// ---------------------------------------------------------------------------

/** @deprecated since stage 1.3 — use `DeepseekPricingProvider` instead. */
export type DeepseekCurrencyCosts = {
  costUsd: number
  costCny: number
}

type DeepseekPrice = {
  inputCacheHit: number
  inputCacheMiss: number
  output: number
}

type DeepseekPriceSet = {
  usd: DeepseekPrice
  cny: DeepseekPrice
}

const TOKENS_PER_MILLION = 1_000_000

// Official DeepSeek API prices per 1M tokens. As of 2026-06-02,
// deepseek-chat/deepseek-reasoner are aliases for v4-flash modes.
const DEEPSEEK_V4_PRICES: Record<'flash' | 'pro', DeepseekPriceSet> = {
  flash: {
    usd: {
      inputCacheHit: 0.0028,
      inputCacheMiss: 0.14,
      output: 0.28
    },
    cny: {
      inputCacheHit: 0.02,
      inputCacheMiss: 1,
      output: 2
    }
  },
  pro: {
    usd: {
      inputCacheHit: 0.003625,
      inputCacheMiss: 0.435,
      output: 0.87
    },
    cny: {
      inputCacheHit: 0.025,
      inputCacheMiss: 3,
      output: 6
    }
  }
}

function pricingTierForModel(model: string): keyof typeof DEEPSEEK_V4_PRICES | null {
  const normalized = model.trim().toLowerCase()
  if (!normalized) return null
  if (normalized === 'deepseek-v4-pro' || normalized.endsWith('/deepseek-v4-pro')) return 'pro'
  if (
    normalized === 'deepseek-v4-flash' ||
    normalized === 'deepseek-chat' ||
    normalized === 'deepseek-reasoner' ||
    normalized.endsWith('/deepseek-v4-flash') ||
    normalized.endsWith('/deepseek-chat') ||
    normalized.endsWith('/deepseek-reasoner')
  ) {
    return 'flash'
  }
  return null
}

function computeCost(
  price: DeepseekPrice,
  cacheHitTokens: number,
  cacheMissTokens: number,
  outputTokens: number
): number {
  return (
    (cacheHitTokens / TOKENS_PER_MILLION) * price.inputCacheHit +
    (cacheMissTokens / TOKENS_PER_MILLION) * price.inputCacheMiss +
    (outputTokens / TOKENS_PER_MILLION) * price.output
  )
}

// Singleton instance used by the backward-compatible function exports.
const singletonProvider = new DeepseekPricingProvider()

/** @deprecated since stage 1.3 — use `DeepseekPricingProvider.estimateCost` instead. */
export function estimateDeepseekCost(input: {
  model: string
  cacheHitTokens: number
  cacheMissTokens: number
  outputTokens: number
  providerHost?: string
}): DeepseekCurrencyCosts | null {
  const estimate = singletonProvider.estimateCost(input)
  if (!estimate || estimate.costUsd === undefined || estimate.costCny === undefined) return null
  return { costUsd: estimate.costUsd, costCny: estimate.costCny }
}

/** @deprecated since stage 1.3 — use `DeepseekPricingProvider.estimateCost` instead. */
export function estimateDeepseekInputTokenCost(input: {
  model: string
  inputTokens: number
  providerHost?: string
}): DeepseekCurrencyCosts | null {
  return estimateDeepseekCost({
    model: input.model,
    cacheHitTokens: 0,
    cacheMissTokens: input.inputTokens,
    outputTokens: 0,
    providerHost: input.providerHost
  })
}

/** @deprecated since stage 1.3 — use `DeepseekPricingProvider.estimateCacheSavings` instead. */
export function estimateDeepseekCacheSavings(input: {
  model: string
  cacheHitTokens: number
  providerHost?: string
}): DeepseekCurrencyCosts | null {
  const estimate = singletonProvider.estimateCacheSavings(input)
  if (!estimate || estimate.cacheSavingsUsd === undefined || estimate.cacheSavingsCny === undefined) return null
  return { costUsd: estimate.cacheSavingsUsd, costCny: estimate.cacheSavingsCny }
}
