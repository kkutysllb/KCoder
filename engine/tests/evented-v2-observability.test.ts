import { describe, expect, it } from 'vitest'
import type { MultiAgentRun } from '@qiongqi/contracts'
import { buildEventedV2RunMetrics, buildEventedV2RunTimeline } from '@qiongqi/loop'

describe('evented v2 observability projections', () => {
  it('projects a run timeline with events, agent runs, and outbox state', () => {
    const timeline = buildEventedV2RunTimeline(sampleRun())

    expect(timeline).toMatchObject({
      runId: 'mar_1',
      status: 'suspended',
      activeNodeId: 'wait_approval',
      events: [
        { seq: 0, type: 'run_started', agentId: 'manager' },
        { seq: 1, type: 'node_completed', nodeId: 'manager', agentId: 'manager' },
        { seq: 2, type: 'node_started', nodeId: 'wait_approval' }
      ],
      agentRuns: [
        {
          agentRunId: 'agent_run_1',
          agentId: 'manager',
          status: 'completed',
          peerArtifact: {
            peerCardId: 'peer_manager',
            status: 'completed',
            artifacts: [{
              id: 'artifact_1',
              mimeType: 'text/markdown',
              text: '# Done',
              tags: ['assistant_text'],
              isError: false
            }]
          }
        }
      ],
      outbox: [
        { outboxId: 'outbox_1', status: 'pending', messageId: 'msg_1' }
      ]
    })
  })

  it('projects aggregate metrics across multi-agent runs', () => {
    const metrics = buildEventedV2RunMetrics([
      sampleRun(),
      { ...sampleRun(), runId: 'mar_2', status: 'completed', outbox: [] }
    ])

    expect(metrics).toEqual({
      totalRuns: 2,
      byStatus: { suspended: 1, completed: 1 },
      agentRuns: {
        total: 2,
        byStatus: { completed: 2 },
        byAgent: { manager: 2 }
      },
      outbox: {
        total: 1,
        pending: 1,
        published: 0,
        runsWithPendingOutbox: 1
      }
    })
  })

  it('projects retry amplification, fan-out, and critical-path latency without payload inspection', () => {
    const run = sampleRun()
    run.branchStatus = { research: 'completed', review: 'completed' }
    run.retryCounters = { manager: 1 }
    run.agentRuns.push({
      ...run.agentRuns[0]!,
      agentRunId: 'agent_run_2',
      startedAt: '2026-07-21T00:00:01.000Z',
      completedAt: '2026-07-21T00:00:02.000Z',
      updatedAt: '2026-07-21T00:00:02.000Z'
    })

    expect(buildEventedV2RunTimeline(run).graphMetrics).toEqual({
      fanOut: 2,
      physicalAttempts: 2,
      retryCount: 1,
      retryAmplification: 2,
      criticalPathLatencyMs: 2_000
    })
  })
})

function sampleRun(): MultiAgentRun {
  return {
    version: 1,
    runId: 'mar_1',
    threadId: 'thread_1',
    turnId: 'turn_1',
    workspaceKey: 'workspace_1',
    status: 'suspended',
    graphId: 'graph_1',
    activeNodeId: 'wait_approval',
    activeAgentStack: ['manager'],
    branchStatus: {},
    agentRuns: [{
      agentRunId: 'agent_run_1',
      agentId: 'manager',
      nodeId: 'manager',
      status: 'completed',
      startedAt: '2026-07-21T00:00:00.000Z',
      updatedAt: '2026-07-21T00:00:01.000Z',
      completedAt: '2026-07-21T00:00:01.000Z',
      summary: 'done',
      peerArtifact: {
        peerCardId: 'peer_manager',
        status: 'completed',
        summary: 'done',
        artifacts: [{
          id: 'artifact_1',
          mimeType: 'text/markdown',
          text: '# Done',
          tags: ['assistant_text'],
          isError: false
        }]
      }
    }],
    events: [
      {
        eventId: 'mae_1',
        type: 'run_started',
        nodeId: 'manager',
        agentId: 'manager',
        timestamp: '2026-07-21T00:00:00.000Z'
      },
      {
        eventId: 'mae_2',
        type: 'node_completed',
        nodeId: 'manager',
        agentId: 'manager',
        payload: { condition: 'completed' },
        timestamp: '2026-07-21T00:00:01.000Z'
      },
      {
        eventId: 'mae_3',
        type: 'node_started',
        nodeId: 'wait_approval',
        timestamp: '2026-07-21T00:00:02.000Z'
      }
    ],
    outbox: [{
      outboxId: 'outbox_1',
      kind: 'mailbox_enqueue',
      status: 'pending',
      message: {
        messageId: 'msg_1',
        envelopeId: 'env_1',
        runId: 'mar_1',
        fromAgentId: 'manager',
        toAgentId: 'researcher',
        status: 'queued',
        payload: { prompt: 'Research.' },
        createdAt: '2026-07-21T00:00:00.000Z',
        updatedAt: '2026-07-21T00:00:00.000Z'
      },
      createdAt: '2026-07-21T00:00:00.000Z',
      updatedAt: '2026-07-21T00:00:00.000Z'
    }],
    retryCounters: {},
    budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:02.000Z'
  }
}
