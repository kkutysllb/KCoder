import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RunIdentity, TaskStateV1 } from '@qiongqi/contracts'
import { FileTaskStateStore, InMemoryTaskStateStore } from '@qiongqi/adapter-storage'

const identity: RunIdentity = {
  ownerUserId: 'owner-1',
  workspaceKey: '/workspace-1',
  threadId: 'thread-1',
  turnId: 'turn-1',
  runId: 'run-1'
}

describe.each([
  ['memory', async () => new InMemoryTaskStateStore()],
  ['file', async () => new FileTaskStateStore(await mkdtemp(join(tmpdir(), 'qiongqi-task-state-')))]
] as const)('%s task state store', (_name, createStore) => {
  it('prepares revisions without exposing them before commit', async () => {
    const store = await createStore()
    const prepared = await store.prepare(task(1), 0)

    expect(await store.load(identity)).toBeUndefined()
    await store.commit(prepared)
    expect(await store.load(identity)).toMatchObject({ revision: 1 })
  })

  it('rejects stale revisions and keeps the active state', async () => {
    const store = await createStore()
    const first = await store.prepare(task(1), 0)
    await store.commit(first)

    await expect(store.prepare(task(2), 0)).rejects.toThrow('task revision conflict')
    expect(await store.load(identity)).toMatchObject({ revision: 1 })

    const second = await store.prepare(task(2), 1)
    await store.commit(second)
    expect(await store.load(identity)).toMatchObject({ revision: 2 })
  })

  it('isolates identical ids by owner and workspace', async () => {
    const store = await createStore()
    const prepared = await store.prepare(task(1), 0)
    await store.commit(prepared)

    expect(await store.load({ ...identity, ownerUserId: 'owner-2' })).toBeUndefined()
    expect(await store.load({ ...identity, workspaceKey: '/workspace-2' })).toBeUndefined()
  })

  it('aborts an uncommitted revision', async () => {
    const store = await createStore()
    const prepared = await store.prepare(task(1), 0)
    await store.abort(prepared)

    expect(await store.load(identity)).toBeUndefined()
    await expect(store.commit(prepared)).rejects.toThrow('prepared task revision')
  })
})

it('file store allows only one concurrent commit for the same expected revision', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qiongqi-task-state-race-'))
  const firstStore = new FileTaskStateStore(root)
  const secondStore = new FileTaskStateStore(root)
  const first = await firstStore.prepare(task(1), 0)
  const second = await secondStore.prepare(task(1, 'alternate'), 0)

  const results = await Promise.allSettled([
    firstStore.commit(first),
    secondStore.commit(second)
  ])

  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  expect((await firstStore.load(identity))?.objective).toMatch(/objective-/)
})

it('file store does not expose raw identity or objective in its active pointer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qiongqi-task-state-path-'))
  const store = new FileTaskStateStore(root)
  const prepared = await store.prepare(task(1), 0)
  await store.commit(prepared)

  const active = await readFile(join(root, 'task-state', prepared.scopeDigest, 'active.json'), 'utf8')
  expect(active).not.toContain(identity.ownerUserId)
  expect(active).not.toContain(identity.workspaceKey)
  expect(active).not.toContain('objective-1')
})

function task(revision: number, suffix = String(revision)): TaskStateV1 {
  return {
    version: 1,
    identity,
    revision,
    source: {
      objectiveItemId: 'user-item-1',
      sourceItemIds: ['user-item-1'],
      sourceDigest: `source-${suffix}`
    },
    objective: `objective-${suffix}`,
    constraints: [],
    completedActions: [],
    pendingActions: [],
    activeSkillIds: [],
    artifacts: [],
    toolLedger: [],
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z'
  }
}
