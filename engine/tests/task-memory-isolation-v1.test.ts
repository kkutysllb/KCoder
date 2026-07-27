import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MemoryCreateRequest,
  MemoryQuerySchema,
  QiongqiCapabilitiesConfig,
  type TaskScope
} from '@qiongqi/contracts'
import { FileMemoryStore } from '@qiongqi/memory'
import { createTaskCheckpoint, publishTaskMemory } from '@qiongqi/loop'

const scope: TaskScope = { ownerId: 'owner-1', workspaceId: 'workspace-1', taskId: 'task-1' }
const otherTask: TaskScope = { ...scope, taskId: 'task-2' }
const now = '2026-07-26T00:00:00.000Z'

describe('task memory v1 isolation', () => {
  const directories: string[] = []

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
  })

  it('isolates task-shared and agent-private records by their complete identities', async () => {
    const store = await createStore(directories)
    const checkpoint = createTaskCheckpoint({
      scope,
      objective: 'Ship Engine v1',
      provenance: [{ source: 'user:objective', digest: 'objective-digest', recordedAt: now }],
      nowIso: () => now
    })
    const shared = await publishTaskMemory({
      store,
      checkpoint,
      kind: 'objective',
      content: 'Ship Engine v1 with isolated durable memory',
      provenance: { source: 'checkpoint:1', digest: 'shared-digest', recordedAt: now },
      nowIso: () => now
    })
    const privateA = await store.create({
      content: 'Agent A private retry analysis',
      scope: 'agent_private',
      taskScope: scope,
      agentId: 'agent-a',
      agentRunId: 'agent-run-a',
      kind: 'reasoning_draft',
      provenance: { source: 'agent:agent-run-a', digest: 'private-a', recordedAt: now },
      retention: 'agent_run'
    })
    await store.create({
      content: 'Agent B private retry analysis',
      scope: 'agent_private',
      taskScope: scope,
      agentId: 'agent-b',
      agentRunId: 'agent-run-b',
      kind: 'reasoning_draft',
      provenance: { source: 'agent:agent-run-b', digest: 'private-b', recordedAt: now },
      retention: 'agent_run'
    })

    await expect(store.retrieve({ namespace: 'task_shared', query: 'Engine isolated memory', taskScope: scope, limit: 10 }))
      .resolves.toEqual([shared])
    await expect(store.retrieve({ namespace: 'task_shared', query: 'Engine isolated memory', taskScope: otherTask, limit: 10 }))
      .resolves.toEqual([])
    await expect(store.retrieve({
      namespace: 'agent_private', query: 'private retry analysis', taskScope: scope,
      agentId: 'agent-a', agentRunId: 'agent-run-a', limit: 10
    })).resolves.toEqual([privateA])
    await expect(store.retrieve({
      namespace: 'agent_private', query: 'private retry analysis', taskScope: scope,
      agentId: 'agent-b', agentRunId: 'agent-run-b', limit: 10
    })).resolves.not.toContainEqual(privateA)
  })

  it('rejects incomplete task/private scopes and raw shared observations', () => {
    expect(() => MemoryQuerySchema.parse({
      namespace: 'task_shared', query: 'memory',
      taskScope: { ownerId: scope.ownerId, workspaceId: scope.workspaceId }, limit: 5
    })).toThrow()
    expect(() => MemoryQuerySchema.parse({
      namespace: 'agent_private', query: 'memory', taskScope: scope, agentId: 'agent-a', limit: 5
    })).toThrow()
    expect(() => MemoryCreateRequest.parse({
      content: 'raw tool output',
      scope: 'task_shared',
      taskScope: scope,
      checkpointRevision: 1,
      kind: 'tool_observation',
      provenance: { source: 'tool:call-1', digest: 'raw-digest', recordedAt: now },
      retention: 'task',
      publishedAt: now,
      toolOutput: { unbounded: true }
    })).toThrow()
  })

  it('publishes only allowed shared kinds and requires evidence for factual claims', async () => {
    const store = await createStore(directories)
    const checkpoint = createTaskCheckpoint({
      scope,
      objective: 'Ship Engine v1',
      provenance: [{ source: 'user:objective', digest: 'objective-digest', recordedAt: now }],
      nowIso: () => now
    })

    await expect(store.create({
      scope: 'task_shared',
      taskScope: scope,
      checkpointRevision: checkpoint.revision,
      kind: 'objective',
      content: 'bypass publication governance',
      provenance: { source: 'direct:create', digest: 'bypass-digest', recordedAt: now },
      evidenceRefs: [],
      retention: 'task',
      publishedAt: now
    } as never)).rejects.toThrow(/publishTaskMemory/)

    await expect(publishTaskMemory({
      store,
      checkpoint,
      kind: 'evidence',
      content: 'All tests passed',
      provenance: { source: 'kernel:test', digest: 'claim-digest', recordedAt: now },
      nowIso: () => now
    })).rejects.toThrow(/evidence reference/)
    await expect(publishTaskMemory({
      store,
      checkpoint,
      kind: 'reasoning_draft',
      content: 'private reasoning',
      provenance: { source: 'agent:private', digest: 'private-digest', recordedAt: now },
      nowIso: () => now
    } as never)).rejects.toThrow(/not publishable/)
  })
})

async function createStore(directories: string[]): Promise<FileMemoryStore> {
  const directory = await mkdtemp(join(tmpdir(), 'qiongqi-task-memory-'))
  directories.push(directory)
  let id = 0
  return new FileMemoryStore({
    rootDir: directory,
    config: QiongqiCapabilitiesConfig.parse({ memory: { enabled: true } }).memory,
    nowIso: () => now,
    idGenerator: () => `memory-${++id}`
  })
}
