import { describe, expect, it } from 'vitest'
import { InMemoryDurableEngineStore } from '@qiongqi/adapter-storage'
import type { AgentGraph, GraphRunRecord, TaskScope } from '@qiongqi/contracts'
import {
  EventedV2MultiAgentRuntime,
  GraphGovernor,
  RootRunAggregateCoordinator,
  compileAgentGraph,
  createDurableEventedV2Stores
} from '@qiongqi/loop'

const scope: TaskScope = { ownerId: 'owner-approval', workspaceId: 'workspace-approval', taskId: 'task-approval' }
const createdAt = '2026-07-26T00:00:00.000Z'
const expiresAt = '2026-07-26T01:00:00.000Z'

describe('durable graph human checkpoints', () => {
  it('advances only the checkpoint resume edge after a valid approval', async () => {
    const fixture = await suspendedApprovalRun()
    const checkpoint = await fixture.governor.requestApproval({
      runId: fixture.runId,
      nodeId: 'approval',
      policyRevision: 1,
      evidenceRefs: ['evidence-1'],
      approvalScope: ['repository-write'],
      expiresAt
    })

    expect(checkpoint).toMatchObject({
      status: 'pending',
      runId: fixture.runId,
      nodeId: 'approval',
      resumeEdgeId: fixture.revision.edges.find((edge) => edge.condition === 'approved')?.edgeId
    })
    const waitingGraph = await fixture.store.loadGraphRun(fixture.runId)
    const waitingRoot = await fixture.store.loadRun(fixture.runId)
    expect(waitingRoot).toMatchObject({ status: 'waiting_approval' })
    expect(waitingRoot?.version).toBe(waitingGraph?.version)
    await expect(fixture.runtime.completeExternalNode({
      runId: fixture.runId,
      nodeId: 'approval',
      condition: 'approved'
    })).rejects.toThrow(/checkpoint|approval gate/)
    const resolvedEventedRun = await fixture.runtime.resolveApproval({
      checkpointId: checkpoint.checkpointId,
      resolutionToken: checkpoint.resolutionToken,
      graphRevision: fixture.revision.revision,
      decision: 'allow'
    })

    expect(resolvedEventedRun).toMatchObject({ status: 'completed', activeNodeId: 'done' })
    expect(new Set(resolvedEventedRun.events.map((event) => event.eventId)).size)
      .toBe(resolvedEventedRun.events.length)
    await expect(fixture.store.loadGraphRun(fixture.runId)).resolves.toMatchObject({
      status: 'completed', activeNodeIds: ['done']
    })
    const completedGraph = await fixture.store.loadGraphRun(fixture.runId)
    const completedRoot = await fixture.store.loadRun(fixture.runId)
    expect(completedRoot?.version).toBe(completedGraph?.version)
    await expect(fixture.store.loadHumanCheckpoint(checkpoint.checkpointId)).resolves.toMatchObject({
      status: 'allowed', resolvedAt: createdAt
    })
    const events = await fixture.store.listWorkGraphEvents(fixture.runId, 0, 100)
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'approval_requested', nodeId: 'approval' }),
      expect.objectContaining({ kind: 'approval_resolved', nodeId: 'approval' }),
      expect.objectContaining({ kind: 'edge_traversed', edgeId: checkpoint.resumeEdgeId })
    ]))
    expect(events.filter((event) => event.kind === 'edge_traversed' && event.nodeId === 'approval'))
      .toHaveLength(1)
  })

  it('rejects wrong revision and token without consuming a pending checkpoint', async () => {
    const fixture = await suspendedApprovalRun()
    const checkpoint = await fixture.governor.requestApproval({
      runId: fixture.runId,
      nodeId: 'approval',
      policyRevision: 1,
      evidenceRefs: [],
      approvalScope: ['repository-write'],
      expiresAt
    })

    await expect(fixture.governor.resolveApproval({
      checkpointId: checkpoint.checkpointId,
      resolutionToken: checkpoint.resolutionToken,
      graphRevision: fixture.revision.revision + 1,
      decision: 'allow'
    })).rejects.toThrow(/revision/)
    await expect(fixture.governor.resolveApproval({
      checkpointId: checkpoint.checkpointId,
      resolutionToken: 'wrong-token',
      graphRevision: fixture.revision.revision,
      decision: 'allow'
    })).rejects.toThrow(/token/)
    await expect(fixture.store.loadHumanCheckpoint(checkpoint.checkpointId)).resolves.toMatchObject({ status: 'pending' })
  })

  it('consumes an approval token once', async () => {
    const fixture = await suspendedApprovalRun()
    const checkpoint = await fixture.governor.requestApproval({
      runId: fixture.runId,
      nodeId: 'approval',
      policyRevision: 1,
      evidenceRefs: [],
      approvalScope: ['repository-write'],
      expiresAt
    })
    const resolution = {
      checkpointId: checkpoint.checkpointId,
      resolutionToken: checkpoint.resolutionToken,
      graphRevision: fixture.revision.revision,
      decision: 'allow' as const
    }

    await fixture.governor.resolveApproval(resolution)
    await expect(fixture.governor.resolveApproval(resolution)).rejects.toThrow(/consumed|pending/)
  })

  it('follows the explicit denied edge without accepting a caller-selected condition', async () => {
    const fixture = await suspendedApprovalRun()
    const checkpoint = await fixture.governor.requestApproval({
      runId: fixture.runId,
      nodeId: 'approval',
      policyRevision: 1,
      evidenceRefs: [],
      approvalScope: ['repository-write'],
      expiresAt
    })

    const denied = await fixture.governor.resolveApproval({
      checkpointId: checkpoint.checkpointId,
      resolutionToken: checkpoint.resolutionToken,
      graphRevision: fixture.revision.revision,
      decision: 'deny'
    })

    expect(denied).toMatchObject({ status: 'completed', activeNodeIds: ['denied'] })
    await expect(fixture.store.loadHumanCheckpoint(checkpoint.checkpointId)).resolves.toMatchObject({ status: 'denied' })
  })

  it('durably expires an approval and refuses an aborted graph run', async () => {
    const fixture = await suspendedApprovalRun({ nowIso: expiresAt })
    const expired = await fixture.governor.requestApproval({
      runId: fixture.runId,
      nodeId: 'approval',
      policyRevision: 1,
      evidenceRefs: [],
      approvalScope: ['repository-write'],
      expiresAt
    })
    await expect(fixture.governor.resolveApproval({
      checkpointId: expired.checkpointId,
      resolutionToken: expired.resolutionToken,
      graphRevision: fixture.revision.revision,
      decision: 'allow'
    })).rejects.toThrow(/expired/)
    await expect(fixture.store.loadHumanCheckpoint(expired.checkpointId)).resolves.toMatchObject({ status: 'expired' })
    await expect(fixture.store.loadGraphRun(fixture.runId)).resolves.toMatchObject({
      status: 'completed', activeNodeIds: ['expired']
    })

    const cancelledFixture = await suspendedApprovalRun()
    const cancelled = await cancelledFixture.governor.requestApproval({
      runId: cancelledFixture.runId,
      nodeId: 'approval',
      policyRevision: 1,
      evidenceRefs: [],
      approvalScope: ['repository-write'],
      expiresAt
    })
    const current = (await cancelledFixture.store.loadGraphRun(cancelledFixture.runId))!
    await abortGraphRun(cancelledFixture.store, cancelledFixture.coordinator, current)
    await expect(cancelledFixture.governor.resolveApproval({
      checkpointId: cancelled.checkpointId,
      resolutionToken: cancelled.resolutionToken,
      graphRevision: cancelledFixture.revision.revision,
      decision: 'allow'
    })).rejects.toThrow(/aborted|cancelled/)
  })
})

async function suspendedApprovalRun(options: { nowIso?: string } = {}) {
  const store = new InMemoryDurableEngineStore()
  const graph = approvalGraph()
  const revision = compileAgentGraph(graph, { revision: 1, publishedAt: createdAt })
  const coordinator = new RootRunAggregateCoordinator({ store, nowIso: () => options.nowIso ?? createdAt })
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
    nowIso: () => createdAt
  })
  const started = await runtime.start({
    threadId: 'thread-approval', turnId: 'turn-approval', workspaceKey: 'workspace-approval', prompt: 'Approve.'
  })
  const waiting = await runtime.completeAgentTask({ runId: started.runId, agentId: 'manager', condition: 'completed' })
  expect(waiting).toMatchObject({ status: 'suspended', activeNodeId: 'approval' })
  const governor = new GraphGovernor({
    store,
    graphRevision: revision,
    rootAggregate: coordinator,
    ids: nextId(),
    nowIso: () => options.nowIso ?? createdAt
  })
  return {
    store,
    coordinator,
    revision,
    runId: started.runId,
    governor,
    runtime: new EventedV2MultiAgentRuntime({
      ...durable,
      graph,
      ids: nextId(),
      nowIso: () => options.nowIso ?? createdAt,
      approvalGovernor: governor
    })
  }
}

function approvalGraph(): AgentGraph {
  return {
    version: 1,
    graphId: 'approval-graph',
    startNodeId: 'manager',
    nodes: [
      { id: 'manager', kind: 'agent', agentId: 'manager' },
      { id: 'approval', kind: 'wait', waitFor: 'approval' },
      { id: 'done', kind: 'terminate' },
      { id: 'denied', kind: 'terminate' },
      { id: 'expired', kind: 'terminate' }
    ],
    edges: [
      { from: 'manager', to: 'approval', condition: 'completed' },
      { from: 'approval', to: 'done', condition: 'approved' },
      { from: 'approval', to: 'denied', condition: 'denied' },
      { from: 'approval', to: 'expired', condition: 'expired' }
    ]
  }
}

async function abortGraphRun(
  store: InMemoryDurableEngineStore,
  coordinator: RootRunAggregateCoordinator,
  current: GraphRunRecord
): Promise<void> {
  const lease = await store.acquireLease(current.runId, 'cancel-worker', 30_000)
  if (!lease) throw new Error('failed to acquire cancellation lease')
  try {
    await coordinator.requestCancel(current.runId, lease)
    await coordinator.finalizeCancel(current.runId, lease)
  } finally {
    await store.releaseLease(current.runId, lease)
  }
}

function nextId(): (prefix: string) => string {
  let value = 0
  return (prefix) => `${prefix}-${++value}`
}
