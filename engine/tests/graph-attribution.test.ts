import { describe, expect, it } from 'vitest'
import { InMemoryDurableEngineStore } from '@qiongqi/adapter-storage'
import {
  CostEntrySchema,
  GraphAttributionSchema,
  UsageSnapshotSchema,
  ValueEventSchema,
  type GraphRunRecord,
  type TaskScope
} from '@qiongqi/contracts'
import { compileAgentGraph, EngineValueLedger } from '@qiongqi/loop'

const scope: TaskScope = { ownerId: 'owner-attribution', workspaceId: 'workspace-attribution', taskId: 'task-attribution' }
const startedAt = '2026-07-26T00:00:00.000Z'
const finishedAt = '2026-07-26T00:00:04.000Z'

describe('graph attribution', () => {
  it('validates graph attribution without requiring private execution context', () => {
    const graph = GraphAttributionSchema.parse({
      graphId: 'graph-attribution', graphRevision: 1, runId: 'graph-run',
      nodeId: 'agent-a', edgeId: 'edge-a-b', attemptId: 'attempt-1'
    })
    expect(graph).toEqual({
      graphId: 'graph-attribution', graphRevision: 1, runId: 'graph-run',
      nodeId: 'agent-a', edgeId: 'edge-a-b', attemptId: 'attempt-1'
    })
    expect(UsageSnapshotSchema.parse({ ...usage(1), graph }).graph).toEqual(graph)
    expect(CostEntrySchema.parse({
      costId: 'cost-contract', scope, amount: 1, currency: 'USD', source: 'model', incurredAt: finishedAt, graph
    }).graph).toEqual(graph)
    expect(ValueEventSchema.parse({
      valueId: 'value-contract', scope, amount: 3, currency: 'USD', source: 'caller', confidence: 1,
      evidenceRefs: [], recordedAt: finishedAt, graph
    }).graph).toEqual(graph)
  })

  it('attributes actual cost, retries, fan-out, avoided cost, and latency to a graph revision', async () => {
    const store = new InMemoryDurableEngineStore()
    const revision = compileAgentGraph({
      version: 1,
      graphId: 'graph-attribution',
      startNodeId: 'agent-a',
      nodes: [
        { id: 'agent-a', kind: 'agent', agentId: 'agent-a' },
        { id: 'agent-b', kind: 'agent', agentId: 'agent-b' },
        { id: 'agent-c', kind: 'agent', agentId: 'agent-c' }
      ],
      edges: [
        { from: 'agent-a', to: 'agent-b', condition: 'branch-b' },
        { from: 'agent-a', to: 'agent-c', condition: 'branch-c' }
      ]
    }, { revision: 1, publishedAt: startedAt })
    const run: GraphRunRecord = {
      schemaVersion: 1, scope, runId: 'graph-run', threadId: 'thread', turnId: 'turn', workspaceKey: 'workspace',
      graphId: revision.graphId, graphRevision: revision.revision, graphDigest: revision.graphDigest,
      version: 1, status: 'completed', circuitState: 'running', activeNodeIds: [],
      budgets: { stepsUsed: 3, toolCallsUsed: 0, inputTokens: 200, outputTokens: 100, costUsd: 2 },
      createdAt: startedAt, updatedAt: finishedAt
    }
    const [edgeB, edgeC] = revision.edges
    await store.commit({
      scope, runId: run.runId, expectedRunVersion: 0, expectedTaskRevision: 0,
      graphRevisionMutations: [{ type: 'put', record: revision }],
      graphRunMutation: { type: 'put', record: run },
      workGraphEvents: [
        event('run-started', 'run_started', 'run', startedAt),
        event('a-1-start', 'node_started', 'a-1', startedAt, { nodeId: 'agent-a' }),
        event('a-1-failed', 'node_failed', 'a-1', '2026-07-26T00:00:01.000Z', { nodeId: 'agent-a' }),
        event('a-2-start', 'node_started', 'a-2', '2026-07-26T00:00:01.000Z', { nodeId: 'agent-a' }),
        event('a-2-complete', 'node_completed', 'a-2', '2026-07-26T00:00:02.000Z', { nodeId: 'agent-a' }),
        event('edge-b', 'edge_traversed', 'a-2', '2026-07-26T00:00:02.000Z', { nodeId: 'agent-a', edgeId: edgeB!.edgeId }),
        event('edge-c', 'edge_traversed', 'a-2', '2026-07-26T00:00:02.000Z', { nodeId: 'agent-a', edgeId: edgeC!.edgeId }),
        event('b-start', 'node_started', 'b-1', '2026-07-26T00:00:02.000Z', { nodeId: 'agent-b' }),
        event('c-start', 'node_started', 'c-1', '2026-07-26T00:00:02.000Z', { nodeId: 'agent-c' }),
        event('c-complete', 'node_completed', 'c-1', '2026-07-26T00:00:03.000Z', { nodeId: 'agent-c' }),
        event('b-complete', 'node_completed', 'b-1', finishedAt, { nodeId: 'agent-b' }),
        event('run-complete', 'run_completed', 'run', finishedAt)
      ],
      ledgerMutations: [{ type: 'append', record: {
        kind: 'model', operationId: 'model-replayed', scope, kernelRunId: 'kernel-replayed',
        graph: {
          graphId: revision.graphId, graphRevision: revision.revision, graphDigest: revision.graphDigest,
          nodeId: 'agent-a', attemptId: 'a-2', callerId: 'caller', policyRevision: 1
        },
        logicalRequestKey: 'logical-model', requestFingerprint: 'request-model', taskRevision: 0,
        contextRevision: 0, strategyRevision: 1, strategyDigest: 'strategy',
        profileRef: { profileId: 'profile', revision: 1 }, status: 'replayed',
        resultRef: 'result://model', usage: usage(0.75), createdAt: finishedAt, updatedAt: finishedAt
      } }],
      costMutations: [
        { type: 'append', record: cost('cost-a-1', 1, 'agent-a', 'a-1') },
        { type: 'append', record: cost('cost-a-2', 1, 'agent-a', 'a-2') }
      ]
    })

    const snapshot = await new EngineValueLedger({ store, scope, nowIso: () => finishedAt })
      .snapshot({ graphId: revision.graphId, graphRevision: revision.revision })

    expect(snapshot.byNode?.['agent-a']).toMatchObject({ cost: 2, attempts: 2, retries: 1 })
    expect(snapshot.byEdge?.[edgeB!.edgeId]).toMatchObject({ traversals: 1 })
    expect(snapshot).toMatchObject({
      incurredCost: 2,
      fanOut: 2,
      retryAmplification: 4 / 3,
      suppressedPhysicalAttempts: 1,
      avoidedCost: 0.75,
      criticalPathLatencyMs: 4_000
    })

    await store.commit({
      scope, runId: 'graph-run-2', expectedRunVersion: 0, expectedTaskRevision: 0,
      graphRunMutation: { type: 'put', record: {
        ...run, runId: 'graph-run-2', threadId: 'thread-2', turnId: 'turn-2',
        createdAt: '2026-07-26T00:00:05.000Z', updatedAt: '2026-07-26T00:00:10.000Z'
      } },
      workGraphEvents: [
        event('a-run-2-start', 'node_started', 'a-run-2', '2026-07-26T00:00:05.000Z', { nodeId: 'agent-a' }, 'graph-run-2'),
        event('a-run-2-complete', 'node_completed', 'a-run-2', '2026-07-26T00:00:06.000Z', { nodeId: 'agent-a' }, 'graph-run-2')
      ]
    })
    const aggregate = await new EngineValueLedger({ store, scope, nowIso: () => finishedAt })
      .snapshot({ graphId: revision.graphId, graphRevision: revision.revision })
    expect(aggregate.byNode?.['agent-a']).toMatchObject({ attempts: 3, retries: 1 })
    expect(aggregate.retryAmplification).toBe(5 / 4)
    expect(aggregate.criticalPathLatencyMs).toBe(4_000)
    expect(aggregate.revision).toBeGreaterThan(snapshot.revision)
  })
})

function event(
  eventId: string,
  kind: 'run_started' | 'run_completed' | 'node_started' | 'node_completed' | 'node_failed' | 'edge_traversed',
  attemptId: string,
  timestamp: string,
  dimensions: { nodeId?: string; edgeId?: string } = {},
  runId = 'graph-run'
) {
  return { type: 'append' as const, record: {
    eventId, scope, runId, graphId: 'graph-attribution', graphRevision: 1,
    attemptId, kind, payload: {}, timestamp, ...dimensions
  } }
}

function cost(costId: string, amount: number, nodeId: string, attemptId: string) {
  return {
    costId, scope, amount, currency: 'USD', source: 'model', incurredAt: finishedAt,
    graph: { graphId: 'graph-attribution', graphRevision: 1, runId: 'graph-run', nodeId, attemptId }
  }
}

function usage(costUsd: number) {
  return {
    promptTokens: 100, completionTokens: 20, totalTokens: 120,
    cacheHitRate: null, turns: 1, costUsd
  }
}
