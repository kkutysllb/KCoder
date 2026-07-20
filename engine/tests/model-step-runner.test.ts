import { describe, expect, it } from 'vitest'
import {
  bootstrapThread,
  makeFakeModel,
  makeHarness
} from './loop-test-harness.js'

describe('ModelStepRunner', () => {
  it('records usage and emits a usage event', async () => {
    const h = makeHarness(
      makeFakeModel([
        {
          kind: 'usage',
          usage: {
            promptTokens: 12,
            completionTokens: 4,
            totalTokens: 16,
            cachedTokens: 6,
            cacheHitTokens: 6,
            cacheMissTokens: 6,
            cacheHitRate: 0.5,
            turns: 1
          }
        },
        { kind: 'completed', stopReason: 'stop' }
      ])
    )
    await bootstrapThread(h)
    const seen: number[] = []
    h.bus.subscribe(h.threadId, (event) => {
      if (event.kind === 'usage') seen.push(event.seq)
    })
    await h.loop.runTurn(h.threadId, h.turnId)
    expect(seen.length).toBeGreaterThan(0)
    const replay = await h.sessionStore.loadEventsSince(h.threadId, 0)
    expect(replay.some((event) => event.kind === 'usage')).toBe(true)
  })

  it('persists assistant text deltas for SSE replay before the final item', async () => {
    const h = makeHarness(
      makeFakeModel([
        { kind: 'assistant_text_delta', text: 'he' },
        { kind: 'assistant_text_delta', text: 'llo' },
        { kind: 'completed', stopReason: 'stop' }
      ])
    )
    await bootstrapThread(h)
    await h.loop.runTurn(h.threadId, h.turnId)
    const replay = await h.sessionStore.loadEventsSince(h.threadId, 0)
    const deltas = replay.filter((event) => event.kind === 'assistant_text_delta')
    expect(deltas).toHaveLength(2)
    const items = await h.sessionStore.loadItems(h.threadId)
    expect(items.some((item) => item.kind === 'assistant_text' && item.text === 'hello')).toBe(true)
  })

  it('persists completed reasoning before completed assistant text', async () => {
    const h = makeHarness(
      makeFakeModel([
        { kind: 'assistant_reasoning_delta', text: 'thinking' },
        { kind: 'assistant_text_delta', text: 'answer' },
        { kind: 'completed', stopReason: 'stop' }
      ])
    )
    await bootstrapThread(h)
    await h.loop.runTurn(h.threadId, h.turnId)

    const itemKinds = (await h.sessionStore.loadItems(h.threadId))
      .filter((item) => item.kind === 'assistant_reasoning' || item.kind === 'assistant_text')
      .map((item) => item.kind)

    expect(itemKinds).toEqual(['assistant_reasoning', 'assistant_text'])
  })
})
