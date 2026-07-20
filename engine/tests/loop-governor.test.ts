import { describe, expect, it } from 'vitest'
import { LoopGovernor } from '@qiongqi/loop'
import type { ToolObservation } from '@qiongqi/contracts'

const base: ToolObservation = {
  callId: 'c', toolName: 'read', effect: 'read', capabilityClass: 'filesystem.read',
  resourceKeys: ['data/a.json'], canonicalArgumentsDigest: 'same-call', resultDigest: 'same-result',
  resultItemId: 'item', artifactRefs: [], failed: false, replayed: false
}

describe('persisted loop governor', () => {
  it('terminates exact canonical call repetition after three no-progress observations', () => {
    const governor = new LoopGovernor()
    let state = undefined
    for (let index = 0; index < 2; index += 1) {
      const decision = governor.evaluate(state, { stage: 'tool', observations: [{ ...base, callId: `c${index}` }], progress: { level: 'none', digest: 'none' } })
      state = decision.state
      expect(decision.action).toBe('allow')
    }
    const decision = governor.evaluate(state, { stage: 'tool', observations: [{ ...base, callId: 'c3' }], progress: { level: 'none', digest: 'none' } })
    expect(decision.action).toBe('terminate')
    expect(decision.reason).toBe('exact_call_repetition')
  })

  it('requests one checkpoint for read churn and then terminates only after post-checkpoint no progress', () => {
    const governor = new LoopGovernor()
    let state = undefined
    let decision!: ReturnType<LoopGovernor['evaluate']>
    for (let index = 0; index < 6; index += 1) {
      decision = governor.evaluate(state, { stage: 'tool', observations: [{ ...base, callId: `c${index}`, canonicalArgumentsDigest: `call-${index}`, resultDigest: `result-${index}` }], progress: { level: 'none', digest: 'none' } })
      state = decision.state
    }
    expect(decision.action).toBe('checkpoint')
    state = governor.markCheckpointCompleted(state)
    decision = governor.evaluate(state, { stage: 'model', observations: [], progress: { level: 'none', digest: 'none' } })
    state = decision.state
    expect(decision.action).toBe('allow')
    decision = governor.evaluate(state, { stage: 'model', observations: [], progress: { level: 'none', digest: 'none' } })
    expect(decision.action).toBe('terminate')
    expect(decision.reason).toBe('post_checkpoint_no_progress')
  })

  it('ignores replayed effects and isolates progress by persisted state input', () => {
    const governor = new LoopGovernor()
    const replay = governor.evaluate(undefined, { stage: 'tool', observations: [{ ...base, replayed: true }], progress: { level: 'none', digest: 'none' } })
    expect(replay.action).toBe('allow')
    expect(replay.state.observationCount).toBe(0)
  })
})
