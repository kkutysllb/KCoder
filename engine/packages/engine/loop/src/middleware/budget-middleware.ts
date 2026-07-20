import { ModelProposalSchema, TaskStateV1Schema } from '@qiongqi/contracts'
import type { RuntimeMiddleware } from '../runtime-middleware.js'

export type BudgetMiddlewareOptions = {
  maxSteps?: number
  maxToolCalls?: number
  maxTokens?: number
  maxCostUsd?: number
}

export function budgetMiddleware(options: BudgetMiddlewareOptions = {}): RuntimeMiddleware {
  return {
    id: 'budget', version: 1, hooks: ['beforeNode'],
    handle: async (context, next) => {
      const budget = context.state.budgets
      const totalTokens = budget.inputTokens + budget.outputTokens
      const maxToolCalls = options.maxToolCalls ?? Number.POSITIVE_INFINITY
      const pendingToolCalls = context.node?.id === 'prepare-tools'
        ? unledgeredToolCallCount(context.state.nodeData)
        : 0
      const projectedToolCalls = budget.toolCallsUsed + pendingToolCalls
      const toolCallCapped = context.node?.id === 'prepare-tools'
        ? projectedToolCalls > maxToolCalls
        : budget.toolCallsUsed > maxToolCalls
      const outcome = budget.stepsUsed >= (options.maxSteps ?? Number.POSITIVE_INFINITY)
        ? {
            status: 'degraded' as const,
            reason: 'step_capped' as const,
            retryable: false,
            details: { code: 'step_cap', maxSteps: options.maxSteps, stepsUsed: budget.stepsUsed }
          }
        : toolCallCapped
          ? {
              status: 'degraded' as const,
              reason: 'step_capped' as const,
              retryable: false,
              details: {
                code: 'tool_call_cap',
                maxToolCalls: options.maxToolCalls,
                toolCallsUsed: budget.toolCallsUsed,
                pendingToolCalls,
                projectedToolCalls
              }
            }
          : totalTokens >= (options.maxTokens ?? Number.POSITIVE_INFINITY)
            ? {
                status: 'degraded' as const,
                reason: 'token_capped' as const,
                retryable: false,
                details: { code: 'token_cap', maxTokens: options.maxTokens, totalTokens }
              }
            : budget.costUsd >= (options.maxCostUsd ?? Number.POSITIVE_INFINITY)
              ? {
                  status: 'degraded' as const,
                  reason: 'cost_capped' as const,
                  retryable: false,
                  details: { code: 'cost_cap', maxCostUsd: options.maxCostUsd, costUsd: budget.costUsd }
                }
              : undefined
      if (outcome) return { commands: [{ type: 'terminate', outcome }] }
      return next(context)
    }
  }
}

function unledgeredToolCallCount(nodeData: Record<string, unknown>): number {
  const proposal = ModelProposalSchema.safeParse(nodeData['normalize-proposal'])
  const task = TaskStateV1Schema.safeParse(nodeData['restore-task'])
  if (!proposal.success || !task.success) return 0
  const ledgerCallIds = new Set(task.data.toolLedger.map((entry) => entry.callId))
  return proposal.data.toolIntents.filter((intent) => !ledgerCallIds.has(intent.callId)).length
}
