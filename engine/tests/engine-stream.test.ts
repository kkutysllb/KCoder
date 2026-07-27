import { describe, expect, it } from 'vitest'
import type { ModelClient, ModelRequest } from '@qiongqi/ports'
import { InMemoryDurableEngineStore } from '@qiongqi/adapter-storage'
import { ModelProposalRunner, EngineStreamPublisher } from '@qiongqi/loop'
import { LocalToolHost } from '@qiongqi/adapter-tools'
import { EngineStreamEventSchema, RoiSnapshotSchema } from '@qiongqi/contracts'

const scope = { ownerId: 'owner-1', workspaceId: 'workspace-1', taskId: 'task-1' }

function request(): ModelRequest {
  return {
    threadId: 'thread-1',
    turnId: 'turn-1',
    model: 'test-model',
    prefix: [],
    history: [],
    tools: [],
    abortSignal: new AbortController().signal
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('durable engine streaming', () => {
  it('persists the first provider text chunk before completion', async () => {
    const store = new InMemoryDurableEngineStore()
    const publisher = new EngineStreamPublisher({ store, streamId: 'stream-1', scope })
    const completion = deferred()
    const firstChunk = deferred()
    const client: ModelClient = {
      provider: 'test-provider',
      model: 'test-model',
      async *stream() {
        yield { kind: 'assistant_text_delta' as const, text: 'first' }
        firstChunk.resolve()
        await completion.promise
        yield { kind: 'completed' as const, stopReason: 'stop' }
      }
    }
    const runner = new ModelProposalRunner({
      client,
      onDelta: async (chunk) => publisher.publish({
        channel: 'public',
        kind: chunk.kind,
        payload: chunk
      })
    })

    const run = runner.run(request())
    await firstChunk.promise
    const beforeCompletion = await store.readStream('stream-1', 0, 10)
    expect(beforeCompletion.map((event) => event.payload)).toContainEqual({
      kind: 'assistant_text_delta',
      text: 'first'
    })
    completion.resolve()
    await run
  })

  it('resumes from a durable cursor and keeps private reasoning and acknowledgements isolated', async () => {
    const store = new InMemoryDurableEngineStore()
    const publisher = new EngineStreamPublisher({ store, streamId: 'stream-2', scope })
    await publisher.publish({ channel: 'public', kind: 'model.text.delta', payload: { text: 'a' } })
    await publisher.publish({ channel: 'public', kind: 'model.text.delta', payload: { text: 'b' } })
    await publisher.publish({ channel: 'private', kind: 'model.reasoning.delta', payload: { text: 'secret' } })

    const firstPage = await publisher.read('consumer-a', 0, 1)
    expect(firstPage).toHaveLength(1)
    const resumed = await publisher.read('consumer-a', firstPage[0]!.seq, 10)
    expect(resumed.map((event) => event.payload)).toContainEqual({ text: 'b' })
    expect(resumed.some((event) => event.kind.includes('reasoning'))).toBe(false)

    await publisher.ack('consumer-a', 2)
    await publisher.ack('consumer-b', 1)
  })

  it('streams tool start, progress and result lifecycle events', async () => {
    const store = new InMemoryDurableEngineStore()
    const publisher = new EngineStreamPublisher({ store, streamId: 'stream-tool', scope })
    const host = new LocalToolHost({ tools: [LocalToolHost.defineTool({
      name: 'streaming_tool',
      description: 'test tool streaming',
      inputSchema: { type: 'object', properties: {} },
      policy: 'auto',
      execute: async (_arguments, _context, onUpdate) => {
        await onUpdate?.({ output: { percent: 50 } })
        return { output: { done: true } }
      }
    })] })

    await host.execute(
      { callId: 'call-1', toolName: 'streaming_tool', arguments: {} },
      {
        threadId: 'thread-1',
        turnId: 'turn-1',
        workspace: '/workspace',
        approvalPolicy: 'auto',
        abortSignal: new AbortController().signal,
        awaitApproval: async () => 'allow',
        stream: publisher
      }
    )
    expect((await publisher.read('consumer', 0, 10)).map((event) => event.kind)).toEqual([
      'tool.started',
      'tool.progress',
      'tool.result'
    ])
  })

  it('persists complete graph correlation identity with each stream event', async () => {
    const store = new InMemoryDurableEngineStore()
    const graph = {
      graphId: 'graph-1', graphRevision: 2, graphDigest: 'a'.repeat(64), nodeId: 'node-1', edgeId: 'edge-1',
      attemptId: 'attempt-1', callerId: 'user-1', policyRevision: 3
    }
    const publisher = new EngineStreamPublisher({ store, streamId: 'stream-graph', scope, graph })
    await publisher.publish({ channel: 'public', kind: 'node.progress', payload: {} })

    await expect(store.readStream('stream-graph', 0, 10)).resolves.toMatchObject([{ graph }])
  })

  it('persists first-class branch correlation on stream events', () => {
    const event = EngineStreamEventSchema.parse({
      streamId: 'stream-branch',
      seq: 1,
      timestamp: '2026-07-27T00:00:00.000Z',
      scope,
      multiAgentRunId: 'run-parallel',
      branchId: 'research',
      channel: 'public',
      kind: 'branch.completed',
      payload: { output: 'facts' }
    })

    expect(event.branchId).toBe('research')
    expect(() => EngineStreamEventSchema.parse({ ...event, multiAgentRunId: undefined })).toThrow(
      'branchId requires multiAgentRunId'
    )
  })

  it('publishes and replays branch correlation through the durable stream', async () => {
    const store = new InMemoryDurableEngineStore()
    const publisher = new EngineStreamPublisher({
      store,
      streamId: 'stream-branch-publisher',
      scope,
      multiAgentRunId: 'run-parallel',
      branchId: 'research'
    })

    await publisher.publish({ channel: 'public', kind: 'branch.progress', payload: { percent: 50 } })

    await expect(publisher.read('consumer', 0, 10)).resolves.toMatchObject([{
      multiAgentRunId: 'run-parallel',
      branchId: 'research',
      kind: 'branch.progress'
    }])
  })

  it('parses real-time root ROI attribution by branch', () => {
    const snapshot = RoiSnapshotSchema.parse({
      scope,
      revision: 3,
      roiStatus: 'available',
      currency: 'USD',
      incurredCost: 3,
      businessValue: 9,
      netValue: 6,
      roiRatio: 2,
      engineEfficiency: {
        logicalAttempts: 3,
        physicalAttempts: 3,
        replayedAttempts: 0,
        suppressedAttempts: 0,
        estimatedWasteAvoided: 0
      },
      byBranch: {
        research: {
          roiStatus: 'available', currency: 'USD', incurredCost: 1, businessValue: 4,
          netValue: 3, roiRatio: 3,
          engineEfficiency: {
            logicalAttempts: 1, physicalAttempts: 1, replayedAttempts: 0,
            suppressedAttempts: 0, estimatedWasteAvoided: 0
          },
          updatedAt: '2026-07-27T00:00:00.000Z'
        }
      },
      updatedAt: '2026-07-27T00:00:00.000Z'
    })

    expect(snapshot.byBranch?.research?.incurredCost).toBe(1)
  })
})
