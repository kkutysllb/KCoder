import { Router } from '../router.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { readJsonBody } from '../read-json-body.js'
import { healthJsonResponse, readinessJsonResponse } from './health.js'
import { buildWorkspaceStatusResponse } from './workspace.js'
import {
  createThread,
  clearThreadGoal,
  clearThreadTodos,
  deleteThread,
  forkThread,
  getThreadGoal,
  getThreadTodos,
  getThread,
  listThreads,
  setThreadGoal,
  setThreadTodos,
  updateThread
} from './threads.js'
import {
  compactTurn,
  getTurn,
  interruptTurn,
  startTurn,
  steerTurn
} from './turns.js'
import { startReview } from './review.js'
import { buildEventStreamResponse } from './events.js'
import { buildEngineStreamResponse } from './engine-stream.js'
import { decideApproval } from './approvals.js'
import { resolveUserInput } from './user-inputs.js'
import { resumeSession } from './sessions.js'
import { usageJsonResponse } from './usage.js'
import { runtimeInfoJsonResponse, runtimeToolDiagnosticsJsonResponse, runtimeMetricsResponse } from './runtime-info.js'
import { agentCardJsonResponse } from './agent-card.js'
import { a2aCreateTask, a2aCreateTaskSync, a2aGetTask, a2aCancelTask, a2aGetArtifacts, a2aSubscribeTask } from './a2a.js'
import { listSkills } from './skills.js'
import {
  analyzeSkillDraft,
  createSkillDraft,
  generateSkillDraft,
  installSkillDraft,
  listSkillDrafts,
  updateSkillDraft
} from './skill-drafts.js'
import {
  attachmentDiagnostics,
  getAttachmentContent,
  getAttachmentMetadata,
  uploadAttachment
} from './attachments.js'
import {
  listThreadArtifacts,
  readThreadArtifact
} from './artifacts.js'
import {
  createMemory,
  deleteMemory,
  listMemories,
  memoryDiagnostics,
  updateMemory
} from './memory.js'
import { isAuthorized, bearerToken } from '../auth.js'
import { AuthError, authSessionBody, type AuthActor } from '../auth-service.js'
import { ERRORS } from './runtime-error.js'
import type { ServerRuntime } from './server-runtime.js'

/**
 * Build the core HTTP router. Product-specific compatibility APIs belong in
 * embedding applications, not in the generic Qiongqi runtime.
 */
export function buildRouter(runtime: ServerRuntime): Router {
  const router = new Router()

  router.add('GET', '/health', () => healthJsonResponse())
  router.add('GET', '/ready', () => readinessJsonResponse(runtime))
  router.add('GET', '/.well-known/agent-card.json', () => agentCardJsonResponse(runtime))

  registerAuthRoutes(router, runtime)
  registerA2aRoutes(router, runtime)
  registerRuntimeRoutes(router, runtime)
  registerSkillRoutes(router, runtime)
  registerAttachmentRoutes(router, runtime)
  registerMemoryRoutes(router, runtime)
  registerThreadRoutes(router, runtime)
  registerApprovalRoutes(router, runtime)
  registerUsageRoutes(router, runtime)

  return router
}

function registerAuthRoutes(router: Router, runtime: ServerRuntime): void {
  router.add('GET', '/v1/auth/setup-status', async () => {
    if (!runtime.authService) return ERRORS.unavailable('auth service not configured')
    return jsonResponse(await runtime.authService.setupStatus())
  })
  router.add('POST', '/v1/auth/initialize', (request) =>
    authJsonResponse(runtime, async (service) => service.initialize(await authCredentialsFromRequest(request))))
  router.add('POST', '/v1/auth/login', (request) =>
    authJsonResponse(runtime, async (service) => service.login(await authCredentialsFromRequest(request))))
  router.add('POST', '/v1/auth/register', (request) =>
    authJsonResponse(runtime, async (service) => service.register(await authCredentialsFromRequest(request))))
  router.add('GET', '/v1/auth/me', async (request) => {
    const actor = await authenticate(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return jsonResponse({ user: actor.user })
  })
  router.add('POST', '/v1/auth/logout', async (request) => {
    if (!runtime.authService) return ERRORS.unavailable('auth service not configured')
    await runtime.authService.logout(bearerToken(request.headers))
    return jsonResponse({ success: true })
  })
  router.add('POST', '/v1/auth/change-password', async (request) => {
    if (!runtime.authService) return ERRORS.unavailable('auth service not configured')
    const actor = await authenticate(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    const body = await readJsonBody(request)
    if (!body.ok) return body.response
    if (!isObject(body.value)) return ERRORS.validation('auth body must be an object')
    try {
      const session = await runtime.authService.changePassword({
        actor,
        currentPassword: stringValue(body.value.currentPassword) ?? stringValue(body.value.current_password) ?? '',
        newPassword: stringValue(body.value.newPassword) ?? stringValue(body.value.new_password) ?? ''
      })
      return jsonResponse(authSessionBody(session))
    } catch (error) {
      return authErrorResponse(error)
    }
  })
}

function registerA2aRoutes(router: Router, runtime: ServerRuntime): void {
  router.add('POST', '/a2a/tasks', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    if (!runtime.a2aTaskStore) return ERRORS.unavailable('A2A task store not configured')
    return a2aCreateTask(runtime, runtime.a2aTaskStore, request)
  })
  router.add('GET', '/a2a/tasks/:id', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    if (!runtime.a2aTaskStore) return ERRORS.unavailable('A2A task store not configured')
    return a2aGetTask(runtime.a2aTaskStore, ctx.params.id)
  })
  router.add('POST', '/a2a/tasks/:id/cancel', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    if (!runtime.a2aTaskStore) return ERRORS.unavailable('A2A task store not configured')
    return a2aCancelTask(runtime, runtime.a2aTaskStore, ctx.params.id)
  })
  router.add('GET', '/a2a/tasks/:id/artifacts', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    if (!runtime.a2aTaskStore) return ERRORS.unavailable('A2A task store not configured')
    return a2aGetArtifacts(runtime, runtime.a2aTaskStore, ctx.params.id)
  })
  router.add('GET', '/a2a/tasks/:id/subscribe', (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    if (!runtime.a2aTaskStore) return ERRORS.unavailable('A2A task store not configured')
    return a2aSubscribeTask(runtime, runtime.a2aTaskStore, ctx.params.id, request)
  })
  router.add('POST', '/a2a', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    if (!runtime.a2aTaskStore) return ERRORS.unavailable('A2A task store not configured')
    return a2aCreateTaskSync(runtime, runtime.a2aTaskStore, request)
  })
}

function registerRuntimeRoutes(router: Router, runtime: ServerRuntime): void {
  router.add('GET', '/v1/runtime/info', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return runtimeInfoJsonResponse(runtime)
  })
  router.add('GET', '/v1/runtime/tools', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return runtimeToolDiagnosticsJsonResponse(runtime)
  })
  router.add('GET', '/v1/runtime/metrics', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return runtimeMetricsResponse(request, runtime)
  })
  router.add('GET', '/v1/engine/streams/:streamId/subscribe', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    if (!runtime.durableEngineStore) return ERRORS.unavailable('durable engine store is not configured')
    const url = new URL(request.url)
    const subscriberId = stringValue(url.searchParams.get('subscriber_id'))
      ?? stringValue(request.headers.get('x-qiongqi-subscriber-id'))
      ?? 'anonymous'
    const includePrivate = url.searchParams.get('include_private') === 'true'
    const allowPrivate = includePrivate && actor.role === 'admin'
    return buildEngineStreamResponse({
      request,
      store: runtime.durableEngineStore,
      streamId: ctx.params.streamId,
      subscriberId,
      allowPrivate
    })
  })
  router.add('POST', '/v1/engine/streams/:streamId/ack', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    if (!runtime.durableEngineStore) return ERRORS.unavailable('durable engine store is not configured')
    const body = await readJsonBody(request)
    if (!body.ok) return body.response
    if (!isObject(body.value)) return ERRORS.validation('stream ack body must be an object')
    const subscriberId = stringValue(body.value.subscriberId) ?? stringValue(body.value.subscriber_id)
    const throughSeq = body.value.throughSeq ?? body.value.through_seq
    if (!subscriberId || !Number.isInteger(throughSeq) || Number(throughSeq) < 0) {
      return ERRORS.validation('subscriberId and non-negative throughSeq are required')
    }
    await runtime.durableEngineStore.ackStream(ctx.params.streamId, subscriberId, Number(throughSeq))
    return jsonResponse({ streamId: ctx.params.streamId, subscriberId, throughSeq })
  })
  router.add('GET', '/v1/runtime/evented-v2/runs/:runId/timeline', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    if (!runtime.multiAgentRuntime) return ERRORS.unavailable('evented_v2 runtime is not configured')
    try {
      return jsonResponse(await runtime.multiAgentRuntime.timeline(ctx.params.runId))
    } catch (error) {
      if (String((error as { message?: unknown })?.message ?? error).includes('MultiAgentRun not found')) {
        return ERRORS.notFound(`evented_v2 run not found: ${ctx.params.runId}`)
      }
      throw error
    }
  })
  router.add('GET', '/v1/runtime/evented-v2/metrics', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    if (!runtime.multiAgentRuntime) return ERRORS.unavailable('evented_v2 runtime is not configured')
    return jsonResponse(await runtime.multiAgentRuntime.metrics())
  })
  // ============ Governed graph governance routes ============
  // These expose the DurableEngine's governance surface when governedGraph
  // mode is enabled: inspect a run's graph/circuit/workEvents, set the circuit
  // state (report_only/paused/retired/running), and cancel a run.
  router.add('GET', '/v1/engine/runs/:runId/inspect', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    if (!runtime.governedEngine) return ERRORS.unavailable('governed graph engine is not configured')
    try {
      return jsonResponse(await runtime.governedEngine.inspect(ctx.params.runId))
    } catch (error) {
      if (String((error as { message?: unknown })?.message ?? error).includes('not found')) {
        return ERRORS.notFound(`governed run not found: ${ctx.params.runId}`)
      }
      throw error
    }
  })
  router.add('POST', '/v1/engine/runs/:runId/circuit', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    if (!runtime.governedEngine) return ERRORS.unavailable('governed graph engine is not configured')
    const body = await readJsonBody(request)
    if (!body.ok) return body.response
    const state = (body.value as { state?: string })?.state
    if (state !== 'running' && state !== 'report_only' && state !== 'paused' && state !== 'retired') {
      return ERRORS.validation('circuit state must be one of: running, report_only, paused, retired')
    }
    await runtime.governedEngine.setGraphCircuit(ctx.params.runId, state)
    return jsonResponse({ runId: ctx.params.runId, circuitState: state })
  })
  router.add('POST', '/v1/engine/runs/:runId/cancel', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    if (!runtime.governedEngine) return ERRORS.unavailable('governed graph engine is not configured')
    await runtime.governedEngine.cancel(ctx.params.runId)
    return jsonResponse({ runId: ctx.params.runId, cancelled: true })
  })
  router.add('POST', '/v1/engine/checkpoints/:checkpointId/resolve', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    if (!runtime.governedEngine) return ERRORS.unavailable('governed graph engine is not configured')
    const body = await readJsonBody(request)
    if (!body.ok) return body.response
    const value = body.value as { decision?: string; token?: string; resolutionToken?: string; graphRevision?: number }
    if (value.decision !== 'allow' && value.decision !== 'deny') {
      return ERRORS.validation('checkpoint decision must be allow or deny')
    }
    await runtime.governedEngine.resolveCheckpoint(ctx.params.checkpointId, {
      decision: value.decision,
      ...(value.token ? { token: value.token } : {}),
      ...(value.resolutionToken ? { resolutionToken: value.resolutionToken } : {}),
      ...(value.graphRevision ? { graphRevision: value.graphRevision } : {})
    })
    return jsonResponse({ checkpointId: ctx.params.checkpointId, resolved: true })
  })
  router.add('GET', '/v1/workspace/status', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const url = new URL(request.url)
    const path = url.searchParams.get('path')
    return buildWorkspaceStatusResponse({ inspector: runtime.workspaceInspector, path })
  })
}

function registerSkillRoutes(router: Router, runtime: ServerRuntime): void {
  router.add('GET', '/v1/skills', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return listSkills(runtime)
  })
  router.add('GET', '/v1/skills/drafts', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return listSkillDrafts(runtime)
  })
  router.add('POST', '/v1/skills/drafts', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return createSkillDraft(runtime, actor, request)
  })
  router.add('POST', '/v1/skills/drafts/:draftId/analyze', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return analyzeSkillDraft(runtime, actor, ctx.params.draftId)
  })
  router.add('POST', '/v1/skills/drafts/:draftId/generate', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return generateSkillDraft(runtime, actor, ctx.params.draftId)
  })
  router.add('PATCH', '/v1/skills/drafts/:draftId', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return updateSkillDraft(runtime, actor, ctx.params.draftId, request)
  })
  router.add('POST', '/v1/skills/drafts/:draftId/install', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return installSkillDraft(runtime, actor, ctx.params.draftId, request)
  })
}

function registerAttachmentRoutes(router: Router, runtime: ServerRuntime): void {
  router.add('POST', '/v1/attachments', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return uploadAttachment(runtime.attachmentStore, request)
  })
  router.add('GET', '/v1/attachments/diagnostics', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return attachmentDiagnostics(runtime.attachmentStore)
  })
  router.add('GET', '/v1/attachments/:id', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return getAttachmentMetadata(runtime.attachmentStore, ctx.params.id)
  })
  router.add('GET', '/v1/attachments/:id/content', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return getAttachmentContent(runtime.attachmentStore, ctx.params.id, request)
  })
}

function registerMemoryRoutes(router: Router, runtime: ServerRuntime): void {
  router.add('GET', '/v1/memory', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return listMemories(runtime.memoryStore, request, actorOwner(actor))
  })
  router.add('POST', '/v1/memory', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return createMemory(runtime.memoryStore, request, actorOwner(actor))
  })
  router.add('GET', '/v1/memory/diagnostics', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return memoryDiagnostics(runtime.memoryStore)
  })
  router.add('PATCH', '/v1/memory/:id', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return updateMemory(runtime.memoryStore, ctx.params.id, request, actorOwner(actor))
  })
  router.add('DELETE', '/v1/memory/:id', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return deleteMemory(runtime.memoryStore, ctx.params.id, actorOwner(actor))
  })
}

function registerThreadRoutes(router: Router, runtime: ServerRuntime): void {
  router.add('GET', '/v1/threads', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return listThreads(runtime.threadService, request, actorOwner(actor))
  })
  router.add('POST', '/v1/threads', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return createThread(runtime.threadService, request, actorOwner(actor), await defaultModelForActor(runtime, actor), runtime)
  })
  router.add('GET', '/v1/threads/:id', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return getThread(runtime.threadService, ctx.params.id, runtime.sessionStore, actorOwner(actor))
  })
  router.add('PATCH', '/v1/threads/:id', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return updateThread(runtime.threadService, ctx.params.id, request)
  })
  router.add('DELETE', '/v1/threads/:id', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return deleteThread(runtime.threadService, ctx.params.id)
  })
  router.add('POST', '/v1/threads/:id/fork', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return forkThread(runtime.threadService, ctx.params.id, request)
  })
  router.add('GET', '/v1/threads/:id/goal', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return getThreadGoal(runtime.threadService, ctx.params.id)
  })
  router.add('POST', '/v1/threads/:id/goal', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return setThreadGoal(runtime.threadService, ctx.params.id, request)
  })
  router.add('DELETE', '/v1/threads/:id/goal', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return clearThreadGoal(runtime.threadService, ctx.params.id)
  })
  router.add('GET', '/v1/threads/:id/todos', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return getThreadTodos(runtime.threadService, ctx.params.id)
  })
  router.add('POST', '/v1/threads/:id/todos', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return setThreadTodos(runtime.threadService, ctx.params.id, request)
  })
  router.add('DELETE', '/v1/threads/:id/todos', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return clearThreadTodos(runtime.threadService, ctx.params.id)
  })
  router.add('POST', '/v1/threads/:id/turns', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    if (!(await ownsThread(runtime, ctx.params.id, actor))) return ERRORS.notFound(`thread not found: ${ctx.params.id}`)
    const thread = await runtime.threadService.get(ctx.params.id)
    return startTurn(runtime.turnService, ctx.params.id, request, ({ threadId, turnId }) => {
      runtime.runTurn(threadId, turnId)
    }, thread?.model ?? await defaultModelForActor(runtime, actor))
  })
  router.add('POST', '/v1/threads/:id/review', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    if (!runtime.reviewService || !runtime.runReview) {
      return ERRORS.unavailable('review is not available')
    }
    return startReview(
      runtime.turnService,
      ctx.params.id,
      request,
      ({ threadId, turnId, reviewItemId }, target, model) => {
        runtime.runReview?.({ threadId, turnId, reviewItemId, target, model })
      }
    )
  })
  router.add('GET', '/v1/threads/:id/turns/:turnId', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return getTurn(runtime.turnService, ctx.params.id, ctx.params.turnId)
  })
  router.add('POST', '/v1/threads/:id/turns/:turnId/steer', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return steerTurn(runtime.turnService, ctx.params.id, ctx.params.turnId, request)
  })
  router.add('POST', '/v1/threads/:id/turns/:turnId/interrupt', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return interruptTurn(runtime.turnService, ctx.params.id, ctx.params.turnId, request)
  })
  router.add('POST', '/v1/threads/:id/compact', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return compactTurn(runtime.turnService, ctx.params.id, request)
  })
  router.add('GET', '/v1/threads/:id/events', (request, ctx) => {
    return (async () => {
      const actor = await authenticateOrInternal(request, runtime)
      if (!actor) return ERRORS.unauthorized()
      if (!(await ownsThread(runtime, ctx.params.id, actor))) return ERRORS.notFound(`thread not found: ${ctx.params.id}`)
      return buildEventStreamResponse({
        request,
        threadId: ctx.params.id,
        eventBus: runtime.eventBus,
        sessionStore: runtime.sessionStore,
        allocateSeq: runtime.allocateSeq
      })
    })()
  })
  router.add('GET', '/v1/threads/:id/artifacts', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return listThreadArtifacts(runtime, ctx.params.id)
  })
  router.add('GET', '/v1/threads/:id/artifacts/content', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return readThreadArtifact(runtime, ctx.params.id, request)
  })
}

function registerApprovalRoutes(router: Router, runtime: ServerRuntime): void {
  router.add('POST', '/v1/approvals/:id', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return decideApproval({
      approvalId: ctx.params.id,
      request,
      gate: runtime.approvalGate,
      events: runtime.events
    })
  })
  router.add('POST', '/v1/user-inputs/:id', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return resolveUserInput({
      inputId: ctx.params.id,
      request,
      gate: runtime.userInputGate
    })
  })
  router.add('POST', '/v1/user-input/:id', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return resolveUserInput({
      inputId: ctx.params.id,
      request,
      gate: runtime.userInputGate
    })
  })
  router.add('POST', '/v1/sessions/:id/resume-thread', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return resumeSession(runtime.threadService, ctx.params.id, request)
  })
}

function registerUsageRoutes(router: Router, runtime: ServerRuntime): void {
  router.add('GET', '/v1/usage', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return usageJsonResponse(request, runtime, actorOwner(actor) ? actor : undefined)
  })
}

async function authCredentialsFromRequest(request: Request): Promise<{ email: string; password: string }> {
  const body = await readJsonBody(request)
  if (!body.ok) throw body.response
  if (!isObject(body.value)) throw ERRORS.validation('auth body must be an object')
  return {
    email: stringValue(body.value.email) ?? '',
    password: stringValue(body.value.password) ?? ''
  }
}

async function authJsonResponse(
  runtime: ServerRuntime,
  run: (service: NonNullable<ServerRuntime['authService']>) => Promise<unknown>
): Promise<JsonResponse> {
  if (!runtime.authService) return ERRORS.unavailable('auth service not configured')
  try {
    const result = await run(runtime.authService)
    return jsonResponse(authSessionBody(result as Parameters<typeof authSessionBody>[0]))
  } catch (error) {
    if (isJsonResponse(error)) return error
    return authErrorResponse(error)
  }
}

function authErrorResponse(error: unknown): JsonResponse {
  if (error instanceof AuthError) {
    return jsonResponse({ code: 'auth_error', message: error.message }, error.status)
  }
  throw error
}

function isJsonResponse(value: unknown): value is JsonResponse {
  return isObject(value)
    && typeof value.status === 'number'
    && isObject(value.headers)
    && typeof value.body === 'string'
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function authorize(request: Request, runtime: ServerRuntime): boolean {
  return isAuthorized(request.headers, runtime.runtimeToken, runtime.insecure)
}

async function authenticate(request: Request, runtime: ServerRuntime): Promise<AuthActor | null> {
  if (runtime.insecure && !runtime.authService) {
    return {
      userId: 'insecure-local-user',
      role: 'admin',
      sessionId: 'insecure',
      user: {
        id: 'insecure-local-user',
        email: 'local@qiongqi.invalid',
        username: 'local@qiongqi.invalid',
        display_name: 'Local User',
        system_role: 'admin',
        is_admin: true,
        auth_provider: 'local'
      }
    }
  }
  return runtime.authService?.verifyToken(bearerToken(request.headers)) ?? null
}

async function authenticateOrInternal(request: Request, runtime: ServerRuntime): Promise<AuthActor | null> {
  const actor = await authenticate(request, runtime)
  if (actor) return actor
  if (!authorize(request, runtime)) return null
  return {
    userId: 'internal-runtime',
    role: 'admin',
    sessionId: 'runtime-token',
    user: {
      id: 'internal-runtime',
      email: 'internal@qiongqi.invalid',
      username: 'internal@qiongqi.invalid',
      display_name: 'Internal Runtime',
      system_role: 'admin',
      is_admin: true,
      auth_provider: 'local'
    }
  }
}

async function ownsThread(runtime: ServerRuntime, threadId: string, actor: AuthActor): Promise<boolean> {
  if (actor.sessionId === 'runtime-token') return true
  return Boolean(await runtime.threadService.getForOwner(threadId, actor.userId))
}

function actorOwner(actor: AuthActor): string | undefined {
  return actor.sessionId === 'runtime-token' ? undefined : actor.userId
}

async function defaultModelForActor(runtime: ServerRuntime, actor: AuthActor): Promise<string> {
  const owner = actorOwner(actor)
  if (owner && runtime.userDataStore) {
    const userModels = await runtime.userDataStore.listModelProfiles(owner)
    if (userModels.activeModel && userModels.profiles[userModels.activeModel]) {
      return userModels.activeModel
    }
  }
  return runtime.info().model ?? 'default'
}
