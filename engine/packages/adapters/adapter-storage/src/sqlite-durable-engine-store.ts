import { randomUUID } from 'node:crypto'
import Database, { type Database as SqliteDatabase } from 'better-sqlite3'
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
import { BudgetReservationRecordSchema, type BudgetReservationRecord } from '@qiongqi/ports'
import { resourceClaimConflicts } from '@qiongqi/ports'

type PayloadRow = { payload: string }
type VersionRow = { version: number }
type RevisionRow = { revision: number }
type HighWaterRow = { high_water: number }
type AckRow = { through_seq: number }
type FenceRow = { fence: number }
type LeaseRow = { payload: string; expires_at: string }
type OutboxRow = {
  payload: string
  kind: string
  payload_ref: string
  status: EngineOutboxIntent['status']
  claim_payload: string | null
}
type StoredOutboxRow = PayloadRow & { claim_payload: string | null }

export class SqliteDurableEngineStore implements DurableEngineStore {
  private readonly db: SqliteDatabase

  constructor(databasePath: string) {
    this.db = new Database(databasePath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('busy_timeout = 5000')
    this.migrate()
  }

  close(): void {
    this.db.close()
  }

  async commit(rawInput: EngineCommit): Promise<EngineCommitResult> {
    const input = parseOrCorrupt(EngineCommitSchema, rawInput, 'invalid engine commit')
    assertGovernedRootCommit(input)
    return this.db.transaction(() => this.commitTransaction(input))()
  }

  async loadRun(runId: string): Promise<EngineRunRecord | undefined> {
    const row = this.db.prepare('SELECT payload FROM engine_runs WHERE run_id = ?').get(runId) as PayloadRow | undefined
    return row ? parsePayload(EngineRunRecordSchema, row.payload, `corrupt run ${runId}`) : undefined
  }

  async loadTask(scope: TaskScope): Promise<TaskCheckpointV1 | undefined> {
    const parsedScope = parseOrCorrupt(TaskScopeSchema, scope, 'invalid task scope')
    const row = this.db.prepare(`
      SELECT payload FROM task_checkpoints
      WHERE owner_id = ? AND workspace_id = ? AND task_id = ?
    `).get(...scopeParams(parsedScope)) as PayloadRow | undefined
    return row ? parsePayload(TaskCheckpointV1Schema, row.payload, 'corrupt task checkpoint') : undefined
  }

  async loadContext(scope: TaskScope, contextId: string): Promise<ContextCheckpointV1 | undefined> {
    const parsedScope = parseOrCorrupt(TaskScopeSchema, scope, 'invalid task scope')
    const row = this.db.prepare(`
      SELECT payload FROM context_checkpoints
      WHERE owner_id = ? AND workspace_id = ? AND task_id = ? AND context_id = ?
    `).get(...scopeParams(parsedScope), contextId) as PayloadRow | undefined
    return row ? parsePayload(ContextCheckpointV1Schema, row.payload, `corrupt context ${contextId}`) : undefined
  }

  async loadBudgetReservations(parentRunId: string): Promise<BudgetReservationRecord[]> {
    const rows = this.db.prepare(`
      SELECT payload FROM engine_budget_reservations WHERE parent_run_id = ? ORDER BY reservation_id
    `).all(parentRunId) as PayloadRow[]
    return rows.map((row) => parsePayload(BudgetReservationRecordSchema, row.payload, `corrupt budget reservation ${parentRunId}`))
  }

  async loadGraphRevision(graphId: string, revision: number): Promise<GraphRevision | undefined> {
    const row = this.db.prepare(`
      SELECT payload FROM graph_revisions WHERE graph_id = ? AND revision = ?
    `).get(graphId, revision) as PayloadRow | undefined
    return row ? parsePayload(GraphRevisionSchema, row.payload, `corrupt graph revision ${graphId}:${revision}`) : undefined
  }

  async loadGraphRun(runId: string): Promise<GraphRunRecord | undefined> {
    const row = this.db.prepare('SELECT payload FROM graph_runs WHERE run_id = ?').get(runId) as PayloadRow | undefined
    return row ? parsePayload(GraphRunRecordSchema, row.payload, `corrupt graph run ${runId}`) : undefined
  }

  async listGraphRuns(scope?: TaskScope): Promise<GraphRunRecord[]> {
    const rows = scope
      ? this.db.prepare(`
          SELECT payload FROM graph_runs
          WHERE owner_id = ? AND workspace_id = ? AND task_id = ?
          ORDER BY rowid
        `).all(...scopeParams(parseOrCorrupt(TaskScopeSchema, scope, 'invalid task scope'))) as PayloadRow[]
      : this.db.prepare('SELECT payload FROM graph_runs ORDER BY rowid').all() as PayloadRow[]
    return rows
      .map((row) => parsePayload(GraphRunRecordSchema, row.payload, 'corrupt graph run'))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.runId.localeCompare(right.runId))
  }

  async listWorkGraphEvents(runId: string, afterSeq: number, limit: number): Promise<WorkGraphEventRecord[]> {
    assertNonnegativeInteger(afterSeq, 'afterSeq')
    if (!Number.isInteger(limit) || limit <= 0) throw new EngineStoreConflictError('limit must be a positive integer')
    const rows = this.db.prepare(`
      SELECT payload FROM work_graph_events WHERE run_id = ? AND seq > ? ORDER BY seq LIMIT ?
    `).all(runId, afterSeq, limit) as PayloadRow[]
    return rows.map((row) => parsePayload(WorkGraphEventRecordSchema, row.payload, `corrupt work graph event ${runId}`))
  }

  async loadTaskModelPolicy(scope: TaskScope): Promise<TaskModelPolicyRecord | undefined> {
    const parsedScope = parseOrCorrupt(TaskScopeSchema, scope, 'invalid task scope')
    const row = this.db.prepare(`
      SELECT payload FROM task_model_policies
      WHERE owner_id = ? AND workspace_id = ? AND task_id = ?
    `).get(...scopeParams(parsedScope)) as PayloadRow | undefined
    return row ? parsePayload(TaskModelPolicyRecordSchema, row.payload, 'corrupt task model policy') : undefined
  }

  async loadHumanCheckpoint(checkpointId: string): Promise<HumanCheckpoint | undefined> {
    const row = this.db.prepare('SELECT payload FROM human_checkpoints WHERE checkpoint_id = ?')
      .get(checkpointId) as PayloadRow | undefined
    return row ? parsePayload(HumanCheckpointSchema, row.payload, `corrupt human checkpoint ${checkpointId}`) : undefined
  }

  async listResourceClaims(resourceKey: string): Promise<ResourceClaim[]> {
    const rows = this.db.prepare(`
      SELECT payload FROM resource_claims WHERE resource_key = ? ORDER BY claim_id
    `).all(resourceKey) as PayloadRow[]
    return rows.map((row) => parsePayload(ResourceClaimSchema, row.payload, `corrupt resource claim ${resourceKey}`))
  }

  async claimResource(rawInput: ResourceClaimRequest): Promise<ResourceClaim | undefined> {
    const input = parseOrCorrupt(ResourceClaimRequestSchema, rawInput, 'invalid resource claim request')
    const transaction = this.db.transaction(() => {
      const now = Date.now()
      const rows = this.db.prepare('SELECT payload FROM resource_claims WHERE resource_key = ? ORDER BY claim_id')
        .all(input.resourceKey) as PayloadRow[]
      const claims = rows.map((row) => parsePayload(ResourceClaimSchema, row.payload, `corrupt resource claim ${input.resourceKey}`))
      for (const claim of claims) {
        if (claim.status === 'active' && Date.parse(claim.lease.expiresAt) <= now) {
          const expired = ResourceClaimSchema.parse({
            ...claim, status: 'expired', updatedAt: new Date(now).toISOString()
          })
          this.db.prepare('UPDATE resource_claims SET status = ?, payload = ? WHERE resource_key = ? AND claim_id = ?')
            .run(expired.status, encode(expired), expired.resourceKey, expired.claimId)
        }
      }
      const existing = claims.find((claim) => claim.claimId === input.claimId)
      if (existing?.status === 'active' && Date.parse(existing.lease.expiresAt) > now) {
        return sameClaimRequest(existing, input) ? existing : undefined
      }
      const active = claims.filter((claim) =>
        claim.status === 'active'
        && claim.claimId !== input.claimId
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
      this.db.prepare(`
        INSERT INTO resource_claims
          (resource_key, claim_id, owner_id, workspace_id, task_id, status, payload)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(resource_key, claim_id) DO UPDATE SET
          owner_id = excluded.owner_id,
          workspace_id = excluded.workspace_id,
          task_id = excluded.task_id,
          status = excluded.status,
          payload = excluded.payload
      `).run(claim.resourceKey, claim.claimId, ...scopeParams(claim.scope), claim.status, encode(claim))
      return claim
    })
    return transaction.immediate()
  }

  async renewResourceClaim(rawClaim: ResourceClaim, ttlMs: number): Promise<ResourceClaim | undefined> {
    assertTtl(ttlMs)
    const claim = parseOrCorrupt(ResourceClaimSchema, rawClaim, 'invalid resource claim')
    const transaction = this.db.transaction(() => {
      const row = this.db.prepare('SELECT payload FROM resource_claims WHERE resource_key = ? AND claim_id = ?')
        .get(claim.resourceKey, claim.claimId) as PayloadRow | undefined
      if (!row) return undefined
      const current = parsePayload(ResourceClaimSchema, row.payload, `corrupt resource claim ${claim.claimId}`)
      const now = Date.now()
      if (current.status !== 'active' || Date.parse(current.lease.expiresAt) <= now) {
        if (current.status === 'active') {
          const expired = ResourceClaimSchema.parse({ ...current, status: 'expired', updatedAt: new Date(now).toISOString() })
          this.db.prepare('UPDATE resource_claims SET status = ?, payload = ? WHERE resource_key = ? AND claim_id = ?')
            .run(expired.status, encode(expired), expired.resourceKey, expired.claimId)
        }
        return undefined
      }
      if (!sameResourceClaimLease(current, claim)) return undefined
      const renewed = ResourceClaimSchema.parse({
        ...current,
        lease: { ...current.lease, expiresAt: new Date(now + ttlMs).toISOString() },
        updatedAt: new Date(now).toISOString()
      })
      this.db.prepare('UPDATE resource_claims SET payload = ? WHERE resource_key = ? AND claim_id = ?')
        .run(encode(renewed), renewed.resourceKey, renewed.claimId)
      return renewed
    })
    return transaction.immediate()
  }

  async releaseResourceClaim(rawClaim: ResourceClaim): Promise<void> {
    const claim = parseOrCorrupt(ResourceClaimSchema, rawClaim, 'invalid resource claim')
    const transaction = this.db.transaction(() => {
      const row = this.db.prepare('SELECT payload FROM resource_claims WHERE resource_key = ? AND claim_id = ?')
        .get(claim.resourceKey, claim.claimId) as PayloadRow | undefined
      const current = row
        ? parsePayload(ResourceClaimSchema, row.payload, `corrupt resource claim ${claim.claimId}`)
        : undefined
      if (!current || current.status !== 'active' || !sameResourceClaimLease(current, claim)) {
        throw new EngineStoreConflictError(`resource claim ${claim.claimId} rejected by stale token or fence`)
      }
      const released = ResourceClaimSchema.parse({ ...current, status: 'released', updatedAt: new Date().toISOString() })
      this.db.prepare('UPDATE resource_claims SET status = ?, payload = ? WHERE resource_key = ? AND claim_id = ?')
        .run(released.status, encode(released), released.resourceKey, released.claimId)
    })
    transaction.immediate()
  }

  async loadOutboxIntent(workId: string): Promise<EngineOutboxRecord | undefined> {
    const row = this.db.prepare('SELECT payload, claim_payload FROM engine_outbox WHERE work_id = ?')
      .get(workId) as StoredOutboxRow | undefined
    return row ? parseStoredOutbox(row, `corrupt outbox intent ${workId}`) : undefined
  }

  async listOutboxIntents(scope: TaskScope): Promise<EngineOutboxRecord[]> {
    const parsedScope = parseOrCorrupt(TaskScopeSchema, scope, 'invalid task scope')
    const rows = this.db.prepare(`
      SELECT payload, claim_payload FROM engine_outbox
      WHERE owner_id = ? AND workspace_id = ? AND task_id = ?
      ORDER BY created_at, work_id
    `).all(...scopeParams(parsedScope)) as StoredOutboxRow[]
    return rows.map((row) => parseStoredOutbox(row, 'corrupt outbox intent'))
  }

  async findLedger(rawQuery: LedgerQuery): Promise<ExecutionLedgerEntry[]> {
    const query = parseOrCorrupt(LedgerQuerySchema, rawQuery, 'invalid ledger query')
    const clauses = ['owner_id = ?', 'workspace_id = ?', 'task_id = ?']
    const params: unknown[] = [...scopeParams(query.scope)]
    addFilter(clauses, params, 'kind', query.kind)
    addFilter(clauses, params, 'operation_id', query.operationId)
    addFilter(clauses, params, 'kernel_run_id', query.kernelRunId)
    addFilter(clauses, params, 'logical_request_key', query.logicalRequestKey)
    addFilter(clauses, params, 'exact_fingerprint', query.exactFingerprint)
    addFilter(clauses, params, 'semantic_key', query.semanticKey)
    addFilter(clauses, params, 'status', query.status)
    const rows = this.db.prepare(`
      SELECT payload FROM execution_ledger
      WHERE ${clauses.join(' AND ')}
      ORDER BY created_at, operation_id
    `).all(...params) as PayloadRow[]
    return rows.map((row) => parsePayload(ExecutionLedgerEntrySchema, row.payload, 'corrupt execution ledger'))
  }

  async listCosts(scope: TaskScope): Promise<CostEntry[]> {
    const parsedScope = parseOrCorrupt(TaskScopeSchema, scope, 'invalid task scope')
    const rows = this.db.prepare(`
      SELECT payload FROM engine_costs
      WHERE owner_id = ? AND workspace_id = ? AND task_id = ? ORDER BY cost_id
    `).all(...scopeParams(parsedScope)) as PayloadRow[]
    return rows.map((row) => parsePayload(CostEntrySchema, row.payload, 'corrupt engine cost'))
  }

  async listValues(scope: TaskScope): Promise<ValueEvent[]> {
    const parsedScope = parseOrCorrupt(TaskScopeSchema, scope, 'invalid task scope')
    const rows = this.db.prepare(`
      SELECT payload FROM engine_values
      WHERE owner_id = ? AND workspace_id = ? AND task_id = ? ORDER BY value_id
    `).all(...scopeParams(parsedScope)) as PayloadRow[]
    return rows.map((row) => parsePayload(ValueEventSchema, row.payload, 'corrupt engine value'))
  }

  async readStream(streamId: string, afterSeq: number, limit: number): Promise<EngineStreamEvent[]> {
    assertNonnegativeInteger(afterSeq, 'afterSeq')
    if (!Number.isInteger(limit) || limit <= 0) throw new EngineStoreConflictError('limit must be a positive integer')
    const rows = this.db.prepare(`
      SELECT payload FROM engine_stream_events
      WHERE stream_id = ? AND seq > ? ORDER BY seq LIMIT ?
    `).all(streamId, afterSeq, limit) as PayloadRow[]
    return rows.map((row) => parsePayload(EngineStreamEventSchema, row.payload, `corrupt stream ${streamId}`))
  }

  async ackStream(streamId: string, subscriberId: string, throughSeq: number): Promise<void> {
    assertNonnegativeInteger(throughSeq, 'throughSeq')
    this.db.transaction(() => {
      const highWater = this.currentHighWater('engine_stream_counters', 'stream_id', streamId)
      if (throughSeq > highWater) throw new EngineStoreConflictError('stream acknowledgement exceeds high-water')
      const current = this.db.prepare(`
        SELECT through_seq FROM engine_stream_acks WHERE stream_id = ? AND subscriber_id = ?
      `).get(streamId, subscriberId) as AckRow | undefined
      if (current && throughSeq < current.through_seq) {
        throw new EngineStoreConflictError('stream acknowledgement cannot move backwards')
      }
      this.db.prepare(`
        INSERT INTO engine_stream_acks (stream_id, subscriber_id, through_seq)
        VALUES (?, ?, ?)
        ON CONFLICT(stream_id, subscriber_id) DO UPDATE SET through_seq = excluded.through_seq
      `).run(streamId, subscriberId, throughSeq)
    })()
  }

  async acquireLease(runId: string, holderId: string, ttlMs: number): Promise<EngineLease | undefined> {
    assertTtl(ttlMs)
    return this.db.transaction(() => {
      const now = Date.now()
      const current = this.db.prepare('SELECT payload, expires_at FROM engine_leases WHERE run_id = ?')
        .get(runId) as LeaseRow | undefined
      if (current && Date.parse(current.expires_at) > now) return undefined
      const fence = this.nextFence('engine_lease_fences', 'run_id', runId)
      const lease = EngineLeaseSchema.parse({
        runId,
        holderId,
        fence,
        token: randomUUID(),
        expiresAt: new Date(now + ttlMs).toISOString()
      })
      this.db.prepare(`
        INSERT INTO engine_leases (run_id, holder_id, fence, token, expires_at, payload)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id) DO UPDATE SET
          holder_id = excluded.holder_id,
          fence = excluded.fence,
          token = excluded.token,
          expires_at = excluded.expires_at,
          payload = excluded.payload
      `).run(runId, holderId, fence, lease.token, lease.expiresAt, encode(lease))
      return lease
    })()
  }

  async renewLease(runId: string, lease: EngineLease, ttlMs: number): Promise<EngineLease | undefined> {
    assertTtl(ttlMs)
    const parsed = parseOrCorrupt(EngineLeaseSchema, lease, 'invalid engine lease')
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT payload, expires_at FROM engine_leases WHERE run_id = ?')
        .get(runId) as LeaseRow | undefined
      if (!row || Date.parse(row.expires_at) <= Date.now()) return undefined
      const current = parsePayload(EngineLeaseSchema, row.payload, `corrupt lease ${runId}`)
      if (!sameLease(current, parsed)) return undefined
      const renewed = EngineLeaseSchema.parse({ ...current, expiresAt: new Date(Date.now() + ttlMs).toISOString() })
      this.db.prepare('UPDATE engine_leases SET expires_at = ?, payload = ? WHERE run_id = ?')
        .run(renewed.expiresAt, encode(renewed), runId)
      return renewed
    })()
  }

  async releaseLease(runId: string, lease: EngineLease): Promise<void> {
    const parsed = parseOrCorrupt(EngineLeaseSchema, lease, 'invalid engine lease')
    this.db.transaction(() => {
      const row = this.db.prepare('SELECT payload FROM engine_leases WHERE run_id = ?').get(runId) as PayloadRow | undefined
      if (!row || !sameLease(parsePayload(EngineLeaseSchema, row.payload, `corrupt lease ${runId}`), parsed)) {
        throw new EngineStoreConflictError('lease does not match active owner')
      }
      this.db.prepare('DELETE FROM engine_leases WHERE run_id = ?').run(runId)
    })()
  }

  async claimWork(workerId: string, kinds: readonly string[], ttlMs: number): Promise<WorkClaim | undefined> {
    assertTtl(ttlMs)
    if (kinds.length === 0) return undefined
    return this.db.transaction(() => {
      const now = new Date().toISOString()
      const placeholders = kinds.map(() => '?').join(', ')
      const row = this.db.prepare(`
        SELECT payload, kind, payload_ref, status, claim_payload
        FROM engine_outbox
        WHERE kind IN (${placeholders})
          AND available_at <= ?
          AND (status = 'pending' OR (status = 'claimed' AND claim_expires_at <= ?))
        ORDER BY available_at, work_id
        LIMIT 1
      `).get(...kinds, now, now) as OutboxRow | undefined
      if (!row) return undefined
      const intent = parsePayload(EngineOutboxIntentSchema, row.payload, 'corrupt outbox intent')
      const fence = this.nextFence('engine_work_fences', 'work_id', intent.workId)
      const lease = EngineLeaseSchema.parse({
        runId: `work:${intent.workId}`,
        holderId: workerId,
        fence,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + ttlMs).toISOString()
      })
      const claimedIntent = EngineOutboxIntentSchema.parse({ ...intent, status: 'claimed', updatedAt: now })
      this.db.prepare(`
        UPDATE engine_outbox SET status = 'claimed', updated_at = ?, payload = ?,
          claim_payload = ?, claim_expires_at = ?
        WHERE work_id = ?
      `).run(now, encode(claimedIntent), encode(lease), lease.expiresAt, intent.workId)
      return WorkClaimSchema.parse({
        workId: intent.workId,
        kind: row.kind,
        payloadRef: row.payload_ref,
        lease,
        payload: intent.payload
      })
    })()
  }

  async renewWorkClaim(workId: string, lease: EngineLease, ttlMs: number): Promise<EngineLease | undefined> {
    assertTtl(ttlMs)
    const parsed = parseOrCorrupt(EngineLeaseSchema, lease, 'invalid work claim')
    return this.db.transaction(() => {
      const row = this.db.prepare(`
        SELECT payload, claim_payload, claim_expires_at FROM engine_outbox WHERE work_id = ?
      `).get(workId) as (StoredOutboxRow & { claim_expires_at: string | null }) | undefined
      if (!row?.claim_payload || !row.claim_expires_at || Date.parse(row.claim_expires_at) <= Date.now()) {
        return undefined
      }
      const intent = parsePayload(EngineOutboxIntentSchema, row.payload, `corrupt outbox intent ${workId}`)
      const current = parsePayload(EngineLeaseSchema, row.claim_payload, `corrupt work claim ${workId}`)
      if (intent.status !== 'claimed' || !sameLease(current, parsed)) return undefined
      const now = new Date().toISOString()
      const renewed = EngineLeaseSchema.parse({ ...current, expiresAt: new Date(Date.now() + ttlMs).toISOString() })
      const updated = EngineOutboxIntentSchema.parse({ ...intent, updatedAt: now })
      this.db.prepare(`
        UPDATE engine_outbox SET updated_at = ?, payload = ?, claim_payload = ?, claim_expires_at = ?
        WHERE work_id = ?
      `).run(now, encode(updated), encode(renewed), renewed.expiresAt, workId)
      return renewed
    })()
  }

  private commitTransaction(input: ParsedEngineCommit): EngineCommitResult {
    this.assertExpectedVersions(input)
    this.assertLeaseFence(input)
    this.applyGraphRevisions(input)
    this.applyGraphRun(input)
    this.applyWorkGraphEvents(input)
    this.applyTaskModelPolicy(input)
    this.applyHumanCheckpoints(input)
    this.applyResourceClaims(input)
    this.applyRun(input)
    this.applyTask(input)
    this.applyContext(input)
    this.applyLedger(input)
    this.applyEvents(input)
    const streamHighWater = this.applyStreamEvents(input)
    this.applyOutbox(input)
    this.applyCosts(input)
    this.applyValues(input)
    this.applyBudgetReservations(input)

    return EngineCommitResultSchema.parse({
      runVersion: this.currentRunVersion(input.runId),
      taskRevision: this.currentTaskRevision(input.scope),
      eventHighWater: this.currentHighWater('engine_event_counters', 'run_id', input.runId),
      streamHighWater
    })
  }

  private assertExpectedVersions(input: ParsedEngineCommit): void {
    const runVersion = this.currentRunVersion(input.runId)
    if (input.expectedRunVersion !== runVersion) {
      throw new EngineStoreConflictError(`run version mismatch: expected ${input.expectedRunVersion}, actual ${runVersion}`)
    }
    const taskRevision = this.currentTaskRevision(input.scope)
    if (input.expectedTaskRevision !== taskRevision) {
      throw new EngineStoreConflictError(
        `task revision mismatch: expected ${input.expectedTaskRevision}, actual ${taskRevision}`
      )
    }
    if (input.expectedModelPolicyRevision !== undefined) {
      const policyRevision = this.currentModelPolicyRevision(input.scope)
      if (input.expectedModelPolicyRevision !== policyRevision) {
        throw new EngineStoreConflictError(
          `model policy revision mismatch: expected ${input.expectedModelPolicyRevision}, actual ${policyRevision}`
        )
      }
    }
  }

  private applyGraphRevisions(input: ParsedEngineCommit): void {
    for (const mutation of input.graphRevisionMutations) {
      const graphId = mutation.type === 'put' ? mutation.record.graphId : mutation.graphId
      const revision = mutation.type === 'put' ? mutation.record.revision : mutation.revision
      if (mutation.type === 'delete') {
        this.db.prepare('DELETE FROM graph_revisions WHERE graph_id = ? AND revision = ?').run(graphId, revision)
        continue
      }
      const row = this.db.prepare('SELECT payload FROM graph_revisions WHERE graph_id = ? AND revision = ?')
        .get(graphId, revision) as PayloadRow | undefined
      if (row) {
        const existing = parsePayload(GraphRevisionSchema, row.payload, `corrupt graph revision ${graphId}:${revision}`)
        if (!sameRecord(existing, mutation.record)) {
          throw new EngineStoreConflictError(`graph revision ${graphId}:${revision} is immutable`)
        }
        continue
      }
      this.db.prepare(`
        INSERT INTO graph_revisions (graph_id, revision, graph_digest, payload) VALUES (?, ?, ?, ?)
      `).run(graphId, revision, mutation.record.graphDigest, encode(mutation.record))
    }
  }

  private applyGraphRun(input: ParsedEngineCommit): void {
    const mutation = input.graphRunMutation
    if (!mutation) return
    if (mutation.type === 'delete') {
      if (mutation.recordId !== input.runId) throw new EngineStoreCorruptError('graph run delete targets another run')
      this.db.prepare('DELETE FROM graph_runs WHERE run_id = ?').run(input.runId)
      return
    }
    assertSameScope(input.scope, mutation.record.scope, 'graph run')
    if (mutation.record.runId !== input.runId) throw new EngineStoreCorruptError('graph run mutation targets another run')
    const assignedVersion = input.expectedRunVersion + 1
    if (mutation.record.version !== assignedVersion) {
      throw new EngineStoreConflictError(`graph run mutation must use assigned version ${assignedVersion}`)
    }
    this.db.prepare(`
      INSERT INTO graph_runs
        (run_id, owner_id, workspace_id, task_id, graph_id, graph_revision, version, status, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET
        owner_id = excluded.owner_id,
        workspace_id = excluded.workspace_id,
        task_id = excluded.task_id,
        graph_id = excluded.graph_id,
        graph_revision = excluded.graph_revision,
        version = excluded.version,
        status = excluded.status,
        payload = excluded.payload
    `).run(
      mutation.record.runId,
      ...scopeParams(input.scope),
      mutation.record.graphId,
      mutation.record.graphRevision,
      mutation.record.version,
      mutation.record.status,
      encode(mutation.record)
    )
  }

  private applyWorkGraphEvents(input: ParsedEngineCommit): void {
    for (const mutation of input.workGraphEvents) {
      assertSameScope(input.scope, mutation.record.scope, 'work graph event')
      if (mutation.record.runId !== input.runId) throw new EngineStoreCorruptError('work graph event targets another run')
      const existingRow = this.db.prepare('SELECT payload FROM work_graph_events WHERE run_id = ? AND event_id = ?')
        .get(input.runId, mutation.record.eventId) as PayloadRow | undefined
      if (existingRow) {
        const existing = parsePayload(
          WorkGraphEventRecordSchema,
          existingRow.payload,
          `corrupt work graph event ${mutation.record.eventId}`
        )
        const { seq: _seq, ...existingInput } = existing
        if (!sameRecord(existingInput, mutation.record)) {
          throw new EngineStoreConflictError(`work graph event ${mutation.record.eventId} already exists with different data`)
        }
        continue
      }
      const seq = this.nextHighWater('work_graph_event_counters', 'run_id', input.runId)
      const record = WorkGraphEventRecordSchema.parse({ ...mutation.record, seq })
      this.db.prepare(`
        INSERT INTO work_graph_events (run_id, seq, event_id, kind, timestamp, payload)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(input.runId, seq, record.eventId, record.kind, record.timestamp, encode(record))
    }
  }

  private applyTaskModelPolicy(input: ParsedEngineCommit): void {
    const mutation = input.taskModelPolicyMutation
    if (!mutation) return
    if (mutation.type === 'delete') {
      this.db.prepare(`
        DELETE FROM task_model_policies WHERE owner_id = ? AND workspace_id = ? AND task_id = ?
      `).run(...scopeParams(input.scope))
      return
    }
    assertSameScope(input.scope, mutation.record.scope, 'task model policy')
    const assignedRevision = (input.expectedModelPolicyRevision ?? 0) + 1
    if (mutation.record.revision !== assignedRevision) {
      throw new EngineStoreConflictError(`model policy mutation must use assigned revision ${assignedRevision}`)
    }
    this.db.prepare(`
      INSERT INTO task_model_policies (owner_id, workspace_id, task_id, revision, payload)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(owner_id, workspace_id, task_id) DO UPDATE SET
        revision = excluded.revision,
        payload = excluded.payload
    `).run(...scopeParams(input.scope), mutation.record.revision, encode(mutation.record))
  }

  private applyHumanCheckpoints(input: ParsedEngineCommit): void {
    for (const mutation of input.humanCheckpointMutations) {
      if (mutation.type === 'delete') {
        this.db.prepare('DELETE FROM human_checkpoints WHERE checkpoint_id = ?').run(mutation.recordId)
        continue
      }
      if (mutation.type !== 'put') {
        const row = this.db.prepare('SELECT payload FROM human_checkpoints WHERE checkpoint_id = ?')
          .get(mutation.recordId) as PayloadRow | undefined
        if (!row) throw new EngineStoreConflictError(`checkpoint ${mutation.recordId} does not exist`)
        const current = parsePayload(HumanCheckpointSchema, row.payload, `corrupt checkpoint ${mutation.recordId}`)
        assertSameScope(input.scope, current.scope, 'human checkpoint')
        const next = applyHumanCheckpointMutation(current, mutation)
        this.db.prepare('UPDATE human_checkpoints SET status = ?, payload = ? WHERE checkpoint_id = ?')
          .run(next.status, encode(next), mutation.recordId)
        continue
      }
      assertSameScope(input.scope, mutation.record.scope, 'human checkpoint')
      const row = this.db.prepare('SELECT payload FROM human_checkpoints WHERE checkpoint_id = ?')
        .get(mutation.record.checkpointId) as PayloadRow | undefined
      if (row) {
        const existing = parsePayload(HumanCheckpointSchema, row.payload, `corrupt checkpoint ${mutation.record.checkpointId}`)
        if (!sameRecord(existing, mutation.record)) {
          throw new EngineStoreConflictError(`checkpoint ${mutation.record.checkpointId} already exists with different data`)
        }
        continue
      }
      this.db.prepare(`
        INSERT INTO human_checkpoints
          (checkpoint_id, owner_id, workspace_id, task_id, run_id, status, resolution_token, payload)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        mutation.record.checkpointId,
        ...scopeParams(input.scope),
        mutation.record.runId,
        mutation.record.status,
        mutation.record.resolutionToken,
        encode(mutation.record)
      )
    }
  }

  private applyResourceClaims(input: ParsedEngineCommit): void {
    for (const mutation of input.resourceClaimMutations) {
      const resourceKey = mutation.type === 'put' ? mutation.record.resourceKey : mutation.resourceKey
      const claimId = mutation.type === 'put' ? mutation.record.claimId : mutation.claimId
      if (mutation.type === 'delete') {
        this.db.prepare('DELETE FROM resource_claims WHERE resource_key = ? AND claim_id = ?').run(resourceKey, claimId)
        continue
      }
      assertSameScope(input.scope, mutation.record.scope, 'resource claim')
      this.db.prepare(`
        INSERT INTO resource_claims
          (resource_key, claim_id, owner_id, workspace_id, task_id, status, payload)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(resource_key, claim_id) DO UPDATE SET
          owner_id = excluded.owner_id,
          workspace_id = excluded.workspace_id,
          task_id = excluded.task_id,
          status = excluded.status,
          payload = excluded.payload
      `).run(resourceKey, claimId, ...scopeParams(input.scope), mutation.record.status, encode(mutation.record))
    }
  }

  private assertLeaseFence(input: ParsedEngineCommit): void {
    const latest = this.db.prepare('SELECT fence FROM engine_lease_fences WHERE run_id = ?').get(input.runId) as FenceRow | undefined
    if (latest && input.leaseFence !== latest.fence) {
      throw new EngineStoreConflictError(`stale lease fence for run ${input.runId}`)
    }
    const active = this.db.prepare('SELECT payload, expires_at FROM engine_leases WHERE run_id = ?')
      .get(input.runId) as LeaseRow | undefined
    if (active && Date.parse(active.expires_at) > Date.now()) {
      const lease = parsePayload(EngineLeaseSchema, active.payload, `corrupt lease ${input.runId}`)
      if (input.leaseFence !== lease.fence) {
        throw new EngineStoreConflictError(`commit does not own the active lease for run ${input.runId}`)
      }
    }
  }

  private applyRun(input: ParsedEngineCommit): void {
    const mutation = input.runMutation
    if (!mutation) return
    if (mutation.type === 'delete') {
      if (mutation.recordId !== input.runId) throw new EngineStoreCorruptError('run delete targets another run')
      this.db.prepare('DELETE FROM engine_runs WHERE run_id = ?').run(input.runId)
      return
    }
    assertSameScope(input.scope, mutation.record.scope, 'run')
    if (mutation.record.runId !== input.runId) throw new EngineStoreCorruptError('run mutation targets another run')
    const assignedVersion = input.expectedRunVersion + 1
    if (mutation.record.version !== assignedVersion) {
      throw new EngineStoreConflictError(`run mutation must use assigned version ${assignedVersion}`)
    }
    this.db.prepare(`
      INSERT INTO engine_runs (run_id, owner_id, workspace_id, task_id, version, status, desired_state, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET
        owner_id = excluded.owner_id,
        workspace_id = excluded.workspace_id,
        task_id = excluded.task_id,
        version = excluded.version,
        status = excluded.status,
        desired_state = excluded.desired_state,
        payload = excluded.payload
    `).run(
      mutation.record.runId,
      ...scopeParams(input.scope),
      mutation.record.version,
      mutation.record.status,
      mutation.record.desiredState,
      encode(mutation.record)
    )
  }

  private applyTask(input: ParsedEngineCommit): void {
    const mutation = input.taskCheckpointMutation
    if (!mutation) return
    if (mutation.type === 'delete') {
      if (mutation.recordId !== encodeScope(input.scope)) {
        throw new EngineStoreCorruptError('task delete requires its encoded task scope')
      }
      this.db.prepare(`
        DELETE FROM task_checkpoints WHERE owner_id = ? AND workspace_id = ? AND task_id = ?
      `).run(...scopeParams(input.scope))
      return
    }
    assertSameScope(input.scope, mutation.record.scope, 'task checkpoint')
    const assignedRevision = input.expectedTaskRevision + 1
    if (mutation.record.revision !== assignedRevision) {
      throw new EngineStoreConflictError(`task mutation must use assigned revision ${assignedRevision}`)
    }
    this.db.prepare(`
      INSERT INTO task_checkpoints (owner_id, workspace_id, task_id, revision, status, payload)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(owner_id, workspace_id, task_id) DO UPDATE SET
        revision = excluded.revision,
        status = excluded.status,
        payload = excluded.payload
    `).run(...scopeParams(input.scope), mutation.record.revision, mutation.record.status, encode(mutation.record))
  }

  private applyContext(input: ParsedEngineCommit): void {
    const mutation = input.contextCheckpointMutation
    if (!mutation) return
    if (mutation.type === 'delete') {
      this.db.prepare(`
        DELETE FROM context_checkpoints
        WHERE owner_id = ? AND workspace_id = ? AND task_id = ? AND context_id = ?
      `).run(...scopeParams(input.scope), mutation.recordId)
      return
    }
    assertSameScope(input.scope, mutation.record.scope, 'context checkpoint')
    this.db.prepare(`
      INSERT INTO context_checkpoints
        (owner_id, workspace_id, task_id, context_id, revision, payload)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(owner_id, workspace_id, task_id, context_id) DO UPDATE SET
        revision = excluded.revision,
        payload = excluded.payload
    `).run(
      ...scopeParams(input.scope),
      mutation.record.contextId,
      mutation.record.revision,
      encode(mutation.record)
    )
  }

  private applyLedger(input: ParsedEngineCommit): void {
    for (const mutation of input.ledgerMutations) {
      const operationId = mutation.type === 'delete' ? mutation.recordId : mutation.record.operationId
      const key = [...scopeParams(input.scope), operationId]
      if (mutation.type === 'delete') {
        this.db.prepare(`
          DELETE FROM execution_ledger
          WHERE owner_id = ? AND workspace_id = ? AND task_id = ? AND operation_id = ?
        `).run(...key)
        continue
      }
      assertSameScope(input.scope, mutation.record.scope, 'ledger')
      const existing = this.db.prepare(`
        SELECT payload FROM execution_ledger
        WHERE owner_id = ? AND workspace_id = ? AND task_id = ? AND operation_id = ?
      `).get(...key) as PayloadRow | undefined
      if (mutation.type === 'append' && existing) {
        const parsed = parsePayload(ExecutionLedgerEntrySchema, existing.payload, `corrupt ledger ${operationId}`)
        if (!sameRecord(parsed, mutation.record)) {
          throw new EngineStoreConflictError(`operation ${operationId} already exists with different data`)
        }
        continue
      }
      const record = mutation.record
      this.db.prepare(`
        INSERT INTO execution_ledger
          (owner_id, workspace_id, task_id, operation_id, kind, kernel_run_id,
           logical_request_key, exact_fingerprint, semantic_key, status, created_at, payload)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner_id, workspace_id, task_id, operation_id) DO UPDATE SET
          kind = excluded.kind,
          kernel_run_id = excluded.kernel_run_id,
          logical_request_key = excluded.logical_request_key,
          exact_fingerprint = excluded.exact_fingerprint,
          semantic_key = excluded.semantic_key,
          status = excluded.status,
          created_at = excluded.created_at,
          payload = excluded.payload
      `).run(
        ...scopeParams(input.scope),
        operationId,
        record.kind,
        record.kernelRunId,
        record.kind === 'model' ? record.logicalRequestKey : null,
        record.kind === 'tool' ? record.exactFingerprint : null,
        record.kind === 'tool' ? record.semanticKey : null,
        record.status,
        record.createdAt,
        encode(record)
      )
    }
  }

  private applyEvents(input: ParsedEngineCommit): void {
    for (const mutation of input.events) {
      assertSameScope(input.scope, mutation.record.scope, 'event')
      if (mutation.record.runId !== input.runId) throw new EngineStoreCorruptError('event targets another run')
      const existing = this.db.prepare(`
        SELECT payload FROM engine_events WHERE run_id = ? AND event_id = ?
      `).get(input.runId, mutation.record.eventId) as PayloadRow | undefined
      if (existing) {
        const record = parsePayload(EngineEventRecordSchema, existing.payload, `corrupt event ${mutation.record.eventId}`)
        const { seq: _seq, ...eventInput } = record
        if (!sameRecord(eventInput, mutation.record)) {
          throw new EngineStoreConflictError(`event ${mutation.record.eventId} already exists with different data`)
        }
        continue
      }
      const seq = this.nextHighWater('engine_event_counters', 'run_id', input.runId)
      const record = EngineEventRecordSchema.parse({ ...mutation.record, seq })
      this.db.prepare(`
        INSERT INTO engine_events (run_id, seq, event_id, kind, timestamp, payload)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(input.runId, seq, record.eventId, record.kind, record.timestamp, encode(record))
    }
  }

  private applyStreamEvents(input: ParsedEngineCommit): number {
    let highWater = 0
    for (const mutation of input.streamEvents) {
      assertSameScope(input.scope, mutation.record.scope, 'stream event')
      const seq = this.nextHighWater('engine_stream_counters', 'stream_id', mutation.record.streamId)
      const record = EngineStreamEventSchema.parse({ ...mutation.record, seq })
      this.db.prepare(`
        INSERT INTO engine_stream_events
          (stream_id, seq, owner_id, workspace_id, task_id, channel, kind, timestamp, payload)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.streamId,
        record.seq,
        ...scopeParams(record.scope),
        record.channel,
        record.kind,
        record.timestamp,
        encode(record)
      )
      highWater = Math.max(highWater, seq)
    }
    return highWater
  }

  private applyOutbox(input: ParsedEngineCommit): void {
    for (const mutation of input.outboxIntents) {
      if (mutation.type === 'delete') {
        this.db.prepare('DELETE FROM engine_outbox WHERE work_id = ?').run(mutation.recordId)
        continue
      }
      if (mutation.type === 'complete') {
        const row = this.db.prepare('SELECT payload, claim_payload FROM engine_outbox WHERE work_id = ?')
          .get(mutation.recordId) as StoredOutboxRow | undefined
        if (!row) throw new EngineStoreConflictError(`work ${mutation.recordId} does not exist`)
        const existing = parsePayload(EngineOutboxIntentSchema, row.payload, `corrupt work ${mutation.recordId}`)
        const activeClaim = row.claim_payload
          ? parsePayload(EngineLeaseSchema, row.claim_payload, `corrupt work claim ${mutation.recordId}`)
          : undefined
        if (mutation.claim && (!activeClaim || !sameLease(activeClaim, mutation.claim))) {
          throw new EngineStoreConflictError(`work ${mutation.recordId} completion rejected by stale claim`)
        }
        if (existing.status === 'completed') {
          if (mutation.payload !== undefined && !sameRecord(existing.payload, mutation.payload)) {
            throw new EngineStoreConflictError(`work ${mutation.recordId} already completed differently`)
          }
          continue
        }
        const now = new Date().toISOString()
        const completed = EngineOutboxIntentSchema.parse({
          ...existing,
          status: 'completed',
          completedAt: now,
          updatedAt: now,
          ...(mutation.payload !== undefined ? { payload: mutation.payload } : {})
        })
        this.db.prepare(`
          UPDATE engine_outbox SET status = 'completed', updated_at = ?, completed_at = ?,
            payload = ?, claim_payload = NULL, claim_expires_at = NULL WHERE work_id = ?
        `).run(now, now, encode(completed), mutation.recordId)
        continue
      }
      assertSameScope(input.scope, mutation.record.scope, 'outbox')
      const existing = this.db.prepare('SELECT payload FROM engine_outbox WHERE work_id = ?')
        .get(mutation.record.workId) as PayloadRow | undefined
      if (existing) {
        const parsed = parsePayload(EngineOutboxIntentSchema, existing.payload, `corrupt work ${mutation.record.workId}`)
        if (!sameOutboxIdentity(parsed, mutation.record)) {
          throw new EngineStoreConflictError(`work ${mutation.record.workId} already exists with different data`)
        }
        continue
      }
      const record = mutation.record
      this.db.prepare(`
        INSERT INTO engine_outbox
          (work_id, owner_id, workspace_id, task_id, kind, payload_ref, status,
           available_at, created_at, updated_at, completed_at, payload)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.workId,
        ...scopeParams(input.scope),
        record.kind,
        record.payloadRef,
        record.status,
        record.availableAt,
        record.createdAt,
        record.updatedAt,
        record.completedAt ?? null,
        encode(record)
      )
    }
  }

  private applyCosts(input: ParsedEngineCommit): void {
    for (const mutation of input.costMutations) {
      const costId = mutation.type === 'delete' ? mutation.recordId : mutation.record.costId
      const key = [...scopeParams(input.scope), costId]
      if (mutation.type === 'delete') {
        this.db.prepare(`
          DELETE FROM engine_costs WHERE owner_id = ? AND workspace_id = ? AND task_id = ? AND cost_id = ?
        `).run(...key)
        continue
      }
      assertSameScope(input.scope, mutation.record.scope, 'cost')
      this.appendIdempotent('engine_costs', 'cost_id', key, CostEntrySchema, mutation.record, `cost ${costId}`)
    }
  }

  private applyValues(input: ParsedEngineCommit): void {
    for (const mutation of input.valueMutations) {
      const valueId = mutation.type === 'delete' ? mutation.recordId : mutation.record.valueId
      const key = [...scopeParams(input.scope), valueId]
      if (mutation.type === 'delete') {
        this.db.prepare(`
          DELETE FROM engine_values WHERE owner_id = ? AND workspace_id = ? AND task_id = ? AND value_id = ?
        `).run(...key)
        continue
      }
      assertSameScope(input.scope, mutation.record.scope, 'value')
      this.appendIdempotent('engine_values', 'value_id', key, ValueEventSchema, mutation.record, `value ${valueId}`)
    }
  }

  private applyBudgetReservations(input: ParsedEngineCommit): void {
    for (const mutation of input.budgetReservationMutations) {
      const reservationId = mutation.type === 'reserve' ? mutation.record.reservationId : mutation.recordId
      const key = [...scopeParams(input.scope), reservationId]
      if (mutation.type === 'reserve') {
        assertSameScope(input.scope, mutation.record.scope, 'budget reservation')
        const existing = this.db.prepare(`
          SELECT payload FROM engine_budget_reservations
          WHERE owner_id = ? AND workspace_id = ? AND task_id = ? AND reservation_id = ?
        `).get(...key) as PayloadRow | undefined
        if (existing) {
          if (!sameRecord(parsePayload(BudgetReservationRecordSchema, existing.payload, `corrupt reservation ${reservationId}`), mutation.record)) {
            throw new EngineStoreConflictError(`reservation ${reservationId} already exists with different data`)
          }
          continue
        }
        const parent = this.db.prepare('SELECT payload FROM engine_runs WHERE run_id = ?').get(mutation.record.parentRunId) as PayloadRow | undefined
        const parentRecord = parent ? parsePayload(EngineRunRecordSchema, parent.payload, `corrupt parent run ${mutation.record.parentRunId}`) : undefined
        if (!parentRecord?.budgetLimits) throw new EngineStoreConflictError(`parent run ${mutation.record.parentRunId} has no budget limits`)
        const reservationRows = this.db.prepare(`
          SELECT payload FROM engine_budget_reservations WHERE parent_run_id = ?
        `).all(mutation.record.parentRunId) as PayloadRow[]
        const committed = reservationRows
          .map((row) => parsePayload(BudgetReservationRecordSchema, row.payload, 'corrupt budget reservation'))
          .reduce((total, record) => addBudget(total, committedReservationBudget(record)), zeroBudget())
        assertWithinBudget(addBudget(committed, mutation.record.reserved), parentRecord.budgetLimits)
        this.db.prepare(`
          INSERT INTO engine_budget_reservations
            (owner_id, workspace_id, task_id, reservation_id, parent_run_id, child_run_id, status, payload)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(...key, mutation.record.parentRunId, mutation.record.childRunId, mutation.record.status, encode(mutation.record))
      } else {
        const existing = this.db.prepare(`
          SELECT payload FROM engine_budget_reservations
          WHERE owner_id = ? AND workspace_id = ? AND task_id = ? AND reservation_id = ?
        `).get(...key) as PayloadRow | undefined
        if (!existing) throw new EngineStoreConflictError(`reservation ${reservationId} does not exist`)
        const record = parsePayload(BudgetReservationRecordSchema, existing.payload, `corrupt reservation ${reservationId}`)
        if (mutation.type === 'settle' && record.status === 'settled' && record.actual
          && !sameRecord(record.actual, mutation.actual)) {
          throw new EngineStoreConflictError(`reservation ${reservationId} already settled differently`)
        }
        const next = mutation.type === 'settle'
          ? { ...record, status: 'settled' as const, actual: mutation.actual, updatedAt: mutation.updatedAt }
          : { ...record, status: 'released' as const, updatedAt: mutation.updatedAt }
        this.db.prepare(`
          UPDATE engine_budget_reservations SET status = ?, payload = ?
          WHERE owner_id = ? AND workspace_id = ? AND task_id = ? AND reservation_id = ?
        `).run(next.status, encode(next), ...key)
      }
    }
  }

  private appendIdempotent<T>(
    table: 'engine_costs' | 'engine_values',
    idColumn: 'cost_id' | 'value_id',
    key: unknown[],
    schema: { parse(value: unknown): T },
    record: T,
    label: string
  ): void {
    const row = this.db.prepare(`
      SELECT payload FROM ${table}
      WHERE owner_id = ? AND workspace_id = ? AND task_id = ? AND ${idColumn} = ?
    `).get(...key) as PayloadRow | undefined
    if (row) {
      const existing = parsePayload(schema, row.payload, `corrupt ${label}`)
      if (!sameRecord(existing, record)) throw new EngineStoreConflictError(`${label} already exists with different data`)
      return
    }
    this.db.prepare(`
      INSERT INTO ${table} (owner_id, workspace_id, task_id, ${idColumn}, payload)
      VALUES (?, ?, ?, ?, ?)
    `).run(...key, encode(record))
  }

  private currentRunVersion(runId: string): number {
    const engine = this.db.prepare('SELECT version FROM engine_runs WHERE run_id = ?').get(runId) as VersionRow | undefined
    const graph = this.db.prepare('SELECT version FROM graph_runs WHERE run_id = ?').get(runId) as VersionRow | undefined
    if (engine && graph && engine.version !== graph.version) {
      throw new EngineStoreCorruptError(`engine and graph run versions diverged for ${runId}`)
    }
    return engine?.version ?? graph?.version ?? 0
  }

  private currentTaskRevision(scope: TaskScope): number {
    const row = this.db.prepare(`
      SELECT revision FROM task_checkpoints
      WHERE owner_id = ? AND workspace_id = ? AND task_id = ?
    `).get(...scopeParams(scope)) as RevisionRow | undefined
    return row?.revision ?? 0
  }

  private currentModelPolicyRevision(scope: TaskScope): number {
    const row = this.db.prepare(`
      SELECT revision FROM task_model_policies
      WHERE owner_id = ? AND workspace_id = ? AND task_id = ?
    `).get(...scopeParams(scope)) as RevisionRow | undefined
    return row?.revision ?? 0
  }

  private currentHighWater(table: string, keyColumn: string, key: string): number {
    const row = this.db.prepare(`SELECT high_water FROM ${table} WHERE ${keyColumn} = ?`).get(key) as HighWaterRow | undefined
    return row?.high_water ?? 0
  }

  private nextHighWater(table: string, keyColumn: string, key: string): number {
    const row = this.db.prepare(`
      INSERT INTO ${table} (${keyColumn}, high_water) VALUES (?, 1)
      ON CONFLICT(${keyColumn}) DO UPDATE SET high_water = high_water + 1
      RETURNING high_water
    `).get(key) as HighWaterRow
    return row.high_water
  }

  private nextFence(table: string, keyColumn: string, key: string): number {
    const row = this.db.prepare(`
      INSERT INTO ${table} (${keyColumn}, fence) VALUES (?, 1)
      ON CONFLICT(${keyColumn}) DO UPDATE SET fence = fence + 1
      RETURNING fence
    `).get(key) as FenceRow
    return row.fence
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS engine_runs (
        run_id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        status TEXT NOT NULL,
        desired_state TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS engine_runs_scope_idx
        ON engine_runs(owner_id, workspace_id, task_id);

      CREATE TABLE IF NOT EXISTS graph_revisions (
        graph_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        graph_digest TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY(graph_id, revision)
      );
      CREATE TABLE IF NOT EXISTS graph_runs (
        run_id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        graph_id TEXT NOT NULL,
        graph_revision INTEGER NOT NULL,
        version INTEGER NOT NULL,
        status TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS graph_runs_scope_idx
        ON graph_runs(owner_id, workspace_id, task_id);
      CREATE TABLE IF NOT EXISTS work_graph_event_counters (
        run_id TEXT PRIMARY KEY,
        high_water INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS work_graph_events (
        run_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        event_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY(run_id, seq),
        UNIQUE(run_id, event_id)
      );
      CREATE TABLE IF NOT EXISTS task_model_policies (
        owner_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY(owner_id, workspace_id, task_id)
      );
      CREATE TABLE IF NOT EXISTS human_checkpoints (
        checkpoint_id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        status TEXT NOT NULL,
        resolution_token TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS human_checkpoints_run_idx
        ON human_checkpoints(run_id, status);
      CREATE TABLE IF NOT EXISTS resource_claims (
        resource_key TEXT NOT NULL,
        claim_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        status TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY(resource_key, claim_id)
      );
      CREATE INDEX IF NOT EXISTS resource_claims_status_idx
        ON resource_claims(resource_key, status);

      CREATE TABLE IF NOT EXISTS task_checkpoints (
        owner_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        status TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY(owner_id, workspace_id, task_id)
      );

      CREATE TABLE IF NOT EXISTS context_checkpoints (
        owner_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        context_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY(owner_id, workspace_id, task_id, context_id)
      );

      CREATE TABLE IF NOT EXISTS execution_ledger (
        owner_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        kernel_run_id TEXT NOT NULL,
        logical_request_key TEXT,
        exact_fingerprint TEXT,
        semantic_key TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY(owner_id, workspace_id, task_id, operation_id)
      );
      CREATE INDEX IF NOT EXISTS engine_ledger_query_idx
        ON execution_ledger(owner_id, workspace_id, task_id, kind, status);
      CREATE INDEX IF NOT EXISTS engine_ledger_model_idx
        ON execution_ledger(owner_id, workspace_id, task_id, logical_request_key);
      CREATE INDEX IF NOT EXISTS engine_ledger_tool_idx
        ON execution_ledger(owner_id, workspace_id, task_id, exact_fingerprint, semantic_key);

      CREATE TABLE IF NOT EXISTS task_memories (
        owner_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        memory_id TEXT NOT NULL,
        namespace TEXT NOT NULL,
        revision INTEGER NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY(owner_id, workspace_id, task_id, memory_id)
      );

      CREATE TABLE IF NOT EXISTS engine_event_counters (
        run_id TEXT PRIMARY KEY,
        high_water INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS engine_events (
        run_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        event_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY(run_id, seq),
        UNIQUE(run_id, event_id)
      );

      CREATE TABLE IF NOT EXISTS engine_stream_counters (
        stream_id TEXT PRIMARY KEY,
        high_water INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS engine_stream_events (
        stream_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        owner_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        kind TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY(stream_id, seq)
      );
      CREATE INDEX IF NOT EXISTS engine_stream_scope_idx
        ON engine_stream_events(owner_id, workspace_id, task_id);
      CREATE TABLE IF NOT EXISTS engine_stream_acks (
        stream_id TEXT NOT NULL,
        subscriber_id TEXT NOT NULL,
        through_seq INTEGER NOT NULL,
        PRIMARY KEY(stream_id, subscriber_id)
      );

      CREATE TABLE IF NOT EXISTS engine_outbox (
        work_id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload_ref TEXT NOT NULL,
        status TEXT NOT NULL,
        available_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        claim_payload TEXT,
        claim_expires_at TEXT,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS engine_outbox_claim_idx
        ON engine_outbox(status, kind, available_at, claim_expires_at);

      CREATE TABLE IF NOT EXISTS engine_costs (
        owner_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        cost_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY(owner_id, workspace_id, task_id, cost_id)
      );
      CREATE TABLE IF NOT EXISTS engine_values (
        owner_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        value_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY(owner_id, workspace_id, task_id, value_id)
      );
      CREATE TABLE IF NOT EXISTS engine_budget_reservations (
        owner_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        reservation_id TEXT NOT NULL,
        parent_run_id TEXT NOT NULL,
        child_run_id TEXT NOT NULL,
        status TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY(owner_id, workspace_id, task_id, reservation_id)
      );
      CREATE INDEX IF NOT EXISTS engine_budget_reservations_parent_idx
        ON engine_budget_reservations(parent_run_id, status);

      CREATE TABLE IF NOT EXISTS engine_lease_fences (
        run_id TEXT PRIMARY KEY,
        fence INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS engine_leases (
        run_id TEXT PRIMARY KEY,
        holder_id TEXT NOT NULL,
        fence INTEGER NOT NULL,
        token TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS engine_work_fences (
        work_id TEXT PRIMARY KEY,
        fence INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS worker_inbox (
        work_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        available_at TEXT NOT NULL,
        fence INTEGER NOT NULL DEFAULT 0,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS worker_inbox_claim_idx
        ON worker_inbox(status, kind, available_at);
    `)
  }
}

function committedReservationBudget(record: BudgetReservationRecord): BudgetState {
  if (record.status === 'reserved') return record.reserved
  if (record.status === 'released') return zeroBudget()
  if (!record.actual) throw new EngineStoreConflictError(`settled reservation ${record.reservationId} has no actual usage`)
  return record.actual
}

function scopeParams(scope: TaskScope): [string, string, string] {
  return [scope.ownerId, scope.workspaceId, scope.taskId]
}

function encodeScope(scope: TaskScope): string {
  return encodeTaskScope(scope)
}

function assertSameScope(expected: TaskScope, actual: TaskScope, recordKind: string): void {
  if (encodeScope(expected) !== encodeScope(actual)) {
    throw new EngineStoreCorruptError(`${recordKind} scope does not match commit scope`)
  }
}

function addFilter(clauses: string[], params: unknown[], column: string, value: unknown): void {
  if (value === undefined) return
  clauses.push(`${column} = ?`)
  params.push(value)
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
  return encodeTaskScope(claim.scope) === encodeTaskScope(request.scope)
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
  return encode(left) === encode(right)
}

function encode(value: unknown): string {
  return JSON.stringify(value)
}

function parsePayload<T>(schema: { parse(value: unknown): T }, payload: string, message: string): T {
  try {
    return schema.parse(JSON.parse(payload))
  } catch (cause) {
    throw new EngineStoreCorruptError(message, { cause })
  }
}

function parseOrCorrupt<T>(schema: { parse(value: unknown): T }, value: unknown, message: string): T {
  try {
    return schema.parse(value)
  } catch (cause) {
    throw new EngineStoreCorruptError(message, { cause })
  }
}

function parseStoredOutbox(row: StoredOutboxRow, message: string): EngineOutboxRecord {
  const intent = parsePayload(EngineOutboxIntentSchema, row.payload, message)
  const claim = row.claim_payload ? parsePayload(EngineLeaseSchema, row.claim_payload, message) : undefined
  return parseOrCorrupt(EngineOutboxRecordSchema, { ...intent, ...(claim ? { claim } : {}) }, message)
}

function sameOutboxIdentity(existing: EngineOutboxIntent, incoming: EngineOutboxIntent): boolean {
  return existing.workId === incoming.workId
    && encodeTaskScope(existing.scope) === encodeTaskScope(incoming.scope)
    && existing.kind === incoming.kind
    && existing.payloadRef === incoming.payloadRef
    && existing.availableAt === incoming.availableAt
    && existing.createdAt === incoming.createdAt
    && (existing.status === 'completed' || sameRecord(existing.payload, incoming.payload))
}

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
  for (const key of ['stepsUsed', 'toolCallsUsed', 'inputTokens', 'outputTokens', 'costUsd'] as const) {
    if (actual[key] > limits[key]) throw new EngineStoreConflictError(`parent budget exceeded: ${key}`)
  }
}
