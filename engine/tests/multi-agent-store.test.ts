import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  FileEventedV2WorkerRegistryStore,
  FileMailboxStore,
  FileMultiAgentRunStore,
  InMemoryEventedV2WorkerRegistryStore,
  InMemoryMailboxStore,
  InMemoryMultiAgentRunStore
} from '@qiongqi/adapter-storage'
import type { EventedV2WorkerRegistryStore, MailboxStore, MultiAgentRunStore } from '@qiongqi/ports'
import type { MailboxMessage, MultiAgentRun } from '@qiongqi/contracts'

describe('multi-agent runtime stores', () => {
  it('defines store contracts for runs and mailbox messages', async () => {
    const runs: MultiAgentRun[] = []
    const messages: MailboxMessage[] = []
    const workers: Awaited<ReturnType<EventedV2WorkerRegistryStore['recordHeartbeat']>>[] = []
    const runStore: MultiAgentRunStore = {
      save: async (run) => { runs.push(run) },
      load: async (runId) => runs.find((run) => run.runId === runId),
      update: async (runId, mutate) => {
        const current = runs.find((run) => run.runId === runId)
        if (!current) throw new Error(`MultiAgentRun not found: ${runId}`)
        const next = await mutate(current)
        const index = runs.findIndex((run) => run.runId === runId)
        runs[index] = next
        return next
      },
      listAll: async () => runs.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      listWithPendingOutbox: async () => runs.filter((run) => run.outbox.some((intent) => intent.status === 'pending')),
      listByThread: async (threadId) => runs.filter((run) => run.threadId === threadId),
      delete: async (runId) => {
        const index = runs.findIndex((run) => run.runId === runId)
        if (index >= 0) runs.splice(index, 1)
      }
    }
    const mailbox: MailboxStore = {
      enqueue: async (message) => { messages.push(message) },
      claimNext: async (agentId) => messages.find((message) => message.toAgentId === agentId && message.status === 'queued'),
      complete: async (messageId) => {
        const message = messages.find((candidate) => candidate.messageId === messageId)
        if (message) message.status = 'completed'
      },
      listForRun: async (runId) => messages.filter((message) => message.runId === runId)
    }
    const workerRegistry: EventedV2WorkerRegistryStore = {
      recordHeartbeat: async (heartbeat) => {
        const record = {
          workerId: heartbeat.workerId,
          role: heartbeat.role,
          status: 'online' as const,
          agentIds: heartbeat.agentIds,
          startedAt: heartbeat.heartbeatAt,
          heartbeatAt: heartbeat.heartbeatAt,
          expiresAt: new Date(Date.parse(heartbeat.heartbeatAt) + heartbeat.ttlMs).toISOString(),
          updatedAt: heartbeat.heartbeatAt
        }
        workers.push(record)
        return record
      },
      list: async () => workers
    }

    await runStore.save(baseRun())
    await mailbox.enqueue(baseMessage())

    expect(await runStore.load('mar_1')).toBeDefined()
    expect(await mailbox.claimNext('researcher')).toMatchObject({ messageId: 'msg_1' })
    expect(await workerRegistry.recordHeartbeat({
      workerId: 'worker_a',
      role: 'remote_agent',
      agentIds: ['researcher'],
      heartbeatAt: '2026-07-21T00:00:00.000Z',
      ttlMs: 1000
    })).toMatchObject({ workerId: 'worker_a', status: 'online' })
  })
})

let mailboxNowMs = Date.parse('2026-07-21T00:00:00.000Z')

describe.each([
  ['memory', async () => ({
    runs: new InMemoryMultiAgentRunStore(),
    mailbox: new InMemoryMailboxStore({ nowMs: () => mailboxNowMs }),
    workerRegistry: new InMemoryEventedV2WorkerRegistryStore()
  })],
  ['file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qiongqi-multi-agent-'))
    return {
      root,
      runs: new FileMultiAgentRunStore(root),
      mailbox: new FileMailboxStore(root, { nowMs: () => mailboxNowMs }),
      workerRegistry: new FileEventedV2WorkerRegistryStore(root)
    }
  }]
] as const)('%s multi-agent stores', (_name, factory) => {
  it('saves, loads, lists, claims, and completes records', async () => {
    const created = await factory()
    try {
      await created.runs.save(baseRun())
      await created.mailbox.enqueue(baseMessage())

      expect(await created.runs.load('mar_1')).toMatchObject({ runId: 'mar_1' })
      expect(await created.runs.listAll?.()).toMatchObject([{ runId: 'mar_1' }])
      expect(await created.runs.listByThread('thread_1')).toHaveLength(1)

      const claimed = await created.mailbox.claimNext('researcher')
      expect(claimed).toMatchObject({ status: 'delivered', messageId: 'msg_1' })

      await created.mailbox.complete('msg_1')
      expect(await created.mailbox.listForRun('mar_1')).toMatchObject([{ status: 'completed' }])

      await created.runs.delete('mar_1')
      expect(await created.runs.load('mar_1')).toBeUndefined()
    } finally {
      if ('root' in created) await rm(created.root, { recursive: true, force: true })
    }
  })

  it('leases claimed mailbox messages and makes expired claims available to another worker', async () => {
    const created = await factory()
    try {
      await created.mailbox.enqueue(baseMessage())

      const first = await created.mailbox.claimNext('researcher', { holderId: 'worker_a', ttlMs: 1000 })
      expect(first).toMatchObject({
        status: 'delivered',
        claimLease: { holderId: 'worker_a', epoch: 1 }
      })
      await expect(created.mailbox.claimNext('researcher', { holderId: 'worker_b', ttlMs: 1000 })).resolves.toBeUndefined()

      mailboxNowMs += 1001
      const second = await created.mailbox.claimNext('researcher', { holderId: 'worker_b', ttlMs: 1000 })
      expect(second).toMatchObject({
        status: 'delivered',
        claimLease: { holderId: 'worker_b', epoch: 2 }
      })

      await expect(created.mailbox.complete('msg_1', 'completed', first?.claimLease)).rejects.toThrow(/stale mailbox claim/i)
      await created.mailbox.complete('msg_1', 'completed', second?.claimLease)
      expect(await created.mailbox.listForRun('mar_1')).toMatchObject([{ status: 'completed' }])
    } finally {
      mailboxNowMs = Date.parse('2026-07-21T00:00:00.000Z')
      if ('root' in created) await rm(created.root, { recursive: true, force: true })
    }
  })

  it('treats repeated mailbox completion with the same terminal status as idempotent', async () => {
    const created = await factory()
    try {
      await created.mailbox.enqueue(baseMessage())

      const claimed = await created.mailbox.claimNext('researcher', { holderId: 'worker_a', ttlMs: 1000 })
      expect(claimed).toMatchObject({
        status: 'delivered',
        claimLease: { holderId: 'worker_a', epoch: 1 }
      })

      await created.mailbox.complete('msg_1', 'failed', claimed?.claimLease)
      await created.mailbox.complete('msg_1', 'failed', claimed?.claimLease)
      await expect(created.mailbox.complete('msg_1', 'completed', claimed?.claimLease)).rejects.toThrow(/stale mailbox claim/i)

      expect(await created.mailbox.listForRun('mar_1')).toMatchObject([{ status: 'failed' }])
    } finally {
      if ('root' in created) await rm(created.root, { recursive: true, force: true })
    }
  })

  it('serializes concurrent run updates through the store', async () => {
    const created = await factory()
    try {
      await created.runs.save(baseRun())

      await Promise.all([
        created.runs.update('mar_1', async (run) => ({
          ...run,
          agentRuns: [...run.agentRuns, {
            agentRunId: 'agent_run_a',
            agentId: 'agent_a',
            nodeId: 'node_a',
            status: 'queued',
            startedAt: '2026-07-21T00:00:01.000Z',
            updatedAt: '2026-07-21T00:00:01.000Z'
          }]
        })),
        created.runs.update('mar_1', async (run) => ({
          ...run,
          agentRuns: [...run.agentRuns, {
            agentRunId: 'agent_run_b',
            agentId: 'agent_b',
            nodeId: 'node_b',
            status: 'queued',
            startedAt: '2026-07-21T00:00:02.000Z',
            updatedAt: '2026-07-21T00:00:02.000Z'
          }]
        }))
      ])

      expect((await created.runs.load('mar_1'))?.agentRuns.map((agentRun) => agentRun.agentId).sort()).toEqual([
        'agent_a',
        'agent_b'
      ])
    } finally {
      if ('root' in created) await rm(created.root, { recursive: true, force: true })
    }
  })

  it('enforces run lease fencing for stale cross-worker updates', async () => {
    const created = await factory()
    try {
      await created.runs.save(baseRun())

      const first = await created.runs.acquireLease?.('mar_1', 'worker_a', 60_000)
      expect(first).toMatchObject({ acquired: true })
      expect(first?.fence).toBeDefined()
      const blocked = await created.runs.acquireLease?.('mar_1', 'worker_b', 60_000)
      expect(blocked).toMatchObject({ acquired: false })

      await created.runs.update('mar_1', (run) => ({
        ...run,
        status: 'suspended',
        updatedAt: '2026-07-21T00:00:01.000Z'
      }), { fence: first?.fence })

      await created.runs.releaseLease?.('mar_1', 'worker_a', first?.fence)
      const second = await created.runs.acquireLease?.('mar_1', 'worker_b', 60_000)
      expect(second).toMatchObject({ acquired: true })
      expect(second?.fence?.epoch).toBeGreaterThan(first?.fence?.epoch ?? 0)

      await expect(created.runs.update('mar_1', (run) => ({
        ...run,
        status: 'completed',
        updatedAt: '2026-07-21T00:00:02.000Z'
      }), { fence: first?.fence })).rejects.toThrow(/stale lease fence/i)
    } finally {
      if ('root' in created) await rm(created.root, { recursive: true, force: true })
    }
  })

  it('rejects compare-and-swap updates with a stale run version', async () => {
    const created = await factory()
    try {
      await created.runs.save(baseRun())
      const initialVersion = await created.runs.loadVersion?.('mar_1')
      expect(initialVersion).toBe(0)

      await created.runs.update('mar_1', (run) => ({
        ...run,
        status: 'suspended',
        updatedAt: '2026-07-21T00:00:01.000Z'
      }), { expectedVersion: initialVersion })

      expect(await created.runs.loadVersion?.('mar_1')).toBe(1)
      await expect(created.runs.update('mar_1', (run) => ({
        ...run,
        status: 'completed',
        updatedAt: '2026-07-21T00:00:02.000Z'
      }), { expectedVersion: initialVersion })).rejects.toThrow(/version/i)
    } finally {
      if ('root' in created) await rm(created.root, { recursive: true, force: true })
    }
  })

  it('lists runs with pending outbox intents for reconciliation', async () => {
    const created = await factory()
    try {
      await created.runs.save(baseRun())
      await created.runs.save(runWithPendingOutbox())

      expect(await created.runs.listWithPendingOutbox()).toMatchObject([{ runId: 'mar_pending' }])
    } finally {
      if ('root' in created) await rm(created.root, { recursive: true, force: true })
    }
  })

  it('lists all runs across threads for management projections', async () => {
    const created = await factory()
    try {
      await created.runs.save({ ...baseRun(), runId: 'mar_a', threadId: 'thread_2', createdAt: '2026-07-21T00:00:02.000Z' })
      await created.runs.save({ ...baseRun(), runId: 'mar_b', threadId: 'thread_1', createdAt: '2026-07-21T00:00:01.000Z' })

      expect(await created.runs.listAll?.()).toMatchObject([
        { runId: 'mar_b', threadId: 'thread_1' },
        { runId: 'mar_a', threadId: 'thread_2' }
      ])
    } finally {
      if ('root' in created) await rm(created.root, { recursive: true, force: true })
    }
  })

  it('records evented_v2 worker heartbeats and reports expired workers', async () => {
    const created = await factory()
    try {
      await created.workerRegistry.recordHeartbeat({
        workerId: 'worker_a',
        role: 'remote_agent',
        agentIds: ['researcher'],
        heartbeatAt: '2026-07-21T00:00:00.000Z',
        ttlMs: 1000
      })
      await created.workerRegistry.recordHeartbeat({
        workerId: 'worker_a',
        role: 'remote_agent',
        agentIds: ['researcher', 'writer'],
        heartbeatAt: '2026-07-21T00:00:00.500Z',
        ttlMs: 1000
      })

      expect(await created.workerRegistry.list({ nowIso: '2026-07-21T00:00:01.000Z' })).toMatchObject([
        {
          workerId: 'worker_a',
          role: 'remote_agent',
          status: 'online',
          agentIds: ['researcher', 'writer'],
          startedAt: '2026-07-21T00:00:00.000Z',
          heartbeatAt: '2026-07-21T00:00:00.500Z',
          expiresAt: '2026-07-21T00:00:01.500Z'
        }
      ])
      expect(await created.workerRegistry.list({ nowIso: '2026-07-21T00:00:02.000Z' })).toMatchObject([
        {
          workerId: 'worker_a',
          status: 'expired'
        }
      ])
    } finally {
      if ('root' in created) await rm(created.root, { recursive: true, force: true })
    }
  })
})

describe('file multi-agent store path safety', () => {
  it('rejects run path segments containing parent directory traversal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qiongqi-multi-agent-'))
    const runs = new FileMultiAgentRunStore(root)
    try {
      await expect(runs.save({ ...baseRun(), runId: '../escape' })).rejects.toThrow()
      await expect(runs.save({ ...baseRun(), threadId: '../escape' })).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects mailbox path segments containing parent directory traversal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qiongqi-multi-agent-'))
    const mailbox = new FileMailboxStore(root)
    try {
      await expect(mailbox.enqueue({ ...baseMessage(), runId: '../escape' })).rejects.toThrow()
      await expect(mailbox.enqueue({ ...baseMessage(), messageId: '../escape' })).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('file multi-agent store persistence behavior', () => {
  it('rejects corrupt run JSON when listing a thread', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qiongqi-multi-agent-'))
    const runs = new FileMultiAgentRunStore(root)
    try {
      const dir = join(root, 'multi-agent-runs', 'thread_1')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'mar_bad.json'), '{bad json', 'utf8')

      await expect(runs.listByThread('thread_1')).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects corrupt mailbox JSON when listing messages for a run', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qiongqi-multi-agent-'))
    const mailbox = new FileMailboxStore(root)
    try {
      const dir = join(root, 'mailbox', 'mar_1')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'msg_bad.json'), '{bad json', 'utf8')

      await expect(mailbox.listForRun('mar_1')).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('moves an existing run record when saving the same runId under a different thread', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qiongqi-multi-agent-'))
    const runs = new FileMultiAgentRunStore(root)
    try {
      await runs.save(baseRun())
      await runs.save({ ...baseRun(), threadId: 'thread_2' })

      expect(await runs.load('mar_1')).toMatchObject({ threadId: 'thread_2' })
      expect(await runs.listByThread('thread_1')).toHaveLength(0)
      expect(await runs.listByThread('thread_2')).toHaveLength(1)

      await runs.delete('mar_1')
      expect(await runs.listByThread('thread_2')).toHaveLength(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('delivers a queued file mailbox message to only one concurrent claimant', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qiongqi-multi-agent-'))
    const mailbox = new FileMailboxStore(root)
    try {
      await mailbox.enqueue(baseMessage())

      const claimed = await Promise.all([
        mailbox.claimNext('researcher'),
        mailbox.claimNext('researcher')
      ])

      expect(claimed.filter(Boolean)).toHaveLength(1)
      expect(await mailbox.listForRun('mar_1')).toMatchObject([{ messageId: 'msg_1', status: 'delivered' }])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not let a late file mailbox enqueue downgrade a delivered message', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qiongqi-multi-agent-'))
    const mailbox = new FileMailboxStore(root)
    try {
      await mailbox.enqueue(baseMessage())
      expect(await mailbox.claimNext('researcher')).toMatchObject({ messageId: 'msg_1', status: 'delivered' })

      await mailbox.enqueue(baseMessage())

      expect(await mailbox.listForRun('mar_1')).toMatchObject([{ messageId: 'msg_1', status: 'delivered' }])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

function baseRun(): MultiAgentRun {
  return {
    version: 1,
    runId: 'mar_1',
    threadId: 'thread_1',
    turnId: 'turn_1',
    workspaceKey: 'workspace_1',
    status: 'running',
    graphId: 'graph_default',
    activeNodeId: 'manager',
    activeAgentStack: ['manager'],
    branchStatus: {},
    agentRuns: [],
    events: [],
    outbox: [],
    retryCounters: {},
    budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z'
  }
}

function baseMessage(): MailboxMessage {
  return {
    messageId: 'msg_1',
    envelopeId: 'env_1',
    runId: 'mar_1',
    fromAgentId: 'manager',
    toAgentId: 'researcher',
    status: 'queued',
    payload: { prompt: 'Research runtime design.' },
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z'
  }
}

function runWithPendingOutbox(): MultiAgentRun {
  return {
    ...baseRun(),
    runId: 'mar_pending',
    outbox: [{
      outboxId: 'outbox_1',
      kind: 'mailbox_enqueue',
      status: 'pending',
      message: { ...baseMessage(), runId: 'mar_pending' },
      createdAt: '2026-07-21T00:00:00.000Z',
      updatedAt: '2026-07-21T00:00:00.000Z'
    }]
  }
}
