import type { CostEstimate, PricingInput, PricingProvider } from './types.js'

/**
 * Composite pricing provider that delegates to a list of registered
 * providers, returning the first non-null estimate.
 *
 * Usage:
 * ```ts
 * const pricing = new CompositePricingProvider([
 *   new DeepseekPricingProvider(),
 *   new OpenAIPricingProvider(),     // hypothetical future provider
 *   new AnthropicPricingProvider()   // hypothetical future provider
 * ])
 * const estimate = pricing.estimateCost({ model: 'gpt-4o', ... })
 * ```
 *
 * The composite is the recommended top-level pricing provider for
 * the model client: it lets multiple provider-specific implementations
 * coexist without hard-coding any one of them.
 */
export class CompositePricingProvider implements PricingProvider {
  readonly id = 'composite'
  private readonly providers: readonly PricingProvider[]

  constructor(providers: readonly PricingProvider[]) {
    this.providers = providers
  }

  estimateCost(input: PricingInput): CostEstimate | null {
    for (const provider of this.providers) {
      const estimate = provider.estimateCost(input)
      if (estimate) return estimate
    }
    return null
  }

  estimateCacheSavings(input: {
    model: string
    providerHost?: string
    cacheHitTokens: number
  }): CostEstimate | null {
    for (const provider of this.providers) {
      const estimate = provider.estimateCacheSavings(input)
      if (estimate) return estimate
    }
    return null
  }

  /** List registered providers for diagnostics. */
  listProviders(): readonly PricingProvider[] {
    return this.providers
  }
}
