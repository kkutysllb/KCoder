import { describe, expect, it } from 'vitest'
import { InMemoryDurableEngineStore } from '@qiongqi/adapter-storage'
import { GraphRevisionSchema, GraphRunRecordSchema, MultiAgentRunSchema, type BudgetState, type GraphRunRecord } from '@qiongqi/contracts'
import {
  RootRunAggregateCoordinator,
  RootRunAggregateError
} from '@qiongqi/loop'
import { EngineStoreConflictError, type EngineRunRecord } from '@qiongqi/ports'

const scope = { ownerId: 'owner-root', workspaceId: 'workspace-root', taskId: 'task-root' }
const timestamp = '2026-07-27T00:00:00.000Z'
const digest = 'a'.repeat(64)
const zeroBudget: BudgetState = {
  stepsUsed: 0,
  toolCallsUsed: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0
}
const budgetLimits: BudgetState = {
  stepsUsed: 10,
  toolCallsUsed: 10,
  inputTokens: 1_000,
  outputTokens: 1_000,
  costUsd: 10
}

function graphRun(version = 1): GraphRunRecord {
  return GraphRunRecordSchema.parse({
    schemaVersion: 1,
    scope,
    runId: 'root-1',
    threadId: 'thread-1',
    turnId: 'turn-1',
    workspaceKey: 'workspace-root',
    graphId: 'graph-1',
    graphRevision: 1,
    graphDigest: digest,
    version,
    status: 'running',
    circuitState: 'running',
    activeNodeIds: ['agent'],
    budgets: zeroBudget,
    eventedV2Run: {
      version: 1,
      runId: 'root-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      workspaceKey: 'workspace-root',
      status: 'running',
      graphId: 'graph-1',
      activeNodeId: 'agent',
      activeAgentStack: ['writer'],
      branchStatus: {},
      agentRuns: [{
        agentRunId: 'agent-run-1',
        agentId: 'writer',
        nodeId: 'agent',
        status: 'running',
        startedAt: timestamp,
        updatedAt: timestamp
      }],
      events: [],
      outbox: [],
      retryCounters: {},
      budgets: zeroBudget,
      createdAt: timestamp,
      updatedAt: timestamp
    },
    createdAt: timestamp,
    updatedAt: timestamp
  })
}

function rootEngine(version = 1, limits: BudgetState | null = budgetLimits): EngineRunRecord {
  return {
    runId: 'root-1',
    scope,
    multiAgentRunId: 'root-1',
    graph: {
      graphId: 'graph-1',
      graphRevision: 1,
      graphDigest: digest,
      nodeId: 'agent',
      attemptId: 'root-1',
      callerId: scope.ownerId,
      policyRevision: 1
    },
    version,
    status: 'running',
    desiredState: 'running',
    cursor: { nodeId: 'agent', stepIndex: 0, checkpointSeq: 0 },
    budgets: zeroBudget,
    ...(limits !== null ? { budgetLimits: limits } : {}),
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function coordinator(store: InMemoryDurableEngineStore) {
  return new RootRunAggregateCoordinator({ store, nowIso: () => timestamp })
}

function pinnedRevision() {
  return GraphRevisionSchema.parse({
    schemaVersion: 1,
    graphId: 'graph-1',
    revision: 1,
    graphDigest: digest,
    startNodeId: 'agent',
    nodes: [{ id: 'agent', kind: 'agent', agentId: 'writer' }],
    edges: [],
    publishedAt: timestamp,
    diagnostics: []
  })
}

async function seedBoth(
  store: InMemoryDurableEngineStore,
  graph = graphRun(),
  engine = rootEngine()
): Promise<void> {
  await store.commit({
    scope,
    runId: graph.runId,
    expectedRunVersion: 0,
    expectedTaskRevision: 0,
    graphRunMutation: { type: 'put', record: graph },
    runMutation: { type: 'put', record: engine }
  })
}

describe('RootRunAggregateCoordinator', () => {
  it('creates same-id same-version graph and root engine records atomically', async () => {
    const store = new InMemoryDurableEngineStore()
    const created = await coordinator(store).create({
      graphRun: graphRun(),
      budgetLimits,
      policyRevision: 1
    })

    expect(created.graphRun).toMatchObject({ runId: 'root-1', version: 1 })
    expect(created.engineRun).toMatchObject({
      runId: 'root-1',
      multiAgentRunId: 'root-1',
      version: 1,
      budgetLimits,
      graph: { graphId: 'graph-1', graphRevision: 1, graphDigest: digest }
    })
    await expect(store.loadGraphRun('root-1')).resolves.toEqual(created.graphRun)
    await expect(store.loadRun('root-1')).resolves.toEqual(created.engineRun)
  })

  it('fails closed when only the governed GraphRun exists', async () => {
    const store = new InMemoryDurableEngineStore()
    await store.commit({
      scope,
      runId: 'root-1',
      expectedRunVersion: 0,
      expectedTaskRevision: 0,
      graphRunMutation: { type: 'put', record: graphRun() }
    })

    await expect(coordinator(store).load('root-1')).rejects.toMatchObject({
      code: 'ROOT_RUN_AGGREGATE_INCOMPLETE'
    })
  })

  it('fails closed when root projection versions diverge', async () => {
    const store = new InMemoryDurableEngineStore()
    await seedBoth(store)
    await store.commit({
      scope,
      runId: 'root-1',
      expectedRunVersion: 1,
      expectedTaskRevision: 0,
      runMutation: { type: 'put', record: rootEngine(2) }
    })

    await expect(coordinator(store).load('root-1')).rejects.toMatchObject({
      code: 'ROOT_RUN_AGGREGATE_DIVERGED'
    })
  })

  it('fails closed when a governed root has no caller budget', async () => {
    const store = new InMemoryDurableEngineStore()
    await seedBoth(store, graphRun(), rootEngine(1, null))

    await expect(coordinator(store).load('root-1')).rejects.toMatchObject({
      code: 'ROOT_RUN_BUDGET_MISSING'
    })
  })

  it('rolls back both projections when an extra mutation conflicts', async () => {
    const store = new InMemoryDurableEngineStore()
    const revision = pinnedRevision()
    await store.commit({
      scope,
      runId: 'catalog-1',
      expectedRunVersion: 0,
      expectedTaskRevision: 0,
      graphRevisionMutations: [{ type: 'put', record: revision }]
    })

    await expect(coordinator(store).create({
      graphRun: graphRun(),
      budgetLimits,
      policyRevision: 1,
      mutations: {
        graphRevisionMutations: [{
          type: 'put',
          record: { ...revision, graphDigest: 'b'.repeat(64) }
        }]
      }
    })).rejects.toBeInstanceOf(EngineStoreConflictError)
    await expect(store.loadGraphRun('root-1')).resolves.toBeUndefined()
    await expect(store.loadRun('root-1')).resolves.toBeUndefined()
  })

  it('advances both projections through update, cancellation, and deletion', async () => {
    const store = new InMemoryDurableEngineStore()
    const aggregate = coordinator(store)
    await aggregate.create({ graphRun: graphRun(), budgetLimits, policyRevision: 1 })

    const updated = await aggregate.update({
      runId: 'root-1',
      mutate: ({ graphRun: current }) => ({
        graphRun: { ...current, circuitState: 'report_only', updatedAt: timestamp }
      })
    })
    expect(updated.graphRun).toMatchObject({ version: 2, circuitState: 'report_only' })
    expect(updated.engineRun).toMatchObject({ version: 2 })

    const cancelling = await aggregate.requestCancel('root-1')
    expect(cancelling.graphRun.version).toBe(3)
    expect(cancelling.engineRun).toMatchObject({ version: 3, desiredState: 'cancelled', status: 'running' })

    const cancelled = await aggregate.finalizeCancel('root-1')
    expect(cancelled.graphRun).toMatchObject({ version: 4, status: 'aborted' })
    expect(cancelled.engineRun).toMatchObject({
      version: 4,
      status: 'aborted',
      outcome: { status: 'aborted', reason: 'user_aborted', retryable: false }
    })

    await aggregate.delete('root-1')
    await expect(store.loadGraphRun('root-1')).resolves.toBeUndefined()
    await expect(store.loadRun('root-1')).resolves.toBeUndefined()
  })

  it('finalizes cancellation across every open durable branch projection', async () => {
    const store = new InMemoryDurableEngineStore()
    const running = graphRun()
    const eventedV2Run = MultiAgentRunSchema.parse({
      ...running.eventedV2Run!,
      activeNodeId: 'join_all',
      branchStatus: { draft: 'running', research: 'running', review: 'completed' },
      branches: {
        draft: {
          branchId: 'draft', parallelNodeId: 'fan_out', joinNodeId: 'join_all', status: 'suspended',
          activeNodeId: 'writer_wait', agentRunIds: [], usageRefs: [], artifactRefs: [], updatedAt: timestamp
        },
        research: {
          branchId: 'research', parallelNodeId: 'fan_out', joinNodeId: 'join_all', status: 'running',
          activeNodeId: 'researcher', agentRunIds: [], usageRefs: [], artifactRefs: [], updatedAt: timestamp
        },
        review: {
          branchId: 'review', parallelNodeId: 'fan_out', joinNodeId: 'join_all', status: 'completed',
          activeNodeId: 'join_all', agentRunIds: [], output: 'approved', usageRefs: [], artifactRefs: [],
          completedAt: timestamp, updatedAt: timestamp
        }
      }
    })
    const graph = GraphRunRecordSchema.parse({
      ...running,
      activeNodeIds: ['join_all', 'writer_wait', 'researcher'],
      eventedV2Run
    })
    const engine = {
      ...rootEngine(),
      graph: { ...rootEngine().graph!, nodeId: 'join_all' },
      cursor: { ...rootEngine().cursor, nodeId: 'join_all' }
    }
    await seedBoth(store, graph, engine)

    const cancelled = await coordinator(store).finalizeCancel('root-1')

    expect(cancelled.graphRun.activeNodeIds).toEqual(['join_all'])
    expect(cancelled.graphRun.eventedV2Run?.branchStatus).toEqual({
      draft: 'aborted', research: 'aborted', review: 'completed'
    })
    expect(cancelled.graphRun.eventedV2Run?.branches).toMatchObject({
      draft: { status: 'aborted' },
      research: { status: 'aborted' },
      review: { status: 'completed', output: 'approved' }
    })
    expect(cancelled.graphRun.eventedV2Run?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'branch_cancelled', branchId: 'draft', nodeId: 'writer_wait' }),
      expect.objectContaining({ type: 'branch_cancelled', branchId: 'research', nodeId: 'researcher' }),
      expect.objectContaining({ type: 'run_cancelled', nodeId: 'join_all' })
    ]))
    expect(cancelled.graphRun.eventedV2Run?.events).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'branch_cancelled', branchId: 'review' })
    ]))
    await expect(store.listWorkGraphEvents('root-1', 0, 100)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'branch_cancelled', branchId: 'draft', nodeId: 'writer_wait' }),
      expect.objectContaining({ kind: 'branch_cancelled', branchId: 'research', nodeId: 'researcher' }),
      expect.objectContaining({ kind: 'run_cancelled', nodeId: 'join_all' })
    ]))
    await expect(store.readStream('stream:root-1', 0, 100)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'branch.cancelled', branchId: 'draft' }),
      expect.objectContaining({ kind: 'branch.cancelled', branchId: 'research' }),
      expect.objectContaining({ kind: 'run.cancelled' })
    ]))
  })

  it('persists root cancellation work before best-effort Kernel cancellation', async () => {
    const store = new InMemoryDurableEngineStore()
    const running = graphRun()
    const graph = GraphRunRecordSchema.parse({
      ...running,
      eventedV2Run: {
        ...running.eventedV2Run!,
        agentRuns: running.eventedV2Run!.agentRuns.map((agentRun) => ({
          ...agentRun,
          executionRef: {
            scope,
            parentKind: 'agent',
            multiAgentRunId: 'root-1',
            agentRunId: agentRun.agentRunId,
            parentRunId: agentRun.agentRunId,
            kernelRunId: 'kernel-root-agent'
          }
        }))
      }
    })
    await seedBoth(store, graph, rootEngine())

    await coordinator(store).requestCancel('root-1')

    await expect(store.loadOutboxIntent('agent_execution_cancel_requested:kernel-root-agent'))
      .resolves.toMatchObject({
        status: 'pending',
        kind: 'agent_execution_cancel_requested',
        payload: { reason: 'root_cancel', executionRef: { kernelRunId: 'kernel-root-agent' } }
      })
  })

  it('exports a structured aggregate error type', () => {
    const error = new RootRunAggregateError('ROOT_RUN_AGGREGATE_DIVERGED', 'diverged')
    expect(error).toMatchObject({ name: 'RootRunAggregateError', code: 'ROOT_RUN_AGGREGATE_DIVERGED' })
  })

  it('explicitly migrates a graph-only run and audits the repair', async () => {
    const store = new InMemoryDurableEngineStore()
    await store.commit({
      scope,
      runId: 'root-1',
      expectedRunVersion: 0,
      expectedTaskRevision: 0,
      expectedModelPolicyRevision: 0,
      graphRevisionMutations: [{ type: 'put', record: pinnedRevision() }],
      graphRunMutation: { type: 'put', record: graphRun() },
      taskModelPolicyMutation: {
        type: 'put',
        record: {
          scope,
          revision: 1,
          policy: { authorizedProfileIds: ['caller-model'] },
          validatedProfileRefs: [],
          createdAt: timestamp,
          updatedAt: timestamp
        }
      }
    })
    const aggregate = coordinator(store)

    const migrated = await aggregate.migrateGraphOnly({ runId: 'root-1', budgetLimits })

    expect(migrated.graphRun).toMatchObject({ version: 2 })
    expect(migrated.engineRun).toMatchObject({ version: 2, budgetLimits })
    await expect(store.listWorkGraphEvents('root-1', 0, 100)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'root_run_repaired' })
    ]))
    await expect(aggregate.migrateGraphOnly({ runId: 'root-1', budgetLimits })).rejects.toThrow(/already|both|engine/i)
  })

  it('migrates a terminal graph-only run for audit without creating dispatch work', async () => {
    const store = new InMemoryDurableEngineStore()
    const running = graphRun()
    const terminal = GraphRunRecordSchema.parse({
      ...running,
      status: 'completed',
      eventedV2Run: {
        ...running.eventedV2Run!,
        status: 'completed',
        agentRuns: running.eventedV2Run!.agentRuns.map((agentRun) => ({
          ...agentRun,
          status: 'completed',
          completedAt: timestamp
        })),
        events: [{
          eventId: 'run-completed-1',
          type: 'run_completed',
          nodeId: 'agent',
          timestamp
        }]
      }
    })
    await store.commit({
      scope,
      runId: 'root-1',
      expectedRunVersion: 0,
      expectedTaskRevision: 0,
      expectedModelPolicyRevision: 0,
      graphRevisionMutations: [{ type: 'put', record: pinnedRevision() }],
      graphRunMutation: { type: 'put', record: terminal },
      taskModelPolicyMutation: {
        type: 'put',
        record: {
          scope,
          revision: 1,
          policy: { authorizedProfileIds: ['caller-model'] },
          validatedProfileRefs: [],
          createdAt: timestamp,
          updatedAt: timestamp
        }
      }
    })

    const migrated = await coordinator(store).migrateGraphOnly({ runId: 'root-1', budgetLimits })

    expect(migrated.engineRun).toMatchObject({ status: 'completed' })
    expect((await store.listOutboxIntents(scope)).filter((intent) => intent.kind === 'agent_execution_requested'))
      .toHaveLength(0)
  })
})
