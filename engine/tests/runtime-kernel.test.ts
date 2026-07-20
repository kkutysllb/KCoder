import { describe, expect, it, vi } from 'vitest'
import { InMemoryRunEventStore, InMemoryRunStateStore } from '@qiongqi/adapter-storage'
import { MiddlewareChain, RuntimeKernel, validateExecutionGraph, type ExecutionGraph } from '@qiongqi/loop'
import type { RunIdentity } from '@qiongqi/contracts'
import type { RunLeaseStore } from '@qiongqi/ports'

const identity: RunIdentity = { ownerUserId: 'u1', threadId: 't1', turnId: 'tu1', runId: 'r1', workspaceKey: 'w1' }

const graph: ExecutionGraph = {
  version: 'test-v1', startNodeId: 'prepare', predicates: ['next'],
  nodes: [
    { id: 'prepare', kind: 'prepare', effect: 'pure', checkpoint: 'both' },
    { id: 'model', kind: 'model', effect: 'model', checkpoint: 'both' },
    { id: 'evaluate', kind: 'evaluate', effect: 'pure', checkpoint: 'both' },
    { id: 'complete', kind: 'complete', effect: 'state', terminal: true, checkpoint: 'after' }
  ],
  edges: [
    { from: 'prepare', to: 'model', when: 'next' },
    { from: 'model', to: 'evaluate', when: 'next' },
    { from: 'evaluate', to: 'complete', when: 'next' }
  ]
}

describe('RuntimeKernel', () => {
  it('rejects invalid lease TTL values', () => {
    expect(() => new RuntimeKernel({
      graph: { version: 'ttl-v1', startNodeId: 'done', predicates: ['next'], nodes: [{ id: 'done', kind: 'model', effect: 'model', terminal: true }], edges: [] },
      snapshots: new InMemoryRunStateStore(),
      events: new InMemoryRunEventStore(),
      leases: new RecordingLeaseStore(),
      holderId: 'ttl-holder',
      leaseTtlMs: 0,
      nodes: { done: () => ({ outcome: { status: 'completed', reason: 'normal_stop', retryable: false } }) }
    })).toThrow(/leaseTtlMs/)
  })
  it('runs a graph, checkpoints each node, and returns a structured outcome', async () => {
    validateExecutionGraph(graph)
    const snapshots = new InMemoryRunStateStore()
    const events = new InMemoryRunEventStore()
    const kernel = new RuntimeKernel({
      graph,
      snapshots,
      events,
      leases: snapshots,
      holderId: 'test-holder',
      nowIso: () => '2026-07-15T00:00:00.000Z',
      nodes: {
        prepare: async () => ({
          condition: 'next',
          value: { taskRevision: 2 },
          commands: [{ type: 'set-task-revision', revision: 2 }]
        }),
        model: async () => ({ condition: 'next' }),
        evaluate: async () => ({ condition: 'next' }),
        complete: async () => ({ outcome: { status: 'completed', reason: 'normal_stop', retryable: false } })
      }
    })
    await expect(kernel.run(identity)).resolves.toMatchObject({ status: 'completed', reason: 'normal_stop' })
    const persisted = await snapshots.load(identity)
    expect(persisted?.status).toBe('completed')
    expect(persisted?.nodeData.prepare).toEqual({ taskRevision: 2 })
    expect(persisted?.taskRevision).toBe(2)
    await expect(events.listAfter(identity, 0)).resolves.toHaveLength(12)
  })

  it('keeps a terminal outcome monotonic when afterNode middleware tries to replace it', async () => {
    const snapshots = new InMemoryRunStateStore()
    const kernel = new RuntimeKernel({
      graph: {
        version: 'terminal-v1',
        startNodeId: 'complete',
        predicates: ['next'],
        nodes: [{ id: 'complete', kind: 'complete', effect: 'state', terminal: true }],
        edges: []
      },
      snapshots,
      events: new InMemoryRunEventStore(),
      leases: snapshots,
      holderId: 'test-holder',
      middleware: new MiddlewareChain([{
        id: 'late-termination',
        version: 1,
        hooks: ['afterNode'],
        handle: async (_context, next) => {
          const result = await next(_context)
          return {
            ...result,
            commands: [{
              type: 'terminate',
              outcome: { status: 'failed', reason: 'runtime_error', retryable: true }
            }]
          }
        }
      }]),
      nodes: {
        complete: () => ({
          outcome: { status: 'completed', reason: 'normal_stop', retryable: false }
        })
      }
    })

    await expect(kernel.run({ ...identity, runId: 'terminal-run' })).resolves.toMatchObject({
      status: 'completed',
      reason: 'normal_stop'
    })
  })

  it('prevents a second RuntimeKernel holder from executing while the run lease is held', async () => {
    const snapshots = new InMemoryRunStateStore()
    let entered = false
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const makeKernel = (holderId: string) => new RuntimeKernel({
      graph: {
        version: 'lease-v1',
        startNodeId: 'prepare',
        predicates: ['next'],
        nodes: [{ id: 'prepare', kind: 'prepare', effect: 'pure', terminal: true }],
        edges: []
      },
      snapshots,
      events: new InMemoryRunEventStore(),
      leases: snapshots,
      holderId,
      nodes: {
        prepare: async () => {
          entered = true
          await gate
          return { outcome: { status: 'completed', reason: 'normal_stop', retryable: false } }
        }
      }
    })
    const first = makeKernel('holder-a').run(identity)
    while (!entered) await new Promise<void>((resolve) => setImmediate(resolve))
    await expect(makeKernel('holder-b').run(identity)).resolves.toMatchObject({
      status: 'failed',
      details: { code: 'lease_unavailable' }
    })
    release()
    await expect(first).resolves.toMatchObject({ status: 'completed' })
  })

  it('renews a long-running lease and stops the heartbeat after completion', async () => {
    vi.useFakeTimers()
    try {
      const leases = new RecordingLeaseStore()
      const snapshots = new InMemoryRunStateStore()
      let entered = false
      let release!: () => void
      const gate = new Promise<void>((resolve) => { release = resolve })
      const kernel = new RuntimeKernel({
        graph: {
          version: 'heartbeat-v1',
          startNodeId: 'long-task',
          predicates: ['next'],
          nodes: [{ id: 'long-task', kind: 'model', effect: 'model', terminal: true }],
          edges: []
        },
        snapshots,
        events: new InMemoryRunEventStore(),
        leases,
        holderId: 'heartbeat-holder',
        leaseTtlMs: 30_000,
        nodes: {
          'long-task': async () => {
            entered = true
            await gate
            return { outcome: { status: 'completed', reason: 'normal_stop', retryable: false } }
          }
        }
      })
      const running = kernel.run(identity)
      while (!entered) await Promise.resolve()

      const boundaryRenewCount = leases.renewCalls.length
      await vi.advanceTimersByTimeAsync(120_000)
      expect(leases.renewCalls).toHaveLength(boundaryRenewCount + 12)
      expect(leases.renewCalls[0]).toEqual({
        identity,
        holderId: 'heartbeat-holder',
        ttlMs: 30_000
      })

      release()
      await expect(running).resolves.toMatchObject({ status: 'completed' })
      expect(leases.releaseCalls).toEqual([{ identity, holderId: 'heartbeat-holder' }])
      const renewCount = leases.renewCalls.length
      await vi.advanceTimersByTimeAsync(100)
      expect(leases.renewCalls).toHaveLength(renewCount)
    } finally {
      vi.useRealTimers()
    }
  })

  it('fences node completion when lease renewal is lost and returns a retryable lease error', async () => {
    vi.useFakeTimers()
    try {
      const leases = new RecordingLeaseStore()
      const snapshots = new InMemoryRunStateStore()
      const events = new InMemoryRunEventStore()
      let entered = false
      let release!: () => void
      const gate = new Promise<void>((resolve) => { release = resolve })
      const kernel = new RuntimeKernel({
        graph: {
          version: 'heartbeat-loss-v1',
          startNodeId: 'long-task',
          predicates: ['next'],
          nodes: [{ id: 'long-task', kind: 'model', effect: 'model', terminal: true }],
          edges: []
        },
        snapshots,
        events,
        leases,
        holderId: 'heartbeat-holder',
        leaseTtlMs: 30,
        nodes: {
          'long-task': async () => {
            entered = true
            await gate
            return { outcome: { status: 'completed', reason: 'normal_stop', retryable: false } }
          }
        }
      })
      const running = kernel.run(identity)
      while (!entered) await Promise.resolve()

      leases.failNextRenewal()
      await vi.advanceTimersByTimeAsync(11)
      release()
      await expect(running).resolves.toMatchObject({
        status: 'failed',
        reason: 'runtime_error',
        retryable: true,
        details: { code: 'lease_unavailable' }
      })
      await expect(events.listAfter(identity, 0)).resolves.toHaveLength(1)
      await expect(snapshots.load(identity)).resolves.toMatchObject({ status: 'running' })
      expect(leases.releaseCalls).toEqual([{ identity, holderId: 'heartbeat-holder' }])
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not replace a committed terminal outcome when the lease is lost in afterNode', async () => {
    vi.useFakeTimers()
    try {
      const leases = new RecordingLeaseStore()
      const snapshots = new InMemoryRunStateStore()
      const events = new InMemoryRunEventStore()
      let enteredAfterNode = false
      let releaseAfterNode!: () => void
      const afterNodeGate = new Promise<void>((resolve) => { releaseAfterNode = resolve })
      const kernel = new RuntimeKernel({
        graph: {
          version: 'heartbeat-terminal-v1',
          startNodeId: 'complete',
          predicates: ['next'],
          nodes: [{ id: 'complete', kind: 'complete', effect: 'state', terminal: true }],
          edges: []
        },
        snapshots,
        events,
        leases,
        holderId: 'heartbeat-holder',
        leaseTtlMs: 30,
        middleware: new MiddlewareChain([{
          id: 'slow-after-node',
          version: 1,
          hooks: ['afterNode'],
          handle: async (context, next) => {
            enteredAfterNode = true
            await afterNodeGate
            return next(context)
          }
        }]),
        nodes: {
          complete: async () => ({
            outcome: { status: 'completed', reason: 'normal_stop', retryable: false }
          })
        }
      })
      const running = kernel.run(identity)
      while (!enteredAfterNode) await Promise.resolve()

      leases.failNextRenewal()
      await vi.advanceTimersByTimeAsync(11)
      releaseAfterNode()
      await expect(running).resolves.toMatchObject({
        status: 'completed',
        reason: 'normal_stop',
        retryable: false
      })
      expect((await events.listAfter(identity, 0)).map((event) => event.eventType)).toEqual([
        'node.started',
        'node.completed'
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not commit beforeNode commands when the lease is lost while middleware is pending', async () => {
    vi.useFakeTimers()
    try {
      const leases = new RecordingLeaseStore()
      const snapshots = new InMemoryRunStateStore()
      const events = new InMemoryRunEventStore()
      let enteredBeforeNode = false
      let releaseBeforeNode!: () => void
      const beforeNodeGate = new Promise<void>((resolve) => { releaseBeforeNode = resolve })
      const kernel = new RuntimeKernel({
        graph: {
          version: 'heartbeat-before-node-v1',
          startNodeId: 'work',
          predicates: ['next'],
          nodes: [{ id: 'work', kind: 'prepare', effect: 'pure', terminal: true }],
          edges: []
        },
        snapshots,
        events,
        leases,
        holderId: 'heartbeat-holder',
        leaseTtlMs: 30,
        middleware: new MiddlewareChain([{
          id: 'slow-before-node',
          version: 1,
          hooks: ['beforeNode'],
          handle: async () => {
            enteredBeforeNode = true
            await beforeNodeGate
            return {
              commands: [
                { type: 'set-task-revision', revision: 99 },
                {
                  type: 'terminate',
                  outcome: { status: 'suspended', reason: 'required_action_missing', retryable: true }
                }
              ]
            }
          }
        }]),
        nodes: {
          work: async () => ({
            outcome: { status: 'completed', reason: 'normal_stop', retryable: false }
          })
        }
      })
      const running = kernel.run(identity)
      while (!enteredBeforeNode) await Promise.resolve()

      leases.failNextRenewal()
      await vi.advanceTimersByTimeAsync(11)
      releaseBeforeNode()
      await expect(running).resolves.toMatchObject({
        status: 'failed',
        retryable: true,
        details: { code: 'lease_unavailable' }
      })
      await expect(snapshots.load(identity)).resolves.toMatchObject({
        status: 'running',
        taskRevision: 0
      })
      expect((await events.listAfter(identity, 0)).map((event) => event.eventType)).toEqual([
        'node.started'
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('treats a synchronous renew throw as lease loss without leaking the heartbeat', async () => {
    vi.useFakeTimers()
    try {
      const leases = new RecordingLeaseStore()
      const snapshots = new InMemoryRunStateStore()
      let entered = false
      let release!: () => void
      const gate = new Promise<void>((resolve) => { release = resolve })
      const kernel = new RuntimeKernel({
        graph: {
          version: 'heartbeat-sync-throw-v1',
          startNodeId: 'work',
          predicates: ['next'],
          nodes: [{ id: 'work', kind: 'model', effect: 'model', terminal: true }],
          edges: []
        },
        snapshots,
        events: new InMemoryRunEventStore(),
        leases,
        holderId: 'heartbeat-holder',
        leaseTtlMs: 30,
        nodes: {
          work: async () => {
            entered = true
            await gate
            return { outcome: { status: 'completed', reason: 'normal_stop', retryable: false } }
          }
        }
      })
      const running = kernel.run(identity)
      while (!entered) await Promise.resolve()

      leases.throwNextRenewal()
      await vi.advanceTimersByTimeAsync(11)
      release()
      await expect(running).resolves.toMatchObject({
        status: 'failed',
        retryable: true,
        details: { code: 'lease_unavailable' }
      })
      const renewCount = leases.renewCalls.length
      await vi.advanceTimersByTimeAsync(100)
      expect(leases.renewCalls).toHaveLength(renewCount)
      expect(leases.releaseCalls).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each(['failed', 'aborted'] as const)('stops lease renewal after a %s outcome', async (status) => {
    vi.useFakeTimers()
    try {
      const leases = new RecordingLeaseStore()
      const kernel = new RuntimeKernel({
        graph: {
          version: `heartbeat-${status}-v1`,
          startNodeId: 'finish',
          predicates: ['next'],
          nodes: [{ id: 'finish', kind: 'complete', effect: 'state', terminal: true }],
          edges: []
        },
        snapshots: new InMemoryRunStateStore(),
        events: new InMemoryRunEventStore(),
        leases,
        holderId: 'heartbeat-holder',
        leaseTtlMs: 30,
        nodes: {
          finish: async () => ({
            outcome: { status, reason: 'runtime_error', retryable: status === 'failed' }
          })
        }
      })

      await expect(kernel.run({ ...identity, runId: `heartbeat-${status}` })).resolves.toMatchObject({ status })
      const renewCount = leases.renewCalls.length
      await vi.advanceTimersByTimeAsync(100)
      expect(leases.renewCalls).toHaveLength(renewCount)
      expect(leases.releaseCalls).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

class RecordingLeaseStore implements RunLeaseStore {
  readonly renewCalls: Array<{ identity: RunIdentity; holderId: string; ttlMs: number }> = []
  readonly releaseCalls: Array<{ identity: RunIdentity; holderId: string }> = []
  private readonly renewResults: boolean[]
  private throwOnNextRenewal = false

  constructor(renewResults: boolean[] = []) {
    this.renewResults = [...renewResults]
  }

  failNextRenewal(): void {
    this.renewResults.push(false)
  }

  throwNextRenewal(): void {
    this.throwOnNextRenewal = true
  }

  async acquire(_identity: RunIdentity, _holderId: string, ttlMs: number): Promise<{ acquired: boolean; expiresAt?: string }> {
    return { acquired: true, expiresAt: new Date(Date.now() + ttlMs).toISOString() }
  }

  renew(identity: RunIdentity, holderId: string, ttlMs: number): Promise<boolean> {
    this.renewCalls.push({ identity, holderId, ttlMs })
    if (this.throwOnNextRenewal) {
      this.throwOnNextRenewal = false
      throw new Error('synchronous renew failure')
    }
    return Promise.resolve(this.renewResults.shift() ?? true)
  }

  async release(identity: RunIdentity, holderId: string): Promise<void> {
    this.releaseCalls.push({ identity, holderId })
  }
}
