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

it('preserves degraded instead of mapping it to failed', async () => {
  const store = new InMemoryRunStateStore()
  const finished: string[] = []
  const runner = new KernelV3TurnRunner({
    snapshots: store,
    events: new InMemoryRunEventStore(),
    leases: store,
    holderId: 'test-degraded',
    identityForTurn: (threadId, turnId) => ({
      ownerUserId: 'owner-1', workspaceKey: '/workspace-1', threadId, turnId, runId: `run-${turnId}`
    }),
    nodes: {
      'prepare-turn': () => ({ outcome: { status: 'degraded', reason: 'no_progress', retryable: false } })
    },
    finishTurn: async (_threadId, _turnId, status) => { finished.push(status) }
  })

  await expect(runner.runTurn('thread-1', 'turn-degraded')).resolves.toBe('degraded')
  expect(finished).toEqual(['degraded'])
})

it('returns the exact persisted Kernel budget without changing runTurn compatibility', async () => {
  const store = new InMemoryRunStateStore()
  const runner = new KernelV3TurnRunner({
    snapshots: store,
    events: new InMemoryRunEventStore(),
    leases: store,
    holderId: 'test-detailed',
    identityForTurn: (threadId, turnId) => ({
      ownerUserId: 'owner-1', workspaceKey: '/workspace-1', threadId, turnId, runId: `run-${turnId}`
    }),
    nodes: {
      'prepare-turn': () => ({
        commands: [{
          type: 'add-budget',
          usageId: 'turn:turn-detailed',
          delta: {
            stepsUsed: 2,
            toolCallsUsed: 3,
            inputTokens: 120,
            outputTokens: 45,
            costUsd: 0.25
          }
        }],
        outcome: { status: 'completed', reason: 'normal_stop', retryable: false }
      })
    },
    finishTurn: async (_threadId, _turnId, status) => status
  })

  await expect(runner.runTurnDetailed('thread-1', 'turn-detailed')).resolves.toEqual({
    status: 'completed',
    budget: {
      stepsUsed: 2,
      toolCallsUsed: 3,
      inputTokens: 120,
      outputTokens: 45,
      costUsd: 0.25
    }
  })

  await expect(runner.runTurn('thread-1', 'turn-status-only')).resolves.toBe('completed')
})
