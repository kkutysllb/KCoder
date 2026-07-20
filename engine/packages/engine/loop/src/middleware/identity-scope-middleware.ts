import type { RunIdentity } from '@qiongqi/contracts'
import type { RuntimeMiddleware } from '../runtime-middleware.js'

export function identityScopeMiddleware(expected: RunIdentity): RuntimeMiddleware {
  return {
    id: 'identity-scope', version: 1, hooks: ['beforeRun', 'beforeNode'],
    handle: async (context, next) => {
      const same = (Object.keys(expected) as (keyof RunIdentity)[]).every((key) => context.identity[key] === expected[key])
      if (!same) return { commands: [{ type: 'terminate', outcome: { status: 'failed', reason: 'runtime_error', retryable: false, details: { code: 'identity_scope_mismatch' } } }] }
      return next(context)
    }
  }
}
