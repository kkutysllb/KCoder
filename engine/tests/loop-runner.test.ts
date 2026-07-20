import { describe, expect, it } from 'vitest'
import { LoopRunner, TurnEventBus, defaultLoopPlan, defaultLoopEvaluator } from '@qiongqi/loop'
import type { TurnStepEvent, LoopRun } from '@qiongqi/loop'

function mkRun(): LoopRun {
  return {
    version: 2, threadId: 't1', turnId: 'tu1', stepIndex: 0, phaseCursor: 0,
    events: [], items: [], status: 'running',
    startedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

function mkDeps(over: Record<string, unknown> = {}) {
  return {
    promptBuilder: {
      build: async () => ({
        kind: 'built',
        ctx: {
          request: { messages: [] },
          model: 'm', modelCapabilities: {}, thread: {}, turn: {},
          healedItems: [], activePlanContext: undefined, effectiveMode: 'agent',
          approvalPolicy: 'auto', planTurnActive: false, allowedToolNames: undefined,
          activeSkillIds: [], activeGoalInstruction: null, toolSpecs: [],
          toolProviderMetadata: new Map(), toolProviderKinds: new Map(),
          toolKinds: new Map(), toolCatalogDrift: {},
          attachments: { imageAttachments: [], textFallbacks: [] }
        }
      }),
      recordPromptPressure: () => undefined
    },
    modelStepRunner: {
      run: async () => ({
        kind: 'ran', text: 'done', textItemId: 'i', reasoning: '', reasoningItemId: 'r',
        completedToolCalls: [], stopReason: 'stop'
      })
    },
    coordinator: { dispatch: async () => 'dispatched' },
    evaluator: defaultLoopEvaluator,
    events: { record: async () => undefined },
    turns: { applyItem: async () => undefined },
    ids: { next: (p: string) => `id_${p}` },
    ...over
  } as never
}

describe('LoopRunner.step', () => {
  it('emits step:start, prompt:built, model:ran, decision, step:end on a clean stop', async () => {
    const deps = mkDeps()
    const runner = new LoopRunner(deps)
    const bus = new TurnEventBus()
    const seen: TurnStepEvent[] = []
    for (const kind of ['step:start', 'prompt:built', 'model:ran', 'decision', 'step:end'] as const) {
      bus.on(kind, async (e) => { seen.push(e); return })
    }
    const outcome = await runner.step({
      run: mkRun(), plan: defaultLoopPlan(), signal: new AbortController().signal,
      stepIndex: 0, bus
    })
    expect(outcome.action).toBe('stop')
    const kinds = seen.map((e) => e.kind)
    expect(kinds).toEqual(['step:start', 'prompt:built', 'model:ran', 'decision', 'step:end'])
  })

  it('returns continue and dispatches tool calls on a tool_calls stop', async () => {
    const deps = mkDeps({
      modelStepRunner: {
        run: async () => ({
          kind: 'ran', text: '', textItemId: 'i', reasoning: '', reasoningItemId: 'r',
          completedToolCalls: [{ callId: 'c1', toolName: 'ls', arguments: {} }],
          stopReason: 'tool_calls'
        })
      }
    })
    const runner = new LoopRunner(deps)
    const bus = new TurnEventBus()
    const outcome = await runner.step({
      run: mkRun(), plan: defaultLoopPlan(), signal: new AbortController().signal,
      stepIndex: 0, bus
    })
    expect(outcome.action).toBe('continue')
  })

  it('appends events to LoopRun.events', async () => {
    const deps = mkDeps()
    const runner = new LoopRunner(deps)
    const bus = new TurnEventBus()
    const run = mkRun()
    await runner.step({ run, plan: defaultLoopPlan(), signal: new AbortController().signal, stepIndex: 0, bus })
    expect(run.events.length).toBeGreaterThan(0)
    expect(run.events[0].kind).toBe('step:start')
  })

  it('returns aborted when signal is already aborted', async () => {
    const deps = mkDeps()
    const runner = new LoopRunner(deps)
    const bus = new TurnEventBus()
    const ac = new AbortController()
    ac.abort()
    const outcome = await runner.step({
      run: mkRun(), plan: defaultLoopPlan(), signal: ac.signal, stepIndex: 0, bus
    })
    expect(outcome.action).toBe('aborted')
  })

  it('returns retry on truncated output then stop on second attempt', async () => {
    let calls = 0
    const deps = mkDeps({
      modelStepRunner: {
        run: async () => {
          calls += 1
          if (calls === 1) {
            return {
              kind: 'ran', text: 'half', textItemId: 'i', reasoning: '', reasoningItemId: 'r',
              completedToolCalls: [], stopReason: 'length'
            }
          }
          return {
            kind: 'ran', text: 'done', textItemId: 'i', reasoning: '', reasoningItemId: 'r',
            completedToolCalls: [], stopReason: 'stop'
          }
        }
      }
    })
    const runner = new LoopRunner(deps)
    const bus = new TurnEventBus()
    const run = mkRun()
    const o1 = await runner.step({ run, plan: defaultLoopPlan(), signal: new AbortController().signal, stepIndex: 0, bus })
    expect(o1.action).toBe('retry')
    const o2 = await runner.step({ run, plan: defaultLoopPlan(), signal: new AbortController().signal, stepIndex: 0, bus })
    expect(o2.action).toBe('stop')
  })

  it('does not retry truncated output when the plan omits the evaluate phase', async () => {
    const deps = mkDeps({
      modelStepRunner: {
        run: async () => ({
          kind: 'ran', text: 'half', textItemId: 'i', reasoning: '', reasoningItemId: 'r',
          completedToolCalls: [], stopReason: 'length'
        })
      }
    })
    const runner = new LoopRunner(deps)
    const bus = new TurnEventBus()
    const run = mkRun()
    const plan = {
      ...defaultLoopPlan(),
      phases: defaultLoopPlan().phases.filter((phase) => phase.kind !== 'evaluate')
    }
    const outcome = await runner.step({ run, plan, signal: new AbortController().signal, stepIndex: 0, bus })

    expect(outcome.action).toBe('stop')
    expect(run.events.some((event) => event.kind === 'step:retry')).toBe(false)
  })
})
