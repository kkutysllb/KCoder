import type { RuntimeMiddleware } from '../runtime-middleware.js'

export function historyIntegrityMiddleware(): RuntimeMiddleware {
  return {
    id: 'history-integrity', version: 1, hooks: ['beforeNode'],
    handle: async (context, next) => {
      const items = context.facts?.historyItems
      if (Array.isArray(items)) return next({ ...context, facts: { ...context.facts, historyItems: items } })
      return next(context)
    }
  }
}
