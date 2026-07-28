import { describe, expect, it } from 'vitest'
import { InMemoryEventBus, InMemorySessionStore, InMemoryThreadStore } from '@qiongqi/adapter-storage'
import { GraphRunRecordSchema } from '@qiongqi/contracts'
import { createThreadRecord } from '@qiongqi/domain'
import { GovernedTurnRuntime } from '@qiongqi/http'
import { ContextCompactor, InflightTracker, SteeringQueue } from '@qiongqi/loop'
import { SequentialIdGenerator } from '@qiongqi/ports'
import { RuntimeEventRecorder, TurnService } from '@qiongqi/services'

const timestamp = '2026-07-28T00:00:00.000Z'
const governedExecution = {
  scope: { ownerId: 'owner', workspaceId: 'workspace', taskId: 'task-governed' },
  graphRef: { graphId: 'report-flow', revision: 4 },
  budgetLimits: { stepsUsed: 10, toolCallsUsed: 5, inputTokens: 10_000, outputTokens: 2_000, costUsd: 1 },
  modelPolicy: { authorizedProfileIds: ['model-primary'] }
}

describe('GovernedTurnRuntime', () => {
  it('starts once, persists the binding, and reuses it on replay', async () => {
    const h = await harness()
    const started = await h.turns.startTurn({
      threadId: 'thread-1', request: { prompt: 'build report', governedExecution }
    })

    const first = await h.runtime.runTurn('thread-1', started.turnId)
    const second = await h.runtime.runTurn('thread-1', started.turnId)

    expect(h.engine.starts).toHaveLength(1)
    expect(second).toEqual(first)
    expect(await h.turns.getTurn('thread-1', started.turnId)).toMatchObject({
      governedBinding: {
        multiAgentRunId: 'mar-started',
        streamId: 'stream:mar-started',
        graphRef: governedExecution.graphRef,
        boundAt: timestamp
      }
    })
    expect(h.engine.starts[0]).toMatchObject({
      ...governedExecution,
      threadId: 'thread-1',
      turnId: started.turnId,
      workspaceKey: '/workspace',
      prompt: 'build report'
    })
  })

  it('recovers the crash gap from an existing correlated GraphRun', async () => {
    const h = await harness()
    const started = await h.turns.startTurn({
      threadId: 'thread-1', request: { prompt: 'build report', governedExecution }
    })
    h.records.push(graphRun('mar-existing', started.turnId, 'running'))

    const binding = await h.runtime.runTurn('thread-1', started.turnId)

    expect(h.engine.starts).toHaveLength(0)
    expect(binding).toMatchObject({ multiAgentRunId: 'mar-existing', streamId: 'stream:mar-existing' })
  })

  it.each(['completed', 'failed', 'aborted'] as const)('projects terminal GraphRun status %s exactly once', async (status) => {
    const h = await harness()
    const started = await h.turns.startTurn({
      threadId: 'thread-1', request: { prompt: 'build report', governedExecution }
    })
    await h.runtime.runTurn('thread-1', started.turnId)
    h.engine.status = status

    await h.runtime.inspect('thread-1', started.turnId)
    const first = await h.turns.getTurn('thread-1', started.turnId)
    await h.runtime.inspect('thread-1', started.turnId)
    const second = await h.turns.getTurn('thread-1', started.turnId)

    expect(first?.status).toBe(status)
    expect(second).toEqual(first)
  })
})

async function harness() {
  const bus = new InMemoryEventBus()
  const threadStore = new InMemoryThreadStore()
  const sessionStore = new InMemorySessionStore()
  const events = new RuntimeEventRecorder({
    eventBus: bus, sessionStore, allocateSeq: (threadId) => bus.allocateSeq(threadId), nowIso: () => timestamp
  })
  const turns = new TurnService({
    threadStore,
    sessionStore,
    events,
    inflight: new InflightTracker(),
    steering: new SteeringQueue(),
    compactor: new ContextCompactor(),
    ids: new SequentialIdGenerator(),
    nowIso: () => timestamp
  })
  await threadStore.upsert(createThreadRecord({
    id: 'thread-1', title: 'Governed', workspace: '/workspace', model: 'model-a', createdAt: timestamp
  }))
  const records: ReturnType<typeof graphRun>[] = []
  const engine = {
    starts: [] as unknown[],
    status: 'running' as ReturnType<typeof graphRun>['status'],
    async start(input: unknown) { this.starts.push(input); return { multiAgentRunId: 'mar-started', streamId: 'stream:mar-started' } },
    async inspect(runId: string) {
      const turnId = (this.starts[0] as { turnId?: string } | undefined)?.turnId ?? 'turn-1'
      return records.find((record) => record.runId === runId) ?? graphRun(runId, turnId, this.status)
    },
    async cancel() { this.status = 'aborted' as const }
  }
  const runtime = new GovernedTurnRuntime({
    engine,
    store: { listGraphRuns: async () => [...records] },
    turns,
    threads: { get: async () => threadStore.get('thread-1') },
    nowIso: () => timestamp
  })
  return { turns, engine, runtime, records }
}

function graphRun(runId: string, turnId: string, status: 'running' | 'completed' | 'failed' | 'aborted') {
  return GraphRunRecordSchema.parse({
    schemaVersion: 1,
    scope: governedExecution.scope,
    runId,
    threadId: 'thread-1',
    turnId,
    workspaceKey: '/workspace',
    graphId: governedExecution.graphRef.graphId,
    graphRevision: governedExecution.graphRef.revision,
    graphDigest: 'a'.repeat(64),
    version: 1,
    status,
    circuitState: 'running',
    activeNodeIds: status === 'running' ? ['agent'] : [],
    budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    createdAt: timestamp,
    updatedAt: timestamp
  })
}
