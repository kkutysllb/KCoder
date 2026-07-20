import type { RuntimeMiddleware } from '../runtime-middleware.js'

export function commitIntegrityMiddleware(): RuntimeMiddleware {
  return {
    id: 'commit-integrity', version: 1, hooks: ['beforeNode', 'afterNode'],
    handle: async (context, next) => {
      if (context.facts?.lateEvent === true && ['completed', 'failed', 'aborted'].includes(context.state.status)) return { commands: [{ type: 'record-warning', code: 'late_event_ignored', message: 'late event ignored after terminal run' }] }
      return next(context)
    }
  }
}
