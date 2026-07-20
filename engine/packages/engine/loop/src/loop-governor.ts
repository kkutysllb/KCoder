import type { ToolObservation } from '@qiongqi/contracts'

export type LoopGovernorState = {
  version: 1
  recentCalls: string[]
  recentResults: string[]
  recentResources: string[]
  observationCount: number
  noProgressToolCalls: number
  noProgressModelSteps: number
  checkpointRequested: boolean
  checkpointCompleted: boolean
  terminated?: string
}

export type LoopGovernorDecision = {
  action: 'allow' | 'checkpoint' | 'terminate'
  reason?: string
  state: LoopGovernorState
}

export type LoopGovernorInput = {
  stage: 'model' | 'tool' | 'checkpoint'
  observations: readonly ToolObservation[]
  progress: { level: 'strong' | 'weak' | 'none'; digest: string }
  proposalClass?: string
}

export class LoopGovernor {
  evaluate(previous: LoopGovernorState | undefined, input: LoopGovernorInput): LoopGovernorDecision {
    const state: LoopGovernorState = previous
      ? { ...previous, recentCalls: [...previous.recentCalls], recentResults: [...previous.recentResults], recentResources: [...previous.recentResources] }
      : {
          version: 1, recentCalls: [], recentResults: [], recentResources: [], observationCount: 0,
          noProgressToolCalls: 0, noProgressModelSteps: 0, checkpointRequested: false, checkpointCompleted: false
        }
    const fresh = input.observations.filter((observation) => !observation.replayed)
    for (const observation of fresh) {
      state.observationCount += 1
      state.recentCalls.push(observation.canonicalArgumentsDigest)
      state.recentResults.push(observation.resultDigest)
      if (observation.effect === 'read') state.recentResources.push(`${observation.capabilityClass}:${observation.resourceKeys.join(',')}`)
    }
    state.recentCalls = state.recentCalls.slice(-32)
    state.recentResults = state.recentResults.slice(-32)
    state.recentResources = state.recentResources.slice(-32)
    const hasProgress = input.progress.level !== 'none'
    if (hasProgress) {
      state.noProgressToolCalls = 0
      state.noProgressModelSteps = 0
    } else {
      state.noProgressToolCalls += fresh.length
      if (input.stage === 'model') state.noProgressModelSteps += 1
    }

    const repeatedCall = repeatedTail(state.recentCalls)
    if (repeatedCall >= 3) return this.terminate(state, 'exact_call_repetition')
    const latestResult = state.recentResults.at(-1)
    if (latestResult && occurrencesInWindow(state.recentResults, latestResult) >= 4) return this.terminate(state, 'repeated_result_digest')
    if (!state.checkpointRequested && state.recentResources.length >= 6 && distinctCount(state.recentResults.slice(-6)) === 6) {
      state.checkpointRequested = true
      return { action: 'checkpoint', reason: 'read_resource_churn', state }
    }
    if (!state.checkpointRequested && (state.noProgressToolCalls >= 12 || state.noProgressModelSteps >= 8)) {
      state.checkpointRequested = true
      return { action: 'checkpoint', reason: 'no_progress_window', state }
    }
    if (state.checkpointCompleted && state.noProgressModelSteps >= 2) return this.terminate(state, 'post_checkpoint_no_progress')
    return { action: 'allow', state }
  }

  markCheckpointCompleted(previous: LoopGovernorState): LoopGovernorState {
    return { ...previous, checkpointCompleted: true, noProgressModelSteps: 0 }
  }

  private terminate(state: LoopGovernorState, reason: string): LoopGovernorDecision {
    state.terminated = reason
    return { action: 'terminate', reason, state }
  }
}

function repeatedTail(values: readonly string[]): number {
  const last = values.at(-1)
  if (!last) return 0
  let count = 0
  for (let index = values.length - 1; index >= 0 && values[index] === last; index -= 1) count += 1
  return count
}

function distinctCount(values: readonly string[]): number {
  return new Set(values).size
}

function occurrencesInWindow(values: readonly string[], target: string): number {
  return values.slice(-16).filter((value) => value === target).length
}
