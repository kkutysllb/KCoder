import type { RuntimeMiddleware } from '../runtime-middleware.js'

export function safetyTerminationMiddleware(): RuntimeMiddleware {
  return {
    id: 'safety-termination', version: 1, hooks: ['afterNode'],
    handle: async (context, next) => {
      const stopClass = context.facts?.stopClass
      if (stopClass === 'safety' || stopClass === 'refusal') {
        return { commands: [{ type: 'terminate', outcome: { status: 'degraded', reason: 'provider_safety_stop', retryable: false, details: { providerReason: context.facts?.providerReason } } }] }
      }
      return next(context)
    }
  }
}
