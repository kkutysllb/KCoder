import { describe, expect, it } from 'vitest'
import { InMemoryRunEventStore, InMemoryRunStateStore } from '@qiongqi/adapter-storage'
import type { RunIdentity } from '@qiongqi/contracts'
import {
  MiddlewareChain,
  RuntimeKernel,
  type ExecutionGraph,
  type RuntimeMiddleware
} from '@qiongqi/loop'

const identity: RunIdentity = {
  ownerUserId: 'owner-after',
  workspaceKey: 'workspace-after',
  threadId: 'thread-after',
  turnId: 'turn-after',
  runId: 'run-after'
}

const graph: ExecutionGraph = {
  version: 'after-middleware-v1',
  startNodeId: 'work',
  predicates: ['next'],
  nodes: [
    { id: 'work', kind: 'work', effect: 'state', checkpoint: 'both' },
    { id: 'complete', kind: 'complete', effect: 'state', terminal: true, checkpoint: 'both' }
  ],
  edges: [{ from: 'work', to: 'complete', when: 'next' }]
}

function middleware(calls: string[], terminate = false, afterRuns: string[] = []): MiddlewareChain {
  const item: RuntimeMiddleware = {
    id: 'facts-governance',
    version: 1,
    hooks: ['afterNode', 'afterRun'],
    handle: async (context, next) => {
      if (context.hook === 'afterRun') {
        afterRuns.push('afterRun')
        return next(context)
      }
      if (context.node?.id !== 'work') return next(context)
      calls.push(String(context.facts?.decision))
      return {
        commands: terminate
          ? [{
              type: 'terminate',
              outcome: {
                status: 'degraded',
                reason: 'step_capped',
                retryable: false,
                details: { code: 'facts_terminate' }
              }
            }]
          : [{
              type: 'set-middleware-state',
              id: 'facts-governance',
              state: { version: 1, data: { decision: context.facts?.decision } }
            }]
      }
    }
  }
  return new MiddlewareChain([item])
}

function nodes() {
  return {
    work: () => ({ condition: 'next', facts: { decision: 'apply' } }),
    complete: () => ({
      outcome: { status: 'completed', reason: 'normal_stop', retryable: false } as const
    })
  }
}

function kernel(input: {
  snapshots: InMemoryRunStateStore
  events: InMemoryRunEventStore
  calls: string[]
  crashAt?: string
  terminate?: boolean
  afterRuns?: string[]
}) {
  let crashed = false
  return new RuntimeKernel({
    graph,
    snapshots: input.snapshots,
    events: input.events,
    leases: input.snapshots,
    holderId: `after-${input.crashAt ?? 'resume'}`,
    middleware: middleware(input.calls, input.terminate, input.afterRuns),
    nodes: nodes(),
    ...(input.crashAt
      ? {
          crashPoint: (point: string) => {
            if (!crashed && point === input.crashAt) {
              crashed = true
              throw new Error(`crash:${point}`)
            }
          }
        }
      : {})
  } as never)
}

async function afterEvents(events: InMemoryRunEventStore) {
  return (await events.listAfter(identity, 0)).filter(
    (event) => event.eventType === 'node.after_middleware' && event.stepId === 'work'
  )
}

describe('RuntimeKernel durable afterNode middleware', () => {
  it('honors an afterNode jump instead of following the default edge', async () => {
    const snapshots = new InMemoryRunStateStore()
    const events = new InMemoryRunEventStore()
    const routedGraph: ExecutionGraph = {
      version: 'after-middleware-jump-v1',
      startNodeId: 'work',
      predicates: ['next'],
      nodes: [
        { id: 'work', kind: 'work', effect: 'state', checkpoint: 'both' },
        { id: 'detour', kind: 'detour', effect: 'state', checkpoint: 'both' },
        { id: 'complete', kind: 'complete', effect: 'state', terminal: true, checkpoint: 'both' }
      ],
      edges: [
        { from: 'work', to: 'complete', when: 'next' },
        { from: 'detour', to: 'complete', when: 'next' }
      ]
    }
    const runtime = new RuntimeKernel({
      graph: routedGraph,
      snapshots,
      events,
      leases: snapshots,
      holderId: 'after-jump',
      middleware: new MiddlewareChain([{
        id: 'jump-governance',
        version: 1,
        hooks: ['afterNode'],
        handle: async (context, next) => context.node?.id === 'work'
          ? { commands: [{ type: 'jump', nodeId: 'detour', condition: 'next', reason: 'test detour' }] }
          : next(context)
      }]),
      nodes: {
        work: () => ({ condition: 'next' }),
        detour: () => ({ condition: 'next' }),
        complete: () => ({ outcome: { status: 'completed', reason: 'normal_stop', retryable: false } as const })
      }
    })

    await expect(runtime.run(identity)).resolves.toMatchObject({ status: 'completed' })
    expect((await events.listAfter(identity, 0))
      .filter((event) => event.eventType === 'node.started')
      .map((event) => event.stepId)).toEqual(['work', 'detour', 'complete'])
  })

  it('honors an afterNode retry by re-entering the prompt node when present', async () => {
    const snapshots = new InMemoryRunStateStore()
    const events = new InMemoryRunEventStore()
    const calls: string[] = []
    const retryGraph: ExecutionGraph = {
      version: 'after-middleware-retry-v1',
      startNodeId: 'account-model',
      predicates: ['next'],
      nodes: [
        { id: 'account-model', kind: 'account-model', effect: 'state', checkpoint: 'both' },
        { id: 'build-context', kind: 'build-context', effect: 'state', checkpoint: 'both' },
        { id: 'complete', kind: 'complete', effect: 'state', terminal: true, checkpoint: 'both' }
      ],
      edges: [
        { from: 'account-model', to: 'complete', when: 'next' },
        { from: 'build-context', to: 'complete', when: 'next' }
      ]
    }
    const runtime = new RuntimeKernel({
      graph: retryGraph,
      snapshots,
      events,
      leases: snapshots,
      holderId: 'after-retry',
      middleware: new MiddlewareChain([{
        id: 'retry-governance',
        version: 1,
        hooks: ['afterNode'],
        handle: async (context, next) => {
          if (context.node?.id !== 'account-model') return next(context)
          calls.push('retry')
          return { commands: [{ type: 'retry', reason: 'test retry' }] }
        }
      }]),
      nodes: {
        'account-model': () => ({ condition: 'next' }),
        'build-context': () => ({ condition: 'next' }),
        complete: () => ({ outcome: { status: 'completed', reason: 'normal_stop', retryable: false } as const })
      }
    })

    await expect(runtime.run(identity)).resolves.toMatchObject({ status: 'completed' })
    expect((await events.listAfter(identity, 0))
      .filter((event) => event.eventType === 'node.started')
      .map((event) => event.stepId)).toEqual(['account-model', 'build-context', 'complete'])
    expect(calls).toEqual(['retry'])
  })

  it('reruns afterNode after a crash immediately following node.completed', async () => {
    const snapshots = new InMemoryRunStateStore()
    const events = new InMemoryRunEventStore()
    const calls: string[] = []

    await expect(kernel({
      snapshots,
      events,
      calls,
      crashAt: 'after_node_completed'
    }).run(identity)).rejects.toThrow('crash:after_node_completed')

    await expect(kernel({ snapshots, events, calls }).run(identity)).resolves.toMatchObject({
      status: 'completed'
    })
    expect(calls).toEqual(['apply'])
    await expect(snapshots.load(identity)).resolves.toMatchObject({
      middleware: {
        'facts-governance': { version: 1, data: { decision: 'apply' } }
      }
    })
    expect(await afterEvents(events)).toHaveLength(1)
  })

  it('persists one command application when crashing after middleware returns', async () => {
    const snapshots = new InMemoryRunStateStore()
    const events = new InMemoryRunEventStore()
    const calls: string[] = []

    await expect(kernel({
      snapshots,
      events,
      calls,
      crashAt: 'after_node_middleware'
    }).run(identity)).rejects.toThrow('crash:after_node_middleware')

    await kernel({ snapshots, events, calls }).run(identity)

    expect(calls).toEqual(['apply', 'apply'])
    await expect(snapshots.load(identity)).resolves.toMatchObject({
      middleware: {
        'facts-governance': { version: 1, data: { decision: 'apply' } }
      }
    })
    expect(await afterEvents(events)).toHaveLength(1)
  })

  it('replays recorded termination without rerunning middleware after event persistence', async () => {
    const snapshots = new InMemoryRunStateStore()
    const events = new InMemoryRunEventStore()
    const calls: string[] = []
    const afterRuns: string[] = []

    await expect(kernel({
      snapshots,
      events,
      calls,
      afterRuns,
      terminate: true,
      crashAt: 'after_node_after_middleware_event'
    }).run(identity)).rejects.toThrow('crash:after_node_after_middleware_event')

    await expect(kernel({ snapshots, events, calls, afterRuns, terminate: true }).run(identity)).resolves.toMatchObject({
      status: 'degraded',
      reason: 'step_capped',
      details: { code: 'facts_terminate' }
    })
    expect(calls).toEqual(['apply'])
    expect(afterRuns).toEqual(['afterRun'])
    expect(await afterEvents(events)).toHaveLength(1)
  })

  it('checkpoints a repaired legacy terminal completion exactly once', async () => {
    const snapshots = new InMemoryRunStateStore()
    const events = new InMemoryRunEventStore()
    const calls: string[] = []
    const afterRuns: string[] = []
    await snapshots.save({
      version: 3,
      graphVersion: graph.version,
      runtimeMode: 'kernel_v3',
      ...identity,
      status: 'completed',
      cursor: { stepIndex: 0, nodeId: 'work', attempt: 0, checkpointSeq: 2 },
      budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
      recovery: { attempts: 0, maxAttempts: 1 },
      middleware: {},
      nodeData: {},
      taskRevision: 0,
      pendingEffects: [],
      committedEffects: [],
      outcome: { status: 'completed', reason: 'normal_stop', retryable: false },
      createdAt: 'now',
      updatedAt: 'now'
    })
    await events.append({
      eventId: 'started-work',
      seq: 1,
      ...identity,
      stepId: 'work',
      nodeAttemptId: 'work:0',
      eventType: 'node.started',
      payload: { nodeId: 'work', stepIndex: 0 },
      timestamp: 'now'
    })
    await events.append({
      eventId: 'completed-work',
      seq: 2,
      ...identity,
      stepId: 'work',
      nodeAttemptId: 'work:0',
      eventType: 'node.completed',
      payload: {
        nodeId: 'work',
        stepIndex: 0,
        condition: 'next',
        commands: [],
        facts: { decision: 'apply' },
        outcome: { status: 'completed', reason: 'normal_stop', retryable: false }
      },
      timestamp: 'now'
    })

    await kernel({ snapshots, events, calls, afterRuns }).run(identity)
    await kernel({ snapshots, events, calls, afterRuns }).run(identity)

    expect(calls).toEqual(['apply'])
    expect(afterRuns).toEqual(['afterRun'])
    await expect(snapshots.load(identity)).resolves.toMatchObject({
      cursor: { checkpointSeq: 3 }
    })
  })

  it.each([
    { label: 'negative', delta: { stepsUsed: -1 } },
    { label: 'malformed', delta: [] }
  ])('rejects $label terminal afterNode commands before persistence', async ({ delta }) => {
    const snapshots = new InMemoryRunStateStore()
    const events = new InMemoryRunEventStore()
    const terminalGraph: ExecutionGraph = {
      version: 'terminal-after-validation-v1',
      startNodeId: 'complete',
      predicates: ['next'],
      nodes: [{ id: 'complete', kind: 'complete', effect: 'state', terminal: true }],
      edges: []
    }
    const runtime = new RuntimeKernel({
      graph: terminalGraph,
      snapshots,
      events,
      leases: snapshots,
      holderId: 'terminal-after-validation',
      middleware: new MiddlewareChain([{
        id: 'invalid-terminal-command',
        version: 1,
        hooks: ['afterNode'],
        handle: async () => ({
          commands: [{ type: 'add-budget', delta } as never]
        })
      }]),
      nodes: {
        complete: () => ({
          outcome: { status: 'completed', reason: 'normal_stop', retryable: false }
        })
      }
    })

    await expect(runtime.run(identity)).resolves.toMatchObject({
      status: 'failed',
      reason: 'runtime_error'
    })
    expect((await snapshots.load(identity))?.budgets).toMatchObject({ stepsUsed: 0 })
    expect((await events.listAfter(identity, 0)).filter(
      (event) => event.eventType === 'node.after_middleware'
    )).toEqual([])
  })

  it('rejects invalid terminal commands while repairing completion-only replay', async () => {
    const snapshots = new InMemoryRunStateStore()
    const events = new InMemoryRunEventStore()
    await snapshots.save({
      version: 3,
      graphVersion: graph.version,
      runtimeMode: 'kernel_v3',
      ...identity,
      status: 'running',
      cursor: { stepIndex: 0, nodeId: 'work', attempt: 0, checkpointSeq: 1 },
      budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
      recovery: { attempts: 0, maxAttempts: 1 },
      middleware: {},
      nodeData: {},
      taskRevision: 0,
      pendingEffects: [],
      committedEffects: [],
      createdAt: 'now',
      updatedAt: 'now'
    })
    await events.append({
      eventId: 'completed-terminal-replay',
      seq: 2,
      ...identity,
      stepId: 'work',
      nodeAttemptId: 'work:0',
      eventType: 'node.completed',
      payload: {
        nodeId: 'work',
        stepIndex: 0,
        condition: 'next',
        commands: [],
        facts: { decision: 'invalid' },
        outcome: { status: 'completed', reason: 'normal_stop', retryable: false }
      },
      timestamp: 'now'
    })
    const runtime = new RuntimeKernel({
      graph,
      snapshots,
      events,
      leases: snapshots,
      holderId: 'terminal-replay-validation',
      middleware: new MiddlewareChain([{
        id: 'invalid-terminal-command',
        version: 1,
        hooks: ['afterNode'],
        handle: async () => ({
          commands: [{ type: 'add-budget', delta: { costUsd: Number.POSITIVE_INFINITY } }]
        })
      }]),
      nodes: nodes()
    })

    await expect(runtime.run(identity)).resolves.toMatchObject({
      status: 'failed',
      reason: 'runtime_error'
    })
    expect((await events.listAfter(identity, 0)).filter(
      (event) => event.eventType === 'node.after_middleware'
    )).toEqual([])
    expect((await snapshots.load(identity))?.budgets.costUsd).toBe(0)
  })

  it('reports a corrupt recorded terminal after-middleware event without replacing outcome', async () => {
    const snapshots = new InMemoryRunStateStore()
    const events = new InMemoryRunEventStore()
    const errors: string[] = []
    await snapshots.save({
      version: 3,
      graphVersion: graph.version,
      runtimeMode: 'kernel_v3',
      ...identity,
      status: 'completed',
      cursor: { stepIndex: 0, nodeId: 'work', attempt: 0, checkpointSeq: 2 },
      budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
      recovery: { attempts: 0, maxAttempts: 1 },
      middleware: {},
      nodeData: {},
      taskRevision: 0,
      pendingEffects: [],
      committedEffects: [],
      outcome: { status: 'completed', reason: 'normal_stop', retryable: false },
      createdAt: 'now',
      updatedAt: 'now'
    })
    await events.append({
      eventId: 'completed-corrupt-terminal',
      seq: 2,
      ...identity,
      stepId: 'work',
      nodeAttemptId: 'work:0',
      eventType: 'node.completed',
      payload: {
        nodeId: 'work',
        stepIndex: 0,
        condition: 'next',
        commands: [],
        facts: { decision: 'invalid' },
        outcome: { status: 'completed', reason: 'normal_stop', retryable: false }
      },
      timestamp: 'now'
    })
    await events.append({
      eventId: 'after-corrupt-terminal',
      seq: 3,
      ...identity,
      stepId: 'work',
      nodeAttemptId: 'work:0',
      eventType: 'node.after_middleware',
      payload: {
        nodeId: 'work',
        stepIndex: 0,
        commands: [{ type: 'add-budget', delta: { toolCallsUsed: -1 } }]
      },
      timestamp: 'now'
    })
    const runtime = new RuntimeKernel({
      graph,
      snapshots,
      events,
      leases: snapshots,
      holderId: 'terminal-corruption',
      middleware: new MiddlewareChain([{
        id: 'error-observer',
        version: 1,
        hooks: ['onError'],
        handle: async (context, next) => {
          errors.push(context.error instanceof Error ? context.error.message : String(context.error))
          return next(context)
        }
      }]),
      nodes: nodes()
    })

    await expect(runtime.run(identity)).resolves.toEqual({
      status: 'completed',
      reason: 'normal_stop',
      retryable: false
    })
    expect(errors).toEqual([expect.stringContaining('invalid budget delta')])
    await expect(snapshots.load(identity)).resolves.toMatchObject({
      status: 'completed',
      cursor: { checkpointSeq: 2 },
      budgets: { toolCallsUsed: 0 }
    })
  })
})
