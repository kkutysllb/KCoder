import { expect, it } from 'vitest'
import { InMemoryRunEventStore, InMemoryRunStateStore } from '@qiongqi/adapter-storage'

it('isolates runtime events and snapshots by owner/workspace/thread/turn/run', async () => {
  const events = new InMemoryRunEventStore()
  const snapshots = new InMemoryRunStateStore()
  const a = { ownerUserId: 'a', workspaceKey: 'w', threadId: 't', turnId: 'tu', runId: 'r' }
  const b = { ...a, ownerUserId: 'b' }
  await events.append({ eventId: 'e-a', seq: 1, ...a, eventType: 'node.completed', payload: {}, timestamp: 'now' })
  expect(await events.listAfter(b, 0)).toEqual([])
  await snapshots.save({ version: 3, graphVersion: 'g', runtimeMode: 'kernel_v3', ...a, status: 'running', cursor: { stepIndex: 0, nodeId: 'n', attempt: 0, checkpointSeq: 0 }, budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }, recovery: { attempts: 0, maxAttempts: 1 }, middleware: {}, pendingEffects: [], committedEffects: [], createdAt: 'now', updatedAt: 'now' })
  expect(await snapshots.load(b)).toBeUndefined()
})
