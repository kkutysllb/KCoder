import { randomUUID } from 'node:crypto'
import {
  ContextCheckpointV1Schema,
  CostEntrySchema,
  EngineStreamEventSchema,
  ExecutionLedgerEntrySchema,
  GraphRevisionSchema,
  GraphRunRecordSchema,
  HumanCheckpointSchema,
  ResourceClaimSchema,
  TaskCheckpointV1Schema,
  TaskScopeSchema,
  ValueEventSchema,
  WorkGraphEventRecordSchema,
  encodeTaskScope,
  type BudgetState,
  type ContextCheckpointV1,
  type CostEntry,
  type EngineStreamEvent,
  type ExecutionLedgerEntry,
  type GraphRevision,
  type GraphRunRecord,
  type HumanCheckpoint,
  type ResourceClaim,
  type TaskCheckpointV1,
  type TaskScope,
  type ValueEvent,
  type WorkGraphEventRecord
} from '@qiongqi/contracts'
import {
  applyHumanCheckpointMutation,
  assertGovernedRootCommit,
  EngineCommitResultSchema,
  EngineCommitSchema,
  EngineEventRecordSchema,
  EngineLeaseSchema,
  EngineOutboxRecordSchema,
  EngineOutboxIntentSchema,
  EngineRunRecordSchema,
  EngineStoreConflictError,
  EngineStoreCorruptError,
  LedgerQuerySchema,
  ResourceClaimRequestSchema,
  TaskModelPolicyRecordSchema,
  WorkClaimSchema,
  type DurableEngineStore,
  type EngineCommit,
  type EngineCommitResult,
  type EngineEventRecord,
  type EngineLease,
  type EngineOutboxRecord,
  type EngineOutboxIntent,
  type EngineRunRecord,
  type LedgerQuery,
  type ParsedEngineCommit,
  type ResourceClaimRequest,
  type TaskModelPolicyRecord,
  type WorkClaim
} from '@qiongqi/ports'
import { resourceClaimConflicts } from '@qiongqi/ports'
import { BudgetReservationRecordSchema, type BudgetReservationRecord } from '@qiongqi/ports'

type StoredOutbox = EngineOutboxIntent & { claim?: EngineLease }

interface StoreDraft {
  runs: Map<string, EngineRunRecord>
  tasks: Map<string, TaskCheckpointV1>
  contexts: Map<string, ContextCheckpointV1>
  ledger: Map<string, ExecutionLedgerEntry>
  events: Map<string, EngineEventRecord[]>
  streams: Map<string, EngineStreamEvent[]>
  outbox: Map<string, StoredOutbox>
  costs: Map<string, CostEntry>
  values: Map<string, ValueEvent>
  reservations: Map<string, BudgetReservationRecord>
  graphRevisions: Map<string, GraphRevision>
  graphRuns: Map<string, GraphRunRecord>
  workGraphEvents: Map<string, WorkGraphEventRecord[]>
  taskModelPolicies: Map<string, TaskModelPolicyRecord>
  humanCheckpoints: Map<string, HumanCheckpoint>
  resourceClaims: Map<string, ResourceClaim>
}

export class InMemoryDurableEngineStore implements DurableEngineStore {
  private runs = new Map<string, EngineRunRecord>()
  private tasks = new Map<string, TaskCheckpointV1>()
  private contexts = new Map<string, ContextCheckpointV1>()
  private ledger = new Map<string, ExecutionLedgerEntry>()
  private events = new Map<string, EngineEventRecord[]>()
  private streams = new Map<string, EngineStreamEvent[]>()
  private outbox = new Map<string, StoredOutbox>()
  private costs = new Map<string, CostEntry>()
  private values = new Map<string, ValueEvent>()
  private reservations = new Map<string, BudgetReservationRecord>()
  private graphRevisions = new Map<string, GraphRevision>()
  private graphRuns = new Map<string, GraphRunRecord>()
  private workGraphEvents = new Map<string, WorkGraphEventRecord[]>()
  private taskModelPolicies = new Map<string, TaskModelPolicyRecord>()
  private humanCheckpoints = new Map<string, HumanCheckpoint>()
  private resourceClaims = new Map<string, ResourceClaim>()
  private streamAcks = new Map<string, number>()
  private leases = new Map<string, EngineLease>()
  private leaseFences = new Map<string, number>()
  private workFences = new Map<string, number>()
  private commitLock: Promise<void> = Promise.resolve()

  async commit(rawInput: EngineCommit): Promise<EngineCommitResult> {
    const input = parseOrCorrupt(EngineCommitSchema, rawInput, 'invalid engine commit')
    assertGovernedRootCommit(input)
    return this.exclusive(() => {
      this.assertExpectedVersions(input)
      this.assertLeaseFence(input)

      const draft = this.cloneStore()
      this.applyCommit(draft, input)
      this.swapStore(draft)

      const streamHighWater = input.streamEvents.reduce((highWater, mutation) => {
        const events = draft.streams.get(mutation.record.streamId) ?? []
        return Math.max(highWater, events.at(-1)?.seq ?? 0)
      }, 0)
      const result = {
        runVersion: draft.runs.get(input.runId)?.version ?? draft.graphRuns.get(input.runId)?.version ?? 0,
        taskRevision: draft.tasks.get(scopeKey(input.scope))?.revision ?? 0,
        eventHighWater: draft.events.get(input.runId)?.at(-1)?.seq ?? 0,
        streamHighWater
      }
      return EngineCommitResultSchema.parse(result)
    })
  }

  async loadRun(runId: string): Promise<EngineRunRecord | undefined> {
    const record = this.runs.get(runId)
    return record ? cloneAndParse(EngineRunRecordSchema, record, `corrupt run ${runId}`) : undefined
  }

  async loadTask(scope: TaskScope): Promise<TaskCheckpointV1 | undefined> {
    const parsedScope = parseOrCorrupt(TaskScopeSchema, scope, 'invalid task scope')
    const record = this.tasks.get(scopeKey(parsedScope))
    return record ? cloneAndParse(TaskCheckpointV1Schema, record, 'corrupt task checkpoint') : undefined
  }

  async loadContext(scope: TaskScope, contextId: string): Promise<ContextCheckpointV1 | undefined> {
    const parsedScope = parseOrCorrupt(TaskScopeSchema, scope, 'invalid task scope')
    const record = this.contexts.get(contextKey(parsedScope, contextId))
    return record ? cloneAndParse(ContextCheckpointV1Schema, record, `corrupt context ${contextId}`) : undefined
  }

  async loadBudgetReservations(parentRunId: string): Promise<BudgetReservationRecord[]> {
    return [...this.reservations.values()]
      .filter((record) => record.parentRunId === parentRunId)
      .map((record) => cloneAndParse(BudgetReservationRecordSchema, record, `corrupt budget reservation ${record.reservationId}`))
  }

  async loadGraphRevision(graphId: string, revision: number): Promise<GraphRevision | undefined> {
    const record = this.graphRevisions.get(graphRevisionKey(graphId, revision))
    return record ? cloneAndParse(GraphRevisionSchema, record, `corrupt graph revision ${graphId}:${revision}`) : undefined
  }

  async loadGraphRun(runId: string): Promise<GraphRunRecord | undefined> {
    const record = this.graphRuns.get(runId)
    return record ? cloneAndParse(GraphRunRecordSchema, record, `corrupt graph run ${runId}`) : undefined
  }

  async listGraphRuns(scope?: TaskScope): Promise<GraphRunRecord[]> {
    const encodedScope = scope ? scopeKey(parseOrCorrupt(TaskScopeSchema, scope, 'invalid task scope')) : undefined
    return [...this.graphRuns.values()]
      .filter((record) => encodedScope === undefined || scopeKey(record.scope) === encodedScope)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.runId.localeCompare(right.runId))
      .map((record) => cloneAndParse(GraphRunRecordSchema, record, `corrupt graph run ${record.runId}`))
  }

  async listWorkGraphEvents(runId: string, afterSeq: number, limit: number): Promise<WorkGraphEventRecord[]> {
    assertNonnegativeInteger(afterSeq, 'afterSeq')
    if (!Number.isInteger(limit) || limit <= 0) throw new EngineStoreConflictError('limit must be a positive integer')
    return (this.workGraphEvents.get(runId) ?? [])
      .filter((event) => event.seq > afterSeq)
      .slice(0, limit)
      .map((event) => cloneAndParse(WorkGraphEventRecordSchema, event, `corrupt work graph event ${event.eventId}`))
  }

  async loadTaskModelPolicy(scope: TaskScope): Promise<TaskModelPolicyRecord | undefined> {
    const record = this.taskModelPolicies.get(scopeKey(TaskScopeSchema.parse(scope)))
    return record ? cloneAndParse(TaskModelPolicyRecordSchema, record, 'corrupt task model policy') : undefined
  }

  async loadHumanCheckpoint(checkpointId: string): Promise<HumanCheckpoint | undefined> {
    const record = this.humanCheckpoints.get(checkpointId)
    return record ? cloneAndParse(HumanCheckpointSchema, record, `corrupt human checkpoint ${checkpointId}`) : undefined
  }

  async listResourceClaims(resourceKey: string): Promise<ResourceClaim[]> {
    return [...this.resourceClaims.values()]
      .filter((claim) => claim.resourceKey === resourceKey)
      .map((claim) => cloneAndParse(ResourceClaimSchema, claim, `corrupt resource claim ${claim.claimId}`))
  }

  async claimResource(rawInput: ResourceClaimRequest): Promise<ResourceClaim | undefined> {
    const input = parseOrCorrupt(ResourceClaimRequestSchema, rawInput, 'invalid resource claim request')
    return this.exclusive(() => {
      const now = Date.now()
      const claims = [...this.resourceClaims.values()].filter((claim) => claim.resourceKey === input.resourceKey)
      for (const claim of claims) {
        if (claim.status === 'active' && Date.parse(claim.lease.expiresAt) <= now) {
          this.resourceClaims.set(resourceClaimKey(claim.resourceKey, claim.claimId), {
            ...claim, status: 'expired', updatedAt: new Date(now).toISOString()
          })
        }
      }
      const key = resourceClaimKey(input.resourceKey, input.claimId)
      const existing = this.resourceClaims.get(key)
      if (existing?.status === 'active') {
        return sameClaimRequest(existing, input)
          ? cloneAndParse(ResourceClaimSchema, existing, `corrupt resource claim ${existing.claimId}`)
          : undefined
      }
      const active = [...this.resourceClaims.values()].filter((claim) =>
        claim.resourceKey === input.resourceKey
        && claim.status === 'active'
        && Date.parse(claim.lease.expiresAt) > now)
      if (resourceClaimConflicts(input.mode, active)) return undefined
      const fence = Math.max(0, ...claims.map((claim) => claim.lease.fence ?? 0)) + 1
      const timestamp = new Date(now).toISOString()
      const claim = ResourceClaimSchema.parse({
        claimId: input.claimId,
        scope: input.scope,
        resourceKey: input.resourceKey,
        mode: input.mode,
        holderId: input.holderId,
        conflictStrategy: input.conflictStrategy,
        status: 'active',
        lease: { token: randomUUID(), fence, expiresAt: new Date(now + input.ttlMs).toISOString() },
        createdAt: timestamp,
        updatedAt: timestamp
      })
      this.resourceClaims.set(key, claim)
      return structuredClone(claim)
    })
  }

  async renewResourceClaim(rawClaim: ResourceClaim, ttlMs: number): Promise<ResourceClaim | undefined> {
    assertTtl(ttlMs)
    const claim = parseOrCorrupt(ResourceClaimSchema, rawClaim, 'invalid resource claim')
    return this.exclusive(() => {
      const key = resourceClaimKey(claim.resourceKey, claim.claimId)
      const current = this.resourceClaims.get(key)
      const now = Date.now()
      if (!current || current.status !== 'active' || Date.parse(current.lease.expiresAt) <= now) {
        if (current?.status === 'active') {
          this.resourceClaims.set(key, { ...current, status: 'expired', updatedAt: new Date(now).toISOString() })
        }
        return undefined
      }
      if (!sameResourceClaimLease(current, claim)) return undefined
      const renewed = ResourceClaimSchema.parse({
        ...current,
        lease: { ...current.lease, expiresAt: new Date(now + ttlMs).toISOString() },
        updatedAt: new Date(now).toISOString()
      })
      this.resourceClaims.set(key, renewed)
      return structuredClone(renewed)
    })
  }

  async releaseResourceClaim(rawClaim: ResourceClaim): Promise<void> {
    const claim = parseOrCorrupt(ResourceClaimSchema, rawClaim, 'invalid resource claim')
    await this.exclusive(() => {
      const key = resourceClaimKey(claim.resourceKey, claim.claimId)
      const current = this.resourceClaims.get(key)
      if (!current || current.status !== 'active' || !sameResourceClaimLease(current, claim)) {
        throw new EngineStoreConflictError(`resource claim ${claim.claimId} rejected by stale token or fence`)
      }
      const now = new Date().toISOString()
      this.resourceClaims.set(key, ResourceClaimSchema.parse({ ...current, status: 'released', updatedAt: now }))
    })
  }

  async loadOutboxIntent(workId: string): Promise<EngineOutboxRecord | undefined> {
    const record = this.outbox.get(workId)
    return record ? cloneAndParse(EngineOutboxRecordSchema, record, `corrupt outbox intent ${workId}`) : undefined
  }

  async listOutboxIntents(scope: TaskScope): Promise<EngineOutboxRecord[]> {
    const encodedScope = scopeKey(parseOrCorrupt(TaskScopeSchema, scope, 'invalid task scope'))
    return [...this.outbox.values()]
      .filter((record) => scopeKey(record.scope) === encodedScope)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.workId.localeCompare(right.workId))
      .map((record) => cloneAndParse(EngineOutboxRecordSchema, record, `corrupt outbox intent ${record.workId}`))
  }

  async findLedger(rawQuery: LedgerQuery): Promise<ExecutionLedgerEntry[]> {
    const query = parseOrCorrupt(LedgerQuerySchema, rawQuery, 'invalid ledger query')
    const encodedScope = scopeKey(query.scope)
    return [...this.ledger.values()]
      .filter((entry) => scopeKey(entry.scope) === encodedScope)
      .filter((entry) => query.kind === undefined || entry.kind === query.kind)
      .filter((entry) => query.operationId === undefined || entry.operationId === query.operationId)
      .filter((entry) => query.kernelRunId === undefined || entry.kernelRunId === query.kernelRunId)
      .filter((entry) => query.logicalRequestKey === undefined
        || (entry.kind === 'model' && entry.logicalRequestKey === query.logicalRequestKey))
      .filter((entry) => query.exactFingerprint === undefined
        || (entry.kind === 'tool' && entry.exactFingerprint === query.exactFingerprint))
      .filter((entry) => query.semanticKey === undefined
        || (entry.kind === 'tool' && entry.semanticKey === query.semanticKey))
      .filter((entry) => query.status === undefined || entry.status === query.status)
      .map((entry) => cloneAndParse(ExecutionLedgerEntrySchema, entry, `corrupt ledger ${entry.operationId}`))
  }

  async listCosts(scope: TaskScope): Promise<CostEntry[]> {
    const parsedScope = parseOrCorrupt(TaskScopeSchema, scope, 'invalid task scope')
    return [...this.costs.values()]
      .filter((record) => scopeKey(record.scope) === scopeKey(parsedScope))
      .map((record) => cloneAndParse(CostEntrySchema, record, `corrupt cost ${record.costId}`))
  }

  async listValues(scope: TaskScope): Promise<ValueEvent[]> {
    const parsedScope = parseOrCorrupt(TaskScopeSchema, scope, 'invalid task scope')
    return [...this.values.values()]
      .filter((record) => scopeKey(record.scope) === scopeKey(parsedScope))
      .map((record) => cloneAndParse(ValueEventSchema, record, `corrupt value ${record.valueId}`))
  }

  async readStream(streamId: string, afterSeq: number, limit: number): Promise<EngineStreamEvent[]> {
    assertNonnegativeInteger(afterSeq, 'afterSeq')
    if (!Number.isInteger(limit) || limit <= 0) throw new EngineStoreConflictError('limit must be a positive integer')
    return (this.streams.get(streamId) ?? [])
      .filter((event) => event.seq > afterSeq)
      .slice(0, limit)
      .map((event) => cloneAndParse(EngineStreamEventSchema, event, `corrupt stream ${streamId}`))
  }

  async ackStream(streamId: string, subscriberId: string, throughSeq: number): Promise<void> {
    assertNonnegativeInteger(throughSeq, 'throughSeq')
    await this.exclusive(() => {
      const highWater = this.streams.get(streamId)?.at(-1)?.seq ?? 0
      if (throughSeq > highWater) throw new EngineStoreConflictError('stream acknowledgement exceeds high-water')
      const key = `${streamId}\u0000${subscriberId}`
      const current = this.streamAcks.get(key) ?? 0
      if (throughSeq < current) throw new EngineStoreConflictError('stream acknowledgement cannot move backwards')
      this.streamAcks.set(key, throughSeq)
    })
  }

  async acquireLease(runId: string, holderId: string, ttlMs: number): Promise<EngineLease | undefined> {
    assertTtl(ttlMs)
    return this.exclusive(() => {
      const now = Date.now()
      const current = this.leases.get(runId)
      if (current && Date.parse(current.expiresAt) > now) return undefined
      const fence = (this.leaseFences.get(runId) ?? 0) + 1
      const lease = EngineLeaseSchema.parse({
        runId,
        holderId,
        fence,
        token: randomUUID(),
        expiresAt: new Date(now + ttlMs).toISOString()
      })
      this.leaseFences.set(runId, fence)
      this.leases.set(runId, lease)
      return structuredClone(lease)
    })
  }

  async renewLease(runId: string, lease: EngineLease, ttlMs: number): Promise<EngineLease | undefined> {
    assertTtl(ttlMs)
    const parsed = parseOrCorrupt(EngineLeaseSchema, lease, 'invalid engine lease')
    return this.exclusive(() => {
      const current = this.leases.get(runId)
      if (!current || !sameLease(current, parsed) || Date.parse(current.expiresAt) <= Date.now()) return undefined
      const renewed = EngineLeaseSchema.parse({ ...current, expiresAt: new Date(Date.now() + ttlMs).toISOString() })
      this.leases.set(runId, renewed)
      return structuredClone(renewed)
    })
  }

  async releaseLease(runId: string, lease: EngineLease): Promise<void> {
    const parsed = parseOrCorrupt(EngineLeaseSchema, lease, 'invalid engine lease')
    await this.exclusive(() => {
      const current = this.leases.get(runId)
      if (!current || !sameLease(current, parsed)) throw new EngineStoreConflictError('lease does not match active owner')
      this.leases.delete(runId)
    })
  }

  async claimWork(workerId: string, kinds: readonly string[], ttlMs: number): Promise<WorkClaim | undefined> {
    assertTtl(ttlMs)
    return this.exclusive(() => {
      const now = Date.now()
      const allowed = new Set(kinds)
      const candidate = [...this.outbox.values()]
        .filter((work) => allowed.has(work.kind) && Date.parse(work.availableAt) <= now)
        .filter((work) => work.status === 'pending'
          || (work.status === 'claimed' && work.claim && Date.parse(work.claim.expiresAt) <= now))
        .sort((left, right) => left.availableAt.localeCompare(right.availableAt) || left.workId.localeCompare(right.workId))[0]
      if (!candidate) return undefined

      const fence = (this.workFences.get(candidate.workId) ?? 0) + 1
      const lease = EngineLeaseSchema.parse({
        runId: `work:${candidate.workId}`,
        holderId: workerId,
        fence,
        token: randomUUID(),
        expiresAt: new Date(now + ttlMs).toISOString()
      })
      this.workFences.set(candidate.workId, fence)
      this.outbox.set(candidate.workId, { ...candidate, status: 'claimed', claim: lease })
      return WorkClaimSchema.parse({
        workId: candidate.workId,
        kind: candidate.kind,
        payloadRef: candidate.payloadRef,
        lease,
        payload: candidate.payload
      })
    })
  }

  async renewWorkClaim(workId: string, lease: EngineLease, ttlMs: number): Promise<EngineLease | undefined> {
    assertTtl(ttlMs)
    const parsed = parseOrCorrupt(EngineLeaseSchema, lease, 'invalid work claim')
    return this.exclusive(() => {
      const current = this.outbox.get(workId)
      if (current?.status !== 'claimed'
        || !current.claim
        || !sameLease(current.claim, parsed)
        || Date.parse(current.claim.expiresAt) <= Date.now()) {
        return undefined
      }
      const now = new Date().toISOString()
      const renewed = EngineLeaseSchema.parse({
        ...current.claim,
        expiresAt: new Date(Date.now() + ttlMs).toISOString()
      })
      this.outbox.set(workId, { ...current, claim: renewed, updatedAt: now })
      return structuredClone(renewed)
    })
  }

  private assertExpectedVersions(input: ParsedEngineCommit): void {
    const engineVersion = this.runs.get(input.runId)?.version
    const graphVersion = this.graphRuns.get(input.runId)?.version
    if (engineVersion !== undefined && graphVersion !== undefined && engineVersion !== graphVersion) {
      throw new EngineStoreCorruptError(`engine and graph run versions diverged for ${input.runId}`)
    }
    const runVersion = engineVersion ?? graphVersion ?? 0
    if (input.expectedRunVersion !== runVersion) {
      throw new EngineStoreConflictError(`run version mismatch: expected ${input.expectedRunVersion}, actual ${runVersion}`)
    }
    const taskRevision = this.tasks.get(scopeKey(input.scope))?.revision ?? 0
    if (input.expectedTaskRevision !== taskRevision) {
      throw new EngineStoreConflictError(
        `task revision mismatch: expected ${input.expectedTaskRevision}, actual ${taskRevision}`
      )
    }
    if (input.expectedModelPolicyRevision !== undefined) {
      const policyRevision = this.taskModelPolicies.get(scopeKey(input.scope))?.revision ?? 0
      if (input.expectedModelPolicyRevision !== policyRevision) {
        throw new EngineStoreConflictError(
          `model policy revision mismatch: expected ${input.expectedModelPolicyRevision}, actual ${policyRevision}`
        )
      }
    }
  }

  private assertLeaseFence(input: ParsedEngineCommit): void {
    const latestFence = this.leaseFences.get(input.runId) ?? 0
    if (latestFence > 0 && input.leaseFence !== latestFence) {
      throw new EngineStoreConflictError(`stale lease fence for run ${input.runId}`)
    }
    const active = this.leases.get(input.runId)
    if (active && Date.parse(active.expiresAt) > Date.now() && input.leaseFence !== active.fence) {
      throw new EngineStoreConflictError(`commit does not own the active lease for run ${input.runId}`)
    }
  }

  private applyCommit(draft: StoreDraft, input: ParsedEngineCommit): void {
    const encodedScope = scopeKey(input.scope)
    for (const mutation of input.graphRevisionMutations) {
      const key = graphRevisionKey(
        mutation.type === 'put' ? mutation.record.graphId : mutation.graphId,
        mutation.type === 'put' ? mutation.record.revision : mutation.revision
      )
      if (mutation.type === 'delete') {
        draft.graphRevisions.delete(key)
        continue
      }
      const existing = draft.graphRevisions.get(key)
      if (existing && !sameRecord(existing, mutation.record)) {
        throw new EngineStoreConflictError(`graph revision ${key} is immutable`)
      }
      if (!existing) draft.graphRevisions.set(key, structuredClone(mutation.record))
    }
    if (input.graphRunMutation) {
      if (input.graphRunMutation.type === 'delete') {
        if (input.graphRunMutation.recordId !== input.runId) throw new EngineStoreCorruptError('graph run delete targets another run')
        draft.graphRuns.delete(input.runId)
      } else {
        assertSameScope(input.scope, input.graphRunMutation.record.scope, 'graph run')
        if (input.graphRunMutation.record.runId !== input.runId) throw new EngineStoreCorruptError('graph run mutation targets another run')
        const assignedVersion = input.expectedRunVersion + 1
        if (input.graphRunMutation.record.version !== assignedVersion) {
          throw new EngineStoreConflictError(`graph run mutation must use assigned version ${assignedVersion}`)
        }
        draft.graphRuns.set(input.runId, structuredClone(input.graphRunMutation.record))
      }
    }
    for (const mutation of input.workGraphEvents) {
      assertSameScope(input.scope, mutation.record.scope, 'work graph event')
      if (mutation.record.runId !== input.runId) throw new EngineStoreCorruptError('work graph event targets another run')
      const events = draft.workGraphEvents.get(input.runId) ?? []
      const existing = events.find((event) => event.eventId === mutation.record.eventId)
      if (existing) {
        const { seq: _seq, ...existingInput } = existing
        if (!sameRecord(existingInput, mutation.record)) {
          throw new EngineStoreConflictError(`work graph event ${mutation.record.eventId} already exists with different data`)
        }
        continue
      }
      const record = WorkGraphEventRecordSchema.parse({ ...mutation.record, seq: (events.at(-1)?.seq ?? 0) + 1 })
      draft.workGraphEvents.set(input.runId, [...events, record])
    }
    if (input.taskModelPolicyMutation) {
      if (input.taskModelPolicyMutation.type === 'delete') {
        draft.taskModelPolicies.delete(encodedScope)
      } else {
        assertSameScope(input.scope, input.taskModelPolicyMutation.record.scope, 'task model policy')
        const assignedRevision = (input.expectedModelPolicyRevision ?? 0) + 1
        if (input.taskModelPolicyMutation.record.revision !== assignedRevision) {
          throw new EngineStoreConflictError(`model policy mutation must use assigned revision ${assignedRevision}`)
        }
        draft.taskModelPolicies.set(encodedScope, structuredClone(input.taskModelPolicyMutation.record))
      }
    }
    for (const mutation of input.humanCheckpointMutations) {
      if (mutation.type === 'delete') {
        draft.humanCheckpoints.delete(mutation.recordId)
      } else if (mutation.type === 'put') {
        assertSameScope(input.scope, mutation.record.scope, 'human checkpoint')
        appendIdempotent(draft.humanCheckpoints, mutation.record.checkpointId, mutation.record, `checkpoint ${mutation.record.checkpointId}`)
      } else {
        const existing = draft.humanCheckpoints.get(mutation.recordId)
        if (!existing) throw new EngineStoreConflictError(`checkpoint ${mutation.recordId} does not exist`)
        assertSameScope(input.scope, existing.scope, 'human checkpoint')
        draft.humanCheckpoints.set(mutation.recordId, applyHumanCheckpointMutation(existing, mutation))
      }
    }
    for (const mutation of input.resourceClaimMutations) {
      const key = resourceClaimKey(
        mutation.type === 'put' ? mutation.record.resourceKey : mutation.resourceKey,
        mutation.type === 'put' ? mutation.record.claimId : mutation.claimId
      )
      if (mutation.type === 'delete') {
        draft.resourceClaims.delete(key)
      } else {
        assertSameScope(input.scope, mutation.record.scope, 'resource claim')
        draft.resourceClaims.set(key, structuredClone(mutation.record))
      }
    }
    if (input.runMutation) {
      if (input.runMutation.type === 'delete') {
        if (input.runMutation.recordId !== input.runId) throw new EngineStoreCorruptError('run delete targets another run')
        draft.runs.delete(input.runId)
      } else {
        assertSameScope(input.scope, input.runMutation.record.scope, 'run')
        if (input.runMutation.record.runId !== input.runId) throw new EngineStoreCorruptError('run mutation targets another run')
        const assignedVersion = input.expectedRunVersion + 1
        if (input.runMutation.record.version !== assignedVersion) {
          throw new EngineStoreConflictError(`run mutation must use assigned version ${assignedVersion}`)
        }
        draft.runs.set(input.runId, structuredClone(input.runMutation.record))
      }
    }
    if (input.taskCheckpointMutation) {
      if (input.taskCheckpointMutation.type === 'delete') {
        if (input.taskCheckpointMutation.recordId !== encodedScope) {
          throw new EngineStoreCorruptError('task delete requires its encoded task scope')
        }
        draft.tasks.delete(encodedScope)
      } else {
        assertSameScope(input.scope, input.taskCheckpointMutation.record.scope, 'task checkpoint')
        const assignedRevision = input.expectedTaskRevision + 1
        if (input.taskCheckpointMutation.record.revision !== assignedRevision) {
          throw new EngineStoreConflictError(`task mutation must use assigned revision ${assignedRevision}`)
        }
        draft.tasks.set(encodedScope, structuredClone(input.taskCheckpointMutation.record))
      }
    }
    if (input.contextCheckpointMutation) {
      if (input.contextCheckpointMutation.type === 'delete') {
        draft.contexts.delete(contextKey(input.scope, input.contextCheckpointMutation.recordId))
      } else {
        assertSameScope(input.scope, input.contextCheckpointMutation.record.scope, 'context checkpoint')
        draft.contexts.set(
          contextKey(input.scope, input.contextCheckpointMutation.record.contextId),
          structuredClone(input.contextCheckpointMutation.record)
        )
      }
    }

    for (const mutation of input.ledgerMutations) {
      const key = ledgerKey(input.scope, mutation.type === 'delete' ? mutation.recordId : mutation.record.operationId)
      if (mutation.type === 'delete') {
        draft.ledger.delete(key)
        continue
      }
      assertSameScope(input.scope, mutation.record.scope, 'ledger')
      const existing = draft.ledger.get(key)
      if (mutation.type === 'append' && existing) {
        if (!sameRecord(existing, mutation.record)) {
          throw new EngineStoreConflictError(`operation ${mutation.record.operationId} already exists with different data`)
        }
        continue
      }
      draft.ledger.set(key, structuredClone(mutation.record))
    }

    for (const mutation of input.events) {
      assertSameScope(input.scope, mutation.record.scope, 'event')
      if (mutation.record.runId !== input.runId) throw new EngineStoreCorruptError('event targets another run')
      const events = draft.events.get(input.runId) ?? []
      const existing = events.find((event) => event.eventId === mutation.record.eventId)
      if (existing) {
        const { seq: _seq, ...existingInput } = existing
        if (!sameRecord(existingInput, mutation.record)) {
          throw new EngineStoreConflictError(`event ${mutation.record.eventId} already exists with different data`)
        }
        continue
      }
      const record = EngineEventRecordSchema.parse({ ...mutation.record, seq: (events.at(-1)?.seq ?? 0) + 1 })
      draft.events.set(input.runId, [...events, record])
    }

    for (const mutation of input.streamEvents) {
      assertSameScope(input.scope, mutation.record.scope, 'stream event')
      const events = draft.streams.get(mutation.record.streamId) ?? []
      const record = EngineStreamEventSchema.parse({ ...mutation.record, seq: (events.at(-1)?.seq ?? 0) + 1 })
      draft.streams.set(record.streamId, [...events, record])
    }

    for (const mutation of input.outboxIntents) {
      if (mutation.type === 'delete') {
        draft.outbox.delete(mutation.recordId)
        continue
      }
      if (mutation.type === 'complete') {
        const existing = draft.outbox.get(mutation.recordId)
        if (!existing) throw new EngineStoreConflictError(`work ${mutation.recordId} does not exist`)
        if (mutation.claim && (!existing.claim || !sameLease(existing.claim, mutation.claim))) {
          throw new EngineStoreConflictError(`work ${mutation.recordId} completion rejected by stale claim`)
        }
        if (existing.status === 'completed') {
          if (mutation.payload !== undefined && !sameRecord(existing.payload, mutation.payload)) {
            throw new EngineStoreConflictError(`work ${mutation.recordId} already completed differently`)
          }
          continue
        }
        const now = new Date().toISOString()
        const { claim: _claim, ...intent } = existing
        draft.outbox.set(mutation.recordId, {
          ...intent,
          status: 'completed',
          completedAt: now,
          updatedAt: now,
          ...(mutation.payload !== undefined ? { payload: mutation.payload } : {})
        })
        continue
      }
      assertSameScope(input.scope, mutation.record.scope, 'outbox')
      const existing = draft.outbox.get(mutation.record.workId)
      if (existing && !sameOutboxIdentity(existing, mutation.record)) {
        throw new EngineStoreConflictError(`work ${mutation.record.workId} already exists with different data`)
      }
      if (!existing) draft.outbox.set(mutation.record.workId, structuredClone(mutation.record))
    }

    for (const mutation of input.costMutations) {
      const key = costKey(input.scope, mutation.type === 'delete' ? mutation.recordId : mutation.record.costId)
      if (mutation.type === 'delete') {
        draft.costs.delete(key)
      } else {
        assertSameScope(input.scope, mutation.record.scope, 'cost')
        appendIdempotent(draft.costs, key, mutation.record, `cost ${mutation.record.costId}`)
      }
    }
    for (const mutation of input.valueMutations) {
      const key = valueKey(input.scope, mutation.type === 'delete' ? mutation.recordId : mutation.record.valueId)
      if (mutation.type === 'delete') {
        draft.values.delete(key)
      } else {
        assertSameScope(input.scope, mutation.record.scope, 'value')
        appendIdempotent(draft.values, key, mutation.record, `value ${mutation.record.valueId}`)
      }
    }

    for (const mutation of input.budgetReservationMutations) {
      const key = `${scopeKey(input.scope)}\u0000${mutation.type === 'reserve' ? mutation.record.reservationId : mutation.recordId}`
      if (mutation.type === 'reserve') {
        assertSameScope(input.scope, mutation.record.scope, 'budget reservation')
        const existing = draft.reservations.get(key)
        if (existing) {
          if (!sameRecord(existing, mutation.record)) {
            throw new EngineStoreConflictError(`reservation ${mutation.record.reservationId} already exists with different data`)
          }
          continue
        }
        const parent = draft.runs.get(mutation.record.parentRunId)
        if (!parent?.budgetLimits) throw new EngineStoreConflictError(`parent run ${mutation.record.parentRunId} has no budget limits`)
        const committed = [...draft.reservations.values()]
          .filter((record) => record.parentRunId === mutation.record.parentRunId)
          .reduce((total, record) => addBudget(total, committedReservationBudget(record)), zeroBudget())
        const projected = addBudget(committed, mutation.record.reserved)
        assertWithinBudget(projected, parent.budgetLimits)
        draft.reservations.set(key, structuredClone(mutation.record))
      } else {
        const existing = draft.reservations.get(key)
        if (!existing) throw new EngineStoreConflictError(`reservation ${mutation.recordId} does not exist`)
        if (mutation.type === 'settle') {
          if (existing.status === 'settled' && existing.actual && !sameRecord(existing.actual, mutation.actual)) {
            throw new EngineStoreConflictError(`reservation ${mutation.recordId} already settled differently`)
          }
          draft.reservations.set(key, {
            ...existing, status: 'settled', actual: mutation.actual, updatedAt: mutation.updatedAt
          })
        } else {
          draft.reservations.set(key, { ...existing, status: 'released', updatedAt: mutation.updatedAt })
        }
      }
    }
  }

  private cloneStore(): StoreDraft {
    return {
      runs: cloneMap(this.runs),
      tasks: cloneMap(this.tasks),
      contexts: cloneMap(this.contexts),
      ledger: cloneMap(this.ledger),
      events: cloneMap(this.events),
      streams: cloneMap(this.streams),
      outbox: cloneMap(this.outbox),
      costs: cloneMap(this.costs),
      values: cloneMap(this.values),
      reservations: cloneMap(this.reservations),
      graphRevisions: cloneMap(this.graphRevisions),
      graphRuns: cloneMap(this.graphRuns),
      workGraphEvents: cloneMap(this.workGraphEvents),
      taskModelPolicies: cloneMap(this.taskModelPolicies),
      humanCheckpoints: cloneMap(this.humanCheckpoints),
      resourceClaims: cloneMap(this.resourceClaims)
    }
  }

  private swapStore(draft: StoreDraft): void {
    this.runs = draft.runs
    this.tasks = draft.tasks
    this.contexts = draft.contexts
    this.ledger = draft.ledger
    this.events = draft.events
    this.streams = draft.streams
    this.outbox = draft.outbox
    this.costs = draft.costs
    this.values = draft.values
    this.reservations = draft.reservations
    this.graphRevisions = draft.graphRevisions
    this.graphRuns = draft.graphRuns
    this.workGraphEvents = draft.workGraphEvents
    this.taskModelPolicies = draft.taskModelPolicies
    this.humanCheckpoints = draft.humanCheckpoints
    this.resourceClaims = draft.resourceClaims
  }

  private async exclusive<T>(operation: () => T | Promise<T>): Promise<T> {
    let release!: () => void
    const previous = this.commitLock
    this.commitLock = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }
}

function committedReservationBudget(record: BudgetReservationRecord): BudgetState {
  if (record.status === 'reserved') return record.reserved
  if (record.status === 'released') return zeroBudget()
  if (!record.actual) throw new EngineStoreConflictError(`settled reservation ${record.reservationId} has no actual usage`)
  return record.actual
}

function scopeKey(scope: TaskScope): string {
  return encodeTaskScope(scope)
}

function contextKey(scope: TaskScope, contextId: string): string {
  return `${scopeKey(scope)}\u0000${contextId}`
}

function graphRevisionKey(graphId: string, revision: number): string {
  return `${graphId}\u0000${revision}`
}

function resourceClaimKey(resourceKey: string, claimId: string): string {
  return `${resourceKey}\u0000${claimId}`
}

function ledgerKey(scope: TaskScope, operationId: string): string {
  return `${scopeKey(scope)}\u0000${operationId}`
}

function costKey(scope: TaskScope, costId: string): string {
  return `${scopeKey(scope)}\u0000${costId}`
}

function valueKey(scope: TaskScope, valueId: string): string {
  return `${scopeKey(scope)}\u0000${valueId}`
}

function assertSameScope(expected: TaskScope, actual: TaskScope, recordKind: string): void {
  if (scopeKey(expected) !== scopeKey(actual)) {
    throw new EngineStoreCorruptError(`${recordKind} scope does not match commit scope`)
  }
}

function assertNonnegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) throw new EngineStoreConflictError(`${name} must be a nonnegative integer`)
}

function assertTtl(ttlMs: number): void {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new EngineStoreConflictError('lease ttl must be positive')
}

function sameLease(left: EngineLease, right: EngineLease): boolean {
  return left.runId === right.runId
    && left.holderId === right.holderId
    && left.fence === right.fence
    && left.token === right.token
}

function sameClaimRequest(claim: ResourceClaim, request: ResourceClaimRequest): boolean {
  return scopeKey(claim.scope) === scopeKey(request.scope)
    && claim.resourceKey === request.resourceKey
    && claim.claimId === request.claimId
    && claim.mode === request.mode
    && claim.holderId === request.holderId
    && claim.conflictStrategy === request.conflictStrategy
}

function sameResourceClaimLease(left: ResourceClaim, right: ResourceClaim): boolean {
  return left.resourceKey === right.resourceKey
    && left.claimId === right.claimId
    && left.holderId === right.holderId
    && left.lease.token === right.lease.token
    && left.lease.fence === right.lease.fence
}

function sameRecord(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function stripClaim(record: StoredOutbox): EngineOutboxIntent {
  const { claim: _claim, ...intent } = record
  return intent
}

function sameOutboxIdentity(existing: StoredOutbox, incoming: EngineOutboxIntent): boolean {
  const stored = stripClaim(existing)
  return stored.workId === incoming.workId
    && scopeKey(stored.scope) === scopeKey(incoming.scope)
    && stored.kind === incoming.kind
    && stored.payloadRef === incoming.payloadRef
    && stored.availableAt === incoming.availableAt
    && stored.createdAt === incoming.createdAt
    && (stored.status === 'completed' || sameRecord(stored.payload, incoming.payload))
}

function cloneMap<K, V>(input: Map<K, V>): Map<K, V> {
  return new Map([...input.entries()].map(([key, value]) => [key, structuredClone(value)]))
}

function appendIdempotent<T>(map: Map<string, T>, key: string, record: T, label: string): void {
  const existing = map.get(key)
  if (existing && !sameRecord(existing, record)) throw new EngineStoreConflictError(`${label} already exists with different data`)
  if (!existing) map.set(key, structuredClone(record))
}

const budgetKeys = ['stepsUsed', 'toolCallsUsed', 'inputTokens', 'outputTokens', 'costUsd'] as const
type Budget = { stepsUsed: number; toolCallsUsed: number; inputTokens: number; outputTokens: number; costUsd: number }

function zeroBudget(): Budget { return { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 } }

function addBudget(left: Budget, right: Budget): Budget {
  return {
    stepsUsed: left.stepsUsed + right.stepsUsed,
    toolCallsUsed: left.toolCallsUsed + right.toolCallsUsed,
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    costUsd: left.costUsd + right.costUsd
  }
}

function assertWithinBudget(actual: Budget, limits: Budget): void {
  for (const key of budgetKeys) {
    if (actual[key] > limits[key]) throw new EngineStoreConflictError(`parent budget exceeded: ${key}`)
  }
}

function parseOrCorrupt<T>(schema: { parse(value: unknown): T }, value: unknown, message: string): T {
  try {
    return schema.parse(value)
  } catch (cause) {
    throw new EngineStoreCorruptError(message, { cause })
  }
}

function cloneAndParse<T>(schema: { parse(value: unknown): T }, value: T, message: string): T {
  return parseOrCorrupt(schema, structuredClone(value), message)
}
