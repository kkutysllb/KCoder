import { describe, expect, it } from 'vitest'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  EventedTurnOrchestrator,
  FileTurnStateStore,
  TurnEventBus,
  defaultLoopPlan,
  defaultLoopEvaluator
} from '@qiongqi/loop'
import { makeHarness, makeSilentModel, bootstrapThread } from './loop-test-harness.js'
import type { ModelStreamChunk } from '@qiongqi/ports'
import { buildDefaultLocalTools, CREATE_PLAN_TOOL_NAME } from '@qiongqi/adapter-tools'

function tempDir(): string {
  const r = Math.random().toString(36).slice(2)
  return join(tmpdir(), `qiongqi-evented-${r}`)
}

function makeEventedHarness(model = makeSilentModel()) {
  const base = makeHarness(model, { tools: buildDefaultLocalTools() })
  const dir = tempDir()
  const serializer = new FileTurnStateStore(dir)
  const bus = new TurnEventBus()
  const loop = new EventedTurnOrchestrator(
    {
      threadStore: base.threadStore,
      sessionStore: base.sessionStore,
      approvalGate: base.approvalGate,
      userInputGate: base.userInputGate,
      model,
      toolHost: base.toolHost,
      usage: base.usage,
      events: base.events,
      turns: base.turns,
      inflight: base.inflight,
      steering: base.steering,
      compactor: base.compactor,
      prefix: base.prefix,
      ids: base.ids,
      nowIso: base.nowIso,
      nowMs: base.nowMs
    },
    serializer,
    bus,
    defaultLoopPlan(),
    defaultLoopEvaluator
  )
  return { base, loop, serializer, dir, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

describe('EventedTurnOrchestrator (declarative loop)', () => {
  it('completes a simple turn via the LoopRunner', async () => {
    const h = makeEventedHarness()
    try {
      await bootstrapThread(h.base)
      const status = await h.loop.runTurn(h.base.threadId, h.base.turnId)
      expect(status).toBe('completed')
    } finally {
      await h.cleanup()
    }
  })

  it('deletes persisted state after completion', async () => {
    const h = makeEventedHarness()
    try {
      await bootstrapThread(h.base)
      await h.loop.runTurn(h.base.threadId, h.base.turnId)
      const leftover = await h.serializer.load(h.base.threadId, h.base.turnId)
      expect(leftover).toBeUndefined()
    } finally {
      await h.cleanup()
    }
  })

  it('retries truncated output on the same step and then completes', async () => {
    let calls = 0
    const h = makeEventedHarness({
      provider: 'truncating',
      model: 'truncating',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        calls += 1
        if (calls === 1) {
          yield { kind: 'assistant_text_delta', text: 'half' }
          yield { kind: 'completed', stopReason: 'length' }
          return
        }
        yield { kind: 'assistant_text_delta', text: 'done' }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    })
    try {
      const stepStarts: number[] = []
      const retries: number[] = []
      await bootstrapThread(h.base)
      ;(h.loop as unknown as { eventBus: { on: (kind: string, fn: (event: unknown) => Promise<void>) => void } })
        .eventBus.on('step:start', async (event) => {
          stepStarts.push((event as { stepIndex: number }).stepIndex)
        })
      ;(h.loop as unknown as { eventBus: { on: (kind: string, fn: (event: unknown) => Promise<void>) => void } })
        .eventBus.on('step:retry', async (event) => {
          retries.push((event as { attempt: number }).attempt)
        })

      const status = await h.loop.runTurn(h.base.threadId, h.base.turnId)

      expect(status).toBe('completed')
      expect(calls).toBe(2)
      expect(stepStarts).toEqual([0, 0])
      expect(retries).toEqual([1])
    } finally {
      await h.cleanup()
    }
  })

  it('preserves required-tool-missing errors in evented mode', async () => {
    const h = makeEventedHarness({
      provider: 'planner',
      model: 'planner',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        yield { kind: 'completed', stopReason: 'stop' }
      }
    })
    try {
      await bootstrapThread(h.base, {
        request: {
          prompt: 'Plan auth',
          guiPlan: {
            operation: 'draft',
            workspaceRoot: '/tmp',
            relativePath: '.qiongqisdd/plan/auth.md',
            planId: '/tmp:.qiongqisdd/plan/auth.md',
            sourceRequest: 'Add auth'
          }
        }
      })

      const status = await h.loop.runTurn(h.base.threadId, h.base.turnId)
      const items = await h.base.sessionStore.loadItems(h.base.threadId)
      const events = await h.base.sessionStore.loadEventsSince(h.base.threadId, 0)

      expect(status).toBe('failed')
      expect(items.some((item) => item.kind === 'error' && item.code === 'required_tool_missing')).toBe(true)
      expect(events.some((event) => event.kind === 'error' && event.code === 'required_tool_missing')).toBe(true)
      expect(events.some((event) => event.kind === 'error' && event.code === 'evaluator_fail')).toBe(false)
      expect(
        items.some((item) => item.kind === 'tool_call' && item.toolName === CREATE_PLAN_TOOL_NAME)
      ).toBe(false)
    } finally {
      await h.cleanup()
    }
  })
})
