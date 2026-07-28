import { describe, expect, it } from 'vitest'
import { InMemoryDurableEngineStore } from '@qiongqi/adapter-storage'
import {
  compileAgentGraph,
  createDurableEventedV2Stores,
  DurableAgentDispatchWorker,
  EventedV2MultiAgentRuntime,
  KernelAgentExecutor,
  RootRunAggregateCoordinator
} from '@qiongqi/loop'
import { KernelCancellationPayloadSchema, KernelDispatchPayloadSchema, type AgentGraph } from '@qiongqi/contracts'
import { EngineRunRecordSchema, EngineStoreConflictError, type DurableEngineStore } from '@qiongqi/ports'

const timestamp = '2026-07-26T00:00:00.000Z'
const scope = { ownerId: 'owner', workspaceId: 'workspace', taskId: 'dispatch-worker' }
const graph: AgentGraph = {
  version: 1,
  graphId: 'dispatch-worker-graph',
  startNodeId: 'agent',
  nodes: [{
    id: 'agent', kind: 'agent', agentId: 'writer',
    nodePolicyRef: { policyId: 'writer-node', revision: 5 },
    modelPolicyRef: { policyId: 'writer-model', revision: 2 },
    executionPolicyRef: {
      policyId: 'product.agent.writer', revision: 4, digest: 'b'.repeat(64)
    }
  }],
  edges: []
}

describe('DurableAgentDispatchWorker', () => {
  it('claims a durable branch cancellation and completes it with the current fence', async () => {
    const store = new InMemoryDurableEngineStore()
    const executionRef = {
      scope,
      parentKind: 'agent' as const,
      multiAgentRunId: 'run-parallel',
      agentRunId: 'agent-draft',
      parentRunId: 'agent-draft',
      kernelRunId: 'kernel-draft'
    }
    const payload = KernelCancellationPayloadSchema.parse({
      schemaVersion: 1,
      executionRef,
      branchId: 'draft',
      reason: 'fail_fast'
    })
    await store.commit({
      scope,
      runId: 'cancel-work-seed',
      expectedRunVersion: 0,
      expectedTaskRevision: 0,
      outboxIntents: [{
        type: 'put',
        record: {
          workId: 'agent_execution_cancel_requested:kernel-draft',
          scope,
          kind: 'agent_execution_cancel_requested',
          payloadRef: 'kernel-run://kernel-draft/cancel',
          status: 'pending',
          availableAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
          payload
        }
      }]
    })
    const cancelled: string[] = []
    const worker = new DurableAgentDispatchWorker({
      store,
      executor: {
        async execute(input) { return { executionRef: input.executionRef } },
        async resume() {},
        async cancel(ref) { cancelled.push(ref.kernelRunId) }
      }
    })

    await expect(worker.flushOnce()).resolves.toMatchObject({
      processed: true,
      workId: 'agent_execution_cancel_requested:kernel-draft'
    })
    expect(cancelled).toEqual(['kernel-draft'])
    await expect(store.loadOutboxIntent('agent_execution_cancel_requested:kernel-draft')).resolves.toMatchObject({
      status: 'completed'
    })
  })

  it('reclaims durable cancellation after worker claim expiry', async () => {
    const store = new InMemoryDurableEngineStore()
    const executionRef = {
      scope,
      parentKind: 'agent' as const,
      multiAgentRunId: 'run-cancel-recovery',
      agentRunId: 'agent-cancel-recovery',
      parentRunId: 'agent-cancel-recovery',
      kernelRunId: 'kernel-cancel-recovery'
    }
    const workId = `agent_execution_cancel_requested:${executionRef.kernelRunId}`
    await store.commit({
      scope,
      runId: 'cancel-recovery-seed',
      expectedRunVersion: 0,
      expectedTaskRevision: 0,
      outboxIntents: [{
        type: 'put',
        record: {
          workId,
          scope,
          kind: 'agent_execution_cancel_requested',
          payloadRef: `kernel-run://${executionRef.kernelRunId}/cancel`,
          status: 'pending',
          availableAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
          payload: KernelCancellationPayloadSchema.parse({
            schemaVersion: 1,
            executionRef,
            reason: 'root_cancel'
          })
        }
      }]
    })
    let cancellations = 0
    const crashing = new DurableAgentDispatchWorker({
      store,
      workerId: 'cancel-worker-stale',
      leaseTtlMs: 1,
      executor: {
        async execute(input) { return { executionRef: input.executionRef } },
        async resume() {},
        async cancel() {
          cancellations += 1
          throw new Error('crash after cancellation delivery')
        }
      }
    })

    await expect(crashing.flushOnce()).rejects.toThrow(/crash after cancellation delivery/)
    await expect(store.loadOutboxIntent(workId)).resolves.toMatchObject({
      status: 'claimed', claim: { holderId: 'cancel-worker-stale', fence: 1 }
    })
    await new Promise((resolve) => setTimeout(resolve, 10))

    let recoveredClaim: unknown
    const recovered = new DurableAgentDispatchWorker({
      store,
      workerId: 'cancel-worker-current',
      executor: {
        async execute(input) { return { executionRef: input.executionRef } },
        async resume() {},
        async cancel() {
          cancellations += 1
          recoveredClaim = (await store.loadOutboxIntent(workId))?.claim
        }
      }
    })
    await expect(recovered.flushOnce()).resolves.toMatchObject({ processed: true, workId })
    expect(cancellations).toBe(2)
    expect(recoveredClaim).toMatchObject({ holderId: 'cancel-worker-current', fence: 2 })
    await expect(store.loadOutboxIntent(workId)).resolves.toMatchObject({
      status: 'completed'
    })
  })

  it('claims a prepared dispatch, resolves its input reference, and completes with the current fence', async () => {
    const { store } = await preparedFixture()

    const observed: Array<{ prompt: string, executionPolicyRef: unknown }> = []
    const worker = new DurableAgentDispatchWorker({
      store,
      workerId: 'worker-a',
      leaseTtlMs: 30_000,
      executor: {
        async execute(input) {
          observed.push({ prompt: input.prompt, executionPolicyRef: input.executionPolicyRef })
          await expect(store.loadOutboxIntent(`agent_execution_requested:${input.executionRef.kernelRunId}`))
            .resolves.toMatchObject({ status: 'claimed', claim: { holderId: 'worker-a' } })
          await expect(store.loadBudgetReservations(input.multiAgentRunId)).resolves.toMatchObject([{
            reservationId: input.reservationId,
            status: 'reserved'
          }])
          return { executionRef: input.executionRef }
        },
        async resume() {},
        async cancel() {}
      }
    })

    await expect(worker.flushOnce()).resolves.toMatchObject({
      processed: true,
      workId: 'agent_execution_requested:kernel_run-worker'
    })
    expect(observed).toEqual([{
      prompt: 'write the report',
      executionPolicyRef: {
        policyId: 'product.agent.writer', revision: 4, digest: 'b'.repeat(64)
      }
    }])
    await expect(store.loadOutboxIntent('agent_execution_requested:kernel_run-worker')).resolves.toMatchObject({
      status: 'completed'
    })
  })

  it.each([1, 2] as const)('hydrates legacy schema v%s dispatches from durable graph facts', async (schemaVersion) => {
    const { store, workId } = await preparedFixture()
    const original = KernelDispatchPayloadSchema.parse((await store.loadOutboxIntent(workId))?.payload)
    if (original.schemaVersion !== 3) throw new Error('fixture must write schema v3')
    const legacy = {
      schemaVersion,
      identity: original.identity,
      reservationId: original.reservationId,
      requestedBudget: original.requestedBudget,
      role: original.role,
      inputRef: original.inputRef,
      sharedEvidenceRefs: original.sharedEvidenceRefs,
      ...(schemaVersion === 1 ? {} : { executionPolicyRef: original.executionPolicyRef })
    }
    const observed: unknown[] = []
    const worker = new DurableAgentDispatchWorker({
      store: storeWithClaimPayload(store, KernelDispatchPayloadSchema.parse(legacy)),
      executor: {
        async execute(input) { observed.push(input); return { executionRef: input.executionRef } },
        async resume() {},
        async cancel() {}
      }
    })

    await expect(worker.flushOnce()).resolves.toMatchObject({ processed: true, workId })
    expect(observed).toMatchObject([{
      threadId: 'thread-worker',
      turnId: 'turn-worker',
      workspaceKey: 'workspace',
      nodePolicyRef: { policyId: 'writer-node', revision: 5 },
      modelPolicyRef: { policyId: 'writer-model', revision: 2 },
      executionPolicyRef: {
        policyId: 'product.agent.writer', revision: 4, digest: 'b'.repeat(64)
      }
    }])
  })

  it.each([
    ['workspace', (payload: Extract<ReturnType<typeof KernelDispatchPayloadSchema.parse>, { schemaVersion: 3 }>) => ({
      ...payload, workspaceKey: 'forged-workspace'
    })],
    ['graph digest', (payload: Extract<ReturnType<typeof KernelDispatchPayloadSchema.parse>, { schemaVersion: 3 }>) => ({
      ...payload,
      identity: {
        ...payload.identity,
        graph: { ...payload.identity.graph!, graphDigest: 'f'.repeat(64) },
        executionRef: {
          ...payload.identity.executionRef,
          graph: { ...payload.identity.executionRef.graph!, graphDigest: 'f'.repeat(64) }
        }
      }
    })],
    ['node policy', (payload: Extract<ReturnType<typeof KernelDispatchPayloadSchema.parse>, { schemaVersion: 3 }>) => ({
      ...payload, nodePolicyRef: { policyId: 'forged-node', revision: 1 }
    })],
    ['model policy', (payload: Extract<ReturnType<typeof KernelDispatchPayloadSchema.parse>, { schemaVersion: 3 }>) => ({
      ...payload, modelPolicyRef: { policyId: 'forged-model', revision: 1 }
    })],
    ['execution policy', (payload: Extract<ReturnType<typeof KernelDispatchPayloadSchema.parse>, { schemaVersion: 3 }>) => ({
      ...payload,
      executionPolicyRef: { policyId: 'forged-execution', revision: 1, digest: 'e'.repeat(64) }
    })]
  ])('rejects forged %s before invoking Kernel', async (_label, forge) => {
    const { store, workId } = await preparedFixture()
    const original = KernelDispatchPayloadSchema.parse((await store.loadOutboxIntent(workId))?.payload)
    if (original.schemaVersion !== 3) throw new Error('fixture must write schema v3')
    const forged = KernelDispatchPayloadSchema.parse(forge(original))
    let executed = false
    const worker = new DurableAgentDispatchWorker({
      store: storeWithClaimPayload(store, forged),
      executor: {
        async execute(input) { executed = true; return { executionRef: input.executionRef } },
        async resume() {},
        async cancel() {}
      }
    })

    await expect(worker.flushOnce()).rejects.toBeInstanceOf(EngineStoreConflictError)
    expect(executed).toBe(false)
  })

  it.each([
    ['scope mismatch', async (store: DurableEngineStore, runId: string) => {
      const record = (await store.loadGraphRun(runId))!
      return storeWithOverrides(store, {
        loadGraphRun: async () => ({ ...record, scope: { ...record.scope, taskId: 'forged-task' } })
      })
    }],
    ['missing revision', async (store: DurableEngineStore) => storeWithOverrides(store, {
      loadGraphRevision: async () => undefined
    })],
    ['digest mismatch', async (store: DurableEngineStore, runId: string) => {
      const record = (await store.loadGraphRun(runId))!
      return storeWithOverrides(store, {
        loadGraphRun: async () => ({ ...record, graphDigest: 'd'.repeat(64) })
      })
    }],
    ['missing node', async (store: DurableEngineStore, runId: string) => {
      const record = (await store.loadGraphRun(runId))!
      const revision = (await store.loadGraphRevision(record.graphId, record.graphRevision))!
      return storeWithOverrides(store, {
        loadGraphRevision: async () => ({ ...revision, nodes: [] })
      })
    }],
    ['AgentRun mismatch', async (store: DurableEngineStore, runId: string) => {
      const record = (await store.loadGraphRun(runId))!
      return storeWithOverrides(store, {
        loadGraphRun: async () => ({
          ...record,
          eventedV2Run: {
            ...record.eventedV2Run!,
            agentRuns: record.eventedV2Run!.agentRuns.map((agentRun) => ({
              ...agentRun,
              agentId: 'forged-agent'
            }))
          }
        })
      })
    }]
  ] as const)('rejects corrupt durable fact: %s', async (_label, corrupt) => {
    const { store, runId } = await preparedFixture()
    let executed = false
    const worker = new DurableAgentDispatchWorker({
      store: await corrupt(store, runId),
      executor: {
        async execute(input) { executed = true; return { executionRef: input.executionRef } },
        async resume() {},
        async cancel() {}
      }
    })

    await expect(worker.flushOnce()).rejects.toBeInstanceOf(EngineStoreConflictError)
    expect(executed).toBe(false)
  })

  it('recovers a terminal child with the original identity after claim expiry and rejects the stale fence', async () => {
    const { store, workId, runId } = await preparedFixture()
    let kernelStarts = 0
    const executor = new KernelAgentExecutor({
      store,
      ids: () => 'unused',
      nowIso: () => timestamp,
      startKernel: async () => {
        kernelStarts += 1
        return {
          outcome: { status: 'completed', reason: 'normal_stop', retryable: false },
          usage: { stepsUsed: 1, toolCallsUsed: 0, inputTokens: 10, outputTokens: 2, costUsd: 0.1 },
          usageRefs: ['usage:worker'],
          artifactRefs: []
        }
      }
    })
    const crashing = new DurableAgentDispatchWorker({
      store,
      workerId: 'worker-stale',
      leaseTtlMs: 1,
      executor: {
        async execute(input) {
          await executor.execute(input)
          throw new Error('crash after Kernel terminal commit')
        },
        resume: (executionRef, resolution) => executor.resume(executionRef, resolution),
        cancel: (executionRef) => executor.cancel(executionRef)
      }
    })

    await expect(crashing.flushOnce()).rejects.toThrow(/crash after Kernel terminal/)
    const stale = await store.loadOutboxIntent(workId)
    expect(stale).toMatchObject({ status: 'claimed', claim: { holderId: 'worker-stale', fence: 1 } })
    await new Promise((resolve) => setTimeout(resolve, 10))

    const recovered = new DurableAgentDispatchWorker({
      store,
      workerId: 'worker-current',
      leaseTtlMs: 30_000,
      executor
    })
    await expect(recovered.flushOnce()).resolves.toMatchObject({ processed: true, workId })
    expect(kernelStarts).toBe(1)
    await expect(store.loadRun('kernel_run-worker')).resolves.toMatchObject({ status: 'completed' })
    await expect(store.loadBudgetReservations(runId)).resolves.toMatchObject([{
      reservationId: 'reservation:kernel_run-worker', status: 'settled'
    }])
    await expect(store.commit({
      scope,
      runId: workId,
      expectedRunVersion: 0,
      expectedTaskRevision: 0,
      outboxIntents: [{
        type: 'complete',
        recordId: workId,
        claim: stale!.claim!,
        payload: stale!.payload
      }]
    })).rejects.toBeInstanceOf(EngineStoreConflictError)
  })

  it('resumes the prepared identity when the child exists before Kernel start', async () => {
    const { store, workId } = await preparedFixture()
    const intent = await store.loadOutboxIntent(workId)
    const payload = KernelDispatchPayloadSchema.parse(intent?.payload)
    const identity = payload.identity
    await store.commit({
      scope,
      runId: identity.executionRef.kernelRunId,
      expectedRunVersion: 0,
      expectedTaskRevision: 0,
      runMutation: {
        type: 'put',
        record: EngineRunRecordSchema.parse({
          runId: identity.executionRef.kernelRunId,
          scope,
          multiAgentRunId: identity.multiAgentRunId,
          agentRunId: identity.agentRunId,
          kernelRunId: identity.executionRef.kernelRunId,
          ...(identity.graph ? { graph: identity.graph } : {}),
          version: 1,
          status: 'created',
          desiredState: 'running',
          cursor: { nodeId: identity.nodeId, stepIndex: 0, checkpointSeq: 0 },
          parentRef: { kind: 'agent', runId: identity.agentRunId },
          budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
          budgetLimits: payload.requestedBudget,
          createdAt: timestamp,
          updatedAt: timestamp
        })
      }
    })
    let starts = 0
    const executor = new KernelAgentExecutor({
      store,
      ids: () => 'unused',
      nowIso: () => timestamp,
      startKernel: async (input) => {
        starts += 1
        expect(input.executionRef.kernelRunId).toBe(identity.executionRef.kernelRunId)
        return {
          outcome: { status: 'completed', reason: 'normal_stop', retryable: false },
          usage: { stepsUsed: 1, toolCallsUsed: 0, inputTokens: 10, outputTokens: 2, costUsd: 0.1 },
          usageRefs: [],
          artifactRefs: []
        }
      }
    })

    await new DurableAgentDispatchWorker({ store, executor, workerId: 'worker-recover-created' }).flushOnce()

    expect(starts).toBe(1)
    await expect(store.loadRun(identity.executionRef.kernelRunId)).resolves.toMatchObject({ status: 'completed' })
  })
})

async function preparedFixture() {
  const store = new InMemoryDurableEngineStore()
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
    ids: (prefix) => `${prefix}-worker`,
    nowIso: () => timestamp,
    dispatchPreparer: durable.runs
  })
  const run = await runtime.start({
    threadId: 'thread-worker', turnId: 'turn-worker', workspaceKey: 'workspace', prompt: 'write the report'
  })
  await runtime.dispatchActiveAgent({
    runId: run.runId,
    scope,
    prompt: 'write the report',
    requestedBudget: { stepsUsed: 2, toolCallsUsed: 2, inputTokens: 100, outputTokens: 50, costUsd: 1 },
    graph: {
      graphId: revision.graphId,
      graphRevision: revision.revision,
      graphDigest: revision.graphDigest,
      nodeId: 'agent',
      attemptId: 'agent_run-worker',
      callerId: scope.ownerId,
      policyRevision: 1
    }
  })
  const intent = await store.loadOutboxIntent('agent_execution_requested:kernel_run-worker')
  expect(KernelDispatchPayloadSchema.parse(intent?.payload)).toMatchObject({
    schemaVersion: 3,
    executionPolicyRef: {
      policyId: 'product.agent.writer', revision: 4, digest: 'b'.repeat(64)
    }
  })
  return { store, runId: run.runId, workId: 'agent_execution_requested:kernel_run-worker' }
}

function storeWithClaimPayload(store: DurableEngineStore, payload: unknown): DurableEngineStore {
  return storeWithOverrides(store, {
    claimWork: async (...args) => {
      const claim = await store.claimWork(...args)
      return claim ? { ...claim, payload } : undefined
    }
  })
}

function storeWithOverrides(store: DurableEngineStore, overrides: {
  claimWork?: DurableEngineStore['claimWork']
  loadGraphRun?: DurableEngineStore['loadGraphRun']
  loadGraphRevision?: DurableEngineStore['loadGraphRevision']
  loadRun?: DurableEngineStore['loadRun']
}): DurableEngineStore {
  return new Proxy(store, {
    get(target, property) {
      if (property in overrides) return overrides[property as keyof typeof overrides]
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
}
