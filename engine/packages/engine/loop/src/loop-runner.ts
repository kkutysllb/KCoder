/**
 * LoopRunner: phase interpreter. Executes one loop step by advancing
 * plan.phases linearly, emitting rich events and appending to LoopRun.events.
 *
 * Behaviour-equivalent to runOrchestratorStep when the plan contains no
 * evaluate phase (or the evaluator passes).
 */

import type { PromptBuilder, BuildContext } from './prompt-builder.js'
import type { ModelStepRunner, StepResult } from './model-step-runner.js'
import type { ToolCallCoordinator } from './tool-call-coordinator.js'
import type { LoopPlan, LoopRun } from './loop-plan.js'
import type { LoopEvaluator } from './loop-evaluator.js'
import type { LoopDecision } from './loop-policy.js'
import { decideLoopContinuation } from './loop-policy.js'
import type { TurnEventBus } from './turn-event-bus.js'
import type { TurnStepEvent } from './turn-event-types.js'
import type { RuntimeEventRecorder } from '@qiongqi/services'
import type { TurnService } from '@qiongqi/services'
import type { IdGenerator } from '@qiongqi/ports'
import { makeErrorItem } from '@qiongqi/domain'
import { CREATE_PLAN_TOOL_NAME } from '@qiongqi/adapter-tools'

export interface LoopRunnerDeps {
  promptBuilder: PromptBuilder
  modelStepRunner: ModelStepRunner
  coordinator: ToolCallCoordinator
  evaluator?: LoopEvaluator
  events: RuntimeEventRecorder
  turns: TurnService
  ids: IdGenerator
}

export type LoopStepOutcome =
  | { action: 'continue' }
  | { action: 'stop' }
  | { action: 'failed' }
  | { action: 'aborted' }
  | { action: 'retry' }

/** Append an event to the run log and publish it on the bus. */
async function append(
  run: LoopRun,
  bus: TurnEventBus,
  event: TurnStepEvent
): Promise<void> {
  run.events.push(event)
  await bus.emit(event)
}

export class LoopRunner {
  constructor(private readonly deps: LoopRunnerDeps) {}

  async step(input: {
    run: LoopRun
    plan: LoopPlan
    signal: AbortSignal
    stepIndex: number
    bus: TurnEventBus
  }): Promise<LoopStepOutcome> {
    const { run, plan, signal, stepIndex, bus } = input
    const { promptBuilder, modelStepRunner, coordinator, evaluator, events, turns, ids } = this.deps
    const phaseKinds = new Set(plan.phases.map((phase) => phase.kind))
    const evaluatePhase = plan.phases.find((phase) => phase.kind === 'evaluate')

    if (signal.aborted) {
      await append(run, bus, { kind: 'step:end', status: 'aborted' })
      return { action: 'aborted' }
    }

    await append(run, bus, { kind: 'step:start', stepIndex })

    try {
      if (!phaseKinds.has('build-prompt')) {
        throw new Error('LoopPlan missing required build-prompt phase')
      }
      const built = await promptBuilder.build({ threadId: run.threadId, turnId: run.turnId, signal, stepIndex })
      if (built.kind === 'aborted') {
        await append(run, bus, { kind: 'step:end', status: 'aborted' })
        return { action: 'aborted' }
      }
      if (built.kind === 'stop') {
        await append(run, bus, { kind: 'step:end', status: 'completed' })
        return { action: 'stop' }
      }
      const ctx: BuildContext = built.ctx
      await append(run, bus, {
        kind: 'prompt:built',
        requestId: `step:${stepIndex}`,
        promptTokens: 0
      })

      if (!phaseKinds.has('run-model')) {
        throw new Error('LoopPlan missing required run-model phase')
      }
      const stepResult: StepResult = await modelStepRunner.run({
        request: ctx.request,
        threadId: run.threadId,
        turnId: run.turnId,
        signal,
        toolProviderMetadata: ctx.toolProviderMetadata,
        toolKinds: ctx.toolKinds,
        recordPromptPressure: (tid, model, promptTokens) =>
          promptBuilder.recordPromptPressure({
            ownerUserId: ctx.thread?.ownerUserId ?? 'local-default-owner',
            workspaceKey: ctx.thread?.workspace ?? 'local-default-workspace',
            threadId: tid,
            turnId: run.turnId
          }, model, promptTokens)
      })
      if (stepResult.kind === 'aborted') {
        await append(run, bus, { kind: 'step:end', status: 'aborted' })
        return { action: 'aborted' }
      }
      const ran = stepResult
      await append(run, bus, {
        kind: 'model:ran',
        stopReason: ran.stopReason,
        text: ran.text,
        toolCalls: ran.completedToolCalls.map((c) => ({ callId: c.callId, toolName: c.toolName }))
      })

      if (!phaseKinds.has('decide')) {
        throw new Error('LoopPlan missing required decide phase')
      }
      const decision: LoopDecision = decideLoopContinuation({
        stepResult: ran,
        ctx,
        ids,
        threadId: run.threadId,
        turnId: run.turnId
      })
      await append(run, bus, {
        kind: 'decision',
        action: decision.action,
        ...(decision.action === 'failed_with_error'
          ? { errorCode: decision.errorCode, errorMessage: decision.errorMessage }
          : {})
      })

      if (
        decision.action === 'failed' ||
        decision.action === 'failed_with_error'
      ) {
        return await this.executeDecision(decision, {
          ran, ctx, signal, run, bus, events, turns, ids, coordinator
        })
      }

      // evaluate phase (optional, pluggable)
      if (phaseKinds.has('evaluate') && evaluator) {
        const retryCount = run.events.filter((e) => e.kind === 'step:retry').length
        const maxRetries = evaluatePhase?.maxRetries ?? Number.POSITIVE_INFINITY
        const evaluation = retryCount >= maxRetries
          ? { verdict: 'pass' as const }
          : evaluator({ decision, stepResult: ran, ctx, retryCount })
        if (evaluation.verdict === 'retry') {
          await append(run, bus, { kind: 'step:retry', reason: evaluation.reason, attempt: retryCount + 1 })
          await append(run, bus, { kind: 'step:end', status: 'retried' })
          return { action: 'retry' }
        }
        if (evaluation.verdict === 'fail') {
          await events.record({
            kind: 'error',
            threadId: run.threadId,
            turnId: run.turnId,
            message: evaluation.reason,
            code: 'evaluator_fail'
          })
          await append(run, bus, { kind: 'step:end', status: 'failed' })
          return { action: 'failed' }
        }
      }

      // execute decision (dispatch-tools / materialize-plan / record-error)
      return await this.executeDecision(decision, {
        ran, ctx, signal, run, bus, events, turns, ids, coordinator
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await append(run, bus, { kind: 'turn:failed', error: message })
      await append(run, bus, { kind: 'step:end', status: 'failed' })
      return { action: 'failed' }
    }
  }

  private async executeDecision(
    decision: LoopDecision,
    d: {
      ran: Extract<StepResult, { kind: 'ran' }>
      ctx: BuildContext
      signal: AbortSignal
      run: LoopRun
      bus: TurnEventBus
      events: RuntimeEventRecorder
      turns: TurnService
      ids: IdGenerator
      coordinator: ToolCallCoordinator
    }
  ): Promise<LoopStepOutcome> {
    const { ran, ctx, signal, run, bus, events, turns, ids, coordinator } = d
    switch (decision.action) {
      case 'stop':
        await append(run, bus, { kind: 'step:end', status: 'completed' })
        return { action: 'stop' }
      case 'continue':
        await append(run, bus, { kind: 'step:end', status: 'completed' })
        return { action: 'continue' }
      case 'failed':
        await append(run, bus, { kind: 'step:end', status: 'failed' })
        return { action: 'failed' }
      case 'failed_with_error': {
        await events.record({
          kind: 'error',
          threadId: run.threadId,
          turnId: run.turnId,
          message: decision.errorMessage,
          code: decision.errorCode
        })
        await turns.applyItem(
          run.threadId,
          makeErrorItem({
            id: ids.next('item_error'),
            turnId: run.turnId,
            threadId: run.threadId,
            message: decision.errorMessage,
            code: decision.errorCode
          })
        )
        await append(run, bus, { kind: 'step:end', status: 'failed' })
        return { action: 'failed' }
      }
      case 'materialize_plan': {
        await turns.applyItem(run.threadId, decision.planToolCallItem)
        await events.record({
          kind: 'tool_call_ready',
          threadId: run.threadId,
          turnId: run.turnId,
          itemId: decision.planToolCallItem.id,
          callId: decision.planCall.callId,
          toolName: CREATE_PLAN_TOOL_NAME,
          readyCount: 1
        })
        const dispatched = await coordinator.dispatch({
          calls: [decision.planCall],
          threadId: run.threadId,
          turnId: run.turnId,
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
        await append(run, bus, { kind: 'tools:dispatched', callCount: 1, aborted: dispatched === 'aborted' })
        await append(run, bus, { kind: 'step:end', status: dispatched === 'aborted' ? 'aborted' : 'completed' })
        return dispatched === 'aborted' ? { action: 'aborted' } : { action: 'continue' }
      }
      case 'dispatch': {
        const dispatched = await coordinator.dispatch({
          calls: ran.completedToolCalls,
          threadId: run.threadId,
          turnId: run.turnId,
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
        await append(run, bus, {
          kind: 'tools:dispatched',
          callCount: ran.completedToolCalls.length,
          aborted: dispatched === 'aborted'
        })
        await append(run, bus, { kind: 'step:end', status: dispatched === 'aborted' ? 'aborted' : 'completed' })
        return dispatched === 'aborted' ? { action: 'aborted' } : { action: 'continue' }
      }
    }
  }
}
