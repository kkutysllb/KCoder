import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { SqliteDurableEngineStore } from '@qiongqi/adapter-storage'
import { durableEngineStoreConformance } from './helpers/durable-engine-store-conformance.js'

describe('SqliteDurableEngineStore', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'qiongqi-durable-sqlite-'))
  const stores: SqliteDurableEngineStore[] = []
  let databaseIndex = 0

  afterAll(() => {
    for (const store of stores) store.close()
    rmSync(rootDir, { recursive: true, force: true })
  })

  durableEngineStoreConformance(() => {
    const store = new SqliteDurableEngineStore(join(rootDir, `engine-${databaseIndex++}.sqlite`))
    stores.push(store)
    return store
  })

  it('rejects a stale root version across independent database connections', async () => {
    const path = join(rootDir, 'shared-recovery.sqlite')
    const first = new SqliteDurableEngineStore(path)
    const second = new SqliteDurableEngineStore(path)
    stores.push(first, second)
    const scope = { ownerId: 'owner', workspaceId: 'workspace', taskId: 'sqlite-recovery' }
    const timestamp = '2026-07-27T00:00:00.000Z'
    const record = {
      runId: 'sqlite-shared-run', scope, multiAgentRunId: 'sqlite-shared-run', version: 1,
      status: 'running' as const, desiredState: 'running' as const,
      cursor: { nodeId: 'agent', stepIndex: 0, checkpointSeq: 0 },
      budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
      createdAt: timestamp, updatedAt: timestamp
    }
    await first.commit({
      scope, runId: record.runId, expectedRunVersion: 0, expectedTaskRevision: 0,
      runMutation: { type: 'put', record }
    })
    const stale = await second.loadRun(record.runId)
    await first.commit({
      scope, runId: record.runId, expectedRunVersion: 1, expectedTaskRevision: 0,
      runMutation: { type: 'put', record: { ...record, version: 2, status: 'completed' } }
    })

    await expect(second.commit({
      scope, runId: record.runId, expectedRunVersion: stale!.version, expectedTaskRevision: 0,
      runMutation: { type: 'put', record: { ...stale!, version: 2, status: 'failed' } }
    })).rejects.toMatchObject({ code: 'ENGINE_STORE_CONFLICT' })
    await expect(second.loadRun(record.runId)).resolves.toMatchObject({ version: 2, status: 'completed' })
  })
})
