import {
  BudgetStateSchema,
  GraphRunRecordSchema,
  RootRunAggregateErrorCodeSchema,
  type BudgetState,
  type GraphRunRecord,
  type RootRunAggregateErrorCode
} from '@qiongqi/contracts'
import {
  EngineRunRecordSchema,
  EngineStoreConflictError,
  type DurableEngineStore,
  type EngineCommit,
  type EngineLease,
  type EngineRunRecord
} from '@qiongqi/ports'

export class RootRunAggregateError extends Error {
  constructor(
    readonly code: RootRunAggregateErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    RootRunAggregateErrorCodeSchema.parse(code)
    super(message, options)
    this.name = 'RootRunAggregateError'
  }
}

export type RootRunAggregate = {
  graphRun: GraphRunRecord
  engineRun: EngineRunRecord
}

export type RootRunCommitMutations = Partial<Omit<
  EngineCommit,
  | 'scope'
  | 'runId'
  | 'aggregateKind'
  | 'expectedRunVersion'
  | 'expectedTaskRevision'
  | 'expectedModelPolicyRevision'
  | 'leaseFence'
  | 'graphRunMutation'
  | 'runMutation'
>>

export type CreateRootRunAggregateInput = {
  graphRun: GraphRunRecord
  budgetLimits: BudgetState
  policyRevision: number
  mutations?: RootRunCommitMutations
}

export type RootRunEnginePatch = Partial<Pick<
  EngineRunRecord,
  'status' | 'desiredState' | 'cursor' | 'budgets' | 'outcome' | 'suspension'
>>

export type UpdateRootRunAggregateInput = {
  runId: string
  expectedVersion?: number
  lease?: EngineLease
  mutate: (
    current: RootRunAggregate
  ) => {
    graphRun: GraphRunRecord
    enginePatch?: RootRunEnginePatch
  } | Promise<{
    graphRun: GraphRunRecord
    enginePatch?: RootRunEnginePatch
  }>
  mutations?: RootRunCommitMutations
  allowCancelled?: boolean
  allowTerminal?: boolean
}

export type RootRunAggregateCoordinatorOptions = {
  store: DurableEngineStore
  nowIso?: () => string
}

export type MigrateGraphOnlyRunInput = {
  runId: string
  budgetLimits: BudgetState
}

const compatibleEngineStatuses: Record<GraphRunRecord['status'], readonly EngineRunRecord['status'][]> = {
  created: ['created'],
  running: ['running'],
  suspended: ['waiting_approval', 'waiting_input', 'waiting_effect_verification', 'waiting_model_resolution'],
  completed: ['completed'],
  failed: ['failed', 'degraded'],
  aborted: ['aborted']
}

export class RootRunAggregateCoordinator {
  private readonly nowIso: () => string

  constructor(private readonly options: RootRunAggregateCoordinatorOptions) {
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
  }

  async create(input: CreateRootRunAggregateInput): Promise<RootRunAggregate> {
    const graphRun = GraphRunRecordSchema.parse(input.graphRun)
    const budgetLimits = BudgetStateSchema.parse(input.budgetLimits)
    if (!Number.isInteger(input.policyRevision) || input.policyRevision <= 0) {
      throw new Error('root run policy revision must be a positive integer')
    }
    if (graphRun.version !== 1) {
      throw new EngineStoreConflictError('new governed root projections must start at version 1')
    }
    const [existingGraph, existingEngine] = await Promise.all([
      this.options.store.loadGraphRun(graphRun.runId),
      this.options.store.loadRun(graphRun.runId)
    ])
    if (existingGraph || existingEngine) {
      throw new EngineStoreConflictError(`governed root already exists: ${graphRun.runId}`)
    }

    const nodeId = activeNodeId(graphRun)
    const engineRun = EngineRunRecordSchema.parse({
      runId: graphRun.runId,
      scope: graphRun.scope,
      multiAgentRunId: graphRun.runId,
      graph: {
        graphId: graphRun.graphId,
        graphRevision: graphRun.graphRevision,
        graphDigest: graphRun.graphDigest,
        nodeId,
        attemptId: graphRun.runId,
        callerId: graphRun.scope.ownerId,
        policyRevision: input.policyRevision
      },
      version: 1,
      status: statusForGraph(graphRun, undefined),
      desiredState: 'running',
      cursor: { nodeId, stepIndex: 0, checkpointSeq: 0 },
      budgets: graphRun.budgets,
      budgetLimits,
      createdAt: graphRun.createdAt,
      updatedAt: graphRun.updatedAt
    })
    await this.options.store.commit({
      ...input.mutations,
      scope: graphRun.scope,
      runId: graphRun.runId,
      aggregateKind: 'governed_root',
      expectedRunVersion: 0,
      expectedTaskRevision: await this.taskRevision(graphRun.scope),
      graphRunMutation: { type: 'put', record: graphRun },
      runMutation: { type: 'put', record: engineRun }
    })
    return this.load(graphRun.runId)
  }

  async load(runId: string): Promise<RootRunAggregate> {
    const [rawGraph, rawEngine] = await Promise.all([
      this.options.store.loadGraphRun(runId),
      this.options.store.loadRun(runId)
    ])
    if (!rawGraph && !rawEngine) throw new Error(`governed root run not found: ${runId}`)
    if (!rawGraph || !rawEngine) {
      throw new RootRunAggregateError(
        'ROOT_RUN_AGGREGATE_INCOMPLETE',
        `governed root ${runId} is missing its ${rawGraph ? 'EngineRun' : 'GraphRun'} projection`
      )
    }
    const graphRun = GraphRunRecordSchema.parse(rawGraph)
    const engineRun = EngineRunRecordSchema.parse(rawEngine)
    this.assertAggregate(graphRun, engineRun)
    return { graphRun, engineRun }
  }

  async migrateGraphOnly(input: MigrateGraphOnlyRunInput): Promise<RootRunAggregate> {
    const budgetLimits = BudgetStateSchema.parse(input.budgetLimits)
    const lease = await this.options.store.acquireLease(
      input.runId,
      `root-migration:${input.runId}`,
      30_000
    )
    if (!lease) throw new EngineStoreConflictError(`root migration lease unavailable: ${input.runId}`)
    try {
      const [rawGraph, rawEngine] = await Promise.all([
        this.options.store.loadGraphRun(input.runId),
        this.options.store.loadRun(input.runId)
      ])
      if (!rawGraph) throw new Error(`graph-only run not found: ${input.runId}`)
      if (rawEngine) throw new EngineStoreConflictError(`root EngineRun already exists: ${input.runId}`)
      const current = GraphRunRecordSchema.parse(rawGraph)
      const [revision, policy, reservations] = await Promise.all([
        this.options.store.loadGraphRevision(current.graphId, current.graphRevision),
        this.options.store.loadTaskModelPolicy(current.scope),
        this.options.store.loadBudgetReservations(input.runId)
      ])
      if (!revision || revision.graphDigest !== current.graphDigest) {
        throw new EngineStoreConflictError(`pinned GraphRevision unavailable for migration: ${input.runId}`)
      }
      if (!policy) throw new EngineStoreConflictError(`task model policy unavailable for migration: ${input.runId}`)
      if (!revision.nodes.some((node) => node.id === activeNodeId(current))) {
        throw new EngineStoreConflictError(`active graph node unavailable for migration: ${activeNodeId(current)}`)
      }
      assertMigratableGraphState(current)
      for (const reservation of reservations) {
        if (reservation.parentRunId !== input.runId || !sameScope(current.scope, reservation.scope)) {
          throw new EngineStoreConflictError(`reservation ${reservation.reservationId} contradicts graph-only root scope`)
        }
        const child = await this.options.store.loadRun(reservation.childRunId)
        if (child && (child.multiAgentRunId !== input.runId
          || child.kernelRunId !== reservation.childRunId
          || !sameScope(current.scope, child.scope))) {
          throw new EngineStoreConflictError(`reservation ${reservation.reservationId} contradicts durable child evidence`)
        }
      }
      const committed = reservations.reduce(
        (total, reservation) => addBudget(total, committedReservationBudget(reservation)),
        zeroBudget()
      )
      assertWithinBudget(committed, budgetLimits)
      const settled = reservations
        .filter((reservation) => reservation.status === 'settled')
        .reduce(
          (total, reservation) => addBudget(total, requiredActualBudget(reservation)),
          zeroBudget()
        )
      const now = this.nowIso()
      const version = current.version + 1
      const graphRun = GraphRunRecordSchema.parse({
        ...current,
        version,
        budgets: settled,
        ...(current.eventedV2Run ? {
          eventedV2Run: { ...current.eventedV2Run, budgets: settled, updatedAt: now }
        } : {}),
        updatedAt: now
      })
      const nodeId = activeNodeId(graphRun)
      const engineRun = EngineRunRecordSchema.parse({
        runId: graphRun.runId,
        scope: graphRun.scope,
        multiAgentRunId: graphRun.runId,
        graph: {
          graphId: graphRun.graphId,
          graphRevision: graphRun.graphRevision,
          graphDigest: graphRun.graphDigest,
          nodeId,
          attemptId: graphRun.runId,
          callerId: graphRun.scope.ownerId,
          policyRevision: policy.revision
        },
        version,
        status: statusForGraph(graphRun, undefined),
        desiredState: graphRun.status === 'aborted' ? 'cancelled' : 'running',
        cursor: { nodeId, stepIndex: 0, checkpointSeq: 0 },
        budgets: settled,
        budgetLimits,
        createdAt: graphRun.createdAt,
        updatedAt: now
      })
      const eventId = `root_run_repaired:${input.runId}:${version}`
      await this.options.store.commit({
        scope: current.scope,
        runId: input.runId,
        aggregateKind: 'governed_root',
        expectedRunVersion: current.version,
        expectedTaskRevision: await this.taskRevision(current.scope),
        leaseFence: lease.fence,
        graphRunMutation: { type: 'put', record: graphRun },
        runMutation: { type: 'put', record: engineRun },
        workGraphEvents: [{
          type: 'append',
          record: {
            eventId,
            scope: current.scope,
            runId: input.runId,
            graphId: current.graphId,
            graphRevision: current.graphRevision,
            nodeId,
            attemptId: input.runId,
            kind: 'root_run_repaired',
            payload: { previousVersion: current.version, migratedVersion: version },
            timestamp: now
          }
        }]
      })
      return this.load(input.runId)
    } finally {
      await this.options.store.releaseLease(input.runId, lease)
    }
  }

  async update(input: UpdateRootRunAggregateInput): Promise<RootRunAggregate> {
    const current = await this.load(input.runId)
    if (!input.allowCancelled && current.engineRun.desiredState === 'cancelled') {
      throw new EngineStoreConflictError(`cancelled root run ${input.runId} cannot accept new mutations`)
    }
    if (!input.allowTerminal && isTerminal(current.engineRun)) {
      throw new EngineStoreConflictError(`terminal root run ${input.runId} cannot accept new mutations`)
    }
    if (input.expectedVersion !== undefined && input.expectedVersion !== current.graphRun.version) {
      throw new EngineStoreConflictError(
        `root aggregate version mismatch: expected ${input.expectedVersion}, actual ${current.graphRun.version}`
      )
    }
    if (input.lease && input.lease.runId !== input.runId) {
      throw new EngineStoreConflictError(`root aggregate lease targets another run: ${input.lease.runId}`)
    }
    const mutated = await input.mutate(current)
    const parsedGraph = GraphRunRecordSchema.parse(mutated.graphRun)
    assertImmutableGraphIdentity(current.graphRun, parsedGraph)
    const version = current.graphRun.version + 1
    const now = this.nowIso()
    const graphRun = GraphRunRecordSchema.parse({
      ...parsedGraph,
      version,
      createdAt: current.graphRun.createdAt,
      updatedAt: now
    })
    const patch = mutated.enginePatch ?? {}
    const cursor = patch.cursor ?? {
      ...current.engineRun.cursor,
      nodeId: activeNodeId(graphRun)
    }
    const engineRun = EngineRunRecordSchema.parse({
      ...current.engineRun,
      ...patch,
      runId: current.engineRun.runId,
      scope: current.engineRun.scope,
      multiAgentRunId: current.engineRun.multiAgentRunId,
      graph: {
        ...current.engineRun.graph,
        nodeId: activeNodeId(graphRun)
      },
      version,
      status: patch.status ?? statusForGraph(graphRun, current.engineRun),
      cursor: { ...cursor, nodeId: activeNodeId(graphRun) },
      budgets: patch.budgets ?? graphRun.budgets,
      budgetLimits: current.engineRun.budgetLimits,
      createdAt: current.engineRun.createdAt,
      updatedAt: now
    })
    this.assertAggregate(graphRun, engineRun)
    await this.options.store.commit({
      ...input.mutations,
      scope: current.graphRun.scope,
      runId: input.runId,
      aggregateKind: 'governed_root',
      expectedRunVersion: current.graphRun.version,
      expectedTaskRevision: await this.taskRevision(current.graphRun.scope),
      ...(input.lease ? { leaseFence: input.lease.fence } : {}),
      graphRunMutation: { type: 'put', record: graphRun },
      runMutation: { type: 'put', record: engineRun }
    })
    return this.load(input.runId)
  }

  async delete(runId: string, lease?: EngineLease): Promise<void> {
    const current = await this.load(runId)
    if (lease && lease.runId !== runId) {
      throw new EngineStoreConflictError(`root aggregate lease targets another run: ${lease.runId}`)
    }
    await this.options.store.commit({
      scope: current.graphRun.scope,
      runId,
      aggregateKind: 'governed_root',
      expectedRunVersion: current.graphRun.version,
      expectedTaskRevision: await this.taskRevision(current.graphRun.scope),
      ...(lease ? { leaseFence: lease.fence } : {}),
      graphRunMutation: { type: 'delete', recordId: runId },
      runMutation: { type: 'delete', recordId: runId }
    })
  }

  async requestCancel(runId: string, lease?: EngineLease): Promise<RootRunAggregate> {
    const current = await this.load(runId)
    if (current.engineRun.desiredState === 'cancelled') return current
    if (isTerminal(current.engineRun)) return current
    return this.update({
      runId,
      expectedVersion: current.graphRun.version,
      ...(lease ? { lease } : {}),
      mutate: ({ graphRun }) => ({
        graphRun,
        enginePatch: { desiredState: 'cancelled' }
      })
    })
  }

  async finalizeCancel(runId: string, lease?: EngineLease): Promise<RootRunAggregate> {
    const current = await this.load(runId)
    if (current.graphRun.status === 'aborted' && current.engineRun.status === 'aborted') return current
    if (isTerminal(current.engineRun)) {
      throw new EngineStoreConflictError(`terminal root run ${runId} cannot be overwritten by cancellation`)
    }
    return this.update({
      runId,
      expectedVersion: current.graphRun.version,
      allowCancelled: true,
      ...(lease ? { lease } : {}),
      mutate: ({ graphRun }) => ({
        graphRun: GraphRunRecordSchema.parse({
          ...graphRun,
          status: 'aborted',
          ...(graphRun.eventedV2Run ? {
            eventedV2Run: {
              ...graphRun.eventedV2Run,
              status: 'aborted',
              agentRuns: graphRun.eventedV2Run.agentRuns.map((agentRun) =>
                isAgentRunTerminal(agentRun.status)
                  ? agentRun
                  : { ...agentRun, status: 'aborted', completedAt: this.nowIso(), updatedAt: this.nowIso() })
            }
          } : {})
        }),
        enginePatch: {
          desiredState: 'cancelled',
          status: 'aborted',
          outcome: { status: 'aborted', reason: 'user_aborted', retryable: false },
          suspension: undefined
        }
      })
    })
  }

  private assertAggregate(graphRun: GraphRunRecord, engineRun: EngineRunRecord): void {
    if (!engineRun.budgetLimits) {
      throw new RootRunAggregateError(
        'ROOT_RUN_BUDGET_MISSING',
        `governed root ${graphRun.runId} has no caller-authorized budget limits`
      )
    }
    const eventedRun = graphRun.eventedV2Run
    const diverged = graphRun.runId !== engineRun.runId
      || graphRun.runId !== engineRun.multiAgentRunId
      || !sameScope(graphRun.scope, engineRun.scope)
      || graphRun.version !== engineRun.version
      || graphRun.createdAt !== engineRun.createdAt
      || graphRun.graphId !== engineRun.graph?.graphId
      || graphRun.graphRevision !== engineRun.graph?.graphRevision
      || graphRun.graphDigest !== engineRun.graph?.graphDigest
      || !compatibleEngineStatuses[graphRun.status].includes(engineRun.status)
      || activeNodeId(graphRun) !== engineRun.cursor.nodeId
      || activeNodeId(graphRun) !== engineRun.graph?.nodeId
      || !sameBudget(graphRun.budgets, engineRun.budgets)
      || (eventedRun !== undefined && (
        eventedRun.runId !== graphRun.runId
        || eventedRun.graphId !== graphRun.graphId
        || eventedRun.activeNodeId !== activeNodeId(graphRun)
        || eventedRun.status !== graphRun.status
        || !sameBudget(eventedRun.budgets, graphRun.budgets)
      ))
    if (diverged) {
      throw new RootRunAggregateError(
        'ROOT_RUN_AGGREGATE_DIVERGED',
        `governed root projections diverged: ${graphRun.runId}`
      )
    }
  }

  private async taskRevision(scope: GraphRunRecord['scope']): Promise<number> {
    return (await this.options.store.loadTask(scope))?.revision ?? 0
  }
}

function assertImmutableGraphIdentity(current: GraphRunRecord, next: GraphRunRecord): void {
  if (current.runId !== next.runId
    || !sameScope(current.scope, next.scope)
    || current.threadId !== next.threadId
    || current.turnId !== next.turnId
    || current.workspaceKey !== next.workspaceKey
    || current.graphId !== next.graphId
    || current.graphRevision !== next.graphRevision
    || current.graphDigest !== next.graphDigest
    || current.createdAt !== next.createdAt) {
    throw new EngineStoreConflictError(`root aggregate update changed immutable identity: ${current.runId}`)
  }
}

function statusForGraph(
  graphRun: GraphRunRecord,
  current: EngineRunRecord | undefined
): EngineRunRecord['status'] {
  if (graphRun.status === 'created') return 'created'
  if (graphRun.status === 'running') return 'running'
  if (graphRun.status === 'completed') return 'completed'
  if (graphRun.status === 'failed') return current?.status === 'degraded' ? 'degraded' : 'failed'
  if (graphRun.status === 'aborted') return 'aborted'
  if (current && compatibleEngineStatuses.suspended.includes(current.status)) return current.status
  return 'waiting_input'
}

function activeNodeId(graphRun: GraphRunRecord): string {
  const eventedNodeId = graphRun.eventedV2Run?.activeNodeId
  const recordNodeId = graphRun.activeNodeIds[0]
  const nodeId = eventedNodeId ?? recordNodeId
  if (!nodeId) {
    throw new RootRunAggregateError(
      'ROOT_RUN_AGGREGATE_DIVERGED',
      `governed root ${graphRun.runId} has no reconstructable cursor node`
    )
  }
  if (eventedNodeId && recordNodeId && eventedNodeId !== recordNodeId) {
    throw new RootRunAggregateError(
      'ROOT_RUN_AGGREGATE_DIVERGED',
      `governed root ${graphRun.runId} has conflicting active nodes`
    )
  }
  return nodeId
}

function sameScope(left: GraphRunRecord['scope'], right: EngineRunRecord['scope']): boolean {
  return left.ownerId === right.ownerId
    && left.workspaceId === right.workspaceId
    && left.taskId === right.taskId
}

const budgetKeys = ['stepsUsed', 'toolCallsUsed', 'inputTokens', 'outputTokens', 'costUsd'] as const

function sameBudget(left: BudgetState, right: BudgetState): boolean {
  return budgetKeys.every((key) => left[key] === right[key])
}

function isTerminal(run: EngineRunRecord): boolean {
  return run.status === 'completed'
    || run.status === 'degraded'
    || run.status === 'failed'
    || run.status === 'aborted'
}

function isAgentRunTerminal(status: NonNullable<GraphRunRecord['eventedV2Run']>['agentRuns'][number]['status']): boolean {
  return status === 'completed'
    || status === 'degraded'
    || status === 'failed'
    || status === 'aborted'
}

type RootReservation = Awaited<ReturnType<DurableEngineStore['loadBudgetReservations']>>[number]

function requiredActualBudget(reservation: RootReservation): BudgetState {
  if (!reservation.actual) {
    throw new EngineStoreConflictError(`settled reservation ${reservation.reservationId} has no actual usage`)
  }
  return reservation.actual
}

function committedReservationBudget(reservation: RootReservation): BudgetState {
  if (reservation.status === 'reserved') return reservation.reserved
  if (reservation.status === 'settled') return requiredActualBudget(reservation)
  return zeroBudget()
}

function addBudget(left: BudgetState, right: BudgetState): BudgetState {
  return {
    stepsUsed: left.stepsUsed + right.stepsUsed,
    toolCallsUsed: left.toolCallsUsed + right.toolCallsUsed,
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    costUsd: left.costUsd + right.costUsd
  }
}

function zeroBudget(): BudgetState {
  return { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }
}

function assertWithinBudget(actual: BudgetState, limits: BudgetState): void {
  for (const key of budgetKeys) {
    if (actual[key] > limits[key]) {
      throw new EngineStoreConflictError(`graph-only migration exceeds root budget: ${key}`)
    }
  }
}

function assertMigratableGraphState(graphRun: GraphRunRecord): void {
  const evented = graphRun.eventedV2Run
  if (!evented
    || evented.runId !== graphRun.runId
    || evented.graphId !== graphRun.graphId
    || evented.status !== graphRun.status
    || evented.activeNodeId !== activeNodeId(graphRun)
    || !sameBudget(evented.budgets, graphRun.budgets)) {
    throw new EngineStoreConflictError(`graph-only run has incoherent evented_v2 state: ${graphRun.runId}`)
  }
  if (graphRun.status === 'completed' && !evented.events.some((event) => event.type === 'run_completed')) {
    throw new EngineStoreConflictError(`completed graph-only run has no terminal evidence: ${graphRun.runId}`)
  }
  if (graphRun.status === 'failed' && !evented.events.some((event) => event.type === 'run_failed')) {
    throw new EngineStoreConflictError(`failed graph-only run has no terminal evidence: ${graphRun.runId}`)
  }
  if (graphRun.status === 'aborted' && evented.agentRuns.some((agentRun) => !isAgentRunTerminal(agentRun.status))) {
    throw new EngineStoreConflictError(`aborted graph-only run has active AgentRuns: ${graphRun.runId}`)
  }
}
