import { z } from 'zod'
import {
  BudgetStateSchema,
  GraphRevisionSchema,
  KernelCompletionPayloadSchema,
  KernelRunIdentitySchema
} from '@qiongqi/contracts'
import type { GovernedTurnRuntime } from '../governed-turn-runtime.js'
import { readJsonBody } from '../read-json-body.js'
import { jsonResponse } from '../response.js'
import type { Router } from '../router.js'
import { ERRORS } from './runtime-error.js'
import type { ServerRuntime } from './server-runtime.js'

const NonEmpty = z.string().trim().min(1)

export const GovernedSerialDispatchRequestSchema = z.object({
  multiAgentRunId: NonEmpty,
  prompt: NonEmpty,
  requestedBudget: BudgetStateSchema,
  sharedEvidenceRefs: z.array(NonEmpty).optional()
}).strict()

export const GovernedParallelDispatchRequestSchema = z.object({
  multiAgentRunId: NonEmpty,
  prompt: NonEmpty,
  requestedBudgets: z.record(NonEmpty, BudgetStateSchema),
  sharedEvidenceRefs: z.array(NonEmpty).optional()
}).strict()

export const GovernedCompletionRequestSchema = z.object({
  multiAgentRunId: NonEmpty,
  completion: KernelCompletionPayloadSchema
}).strict()

export const GovernedKernelResumeRequestSchema = z.object({
  executionRef: KernelRunIdentitySchema,
  resolution: z.unknown().optional()
}).strict()

export const GovernedCancelRequestSchema = z.object({
  multiAgentRunId: NonEmpty
}).strict()

export function registerGovernedEngineRoutes(input: {
  router: Router
  runtime: ServerRuntime
  authorize: (request: Request) => boolean
  governedTurns: () => GovernedTurnRuntime | undefined
}): void {
  const { router, runtime } = input

  router.add('POST', '/v1/engine/graphs', async (request) => {
    if (!input.authorize(request)) return ERRORS.unauthorized()
    const binding = runtime.governedEngine
    if (!binding) return ERRORS.unavailable('governed DurableEngine is not configured')
    const body = await readJsonBody(request)
    if (!body.ok) return body.response
    const parsed = GraphRevisionSchema.safeParse(body.value)
    if (!parsed.success) return ERRORS.validation('invalid graph revision', parsed.error.issues)
    try {
      await binding.engine.publishGraph(parsed.data)
      return jsonResponse(parsed.data, 201)
    } catch (error) {
      return governedError(error)
    }
  })

  router.add('GET', '/v1/engine/runs/:runId', async (request, ctx) => {
    if (!input.authorize(request)) return ERRORS.unauthorized()
    if (!runtime.governedEngine) return ERRORS.unavailable('governed DurableEngine is not configured')
    try {
      return jsonResponse(await requireTurns(input).inspectRun(ctx.params.runId))
    } catch (error) {
      return governedError(error)
    }
  })

  router.add('POST', '/v1/engine/runs/:runId/dispatch/serial', async (request, ctx) => {
    return withGovernedBody(input, request, ctx.params.runId, GovernedSerialDispatchRequestSchema, async (body, turns) => {
      assertPathIdentity(ctx.params.runId, body.multiAgentRunId)
      const result = await runtime.governedEngine!.engine.dispatchActiveAgent(body)
      await turns.inspectRun(ctx.params.runId)
      return result
    })
  })

  router.add('POST', '/v1/engine/runs/:runId/dispatch/parallel', async (request, ctx) => {
    return withGovernedBody(input, request, ctx.params.runId, GovernedParallelDispatchRequestSchema, async (body, turns) => {
      assertPathIdentity(ctx.params.runId, body.multiAgentRunId)
      const result = await runtime.governedEngine!.engine.dispatchParallelAgents(body)
      await turns.inspectRun(ctx.params.runId)
      return result
    })
  })

  router.add('POST', '/v1/engine/runs/:runId/completions', async (request, ctx) => {
    return withGovernedBody(input, request, ctx.params.runId, GovernedCompletionRequestSchema, async (body, turns) => {
      assertPathIdentity(ctx.params.runId, body.multiAgentRunId)
      const result = await runtime.governedEngine!.engine.consumeKernelCompletion(body)
      await turns.inspectRun(ctx.params.runId)
      return result
    })
  })

  router.add('POST', '/v1/engine/runs/:runId/kernel/resume', async (request, ctx) => {
    return withGovernedBody(input, request, ctx.params.runId, GovernedKernelResumeRequestSchema, async (body, turns) => {
      assertPathIdentity(ctx.params.runId, body.executionRef.multiAgentRunId)
      await runtime.governedEngine!.engine.resume(body.executionRef, body.resolution)
      await turns.inspectRun(ctx.params.runId)
      return { multiAgentRunId: ctx.params.runId, resumed: true }
    })
  })

  router.add('POST', '/v1/engine/runs/:runId/cancel', async (request, ctx) => {
    return withGovernedBody(input, request, ctx.params.runId, GovernedCancelRequestSchema, async (body, turns) => {
      assertPathIdentity(ctx.params.runId, body.multiAgentRunId)
      await runtime.governedEngine!.engine.cancel(ctx.params.runId)
      await turns.inspectRun(ctx.params.runId)
      return { multiAgentRunId: ctx.params.runId, cancelled: true }
    })
  })
}

async function withGovernedBody<T>(
  input: Parameters<typeof registerGovernedEngineRoutes>[0],
  request: Request,
  _runId: string,
  schema: z.ZodType<T>,
  operation: (body: T, turns: GovernedTurnRuntime) => Promise<unknown>
) {
  if (!input.authorize(request)) return ERRORS.unauthorized()
  if (!input.runtime.governedEngine) return ERRORS.unavailable('governed DurableEngine is not configured')
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = schema.safeParse(body.value)
  if (!parsed.success) return ERRORS.validation('invalid governed engine request', parsed.error.issues)
  try {
    return jsonResponse(await operation(parsed.data, requireTurns(input)))
  } catch (error) {
    return governedError(error)
  }
}

function requireTurns(input: Parameters<typeof registerGovernedEngineRoutes>[0]): GovernedTurnRuntime {
  const turns = input.governedTurns()
  if (!turns) throw new Error('governed DurableEngine is not configured')
  return turns
}

function assertPathIdentity(pathRunId: string, bodyRunId: string): void {
  if (pathRunId !== bodyRunId) throw new Error('path runId contradicts request execution identity')
}

function governedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (/not found/i.test(message)) return ERRORS.notFound(message)
  if (/contradict|conflict|already|multiple/i.test(message)) return ERRORS.conflict(message)
  if (/not configured/i.test(message)) return ERRORS.unavailable(message)
  throw error
}
