import { describe, expect, it } from 'vitest'
import { GraphRevisionSchema, WorkGraphEventRecordSchema } from '@qiongqi/contracts'
import { projectWorkGraph } from '@qiongqi/loop'

describe('work graph projector', () => {
  it('separates intended topology from executed node and edge attempts', () => {
    const revision = GraphRevisionSchema.parse({
      schemaVersion: 1,
      graphId: 'graph-1',
      revision: 1,
      graphDigest: 'a'.repeat(64),
      startNodeId: 'manager',
      nodes: [
        { id: 'manager', kind: 'agent', agentId: 'manager' },
        { id: 'done', kind: 'terminate' }
      ],
      edges: [{ edgeId: 'edge-1', from: 'manager', to: 'done', condition: 'completed' }],
      publishedAt: '2026-07-26T00:00:00.000Z',
      diagnostics: []
    })
    const base = {
      scope: { ownerId: 'owner-1', workspaceId: 'workspace-1', taskId: 'task-1' },
      runId: 'run-1',
      graphId: 'graph-1',
      graphRevision: 1,
      attemptId: 'attempt-1',
      timestamp: '2026-07-26T00:00:00.000Z',
      payload: {}
    }
    const events = [
      WorkGraphEventRecordSchema.parse({ ...base, eventId: 'event-1', seq: 1, nodeId: 'manager', kind: 'node_started' }),
      WorkGraphEventRecordSchema.parse({ ...base, eventId: 'event-2', seq: 2, edgeId: 'edge-1', kind: 'edge_selected' }),
      WorkGraphEventRecordSchema.parse({ ...base, eventId: 'event-3', seq: 3, edgeId: 'edge-1', kind: 'edge_traversed' }),
      WorkGraphEventRecordSchema.parse({ ...base, eventId: 'event-4', seq: 4, nodeId: 'manager', kind: 'node_completed' })
    ]

    expect(projectWorkGraph(revision, events)).toMatchObject({
      intended: { nodeIds: ['manager', 'done'], edgeIds: ['edge-1'] },
      executed: {
        nodes: { manager: { attempts: 1, completed: 1 } },
        edges: { 'edge-1': { selected: 1, traversed: 1, rejected: 0 } }
      }
    })
  })
})
