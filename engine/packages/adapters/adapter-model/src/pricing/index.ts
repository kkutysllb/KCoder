/**
 * Pricing provider abstraction for the model client.
 *
 * @example
 * ```ts
 * import {
 *   CompositePricingProvider,
 *   DeepseekPricingProvider,
 *   type PricingProvider
 * } from '@qiongqi/adapter-model/pricing'
 *
 * const pricing: PricingProvider = new CompositePricingProvider([
 *   new DeepseekPricingProvider()
 * ])
 * ```
 *
 * Stage 1.3 introduced this abstraction so the model client no longer
 * hard-codes DeepSeek-specific pricing. New providers can be added by
 * implementing `PricingProvider` and registering with the composite.
 */

export type {
  CostEstimate,
  PricingInput,
  PricingProvider
} from './types.js'

export {
  DeepseekPricingProvider,
  // Backward-compatible function exports (deprecated):
  estimateDeepseekCost,
  estimateDeepseekInputTokenCost,
  estimateDeepseekCacheSavings,
  type DeepseekCurrencyCosts
} from './deepseek-pricing.js'

export { CompositePricingProvider } from './composite-pricing.js'

import { CompositePricingProvider } from './composite-pricing.js'
import { DeepseekPricingProvider } from './deepseek-pricing.js'

/**
 * Default pricing provider. Includes all built-in provider
 * implementations. Model clients that don't pass a custom
 * `pricingProvider` use this instance.
 *
 * To register a new provider globally, extend this list — but
 * prefer injecting a custom {@link CompositePricingProvider} via
 * the model client config for application-specific setups.
 */
export const defaultPricingProvider: CompositePricingProvider =
  new CompositePricingProvider([
    new DeepseekPricingProvider()
  ])
