import {
  GraphRunRecordSchema,
  HumanCheckpointSchema,
  MultiAgentRunSchema,
  type GraphRevision,
  type AgentRun,
  type JoinNode,
  type GraphCircuitPolicy,
  type GraphCircuitState,
  type GraphRunRecord,
  type HumanCheckpoint,
  type MultiAgentRun,
  type ResourceClaim,
  type WorkGraphEvent
} from '@qiongqi/contracts'
import {
  EngineStoreConflictError,
  type DurableEngineStore,
  type EngineLease,
  type ResourceClaimRequest
} from '@qiongqi/ports'
import {
  advanceBranch,
  abortOpenBranches,
  buildJoinResult,
  joinReadiness,
  projectActiveNodeIds,
  settleBranch,
  spawnParallelBranches
} from './parallel-branch-state.js'
import { eventedRunProjectionMutations } from './durable-graph-store-adapters.js'
import type {
  RootRunAggregateCoordinator,
  RootRunCommitMutations,
  RootRunEnginePatch
} from './root-run-aggregate.js'

export type GraphGovernorOptions = {
  store: DurableEngineStore
  graphRevision: GraphRevision
  ids: (prefix: string) => string
  nowIso?: () => string
  rootAggregate?: RootRunAggregateCoordinator
}

export type ApprovalGateInput = {
  runId: string
  nodeId: string
  branchId?: string
  policyRevision: number
  evidenceRefs: string[]
  approvalScope: string[]
  expiresAt: string
}

export type ApprovalResolutionInput = {
  checkpointId: string
  resolutionToken: string
  graphRevision: number
  decision: 'allow' | 'deny'
}

export type GraphResourceClaimInput = Omit<ResourceClaimRequest, 'scope' | 'holderId'> & {
  runId: string
}

export type GraphResourceClaimDecision =
  | { status: 'claimed'; claim: ResourceClaim }
  | { status: 'wait' | 'skip' | 'escalate' }

export type GraphCircuitMetrics = {
  budgetRatio: number
  duplicateRatio: number
  failureCount: number
  outboxAgeMs: number
}

export type GraphCircuitDecision = {
  state: GraphCircuitState
  reason: 'healthy' | 'budget_ratio' | 'duplicate_ratio' | 'failure_count' | 'outbox_age'
}

export function evaluateGraphCircuit(
  policy: GraphCircuitPolicy,
  metrics: GraphCircuitMetrics
): GraphCircuitDecision {
  if (policy.retireFailureCount !== undefined && metrics.failureCount >= policy.retireFailureCount) {
    return { state: 'retired', reason: 'failure_count' }
  }
  if (policy.pauseDuplicateRatio !== undefined && metrics.duplicateRatio >= policy.pauseDuplicateRatio) {
    return { state: 'paused', reason: 'duplicate_ratio' }
  }
  if (policy.maxOutboxAgeMs !== undefined && metrics.outboxAgeMs >= policy.maxOutboxAgeMs) {
    return { state: 'paused', reason: 'outbox_age' }
  }
  if (policy.reportOnlyBudgetRatio !== undefined && metrics.budgetRatio >= policy.reportOnlyBudgetRatio) {
    return { state: 'report_only', reason: 'budget_ratio' }
  }
  return { state: 'running', reason: 'healthy' }
}

/** Applies human approval as a durable graph edge gate rather than an advisory callback. */
export class GraphGovernor {
  private readonly nowIso: () => string
  private readonly leaseHolderId: string

  constructor(private readonly options: GraphGovernorOptions) {
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    this.leaseHolderId = options.ids('graph_governor')
  }

  async requestApproval(input: ApprovalGateInput): Promise<HumanCheckpoint> {
    return this.withRunLease(input.runId, (lease) => this.requestApprovalWithLease(input, lease))
  }

  private async requestApprovalWithLease(input: ApprovalGateInput, lease: EngineLease): Promise<HumanCheckpoint> {
    const run = await this.requireRun(input.runId)
    this.assertPinned(run)
    const eventedRun = requireEventedRun(run)
    if (input.branchId) {
      const branch = eventedRun.branches[input.branchId]
      if (!branch || branch.status !== 'suspended') {
        throw new Error(`graph branch ${input.branchId} is not suspended for approval`)
      }
      if (branch.activeNodeId !== input.nodeId) {
        throw new Error(`approval node mismatch: ${branch.activeNodeId} !== ${input.nodeId}`)
      }
    } else {
      if (run.status !== 'suspended' || eventedRun.status !== 'suspended') {
        throw new Error(`graph run ${run.runId} is not suspended for approval`)
      }
      if (eventedRun.activeNodeId !== input.nodeId) {
        throw new Error(`approval node mismatch: ${eventedRun.activeNodeId} !== ${input.nodeId}`)
      }
    }
    const node = this.options.graphRevision.nodes.find((candidate) => candidate.id === input.nodeId)
    if (node?.kind !== 'wait' || node.waitFor !== 'approval') {
      throw new Error(`graph node is not an approval wait: ${input.nodeId}`)
    }
    const resumeEdges = this.options.graphRevision.edges.filter((edge) =>
      edge.from === input.nodeId && (edge.condition === 'approved' || edge.condition === 'allowed'))
    if (resumeEdges.length !== 1) throw new Error(`approval node ${input.nodeId} requires exactly one resume edge`)

    const now = this.nowIso()
    const checkpoint = HumanCheckpointSchema.parse({
      checkpointId: this.options.ids('checkpoint'),
      scope: run.scope,
      runId: run.runId,
      graphId: run.graphId,
      graphRevision: run.graphRevision,
      nodeId: input.nodeId,
      ...(input.branchId ? { branchId: input.branchId } : {}),
      policyRevision: input.policyRevision,
      evidenceRefs: input.evidenceRefs,
      approvalScope: input.approvalScope,
      resumeEdgeId: resumeEdges[0]!.edgeId,
      resolutionToken: this.options.ids('approval_token'),
      status: 'pending',
      expiresAt: input.expiresAt,
      createdAt: now,
      updatedAt: now
    })
    const next = GraphRunRecordSchema.parse({
      ...run,
      version: run.version + 1,
      updatedAt: now
    })
    await this.commitTransition(run, next, lease, {
      humanCheckpointMutations: [{ type: 'put', record: checkpoint }],
      workGraphEvents: [{ type: 'append', record: approvalEvent(
        checkpoint,
        'approval_requested',
        `${checkpoint.checkpointId}:requested`,
        { approvalScope: checkpoint.approvalScope, evidenceRefs: checkpoint.evidenceRefs },
        now
      ) }]
    }, (engineRun) => ({
      ...(!input.branchId ? { status: 'waiting_approval' as const } : {}),
      cursor: { ...engineRun.cursor, checkpointSeq: engineRun.cursor.checkpointSeq + 1 }
    }))
    return checkpoint
  }

  async resolveApproval(input: ApprovalResolutionInput): Promise<GraphRunRecord> {
    const checkpoint = await this.requireCheckpoint(input.checkpointId)
    return this.withRunLease(checkpoint.runId, (lease) => this.resolveApprovalWithLease(input, lease))
  }

  async claimResource(input: GraphResourceClaimInput): Promise<GraphResourceClaimDecision> {
    const run = await this.requireRun(input.runId)
    this.assertPinned(run)
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'aborted') {
      throw new Error(`graph run ${run.runId} cannot claim resources in status ${run.status}`)
    }
    if (run.circuitState === 'paused' || run.circuitState === 'retired') {
      throw new Error(`graph circuit ${run.circuitState} blocks resource claims`)
    }
    if (run.circuitState === 'report_only' && input.mode === 'write') {
      throw new Error('graph circuit report_only blocks write resource claims')
    }
    const claim = await this.options.store.claimResource({
      claimId: input.claimId,
      scope: run.scope,
      resourceKey: input.resourceKey,
      mode: input.mode,
      holderId: run.runId,
      conflictStrategy: input.conflictStrategy,
      ttlMs: input.ttlMs
    })
    return claim ? { status: 'claimed', claim } : { status: input.conflictStrategy }
  }

  renewResourceClaim(claim: ResourceClaim, ttlMs: number): Promise<ResourceClaim | undefined> {
    return this.options.store.renewResourceClaim(claim, ttlMs)
  }

  releaseResourceClaim(claim: ResourceClaim): Promise<void> {
    return this.options.store.releaseResourceClaim(claim)
  }

  async evaluateCircuit(
    runId: string,
    policy: GraphCircuitPolicy,
    metrics: GraphCircuitMetrics
  ): Promise<GraphRunRecord> {
    return this.withRunLease(runId, (lease) => this.evaluateCircuitWithLease(runId, policy, metrics, lease))
  }

  async setCircuitState(runId: string, state: GraphCircuitState): Promise<GraphRunRecord> {
    return this.withRunLease(runId, async (lease) => {
      const run = await this.requireRun(runId)
      this.assertPinned(run)
      if (run.circuitState === state) return run
      const now = this.nowIso()
      const next = GraphRunRecordSchema.parse({
        ...run,
        version: run.version + 1,
        circuitState: state,
        updatedAt: now
      })
      const kind = state === 'retired'
        ? 'circuit_retired' as const
        : state === 'paused'
          ? 'circuit_paused' as const
          : state === 'running'
            ? 'circuit_resumed' as const
            : 'circuit_degraded' as const
      const eventId = `circuit:${run.runId}:${next.version}`
      const committed = await this.commitTransition(run, next, lease, {
        workGraphEvents: [{ type: 'append', record: {
          eventId,
          scope: run.scope,
          runId: run.runId,
          graphId: run.graphId,
          graphRevision: run.graphRevision,
          attemptId: eventId,
          kind,
          payload: { state, reason: 'manual_override' },
          timestamp: now
        } }]
      })
      return committed
    })
  }

  private async evaluateCircuitWithLease(
    runId: string,
    policy: GraphCircuitPolicy,
    metrics: GraphCircuitMetrics,
    lease: EngineLease
  ): Promise<GraphRunRecord> {
    const run = await this.requireRun(runId)
    this.assertPinned(run)
    const evaluated = evaluateGraphCircuit(policy, metrics)
    const state = moreSevereCircuit(run.circuitState, evaluated.state)
    if (state === run.circuitState) return run
    const now = this.nowIso()
    const next = GraphRunRecordSchema.parse({
      ...run,
      version: run.version + 1,
      circuitState: state,
      updatedAt: now
    })
    const kind = state === 'retired'
      ? 'circuit_retired' as const
      : state === 'paused'
        ? 'circuit_paused' as const
        : 'circuit_degraded' as const
    const eventId = `circuit:${run.runId}:${next.version}`
    const committed = await this.commitTransition(run, next, lease, {
      workGraphEvents: [{ type: 'append', record: {
        eventId,
        scope: run.scope,
        runId: run.runId,
        graphId: run.graphId,
        graphRevision: run.graphRevision,
        attemptId: eventId,
        kind,
        payload: { state, reason: evaluated.reason, policyId: policy.policyId, policyRevision: policy.revision, metrics },
        timestamp: now
      } }]
    })
    return committed
  }

  private async resolveApprovalWithLease(input: ApprovalResolutionInput, lease: EngineLease): Promise<GraphRunRecord> {
    const checkpoint = await this.requireCheckpoint(input.checkpointId)
    if (checkpoint.status !== 'pending') {
      throw new Error(`checkpoint ${checkpoint.checkpointId} is not pending; token already consumed`)
    }
    if (input.graphRevision !== checkpoint.graphRevision
      || input.graphRevision !== this.options.graphRevision.revision) {
      throw new Error(`checkpoint ${checkpoint.checkpointId} graph revision mismatch`)
    }
    if (input.resolutionToken !== checkpoint.resolutionToken) {
      throw new Error(`checkpoint ${checkpoint.checkpointId} resolution token mismatch`)
    }
    const run = await this.requireRun(checkpoint.runId)
    this.assertPinned(run)
    if (run.status === 'aborted') throw new Error(`graph run ${run.runId} is aborted or cancelled`)
    const eventedRun = requireEventedRun(run)
    if (checkpoint.branchId) {
      const branch = eventedRun.branches[checkpoint.branchId]
      if (!branch || branch.status !== 'suspended' || branch.activeNodeId !== checkpoint.nodeId) {
        throw new Error(`approval checkpoint is not active for branch ${checkpoint.branchId} at node ${checkpoint.nodeId}`)
      }
    } else {
      if (run.status !== 'suspended') throw new Error(`graph run ${run.runId} is not suspended for approval`)
      if (eventedRun.activeNodeId !== checkpoint.nodeId) {
        throw new Error(`approval checkpoint is not active at node ${checkpoint.nodeId}`)
      }
    }

    const now = this.nowIso()
    if (Date.parse(now) >= Date.parse(checkpoint.expiresAt)) {
      await this.expireCheckpoint(run, checkpoint, now, lease)
      throw new Error(`checkpoint ${checkpoint.checkpointId} expired`)
    }

    const edge = input.decision === 'allow'
      ? this.options.graphRevision.edges.find((candidate) => candidate.edgeId === checkpoint.resumeEdgeId)
      : this.options.graphRevision.edges.find((candidate) =>
          candidate.from === checkpoint.nodeId && (candidate.condition === 'denied' || candidate.condition === 'rejected'))
    if (input.decision === 'allow' && (!edge || edge.from !== checkpoint.nodeId)) {
      throw new Error(`checkpoint ${checkpoint.checkpointId} resume edge is invalid`)
    }
    const nextEventedRun = edge
      ? checkpoint.branchId
        ? advanceBranchApprovalRun(
            eventedRun,
            this.options.graphRevision,
            edge.edgeId,
            input.decision,
            checkpoint.branchId,
            checkpoint.checkpointId,
            now
          )
        : advanceApprovalRun(eventedRun, this.options.graphRevision, edge.edgeId, input.decision, checkpoint.checkpointId, now)
      : eventedRun
    const next = GraphRunRecordSchema.parse({
      ...run,
      version: run.version + 1,
      status: nextEventedRun.status,
      activeNodeIds: projectActiveNodeIds(nextEventedRun),
      eventedV2Run: nextEventedRun,
      updatedAt: now
    })
    const resolvedEventId = `${checkpoint.checkpointId}:resolved`
    const workGraphEvents: Array<{ type: 'append'; record: WorkGraphEvent }> = [{
      type: 'append',
      record: approvalEvent(checkpoint, 'approval_resolved', resolvedEventId, { decision: input.decision }, now)
    }]
    if (edge) {
      const attemptId = `${checkpoint.checkpointId}:${edge.edgeId}`
      workGraphEvents.push(
        { type: 'append', record: edgeEvent(checkpoint, edge.edgeId, attemptId, 'edge_selected', {
          condition: edge.condition,
          sourceEventId: resolvedEventId
        }, now) },
        { type: 'append', record: edgeEvent(checkpoint, edge.edgeId, attemptId, 'edge_traversed', {
          condition: edge.condition,
          targetNodeId: edge.to,
          sourceEventId: resolvedEventId
        }, now) }
      )
    }
    const projections = eventedRunProjectionMutations(
      run.scope,
      this.options.graphRevision,
      checkpoint.policyRevision,
      nextEventedRun,
      eventedRun
    )
    const projectedWorkEvents = edge
      ? projections.workGraphEvents.filter((mutation) => mutation.record.edgeId !== edge.edgeId)
      : projections.workGraphEvents
    try {
      const committed = await this.commitTransition(run, next, lease, {
        humanCheckpointMutations: [{
          type: 'resolve',
          recordId: checkpoint.checkpointId,
          resolutionToken: input.resolutionToken,
          graphRevision: input.graphRevision,
          status: input.decision === 'allow' ? 'allowed' : 'denied',
          resolvedAt: now,
          updatedAt: now
        }],
        workGraphEvents: [...workGraphEvents, ...projectedWorkEvents],
        streamEvents: projections.streamEvents
      }, (engineRun) => ({
        cursor: { ...engineRun.cursor, checkpointSeq: engineRun.cursor.checkpointSeq + 1 }
      }))
      return committed
    } catch (error) {
      if (error instanceof EngineStoreConflictError) {
        const latest = await this.options.store.loadHumanCheckpoint(checkpoint.checkpointId)
        if (latest?.status !== 'pending') {
          throw new Error(`checkpoint ${checkpoint.checkpointId} token already consumed`, { cause: error })
        }
      }
      throw error
    }
  }

  private async expireCheckpoint(
    run: GraphRunRecord,
    checkpoint: HumanCheckpoint,
    now: string,
    lease: EngineLease
  ): Promise<void> {
    const edge = this.options.graphRevision.edges.find((candidate) =>
      candidate.from === checkpoint.nodeId && candidate.condition === 'expired')
    const currentEventedRun = requireEventedRun(run)
    const nextEventedRun = edge
      ? checkpoint.branchId
        ? advanceBranchApprovalRun(
            currentEventedRun,
            this.options.graphRevision,
            edge.edgeId,
            'expire',
            checkpoint.branchId,
            checkpoint.checkpointId,
            now
          )
        : advanceApprovalRun(
            currentEventedRun,
            this.options.graphRevision,
            edge.edgeId,
            'expire',
            checkpoint.checkpointId,
            now
          )
      : currentEventedRun
    const next = GraphRunRecordSchema.parse({
      ...run,
      version: run.version + 1,
      status: nextEventedRun.status,
      activeNodeIds: projectActiveNodeIds(nextEventedRun),
      eventedV2Run: nextEventedRun,
      updatedAt: now
    })
    const expiredEventId = `${checkpoint.checkpointId}:expired`
    const workGraphEvents: Array<{ type: 'append'; record: WorkGraphEvent }> = [{
      type: 'append',
      record: approvalEvent(checkpoint, 'approval_expired', expiredEventId, {}, now)
    }]
    if (edge) {
      const attemptId = `${checkpoint.checkpointId}:${edge.edgeId}`
      workGraphEvents.push(
        { type: 'append', record: edgeEvent(checkpoint, edge.edgeId, attemptId, 'edge_selected', {
          condition: edge.condition,
          sourceEventId: expiredEventId
        }, now) },
        { type: 'append', record: edgeEvent(checkpoint, edge.edgeId, attemptId, 'edge_traversed', {
          condition: edge.condition,
          targetNodeId: edge.to,
          sourceEventId: expiredEventId
        }, now) }
      )
    }
    const projections = eventedRunProjectionMutations(
      run.scope,
      this.options.graphRevision,
      checkpoint.policyRevision,
      nextEventedRun,
      currentEventedRun
    )
    const projectedWorkEvents = edge
      ? projections.workGraphEvents.filter((mutation) => mutation.record.edgeId !== edge.edgeId)
      : projections.workGraphEvents
    await this.commitTransition(run, next, lease, {
      humanCheckpointMutations: [{
        type: 'expire',
        recordId: checkpoint.checkpointId,
        graphRevision: checkpoint.graphRevision,
        resolvedAt: now,
        updatedAt: now
      }],
      workGraphEvents: [...workGraphEvents, ...projectedWorkEvents],
      streamEvents: projections.streamEvents
    }, (engineRun) => ({
      cursor: { ...engineRun.cursor, checkpointSeq: engineRun.cursor.checkpointSeq + 1 }
    }))
  }

  private async requireRun(runId: string): Promise<GraphRunRecord> {
    const run = await this.options.store.loadGraphRun(runId)
    if (!run) throw new Error(`graph run not found: ${runId}`)
    return GraphRunRecordSchema.parse(run)
  }

  private async requireCheckpoint(checkpointId: string): Promise<HumanCheckpoint> {
    const checkpoint = await this.options.store.loadHumanCheckpoint(checkpointId)
    if (!checkpoint) throw new Error(`human checkpoint not found: ${checkpointId}`)
    return HumanCheckpointSchema.parse(checkpoint)
  }

  private assertPinned(run: GraphRunRecord): void {
    if (run.graphId !== this.options.graphRevision.graphId
      || run.graphRevision !== this.options.graphRevision.revision
      || run.graphDigest !== this.options.graphRevision.graphDigest) {
      throw new Error(`graph run ${run.runId} does not match the configured graph revision`)
    }
  }

  private async taskRevision(run: GraphRunRecord): Promise<number> {
    return (await this.options.store.loadTask(run.scope))?.revision ?? 0
  }

  private async commitTransition(
    current: GraphRunRecord,
    next: GraphRunRecord,
    lease: EngineLease,
    mutations: RootRunCommitMutations,
    enginePatch?: (engineRun: Awaited<ReturnType<RootRunAggregateCoordinator['load']>>['engineRun']) => RootRunEnginePatch
  ): Promise<GraphRunRecord> {
    if (this.options.rootAggregate) {
      const aggregate = await this.options.rootAggregate.update({
        runId: current.runId,
        expectedVersion: current.version,
        lease,
        mutate: ({ engineRun }) => ({
          graphRun: next,
          ...(enginePatch ? { enginePatch: enginePatch(engineRun) } : {})
        }),
        mutations
      })
      return aggregate.graphRun
    }
    await this.options.store.commit({
      ...mutations,
      scope: current.scope,
      runId: current.runId,
      expectedRunVersion: current.version,
      expectedTaskRevision: await this.taskRevision(current),
      leaseFence: lease.fence,
      graphRunMutation: { type: 'put', record: next }
    })
    return next
  }

  private async withRunLease<T>(runId: string, operation: (lease: EngineLease) => Promise<T>): Promise<T> {
    const lease = await this.options.store.acquireLease(runId, this.leaseHolderId, 30_000)
    if (!lease) throw new EngineStoreConflictError(`graph run lease unavailable: ${runId}`)
    try {
      return await operation(lease)
    } finally {
      await this.options.store.releaseLease(runId, lease)
    }
  }
}

function requireEventedRun(run: GraphRunRecord): MultiAgentRun {
  if (!run.eventedV2Run) throw new Error(`graph run ${run.runId} has no evented_v2 state`)
  return MultiAgentRunSchema.parse(run.eventedV2Run)
}

function moreSevereCircuit(current: GraphCircuitState, evaluated: GraphCircuitState): GraphCircuitState {
  const severity: Record<GraphCircuitState, number> = { running: 0, report_only: 1, paused: 2, retired: 3 }
  return severity[evaluated] > severity[current] ? evaluated : current
}

function approvalEvent(
  checkpoint: HumanCheckpoint,
  kind: 'approval_requested' | 'approval_resolved' | 'approval_expired',
  eventId: string,
  payload: unknown,
  timestamp: string
): WorkGraphEvent {
  return {
    eventId,
    scope: checkpoint.scope,
    runId: checkpoint.runId,
    graphId: checkpoint.graphId,
    graphRevision: checkpoint.graphRevision,
    nodeId: checkpoint.nodeId,
    ...(checkpoint.branchId ? { branchId: checkpoint.branchId } : {}),
    attemptId: checkpoint.checkpointId,
    kind,
    payload,
    timestamp
  }
}

function edgeEvent(
  checkpoint: HumanCheckpoint,
  edgeId: string,
  attemptId: string,
  kind: 'edge_selected' | 'edge_traversed',
  payload: unknown,
  timestamp: string
): WorkGraphEvent {
  return { ...approvalEvent(checkpoint, 'approval_resolved', `${attemptId}:${kind}`, payload, timestamp), edgeId, attemptId, kind }
}

function advanceApprovalRun(
  run: MultiAgentRun,
  revision: GraphRevision,
  edgeId: string,
  decision: 'allow' | 'deny' | 'expire',
  checkpointId: string,
  now: string
): MultiAgentRun {
  let eventSequence = 0
  const ids = (prefix: string) => `${checkpointId}:${prefix}:${++eventSequence}`
  const edge = revision.edges.find((candidate) => candidate.edgeId === edgeId)
  if (!edge) throw new Error(`approval edge not found: ${edgeId}`)
  if (run.activeNodeId !== edge.from) throw new Error(`approval edge source is not active: ${edge.from}`)
  const completed = MultiAgentRunSchema.parse({
    ...run,
    events: [...run.events, {
      eventId: ids('mae'),
      type: 'node_completed',
      nodeId: edge.from,
      payload: { condition: edge.condition, decision, checkpointId },
      timestamp: now
    }],
    updatedAt: now
  })
  return enterRevisionNode(completed, revision, edge.to, ids, now)
}

function advanceBranchApprovalRun(
  run: MultiAgentRun,
  revision: GraphRevision,
  edgeId: string,
  decision: 'allow' | 'deny' | 'expire',
  branchId: string,
  checkpointId: string,
  now: string
): MultiAgentRun {
  let eventSequence = 0
  const ids = (prefix: string) => `${checkpointId}:${prefix}:${++eventSequence}`
  const edge = revision.edges.find((candidate) => candidate.edgeId === edgeId)
  if (!edge) throw new Error(`approval edge not found: ${edgeId}`)
  const branch = run.branches[branchId]
  if (!branch || branch.activeNodeId !== edge.from || branch.status !== 'suspended') {
    throw new Error(`approval edge source is not active for branch ${branchId}: ${edge.from}`)
  }
  let next = MultiAgentRunSchema.parse({
    ...run,
    events: [...run.events, {
      eventId: ids('mae'),
      type: 'node_completed',
      nodeId: edge.from,
      branchId,
      payload: { condition: edge.condition, decision, checkpointId },
      timestamp: now
    }],
    updatedAt: now
  })
  if (edge.to !== branch.joinNodeId) {
    return enterRevisionBranchNode(next, revision, branchId, edge.to, ids, now)
  }

  const status = decision === 'allow' ? 'completed' as const : 'failed' as const
  next = settleBranch(next, {
    branchId,
    status,
    output: { decision, checkpointId },
    ...(status === 'failed' ? { error: `approval_${decision}` } : {}),
    usageRefs: [],
    artifactRefs: [],
    nowIso: now
  })
  next = MultiAgentRunSchema.parse({
    ...next,
    events: [...next.events, {
      eventId: ids('mae'),
      type: status === 'completed' ? 'branch_completed' : 'branch_failed',
      nodeId: edge.from,
      branchId,
      payload: { condition: edge.condition, checkpointId },
      timestamp: now
    }],
    updatedAt: now
  })
  if (status === 'failed') next = applyRevisionFailFast(next, revision, branchId, ids, now)
  const join = revision.nodes.find((candidate) => candidate.id === branch.joinNodeId)
  if (join?.kind !== 'join') throw new Error(`durable branch join node is invalid: ${branch.joinNodeId}`)
  return completeRevisionJoin(next, revision, join, ids, now)
}

function enterRevisionBranchNode(
  run: MultiAgentRun,
  revision: GraphRevision,
  branchId: string,
  nodeId: string,
  ids: (prefix: string) => string,
  now: string
): MultiAgentRun {
  const branch = run.branches[branchId]
  if (!branch) throw new Error(`durable branch not found: ${branchId}`)
  if (nodeId === branch.joinNodeId) {
    const settled = settleBranch(run, {
      branchId,
      status: 'completed',
      usageRefs: [],
      artifactRefs: [],
      nowIso: now
    })
    const join = revision.nodes.find((candidate) => candidate.id === branch.joinNodeId)
    if (join?.kind !== 'join') throw new Error(`durable branch join node is invalid: ${branch.joinNodeId}`)
    return completeRevisionJoin(settled, revision, join, ids, now)
  }
  const node = revision.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) throw new Error(`graph node not found: ${nodeId}`)
  if (node.kind === 'parallel') throw new Error(`nested parallel is unsupported: ${node.id}`)
  if (node.kind === 'terminate') throw new Error(`durable branch terminated before join: ${branchId}`)
  if (node.kind === 'join') throw new Error(`durable branch reached an unrelated join: ${branchId} -> ${node.id}`)
  if (node.kind === 'handoff') {
    const edge = revision.edges.find((candidate) => candidate.from === node.id && candidate.condition === 'accepted')
    if (!edge) throw new Error(`no accepted edge from handoff node: ${node.id}`)
    return enterRevisionBranchNode(advanceBranch(run, branchId, node.id, now), revision, branchId, edge.to, ids, now)
  }
  if (node.kind === 'retry') {
    const counterId = `${branchId}:${node.id}`
    const attempts = (run.retryCounters[counterId] ?? 0) + 1
    const condition = attempts <= node.maxAttempts ? 'retry' : 'exhausted'
    const edge = revision.edges.find((candidate) => candidate.from === node.id && candidate.condition === condition)
    if (!edge) throw new Error(`no ${condition} edge from retry node: ${node.id}`)
    const advanced = advanceBranch(MultiAgentRunSchema.parse({
      ...run,
      retryCounters: { ...run.retryCounters, [counterId]: attempts }
    }), branchId, node.id, now)
    return enterRevisionBranchNode(advanced, revision, branchId, edge.to, ids, now)
  }
  if (node.kind === 'agent' || node.kind === 'judge') {
    const agentId = node.kind === 'agent' ? node.agentId : `judge:${node.id}`
    const agentRunId = ids('agent_run')
    const advanced = advanceBranch(run, branchId, node.id, now, 'running')
    const currentBranch = advanced.branches[branchId]!
    const agentRun: AgentRun = {
      agentRunId,
      branchId,
      agentId,
      nodeId: node.id,
      status: 'queued',
      startedAt: now,
      updatedAt: now
    }
    return MultiAgentRunSchema.parse({
      ...advanced,
      status: 'running',
      branches: {
        ...advanced.branches,
        [branchId]: { ...currentBranch, agentRunIds: [...currentBranch.agentRunIds, agentRunId] }
      },
      agentRuns: [...advanced.agentRuns, agentRun],
      events: [
        ...advanced.events,
        { eventId: ids('mae'), type: 'branch_started', nodeId: node.id, branchId, agentId, timestamp: now },
        { eventId: ids('mae'), type: 'node_started', nodeId: node.id, branchId, agentId, timestamp: now }
      ],
      updatedAt: now
    })
  }
  return MultiAgentRunSchema.parse({
    ...advanceBranch(run, branchId, node.id, now, 'suspended'),
    status: 'running',
    events: [...run.events, {
      eventId: ids('mae'),
      type: 'node_started',
      nodeId: node.id,
      branchId,
      timestamp: now
    }],
    updatedAt: now
  })
}

function applyRevisionFailFast(
  run: MultiAgentRun,
  revision: GraphRevision,
  failedBranchId: string,
  ids: (prefix: string) => string,
  now: string
): MultiAgentRun {
  const failed = run.branches[failedBranchId]!
  const parallel = revision.nodes.find((candidate) => candidate.id === failed.parallelNodeId)
  if (parallel?.kind !== 'parallel' || parallel.failurePolicy !== 'fail_fast') return run
  const abortedBranchIds = Object.values(run.branches)
    .filter((branch) => branch.parallelNodeId === parallel.id
      && !['completed', 'failed', 'aborted'].includes(branch.status))
    .map((branch) => branch.branchId)
    .sort()
  const aborted = abortOpenBranches(run, parallel.id, now)
  return MultiAgentRunSchema.parse({
    ...aborted,
    agentRuns: aborted.agentRuns.map((agentRun) => abortedBranchIds.includes(agentRun.branchId ?? '')
      && !['completed', 'degraded', 'failed', 'aborted'].includes(agentRun.status)
      ? { ...agentRun, status: 'aborted', completedAt: now, updatedAt: now }
      : agentRun),
    events: [
      ...aborted.events,
      ...abortedBranchIds.map((branchId) => ({
        eventId: ids('mae'),
        type: 'branch_cancelled' as const,
        nodeId: run.branches[branchId]!.activeNodeId,
        branchId,
        payload: { reason: 'fail_fast', failedBranchId },
        timestamp: now
      }))
    ],
    updatedAt: now
  })
}

function completeRevisionJoin(
  run: MultiAgentRun,
  revision: GraphRevision,
  node: JoinNode,
  ids: (prefix: string) => string,
  now: string
): MultiAgentRun {
  const readiness = joinReadiness(run, node)
  if (readiness === 'waiting') {
    return MultiAgentRunSchema.parse({
      ...run,
      status: 'running',
      activeNodeId: node.id,
      events: [...run.events, {
        eventId: ids('mae'),
        type: 'join_waiting',
        nodeId: node.id,
        payload: { requiredBranchIds: node.requiredBranchIds },
        timestamp: now
      }],
      updatedAt: now
    })
  }
  const condition = readiness === 'completed' ? 'completed' : 'failed'
  const result = buildJoinResult(run, node)
  const edge = revision.edges.find((candidate) => candidate.from === node.id && candidate.condition === condition)
    ?? (condition === 'completed'
      ? revision.edges.find((candidate) => candidate.from === node.id && candidate.condition === 'joined')
      : undefined)
  const completed = MultiAgentRunSchema.parse({
    ...run,
    activeNodeId: node.id,
    events: [
      ...run.events,
      { eventId: ids('mae'), type: 'join_completed', nodeId: node.id, payload: { condition, result }, timestamp: now },
      { eventId: ids('mae'), type: 'node_completed', nodeId: node.id, payload: { condition, result }, timestamp: now }
    ],
    updatedAt: now
  })
  if (edge) return enterRevisionNode(completed, revision, edge.to, ids, now)
  return MultiAgentRunSchema.parse({
    ...completed,
    status: 'failed',
    events: [...completed.events, {
      eventId: ids('mae'),
      type: 'run_failed',
      nodeId: node.id,
      payload: { reason: `join_${condition}`, result },
      timestamp: now
    }],
    updatedAt: now
  })
}

function enterRevisionNode(
  run: MultiAgentRun,
  revision: GraphRevision,
  nodeId: string,
  ids: (prefix: string) => string,
  now: string
): MultiAgentRun {
  const node = revision.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) throw new Error(`graph node not found: ${nodeId}`)
  if (node.kind === 'terminate') {
    return MultiAgentRunSchema.parse({
      ...run,
      status: 'completed',
      activeNodeId: node.id,
      events: [...run.events, { eventId: ids('mae'), type: 'run_completed', nodeId: node.id, timestamp: now }],
      updatedAt: now
    })
  }
  if (node.kind === 'parallel') {
    let next = spawnParallelBranches(MultiAgentRunSchema.parse({
      ...run,
      activeNodeId: node.id,
      updatedAt: now
    }), node, now)
    next = MultiAgentRunSchema.parse({
      ...next,
      events: [
        ...next.events,
        ...[...node.branches]
          .sort((left, right) => left.branchId.localeCompare(right.branchId))
          .map((branch) => ({
            eventId: ids('mae'),
            type: 'branch_spawned' as const,
            nodeId: node.id,
            branchId: branch.branchId,
            payload: { startNodeId: branch.startNodeId, joinNodeId: node.joinNodeId },
            timestamp: now
          }))
      ]
    })
    for (const branch of [...node.branches].sort((left, right) => left.branchId.localeCompare(right.branchId))) {
      next = enterRevisionBranchNode(next, revision, branch.branchId, branch.startNodeId, ids, now)
    }
    return next
  }
  if (node.kind === 'agent') {
    const hasActive = run.agentRuns.some((agentRun) =>
      agentRun.agentId === node.agentId && agentRun.nodeId === node.id && ['queued', 'running'].includes(agentRun.status))
    return MultiAgentRunSchema.parse({
      ...run,
      status: 'running',
      activeNodeId: node.id,
      activeAgentStack: [...run.activeAgentStack, node.agentId],
      agentRuns: hasActive ? run.agentRuns : [...run.agentRuns, {
        agentRunId: ids('agent_run'), agentId: node.agentId, nodeId: node.id,
        status: 'queued', startedAt: now, updatedAt: now
      }],
      updatedAt: now
    })
  }
  if (node.kind === 'judge') {
    const agentId = `judge:${node.id}`
    const hasActive = run.agentRuns.some((agentRun) =>
      agentRun.agentId === agentId && agentRun.nodeId === node.id && ['queued', 'running'].includes(agentRun.status))
    return MultiAgentRunSchema.parse({
      ...run,
      status: 'suspended',
      activeNodeId: node.id,
      agentRuns: hasActive ? run.agentRuns : [...run.agentRuns, {
        agentRunId: ids('agent_run'), agentId, nodeId: node.id,
        status: 'queued', startedAt: now, updatedAt: now
      }],
      events: [...run.events, { eventId: ids('mae'), type: 'node_started', nodeId: node.id, agentId, timestamp: now }],
      updatedAt: now
    })
  }
  if (node.kind === 'join') {
    return completeRevisionJoin(run, revision, node, ids, now)
  }
  if (node.kind === 'retry') {
    const attempts = (run.retryCounters[node.id] ?? 0) + 1
    const condition = attempts <= node.maxAttempts ? 'retry' : 'exhausted'
    const edge = revision.edges.find((candidate) => candidate.from === node.id && candidate.condition === condition)
    if (edge) {
      const next = MultiAgentRunSchema.parse({
        ...run,
        activeNodeId: node.id,
        retryCounters: { ...run.retryCounters, [node.id]: attempts },
        events: [
          ...run.events,
          { eventId: ids('mae'), type: 'node_started', nodeId: node.id, timestamp: now },
          { eventId: ids('mae'), type: 'node_completed', nodeId: node.id, payload: { condition, attempts, maxAttempts: node.maxAttempts }, timestamp: now }
        ],
        updatedAt: now
      })
      return enterRevisionNode(next, revision, edge.to, ids, now)
    }
  }
  return MultiAgentRunSchema.parse({
    ...run,
    status: 'suspended',
    activeNodeId: node.id,
    events: [...run.events, { eventId: ids('mae'), type: 'node_started', nodeId: node.id, timestamp: now }],
    updatedAt: now
  })
}
