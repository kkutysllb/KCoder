/**
 * ContinuationPolicy is a pure decision function: given the ModelStepRunner
 * result and the build context, it decides whether the turn should stop,
 * continue (with or without dispatching tool calls), fail, or materialise
 * assistant plan text into a synthesised `create_plan` call.
 *
 * The canonical implementation now lives in {@link decideLoopContinuation}
 * (loop-policy.ts). This module re-exports it under the legacy name so
 * existing callers and the classic TurnOrchestrator keep working unchanged.
 */

import type { ToolCallLike } from '@qiongqi/ports'
import type { IdGenerator } from '@qiongqi/ports'
import type { TurnItem } from '@qiongqi/contracts'
import type { BuildContext } from './prompt-builder.js'
import type { StepResult } from './model-step-runner.js'
import { decideLoopContinuation } from './loop-policy.js'

export type ContinuationDecision =
  | { action: 'stop' }
  | { action: 'continue' }
  | { action: 'failed' }
  | { action: 'failed_with_error'; errorMessage: string; errorCode: string }
  | { action: 'materialize_plan'; planCall: ToolCallLike; planToolCallItem: TurnItem }
  | { action: 'dispatch' }

export function decideContinuation(input: {
  stepResult: Extract<StepResult, { kind: 'ran' }>
  ctx: BuildContext
  ids: IdGenerator
  threadId: string
  turnId: string
}): ContinuationDecision {
  return decideLoopContinuation(input)
}

/** Sentinel used by the orchestrator for the normal "dispatch tool calls" path. */
export type DispatchDecision = { action: 'dispatch' }

export function isDispatchDecision(
  decision: ContinuationDecision
): decision is DispatchDecision {
  return decision.action === 'dispatch'
}
