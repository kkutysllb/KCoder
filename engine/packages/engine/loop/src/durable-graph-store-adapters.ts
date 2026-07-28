import {
  AgentRunIdentitySchema,
  GraphRunRecordSchema,
  KernelCancellationPayloadSchema,
  KernelDispatchPayloadSchema,
  MailboxMessageSchema,
  MultiAgentRunSchema,
  TaskScopeSchema,
  type BudgetState,
  type GraphRevision,
  type MailboxMessage,
  type MultiAgentEvent,
  type MultiAgentRun,
  type TaskScope,
  type WorkGraphEvent
} from '@qiongqi/contracts'
import {
  EngineOutboxIntentSchema,
  EngineStoreConflictError,
  type DurableEngineStore,
  type EngineCommit,
  type EngineLease,
  type EngineOutboxRecord,
  type MailboxClaimOptions,
  type MailboxStore,
  type MultiAgentRunStore,
  type MultiAgentRunUpdateOptions
} from '@qiongqi/ports'
import type { RootRunAggregateCoordinator } from './root-run-aggregate.js'
import type { AgentDispatchPreparationInput } from './kernel-agent-executor.js'
import { projectActiveNodeIds } from './parallel-branch-state.js'
import { canonicalDigest } from './execution-fingerprint.js'

export type GovernedRootStoreOptions = {
  coordinator: RootRunAggregateCoordinator
  budgetLimits: BudgetState
  policyRevision: number
}

export type DurableEventedV2StoreOptions = {
  store: DurableEngineStore
  scope: TaskScope
  graphRevision: GraphRevision
  rootAggregate?: GovernedRootStoreOptions
}

export function createDurableEventedV2Stores(options: DurableEventedV2StoreOptions): {
  runs: DurableMultiAgentRunStore
  mailbox: MailboxStore
} {
  const scope = TaskScopeSchema.parse(options.scope)
  return {
    runs: new DurableMultiAgentRunStore(options.store, scope, options.graphRevision, options.rootAggregate),
    mailbox: new DurableMailboxStore(options.store, scope)
  }
}

export class DurableMultiAgentRunStore implements MultiAgentRunStore {
  private readonly locks = new Map<string, Promise<void>>()

  constructor(
    private readonly store: DurableEngineStore,
    private readonly scope: TaskScope,
    private readonly graphRevision: GraphRevision,
    private readonly rootAggregate?: GovernedRootStoreOptions
  ) {}

  async save(rawRun: MultiAgentRun): Promise<void> {
    const run = this.assertCompatibleRun(rawRun)
    await this.withLock(run.runId, async () => {
      const current = await this.store.loadGraphRun(run.runId)
      const expectedRunVersion = current?.version ?? 0
      if (this.rootAggregate) {
        if (current) throw new EngineStoreConflictError(`MultiAgentRun already exists: ${run.runId}`)
        await this.rootAggregate.coordinator.create({
          graphRun: this.recordForRun(run, 1),
          budgetLimits: this.rootAggregate.budgetLimits,
          policyRevision: this.rootAggregate.policyRevision,
          mutations: this.mutationsForRun(run, undefined, true)
        })
        return
      }
      await this.store.commit(await this.commitForRun(run, current?.eventedV2Run, expectedRunVersion, {
        publishRevision: !current
      }))
    })
  }

  async load(runId: string): Promise<MultiAgentRun | undefined> {
    const record = await this.store.loadGraphRun(runId)
    if (!record) return undefined
    if (this.rootAggregate) {
      const aggregate = await this.rootAggregate.coordinator.load(runId)
      this.assertPinnedRecord(aggregate.graphRun)
      return aggregate.graphRun.eventedV2Run
        ? MultiAgentRunSchema.parse(aggregate.graphRun.eventedV2Run)
        : undefined
    }
    this.assertPinnedRecord(record)
    return record.eventedV2Run ? MultiAgentRunSchema.parse(record.eventedV2Run) : undefined
  }

  async update(
    runId: string,
    mutate: (current: MultiAgentRun) => MultiAgentRun | Promise<MultiAgentRun>,
    options: MultiAgentRunUpdateOptions = {}
  ): Promise<MultiAgentRun> {
    return this.withLock(runId, async () => {
      const record = await this.store.loadGraphRun(runId)
      if (!record?.eventedV2Run) throw new Error(`MultiAgentRun not found: ${runId}`)
      this.assertPinnedRecord(record)
      const compatibilityVersion = record.version - 1
      if (options.expectedVersion !== undefined && options.expectedVersion !== compatibilityVersion) {
        throw new EngineStoreConflictError(
          `MultiAgentRun version mismatch: expected ${options.expectedVersion}, got ${compatibilityVersion}`
        )
      }
      const previous = MultiAgentRunSchema.parse(record.eventedV2Run)
      let next = this.assertCompatibleRun(await mutate(previous))
      if (next.runId !== runId) throw new Error(`MultiAgentRun update cannot change runId: ${next.runId} !== ${runId}`)
      if (JSON.stringify(next) === JSON.stringify(previous)) return previous
      if (this.rootAggregate) {
        const aggregate = await this.rootAggregate.coordinator.load(runId)
        const settled = settledBudget(await this.store.loadBudgetReservations(runId))
        next = MultiAgentRunSchema.parse({ ...next, budgets: settled })
        const completedKernel = next.agentRuns.some((agentRun) =>
          agentRun.outcome !== undefined
          && previous.agentRuns.find((candidate) => candidate.agentRunId === agentRun.agentRunId)?.outcome === undefined)
        await this.rootAggregate.coordinator.update({
          runId,
          expectedVersion: record.version,
          ...(options.fence ? { lease: engineLease(runId, options.fence) } : {}),
          mutate: () => ({
            graphRun: this.recordForRun(next, record.version + 1, record.circuitState),
            ...(completedKernel ? {
              enginePatch: {
                cursor: {
                  ...aggregate.engineRun.cursor,
                  stepIndex: aggregate.engineRun.cursor.stepIndex + 1
                }
              }
            } : {})
          }),
          mutations: this.mutationsForRun(next, previous, false)
        })
        return next
      }
      await this.store.commit(await this.commitForRun(next, record.eventedV2Run, record.version, {
        leaseFence: options.fence?.epoch
      }))
      return next
    })
  }

  async prepareAgentDispatch(
    input: AgentDispatchPreparationInput,
    options: MultiAgentRunUpdateOptions = {}
  ): Promise<MultiAgentRun> {
    if (!this.rootAggregate) throw new Error('prepared dispatch requires an aggregate-backed run store')
    return this.withLock(input.multiAgentRunId, async () => {
      const current = await this.rootAggregate!.coordinator.load(input.multiAgentRunId)
      const run = current.graphRun.eventedV2Run
      if (!run) throw new Error(`MultiAgentRun not found: ${input.multiAgentRunId}`)
      const agentRun = run.agentRuns.find((candidate) => candidate.agentRunId === input.agentRunId)
      if (!agentRun) throw new Error(`AgentRun not found: ${input.agentRunId}`)
      this.assertPreparedContext(input, run)
      if (agentRun.agentId !== input.agentId || agentRun.nodeId !== input.nodeId) {
        throw new EngineStoreConflictError('prepared dispatch does not match the durable AgentRun')
      }
      if (agentRun.executionRef) {
        if (agentRun.executionRef.kernelRunId !== input.executionRef.kernelRunId) {
          throw new EngineStoreConflictError('AgentRun already has a different Kernel execution identity')
        }
        return MultiAgentRunSchema.parse(run)
      }
      const now = run.updatedAt
      const next = MultiAgentRunSchema.parse({
        ...run,
        agentRuns: run.agentRuns.map((candidate) => candidate.agentRunId === input.agentRunId
          ? { ...candidate, status: 'running', executionRef: input.executionRef, updatedAt: now }
          : candidate),
        updatedAt: now
      })
      const payload = KernelDispatchPayloadSchema.parse({
        schemaVersion: 3,
        identity: AgentRunIdentitySchema.parse({
          scope: input.scope,
          multiAgentRunId: input.multiAgentRunId,
          parentRunId: input.parentRunId,
          agentRunId: input.agentRunId,
          agentId: input.agentId,
          nodeId: input.nodeId,
          executionRef: input.executionRef,
          ...(input.graph ? { graph: input.graph } : {})
        }),
        reservationId: input.reservationId,
        requestedBudget: input.requestedBudget,
        role: input.role ?? 'agent',
        inputRef: input.inputRef,
        sharedEvidenceRefs: input.sharedEvidenceRefs ?? [],
        threadId: run.threadId,
        turnId: run.turnId,
        workspaceKey: run.workspaceKey,
        ...this.authoritativeNodePolicies(input.nodeId)
      })
      const baseMutations = this.mutationsForRun(next, run, false)
      const workId = `agent_execution_requested:${input.executionRef.kernelRunId}`
      const eventBase = {
        scope: this.scope,
        runId: run.runId,
        graphId: this.graphRevision.graphId,
        graphRevision: this.graphRevision.revision,
        nodeId: input.nodeId,
        attemptId: input.agentRunId,
        timestamp: now
      }
      const aggregate = await this.rootAggregate!.coordinator.update({
        runId: run.runId,
        expectedVersion: current.graphRun.version,
        ...(options.fence ? { lease: engineLease(run.runId, options.fence) } : {}),
        mutate: () => ({
          graphRun: this.recordForRun(next, current.graphRun.version + 1, current.graphRun.circuitState)
        }),
        mutations: {
          ...baseMutations,
          budgetReservationMutations: [{
            type: 'reserve',
            record: {
              reservationId: input.reservationId,
              scope: this.scope,
              parentRunId: run.runId,
              childRunId: input.executionRef.kernelRunId,
              status: 'reserved',
              reserved: input.requestedBudget,
              createdAt: now,
              updatedAt: now
            }
          }],
          outboxIntents: [
            ...baseMutations.outboxIntents,
            {
              type: 'put',
              record: EngineOutboxIntentSchema.parse({
                workId,
                scope: this.scope,
                kind: 'agent_execution_requested',
                payloadRef: input.inputRef,
                status: 'pending',
                availableAt: now,
                createdAt: now,
                updatedAt: now,
                payload
              })
            }
          ],
          workGraphEvents: [
            ...baseMutations.workGraphEvents,
            {
              type: 'append',
              record: {
                ...eventBase,
                eventId: `child_spawned:${input.executionRef.kernelRunId}`,
                kind: 'child_spawned',
                payload: { agentRunId: input.agentRunId, kernelRunId: input.executionRef.kernelRunId }
              }
            },
            {
              type: 'append',
              record: {
                ...eventBase,
                eventId: `budget_reserved:${input.reservationId}`,
                kind: 'budget_reserved',
                payload: { reservationId: input.reservationId, requestedBudget: input.requestedBudget }
              }
            }
          ]
        }
      })
      return MultiAgentRunSchema.parse(aggregate.graphRun.eventedV2Run)
    })
  }

  async prepareAgentDispatches(
    inputs: AgentDispatchPreparationInput[],
    options: MultiAgentRunUpdateOptions = {}
  ): Promise<MultiAgentRun> {
    if (!this.rootAggregate) throw new Error('prepared dispatch requires an aggregate-backed run store')
    if (inputs.length === 0) throw new Error('parallel dispatch preparation requires at least one AgentRun')
    const multiAgentRunId = inputs[0]!.multiAgentRunId
    if (inputs.some((input) => input.multiAgentRunId !== multiAgentRunId || input.parentRunId !== multiAgentRunId)) {
      throw new EngineStoreConflictError('parallel dispatch inputs must share one governed root')
    }
    if (new Set(inputs.map((input) => input.agentRunId)).size !== inputs.length) {
      throw new EngineStoreConflictError('parallel dispatch contains duplicate AgentRun identities')
    }

    return this.withLock(multiAgentRunId, async () => {
      const current = await this.rootAggregate!.coordinator.load(multiAgentRunId)
      const run = current.graphRun.eventedV2Run
      if (!run) throw new Error(`MultiAgentRun not found: ${multiAgentRunId}`)
      const pending: AgentDispatchPreparationInput[] = []
      for (const input of inputs) {
        const agentRun = run.agentRuns.find((candidate) => candidate.agentRunId === input.agentRunId)
        if (!agentRun) throw new Error(`AgentRun not found: ${input.agentRunId}`)
        this.assertPreparedContext(input, run)
        if (agentRun.agentId !== input.agentId || agentRun.nodeId !== input.nodeId) {
          throw new EngineStoreConflictError('prepared dispatch does not match the durable AgentRun')
        }
        if (agentRun.branchId) {
          const branch = run.branches[agentRun.branchId]
          if (!branch?.agentRunIds.includes(agentRun.agentRunId) || branch.activeNodeId !== agentRun.nodeId) {
            throw new EngineStoreConflictError('prepared dispatch does not match the durable branch cursor')
          }
        }
        if (agentRun.executionRef) {
          if (agentRun.executionRef.kernelRunId !== input.executionRef.kernelRunId) {
            throw new EngineStoreConflictError('AgentRun already has a different Kernel execution identity')
          }
          continue
        }
        pending.push(input)
      }
      if (pending.length === 0) return MultiAgentRunSchema.parse(run)

      const now = run.updatedAt
      const executionByAgentRun = new Map(pending.map((input) => [input.agentRunId, input.executionRef]))
      const next = MultiAgentRunSchema.parse({
        ...run,
        agentRuns: run.agentRuns.map((candidate) => {
          const executionRef = executionByAgentRun.get(candidate.agentRunId)
          return executionRef
            ? { ...candidate, status: 'running', executionRef, updatedAt: now }
            : candidate
        }),
        updatedAt: now
      })
      const baseMutations = this.mutationsForRun(next, run, false)
      const payloads = pending.map((input) => KernelDispatchPayloadSchema.parse({
        schemaVersion: 3,
        identity: AgentRunIdentitySchema.parse({
          scope: input.scope,
          multiAgentRunId: input.multiAgentRunId,
          parentRunId: input.parentRunId,
          agentRunId: input.agentRunId,
          agentId: input.agentId,
          nodeId: input.nodeId,
          executionRef: input.executionRef,
          ...(input.graph ? { graph: input.graph } : {})
        }),
        reservationId: input.reservationId,
        requestedBudget: input.requestedBudget,
        role: input.role ?? 'agent',
        inputRef: input.inputRef,
        sharedEvidenceRefs: input.sharedEvidenceRefs ?? [],
        threadId: run.threadId,
        turnId: run.turnId,
        workspaceKey: run.workspaceKey,
        ...this.authoritativeNodePolicies(input.nodeId)
      }))

      const aggregate = await this.rootAggregate!.coordinator.update({
        runId: run.runId,
        expectedVersion: current.graphRun.version,
        ...(options.fence ? { lease: engineLease(run.runId, options.fence) } : {}),
        mutate: () => ({
          graphRun: this.recordForRun(next, current.graphRun.version + 1, current.graphRun.circuitState)
        }),
        mutations: {
          ...baseMutations,
          budgetReservationMutations: pending.map((input) => ({
            type: 'reserve' as const,
            record: {
              reservationId: input.reservationId,
              scope: this.scope,
              parentRunId: run.runId,
              childRunId: input.executionRef.kernelRunId,
              status: 'reserved' as const,
              reserved: input.requestedBudget,
              createdAt: now,
              updatedAt: now
            }
          })),
          outboxIntents: [
            ...baseMutations.outboxIntents,
            ...pending.map((input, index) => ({
              type: 'put' as const,
              record: EngineOutboxIntentSchema.parse({
                workId: `agent_execution_requested:${input.executionRef.kernelRunId}`,
                scope: this.scope,
                kind: 'agent_execution_requested',
                payloadRef: input.inputRef,
                status: 'pending',
                availableAt: now,
                createdAt: now,
                updatedAt: now,
                payload: payloads[index]
              })
            }))
          ],
          workGraphEvents: [
            ...baseMutations.workGraphEvents,
            ...pending.flatMap((input) => {
              const eventBase = {
                scope: this.scope,
                runId: run.runId,
                graphId: this.graphRevision.graphId,
                graphRevision: this.graphRevision.revision,
                nodeId: input.nodeId,
                attemptId: input.agentRunId,
                timestamp: now
              }
              return [
                {
                  type: 'append' as const,
                  record: {
                    ...eventBase,
                    eventId: `child_spawned:${input.executionRef.kernelRunId}`,
                    kind: 'child_spawned' as const,
                    payload: { agentRunId: input.agentRunId, kernelRunId: input.executionRef.kernelRunId }
                  }
                },
                {
                  type: 'append' as const,
                  record: {
                    ...eventBase,
                    eventId: `budget_reserved:${input.reservationId}`,
                    kind: 'budget_reserved' as const,
                    payload: { reservationId: input.reservationId, requestedBudget: input.requestedBudget }
                  }
                }
              ]
            })
          ]
        }
      })
      return MultiAgentRunSchema.parse(aggregate.graphRun.eventedV2Run)
    })
  }

  async loadVersion(runId: string): Promise<number | undefined> {
    const record = await this.store.loadGraphRun(runId)
    if (record && this.rootAggregate) await this.rootAggregate.coordinator.load(runId)
    return record?.eventedV2Run ? record.version - 1 : undefined
  }

  async acquireLease(runId: string, holderId: string, ttlMs: number): Promise<{
    acquired: boolean
    expiresAt?: string
    fence?: { holderId: string; epoch: number; token: string }
  }> {
    const lease = await this.store.acquireLease(runId, holderId, ttlMs)
    return lease
      ? { acquired: true, expiresAt: lease.expiresAt, fence: mailboxFence(lease) }
      : { acquired: false }
  }

  async renewLease(
    runId: string,
    holderId: string,
    fenceOrTtl: { holderId: string; epoch: number; token: string } | number,
    ttlMs?: number
  ): Promise<boolean> {
    if (typeof fenceOrTtl === 'number') return false
    if (fenceOrTtl.holderId !== holderId || ttlMs === undefined) return false
    const renewed = await this.store.renewLease(runId, engineLease(runId, fenceOrTtl), ttlMs)
    return Boolean(renewed)
  }

  async releaseLease(
    runId: string,
    holderId: string,
    fence?: { holderId: string; epoch: number; token: string }
  ): Promise<void> {
    if (!fence || fence.holderId !== holderId) return
    await this.store.releaseLease(runId, engineLease(runId, fence))
  }

  async listAll(): Promise<MultiAgentRun[]> {
    const records = (await this.store.listGraphRuns(this.scope))
      .filter((record) => this.isPinnedRecord(record) && record.eventedV2Run)
    if (this.rootAggregate) {
      await Promise.all(records.map((record) => this.rootAggregate!.coordinator.load(record.runId)))
    }
    return records.map((record) => MultiAgentRunSchema.parse(record.eventedV2Run))
  }

  async listWithPendingOutbox(): Promise<MultiAgentRun[]> {
    return (await this.listAll()).filter((run) => run.outbox.some((intent) => intent.status === 'pending'))
  }

  async listByThread(threadId: string): Promise<MultiAgentRun[]> {
    return (await this.listAll()).filter((run) => run.threadId === threadId)
  }

  async delete(runId: string): Promise<void> {
    await this.withLock(runId, async () => {
      const current = await this.store.loadGraphRun(runId)
      if (!current) return
      this.assertPinnedRecord(current)
      if (this.rootAggregate) {
        await this.rootAggregate.coordinator.delete(runId)
        return
      }
      await this.store.commit({
        scope: this.scope,
        runId,
        expectedRunVersion: current.version,
        expectedTaskRevision: await this.taskRevision(),
        graphRunMutation: { type: 'delete', recordId: runId }
      })
    })
  }

  private async commitForRun(
    run: MultiAgentRun,
    previous: MultiAgentRun | undefined,
    expectedRunVersion: number,
    options: { publishRevision?: boolean; leaseFence?: number }
  ): Promise<EngineCommit> {
    const nextVersion = expectedRunVersion + 1
    return {
      scope: this.scope,
      runId: run.runId,
      expectedRunVersion,
      expectedTaskRevision: await this.taskRevision(),
      ...(options.leaseFence !== undefined ? { leaseFence: options.leaseFence } : {}),
      graphRunMutation: { type: 'put', record: this.recordForRun(run, nextVersion) },
      ...this.mutationsForRun(run, previous, Boolean(options.publishRevision))
    }
  }

  private recordForRun(
    run: MultiAgentRun,
    version: number,
    circuitState: 'running' | 'report_only' | 'paused' | 'retired' = 'running'
  ) {
    return GraphRunRecordSchema.parse({
      schemaVersion: 1,
      scope: this.scope,
      runId: run.runId,
      threadId: run.threadId,
      turnId: run.turnId,
      workspaceKey: run.workspaceKey,
      graphId: this.graphRevision.graphId,
      graphRevision: this.graphRevision.revision,
      graphDigest: this.graphRevision.graphDigest,
      version,
      status: run.status,
      circuitState,
      activeNodeIds: projectActiveNodeIds(run),
      budgets: run.budgets,
      eventedV2Run: run,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt
    })
  }

  private mutationsForRun(
    run: MultiAgentRun,
    previous: MultiAgentRun | undefined,
    publishRevision: boolean
  ) {
    const projections = eventedRunProjectionMutations(
      this.scope,
      this.graphRevision,
      this.rootAggregate?.policyRevision ?? 1,
      run,
      previous
    )
    return {
      graphRevisionMutations: publishRevision ? [{ type: 'put' as const, record: this.graphRevision }] : [],
      ...projections,
      outboxIntents: [
        ...durableRunOutbox(this.scope, run, previous),
        ...durableKernelCancellations(this.scope, run, previous)
      ]
    }
  }

  private assertPreparedContext(input: AgentDispatchPreparationInput, run: MultiAgentRun): void {
    const node = this.graphRevision.nodes.find((candidate) => candidate.id === input.nodeId)
    if (!node) throw new EngineStoreConflictError(`prepared dispatch graph node not found: ${input.nodeId}`)
    if (!sameValue(input.scope, this.scope)
      || input.threadId !== run.threadId
      || input.turnId !== run.turnId
      || input.workspaceKey !== run.workspaceKey
      || !sameValue(input.nodePolicyRef, node.nodePolicyRef)
      || !sameValue(input.modelPolicyRef, 'modelPolicyRef' in node ? node.modelPolicyRef : undefined)
      || !sameValue(input.executionPolicyRef, 'executionPolicyRef' in node ? node.executionPolicyRef : undefined)) {
      throw new EngineStoreConflictError('prepared dispatch contradicts durable run or pinned node policy')
    }
    if (input.graph && (input.graph.graphId !== this.graphRevision.graphId
      || input.graph.graphRevision !== this.graphRevision.revision
      || input.graph.graphDigest !== this.graphRevision.graphDigest
      || input.graph.nodeId !== input.nodeId)) {
      throw new EngineStoreConflictError('prepared dispatch contradicts pinned graph revision')
    }
  }

  private authoritativeNodePolicies(nodeId: string) {
    const node = this.graphRevision.nodes.find((candidate) => candidate.id === nodeId)
    if (!node) throw new EngineStoreConflictError(`prepared dispatch graph node not found: ${nodeId}`)
    return {
      ...(node.nodePolicyRef ? { nodePolicyRef: node.nodePolicyRef } : {}),
      ...('modelPolicyRef' in node && node.modelPolicyRef ? { modelPolicyRef: node.modelPolicyRef } : {}),
      ...('executionPolicyRef' in node && node.executionPolicyRef
        ? { executionPolicyRef: node.executionPolicyRef }
        : {})
    }
  }

  private assertCompatibleRun(run: MultiAgentRun): MultiAgentRun {
    const parsed = MultiAgentRunSchema.parse(run)
    if (parsed.graphId !== this.graphRevision.graphId) {
      throw new Error(`MultiAgentRun graph mismatch: ${parsed.graphId} !== ${this.graphRevision.graphId}`)
    }
    return parsed
  }

  private assertPinnedRecord(record: { graphId: string; graphRevision: number; graphDigest: string }): void {
    if (!this.isPinnedRecord(record)) throw new Error('durable graph run does not match the configured graph revision')
  }

  private isPinnedRecord(record: { graphId: string; graphRevision: number; graphDigest: string }): boolean {
    return record.graphId === this.graphRevision.graphId
      && record.graphRevision === this.graphRevision.revision
      && record.graphDigest === this.graphRevision.graphDigest
  }

  private async taskRevision(): Promise<number> {
    return (await this.store.loadTask(this.scope))?.revision ?? 0
  }

  private async withLock<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(runId) ?? Promise.resolve()
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const current = previous.catch(() => undefined).then(() => gate)
    this.locks.set(runId, current)
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
      if (this.locks.get(runId) === current) this.locks.delete(runId)
    }
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return left === right
  return canonicalDigest(left) === canonicalDigest(right)
}

export function eventedRunProjectionMutations(
  scope: TaskScope,
  revision: GraphRevision,
  policyRevision: number,
  run: MultiAgentRun,
  previous: MultiAgentRun | undefined
): {
  workGraphEvents: NonNullable<EngineCommit['workGraphEvents']>
  streamEvents: NonNullable<EngineCommit['streamEvents']>
} {
  return {
    workGraphEvents: newWorkEvents(scope, revision, run, previous),
    streamEvents: newStreamEvents(scope, revision, policyRevision, run, previous)
  }
}

const budgetKeys = ['stepsUsed', 'toolCallsUsed', 'inputTokens', 'outputTokens', 'costUsd'] as const

function settledBudget(
  reservations: Awaited<ReturnType<DurableEngineStore['loadBudgetReservations']>>
): BudgetState {
  return reservations
    .filter((reservation) => reservation.status === 'settled' && reservation.actual)
    .reduce<BudgetState>((total, reservation) => {
      const actual = reservation.actual!
      return Object.fromEntries(budgetKeys.map((key) => [key, total[key] + actual[key]])) as BudgetState
    }, { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 })
}

export class DurableMailboxStore implements MailboxStore {
  constructor(
    private readonly store: DurableEngineStore,
    private readonly scope: TaskScope
  ) {}

  async enqueue(rawMessage: MailboxMessage): Promise<void> {
    const message = MailboxMessageSchema.parse(rawMessage)
    await this.requireRun(message.runId)
    const timestamp = message.updatedAt
    await this.store.commit({
      scope: this.scope,
      runId: mailboxWorkId(message.messageId),
      expectedRunVersion: 0,
      expectedTaskRevision: await this.taskRevision(),
      outboxIntents: [{
        type: 'put',
        record: EngineOutboxIntentSchema.parse({
          workId: mailboxWorkId(message.messageId),
          scope: this.scope,
          kind: mailboxKind(message.toAgentId),
          payloadRef: `mailbox://${message.messageId}`,
          status: message.status === 'queued' ? 'pending' : 'completed',
          availableAt: message.createdAt,
          createdAt: message.createdAt,
          updatedAt: timestamp,
          ...(message.status === 'queued' ? {} : { completedAt: timestamp }),
          payload: message
        })
      }]
    })
  }

  async claimNext(agentId: string, options: MailboxClaimOptions = {
    holderId: 'evented_v2_mailbox',
    ttlMs: 30_000
  }): Promise<MailboxMessage | undefined> {
    const claim = await this.store.claimWork(options.holderId, [mailboxKind(agentId)], options.ttlMs)
    if (!claim?.payload) return undefined
    const message = MailboxMessageSchema.parse(claim.payload)
    return MailboxMessageSchema.parse({
      ...message,
      status: 'delivered',
      claimLease: mailboxFence(claim.lease, claim.lease.expiresAt),
      updatedAt: new Date().toISOString()
    })
  }

  async complete(
    messageId: string,
    status: 'completed' | 'failed' | 'aborted' = 'completed',
    fence?: MailboxMessage['claimLease']
  ): Promise<void> {
    const workId = mailboxWorkId(messageId)
    const record = await this.store.loadOutboxIntent(workId)
    if (!record) return
    const message = MailboxMessageSchema.parse(record.payload)
    if (isMailboxTerminal(message.status)) {
      if (message.status === status) return
      throw new EngineStoreConflictError('Mailbox complete rejected by stale mailbox claim')
    }
    if (fence && (!record.claim || !sameMailboxFence(record.claim, fence))) {
      throw new EngineStoreConflictError('Mailbox complete rejected by stale mailbox claim')
    }
    await this.requireRun(message.runId)
    const { claimLease: _claimLease, ...rest } = message
    const completed = MailboxMessageSchema.parse({
      ...rest,
      status,
      updatedAt: new Date().toISOString()
    })
    await this.store.commit({
      scope: this.scope,
      runId: workId,
      expectedRunVersion: 0,
      expectedTaskRevision: await this.taskRevision(),
      outboxIntents: [{
        type: 'complete',
        recordId: workId,
        ...(record.claim && fence ? { claim: record.claim } : {}),
        payload: completed
      }]
    })
  }

  async listForRun(runId: string): Promise<MailboxMessage[]> {
    return (await this.store.listOutboxIntents(this.scope))
      .filter((record) => record.kind.startsWith('evented_v2_mailbox:'))
      .map((record) => mailboxMessageFromRecord(record))
      .filter((message) => message.runId === runId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.messageId.localeCompare(right.messageId))
  }

  private async requireRun(runId: string) {
    const run = await this.store.loadGraphRun(runId)
    if (!run) throw new Error(`GraphRun not found for mailbox message: ${runId}`)
    if (TaskScopeSchema.parse(run.scope).ownerId !== this.scope.ownerId
      || run.scope.workspaceId !== this.scope.workspaceId
      || run.scope.taskId !== this.scope.taskId) {
      throw new Error(`Mailbox run scope mismatch: ${runId}`)
    }
    return run
  }

  private async taskRevision(): Promise<number> {
    return (await this.store.loadTask(this.scope))?.revision ?? 0
  }
}

function newWorkEvents(
  scope: TaskScope,
  revision: GraphRevision,
  run: MultiAgentRun,
  previous: MultiAgentRun | undefined
): Array<{ type: 'append'; record: WorkGraphEvent }> {
  const previousIds = new Set(previous?.events.map((event) => event.eventId) ?? [])
  const records: WorkGraphEvent[] = []
  const traversedEdgeIds = new Set<string>()
  for (const event of run.events.filter((candidate) => !previousIds.has(candidate.eventId))) {
    records.push({
        eventId: event.eventId,
        scope,
        runId: run.runId,
        graphId: revision.graphId,
        graphRevision: revision.revision,
        ...(event.nodeId ? { nodeId: event.nodeId } : {}),
        ...(event.branchId ? { branchId: event.branchId } : {}),
        attemptId: event.eventId,
        kind: workEventKind(event),
        payload: { source: 'evented_v2', event },
        timestamp: event.timestamp
    })
    const edge = edgeForLegacyEvent(revision, event)
    if (!edge || traversedEdgeIds.has(edge.edgeId)) continue
    traversedEdgeIds.add(edge.edgeId)
    const attemptId = `${event.eventId}:${edge.edgeId}`
    records.push(
      {
        eventId: `${event.eventId}:edge_selected`,
        scope,
        runId: run.runId,
        graphId: revision.graphId,
        graphRevision: revision.revision,
        nodeId: edge.from,
        edgeId: edge.edgeId,
        attemptId,
        kind: 'edge_selected',
        payload: { condition: edge.condition, sourceEventId: event.eventId },
        timestamp: event.timestamp
      },
      {
        eventId: `${event.eventId}:edge_traversed`,
        scope,
        runId: run.runId,
        graphId: revision.graphId,
        graphRevision: revision.revision,
        nodeId: edge.from,
        edgeId: edge.edgeId,
        attemptId,
        kind: 'edge_traversed',
        payload: { condition: edge.condition, targetNodeId: edge.to, sourceEventId: event.eventId },
        timestamp: event.timestamp
      }
    )
  }
  return records.map((record) => ({ type: 'append', record }))
}

function newStreamEvents(
  scope: TaskScope,
  revision: GraphRevision,
  policyRevision: number,
  run: MultiAgentRun,
  previous: MultiAgentRun | undefined
): NonNullable<EngineCommit['streamEvents']> {
  const previousIds = new Set(previous?.events.map((event) => event.eventId) ?? [])
  return run.events
    .filter((event) => !previousIds.has(event.eventId))
    .map((event) => ({
      type: 'append' as const,
      record: {
        streamId: `stream:${run.runId}`,
        timestamp: event.timestamp,
        scope,
        multiAgentRunId: run.runId,
        ...(event.branchId ? { branchId: event.branchId } : {}),
        graph: {
          graphId: revision.graphId,
          graphRevision: revision.revision,
          graphDigest: revision.graphDigest,
          ...(event.branchId ? { branchId: event.branchId } : {}),
          ...(event.nodeId ? { nodeId: event.nodeId } : {}),
          attemptId: event.eventId,
          callerId: scope.ownerId,
          policyRevision
        },
        channel: 'public' as const,
        kind: event.type.replaceAll('_', '.'),
        payload: {
          eventId: event.eventId,
          ...(event.nodeId ? { nodeId: event.nodeId } : {}),
          ...(event.agentId ? { agentId: event.agentId } : {}),
          ...(event.envelopeId ? { envelopeId: event.envelopeId } : {}),
          ...(event.payload !== undefined ? { data: event.payload } : {})
        }
      }
    }))
}

function edgeForLegacyEvent(revision: GraphRevision, event: MultiAgentEvent) {
  if (event.type === 'node_completed' && event.nodeId) {
    const condition = event.payload && typeof event.payload === 'object' && 'condition' in event.payload
      ? String(event.payload.condition)
      : undefined
    if (condition) return revision.edges.find((edge) => edge.from === event.nodeId && edge.condition === condition)
  }
  if (event.type === 'handoff_requested' && event.nodeId) {
    return revision.edges.find((edge) => edge.to === event.nodeId && edge.condition === 'handoff')
  }
  if (event.type === 'handoff_delivered' && event.nodeId) {
    return revision.edges.find((edge) => edge.to === event.nodeId && edge.condition === 'accepted')
  }
  return undefined
}

function workEventKind(event: MultiAgentEvent): WorkGraphEvent['kind'] {
  return {
    run_started: 'run_started',
    node_started: 'node_started',
    node_completed: 'node_completed',
    handoff_requested: 'node_started',
    handoff_delivered: 'node_completed',
    branch_spawned: 'branch_spawned',
    branch_started: 'branch_started',
    branch_completed: 'branch_completed',
    branch_failed: 'branch_failed',
    branch_cancelled: 'branch_cancelled',
    branch_late_result: 'branch_late_result',
    join_waiting: 'join_waiting',
    join_completed: 'join_completed',
    run_completed: 'run_completed',
    run_failed: 'run_failed',
    run_cancelled: 'run_cancelled'
  }[event.type] as WorkGraphEvent['kind']
}

function durableRunOutbox(
  scope: TaskScope,
  run: MultiAgentRun,
  previous: MultiAgentRun | undefined
): NonNullable<EngineCommit['outboxIntents']> {
  const previousById = new Map(previous?.outbox.map((intent) => [intent.outboxId, intent]) ?? [])
  const mutations: NonNullable<EngineCommit['outboxIntents']> = []
  for (const intent of run.outbox) {
    const workId = runOutboxWorkId(intent.outboxId)
    if (intent.status === 'pending') {
      mutations.push({
        type: 'put' as const,
        record: EngineOutboxIntentSchema.parse({
          workId,
          scope,
          kind: 'evented_v2_outbox',
          payloadRef: `evented-v2-outbox://${intent.outboxId}`,
          status: 'pending',
          availableAt: intent.createdAt,
          createdAt: intent.createdAt,
          updatedAt: intent.updatedAt,
          payload: intent
        })
      })
      continue
    }
    if (previousById.get(intent.outboxId)?.status === 'pending') {
      mutations.push({ type: 'complete', recordId: workId, payload: intent })
    }
  }
  return mutations
}

function durableKernelCancellations(
  scope: TaskScope,
  run: MultiAgentRun,
  previous: MultiAgentRun | undefined
): NonNullable<EngineCommit['outboxIntents']> {
  const previousById = new Map(previous?.agentRuns.map((agentRun) => [agentRun.agentRunId, agentRun]) ?? [])
  return run.agentRuns.flatMap((agentRun) => {
    const before = previousById.get(agentRun.agentRunId)
    if (agentRun.status !== 'aborted'
      || before?.status === 'aborted'
      || !agentRun.branchId
      || !agentRun.executionRef) return []
    const payload = KernelCancellationPayloadSchema.parse({
      schemaVersion: 1,
      executionRef: agentRun.executionRef,
      branchId: agentRun.branchId,
      reason: 'fail_fast'
    })
    return [{
      type: 'put' as const,
      record: EngineOutboxIntentSchema.parse({
        workId: `agent_execution_cancel_requested:${agentRun.executionRef.kernelRunId}`,
        scope,
        kind: 'agent_execution_cancel_requested',
        payloadRef: `kernel-run://${agentRun.executionRef.kernelRunId}/cancel`,
        status: 'pending',
        availableAt: run.updatedAt,
        createdAt: run.updatedAt,
        updatedAt: run.updatedAt,
        payload
      })
    }]
  })
}

function mailboxMessageFromRecord(record: EngineOutboxRecord): MailboxMessage {
  const message = MailboxMessageSchema.parse(record.payload)
  if (record.status === 'claimed' && record.claim) {
    return MailboxMessageSchema.parse({
      ...message,
      status: 'delivered',
      claimLease: mailboxFence(record.claim, record.claim.expiresAt),
      updatedAt: record.updatedAt
    })
  }
  return message
}

function mailboxFence(lease: EngineLease, expiresAt = lease.expiresAt) {
  return { holderId: lease.holderId, epoch: lease.fence, token: lease.token, expiresAt }
}

function engineLease(runId: string, fence: { holderId: string; epoch: number; token: string }): EngineLease {
  return {
    runId,
    holderId: fence.holderId,
    fence: fence.epoch,
    token: fence.token,
    expiresAt: new Date().toISOString()
  }
}

function sameMailboxFence(lease: EngineLease, fence: NonNullable<MailboxMessage['claimLease']>): boolean {
  return lease.holderId === fence.holderId && lease.fence === fence.epoch && lease.token === fence.token
}

function isMailboxTerminal(status: MailboxMessage['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'aborted'
}

function mailboxKind(agentId: string): string {
  return `evented_v2_mailbox:${agentId}`
}

function mailboxWorkId(messageId: string): string {
  return `mailbox:${messageId}`
}

function runOutboxWorkId(outboxId: string): string {
  return `evented-outbox:${outboxId}`
}
