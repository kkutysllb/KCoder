import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { PostgresDurableEngineStore } from '@qiongqi/adapter-storage'
import type { AgentGraph, KernelCompletionPayload, TaskScope } from '@qiongqi/contracts'
import type { DurableEngineStore, ModelProvider } from '@qiongqi/ports'
import {
  compileAgentGraph,
  createEngine,
  KernelAgentExecutor,
  ModelProfileRegistry,
  RootRunAggregateCoordinator
} from '@qiongqi/loop'

const connectionString = process.env.QIONGQI_TEST_POSTGRES_URL
const describePostgres = connectionString ? describe : describe.skip
const timestamp = '2026-07-27T00:00:00.000Z'
const scope: TaskScope = { ownerId: 'owner-pg', workspaceId: 'workspace-pg', taskId: 'parallel-pg' }
const budget = { stepsUsed: 2, toolCallsUsed: 1, inputTokens: 100, outputTokens: 50, costUsd: 1 }
const capabilities = {
  streaming: true, toolCalling: true, structuredOutput: true, reasoning: false,
  inputModalities: ['text'], outputModalities: ['text']
}
const provider: ModelProvider = {
  providerId: 'provider-pg', capabilities: () => capabilities,
  async *stream() { yield { kind: 'completed', stopReason: 'stop' } }
}

describePostgres('PostgreSQL durable parallel engine', () => {
  it('retains concurrent out-of-order branch completions from independent engine instances', async () => {
    const schema = `qiongqi_parallel_${process.pid}_${randomUUID().replaceAll('-', '')}`
    const first = await PostgresDurableEngineStore.create({ connectionString: connectionString!, schema })
    const second = await PostgresDurableEngineStore.create({ connectionString: connectionString!, schema })
    const ids = (prefix: string) => `${prefix}-${randomUUID()}`
    try {
      const graph = parallelGraph()
      const revision = compileAgentGraph(graph, { revision: 1, publishedAt: timestamp })
      const engine = engineFor(first, ids)
      await engine.publishGraph(revision)
      const started = await engine.start({
        scope,
        threadId: 'thread-pg', turnId: 'turn-pg', workspaceKey: 'workspace-pg', prompt: 'Parallel PostgreSQL.',
        modelPolicy: { authorizedProfileIds: ['caller-model'] },
        graphRef: { graphId: revision.graphId, revision: revision.revision },
        budgetLimits: { stepsUsed: 10, toolCallsUsed: 10, inputTokens: 1_000, outputTokens: 1_000, costUsd: 10 }
      })
      await engine.flushAgentDispatches()
      await engine.consumeKernelCompletion({
        multiAgentRunId: started.multiAgentRunId,
        completion: await completionForAgent(first, started.multiAgentRunId, 'manager')
      })
      const prepared = await engine.dispatchParallelAgents({
        multiAgentRunId: started.multiAgentRunId,
        prompt: 'Parallel PostgreSQL.',
        requestedBudgets: { draft: budget, research: budget, review: budget }
      })
      await engine.flushAgentDispatches()
      const byBranch = Object.fromEntries(prepared.agentRuns
        .filter((agentRun) => agentRun.branchId)
        .map((agentRun) => [agentRun.branchId!, agentRun]))
      const completion = async (branchId: 'draft' | 'research' | 'review') => {
        const kernelRunId = byBranch[branchId]!.executionRef!.kernelRunId
        const intent = await first.loadOutboxIntent(`agent_execution_completed:${kernelRunId}`)
        return intent!.payload as KernelCompletionPayload
      }
      await engine.consumeKernelCompletion({
        multiAgentRunId: started.multiAgentRunId,
        completion: await completion('review')
      })

      const engineA = engineFor(first, ids)
      const engineB = engineFor(second, ids)
      await Promise.all([
        engineA.consumeKernelCompletion({
          multiAgentRunId: started.multiAgentRunId,
          completion: await completion('research')
        }),
        engineB.consumeKernelCompletion({
          multiAgentRunId: started.multiAgentRunId,
          completion: await completion('draft')
        })
      ])

      const aggregate = await new RootRunAggregateCoordinator({ store: second, nowIso: () => timestamp })
        .load(started.multiAgentRunId)
      expect(aggregate.graphRun.version).toBe(aggregate.engineRun.version)
      expect(aggregate.graphRun).toMatchObject({ status: 'completed', activeNodeIds: ['done'] })
      expect(Object.values(aggregate.graphRun.eventedV2Run?.branches ?? {}).map((branch) => branch.status))
        .toEqual(['completed', 'completed', 'completed'])
      expect(aggregate.graphRun.eventedV2Run?.events.filter((event) => event.type === 'join_completed'))
        .toHaveLength(1)
    } finally {
      await second.close()
      await first.close({ dropSchema: true })
    }
  })
})

function engineFor(store: DurableEngineStore, ids: (prefix: string) => string) {
  const registry = new ModelProfileRegistry()
  registry.register({
    profileId: 'caller-model', revision: 1, providerId: 'provider-pg', modelId: 'runtime-selected',
    endpointFormat: 'responses', capabilities
  }, provider)
  const executor = new KernelAgentExecutor({
    store,
    ids,
    nowIso: () => timestamp,
    startKernel: async (input) => ({
      outcome: { status: 'completed', reason: 'normal_stop', retryable: false },
      usage: input.agentId === 'manager'
        ? { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }
        : { stepsUsed: 1, toolCallsUsed: 0, inputTokens: 10, outputTokens: 5, costUsd: 0.1 },
      usageRefs: [`usage:${input.agentId}`],
      artifactRefs: [`artifact:${input.agentId}`]
    })
  })
  return createEngine({ store, modelRegistry: registry, kernelExecutor: executor, ids, nowIso: () => timestamp })
}

async function completionForAgent(
  store: DurableEngineStore,
  runId: string,
  agentId: string
): Promise<KernelCompletionPayload> {
  const run = await store.loadGraphRun(runId)
  const agentRun = run?.eventedV2Run?.agentRuns.find((candidate) => candidate.agentId === agentId)
  const kernelRunId = agentRun?.executionRef?.kernelRunId
  if (!kernelRunId) throw new Error(`missing Kernel execution for ${agentId}`)
  const intent = await store.loadOutboxIntent(`agent_execution_completed:${kernelRunId}`)
  return intent!.payload as KernelCompletionPayload
}

function parallelGraph(): AgentGraph {
  return {
    version: 1,
    graphId: 'durable_parallel_pg',
    startNodeId: 'manager',
    nodes: [
      { id: 'manager', kind: 'agent', agentId: 'manager' },
      {
        id: 'fan_out', kind: 'parallel', joinNodeId: 'join_all', failurePolicy: 'wait_all',
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
      { id: 'done', kind: 'terminate' }
    ],
    edges: [
      { from: 'manager', to: 'fan_out', condition: 'completed' },
      { from: 'researcher', to: 'join_all', condition: 'completed' },
      { from: 'writer', to: 'join_all', condition: 'completed' },
      { from: 'reviewer', to: 'join_all', condition: 'completed' },
      { from: 'join_all', to: 'done', condition: 'completed' }
    ]
  }
}
