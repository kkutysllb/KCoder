import { describe, expect, it } from 'vitest'
import { TurnEventBus, runStepViaEventBus } from '@qiongqi/loop'
import type { TurnStepEvent } from '@qiongqi/loop'

describe('runStepViaEventBus', () => {
  it('publishes step boundary events that subscribers can observe', async () => {
    const bus = new TurnEventBus()
    const seen: TurnStepEvent[] = []
    bus.on('step:start', async (event) => {
      seen.push(event)
    })
    bus.on('step:end', async (event) => {
      seen.push(event)
    })

    const status = await runStepViaEventBus({
      eventBus: bus,
      threadId: 'thr_1',
      turnId: 'turn_1',
      signal: new AbortController().signal,
      deps: {
        promptBuilder: {
          build: async () => ({ kind: 'stop' }),
          recordPromptPressure: () => undefined
        },
        modelStepRunner: {},
        coordinator: {},
        events: {},
        turns: {},
        ids: {}
      } as never
    }, 3)

    expect(status).toBe('stop')
    expect(seen).toEqual([
      { kind: 'step:start', stepIndex: 3 },
      { kind: 'step:end', status: 'completed' }
    ])
  })
})
