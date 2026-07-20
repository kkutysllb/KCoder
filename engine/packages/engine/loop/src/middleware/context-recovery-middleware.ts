import { hasRecoverableTaskState, looksLikeContextLossClarification } from '../context-recovery-guard.js'
import type { RuntimeMiddleware } from '../runtime-middleware.js'

export function contextRecoveryMiddleware(): RuntimeMiddleware {
  return {
    id: 'context-recovery', version: 1, hooks: ['afterNode'],
    handle: async (context, next) => {
      const text = typeof context.facts?.proposalText === 'string' ? context.facts.proposalText : ''
      const buildContext = context.facts?.buildContext
      const recoverable = context.facts?.recoverable === true || context.facts?.hasRecoverableState === true ||
        (buildContext && typeof buildContext === 'object' && hasRecoverableTaskState(buildContext as never))
      // Compatibility-only path for classic orchestration, which does not
      // produce normalized ProposalClass values.
      if (recoverable && looksLikeContextLossClarification(text)) return { commands: [{ type: 'retry', reason: 'recoverable context-loss clarification' }] }
      return next(context)
    }
  }
}
