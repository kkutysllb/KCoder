import type { TurnOrchestratorOptions } from './turn-orchestrator.js'
import { TurnEventBus } from './turn-event-bus.js'
import type { TurnStateSerializer } from './turn-event-types.js'
import type { UserInputResolution } from '@qiongqi/ports'
import { ToolCallCoordinator } from './tool-call-coordinator.js'
import { ModelStepRunner } from './model-step-runner.js'
import { PromptBuilder } from './prompt-builder.js'
import { LoopRunner } from './loop-runner.js'
import { defaultLoopPlan } from './loop-plan.js'
import type { LoopPlan, LoopRun } from './loop-plan.js'
import type { LoopEvaluator } from './loop-evaluator.js'
import { defaultLoopEvaluator } from './loop-evaluator.js'

type AwaitUserInputFn = (
  threadId: string,
  turnId: string,
  input: {
    id: string
    itemId: string
    prompt: string
    questions: Array<{ header: string; id: string; question: string; options: Array<{ label: string; description: string }> }>
  },
  signal: AbortSignal
) => Promise<UserInputResolution>

/**
 * Event-driven turn orchestrator, evolved into a declarative loop shell.
 *
 * It is now a thin wrapper that drives {@link LoopRunner} over a
 * {@link LoopPlan}: signal checks, {@link LoopRun} persistence, the
 * stepIndex loop, retry/budget guards, and cleanup. All step logic lives
 * in {@link LoopRunner}, which emits the full rich-event stream and
 * appends to the run log.
 *
 * Classic {@link TurnOrchestrator} is untouched and remains the default
 * regression anchor.
 */
export class EventedTurnOrchestrator {
  private readonly opts: TurnOrchestratorOptions
  private readonly serializer: TurnStateSerializer
  private readonly coordinator: ToolCallCoordinator
  private readonly modelStepRunner: ModelStepRunner
  private readonly promptBuilder: PromptBuilder
  private readonly eventBus: TurnEventBus
  private readonly plan: LoopPlan
  private readonly evaluator?: LoopEvaluator

  constructor(
    opts: TurnOrchestratorOptions,
    serializer: TurnStateSerializer,
    eventBus: TurnEventBus = new TurnEventBus(),
    plan: LoopPlan = defaultLoopPlan(),
    evaluator: LoopEvaluator = defaultLoopEvaluator
  ) {
    this.opts = opts
    this.serializer = serializer
    this.eventBus = eventBus
    this.plan = plan
    this.evaluator = evaluator
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
      ...(opts.onPlanWritten ? { onPlanWritten: opts.onPlanWritten } : {})
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
   * Run a turn through the declarative loop: persists a {@link LoopRun}
   * before each step (crash-recovery resume point), drives {@link LoopRunner}
   * over the {@link LoopPlan}, and deletes the persisted state on exit.
   *
   * On restart, a stale run is detected and the stepIndex is resumed.
   * A `retry` outcome reruns the same stepIndex without advancing (bounded
   * by the evaluate phase's `maxRetries`).
   */
  async runTurn(threadId: string, turnId: string): Promise<'completed' | 'failed' | 'aborted'> {
    const signal = this.opts.turns.getAbortController(turnId)
    if (!signal) return 'failed'
    if (signal.aborted) return 'aborted'

    const runner = new LoopRunner({
      promptBuilder: this.promptBuilder,
      modelStepRunner: this.modelStepRunner,
      coordinator: this.coordinator,
      evaluator: this.evaluator,
      events: this.opts.events,
      turns: this.opts.turns,
      ids: this.opts.ids
    })

    const startedAt = this.opts.nowIso()

    // Crash recovery: if a previous run exists, resume from its stepIndex.
    const previous = await this.serializer.load(threadId, turnId)
    let stepIndex = previous?.stepIndex ?? 0
    const run: LoopRun = previous ?? {
      version: 2,
      threadId,
      turnId,
      stepIndex,
      phaseCursor: 0,
      events: [],
      items: [],
      status: 'running',
      startedAt,
      updatedAt: this.opts.nowIso()
    }

    let status: 'completed' | 'failed' | 'aborted' = 'failed'
    try {
      for (;;) {
        if (signal.aborted) {
          status = 'aborted'
          break
        }

        // Budget guard: a runaway loop must terminate.
        const maxSteps = this.plan.budget?.maxSteps ?? Number.POSITIVE_INFINITY
        if (stepIndex >= maxSteps) {
          await this.opts.events.record({
            kind: 'error',
            threadId,
            turnId,
            message: `Loop exceeded maxSteps budget (${maxSteps})`,
            code: 'loop_budget_exceeded'
          })
          status = 'failed'
          break
        }

        // Persist state before the step so a crash mid-step can resume here.
        run.stepIndex = stepIndex
        run.phaseCursor = 0
        run.status = 'running'
        run.updatedAt = this.opts.nowIso()
        await this.serializer.save(run)

        const outcome = await runner.step({
          run,
          plan: this.plan,
          signal,
          stepIndex,
          bus: this.eventBus
        })
        run.updatedAt = this.opts.nowIso()

        if (outcome.action === 'stop') {
          status = 'completed'
          break
        }
        if (outcome.action === 'failed') {
          status = 'failed'
          break
        }
        if (outcome.action === 'aborted') {
          status = 'aborted'
          break
        }
        if (outcome.action === 'retry') {
          // Rerun the same stepIndex; do NOT advance.
          continue
        }
        // 'continue' — advance stepIndex
        stepIndex += 1
      }
    } finally {
      // Clean up persisted state on completion / failure / abort.
      await this.serializer.delete(threadId, turnId)
    }

    return status
  }
}
