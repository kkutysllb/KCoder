import { expect, it } from 'vitest'
import { InMemoryRunEventStore, InMemoryRunStateStore } from '@qiongqi/adapter-storage'
import { KernelV3TurnRunner } from '@qiongqi/loop'

it('runs the production graph without accepting a classic delegate', async () => {
  const store = new InMemoryRunStateStore()
  const finished: string[] = []
  const runner = new KernelV3TurnRunner({
    snapshots: store,
    events: new InMemoryRunEventStore(),
    leases: store,
    holderId: 'test',
    identityForTurn: (threadId, turnId) => ({
      ownerUserId: 'owner-1',
      workspaceKey: '/workspace-1',
      threadId,
      turnId,
      runId: `run-${turnId}`
    }),
    nodes: {
      'prepare-turn': () => ({ outcome: { status: 'completed', reason: 'normal_stop', retryable: false } })
    },
    finishTurn: async (_threadId, _turnId, status) => {
      finished.push(status)
    }
  })

  await expect(runner.runTurn('thread-1', 'turn-1')).resolves.toBe('completed')
  expect(finished).toEqual(['completed'])
})
