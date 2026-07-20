import { describe, expect, it } from 'vitest'
import { defaultLoopPlan, type LoopPhaseKind } from '@qiongqi/loop'

describe('LoopPlan', () => {
  it('defaultLoopPlan contains the expected ordered phases', () => {
    const plan = defaultLoopPlan()
    expect(plan.version).toBe(1)
    expect(plan.phases.map((p) => p.kind)).toEqual<LoopPhaseKind[]>([
      'build-prompt', 'run-model', 'decide', 'evaluate', 'dispatch-tools'
    ])
  })

  it('marks decide as terminal', () => {
    const plan = defaultLoopPlan()
    const decide = plan.phases.find((p) => p.kind === 'decide')
    expect(decide?.terminal).toBe(true)
  })

  it('evaluate phase has a retry budget', () => {
    const plan = defaultLoopPlan()
    const evaluate = plan.phases.find((p) => p.kind === 'evaluate')
    expect(typeof evaluate?.maxRetries).toBe('number')
    expect((evaluate?.maxRetries ?? 0) > 0).toBe(true)
  })

  it('sets a maxSteps budget', () => {
    const plan = defaultLoopPlan()
    expect(plan.budget?.maxSteps).toBeGreaterThan(0)
  })

  it('is JSON-serialisable (round-trip)', () => {
    const plan = defaultLoopPlan()
    const round = JSON.parse(JSON.stringify(plan))
    expect(round).toEqual(plan)
  })
})
