import { describe, expect, it } from 'vitest'
import { InMemoryDurableEngineStore } from '@qiongqi/adapter-storage'
import { KernelAgentExecutor } from '@qiongqi/loop'
import type { EngineRunRecord } from '@qiongqi/ports'

const scope = { ownerId: 'owner-resume', workspaceId: 'workspace-resume', taskId: 'task-resume' }
const timestamp = '2026-07-26T00:00:00.000Z'
const requested = { stepsUsed: 4, toolCallsUsed: 2, inputTokens: 200, outputTokens: 100, costUsd: 1 }
const suspendedUsage = { stepsUsed: 1, toolCallsUsed: 0, inputTokens: 40, outputTokens: 4, costUsd: 0.1 }
const completedUsage = { stepsUsed: 2, toolCallsUsed: 1, inputTokens: 75, outputTokens: 16, costUsd: 0.3 }

function parentRun(): EngineRunRecord {
  return {
    runId: 'multi-resume', scope, multiAgentRunId: 'multi-resume', version: 1,
    status: 'running', desiredState: 'running',
    cursor: { nodeId: 'agent', stepIndex: 0, checkpointSeq: 0 },
    budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    budgetLimits: { stepsUsed: 10, toolCallsUsed: 10, inputTokens: 1_000, outputTokens: 1_000, costUsd: 10 },
    createdAt: timestamp, updatedAt: timestamp
  }
}

async function waitForRun(store: InMemoryDurableEngineStore, runId: string, status: EngineRunRecord['status']) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const run = await store.loadRun(runId)
    if (run?.status === status) return run
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(`run ${runId} did not reach ${status}`)
}

describe('durable Kernel resume', () => {
  it('validates and consumes a durable suspension token exactly once across executor restart', async () => {
    const store = new InMemoryDurableEngineStore()
    await store.commit({
      scope, runId: 'multi-resume', expectedRunVersion: 0, expectedTaskRevision: 0,
      runMutation: { type: 'put', record: parentRun() }
    })
    const preparedExecutionRef = {
      scope,
      parentKind: 'agent' as const,
      multiAgentRunId: 'multi-resume',
      agentRunId: 'agent-resume',
      parentRunId: 'agent-resume',
      kernelRunId: 'kernel-resume'
    }
    await store.commit({
      scope,
      runId: 'multi-resume',
      expectedRunVersion: 1,
      expectedTaskRevision: 0,
      budgetReservationMutations: [{
        type: 'reserve',
        record: {
          reservationId: 'reservation:kernel-resume', scope, parentRunId: 'multi-resume', childRunId: 'kernel-resume',
          status: 'reserved', reserved: requested, createdAt: timestamp, updatedAt: timestamp
        }
      }]
    })
    const first = new KernelAgentExecutor({
      store,
      ids: (prefix) => prefix === 'kernel_run' ? 'kernel-resume' : 'resume-token',
      nowIso: () => timestamp,
      startKernel: async () => ({
        outcome: { status: 'suspended', reason: 'awaiting_user_input', retryable: true },
        usage: suspendedUsage,
        usageRefs: ['usage:suspended'],
        artifactRefs: []
      })
    })
    const { executionRef } = await first.execute({
      scope, multiAgentRunId: 'multi-resume', agentRunId: 'agent-resume', agentId: 'agent', nodeId: 'agent',
      parentRunId: 'multi-resume', requestedBudget: requested, prompt: 'wait for input',
      executionRef: preparedExecutionRef,
      reservationId: 'reservation:kernel-resume'
    })
    const waiting = await waitForRun(store, executionRef.kernelRunId, 'waiting_input')
    expect(waiting.suspension).toMatchObject({
      token: 'resume-token', reason: 'awaiting_user_input', revision: 1, requestedAt: timestamp
    })
    await expect(store.loadBudgetReservations('multi-resume')).resolves.toMatchObject([{
      status: 'reserved', reserved: requested
    }])
    await expect(store.loadOutboxIntent('agent_execution_completed:kernel-resume')).resolves.toBeUndefined()

    const resumedInputs: unknown[] = []
    const restarted = new KernelAgentExecutor({
      store,
      ids: () => 'unused',
      nowIso: () => timestamp,
      startKernel: async () => { throw new Error('startKernel must not run during resume') },
      resumeKernel: async (input) => {
        resumedInputs.push(input)
        return {
          outcome: { status: 'completed', reason: 'normal_stop', retryable: false },
          usage: completedUsage,
          usageRefs: ['usage:completed'],
          artifactRefs: ['artifact:completed']
        }
      }
    })

    await expect(restarted.resume(executionRef, {
      token: 'wrong-token', revision: 1, resolution: { decision: 'verified' }
    })).rejects.toThrow(/token/)
    await expect(restarted.resume(executionRef, {
      token: 'resume-token', revision: 2, resolution: { decision: 'verified' }
    })).rejects.toThrow(/revision/)
    await restarted.resume(executionRef, {
      token: 'resume-token', revision: 1, resolution: { decision: 'verified' }
    })

    expect(resumedInputs).toEqual([{
      executionRef,
      suspension: waiting.suspension,
      resolution: { decision: 'verified' }
    }])
    await expect(store.loadRun(executionRef.kernelRunId)).resolves.toMatchObject({
      version: 4, status: 'completed', suspension: undefined, outcome: { status: 'completed' }
    })
    await expect(store.loadBudgetReservations('multi-resume')).resolves.toMatchObject([{
      status: 'settled', reserved: requested, actual: completedUsage
    }])
    await expect(store.loadOutboxIntent('agent_execution_completed:kernel-resume')).resolves.toMatchObject({
      payload: { usageRefs: ['usage:completed'], artifactRefs: ['artifact:completed'] }
    })
    await expect(restarted.resume(executionRef, {
      token: 'resume-token', revision: 1, resolution: { decision: 'verified' }
    })).rejects.toThrow(/not waiting|consumed/)
    expect(resumedInputs).toHaveLength(1)
  })
})
