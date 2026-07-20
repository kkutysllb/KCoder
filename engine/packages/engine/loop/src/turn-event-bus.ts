import type { TurnStepEvent } from './turn-event-types.js'
import type { PromptBuilder } from './prompt-builder.js'
import type { ModelStepRunner } from './model-step-runner.js'
import type { ToolCallCoordinator } from './tool-call-coordinator.js'
import { decideContinuation } from './continuation-policy.js'
import type { RuntimeEventRecorder } from '@qiongqi/services'
import type { TurnService } from '@qiongqi/services'
import type { IdGenerator } from '@qiongqi/ports'
import { makeErrorItem } from '@qiongqi/domain'
import { CREATE_PLAN_TOOL_NAME } from '@qiongqi/adapter-tools'

/**
 * Stage 3: lightweight in-process event bus for turn step orchestration.
 *
 * Subscribers register for specific {@link TurnStepEvent} kinds and
 * are called in registration order when a matching event is published.
 * This replaces the imperative for-loop with a pub/sub chain, allowing
 * step components to be independently tested and composed.
 */
export class TurnEventBus {
  private readonly listeners = new Map<string, Array<(event: TurnStepEvent) => Promise<TurnStepEvent | void>>>()

  /** Register a subscriber for a specific event kind. */
  on(kind: TurnStepEvent['kind'], fn: (event: TurnStepEvent) => Promise<TurnStepEvent | void>): () => void {
    const list = this.listeners.get(kind) ?? []
    list.push(fn)
    this.listeners.set(kind, list)
    return () => {
      const idx = list.indexOf(fn)
      if (idx >= 0) list.splice(idx, 1)
    }
  }

  /** Publish an event to all subscribers of its kind. Returns the first non-void result. */
  async emit(event: TurnStepEvent): Promise<TurnStepEvent | void> {
    const list = this.listeners.get(event.kind)
    if (!list || list.length === 0) return
    for (const fn of list) {
      const result = await fn(event)
      if (result !== undefined) return result
    }
  }
}

/**
 * Dependencies injected into step subscriber factories.
 */
export interface StepSubscriberDeps {
  promptBuilder: PromptBuilder
  modelStepRunner: ModelStepRunner
  coordinator: ToolCallCoordinator
  events: RuntimeEventRecorder
  turns: TurnService
  ids: IdGenerator
}

/**
 * Prompt subscriber: step:start → build prompt → prompt:built.
 */
export function createPromptSubscriber(deps: StepSubscriberDeps) {
  return async (event: TurnStepEvent): Promise<TurnStepEvent | void> => {
    if (event.kind !== 'step:start') return
    const { stepIndex } = event
    // step:start carries threadId/turnId/signal via closure — see EventedTurnOrchestratorV2
  }
}

/**
 * Step orchestrator context passed through the event chain.
 */
export interface StepContext {
  eventBus: TurnEventBus
  threadId: string
  turnId: string
  signal: AbortSignal
  deps: StepSubscriberDeps
}

/**
 * @deprecated Since the declarative {@link LoopRunner} (loop-runner.ts) now
 * drives the evented orchestrator, `runStepViaEventBus` is retained only for
 * backward compatibility. New code should use {@link LoopRunner.step}.
 *
 * Run one full step via the event bus.
 *
 * This is the event-driven equivalent of {@link runOrchestratorStep}.
 * Instead of calling PromptBuilder→ModelStepRunner→decideContinuation
 * imperatively, it publishes events and lets subscribers react.
 *
 * The function is intentionally synchronous in structure — it still
 * calls the same components, but each call is wrapped as an event
 * handler, making the data flow visible and interceptable.
 */
export async function runStepViaEventBus(ctx: StepContext, stepIndex: number): Promise<'continue' | 'stop' | 'failed' | 'aborted'> {
  const { eventBus, threadId, turnId, signal, deps } = ctx

  await eventBus.emit({ kind: 'step:start', stepIndex })

  const finish = async (status: 'continue' | 'stop' | 'failed' | 'aborted') => {
    await eventBus.emit({
      kind: 'step:end',
      status: status === 'stop' || status === 'continue' ? 'completed' : status
    })
    return status
  }

  // 1. Build prompt
  const built = await deps.promptBuilder.build({ threadId, turnId, signal, stepIndex })
  if (built.kind === 'aborted') return finish('aborted')
  if (built.kind === 'stop') return finish('stop')
  const promptCtx = built.ctx

  // 2. Run model
  const stepResult = await deps.modelStepRunner.run({
    request: promptCtx.request,
    threadId,
    turnId,
    signal,
    toolProviderMetadata: promptCtx.toolProviderMetadata,
    toolKinds: promptCtx.toolKinds,
    recordPromptPressure: (tid, model, promptTokens) =>
      deps.promptBuilder.recordPromptPressure({
        ownerUserId: promptCtx.thread?.ownerUserId ?? 'local-default-owner',
        workspaceKey: promptCtx.thread?.workspace ?? 'local-default-workspace',
        threadId: tid,
        turnId
      }, model, promptTokens)
  })
  if (stepResult.kind === 'aborted') return finish('aborted')

  // 3. Decide continuation
  const decision = decideContinuation({
    stepResult,
    ctx: promptCtx,
    ids: deps.ids,
    threadId,
    turnId
  })

  // 4. Execute decision
  switch (decision.action) {
    case 'stop': return finish('stop')
    case 'continue': return finish('continue')
    case 'failed': return finish('failed')
    case 'failed_with_error': {
      await deps.events.record({
        kind: 'error', threadId, turnId,
        message: decision.errorMessage, code: decision.errorCode
      })
      await deps.turns.applyItem(threadId, makeErrorItem({
        id: deps.ids.next('item_error'), turnId, threadId,
        message: decision.errorMessage, code: decision.errorCode
      }))
      return finish('failed')
    }
    case 'materialize_plan': {
      await deps.turns.applyItem(threadId, decision.planToolCallItem)
      await deps.events.record({
        kind: 'tool_call_ready', threadId, turnId,
        itemId: decision.planToolCallItem.id,
        callId: decision.planCall.callId,
        toolName: CREATE_PLAN_TOOL_NAME, readyCount: 1
      })
      const dispatched = await deps.coordinator.dispatch({
        calls: [decision.planCall], threadId, turnId,
        workspace: promptCtx.thread?.workspace ?? '',
        ...(promptCtx.thread?.ownerUserId ? { ownerUserId: promptCtx.thread.ownerUserId } : {}),
        ...(promptCtx.workModeId ? { workModeId: promptCtx.workModeId } : {}),
        threadMode: promptCtx.effectiveMode,
        ...(promptCtx.activePlanContext ? { activePlanContext: promptCtx.activePlanContext } : {}),
        modelCapabilities: promptCtx.modelCapabilities,
        activeSkillIds: promptCtx.activeSkillIds,
        ...(promptCtx.allowedToolNames ? { allowedToolNames: promptCtx.allowedToolNames } : {}),
        toolProviderKinds: promptCtx.toolProviderKinds,
        approvalPolicy: promptCtx.approvalPolicy, signal
      })
      if (dispatched === 'aborted') return finish('aborted')
      return finish('continue')
    }
    case 'dispatch': {
      const dispatched = await deps.coordinator.dispatch({
        calls: stepResult.completedToolCalls, threadId, turnId,
        workspace: promptCtx.thread?.workspace ?? '',
        ...(promptCtx.thread?.ownerUserId ? { ownerUserId: promptCtx.thread.ownerUserId } : {}),
        ...(promptCtx.workModeId ? { workModeId: promptCtx.workModeId } : {}),
        threadMode: promptCtx.effectiveMode,
        ...(promptCtx.activePlanContext ? { activePlanContext: promptCtx.activePlanContext } : {}),
        modelCapabilities: promptCtx.modelCapabilities,
        activeSkillIds: promptCtx.activeSkillIds,
        ...(promptCtx.allowedToolNames ? { allowedToolNames: promptCtx.allowedToolNames } : {}),
        toolProviderKinds: promptCtx.toolProviderKinds,
        approvalPolicy: promptCtx.approvalPolicy, signal
      })
      if (dispatched === 'aborted') return finish('aborted')
      return finish('continue')
    }
  }
}
