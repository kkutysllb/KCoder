import { LoopGovernor, type LoopGovernorState } from '../loop-governor.js'
import type { RuntimeMiddleware } from '../runtime-middleware.js'
import type { ToolObservation } from '@qiongqi/contracts'

export function loopGovernorMiddleware(): RuntimeMiddleware {
  const governor = new LoopGovernor()
  return {
    id: 'loop-governor', version: 1, hooks: ['afterNode'],
    handle: async (context, next) => {
      const facts = context.facts ?? {}
      if (context.node?.id === 'progress-checkpoint') {
        const previous = readState(context.state.middleware['loop-governor']?.data)
        if (previous) {
          const state = governor.markCheckpointCompleted(previous)
          return { commands: [{ type: 'set-middleware-state', id: 'loop-governor', state: { version: 1, data: state } }] }
        }
        return next(context)
      }
      if (context.node?.id !== 'project-progress') return next(context)
      const previous = readState(context.state.middleware['loop-governor']?.data)
      const decision = governor.evaluate(previous, {
        stage: 'tool',
        observations: Array.isArray(facts.observations) ? facts.observations as ToolObservation[] : [],
        progress: {
          level: facts.progressLevel === 'strong' || facts.progressLevel === 'weak' ? facts.progressLevel : 'none',
          digest: String(facts.progressDigest ?? 'none')
        }
      })
      const stateCommand = { type: 'set-middleware-state' as const, id: 'loop-governor', state: { version: 1, data: decision.state } }
      if (decision.action === 'terminate') {
        return { commands: [stateCommand, { type: 'terminate', outcome: { status: 'degraded', reason: 'loop_capped', retryable: true, details: { governorReason: decision.reason } } }] }
      }
      if (decision.action === 'checkpoint') {
        return { commands: [stateCommand, { type: 'jump', nodeId: 'progress-checkpoint', condition: 'next', reason: decision.reason ?? 'governor checkpoint' }] }
      }
      return { commands: [stateCommand] }
    }
  }
}

function readState(value: unknown): LoopGovernorState | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<LoopGovernorState>
  if (candidate.version !== 1 || !Array.isArray(candidate.recentCalls) || !Array.isArray(candidate.recentResults)) return undefined
  return {
    version: 1,
    recentCalls: candidate.recentCalls.filter((item): item is string => typeof item === 'string'),
    recentResults: candidate.recentResults.filter((item): item is string => typeof item === 'string'),
    recentResources: Array.isArray(candidate.recentResources) ? candidate.recentResources.filter((item): item is string => typeof item === 'string') : [],
    observationCount: Number(candidate.observationCount) || 0,
    noProgressToolCalls: Number(candidate.noProgressToolCalls) || 0,
    noProgressModelSteps: Number(candidate.noProgressModelSteps) || 0,
    checkpointRequested: candidate.checkpointRequested === true,
    checkpointCompleted: candidate.checkpointCompleted === true,
    ...(typeof candidate.terminated === 'string' ? { terminated: candidate.terminated } : {})
  }
}
