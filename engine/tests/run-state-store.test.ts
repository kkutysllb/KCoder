import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runtimeScopeDigest } from '@qiongqi/adapter-storage'
import { FileRunStateStore, InMemoryRunStateStore } from '@qiongqi/adapter-storage'
import type { RunIdentity, RunStateV3 } from '@qiongqi/contracts'

const identity: RunIdentity = {
  ownerUserId: 'u1', threadId: 't1', turnId: 'tu1', runId: 'r1', workspaceKey: 'w1'
}

function state(): RunStateV3 {
  return {
    version: 3,
    graphVersion: 'kernel-v3-default',
    runtimeMode: 'kernel_v3',
    ...identity,
    status: 'running',
    cursor: { stepIndex: 2, nodeId: 'invoke-model', attempt: 1, checkpointSeq: 4 },
    budgets: { stepsUsed: 2, toolCallsUsed: 1, inputTokens: 10, outputTokens: 4, costUsd: 0.01 },
    recovery: { attempts: 0, maxAttempts: 1 },
    middleware: {},
    pendingEffects: [],
    committedEffects: [],
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:01.000Z'
  }
}

describe.each([
  ['memory', () => new InMemoryRunStateStore()],
  ['file', async () => new FileRunStateStore(await mkdtemp(join(tmpdir(), 'qiongqi-run-state-')))]
])('run state store (%s)', (_name, create) => {
  it('round-trips snapshots and enforces lease ownership', async () => {
    const store = await create()
    await store.save(state())
    await expect(store.load(identity)).resolves.toMatchObject({ cursor: { stepIndex: 2 } })

    await expect(store.acquire(identity, 'holder-a', 60_000)).resolves.toMatchObject({ acquired: true })
    await expect(store.acquire(identity, 'holder-b', 60_000)).resolves.toMatchObject({ acquired: false })
    await expect(store.renew(identity, 'holder-b', 60_000)).resolves.toBe(false)
    await store.release(identity, 'holder-a')
    await expect(store.acquire(identity, 'holder-b', 60_000)).resolves.toMatchObject({ acquired: true })

    if (store instanceof FileRunStateStore) await rm(store.rootDir, { recursive: true, force: true })
  })

  it('isolates equal run ids by owner and workspace', async () => {
    const store = await create()
    const other = { ...identity, ownerUserId: 'u2', workspaceKey: 'w2' }
    await expect(store.acquire(identity, 'holder-a', 60_000)).resolves.toMatchObject({ acquired: true })
    await expect(store.acquire(other, 'holder-b', 60_000)).resolves.toMatchObject({ acquired: true })
    await store.release(identity, 'holder-a')
    await store.release(other, 'holder-b')
  })
})

describe('FileRunStateStore recovery behavior', () => {
  it('ignores a malformed snapshot instead of throwing', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'qiongqi-run-state-invalid-'))
    const store = new FileRunStateStore(rootDir)
    await store.writeRawSnapshot(identity, '{broken')
    await expect(store.load(identity)).resolves.toBeUndefined()
    await rm(rootDir, { recursive: true, force: true })
  })

  it('returns a fencing token and rejects stale renew, release, and snapshot writes', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'qiongqi-run-state-fence-'))
    const store = new FileRunStateStore(rootDir)
    const first = await store.acquire(identity, 'holder-a', 1)
    expect(first.fence).toBeDefined()
    await new Promise((resolve) => setTimeout(resolve, 10))
    const second = await store.acquire(identity, 'holder-b', 60_000)
    expect(second.acquired).toBe(true)
    expect(second.fence?.epoch).toBeGreaterThan(first.fence?.epoch ?? 0)
    await expect(store.renew(identity, 'holder-a', first.fence, 60_000)).resolves.toBe(false)
    await expect(store.release(identity, 'holder-a', first.fence)).resolves.toBeUndefined()
    await expect(store.save(state(), first.fence)).rejects.toThrow(/fence|lease/i)
    await rm(rootDir, { recursive: true, force: true })
  })

  it('allows exactly one winner for concurrent acquisition', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'qiongqi-run-state-race-'))
    const store = new FileRunStateStore(rootDir)
    const results = await Promise.all([
      store.acquire(identity, 'holder-a', 60_000),
      store.acquire(identity, 'holder-b', 60_000)
    ])
    expect(results.filter((result) => result.acquired)).toHaveLength(1)
    await rm(rootDir, { recursive: true, force: true })
  })

  it('reclaims a lock directory left by a dead acquisition process', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'qiongqi-run-state-stale-lock-'))
    const store = new FileRunStateStore(rootDir)
    const lockPath = join(rootDir, 'leases', `${runtimeScopeDigest(identity)}.json.lock`)
    await mkdir(lockPath, { recursive: true })
    await writeFile(join(lockPath, 'owner.json'), JSON.stringify({ pid: 999999, createdAtMs: Date.now(), key: 'test' }))
    await expect(store.acquire(identity, 'holder-a', 60_000)).resolves.toMatchObject({ acquired: true })
    await store.release(identity, 'holder-a')
    await rm(rootDir, { recursive: true, force: true })
  })
})
