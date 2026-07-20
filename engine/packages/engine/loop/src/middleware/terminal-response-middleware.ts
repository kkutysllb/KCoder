import type { RuntimeMiddleware } from '../runtime-middleware.js'

export function terminalResponseMiddleware(): RuntimeMiddleware {
  return {
    id: 'terminal-response', version: 1, hooks: ['afterNode'],
    // Kernel v3 classifies empty model proposals in `evaluate`, where the
    // durable recovery state and `recover-context` graph edge are available.
    // Retrying here would jump directly back to `build-context` and bypass
    // that persisted recovery entry.
    handle: async (context, next) => next(context)
  }
}
