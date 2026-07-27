import { describe, expect, it } from 'vitest'
import { InMemoryDurableEngineStore } from '@qiongqi/adapter-storage'
import {
  compileAgentGraph,
  createDurableEventedV2Stores,
  DurableKernelLifecycle,
  EventedV2MultiAgentRuntime,
  RootRunAggregateCoordinator
} from '@qiongqi/loop'
import type { AgentGraph } from '@qiongqi/contracts'
import type { EngineRunRecord } from '@qiongqi/ports'

const scope = { ownerId: 'owner-outbox', workspaceId: 'workspace-outbox', taskId: 'task-outbox' }
const timestamp = '2026-07-26T00:00:00.000Z'

const graph: AgentGraph = {
  version: 1,
  graphId: 'completion-outbox',
  startNodeId: 'agent',
  nodes: [
    { id: 'agent', kind: 'agent', agentId: 'worker' },
    { id: 'done', kind: 'terminate' }
  ],
  edges: [{ from: 'agent', to: 'done', condition: 'completed' }]
}

describe('Kernel completion outbox', () => {
  it('commits the child outcome and advances evented_v2 once for duplicate delivery', async () => {
    const durableStore = new InMemoryDurableEngineStore()
    const revision = compileAgentGraph(graph, { revision: 1, publishedAt: timestamp })
    const coordinator = new RootRunAggregateCoordinator({ store: durableStore, nowIso: () => timestamp })
    const durable = createDurableEventedV2Stores({
      store: durableStore,
      scope,
      graphRevision: revision,
      rootAggregate: {
        coordinator,
        budgetLimits: { stepsUsed: 10, toolCallsUsed: 10, inputTokens: 1_000, outputTokens: 1_000, costUsd: 10 },
        policyRevision: 1
      }
    })
    let id = 0
    const runtime = new EventedV2MultiAgentRuntime({
      ...durable,
      graph,
      ids: (prefix) => `${prefix}-${++id}`,
      nowIso: () => timestamp,
      dispatchPreparer: durable.runs
    })
    const multiRun = await runtime.start({
      threadId: 'thread-outbox', turnId: 'turn-outbox', workspaceKey: 'workspace-outbox', prompt: 'run'
    })
    const requested = { stepsUsed: 4, toolCallsUsed: 4, inputTokens: 100, outputTokens: 100, costUsd: 1 }
    const prepared = await runtime.dispatchActiveAgent({
      runId: multiRun.runId,
      scope,
      prompt: 'run',
      requestedBudget: requested
    })
    const agentRun = prepared.agentRuns[0]!
    const executionRef = agentRun.executionRef!
    const child: EngineRunRecord = {
      runId: executionRef.kernelRunId, scope, multiAgentRunId: multiRun.runId, agentRunId: agentRun.agentRunId,
      kernelRunId: executionRef.kernelRunId, version: 1, status: 'running', desiredState: 'running',
      cursor: { nodeId: 'complete', stepIndex: 2, checkpointSeq: 3 },
      parentRef: { kind: 'agent', runId: agentRun.agentRunId },
      budgets: { stepsUsed: 2, toolCallsUsed: 1, inputTokens: 20, outputTokens: 5, costUsd: 0.02 },
      budgetLimits: requested,
      createdAt: timestamp, updatedAt: timestamp
    }
    await durableStore.commit({
      scope, runId: child.runId, expectedRunVersion: 0, expectedTaskRevision: 0,
      runMutation: { type: 'put', record: child }
    })
    const lifecycle = new DurableKernelLifecycle({ store: durableStore, nowIso: () => timestamp })
    await lifecycle.completeKernelRun({
      scope,
      runId: child.runId,
      executionRef,
      outcome: { status: 'completed', reason: 'normal_stop', retryable: false },
      usage: child.budgets,
      usageRefs: ['usage-outbox'],
      artifactRefs: [],
      reservationId: `reservation:${executionRef.kernelRunId}`
    })
    const claim = await durableStore.claimWork('evented-worker', ['agent_execution_completed'], 10_000)
    expect(claim?.payload).toBeDefined()

    const first = await runtime.consumeKernelCompletion({ runId: multiRun.runId, completion: claim!.payload })
    const firstGraph = await durableStore.loadGraphRun(multiRun.runId)
    const firstRoot = await durableStore.loadRun(multiRun.runId)
    const second = await runtime.consumeKernelCompletion({ runId: multiRun.runId, completion: claim!.payload })
    const secondGraph = await durableStore.loadGraphRun(multiRun.runId)
    const secondRoot = await durableStore.loadRun(multiRun.runId)
    expect(first.status).toBe('completed')
    expect(second).toEqual(first)
    expect(second.events.filter((event) => event.type === 'node_completed')).toHaveLength(1)
    expect(first.budgets).toEqual(child.budgets)
    expect(firstGraph?.budgets).toEqual(child.budgets)
    expect(firstRoot?.budgets).toEqual(child.budgets)
    expect(firstRoot?.cursor.stepIndex).toBe(1)
    expect(secondGraph?.version).toBe(firstGraph?.version)
    expect(secondRoot?.version).toBe(firstRoot?.version)
  })
})
