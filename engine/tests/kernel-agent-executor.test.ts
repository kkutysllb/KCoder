import { describe, expect, it } from 'vitest'
import { InMemoryDurableEngineStore } from '@qiongqi/adapter-storage'
import { KernelAgentExecutor } from '@qiongqi/loop'
import type { EngineRunRecord } from '@qiongqi/ports'

const scope = { ownerId: 'owner', workspaceId: 'workspace', taskId: 'layered-task' }
const budget = { stepsUsed: 4, toolCallsUsed: 4, inputTokens: 100, outputTokens: 100, costUsd: 1 }
const actual = { stepsUsed: 1, toolCallsUsed: 2, inputTokens: 40, outputTokens: 12, costUsd: 0.25 }

function parent(): EngineRunRecord {
  return {
    runId: 'multi-run', scope, multiAgentRunId: 'multi-run', version: 1, status: 'created', desiredState: 'running',
    cursor: { nodeId: 'agent-node', stepIndex: 0, checkpointSeq: 0 }, parentRef: { kind: 'multi_agent', runId: 'multi-run' },
    budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    budgetLimits: { stepsUsed: 10, toolCallsUsed: 10, inputTokens: 1000, outputTokens: 1000, costUsd: 10 },
    createdAt: '2026-07-26T00:00:00.000Z', updatedAt: '2026-07-26T00:00:00.000Z'
  }
}

async function waitForStatus(store: InMemoryDurableEngineStore, runId: string, status: EngineRunRecord['status']) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const run = await store.loadRun(runId)
    if (run?.status === status) return run
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(`run ${runId} did not reach ${status}`)
}

describe('KernelAgentExecutor', () => {
  it('creates one isolated child identity and completes through durable outbox', async () => {
    const store = new InMemoryDurableEngineStore()
    await store.commit({ scope, runId: 'multi-run', expectedRunVersion: 0, expectedTaskRevision: 0, runMutation: { type: 'put', record: parent() } })
    const executionRef = {
      scope,
      parentKind: 'agent' as const,
      multiAgentRunId: 'multi-run',
      agentRunId: 'agent-1',
      parentRunId: 'agent-1',
      kernelRunId: 'kernel-1'
    }
    await store.commit({
      scope,
      runId: 'multi-run',
      expectedRunVersion: 1,
      expectedTaskRevision: 0,
      budgetReservationMutations: [{
        type: 'reserve',
        record: {
          reservationId: 'reservation:kernel-1', scope, parentRunId: 'multi-run', childRunId: 'kernel-1',
          status: 'reserved', reserved: budget,
          createdAt: '2026-07-26T00:00:00.000Z', updatedAt: '2026-07-26T00:00:00.000Z'
        }
      }]
    })
    let kernelStarts = 0
    const executor = new KernelAgentExecutor({
      store,
      ids: () => { throw new Error('executor must not allocate Kernel identity') },
      nowIso: () => '2026-07-26T00:00:00.000Z',
      startKernel: async () => {
        kernelStarts += 1
        return {
          outcome: { status: 'completed', reason: 'normal_stop', retryable: false },
          usage: actual,
          usageRefs: ['usage:kernel-1'],
          artifactRefs: ['artifact:kernel-1']
        }
      }
    })
    const executed = await executor.execute({
      scope, multiAgentRunId: 'multi-run', agentRunId: 'agent-1', agentId: 'specialist', nodeId: 'specialist-node',
      parentRunId: 'multi-run', requestedBudget: budget, prompt: 'inspect', executionRef,
      reservationId: 'reservation:kernel-1'
    })
    expect(executed.executionRef).toEqual(executionRef)
    const child = await waitForStatus(store, 'kernel-1', 'completed')
    expect(child?.status).toBe('completed')
    await expect(store.loadBudgetReservations('multi-run')).resolves.toMatchObject([{
      status: 'settled',
      reserved: budget,
      actual
    }])
    expect(await store.claimWork('worker', ['agent_execution_completed'], 1000)).toMatchObject({
      workId: 'agent_execution_completed:kernel-1',
      payload: {
        usageRefs: ['usage:kernel-1'],
        artifactRefs: ['artifact:kernel-1']
      }
    })
    await expect(executor.execute({
      scope, multiAgentRunId: 'multi-run', agentRunId: 'agent-1', agentId: 'specialist', nodeId: 'specialist-node',
      parentRunId: 'multi-run', requestedBudget: budget, prompt: 'inspect', executionRef,
      reservationId: 'reservation:kernel-1'
    })).resolves.toEqual({ executionRef })
    expect(kernelStarts).toBe(1)
  })

  it('rejects an existing child that contradicts the prepared identity', async () => {
    const store = new InMemoryDurableEngineStore()
    await store.commit({
      scope, runId: 'multi-run', expectedRunVersion: 0, expectedTaskRevision: 0,
      runMutation: { type: 'put', record: parent() }
    })
    await store.commit({
      scope, runId: 'multi-run', expectedRunVersion: 1, expectedTaskRevision: 0,
      budgetReservationMutations: [{
        type: 'reserve',
        record: {
          reservationId: 'reservation:kernel-conflict', scope, parentRunId: 'multi-run', childRunId: 'kernel-conflict',
          status: 'reserved', reserved: budget,
          createdAt: '2026-07-26T00:00:00.000Z', updatedAt: '2026-07-26T00:00:00.000Z'
        }
      }]
    })
    await store.commit({
      scope, runId: 'kernel-conflict', expectedRunVersion: 0, expectedTaskRevision: 0,
      runMutation: {
        type: 'put',
        record: {
          runId: 'kernel-conflict', scope, multiAgentRunId: 'multi-run', agentRunId: 'different-agent-run',
          kernelRunId: 'kernel-conflict', version: 1, status: 'created', desiredState: 'running',
          cursor: { nodeId: 'specialist-node', stepIndex: 0, checkpointSeq: 0 },
          parentRef: { kind: 'agent', runId: 'different-agent-run' },
          budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
          budgetLimits: budget,
          createdAt: '2026-07-26T00:00:00.000Z', updatedAt: '2026-07-26T00:00:00.000Z'
        }
      }
    })
    const executionRef = {
      scope, parentKind: 'agent' as const, multiAgentRunId: 'multi-run', agentRunId: 'agent-1',
      parentRunId: 'agent-1', kernelRunId: 'kernel-conflict'
    }
    const executor = new KernelAgentExecutor({
      store,
      ids: () => 'unused',
      startKernel: async () => { throw new Error('must not start a conflicting child') }
    })

    await expect(executor.execute({
      scope, multiAgentRunId: 'multi-run', agentRunId: 'agent-1', agentId: 'specialist', nodeId: 'specialist-node',
      parentRunId: 'multi-run', requestedBudget: budget, prompt: 'inspect', executionRef,
      reservationId: 'reservation:kernel-conflict'
    })).rejects.toThrow(/identity|contradicts|match/i)
  })
})
