import type { ToolCallLike } from '@qiongqi/ports'
import { ToolStormBreaker } from '../tool-storm-breaker.js'
import type { RuntimeMiddleware } from '../runtime-middleware.js'

export function loopDetectionMiddleware(options: { windowSize?: number; threshold?: number } = {}): RuntimeMiddleware {
  const breaker = new ToolStormBreaker(options)
  return {
    id: 'loop-detection', version: 1, hooks: ['beforeNode'],
    handle: async (context, next) => {
      const call = context.facts?.toolCall as ToolCallLike | undefined
      if (call) {
        const inspection = breaker.inspect(call)
        if (inspection.suppress) return { commands: [{ type: 'terminate', outcome: { status: 'degraded', reason: 'loop_capped', retryable: false, details: { message: inspection.reason } } }] }
      }
      return next(context)
    }
  }
}
