/**
 * TurnOrchestrator is the thin coordinator that replaced the monolithic
 * `AgentLoop`. It owns the turn lifecycle (goal timer, steering drain,
 * pipeline setup, error enrichment) and drives a bounded `for` loop that
 * delegates each step to:
 *
 *   PromptBuilder   -> assemble the ModelRequest (+ budget gate, compaction,
 *                      tool-catalog drift, token economy)
 *   ModelStepRunner -> stream the model response (+ deltas, usage, tool_call
 *                      materialisation)
 *   ContinuationPolicy -> decide stop / continue / failed / materialise_plan
 *   ToolCallCoordinator -> dispatch tool calls (approval, batching, storm)
 *
 * Behaviour is preserved verbatim from the legacy `AgentLoop.runTurn` /
 * `AgentLoop.loop` / `AgentLoop.modelStep` orchestration shell.
 */

import type { ModelClient } from '@qiongqi/ports'
import type { ToolHost, GuiPlanContext } from '@qiongqi/ports'
import type { ThreadStore } from '@qiongqi/ports'
import type { SessionStore } from '@qiongqi/ports'
import type { ApprovalGate } from '@qiongqi/ports'
import type { UserInputGate, UserInputResolution } from '@qiongqi/ports'
import type { UsageService } from '@qiongqi/services'
import type { TurnService } from '@qiongqi/services'
import type { RuntimeEventRecorder } from '@qiongqi/services'
import type { IdGenerator } from '@qiongqi/ports'
import type { ModelCapabilityMetadata } from '@qiongqi/contracts'
import type { TurnItem } from '@qiongqi/contracts'
import type { ThreadGoal } from '@qiongqi/contracts'
import type { ImmutablePrefix } from '@qiongqi/cache'
import { ContextCompactor } from './context-compactor.js'
import { InflightTracker } from './inflight-tracker.js'
import { SteeringQueue } from './steering-queue.js'
import type { ContextCompactionConfig } from './model-context-profile.js'
import type { SkillRuntime } from '@qiongqi/skills'
import type { SkillPluginHost } from '@qiongqi/skills'
import type { AttachmentStore } from '@qiongqi/attachments'
import type { MemoryStore } from '@qiongqi/memory'
import type { TokenEconomyConfig } from './token-economy.js'
import type { ToolStormBreakerOptions } from './tool-storm-breaker.js'
import { makeAssistantTextItem, makeErrorItem, touchThread } from '@qiongqi/domain'
import { CREATE_PLAN_TOOL_NAME } from '@qiongqi/adapter-tools'
import { createImmutablePrefix } from '@qiongqi/cache'
import { recordPipelineStage } from './loop-events.js'
import { type GoalElapsedTimer } from './loop-helpers.js'
import { ToolCallCoordinator } from './tool-call-coordinator.js'
import { ModelStepRunner, type StepResult } from './model-step-runner.js'
import { PromptBuilder, type BuildContext } from './prompt-builder.js'
import { decideContinuation } from './continuation-policy.js'
import { DEFAULT_EVALUATOR_MAX_RETRIES, defaultLoopEvaluator } from './loop-evaluator.js'
import type { ToolRuntimeV3 } from './tool-runtime-v3.js'

export type TurnOrchestratorOptions = {
  threadStore: ThreadStore
  sessionStore: SessionStore
  approvalGate: ApprovalGate
  userInputGate: UserInputGate
  model: ModelClient
  toolHost: ToolHost
  usage: UsageService
  events: RuntimeEventRecorder
  turns: TurnService
  inflight: InflightTracker
  steering: SteeringQueue
  compactor: ContextCompactor
  prefix: ImmutablePrefix
  ids: IdGenerator
  nowIso: () => string
  nowMs?: () => number
  modelCapabilities?: (model: string) => ModelCapabilityMetadata
  skillRuntime?: SkillRuntime
  skillPluginHost?: SkillPluginHost
  attachmentStore?: AttachmentStore
  runtimeDataDir?: string
  memoryStore?: MemoryStore
  tokenEconomy?: TokenEconomyConfig
  contextCompaction?: ContextCompactionConfig
  toolStorm?: ToolStormBreakerOptions & { enabled?: boolean }
  toolArgumentRepair?: {
    maxStringBytes?: number
  }
  loopBudget?: {
    maxSteps?: number
  }
  /**
   * Optional fallback GUI plan context for embedders that run the loop
   * without persisted turn metadata. Normal serve mode reads GUI plan
   * context from the active turn record.
   */
  activePlanContext?: GuiPlanContext
  /**
   * Optional callback to mutate the active plan context (e.g. when the
   * loop records a successful `create_plan` result). The default is a
   * no-op for callers that don't track plan state.
   */
  onActivePlanContextChange?: (context: GuiPlanContext | undefined) => void
  onPlanWritten?: (input: {
    threadId: string
    turnId: string
    planId: string
    relativePath: string
    markdown: string
  }) => Promise<void>
  toolRuntime?: ToolRuntimeV3
}

type AwaitUserInputFn = (
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
) => Promise<UserInputResolution>

const DEFAULT_CLASSIC_LOOP_MAX_STEPS = 300

/**
 * Turn-scoped state machine. `runTurn(threadId, turnId)` advances a turn
 * until it completes, fails, is aborted, or blocks on approval / user input.
 * Every iteration has hard boundaries: the AbortSignal, the per-thread cost
 * budget (checked at the top of each step by PromptBuilder), and inflight
 * resource cleanup in the coordinator.
 */
export class TurnOrchestrator {
  private readonly opts: TurnOrchestratorOptions
  private readonly coordinator: ToolCallCoordinator
  private readonly modelStepRunner: ModelStepRunner
  private readonly promptBuilder: PromptBuilder

  constructor(opts: TurnOrchestratorOptions) {
    this.opts = opts
    const awaitUserInput: AwaitUserInputFn = (threadId, turnId, input, signal) =>
      this.coordinator.awaitUserInput(threadId, turnId, input, signal)
    this.coordinator = new ToolCallCoordinator({
      toolHost: opts.toolHost,
      approvalGate: opts.approvalGate,
      userInputGate: opts.userInputGate,
      inflight: opts.inflight,
      events: opts.events,
      turns: opts.turns,
      ids: opts.ids,
      nowIso: opts.nowIso,
      memoryStoreEnabled: Boolean(opts.memoryStore),
      ...(opts.runtimeDataDir ? { runtimeDataDir: opts.runtimeDataDir } : {}),
      ...(opts.toolStorm ? { toolStorm: opts.toolStorm } : {}),
      ...(opts.onPlanWritten ? { onPlanWritten: opts.onPlanWritten } : {}),
      ...(opts.toolRuntime ? { toolRuntime: opts.toolRuntime } : {})
    })
    this.modelStepRunner = new ModelStepRunner({
      model: opts.model,
      events: opts.events,
      turns: opts.turns,
      usage: opts.usage,
      ids: opts.ids,
      ...(opts.toolArgumentRepair ? { toolArgumentRepair: opts.toolArgumentRepair } : {})
    })
    this.promptBuilder = new PromptBuilder({
      threadStore: opts.threadStore,
      sessionStore: opts.sessionStore,
      events: opts.events,
      turns: opts.turns,
      usage: opts.usage,
      model: opts.model,
      toolHost: opts.toolHost,
      compactor: opts.compactor,
      prefix: opts.prefix,
      ids: opts.ids,
      nowIso: opts.nowIso,
      ...(opts.modelCapabilities ? { modelCapabilities: opts.modelCapabilities } : {}),
      ...(opts.skillRuntime ? { skillRuntime: opts.skillRuntime } : {}),
      ...(opts.skillPluginHost ? { skillPluginHost: opts.skillPluginHost } : {}),
      ...(opts.attachmentStore ? { attachmentStore: opts.attachmentStore } : {}),
      ...(opts.runtimeDataDir ? { runtimeDataDir: opts.runtimeDataDir } : {}),
      ...(opts.memoryStore ? { memoryStore: opts.memoryStore } : {}),
      ...(opts.tokenEconomy ? { tokenEconomy: opts.tokenEconomy } : {}),
      ...(opts.contextCompaction ? { contextCompaction: opts.contextCompaction } : {}),
      ...(opts.activePlanContext ? { activePlanContext: opts.activePlanContext } : {}),
      ...(opts.onActivePlanContextChange ? { onActivePlanContextChange: opts.onActivePlanContextChange } : {}),
      awaitUserInput
    })
  }

  /**
   * Run a turn end-to-end. The loop returns the final turn status
   * (completed, failed, or aborted). All errors are caught and
   * surfaced through the `error` runtime event.
   */
  async runTurn(threadId: string, turnId: string): Promise<'completed' | 'failed' | 'aborted'> {
    const signal = this.opts.turns.getAbortController(turnId)
    if (!signal) {
      await this.failTurn(threadId, turnId, 'no abort controller for turn')
      return 'failed'
    }
    if (signal.aborted) {
      await this.opts.turns.finishTurn({ threadId, turnId, status: 'aborted' })
      return 'aborted'
    }
    let goalTimer: GoalElapsedTimer | null = null
    try {
      goalTimer = await this.startGoalElapsedTimer(threadId)
      await recordPipelineStage(this.opts.events, { threadId, turnId, stage: 'setup' })
      this.coordinator.setupTurn(turnId)
      await recordPipelineStage(this.opts.events, { threadId, turnId, stage: 'pre_start' })
      await this.drainSteering(threadId, turnId, signal)
      await recordPipelineStage(this.opts.events, { threadId, turnId, stage: 'post_start' })
      const status = await this.loop(threadId, turnId, signal)
      await this.opts.turns.finishTurn({ threadId, turnId, status })
      return status
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error)
      // Best-effort enrichment so the renderer can show "what failed where"
      // instead of the bare "Qiongqi turn failed" string. See issue #26.
      const modelInfo = this.opts.model && 'config' in this.opts.model
        ? (this.opts.model as { config: { model?: string; baseUrl?: string } }).config
        : undefined
      const modelName = modelInfo?.model ?? 'unknown'
      const provider = modelInfo?.baseUrl ?? 'unknown'
      const stack = error instanceof Error
        ? (error.stack?.split('\n').slice(0, 3).join(' | ') ?? '')
        : ''
      const message = [
        '[Qiongqi turn failed]',
        `turn=${turnId}`,
        `thread=${threadId}`,
        `model=${modelName}`,
        `provider=${provider}`,
        `error=${raw}`,
        stack ? `stack=${stack}` : ''
      ].filter(Boolean).join(' ')
      await this.failTurn(threadId, turnId, message)
      return 'failed'
    } finally {
      await this.finishGoalElapsedTimer(threadId, goalTimer)
      this.promptBuilder.clearTurnAutoRoute(threadId, turnId)
      this.coordinator.cleanupTurn(turnId)
    }
  }

  private async failTurn(threadId: string, turnId: string, message: string): Promise<void> {
    await this.opts.turns.finishTurn({ threadId, turnId, status: 'failed', error: message })
  }

  private nowMs(): number {
    return this.opts.nowMs?.() ?? Date.now()
  }

  private async startGoalElapsedTimer(threadId: string): Promise<GoalElapsedTimer | null> {
    const thread = await this.opts.threadStore.get(threadId)
    const goal = thread?.goal
    if (!goal || goal.status !== 'active') return null
    return {
      startedAtMs: this.nowMs(),
      createdAt: goal.createdAt,
      objective: goal.objective
    }
  }

  private async finishGoalElapsedTimer(
    threadId: string,
    timer: GoalElapsedTimer | null
  ): Promise<void> {
    if (!timer) return
    const elapsedSeconds = Math.floor(Math.max(0, this.nowMs() - timer.startedAtMs) / 1000)
    if (elapsedSeconds <= 0) return

    const current = await this.opts.threadStore.get(threadId)
    const currentGoal = current?.goal
    if (!current || !currentGoal) return
    if (currentGoal.createdAt !== timer.createdAt || currentGoal.objective !== timer.objective) {
      return
    }

    const now = this.opts.nowIso()
    const goal: ThreadGoal = {
      ...currentGoal,
      timeUsedSeconds: (currentGoal.timeUsedSeconds ?? 0) + elapsedSeconds,
      updatedAt: now
    }
    const updated = touchThread({ ...current, goal }, now)
    await this.opts.threadStore.upsert(updated)
    await this.opts.events.record({
      kind: 'goal_updated',
      threadId,
      goal
    })
  }

  private async drainSteering(threadId: string, turnId: string, signal: AbortSignal): Promise<void> {
    const pending = this.opts.steering.drain(turnId)
    if (pending.length === 0) return
    for (const text of pending) {
      const item: TurnItem = {
        id: this.opts.ids.next('item_steered'),
        turnId,
        threadId,
        role: 'user',
        status: 'completed',
        createdAt: this.opts.nowIso(),
        finishedAt: this.opts.nowIso(),
        kind: 'user_message',
        text
      }
      await this.opts.turns.applyItem(threadId, item)
    }
    void signal
  }

  private async loop(
    threadId: string,
    turnId: string,
    signal: AbortSignal
  ): Promise<'completed' | 'failed' | 'aborted'> {
    const retryCounts = new Map<number, number>()
    const maxSteps = this.maxLoopSteps()
    for (let step = 0; ;) {
      if (signal.aborted) return 'aborted'
      if (step >= maxSteps) {
        await this.recordLoopBudgetExceeded(threadId, turnId, maxSteps)
        return 'failed'
      }
      await this.drainSteering(threadId, turnId, signal)
      const retryCount = retryCounts.get(step) ?? 0
      const stepResult = await this.runStep(threadId, turnId, signal, step, retryCount)
      if (stepResult === 'retry') {
        retryCounts.set(step, retryCount + 1)
        continue
      }
      if (stepResult === 'stop') return 'completed'
      if (stepResult === 'failed') return 'failed'
      if (stepResult === 'aborted') return 'aborted'
      retryCounts.delete(step)
      step += 1
    }
  }

  private maxLoopSteps(): number {
    const configured = this.opts.loopBudget?.maxSteps
    if (configured === undefined) return DEFAULT_CLASSIC_LOOP_MAX_STEPS
    if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_CLASSIC_LOOP_MAX_STEPS
    return Math.floor(configured)
  }

  private async recordLoopBudgetExceeded(threadId: string, turnId: string, maxSteps: number): Promise<void> {
    const message = `Loop exceeded maxSteps budget (${maxSteps})`
    await this.opts.events.record({
      kind: 'error',
      threadId,
      turnId,
      message,
      code: 'loop_budget_exceeded'
    })
    await this.opts.turns.applyItem(
      threadId,
      makeErrorItem({
        id: this.opts.ids.next('item_error'),
        turnId,
        threadId,
        message,
        code: 'loop_budget_exceeded'
      })
    )
  }

  private async runStep(
    threadId: string,
    turnId: string,
    signal: AbortSignal,
    stepIndex: number,
    retryCount: number
  ): Promise<'continue' | 'stop' | 'failed' | 'aborted' | 'retry'> {
    return runOrchestratorStep({
      threadId,
      turnId,
      signal,
      stepIndex,
      retryCount,
      promptBuilder: this.promptBuilder,
      modelStepRunner: this.modelStepRunner,
      coordinator: this.coordinator,
      events: this.opts.events,
      turns: this.opts.turns,
      ids: this.opts.ids
    })
  }

  /** Convenience factory for tests: builds an orchestrator with sensible defaults. */
  static defaultPrefix(): ImmutablePrefix {
    return createImmutablePrefix({
      systemPrompt: 'You are Qiongqi, a careful and helpful assistant.',
      pinnedConstraints: ['user: preserve recent turns', 'project: keep responses concise']
    })
  }
}

/**
 * Shared step executor used by both {@link TurnOrchestrator} and
 * {@link EventedTurnOrchestrator}.
 *
 * Extracted as a pure function so the evented orchestrator can wrap
 * each step with {@link TurnStepEvent} recording and
 * {@link TurnStateV1} persistence without duplicating the step logic.
 */
export async function runOrchestratorStep(input: {
  threadId: string
  turnId: string
  signal: AbortSignal
  stepIndex: number
  retryCount?: number
  promptBuilder: PromptBuilder
  modelStepRunner: ModelStepRunner
  coordinator: ToolCallCoordinator
  events: RuntimeEventRecorder
  turns: TurnService
  ids: IdGenerator
}): Promise<'continue' | 'stop' | 'failed' | 'aborted' | 'retry'> {
  const { threadId, turnId, signal, stepIndex, retryCount = 0, promptBuilder, modelStepRunner, coordinator, events, turns, ids } = input
  const built = await promptBuilder.build({ threadId, turnId, signal, stepIndex })
  if (built.kind === 'aborted') return 'aborted'
  if (built.kind === 'stop') return 'stop'
  const ctx = built.ctx

  const stepResult = await modelStepRunner.run({
    request: ctx.request,
    threadId,
    turnId,
    signal,
    toolProviderMetadata: ctx.toolProviderMetadata,
    toolKinds: ctx.toolKinds,
    recordPromptPressure: (tid, model, promptTokens) =>
      promptBuilder.recordPromptPressure({
        ownerUserId: ctx.thread?.ownerUserId ?? 'local-default-owner',
        workspaceKey: ctx.thread?.workspace ?? 'local-default-workspace',
        threadId: tid,
        turnId
      }, model, promptTokens)
  })
  if (stepResult.kind === 'aborted') return 'aborted'

  const decision = decideContinuation({
    stepResult,
    ctx,
    ids,
    threadId,
    turnId
  })
  const evaluation = defaultLoopEvaluator({
    decision,
    stepResult,
    ctx,
    retryCount
  })
  if (evaluation.verdict === 'retry') {
    await markRetriedModelOutputFailed({ turns, threadId, stepResult })
    return 'retry'
  }
  if (shouldMaterializeEmptyTerminalFallback({ decision, stepResult, ctx, retryCount })) {
    await turns.applyItem(
      threadId,
      makeAssistantTextItem({
        id: ids.next('item_text'),
        turnId,
        threadId,
        text: emptyTerminalFallbackText(ctx),
        status: 'completed'
      })
    )
  }

  switch (decision.action) {
    case 'stop':
      return 'stop'
    case 'continue':
      return 'continue'
    case 'failed':
      return 'failed'
    case 'failed_with_error': {
      await events.record({
        kind: 'error',
        threadId,
        turnId,
        message: decision.errorMessage,
        code: decision.errorCode
      })
      await turns.applyItem(
        threadId,
        makeErrorItem({
          id: ids.next('item_error'),
          turnId,
          threadId,
          message: decision.errorMessage,
          code: decision.errorCode
        })
      )
      return 'failed'
    }
    case 'materialize_plan': {
      await turns.applyItem(threadId, decision.planToolCallItem)
      await events.record({
        kind: 'tool_call_ready',
        threadId,
        turnId,
        itemId: decision.planToolCallItem.id,
        callId: decision.planCall.callId,
        toolName: CREATE_PLAN_TOOL_NAME,
        readyCount: 1
      })
      const dispatched = await coordinator.dispatch({
        calls: [decision.planCall],
        threadId,
        turnId,
        workspace: ctx.thread?.workspace ?? '',
        ...(ctx.thread?.ownerUserId ? { ownerUserId: ctx.thread.ownerUserId } : {}),
        ...(ctx.workModeId ? { workModeId: ctx.workModeId } : {}),
        threadMode: ctx.effectiveMode,
        ...(ctx.activePlanContext ? { activePlanContext: ctx.activePlanContext } : {}),
        modelCapabilities: ctx.modelCapabilities,
        activeSkillIds: ctx.activeSkillIds,
        ...(ctx.allowedToolNames ? { allowedToolNames: ctx.allowedToolNames } : {}),
        toolProviderKinds: ctx.toolProviderKinds,
        approvalPolicy: ctx.approvalPolicy,
        signal
      })
      if (dispatched === 'aborted') return 'aborted'
      return 'continue'
    }
    case 'dispatch': {
      const dispatched = await coordinator.dispatch({
        calls: stepResult.completedToolCalls,
        threadId,
        turnId,
        workspace: ctx.thread?.workspace ?? '',
        ...(ctx.thread?.ownerUserId ? { ownerUserId: ctx.thread.ownerUserId } : {}),
        ...(ctx.workModeId ? { workModeId: ctx.workModeId } : {}),
        threadMode: ctx.effectiveMode,
        ...(ctx.activePlanContext ? { activePlanContext: ctx.activePlanContext } : {}),
        modelCapabilities: ctx.modelCapabilities,
        activeSkillIds: ctx.activeSkillIds,
        ...(ctx.allowedToolNames ? { allowedToolNames: ctx.allowedToolNames } : {}),
        toolProviderKinds: ctx.toolProviderKinds,
        approvalPolicy: ctx.approvalPolicy,
        signal
      })
      if (dispatched === 'aborted') return 'aborted'
      return 'continue'
    }
  }
}

async function markRetriedModelOutputFailed(input: {
  turns: TurnService
  threadId: string
  stepResult: Extract<StepResult, { kind: 'ran' }>
}): Promise<void> {
  const patch = { status: 'failed' as const, finishedAt: new Date().toISOString() }
  if (input.stepResult.textItemId) {
    await input.turns.updateItem(input.threadId, input.stepResult.textItemId, patch)
  }
  if (input.stepResult.reasoningItemId) {
    await input.turns.updateItem(input.threadId, input.stepResult.reasoningItemId, patch)
  }
}

function shouldMaterializeEmptyTerminalFallback(input: {
  decision: ReturnType<typeof decideContinuation>
  stepResult: Extract<StepResult, { kind: 'ran' }>
  ctx: BuildContext
  retryCount: number
}): boolean {
  if (input.decision.action !== 'stop') return false
  if (input.retryCount < DEFAULT_EVALUATOR_MAX_RETRIES) return false
  if (input.stepResult.stopReason !== 'stop') return false
  if (input.stepResult.completedToolCalls.length > 0) return false
  if (input.stepResult.text.trim() || input.stepResult.reasoning.trim()) return false
  return input.ctx.healedItems.some((item) => item.kind === 'tool_result')
}

function emptyTerminalFallbackText(ctx: BuildContext): string {
  const toolNames = [...new Set(
    ctx.healedItems
      .filter((item) => item.kind === 'tool_result')
      .map((item) => item.kind === 'tool_result' ? item.toolName : '')
      .filter(Boolean)
  )].slice(-5)
  const suffix = toolNames.length > 0 ? ` 最近完成的工具: ${toolNames.join(', ')}。` : ''
  return `工具已经执行完成，但模型没有生成最终答复。${suffix}请查看上方工具结果；如需继续，我会基于这些结果补充分析。`
}
