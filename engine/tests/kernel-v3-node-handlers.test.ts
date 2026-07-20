import { describe, expect, it } from 'vitest'
import { InMemoryRunEventStore, InMemoryRunStateStore, InMemoryTaskStateStore } from '@qiongqi/adapter-storage'
import type { ModelProposal, RunIdentity, TaskStateV1 } from '@qiongqi/contracts'
import { makeToolResultItem, makeUserItem } from '@qiongqi/domain'
import {
  RuntimeKernel,
  createKernelV3NodeHandlers,
  digestValue,
  defaultKernelV3Middleware,
  productionKernelV3Graph
} from '@qiongqi/loop'

const identity: RunIdentity = {
  ownerUserId: 'owner-1',
  workspaceKey: '/workspace-1',
  threadId: 'thread-1',
  turnId: 'turn-1',
  runId: 'run-1'
}

describe('Kernel v3 production node handlers', () => {
  it('commits a normal final proposal through the production graph', async () => {
    const harness = await createHarness([
      proposal({ text: '报告已完成。' })
    ])
    const outcome = await harness.kernel.run(identity)

    expect(outcome).toMatchObject({ status: 'completed', reason: 'normal_stop' })
    expect(harness.applied).toContainEqual(expect.objectContaining({
      kind: 'assistant_text',
      text: '报告已完成。',
      status: 'completed'
    }))
    expect(await nodeSequence(harness.events)).toEqual([
      'prepare-turn',
      'restore-task',
      'build-context',
      'invoke-model',
      'normalize-proposal',
      'account-model',
      'evaluate',
      'commit-assistant'
    ])
  })

  it('recovers from task discontinuity without committing the model question', async () => {
    const harness = await createHarness([
      proposal({
        proposalId: 'proposal-recovery',
        reasoning: 'I no longer have the previous context.',
        text: 'What should I continue with?'
      }),
      proposal({ text: '已继续生成报告。' })
    ])
    await expect(harness.kernel.run(identity)).resolves.toMatchObject({ status: 'completed' })

    expect(harness.applied).not.toContainEqual(expect.objectContaining({
      kind: 'assistant_text',
      text: 'What should I continue with?'
    }))
    expect(harness.applied).not.toContainEqual(expect.objectContaining({
      kind: 'assistant_reasoning',
      text: 'I no longer have the previous context.'
    }))
    expect(harness.requests[1]?.contextInstructions).toContainEqual(
      expect.stringContaining('Authoritative task recovery entry')
    )
    expect(await nodeSequence(harness.events)).toEqual([
      'prepare-turn', 'restore-task', 'build-context', 'invoke-model',
      'normalize-proposal', 'account-model', 'evaluate', 'recover-context', 'build-context',
      'invoke-model', 'normalize-proposal', 'account-model', 'evaluate', 'commit-assistant'
    ])
  })

  it('recovers from a non-terminal action preamble instead of completing the turn', async () => {
    const premature = '抱歉，我刚才误以为任务已切换上下文，没有继续往下推进。我现在立刻继续完成图表生成、Markdown 报告和 HTML 看板。'
    const harness = await createHarness([
      proposal({
        proposalId: 'proposal-premature-preamble',
        text: premature
      }),
      proposal({ proposalId: 'proposal-after-preamble-recovery', text: '图表、Markdown 报告和 HTML 看板已生成完成。' })
    ])

    await expect(harness.kernel.run(identity)).resolves.toMatchObject({ status: 'completed' })

    expect(harness.applied).not.toContainEqual(expect.objectContaining({
      kind: 'assistant_text',
      text: premature
    }))
    expect(harness.requests[1]?.contextInstructions).toContainEqual(
      expect.stringContaining('Authoritative task recovery entry')
    )
    expect(await nodeSequence(harness.events)).toEqual([
      'prepare-turn', 'restore-task', 'build-context', 'invoke-model',
      'normalize-proposal', 'account-model', 'evaluate', 'recover-context', 'build-context',
      'invoke-model', 'normalize-proposal', 'account-model', 'evaluate', 'commit-assistant'
    ])
  })

  it('recovers before executing valid tool intents paired with context-loss text', async () => {
    const harness = await createHarness([
      proposal({
        proposalId: 'proposal-tool-context-loss',
        stopClass: 'tool_calls',
        text: 'What should I continue with?',
        toolIntents: [{ callId: 'call-lost', toolName: 'read_data', arguments: { path: 'lost.json' } }]
      }),
      proposal({ proposalId: 'proposal-after-recovery', text: '已从恢复入口继续。' })
    ])

    await expect(harness.kernel.run(identity)).resolves.toMatchObject({ status: 'completed' })

    expect(harness.applied).not.toContainEqual(expect.objectContaining({
      id: 'item_kernel_text_proposal-tool-context-loss'
    }))
    expect(harness.applied).not.toContainEqual(expect.objectContaining({ callId: 'call-lost' }))
    expect(harness.toolExecutions).toBe(0)
    expect(harness.requests[1]?.contextInstructions).toContainEqual(
      expect.stringContaining('Authoritative task recovery entry')
    )
  })

  it('recovers before executing valid tool intents paired with reasoning-only context loss', async () => {
    const harness = await createHarness([
      proposal({
        proposalId: 'proposal-tool-reasoning-context-loss',
        stopClass: 'tool_calls',
        reasoning: 'What should I continue with?',
        text: '',
        toolIntents: [{ callId: 'call-reasoning-lost', toolName: 'read_data', arguments: {} }]
      }),
      proposal({ proposalId: 'proposal-after-reasoning-recovery', text: '已恢复。' })
    ])

    await expect(harness.kernel.run(identity)).resolves.toMatchObject({ status: 'completed' })

    expect(harness.applied).not.toContainEqual(expect.objectContaining({
      id: 'item_kernel_reasoning_proposal-tool-reasoning-context-loss'
    }))
    expect(harness.applied).not.toContainEqual(expect.objectContaining({
      callId: 'call-reasoning-lost'
    }))
    expect(harness.toolExecutions).toBe(0)
    expect(harness.requests[1]?.contextInstructions).toContainEqual(
      expect.stringContaining('Authoritative task recovery entry')
    )
  })

  it('commits tools, advances TaskState, and loops back through build-context', async () => {
    const harness = await createHarness([
      proposal({
        stopClass: 'tool_calls',
        toolIntents: [{ callId: 'call-1', toolName: 'read_data', arguments: { path: 'data.json' } }],
        text: ''
      }),
      proposal({ text: '数据读取完成。' })
    ])
    await expect(harness.kernel.run(identity)).resolves.toMatchObject({ status: 'completed' })

    await expect(harness.taskStates.load(identity)).resolves.toMatchObject({
      revision: 2,
      toolLedger: [expect.objectContaining({ callId: 'call-1', status: 'committed' })]
    })
    expect(await nodeSequence(harness.events)).toEqual([
      'prepare-turn', 'restore-task', 'build-context', 'invoke-model',
      'normalize-proposal', 'account-model', 'evaluate', 'materialize-proposal', 'prepare-tools', 'commit-tools', 'project-progress', 'govern-progress',
      'build-context', 'invoke-model', 'normalize-proposal', 'account-model', 'evaluate',
      'commit-assistant'
    ])
  })

  it('executes valid native tools when the provider leaked protocol markers in text', async () => {
    const harness = await createHarness([
      proposal({
        stopClass: 'tool_calls',
        text: '(tool call) read_data',
        integrity: {
          leakedProtocolText: true,
          malformedToolCall: false,
          completeToolCalls: true
        },
        toolIntents: [{ callId: 'call-leaked-text', toolName: 'read_data', arguments: { path: 'data.json' } }]
      }),
      proposal({ text: '报告已完成。' })
    ])

    await expect(harness.kernel.run(identity)).resolves.toMatchObject({ status: 'completed' })
    expect(harness.toolExecutions).toBe(1)
    expect(harness.applied).not.toContainEqual(expect.objectContaining({
      kind: 'assistant_text',
      text: '(tool call) read_data'
    }))
  })

  it('recovers from an unknown tool after preserving earlier committed calls', async () => {
    const harness = await createHarness([
      proposal({
        stopClass: 'tool_calls',
        toolIntents: [
          { callId: 'call-valid', toolName: 'read_data', arguments: { path: 'data.json' } },
          { callId: 'call-invalid', toolName: 'skill-manage', arguments: { action: 'enable' } }
        ],
        text: ''
      }),
      proposal({ proposalId: 'proposal-after-rejection', text: '报告已完成。' })
    ], { throwForTool: 'skill-manage', throwMessage: 'unknown tool: skill-manage' })

    await expect(harness.kernel.run(identity)).resolves.toEqual({
      status: 'completed',
      reason: 'normal_stop',
      retryable: false
    })

    expect(harness.toolExecutions).toBe(2)
    expect(harness.applied).toContainEqual(expect.objectContaining({
      kind: 'tool_result',
      callId: 'call-invalid',
      toolName: 'skill-manage',
      isError: true
    }))
    await expect(harness.taskStates.load(identity)).resolves.toMatchObject({
      toolLedger: [
        expect.objectContaining({ callId: 'call-valid', status: 'committed' }),
        expect.objectContaining({ callId: 'call-invalid', status: 'failed' })
      ]
    })
    expect(harness.requests).toHaveLength(2)
  })

  it('keeps non-recoverable tool failures terminal', async () => {
    const harness = await createHarness([
      proposal({
        stopClass: 'tool_calls',
        toolIntents: [{ callId: 'call-fatal', toolName: 'read_data', arguments: {} }],
        text: ''
      }),
      proposal({ text: '不应执行到这里。' })
    ], { throwForTool: 'read_data', throwMessage: 'database write failed' })

    await expect(harness.kernel.run(identity)).resolves.toMatchObject({
      status: 'failed',
      reason: 'runtime_error'
    })
    expect(harness.requests).toHaveLength(1)
  })

  it('materializes tool proposal reasoning and text before the tool call', async () => {
    const harness = await createHarness([
      proposal({
        proposalId: 'proposal-tool',
        stopClass: 'tool_calls',
        toolIntents: [{ callId: 'call-1', toolName: 'read_data', arguments: { path: 'data.json' } }],
        reasoning: '  I should inspect the data first.  ',
        text: '  I will read the data before answering.  '
      }),
      proposal({ proposalId: 'proposal-final', text: '数据读取完成。' })
    ])
    await expect(harness.kernel.run(identity)).resolves.toMatchObject({ status: 'completed' })

    expect(harness.applied.map((item) => item.kind)).toEqual([
      'assistant_reasoning',
      'assistant_text',
      'tool_call',
      'tool_result',
      'assistant_text'
    ])
    expect(harness.applied.slice(0, 2)).toEqual([
      expect.objectContaining({
        id: 'item_kernel_reasoning_proposal-tool',
        text: '  I should inspect the data first.  '
      }),
      expect.objectContaining({
        id: 'item_kernel_text_proposal-tool',
        text: '  I will read the data before answering.  '
      })
    ])
    expect(await nodeSequence(harness.events)).toEqual([
      'prepare-turn', 'restore-task', 'build-context', 'invoke-model',
      'normalize-proposal', 'account-model', 'evaluate', 'materialize-proposal', 'prepare-tools', 'commit-tools', 'project-progress', 'govern-progress',
      'build-context', 'invoke-model', 'normalize-proposal', 'account-model', 'evaluate',
      'commit-assistant'
    ])
  })

  it('re-entering materialization persists one item per stable proposal item id', async () => {
    const harness = await createHarness([])
    const repeated = proposal({
      proposalId: 'proposal-replayed',
      reasoning: 'reason once',
      text: 'text once'
    })
    const state = {
      nodeData: { 'normalize-proposal': repeated }
    }

    await harness.handlers['materialize-proposal']?.({ identity, state } as never)
    await harness.handlers['materialize-proposal']?.({ identity, state } as never)

    expect([...harness.persistedItems.values()]).toEqual([
      expect.objectContaining({ id: 'item_kernel_reasoning_proposal-replayed' }),
      expect.objectContaining({ id: 'item_kernel_text_proposal-replayed' })
    ])
  })

  it('accounts one normalized model proposal with sanitized facts', async () => {
    const harness = await createHarness([])
    const normalized = proposal({
      proposalId: 'proposal-accounted',
      stopClass: 'normal',
      text: 'private model text',
      reasoning: 'private reasoning',
      usage: {
        promptTokens: 12,
        completionTokens: 4,
        totalTokens: 16,
        cacheHitRate: null,
        turns: 1,
        costUsd: 0.08
      }
    })

    const result = await harness.handlers['account-model']?.({
      identity,
      state: { nodeData: { 'normalize-proposal': normalized, 'restore-task': task() } }
    } as never)

    expect(result).toMatchObject({
      condition: 'next',
      commands: [{
        type: 'add-budget',
        usageId: 'model:proposal-accounted',
        delta: { stepsUsed: 1, inputTokens: 12, outputTokens: 4, costUsd: 0.08 }
      }],
      facts: {
        proposalClass: 'final_text',
        stopClass: 'normal',
        inputTokens: 12,
        outputTokens: 4,
        costUsd: 0.08
      }
    })
    expect(result?.facts).not.toHaveProperty('text')
    expect(result?.facts).not.toHaveProperty('reasoning')
  })

  it('persists compaction governor state in the kernel run snapshot', async () => {
    const harness = await createHarness([proposal({ text: '完成。' })])
    await expect(harness.kernel.run(identity)).resolves.toMatchObject({ status: 'completed' })
    const snapshot = await (harness as { snapshots?: InMemoryRunStateStore }).snapshots?.load(identity)
    expect(snapshot?.middleware['compaction-governor']).toEqual({
      version: 1,
      data: { version: 1, step: 0, lastCompactionStep: -1 }
    })
  })

  it('recovers from a context-capacity model failure before terminating the turn', async () => {
    const harness = await createHarness([
      proposal({
        stopClass: 'transport_error',
        providerReason: 'context_length_exceeded',
        text: ''
      }),
      proposal({ proposalId: 'proposal-after-context-recovery', text: '恢复后完成。' })
    ], { emitRuntimeProgress: true })

    await expect(harness.kernel.run(identity)).resolves.toMatchObject({ status: 'completed' })
    expect(harness.requests).toHaveLength(2)
    expect(harness.forceCompactions).toEqual([false, true])
    expect(harness.requests[1]?.contextInstructions).toContainEqual(
      expect.stringContaining('Authoritative task recovery entry')
    )
  })

  it('recognizes provider-specific context overflow messages', async () => {
    const harness = await createHarness([
      proposal({
        stopClass: 'transport_error',
        providerReason: 'maximum context length is 131072 tokens',
        text: ''
      }),
      proposal({ text: '报告已完成。' })
    ])

    await expect(harness.kernel.run(identity)).resolves.toMatchObject({ status: 'completed' })
    expect(harness.requests).toHaveLength(2)
    expect(harness.forceCompactions).toEqual([false, true])
  })

  it('retries a malformed provider proposal before failing the turn', async () => {
    const harness = await createHarness([
      proposal({
        stopClass: 'protocol_error',
        text: '',
        integrity: {
          leakedProtocolText: false,
          malformedToolCall: true,
          completeToolCalls: false
        }
      }),
      proposal({ proposalId: 'proposal-after-protocol-recovery', text: '报告已完成。' })
    ])

    await expect(harness.kernel.run(identity)).resolves.toMatchObject({ status: 'completed' })
    expect(harness.requests).toHaveLength(2)
    expect(harness.requests[1]?.contextInstructions).toContainEqual(
      expect.stringContaining('Authoritative task recovery entry')
    )
  })

  it('retries a transient model stream exception before failing the turn', async () => {
    const harness = await createHarness([
      proposal({ proposalId: 'proposal-after-stream-retry', text: '报告已完成。' })
    ], { throwForProposal: true })

    await expect(harness.kernel.run(identity)).resolves.toMatchObject({ status: 'completed' })
    expect(harness.requests).toHaveLength(2)
    expect(harness.requests[1]?.contextInstructions).toContainEqual(
      expect.stringContaining('Authoritative task recovery entry')
    )
  })

  it('routes an empty post-tool response through durable task recovery', async () => {
    const harness = await createHarness([
      proposal({
        stopClass: 'tool_calls',
        text: '',
        toolIntents: [{ callId: 'call-before-empty', toolName: 'read_data', arguments: { path: 'data.json' } }]
      }),
      proposal({ proposalId: 'proposal-empty-post-tool', text: '' }),
      proposal({ proposalId: 'proposal-after-empty-recovery', text: '报告已完成。' })
    ])

    await expect(harness.kernel.run(identity)).resolves.toMatchObject({ status: 'completed' })
    expect(harness.requests).toHaveLength(3)
    expect(harness.requests[2]?.contextInstructions).toContainEqual(
      expect.stringContaining('Authoritative task recovery entry')
    )
  })

  it('accounts each logical tool call absent from the persisted task ledger', async () => {
    const harness = await createHarness([])
    const restored = task()
    restored.toolLedger = [{
      callId: 'call-1',
      toolName: 'read_data',
      status: 'committed'
    }]
    const normalized = proposal({
      proposalId: 'proposal-tools',
      stopClass: 'tool_calls',
      text: '',
      toolIntents: [
        { callId: 'call-1', toolName: 'read_data', arguments: { secret: 'hidden' } },
        { callId: 'call-2', toolName: 'read_data', arguments: { path: 'data.json' } }
      ]
    })

    const result = await harness.handlers['prepare-tools']?.({
      identity,
      state: { nodeData: { 'normalize-proposal': normalized, 'restore-task': restored } }
    } as never)

    expect(result?.commands).toEqual([{
      type: 'add-budget',
      usageId: `tools:${digestValue({
        proposalId: 'proposal-tools',
        callIds: ['call-2']
      })}`,
      delta: { toolCallsUsed: 1 }
    }])
    expect(result?.commands).not.toContainEqual(expect.objectContaining({
      arguments: expect.anything()
    }))
  })

  it('uses one stable accounting command for a large ordered tool batch', async () => {
    const harness = await createHarness([])
    const calls = Array.from({ length: 200 }, (_, index) => ({
      callId: `call-${index}`,
      toolName: 'read_data',
      arguments: { index }
    }))
    const normalized = proposal({
      proposalId: 'proposal-large-batch',
      stopClass: 'tool_calls',
      text: '',
      toolIntents: calls
    })

    const result = await harness.handlers['prepare-tools']?.({
      identity,
      state: {
        nodeData: { 'normalize-proposal': normalized, 'restore-task': task() }
      }
    } as never)

    expect(result?.commands).toEqual([{
      type: 'add-budget',
      usageId: `tools:${digestValue({
        proposalId: 'proposal-large-batch',
        callIds: calls.map((call) => call.callId)
      })}`,
      delta: { toolCallsUsed: 200 }
    }])
  })
})

async function createHarness(
  proposals: ModelProposal[],
  options: {
    emitRuntimeProgress?: boolean
    throwForTool?: string
    throwMessage?: string
    throwForProposal?: boolean
  } = {}
) {
  const snapshots = new InMemoryRunStateStore()
  const events = new InMemoryRunEventStore()
  const taskStates = new InMemoryTaskStateStore()
  const prepared = await taskStates.prepare(task(), 0)
  await taskStates.commit(prepared)
  const applied: Array<Record<string, unknown>> = []
  const persistedItems = new Map<string, Record<string, unknown>>()
  const requests: Array<Record<string, unknown>> = []
  const forceCompactions: boolean[] = []
  let toolExecutions = 0
  const queue = [...proposals]
  const signal = new AbortController().signal
  const thread = {
    id: identity.threadId,
    ownerUserId: identity.ownerUserId,
    workspace: identity.workspaceKey,
    title: 'test',
    status: 'running',
    turns: [{
      id: identity.turnId,
      threadId: identity.threadId,
      status: 'running',
      prompt: '继续',
      steering: [],
      items: [],
      attachmentIds: [],
      activeSkillIds: [],
      injectedMemoryIds: [],
      createdAt: 'now'
    }],
    createdAt: 'now',
    updatedAt: 'now'
  }
  const handlers = createKernelV3NodeHandlers({
    threadStore: { get: async () => thread } as never,
    sessionStore: {
      loadItems: async () => [makeUserItem({
        id: 'user-1',
        threadId: identity.threadId,
        turnId: identity.turnId,
        text: '完成报告'
      })]
    } as never,
    taskStates,
    turns: {
      getTurn: async () => thread.turns[0],
      getAbortController: () => signal,
      applyItem: async (_threadId: string, item: Record<string, unknown>) => {
        applied.push(item)
        persistedItems.set(String(item.id), item)
      },
      applyItemOnce: async (_threadId: string, item: Record<string, unknown>) => {
        if (persistedItems.has(String(item.id))) return false
        applied.push(item)
        persistedItems.set(String(item.id), item)
        return true
      },
      updateItem: async () => null
      ,updateItemOnce: async (_threadId: string, _itemId: string, patch: Record<string, unknown>) => {
        const existing = persistedItems.get(_itemId)
        if (existing) Object.assign(existing, patch)
        return Boolean(existing)
      }
    } as never,
    promptBuilder: {
      build: async (input: { forceCompaction?: boolean }) => {
        forceCompactions.push(input.forceCompaction === true)
        return {
        kind: 'built',
        ctx: {
          request: {
            threadId: identity.threadId,
            turnId: identity.turnId,
            model: 'test-model',
            prefix: [],
            history: [],
            tools: [{
              name: 'read_data',
              description: 'read',
              inputSchema: {},
              effectPolicy: { effect: 'read', replay: 'safe' }
            }],
            abortSignal: signal
          },
          compactionGovernorState: { version: 1, step: 0, lastCompactionStep: -1 }
        }
        }
      }
    } as never,
    proposalRunner: {
      run: async (request: Record<string, unknown>) => {
        requests.push(request)
        if (options.throwForProposal && requests.length === 1) {
          throw new Error('upstream connection reset')
        }
        const next = queue.shift()
        if (!next) throw new Error('proposal queue exhausted')
        return next
      }
    } as never,
    toolRuntime: {
      execute: async (input: { state: unknown; call: { callId: string; toolName: string } }) => {
        toolExecutions += 1
        if (options.throwForTool === input.call.toolName) {
          throw new Error(options.throwMessage ?? `unknown tool: ${input.call.toolName}`)
        }
        return {
          state: input.state,
          replayed: false,
          result: {
            approved: true,
            item: makeToolResultItem({
              id: `result-${input.call.callId}`,
              threadId: identity.threadId,
              turnId: identity.turnId,
              callId: input.call.callId,
              toolName: input.call.toolName,
              output: { ok: true }
            })
          }
        }
      }
    } as never,
    createToolContext: async () => ({
      threadId: identity.threadId,
      turnId: identity.turnId,
      workspace: identity.workspaceKey,
      ownerUserId: identity.ownerUserId,
      approvalPolicy: 'trusted',
      abortSignal: signal,
      awaitApproval: async () => 'allow'
    }),
    ids: { next: (prefix: string) => `${prefix}-1` },
    nowIso: () => '2026-07-15T00:00:00.000Z',
    emitRuntimeProgress: options.emitRuntimeProgress
  })
  return {
    kernel: new RuntimeKernel({
      graph: productionKernelV3Graph(),
      snapshots,
      events,
      leases: snapshots,
      holderId: 'test',
      middleware: defaultKernelV3Middleware(),
      nodes: handlers
    }),
    events,
    snapshots,
    handlers,
    taskStates,
    applied,
    persistedItems,
    requests,
    forceCompactions,
    get toolExecutions() { return toolExecutions }
  }
}

async function nodeSequence(events: InMemoryRunEventStore): Promise<string[]> {
  return (await events.listAfter(identity, 0))
    .filter((event) => event.eventType === 'node.started')
    .map((event) => event.stepId ?? '')
}

function proposal(overrides: Partial<ModelProposal>): ModelProposal {
  return {
    proposalId: `proposal-${Math.random()}`,
    model: 'test-model',
    stopClass: 'normal',
    integrity: {
      leakedProtocolText: false,
      malformedToolCall: false,
      completeToolCalls: true
    },
    text: 'done',
    reasoning: '',
    toolIntents: [],
    ...overrides
  }
}

function task(): TaskStateV1 {
  return {
    version: 1,
    identity,
    revision: 1,
    source: {
      objectiveItemId: 'user-1',
      sourceItemIds: ['user-1'],
      sourceDigest: 'source-1'
    },
    objective: '完成报告',
    constraints: [],
    completedActions: [],
    pendingActions: [{ id: 'next-1', text: '生成报告', status: 'pending', evidenceItemIds: [] }],
    activeSkillIds: [],
    artifacts: [],
    toolLedger: [],
    createdAt: 'now',
    updatedAt: 'now'
  }
}
