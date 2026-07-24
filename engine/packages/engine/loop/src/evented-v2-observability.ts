import type { AgentRun, MultiAgentEvent, MultiAgentOutboxIntent, MultiAgentRun, PeerArtifact } from '@qiongqi/contracts'

export type EventedV2TimelineEvent = MultiAgentEvent & {
  seq: number
}

export type EventedV2TimelineAgentRun = Pick<
  AgentRun,
  'agentRunId' | 'agentId' | 'nodeId' | 'status' | 'startedAt' | 'updatedAt'
> & {
  completedAt?: string
  summary?: string
  error?: string
  peerArtifact?: PeerArtifact
}

export type EventedV2TimelineOutboxIntent = Pick<
  MultiAgentOutboxIntent,
  'outboxId' | 'kind' | 'status' | 'createdAt' | 'updatedAt'
> & {
  publishedAt?: string
  messageId: string
  envelopeId?: string
  fromAgentId?: string
  toAgentId?: string
  mailboxStatus?: 'completed' | 'failed' | 'aborted'
}

export type EventedV2RunTimeline = Pick<
  MultiAgentRun,
  | 'runId'
  | 'threadId'
  | 'turnId'
  | 'workspaceKey'
  | 'graphId'
  | 'status'
  | 'activeNodeId'
  | 'activeAgentStack'
  | 'branchStatus'
  | 'retryCounters'
  | 'budgets'
  | 'createdAt'
  | 'updatedAt'
> & {
  events: EventedV2TimelineEvent[]
  agentRuns: EventedV2TimelineAgentRun[]
  outbox: EventedV2TimelineOutboxIntent[]
}

export type EventedV2RunMetrics = {
  totalRuns: number
  byStatus: Record<string, number>
  agentRuns: {
    total: number
    byStatus: Record<string, number>
    byAgent: Record<string, number>
  }
  outbox: {
    total: number
    pending: number
    published: number
    runsWithPendingOutbox: number
  }
}

export function buildEventedV2RunTimeline(run: MultiAgentRun): EventedV2RunTimeline {
  return {
    runId: run.runId,
    threadId: run.threadId,
    turnId: run.turnId,
    workspaceKey: run.workspaceKey,
    graphId: run.graphId,
    status: run.status,
    activeNodeId: run.activeNodeId,
    activeAgentStack: [...run.activeAgentStack],
    branchStatus: { ...run.branchStatus },
    retryCounters: { ...run.retryCounters },
    budgets: { ...run.budgets },
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    events: run.events.map((event, seq) => ({ seq, ...event })),
    agentRuns: run.agentRuns.map((agentRun) => ({
      agentRunId: agentRun.agentRunId,
      agentId: agentRun.agentId,
      nodeId: agentRun.nodeId,
      status: agentRun.status,
      startedAt: agentRun.startedAt,
      updatedAt: agentRun.updatedAt,
      ...(agentRun.completedAt !== undefined ? { completedAt: agentRun.completedAt } : {}),
      ...(agentRun.summary !== undefined ? { summary: agentRun.summary } : {}),
      ...(agentRun.error !== undefined ? { error: agentRun.error } : {}),
      ...(agentRun.peerArtifact !== undefined ? { peerArtifact: agentRun.peerArtifact } : {})
    })),
    outbox: run.outbox.map((intent) => intent.kind === 'mailbox_enqueue'
      ? {
          outboxId: intent.outboxId,
          kind: intent.kind,
          status: intent.status,
          messageId: intent.message.messageId,
          envelopeId: intent.message.envelopeId,
          fromAgentId: intent.message.fromAgentId,
          toAgentId: intent.message.toAgentId,
          createdAt: intent.createdAt,
          updatedAt: intent.updatedAt,
          ...(intent.publishedAt !== undefined ? { publishedAt: intent.publishedAt } : {})
        }
      : {
          outboxId: intent.outboxId,
          kind: intent.kind,
          status: intent.status,
          messageId: intent.messageId,
          mailboxStatus: intent.mailboxStatus,
          createdAt: intent.createdAt,
          updatedAt: intent.updatedAt,
          ...(intent.publishedAt !== undefined ? { publishedAt: intent.publishedAt } : {})
        })
  }
}

export function buildEventedV2RunMetrics(runs: readonly MultiAgentRun[]): EventedV2RunMetrics {
  const metrics: EventedV2RunMetrics = {
    totalRuns: runs.length,
    byStatus: {},
    agentRuns: {
      total: 0,
      byStatus: {},
      byAgent: {}
    },
    outbox: {
      total: 0,
      pending: 0,
      published: 0,
      runsWithPendingOutbox: 0
    }
  }

  for (const run of runs) {
    increment(metrics.byStatus, run.status)
    if (run.outbox.some((intent) => intent.status === 'pending')) metrics.outbox.runsWithPendingOutbox += 1
    for (const agentRun of run.agentRuns) {
      metrics.agentRuns.total += 1
      increment(metrics.agentRuns.byStatus, agentRun.status)
      increment(metrics.agentRuns.byAgent, agentRun.agentId)
    }
    for (const intent of run.outbox) {
      metrics.outbox.total += 1
      if (intent.status === 'pending') metrics.outbox.pending += 1
      if (intent.status === 'published') metrics.outbox.published += 1
    }
  }

  return metrics
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1
}
