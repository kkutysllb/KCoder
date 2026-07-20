import { describe, expect, it } from 'vitest'
import { InMemoryEventBus, InMemoryRunEventStore, InMemorySessionStore } from '@qiongqi/adapter-storage'
import { RuntimeEventRecorder } from '@qiongqi/services'
import type { RunEventEnvelope } from '@qiongqi/contracts'

it('records kernel events through the runtime event recorder boundary', async () => {
  const runEvents = new InMemoryRunEventStore()
  const recorder = new RuntimeEventRecorder({
    eventBus: new InMemoryEventBus(),
    sessionStore: new InMemorySessionStore(),
    allocateSeq: () => 1,
    nowIso: () => '2026-07-15T00:00:00.000Z',
    runEventStore: runEvents
  })
  const event: RunEventEnvelope = {
    eventId: 'event-1', seq: 1, ownerUserId: 'u1', workspaceKey: 'w1', threadId: 't1', turnId: 'tu1', runId: 'r1',
    eventType: 'run.created', payload: {}, timestamp: '2026-07-15T00:00:00.000Z'
  }
  await expect(recorder.recordKernelEvent(event)).resolves.toEqual(event)
  await expect(runEvents.listAfter({ ownerUserId: 'u1', workspaceKey: 'w1', threadId: 't1', turnId: 'tu1', runId: 'r1' }, 0)).resolves.toHaveLength(1)
})
