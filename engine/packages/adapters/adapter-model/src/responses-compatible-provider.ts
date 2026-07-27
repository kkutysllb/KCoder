import { CompatModelProvider } from './provider-adapter.js'
import type { ModelCredentialResolver } from '@qiongqi/ports'

export class ResponsesCompatibleProvider extends CompatModelProvider {
  constructor(resolveCredentials: ModelCredentialResolver, providerId = 'responses-compatible') {
    super(providerId, 'responses', resolveCredentials)
  }
}
