import { describe, expect, it } from 'vitest'
import {
  ExecutionContextSchema,
  GraphRunRecordSchema,
  RootRunAggregateErrorCodeSchema,
  WorkGraphEventKindSchema,
  WorkGraphEventSchema
} from '@qiongqi/contracts'

const scope = { ownerId: 'owner', workspaceId: 'workspace', taskId: 'task' }
const timestamp = '2026-07-26T00:00:00.000Z'
const digest = 'a'.repeat(64)

const parent = {
  scope,
  graphId: 'graph',
  graphRevision: 1,
  graphDigest: digest,
  multiAgentRunId: 'run',
  attemptId: 'attempt-root',
  callerIdentity: { kind: 'service', callerId: 'caller' },
  policyRevision: 1
}

describe('graph runtime contracts', () => {
  it('accepts a child execution context that preserves its parent graph identity', () => {
    expect(ExecutionContextSchema.parse({
      ...parent,
      nodeId: 'agent',
      agentRunId: 'agent-run',
      attemptId: 'attempt-child',
      parent
    })).toMatchObject({ graphRevision: 1, parent: { attemptId: 'attempt-root' } })
  })

  it('rejects a child execution context that contradicts its graph parent', () => {
    expect(() => ExecutionContextSchema.parse({
      ...parent,
      graphRevision: 2,
      nodeId: 'agent',
      agentRunId: 'agent-run',
      attemptId: 'attempt-child',
      parent
    })).toThrow('child execution context must preserve parent graph identity')
  })

  it('requires edge facts to carry an edge identity', () => {
    expect(() => WorkGraphEventSchema.parse({
      eventId: 'event', scope, runId: 'run', graphId: 'graph', graphRevision: 1,
      attemptId: 'attempt', kind: 'edge_traversed', payload: {}, timestamp
    })).toThrow('edge work events require edgeId')
  })

  it('preserves stable branch identity on durable work events', () => {
    expect(WorkGraphEventSchema.parse({
      eventId: 'event-branch', scope, runId: 'run', graphId: 'graph', graphRevision: 1,
      nodeId: 'reviewer', branchId: 'review', attemptId: 'attempt', kind: 'branch_completed',
      payload: {}, timestamp
    })).toMatchObject({ branchId: 'review', kind: 'branch_completed' })
  })

  it('pins graph revision and digest on graph runs', () => {
    expect(GraphRunRecordSchema.parse({
      schemaVersion: 1, scope, runId: 'run', threadId: 'thread', turnId: 'turn',
      workspaceKey: 'workspace', graphId: 'graph', graphRevision: 1, graphDigest: digest,
      version: 1, status: 'running', circuitState: 'running', activeNodeIds: ['agent'],
      budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
      createdAt: timestamp, updatedAt: timestamp
    })).toMatchObject({ graphRevision: 1, graphDigest: digest })
  })

  it('exposes stable aggregate errors and the repair audit event kind', () => {
    expect(RootRunAggregateErrorCodeSchema.options).toEqual([
      'ROOT_RUN_AGGREGATE_INCOMPLETE',
      'ROOT_RUN_AGGREGATE_DIVERGED',
      'ROOT_RUN_BUDGET_MISSING'
    ])
    expect(WorkGraphEventKindSchema.parse('root_run_repaired')).toBe('root_run_repaired')
  })

  it('exposes durable branch and join work-event kinds', () => {
    expect([
      'branch_spawned',
      'branch_started',
      'branch_completed',
      'branch_failed',
      'branch_cancelled',
      'join_waiting',
      'join_completed'
    ].map((kind) => WorkGraphEventKindSchema.parse(kind))).toEqual([
      'branch_spawned',
      'branch_started',
      'branch_completed',
      'branch_failed',
      'branch_cancelled',
      'join_waiting',
      'join_completed'
    ])
  })
})
