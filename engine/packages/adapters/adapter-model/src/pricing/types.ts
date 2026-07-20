/**
 * Pricing provider abstraction.
 *
 * The model client needs to estimate token cost and cache savings for
 * each turn. Different providers (DeepSeek, OpenAI, Anthropic, ...)
 * have different price tables and cache semantics, so this is modeled
 * as a provider interface rather than hard-coded in the client.
 *
 * Stage 1.3 extracted the DeepSeek-specific pricing from the monolithic
 * `deepseek-pricing.ts` into an implementor of this interface. New
 * providers can be added by implementing {@link PricingProvider} and
 * registering with {@link CompositePricingProvider}.
 */

/**
 * Estimated cost and savings for a model turn. All fields optional
 * because not every provider reports every currency or metric.
 */
export interface CostEstimate {
  /** Cost in USD, or undefined when the provider cannot estimate. */
  costUsd?: number
  /** Cost in CNY, or undefined when the provider cannot estimate. */
  costCny?: number
  /** Cache hit savings in USD compared to cache miss. */
  cacheSavingsUsd?: number
  /** Cache hit savings in CNY compared to cache miss. */
  cacheSavingsCny?: number
}

/**
 * Input for cost estimation. The provider uses these values together
 * with its own price table to compute a {@link CostEstimate}.
 */
export interface PricingInput {
  /** Model identifier (e.g. `deepseek-v4-pro`, `gpt-4o`). */
  model: string
  /**
   * Optional upstream base URL. Providers that only serve a specific
   * host (e.g. official DeepSeek API) return null for other hosts.
   */
  providerHost?: string
  /** Number of prompt tokens served from cache. */
  cacheHitTokens: number
  /** Number of prompt tokens not served from cache. */
  cacheMissTokens: number
  /** Number of generated completion tokens. */
  outputTokens: number
}

/**
 * Computes cost and cache-savings estimates for a model provider.
 *
 * Implementations must be pure and side-effect free — they receive
 * token counts and return estimates, or null when the input does not
 * match the provider's pricing table (unknown model, non-matching
 * host, etc.).
 */
export interface PricingProvider {
  /** Stable identifier for diagnostics (e.g. `deepseek`, `openai`). */
  readonly id: string
  /**
   * Estimate the cost for a single model turn. Returns null when this
   * provider cannot estimate the given input.
   */
  estimateCost(input: PricingInput): CostEstimate | null
  /**
   * Estimate the savings from cache hits versus cache misses. Returns
   * null when this provider cannot estimate the given input.
   */
  estimateCacheSavings(input: {
    model: string
    providerHost?: string
    cacheHitTokens: number
  }): CostEstimate | null
}
