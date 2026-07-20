import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileTurnStateStore } from '@qiongqi/loop'
import type { LoopRun } from '@qiongqi/loop'

describe('FileTurnStateStore (LoopRun)', () => {
  it('saves and loads a LoopRun', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qiongqi-state-'))
    try {
      const store = new FileTurnStateStore(dir)
      const run: LoopRun = {
        version: 2, threadId: 't1', turnId: 'tu1', stepIndex: 3, phaseCursor: 2,
        events: [{ kind: 'step:start', stepIndex: 3 }], items: [],
        status: 'running', startedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:01.000Z'
      }
      await store.save(run)
      const loaded = await store.load('t1', 'tu1')
      expect(loaded).toBeDefined()
      expect(loaded?.version).toBe(2)
      expect(loaded?.stepIndex).toBe(3)
      expect(loaded?.phaseCursor).toBe(2)
      expect(loaded?.events.length).toBe(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('upgrades a version 1 blob to LoopRun on load', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qiongqi-state-v1-'))
    try {
      const store = new FileTurnStateStore(dir)
      await mkdir(join(dir, 't1', 'turns', 'tu1'), { recursive: true })
      await writeFile(
        join(dir, 't1', 'turns', 'tu1', 'state.json'),
        JSON.stringify({
          version: 1, threadId: 't1', turnId: 'tu1', stepIndex: 5,
          events: [], items: [], status: 'running',
          startedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
        }),
        'utf8'
      )
      const loaded = await store.load('t1', 'tu1')
      expect(loaded).toBeDefined()
      expect(loaded?.version).toBe(2)
      expect(loaded?.stepIndex).toBe(5)
      expect(loaded?.phaseCursor).toBe(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('deletes a stored run', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qiongqi-state-del-'))
    try {
      const store = new FileTurnStateStore(dir)
      const run: LoopRun = {
        version: 2, threadId: 't1', turnId: 'tu1', stepIndex: 0, phaseCursor: 0,
        events: [], items: [], status: 'running',
        startedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
      }
      await store.save(run)
      await store.delete('t1', 'tu1')
      const loaded = await store.load('t1', 'tu1')
      expect(loaded).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
