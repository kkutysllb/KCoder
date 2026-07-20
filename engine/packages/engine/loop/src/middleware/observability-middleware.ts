import type { RuntimeMiddleware } from '../runtime-middleware.js'

export function observabilityMiddleware(): RuntimeMiddleware {
  return {
    id: 'observability', version: 1, hooks: ['beforeRun', 'beforeNode', 'afterNode', 'afterRun', 'onError'],
    handle: async (context, next) => {
      const started = Date.now()
      const result = await next(context)
      const durationMs = Date.now() - started
      return { ...result, commands: [...(result?.commands ?? []), { type: 'record-warning', code: 'hook_observed', message: `${context.hook}:${durationMs}ms` }] }
    }
  }
}
