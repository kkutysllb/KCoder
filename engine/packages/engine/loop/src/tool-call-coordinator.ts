/**
 * ToolCallCoordinator owns everything that happens between "the model
 * emitted N tool calls" and "those calls are persisted as tool_result
 * items": approval gating, parallel batching of read-only built-ins,
 * storm-breaker suppression, live partial updates, and structured user
 * input.
 *
 * Extracted verbatim from the legacy monolithic `AgentLoop`.
 */

import type {
  ToolHost,
  ToolCallLike,
  ToolHostContext,
  ToolHostResult,
  GuiPlanContext,
  ToolProviderKind
} from '@qiongqi/ports'
import type { ApprovalGate } from '@qiongqi/ports'
import type { UserInputGate, UserInputResolution } from '@qiongqi/ports'
import type { RuntimeEventRecorder } from '@qiongqi/services'
import type { TurnService } from '@qiongqi/services'
import type { IdGenerator } from '@qiongqi/ports'
import type { ModelCapabilityMetadata, RunIdentity, RunStateV3, ToolEffectPolicy, TurnItem } from '@qiongqi/contracts'
import { join } from 'node:path'
import {
  makeToolResultItem,
  makeUserInputItem
} from '@qiongqi/domain'
import { ToolStormBreaker, type ToolStormBreakerOptions } from './tool-storm-breaker.js'
import { InflightTracker } from './inflight-tracker.js'
import { repairDispatchToolArguments } from './tool-call-repair.js'
import { CREATE_PLAN_TOOL_NAME } from '@qiongqi/adapter-tools'
import {
  PARALLEL_READ_ONLY_TOOL_NAMES,
  MAX_PARALLEL_TOOL_CALLS
} from './loop-helpers.js'
import type { ToolRuntimeV3 } from './tool-runtime-v3.js'
import { isRecoverableToolDispatchError } from './tool-dispatch-errors.js'

const TOOL_OUTPUT_MAX_INLINE_BYTES = 64 * 1024
const TOOL_OUTPUT_PREVIEW_HEAD_BYTES = 4 * 1024
const TOOL_OUTPUT_PREVIEW_TAIL_BYTES = 4 * 1024

export type ToolCallCoordinatorDeps = {
  toolHost: ToolHost
  approvalGate: ApprovalGate
  userInputGate: UserInputGate
  inflight: InflightTracker
  events: RuntimeEventRecorder
  turns: TurnService
  ids: IdGenerator
  nowIso: () => string
  memoryStoreEnabled: boolean
  runtimeDataDir?: string
  toolStorm?: ToolStormBreakerOptions & { enabled?: boolean }
  onPlanWritten?: (input: {
    threadId: string
    turnId: string
    planId: string
    relativePath: string
    markdown: string
  }) => Promise<void>
  toolRuntime?: ToolRuntimeV3
}

export class ToolCallCoordinator {
  private readonly toolStormBreakers = new Map<string, ToolStormBreaker>()
  private readonly runtimeStates = new Map<string, RunStateV3>()

  constructor(private readonly deps: ToolCallCoordinatorDeps) {}

  setupTurn(turnId: string): void {
    if (this.deps.toolStorm?.enabled !== false) {
      this.toolStormBreakers.set(turnId, new ToolStormBreaker(this.deps.toolStorm))
    }
  }

  cleanupTurn(turnId: string): void {
    this.toolStormBreakers.delete(turnId)
    this.runtimeStates.delete(turnId)
  }

  async dispatch(input: {
    calls: ToolCallLike[]
    threadId: string
    turnId: string
    workspace: string
    ownerUserId?: string
    workModeId?: string
    threadMode?: 'agent' | 'plan'
    activePlanContext?: GuiPlanContext
    modelCapabilities: ModelCapabilityMetadata
    activeSkillIds: readonly string[]
    allowedToolNames?: readonly string[]
    toolProviderKinds: ReadonlyMap<string, ToolProviderKind | undefined>
    approvalPolicy: ToolHostContext['approvalPolicy']
    signal: AbortSignal
  }): Promise<'continue' | 'aborted'> {
    const runtimeIdentity = this.deps.toolRuntime ? makeRuntimeIdentity(input) : undefined
    const runtimeState = runtimeIdentity ? this.runtimeStates.get(input.turnId) ?? makeRuntimeState(runtimeIdentity) : undefined
    if (runtimeState) this.runtimeStates.set(input.turnId, runtimeState)
    const context = this.createToolContext({
      ...input,
      ...(runtimeIdentity ? { runtimeIdentity } : {}),
      ...(runtimeState
        ? {
          runtimeState,
          runtimeStateSink: (next: RunStateV3) => {
            const current = this.runtimeStates.get(input.turnId)
            this.runtimeStates.set(input.turnId, current ? mergeRuntimeEffectState(current, next) : next)
          }
        }
        : {})
    })
    let index = 0

    while (index < input.calls.length) {
      if (input.signal.aborted) return 'aborted'

      const call = input.calls[index]
      if (!call) break

      const storm = this.toolStormBreakers.get(input.turnId)?.inspect(call)
      if (storm?.suppress) {
        await this.persistSuppressedToolCall({
          threadId: input.threadId,
          turnId: input.turnId,
          call,
          reason: storm.reason
        })
        index += 1
        continue
      }

      if (!this.isParallelSafeToolCall(call, input.approvalPolicy, input.toolProviderKinds)) {
        const result = await this.executeToolCall({
          threadId: input.threadId,
          turnId: input.turnId,
          call,
          context
        })
        await this.persistToolCallResult(input.threadId, input.turnId, call, result)
        index += 1
        continue
      }

      const batch: ToolCallLike[] = [call]
      index += 1
      let suppressedAfterBatch: { call: ToolCallLike; reason?: string } | undefined

      while (batch.length < MAX_PARALLEL_TOOL_CALLS && index < input.calls.length) {
        const next = input.calls[index]
        if (!next) break
        if (!this.isParallelSafeToolCall(next, input.approvalPolicy, input.toolProviderKinds)) break

        const nextStorm = this.toolStormBreakers.get(input.turnId)?.inspect(next)
        if (nextStorm?.suppress) {
          suppressedAfterBatch = { call: next, reason: nextStorm.reason }
          index += 1
          break
        }

        batch.push(next)
        index += 1
      }

      const settled = await Promise.allSettled(
        batch.map((entry) =>
          this.executeToolCall({
            threadId: input.threadId,
            turnId: input.turnId,
            call: entry,
            context
          })
        )
      )
      for (let batchIndex = 0; batchIndex < batch.length; batchIndex += 1) {
        const result = settled[batchIndex]
        const batchCall = batch[batchIndex]
        if (!result || !batchCall) continue
        if (result.status === 'rejected') throw result.reason
        await this.persistToolCallResult(input.threadId, input.turnId, batchCall, result.value)
      }

      if (suppressedAfterBatch) {
        await this.persistSuppressedToolCall({
          threadId: input.threadId,
          turnId: input.turnId,
          call: suppressedAfterBatch.call,
          reason: suppressedAfterBatch.reason
        })
      }
    }

    return 'continue'
  }

  isParallelSafeToolCall(
    call: ToolCallLike,
    approvalPolicy: ToolHostContext['approvalPolicy'],
    toolProviderKinds: ReadonlyMap<string, ToolProviderKind | undefined>
  ): boolean {
    if (!PARALLEL_READ_ONLY_TOOL_NAMES.has(call.toolName)) return false
    if (call.toolKind && call.toolKind !== 'tool_call') return false
    if (approvalPolicy === 'untrusted' || approvalPolicy === 'never') return false
    return toolProviderKinds.get(call.toolName) === 'built-in'
  }

  createToolContext(input: {
    threadId: string
    turnId: string
    workspace: string
    ownerUserId?: string
    workModeId?: string
    threadMode?: 'agent' | 'plan'
    activePlanContext?: GuiPlanContext
    modelCapabilities: ModelCapabilityMetadata
    activeSkillIds: readonly string[]
    allowedToolNames?: readonly string[]
    approvalPolicy: ToolHostContext['approvalPolicy']
    signal: AbortSignal
    runtimeIdentity?: RunIdentity
    runtimeState?: RunStateV3
    runtimeStateSink?: (state: RunStateV3) => void
  }): ToolHostContext {
    return {
      threadId: input.threadId,
      turnId: input.turnId,
      workspace: input.workspace,
      ...(input.workModeId ? { workModeId: input.workModeId } : {}),
      ...(input.ownerUserId ? { ownerUserId: input.ownerUserId } : {}),
      threadMode: input.threadMode,
      ...(input.activePlanContext ? { guiPlan: input.activePlanContext } : {}),
      model: input.modelCapabilities,
      activeSkillIds: input.activeSkillIds,
      memoryPolicy: { enabled: this.deps.memoryStoreEnabled },
      delegationPolicy: { enabled: false },
      ...(this.deps.runtimeDataDir
        ? {
            outputBudget: {
              outputDir: join(this.deps.runtimeDataDir, 'threads', input.threadId, 'tool-output'),
              maxInlineBytes: TOOL_OUTPUT_MAX_INLINE_BYTES,
              previewHeadBytes: TOOL_OUTPUT_PREVIEW_HEAD_BYTES,
              previewTailBytes: TOOL_OUTPUT_PREVIEW_TAIL_BYTES
            }
          }
        : {}),
      ...(input.allowedToolNames ? { allowedToolNames: input.allowedToolNames } : {}),
      approvalPolicy: input.approvalPolicy,
      abortSignal: input.signal,
      awaitApproval: async (approval) => {
        await this.deps.events.record({
          kind: 'approval_requested',
          threadId: approval.threadId,
          turnId: approval.turnId,
          approvalId: approval.id,
          toolName: approval.toolName,
          status: 'pending',
          summary: approval.summary
        })
        return this.deps.approvalGate.request(approval)
      },
      awaitUserInput: (inputRequest) =>
        this.awaitUserInput(input.threadId, input.turnId, inputRequest, input.signal)
      ,...(input.runtimeIdentity ? { runtimeIdentity: input.runtimeIdentity } : {})
      ,...(input.runtimeState ? { runtimeState: input.runtimeState } : {})
      ,...(input.runtimeStateSink ? { runtimeStateSink: input.runtimeStateSink } : {})
    }
  }

  async executeToolCall(input: {
    threadId: string
    turnId: string
    call: ToolCallLike
    context: ToolHostContext
  }): Promise<ToolHostResult> {
    return this.deps.inflight.run(
      {
        id: `inflight_${input.call.callId}`,
        kind: 'tool',
        threadId: input.threadId,
        turnId: input.turnId,
        callId: input.call.callId
      },
      async () => {
        try {
          if (this.deps.toolRuntime && input.context.runtimeIdentity && input.context.runtimeState) {
            const execution = await this.deps.toolRuntime.execute({
              identity: input.context.runtimeIdentity,
              state: input.context.runtimeState,
              call: input.call,
              context: input.context,
              policy: input.call.effectPolicy ?? defaultEffectPolicy(input.call)
            })
            const mergedState = mergeRuntimeEffectState(input.context.runtimeState, execution.state)
            input.context.runtimeState = mergedState
            input.context.runtimeStateSink?.(mergedState)
            if (execution.outcome) throw new Error(`tool runtime suspended: ${execution.outcome.reason}`)
            if (execution.result) return execution.result
          }
          return await this.deps.toolHost.execute(input.call, input.context, async (item) => {
            const existing = await this.deps.turns.updateItem(input.threadId, item.id, {
              output: item.kind === 'tool_result' ? item.output : undefined,
              isError: item.kind === 'tool_result' ? item.isError : undefined,
              status: 'running'
            } as Partial<TurnItem>)
            if (existing) return
            await this.deps.turns.applyItem(input.threadId, item)
          })
        } catch (error) {
          if (input.context.abortSignal.aborted || !this.isRecoverableToolDispatchError(error)) {
            throw error
          }
          const message = error instanceof Error ? error.message : String(error)
          await this.deps.events.record({
            kind: 'error',
            threadId: input.threadId,
            turnId: input.turnId,
            message: `Tool call ${input.call.toolName} was rejected: ${message}`,
            code: 'tool_dispatch_rejected',
            severity: 'warning'
          })
          return {
            item: makeToolResultItem({
              id: `item_${input.call.callId}`,
              turnId: input.turnId,
              threadId: input.threadId,
              callId: input.call.callId,
              toolName: input.call.toolName,
              toolKind: input.call.toolKind ?? 'tool_call',
              output: {
                code: 'tool_dispatch_rejected',
                error: message,
                guidance: 'Use only tools advertised in the current turn context.'
              },
              isError: true
            }),
            approved: false
          }
        }
      }
    )
  }

  isRecoverableToolDispatchError(error: unknown): boolean {
    return isRecoverableToolDispatchError(error)
  }

  async persistToolCallResult(
    threadId: string,
    turnId: string,
    call: ToolCallLike,
    result: ToolHostResult
  ): Promise<void> {
    await this.deps.turns.updateItem(threadId, `item_tool_${turnId}_${call.callId}`, {
      status: result.item.kind === 'tool_result' && result.item.isError ? 'failed' : 'completed',
      finishedAt: this.deps.nowIso()
    } as Partial<TurnItem>)
    await this.deps.turns.applyItem(threadId, result.item)
    await this.afterToolResultPersisted(threadId, turnId, call, result)
  }

  async afterToolResultPersisted(
    threadId: string,
    turnId: string,
    call: ToolCallLike,
    result: ToolHostResult
  ): Promise<void> {
    if (call.toolName !== CREATE_PLAN_TOOL_NAME) return
    if (result.item.kind !== 'tool_result' || result.item.isError === true) return
    const output = result.item.output
    if (!output || typeof output !== 'object') return
    const record = output as Record<string, unknown>
    const planId = typeof record.plan_id === 'string' ? record.plan_id : ''
    const relativePath = typeof record.relative_path === 'string' ? record.relative_path : ''
    const markdown = typeof call.arguments.markdown === 'string' ? call.arguments.markdown : ''
    if (!planId || !relativePath || !markdown) return
    try {
      await this.deps.onPlanWritten?.({
        threadId,
        turnId,
        planId,
        relativePath,
        markdown
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.deps.events.record({
        kind: 'error',
        threadId,
        turnId,
        message: `Failed to sync plan checklist to thread todos: ${message}`,
        code: 'todo_plan_sync_failed',
        severity: 'warning'
      })
    }
  }

  async persistSuppressedToolCall(input: {
    threadId: string
    turnId: string
    call: ToolCallLike
    reason?: string
  }): Promise<void> {
    const item = makeToolResultItem({
      id: `item_${input.call.callId}_storm`,
      turnId: input.turnId,
      threadId: input.threadId,
      callId: input.call.callId,
      toolName: input.call.toolName,
      toolKind: input.call.toolKind ?? 'tool_call',
      output: { error: input.reason ?? 'duplicate tool call suppressed by repeat-loop guard' },
      isError: true
    })
    const message = input.reason ?? 'duplicate tool call suppressed by repeat-loop guard'
    await this.deps.turns.updateItem(input.threadId, `item_tool_${input.turnId}_${input.call.callId}`, {
      status: 'failed',
      finishedAt: this.deps.nowIso()
    } as Partial<TurnItem>)
    await this.deps.turns.applyItem(input.threadId, item)
    await this.deps.events.record({
      kind: 'tool_storm_suppressed',
      threadId: input.threadId,
      turnId: input.turnId,
      itemId: item.id,
      toolName: input.call.toolName,
      callId: input.call.callId,
      message
    })
  }

  async awaitUserInput(
    threadId: string,
    turnId: string,
    input: {
      id: string
      itemId: string
      prompt: string
      questions: Array<{
        header: string
        id: string
        question: string
        options: Array<{ label: string; description: string }>
      }>
    },
    signal: AbortSignal
  ): Promise<UserInputResolution> {
    const item = makeUserInputItem({
      id: input.itemId,
      threadId,
      turnId,
      inputId: input.id,
      prompt: input.prompt,
      questions: input.questions
    })
    await this.deps.turns.applyItem(threadId, item)
    await this.deps.events.record({
      kind: 'user_input_requested',
      threadId,
      turnId,
      itemId: item.id,
      inputId: input.id,
      status: 'pending',
      prompt: input.prompt,
      questions: input.questions
    })

    const resolution = await this.waitForUserInput(threadId, turnId, input, signal)
    await this.deps.turns.updateItem(threadId, item.id, {
      status: resolution.status,
      finishedAt: this.deps.nowIso()
    } as Partial<TurnItem>)
    await this.deps.events.record({
      kind: 'user_input_resolved',
      threadId,
      turnId,
      itemId: item.id,
      inputId: input.id,
      status: resolution.status,
      prompt: input.prompt,
      questions: input.questions
    })
    return resolution
  }

  private async waitForUserInput(
    threadId: string,
    turnId: string,
    input: {
      id: string
      itemId: string
      prompt: string
      questions: Array<{
        header: string
        id: string
        question: string
        options: Array<{ label: string; description: string }>
      }>
    },
    signal: AbortSignal
  ): Promise<UserInputResolution> {
    const pending = this.deps.userInputGate.request({
      id: input.id,
      threadId,
      turnId,
      itemId: input.itemId,
      prompt: input.prompt,
      questions: input.questions
    })
    if (!signal.aborted) {
      return new Promise<UserInputResolution>((resolve, reject) => {
        const onAbort = (): void => {
          this.deps.userInputGate.resolve(input.id, { status: 'cancelled' })
          signal.removeEventListener('abort', onAbort)
          reject(new Error('cancelled while awaiting user input'))
        }
        signal.addEventListener('abort', onAbort, { once: true })
        pending
          .then((resolution) => {
            signal.removeEventListener('abort', onAbort)
            resolve(resolution)
          })
          .catch((error) => {
            signal.removeEventListener('abort', onAbort)
            reject(error)
          })
      })
    }
    this.deps.userInputGate.resolve(input.id, { status: 'cancelled' })
    throw new Error('cancelled while awaiting user input')
  }
}

function mergeRuntimeEffectState(current: RunStateV3, next: RunStateV3): RunStateV3 {
  const committedEffects = mergeEffectsByKey(current.committedEffects, next.committedEffects)
  const committedKeys = new Set(committedEffects.map((effect) => effect.idempotencyKey))
  const pendingEffects = mergeEffectsByKey(current.pendingEffects, next.pendingEffects)
    .filter((effect) => !committedKeys.has(effect.idempotencyKey))
  return { ...next, pendingEffects, committedEffects }
}

function mergeEffectsByKey<T extends { idempotencyKey: string }>(current: readonly T[], next: readonly T[]): T[] {
  const merged = new Map<string, T>()
  for (const effect of current) merged.set(effect.idempotencyKey, effect)
  for (const effect of next) merged.set(effect.idempotencyKey, effect)
  return [...merged.values()]
}

function defaultEffectPolicy(call: ToolCallLike): ToolEffectPolicy {
  if (call.toolKind === 'file_change') return { effect: 'non-idempotent-write', replay: 'never' }
  return { effect: 'read', replay: 'safe' }
}

function makeRuntimeIdentity(input: { ownerUserId?: string; workspace: string; threadId: string; turnId: string }): RunIdentity {
  return { ownerUserId: input.ownerUserId ?? 'local-default-owner', workspaceKey: input.workspace || 'local-default-workspace', threadId: input.threadId, turnId: input.turnId, runId: `run_${input.threadId}_${input.turnId}` }
}

function makeRuntimeState(identity: RunIdentity): RunStateV3 {
  const now = new Date().toISOString()
  return { version: 3, graphVersion: 'kernel-v3-tool-runtime', runtimeMode: 'kernel_v3', ...identity, status: 'running', cursor: { stepIndex: 0, nodeId: 'tool', attempt: 0, checkpointSeq: 0 }, budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }, recovery: { attempts: 0, maxAttempts: 1 }, middleware: {}, nodeData: {}, taskRevision: 0, pendingEffects: [], committedEffects: [], createdAt: now, updatedAt: now }
}
