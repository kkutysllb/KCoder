import { randomUUID } from 'node:crypto'
import { Pool, type PoolClient, type QueryResultRow } from 'pg'
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
import { assertPostgresSchemaName, ensurePostgresEngineSchema } from './postgres-engine-schema.js'

type PayloadRow = QueryResultRow & { payload: unknown }
type VersionRow = QueryResultRow & { version: string | number }
type RevisionRow = QueryResultRow & { revision: string | number }
type HighWaterRow = QueryResultRow & { high_water: string | number }
type FenceRow = QueryResultRow & { fence: string | number }
type AckRow = QueryResultRow & { through_seq: string | number }
type LeaseRow = QueryResultRow & { payload: unknown; expires_at: Date | string }
type OutboxRow = QueryResultRow & {
  payload: unknown
  kind: string
  payload_ref: string
}
type StoredOutboxRow = PayloadRow & { claim_payload: unknown | null }

export type PostgresDurableEngineStoreOptions = {
  connectionString: string
  schema: string
  maxConnections?: number
}

export class PostgresDurableEngineStore implements DurableEngineStore {
  private constructor(
    private readonly pool: Pool,
    private readonly schema: string
  ) {}

  static async create(options: PostgresDurableEngineStoreOptions): Promise<PostgresDurableEngineStore> {
    assertPostgresSchemaName(options.schema)
    const bootstrap = new Pool({ connectionString: options.connectionString, max: 1 })
    try {
      await ensurePostgresEngineSchema(bootstrap, options.schema)
    } finally {
      await bootstrap.end()
    }
    const pool = new Pool({
      connectionString: options.connectionString,
      max: options.maxConnections ?? 4,
      options: `-c search_path=${options.schema},public`
    })
    await pool.query('SELECT 1 FROM engine_runs LIMIT 0')
    return new PostgresDurableEngineStore(pool, options.schema)
  }

  async close(options: { dropSchema?: boolean } = {}): Promise<void> {
    if (options.dropSchema) await this.pool.query(`DROP SCHEMA IF EXISTS "${this.schema}" CASCADE`)
    await this.pool.end()
  }

  async commit(rawInput: EngineCommit): Promise<EngineCommitResult> {
    const input = parseOrCorrupt(EngineCommitSchema, rawInput, 'invalid engine commit')
    assertGovernedRootCommit(input)
    try {
      return await this.transaction((client) => this.commitTransaction(client, input))
    } catch (error) {
      throw translatePostgresConflict(error)
    }
  }

  async loadRun(runId: string): Promise<EngineRunRecord | undefined> {
    const result = await this.pool.query<PayloadRow>('SELECT payload FROM engine_runs WHERE run_id = $1', [runId])
    return result.rows[0] ? parsePayload(EngineRunRecordSchema, result.rows[0].payload, `corrupt run ${runId}`) : undefined
  }

  async loadTask(scope: TaskScope): Promise<TaskCheckpointV1 | undefined> {
    const parsedScope = parseOrCorrupt(TaskScopeSchema, scope, 'invalid task scope')
    const result = await this.pool.query<PayloadRow>(`
      SELECT payload FROM task_checkpoints
      WHERE owner_id = $1 AND workspace_id = $2 AND task_id = $3
    `, scopeParams(parsedScope))
    return result.rows[0]
      ? parsePayload(TaskCheckpointV1Schema, result.rows[0].payload, 'corrupt task checkpoint')
      : undefined
  }

  async loadContext(scope: TaskScope, contextId: string): Promise<ContextCheckpointV1 | undefined> {
    const parsedScope = parseOrCorrupt(TaskScopeSchema, scope, 'invalid task scope')
    const result = await this.pool.query<PayloadRow>(`
      SELECT payload FROM context_checkpoints
      WHERE owner_id = $1 AND workspace_id = $2 AND task_id = $3 AND context_id = $4
    `, [...scopeParams(parsedScope), contextId])
    return result.rows[0]
      ? parsePayload(ContextCheckpointV1Schema, result.rows[0].payload, `corrupt context ${contextId}`)
      : undefined
  }

  async loadBudgetReservations(parentRunId: string): Promise<BudgetReservationRecord[]> {
    const result = await this.pool.query<PayloadRow>(`
      SELECT payload FROM engine_budget_reservations WHERE parent_run_id = $1 ORDER BY reservation_id
    `, [parentRunId])
    return result.rows.map((row) => parsePayload(BudgetReservationRecordSchema, row.payload, `corrupt budget reservation ${parentRunId}`))
  }

  async loadGraphRevision(graphId: string, revision: number): Promise<GraphRevision | undefined> {
    const result = await this.pool.query<PayloadRow>(`
      SELECT payload FROM graph_revisions WHERE graph_id = $1 AND revision = $2
    `, [graphId, revision])
    return result.rows[0]
      ? parsePayload(GraphRevisionSchema, result.rows[0].payload, `corrupt graph revision ${graphId}:${revision}`)
      : undefined
  }

  async loadGraphRun(runId: string): Promise<GraphRunRecord | undefined> {
    const result = await this.pool.query<PayloadRow>('SELECT payload FROM graph_runs WHERE run_id = $1', [runId])
    return result.rows[0]
      ? parsePayload(GraphRunRecordSchema, result.rows[0].payload, `corrupt graph run ${runId}`)
      : undefined
  }

  async listGraphRuns(scope?: TaskScope): Promise<GraphRunRecord[]> {
    const result = scope
      ? await this.pool.query<PayloadRow>(`
          SELECT payload FROM graph_runs
          WHERE owner_id = $1 AND workspace_id = $2 AND task_id = $3
        `, scopeParams(parseOrCorrupt(TaskScopeSchema, scope, 'invalid task scope')))
      : await this.pool.query<PayloadRow>('SELECT payload FROM graph_runs')
    return result.rows
      .map((row) => parsePayload(GraphRunRecordSchema, row.payload, 'corrupt graph run'))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.runId.localeCompare(right.runId))
  }

  async listWorkGraphEvents(runId: string, afterSeq: number, limit: number): Promise<WorkGraphEventRecord[]> {
    assertNonnegativeInteger(afterSeq, 'afterSeq')
    if (!Number.isInteger(limit) || limit <= 0) throw new EngineStoreConflictError('limit must be a positive integer')
    const result = await this.pool.query<PayloadRow>(`
      SELECT payload FROM work_graph_events WHERE run_id = $1 AND seq > $2 ORDER BY seq LIMIT $3
    `, [runId, afterSeq, limit])
    return result.rows.map((row) => parsePayload(
      WorkGraphEventRecordSchema,
      row.payload,
      `corrupt work graph event ${runId}`
    ))
  }

  async loadTaskModelPolicy(scope: TaskScope): Promise<TaskModelPolicyRecord | undefined> {
    const parsedScope = parseOrCorrupt(TaskScopeSchema, scope, 'invalid task scope')
    const result = await this.pool.query<PayloadRow>(`
      SELECT payload FROM task_model_policies
      WHERE owner_id = $1 AND workspace_id = $2 AND task_id = $3
    `, scopeParams(parsedScope))
    return result.rows[0]
      ? parsePayload(TaskModelPolicyRecordSchema, result.rows[0].payload, 'corrupt task model policy')
      : undefined
  }

  async loadHumanCheckpoint(checkpointId: string): Promise<HumanCheckpoint | undefined> {
    const result = await this.pool.query<PayloadRow>(`
      SELECT payload FROM human_checkpoints WHERE checkpoint_id = $1
    `, [checkpointId])
    return result.rows[0]
      ? parsePayload(HumanCheckpointSchema, result.rows[0].payload, `corrupt human checkpoint ${checkpointId}`)
      : undefined
  }

  async listResourceClaims(resourceKey: string): Promise<ResourceClaim[]> {
    const result = await this.pool.query<PayloadRow>(`
      SELECT payload FROM resource_claims WHERE resource_key = $1 ORDER BY claim_id
    `, [resourceKey])
    return result.rows.map((row) => parsePayload(ResourceClaimSchema, row.payload, `corrupt resource claim ${resourceKey}`))
  }

  async claimResource(rawInput: ResourceClaimRequest): Promise<ResourceClaim | undefined> {
    const input = parseOrCorrupt(ResourceClaimRequestSchema, rawInput, 'invalid resource claim request')
    return this.transaction(async (client) => {
      await lockResourceKey(client, input.resourceKey)
      const result = await client.query<PayloadRow>(`
        SELECT payload FROM resource_claims WHERE resource_key = $1 ORDER BY claim_id FOR UPDATE
      `, [input.resourceKey])
      const now = Date.now()
      const claims = result.rows.map((row) =>
        parsePayload(ResourceClaimSchema, row.payload, `corrupt resource claim ${input.resourceKey}`))
      for (const claim of claims) {
        if (claim.status === 'active' && Date.parse(claim.lease.expiresAt) <= now) {
          const expired = ResourceClaimSchema.parse({
            ...claim, status: 'expired', updatedAt: new Date(now).toISOString()
          })
          await client.query(`
            UPDATE resource_claims SET status = $3, payload = $4::jsonb
            WHERE resource_key = $1 AND claim_id = $2
          `, [expired.resourceKey, expired.claimId, expired.status, encode(expired)])
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
      await client.query(`
        INSERT INTO resource_claims
          (resource_key, claim_id, owner_id, workspace_id, task_id, status, payload)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
        ON CONFLICT(resource_key, claim_id) DO UPDATE SET
          owner_id = EXCLUDED.owner_id,
          workspace_id = EXCLUDED.workspace_id,
          task_id = EXCLUDED.task_id,
          status = EXCLUDED.status,
          payload = EXCLUDED.payload
      `, [claim.resourceKey, claim.claimId, ...scopeParams(claim.scope), claim.status, encode(claim)])
      return claim
    })
  }

  async renewResourceClaim(rawClaim: ResourceClaim, ttlMs: number): Promise<ResourceClaim | undefined> {
    assertTtl(ttlMs)
    const claim = parseOrCorrupt(ResourceClaimSchema, rawClaim, 'invalid resource claim')
    return this.transaction(async (client) => {
      await lockResourceKey(client, claim.resourceKey)
      const result = await client.query<PayloadRow>(`
        SELECT payload FROM resource_claims WHERE resource_key = $1 AND claim_id = $2 FOR UPDATE
      `, [claim.resourceKey, claim.claimId])
      const current = result.rows[0]
        ? parsePayload(ResourceClaimSchema, result.rows[0].payload, `corrupt resource claim ${claim.claimId}`)
        : undefined
      if (!current) return undefined
      const now = Date.now()
      if (current.status !== 'active' || Date.parse(current.lease.expiresAt) <= now) {
        if (current.status === 'active') {
          const expired = ResourceClaimSchema.parse({ ...current, status: 'expired', updatedAt: new Date(now).toISOString() })
          await client.query(`
            UPDATE resource_claims SET status = $3, payload = $4::jsonb
            WHERE resource_key = $1 AND claim_id = $2
          `, [expired.resourceKey, expired.claimId, expired.status, encode(expired)])
        }
        return undefined
      }
      if (!sameResourceClaimLease(current, claim)) return undefined
      const renewed = ResourceClaimSchema.parse({
        ...current,
        lease: { ...current.lease, expiresAt: new Date(now + ttlMs).toISOString() },
        updatedAt: new Date(now).toISOString()
      })
      await client.query(`
        UPDATE resource_claims SET payload = $3::jsonb WHERE resource_key = $1 AND claim_id = $2
      `, [renewed.resourceKey, renewed.claimId, encode(renewed)])
      return renewed
    })
  }

  async releaseResourceClaim(rawClaim: ResourceClaim): Promise<void> {
    const claim = parseOrCorrupt(ResourceClaimSchema, rawClaim, 'invalid resource claim')
    await this.transaction(async (client) => {
      await lockResourceKey(client, claim.resourceKey)
      const result = await client.query<PayloadRow>(`
        SELECT payload FROM resource_claims WHERE resource_key = $1 AND claim_id = $2 FOR UPDATE
      `, [claim.resourceKey, claim.claimId])
      const current = result.rows[0]
        ? parsePayload(ResourceClaimSchema, result.rows[0].payload, `corrupt resource claim ${claim.claimId}`)
        : undefined
      if (!current || current.status !== 'active' || !sameResourceClaimLease(current, claim)) {
        throw new EngineStoreConflictError(`resource claim ${claim.claimId} rejected by stale token or fence`)
      }
      const released = ResourceClaimSchema.parse({ ...current, status: 'released', updatedAt: new Date().toISOString() })
      await client.query(`
        UPDATE resource_claims SET status = $3, payload = $4::jsonb
        WHERE resource_key = $1 AND claim_id = $2
      `, [released.resourceKey, released.claimId, released.status, encode(released)])
    })
  }

  async loadOutboxIntent(workId: string): Promise<EngineOutboxRecord | undefined> {
    const result = await this.pool.query<StoredOutboxRow>(`
      SELECT payload, claim_payload FROM engine_outbox WHERE work_id = $1
    `, [workId])
    return result.rows[0] ? parseStoredOutbox(result.rows[0], `corrupt outbox intent ${workId}`) : undefined
  }

  async listOutboxIntents(scope: TaskScope): Promise<EngineOutboxRecord[]> {
    const parsedScope = parseOrCorrupt(TaskScopeSchema, scope, 'invalid task scope')
    const result = await this.pool.query<StoredOutboxRow>(`
      SELECT payload, claim_payload FROM engine_outbox
      WHERE owner_id = $1 AND workspace_id = $2 AND task_id = $3
      ORDER BY created_at, work_id
    `, scopeParams(parsedScope))
    return result.rows.map((row) => parseStoredOutbox(row, 'corrupt outbox intent'))
  }

  async findLedger(rawQuery: LedgerQuery): Promise<ExecutionLedgerEntry[]> {
    const query = parseOrCorrupt(LedgerQuerySchema, rawQuery, 'invalid ledger query')
    const clauses = ['owner_id = $1', 'workspace_id = $2', 'task_id = $3']
    const params: unknown[] = [...scopeParams(query.scope)]
    addFilter(clauses, params, 'kind', query.kind)
    addFilter(clauses, params, 'operation_id', query.operationId)
    addFilter(clauses, params, 'kernel_run_id', query.kernelRunId)
    addFilter(clauses, params, 'logical_request_key', query.logicalRequestKey)
    addFilter(clauses, params, 'exact_fingerprint', query.exactFingerprint)
    addFilter(clauses, params, 'semantic_key', query.semanticKey)
    addFilter(clauses, params, 'status', query.status)
    const result = await this.pool.query<PayloadRow>(`
      SELECT payload FROM execution_ledger
      WHERE ${clauses.join(' AND ')}
      ORDER BY created_at, operation_id
    `, params)
    return result.rows.map((row) => parsePayload(ExecutionLedgerEntrySchema, row.payload, 'corrupt execution ledger'))
  }

  async listCosts(scope: TaskScope): Promise<CostEntry[]> {
    const parsedScope = parseOrCorrupt(TaskScopeSchema, scope, 'invalid task scope')
    const result = await this.pool.query<PayloadRow>(`
      SELECT payload FROM engine_costs
      WHERE owner_id = $1 AND workspace_id = $2 AND task_id = $3 ORDER BY cost_id
    `, scopeParams(parsedScope))
    return result.rows.map((row) => parsePayload(CostEntrySchema, row.payload, 'corrupt engine cost'))
  }

  async listValues(scope: TaskScope): Promise<ValueEvent[]> {
    const parsedScope = parseOrCorrupt(TaskScopeSchema, scope, 'invalid task scope')
    const result = await this.pool.query<PayloadRow>(`
      SELECT payload FROM engine_values
      WHERE owner_id = $1 AND workspace_id = $2 AND task_id = $3 ORDER BY value_id
    `, scopeParams(parsedScope))
    return result.rows.map((row) => parsePayload(ValueEventSchema, row.payload, 'corrupt engine value'))
  }

  async readStream(streamId: string, afterSeq: number, limit: number): Promise<EngineStreamEvent[]> {
    assertNonnegativeInteger(afterSeq, 'afterSeq')
    if (!Number.isInteger(limit) || limit <= 0) throw new EngineStoreConflictError('limit must be a positive integer')
    const result = await this.pool.query<PayloadRow>(`
      SELECT payload FROM engine_stream_events
      WHERE stream_id = $1 AND seq > $2 ORDER BY seq LIMIT $3
    `, [streamId, afterSeq, limit])
    return result.rows.map((row) => parsePayload(EngineStreamEventSchema, row.payload, `corrupt stream ${streamId}`))
  }

  async ackStream(streamId: string, subscriberId: string, throughSeq: number): Promise<void> {
    assertNonnegativeInteger(throughSeq, 'throughSeq')
    await this.transaction(async (client) => {
      const highWater = await this.currentHighWater(client, 'engine_stream_counters', 'stream_id', streamId)
      if (throughSeq > highWater) throw new EngineStoreConflictError('stream acknowledgement exceeds high-water')
      const current = await client.query<AckRow>(`
        SELECT through_seq FROM engine_stream_acks
        WHERE stream_id = $1 AND subscriber_id = $2 FOR UPDATE
      `, [streamId, subscriberId])
      const currentSeq = current.rows[0] ? asNumber(current.rows[0].through_seq) : 0
      if (throughSeq < currentSeq) throw new EngineStoreConflictError('stream acknowledgement cannot move backwards')
      await client.query(`
        INSERT INTO engine_stream_acks (stream_id, subscriber_id, through_seq)
        VALUES ($1, $2, $3)
        ON CONFLICT(stream_id, subscriber_id) DO UPDATE SET through_seq = EXCLUDED.through_seq
      `, [streamId, subscriberId, throughSeq])
    })
  }

  async acquireLease(runId: string, holderId: string, ttlMs: number): Promise<EngineLease | undefined> {
    assertTtl(ttlMs)
    return this.transaction(async (client) => {
      await client.query(`
        INSERT INTO engine_lease_fences (run_id, fence) VALUES ($1, 0)
        ON CONFLICT(run_id) DO NOTHING
      `, [runId])
      const fenceRow = await client.query<FenceRow>(`
        SELECT fence FROM engine_lease_fences WHERE run_id = $1 FOR UPDATE
      `, [runId])
      const current = await client.query<LeaseRow>(`
        SELECT payload, expires_at FROM engine_leases WHERE run_id = $1 FOR UPDATE
      `, [runId])
      if (current.rows[0] && timestampMs(current.rows[0].expires_at) > Date.now()) return undefined
      const fence = asNumber(fenceRow.rows[0]!.fence) + 1
      await client.query('UPDATE engine_lease_fences SET fence = $2 WHERE run_id = $1', [runId, fence])
      const lease = EngineLeaseSchema.parse({
        runId,
        holderId,
        fence,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + ttlMs).toISOString()
      })
      await client.query(`
        INSERT INTO engine_leases (run_id, holder_id, fence, token, expires_at, payload)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        ON CONFLICT(run_id) DO UPDATE SET
          holder_id = EXCLUDED.holder_id,
          fence = EXCLUDED.fence,
          token = EXCLUDED.token,
          expires_at = EXCLUDED.expires_at,
          payload = EXCLUDED.payload
      `, [runId, holderId, fence, lease.token, lease.expiresAt, encode(lease)])
      return lease
    })
  }

  async renewLease(runId: string, lease: EngineLease, ttlMs: number): Promise<EngineLease | undefined> {
    assertTtl(ttlMs)
    const parsed = parseOrCorrupt(EngineLeaseSchema, lease, 'invalid engine lease')
    return this.transaction(async (client) => {
      const result = await client.query<LeaseRow>(`
        SELECT payload, expires_at FROM engine_leases WHERE run_id = $1 FOR UPDATE
      `, [runId])
      const row = result.rows[0]
      if (!row || timestampMs(row.expires_at) <= Date.now()) return undefined
      const current = parsePayload(EngineLeaseSchema, row.payload, `corrupt lease ${runId}`)
      if (!sameLease(current, parsed)) return undefined
      const renewed = EngineLeaseSchema.parse({ ...current, expiresAt: new Date(Date.now() + ttlMs).toISOString() })
      await client.query(`
        UPDATE engine_leases SET expires_at = $2, payload = $3::jsonb WHERE run_id = $1
      `, [runId, renewed.expiresAt, encode(renewed)])
      return renewed
    })
  }

  async releaseLease(runId: string, lease: EngineLease): Promise<void> {
    const parsed = parseOrCorrupt(EngineLeaseSchema, lease, 'invalid engine lease')
    await this.transaction(async (client) => {
      const result = await client.query<PayloadRow>(`
        SELECT payload FROM engine_leases WHERE run_id = $1 FOR UPDATE
      `, [runId])
      const row = result.rows[0]
      if (!row || !sameLease(parsePayload(EngineLeaseSchema, row.payload, `corrupt lease ${runId}`), parsed)) {
        throw new EngineStoreConflictError('lease does not match active owner')
      }
      await client.query('DELETE FROM engine_leases WHERE run_id = $1', [runId])
    })
  }

  async claimWork(workerId: string, kinds: readonly string[], ttlMs: number): Promise<WorkClaim | undefined> {
    assertTtl(ttlMs)
    if (kinds.length === 0) return undefined
    return this.transaction(async (client) => {
      const selected = await client.query<OutboxRow>(`
        SELECT payload, kind, payload_ref
        FROM engine_outbox
        WHERE kind = ANY($1::text[])
          AND available_at <= NOW()
          AND (status = 'pending' OR (status = 'claimed' AND claim_expires_at <= NOW()))
        ORDER BY available_at, work_id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `, [kinds])
      const row = selected.rows[0]
      if (!row) return undefined
      const intent = parsePayload(EngineOutboxIntentSchema, row.payload, 'corrupt outbox intent')
      const fence = await this.nextFence(client, 'engine_work_fences', 'work_id', intent.workId)
      const now = new Date().toISOString()
      const lease = EngineLeaseSchema.parse({
        runId: `work:${intent.workId}`,
        holderId: workerId,
        fence,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + ttlMs).toISOString()
      })
      const claimed = EngineOutboxIntentSchema.parse({ ...intent, status: 'claimed', updatedAt: now })
      await client.query(`
        UPDATE engine_outbox SET status = 'claimed', updated_at = $2, payload = $3::jsonb,
          claim_payload = $4::jsonb, claim_expires_at = $5 WHERE work_id = $1
      `, [intent.workId, now, encode(claimed), encode(lease), lease.expiresAt])
      return WorkClaimSchema.parse({
        workId: intent.workId,
        kind: row.kind,
        payloadRef: row.payload_ref,
        lease,
        payload: intent.payload
      })
    })
  }

  async renewWorkClaim(workId: string, lease: EngineLease, ttlMs: number): Promise<EngineLease | undefined> {
    assertTtl(ttlMs)
    const parsed = parseOrCorrupt(EngineLeaseSchema, lease, 'invalid work claim')
    return this.transaction(async (client) => {
      const result = await client.query<StoredOutboxRow & { claim_expires_at: Date | string | null }>(`
        SELECT payload, claim_payload, claim_expires_at
        FROM engine_outbox WHERE work_id = $1 FOR UPDATE
      `, [workId])
      const row = result.rows[0]
      if (!row?.claim_payload || !row.claim_expires_at || timestampMs(row.claim_expires_at) <= Date.now()) {
        return undefined
      }
      const intent = parsePayload(EngineOutboxIntentSchema, row.payload, `corrupt outbox intent ${workId}`)
      const current = parsePayload(EngineLeaseSchema, row.claim_payload, `corrupt work claim ${workId}`)
      if (intent.status !== 'claimed' || !sameLease(current, parsed)) return undefined
      const now = new Date().toISOString()
      const renewed = EngineLeaseSchema.parse({ ...current, expiresAt: new Date(Date.now() + ttlMs).toISOString() })
      const updated = EngineOutboxIntentSchema.parse({ ...intent, updatedAt: now })
      await client.query(`
        UPDATE engine_outbox SET updated_at = $2, payload = $3::jsonb,
          claim_payload = $4::jsonb, claim_expires_at = $5 WHERE work_id = $1
      `, [workId, now, encode(updated), encode(renewed), renewed.expiresAt])
      return renewed
    })
  }

  private async commitTransaction(client: PoolClient, input: ParsedEngineCommit): Promise<EngineCommitResult> {
    await this.lockCommitIdentity(client, input)
    await this.assertExpectedVersions(client, input)
    await this.assertLeaseFence(client, input)
    await this.applyGraphRevisions(client, input)
    await this.applyGraphRun(client, input)
    await this.applyWorkGraphEvents(client, input)
    await this.applyTaskModelPolicy(client, input)
    await this.applyHumanCheckpoints(client, input)
    await this.applyResourceClaims(client, input)
    await this.applyRun(client, input)
    await this.applyTask(client, input)
    await this.applyContext(client, input)
    await this.applyLedger(client, input)
    await this.applyEvents(client, input)
    const streamHighWater = await this.applyStreamEvents(client, input)
    await this.applyOutbox(client, input)
    await this.applyCosts(client, input)
    await this.applyValues(client, input)
    await this.applyBudgetReservations(client, input)
    return EngineCommitResultSchema.parse({
      runVersion: await this.currentRunVersion(client, input.runId),
      taskRevision: await this.currentTaskRevision(client, input.scope),
      eventHighWater: await this.currentHighWater(client, 'engine_event_counters', 'run_id', input.runId),
      streamHighWater
    })
  }

  private async lockCommitIdentity(client: PoolClient, input: ParsedEngineCommit): Promise<void> {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`run:${input.runId}`])
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `task:${encodeTaskScope(input.scope)}`
    ])
  }

  private async assertExpectedVersions(client: PoolClient, input: ParsedEngineCommit): Promise<void> {
    const runVersion = await this.currentRunVersion(client, input.runId, true)
    if (input.expectedRunVersion !== runVersion) {
      throw new EngineStoreConflictError(`run version mismatch: expected ${input.expectedRunVersion}, actual ${runVersion}`)
    }
    const taskRevision = await this.currentTaskRevision(client, input.scope, true)
    if (input.expectedTaskRevision !== taskRevision) {
      throw new EngineStoreConflictError(
        `task revision mismatch: expected ${input.expectedTaskRevision}, actual ${taskRevision}`
      )
    }
    if (input.expectedModelPolicyRevision !== undefined) {
      const policyRevision = await this.currentModelPolicyRevision(client, input.scope, true)
      if (input.expectedModelPolicyRevision !== policyRevision) {
        throw new EngineStoreConflictError(
          `model policy revision mismatch: expected ${input.expectedModelPolicyRevision}, actual ${policyRevision}`
        )
      }
    }
  }

  private async applyGraphRevisions(client: PoolClient, input: ParsedEngineCommit): Promise<void> {
    for (const mutation of input.graphRevisionMutations) {
      const graphId = mutation.type === 'put' ? mutation.record.graphId : mutation.graphId
      const revision = mutation.type === 'put' ? mutation.record.revision : mutation.revision
      if (mutation.type === 'delete') {
        await client.query('DELETE FROM graph_revisions WHERE graph_id = $1 AND revision = $2', [graphId, revision])
        continue
      }
      const existing = await client.query<PayloadRow>(`
        SELECT payload FROM graph_revisions WHERE graph_id = $1 AND revision = $2 FOR UPDATE
      `, [graphId, revision])
      if (existing.rows[0]) {
        const record = parsePayload(GraphRevisionSchema, existing.rows[0].payload, `corrupt graph revision ${graphId}:${revision}`)
        if (!sameRecord(record, mutation.record)) {
          throw new EngineStoreConflictError(`graph revision ${graphId}:${revision} is immutable`)
        }
        continue
      }
      await client.query(`
        INSERT INTO graph_revisions (graph_id, revision, graph_digest, payload)
        VALUES ($1, $2, $3, $4::jsonb)
      `, [graphId, revision, mutation.record.graphDigest, encode(mutation.record)])
    }
  }

  private async applyGraphRun(client: PoolClient, input: ParsedEngineCommit): Promise<void> {
    const mutation = input.graphRunMutation
    if (!mutation) return
    if (mutation.type === 'delete') {
      if (mutation.recordId !== input.runId) throw new EngineStoreCorruptError('graph run delete targets another run')
      await client.query('DELETE FROM graph_runs WHERE run_id = $1', [input.runId])
      return
    }
    assertSameScope(input.scope, mutation.record.scope, 'graph run')
    if (mutation.record.runId !== input.runId) throw new EngineStoreCorruptError('graph run mutation targets another run')
    const assignedVersion = input.expectedRunVersion + 1
    if (mutation.record.version !== assignedVersion) {
      throw new EngineStoreConflictError(`graph run mutation must use assigned version ${assignedVersion}`)
    }
    const record = mutation.record
    await client.query(`
      INSERT INTO graph_runs
        (run_id, owner_id, workspace_id, task_id, graph_id, graph_revision, version, status, payload)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
      ON CONFLICT(run_id) DO UPDATE SET
        owner_id = EXCLUDED.owner_id,
        workspace_id = EXCLUDED.workspace_id,
        task_id = EXCLUDED.task_id,
        graph_id = EXCLUDED.graph_id,
        graph_revision = EXCLUDED.graph_revision,
        version = EXCLUDED.version,
        status = EXCLUDED.status,
        payload = EXCLUDED.payload
    `, [
      record.runId,
      ...scopeParams(input.scope),
      record.graphId,
      record.graphRevision,
      record.version,
      record.status,
      encode(record)
    ])
  }

  private async applyWorkGraphEvents(client: PoolClient, input: ParsedEngineCommit): Promise<void> {
    for (const mutation of input.workGraphEvents) {
      assertSameScope(input.scope, mutation.record.scope, 'work graph event')
      if (mutation.record.runId !== input.runId) throw new EngineStoreCorruptError('work graph event targets another run')
      const existing = await client.query<PayloadRow>(`
        SELECT payload FROM work_graph_events WHERE run_id = $1 AND event_id = $2 FOR UPDATE
      `, [input.runId, mutation.record.eventId])
      if (existing.rows[0]) {
        const record = parsePayload(
          WorkGraphEventRecordSchema,
          existing.rows[0].payload,
          `corrupt work graph event ${mutation.record.eventId}`
        )
        const { seq: _seq, ...eventInput } = record
        if (!sameRecord(eventInput, mutation.record)) {
          throw new EngineStoreConflictError(`work graph event ${mutation.record.eventId} already exists with different data`)
        }
        continue
      }
      const seq = await this.nextHighWater(client, 'work_graph_event_counters', 'run_id', input.runId)
      const record = WorkGraphEventRecordSchema.parse({ ...mutation.record, seq })
      await client.query(`
        INSERT INTO work_graph_events (run_id, seq, event_id, kind, timestamp, payload)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      `, [input.runId, seq, record.eventId, record.kind, record.timestamp, encode(record)])
    }
  }

  private async applyTaskModelPolicy(client: PoolClient, input: ParsedEngineCommit): Promise<void> {
    const mutation = input.taskModelPolicyMutation
    if (!mutation) return
    if (mutation.type === 'delete') {
      await client.query(`
        DELETE FROM task_model_policies WHERE owner_id = $1 AND workspace_id = $2 AND task_id = $3
      `, scopeParams(input.scope))
      return
    }
    assertSameScope(input.scope, mutation.record.scope, 'task model policy')
    const assignedRevision = (input.expectedModelPolicyRevision ?? 0) + 1
    if (mutation.record.revision !== assignedRevision) {
      throw new EngineStoreConflictError(`model policy mutation must use assigned revision ${assignedRevision}`)
    }
    await client.query(`
      INSERT INTO task_model_policies (owner_id, workspace_id, task_id, revision, payload)
      VALUES ($1, $2, $3, $4, $5::jsonb)
      ON CONFLICT(owner_id, workspace_id, task_id) DO UPDATE SET
        revision = EXCLUDED.revision,
        payload = EXCLUDED.payload
    `, [...scopeParams(input.scope), mutation.record.revision, encode(mutation.record)])
  }

  private async applyHumanCheckpoints(client: PoolClient, input: ParsedEngineCommit): Promise<void> {
    for (const mutation of input.humanCheckpointMutations) {
      if (mutation.type === 'delete') {
        await client.query('DELETE FROM human_checkpoints WHERE checkpoint_id = $1', [mutation.recordId])
        continue
      }
      if (mutation.type !== 'put') {
        const existing = await client.query<PayloadRow>(`
          SELECT payload FROM human_checkpoints WHERE checkpoint_id = $1 FOR UPDATE
        `, [mutation.recordId])
        if (!existing.rows[0]) throw new EngineStoreConflictError(`checkpoint ${mutation.recordId} does not exist`)
        const current = parsePayload(HumanCheckpointSchema, existing.rows[0].payload, `corrupt checkpoint ${mutation.recordId}`)
        assertSameScope(input.scope, current.scope, 'human checkpoint')
        const next = applyHumanCheckpointMutation(current, mutation)
        await client.query(
          'UPDATE human_checkpoints SET status = $2, payload = $3::jsonb WHERE checkpoint_id = $1',
          [mutation.recordId, next.status, encode(next)]
        )
        continue
      }
      assertSameScope(input.scope, mutation.record.scope, 'human checkpoint')
      const existing = await client.query<PayloadRow>(`
        SELECT payload FROM human_checkpoints WHERE checkpoint_id = $1 FOR UPDATE
      `, [mutation.record.checkpointId])
      if (existing.rows[0]) {
        const record = parsePayload(HumanCheckpointSchema, existing.rows[0].payload, `corrupt checkpoint ${mutation.record.checkpointId}`)
        if (!sameRecord(record, mutation.record)) {
          throw new EngineStoreConflictError(`checkpoint ${mutation.record.checkpointId} already exists with different data`)
        }
        continue
      }
      await client.query(`
        INSERT INTO human_checkpoints
          (checkpoint_id, owner_id, workspace_id, task_id, run_id, status, resolution_token, payload)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      `, [
        mutation.record.checkpointId,
        ...scopeParams(input.scope),
        mutation.record.runId,
        mutation.record.status,
        mutation.record.resolutionToken,
        encode(mutation.record)
      ])
    }
  }

  private async applyResourceClaims(client: PoolClient, input: ParsedEngineCommit): Promise<void> {
    for (const mutation of input.resourceClaimMutations) {
      const resourceKey = mutation.type === 'put' ? mutation.record.resourceKey : mutation.resourceKey
      const claimId = mutation.type === 'put' ? mutation.record.claimId : mutation.claimId
      if (mutation.type === 'delete') {
        await client.query('DELETE FROM resource_claims WHERE resource_key = $1 AND claim_id = $2', [resourceKey, claimId])
        continue
      }
      assertSameScope(input.scope, mutation.record.scope, 'resource claim')
      await client.query(`
        INSERT INTO resource_claims
          (resource_key, claim_id, owner_id, workspace_id, task_id, status, payload)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
        ON CONFLICT(resource_key, claim_id) DO UPDATE SET
          owner_id = EXCLUDED.owner_id,
          workspace_id = EXCLUDED.workspace_id,
          task_id = EXCLUDED.task_id,
          status = EXCLUDED.status,
          payload = EXCLUDED.payload
      `, [resourceKey, claimId, ...scopeParams(input.scope), mutation.record.status, encode(mutation.record)])
    }
  }

  private async assertLeaseFence(client: PoolClient, input: ParsedEngineCommit): Promise<void> {
    const latest = await client.query<FenceRow>(`
      SELECT fence FROM engine_lease_fences WHERE run_id = $1 FOR SHARE
    `, [input.runId])
    if (latest.rows[0] && input.leaseFence !== asNumber(latest.rows[0].fence)) {
      throw new EngineStoreConflictError(`stale lease fence for run ${input.runId}`)
    }
    const active = await client.query<LeaseRow>(`
      SELECT payload, expires_at FROM engine_leases WHERE run_id = $1 FOR SHARE
    `, [input.runId])
    if (active.rows[0] && timestampMs(active.rows[0].expires_at) > Date.now()) {
      const lease = parsePayload(EngineLeaseSchema, active.rows[0].payload, `corrupt lease ${input.runId}`)
      if (input.leaseFence !== lease.fence) {
        throw new EngineStoreConflictError(`commit does not own the active lease for run ${input.runId}`)
      }
    }
  }

  private async applyRun(client: PoolClient, input: ParsedEngineCommit): Promise<void> {
    const mutation = input.runMutation
    if (!mutation) return
    if (mutation.type === 'delete') {
      if (mutation.recordId !== input.runId) throw new EngineStoreCorruptError('run delete targets another run')
      await client.query('DELETE FROM engine_runs WHERE run_id = $1', [input.runId])
      return
    }
    assertSameScope(input.scope, mutation.record.scope, 'run')
    if (mutation.record.runId !== input.runId) throw new EngineStoreCorruptError('run mutation targets another run')
    const assignedVersion = input.expectedRunVersion + 1
    if (mutation.record.version !== assignedVersion) {
      throw new EngineStoreConflictError(`run mutation must use assigned version ${assignedVersion}`)
    }
    const record = mutation.record
    await client.query(`
      INSERT INTO engine_runs
        (run_id, owner_id, workspace_id, task_id, version, status, desired_state, payload)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      ON CONFLICT(run_id) DO UPDATE SET
        owner_id = EXCLUDED.owner_id,
        workspace_id = EXCLUDED.workspace_id,
        task_id = EXCLUDED.task_id,
        version = EXCLUDED.version,
        status = EXCLUDED.status,
        desired_state = EXCLUDED.desired_state,
        payload = EXCLUDED.payload
    `, [record.runId, ...scopeParams(input.scope), record.version, record.status, record.desiredState, encode(record)])
  }

  private async applyTask(client: PoolClient, input: ParsedEngineCommit): Promise<void> {
    const mutation = input.taskCheckpointMutation
    if (!mutation) return
    if (mutation.type === 'delete') {
      if (mutation.recordId !== encodeTaskScope(input.scope)) {
        throw new EngineStoreCorruptError('task delete requires its encoded task scope')
      }
      await client.query(`
        DELETE FROM task_checkpoints WHERE owner_id = $1 AND workspace_id = $2 AND task_id = $3
      `, scopeParams(input.scope))
      return
    }
    assertSameScope(input.scope, mutation.record.scope, 'task checkpoint')
    const assignedRevision = input.expectedTaskRevision + 1
    if (mutation.record.revision !== assignedRevision) {
      throw new EngineStoreConflictError(`task mutation must use assigned revision ${assignedRevision}`)
    }
    const record = mutation.record
    await client.query(`
      INSERT INTO task_checkpoints (owner_id, workspace_id, task_id, revision, status, payload)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      ON CONFLICT(owner_id, workspace_id, task_id) DO UPDATE SET
        revision = EXCLUDED.revision,
        status = EXCLUDED.status,
        payload = EXCLUDED.payload
    `, [...scopeParams(input.scope), record.revision, record.status, encode(record)])
  }

  private async applyContext(client: PoolClient, input: ParsedEngineCommit): Promise<void> {
    const mutation = input.contextCheckpointMutation
    if (!mutation) return
    if (mutation.type === 'delete') {
      await client.query(`
        DELETE FROM context_checkpoints
        WHERE owner_id = $1 AND workspace_id = $2 AND task_id = $3 AND context_id = $4
      `, [...scopeParams(input.scope), mutation.recordId])
      return
    }
    assertSameScope(input.scope, mutation.record.scope, 'context checkpoint')
    const record = mutation.record
    await client.query(`
      INSERT INTO context_checkpoints
        (owner_id, workspace_id, task_id, context_id, revision, payload)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      ON CONFLICT(owner_id, workspace_id, task_id, context_id) DO UPDATE SET
        revision = EXCLUDED.revision,
        payload = EXCLUDED.payload
    `, [...scopeParams(input.scope), record.contextId, record.revision, encode(record)])
  }

  private async applyLedger(client: PoolClient, input: ParsedEngineCommit): Promise<void> {
    for (const mutation of input.ledgerMutations) {
      const operationId = mutation.type === 'delete' ? mutation.recordId : mutation.record.operationId
      const key = [...scopeParams(input.scope), operationId]
      if (mutation.type === 'delete') {
        await client.query(`
          DELETE FROM execution_ledger
          WHERE owner_id = $1 AND workspace_id = $2 AND task_id = $3 AND operation_id = $4
        `, key)
        continue
      }
      assertSameScope(input.scope, mutation.record.scope, 'ledger')
      const existing = await client.query<PayloadRow>(`
        SELECT payload FROM execution_ledger
        WHERE owner_id = $1 AND workspace_id = $2 AND task_id = $3 AND operation_id = $4
        FOR UPDATE
      `, key)
      if (mutation.type === 'append' && existing.rows[0]) {
        const parsed = parsePayload(ExecutionLedgerEntrySchema, existing.rows[0].payload, `corrupt ledger ${operationId}`)
        if (!sameRecord(parsed, mutation.record)) {
          throw new EngineStoreConflictError(`operation ${operationId} already exists with different data`)
        }
        continue
      }
      const record = mutation.record
      await client.query(`
        INSERT INTO execution_ledger
          (owner_id, workspace_id, task_id, operation_id, kind, kernel_run_id,
           logical_request_key, exact_fingerprint, semantic_key, status, created_at, payload)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
        ON CONFLICT(owner_id, workspace_id, task_id, operation_id) DO UPDATE SET
          kind = EXCLUDED.kind,
          kernel_run_id = EXCLUDED.kernel_run_id,
          logical_request_key = EXCLUDED.logical_request_key,
          exact_fingerprint = EXCLUDED.exact_fingerprint,
          semantic_key = EXCLUDED.semantic_key,
          status = EXCLUDED.status,
          created_at = EXCLUDED.created_at,
          payload = EXCLUDED.payload
      `, [
        ...scopeParams(input.scope), operationId, record.kind, record.kernelRunId,
        record.kind === 'model' ? record.logicalRequestKey : null,
        record.kind === 'tool' ? record.exactFingerprint : null,
        record.kind === 'tool' ? record.semanticKey : null,
        record.status, record.createdAt, encode(record)
      ])
    }
  }

  private async applyEvents(client: PoolClient, input: ParsedEngineCommit): Promise<void> {
    for (const mutation of input.events) {
      assertSameScope(input.scope, mutation.record.scope, 'event')
      if (mutation.record.runId !== input.runId) throw new EngineStoreCorruptError('event targets another run')
      const existing = await client.query<PayloadRow>(`
        SELECT payload FROM engine_events WHERE run_id = $1 AND event_id = $2 FOR UPDATE
      `, [input.runId, mutation.record.eventId])
      if (existing.rows[0]) {
        const record = parsePayload(EngineEventRecordSchema, existing.rows[0].payload, `corrupt event ${mutation.record.eventId}`)
        const { seq: _seq, ...eventInput } = record
        if (!sameRecord(eventInput, mutation.record)) {
          throw new EngineStoreConflictError(`event ${mutation.record.eventId} already exists with different data`)
        }
        continue
      }
      const seq = await this.nextHighWater(client, 'engine_event_counters', 'run_id', input.runId)
      const record = EngineEventRecordSchema.parse({ ...mutation.record, seq })
      await client.query(`
        INSERT INTO engine_events (run_id, seq, event_id, kind, timestamp, payload)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      `, [input.runId, seq, record.eventId, record.kind, record.timestamp, encode(record)])
    }
  }

  private async applyStreamEvents(client: PoolClient, input: ParsedEngineCommit): Promise<number> {
    let highWater = 0
    for (const mutation of input.streamEvents) {
      assertSameScope(input.scope, mutation.record.scope, 'stream event')
      const seq = await this.nextHighWater(client, 'engine_stream_counters', 'stream_id', mutation.record.streamId)
      const record = EngineStreamEventSchema.parse({ ...mutation.record, seq })
      await client.query(`
        INSERT INTO engine_stream_events
          (stream_id, seq, owner_id, workspace_id, task_id, channel, kind, timestamp, payload)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
      `, [record.streamId, record.seq, ...scopeParams(record.scope), record.channel, record.kind, record.timestamp, encode(record)])
      highWater = Math.max(highWater, seq)
    }
    return highWater
  }

  private async applyOutbox(client: PoolClient, input: ParsedEngineCommit): Promise<void> {
    for (const mutation of input.outboxIntents) {
      if (mutation.type === 'delete') {
        await client.query('DELETE FROM engine_outbox WHERE work_id = $1', [mutation.recordId])
        continue
      }
      if (mutation.type === 'complete') {
        const result = await client.query<StoredOutboxRow>(`
          SELECT payload, claim_payload FROM engine_outbox WHERE work_id = $1 FOR UPDATE
        `, [mutation.recordId])
        if (!result.rows[0]) throw new EngineStoreConflictError(`work ${mutation.recordId} does not exist`)
        const existing = parsePayload(EngineOutboxIntentSchema, result.rows[0].payload, `corrupt work ${mutation.recordId}`)
        const activeClaim = result.rows[0].claim_payload
          ? parsePayload(EngineLeaseSchema, result.rows[0].claim_payload, `corrupt work claim ${mutation.recordId}`)
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
        await client.query(`
          UPDATE engine_outbox SET status = 'completed', updated_at = $2, completed_at = $2,
            payload = $3::jsonb, claim_payload = NULL, claim_expires_at = NULL WHERE work_id = $1
        `, [mutation.recordId, now, encode(completed)])
        continue
      }
      assertSameScope(input.scope, mutation.record.scope, 'outbox')
      const existing = await client.query<PayloadRow>(`
        SELECT payload FROM engine_outbox WHERE work_id = $1 FOR UPDATE
      `, [mutation.record.workId])
      if (existing.rows[0]) {
        const parsed = parsePayload(EngineOutboxIntentSchema, existing.rows[0].payload, `corrupt work ${mutation.record.workId}`)
        if (!sameOutboxIdentity(parsed, mutation.record)) {
          throw new EngineStoreConflictError(`work ${mutation.record.workId} already exists with different data`)
        }
        continue
      }
      const record = mutation.record
      await client.query(`
        INSERT INTO engine_outbox
          (work_id, owner_id, workspace_id, task_id, kind, payload_ref, status,
           available_at, created_at, updated_at, completed_at, payload)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
      `, [
        record.workId, ...scopeParams(input.scope), record.kind, record.payloadRef, record.status,
        record.availableAt, record.createdAt, record.updatedAt, record.completedAt ?? null, encode(record)
      ])
    }
  }

  private async applyCosts(client: PoolClient, input: ParsedEngineCommit): Promise<void> {
    for (const mutation of input.costMutations) {
      const costId = mutation.type === 'delete' ? mutation.recordId : mutation.record.costId
      const key = [...scopeParams(input.scope), costId]
      if (mutation.type === 'delete') {
        await client.query(`
          DELETE FROM engine_costs WHERE owner_id = $1 AND workspace_id = $2 AND task_id = $3 AND cost_id = $4
        `, key)
        continue
      }
      assertSameScope(input.scope, mutation.record.scope, 'cost')
      await this.appendIdempotent(client, 'engine_costs', 'cost_id', key, CostEntrySchema, mutation.record, `cost ${costId}`)
    }
  }

  private async applyValues(client: PoolClient, input: ParsedEngineCommit): Promise<void> {
    for (const mutation of input.valueMutations) {
      const valueId = mutation.type === 'delete' ? mutation.recordId : mutation.record.valueId
      const key = [...scopeParams(input.scope), valueId]
      if (mutation.type === 'delete') {
        await client.query(`
          DELETE FROM engine_values WHERE owner_id = $1 AND workspace_id = $2 AND task_id = $3 AND value_id = $4
        `, key)
        continue
      }
      assertSameScope(input.scope, mutation.record.scope, 'value')
      await this.appendIdempotent(client, 'engine_values', 'value_id', key, ValueEventSchema, mutation.record, `value ${valueId}`)
    }
  }

  private async applyBudgetReservations(client: PoolClient, input: ParsedEngineCommit): Promise<void> {
    for (const mutation of input.budgetReservationMutations) {
      const reservationId = mutation.type === 'reserve' ? mutation.record.reservationId : mutation.recordId
      const key = [...scopeParams(input.scope), reservationId]
      if (mutation.type === 'reserve') {
        assertSameScope(input.scope, mutation.record.scope, 'budget reservation')
        const existing = await client.query<PayloadRow>(`
          SELECT payload FROM engine_budget_reservations
          WHERE owner_id = $1 AND workspace_id = $2 AND task_id = $3 AND reservation_id = $4 FOR UPDATE
        `, key)
        if (existing.rows[0]) {
          if (!sameRecord(parsePayload(BudgetReservationRecordSchema, existing.rows[0].payload, `corrupt reservation ${reservationId}`), mutation.record)) {
            throw new EngineStoreConflictError(`reservation ${reservationId} already exists with different data`)
          }
          continue
        }
        const parent = await client.query<PayloadRow>('SELECT payload FROM engine_runs WHERE run_id = $1 FOR UPDATE', [mutation.record.parentRunId])
        const parentRecord = parent.rows[0]
          ? parsePayload(EngineRunRecordSchema, parent.rows[0].payload, `corrupt parent run ${mutation.record.parentRunId}`)
          : undefined
        if (!parentRecord?.budgetLimits) throw new EngineStoreConflictError(`parent run ${mutation.record.parentRunId} has no budget limits`)
        const reservations = await client.query<PayloadRow>(`
          SELECT payload FROM engine_budget_reservations WHERE parent_run_id = $1 FOR UPDATE
        `, [mutation.record.parentRunId])
        const committed = reservations.rows
          .map((row) => parsePayload(BudgetReservationRecordSchema, row.payload, 'corrupt budget reservation'))
          .reduce((total, record) => addBudget(total, committedReservationBudget(record)), zeroBudget())
        assertWithinBudget(addBudget(committed, mutation.record.reserved), parentRecord.budgetLimits)
        await client.query(`
          INSERT INTO engine_budget_reservations
            (owner_id, workspace_id, task_id, reservation_id, parent_run_id, child_run_id, status, payload)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
        `, [...key, mutation.record.parentRunId, mutation.record.childRunId, mutation.record.status, encode(mutation.record)])
      } else {
        const existing = await client.query<PayloadRow>(`
          SELECT payload FROM engine_budget_reservations
          WHERE owner_id = $1 AND workspace_id = $2 AND task_id = $3 AND reservation_id = $4 FOR UPDATE
        `, key)
        if (!existing.rows[0]) throw new EngineStoreConflictError(`reservation ${reservationId} does not exist`)
        const record = parsePayload(BudgetReservationRecordSchema, existing.rows[0].payload, `corrupt reservation ${reservationId}`)
        if (mutation.type === 'settle' && record.status === 'settled' && record.actual
          && !sameRecord(record.actual, mutation.actual)) {
          throw new EngineStoreConflictError(`reservation ${reservationId} already settled differently`)
        }
        const next = mutation.type === 'settle'
          ? { ...record, status: 'settled' as const, actual: mutation.actual, updatedAt: mutation.updatedAt }
          : { ...record, status: 'released' as const, updatedAt: mutation.updatedAt }
        await client.query(`
          UPDATE engine_budget_reservations SET status = $5, payload = $6::jsonb
          WHERE owner_id = $1 AND workspace_id = $2 AND task_id = $3 AND reservation_id = $4
        `, [...key, next.status, encode(next)])
      }
    }
  }

  private async appendIdempotent<T>(
    client: PoolClient,
    table: 'engine_costs' | 'engine_values',
    idColumn: 'cost_id' | 'value_id',
    key: unknown[],
    schema: { parse(value: unknown): T },
    record: T,
    label: string
  ): Promise<void> {
    const result = await client.query<PayloadRow>(`
      SELECT payload FROM ${table}
      WHERE owner_id = $1 AND workspace_id = $2 AND task_id = $3 AND ${idColumn} = $4
      FOR UPDATE
    `, key)
    if (result.rows[0]) {
      const existing = parsePayload(schema, result.rows[0].payload, `corrupt ${label}`)
      if (!sameRecord(existing, record)) throw new EngineStoreConflictError(`${label} already exists with different data`)
      return
    }
    await client.query(`
      INSERT INTO ${table} (owner_id, workspace_id, task_id, ${idColumn}, payload)
      VALUES ($1, $2, $3, $4, $5::jsonb)
    `, [...key, encode(record)])
  }

  private async currentRunVersion(client: PoolClient, runId: string, lock = false): Promise<number> {
    const engine = await client.query<VersionRow>(`
      SELECT version FROM engine_runs WHERE run_id = $1${lock ? ' FOR UPDATE' : ''}
    `, [runId])
    const graph = await client.query<VersionRow>(`
      SELECT version FROM graph_runs WHERE run_id = $1${lock ? ' FOR UPDATE' : ''}
    `, [runId])
    const engineVersion = engine.rows[0] ? asNumber(engine.rows[0].version) : undefined
    const graphVersion = graph.rows[0] ? asNumber(graph.rows[0].version) : undefined
    if (engineVersion !== undefined && graphVersion !== undefined && engineVersion !== graphVersion) {
      throw new EngineStoreCorruptError(`engine and graph run versions diverged for ${runId}`)
    }
    return engineVersion ?? graphVersion ?? 0
  }

  private async currentTaskRevision(client: PoolClient, scope: TaskScope, lock = false): Promise<number> {
    const result = await client.query<RevisionRow>(`
      SELECT revision FROM task_checkpoints
      WHERE owner_id = $1 AND workspace_id = $2 AND task_id = $3${lock ? ' FOR UPDATE' : ''}
    `, scopeParams(scope))
    return result.rows[0] ? asNumber(result.rows[0].revision) : 0
  }

  private async currentModelPolicyRevision(client: PoolClient, scope: TaskScope, lock = false): Promise<number> {
    const result = await client.query<RevisionRow>(`
      SELECT revision FROM task_model_policies
      WHERE owner_id = $1 AND workspace_id = $2 AND task_id = $3${lock ? ' FOR UPDATE' : ''}
    `, scopeParams(scope))
    return result.rows[0] ? asNumber(result.rows[0].revision) : 0
  }

  private async currentHighWater(
    client: PoolClient,
    table: 'engine_event_counters' | 'engine_stream_counters' | 'work_graph_event_counters',
    keyColumn: 'run_id' | 'stream_id',
    key: string
  ): Promise<number> {
    const result = await client.query<HighWaterRow>(`SELECT high_water FROM ${table} WHERE ${keyColumn} = $1`, [key])
    return result.rows[0] ? asNumber(result.rows[0].high_water) : 0
  }

  private async nextHighWater(
    client: PoolClient,
    table: 'engine_event_counters' | 'engine_stream_counters' | 'work_graph_event_counters',
    keyColumn: 'run_id' | 'stream_id',
    key: string
  ): Promise<number> {
    const result = await client.query<HighWaterRow>(`
      INSERT INTO ${table} (${keyColumn}, high_water) VALUES ($1, 1)
      ON CONFLICT(${keyColumn}) DO UPDATE SET high_water = ${table}.high_water + 1
      RETURNING high_water
    `, [key])
    return asNumber(result.rows[0]!.high_water)
  }

  private async nextFence(
    client: PoolClient,
    table: 'engine_work_fences',
    keyColumn: 'work_id',
    key: string
  ): Promise<number> {
    const result = await client.query<FenceRow>(`
      INSERT INTO ${table} (${keyColumn}, fence) VALUES ($1, 1)
      ON CONFLICT(${keyColumn}) DO UPDATE SET fence = ${table}.fence + 1
      RETURNING fence
    `, [key])
    return asNumber(result.rows[0]!.fence)
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await operation(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw translatePostgresConflict(error)
    } finally {
      client.release()
    }
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

function assertSameScope(expected: TaskScope, actual: TaskScope, recordKind: string): void {
  if (encodeTaskScope(expected) !== encodeTaskScope(actual)) {
    throw new EngineStoreCorruptError(`${recordKind} scope does not match commit scope`)
  }
}

function addFilter(clauses: string[], params: unknown[], column: string, value: unknown): void {
  if (value === undefined) return
  params.push(value)
  clauses.push(`${column} = $${params.length}`)
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

async function lockResourceKey(client: PoolClient, resourceKey: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [resourceKey])
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

function parsePayload<T>(schema: { parse(value: unknown): T }, payload: unknown, message: string): T {
  try {
    const value = typeof payload === 'string' ? JSON.parse(payload) : payload
    return schema.parse(value)
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

function asNumber(value: string | number): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new EngineStoreCorruptError(`invalid PostgreSQL integer: ${value}`)
  return parsed
}

function timestampMs(value: Date | string): number {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value)
  if (!Number.isFinite(parsed)) throw new EngineStoreCorruptError(`invalid PostgreSQL timestamp: ${String(value)}`)
  return parsed
}

function translatePostgresConflict(error: unknown): unknown {
  if (error instanceof EngineStoreConflictError || error instanceof EngineStoreCorruptError) return error
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  if (code === '23505' || code === '40001' || code === '40P01') {
    return new EngineStoreConflictError(`PostgreSQL transaction conflict (${code})`)
  }
  return error
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
