import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  FileRunEventStore,
  InMemoryRunEventStore,
  InMemoryRunStateStore
} from '@qiongqi/adapter-storage'
import type { BudgetState, RunIdentity, RunStateV3 } from '@qiongqi/contracts'
import {
  MiddlewareChain,
  RuntimeKernel,
  budgetMiddleware,
  createKernelV3NodeHandlers,
  digestValue,
  type ExecutionGraph,
  type MiddlewareCommand,
  type RuntimeMiddleware
} from '@qiongqi/loop'

const identity: RunIdentity = {
  ownerUserId: 'owner-budget',
  workspaceKey: 'workspace-budget',
  threadId: 'thread-budget',
  turnId: 'turn-budget',
  runId: 'run-budget'
}

const zeroBudget: BudgetState = {
  stepsUsed: 0,
  toolCallsUsed: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0
}

function graph(nodeIds: string[]): ExecutionGraph {
  return {
    version: 'budget-test-v1',
    startNodeId: nodeIds[0]!,
    predicates: ['next'],
    nodes: nodeIds.map((id, index) => ({
      id,
      kind: id,
      effect: 'state' as const,
      terminal: index === nodeIds.length - 1,
      checkpoint: 'both' as const
    })),
    edges: nodeIds.slice(0, -1).map((id, index) => ({
      from: id,
      to: nodeIds[index + 1]!,
      when: 'next'
    }))
  }
}

function state(overrides: Partial<RunStateV3> = {}): RunStateV3 {
  return {
    version: 3,
    graphVersion: 'budget-test-v1',
    runtimeMode: 'kernel_v3',
    ...identity,
    status: 'running',
    cursor: { stepIndex: 0, nodeId: 'count', attempt: 0, checkpointSeq: 1 },
    budgets: zeroBudget,
    recovery: { attempts: 0, maxAttempts: 1 },
    middleware: {},
    nodeData: {},
    taskRevision: 0,
    pendingEffects: [],
    committedEffects: [],
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
    ...overrides
  }
}

const complete = () => ({
  outcome: { status: 'completed', reason: 'normal_stop', retryable: false } as const
})

describe('RuntimeKernel budget accounting', () => {
  it('adds all finite nonnegative budget fields atomically', async () => {
    const snapshots = new InMemoryRunStateStore()
    const kernel = new RuntimeKernel({
      graph: graph(['count', 'complete']),
      snapshots,
      events: new InMemoryRunEventStore(),
      leases: snapshots,
      holderId: 'budget-test',
      nodes: {
        count: () => ({
          condition: 'next',
          commands: [{
            type: 'add-budget',
            delta: {
              stepsUsed: 1,
              toolCallsUsed: 2,
              inputTokens: 11,
              outputTokens: 7,
              costUsd: 0.25
            }
          } as MiddlewareCommand]
        }),
        complete
      }
    })

    await expect(kernel.run(identity)).resolves.toMatchObject({ status: 'completed' })
    await expect(snapshots.load(identity)).resolves.toMatchObject({
      budgets: {
        stepsUsed: 1,
        toolCallsUsed: 2,
        inputTokens: 11,
        outputTokens: 7,
        costUsd: 0.25
      }
    })
  })

  it('deduplicates repeated usage ids across completed nodes', async () => {
    const snapshots = new InMemoryRunStateStore()
    const command = {
      type: 'add-budget',
      delta: { stepsUsed: 1, inputTokens: 10 },
      usageId: 'model:proposal-1'
    } as MiddlewareCommand
    const kernel = new RuntimeKernel({
      graph: graph(['first', 'second', 'complete']),
      snapshots,
      events: new InMemoryRunEventStore(),
      leases: snapshots,
      holderId: 'budget-test',
      nodes: {
        first: () => ({ condition: 'next', commands: [command] }),
        second: () => ({ condition: 'next', commands: [command] }),
        complete
      }
    })

    await kernel.run(identity)

    await expect(snapshots.load(identity)).resolves.toMatchObject({
      budgets: { stepsUsed: 1, inputTokens: 10 },
      middleware: {
        'budget-accounting': {
          version: 1,
          data: { processedUsageIds: ['model:proposal-1'] }
        }
      }
    })
  })

  it('validates a duplicate usage-id delta before deduplicating it', async () => {
    const snapshots = new InMemoryRunStateStore()
    const events = new InMemoryRunEventStore()
    const kernel = new RuntimeKernel({
      graph: graph(['first', 'second', 'complete']),
      snapshots,
      events,
      leases: snapshots,
      holderId: 'budget-test',
      nodes: {
        first: () => ({
          condition: 'next',
          commands: [{
            type: 'add-budget',
            usageId: 'model:proposal-duplicate',
            delta: { stepsUsed: 1 }
          }]
        }),
        second: () => ({
          condition: 'next',
          commands: [{
            type: 'add-budget',
            usageId: 'model:proposal-duplicate',
            delta: { stepsUsed: -1 }
          } as MiddlewareCommand]
        }),
        complete
      }
    })

    await expect(kernel.run(identity)).resolves.toMatchObject({
      status: 'failed',
      reason: 'runtime_error'
    })
    await expect(snapshots.load(identity)).resolves.toMatchObject({
      budgets: { stepsUsed: 1 }
    })
    expect((await events.listAfter(identity, 0)).filter(
      (event) => event.eventType === 'node.completed'
    )).toHaveLength(1)
  })

  it.each([
    { label: 'unknown key', delta: { stepsUsed: 1, secretTokens: 2 } },
    { label: 'array', delta: [] },
    { label: 'non-object', delta: 'stepsUsed=1' }
  ])('rejects an invalid $label delta shape before persistence', async ({ delta }) => {
    const snapshots = new InMemoryRunStateStore()
    const events = new InMemoryRunEventStore()
    const kernel = new RuntimeKernel({
      graph: graph(['count', 'complete']),
      snapshots,
      events,
      leases: snapshots,
      holderId: 'budget-test',
      nodes: {
        count: () => ({
          condition: 'next',
          commands: [{ type: 'add-budget', delta } as unknown as MiddlewareCommand]
        }),
        complete
      }
    })

    await expect(kernel.run(identity)).resolves.toMatchObject({
      status: 'failed',
      reason: 'runtime_error'
    })
    expect((await snapshots.load(identity))?.budgets).toEqual(zeroBudget)
    expect((await events.listAfter(identity, 0)).filter(
      (event) => event.eventType === 'node.completed'
    )).toEqual([])
  })

  it('accounts two model proposals and two logical tool calls', async () => {
    const firstProposal = {
      proposalId: 'proposal-first',
      model: 'test-model',
      stopClass: 'tool_calls' as const,
      integrity: {
        leakedProtocolText: false,
        malformedToolCall: false,
        completeToolCalls: true
      },
      text: '',
      reasoning: '',
      toolIntents: [
        { callId: 'call-1', toolName: 'read_data', arguments: {} },
        { callId: 'call-2', toolName: 'read_data', arguments: {} }
      ],
      usage: {
        promptTokens: 10,
        completionTokens: 2,
        totalTokens: 12,
        cacheHitRate: null,
        turns: 1,
        costUsd: 0.1
      }
    }
    const secondProposal = {
      ...firstProposal,
      proposalId: 'proposal-second',
      stopClass: 'normal' as const,
      text: 'done',
      toolIntents: [],
      usage: {
        promptTokens: 20,
        completionTokens: 3,
        totalTokens: 23,
        cacheHitRate: null,
        turns: 1,
        costUsd: 0.2
      }
    }
    const task = {
      version: 1 as const,
      identity,
      revision: 1,
      source: {
        objectiveItemId: 'user-1',
        sourceItemIds: ['user-1'],
        sourceDigest: 'source-1'
      },
      objective: 'finish',
      constraints: [],
      completedActions: [],
      pendingActions: [{ id: 'next-1', text: 'finish', status: 'pending' as const, evidenceItemIds: [] }],
      activeSkillIds: [],
      artifacts: [],
      toolLedger: [],
      createdAt: 'now',
      updatedAt: 'now'
    }
    const productionHandlers = createKernelV3NodeHandlers({
      turns: { applyItemOnce: async () => true }
    } as never)
    const accountingGraph: ExecutionGraph = {
      version: 'budget-integration-v1',
      startNodeId: 'load-first',
      predicates: ['next'],
      nodes: [
        'load-first',
        'account-first',
        'prepare-tools',
        'load-second',
        'account-second',
        'complete'
      ].map((id, index, all) => ({
        id,
        kind: id,
        effect: 'state' as const,
        terminal: index === all.length - 1,
        checkpoint: 'both' as const
      })),
      edges: [
        ['load-first', 'account-first'],
        ['account-first', 'prepare-tools'],
        ['prepare-tools', 'load-second'],
        ['load-second', 'account-second'],
        ['account-second', 'complete']
      ].map(([from, to]) => ({ from: from!, to: to!, when: 'next' }))
    }
    const snapshots = new InMemoryRunStateStore()
    const kernel = new RuntimeKernel({
      graph: accountingGraph,
      snapshots,
      events: new InMemoryRunEventStore(),
      leases: snapshots,
      holderId: 'budget-test',
      nodes: {
        'load-first': () => ({
          condition: 'next',
          commands: [
            { type: 'set-node-data', nodeId: 'restore-task', value: task },
            { type: 'set-node-data', nodeId: 'normalize-proposal', value: firstProposal }
          ]
        }),
        'account-first': productionHandlers['account-model']!,
        'prepare-tools': productionHandlers['prepare-tools']!,
        'load-second': () => ({
          condition: 'next',
          commands: [{
            type: 'set-node-data',
            nodeId: 'normalize-proposal',
            value: secondProposal
          }]
        }),
        'account-second': productionHandlers['account-model']!,
        complete
      }
    })

    await kernel.run(identity)

    await expect(snapshots.load(identity)).resolves.toMatchObject({
      budgets: {
        stepsUsed: 2,
        toolCallsUsed: 2,
        inputTokens: 30,
        outputTokens: 5
      }
    })
    expect((await snapshots.load(identity))?.budgets.costUsd).toBeCloseTo(0.3)
  })

  it('persists one processed usage id for a large tool proposal batch', async () => {
    const snapshots = new InMemoryRunStateStore()
    const events = new InMemoryRunEventStore()
    const calls = Array.from({ length: 200 }, (_, index) => ({
      callId: `call-${index}`,
      toolName: 'read_data',
      arguments: {}
    }))
    const proposal = {
      proposalId: 'proposal-large-processed-batch',
      model: 'test-model',
      stopClass: 'tool_calls' as const,
      integrity: {
        leakedProtocolText: false,
        malformedToolCall: false,
        completeToolCalls: true
      },
      text: '',
      reasoning: '',
      toolIntents: calls
    }
    const task = {
      version: 1 as const,
      identity,
      revision: 1,
      source: {
        objectiveItemId: 'user-1',
        sourceItemIds: ['user-1'],
        sourceDigest: 'source-1'
      },
      objective: 'finish',
      constraints: [],
      completedActions: [],
      pendingActions: [{ id: 'next-1', text: 'finish', status: 'pending' as const, evidenceItemIds: [] }],
      activeSkillIds: [],
      artifacts: [],
      toolLedger: [],
      createdAt: 'now',
      updatedAt: 'now'
    }
    await snapshots.save(state({
      graphVersion: 'large-tool-batch-v1',
      cursor: { stepIndex: 0, nodeId: 'prepare-tools', attempt: 0, checkpointSeq: 0 },
      nodeData: { 'normalize-proposal': proposal, 'restore-task': task }
    }))
    const handlers = createKernelV3NodeHandlers({
      turns: { applyItemOnce: async () => true }
    } as never)
    const batchGraph: ExecutionGraph = {
      version: 'large-tool-batch-v1',
      startNodeId: 'prepare-tools',
      predicates: ['next'],
      nodes: [
        { id: 'prepare-tools', kind: 'prepare-tools', effect: 'state', checkpoint: 'both' },
        { id: 'complete', kind: 'complete', effect: 'state', terminal: true, checkpoint: 'both' }
      ],
      edges: [{ from: 'prepare-tools', to: 'complete', when: 'next' }]
    }
    const kernel = new RuntimeKernel({
      graph: batchGraph,
      snapshots,
      events,
      leases: snapshots,
      holderId: 'large-tool-batch',
      nodes: { 'prepare-tools': handlers['prepare-tools']!, complete }
    })

    await kernel.run(identity)

    const persisted = await snapshots.load(identity)
    expect(persisted?.budgets.toolCallsUsed).toBe(200)
    expect(persisted?.middleware['budget-accounting']).toEqual({
      version: 1,
      data: {
        processedUsageIds: [`tools:${digestValue({
          proposalId: proposal.proposalId,
          callIds: calls.map((call) => call.callId)
        })}`]
      }
    })
  })

  it('applies a no-usage-id command once when replaying its completed event', async () => {
    const snapshots = new InMemoryRunStateStore()
    const events = new InMemoryRunEventStore()
    await snapshots.save(state())
    await events.append({
      eventId: 'completed-count',
      seq: 2,
      ...identity,
      stepId: 'count',
      nodeAttemptId: 'count:0',
      eventType: 'node.completed',
      payload: {
        nodeId: 'count',
        stepIndex: 0,
        condition: 'next',
        commands: [{ type: 'add-budget', delta: { stepsUsed: 1 } }]
      },
      timestamp: '2026-07-16T00:00:01.000Z'
    })
    const kernel = new RuntimeKernel({
      graph: graph(['count', 'complete']),
      snapshots,
      events,
      leases: snapshots,
      holderId: 'budget-test',
      nodes: { count: () => { throw new Error('must replay') }, complete }
    })

    await kernel.run(identity)
    await kernel.run(identity)

    await expect(snapshots.load(identity)).resolves.toMatchObject({
      status: 'completed',
      budgets: { stepsUsed: 1 }
    })
  })

  it.each([
    { stepsUsed: -1 },
    { inputTokens: Number.NaN },
    { costUsd: Number.POSITIVE_INFINITY },
    { stepsUsed: Number.MAX_SAFE_INTEGER + 1 }
  ] as Array<Partial<BudgetState>>)('rejects invalid delta $stepsUsed$inputTokens$costUsd', async (delta) => {
    const snapshots = new InMemoryRunStateStore()
    const events = new InMemoryRunEventStore()
    const kernel = new RuntimeKernel({
      graph: graph(['count', 'complete']),
      snapshots,
      events,
      leases: snapshots,
      holderId: 'budget-test',
      nodes: {
        count: () => ({
          condition: 'next',
          commands: [{ type: 'add-budget', delta } as MiddlewareCommand]
        }),
        complete
      }
    })

    await expect(kernel.run(identity)).resolves.toMatchObject({
      status: 'failed',
      reason: 'runtime_error'
    })
    expect((await snapshots.load(identity))?.budgets).toEqual(zeroBudget)
    expect((await events.listAfter(identity, 0)).filter(
      (event) => event.eventType === 'node.completed'
    )).toEqual([])
  })

  it('rejects an unsafe accumulated integer before persistence', async () => {
    const snapshots = new InMemoryRunStateStore()
    const events = new InMemoryRunEventStore()
    await snapshots.save(state({
      cursor: { stepIndex: 0, nodeId: 'count', attempt: 0, checkpointSeq: 0 },
      budgets: { ...zeroBudget, stepsUsed: Number.MAX_SAFE_INTEGER }
    }))
    const kernel = new RuntimeKernel({
      graph: graph(['count', 'complete']),
      snapshots,
      events,
      leases: snapshots,
      holderId: 'budget-test',
      nodes: {
        count: () => ({
          condition: 'next',
          commands: [{ type: 'add-budget', delta: { stepsUsed: 1 } }]
        }),
        complete
      }
    })

    await expect(kernel.run(identity)).resolves.toMatchObject({
      status: 'failed',
      reason: 'runtime_error'
    })
    expect((await events.listAfter(identity, 0)).filter(
      (event) => event.eventType === 'node.completed'
    )).toEqual([])
  })
})

describe('RuntimeKernel committed node facts', () => {
  it('passes committed facts to afterNode during a normal run', async () => {
    const seen: unknown[] = []
    const middleware: RuntimeMiddleware = {
      id: 'facts',
      version: 1,
      hooks: ['afterNode'],
      handle: async (context, next) => {
        seen.push(context.facts)
        return next(context)
      }
    }
    const snapshots = new InMemoryRunStateStore()
    const kernel = new RuntimeKernel({
      graph: graph(['count', 'complete']),
      snapshots,
      events: new InMemoryRunEventStore(),
      leases: snapshots,
      holderId: 'facts-test',
      middleware: new MiddlewareChain([middleware]),
      nodes: {
        count: () => ({ condition: 'next', facts: { proposalClass: 'final' } }),
        complete
      }
    })

    await kernel.run(identity)

    expect(seen[0]).toEqual({ proposalClass: 'final' })
  })

  it('passes persisted facts to afterNode when replaying after a checkpoint', async () => {
    const snapshots = new InMemoryRunStateStore()
    const events = new InMemoryRunEventStore()
    await snapshots.save(state())
    await events.append({
      eventId: 'completed-count',
      seq: 2,
      ...identity,
      stepId: 'count',
      nodeAttemptId: 'count:0',
      eventType: 'node.completed',
      payload: {
        nodeId: 'count',
        stepIndex: 0,
        condition: 'next',
        commands: [],
        facts: { proposalClass: 'tool_intents', stopClass: 'tool_calls' }
      },
      timestamp: '2026-07-16T00:00:01.000Z'
    })
    const seen: unknown[] = []
    const kernel = new RuntimeKernel({
      graph: graph(['count', 'complete']),
      snapshots,
      events,
      leases: snapshots,
      holderId: 'facts-test',
      middleware: new MiddlewareChain([{
        id: 'facts',
        version: 1,
        hooks: ['afterNode'],
        handle: async (context, next) => {
          if (context.node?.id === 'count') seen.push(context.facts)
          return next(context)
        }
      }]),
      nodes: { count: () => { throw new Error('must replay') }, complete }
    })

    await kernel.run(identity)

    expect(seen).toEqual([{ proposalClass: 'tool_intents', stopClass: 'tool_calls' }])
  })

  it('passes the same JSON-canonical committed facts during normal run and replay', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'qiongqi-kernel-facts-'))
    const replayRootDir = await mkdtemp(join(tmpdir(), 'qiongqi-kernel-facts-replay-'))
    const events = new FileRunEventStore(rootDir)
    const originalFacts = {
      proposalClass: 'final_text',
      omitted: undefined,
      nested: { kept: 'yes', omitted: undefined },
      list: ['kept', undefined]
    }
    try {
      const normalSeen: unknown[] = []
      const normalSnapshots = new InMemoryRunStateStore()
      const normalKernel = new RuntimeKernel({
        graph: graph(['count', 'complete']),
        snapshots: normalSnapshots,
        events,
        leases: normalSnapshots,
        holderId: 'facts-normal',
        middleware: factsMiddleware(normalSeen),
        nodes: {
          count: () => ({ condition: 'next', facts: originalFacts }),
          complete
        }
      })

      await normalKernel.run(identity)
      const normalEvents = await events.listAfter(identity, 0)
      const committed = normalEvents.find(
        (event) => event.eventType === 'node.completed' && event.stepId === 'count'
      )?.payload as { facts?: unknown }

      const replaySeen: unknown[] = []
      const replaySnapshots = new InMemoryRunStateStore()
      const replayEvents = new FileRunEventStore(replayRootDir)
      for (const event of normalEvents.filter((event) => event.seq <= 2)) {
        await replayEvents.append(event)
      }
      await replaySnapshots.save(state())
      const replayKernel = new RuntimeKernel({
        graph: graph(['count', 'complete']),
        snapshots: replaySnapshots,
        events: replayEvents,
        leases: replaySnapshots,
        holderId: 'facts-replay',
        middleware: factsMiddleware(replaySeen),
        nodes: {
          count: () => { throw new Error('completed node must replay') },
          complete
        }
      })

      await replayKernel.run(identity)

      expect(committed.facts).toEqual({
        proposalClass: 'final_text',
        nested: { kept: 'yes' },
        list: ['kept', null]
      })
      expect(normalSeen).toEqual([committed.facts])
      expect(replaySeen).toEqual([committed.facts])
    } finally {
      await rm(rootDir, { recursive: true, force: true })
      await rm(replayRootDir, { recursive: true, force: true })
    }
  })
})

function factsMiddleware(seen: unknown[]): MiddlewareChain {
  return new MiddlewareChain([{
    id: 'canonical-facts',
    version: 1,
    hooks: ['afterNode'],
    handle: async (context, next) => {
      if (context.node?.id === 'count') seen.push(context.facts)
      return next(context)
    }
  }])
}

describe('budgetMiddleware', () => {
  it('returns a compatible structured outcome when already over the tool-call cap', async () => {
    const result = await new MiddlewareChain([
      budgetMiddleware({ maxToolCalls: 2 })
    ]).run('beforeNode', {
      identity,
      state: state({
        cursor: { stepIndex: 0, nodeId: 'count', attempt: 0, checkpointSeq: 0 },
        budgets: { ...zeroBudget, toolCallsUsed: 3 }
      }),
      hook: 'beforeNode',
      commands: []
    })

    expect(result?.commands?.[0]).toMatchObject({
      type: 'terminate',
      outcome: {
        reason: 'step_capped',
        details: { code: 'tool_call_cap', maxToolCalls: 2, toolCallsUsed: 3 }
      }
    })
  })

  it.each([
    { label: 'below', current: 1, pending: 1, max: 3, status: 'completed', items: 1 },
    { label: 'equal', current: 1, pending: 2, max: 3, status: 'completed', items: 2 },
    { label: 'above', current: 2, pending: 2, max: 3, status: 'degraded', items: 0 }
  ])('enforces a $label prospective tool batch before materialization', async ({
    current,
    pending,
    max,
    status,
    items
  }) => {
    const snapshots = new InMemoryRunStateStore()
    const events = new InMemoryRunEventStore()
    const applied: string[] = []
    let commits = 0
    const proposal = {
      proposalId: `proposal-cap-${current}-${pending}`,
      model: 'test-model',
      stopClass: 'tool_calls' as const,
      integrity: {
        leakedProtocolText: false,
        malformedToolCall: false,
        completeToolCalls: true
      },
      text: '',
      reasoning: '',
      toolIntents: Array.from({ length: pending }, (_, index) => ({
        callId: `call-${index}`,
        toolName: 'read_data',
        arguments: {}
      }))
    }
    const task = {
      version: 1 as const,
      identity,
      revision: 1,
      source: {
        objectiveItemId: 'user-1',
        sourceItemIds: ['user-1'],
        sourceDigest: 'source-1'
      },
      objective: 'finish',
      constraints: [],
      completedActions: [],
      pendingActions: [{ id: 'next-1', text: 'finish', status: 'pending' as const, evidenceItemIds: [] }],
      activeSkillIds: [],
      artifacts: [],
      toolLedger: [],
      createdAt: 'now',
      updatedAt: 'now'
    }
    await snapshots.save(state({
      graphVersion: 'tool-cap-v1',
      cursor: { stepIndex: 0, nodeId: 'prepare-tools', attempt: 0, checkpointSeq: 0 },
      budgets: { ...zeroBudget, toolCallsUsed: current },
      nodeData: { 'normalize-proposal': proposal, 'restore-task': task }
    }))
    const handlers = createKernelV3NodeHandlers({
      turns: {
        applyItemOnce: async (_threadId: string, item: { id: string }) => {
          applied.push(item.id)
          return true
        }
      }
    } as never)
    const capGraph: ExecutionGraph = {
      version: 'tool-cap-v1',
      startNodeId: 'prepare-tools',
      predicates: ['next'],
      nodes: [
        { id: 'prepare-tools', kind: 'prepare-tools', effect: 'state', checkpoint: 'both' },
        { id: 'commit-tools', kind: 'commit-tools', effect: 'tool', terminal: true, checkpoint: 'both' }
      ],
      edges: [{ from: 'prepare-tools', to: 'commit-tools', when: 'next' }]
    }
    const kernel = new RuntimeKernel({
      graph: capGraph,
      snapshots,
      events,
      leases: snapshots,
      holderId: 'tool-cap',
      middleware: new MiddlewareChain([budgetMiddleware({ maxToolCalls: max })]),
      nodes: {
        'prepare-tools': handlers['prepare-tools']!,
        'commit-tools': () => {
          commits += 1
          return complete()
        }
      }
    })

    await expect(kernel.run(identity)).resolves.toMatchObject({ status })
    expect(applied).toHaveLength(items)
    expect(commits).toBe(status === 'completed' ? 1 : 0)
  })
})
