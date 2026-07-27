import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FileRunStateStore } from '@qiongqi/adapter-storage'
import { EngineStoreCorruptError } from '@qiongqi/ports'
import type { RunIdentity } from '@qiongqi/contracts'

const identity: RunIdentity = {
  ownerUserId: 'owner-1', workspaceKey: 'workspace-1', threadId: 'thread-1', turnId: 'turn-1', runId: 'run-1'
}

describe('FileRunStateStore corruption', () => {
  it.each([
    ['invalid JSON', '{broken'],
    ['schema-invalid JSON', JSON.stringify({ version: 3, status: 'running' })]
  ])('distinguishes missing snapshots from %s', async (_label, contents) => {
    const directory = await mkdtemp(join(tmpdir(), 'qiongqi-corrupt-run-'))
    const store = new FileRunStateStore(directory)
    await expect(store.load(identity)).resolves.toBeUndefined()
    await store.writeRawSnapshot(identity, contents)
    await expect(store.load(identity)).rejects.toBeInstanceOf(EngineStoreCorruptError)
    await rm(directory, { recursive: true, force: true })
  })
})
