import { CompatModelProvider } from './provider-adapter.js'
import type { ModelCredentialResolver } from '@qiongqi/ports'

export class AnthropicCompatibleProvider extends CompatModelProvider {
  constructor(resolveCredentials: ModelCredentialResolver, providerId = 'anthropic-compatible') {
    super(providerId, 'messages', resolveCredentials)
  }
}
