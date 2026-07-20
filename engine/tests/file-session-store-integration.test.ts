import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InMemoryEventBus } from '@qiongqi/adapter-storage'
import { FileThreadStore, FileSessionStore } from '@qiongqi/adapter-storage'
import { RuntimeEventRecorder } from '@qiongqi/services'
import { createThreadRecord } from '@qiongqi/domain'

describe('FileSessionStore integration', () => {
  let dataDir = ''
  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'kun-test-'))
    await mkdir(dataDir, { recursive: true })
  })
  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  it('persists events and items as JSONL with atomic index writes', async () => {
    const threadStore = new FileThreadStore({ dataDir })
    const sessionStore = new FileSessionStore({ dataDir })
    await threadStore.upsert(
      createThreadRecord({ id: 'thr_x', title: 'demo', workspace: '/tmp', model: 'm' })
    )
    await sessionStore.appendEvent('thr_x', {
      kind: 'heartbeat',
      seq: 1,
      timestamp: new Date().toISOString(),
      threadId: 'thr_x'
    })
    const events = await sessionStore.loadEventsSince('thr_x', 0)
    expect(events).toHaveLength(1)
    const content = await readFile(join(dataDir, 'threads', 'thr_x', 'events.jsonl'), 'utf-8')
    expect(content.endsWith('\n')).toBe(true)
    const index = JSON.parse(
      await readFile(join(dataDir, 'threads', 'index.json'), 'utf-8')
    ) as { order: string[] }
    expect(index.order).toContain('thr_x')
  })

  it('handles concurrent file thread index writes in the same millisecond', async () => {
    const spy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    try {
      const threadStore = new FileThreadStore({
        dataDir,
        now: () => new Date('2026-06-03T00:00:00.000Z')
      })
      const threads = Array.from({ length: 20 }, (_, index) =>
        createThreadRecord({
          id: `thr_concurrent_${index}`,
          title: `demo ${index}`,
          workspace: '/tmp',
          model: 'm'
        })
      )

      await expect(Promise.all(threads.map((thread) => threadStore.upsert(thread))))
        .resolves.toHaveLength(20)
      const index = JSON.parse(
        await readFile(join(dataDir, 'threads', 'index.json'), 'utf-8')
      ) as { order: string[] }

      expect(index.order).toEqual(expect.arrayContaining(threads.map((thread) => thread.id)))
    } finally {
      spy.mockRestore()
    }
  })

  it('continues event sequence numbers after a file-backed restart', async () => {
    const sessionStore = new FileSessionStore({ dataDir })
    await sessionStore.appendEvent('thr_seq', {
      kind: 'heartbeat',
      seq: 7,
      timestamp: new Date().toISOString(),
      threadId: 'thr_seq'
    })
    const bus = new InMemoryEventBus()
    const recorder = new RuntimeEventRecorder({
      eventBus: bus,
      sessionStore,
      allocateSeq: (threadId) => bus.allocateSeq(threadId),
      nowIso: () => new Date().toISOString()
    })
    const event = await recorder.record({ kind: 'heartbeat', threadId: 'thr_seq' })
    expect(event.seq).toBe(8)
  })

  it('survives a malformed JSONL line', async () => {
    const sessionStore = new FileSessionStore({ dataDir })
    await mkdir(join(dataDir, 'threads', 'thr_y'), { recursive: true })
    await appendFile(
      join(dataDir, 'threads', 'thr_y', 'events.jsonl'),
      '{"kind":"heartbeat","seq":1,"timestamp":"t","threadId":"thr_y"}\n',
      'utf-8'
    )
    const events = await sessionStore.loadEventsSince('thr_y', 0)
    expect(events).toHaveLength(1)
  })

  it('compacts usage events by retention window while preserving a carryover baseline', async () => {
    const sessionStore = new FileSessionStore({
      dataDir,
      usageEventCompaction: {
        maxBytes: 1,
        retentionDays: 365,
        nowIso: () => '2026-06-03T00:00:00.000Z'
      }
    })
    const usage = (tokens: number) => ({
      promptTokens: tokens,
      completionTokens: 0,
      totalTokens: tokens,
      cacheHitRate: null,
      turns: tokens
    })
    await sessionStore.appendEvent('thr_usage_compact', {
      kind: 'heartbeat',
      seq: 1,
      timestamp: '2024-01-01T00:00:00.000Z',
      threadId: 'thr_usage_compact'
    })
    await sessionStore.appendEvent('thr_usage_compact', {
      kind: 'usage',
      seq: 2,
      timestamp: '2024-01-01T00:00:00.000Z',
      threadId: 'thr_usage_compact',
      model: 'deepseek-chat',
      usage: usage(2)
    })
    await sessionStore.appendEvent('thr_usage_compact', {
      kind: 'usage',
      seq: 3,
      timestamp: '2025-06-02T23:59:59.000Z',
      threadId: 'thr_usage_compact',
      model: 'deepseek-chat',
      usage: usage(3)
    })
    await sessionStore.appendEvent('thr_usage_compact', {
      kind: 'usage',
      seq: 4,
      timestamp: '2025-06-04T00:00:00.000Z',
      threadId: 'thr_usage_compact',
      model: 'deepseek-chat',
      usage: usage(4)
    })
    await sessionStore.appendEvent('thr_usage_compact', {
      kind: 'usage',
      seq: 5,
      timestamp: '2025-06-04T01:00:00.000Z',
      threadId: 'thr_usage_compact',
      model: 'deepseek-chat',
      usage: usage(5)
    })
    await sessionStore.appendEvent('thr_usage_compact', {
      kind: 'usage',
      seq: 6,
      timestamp: '2025-06-04T02:00:00.000Z',
      threadId: 'thr_usage_compact',
      model: 'deepseek-reasoner',
      usage: usage(6)
    })
    await sessionStore.appendEvent('thr_usage_compact', {
      kind: 'usage',
      seq: 7,
      timestamp: '2026-06-02T00:00:00.000Z',
      threadId: 'thr_usage_compact',
      model: 'deepseek-reasoner',
      usage: usage(7)
    })

    const events = await sessionStore.loadEventsSince('thr_usage_compact', 0)
    expect(events.map((event) => event.seq)).toEqual([1, 3, 5, 6, 7])
    expect(await sessionStore.highestSeq('thr_usage_compact')).toBe(7)
  })
})
