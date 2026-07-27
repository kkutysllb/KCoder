import { describe, expect, it } from 'vitest'
import { InMemoryDurableEngineStore } from '@qiongqi/adapter-storage'
import { DurableKernelLifecycle } from '@qiongqi/loop'
import type { EngineRunRecord } from '@qiongqi/ports'

const scope = { ownerId: 'owner-budget', workspaceId: 'workspace-budget', taskId: 'task-budget' }
const timestamp = '2026-07-26T00:00:00.000Z'

function parentRun(): EngineRunRecord {
  return {
    runId: 'multi-budget', scope, multiAgentRunId: 'multi-budget', version: 1,
    status: 'running', desiredState: 'running',
    cursor: { nodeId: 'dispatch', stepIndex: 0, checkpointSeq: 0 },
    budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    budgetLimits: { stepsUsed: 10, toolCallsUsed: 10, inputTokens: 1_000, outputTokens: 1_000, costUsd: 1 },
    createdAt: timestamp, updatedAt: timestamp
  }
}

describe('parent budget reservations', () => {
  it('atomically prevents concurrent children from over-reserving the parent budget', async () => {
    const store = new InMemoryDurableEngineStore()
    await store.commit({
      scope, runId: 'multi-budget', expectedRunVersion: 0, expectedTaskRevision: 0,
      runMutation: { type: 'put', record: parentRun() }
    })
    const lifecycle = new DurableKernelLifecycle({ store, nowIso: () => timestamp })
    const requested = {
      stepsUsed: 6, toolCallsUsed: 1, inputTokens: 100, outputTokens: 100, costUsd: 0.2
    }

    const results = await Promise.allSettled([
      lifecycle.reserveParentBudget({
        scope, parentRunId: 'multi-budget', childRunId: 'kernel-a', reservationId: 'reservation-a', requested
      }),
      lifecycle.reserveParentBudget({
        scope, parentRunId: 'multi-budget', childRunId: 'kernel-b', reservationId: 'reservation-b', requested
      })
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    await expect(store.loadBudgetReservations('multi-budget')).resolves.toHaveLength(1)
  })

  it('rejects actual usage above the reserved child budget without mutating durable state', async () => {
    const store = new InMemoryDurableEngineStore()
    await store.commit({
      scope, runId: 'multi-budget', expectedRunVersion: 0, expectedTaskRevision: 0,
      runMutation: { type: 'put', record: parentRun() }
    })
    const lifecycle = new DurableKernelLifecycle({ store, nowIso: () => timestamp })
    const requested = {
      stepsUsed: 2, toolCallsUsed: 1, inputTokens: 100, outputTokens: 100, costUsd: 0.2
    }
    await lifecycle.reserveParentBudget({
      scope, parentRunId: 'multi-budget', childRunId: 'kernel-over', reservationId: 'reservation-over', requested
    })
    const child: EngineRunRecord = {
      runId: 'kernel-over', scope, multiAgentRunId: 'multi-budget', agentRunId: 'agent-over', kernelRunId: 'kernel-over',
      version: 1, status: 'running', desiredState: 'running',
      cursor: { nodeId: 'model', stepIndex: 1, checkpointSeq: 0 },
      parentRef: { kind: 'agent', runId: 'agent-over' },
      budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
      budgetLimits: requested,
      createdAt: timestamp, updatedAt: timestamp
    }
    await store.commit({
      scope, runId: child.runId, expectedRunVersion: 0, expectedTaskRevision: 0,
      runMutation: { type: 'put', record: child }
    })

    await expect(lifecycle.completeKernelRun({
      scope,
      runId: child.runId,
      executionRef: {
        scope, parentKind: 'agent', multiAgentRunId: 'multi-budget', agentRunId: 'agent-over',
        parentRunId: 'agent-over', kernelRunId: child.runId
      },
      outcome: { status: 'completed', reason: 'normal_stop', retryable: false },
      usage: { ...requested, outputTokens: requested.outputTokens + 1 },
      usageRefs: [],
      artifactRefs: [],
      reservationId: 'reservation-over'
    })).rejects.toThrow(/reserved budget.*outputTokens/)
    await expect(store.loadRun(child.runId)).resolves.toMatchObject({ version: 1, status: 'running' })
    await expect(store.loadBudgetReservations('multi-budget')).resolves.toMatchObject([{
      reservationId: 'reservation-over', status: 'reserved'
    }])
    expect((await store.loadBudgetReservations('multi-budget'))[0]).not.toHaveProperty('actual')
  })
})
