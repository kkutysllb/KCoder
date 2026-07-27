import { CompatModelProvider } from './provider-adapter.js'
import type { ModelCredentialResolver } from '@qiongqi/ports'

export class OpenAICompatibleProvider extends CompatModelProvider {
  constructor(resolveCredentials: ModelCredentialResolver, providerId = 'openai-compatible') {
    super(providerId, 'chat_completions', resolveCredentials)
  }
}
