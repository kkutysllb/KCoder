import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { PostgresDurableEngineStore } from '@qiongqi/adapter-storage'
import {
  compileAgentGraph,
  createDurableEventedV2Stores,
  DurableAgentDispatchWorker,
  EventedV2MultiAgentRuntime,
  KernelAgentExecutor,
  RootRunAggregateCoordinator
} from '@qiongqi/loop'
import type { AgentGraph } from '@qiongqi/contracts'

const connectionString = process.env.QIONGQI_TEST_POSTGRES_URL
const describePostgres = connectionString ? describe : describe.skip

describePostgres('PostgreSQL governed engine recovery', () => {
  it('persists prepared identity through Kernel completion without a provider default', async () => {
    const store = await PostgresDurableEngineStore.create({
      connectionString: connectionString!,
      schema: `qiongqi_governed_${process.pid}_${randomUUID().replaceAll('-', '')}`
    })
    try {
      const timestamp = new Date().toISOString()
      const scope = { ownerId: 'owner-pg', workspaceId: 'workspace-pg', taskId: 'task-pg' }
      const graph: AgentGraph = {
        version: 1,
        graphId: 'pg-governed-graph',
        startNodeId: 'agent',
        nodes: [
          { id: 'agent', kind: 'agent', agentId: 'writer' },
          { id: 'done', kind: 'terminate' }
        ],
        edges: [{ from: 'agent', to: 'done', condition: 'completed' }]
      }
      const revision = compileAgentGraph(graph, { revision: 1, publishedAt: timestamp })
      await store.commit({
        scope,
        runId: 'policy:pg-governed',
        expectedRunVersion: 0,
        expectedTaskRevision: 0,
        expectedModelPolicyRevision: 0,
        taskModelPolicyMutation: {
          type: 'put',
          record: {
            scope,
            revision: 1,
            policy: { authorizedProfileIds: ['caller-selected-model'] },
            validatedProfileRefs: [{ profileId: 'caller-selected-model', revision: 7 }],
            createdAt: timestamp,
            updatedAt: timestamp
          }
        }
      })
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
      let id = 0
      const runtime = new EventedV2MultiAgentRuntime({
        ...durable,
        graph,
        ids: (prefix) => `${prefix}-pg-${++id}`,
        nowIso: () => timestamp,
        dispatchPreparer: durable.runs
      })
      const started = await runtime.start({
        threadId: 'thread-pg', turnId: 'turn-pg', workspaceKey: 'workspace-pg', prompt: 'run on caller policy'
      })
      const prepared = await runtime.dispatchActiveAgent({
        runId: started.runId,
        scope,
        prompt: 'run on caller policy',
        requestedBudget: { stepsUsed: 2, toolCallsUsed: 1, inputTokens: 100, outputTokens: 50, costUsd: 1 },
        graph: {
          graphId: revision.graphId,
          graphRevision: revision.revision,
          graphDigest: revision.graphDigest,
          nodeId: 'agent',
          attemptId: started.runId,
          callerId: scope.ownerId,
          policyRevision: 1
        }
      })
      const executionRef = prepared.agentRuns[0]!.executionRef!
      const actual = { stepsUsed: 1, toolCallsUsed: 0, inputTokens: 20, outputTokens: 4, costUsd: 0.2 }
      const executor = new KernelAgentExecutor({
        store,
        ids: () => 'unused',
        nowIso: () => timestamp,
        startKernel: async (input) => {
          expect(input.executionRef).toEqual(executionRef)
          expect(input.graph?.policyRevision).toBe(1)
          return {
            outcome: { status: 'completed', reason: 'normal_stop', retryable: false },
            usage: actual,
            usageRefs: ['usage:pg'],
            artifactRefs: []
          }
        }
      })

      await new DurableAgentDispatchWorker({ store, executor, workerId: 'pg-kernel-worker' }).flushOnce()
      const completion = await store.claimWork('pg-evented-worker', ['agent_execution_completed'], 30_000)
      expect(completion?.payload).toBeDefined()
      await runtime.consumeKernelCompletion({ runId: started.runId, completion: completion!.payload })
      await store.commit({
        scope,
        runId: completion!.workId,
        expectedRunVersion: 0,
        expectedTaskRevision: 0,
        outboxIntents: [{
          type: 'complete',
          recordId: completion!.workId,
          claim: completion!.lease,
          payload: completion!.payload
        }]
      })

      const aggregate = await coordinator.load(started.runId)
      expect(aggregate.graphRun).toMatchObject({ version: 3, status: 'completed', budgets: actual })
      expect(aggregate.engineRun).toMatchObject({ version: 3, status: 'completed', budgets: actual })
      await expect(store.loadTaskModelPolicy(scope)).resolves.toMatchObject({
        policy: { authorizedProfileIds: ['caller-selected-model'] }
      })
      expect(JSON.stringify(aggregate)).not.toContain('deepseek-chat')
    } finally {
      await store.close({ dropSchema: true })
    }
  })
})
