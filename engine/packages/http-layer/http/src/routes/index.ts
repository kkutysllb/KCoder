import { Router } from '../router.js'
import { jsonResponse } from '../response.js'
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
  deleteThreadUpload,
  listThreadUploads,
  uploadThreadFiles
} from './uploads.js'
import {
  createMemory,
  deleteMemory,
  listMemories,
  memoryDiagnostics,
  updateMemory
} from './memory.js'
import { isAuthorized, bearerToken } from '../auth.js'
import { ERRORS } from './runtime-error.js'
import type { ServerRuntime } from './server-runtime.js'
import {
  FINANCE_CREDENTIALS_SECRET_KEY,
  FINANCE_DATA_SOURCE_CONFIG_KEY,
  loadFinanceDataSource,
  saveFinanceDataSource,
  type FinanceCredentialSecrets,
  type FinanceDataSourceConfig
} from '../finance-credentials.js'
import {
  kworksCancelRun,
  kworksAcceptProjectStageSuggestion,
  kworksApplyCodingReviewFix,
  kworksAuthChangePassword,
  kworksAuthInitialize,
  kworksAuthLogin,
  kworksAuthLogout,
  kworksAuthMe,
  kworksAuthRegister,
  kworksAuthSetupStatus,
  kworksChannelsConfig,
  kworksConfig,
  kworksConfigSection,
  kworksCodingSkills,
  kworksCreateModel,
  kworksCreateCron,
  kworksCreateProject,
  kworksCreateThread,
  kworksDeleteCron,
  kworksDeleteModel,
  kworksDeleteProject,
  kworksDeleteThread,
  kworksDeliveryStages,
  kworksCreateSkill,
  kworksDiscardProjectFileChange,
  kworksDismissProjectStageSuggestion,
  kworksEmptyList,
  kworksExistingRunStream,
  kworksGetCodingRoiSummary,
  kworksGetCodingSkill,
  kworksGetCodingSession,
  kworksGetLatestCodingReview,
  kworksGetProjectDiff,
  kworksGetProjectEnvironment,
  kworksGetProjectStage,
  kworksGetRun,
  kworksGetProject,
  kworksGetThread,
  kworksGetThreadHistory,
  kworksGetThreadState,
  kworksInstallSkill,
  kworksGitCommitProject,
  kworksGitPushProject,
  kworksListCodingRoiReports,
  kworksListCodingSessionChanges,
  kworksListCodingSessionEvents,
  kworksListProjectFiles,
  kworksListProjectWorktrees,
  kworksListProjects,
  kworksListCrons,
  kworksListRuns,
  kworksMcpConfig,
  kworksMemory,
  kworksModels,
  kworksActivateModel,
  kworksReadProjectFile,
  kworksRunStream,
  kworksRunCodingReview,
  kworksSaveConfig,
  kworksSaveConfigSection,
  kworksSearchThreads,
  kworksSetCodingSkillEnabled,
  kworksSetProjectStage,
  kworksSkills,
  kworksModeSkills,
  syncRuntimeToolsForActor,
  kworksToggleCron,
  kworksUpdateCron,
  kworksUpdateModel,
  kworksUpdateThreadState,
  kworksWorkModes
} from './kworks-compat.js'
import type { AuthActor } from '../auth-service.js'

/**
 * Build the full router used by the HTTP server. The router exposes:
 * - `GET /health` (unauthenticated)
 * - `GET /.well-known/agent-card.json` (unauthenticated, Stage 2 A2A discovery)
 * - `POST /a2a/tasks` (auth, Stage 4 A2A task submission with status tracking)
 * - `GET /a2a/tasks/:id` (auth, Stage 4 A2A task status query)
 * - `POST /a2a/tasks/:id/cancel` (auth, Stage 4 cancel task)
 * - `GET /a2a/tasks/:id/artifacts` (auth, Stage 4 task artifacts)
 * - `GET /a2a/tasks/:id/subscribe` (auth, Stage 4 SSE task progress)
 * - `GET /v1/runtime/info` (auth)
 * - `GET /v1/runtime/tools` (auth)
 * - `GET /v1/skills` (auth)
 * - `POST /v1/attachments` (auth)
 * - `GET /v1/attachments/diagnostics` (auth)
 * - `GET /v1/attachments/{id}` and `{id}/content` (auth)
 * - `GET /v1/threads/{id}/artifacts` and `{id}/artifacts/content` (auth)
 * - `GET/POST /v1/memory`, `PATCH/DELETE /v1/memory/{id}`, diagnostics (auth)
 * - `GET /v1/workspace/status` (auth)
 * - `GET/POST /v1/threads` (auth)
 * - `GET/PATCH/DELETE /v1/threads/{id}` (auth)
 * - `POST /v1/threads/{id}/fork` (auth)
 * - `GET/POST/DELETE /v1/threads/{id}/goal` (auth)
 * - `GET/POST/DELETE /v1/threads/{id}/todos` (auth)
 * - `POST /v1/threads/{id}/turns` (auth)
 * - `POST /v1/threads/{id}/review` (auth)
 * - `GET /v1/threads/{id}/turns/{turnId}` (auth)
 * - `POST /v1/threads/{id}/turns/{turnId}/steer` (auth)
 * - `POST /v1/threads/{id}/turns/{turnId}/interrupt` (auth)
 * - `POST /v1/threads/{id}/compact` (auth)
 * - `GET /v1/threads/{id}/events` (auth)
 * - `POST /v1/approvals/{id}` (auth)
 * - `POST /v1/user-inputs/{id}` and `/v1/user-input/{id}` (auth)
 * - `POST /v1/sessions/{id}/resume-thread` (auth)
 * - `GET /v1/usage` (auth)
 */
export function buildRouter(runtime: ServerRuntime): Router {
  const router = new Router()
  router.add('GET', '/health', () => healthJsonResponse())
  router.add('GET', '/api/v1/auth/setup-status', () => kworksAuthSetupStatus(runtime))
  router.add('POST', '/api/v1/auth/login/local', (request) => kworksAuthLogin(runtime, request))
  router.add('POST', '/api/v1/auth/register', (request) => kworksAuthRegister(runtime, request))
  router.add('POST', '/api/v1/auth/initialize', (request) => kworksAuthInitialize(runtime, request))
  router.add('GET', '/api/v1/auth/me', async (request) => {
    const actor = await authenticate(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksAuthMe(actor)
  })
  router.add('POST', '/api/v1/auth/logout', async (request) => {
    const actor = await authenticate(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksAuthLogout(runtime, request)
  })
  router.add('POST', '/api/v1/auth/change-password', async (request) => {
    const actor = await authenticate(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksAuthChangePassword(runtime, request, actor)
  })
  router.add('GET', '/api/models', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksModels(runtime, actor)
  })
  router.add('POST', '/api/models', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksCreateModel(runtime, request, actor)
  })
  router.add('PUT', '/api/models/:name', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksUpdateModel(runtime, ctx.params.name, request, actor)
  })
  router.add('POST', '/api/models/:name/activate', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksActivateModel(runtime, ctx.params.name, actor)
  })
  router.add('DELETE', '/api/models/:name', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksDeleteModel(runtime, ctx.params.name, actor)
  })
  router.add('GET', '/api/config', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    return kworksConfig(runtime, actor ?? undefined)
  })
  router.add('PUT', '/api/config', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksSaveConfig(runtime, request, actor)
  })
  router.add('GET', '/api/config/:section', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    return kworksConfigSection(runtime, ctx.params.section, actor ?? undefined)
  })
  router.add('PUT', '/api/config/:section', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksSaveConfigSection(runtime, ctx.params.section, request, actor)
  })
  router.add('GET', '/api/mcp/config', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksMcpConfig(runtime, actor)
  })
  router.add('PUT', '/api/mcp/config', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksMcpConfig(runtime, actor, request)
  })
  router.add('GET', '/api/skills', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksSkills(runtime, actor)
  })
  router.add('GET', '/api/work-modes', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksWorkModes(runtime, actor, request)
  })
  router.add('POST', '/api/work-modes', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksWorkModes(runtime, actor, request)
  })
  router.add('GET', '/api/work-modes/:modeId', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksWorkModes(runtime, actor, request, ctx.params.modeId)
  })
  router.add('PATCH', '/api/work-modes/:modeId', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksWorkModes(runtime, actor, request, ctx.params.modeId)
  })
  router.add('DELETE', '/api/work-modes/:modeId', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksWorkModes(runtime, actor, request, ctx.params.modeId)
  })
  router.add('GET', '/api/work-modes/:modeId/skills', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksModeSkills(runtime, actor, ctx.params.modeId)
  })
  router.add('PUT', '/api/work-modes/:modeId/skills/:skillId', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksWorkModes(runtime, actor, request, ctx.params.modeId, ctx.params.skillId)
  })
  router.add('DELETE', '/api/work-modes/:modeId/skills/:skillId', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksWorkModes(runtime, actor, request, ctx.params.modeId, ctx.params.skillId)
  })
  router.add('GET', '/api/coding/skills', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksCodingSkills(runtime, actor)
  })
  router.add('GET', '/api/coding/skills/:skillId', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksGetCodingSkill(runtime, actor, ctx.params.skillId)
  })
  router.add('PUT', '/api/coding/skills/:skillId/enabled', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksSetCodingSkillEnabled(runtime, actor, ctx.params.skillId, request)
  })
  router.add('GET', '/api/skills/drafts', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return listSkillDrafts(runtime)
  })
  router.add('POST', '/api/skills/drafts', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return createSkillDraft(runtime, actor, request)
  })
  router.add('POST', '/api/skills/drafts/:draftId/analyze', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return analyzeSkillDraft(runtime, actor, ctx.params.draftId)
  })
  router.add('POST', '/api/skills/drafts/:draftId/generate', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return generateSkillDraft(runtime, actor, ctx.params.draftId)
  })
  router.add('PATCH', '/api/skills/drafts/:draftId', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return updateSkillDraft(runtime, actor, ctx.params.draftId, request)
  })
  router.add('POST', '/api/skills/drafts/:draftId/install', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return installSkillDraft(runtime, actor, ctx.params.draftId, request)
  })
  router.add('PUT', '/api/skills/:name', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksSkills(runtime, actor, request, ctx.params.name)
  })
  router.add('GET', '/api/skills/:name', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksSkills(runtime, actor, request, ctx.params.name)
  })
  router.add('POST', '/api/skills/:name/register', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksSkills(runtime, actor, request, ctx.params.name)
  })
  router.add('POST', '/api/skills/:name/unregister', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksSkills(runtime, actor, request, ctx.params.name)
  })
  router.add('DELETE', '/api/skills/:name', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksSkills(runtime, actor, request, ctx.params.name)
  })
  router.add('POST', '/api/skills/create', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksCreateSkill(runtime, actor, request)
  })
  router.add('POST', '/api/skills/install', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksInstallSkill(runtime, actor, request)
  })
  router.add('GET', '/api/memory', () => kworksMemory())
  router.add('POST', '/api/memory', () => kworksMemory())
  router.add('DELETE', '/api/memory', () => kworksMemory())
  router.add('GET', '/api/memory/export', () => kworksMemory())
  router.add('POST', '/api/memory/import', () => kworksMemory())
  router.add('GET', '/api/memory/facts', () => kworksMemory())
  router.add('POST', '/api/memory/facts', () => kworksMemory())
  router.add('PATCH', '/api/memory/facts/:factId', () => kworksMemory())
  router.add('DELETE', '/api/memory/facts/:factId', () => kworksMemory())
  router.add('GET', '/api/agents', () => kworksEmptyList('agents'))
  router.add('GET', '/api/crons', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksListCrons(runtime, actor)
  })
  router.add('POST', '/api/crons/:name', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksCreateCron(runtime, actor, ctx.params.name, request)
  })
  router.add('PUT', '/api/crons/:name', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksUpdateCron(runtime, actor, ctx.params.name, request)
  })
  router.add('DELETE', '/api/crons/:name', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksDeleteCron(runtime, actor, ctx.params.name)
  })
  router.add('PUT', '/api/crons/:name/toggle', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksToggleCron(runtime, actor, ctx.params.name, request)
  })
  router.add('GET', '/api/channels/config', () => kworksChannelsConfig())
  router.add('PUT', '/api/channels/config', () => kworksChannelsConfig())
  router.add('POST', '/api/channels/:name/restart', () => jsonResponse({
    success: true,
    message: 'Channel restart is not required for the QiongQi runtime'
  }))
  router.add('GET', '/api/projects', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksListProjects(runtime, actor)
  })
  router.add('POST', '/api/projects', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksCreateProject(runtime, actor, request)
  })
  router.add('GET', '/api/projects/:id', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksGetProject(runtime, actor, ctx.params.id)
  })
  router.add('GET', '/api/projects/:id/files', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksListProjectFiles(runtime, actor, ctx.params.id, request)
  })
  router.add('GET', '/api/projects/:id/file', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksReadProjectFile(runtime, actor, ctx.params.id, request)
  })
  router.add('GET', '/api/projects/:id/worktrees', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksListProjectWorktrees(runtime, actor, ctx.params.id)
  })
  router.add('GET', '/api/projects/:id/diff', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksGetProjectDiff(runtime, actor, ctx.params.id)
  })
  router.add('POST', '/api/projects/:id/diff/discard', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksDiscardProjectFileChange(runtime, actor, ctx.params.id, request)
  })
  router.add('POST', '/api/projects/:id/git/commit', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksGitCommitProject(runtime, actor, ctx.params.id, request)
  })
  router.add('POST', '/api/projects/:id/git/push', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksGitPushProject(runtime, actor, ctx.params.id)
  })
  router.add('GET', '/api/projects/:id/environment', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksGetProjectEnvironment(runtime, actor, ctx.params.id)
  })
  router.add('DELETE', '/api/projects/:id', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksDeleteProject(runtime, actor, ctx.params.id)
  })
  router.add('GET', '/api/coding/delivery-stages', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksDeliveryStages()
  })
  router.add('GET', '/api/coding/stage', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksGetProjectStage(runtime, actor, request)
  })
  router.add('POST', '/api/coding/stage', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksSetProjectStage(runtime, actor, request)
  })
  router.add('POST', '/api/coding/stage/suggestion/accept', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksAcceptProjectStageSuggestion(runtime, actor, request)
  })
  router.add('POST', '/api/coding/stage/suggestion/dismiss', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksDismissProjectStageSuggestion(runtime, actor, request)
  })
  router.add('GET', '/api/coding/sessions/:threadId', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksGetCodingSession(runtime, ctx.params.threadId)
  })
  router.add('GET', '/api/coding/sessions/:threadId/events', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksListCodingSessionEvents(runtime, ctx.params.threadId)
  })
  router.add('GET', '/api/coding/sessions/:threadId/changes', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksListCodingSessionChanges(runtime, ctx.params.threadId)
  })
  router.add('GET', '/api/coding/sessions/:threadId/review', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksGetLatestCodingReview(runtime, ctx.params.threadId)
  })
  router.add('GET', '/api/coding/sessions/:threadId/roi/summary', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksGetCodingRoiSummary(runtime, ctx.params.threadId)
  })
  router.add('GET', '/api/coding/sessions/:threadId/roi', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksListCodingRoiReports(runtime, ctx.params.threadId)
  })
  router.add('POST', '/api/coding/reviews', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksRunCodingReview(runtime, actor, request)
  })
  router.add('POST', '/api/coding/reviews/fixes/apply', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksApplyCodingReviewFix(request)
  })
  router.add('POST', '/api/threads', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksCreateThread(runtime, request, actor)
  })
  router.add('POST', '/api/threads/search', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksSearchThreads(runtime, request, actor)
  })
  router.add('GET', '/api/threads/:id', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return kworksGetThread(runtime, ctx.params.id, actor)
  })
  router.add('DELETE', '/api/threads/:id', async (request, ctx) => {
    const denied = await denyUnlessThreadOwner(request, runtime, ctx.params.id)
    if (denied) return denied
    return kworksDeleteThread(runtime, ctx.params.id)
  })
  router.add('GET', '/api/threads/:id/state', async (request, ctx) => {
    const denied = await denyUnlessThreadOwner(request, runtime, ctx.params.id)
    if (denied) return denied
    return kworksGetThreadState(runtime, ctx.params.id)
  })
  router.add('POST', '/api/threads/:id/state', async (request, ctx) => {
    const denied = await denyUnlessThreadOwner(request, runtime, ctx.params.id)
    if (denied) return denied
    return kworksUpdateThreadState(runtime, ctx.params.id, request)
  })
  router.add('POST', '/api/threads/:id/history', async (request, ctx) => {
    const denied = await denyUnlessThreadOwner(request, runtime, ctx.params.id)
    if (denied) return denied
    return kworksGetThreadHistory(runtime, ctx.params.id)
  })
  router.add('POST', '/api/threads/:id/suggestions', async (request, ctx) => {
    const denied = await denyUnlessThreadOwner(request, runtime, ctx.params.id)
    if (denied) return denied
    return jsonResponse({ suggestions: [] })
  })
  router.add('POST', '/api/threads/:id/uploads', async (request, ctx) => {
    const denied = await denyUnlessThreadOwner(request, runtime, ctx.params.id)
    if (denied) return denied
    return uploadThreadFiles(runtime, ctx.params.id, request)
  })
  router.add('GET', '/api/threads/:id/uploads/list', async (request, ctx) => {
    const denied = await denyUnlessThreadOwner(request, runtime, ctx.params.id)
    if (denied) return denied
    return listThreadUploads(runtime, ctx.params.id)
  })
  router.add('DELETE', '/api/threads/:id/uploads/:filename', async (request, ctx) => {
    const denied = await denyUnlessThreadOwner(request, runtime, ctx.params.id)
    if (denied) return denied
    return deleteThreadUpload(runtime, ctx.params.id, ctx.params.filename)
  })
  router.add('GET', '/api/threads/:id/artifacts', async (request, ctx) => {
    const denied = await denyUnlessThreadOwner(request, runtime, ctx.params.id)
    if (denied) return denied
    return readThreadArtifact(runtime, ctx.params.id, request)
  })
  router.add('GET', '/api/threads/:id/artifacts/:mount', async (request, ctx) => {
    const denied = await denyUnlessThreadOwner(request, runtime, ctx.params.id)
    if (denied) return denied
    return readThreadArtifact(runtime, ctx.params.id, request)
  })
  router.add('GET', '/api/threads/:id/artifacts/:mount/:file', async (request, ctx) => {
    const denied = await denyUnlessThreadOwner(request, runtime, ctx.params.id)
    if (denied) return denied
    return readThreadArtifact(runtime, ctx.params.id, request)
  })
  router.add('GET', '/api/threads/:id/artifacts/:mount/:dir/:file', async (request, ctx) => {
    const denied = await denyUnlessThreadOwner(request, runtime, ctx.params.id)
    if (denied) return denied
    return readThreadArtifact(runtime, ctx.params.id, request)
  })
  router.add('GET', '/api/threads/:id/artifacts/:mount/:dir/:nested/:file', async (request, ctx) => {
    const denied = await denyUnlessThreadOwner(request, runtime, ctx.params.id)
    if (denied) return denied
    return readThreadArtifact(runtime, ctx.params.id, request)
  })
  router.add('GET', '/api/threads/:id/artifacts/:mount/:dir/:nested/:package/:file', async (request, ctx) => {
    const denied = await denyUnlessThreadOwner(request, runtime, ctx.params.id)
    if (denied) return denied
    return readThreadArtifact(runtime, ctx.params.id, request)
  })
  router.add('GET', '/api/threads/:id/artifacts/:mount/:dir/:nested/:package/:subdir/:file', async (request, ctx) => {
    const denied = await denyUnlessThreadOwner(request, runtime, ctx.params.id)
    if (denied) return denied
    return readThreadArtifact(runtime, ctx.params.id, request)
  })
  router.add('GET', '/api/threads/:id/runs', async (request, ctx) => {
    const denied = await denyUnlessThreadOwner(request, runtime, ctx.params.id)
    if (denied) return denied
    return kworksListRuns(ctx.params.id)
  })
  router.add('GET', '/api/threads/:id/runs/:runId', async (request, ctx) => {
    const denied = await denyUnlessThreadOwner(request, runtime, ctx.params.id)
    if (denied) return denied
    return kworksGetRun(ctx.params.id, ctx.params.runId)
  })
  router.add('PUT', '/api/threads/:id/runs/:runId/feedback', async (request, ctx) => {
    const denied = await denyUnlessThreadOwner(request, runtime, ctx.params.id)
    if (denied) return denied
    const body = await request.json().catch(() => ({})) as {
      rating?: unknown
      comment?: unknown
    }
    return jsonResponse({
      feedback_id: `${ctx.params.id}:${ctx.params.runId}`,
      rating: typeof body.rating === 'number' ? body.rating : 0,
      comment: typeof body.comment === 'string' ? body.comment : null
    })
  })
  router.add('DELETE', '/api/threads/:id/runs/:runId/feedback', async (request, ctx) => {
    const denied = await denyUnlessThreadOwner(request, runtime, ctx.params.id)
    if (denied) return denied
    return jsonResponse({ success: true })
  })
  router.add('POST', '/api/threads/:id/runs/stream', async (request, ctx) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    if (!(await ownsThread(runtime, ctx.params.id, actor))) return ERRORS.notFound(`thread not found: ${ctx.params.id}`)
    return kworksRunStream(runtime, ctx.params.id, request, actor)
  })
  router.add('POST', '/api/threads/:id/runs/:runId/cancel', async (request, ctx) => {
    const denied = await denyUnlessThreadOwner(request, runtime, ctx.params.id)
    if (denied) return denied
    return kworksCancelRun(runtime, ctx.params.id, ctx.params.runId)
  })
  router.add('GET', '/api/threads/:id/runs/:runId/stream', async (request, ctx) => {
    const denied = await denyUnlessThreadOwner(request, runtime, ctx.params.id)
    if (denied) return denied
    return kworksExistingRunStream(runtime, ctx.params.id, ctx.params.runId, request)
  })
  router.add('POST', '/api/threads/:id/runs/:runId/stream', async (request, ctx) => {
    const denied = await denyUnlessThreadOwner(request, runtime, ctx.params.id)
    if (denied) return denied
    return kworksExistingRunStream(runtime, ctx.params.id, ctx.params.runId, request)
  })
  router.add('GET', '/ready', () => readinessJsonResponse(runtime))
  // Stage 2: A2A discovery — public, unauthenticated by RFC 8615 convention.
  router.add('GET', '/.well-known/agent-card.json', () => agentCardJsonResponse(runtime))
  // Stage 4: A2A task submission with status tracking.
  router.add('POST', '/a2a/tasks', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    if (!runtime.a2aTaskStore) return ERRORS.unavailable('A2A task store not configured')
    return a2aCreateTask(runtime, runtime.a2aTaskStore, request)
  })
  // Stage 4: query A2A task by id.
  router.add('GET', '/a2a/tasks/:id', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    if (!runtime.a2aTaskStore) return ERRORS.unavailable('A2A task store not configured')
    return a2aGetTask(runtime.a2aTaskStore, ctx.params.id)
  })
  // Stage 4: cancel a task.
  router.add('POST', '/a2a/tasks/:id/cancel', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    if (!runtime.a2aTaskStore) return ERRORS.unavailable('A2A task store not configured')
    return a2aCancelTask(runtime, runtime.a2aTaskStore, ctx.params.id)
  })
  // Stage 4: retrieve task artifacts (turn items).
  router.add('GET', '/a2a/tasks/:id/artifacts', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    if (!runtime.a2aTaskStore) return ERRORS.unavailable('A2A task store not configured')
    return a2aGetArtifacts(runtime, runtime.a2aTaskStore, ctx.params.id)
  })
  // Stage 4: SSE subscribe to task progress.
  router.add('GET', '/a2a/tasks/:id/subscribe', (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    if (!runtime.a2aTaskStore) return ERRORS.unavailable('A2A task store not configured')
    return a2aSubscribeTask(runtime, runtime.a2aTaskStore, ctx.params.id, request)
  })
  // Backward-compatible endpoint (Stage 2).
  router.add('POST', '/a2a', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    if (!runtime.a2aTaskStore) return ERRORS.unavailable('A2A task store not configured')
    return a2aCreateTaskSync(runtime, runtime.a2aTaskStore, request)
  })
  router.add('GET', '/v1/runtime/info', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    await syncRuntimeToolsForActor(runtime, actor)
    return runtimeInfoJsonResponse(runtime)
  })
  router.add('GET', '/v1/runtime/tools', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    await syncRuntimeToolsForActor(runtime, actor)
    return runtimeToolDiagnosticsJsonResponse(runtime)
  })
  router.add('GET', '/v1/runtime/metrics', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return runtimeMetricsResponse(request, runtime)
  })
  router.add('GET', '/v1/skills', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return listSkills(runtime)
  })
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
  router.add('GET', '/v1/threads/:id/artifacts', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return listThreadArtifacts(runtime, ctx.params.id)
  })
  router.add('GET', '/v1/threads/:id/artifacts/content', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return readThreadArtifact(runtime, ctx.params.id, request)
  })
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
  router.add('GET', '/v1/workspace/status', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const url = new URL(request.url)
    const path = url.searchParams.get('path')
    return buildWorkspaceStatusResponse({ inspector: runtime.workspaceInspector, path })
  })
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
    await syncRuntimeToolsForActor(runtime, actor)
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
  router.add('GET', '/v1/usage', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return usageJsonResponse(request, runtime, actorOwner(actor) ? actor : undefined)
  })
  router.add('GET', '/api/usage', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    return usageJsonResponse(request, runtime, actorOwner(actor) ? actor : undefined, { defaultWindow: 'month' })
  })
  // Finance credential status — checks whether the two data-source API keys
  // required by the finance work mode's KSkills packages are present. Read-only,
  // no secrets are returned.
  router.add('GET', '/api/finance/credentials/status', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    const resolved = await loadFinanceDataSource(runtime.kworksUserDataStore, actorOwner(actor))
    return jsonResponse(resolved.status)
  })
  router.add('GET', '/api/finance/credentials', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    const resolved = await loadFinanceDataSource(runtime.kworksUserDataStore, actorOwner(actor))
    return jsonResponse(resolved.status)
  })
  router.add('PUT', '/api/finance/credentials', async (request) => {
    const actor = await authenticateOrInternal(request, runtime)
    if (!actor) return ERRORS.unauthorized()
    const owner = actorOwner(actor)
    if (!owner || !runtime.kworksUserDataStore) return ERRORS.unavailable('finance credential storage is unavailable')
    const body = await readJsonBody(request)
    if (!body.ok) return body.response
    if (!isObject(body.value)) return ERRORS.validation('finance credentials body must be an object')

    const current = await loadFinanceDataSource(runtime.kworksUserDataStore, owner)
    const rawSecrets = await runtime.kworksUserDataStore.getUserSetting(owner, FINANCE_CREDENTIALS_SECRET_KEY)
    const secrets: FinanceCredentialSecrets = isObject(rawSecrets) ? {
      ...(typeof rawSecrets.tushareToken === 'string' ? { tushareToken: rawSecrets.tushareToken } : {}),
      ...(typeof rawSecrets.iwencaiApiKey === 'string' ? { iwencaiApiKey: rawSecrets.iwencaiApiKey } : {})
    } : {}
    for (const [field, key] of [['tushareToken', 'tushareToken'], ['iwencaiApiKey', 'iwencaiApiKey']] as const) {
      if (!(field in body.value)) continue
      const value = body.value[field]
      if (value === null || value === '') delete secrets[key]
      else if (typeof value === 'string') secrets[key] = value.trim()
      else return ERRORS.validation(`${field} must be a string or null`)
    }
    const rawConfig = await runtime.kworksUserDataStore.getUserSetting(owner, FINANCE_DATA_SOURCE_CONFIG_KEY)
    const storedConfig = isObject(rawConfig) ? rawConfig : {}
    const config: FinanceDataSourceConfig = {
      apiBaseUrl: stringValue(body.value.apiBaseUrl) ?? stringValue(storedConfig.apiBaseUrl) ?? current.config.apiBaseUrl,
      queryEndpoint: stringValue(body.value.queryEndpoint) ?? stringValue(storedConfig.queryEndpoint) ?? current.config.queryEndpoint,
      comprehensiveEndpoint: stringValue(body.value.comprehensiveEndpoint) ?? stringValue(storedConfig.comprehensiveEndpoint) ?? current.config.comprehensiveEndpoint,
      webUrl: stringValue(body.value.webUrl) ?? stringValue(storedConfig.webUrl) ?? current.config.webUrl
    }
    await saveFinanceDataSource(runtime.kworksUserDataStore, owner, { secrets, config })
    const resolved = await loadFinanceDataSource(runtime.kworksUserDataStore, owner)
    return jsonResponse(resolved.status)
  })
  return router
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function authorize(request: Request, runtime: ServerRuntime): boolean {
  if (isAuthorized(request.headers, runtime.runtimeToken, runtime.insecure)) return true
  return false
}

async function authenticate(request: Request, runtime: ServerRuntime): Promise<AuthActor | null> {
  if (runtime.insecure && !runtime.authService) {
    return {
      userId: 'insecure-local-user',
      role: 'admin',
      sessionId: 'insecure',
      user: {
        id: 'insecure-local-user',
        email: 'local@kworks.invalid',
        username: 'local@kworks.invalid',
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
  if (owner && runtime.kworksUserDataStore) {
    const userModels = await runtime.kworksUserDataStore.listModelProfiles(owner)
    if (userModels.activeModel && userModels.profiles[userModels.activeModel]) {
      return userModels.activeModel
    }
  }
  return runtime.info().model ?? 'default'
}

async function denyUnlessThreadOwner(request: Request, runtime: ServerRuntime, threadId: string): Promise<ReturnType<typeof ERRORS.unauthorized> | ReturnType<typeof ERRORS.notFound> | null> {
  const actor = await authenticateOrInternal(request, runtime)
  if (!actor) return ERRORS.unauthorized()
  if (!(await ownsThread(runtime, threadId, actor))) return ERRORS.notFound(`thread not found: ${threadId}`)
  return null
}

void bearerToken
