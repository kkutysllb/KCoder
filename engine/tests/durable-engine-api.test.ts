import { describe, expect, it } from 'vitest'
import { InMemoryDurableEngineStore, InMemoryMailboxStore, InMemoryMultiAgentRunStore } from '@qiongqi/adapter-storage'
import {
  compileAgentGraph,
  createDurableEventedV2Stores,
  createEngine,
  EventedV2MultiAgentRuntime,
  KernelAgentExecutor,
  ModelProfileRegistry
} from '@qiongqi/loop'
import type { AgentGraph, ModelSelectionPolicy } from '@qiongqi/contracts'
import type { ModelProvider } from '@qiongqi/ports'

const scope = { ownerId: 'owner', workspaceId: 'workspace', taskId: 'api-task' }
const graph: AgentGraph = { version: 1, graphId: 'api-graph', startNodeId: 'agent', nodes: [{ id: 'agent', kind: 'agent', agentId: 'agent' }], edges: [] }
const capabilities = { streaming: true, toolCalling: true, structuredOutput: true, reasoning: false, inputModalities: ['text'], outputModalities: ['text'] }
const provider: ModelProvider = { providerId: 'provider', capabilities: () => capabilities, async *stream() { yield { kind: 'completed', stopReason: 'stop' } } }
const budgetLimits = { stepsUsed: 10, toolCallsUsed: 10, inputTokens: 1_000, outputTokens: 1_000, costUsd: 10 }

describe('durable engine v1 API', () => {
  it('exposes the model-neutral facade and value/stream operations', async () => {
    const store = new InMemoryDurableEngineStore()
    const registry = new ModelProfileRegistry()
    registry.register({ profileId: 'model-a', revision: 1, providerId: 'provider', modelId: 'a', endpointFormat: 'chat_completions', capabilities }, provider)
    const executor = new KernelAgentExecutor({
      store,
      ids: () => 'kernel',
      startKernel: async () => ({
        outcome: { status: 'completed', reason: 'normal_stop', retryable: false },
        usage: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
        usageRefs: [],
        artifactRefs: []
      })
    })
    const orchestrator = new EventedV2MultiAgentRuntime({ runs: new InMemoryMultiAgentRunStore(), mailbox: new InMemoryMailboxStore(), graph, ids: (prefix) => `${prefix}-1`, nowIso: () => '2026-07-26T00:00:00.000Z' })
    const engine = createEngine({ store, modelRegistry: registry, kernelExecutor: executor, orchestrator })
    const policy: ModelSelectionPolicy = { authorizedProfileIds: ['model-a'] }
    const run = await engine.start({ scope, threadId: 'thread', turnId: 'turn', workspaceKey: 'workspace', prompt: 'start', modelPolicy: policy })
    expect(run.streamId).toBe(`stream:${run.multiAgentRunId}`)
    const value = await engine.recordValue({ valueId: 'v1', scope, amount: 10, currency: 'USD', source: 'caller', confidence: 1, evidenceRefs: [], recordedAt: '2026-07-26T00:00:00.000Z' })
    expect(value.roiStatus).toBe('unavailable')
    await engine.setTaskModelPolicy(scope, 2, policy)
    await engine.cancel(run.multiAgentRunId)
    await engine.ack(run.streamId, 'consumer', 0)
  })

  it('publishes and starts an immutable graph revision through the v1.1 facade', async () => {
    const store = new InMemoryDurableEngineStore()
    const engine = engineFixture(store)
    const revision = compileAgentGraph(graph, {
      revision: 2,
      publishedAt: '2026-07-26T00:00:00.000Z'
    })
    await engine.publishGraph(revision)

    await expect(engine.start({
      scope,
      threadId: 'thread-missing-budget',
      turnId: 'turn-missing-budget',
      workspaceKey: 'workspace',
      prompt: 'must fail',
      modelPolicy: { authorizedProfileIds: ['model-a'] },
      graphRef: { graphId: revision.graphId, revision: revision.revision }
    } as never)).rejects.toThrow(/budget/i)

    const started = await engine.start({
      scope,
      threadId: 'thread-v11',
      turnId: 'turn-v11',
      workspaceKey: 'workspace',
      prompt: 'start governed graph',
      modelPolicy: { authorizedProfileIds: ['model-a'] },
      graphRef: { graphId: revision.graphId, revision: revision.revision },
      budgetLimits
    })
    const inspection = await engine.inspect(started.multiAgentRunId)
    const root = await store.loadRun(started.multiAgentRunId)

    expect(inspection).toMatchObject({
      runId: started.multiAgentRunId,
      graphId: revision.graphId,
      graphRevision: 2,
      graphDigest: revision.graphDigest,
      circuitState: 'running'
    })
    expect(root).toMatchObject({
      runId: started.multiAgentRunId,
      multiAgentRunId: started.multiAgentRunId,
      version: 2,
      budgetLimits,
      graph: {
        graphId: revision.graphId,
        graphRevision: revision.revision,
        graphDigest: revision.graphDigest
      }
    })
    expect(inspection.workEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'run_started' }),
      expect.objectContaining({ kind: 'child_spawned' }),
      expect.objectContaining({ kind: 'budget_reserved' })
    ]))
    const reservations = await store.loadBudgetReservations(started.multiAgentRunId)
    expect(reservations).toHaveLength(1)
    expect(reservations[0]).toMatchObject({ parentRunId: started.multiAgentRunId })
    const dispatches = (await store.listOutboxIntents(scope))
      .filter((intent) => intent.kind === 'agent_execution_requested')
    expect(dispatches).toHaveLength(1)
    expect(dispatches[0]?.payload).not.toHaveProperty('prompt')
    await engine.setGraphCircuit(started.multiAgentRunId, 'report_only')
    await expect(engine.inspect(started.multiAgentRunId)).resolves.toMatchObject({ circuitState: 'report_only' })
    const circuitGraph = await store.loadGraphRun(started.multiAgentRunId)
    const circuitRoot = await store.loadRun(started.multiAgentRunId)
    expect(circuitRoot?.version).toBe(circuitGraph?.version)
    expect(engine.resolveCheckpoint).toBeTypeOf('function')
  })

  it('never repairs a graph-only run during load and requires explicit migration limits', async () => {
    const store = new InMemoryDurableEngineStore()
    const engine = engineFixture(store)
    const revision = compileAgentGraph(graph, { revision: 3, publishedAt: '2026-07-26T00:00:00.000Z' })
    await engine.publishGraph(revision)
    await engine.setTaskModelPolicy(scope, 1, { authorizedProfileIds: ['model-a'] })
    const durable = createDurableEventedV2Stores({ store, scope, graphRevision: revision })
    const runtime = new EventedV2MultiAgentRuntime({
      ...durable,
      graph,
      ids: (prefix) => `${prefix}-graph-only`,
      nowIso: () => '2026-07-26T00:00:00.000Z'
    })
    const graphOnly = await runtime.start({
      threadId: 'thread-graph-only', turnId: 'turn-graph-only', workspaceKey: 'workspace', prompt: 'legacy run'
    })

    await expect(engine.inspect(graphOnly.runId)).rejects.toMatchObject({
      code: 'ROOT_RUN_AGGREGATE_INCOMPLETE'
    })
    await expect(store.loadRun(graphOnly.runId)).resolves.toBeUndefined()
    await expect(engine.migrateGraphOnlyRun({
      runId: graphOnly.runId,
      budgetLimits: undefined
    } as never)).rejects.toThrow(/required|object|invalid/i)

    const migrated = await engine.migrateGraphOnlyRun({ runId: graphOnly.runId, budgetLimits })
    expect(migrated).toMatchObject({ graphRun: { version: 2 }, engineRun: { version: 2, budgetLimits } })
    await expect(engine.inspect(graphOnly.runId)).resolves.toMatchObject({ runId: graphOnly.runId, version: 2 })
  })
})

function engineFixture(store: InMemoryDurableEngineStore) {
  const registry = new ModelProfileRegistry()
  registry.register({
    profileId: 'model-a', revision: 1, providerId: 'provider', modelId: 'a',
    endpointFormat: 'chat_completions', capabilities
  }, provider)
  const executor = new KernelAgentExecutor({
    store,
    ids: (prefix) => `${prefix}-kernel`,
    startKernel: async () => ({
      outcome: { status: 'completed', reason: 'normal_stop', retryable: false },
      usage: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
      usageRefs: [],
      artifactRefs: []
    })
  })
  const orchestrator = new EventedV2MultiAgentRuntime({
    runs: new InMemoryMultiAgentRunStore(), mailbox: new InMemoryMailboxStore(), graph,
    ids: (prefix) => `${prefix}-legacy`, nowIso: () => '2026-07-26T00:00:00.000Z'
  })
  let nextId = 0
  return createEngine({
    store, modelRegistry: registry, kernelExecutor: executor, orchestrator,
    ids: (prefix) => `${prefix}-${++nextId}`,
    nowIso: () => '2026-07-26T00:00:00.000Z'
  })
}
