import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { PostgresDurableEngineStore } from '@qiongqi/adapter-storage'
import { durableEngineStoreConformance } from './helpers/durable-engine-store-conformance.js'

it('exports the PostgreSQL durable engine adapter', () => {
  expect(PostgresDurableEngineStore).toBeTypeOf('function')
})

const connectionString = process.env.QIONGQI_TEST_POSTGRES_URL
const describePostgres = connectionString ? describe : describe.skip

describePostgres('PostgresDurableEngineStore', () => {
  const stores: PostgresDurableEngineStore[] = []
  const schemaPrefix = `qiongqi_engine_${process.pid}_${randomUUID().replaceAll('-', '')}`
  let schemaIndex = 0

  afterAll(async () => {
    await Promise.all(stores.map((store) => store.close({ dropSchema: true })))
  })

  durableEngineStoreConformance(async () => {
    const store = await PostgresDurableEngineStore.create({
      connectionString: connectionString!,
      schema: `${schemaPrefix}_${schemaIndex++}`
    })
    stores.push(store)
    return store
  })

  it('allows exactly one of two independent pools to claim a work item', async () => {
    const schema = `${schemaPrefix}_race`
    const first = await PostgresDurableEngineStore.create({ connectionString: connectionString!, schema })
    const second = await PostgresDurableEngineStore.create({ connectionString: connectionString!, schema })
    stores.push(first, second)
    const scope = { ownerId: 'owner-race', workspaceId: 'workspace-race', taskId: 'task-race' }
    const timestamp = new Date(Date.now() - 1_000).toISOString()
    await first.commit({
      scope,
      runId: 'run-race',
      expectedRunVersion: 0,
      expectedTaskRevision: 0,
      outboxIntents: [{
        type: 'put',
        record: {
          workId: 'work-race', scope, kind: 'race', payloadRef: 'outbox://work-race', status: 'pending',
          availableAt: timestamp, createdAt: timestamp, updatedAt: timestamp
        }
      }]
    })

    const claims = await Promise.all([
      first.claimWork('worker-a', ['race'], 10_000),
      second.claimWork('worker-b', ['race'], 10_000)
    ])
    expect(claims.filter(Boolean)).toHaveLength(1)
  })

  it('allows exactly one of two independent pools to create the same absent run', async () => {
    const schema = `${schemaPrefix}_run_cas`
    const first = await PostgresDurableEngineStore.create({ connectionString: connectionString!, schema })
    const second = await PostgresDurableEngineStore.create({ connectionString: connectionString!, schema })
    stores.push(first, second)
    const scope = { ownerId: 'owner-cas', workspaceId: 'workspace-cas', taskId: 'task-cas' }
    const timestamp = new Date().toISOString()
    const commit = {
      scope,
      runId: 'run-cas',
      expectedRunVersion: 0,
      expectedTaskRevision: 0,
      runMutation: {
        type: 'put' as const,
        record: {
          runId: 'run-cas', scope, multiAgentRunId: 'multi-cas', version: 1, status: 'running' as const,
          desiredState: 'running' as const,
          cursor: { nodeId: 'start', stepIndex: 0, checkpointSeq: 0 },
          budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
          createdAt: timestamp, updatedAt: timestamp
        }
      }
    }

    const results = await Promise.allSettled([first.commit(commit), second.commit(commit)])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  })

  it('allows exactly one concurrent child reservation when their sum exceeds the root limit', async () => {
    const schema = `${schemaPrefix}_budget_race`
    const first = await PostgresDurableEngineStore.create({ connectionString: connectionString!, schema })
    const second = await PostgresDurableEngineStore.create({ connectionString: connectionString!, schema })
    stores.push(first, second)
    const scope = { ownerId: 'owner-budget-race', workspaceId: 'workspace-budget-race', taskId: 'task-budget-race' }
    const timestamp = new Date().toISOString()
    await first.commit({
      scope,
      runId: 'budget-race-root',
      expectedRunVersion: 0,
      expectedTaskRevision: 0,
      runMutation: {
        type: 'put',
        record: {
          runId: 'budget-race-root', scope, multiAgentRunId: 'budget-race-root', version: 1,
          status: 'running', desiredState: 'running',
          cursor: { nodeId: 'dispatch', stepIndex: 0, checkpointSeq: 0 },
          budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
          budgetLimits: { stepsUsed: 10, toolCallsUsed: 10, inputTokens: 100, outputTokens: 100, costUsd: 10 },
          createdAt: timestamp, updatedAt: timestamp
        }
      }
    })
    const reserve = (store: PostgresDurableEngineStore, suffix: string) => store.commit({
      scope,
      runId: 'budget-race-root',
      expectedRunVersion: 1,
      expectedTaskRevision: 0,
      budgetReservationMutations: [{
        type: 'reserve' as const,
        record: {
          reservationId: `budget-race-${suffix}`, scope, parentRunId: 'budget-race-root', childRunId: `child-${suffix}`,
          status: 'reserved' as const,
          reserved: { stepsUsed: 6, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
          createdAt: timestamp, updatedAt: timestamp
        }
      }]
    })

    const results = await Promise.allSettled([reserve(first, 'a'), reserve(second, 'b')])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  })
})
