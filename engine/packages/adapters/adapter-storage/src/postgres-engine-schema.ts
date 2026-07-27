import type { Pool } from 'pg'

export function assertPostgresSchemaName(schema: string): void {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) {
    throw new Error(`invalid PostgreSQL schema name: ${schema}`)
  }
}

export async function ensurePostgresEngineSchema(pool: Pool, schema: string): Promise<void> {
  assertPostgresSchemaName(schema)
  const namespace = `"${schema}"`
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${namespace}`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${namespace}.engine_runs (
      run_id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      version BIGINT NOT NULL,
      status TEXT NOT NULL,
      desired_state TEXT NOT NULL,
      payload JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS engine_runs_scope_idx
      ON ${namespace}.engine_runs(owner_id, workspace_id, task_id);

    CREATE TABLE IF NOT EXISTS ${namespace}.graph_revisions (
      graph_id TEXT NOT NULL,
      revision BIGINT NOT NULL,
      graph_digest TEXT NOT NULL,
      payload JSONB NOT NULL,
      PRIMARY KEY(graph_id, revision)
    );
    CREATE TABLE IF NOT EXISTS ${namespace}.graph_runs (
      run_id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      graph_id TEXT NOT NULL,
      graph_revision BIGINT NOT NULL,
      version BIGINT NOT NULL,
      status TEXT NOT NULL,
      payload JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS graph_runs_scope_idx
      ON ${namespace}.graph_runs(owner_id, workspace_id, task_id);
    CREATE TABLE IF NOT EXISTS ${namespace}.work_graph_event_counters (
      run_id TEXT PRIMARY KEY,
      high_water BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ${namespace}.work_graph_events (
      run_id TEXT NOT NULL,
      seq BIGINT NOT NULL,
      event_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      timestamp TIMESTAMPTZ NOT NULL,
      payload JSONB NOT NULL,
      PRIMARY KEY(run_id, seq),
      UNIQUE(run_id, event_id)
    );
    CREATE TABLE IF NOT EXISTS ${namespace}.task_model_policies (
      owner_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      revision BIGINT NOT NULL,
      payload JSONB NOT NULL,
      PRIMARY KEY(owner_id, workspace_id, task_id)
    );
    CREATE TABLE IF NOT EXISTS ${namespace}.human_checkpoints (
      checkpoint_id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      status TEXT NOT NULL,
      resolution_token TEXT NOT NULL,
      payload JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS human_checkpoints_run_idx
      ON ${namespace}.human_checkpoints(run_id, status);
    CREATE TABLE IF NOT EXISTS ${namespace}.resource_claims (
      resource_key TEXT NOT NULL,
      claim_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      status TEXT NOT NULL,
      payload JSONB NOT NULL,
      PRIMARY KEY(resource_key, claim_id)
    );
    CREATE INDEX IF NOT EXISTS resource_claims_status_idx
      ON ${namespace}.resource_claims(resource_key, status);

    CREATE TABLE IF NOT EXISTS ${namespace}.task_checkpoints (
      owner_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      revision BIGINT NOT NULL,
      status TEXT NOT NULL,
      payload JSONB NOT NULL,
      PRIMARY KEY(owner_id, workspace_id, task_id)
    );
    CREATE TABLE IF NOT EXISTS ${namespace}.context_checkpoints (
      owner_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      context_id TEXT NOT NULL,
      revision BIGINT NOT NULL,
      payload JSONB NOT NULL,
      PRIMARY KEY(owner_id, workspace_id, task_id, context_id)
    );
    CREATE TABLE IF NOT EXISTS ${namespace}.execution_ledger (
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
      created_at TIMESTAMPTZ NOT NULL,
      payload JSONB NOT NULL,
      PRIMARY KEY(owner_id, workspace_id, task_id, operation_id)
    );
    CREATE INDEX IF NOT EXISTS execution_ledger_query_idx
      ON ${namespace}.execution_ledger(owner_id, workspace_id, task_id, kind, status);
    CREATE INDEX IF NOT EXISTS execution_ledger_model_idx
      ON ${namespace}.execution_ledger(owner_id, workspace_id, task_id, logical_request_key);
    CREATE INDEX IF NOT EXISTS execution_ledger_tool_idx
      ON ${namespace}.execution_ledger(owner_id, workspace_id, task_id, exact_fingerprint, semantic_key);

    CREATE TABLE IF NOT EXISTS ${namespace}.task_memories (
      owner_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      memory_id TEXT NOT NULL,
      namespace TEXT NOT NULL,
      revision BIGINT NOT NULL,
      payload JSONB NOT NULL,
      PRIMARY KEY(owner_id, workspace_id, task_id, memory_id)
    );
    CREATE TABLE IF NOT EXISTS ${namespace}.engine_event_counters (
      run_id TEXT PRIMARY KEY,
      high_water BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ${namespace}.engine_events (
      run_id TEXT NOT NULL,
      seq BIGINT NOT NULL,
      event_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      timestamp TIMESTAMPTZ NOT NULL,
      payload JSONB NOT NULL,
      PRIMARY KEY(run_id, seq),
      UNIQUE(run_id, event_id)
    );
    CREATE TABLE IF NOT EXISTS ${namespace}.engine_stream_counters (
      stream_id TEXT PRIMARY KEY,
      high_water BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ${namespace}.engine_stream_events (
      stream_id TEXT NOT NULL,
      seq BIGINT NOT NULL,
      owner_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      kind TEXT NOT NULL,
      timestamp TIMESTAMPTZ NOT NULL,
      payload JSONB NOT NULL,
      PRIMARY KEY(stream_id, seq)
    );
    CREATE INDEX IF NOT EXISTS engine_stream_scope_idx
      ON ${namespace}.engine_stream_events(owner_id, workspace_id, task_id);
    CREATE TABLE IF NOT EXISTS ${namespace}.engine_stream_acks (
      stream_id TEXT NOT NULL,
      subscriber_id TEXT NOT NULL,
      through_seq BIGINT NOT NULL,
      PRIMARY KEY(stream_id, subscriber_id)
    );
    CREATE TABLE IF NOT EXISTS ${namespace}.engine_outbox (
      work_id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload_ref TEXT NOT NULL,
      status TEXT NOT NULL,
      available_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      completed_at TIMESTAMPTZ,
      claim_payload JSONB,
      claim_expires_at TIMESTAMPTZ,
      payload JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS engine_outbox_claim_idx
      ON ${namespace}.engine_outbox(status, kind, available_at, claim_expires_at);
    CREATE TABLE IF NOT EXISTS ${namespace}.engine_costs (
      owner_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      cost_id TEXT NOT NULL,
      payload JSONB NOT NULL,
      PRIMARY KEY(owner_id, workspace_id, task_id, cost_id)
    );
    CREATE TABLE IF NOT EXISTS ${namespace}.engine_values (
      owner_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      value_id TEXT NOT NULL,
      payload JSONB NOT NULL,
      PRIMARY KEY(owner_id, workspace_id, task_id, value_id)
    );
    CREATE TABLE IF NOT EXISTS ${namespace}.engine_budget_reservations (
      owner_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      reservation_id TEXT NOT NULL,
      parent_run_id TEXT NOT NULL,
      child_run_id TEXT NOT NULL,
      status TEXT NOT NULL,
      payload JSONB NOT NULL,
      PRIMARY KEY(owner_id, workspace_id, task_id, reservation_id)
    );
    CREATE INDEX IF NOT EXISTS engine_budget_reservations_parent_idx
      ON ${namespace}.engine_budget_reservations(parent_run_id, status);
    CREATE TABLE IF NOT EXISTS ${namespace}.engine_lease_fences (
      run_id TEXT PRIMARY KEY,
      fence BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ${namespace}.engine_leases (
      run_id TEXT PRIMARY KEY,
      holder_id TEXT NOT NULL,
      fence BIGINT NOT NULL,
      token TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      payload JSONB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ${namespace}.engine_work_fences (
      work_id TEXT PRIMARY KEY,
      fence BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ${namespace}.worker_inbox (
      work_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      available_at TIMESTAMPTZ NOT NULL,
      fence BIGINT NOT NULL DEFAULT 0,
      payload JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS worker_inbox_claim_idx
      ON ${namespace}.worker_inbox(status, kind, available_at);
  `)
}
