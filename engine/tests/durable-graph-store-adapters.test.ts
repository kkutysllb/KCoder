import { describe, expect, it } from 'vitest'
import { InMemoryDurableEngineStore } from '@qiongqi/adapter-storage'
import type { AgentGraph, TaskScope } from '@qiongqi/contracts'
import {
  EventedV2MultiAgentRuntime,
  compileAgentGraph,
  createDurableEventedV2Stores,
  defaultManagerSpecialistGraph,
  RootRunAggregateCoordinator
} from '@qiongqi/loop'

const timestamp = '2026-07-26T00:00:00.000Z'
const scope: TaskScope = { ownerId: 'owner-1', workspaceId: 'workspace-1', taskId: 'task-1' }

describe('durable evented_v2 store adapters', () => {
  it('prepares all parallel Agent dispatches in one governed root version', async () => {
    const store = new InMemoryDurableEngineStore()
    const graph = parallelAgentsGraph()
    const revision = compileAgentGraph(graph, { revision: 1, publishedAt: timestamp })
    const coordinator = new RootRunAggregateCoordinator({ store, nowIso: () => timestamp })
    const durable = createDurableEventedV2Stores({
      store,
      scope,
      graphRevision: revision,
      rootAggregate: {
        coordinator,
        budgetLimits: { stepsUsed: 10, toolCallsUsed: 10, inputTokens: 1_000, outputTokens: 1_000, costUsd: 10 },
        policyRevision: 1
      }
    })
    const runtime = new EventedV2MultiAgentRuntime({
      ...durable,
      graph,
      ids: nextId(),
      nowIso: () => timestamp,
      dispatchPreparer: durable.runs
    })
    const run = await runtime.start({
      threadId: 'thread-parallel', turnId: 'turn-parallel', workspaceKey: 'workspace-1', prompt: 'Parallel.'
    })
    const fannedOut = await runtime.completeAgentTask({
      runId: run.runId, agentId: 'manager', condition: 'completed'
    })
    const before = await coordinator.load(run.runId)

    const prepared = await runtime.dispatchParallelAgents({
      runId: run.runId,
      scope,
      prompt: 'Execute branch work.',
      requestedBudgets: {
        draft: { stepsUsed: 1, toolCallsUsed: 1, inputTokens: 100, outputTokens: 100, costUsd: 1 },
        research: { stepsUsed: 1, toolCallsUsed: 1, inputTokens: 100, outputTokens: 100, costUsd: 1 },
        review: { stepsUsed: 1, toolCallsUsed: 1, inputTokens: 100, outputTokens: 100, costUsd: 1 }
      }
    })

    const after = await coordinator.load(run.runId)
    expect(after.graphRun.version).toBe(before.graphRun.version + 1)
    expect(after.engineRun.version).toBe(after.graphRun.version)
    expect(after.graphRun.activeNodeIds).toEqual(['join_all', 'writer', 'researcher', 'reviewer'])
    expect(prepared.agentRuns.filter((agentRun) => agentRun.branchId).every((agentRun) => agentRun.executionRef)).toBe(true)
    expect(await store.loadBudgetReservations(run.runId)).toHaveLength(3)
    expect((await store.listOutboxIntents(scope)).filter((intent) => intent.kind === 'agent_execution_requested'))
      .toHaveLength(3)
    expect(fannedOut.agentRuns.filter((agentRun) => agentRun.branchId).every((agentRun) => !agentRun.executionRef)).toBe(true)
  })

  it('rolls back the complete parallel prepare when aggregate budget is insufficient', async () => {
    const store = new InMemoryDurableEngineStore()
    const graph = parallelAgentsGraph()
    const revision = compileAgentGraph(graph, { revision: 1, publishedAt: timestamp })
    const coordinator = new RootRunAggregateCoordinator({ store, nowIso: () => timestamp })
    const durable = createDurableEventedV2Stores({
      store,
      scope,
      graphRevision: revision,
      rootAggregate: {
        coordinator,
        budgetLimits: { stepsUsed: 2, toolCallsUsed: 2, inputTokens: 200, outputTokens: 200, costUsd: 2 },
        policyRevision: 1
      }
    })
    const runtime = new EventedV2MultiAgentRuntime({
      ...durable, graph, ids: nextId(), nowIso: () => timestamp, dispatchPreparer: durable.runs
    })
    const run = await runtime.start({
      threadId: 'thread-budget', turnId: 'turn-budget', workspaceKey: 'workspace-1', prompt: 'Parallel.'
    })
    await runtime.completeAgentTask({ runId: run.runId, agentId: 'manager', condition: 'completed' })
    const version = (await coordinator.load(run.runId)).graphRun.version

    await expect(runtime.dispatchParallelAgents({
      runId: run.runId,
      scope,
      prompt: 'Execute branch work.',
      requestedBudgets: Object.fromEntries(['draft', 'research', 'review'].map((branchId) => [branchId, {
        stepsUsed: 1, toolCallsUsed: 1, inputTokens: 100, outputTokens: 100, costUsd: 1
      }]))
    })).rejects.toThrow(/budget/i)

    const after = await coordinator.load(run.runId)
    expect(after.graphRun.version).toBe(version)
    expect(after.graphRun.eventedV2Run?.agentRuns.filter((agentRun) => agentRun.branchId)
      .every((agentRun) => !agentRun.executionRef)).toBe(true)
    expect(await store.loadBudgetReservations(run.runId)).toEqual([])
    expect((await store.listOutboxIntents(scope)).filter((intent) => intent.kind === 'agent_execution_requested'))
      .toEqual([])
  })

  it('persists fail-fast sibling cancellation intents before external Kernel cancellation', async () => {
    const store = new InMemoryDurableEngineStore()
    const graph = parallelAgentsGraph('fail_fast')
    const revision = compileAgentGraph(graph, { revision: 1, publishedAt: timestamp })
    const coordinator = new RootRunAggregateCoordinator({ store, nowIso: () => timestamp })
    const durable = createDurableEventedV2Stores({
      store,
      scope,
      graphRevision: revision,
      rootAggregate: {
        coordinator,
        budgetLimits: { stepsUsed: 10, toolCallsUsed: 10, inputTokens: 1_000, outputTokens: 1_000, costUsd: 10 },
        policyRevision: 1
      }
    })
    const runtime = new EventedV2MultiAgentRuntime({
      ...durable, graph, ids: nextId(), nowIso: () => timestamp, dispatchPreparer: durable.runs
    })
    const run = await runtime.start({
      threadId: 'thread-cancel', turnId: 'turn-cancel', workspaceKey: 'workspace-1', prompt: 'Parallel.'
    })
    await runtime.completeAgentTask({ runId: run.runId, agentId: 'manager', condition: 'completed' })
    const prepared = await runtime.dispatchParallelAgents({
      runId: run.runId,
      scope,
      prompt: 'Execute branch work.',
      requestedBudgets: Object.fromEntries(['draft', 'research', 'review'].map((branchId) => [branchId, {
        stepsUsed: 1, toolCallsUsed: 1, inputTokens: 100, outputTokens: 100, costUsd: 1
      }]))
    })
    const review = prepared.agentRuns.find((agentRun) => agentRun.branchId === 'review')!

    const failed = await runtime.completeAgentTask({
      runId: run.runId,
      branchId: 'review',
      agentRunId: review.agentRunId,
      agentId: review.agentId,
      executionRef: review.executionRef,
      condition: 'failed',
      status: 'failed',
      error: 'review failed',
      usageRefs: ['usage:review'],
      artifactRefs: []
    })

    expect(failed.agentRuns.filter((agentRun) => ['draft', 'research'].includes(agentRun.branchId ?? '')))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ branchId: 'draft', status: 'aborted' }),
        expect.objectContaining({ branchId: 'research', status: 'aborted' })
      ]))
    expect((await store.listOutboxIntents(scope))
      .filter((intent) => intent.kind === 'agent_execution_cancel_requested'))
      .toHaveLength(2)
  })

  it('atomically projects branch lifecycle events into the durable root stream', async () => {
    const store = new InMemoryDurableEngineStore()
    const graph = parallelAgentsGraph()
    const revision = compileAgentGraph(graph, { revision: 1, publishedAt: timestamp })
    const durable = createDurableEventedV2Stores({
      store,
      scope,
      graphRevision: revision,
      rootAggregate: {
        coordinator: new RootRunAggregateCoordinator({ store, nowIso: () => timestamp }),
        budgetLimits: { stepsUsed: 10, toolCallsUsed: 10, inputTokens: 1_000, outputTokens: 1_000, costUsd: 10 },
        policyRevision: 1
      }
    })
    const runtime = new EventedV2MultiAgentRuntime({
      ...durable, graph, ids: nextId(), nowIso: () => timestamp
    })
    const run = await runtime.start({
      threadId: 'thread-stream', turnId: 'turn-stream', workspaceKey: 'workspace-1', prompt: 'Parallel.'
    })

    await runtime.completeAgentTask({ runId: run.runId, agentId: 'manager', condition: 'completed' })

    const events = await store.readStream(`stream:${run.runId}`, 0, 100)
    expect(events.filter((event) => event.kind === 'branch.spawned')).toHaveLength(3)
    expect(events.filter((event) => event.kind === 'branch.started')).toEqual(expect.arrayContaining([
      expect.objectContaining({ multiAgentRunId: run.runId, branchId: 'draft' }),
      expect.objectContaining({ multiAgentRunId: run.runId, branchId: 'research' }),
      expect.objectContaining({ multiAgentRunId: run.runId, branchId: 'review' })
    ]))
  })

  it('persists GraphRun and root EngineRun through aggregate-backed mode', async () => {
    const store = new InMemoryDurableEngineStore()
    const graph = defaultManagerSpecialistGraph({ managerAgentId: 'manager', specialistAgentId: 'researcher' })
    const revision = compileAgentGraph(graph, { revision: 1, publishedAt: timestamp })
    const durable = createDurableEventedV2Stores({
      store,
      scope,
      graphRevision: revision,
      rootAggregate: {
        coordinator: new RootRunAggregateCoordinator({ store, nowIso: () => timestamp }),
        budgetLimits: { stepsUsed: 10, toolCallsUsed: 10, inputTokens: 1_000, outputTokens: 1_000, costUsd: 10 },
        policyRevision: 1
      }
    })
    const runtime = new EventedV2MultiAgentRuntime({
      ...durable,
      graph,
      ids: nextId(),
      nowIso: () => timestamp
    })

    const run = await runtime.start({
      threadId: 'thread-root',
      turnId: 'turn-root',
      workspaceKey: 'workspace-1',
      prompt: 'Persist the root aggregate.'
    })

    const graphRun = await store.loadGraphRun(run.runId)
    const engineRun = await store.loadRun(run.runId)
    expect(graphRun).toMatchObject({ runId: run.runId, version: 1 })
    expect(engineRun).toMatchObject({
      runId: run.runId,
      multiAgentRunId: run.runId,
      version: 1,
      budgetLimits: { stepsUsed: 10 }
    })
  })

  it('persists a pinned graph run and reconstructs it after adapter restart', async () => {
    const store = new InMemoryDurableEngineStore()
    const graph = defaultManagerSpecialistGraph({ managerAgentId: 'manager', specialistAgentId: 'researcher' })
    const revision = compileAgentGraph(graph, { revision: 1, publishedAt: timestamp })
    const durable = createDurableEventedV2Stores({ store, scope, graphRevision: revision })
    const runtime = new EventedV2MultiAgentRuntime({
      ...durable,
      graph,
      ids: nextId(),
      nowIso: () => timestamp
    })

    const run = await runtime.start({
      threadId: 'thread-1',
      turnId: 'turn-1',
      workspaceKey: 'workspace-1',
      prompt: 'Persist the graph run.'
    })

    await expect(store.loadGraphRun(run.runId)).resolves.toMatchObject({
      runId: run.runId,
      graphId: revision.graphId,
      graphRevision: revision.revision,
      graphDigest: revision.graphDigest,
      version: 1
    })
    await expect(store.listWorkGraphEvents(run.runId, 0, 10)).resolves.toMatchObject([
      { kind: 'run_started', nodeId: revision.startNodeId }
    ])

    const restarted = createDurableEventedV2Stores({ store, scope, graphRevision: revision })
    await expect(restarted.runs.load(run.runId)).resolves.toEqual(run)
    await expect(restarted.runs.loadVersion?.(run.runId)).resolves.toBe(0)
  })

  it('keeps mailbox claim and completion state across adapter restarts', async () => {
    const store = new InMemoryDurableEngineStore()
    const graph = defaultManagerSpecialistGraph({ managerAgentId: 'manager', specialistAgentId: 'researcher' })
    const revision = compileAgentGraph(graph, { revision: 1, publishedAt: timestamp })
    const durable = createDurableEventedV2Stores({ store, scope, graphRevision: revision })
    const runtime = new EventedV2MultiAgentRuntime({
      ...durable,
      graph,
      ids: nextId(),
      nowIso: () => timestamp
    })
    const run = await runtime.start({
      threadId: 'thread-1', turnId: 'turn-1', workspaceKey: 'workspace-1', prompt: 'Delegate.'
    })
    await runtime.handoff({
      runId: run.runId,
      sourceAgentId: 'manager',
      targetAgentId: 'researcher',
      prompt: 'Research durable graphs.'
    })

    const claimed = await durable.mailbox.claimNext('researcher', { holderId: 'worker-1', ttlMs: 30_000 })
    expect(claimed).toMatchObject({ status: 'delivered', claimLease: { holderId: 'worker-1', epoch: 1 } })

    const restarted = createDurableEventedV2Stores({ store, scope, graphRevision: revision })
    await expect(restarted.mailbox.listForRun(run.runId)).resolves.toMatchObject([
      { messageId: claimed!.messageId, status: 'delivered', claimLease: claimed!.claimLease }
    ])
    await restarted.mailbox.complete(claimed!.messageId, 'completed', claimed!.claimLease)
    const completed = await restarted.mailbox.listForRun(run.runId)
    expect(completed).toMatchObject([{ messageId: claimed!.messageId, status: 'completed' }])
    expect(completed[0]).not.toHaveProperty('claimLease')
  })

  it('records stable edge selection and traversal facts for deterministic handoff', async () => {
    const store = new InMemoryDurableEngineStore()
    const graph = defaultManagerSpecialistGraph({ managerAgentId: 'manager', specialistAgentId: 'researcher' })
    const revision = compileAgentGraph(graph, { revision: 1, publishedAt: timestamp })
    const durable = createDurableEventedV2Stores({ store, scope, graphRevision: revision })
    const runtime = new EventedV2MultiAgentRuntime({ ...durable, graph, ids: nextId(), nowIso: () => timestamp })
    const run = await runtime.start({
      threadId: 'thread-1', turnId: 'turn-1', workspaceKey: 'workspace-1', prompt: 'Delegate.'
    })
    await runtime.handoff({
      runId: run.runId,
      sourceAgentId: 'manager',
      targetAgentId: 'researcher',
      prompt: 'Research.'
    })

    const traversed = (await store.listWorkGraphEvents(run.runId, 0, 50))
      .filter((event) => event.kind === 'edge_traversed')
    expect(traversed.map((event) => event.edgeId)).toEqual(revision.edges.slice(0, 2).map((edge) => edge.edgeId))
    expect(traversed.every((event) => event.attemptId.length > 0)).toBe(true)
  })
})

function nextId(): (prefix: string) => string {
  let value = 0
  return (prefix) => `${prefix}-${++value}`
}

function parallelAgentsGraph(failurePolicy: 'wait_all' | 'fail_fast' = 'wait_all'): AgentGraph {
  return {
    version: 1,
    graphId: 'parallel_agents',
    startNodeId: 'manager',
    nodes: [
      { id: 'manager', kind: 'agent', agentId: 'manager' },
      {
        id: 'fan_out', kind: 'parallel', joinNodeId: 'join_all', failurePolicy,
        branches: [
          { branchId: 'research', startNodeId: 'researcher' },
          { branchId: 'draft', startNodeId: 'writer' },
          { branchId: 'review', startNodeId: 'reviewer' }
        ]
      },
      { id: 'researcher', kind: 'agent', agentId: 'researcher' },
      { id: 'writer', kind: 'agent', agentId: 'writer' },
      { id: 'reviewer', kind: 'agent', agentId: 'reviewer' },
      {
        id: 'join_all', kind: 'join', sourceParallelNodeId: 'fan_out',
        requiredBranchIds: ['research', 'draft', 'review'], outputPolicy: 'all'
      },
      { id: 'done', kind: 'terminate' },
      { id: 'failed_done', kind: 'terminate' }
    ],
    edges: [
      { from: 'manager', to: 'fan_out', condition: 'completed' },
      { from: 'researcher', to: 'join_all', condition: 'completed' },
      { from: 'researcher', to: 'join_all', condition: 'failed' },
      { from: 'writer', to: 'join_all', condition: 'completed' },
      { from: 'writer', to: 'join_all', condition: 'failed' },
      { from: 'reviewer', to: 'join_all', condition: 'completed' },
      { from: 'reviewer', to: 'join_all', condition: 'failed' },
      { from: 'join_all', to: 'done', condition: 'completed' },
      { from: 'join_all', to: 'failed_done', condition: 'failed' }
    ]
  }
}
