import type {
  AgentExecutionView,
  ChildRunRecord,
  ExecutionStatus,
  KernelV3TurnExecutionView,
  RuntimeDecision,
  RuntimeDecisionView,
  ThreadRecord,
  ToolRunView,
  Turn,
  TurnItemStatus
} from '@qiongqi/contracts'
import type { AgentTranscriptStore } from '@qiongqi/ports'
import {
  sanitizeTranscript,
  sanitizeTurnExecution,
  sanitizeUserFacingError,
  type TurnExecutionSanitizerOptions
} from './turn-execution-sanitizer.js'

export interface KernelV3ExecutionAdapterContract {
  project(input: {
    thread: ThreadRecord
    turn: Turn
    childRuns: ChildRunRecord[]
  }): Promise<KernelV3TurnExecutionView>
}

export type KernelV3ExecutionAdapterDeps = {
  transcripts: Pick<AgentTranscriptStore, 'load'>
  sanitizerOptions: TurnExecutionSanitizerOptions
}

export class KernelV3ExecutionAdapter implements KernelV3ExecutionAdapterContract {
  constructor(private readonly deps: KernelV3ExecutionAdapterDeps) {}

  async project(input: {
    thread: ThreadRecord
    turn: Turn
    childRuns: ChildRunRecord[]
  }): Promise<KernelV3TurnExecutionView> {
    if (input.thread.id !== input.turn.threadId) {
      throw new Error('turn does not belong to thread')
    }
    if (input.turn.runtimeDecision?.effectiveMode !== 'kernel_v3') {
      throw new Error('kernel_v3 projection requires a persisted kernel_v3 decision')
    }

    const rootKey = `root:${input.turn.id}`
    const children = input.childRuns
      .filter((child) =>
        child.parentThreadId === input.thread.id &&
        child.parentTurnId === input.turn.id &&
        child.scope.kind === 'root_turn' &&
        child.publicKey !== undefined &&
        child.sequence !== undefined)
      .sort((left, right) =>
        left.sequence! - right.sequence! || left.publicKey!.localeCompare(right.publicKey!))

    const agents = await Promise.all([
      Promise.resolve(projectRootAgent(input.turn, rootKey)),
      ...children.map((child) => this.projectChildAgent(input.turn, child, rootKey))
    ])
    const projected = sanitizeTurnExecution({
      version: 1,
      available: true,
      revision: 'sha256:unrevisioned',
      mode: 'kernel_v3',
      status: input.turn.status,
      decision: publicDecision(input.turn.runtimeDecision),
      agents,
      delegation: {
        roots: [rootKey],
        edges: children.map((child) => ({ from: rootKey, to: child.publicKey! }))
      }
    }, this.deps.sanitizerOptions)

    if (!projected.available || projected.mode !== 'kernel_v3') {
      throw new Error('kernel_v3 projection produced an invalid mode')
    }
    return projected
  }

  private async projectChildAgent(
    turn: Turn,
    child: ChildRunRecord,
    rootKey: string
  ): Promise<AgentExecutionView> {
    const transcript = child.transcriptRef
      ? await this.deps.transcripts.load(child.transcriptRef)
      : undefined
    const transcriptMatches = transcript &&
      transcript.threadId === child.parentThreadId &&
      transcript.turnId === child.parentTurnId &&
      transcript.ownerPublicKey === child.publicKey
      ? transcript
      : undefined
    const content = transcriptMatches
      ? sanitizeTranscript(transcriptMatches, this.deps.sanitizerOptions)
      : { messages: [], reasoning: [], toolRuns: [] }
    const pending = Boolean(child.transcriptRef) && !transcriptMatches

    return {
      key: child.publicKey!,
      parentKey: rootKey,
      sequence: child.sequence!,
      role: 'child',
      name: child.label?.trim() || 'Child Agent',
      task: child.prompt,
      status: child.status,
      startedAt: child.createdAt,
      ...(isTerminal(child.status) ? { completedAt: child.updatedAt } : {}),
      durationMs: durationBetween(child.createdAt, child.updatedAt),
      usage: {
        promptTokens: child.usage.promptTokens,
        completionTokens: child.usage.completionTokens,
        totalTokens: child.usage.totalTokens,
        ...(child.usage.costUsd !== undefined ? { costUsd: child.usage.costUsd } : {}),
        ...(child.usage.costCny !== undefined ? { costCny: child.usage.costCny } : {})
      },
      ...content,
      ...(pending
        ? {
            summary: '等待同步',
            error: { code: 'execution_data_pending', message: '执行详情仍在同步' }
          }
        : child.summary !== undefined
          ? { summary: child.summary }
          : {}),
      ...(!pending && child.error ? { error: sanitizeUserFacingError(child.error) } : {}),
      retries: []
    }
  }
}

export function projectRootAgent(turn: Turn, rootKey: string): AgentExecutionView {
  const seenSourceRefs = new Set<string>()
  const messages = turn.items.flatMap((item, index) => {
    if (item.kind !== 'assistant_text') return []
    const sourceRef = item.sourceRef ?? `${rootKey}:item:${index + 1}`
    if (seenSourceRefs.has(sourceRef)) return []
    seenSourceRefs.add(sourceRef)
    return [{
      key: `${rootKey}:message:${seenSourceRefs.size}`,
      sourceRef,
      role: 'assistant' as const,
      content: item.text,
      createdAt: item.createdAt,
      artifactKeys: []
    }]
  })
  const toolRuns = projectRootToolRuns(turn, rootKey)
  const finalMessage = messages.at(-1)
  return {
    key: rootKey,
    sequence: 1,
    role: 'root',
    name: 'Root Agent',
    task: turn.prompt,
    status: turn.status,
    ...(turn.startedAt ? { startedAt: turn.startedAt } : {}),
    ...(turn.finishedAt ? { completedAt: turn.finishedAt } : {}),
    ...(turn.startedAt && turn.finishedAt
      ? { durationMs: durationBetween(turn.startedAt, turn.finishedAt) }
      : {}),
    messages,
    reasoning: [],
    toolRuns,
    ...(finalMessage ? { summary: finalMessage.content } : {}),
    ...(turn.error ? { error: sanitizeUserFacingError(turn.error) } : {}),
    retries: []
  }
}

function projectRootToolRuns(turn: Turn, rootKey: string): ToolRunView[] {
  const results = new Map(turn.items
    .filter((item) => item.kind === 'tool_result')
    .map((item) => [item.callId, item] as const))
  let sequence = 0
  return turn.items.flatMap((item) => {
    if (item.kind !== 'tool_call') return []
    sequence += 1
    const result = results.get(item.callId)
    return [{
      key: `${rootKey}:tool:${sequence}`,
      toolName: item.toolName,
      status: result?.isError ? 'failed' : mapItemStatus(result?.status ?? item.status),
      input: item.arguments,
      ...(result ? { result: result.output } : {}),
      artifactKeys: []
    }]
  })
}

function publicDecision(decision: RuntimeDecision): RuntimeDecisionView {
  return {
    preferredMode: decision.preferredMode,
    effectiveMode: decision.effectiveMode,
    preference: decision.preference,
    source: decision.source,
    reasonCode: decision.reasonCode,
    reason: decision.reason,
    ...(decision.fallbackReasonCode ? { fallbackReasonCode: decision.fallbackReasonCode } : {}),
    ...(decision.fallbackReason ? { fallbackReason: decision.fallbackReason } : {}),
    rolloutStage: decision.rolloutStage,
    decidedAt: decision.decidedAt
  }
}

function mapItemStatus(status: TurnItemStatus): ExecutionStatus {
  return status === 'pending' ? 'queued' : status
}

function durationBetween(startedAt: string, completedAt: string): number {
  const duration = Date.parse(completedAt) - Date.parse(startedAt)
  return Number.isFinite(duration) ? Math.max(0, duration) : 0
}

function isTerminal(status: ExecutionStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'aborted'
}
