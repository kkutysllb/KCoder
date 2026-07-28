import { describe, expect, it } from 'vitest'
import {
  InMemoryEventBus,
  InMemorySessionStore,
  InMemoryThreadStore
} from '@qiongqi/adapter-storage'
import { createThreadRecord, makeAssistantTextItem } from '@qiongqi/domain'
import type { ModelClient, OutputValidatorRegistry } from '@qiongqi/ports'
import { SequentialIdGenerator } from '@qiongqi/ports'
import { ContextCompactor, InflightTracker, SteeringQueue } from '@qiongqi/loop'
import { RuntimeEventRecorder, TurnService } from '@qiongqi/services'
import { bootstrapThread, makeHarness } from './loop-test-harness.js'

const validatorRef = {
  validatorId: 'finance-report',
  revision: 2,
  digest: 'a'.repeat(64)
}

const executionPolicy = {
  policyId: 'product.agent.finance',
  revision: 3,
  skills: { allowedSkillIds: [], requiredSkillIds: [] },
  tools: { allowedToolNames: [] },
  output: { validatorRef }
}

async function harness(outputValidators?: OutputValidatorRegistry) {
  const bus = new InMemoryEventBus()
  const threadStore = new InMemoryThreadStore()
  const sessionStore = new InMemorySessionStore()
  const ids = new SequentialIdGenerator()
  const nowIso = () => '2026-07-27T11:00:00.000Z'
  const events = new RuntimeEventRecorder({
    eventBus: bus,
    sessionStore,
    allocateSeq: (threadId) => bus.allocateSeq(threadId),
    nowIso
  })
  const turns = new TurnService({
    threadStore,
    sessionStore,
    events,
    inflight: new InflightTracker(),
    steering: new SteeringQueue(),
    compactor: new ContextCompactor(),
    ids,
    nowIso,
    ...(outputValidators ? { outputValidators } : {})
  })
  await threadStore.upsert(createThreadRecord({
    id: 'thread_output',
    title: 'Output validation',
    workspace: '/tmp/output',
    model: 'model-a',
    createdAt: nowIso()
  }))
  const started = await turns.startTurn({
    threadId: 'thread_output',
    request: { prompt: 'write report', executionPolicy }
  })
  await turns.applyItem('thread_output', makeAssistantTextItem({
    id: 'assistant_report',
    threadId: 'thread_output',
    turnId: started.turnId,
    text: 'durable report',
    status: 'completed'
  }))
  return { turns, turnId: started.turnId }
}

describe('turn output validator', () => {
  it('returns failed from the public turn runner when validation rejects completion', async () => {
    const model: ModelClient = {
      provider: 'fake',
      model: 'fake',
      async *stream() {
        yield { kind: 'assistant_text_delta', text: 'invalid report' }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
    const runtime = makeHarness(model, {
      outputValidators: {
        resolve: () => ({
          ref: validatorRef,
          validate: () => ({ ok: false, reason: 'runner-level rejection' })
        })
      }
    })
    await bootstrapThread(runtime, {
      request: { prompt: 'write report', executionPolicy }
    })

    const status = await runtime.loop.runTurn(runtime.threadId, runtime.turnId)

    expect(status).toBe('failed')
    expect((await runtime.turns.getTurn(runtime.threadId, runtime.turnId))?.error).toMatch(/runner-level rejection/)
  })

  it('validates the persisted output before completing the turn', async () => {
    let received: unknown
    const h = await harness({
      resolve: () => ({
        ref: validatorRef,
        validate(input) {
          received = input
          return { ok: true }
        }
      })
    })

    const result = await h.turns.finishTurn({
      threadId: 'thread_output',
      turnId: h.turnId,
      status: 'completed'
    })
    const stored = await h.turns.getTurn('thread_output', h.turnId)

    expect(result.status).toBe('completed')
    expect(received).toMatchObject({
      threadId: 'thread_output',
      turnId: h.turnId,
      outputText: 'durable report',
      assistantItemIds: ['assistant_report']
    })
    expect(stored?.outputValidation).toMatchObject({
      status: 'accepted',
      validatorRef
    })
  })

  it('fails closed when the validator rejects the output', async () => {
    const h = await harness({
      resolve: () => ({
        ref: validatorRef,
        validate: () => ({ ok: false, reason: 'required finance evidence is incomplete' })
      })
    })

    const result = await h.turns.finishTurn({
      threadId: 'thread_output',
      turnId: h.turnId,
      status: 'completed'
    })
    const stored = await h.turns.getTurn('thread_output', h.turnId)

    expect(result.status).toBe('failed')
    expect(stored).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/required finance evidence is incomplete/),
      outputValidation: { status: 'rejected' }
    })
  })

  it('fails closed when the configured validator is unavailable', async () => {
    const h = await harness()

    const result = await h.turns.finishTurn({
      threadId: 'thread_output',
      turnId: h.turnId,
      status: 'completed'
    })

    expect(result.status).toBe('failed')
    expect((await h.turns.getTurn('thread_output', h.turnId))?.error).toMatch(/output validator unavailable/i)
  })

  it('fails closed when the registry returns a different validator identity', async () => {
    const h = await harness({
      resolve: () => ({
        ref: { ...validatorRef, revision: 3 },
        validate: () => ({ ok: true })
      })
    })

    const result = await h.turns.finishTurn({
      threadId: 'thread_output',
      turnId: h.turnId,
      status: 'completed'
    })

    expect(result.status).toBe('failed')
    expect((await h.turns.getTurn('thread_output', h.turnId))?.error).toMatch(/identity mismatch/i)
  })

  it('fails closed when the validator throws', async () => {
    const h = await harness({
      resolve: () => ({
        ref: validatorRef,
        validate: () => { throw new Error('validator crashed') }
      })
    })

    const result = await h.turns.finishTurn({
      threadId: 'thread_output',
      turnId: h.turnId,
      status: 'completed'
    })

    expect(result.status).toBe('failed')
    expect((await h.turns.getTurn('thread_output', h.turnId))?.error).toMatch(/validator crashed/i)
  })
})
