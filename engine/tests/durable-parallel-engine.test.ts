import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { InMemoryDurableEngineStore, SqliteDurableEngineStore } from '@qiongqi/adapter-storage'
import {
  KernelDispatchPayloadSchema,
  type AgentGraph,
  type KernelCompletionPayload,
  type TaskScope
} from '@qiongqi/contracts'
import type { DurableEngineStore, ModelProvider } from '@qiongqi/ports'
import {
  compileAgentGraph,
  createEngine,
  KernelAgentExecutor,
  ModelProfileRegistry,
  RootRunAggregateCoordinator
} from '@qiongqi/loop'

const scope: TaskScope = { ownerId: 'owner', workspaceId: 'workspace', taskId: 'durable-parallel' }
const timestamp = '2026-07-27T00:00:00.000Z'
const budget = { stepsUsed: 2, toolCallsUsed: 1, inputTokens: 100, outputTokens: 50, costUsd: 1 }
const limits = { stepsUsed: 10, toolCallsUsed: 10, inputTokens: 1_000, outputTokens: 1_000, costUsd: 10 }
const capabilities = {
  streaming: true, toolCalling: true, structuredOutput: true, reasoning: false,
  inputModalities: ['text'], outputModalities: ['text']
}
const provider: ModelProvider = {
  providerId: 'provider-neutral', capabilities: () => capabilities,
  async *stream() { yield { kind: 'completed', stopReason: 'stop' } }
}

describe('durable parallel engine acceptance', () => {
  it('recovers across runtime restart and joins concurrent out-of-order Kernel completions once', async () => {
    await verifyDurableParallel(new InMemoryDurableEngineStore())
  })

  it('recovers the same parallel run through independent SQLite connections', async () => {
    const root = mkdtempSync(join(tmpdir(), 'qiongqi-parallel-sqlite-'))
    const path = join(root, 'engine.sqlite')
    const first = new SqliteDurableEngineStore(path)
    const second = new SqliteDurableEngineStore(path)
    try {
      await verifyDurableParallel(first, second)
    } finally {
      second.close()
      first.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
})

async function verifyDurableParallel(store: DurableEngineStore, restartedStore: DurableEngineStore = store): Promise<void> {
    const graph = parallelGraph()
    const revision = compileAgentGraph(graph, { revision: 1, publishedAt: timestamp })
    let id = 0
    const ids = (prefix: string) => `${prefix}-${++id}`
    const engine = engineFor(store, ids)
    await engine.publishGraph(revision)
    const started = await engine.start({
      scope,
      threadId: 'thread', turnId: 'turn', workspaceKey: 'workspace', prompt: 'Build the durable report.',
      modelPolicy: { authorizedProfileIds: ['caller-model'] },
      graphRef: { graphId: revision.graphId, revision: revision.revision },
      budgetLimits: limits
    })
    await engine.flushAgentDispatches()
    await engine.consumeKernelCompletion({
      multiAgentRunId: started.multiAgentRunId,
      completion: await completionForAgent(store, started.multiAgentRunId, 'manager')
    })
    const prepared = await engine.dispatchParallelAgents({
      multiAgentRunId: started.multiAgentRunId,
      prompt: 'Build the durable report.',
      requestedBudgets: { draft: budget, research: budget, review: budget }
    })
    for (const agentRun of prepared.agentRuns.filter((candidate) => candidate.branchId)) {
      const kernelRunId = agentRun.executionRef!.kernelRunId
      const intent = await store.loadOutboxIntent(`agent_execution_requested:${kernelRunId}`)
      expect(KernelDispatchPayloadSchema.parse(intent?.payload)).toMatchObject({
        schemaVersion: 3,
        threadId: 'thread',
        turnId: 'turn',
        workspaceKey: 'workspace',
        executionPolicyRef: {
          policyId: `product.agent.${agentRun.agentId}`,
          revision: 1,
          digest: 'c'.repeat(64)
        }
      })
    }
    await engine.flushAgentDispatches()

    const agentByBranch = Object.fromEntries(prepared.agentRuns
      .filter((agentRun) => agentRun.branchId)
      .map((agentRun) => [agentRun.branchId!, agentRun]))
    const completion = async (branchId: 'draft' | 'research' | 'review'): Promise<KernelCompletionPayload> => {
      const kernelRunId = agentByBranch[branchId]!.executionRef!.kernelRunId
      const intent = await store.loadOutboxIntent(`agent_execution_completed:${kernelRunId}`)
      return intent!.payload as KernelCompletionPayload
    }

    await engine.consumeKernelCompletion({
      multiAgentRunId: started.multiAgentRunId, completion: await completion('review')
    })

    const restartedA = engineFor(store, ids)
    const restartedB = engineFor(restartedStore, ids)
    await Promise.all([
      restartedA.consumeKernelCompletion({
        multiAgentRunId: started.multiAgentRunId, completion: await completion('research')
      }),
      restartedB.consumeKernelCompletion({
        multiAgentRunId: started.multiAgentRunId, completion: await completion('draft')
      })
    ])

    await restartedA.recordCost({
      costId: 'cost:research', scope, amount: 2, currency: 'USD', source: 'model',
      graph: {
        graphId: revision.graphId, graphRevision: revision.revision, runId: started.multiAgentRunId,
        nodeId: 'researcher', branchId: 'research'
      },
      incurredAt: timestamp
    })
    const roi = await restartedA.recordValue({
      valueId: 'value:research', scope, amount: 6, currency: 'USD', source: 'caller', confidence: 1,
      evidenceRefs: [],
      graph: {
        graphId: revision.graphId, graphRevision: revision.revision, runId: started.multiAgentRunId,
        nodeId: 'researcher', branchId: 'research'
      },
      recordedAt: timestamp
    })
    expect(roi.byBranch?.research).toMatchObject({ incurredCost: 2, businessValue: 6, roiRatio: 2 })

    const aggregate = await new RootRunAggregateCoordinator({ store, nowIso: () => timestamp })
      .load(started.multiAgentRunId)
    expect(aggregate.graphRun.version).toBe(aggregate.engineRun.version)
    expect(aggregate.graphRun).toMatchObject({ status: 'completed', activeNodeIds: ['done'] })
    expect(aggregate.graphRun.budgets).toEqual({
      stepsUsed: 3, toolCallsUsed: 0, inputTokens: 30, outputTokens: 15, costUsd: 0.30000000000000004
    })
    const joined = aggregate.graphRun.eventedV2Run?.events.find((event) => event.type === 'join_completed')
    expect(joined?.payload).toMatchObject({
      condition: 'completed',
      result: {
        branches: {
          draft: { usageRefs: ['usage:writer'], artifactRefs: ['artifact:writer'] },
          research: { usageRefs: ['usage:researcher'], artifactRefs: ['artifact:researcher'] },
          review: { usageRefs: ['usage:reviewer'], artifactRefs: ['artifact:reviewer'] }
        }
      }
    })
    expect((aggregate.graphRun.eventedV2Run?.events ?? []).filter((event) => event.type === 'join_completed'))
      .toHaveLength(1)
    expect(await store.loadBudgetReservations(started.multiAgentRunId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'settled' }),
      expect.objectContaining({ status: 'settled' }),
      expect.objectContaining({ status: 'settled' })
    ]))
    const stream = await restartedB.subscribe(started.streamId, 'acceptance', 0, 200)
    expect(stream.filter((event) => event.kind === 'branch.completed')).toHaveLength(3)
    expect(stream).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'join.completed', multiAgentRunId: started.multiAgentRunId }),
      expect.objectContaining({
        kind: 'roi.snapshot',
        payload: expect.objectContaining({ byBranch: { research: expect.objectContaining({ roiRatio: 2 }) } })
      })
    ]))

    const beforeDuplicate = aggregate.graphRun.version
    await restartedA.consumeKernelCompletion({
      multiAgentRunId: started.multiAgentRunId, completion: await completion('draft')
    })
    expect((await store.loadGraphRun(started.multiAgentRunId))?.version).toBe(beforeDuplicate)
}

function engineFor(
  store: DurableEngineStore,
  ids: (prefix: string) => string
 ) {
  const registry = new ModelProfileRegistry()
  registry.register({
    profileId: 'caller-model', revision: 1, providerId: 'provider-neutral', modelId: 'runtime-selected',
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
  return createEngine({
    store, modelRegistry: registry, kernelExecutor: executor, ids, nowIso: () => timestamp
  })
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
    graphId: 'durable_parallel',
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
      {
        id: 'researcher', kind: 'agent', agentId: 'researcher',
        executionPolicyRef: { policyId: 'product.agent.researcher', revision: 1, digest: 'c'.repeat(64) }
      },
      {
        id: 'writer', kind: 'agent', agentId: 'writer',
        executionPolicyRef: { policyId: 'product.agent.writer', revision: 1, digest: 'c'.repeat(64) }
      },
      {
        id: 'reviewer', kind: 'agent', agentId: 'reviewer',
        executionPolicyRef: { policyId: 'product.agent.reviewer', revision: 1, digest: 'c'.repeat(64) }
      },
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
