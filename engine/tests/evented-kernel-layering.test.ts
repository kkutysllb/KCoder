import { describe, expect, it } from 'vitest'
import {
  compileAgentGraph,
  createDurableEventedV2Stores,
  EventedV2MultiAgentRuntime,
  KernelAgentExecutor,
  RootRunAggregateCoordinator
} from '@qiongqi/loop'
import { InMemoryDurableEngineStore, InMemoryMailboxStore, InMemoryMultiAgentRunStore } from '@qiongqi/adapter-storage'
import type { AgentGraph } from '@qiongqi/contracts'
import type { EngineRunRecord } from '@qiongqi/ports'

const graph: AgentGraph = {
  version: 1,
  graphId: 'layered-graph',
  startNodeId: 'agent-node',
  nodes: [
    {
      id: 'agent-node',
      kind: 'agent',
      agentId: 'specialist',
      nodePolicyRef: { policyId: 'specialist-policy', revision: 2 }
    },
    { id: 'terminate', kind: 'terminate' }
  ],
  edges: [{ from: 'agent-node', to: 'terminate', condition: 'completed' }]
}

describe('evented_v2 + Kernel layering', () => {
  it('persists a governed dispatch before invoking Kernel', async () => {
    const store = new InMemoryDurableEngineStore()
    const revision = compileAgentGraph(graph, { revision: 1, publishedAt: '2026-07-26T00:00:00.000Z' })
    const durable = createDurableEventedV2Stores({
      store,
      scope: { ownerId: 'owner', workspaceId: 'workspace', taskId: 'prepare-first' },
      graphRevision: revision,
      rootAggregate: {
        coordinator: new RootRunAggregateCoordinator({ store, nowIso: () => '2026-07-26T00:00:00.000Z' }),
        budgetLimits: { stepsUsed: 10, toolCallsUsed: 10, inputTokens: 1_000, outputTokens: 1_000, costUsd: 10 },
        policyRevision: 1
      }
    })
    const seen: string[] = []
    const executor = {
      async execute() { seen.push('kernel'); return { executionRef: undefined as never } },
      async resume() {},
      async cancel() {}
    }
    const runtime = new EventedV2MultiAgentRuntime({
      ...durable,
      graph,
      ids: (prefix) => `${prefix}-prepared`,
      nowIso: () => '2026-07-26T00:00:00.000Z',
      agentExecutor: executor,
      dispatchPreparer: durable.runs
    })
    const run = await runtime.start({
      threadId: 'thread-prepare', turnId: 'turn-prepare', workspaceKey: 'workspace', prompt: 'prepare this work'
    })

    const prepared = await runtime.dispatchActiveAgent({
      runId: run.runId,
      scope: { ownerId: 'owner', workspaceId: 'workspace', taskId: 'prepare-first' },
      prompt: 'prepare this work',
      requestedBudget: { stepsUsed: 2, toolCallsUsed: 2, inputTokens: 100, outputTokens: 50, costUsd: 1 }
    })
    const retried = await runtime.dispatchActiveAgent({
      runId: run.runId,
      scope: { ownerId: 'owner', workspaceId: 'workspace', taskId: 'prepare-first' },
      prompt: 'prepare this work',
      requestedBudget: { stepsUsed: 2, toolCallsUsed: 2, inputTokens: 100, outputTokens: 50, costUsd: 1 }
    })

    expect(seen).toEqual([])
    expect(retried.agentRuns).toEqual(prepared.agentRuns)
    expect(prepared.agentRuns[0]?.executionRef).toMatchObject({ kernelRunId: 'kernel_run-prepared' })
    await expect(store.loadBudgetReservations(run.runId)).resolves.toMatchObject([{
      reservationId: 'reservation:kernel_run-prepared',
      childRunId: 'kernel_run-prepared',
      status: 'reserved'
    }])
    await expect(store.loadOutboxIntent('agent_execution_requested:kernel_run-prepared')).resolves.toMatchObject({
      status: 'pending',
      kind: 'agent_execution_requested',
      payload: {
        identity: { executionRef: { kernelRunId: 'kernel_run-prepared' } },
        reservationId: 'reservation:kernel_run-prepared'
      }
    })
    const root = await store.loadRun(run.runId)
    const graphRun = await store.loadGraphRun(run.runId)
    expect(root?.version).toBe(2)
    expect(graphRun?.version).toBe(2)
  })

  it('binds one Kernel child to an AgentRun and consumes duplicate completion once', async () => {
    const store = new InMemoryDurableEngineStore()
    const parent: EngineRunRecord = {
      runId: 'mar-1', scope: { ownerId: 'owner', workspaceId: 'workspace', taskId: 'layered' }, multiAgentRunId: 'mar-1', version: 1,
      status: 'created', desiredState: 'running', cursor: { nodeId: 'agent-node', stepIndex: 0, checkpointSeq: 0 },
      budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
      budgetLimits: { stepsUsed: 10, toolCallsUsed: 10, inputTokens: 1000, outputTokens: 1000, costUsd: 10 },
      createdAt: '2026-07-26T00:00:00.000Z', updatedAt: '2026-07-26T00:00:00.000Z'
    }
    await store.commit({ scope: parent.scope, runId: parent.runId, expectedRunVersion: 0, expectedTaskRevision: 0, runMutation: { type: 'put', record: parent } })
    await store.commit({
      scope: parent.scope,
      runId: parent.runId,
      expectedRunVersion: 1,
      expectedTaskRevision: 0,
      budgetReservationMutations: [{
        type: 'reserve',
        record: {
          reservationId: 'reservation:kernel_run-1',
          scope: parent.scope,
          parentRunId: parent.runId,
          childRunId: 'kernel_run-1',
          status: 'reserved',
          reserved: { stepsUsed: 1, toolCallsUsed: 1, inputTokens: 1, outputTokens: 1, costUsd: 1 },
          createdAt: '2026-07-26T00:00:00.000Z',
          updatedAt: '2026-07-26T00:00:00.000Z'
        }
      }]
    })
    let executionInput: Parameters<KernelAgentExecutor['execute']>[0] | undefined
    const executor = new KernelAgentExecutor({
      store,
      ids: () => 'kernel-1',
      startKernel: async (input) => {
        executionInput = input
        return {
        outcome: { status: 'completed', reason: 'normal_stop', retryable: false },
        usage: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
        usageRefs: [],
        artifactRefs: []
        }
      }
    })
    const runtime = new EventedV2MultiAgentRuntime({
      runs: new InMemoryMultiAgentRunStore(), mailbox: new InMemoryMailboxStore(), graph, ids: (prefix) => `${prefix}-1`, nowIso: () => '2026-07-26T00:00:00.000Z', agentExecutor: executor
    })
    const run = await runtime.start({ threadId: 'thread', turnId: 'turn', workspaceKey: 'workspace', prompt: 'work' })
    const dispatched = await runtime.dispatchActiveAgent({ runId: run.runId, scope: parent.scope, prompt: 'work', requestedBudget: { stepsUsed: 1, toolCallsUsed: 1, inputTokens: 1, outputTokens: 1, costUsd: 1 } })
    expect(dispatched.agentRuns[0]?.executionRef?.kernelRunId).toBe('kernel_run-1')
    expect(executionInput).toMatchObject({
      threadId: 'thread',
      turnId: 'turn',
      workspaceKey: 'workspace',
      nodePolicyRef: { policyId: 'specialist-policy', revision: 2 }
    })
    const completion = { executionRef: dispatched.agentRuns[0]!.executionRef!, outcome: { status: 'completed', reason: 'normal_stop', retryable: false }, usageRefs: [], artifactRefs: [] }
    await runtime.consumeKernelCompletion({ runId: run.runId, completion })
    const twice = await runtime.consumeKernelCompletion({ runId: run.runId, completion })
    expect(twice.status).toBe('completed')
  })
})
