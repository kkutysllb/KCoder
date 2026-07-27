import { describe, expect, it } from 'vitest'
import { decideDuplicateAction, nextDuplicateCount } from '@qiongqi/loop'

describe('duplicate governor', () => {
  it('replays the first exact or semantic duplicate without physical execution', () => {
    expect(decideDuplicateAction({
      duplicateCount: 1,
      strategyChanged: false,
      progressChanged: false,
      exactResultRef: 'result://exact'
    })).toEqual({ action: 'replay', resultRef: 'result://exact' })
    expect(decideDuplicateAction({
      duplicateCount: 1,
      strategyChanged: false,
      progressChanged: false,
      semanticResultRef: 'result://semantic'
    })).toEqual({ action: 'suppress_semantic', resultRef: 'result://semantic' })
  })

  it('does not treat a revision-only change as a new strategy', () => {
    expect(decideDuplicateAction({ duplicateCount: 2, strategyChanged: false, progressChanged: false }))
      .toEqual({ action: 'replay_and_require_strategy_change', nextStrategyRevision: 2 })
  })

  it('checkpoints for convergence on the third duplicate', () => {
    expect(decideDuplicateAction({ duplicateCount: 3, strategyChanged: true, progressChanged: false }))
      .toEqual({ action: 'checkpoint_and_converge' })
  })

  it('terminates after the convergence attempt still makes no progress', () => {
    expect(decideDuplicateAction({ duplicateCount: 4, strategyChanged: true, progressChanged: false }).action)
      .toBe('degrade_no_progress')
  })

  it('executes after real progress or a corrected second-attempt strategy', () => {
    expect(decideDuplicateAction({ duplicateCount: 4, strategyChanged: false, progressChanged: true }))
      .toEqual({ action: 'execute' })
    expect(decideDuplicateAction({ duplicateCount: 2, strategyChanged: true, progressChanged: false }))
      .toEqual({ action: 'execute' })
  })

  it('resets only for progress or graph retry while resume preserves the counter', () => {
    expect(nextDuplicateCount({ current: 2, event: 'resume', progressChanged: false })).toBe(2)
    expect(nextDuplicateCount({ current: 2, event: 'duplicate', progressChanged: false })).toBe(3)
    expect(nextDuplicateCount({ current: 2, event: 'duplicate', progressChanged: true })).toBe(0)
    expect(nextDuplicateCount({ current: 2, event: 'graph_retry', progressChanged: false })).toBe(0)
  })
})
