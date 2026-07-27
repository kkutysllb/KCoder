import { describe, expect, it } from 'vitest'
import { InMemoryDurableEngineStore } from '@qiongqi/adapter-storage'
import { GraphRevisionSchema, GraphRunRecordSchema, type BudgetState, type GraphRunRecord } from '@qiongqi/contracts'
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
