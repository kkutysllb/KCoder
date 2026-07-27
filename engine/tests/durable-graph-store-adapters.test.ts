import { describe, expect, it } from 'vitest'
import { InMemoryDurableEngineStore } from '@qiongqi/adapter-storage'
import type { TaskScope } from '@qiongqi/contracts'
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
