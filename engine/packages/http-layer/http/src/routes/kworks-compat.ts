import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { jsonResponse, type JsonResponse } from '../response.js'
import { readJsonBody } from '../read-json-body.js'
import { encodeSseEvent } from '../sse.js'
import type { ServerRuntime } from './server-runtime.js'
import { defaultThreadWorkspace } from './default-workspace.js'
import {
  DEFAULT_QIONGQI_CAPABILITIES_CONFIG,
  QiongqiConfigSchema,
  type McpServerConfig,
  type QiongqiConfig,
  type RuntimeEvent,
  type ThreadRecord,
  type ThreadSummary,
  type TurnItem,
  DEFAULT_WORK_MODES
} from '@qiongqi/contracts'
import {
  DEFAULT_LOCKED_SKILL_IDS,
  assertSkillCanBeDisabled,
  resolveEffectiveSkillIds,
  resolveWorkModeDefaultSkillIds
} from '@qiongqi/skills'
import { bearerToken } from '../auth.js'
import { AuthError, authSessionBody, type AuthActor, type AuthSession } from '../auth-service.js'
import { deriveThreadTitle, isDefaultThreadTitle } from '@qiongqi/domain'
import {
  inferModelCapabilityDefaults
} from '@qiongqi/loop'
import { compatibilityProfileForModel } from '@qiongqi/adapter-model'

const execFileAsync = promisify(execFile)

type RunRecord = {
  run_id: string
  thread_id: string
  assistant_id?: string | null
  status: 'pending' | 'running' | 'success' | 'error' | 'interrupted'
  created_at: string
  updated_at: string
  metadata: Record<string, unknown>
  kwargs: Record<string, unknown>
  turn_id?: string
  error?: string
}

const runs = new Map<string, RunRecord>()
const runsByThread = new Map<string, string[]>()
const USER_SETTING_CRONS = 'automations.crons'
const USER_SETTING_MCP = 'capabilities.mcp'
const USER_SETTING_MCP_COMPAT = 'capabilities.mcp.compat'
const USER_SETTING_SKILLS = 'capabilities.skills'
const USER_SETTING_SKILLS_COMPAT = 'capabilities.skills.compat'
const USER_SETTING_WEB = 'capabilities.web'
const USER_SETTING_PROJECTS = 'coding.projects'
const READ_ONLY_WORK_MODE_SKILLS_DETAIL = 'Work mode skills are read-only'
const codingReviewsByThread = new Map<string, CodingReview>()

type KWorksCronJobConfig = {
  enabled: boolean
  cron: string
  description: string
  agent: string
  model: string | null
  prompt: string
}

type KWorksCronSnapshot = {
  version: 1
  users: Record<string, Record<string, KWorksCronJobConfig>>
}

type KWorksProject = {
  id: string
  name: string
  path: string
  description: string
  config: Record<string, unknown>
  is_git_repo: boolean
  created_at: string
  updated_at: string
}

type KWorksProjectSnapshot = {
  version: 1
  users: Record<string, KWorksProject[]>
}

type StageSource = 'user' | 'agent_suggested' | 'agent_accepted'

type StageHistoryEntry = {
  from_stage_id: string | null
  to_stage_id: string
  reason: string
  source: StageSource
  timestamp: string
  thread_id?: string | null
  run_outcome?: string | null
}

type StageSuggestion = {
  stage_id: string
  reason: string
  suggested_by_thread_id: string
  timestamp: string
}

type ProjectStageState = {
  project_root: string
  current_stage: string | null
  stage_history: StageHistoryEntry[]
  pending_suggestion: StageSuggestion | null
  updated_at: string | null
}

type ProjectStageSnapshot = {
  version: 1
  users: Record<string, Record<string, ProjectStageState>>
}

type CodingReviewFinding = {
  id: string
  severity: 'critical' | 'major' | 'minor' | 'nitpick'
  category: string
  file: string | null
  line: number | null
  task_id: string | null
  message: string
  suggestion: string
  evidence: string[]
  fix: {
    applicable: boolean
    kind: string | null
    description: string
    patch: string
    applied: boolean
    applied_at?: string
  }
}

type CodingReview = {
  review_id: string
  project_id: string
  project_root: string
  thread_id: string
  scope: string
  decision: string
  summary: {
    project_files: number
    task_changes: number
    qiongqi_events: number
    commits: number
    additions: number
    deletions: number
    critical: number
    major: number
    minor: number
    nitpick: number
  }
  findings: CodingReviewFinding[]
  source: Record<string, unknown>
  created_at: string
  next_plan: string[]
}

const CODING_DELIVERY_STAGES = [
  {
    id: 'requirements',
    title: 'Requirements',
    goal: 'Clarify the user goal, acceptance criteria, constraints, and the project context before coding.',
    recommended_skills: ['requirements-analysis', 'product-spec', 'acceptance-criteria', 'codebase-analysis'],
    suggested_prompt: 'Clarify requirements, acceptance criteria, risks, and the relevant code paths before planning changes.',
    next_stage_id: 'planning'
  },
  {
    id: 'planning',
    title: 'Planning',
    goal: 'Break the work into executable steps, tests, and rollback notes.',
    recommended_skills: ['planning', 'technical-design', 'task-decomposition', 'using-git-worktrees'],
    suggested_prompt: 'Create a concise implementation plan with files to touch, tests to run, and risks.',
    next_stage_id: 'implementation'
  },
  {
    id: 'implementation',
    title: 'Implementation',
    goal: 'Apply focused code changes with the project workspace and coding skills active.',
    recommended_skills: ['implement', 'tdd', 'debugging', 'frontend-engineering', 'api-design'],
    suggested_prompt: 'Implement the planned change, keep edits scoped, and update tests alongside the code.',
    next_stage_id: 'review'
  },
  {
    id: 'review',
    title: 'Review',
    goal: 'Inspect changes for regressions, missing tests, security issues, and UX breakage.',
    recommended_skills: ['code-review', 'security-review', 'verification-before-completion', 'playwright-verification'],
    suggested_prompt: 'Review the current diff, identify issues by severity, and run the verification commands.',
    next_stage_id: 'delivery'
  },
  {
    id: 'delivery',
    title: 'Delivery',
    goal: 'Summarize outcomes, verification evidence, residual risks, and handoff notes.',
    recommended_skills: ['release-engineering', 'handoff-docs', 'rollback-recovery'],
    suggested_prompt: 'Prepare the final handoff with changes made, verification, and any follow-up risks.',
    next_stage_id: null
  }
] satisfies Array<{
  id: string
  title: string
  goal: string
  recommended_skills: string[]
  suggested_prompt: string
  next_stage_id: string | null
}>

type ProjectFileEntry = {
  name: string
  path: string
  type: 'directory' | 'file'
  size: number
  ext: string
}

type ProjectDiffFile = {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied'
  additions: number
  deletions: number
  previous_path?: string | null
  diff?: string
}

export async function kworksModels(runtime: ServerRuntime, actor?: AuthActor): Promise<JsonResponse> {
  const config = await readEffectiveRuntimeConfig(runtime, actor)
  return jsonResponse({
    models: modelsFromConfig(config).map(redactModelForResponse),
    token_usage: { enabled: false }
  })
}

export async function kworksCreateModel(runtime: ServerRuntime, request: Request, actor?: AuthActor): Promise<JsonResponse | Response> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  if (!isObject(body.value)) return jsonResponse({ detail: 'model request body must be an object' }, 400)
  const result = await upsertModelProfile(runtime, body.value, actor)
  if (!result.ok) return result.response
  return jsonResponse(redactModelForResponse(result.model), 201)
}

export async function kworksUpdateModel(runtime: ServerRuntime, name: string, request: Request, actor?: AuthActor): Promise<JsonResponse | Response> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  if (!isObject(body.value)) return jsonResponse({ detail: 'model request body must be an object' }, 400)
  const result = await upsertModelProfile(runtime, { ...body.value, name }, actor)
  if (!result.ok) return result.response
  return jsonResponse(redactModelForResponse(result.model))
}

export async function kworksDeleteModel(runtime: ServerRuntime, name: string, actor?: AuthActor): Promise<JsonResponse> {
  const owner = ownerUserId(actor)
  if (actor && owner && runtime.kworksUserDataStore) {
    await runtime.kworksUserDataStore.deleteModelProfile(owner, name)
    return jsonResponse({ success: true })
  }
  const config = await readRuntimeConfig(runtime)
  const profiles = { ...(config.models?.profiles ?? {}) }
  delete profiles[name]
  await writeRuntimeConfig(runtime, {
    ...config,
    models: { ...(config.models ?? {}), profiles }
  })
  return jsonResponse({ success: true })
}

export async function kworksActivateModel(runtime: ServerRuntime, name: string, actor?: AuthActor): Promise<JsonResponse | Response> {
  const owner = ownerUserId(actor)
  if (actor && owner && runtime.kworksUserDataStore) {
    const config = await ensureUserModelProfile(runtime, actor, name)
    if (!config.models?.profiles?.[name]) return jsonResponse({ detail: `model profile ${name} not found` }, 404)
    await runtime.kworksUserDataStore.activateModelProfile(owner, name)
    const saved = await readEffectiveRuntimeConfig(runtime, actor)
    return jsonResponse({
      model: name,
      active: saved.serve?.model === name,
      serve: redactValueForResponse(saved.serve ?? {})
    })
  }
  const config = await readRuntimeConfig(runtime)
  const profile = config.models?.profiles?.[name]
  if (!profile) return jsonResponse({ detail: `model profile ${name} not found` }, 404)
  const profileApiKey = typeof profile.apiKey === 'string' && !isRedactedSecret(profile.apiKey) ? profile.apiKey : undefined
  const next = {
    ...config,
    serve: {
      ...(config.serve ?? {}),
      model: name,
      ...(profile.baseUrl ? { baseUrl: profile.baseUrl } : {}),
      ...(profileApiKey !== undefined ? { apiKey: profileApiKey } : {}),
      ...(profile.endpointFormat ? { endpointFormat: profile.endpointFormat } : {})
    }
  }
  const parsed = parseQiongqiConfig(next)
  if (!parsed.ok) return parsed.response
  const saved = await writeRuntimeConfig(runtime, parsed.config)
  return jsonResponse({
    model: name,
    active: saved.serve?.model === name,
    serve: redactValueForResponse(saved.serve ?? {})
  })
}

export async function kworksAuthSetupStatus(runtime: ServerRuntime): Promise<JsonResponse> {
  const status = await runtime.authService?.setupStatus()
  return jsonResponse(status ?? {
    initialized: false,
    has_admin: false,
    needs_setup: true,
    local_auth_enabled: true,
    registration_enabled: false
  })
}

export async function kworksAuthLogin(runtime: ServerRuntime, request: Request): Promise<JsonResponse | Response> {
  if (!runtime.authService) return jsonResponse({ detail: 'auth service is not configured' }, 503)
  const body = await readAuthRequestBody(request)
  if (!body.ok) return body.response
  if (!isObject(body.value)) return jsonResponse({ detail: 'auth request body must be an object' }, 400)
  try {
    const email = stringValue(body.value.email) ?? stringValue(body.value.username) ?? ''
    const password = stringValue(body.value.password) ?? ''
    return authSessionResponse(await runtime.authService.login({ email, password }))
  } catch (error) {
    return authErrorResponse(error)
  }
}

export async function kworksAuthRegister(runtime: ServerRuntime, request: Request): Promise<JsonResponse | Response> {
  if (!runtime.authService) return jsonResponse({ detail: 'auth service is not configured' }, 503)
  const body = await readAuthRequestBody(request)
  if (!body.ok) return body.response
  if (!isObject(body.value)) return jsonResponse({ detail: 'auth request body must be an object' }, 400)
  try {
    const email = stringValue(body.value.email) ?? stringValue(body.value.username) ?? ''
    const password = stringValue(body.value.password) ?? ''
    return authSessionResponse(await runtime.authService.register({ email, password }))
  } catch (error) {
    return authErrorResponse(error)
  }
}

export async function kworksAuthInitialize(runtime: ServerRuntime, request: Request): Promise<JsonResponse | Response> {
  if (!runtime.authService) return jsonResponse({ detail: 'auth service is not configured' }, 503)
  const body = await readAuthRequestBody(request)
  if (!body.ok) return body.response
  if (!isObject(body.value)) return jsonResponse({ detail: 'auth request body must be an object' }, 400)
  try {
    const email = stringValue(body.value.email) ?? stringValue(body.value.username) ?? ''
    const password = stringValue(body.value.password) ?? ''
    return authSessionResponse(await runtime.authService.initialize({ email, password }))
  } catch (error) {
    return authErrorResponse(error)
  }
}

export async function kworksAuthMe(actor: AuthActor): Promise<JsonResponse> {
  return jsonResponse(actor.user)
}

export async function kworksAuthLogout(runtime: ServerRuntime, request: Request): Promise<JsonResponse> {
  await runtime.authService?.logout(bearerToken(request.headers))
  // Clear the auth cookies on logout (Web mode).
  return {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'set-cookie': [
        clearAuthCookie('access_token'),
        clearAuthCookie('csrf_token')
      ]
    },
    body: JSON.stringify({ success: true })
  }
}

/**
 * Build a JsonResponse for a successful auth session, setting both the
 * HttpOnly ``access_token`` cookie (for browser/SSR requests) and the
 * JS-readable ``csrf_token`` cookie (for the Double Submit Cookie pattern
 * enforced by the frontend's fetcher wrapper).
 *
 * The desktop Electron client ignores these cookies and reads the token
 * from the JSON body via ``data.access_token`` — both transport paths
 * are served by the same response.
 */
function authSessionResponse(session: AuthSession): JsonResponse {
  const body = authSessionBody(session)
  const maxAge = Math.floor(session.expiresIn)
  return {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'set-cookie': [
        bakeAuthCookie('access_token', session.accessToken, { httpOnly: true, maxAge }),
        bakeAuthCookie('csrf_token', session.accessToken, { httpOnly: false, maxAge })
      ]
    },
    body: JSON.stringify(body)
  }
}

/** Serialize a Set-Cookie value with sane defaults for the auth cookies. */
function bakeAuthCookie(name: string, value: string, opts: { httpOnly: boolean; maxAge: number }): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${opts.maxAge}`,
    'SameSite=Lax',
    'Secure=false'
  ]
  if (opts.httpOnly) parts.push('HttpOnly')
  return parts.join('; ')
}

/** Serialize a Set-Cookie value that immediately expires the cookie. */
function clearAuthCookie(name: string): string {
  return `${name}=; Path=/; Max-Age=0; SameSite=Lax; Secure=false`
}

export async function kworksAuthChangePassword(runtime: ServerRuntime, request: Request, actor: AuthActor): Promise<JsonResponse | Response> {
  if (!runtime.authService) return jsonResponse({ detail: 'auth service is not configured' }, 503)
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  if (!isObject(body.value)) return jsonResponse({ detail: 'auth request body must be an object' }, 400)
  try {
    const currentPassword =
      stringValue(body.value.current_password) ??
      stringValue(body.value.currentPassword) ??
      stringValue(body.value.old_password) ??
      ''
    const newPassword =
      stringValue(body.value.new_password) ??
      stringValue(body.value.newPassword) ??
      stringValue(body.value.password) ??
      ''
    return jsonResponse(authSessionBody(await runtime.authService.changePassword({
      actor,
      currentPassword,
      newPassword
    })))
  } catch (error) {
    return authErrorResponse(error)
  }
}

export async function kworksConfig(runtime: ServerRuntime, actor?: AuthActor): Promise<JsonResponse> {
  return jsonResponse({ config: redactConfigForResponse(await readEffectiveRuntimeConfig(runtime, actor)) })
}

export async function kworksConfigSection(runtime: ServerRuntime, section: string, actor?: AuthActor): Promise<JsonResponse> {
  if (isUnsupportedKWorksConfigSection(section)) {
    return jsonResponse({ detail: `${section} is not a KWorks configurable runtime section` }, 404)
  }
  const config = await readEffectiveRuntimeConfig(runtime, actor)
  return jsonResponse({ section, data: redactValueForResponse(sectionValue(config, section)) })
}

export async function kworksSaveConfig(runtime: ServerRuntime, request: Request, actor?: AuthActor): Promise<JsonResponse | Response> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const config = isObject(body.value) && isObject(body.value.config) ? body.value.config : {}
  const current = await readEffectiveRuntimeConfig(runtime, actor)
  const parsed = parseQiongqiConfig(normalizeConfigForWrite(restoreRedactedSecrets(config, current)))
  if (!parsed.ok) return parsed.response
  const userSaved = await writeUserScopedModelConfig(runtime, parsed.config, actor)
  if (userSaved) {
    const capabilitySaved = await writeUserScopedCapabilityConfig(runtime, parsed.config, actor)
    if (!capabilitySaved.ok) return capabilitySaved.response
    if (capabilitySaved.saved) await syncRuntimeToolsForActor(runtime, actor)
    return jsonResponse({ config: redactConfigForResponse(await readEffectiveRuntimeConfig(runtime, actor)) })
  }
  const saved = await writeRuntimeConfig(runtime, parsed.config)
  await writeUserScopedCapabilityConfig(runtime, saved, actor)
  return jsonResponse({ config: redactConfigForResponse(saved) })
}

export async function kworksSaveConfigSection(runtime: ServerRuntime, section: string, request: Request, actor?: AuthActor): Promise<JsonResponse | Response> {
  if (isUnsupportedKWorksConfigSection(section)) {
    return jsonResponse({ detail: `${section} is not a KWorks configurable runtime section` }, 404)
  }
  if (isBuiltInAttachmentsSection(section)) {
    return jsonResponse({ detail: 'attachments are a built-in product capability and are not user-configurable' }, 403)
  }
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const data = isObject(body.value) && 'data' in body.value ? body.value.data : body.value
  const current = usesRuntimeSectionWrite(section)
    ? await readUserScopedCapabilityConfig(runtime, await readRuntimeConfig(runtime), actor)
    : await readEffectiveRuntimeConfig(runtime, actor)
  const next = withSectionValue(current, section, data)
  const parsed = parseQiongqiConfig(normalizeConfigForWrite(restoreRedactedSecrets(next, current)))
  if (!parsed.ok) return parsed.response
  const userSaved = await writeUserScopedModelConfig(runtime, parsed.config, actor, section)
  if (userSaved) {
    const effective = await readEffectiveRuntimeConfig(runtime, actor)
    return jsonResponse({ section, data: redactValueForResponse(sectionValue(effective, section)) })
  }
  const capabilitySaved = await writeUserScopedCapabilityConfig(runtime, parsed.config, actor, section)
  if (!capabilitySaved.ok) return capabilitySaved.response
  const saved = await writeRuntimeConfig(runtime, parsed.config)
  if (section === 'mcp' || section === 'mcp_servers' || section === 'web' || section === 'capabilities') {
    await refreshRuntimeTools(runtime)
  }
  return jsonResponse({ section, data: redactValueForResponse(sectionValue(saved, section)) })
}

export async function kworksMcpConfig(runtime: ServerRuntime, actor: AuthActor, request?: Request): Promise<JsonResponse | Response> {
  const owner = ownerUserId(actor)
  if (request?.method === 'PUT') {
    const body = await readJsonBody(request)
    if (!body.ok) return body.response
    const compat = normalizeMcpConfig(body.value)
    const synced = await syncMcpCompatToRuntimeConfig(runtime, compat)
    if (!synced.ok) return synced.response
    await refreshRuntimeTools(runtime)
    if (owner && runtime.kworksUserDataStore) {
      await runtime.kworksUserDataStore.setUserSetting(owner, USER_SETTING_MCP_COMPAT, compat)
      await runtime.kworksUserDataStore.setUserSetting(owner, USER_SETTING_MCP, synced.config.capabilities?.mcp)
      await runtime.kworksUserDataStore.setUserSetting(owner, USER_SETTING_SKILLS_COMPAT, compat.skills)
      await runtime.kworksUserDataStore.setUserSetting(owner, USER_SETTING_SKILLS, synced.config.capabilities?.skills)
      return jsonResponse(mcpCompatResponse(compat))
    }
    return jsonResponse(mcpCompatResponse(mcpCompatFromConfig(synced.config)))
  }
  if (owner && runtime.kworksUserDataStore) {
    const savedMcp = normalizeMcpConfig(await runtime.kworksUserDataStore.getUserSetting(owner, USER_SETTING_MCP_COMPAT))
    const savedSkills = normalizeSkillCompat(await runtime.kworksUserDataStore.getUserSetting(owner, USER_SETTING_SKILLS_COMPAT))
    return jsonResponse(mcpCompatResponse({ ...savedMcp, skills: savedSkills }))
  }
  return jsonResponse(mcpCompatResponse(mcpCompatFromConfig(await readRuntimeConfig(runtime))))
}

async function syncMcpCompatToRuntimeConfig(
  runtime: ServerRuntime,
  compat: { mcp_servers: Record<string, Record<string, unknown>>; skills?: SkillCompatConfig }
): Promise<{ ok: true; config: QiongqiConfig } | { ok: false; response: JsonResponse }> {
  const current = await readRuntimeConfig(runtime)
  const nextMcp = mcpCapabilityFromCompat(
    compat,
    current.capabilities?.mcp ?? { ...DEFAULT_QIONGQI_CAPABILITIES_CONFIG.mcp, enabled: false }
  )
  const nextSkills = skillsCapabilityFromCompat(
    compat.skills,
    current.capabilities?.skills ?? DEFAULT_QIONGQI_CAPABILITIES_CONFIG.skills
  )
  const parsed = parseQiongqiConfig({
    ...current,
    capabilities: {
      ...(current.capabilities ?? {}),
      mcp: nextMcp,
      skills: nextSkills
    }
  })
  if (!parsed.ok) return parsed
  return { ok: true, config: await writeRuntimeConfig(runtime, parsed.config) }
}

export async function kworksSkills(runtime: ServerRuntime, actor?: AuthActor, request?: Request, name?: string): Promise<JsonResponse | Response> {
  const owner = ownerUserId(actor)
  const skillState = owner && runtime.kworksUserDataStore
    ? normalizeSkillCompat(await runtime.kworksUserDataStore.getUserSetting(owner, USER_SETTING_SKILLS_COMPAT))
    : {}
  if (request?.method === 'GET' && name) {
    const skills = await kworksSkillEntries(runtime, skillState)
    const skill = skills.find((item) => item.id === name) ?? skillEntryFromCompatOnly(name, skillState[name])
    return jsonResponse({ skill })
  }
  if (request?.method === 'POST' && name) {
    const action = skillActionFromUrl(request.url)
    if (action === 'register') return setSkillEnabledForActor(runtime, owner, name, true, skillState)
    if (action === 'unregister') return setSkillEnabledForActor(runtime, owner, name, false, skillState)
  }
  if (request?.method === 'DELETE' && name) {
    if (await isLockedSkill(runtime, name, actor)) return jsonResponse({ detail: `Skill ${name} is required by all work modes` }, 403)
    const skills = await kworksSkillEntries(runtime, skillState)
    const skill = skills.find((item) => item.id === name)
    if (!skill) return jsonResponse({ detail: `Skill ${name} not found` }, 404)
    if (skill.deletable !== true) return jsonResponse({ detail: `Skill ${name} is not deletable` }, 403)
    const root = stringValue(skill.root)
    if (!root || !isDeletableSkillRoot(root)) return jsonResponse({ detail: `Skill ${name} is not in a user-writable skill root` }, 403)
    await rm(root, { recursive: true, force: true })
    return setSkillEnabledForActor(runtime, owner, name, false, skillState, { status: 'deleted', registered: false })
  }
  if (request?.method === 'PUT' && name) {
    const body = await readJsonBody(request)
    if (!body.ok) return body.response
    const enabled = isObject(body.value) ? booleanValue(body.value.enabled) : undefined
    if (enabled === undefined) return jsonResponse({ detail: 'enabled must be a boolean' }, 400)
    return setSkillEnabledForActor(runtime, owner, name, enabled, skillState)
  }

  return jsonResponse({ skills: await kworksSkillEntries(runtime, skillState) })
}

export async function kworksWorkModes(
  runtime: ServerRuntime,
  actor?: AuthActor,
  request?: Request,
  modeId?: string,
  skillId?: string
): Promise<JsonResponse | Response> {
  const config = await readEffectiveRuntimeConfig(runtime, actor)
  const skillsConfig = config.capabilities?.skills ?? DEFAULT_QIONGQI_CAPABILITIES_CONFIG.skills
  const owner = ownerUserId(actor)
  const skillState = skillCompatFromCapability(skillsConfig)
  if (request?.method === 'POST' && !modeId && !skillId) {
    const body = await readJsonBody(request)
    if (!body.ok) return body.response
    const parsed = parseWorkModeRequestBody(body.value, { requireName: true, requireId: true, requireDescription: true })
    if (!parsed.ok) return parsed.response
    if (skillsConfig.workModes.modes[parsed.mode.id]) {
      return jsonResponse({ detail: `Work mode ${parsed.mode.id} already exists` }, 409)
    }
    const nextSkills = {
      ...skillsConfig,
      workModes: {
        ...skillsConfig.workModes,
        modes: {
          ...skillsConfig.workModes.modes,
          [parsed.mode.id]: parsed.mode
        }
      },
      modeSkillOverrides: {
        ...skillsConfig.modeSkillOverrides,
        [parsed.mode.id]: {
          addedSkillIds: [],
          removedSkillIds: []
        }
      }
    }
    const synced = await syncSkillsCapabilityToRuntimeConfig(runtime, owner, nextSkills)
    if (!synced.ok) return synced.response
    await refreshRuntimeTools(runtime)
    return jsonResponse({
      workMode: await workModeResponse(runtime, synced.config.capabilities?.skills ?? nextSkills, skillCompatFromCapability(synced.config.capabilities?.skills ?? nextSkills), parsed.mode.id)
    }, 201)
  }

  if (request?.method === 'PATCH' && modeId && !skillId) {
    const existing = skillsConfig.workModes.modes[modeId]
    if (!existing) return jsonResponse({ detail: `Work mode ${modeId} not found` }, 404)
    if (existing.builtin || existing.editable === false) {
      return jsonResponse({ detail: `Work mode ${modeId} is built in and cannot be edited` }, 403)
    }
    const body = await readJsonBody(request)
    if (!body.ok) return body.response
    const parsed = parseWorkModeRequestBody(body.value, { existing, modeId, requireName: false, requireDescription: true })
    if (!parsed.ok) return parsed.response
    const nextSkills = {
      ...skillsConfig,
      workModes: {
        ...skillsConfig.workModes,
        modes: {
          ...skillsConfig.workModes.modes,
          [modeId]: parsed.mode
        }
      }
    }
    const synced = await syncSkillsCapabilityToRuntimeConfig(runtime, owner, nextSkills)
    if (!synced.ok) return synced.response
    await refreshRuntimeTools(runtime)
    return jsonResponse({
      workMode: await workModeResponse(runtime, synced.config.capabilities?.skills ?? nextSkills, skillCompatFromCapability(synced.config.capabilities?.skills ?? nextSkills), modeId)
    })
  }

  if (request?.method === 'DELETE' && modeId && !skillId) {
    const mode = skillsConfig.workModes.modes[modeId]
    if (!mode) return jsonResponse({ detail: `Work mode ${modeId} not found` }, 404)
    if (mode.builtin || mode.editable === false || skillsConfig.workModes.defaultModeId === modeId) {
      return jsonResponse({ detail: `Work mode ${modeId} is built in and cannot be deleted` }, 403)
    }
    // Find and physically delete skills exclusive to this mode BEFORE removing
    // the mode config (so findExclusiveSkillIds can still read its overrides).
    const exclusiveIds = findExclusiveSkillIds(skillsConfig, modeId)
    let cleanedSkills = skillsConfig
    for (const skillId of exclusiveIds) {
      cleanedSkills = await purgeExclusiveSkill(runtime, cleanedSkills, skillId)
    }
    const modes = { ...cleanedSkills.workModes.modes }
    delete modes[modeId]
    const nextSkills = {
      ...cleanedSkills,
      workModes: { ...cleanedSkills.workModes, modes },
      modeSkillOverrides: Object.fromEntries(
        Object.entries(cleanedSkills.modeSkillOverrides ?? {}).filter(([id]) => id !== modeId)
      )
    }
    const synced = await syncSkillsCapabilityToRuntimeConfig(runtime, owner, nextSkills)
    if (!synced.ok) return synced.response
    await refreshRuntimeTools(runtime)
    return jsonResponse({ success: true, deletedSkillIds: exclusiveIds })
  }

  if (request?.method === 'PUT' && modeId && skillId) {
    return jsonResponse({ detail: READ_ONLY_WORK_MODE_SKILLS_DETAIL }, 403)
  }

  if (request?.method === 'DELETE' && modeId && skillId) {
    return jsonResponse({ detail: READ_ONLY_WORK_MODE_SKILLS_DETAIL }, 403)
  }

  if (request?.method === 'GET' && modeId) {
    const mode = await workModeResponse(runtime, skillsConfig, skillState, modeId)
    if (!mode) return jsonResponse({ detail: `Work mode ${modeId} not found` }, 404)
    return jsonResponse({ workMode: mode })
  }

  return jsonResponse({
    defaultModeId: skillsConfig.workModes.defaultModeId,
    lockedSkillIds: skillsConfig.lockedSkillIds,
    workModes: await Promise.all(
      Object.keys(skillsConfig.workModes.modes)
        .sort((a, b) => a.localeCompare(b))
        .map((id) => workModeResponse(runtime, skillsConfig, skillState, id))
    ).then((modes) => modes.filter(Boolean))
  })
}

export async function kworksModeSkills(runtime: ServerRuntime, actor: AuthActor | undefined, modeId: string): Promise<JsonResponse> {
  const config = await readEffectiveRuntimeConfig(runtime, actor)
  const skillsConfig = config.capabilities?.skills ?? DEFAULT_QIONGQI_CAPABILITIES_CONFIG.skills
  const mode = await workModeResponse(runtime, skillsConfig, skillCompatFromCapability(skillsConfig), modeId)
  if (!mode) return jsonResponse({ detail: `Work mode ${modeId} not found` }, 404)
  return jsonResponse({ skills: Array.isArray(mode.skills) ? mode.skills : [] })
}

export async function kworksCodingSkills(runtime: ServerRuntime, actor: AuthActor | undefined): Promise<JsonResponse> {
  const config = await readEffectiveRuntimeConfig(runtime, actor)
  const skillsConfig = config.capabilities?.skills ?? DEFAULT_QIONGQI_CAPABILITIES_CONFIG.skills
  const mode = await workModeResponse(runtime, skillsConfig, skillCompatFromCapability(skillsConfig), 'coding')
  if (!mode) return jsonResponse({ detail: 'Work mode coding not found' }, 404)
  const skills = Array.isArray(mode.skills) ? mode.skills : []
  return jsonResponse({ skills: skills.map((skill) => legacyCodingSkillEntry(skill)) })
}

export async function kworksGetCodingSkill(
  runtime: ServerRuntime,
  actor: AuthActor | undefined,
  skillId: string
): Promise<JsonResponse> {
  const config = await readEffectiveRuntimeConfig(runtime, actor)
  const skillsConfig = config.capabilities?.skills ?? DEFAULT_QIONGQI_CAPABILITIES_CONFIG.skills
  const mode = await workModeResponse(runtime, skillsConfig, skillCompatFromCapability(skillsConfig), 'coding')
  if (!mode) return jsonResponse({ detail: 'Work mode coding not found' }, 404)
  const skill = (Array.isArray(mode.skills) ? mode.skills : []).find((item) => stringValue(item.id) === skillId)
  if (!skill) return jsonResponse({ detail: `Coding skill ${skillId} not found` }, 404)
  return jsonResponse({ skill: legacyCodingSkillEntry(skill), instructions: '' })
}

export async function kworksSetCodingSkillEnabled(
  runtime: ServerRuntime,
  actor: AuthActor | undefined,
  skillId: string,
  request: Request
): Promise<JsonResponse | Response> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  if (!isObject(body.value)) return jsonResponse({ detail: 'coding skill toggle request body must be an object' }, 400)
  const enabled = booleanValue(body.value.enabled)
  if (enabled === undefined) return jsonResponse({ detail: 'enabled must be a boolean' }, 400)

  return jsonResponse({ detail: READ_ONLY_WORK_MODE_SKILLS_DETAIL }, 403)
}

export async function kworksInstallSkill(
  runtime: ServerRuntime,
  actor: AuthActor | undefined,
  request: Request
): Promise<JsonResponse | Response> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  if (!isObject(body.value)) return jsonResponse({ detail: 'skill install request body must be an object' }, 400)

  const threadId = stringValue(body.value.thread_id) ?? stringValue(body.value.threadId)
  const requestedPath = stringValue(body.value.path)
  if (!threadId) return jsonResponse({ detail: 'thread_id is required' }, 400)
  if (!requestedPath) return jsonResponse({ detail: 'path is required' }, 400)

  const source = resolveThreadSkillSource(runtime, threadId, requestedPath)
  if (!source.ok) return jsonResponse({ detail: source.detail }, 400)
  const sourceStat = await stat(source.absolutePath).catch(() => null)
  if (!sourceStat) return jsonResponse({ detail: `skill artifact not found: ${requestedPath}` }, 404)

  const skillId = await inferSkillId(source.absolutePath, sourceStat.isDirectory())
  if (!skillId) return jsonResponse({ detail: 'could not infer skill id from artifact' }, 400)

  const targetRoot = userSkillInstallRoot(runtime, skillId)
  await rm(targetRoot, { recursive: true, force: true })
  await mkdir(targetRoot, { recursive: true })
  if (sourceStat.isDirectory()) {
    await cp(source.absolutePath, targetRoot, { recursive: true, force: true })
  } else {
    await writeFile(join(targetRoot, 'SKILL.md'), await readFile(source.absolutePath))
  }

  const requestedWorkModeId = normalizeWorkModeId(
    stringValue(body.value.workModeId) ?? stringValue(body.value.work_mode_id)
  )
  const registered = await enableUserSkillForActor(runtime, actor, skillId, requestedWorkModeId)
  if (!registered.ok) return registered.response

  return jsonResponse({
    success: true,
    skill_name: skillId,
    skill_id: skillId,
    workModeId: registered.workModeId,
    root: targetRoot,
    message: `技能 ${skillId} 已安装并绑定到 ${registered.workModeId}`
  })
}

export async function kworksCreateSkill(
  runtime: ServerRuntime,
  actor: AuthActor | undefined,
  request: Request
): Promise<JsonResponse | Response> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = parseSkillCreateRequestBody(body.value)
  if (!parsed.ok) return parsed.response

  const { skill } = parsed
  const targetRoot = userSkillInstallRoot(runtime, skill.id)
  await rm(targetRoot, { recursive: true, force: true })
  await mkdir(targetRoot, { recursive: true })
  await writeFile(join(targetRoot, 'SKILL.md'), renderCreatedSkillMarkdown(skill), 'utf8')
  await writeFile(join(targetRoot, 'skill.json'), `${JSON.stringify(skillManifestForCreatedSkill(skill), null, 2)}\n`, 'utf8')

  let workModeId = skill.workModeId
  if (skill.install) {
    const registered = await enableUserSkillForActor(runtime, actor, skill.id, skill.workModeId)
    if (!registered.ok) return registered.response
    workModeId = registered.workModeId
  }

  return jsonResponse({
    success: true,
    installed: skill.install,
    skill_name: skill.id,
    skill_id: skill.id,
    workModeId,
    root: targetRoot,
    message: skill.install
      ? `技能 ${skill.id} 已创建并绑定到 ${workModeId}`
      : `技能 ${skill.id} 已创建`
  }, 201)
}

export async function kworksEmptyList(key: string): Promise<JsonResponse> {
  return jsonResponse({ [key]: [] })
}

export async function kworksListProjects(runtime: ServerRuntime, actor: AuthActor): Promise<JsonResponse> {
  return jsonResponse({ projects: await projectsForActor(runtime, actor) })
}

export async function kworksCreateProject(
  runtime: ServerRuntime,
  actor: AuthActor,
  request: Request
): Promise<JsonResponse | Response> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  if (!isObject(body.value)) return jsonResponse({ detail: 'project request body must be an object' }, 400)
  const name = stringValue(body.value.name)
  const requestedPath = stringValue(body.value.path)
  if (!name) return jsonResponse({ detail: 'project name is required' }, 400)
  if (!requestedPath) return jsonResponse({ detail: 'project path is required' }, 400)

  const projectPath = resolve(requestedPath)
  let projectStat: Awaited<ReturnType<typeof stat>>
  try {
    projectStat = await stat(projectPath)
  } catch {
    return jsonResponse({ detail: `Project path does not exist: ${projectPath}` }, 400)
  }
  if (!projectStat.isDirectory()) {
    return jsonResponse({ detail: `Project path is not a directory: ${projectPath}` }, 400)
  }

  const now = new Date().toISOString()
  const project: KWorksProject = {
    id: `proj_${randomUUID()}`,
    name,
    path: projectPath,
    description: stringValue(body.value.description) ?? '',
    config: isObject(body.value.config) ? body.value.config : {},
    is_git_repo: await isGitRepository(projectPath),
    created_at: now,
    updated_at: now
  }
  await saveProjectsForActor(runtime, actor, [project, ...(await projectsForActor(runtime, actor))])
  return jsonResponse(project, 201)
}

export async function kworksGetProject(runtime: ServerRuntime, actor: AuthActor, projectId: string): Promise<JsonResponse> {
  const project = (await projectsForActor(runtime, actor)).find((item) => item.id === projectId)
  if (!project) return jsonResponse({ detail: `Project ${projectId} not found` }, 404)
  return jsonResponse(project)
}

export async function kworksDeleteProject(runtime: ServerRuntime, actor: AuthActor, projectId: string): Promise<JsonResponse> {
  const projects = await projectsForActor(runtime, actor)
  const next = projects.filter((item) => item.id !== projectId)
  if (next.length === projects.length) return jsonResponse({ detail: `Project ${projectId} not found` }, 404)
  await saveProjectsForActor(runtime, actor, next)
  return jsonResponse({ success: true })
}

export async function kworksListProjectFiles(
  runtime: ServerRuntime,
  actor: AuthActor,
  projectId: string,
  request: Request
): Promise<JsonResponse> {
  const project = await projectForActor(runtime, actor, projectId)
  if (!project) return jsonResponse({ detail: `Project ${projectId} not found` }, 404)
  const subpath = new URL(request.url).searchParams.get('path') ?? '.'
  const resolved = resolveProjectSubpath(project.path, subpath)
  if (!resolved.ok) return jsonResponse({ detail: resolved.detail }, 400)
  let directoryStat: Awaited<ReturnType<typeof stat>>
  try {
    directoryStat = await stat(resolved.absolutePath)
  } catch {
    return jsonResponse({ detail: `Project path does not exist: ${resolved.relativePath}` }, 404)
  }
  if (!directoryStat.isDirectory()) {
    return jsonResponse({ detail: `Project path is not a directory: ${resolved.relativePath}` }, 400)
  }

  const entries = await Promise.all(
    (await readdir(resolved.absolutePath, { withFileTypes: true }))
      .filter((entry) => entry.name !== '.git')
      .map((entry) => projectFileEntry(resolved.absolutePath, resolved.relativePath, entry.name))
  )
  return jsonResponse({
    entries: entries
      .filter((entry): entry is ProjectFileEntry => Boolean(entry))
      .sort((a, b) => Number(a.type === 'file') - Number(b.type === 'file') || a.name.localeCompare(b.name))
  })
}

export async function kworksReadProjectFile(
  runtime: ServerRuntime,
  actor: AuthActor,
  projectId: string,
  request: Request
): Promise<JsonResponse> {
  const project = await projectForActor(runtime, actor, projectId)
  if (!project) return jsonResponse({ detail: `Project ${projectId} not found` }, 404)
  const subpath = new URL(request.url).searchParams.get('path') ?? ''
  const resolved = resolveProjectSubpath(project.path, subpath)
  if (!resolved.ok) return jsonResponse({ detail: resolved.detail }, 400)
  let fileStat: Awaited<ReturnType<typeof stat>>
  try {
    fileStat = await stat(resolved.absolutePath)
  } catch {
    return jsonResponse({ detail: `Project file does not exist: ${resolved.relativePath}` }, 404)
  }
  if (!fileStat.isFile()) {
    return jsonResponse({ detail: `Project path is not a file: ${resolved.relativePath}` }, 400)
  }
  return jsonResponse({
    path: resolved.relativePath,
    content: await readFile(resolved.absolutePath, 'utf-8'),
    size: fileStat.size,
    language: languageFromPath(resolved.relativePath)
  })
}

export async function kworksListProjectWorktrees(
  runtime: ServerRuntime,
  actor: AuthActor,
  projectId: string
): Promise<JsonResponse> {
  const project = await projectForActor(runtime, actor, projectId)
  if (!project) return jsonResponse({ detail: `Project ${projectId} not found` }, 404)
  if (!(await isGitRepository(project.path))) return jsonResponse({ worktrees: [] })
  return jsonResponse({ worktrees: parseGitWorktrees(await runGit(project.path, ['worktree', 'list', '--porcelain'])) })
}

export async function kworksGetProjectDiff(
  runtime: ServerRuntime,
  actor: AuthActor,
  projectId: string
): Promise<JsonResponse> {
  const project = await projectForActor(runtime, actor, projectId)
  if (!project) return jsonResponse({ detail: `Project ${projectId} not found` }, 404)
  const isGitRepo = await isGitRepository(project.path)
  if (!isGitRepo) return jsonResponse({ is_git_repo: false, has_changes: false, files: [], diff: '' })
  const [status, numstat, diff] = await Promise.all([
    runGit(project.path, ['status', '--porcelain']),
    runGit(project.path, ['diff', '--numstat']),
    runGit(project.path, ['diff', '--'])
  ])
  const files = projectDiffFiles(status, numstat, diff)
  return jsonResponse({
    is_git_repo: true,
    has_changes: files.length > 0 || diff.trim().length > 0,
    files,
    diff
  })
}

export async function kworksGetProjectEnvironment(
  runtime: ServerRuntime,
  actor: AuthActor,
  projectId: string
): Promise<JsonResponse> {
  const project = await projectForActor(runtime, actor, projectId)
  if (!project) return jsonResponse({ detail: `Project ${projectId} not found` }, 404)
  const isGitRepo = await isGitRepository(project.path)
  if (!isGitRepo) return jsonResponse(projectEnvironmentResponse(project, false))
  const [branch, head, upstream, aheadBehind, status, numstat, remote] = await Promise.all([
    runGit(project.path, ['branch', '--show-current']),
    runGit(project.path, ['rev-parse', '--short', 'HEAD']),
    runGit(project.path, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']),
    runGit(project.path, ['rev-list', '--left-right', '--count', '@{u}...HEAD']),
    runGit(project.path, ['status', '--porcelain']),
    runGit(project.path, ['diff', '--numstat']),
    runGit(project.path, ['remote', 'get-url', 'origin'])
  ])
  const totals = diffTotals(numstat)
  const [behind, ahead] = parseAheadBehind(aheadBehind)
  return jsonResponse(projectEnvironmentResponse(project, true, {
    branch: branch.trim() || null,
    head: head.trim() || null,
    upstream: upstream.trim() || null,
    ahead,
    behind,
    changedFiles: statusLines(status).length,
    additions: totals.additions,
    deletions: totals.deletions,
    remote: remote.trim() || null
  }))
}

export async function kworksDiscardProjectFileChange(
  runtime: ServerRuntime,
  actor: AuthActor,
  projectId: string,
  request: Request
): Promise<JsonResponse | Response> {
  const project = await projectForActor(runtime, actor, projectId)
  if (!project) return jsonResponse({ detail: `Project ${projectId} not found` }, 404)
  if (!(await isGitRepository(project.path))) return jsonResponse({ detail: 'Project is not a git repository' }, 400)
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  if (!isObject(body.value)) return jsonResponse({ detail: 'discard request body must be an object' }, 400)
  const requestedPath = stringValue(body.value.path)
  if (!requestedPath) return jsonResponse({ detail: 'path is required' }, 400)
  const resolved = resolveProjectSubpath(project.path, requestedPath)
  if (!resolved.ok) return jsonResponse({ detail: resolved.detail }, 400)
  if (resolved.relativePath === '.') return jsonResponse({ detail: 'path must reference a project file' }, 400)

  const status = await runGit(project.path, ['status', '--porcelain', '--', resolved.relativePath])
  if (!status.trim()) return jsonResponse({ path: resolved.relativePath, discarded: false })
  if (statusLines(status).every((line) => line.startsWith('??'))) {
    await rm(resolved.absolutePath, { recursive: true, force: true })
    return jsonResponse({ path: resolved.relativePath, discarded: true })
  }
  const restored = await runGitStrict(project.path, ['restore', '--staged', '--worktree', '--', resolved.relativePath])
  if (!restored.ok) return jsonResponse({ detail: restored.detail }, 400)
  return jsonResponse({ path: resolved.relativePath, discarded: true })
}

export async function kworksGitCommitProject(
  runtime: ServerRuntime,
  actor: AuthActor,
  projectId: string,
  request: Request
): Promise<JsonResponse | Response> {
  const project = await projectForActor(runtime, actor, projectId)
  if (!project) return jsonResponse({ detail: `Project ${projectId} not found` }, 404)
  if (!(await isGitRepository(project.path))) return jsonResponse({ detail: 'Project is not a git repository' }, 400)
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  if (!isObject(body.value)) return jsonResponse({ detail: 'commit request body must be an object' }, 400)
  const message = stringValue(body.value.message)?.trim()
  if (!message) return jsonResponse({ detail: 'message is required' }, 400)
  const status = await runGit(project.path, ['status', '--porcelain'])
  if (!status.trim()) return jsonResponse({ detail: 'No changes to commit' }, 400)
  const added = await runGitStrict(project.path, ['add', '-A'])
  if (!added.ok) return jsonResponse({ detail: added.detail }, 400)
  const committed = await runGitStrict(project.path, ['commit', '-m', message])
  if (!committed.ok) return jsonResponse({ detail: committed.detail }, 400)
  const head = (await runGit(project.path, ['rev-parse', '--short', 'HEAD'])).trim()
  return jsonResponse({
    head,
    summary: firstNonEmptyLine(committed.output) ?? `Committed ${head}`,
    message
  })
}

export async function kworksGitPushProject(
  runtime: ServerRuntime,
  actor: AuthActor,
  projectId: string
): Promise<JsonResponse> {
  const project = await projectForActor(runtime, actor, projectId)
  if (!project) return jsonResponse({ detail: `Project ${projectId} not found` }, 404)
  if (!(await isGitRepository(project.path))) return jsonResponse({ detail: 'Project is not a git repository' }, 400)
  const branch = (await runGit(project.path, ['branch', '--show-current'])).trim()
  if (!branch) return jsonResponse({ detail: 'Cannot push a detached HEAD' }, 400)
  const upstream = (await runGit(project.path, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])).trim()
  if (!upstream) return jsonResponse({ detail: 'Current branch has no upstream' }, 400)
  const pushed = await runGitStrict(project.path, ['push'])
  if (!pushed.ok) return jsonResponse({ detail: pushed.detail }, 400)
  return jsonResponse({
    branch,
    upstream,
    summary: firstNonEmptyLine(pushed.output) ?? `Pushed ${branch}`
  })
}

export async function kworksDeliveryStages(): Promise<JsonResponse> {
  return jsonResponse({ stages: CODING_DELIVERY_STAGES })
}

export async function kworksGetProjectStage(
  runtime: ServerRuntime,
  actor: AuthActor,
  request: Request
): Promise<JsonResponse> {
  const projectRoot = new URL(request.url).searchParams.get('project_root')
  if (!projectRoot) return jsonResponse({ detail: 'project_root is required' }, 400)
  return jsonResponse(await projectStageForActor(runtime, actor, projectRoot))
}

export async function kworksSetProjectStage(
  runtime: ServerRuntime,
  actor: AuthActor,
  request: Request
): Promise<JsonResponse | Response> {
  const projectRoot = new URL(request.url).searchParams.get('project_root')
  if (!projectRoot) return jsonResponse({ detail: 'project_root is required' }, 400)
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  if (!isObject(body.value)) return jsonResponse({ detail: 'stage request body must be an object' }, 400)
  const stageId = stringValue(body.value.stage_id)
  if (!stageId) return jsonResponse({ detail: 'stage_id is required' }, 400)
  if (!CODING_DELIVERY_STAGES.some((stage) => stage.id === stageId)) {
    return jsonResponse({ detail: `Unknown delivery stage ${stageId}` }, 400)
  }
  const current = await projectStageForActor(runtime, actor, projectRoot)
  const now = new Date().toISOString()
  const next: ProjectStageState = {
    ...current,
    current_stage: stageId,
    pending_suggestion: null,
    updated_at: now,
    stage_history: [
      ...current.stage_history,
      {
        from_stage_id: current.current_stage,
        to_stage_id: stageId,
        reason: stringValue(body.value.reason) ?? '',
        source: 'user',
        timestamp: now
      }
    ]
  }
  await saveProjectStageForActor(runtime, actor, next)
  return jsonResponse(next)
}

export async function kworksAcceptProjectStageSuggestion(
  runtime: ServerRuntime,
  actor: AuthActor,
  request: Request
): Promise<JsonResponse> {
  const projectRoot = new URL(request.url).searchParams.get('project_root')
  if (!projectRoot) return jsonResponse({ detail: 'project_root is required' }, 400)
  const current = await projectStageForActor(runtime, actor, projectRoot)
  if (!current.pending_suggestion) return jsonResponse(current)
  const now = new Date().toISOString()
  const next: ProjectStageState = {
    ...current,
    current_stage: current.pending_suggestion.stage_id,
    pending_suggestion: null,
    updated_at: now,
    stage_history: [
      ...current.stage_history,
      {
        from_stage_id: current.current_stage,
        to_stage_id: current.pending_suggestion.stage_id,
        reason: current.pending_suggestion.reason,
        source: 'agent_accepted',
        timestamp: now,
        thread_id: current.pending_suggestion.suggested_by_thread_id
      }
    ]
  }
  await saveProjectStageForActor(runtime, actor, next)
  return jsonResponse(next)
}

export async function kworksDismissProjectStageSuggestion(
  runtime: ServerRuntime,
  actor: AuthActor,
  request: Request
): Promise<JsonResponse> {
  const projectRoot = new URL(request.url).searchParams.get('project_root')
  if (!projectRoot) return jsonResponse({ detail: 'project_root is required' }, 400)
  const current = await projectStageForActor(runtime, actor, projectRoot)
  if (!current.pending_suggestion) return jsonResponse(current)
  const next: ProjectStageState = {
    ...current,
    pending_suggestion: null,
    updated_at: new Date().toISOString()
  }
  await saveProjectStageForActor(runtime, actor, next)
  return jsonResponse(next)
}

export async function kworksGetCodingSession(runtime: ServerRuntime, threadId: string): Promise<JsonResponse> {
  const thread = await runtime.threadService.get(threadId)
  return jsonResponse({
    thread_id: threadId,
    session: codingSessionFromThread(runtime, threadId, thread)
  })
}

export async function kworksListCodingSessionEvents(runtime: ServerRuntime, threadId: string): Promise<JsonResponse> {
  const thread = await runtime.threadService.get(threadId)
  return jsonResponse({ thread_id: threadId, events: codingEventsFromThread(threadId, thread) })
}

export async function kworksListCodingSessionChanges(runtime: ServerRuntime, threadId: string): Promise<JsonResponse> {
  const thread = await runtime.threadService.get(threadId)
  return jsonResponse({ thread_id: threadId, changes: await codingChangesFromThread(threadId, thread) })
}

export async function kworksGetLatestCodingReview(runtime: ServerRuntime, threadId: string): Promise<JsonResponse> {
  const thread = await runtime.threadService.get(threadId)
  return jsonResponse({
    thread_id: threadId,
    review: nativeCodingReviewFromThread(threadId, thread) ?? codingReviewsByThread.get(threadId) ?? null
  })
}

export async function kworksRunCodingReview(
  runtime: ServerRuntime,
  actor: AuthActor,
  request: Request
): Promise<JsonResponse | Response> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  if (!isObject(body.value)) return jsonResponse({ detail: 'review request body must be an object' }, 400)
  const projectId = stringValue(body.value.project_id)
  const projectRoot = stringValue(body.value.project_root)
  const threadId = stringValue(body.value.thread_id)
  if (!projectId) return jsonResponse({ detail: 'project_id is required' }, 400)
  if (!projectRoot) return jsonResponse({ detail: 'project_root is required' }, 400)
  if (!threadId) return jsonResponse({ detail: 'thread_id is required' }, 400)
  const project = await projectForActor(runtime, actor, projectId)
  if (!project) return jsonResponse({ detail: `Project ${projectId} not found` }, 404)
  const isGitRepo = await isGitRepository(project.path)
  const status = isGitRepo ? await runGit(project.path, ['status', '--porcelain']) : ''
  const numstat = isGitRepo ? await runGit(project.path, ['diff', '--numstat']) : ''
  const totals = diffTotals(numstat)
  const changedFiles = statusLines(status).length
  const now = new Date().toISOString()
  const findings: CodingReviewFinding[] = changedFiles > 0
    ? [{
        id: `finding_${randomUUID()}`,
        severity: 'major' as const,
        category: 'review_coverage',
        file: null,
        line: null,
        task_id: threadId,
        message: '需要真实代码审查',
        suggestion: '运行 code-review skill 或 agent review 后再判定是否通过。',
        evidence: [
          `changed_files=${changedFiles}`,
          `additions=${totals.additions}`,
          `deletions=${totals.deletions}`,
          'compat review can only summarize git diff and cannot replace semantic review'
        ],
        fix: {
          applicable: false,
          kind: null,
          description: `检测到 ${changedFiles} 个文件变更（+${totals.additions}/-${totals.deletions}），需要真实 code-review skill 或 agent review 后再处理。`,
          patch: '',
          applied: false
        }
      }]
    : []
  const review: CodingReview = {
    review_id: `review_${randomUUID()}`,
    project_id: projectId,
    project_root: projectRoot,
    thread_id: threadId,
    scope: stringValue(body.value.scope) ?? 'project_diff',
    decision: findings.length > 0 ? 'needs_review' : 'pass',
    summary: {
      project_files: changedFiles,
      task_changes: 0,
      qiongqi_events: 0,
      commits: 0,
      additions: totals.additions,
      deletions: totals.deletions,
      critical: 0,
      major: findings.filter((finding) => finding.severity === 'major').length,
      minor: 0,
      nitpick: 0
    },
    findings,
    source: {
      kind: 'qiongqi-compat',
      is_git_repo: isGitRepo
    },
    created_at: now,
    next_plan: findings.length > 0
      ? ['运行真实 code-review skill/agent 审查当前 diff', '根据审查结果处理 findings 后重新运行 review']
      : []
  }
  codingReviewsByThread.set(threadId, review)
  return jsonResponse(review, 201)
}

function nativeCodingReviewFromThread(threadId: string, thread: ThreadRecord | null): CodingReview | null {
  if (!thread) return null
  const reviewItems = thread.turns
    .flatMap((turn) => turn.items.map((item) => ({ turn, item })))
    .filter((entry): entry is { turn: ThreadRecord['turns'][number]; item: Extract<TurnItem, { kind: 'review' }> } => entry.item.kind === 'review')
  const latest = reviewItems.at(-1)
  if (!latest) return null

  const item = latest.item
  const output: Record<string, unknown> = isObject(item.output) ? item.output : {}
  const rawFindings = Array.isArray(output.findings) ? output.findings : []
  const findings = rawFindings
    .map((finding, index) => nativeReviewFindingFromOutput(finding, index, threadId, item.id))
    .filter((finding): finding is CodingReviewFinding => Boolean(finding))
  const summary = {
    project_files: new Set(findings.map((finding) => finding.file).filter((file): file is string => Boolean(file))).size,
    task_changes: 0,
    qiongqi_events: codingEventsFromThread(threadId, thread).length,
    commits: nativeReviewTargetKind(item.target) === 'baseBranch' ? 1 : 0,
    additions: 0,
    deletions: 0,
    critical: findings.filter((finding) => finding.severity === 'critical').length,
    major: findings.filter((finding) => finding.severity === 'major').length,
    minor: findings.filter((finding) => finding.severity === 'minor').length,
    nitpick: findings.filter((finding) => finding.severity === 'nitpick').length
  }
  const correctness = stringValue(output.overallCorrectness)
  const decision = correctness === 'patch is incorrect'
    ? 'request_changes'
    : findings.some((finding) => finding.severity === 'critical' || finding.severity === 'major')
      ? 'needs_review'
      : 'pass'

  return {
    review_id: item.id,
    project_id: threadId,
    project_root: thread.workspace ?? '',
    thread_id: threadId,
    scope: nativeReviewScope(item.target),
    decision,
    summary,
    findings,
    source: {
      kind: 'qiongqi-native-review',
      target: item.target,
      title: item.title,
      status: item.status,
      overallCorrectness: correctness,
      overallExplanation: stringValue(output.overallExplanation),
      overallConfidenceScore: numberValue(output.overallConfidenceScore)
    },
    created_at: item.finishedAt ?? item.createdAt ?? latest.turn.finishedAt ?? latest.turn.createdAt ?? new Date().toISOString(),
    next_plan: findings.length > 0
      ? ['处理 native QiongQi review findings', '修复后重新运行 Code Review']
      : []
  }
}

function nativeReviewFindingFromOutput(
  value: unknown,
  index: number,
  threadId: string,
  reviewItemId: string
): CodingReviewFinding | null {
  if (!isObject(value)) return null
  const location = isObject(value.codeLocation) ? value.codeLocation : {}
  const lineRange: Record<string, unknown> = isObject(location.lineRange) ? lineRangeObject(location.lineRange) : {}
  const priority = numberValue(value.priority) ?? 3
  const confidence = numberValue(value.confidenceScore)
  const title = stringValue(value.title) || `Review finding ${index + 1}`
  const body = stringValue(value.body) ?? ''
  const file = stringValue(location.absoluteFilePath) || null
  const line = numberValue(lineRange.start) ?? null
  return {
    id: `${reviewItemId}_finding_${index + 1}`,
    severity: severityFromReviewPriority(priority),
    category: 'native_review',
    file,
    line: line !== null && line > 0 ? line : null,
    task_id: threadId,
    message: title,
    suggestion: body,
    evidence: [
      `priority=${Number.isFinite(priority) ? priority : 'unknown'}`,
      `confidence=${Number.isFinite(confidence) ? confidence : 'unknown'}`,
      `review_item=${reviewItemId}`
    ],
    fix: {
      applicable: false,
      kind: null,
      description: 'Native QiongQi review findings are read-only in this panel; ask the Coding Agent to implement the fix.',
      patch: '',
      applied: false
    }
  }
}

function severityFromReviewPriority(priority: number): CodingReviewFinding['severity'] {
  if (priority <= 0) return 'critical'
  if (priority === 1) return 'major'
  if (priority === 2) return 'minor'
  return 'nitpick'
}

function nativeReviewScope(target: unknown): string {
  const kind = nativeReviewTargetKind(target)
  if (kind === 'baseBranch') return 'pr'
  if (kind === 'commit') return 'commit'
  if (kind === 'custom') return 'custom'
  return 'project_diff'
}

function nativeReviewTargetKind(target: unknown): string {
  return isObject(target) ? stringValue(target.kind) ?? '' : ''
}

function lineRangeObject(value: unknown): Record<string, unknown> {
  return isObject(value) ? value : {}
}

export async function kworksApplyCodingReviewFix(request: Request): Promise<JsonResponse | Response> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  if (!isObject(body.value)) return jsonResponse({ detail: 'review fix request body must be an object' }, 400)
  const threadId = stringValue(body.value.thread_id)
  const reviewId = stringValue(body.value.review_id)
  const findingId = stringValue(body.value.finding_id)
  if (!threadId || !reviewId || !findingId) {
    return jsonResponse({ detail: 'thread_id, review_id and finding_id are required' }, 400)
  }
  const review = codingReviewsByThread.get(threadId)
  const finding = review?.review_id === reviewId ? review.findings.find((item) => item.id === findingId) : undefined
  if (!review || !finding) return jsonResponse({ detail: 'Review finding not found' }, 404)
  return jsonResponse({
    thread_id: threadId,
    review_id: reviewId,
    finding_id: findingId,
    file: finding.file ?? '',
    applied: false
  })
}

export async function kworksGetCodingRoiSummary(runtime: ServerRuntime, threadId: string): Promise<JsonResponse> {
  const thread = await runtime.threadService.get(threadId)
  const report = codingRoiReportFromThread(threadId, thread)
  return jsonResponse({
    thread_id: threadId,
    summary: codingRoiSummaryFromReport(threadId, report)
  })
}

export async function kworksListCodingRoiReports(runtime: ServerRuntime, threadId: string): Promise<JsonResponse> {
  const thread = await runtime.threadService.get(threadId)
  const report = codingRoiReportFromThread(threadId, thread)
  return jsonResponse({ thread_id: threadId, reports: report ? [report] : [] })
}

export async function kworksChannelsConfig(): Promise<JsonResponse> {
  return jsonResponse({ channels: [] })
}

export async function kworksMemory(): Promise<JsonResponse> {
  return jsonResponse({ enabled: true, facts: [], memories: [] })
}

export async function kworksListCrons(runtime: ServerRuntime, actor: AuthActor): Promise<JsonResponse> {
  return jsonResponse({ cron_jobs: await cronJobsForActor(runtime, actor) })
}

export async function kworksCreateCron(
  runtime: ServerRuntime,
  actor: AuthActor,
  name: string,
  request: Request
): Promise<JsonResponse | Response> {
  const parsed = await readCronConfig(runtime, request)
  if (!parsed.ok) return parsed.response
  await saveCronJobsForActor(runtime, actor, {
    ...(await cronJobsForActor(runtime, actor)),
    [name]: parsed.value
  })
  return jsonResponse(parsed.value, 201)
}

export async function kworksUpdateCron(
  runtime: ServerRuntime,
  actor: AuthActor,
  name: string,
  request: Request
): Promise<JsonResponse | Response> {
  const parsed = await readCronConfig(runtime, request)
  if (!parsed.ok) return parsed.response
  const jobs = await cronJobsForActor(runtime, actor)
  if (!jobs[name]) return jsonResponse({ detail: `Cron job ${name} not found` }, 404)
  await saveCronJobsForActor(runtime, actor, { ...jobs, [name]: parsed.value })
  return jsonResponse(parsed.value)
}

export async function kworksDeleteCron(
  runtime: ServerRuntime,
  actor: AuthActor,
  name: string
): Promise<JsonResponse> {
  const jobs = await cronJobsForActor(runtime, actor)
  if (!jobs[name]) return jsonResponse({ detail: `Cron job ${name} not found` }, 404)
  const nextJobs = { ...jobs }
  delete nextJobs[name]
  await saveCronJobsForActor(runtime, actor, nextJobs)
  return jsonResponse({ success: true })
}

export async function kworksToggleCron(
  runtime: ServerRuntime,
  actor: AuthActor,
  name: string,
  request: Request
): Promise<JsonResponse | Response> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  if (!isObject(body.value)) return jsonResponse({ detail: 'cron toggle request body must be an object' }, 400)
  const enabled = booleanValue(body.value.enabled)
  if (enabled === undefined) return jsonResponse({ detail: 'enabled must be a boolean' }, 400)
  const jobs = await cronJobsForActor(runtime, actor)
  const existing = jobs[name]
  if (!existing) return jsonResponse({ detail: `Cron job ${name} not found` }, 404)
  const updated = { ...existing, enabled }
  await saveCronJobsForActor(runtime, actor, { ...jobs, [name]: updated })
  return jsonResponse(updated)
}

async function projectsForActor(runtime: ServerRuntime, actor: AuthActor): Promise<KWorksProject[]> {
  const owner = ownerUserId(actor)
  if (owner && runtime.kworksUserDataStore) {
    return normalizeProjects(await runtime.kworksUserDataStore.getUserSetting(owner, USER_SETTING_PROJECTS))
  }
  const snapshot = await loadProjectSnapshot(runtime)
  return [...(snapshot.users[projectOwnerKey(actor)] ?? [])]
}

async function saveProjectsForActor(
  runtime: ServerRuntime,
  actor: AuthActor,
  projects: KWorksProject[]
): Promise<void> {
  const owner = ownerUserId(actor)
  if (owner && runtime.kworksUserDataStore) {
    await runtime.kworksUserDataStore.setUserSetting(owner, USER_SETTING_PROJECTS, projects)
    return
  }
  const snapshot = await loadProjectSnapshot(runtime)
  await saveProjectSnapshot(runtime, {
    version: 1,
    users: {
      ...snapshot.users,
      [projectOwnerKey(actor)]: projects
    }
  })
}

async function projectForActor(
  runtime: ServerRuntime,
  actor: AuthActor,
  projectId: string
): Promise<KWorksProject | undefined> {
  return (await projectsForActor(runtime, actor)).find((project) => project.id === projectId)
}

function normalizeProjects(value: unknown): KWorksProject[] {
  if (!Array.isArray(value)) return []
  return value.map(normalizeProject).filter((project): project is KWorksProject => Boolean(project))
}

function normalizeProject(value: unknown): KWorksProject | null {
  if (!isObject(value)) return null
  const id = stringValue(value.id)
  const name = stringValue(value.name)
  const path = stringValue(value.path)
  if (!id || !name || !path) return null
  return {
    id,
    name,
    path,
    description: stringValue(value.description) ?? '',
    config: isObject(value.config) ? value.config : {},
    is_git_repo: value.is_git_repo === true,
    created_at: stringValue(value.created_at) ?? new Date().toISOString(),
    updated_at: stringValue(value.updated_at) ?? new Date().toISOString()
  }
}

async function loadProjectSnapshot(runtime: ServerRuntime): Promise<KWorksProjectSnapshot> {
  try {
    const parsed = JSON.parse(await readFile(projectStorePath(runtime), 'utf-8')) as unknown
    if (!isObject(parsed) || !isObject(parsed.users)) return emptyProjectSnapshot()
    const users: Record<string, KWorksProject[]> = {}
    for (const [userId, projects] of Object.entries(parsed.users)) {
      const normalized = normalizeProjects(projects)
      if (normalized.length > 0) users[userId] = normalized
    }
    return { version: 1, users }
  } catch {
    return emptyProjectSnapshot()
  }
}

async function saveProjectSnapshot(runtime: ServerRuntime, snapshot: KWorksProjectSnapshot): Promise<void> {
  await mkdir(join(runtime.info().dataDir, 'kworks'), { recursive: true })
  await writeFile(projectStorePath(runtime), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8')
}

function emptyProjectSnapshot(): KWorksProjectSnapshot {
  return { version: 1, users: {} }
}

function projectStorePath(runtime: ServerRuntime): string {
  return join(runtime.info().dataDir, 'kworks', 'projects.json')
}

function projectStageStorePath(runtime: ServerRuntime): string {
  return join(runtime.info().dataDir, 'kworks', 'project-stages.json')
}

function projectOwnerKey(actor: AuthActor): string {
  return ownerUserId(actor) ?? 'internal-runtime'
}

async function projectStageForActor(
  runtime: ServerRuntime,
  actor: AuthActor,
  projectRoot: string
): Promise<ProjectStageState> {
  const snapshot = await loadProjectStageSnapshot(runtime)
  return snapshot.users[projectOwnerKey(actor)]?.[projectRoot] ?? emptyProjectStage(projectRoot)
}

async function saveProjectStageForActor(
  runtime: ServerRuntime,
  actor: AuthActor,
  state: ProjectStageState
): Promise<void> {
  const snapshot = await loadProjectStageSnapshot(runtime)
  const ownerKey = projectOwnerKey(actor)
  await saveProjectStageSnapshot(runtime, {
    version: 1,
    users: {
      ...snapshot.users,
      [ownerKey]: {
        ...(snapshot.users[ownerKey] ?? {}),
        [state.project_root]: state
      }
    }
  })
}

async function loadProjectStageSnapshot(runtime: ServerRuntime): Promise<ProjectStageSnapshot> {
  try {
    const parsed = JSON.parse(await readFile(projectStageStorePath(runtime), 'utf-8')) as unknown
    if (!isObject(parsed) || !isObject(parsed.users)) return emptyProjectStageSnapshot()
    const users: Record<string, Record<string, ProjectStageState>> = {}
    for (const [ownerKey, states] of Object.entries(parsed.users)) {
      if (!isObject(states)) continue
      const normalizedStates: Record<string, ProjectStageState> = {}
      for (const [projectRoot, state] of Object.entries(states)) {
        const normalized = normalizeProjectStageState(projectRoot, state)
        if (normalized) normalizedStates[projectRoot] = normalized
      }
      if (Object.keys(normalizedStates).length > 0) users[ownerKey] = normalizedStates
    }
    return { version: 1, users }
  } catch {
    return emptyProjectStageSnapshot()
  }
}

async function saveProjectStageSnapshot(runtime: ServerRuntime, snapshot: ProjectStageSnapshot): Promise<void> {
  await mkdir(join(runtime.info().dataDir, 'kworks'), { recursive: true })
  await writeFile(projectStageStorePath(runtime), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8')
}

function emptyProjectStageSnapshot(): ProjectStageSnapshot {
  return { version: 1, users: {} }
}

function emptyProjectStage(projectRoot: string): ProjectStageState {
  return {
    project_root: projectRoot,
    current_stage: null,
    stage_history: [],
    pending_suggestion: null,
    updated_at: null
  }
}

function normalizeProjectStageState(projectRoot: string, value: unknown): ProjectStageState | null {
  if (!isObject(value)) return null
  return {
    project_root: stringValue(value.project_root) ?? projectRoot,
    current_stage: stringValue(value.current_stage) ?? null,
    stage_history: Array.isArray(value.stage_history)
      ? value.stage_history.map(normalizeStageHistoryEntry).filter((entry): entry is StageHistoryEntry => Boolean(entry))
      : [],
    pending_suggestion: normalizeStageSuggestion(value.pending_suggestion),
    updated_at: stringValue(value.updated_at) ?? null
  }
}

function normalizeStageHistoryEntry(value: unknown): StageHistoryEntry | null {
  if (!isObject(value)) return null
  const toStageId = stringValue(value.to_stage_id)
  if (!toStageId) return null
  return {
    from_stage_id: stringValue(value.from_stage_id) ?? null,
    to_stage_id: toStageId,
    reason: stringValue(value.reason) ?? '',
    source: stageSourceValue(value.source),
    timestamp: stringValue(value.timestamp) ?? new Date().toISOString(),
    ...(stringValue(value.thread_id) ? { thread_id: stringValue(value.thread_id) } : {}),
    ...(stringValue(value.run_outcome) ? { run_outcome: stringValue(value.run_outcome) } : {})
  }
}

function normalizeStageSuggestion(value: unknown): StageSuggestion | null {
  if (!isObject(value)) return null
  const stageId = stringValue(value.stage_id)
  const threadId = stringValue(value.suggested_by_thread_id)
  if (!stageId || !threadId) return null
  return {
    stage_id: stageId,
    reason: stringValue(value.reason) ?? '',
    suggested_by_thread_id: threadId,
    timestamp: stringValue(value.timestamp) ?? new Date().toISOString()
  }
}

function stageSourceValue(value: unknown): StageSource {
  return value === 'agent_suggested' || value === 'agent_accepted' ? value : 'user'
}

function resolveProjectSubpath(
  projectRoot: string,
  subpath: string
): { ok: true; absolutePath: string; relativePath: string } | { ok: false; detail: string } {
  const root = resolve(projectRoot)
  const absolutePath = resolve(root, subpath.trim() || '.')
  const relativePath = relative(root, absolutePath)
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    return { ok: false, detail: 'Project path must stay inside the project root' }
  }
  return {
    ok: true,
    absolutePath,
    relativePath: relativePath ? toProjectPath(relativePath) : '.'
  }
}

async function projectFileEntry(
  parentAbsolutePath: string,
  parentRelativePath: string,
  name: string
): Promise<ProjectFileEntry | null> {
  const absolutePath = join(parentAbsolutePath, name)
  let entryStat: Awaited<ReturnType<typeof stat>>
  try {
    entryStat = await stat(absolutePath)
  } catch {
    return null
  }
  const type = entryStat.isDirectory() ? 'directory' : entryStat.isFile() ? 'file' : undefined
  if (!type) return null
  const path = parentRelativePath === '.' ? name : `${parentRelativePath}/${name}`
  return {
    name,
    path: toProjectPath(path),
    type,
    size: type === 'file' ? entryStat.size : 0,
    ext: type === 'file' ? extname(name) : ''
  }
}

function toProjectPath(path: string): string {
  return path.split(sep).join('/')
}

function languageFromPath(path: string): string {
  const ext = extname(path).toLowerCase()
  const languages: Record<string, string> = {
    '.c': 'c',
    '.cpp': 'cpp',
    '.css': 'css',
    '.go': 'go',
    '.html': 'html',
    '.java': 'java',
    '.js': 'javascript',
    '.jsx': 'jsx',
    '.json': 'json',
    '.md': 'markdown',
    '.mdx': 'markdown',
    '.py': 'python',
    '.rs': 'rust',
    '.sh': 'bash',
    '.sql': 'sql',
    '.ts': 'typescript',
    '.tsx': 'tsx',
    '.txt': 'text',
    '.xml': 'xml',
    '.yaml': 'yaml',
    '.yml': 'yaml'
  }
  return languages[ext] ?? (ext.replace(/^\./, '') || 'text')
}

async function runGit(workspace: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['-c', 'core.quotePath=false', ...args], {
      cwd: workspace,
      timeout: 5000,
      maxBuffer: 10 * 1024 * 1024
    })
    return stdout
  } catch {
    return ''
  }
}

async function runGitStrict(workspace: string, args: string[]): Promise<{ ok: true; output: string } | { ok: false; detail: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('git', ['-c', 'core.quotePath=false', ...args], {
      cwd: workspace,
      timeout: 10000,
      maxBuffer: 10 * 1024 * 1024
    })
    return { ok: true, output: `${stdout}${stderr}` }
  } catch (error) {
    return { ok: false, detail: commandErrorMessage(error) }
  }
}

function commandErrorMessage(error: unknown): string {
  if (isObject(error)) {
    const stderr = stringValue(error.stderr)
    const stdout = stringValue(error.stdout)
    const message = stringValue(error.message)
    return stderr?.trim() || stdout?.trim() || message || 'git command failed'
  }
  return messageFromError(error)
}

function firstNonEmptyLine(value: string): string | null {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null
}

function parseGitWorktrees(output: string): Array<{
  path: string
  branch: string | null
  head: string | null
  bare: string | null
  detached: string | null
}> {
  const worktrees: Array<{
    path: string
    branch: string | null
    head: string | null
    bare: string | null
    detached: string | null
  }> = []
  let current: {
    path: string
    branch: string | null
    head: string | null
    bare: string | null
    detached: string | null
  } | null = null
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) {
      if (current) worktrees.push(current)
      current = null
      continue
    }
    const [key, ...rest] = line.split(' ')
    const value = rest.join(' ')
    if (key === 'worktree') current = { path: value, branch: null, head: null, bare: null, detached: null }
    if (!current) continue
    if (key === 'HEAD') current.head = value || null
    if (key === 'branch') current.branch = branchName(value)
    if (key === 'bare') current.bare = value || 'true'
    if (key === 'detached') current.detached = value || 'true'
  }
  if (current) worktrees.push(current)
  return worktrees
}

function branchName(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.replace(/^refs\/heads\//, '')
}

function projectDiffFiles(status: string, numstat: string, diff: string): ProjectDiffFile[] {
  const totalsByPath = numstatTotalsByPath(numstat)
  const files = statusLines(status).map((line) => {
    const statusCode = line.slice(0, 2)
    const rawPath = line.slice(3).trim()
    const renamed = rawPath.includes(' -> ')
    const path = renamed ? rawPath.split(' -> ').at(-1)!.trim() : rawPath
    const previousPath = renamed ? rawPath.split(' -> ')[0].trim() : null
    const totals = totalsByPath[path] ?? { additions: 0, deletions: 0 }
    return {
      path,
      status: projectDiffStatus(statusCode),
      additions: totals.additions,
      deletions: totals.deletions,
      ...(previousPath ? { previous_path: previousPath } : {}),
      ...(diff ? { diff: fileDiffSection(diff, path) } : {})
    }
  })
  return files
}

function statusLines(status: string): string[] {
  return status.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean)
}

function projectDiffStatus(statusCode: string): ProjectDiffFile['status'] {
  if (statusCode.includes('A') || statusCode.includes('?')) return 'added'
  if (statusCode.includes('D')) return 'deleted'
  if (statusCode.includes('R')) return 'renamed'
  if (statusCode.includes('C')) return 'copied'
  return 'modified'
}

function numstatTotalsByPath(numstat: string): Record<string, { additions: number; deletions: number }> {
  const totals: Record<string, { additions: number; deletions: number }> = {}
  for (const line of statusLines(numstat)) {
    const [additions, deletions, ...pathParts] = line.split(/\s+/)
    const path = pathParts.join(' ')
    if (!path) continue
    totals[path] = {
      additions: Number.parseInt(additions, 10) || 0,
      deletions: Number.parseInt(deletions, 10) || 0
    }
  }
  return totals
}

function diffTotals(numstat: string): { additions: number; deletions: number } {
  return Object.values(numstatTotalsByPath(numstat)).reduce(
    (total, item) => ({
      additions: total.additions + item.additions,
      deletions: total.deletions + item.deletions
    }),
    { additions: 0, deletions: 0 }
  )
}

function fileDiffSection(diff: string, path: string): string {
  const marker = `diff --git a/${path} b/${path}`
  const start = diff.indexOf(marker)
  if (start < 0) return ''
  const next = diff.indexOf('\ndiff --git ', start + marker.length)
  return next < 0 ? diff.slice(start) : diff.slice(start, next)
}

function emptyCodingSession(threadId: string): Record<string, unknown> {
  return {
    thread_id: threadId,
    project_root: null,
    scratch_root: null,
    skills: [],
    active_coding_skills: [],
    tool_policy: [],
    roi: {},
    change_summary: {},
    updated_at: null
  }
}

function codingSessionFromThread(runtime: ServerRuntime, threadId: string, thread: ThreadRecord | null): Record<string, unknown> {
  if (!thread) return emptyCodingSession(threadId)
  const activeSkillIds = activeSkillIdsFromThread(thread)
  const skills = activeSkillIds.map((id) => ({ id, name: id }))
  const toolPolicy = toolPolicyFromThread(thread)
  const roi = codingRoiReportFromThread(threadId, thread)
  return {
    ...emptyCodingSession(threadId),
    project_root: thread.workspace || null,
    scratch_root: threadRoot(runtime, threadId),
    skills,
    active_coding_skills: skills,
    tool_policy: toolPolicy,
    roi: roi?.summary ?? {},
    change_summary: changeSummaryFromThread(thread),
    updated_at: thread.updatedAt ?? null
  }
}

function activeSkillIdsFromThread(thread: ThreadRecord): string[] {
  const ids = new Set<string>()
  for (const turn of thread.turns) {
    for (const id of turn.activeSkillIds ?? []) {
      if (typeof id === 'string' && id.trim()) ids.add(id.trim())
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b))
}

function toolPolicyFromThread(thread: ThreadRecord): Array<Record<string, unknown>> {
  const tools = new Map<string, Record<string, unknown>>()
  for (const turn of thread.turns) {
    for (const item of turn.items) {
      if (item.kind !== 'tool_call') continue
      tools.set(item.toolName, {
        id: item.toolName,
        name: item.toolName,
        kind: item.toolKind
      })
    }
  }
  return [...tools.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)))
}

function changeSummaryFromThread(thread: ThreadRecord): Record<string, unknown> {
  const toolCalls = thread.turns.reduce(
    (count, turn) => count + turn.items.filter((item) => item.kind === 'tool_call').length,
    0
  )
  return {
    current_task: thread.turns.at(-1)?.prompt ?? '',
    turns: thread.turns.length,
    tool_calls: toolCalls
  }
}

function codingEventsFromThread(threadId: string, thread: ThreadRecord | null): Array<Record<string, unknown>> {
  if (!thread) return []
  const events: Array<Record<string, unknown>> = []
  for (const turn of thread.turns) {
    for (const item of turn.items) {
      if (item.kind === 'tool_call') {
        events.push({
          event_id: item.id,
          thread_id: threadId,
          task_id: turn.id,
          event_type: 'tool_call',
          tool_name: item.toolName,
          status: item.status,
          summary: item.summary ?? '',
          created_at: item.createdAt,
          finished_at: item.finishedAt ?? null,
          payload: item.arguments
        })
      } else if (item.kind === 'tool_result') {
        events.push({
          event_id: item.id,
          thread_id: threadId,
          task_id: turn.id,
          event_type: 'tool_result',
          tool_name: item.toolName,
          status: item.status,
          is_error: item.isError,
          created_at: item.createdAt,
          finished_at: item.finishedAt ?? null,
          payload: item.output
        })
      }
    }
  }
  return events.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
}

async function codingChangesFromThread(threadId: string, thread: ThreadRecord | null): Promise<Array<Record<string, unknown>>> {
  if (!thread?.workspace) return []
  const isRepo = await isGitRepository(thread.workspace)
  if (!isRepo) return []
  const [status, numstat] = await Promise.all([
    runGit(thread.workspace, ['status', '--porcelain']),
    runGit(thread.workspace, ['diff', '--numstat'])
  ])
  const stats = new Map<string, { additions: number; deletions: number }>()
  for (const line of statusLines(numstat)) {
    const [additions, deletions, ...rest] = line.split(/\s+/)
    const path = rest.join(' ')
    if (!path) continue
    stats.set(path, {
      additions: Number.parseInt(additions, 10) || 0,
      deletions: Number.parseInt(deletions, 10) || 0
    })
  }
  return statusLines(status).map((line) => {
    const path = line.slice(3).trim()
    const fileStats = stats.get(path) ?? { additions: 0, deletions: 0 }
    return {
      thread_id: threadId,
      task_id: thread.turns.at(-1)?.id ?? '',
      project_root: thread.workspace,
      path,
      status: line.slice(0, 2).trim() || 'modified',
      additions: fileStats.additions,
      deletions: fileStats.deletions,
      diff: '',
      created_at: thread.updatedAt
    }
  })
}

function codingRoiReportFromThread(threadId: string, thread: ThreadRecord | null): Record<string, unknown> | null {
  if (!thread) return null
  const skillInjectionBytes = thread.turns.reduce((sum, turn) => sum + (turn.skillInjectionBytes ?? 0), 0)
  const toolCatalogToolCount = thread.turns.reduce((sum, turn) => sum + (turn.toolCatalogToolCount ?? 0), 0)
  const actualTokens = Math.ceil(skillInjectionBytes / 4) + toolCatalogToolCount
  const estimatedSavedTokens = Math.ceil(skillInjectionBytes / 8)
  const estimatedBaselineTokens = actualTokens + estimatedSavedTokens
  return {
    report_id: `roi_${threadId}`,
    thread_id: threadId,
    created_at: thread.updatedAt,
    summary: {
      provider_usage: {
        total_tokens: actualTokens,
        skill_injection_bytes: skillInjectionBytes
      },
      tool_output: {
        tool_catalog_tool_count: toolCatalogToolCount
      },
      token_economy: {},
      derived: {
        actual_tokens: actualTokens,
        estimated_saved_tokens: estimatedSavedTokens,
        estimated_baseline_tokens: estimatedBaselineTokens,
        saving_ratio: estimatedBaselineTokens > 0 ? estimatedSavedTokens / estimatedBaselineTokens : 0,
        tool_hidden_ratio: 0,
        tool_catalog_saved_tokens: estimatedSavedTokens,
        tool_output_saved_tokens: 0,
        token_economy_saved_tokens: 0
      }
    }
  }
}

function codingRoiSummaryFromReport(threadId: string, report: Record<string, unknown> | null): Record<string, unknown> {
  const summary = isObject(report?.summary) ? report.summary : {}
  return {
    thread_id: threadId,
    report_count: report ? 1 : 0,
    latest: report,
    provider_usage: isObject(summary.provider_usage) ? summary.provider_usage : {},
    tool_output: isObject(summary.tool_output) ? summary.tool_output : {},
    token_economy: isObject(summary.token_economy) ? summary.token_economy : {},
    derived: isObject(summary.derived)
      ? summary.derived
      : {
          actual_tokens: 0,
          estimated_saved_tokens: 0,
          estimated_baseline_tokens: 0,
          saving_ratio: 0,
          tool_hidden_ratio: 0,
          tool_catalog_saved_tokens: 0,
          tool_output_saved_tokens: 0,
          token_economy_saved_tokens: 0
        }
  }
}

function parseAheadBehind(output: string): [behind: number, ahead: number] {
  const [behind, ahead] = output.trim().split(/\s+/).map((value) => Number.parseInt(value, 10) || 0)
  return [behind ?? 0, ahead ?? 0]
}

function projectEnvironmentResponse(
  project: KWorksProject,
  isGitRepo: boolean,
  git: {
    branch?: string | null
    head?: string | null
    upstream?: string | null
    ahead?: number
    behind?: number
    changedFiles?: number
    additions?: number
    deletions?: number
    remote?: string | null
  } = {}
): Record<string, unknown> {
  return {
    is_git_repo: isGitRepo,
    branch: git.branch ?? null,
    head: git.head ?? null,
    upstream: git.upstream ?? null,
    ahead: git.ahead ?? 0,
    behind: git.behind ?? 0,
    changed_files: git.changedFiles ?? 0,
    additions: git.additions ?? 0,
    deletions: git.deletions ?? 0,
    github_cli: {
      available: false,
      authenticated: false,
      username: null,
      host: null,
      detail: 'GitHub CLI status is not checked by the local project endpoint.'
    },
    source: {
      label: git.remote ?? project.path,
      remote: git.remote ?? null,
      provider: git.remote ? remoteProvider(git.remote) : 'local'
    }
  }
}

function remoteProvider(remote: string): string {
  if (remote.includes('github.com')) return 'github'
  if (remote.includes('gitlab.com')) return 'gitlab'
  if (remote.includes('bitbucket.org')) return 'bitbucket'
  return 'git'
}

async function isGitRepository(projectPath: string): Promise<boolean> {
  try {
    await stat(join(projectPath, '.git'))
    return true
  } catch {
    return false
  }
}

async function readCronConfig(
  runtime: ServerRuntime,
  request: Request
): Promise<{ ok: true; value: KWorksCronJobConfig } | { ok: false; response: JsonResponse | Response }> {
  const body = await readJsonBody(request)
  if (!body.ok) return { ok: false, response: body.response }
  if (!isObject(body.value)) {
    return { ok: false, response: jsonResponse({ detail: 'cron request body must be an object' }, 400) }
  }
  const cron = stringValue(body.value.cron)
  const prompt = stringValue(body.value.prompt)
  if (!cron) return { ok: false, response: jsonResponse({ detail: 'cron is required' }, 400) }
  if (!prompt) return { ok: false, response: jsonResponse({ detail: 'prompt is required' }, 400) }
  return {
    ok: true,
    value: {
      enabled: booleanValue(body.value.enabled) ?? true,
      cron,
      description: stringValue(body.value.description) ?? '',
      agent: stringValue(body.value.agent) ?? 'qiongqi',
      model: stringValue(body.value.model) ?? runtime.info().model ?? null,
      prompt
    }
  }
}

async function loadCronSnapshot(runtime: ServerRuntime): Promise<KWorksCronSnapshot> {
  try {
    const parsed = JSON.parse(await readFile(cronStorePath(runtime), 'utf-8')) as unknown
    if (!isObject(parsed) || !isObject(parsed.users)) return emptyCronSnapshot()
    const users: Record<string, Record<string, KWorksCronJobConfig>> = {}
    for (const [userId, jobs] of Object.entries(parsed.users)) {
      if (!isObject(jobs)) continue
      const normalizedJobs: Record<string, KWorksCronJobConfig> = {}
      for (const [name, value] of Object.entries(jobs)) {
        const normalized = normalizeCronJobConfig(value)
        if (normalized) normalizedJobs[name] = normalized
      }
      users[userId] = normalizedJobs
    }
    return { version: 1, users }
  } catch {
    return emptyCronSnapshot()
  }
}

function emptyCronSnapshot(): KWorksCronSnapshot {
  return { version: 1, users: {} }
}

function cronStorePath(runtime: ServerRuntime): string {
  return join(runtime.info().dataDir, 'kworks', 'crons.json')
}

async function cronJobsForActor(runtime: ServerRuntime, actor: AuthActor): Promise<Record<string, KWorksCronJobConfig>> {
  const owner = ownerUserId(actor)
  if (owner && runtime.kworksUserDataStore) {
    const saved = runtime.kworksUserDataStore
      ? await runtime.kworksUserDataStore.getUserSetting(owner, USER_SETTING_CRONS)
      : undefined
    const normalized = normalizeCronJobs(saved)
    if (Object.keys(normalized).length > 0) return normalized
  }
  const legacySnapshot = await loadCronSnapshot(runtime)
  return { ...(legacySnapshot.users[cronOwnerKey(actor)] ?? {}) }
}

async function saveCronJobsForActor(runtime: ServerRuntime, actor: AuthActor, jobs: Record<string, KWorksCronJobConfig>): Promise<void> {
  const owner = ownerUserId(actor)
  if (owner && runtime.kworksUserDataStore) {
    await runtime.kworksUserDataStore.setUserSetting(owner, USER_SETTING_CRONS, jobs)
    return
  }
  throw new Error('cron persistence requires an authenticated KWorks user')
}

function cronOwnerKey(actor: AuthActor): string {
  return ownerUserId(actor) ?? 'internal-runtime'
}

function normalizeCronJobs(value: unknown): Record<string, KWorksCronJobConfig> {
  if (!isObject(value)) return {}
  const jobs: Record<string, KWorksCronJobConfig> = {}
  for (const [name, raw] of Object.entries(value)) {
    const normalized = normalizeCronJobConfig(raw)
    if (normalized) jobs[name] = normalized
  }
  return jobs
}

function normalizeCronJobConfig(value: unknown): KWorksCronJobConfig | null {
  if (!isObject(value)) return null
  const cron = stringValue(value.cron)
  const prompt = stringValue(value.prompt)
  if (!cron || !prompt) return null
  return {
    enabled: booleanValue(value.enabled) ?? true,
    cron,
    description: stringValue(value.description) ?? '',
    agent: stringValue(value.agent) ?? 'qiongqi',
    model: stringValue(value.model) ?? null,
    prompt
  }
}

async function readRuntimeConfig(runtime: ServerRuntime): Promise<QiongqiConfig> {
  if (runtime.configStore) return QiongqiConfigSchema.parse(await runtime.configStore.read())
  const info = runtime.info()
  const model = info.model || 'default'
  return QiongqiConfigSchema.parse({
    serve: {
      host: info.host,
      port: info.port,
      dataDir: info.dataDir,
      runtimeToken: runtime.runtimeToken,
      model,
      approvalPolicy: info.approvalPolicy,
      sandboxMode: info.sandboxMode,
      insecure: info.insecure
    },
    models: {
      profiles: {
        [model]: {
          inputModalities: ['text'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text']
        }
      }
    }
  })
}

/**
 * Rename a legacy `task` work-mode entry to `office` in persisted skill configs.
 * Old per-user snapshots may carry `modes.task` alongside the new `modes.office`,
 * causing the UI to render two "日常办公" entries. This merges them: if both
 * exist, `office` wins (it's the current built-in); if only `task` exists, it's
 * renamed in place. `defaultModeId` is fixed up too.
 */
function normalizeLegacyTaskWorkMode(config: QiongqiConfig): QiongqiConfig {
  const skills = config.capabilities?.skills
  const workModes = skills?.workModes
  const modes = workModes?.modes as Record<string, WorkModeConfigValue> | undefined
  if (!modes || !('task' in modes)) return config

  const { task: _task, ...rest } = modes
  // If `office` already exists, drop the stale `task` entry; otherwise rename it.
  const nextModes: Record<string, WorkModeConfigValue> = 'office' in rest
    ? rest
    : { ...rest, office: { ..._task, id: 'office' } }
  const nextDefault = workModes!.defaultModeId === 'task' ? 'office' : workModes!.defaultModeId
  // Also fix up modeSkillOverrides: move any `task` overrides to `office`.
  const overrides = (skills?.modeSkillOverrides ?? {}) as SkillsConfig['modeSkillOverrides']
  const nextOverrides = 'task' in overrides
    ? { ...overrides, office: { ...(overrides.office ?? { addedSkillIds: [], removedSkillIds: [] }), ...overrides.task } }
    : overrides
  const { task: _dropOverride, ...cleanOverrides } = nextOverrides
  return {
    ...config,
    capabilities: {
      ...(config.capabilities ?? {}),
      skills: {
        ...skills!,
        workModes: { ...workModes!, defaultModeId: nextDefault, modes: nextModes },
        modeSkillOverrides: cleanOverrides
      }
    }
  }
}

/**
 * Ensure all built-in work modes from DEFAULT_WORK_MODES exist in the stored
 * config. Old per-user snapshots persisted before a new built-in mode (e.g.
 * `finance`) was added will be missing it — without this, the mode is invisible
 * to the SkillPluginHost and its skills never load.
 *
 * Only adds modes that are completely absent; it never overwrites a mode the
 * user has explicitly customized.
 */
function ensureBuiltinWorkModes(config: QiongqiConfig): QiongqiConfig {
  const skills = config.capabilities?.skills
  const workModes = skills?.workModes
  const modes = workModes?.modes
  if (!modes) return config
  const builtinIds = Object.keys(DEFAULT_WORK_MODES)
  const missing = builtinIds.filter((id) => !modes[id])
  if (missing.length === 0) return config
  const mergedModes = { ...modes }
  for (const id of missing) {
    const builtin = DEFAULT_WORK_MODES[id as keyof typeof DEFAULT_WORK_MODES]
    if (builtin) {
      mergedModes[id] = { ...builtin }
    }
  }
  return {
    ...config,
    capabilities: {
      ...(config.capabilities ?? {}),
      skills: {
        ...skills!,
        workModes: { ...workModes!, modes: mergedModes }
      }
    }
  }
}

async function readEffectiveRuntimeConfig(runtime: ServerRuntime, actor?: AuthActor): Promise<QiongqiConfig> {
  let config = await readUserScopedCapabilityConfig(runtime, await readRuntimeConfig(runtime), actor)
  // Skills are a core capability of the KWorks desktop app (enabled at startup
  // via KWorks_SKILLS_PATH). The live SkillPluginHost reflects the startup
  // intent — if it reports skills as enabled, per-user/per-section config
  // overrides (which can set enabled=false) must not be able to disable them.
  // Without this guard the model silently loses visibility of all work-mode-
  // bound skills ("运行时上下文中没有显式枚举技能列表").
  const liveSkills = await runtime.skillsV2?.()
  if (liveSkills?.enabled && config.capabilities?.skills && !config.capabilities.skills.enabled) {
    config = {
      ...config,
      capabilities: {
        ...(config.capabilities ?? {}),
        skills: { ...config.capabilities.skills, enabled: true }
      }
    }
  }
  // Normalize legacy work-mode id "task" → "office" in persisted per-user
  // skill configs. Old snapshots may still carry a `modes.task` entry; without
  // this, the frontend renders both `task` and `office` as separate "日常办公"
  // entries. Rename the key and fix defaultModeId so only one entry survives.
  config = normalizeLegacyTaskWorkMode(config)
  // Ensure all built-in work modes exist. Old per-user snapshots persisted
  // before a new built-in mode (e.g. `finance`) was added will be missing it —
  // without this, the mode and its skills are invisible at runtime.
  config = ensureBuiltinWorkModes(config)
  const owner = ownerUserId(actor)
  if (!owner || !runtime.kworksUserDataStore) return config
  const userModels = await runtime.kworksUserDataStore.listModelProfiles(owner)
  if (Object.keys(userModels.profiles).length === 0) {
    const { model: _model, ...serveWithoutModel } = config.serve ?? {}
    return {
      ...config,
      serve: serveWithoutModel,
      models: {
        ...(config.models ?? {}),
        profiles: {}
      }
    }
  }
  const activeModel = userModels.activeModel && userModels.profiles[userModels.activeModel]
    ? userModels.activeModel
    : undefined
  const activeProfile = activeModel ? userModels.profiles[activeModel] : undefined
  const {
    model: _model,
    baseUrl: _baseUrl,
    apiKey: _apiKey,
    endpointFormat: _endpointFormat,
    ...serveWithoutModelRoute
  } = config.serve ?? {}
  return {
    ...config,
    serve: {
      ...(activeModel ? (config.serve ?? {}) : serveWithoutModelRoute),
      ...(activeModel ? { model: activeModel } : {}),
      ...(activeProfile?.baseUrl ? { baseUrl: activeProfile.baseUrl } : {}),
      ...(activeProfile?.apiKey !== undefined ? { apiKey: activeProfile.apiKey } : {}),
      ...(activeProfile?.endpointFormat ? { endpointFormat: activeProfile.endpointFormat } : {})
    },
    models: {
      ...(config.models ?? {}),
      profiles: userModels.profiles
    }
  }
}

export async function syncRuntimeToolsForActor(runtime: ServerRuntime, actor?: AuthActor): Promise<void> {
  const current = await readRuntimeConfig(runtime)
  const config = await readUserScopedCapabilityConfig(runtime, current, actor)
  if (sameJson(current.capabilities, config.capabilities)) return
  await writeRuntimeConfig(runtime, config)
  await refreshRuntimeTools(runtime)
}

async function readUserScopedCapabilityConfig(
  runtime: ServerRuntime,
  config: QiongqiConfig,
  actor?: AuthActor
): Promise<QiongqiConfig> {
  const owner = ownerUserId(actor)
  if (!owner || !runtime.kworksUserDataStore) return config
  const savedMcp = await runtime.kworksUserDataStore.getUserSetting(owner, USER_SETTING_MCP)
  const savedMcpCompat = await runtime.kworksUserDataStore.getUserSetting(owner, USER_SETTING_MCP_COMPAT)
  const savedSkills = await runtime.kworksUserDataStore.getUserSetting(owner, USER_SETTING_SKILLS)
  const savedSkillsCompat = await runtime.kworksUserDataStore.getUserSetting(owner, USER_SETTING_SKILLS_COMPAT)
  const savedWeb = await runtime.kworksUserDataStore.getUserSetting(owner, USER_SETTING_WEB)
  return userCapabilityConfigFromSettings(config, {
    mcp: savedMcp,
    mcpCompat: savedMcpCompat,
    skills: savedSkills,
    skillsCompat: savedSkillsCompat,
    web: savedWeb
  })
}

function userCapabilityConfigFromSettings(
  config: QiongqiConfig,
  settings: {
    mcp?: unknown
    mcpCompat?: unknown
    skills?: unknown
    skillsCompat?: unknown
    web?: unknown
  }
): QiongqiConfig {
  let next: QiongqiConfig = {
    ...config,
    capabilities: { ...(config.capabilities ?? DEFAULT_QIONGQI_CAPABILITIES_CONFIG) }
  }
  const parsedMcp = parseCapabilitySection(next, 'mcp', settings.mcp)
  if (parsedMcp.ok && parsedMcp.present) {
    next = parsedMcp.config
  } else if (isObject(settings.mcpCompat)) {
    next = {
      ...next,
      capabilities: {
        ...(next.capabilities ?? {}),
        mcp: mcpCapabilityFromCompat(
          normalizeMcpConfig(settings.mcpCompat),
          next.capabilities?.mcp ?? DEFAULT_QIONGQI_CAPABILITIES_CONFIG.mcp
        )
      }
    }
  }

  const parsedSkills = parseCapabilitySection(next, 'skills', settings.skills)
  if (parsedSkills.ok && parsedSkills.present) {
    next = parsedSkills.config
  } else if (isObject(settings.skillsCompat)) {
    next = {
      ...next,
      capabilities: {
        ...(next.capabilities ?? {}),
        skills: skillsCapabilityFromCompat(
          normalizeSkillCompat(settings.skillsCompat),
          next.capabilities?.skills ?? DEFAULT_QIONGQI_CAPABILITIES_CONFIG.skills
        )
      }
    }
  }

  const parsedWeb = parseCapabilitySection(next, 'web', settings.web)
  if (parsedWeb.ok && parsedWeb.present) next = parsedWeb.config
  return next
}

async function writeUserScopedCapabilityConfig(
  runtime: ServerRuntime,
  config: QiongqiConfig,
  actor?: AuthActor,
  section?: string
): Promise<{ ok: true; saved: boolean } | { ok: false; response: JsonResponse }> {
  const owner = ownerUserId(actor)
  if (!owner || !runtime.kworksUserDataStore) return { ok: true, saved: false }
  const saves: Array<Promise<void>> = []
  const saveMcp = section === undefined || section === 'mcp' || section === 'mcp_servers' || section === 'capabilities'
  const saveWeb = section === undefined || section === 'web' || section === 'capabilities'
  const saveSkills = section === undefined || section === 'skills' || section === 'capabilities'

  if (saveMcp && config.capabilities?.mcp) {
    const parsed = parseCapabilitySection(config, 'mcp', config.capabilities.mcp)
    if (!parsed.ok) return { ok: false, response: parsed.response }
    saves.push(runtime.kworksUserDataStore.setUserSetting(owner, USER_SETTING_MCP, config.capabilities.mcp))
    const compat = mcpCompatFromConfig(config)
    saves.push(runtime.kworksUserDataStore.setUserSetting(owner, USER_SETTING_MCP_COMPAT, compat))
  }
  if (saveWeb && config.capabilities?.web) {
    const parsed = parseCapabilitySection(config, 'web', config.capabilities.web)
    if (!parsed.ok) return { ok: false, response: parsed.response }
    saves.push(runtime.kworksUserDataStore.setUserSetting(owner, USER_SETTING_WEB, config.capabilities.web))
  }
  if (saveSkills && config.capabilities?.skills) {
    const parsed = parseCapabilitySection(config, 'skills', config.capabilities.skills)
    if (!parsed.ok) return { ok: false, response: parsed.response }
    saves.push(runtime.kworksUserDataStore.setUserSetting(owner, USER_SETTING_SKILLS, config.capabilities.skills))
    saves.push(runtime.kworksUserDataStore.setUserSetting(
      owner,
      USER_SETTING_SKILLS_COMPAT,
      skillCompatFromCapability(config.capabilities.skills)
    ))
  }
  await Promise.all(saves)
  return { ok: true, saved: saves.length > 0 }
}

function parseCapabilitySection(
  config: QiongqiConfig,
  section: 'mcp' | 'skills' | 'web',
  data: unknown
): { ok: true; present: false; config: QiongqiConfig } | { ok: true; present: true; config: QiongqiConfig } | { ok: false; response: JsonResponse } {
  if (!isObject(data)) return { ok: true, present: false, config }
  const parsed = parseQiongqiConfig(withSectionValue(config, section, data))
  if (!parsed.ok) return parsed
  return { ok: true, present: true, config: parsed.config }
}

async function refreshRuntimeTools(runtime: ServerRuntime): Promise<void> {
  await (runtime.refreshRuntimeTools?.() ?? runtime.refreshMcpTools?.())
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

async function ensureUserModelProfile(runtime: ServerRuntime, actor: AuthActor, name: string): Promise<QiongqiConfig> {
  const config = await readEffectiveRuntimeConfig(runtime, actor)
  if (config.models?.profiles?.[name]) return config

  const owner = ownerUserId(actor)
  if (!owner || !runtime.kworksUserDataStore) return config

  const globalConfig = await readRuntimeConfig(runtime)
  const globalProfile = globalConfig.models?.profiles?.[name]
  if (!globalProfile) return config

  const secret = typeof globalProfile.apiKey === 'string' && !isRedactedSecret(globalProfile.apiKey)
    ? { apiKey: globalProfile.apiKey }
    : {}
  await runtime.kworksUserDataStore.saveModelProfile(owner, name, globalProfile, secret)
  return readEffectiveRuntimeConfig(runtime, actor)
}

async function writeRuntimeConfig(runtime: ServerRuntime, config: QiongqiConfig): Promise<QiongqiConfig> {
  const parsed = QiongqiConfigSchema.parse(config)
  if (!runtime.configStore) return parsed
  return QiongqiConfigSchema.parse(await runtime.configStore.write(parsed))
}

function parseQiongqiConfig(value: unknown): { ok: true; config: QiongqiConfig } | { ok: false; response: JsonResponse } {
  const parsed = QiongqiConfigSchema.safeParse(value)
  if (parsed.success) return { ok: true, config: parsed.data }
  return {
    ok: false,
    response: jsonResponse({
      detail: `Invalid QiongQi config: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
      issues: parsed.error.issues
    }, 400)
  }
}

async function writeUserScopedModelConfig(
  runtime: ServerRuntime,
  config: QiongqiConfig,
  actor?: AuthActor,
  section?: string
): Promise<boolean> {
  const owner = ownerUserId(actor)
  if (!owner || !runtime.kworksUserDataStore) return false
  if (section !== undefined && section !== 'models' && section !== 'serve') return false

  const profiles = config.models?.profiles ?? {}
  const current = await runtime.kworksUserDataStore.listModelProfiles(owner)
  for (const name of Object.keys(current.profiles)) {
    if (!profiles[name]) await runtime.kworksUserDataStore.deleteModelProfile(owner, name)
  }
  for (const [name, profile] of Object.entries(profiles)) {
    const existing = current.profiles[name] ?? {}
    const secret = typeof profile.apiKey === 'string' && !isRedactedSecret(profile.apiKey)
      ? { apiKey: profile.apiKey }
      : typeof existing.apiKey === 'string' && isRedactedSecret(String(profile.apiKey ?? ''))
        ? { apiKey: existing.apiKey }
        : {}
    await runtime.kworksUserDataStore.saveModelProfile(owner, name, profile, secret)
  }
  const activeModel = config.serve?.model
  if (activeModel && profiles[activeModel]) {
    await runtime.kworksUserDataStore.activateModelProfile(owner, activeModel)
  }
  return true
}

function normalizeConfigForWrite(value: unknown): unknown {
  if (!isObject(value)) return value
  const config = value as Record<string, unknown>
  const out: Record<string, unknown> = { ...config }

  if (isObject(out.serve)) {
    const { sandboxMode: _sandboxMode, ...serveWithoutSandbox } = out.serve
    out.serve = omitEmptyOptionalStrings(serveWithoutSandbox, [
      'model',
      'baseUrl',
      'apiKey',
      'runtimeToken',
      'dataDir'
    ])
  }

  if (isObject(out.models)) {
    const models = { ...out.models }
    if (isObject(models.profiles)) {
      const profiles: Record<string, unknown> = {}
      for (const [name, rawProfile] of Object.entries(models.profiles)) {
        profiles[name] = isObject(rawProfile)
          ? omitEmptyOptionalStrings(rawProfile, ['providerModel', 'baseUrl', 'apiKey', 'endpointFormat'])
          : rawProfile
      }
      models.profiles = profiles
    }
    out.models = models
  }

  return out
}

function omitEmptyOptionalStrings(
  value: Record<string, unknown>,
  keys: readonly string[]
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...value }
  for (const key of keys) {
    if (typeof out[key] === 'string' && out[key].trim() === '') delete out[key]
  }
  return out
}

function modelsFromConfig(config: QiongqiConfig): Record<string, unknown>[] {
  const profiles = config.models?.profiles ?? {}
  const out = Object.entries(profiles).map(([name, profile]) => modelFromProfile(name, profile, config))
  const serveModel = config.serve?.model
  if (serveModel && !out.some((model) => model.name === serveModel)) {
    out.unshift(modelFromProfile(serveModel, {}, config))
  }
  return out
}

function modelFromProfile(
  name: string,
  profile: NonNullable<NonNullable<QiongqiConfig['models']>['profiles']>[string],
  config: QiongqiConfig
): Record<string, unknown> {
  const inferred = inferModelCapabilityDefaults(
    typeof profile.providerModel === 'string' && profile.providerModel.trim()
      ? profile.providerModel
      : name,
    [name, ...(Array.isArray(profile.aliases) ? profile.aliases : [])]
  )
  const inputModalities = profile.inputModalities ?? inferred.inputModalities
  const outputModalities = profile.outputModalities ?? inferred.outputModalities
  const messageParts = profile.messageParts ?? inferred.messageParts
  const model = profile.providerModel ?? name
  const baseUrl = profile.baseUrl ?? (config.serve?.model === name ? config.serve?.baseUrl : null) ?? null
  const endpointFormat = profile.endpointFormat ?? (config.serve?.model === name ? config.serve?.endpointFormat : undefined)
  const supportsToolCalling = profile.supportsToolCalling ?? true
  const compatibility = compatibilityProfileForModel({
    baseUrl: baseUrl ?? '',
    model,
    endpointFormat,
    supportsToolCalling
  })
  return {
    id: name,
    name,
    use: 'qiongqi',
    model,
    display_name: name,
    description: 'QiongQi model profile',
    api_key: profile.apiKey ?? (config.serve?.model === name ? config.serve?.apiKey : null) ?? null,
    base_url: baseUrl,
    endpoint_format: endpointFormat,
    active: config.serve?.model === name,
    aliases: profile.aliases ?? [],
    context_window_tokens: profile.contextWindowTokens ?? null,
    context_compaction: profile.contextCompaction ?? null,
    input_modalities: inputModalities,
    output_modalities: outputModalities,
    supports_tool_calling: supportsToolCalling,
    message_parts: messageParts,
    supports_vision: inputModalities.includes('image'),
    supports_thinking: true,
    supports_reasoning_effort: compatibility.supportsReasoningEffort,
    reasoning_effort_values: ['auto', 'off', 'low', 'medium', 'high', 'max'],
    provider_compatibility: {
      provider: compatibility.provider,
      thinking_dialect: compatibility.thinkingDialect,
      tool_call_protocol: compatibility.toolCallProtocol,
      request_flags: {
        deepseek_thinking: compatibility.requestFlags.deepseekThinking,
        reasoning_split: compatibility.requestFlags.reasoningSplit,
        zai_tool_stream: compatibility.requestFlags.zaiToolStream
      },
      fold_tool_history: compatibility.foldToolHistory,
      requires_assistant_content_for_tool_calls: compatibility.requiresAssistantContentForToolCalls,
      requires_user_message: compatibility.requiresUserMessage,
      requires_strict_alternation: compatibility.requiresStrictAlternation
    },
    compatibility_warnings: compatibility.warnings
  }
}

async function upsertModelProfile(
  runtime: ServerRuntime,
  value: Record<string, unknown>,
  actor?: AuthActor
): Promise<{ ok: true; model: Record<string, unknown> } | { ok: false; response: JsonResponse }> {
  const config = await readEffectiveRuntimeConfig(runtime, actor)
  const modelId = stringValue(value.model) ?? runtime.info().model ?? 'default'
  const name = stringValue(value.name) ?? modelId
  if (!name || !modelId) return { ok: false, response: jsonResponse({ detail: 'model name and model are required' }, 400) }
  const existing = config.models?.profiles?.[name] ?? {}
  const inputModalities = stringList(value.inputModalities) ?? stringList(value.input_modalities)
  const outputModalities = stringList(value.outputModalities) ?? stringList(value.output_modalities)
  const messageParts = stringList(value.messageParts) ?? stringList(value.message_parts)
  const supportsToolCalling = booleanValue(value.supportsToolCalling) ?? booleanValue(value.supports_tool_calling)
  const contextWindowTokens = numberValue(value.contextWindowTokens) ?? numberValue(value.context_window_tokens)
  const inferred = inferModelCapabilityDefaults(modelId, [name])
  const profile = {
    ...existing,
    ...(stringList(value.aliases) ? { aliases: stringList(value.aliases) } : {}),
    ...(contextWindowTokens ? { contextWindowTokens } : {}),
    ...(isObject(value.contextCompaction) ? { contextCompaction: value.contextCompaction } : {}),
    ...(isObject(value.context_compaction) ? { contextCompaction: value.context_compaction } : {}),
    ...(inputModalities ? { inputModalities } : { inputModalities: inferred.inputModalities }),
    ...(outputModalities ? { outputModalities } : { outputModalities: inferred.outputModalities }),
    ...(supportsToolCalling !== undefined ? { supportsToolCalling } : {}),
    ...(messageParts ? { messageParts } : { messageParts: inferred.messageParts }),
    providerModel: modelId,
    ...(typeof value.baseUrl === 'string' || typeof value.base_url === 'string'
      ? { baseUrl: stringValue(value.baseUrl) ?? stringValue(value.base_url) }
      : {}),
    ...secretUpdate(value.apiKey, value.api_key, existing.apiKey),
    ...(typeof value.endpointFormat === 'string' || typeof value.endpoint_format === 'string'
      ? { endpointFormat: stringValue(value.endpointFormat) ?? stringValue(value.endpoint_format) }
      : {})
  }
  const parsed = parseQiongqiConfig({
    ...config,
    models: {
      ...(config.models ?? {}),
      profiles: {
        ...(config.models?.profiles ?? {}),
        [name]: profile
      }
    }
  })
  if (!parsed.ok) return parsed
  const owner = ownerUserId(actor)
  if (owner && runtime.kworksUserDataStore) {
    const secret = secretUpdate(value.apiKey, value.api_key, existing.apiKey)
    await runtime.kworksUserDataStore.saveModelProfile(owner, name, parsed.config.models?.profiles?.[name] ?? {}, secret.apiKey !== undefined ? { apiKey: secret.apiKey } : {})
    const saved = await readEffectiveRuntimeConfig(runtime, actor)
    return { ok: true, model: modelFromProfile(name, saved.models?.profiles?.[name] ?? {}, saved) }
  }
  const saved = await writeRuntimeConfig(runtime, parsed.config)
  return { ok: true, model: modelFromProfile(name, saved.models?.profiles?.[name] ?? {}, saved) }
}

function sectionValue(config: QiongqiConfig, section: string): unknown {
  switch (section) {
    case 'serve': return config.serve ?? {}
    case 'models': return config.models ?? { profiles: {} }
    case 'contextCompaction':
    case 'summarization': return config.contextCompaction ?? {}
    case 'runtime': return config.runtime ?? {}
    case 'capabilities': return config.capabilities
    case 'storage':
    case 'database': return config.serve?.storage ?? { backend: 'hybrid' }
    case 'observability':
    case 'run_events': return config.serve?.observability ?? {}
    case 'token_economy': return config.serve?.tokenEconomy ?? {}
    case 'uploads':
    case 'attachments': return config.capabilities?.attachments ?? {}
    case 'mcp':
    case 'mcp_servers': return config.capabilities?.mcp ?? {}
    case 'web': return config.capabilities?.web ?? {}
    case 'skills': return config.capabilities?.skills ?? {}
    case 'subagents':
    case 'collaboration': return config.capabilities?.subagents ?? {}
    default: return null
  }
}

function withSectionValue(config: QiongqiConfig, section: string, data: unknown): unknown {
  switch (section) {
    case 'serve': return { ...config, serve: isObject(data) ? data : {} }
    case 'models': return { ...config, models: isObject(data) ? data : { profiles: {} } }
    case 'contextCompaction':
    case 'summarization': return { ...config, contextCompaction: isObject(data) ? data : {} }
    case 'runtime': return { ...config, runtime: isObject(data) ? data : {} }
    case 'capabilities': return { ...config, capabilities: isObject(data) ? data : {} }
    case 'storage':
    case 'database': return { ...config, serve: { ...(config.serve ?? {}), storage: isObject(data) ? data : {} } }
    case 'observability':
    case 'run_events': return { ...config, serve: { ...(config.serve ?? {}), observability: isObject(data) ? data : {} } }
    case 'token_economy': return { ...config, serve: { ...(config.serve ?? {}), tokenEconomy: isObject(data) ? data : {} } }
    case 'uploads':
    case 'attachments': return { ...config, capabilities: { ...(config.capabilities ?? {}), attachments: isObject(data) ? data : {} } }
    case 'mcp':
    case 'mcp_servers': return { ...config, capabilities: { ...(config.capabilities ?? {}), mcp: isObject(data) ? data : {} } }
    case 'web': return { ...config, capabilities: { ...(config.capabilities ?? {}), web: isObject(data) ? data : {} } }
    case 'skills': return { ...config, capabilities: { ...(config.capabilities ?? {}), skills: isObject(data) ? data : {} } }
    case 'subagents':
    case 'collaboration': return { ...config, capabilities: { ...(config.capabilities ?? {}), subagents: isObject(data) ? data : {} } }
    default: return config
  }
}

function usesRuntimeSectionWrite(section: string): boolean {
  return [
    'mcp',
    'mcp_servers',
    'web',
    'skills',
    'capabilities',
    'subagents',
    'collaboration'
  ].includes(section)
}

function isBuiltInAttachmentsSection(section: string): boolean {
  return section === 'attachments' || section === 'uploads'
}

function isUnsupportedKWorksConfigSection(section: string): boolean {
  return section === 'sandbox'
}

function redactConfigForResponse(config: QiongqiConfig): QiongqiConfig {
  return redactValueForResponse(config) as QiongqiConfig
}

function redactValueForResponse(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValueForResponse)
  if (!isObject(value)) return value
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === 'sandboxMode') {
      continue
    } else if (key === 'apiKey' || key === 'api_key' || key.toLowerCase().includes('token')) {
      out[key] = typeof item === 'string' && item.length > 0 ? '********' : item
    } else {
      out[key] = redactValueForResponse(item)
    }
  }
  return out
}

function secretUpdate(camelValue: unknown, snakeValue: unknown, existing: unknown): { apiKey?: string } {
  const candidate = typeof camelValue === 'string' ? camelValue : typeof snakeValue === 'string' ? snakeValue : undefined
  if (candidate === undefined) return {}
  if (isRedactedSecret(candidate)) return typeof existing === 'string' ? { apiKey: existing } : {}
  return { apiKey: candidate }
}

function restoreRedactedSecrets(next: unknown, current: unknown): unknown {
  if (Array.isArray(next)) {
    const currentArray = Array.isArray(current) ? current : []
    return next.map((item, index) => restoreRedactedSecrets(item, currentArray[index]))
  }
  if (!isObject(next)) return next
  const currentObject = isObject(current) ? current : {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(next)) {
    const currentValue = currentObject[key]
    if (isSecretKey(key) && typeof value === 'string' && isRedactedSecret(value)) {
      out[key] = currentValue
    } else {
      out[key] = restoreRedactedSecrets(value, currentValue)
    }
  }
  return out
}

function isSecretKey(key: string): boolean {
  return key === 'apiKey' || key === 'api_key' || key.toLowerCase().includes('token')
}

function isRedactedSecret(value: string): boolean {
  const trimmed = value.trim()
  return /^\*{3,}$/.test(trimmed) || trimmed === '<redacted>'
}

type SkillCompatConfig = Record<string, { enabled: boolean }>

function normalizeMcpConfig(value: unknown): { mcp_servers: Record<string, Record<string, unknown>>; skills: SkillCompatConfig } {
  const source = isObject(value) ? value : {}
  const rawServers = isObject(source.mcp_servers)
    ? source.mcp_servers
    : isObject(source.mcpServers)
      ? source.mcpServers
      : isObject(source.servers)
        ? source.servers
        : {}
  const mcp_servers: Record<string, Record<string, unknown>> = {}
  for (const [name, rawConfig] of Object.entries(rawServers)) {
    if (!isObject(rawConfig)) continue
    const type = stringValue(rawConfig.type) ?? 'stdio'
    const config: Record<string, unknown> = {
      enabled: booleanValue(rawConfig.enabled) ?? true,
      type,
      description: stringValue(rawConfig.description) ?? ''
    }
    const transport = stringValue(rawConfig.transport)
    config.transport = transport ?? type
    const command = stringValue(rawConfig.command)
    if (command !== undefined) config.command = command
    if (Array.isArray(rawConfig.args)) {
      config.args = rawConfig.args.filter((item): item is string => typeof item === 'string')
    }
    if (isObject(rawConfig.env)) config.env = stringRecord(rawConfig.env)
    const url = stringValue(rawConfig.url)
    if (url !== undefined) config.url = url
    if (isObject(rawConfig.headers)) config.headers = stringRecord(rawConfig.headers)
    const trustScope = stringValue(rawConfig.trustScope)
    if (trustScope !== undefined) config.trustScope = trustScope
    const trustedWorkspaceRoots = stringList(rawConfig.trustedWorkspaceRoots)
    if (trustedWorkspaceRoots !== undefined) config.trustedWorkspaceRoots = trustedWorkspaceRoots
    const timeoutMs = numberValue(rawConfig.timeoutMs)
    if (timeoutMs !== undefined) config.timeoutMs = timeoutMs
    mcp_servers[name] = config
  }
  return { mcp_servers, skills: normalizeSkillCompat(source.skills) }
}

function normalizeSkillCompat(value: unknown): SkillCompatConfig {
  if (!isObject(value)) return {}
  const out: SkillCompatConfig = {}
  for (const [name, raw] of Object.entries(value)) {
    if (typeof raw === 'boolean') {
      out[name] = { enabled: raw }
    } else if (isObject(raw)) {
      out[name] = { enabled: booleanValue(raw.enabled) ?? true }
    }
  }
  return out
}

function skillCompatFromCapability(
  value: NonNullable<NonNullable<QiongqiConfig['capabilities']>['skills']>
): SkillCompatConfig {
  const out: SkillCompatConfig = {}
  for (const [name, enabled] of Object.entries(value.enabledSkills ?? {})) {
    out[name] = { enabled }
  }
  return out
}

function mcpCompatFromConfig(config: QiongqiConfig): { mcp_servers: Record<string, Record<string, unknown>>; skills: SkillCompatConfig } {
  const servers = config.capabilities?.mcp?.servers ?? {}
  const mcp_servers: Record<string, Record<string, unknown>> = {}
  for (const [name, server] of Object.entries(servers)) {
    mcp_servers[name] = {
      enabled: server.enabled,
      transport: server.transport,
      command: server.command,
      args: server.args,
      url: server.url,
      headers: server.headers,
      env: server.env,
      trustScope: server.trustScope,
      trustedWorkspaceRoots: server.trustedWorkspaceRoots,
      timeoutMs: server.timeoutMs
    }
  }
  return { mcp_servers, skills: normalizeSkillCompat(config.capabilities?.skills?.enabledSkills) }
}

function mcpCompatResponse(config: { mcp_servers: Record<string, Record<string, unknown>>; skills?: SkillCompatConfig }): {
  mcp_servers: Record<string, Record<string, unknown>>
  mcpServers: Record<string, Record<string, unknown>>
  skills: SkillCompatConfig
} {
  const mcpServers: Record<string, Record<string, unknown>> = {}
  for (const [name, server] of Object.entries(config.mcp_servers)) {
    mcpServers[name] = {
      ...server,
      type: stringValue(server.transport) ?? stringValue(server.type) ?? 'stdio'
    }
  }
  return {
    mcp_servers: config.mcp_servers,
    mcpServers,
    skills: normalizeSkillCompat(config.skills)
  }
}

function mcpCapabilityFromCompat(
  value: { mcp_servers: Record<string, Record<string, unknown>> },
  current: NonNullable<NonNullable<QiongqiConfig['capabilities']>['mcp']>
): NonNullable<NonNullable<QiongqiConfig['capabilities']>['mcp']> {
  const servers: Record<string, McpServerConfig> = {}
  for (const [name, raw] of Object.entries(value.mcp_servers)) {
    const transport = transportFromCompat(raw)
    servers[name] = {
      enabled: booleanValue(raw.enabled) ?? true,
      transport,
      ...(transport === 'stdio' ? { command: stringValue(raw.command) ?? 'npx' } : {}),
      ...(transport !== 'stdio' ? { url: stringValue(raw.url) ?? 'http://127.0.0.1' } : {}),
      args: Array.isArray(raw.args) ? raw.args.filter((item): item is string => typeof item === 'string') : [],
      headers: isObject(raw.headers) ? stringRecord(raw.headers) : {},
      env: isObject(raw.env) ? stringRecord(raw.env) : {},
      trustScope: stringValue(raw.trustScope) === 'user' ? 'user' : 'workspace',
      trustedWorkspaceRoots: stringList(raw.trustedWorkspaceRoots) ?? [process.cwd()],
      timeoutMs: numberValue(raw.timeoutMs) ?? 30_000
    }
  }
  return {
    enabled: current.enabled || Object.values(servers).some((server) => server.enabled),
    servers,
    search: current.search ?? DEFAULT_QIONGQI_CAPABILITIES_CONFIG.mcp.search
  }
}

async function syncSkillsCompatToRuntimeConfig(
  runtime: ServerRuntime,
  skills: SkillCompatConfig
): Promise<{ ok: true; config: QiongqiConfig } | { ok: false; response: JsonResponse }> {
  const current = await readRuntimeConfig(runtime)
  const parsed = parseQiongqiConfig({
    ...current,
    capabilities: {
      ...(current.capabilities ?? {}),
      skills: skillsCapabilityFromCompat(
        skills,
        current.capabilities?.skills ?? DEFAULT_QIONGQI_CAPABILITIES_CONFIG.skills
      )
    }
  })
  if (!parsed.ok) return parsed
  return { ok: true, config: await writeRuntimeConfig(runtime, parsed.config) }
}

function skillsCapabilityFromCompat(
  value: SkillCompatConfig | undefined,
  current: NonNullable<NonNullable<QiongqiConfig['capabilities']>['skills']>
): NonNullable<NonNullable<QiongqiConfig['capabilities']>['skills']> {
  const enabledSkills: Record<string, boolean> = { ...(current.enabledSkills ?? {}) }
  for (const [name, skill] of Object.entries(normalizeSkillCompat(value))) {
    enabledSkills[name] = skill.enabled
  }
  return {
    ...current,
    enabled: current.enabled || Object.keys(enabledSkills).length > 0,
    enabledSkills
  }
}

async function syncSkillsCapabilityToRuntimeConfig(
  runtime: ServerRuntime,
  owner: string | undefined,
  skills: NonNullable<NonNullable<QiongqiConfig['capabilities']>['skills']>
): Promise<{ ok: true; config: QiongqiConfig } | { ok: false; response: JsonResponse }> {
  const current = await readRuntimeConfig(runtime)
  const parsed = parseQiongqiConfig({
    ...current,
    capabilities: {
      ...(current.capabilities ?? {}),
      skills
    }
  })
  if (!parsed.ok) return parsed
  const saved = await writeRuntimeConfig(runtime, parsed.config)
  if (owner && runtime.kworksUserDataStore) {
    await runtime.kworksUserDataStore.setUserSetting(owner, USER_SETTING_SKILLS, saved.capabilities?.skills)
    await runtime.kworksUserDataStore.setUserSetting(
      owner,
      USER_SETTING_SKILLS_COMPAT,
      skillCompatFromCapability(saved.capabilities?.skills ?? skills)
    )
  }
  return { ok: true, config: saved }
}

function transportFromCompat(raw: Record<string, unknown>): McpServerConfig['transport'] {
  const value = stringValue(raw.transport) ?? stringValue(raw.type) ?? 'stdio'
  if (value === 'streamable-http' || value === 'sse') return value
  return 'stdio'
}

async function kworksSkillEntries(runtime: ServerRuntime, state: SkillCompatConfig): Promise<Array<Record<string, unknown>>> {
  const diagnostics = await runtime.skills?.()
  const diagnosticsV2 = await runtime.skillsV2?.()
  const rawSkills = diagnosticsV2?.skills ?? diagnostics?.skills ?? []
  return rawSkills
    .map((skill) => kworksSkillEntry(skill as Record<string, unknown>, state))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
}

type SkillsConfig = NonNullable<NonNullable<QiongqiConfig['capabilities']>['skills']>
type WorkModeConfigValue = SkillsConfig['workModes']['modes'][string]

type ParsedSkillCreateRequest = {
  id: string
  name: string
  description: string
  trigger: string
  output: string
  procedure: string | undefined
  examples: string[]
  workModeId: string | undefined
  install: boolean
}

function parseSkillCreateRequestBody(
  value: unknown
): { ok: true; skill: ParsedSkillCreateRequest } | { ok: false; response: JsonResponse } {
  if (!isObject(value)) {
    return { ok: false, response: jsonResponse({ detail: 'skill create request body must be an object' }, 400) }
  }

  const id = stringValue(value.id) ?? stringValue(value.skill_id) ?? stringValue(value.skillId)
  if (!id) return { ok: false, response: jsonResponse({ detail: 'id is required' }, 400) }
  if (!isValidCustomSkillId(id)) {
    return {
      ok: false,
      response: jsonResponse({
        detail: 'id must start with a lowercase English letter or number and contain only lowercase English letters, numbers, or hyphens'
      }, 400)
    }
  }

  const name = stringValue(value.name)
  if (!name) return { ok: false, response: jsonResponse({ detail: 'name is required' }, 400) }
  const description = stringValue(value.description)
  if (!description) return { ok: false, response: jsonResponse({ detail: 'description is required' }, 400) }
  const trigger = stringValue(value.trigger) ?? stringValue(value.whenToUse) ?? stringValue(value.when_to_use)
  if (!trigger) return { ok: false, response: jsonResponse({ detail: 'trigger is required' }, 400) }
  const output = stringValue(value.output) ?? stringValue(value.outputContract) ?? stringValue(value.output_contract)
  if (!output) return { ok: false, response: jsonResponse({ detail: 'output is required' }, 400) }

  const examples = stringList(value.examples)
    ?.map((item) => item.trim())
    .filter(Boolean) ?? []

  return {
    ok: true,
    skill: {
      id,
      name,
      description,
      trigger,
      output,
      procedure: stringValue(value.procedure) ?? stringValue(value.steps),
      examples,
      workModeId: normalizeWorkModeId(stringValue(value.workModeId) ?? stringValue(value.work_mode_id)),
      install: booleanValue(value.install) ?? true
    }
  }
}

async function enableUserSkillForActor(
  runtime: ServerRuntime,
  actor: AuthActor | undefined,
  skillId: string,
  requestedWorkModeId: string | undefined
): Promise<{ ok: true; workModeId: string; skills: SkillsConfig } | { ok: false; response: JsonResponse }> {
  const config = await readEffectiveRuntimeConfig(runtime, actor)
  const currentSkills = config.capabilities?.skills ?? DEFAULT_QIONGQI_CAPABILITIES_CONFIG.skills
  const installRoot = customSharedSkillRoot(runtime)
  const roots = new Set(currentSkills.roots ?? [])
  roots.add(installRoot)
  const withRoot: SkillsConfig = {
    ...currentSkills,
    enabled: true,
    roots: [...roots].sort((a, b) => a.localeCompare(b)),
    enabledSkills: {
      ...(currentSkills.enabledSkills ?? {}),
      [skillId]: true
    }
  }
  const workModeId = requestedWorkModeId && withRoot.workModes.modes[requestedWorkModeId]
    ? requestedWorkModeId
    : withRoot.workModes.defaultModeId
  const updated = updateModeSkillOverride(withRoot, workModeId, skillId, 'add')
  if (!updated.ok) return updated
  const synced = await syncSkillsCapabilityToRuntimeConfig(runtime, ownerUserId(actor), updated.skills)
  if (!synced.ok) return synced
  await refreshRuntimeTools(runtime)
  return { ok: true, workModeId, skills: updated.skills }
}

function skillManifestForCreatedSkill(skill: ParsedSkillCreateRequest): Record<string, unknown> {
  return {
    specVersion: '1.0',
    id: skill.id,
    name: skill.name,
    description: skill.description,
    version: '0.1.0',
    entry: 'SKILL.md',
    category: 'workflow',
    activation: {
      commands: [],
      promptPatterns: [escapeRegExp(skill.trigger)],
      fileTypes: [],
      autoActivate: false
    },
    commands: [],
    tools: {
      allowed: [],
      declarations: [],
      mcpServers: {}
    },
    contributes: {
      chatMenu: [],
      quickTask: []
    },
    permissions: {
      workspace: 'write',
      network: false,
      exec: 'none',
      requiresApproval: 'on-request'
    },
    assets: []
  }
}

function renderCreatedSkillMarkdown(skill: ParsedSkillCreateRequest): string {
  const procedure = skill.procedure
    ? normalizeMarkdownBlock(skill.procedure)
    : [
        '- Confirm the user goal, required inputs, and constraints before doing work.',
        '- Follow the workflow described in the trigger and keep actions scoped to the current user, task, and workspace.',
        '- Produce the requested output contract and call out missing information or external limitations clearly.'
      ].join('\n')
  const examples = skill.examples.length
    ? `\n\n## Examples\n${skill.examples.map((example) => `- ${frontmatterLine(example)}`).join('\n')}`
    : ''
  return [
    '---',
    `name: ${skill.id}`,
    `description: ${frontmatterLine(skill.description)}`,
    '---',
    '',
    `# ${skill.name}`,
    '',
    '## When To Use',
    normalizeMarkdownBlock(skill.trigger),
    '',
    '## Procedure',
    procedure,
    '',
    '## Output Contract',
    normalizeMarkdownBlock(skill.output),
    '',
    '## Failure Handling',
    '- If required inputs are missing, ask one concise clarification question.',
    '- If external dependencies are unavailable, explain the limitation and provide the best partial result.',
    '- Do not reuse memory, files, credentials, or task context across users or unrelated tasks.',
    examples
  ].join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

function normalizeMarkdownBlock(value: string): string {
  return value.replace(/\r\n/g, '\n').trim()
}

function frontmatterLine(value: string): string {
  return value.replace(/\r?\n/g, ' ').trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parseWorkModeRequestBody(
  value: unknown,
  options: {
    existing?: WorkModeConfigValue
    modeId?: string
    requireId?: boolean
    requireName: boolean
    requireDescription?: boolean
  }
): { ok: true; mode: WorkModeConfigValue } | { ok: false; response: JsonResponse } {
  if (!isObject(value)) {
    return { ok: false, response: jsonResponse({ detail: 'work mode request body must be an object' }, 400) }
  }

  const rawName = stringValue(value.name)?.trim()
  if (options.requireName && !rawName) {
    return { ok: false, response: jsonResponse({ detail: 'name is required' }, 400) }
  }

  const requestedId = options.modeId ?? stringValue(value.id) ?? stringValue(value.mode_id)
  if (options.requireId && !requestedId) {
    return { ok: false, response: jsonResponse({ detail: 'id is required' }, 400) }
  }
  const id = options.existing?.id ?? normalizeWorkModeId(requestedId)
  if (!id) {
    return { ok: false, response: jsonResponse({ detail: 'id is required' }, 400) }
  }
  if (!isValidCustomWorkModeId(id)) {
    return {
      ok: false,
      response: jsonResponse({
        detail: 'id must start with a lowercase English letter or number and contain only lowercase English letters, numbers, or hyphens'
      }, 400)
    }
  }

  const hasDescription = Object.prototype.hasOwnProperty.call(value, 'description')
  const description = stringValue(value.description)
  if (options.requireDescription && (!description && (options.requireId || hasDescription || !options.existing?.description))) {
    return { ok: false, response: jsonResponse({ detail: 'description is required' }, 400) }
  }
  const icon = stringValue(value.icon)
  const defaultSkillIds = stringList(value.defaultSkillIds) ?? stringList(value.default_skill_ids)

  return {
    ok: true,
    mode: {
      id,
      name: rawName || options.existing?.name || id,
      ...(description !== undefined
        ? (description ? { description } : {})
        : options.existing?.description
          ? { description: options.existing.description }
          : {}),
      ...(icon !== undefined
        ? (icon ? { icon } : {})
        : options.existing?.icon
          ? { icon: options.existing.icon }
          : {}),
      builtin: false,
      editable: true,
      defaultSkillIds: [...new Set(defaultSkillIds ?? options.existing?.defaultSkillIds ?? [])]
        .map((skillId) => skillId.trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
    }
  }
}

function normalizeWorkModeId(id: string | undefined): string | undefined {
  const fromId = id?.trim()
  if (!fromId) return undefined
  const lower = fromId.toLowerCase()
  // Legacy alias: "task" was renamed to "office".
  return lower === 'task' ? 'office' : lower
}

function isValidCustomWorkModeId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(id)
}

function isValidCustomSkillId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(id)
}

async function workModeResponse(
  runtime: ServerRuntime,
  skillsConfig: SkillsConfig,
  state: SkillCompatConfig,
  modeId: string
): Promise<Record<string, unknown> | null> {
  const mode = skillsConfig.workModes.modes[modeId]
  if (!mode) return null
  const effective = new Set(resolveEffectiveSkillIds(skillsConfig, modeId))
  const entries = await allSkillEntriesForMode(runtime, state, skillsConfig, modeId)
  return {
    id: mode.id,
    name: mode.name,
    description: mode.description ?? '',
    icon: mode.icon ?? '',
    builtin: mode.builtin,
    editable: mode.editable,
    skills: entries.map((entry) => {
      const id = String(entry.id)
      const locked = skillsConfig.lockedSkillIds.includes(id)
      const enabled = locked || effective.has(id)
      return {
        ...entry,
        locked,
        enabled,
        registered: enabled,
        status: enabled ? 'registered' : 'disabled',
        editable: !locked && Boolean(entry.editable),
        deletable: !locked && Boolean(entry.deletable)
      }
    })
  }
}

async function allSkillEntriesForMode(
  runtime: ServerRuntime,
  state: SkillCompatConfig,
  skillsConfig: SkillsConfig,
  modeId: string
): Promise<Array<Record<string, unknown>>> {
  const entries = new Map<string, Record<string, unknown>>()
  for (const entry of await kworksSkillEntries(runtime, state)) {
    entries.set(String(entry.id), entry)
  }
  for (const id of resolveModeDisplaySkillIds(skillsConfig, modeId)) {
    if (!entries.has(id)) entries.set(id, skillEntryFromCompatOnly(id, state[id]))
  }
  return [...entries.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)))
}

function resolveModeDisplaySkillIds(skillsConfig: SkillsConfig, modeId: string): string[] {
  const overrides = skillsConfig.modeSkillOverrides[modeId]
  const ids = new Set<string>()
  for (const id of skillsConfig.lockedSkillIds) ids.add(id)
  for (const id of resolveWorkModeDefaultSkillIds(skillsConfig, modeId)) ids.add(id)
  for (const id of overrides?.addedSkillIds ?? []) ids.add(id)
  for (const id of overrides?.removedSkillIds ?? []) ids.add(id)
  return [...ids]
}

function updateModeSkillOverride(
  skillsConfig: SkillsConfig,
  modeId: string,
  skillId: string,
  action: 'add' | 'remove'
): { ok: true; skills: SkillsConfig } | { ok: false; response: JsonResponse } {
  const mode = skillsConfig.workModes.modes[modeId]
  if (!mode) return { ok: false, response: jsonResponse({ detail: `Work mode ${modeId} not found` }, 404) }
  const current = skillsConfig.modeSkillOverrides[modeId] ?? { addedSkillIds: [], removedSkillIds: [] }
  const defaultIds = new Set(resolveWorkModeDefaultSkillIds(skillsConfig, modeId))
  const added = new Set(current.addedSkillIds)
  const removed = new Set(current.removedSkillIds)

  if (action === 'add') {
    removed.delete(skillId)
    if (!defaultIds.has(skillId)) added.add(skillId)
  } else {
    added.delete(skillId)
    if (!skillsConfig.lockedSkillIds.includes(skillId)) removed.add(skillId)
  }

  return {
    ok: true,
    skills: {
      ...skillsConfig,
      modeSkillOverrides: {
        ...skillsConfig.modeSkillOverrides,
        [modeId]: {
          addedSkillIds: [...added].sort((a, b) => a.localeCompare(b)),
          removedSkillIds: [...removed].sort((a, b) => a.localeCompare(b))
        }
      }
    }
  }
}

function kworksSkillEntry(skill: Record<string, unknown>, state: SkillCompatConfig): Record<string, unknown> {
  const id = stringValue(skill.id) ?? stringValue(skill.name) ?? 'unknown'
  const enabled = state[id]?.enabled ?? true
  const root = stringValue(skill.root) ?? ''
  const category = skillCategoryFromRoot(root, stringValue(skill.source), stringValue(skill.category))
  const validationError = stringValue(skill.validationError)
  return {
    id,
    name: stringValue(skill.name) ?? id,
    description: stringValue(skill.description) ?? '',
    version: stringValue(skill.version) ?? '0.0.0',
    root,
    category,
    family: skillFamily(id, root, stringValue(skill.source), category),
    license: stringValue(skill.license) ?? '',
    enabled,
    registered: true,
    status: validationError ? 'invalid' : enabled ? 'registered' : 'disabled',
    builtin: isBuiltinSkill(id) || category === 'public' || stringValue(skill.source) === 'official',
    editable: category === 'custom' || category === 'user',
    deletable: category === 'custom' || category === 'user',
    legacy: Boolean(skill.legacy),
    commands: Array.isArray(skill.commands) ? skill.commands : [],
    contributions: isObject(skill.contributions) ? skill.contributions : {},
    permissions: isObject(skill.permissions) ? skill.permissions : {},
    ...(validationError ? { validationError } : {})
  }
}

function legacyCodingSkillEntry(skill: Record<string, unknown>): Record<string, unknown> {
  const id = stringValue(skill.id) ?? stringValue(skill.name) ?? 'unknown'
  const validationError = stringValue(skill.validationError)
  const activationKeywords =
    stringList(skill.activation_keywords) ??
    stringList(skill.activationKeywords) ??
    stringList(isObject(skill.triggers) ? skill.triggers.promptPatterns : undefined) ??
    []
  const allowedTools = stringList(skill.allowed_tools) ?? stringList(skill.allowedTools) ?? []
  const root = stringValue(skill.root) ?? ''
  return {
    id,
    name: stringValue(skill.name) ?? id,
    description: stringValue(skill.description) ?? '',
    scope: stringValue(skill.scope) === 'project' ? 'project' : 'global',
    legacy: booleanValue(skill.legacy) ?? true,
    activation_keywords: activationKeywords,
    always_activate: booleanValue(skill.always_activate) ?? booleanValue(skill.alwaysActivate) ?? false,
    allowed_tools: allowedTools,
    permissions: isObject(skill.permissions) ? skill.permissions : null,
    skill_file: stringValue(skill.skill_file) ?? stringValue(skill.skillFile) ?? (root ? join(root, 'SKILL.md') : ''),
    enabled: booleanValue(skill.enabled) ?? true,
    manifest_errors: [
      ...(stringList(skill.manifest_errors) ?? stringList(skill.manifestErrors) ?? []),
      ...(validationError ? [validationError] : [])
    ],
    commands: Array.isArray(skill.commands)
      ? skill.commands.filter((item): item is Record<string, string> => isStringRecord(item))
      : [],
    ui: isObject(skill.ui) ? skill.ui : null,
    locked: booleanValue(skill.locked) ?? false
  }
}

function skillFamily(id: string, root: string, source?: string, category?: string): string {
  if (isBuiltinSkill(id)) return 'kworks-management'
  if (isQiongqiCodingSkill(id) || root.includes('/qiongqi/skills') || (source === 'official' && (category === 'development' || category === 'review'))) {
    return 'qiongqi-coding'
  }
  if (root.includes('/custom/') || root.endsWith('/custom')) return 'user-custom'
  if (root.includes('/public/') || root.endsWith('/public')) return 'kworks-public'
  return 'user'
}

function isQiongqiCodingSkill(id: string): boolean {
  return [
    'code-review',
    'debugging',
    'git-worktrees',
    'goal',
    'planning',
    'refactoring',
    'review',
    'security-review',
    'tdd',
    'todo',
    'web'
  ].includes(id)
}

function skillEntryFromCompatOnly(id: string, state?: { enabled: boolean }): Record<string, unknown> {
  const enabled = state?.enabled ?? true
  return {
    id,
    name: id,
    description: '',
    version: '0.0.0',
    root: '',
    category: 'user',
    license: '',
    enabled,
    registered: false,
    status: enabled ? 'registered' : 'disabled',
    builtin: isBuiltinSkill(id),
    editable: !isBuiltinSkill(id),
    deletable: !isBuiltinSkill(id),
    legacy: true,
    commands: [],
    contributions: {},
    permissions: {}
  }
}

function resolveThreadSkillSource(
  runtime: ServerRuntime,
  threadId: string,
  requestedPath: string
): { ok: true; absolutePath: string } | { ok: false; detail: string } {
  const root = threadRoot(runtime, threadId)
  const decoded = decodeURIComponent(requestedPath)
  const virtual = decoded.startsWith('/mnt/qiongqi/') ? decoded : null
  if (virtual) {
    const parts = virtual.split('/').filter(Boolean)
    const mount = parts[2]
    const relativePath = parts.slice(3).join('/')
    const mountRoot = mount === 'outputs'
      ? join(root, 'outputs')
      : mount === 'uploads'
        ? join(root, 'uploads')
        : mount === 'artifacts'
          ? join(root, 'artifacts')
          : mount === 'workspace'
            ? join(root, 'workspace')
            : null
    if (!mountRoot) return { ok: false, detail: `unsupported skill artifact mount: ${mount ?? ''}` }
    return safeResolveWithin(mountRoot, relativePath)
  }
  if (isAbsolute(decoded)) return safeResolveWithin(root, relative(root, decoded))
  return safeResolveWithin(root, decoded)
}

function safeResolveWithin(root: string, subpath: string): { ok: true; absolutePath: string } | { ok: false; detail: string } {
  const absoluteRoot = resolve(root)
  const absolutePath = resolve(absoluteRoot, subpath)
  const rel = relative(absoluteRoot, absolutePath)
  if (rel === '' || (!rel.startsWith('..') && !rel.includes(`..${sep}`) && !resolve(rel).startsWith('/..'))) {
    return { ok: true, absolutePath }
  }
  return { ok: false, detail: 'skill artifact path escapes thread workspace' }
}

async function inferSkillId(sourcePath: string, isDirectory: boolean): Promise<string | undefined> {
  const skillMd = isDirectory ? join(sourcePath, 'SKILL.md') : sourcePath
  const content = await readFile(skillMd, 'utf8').catch(() => '')
  const frontmatter = readSkillFrontmatter(content)
  return slugifySkillId(frontmatter.id ?? frontmatter.name ?? basename(sourcePath, extname(sourcePath)))
}

function readSkillFrontmatter(content: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
  const out: Record<string, string> = {}
  if (!match) return out
  for (const line of match[1].split(/\r?\n/)) {
    const index = line.indexOf(':')
    if (index <= 0) continue
    const key = line.slice(0, index).trim()
    const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')
    if (key) out[key] = value
  }
  return out
}

function slugifySkillId(value: string | undefined): string | undefined {
  const slug = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || undefined
}

function userSkillInstallRoot(runtime: ServerRuntime, skillId: string): string {
  return join(customSharedSkillRoot(runtime), skillId)
}

/**
 * Compute the set of skill IDs that are EXCLUSIVE to `modeId`: present in that
 * mode's `addedSkillIds` but NOT in any locked skill, any other mode's defaults,
 * or any other mode's added overrides. These are safe to physically delete when
 * the mode is removed — nothing else references them.
 */
function findExclusiveSkillIds(skillsConfig: SkillsConfig, modeId: string): string[] {
  const overrides = skillsConfig.modeSkillOverrides[modeId]
  if (!overrides) return []
  const candidates = new Set(overrides.addedSkillIds)
  if (candidates.size === 0) return []

  // Exclude locked skills (always retained).
  for (const id of skillsConfig.lockedSkillIds) candidates.delete(id)

  // Exclude skills referenced by any OTHER mode (defaults or adds).
  for (const otherModeId of Object.keys(skillsConfig.workModes.modes)) {
    if (otherModeId === modeId) continue
    for (const id of resolveWorkModeDefaultSkillIds(skillsConfig, otherModeId)) candidates.delete(id)
    const otherOverrides = skillsConfig.modeSkillOverrides[otherModeId]
    for (const id of otherOverrides?.addedSkillIds ?? []) candidates.delete(id)
  }

  return [...candidates]
}

/**
 * Physically delete a user-installed skill: remove its folder from disk and
 * drop it from `enabledSkills`. Mirrors what enableUserSkillForActor does in
 * reverse. Best-effort — a missing folder is not an error.
 */
async function purgeExclusiveSkill(
  runtime: ServerRuntime,
  skillsConfig: SkillsConfig,
  skillId: string
): Promise<SkillsConfig> {
  // Remove the skill folder on disk.
  await rm(userSkillInstallRoot(runtime, skillId), { recursive: true, force: true }).catch(() => {})
  // Remove from enabledSkills.
  if (!skillsConfig.enabledSkills || !(skillId in skillsConfig.enabledSkills)) return skillsConfig
  const nextEnabled = { ...skillsConfig.enabledSkills }
  delete nextEnabled[skillId]
  return { ...skillsConfig, enabledSkills: nextEnabled }
}

function customSharedSkillRoot(runtime: ServerRuntime): string {
  return join(workspaceRootFromRuntimeDataDir(runtime.info().dataDir), 'skills', 'custom', 'shared')
}

function threadRoot(runtime: ServerRuntime, threadId: string): string {
  return join(runtime.info().dataDir, 'threads', threadId)
}

function workspaceRootFromRuntimeDataDir(dataDir: string): string {
  const parts = dataDir.split(/[\\/]+/)
  const usersIndex = parts.lastIndexOf('users')
  if (usersIndex < 0) return dataDir
  const leadingSlash = dataDir.startsWith('/') ? '/' : ''
  return `${leadingSlash}${parts.slice(0, usersIndex).join('/')}`
}

function skillCategoryFromRoot(root: string, source?: string, category?: string): string {
  if (root.includes('/custom/') || root.endsWith('/custom')) return 'custom'
  if (root.includes('/public/') || root.endsWith('/public') || source === 'official') return 'public'
  if (category === 'workflow' || category === 'development' || category === 'review' || category === 'planning' || category === 'integration') return 'public'
  return 'user'
}

function isBuiltinSkill(id: string): boolean {
  return (DEFAULT_LOCKED_SKILL_IDS as readonly string[]).includes(id)
}

async function isLockedSkill(runtime: ServerRuntime, name: string, actor?: AuthActor): Promise<boolean> {
  const config = await readEffectiveRuntimeConfig(runtime, actor)
  const skills = config.capabilities?.skills ?? DEFAULT_QIONGQI_CAPABILITIES_CONFIG.skills
  return skills.lockedSkillIds.includes(name)
}

async function setSkillEnabledForActor(
  runtime: ServerRuntime,
  owner: string | undefined,
  name: string,
  enabled: boolean,
  current: SkillCompatConfig,
  extra: Record<string, unknown> = {}
): Promise<JsonResponse | Response> {
  if (!enabled) {
    const config = await readRuntimeConfig(runtime)
    const skills = config.capabilities?.skills ?? DEFAULT_QIONGQI_CAPABILITIES_CONFIG.skills
    try {
      assertSkillCanBeDisabled(skills.lockedSkillIds, name)
    } catch (error) {
      return jsonResponse({ detail: messageFromError(error) }, 403)
    }
  }
  const next = { ...current, [name]: { ...(current[name] ?? {}), enabled } }
  const synced = await syncSkillsCompatToRuntimeConfig(runtime, next)
  if (!synced.ok) return synced.response
  if (owner && runtime.kworksUserDataStore) {
    await runtime.kworksUserDataStore.setUserSetting(owner, USER_SETTING_SKILLS_COMPAT, next)
    await runtime.kworksUserDataStore.setUserSetting(owner, USER_SETTING_SKILLS, synced.config.capabilities?.skills)
  }
  const skills = await kworksSkillEntries(runtime, next)
  const skill = skills.find((item) => item.id === name) ?? skillEntryFromCompatOnly(name, next[name])
  return jsonResponse({
    skill: {
      ...skill,
      enabled,
      status: enabled ? 'registered' : 'disabled',
      ...extra
    }
  })
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function skillActionFromUrl(url: string): 'register' | 'unregister' | undefined {
  const pathname = new URL(url).pathname
  if (pathname.endsWith('/register')) return 'register'
  if (pathname.endsWith('/unregister')) return 'unregister'
  return undefined
}

function isDeletableSkillRoot(root: string): boolean {
  const normalized = resolve(root)
  return normalized.includes('/skills/custom/') || normalized.includes('/skills/user/')
}

function stringRecord(value: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') out[key] = item
  }
  return out
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isObject(value) && Object.values(value).every((item) => typeof item === 'string')
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === 'string')
}

function redactModelForResponse(model: Record<string, unknown>): Record<string, unknown> {
  return {
    ...model,
    api_key: typeof model.api_key === 'string' && model.api_key.length > 0 ? '********' : null
  }
}

async function readAuthRequestBody(request: Request): Promise<
  { ok: true; value: unknown } | { ok: false; response: JsonResponse }
> {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.includes('application/x-www-form-urlencoded')) {
    return readJsonBody(request)
  }
  const params = new URLSearchParams(await request.text())
  const value: Record<string, string> = {}
  for (const [key, item] of params.entries()) value[key] = item
  return { ok: true, value }
}

function authErrorResponse(error: unknown): JsonResponse {
  if (error instanceof AuthError) {
    return jsonResponse({ detail: error.message, code: 'auth_error' }, error.status)
  }
  return jsonResponse({ detail: error instanceof Error ? error.message : 'auth failed' }, 500)
}

function ownerUserId(actor?: AuthActor): string | undefined {
  return actor && actor.sessionId !== 'runtime-token' ? actor.userId : undefined
}

export async function kworksCreateThread(runtime: ServerRuntime, request: Request, actor?: AuthActor): Promise<JsonResponse | Response> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const value = isObject(body.value) ? body.value : {}
  const threadId = stringValue(value.thread_id) ?? randomUUID()
  const model = stringValue(value.model) ?? runtime.info().model ?? 'default'
  const workModeId = stringValue(value.workModeId) ?? stringValue(value.work_mode_id)
  const workspace = explicitWorkspace(stringValue(value.workspace)) ?? defaultThreadWorkspace(runtime, workModeId)
  const title = stringValue(value.title) ?? 'New chat'
  const existing = await runtime.threadService.get(threadId)
  if (!existing) {
    await runtime.threadService.create(
      { title, workspace, model, mode: 'agent', workModeId },
      { id: threadId, title, ownerUserId: ownerUserId(actor) }
    )
  }
  const owner = ownerUserId(actor)
  const thread = owner
    ? await runtime.threadService.getForOwner(threadId, owner)
    : await runtime.threadService.get(threadId)
  return jsonResponse(threadToKWorksResponse(requireThread(thread, threadId)))
}

export async function kworksSearchThreads(runtime: ServerRuntime, request: Request, actor?: AuthActor): Promise<JsonResponse | Response> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const value = isObject(body.value) ? body.value : {}
  const limit = numberValue(value.limit) ?? 100
  const threads = await runtime.threadService.list({ limit, includeArchived: false, ownerUserId: ownerUserId(actor) })
  return jsonResponse(threads.map((thread) => threadSummaryToKWorksResponse(thread)))
}

export async function kworksGetThread(runtime: ServerRuntime, threadId: string, actor?: AuthActor): Promise<JsonResponse> {
  const owner = ownerUserId(actor)
  const thread = owner
    ? await runtime.threadService.getForOwner(threadId, owner)
    : await runtime.threadService.get(threadId)
  if (!thread) return jsonResponse({ detail: `Thread ${threadId} not found` }, 404)
  return jsonResponse(threadToKWorksResponse(thread))
}

export async function kworksDeleteThread(runtime: ServerRuntime, threadId: string): Promise<JsonResponse> {
  const ok = await runtime.threadService.delete(threadId)
  if (!ok) {
    return jsonResponse({ detail: `Thread ${threadId} not found` }, 404)
  }
  return jsonResponse({ success: true, message: `Deleted local data for ${threadId}` })
}

export async function kworksUpdateThreadState(runtime: ServerRuntime, threadId: string, request: Request): Promise<JsonResponse | Response> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const value = isObject(body.value) ? body.value : {}
  const values = isObject(value.values) ? value.values : {}
  if (typeof values.title === 'string' && values.title.trim()) {
    try {
      await runtime.threadService.update(threadId, { title: values.title.trim() })
    } catch {
      return jsonResponse({ detail: `Thread ${threadId} not found` }, 404)
    }
  }
  const thread = await runtime.threadService.get(threadId)
  if (!thread) return jsonResponse({ detail: `Thread ${threadId} not found` }, 404)
  return jsonResponse(threadStateResponse(thread))
}

export async function kworksGetThreadState(runtime: ServerRuntime, threadId: string): Promise<JsonResponse> {
  const thread = await runtime.threadService.get(threadId)
  if (!thread) return jsonResponse({ detail: `Thread ${threadId} not found` }, 404)
  return jsonResponse(threadStateResponse(thread))
}

export async function kworksGetThreadHistory(runtime: ServerRuntime, threadId: string): Promise<JsonResponse> {
  const thread = await runtime.threadService.get(threadId)
  if (!thread) return jsonResponse({ detail: `Thread ${threadId} not found` }, 404)
  return jsonResponse([
    {
      checkpoint: {
        checkpoint_id: `qiongqi-${thread.updatedAt}`,
        thread_id: threadId,
        checkpoint_ns: ''
      },
      parent_checkpoint: null,
      checkpoint_id: `qiongqi-${thread.updatedAt}`,
      parent_checkpoint_id: null,
      metadata: { source: 'qiongqi', step: thread.turns.length },
      values: threadValues(thread),
      created_at: thread.updatedAt,
      next: [],
      tasks: []
    }
  ])
}

export async function kworksListRuns(threadId: string): Promise<JsonResponse> {
  const ids = runsByThread.get(threadId) ?? []
  return jsonResponse(ids.map((id) => runs.get(id)).filter(Boolean).map(runToResponse))
}

export async function kworksGetRun(threadId: string, runId: string): Promise<JsonResponse> {
  const run = runs.get(runId)
  if (!run || run.thread_id !== threadId) return jsonResponse({ detail: `Run ${runId} not found` }, 404)
  return jsonResponse(runToResponse(run))
}

export async function kworksCancelRun(runtime: ServerRuntime, threadId: string, runId: string): Promise<Response | JsonResponse> {
  const run = runs.get(runId)
  if (!run || run.thread_id !== threadId) return jsonResponse({ detail: `Run ${runId} not found` }, 404)
  if (run.turn_id && (run.status === 'pending' || run.status === 'running')) {
    await runtime.turnService.interruptTurn({ threadId, turnId: run.turn_id, discard: false })
    run.status = 'interrupted'
    run.updated_at = new Date().toISOString()
  }
  return new Response(null, { status: 202 })
}

export async function kworksExistingRunStream(runtime: ServerRuntime, threadId: string, runId: string, request: Request): Promise<Response | JsonResponse> {
  const run = runs.get(runId)
  if (!run || run.thread_id !== threadId) return jsonResponse({ detail: `Run ${runId} not found` }, 404)
  const url = new URL(request.url)
  if (url.searchParams.has('action')) {
    return kworksCancelRun(runtime, threadId, runId)
  }
  if (run.status === 'pending' || run.status === 'running') {
    return kworksRunEventStream(runtime, request, run)
  }
  return new Response(formatKWorksSse('end', null), {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive'
    }
  })
}

export async function kworksRunStream(runtime: ServerRuntime, threadId: string, request: Request, actor?: AuthActor): Promise<Response | JsonResponse> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const value = isObject(body.value) ? body.value : {}
  const input = isObject(value.input) ? value.input : {}
  const context = isObject(value.context) ? value.context : {}
  const prompt = promptWithExplicitSkillContext(extractPrompt(input), context)
  if (!prompt) return jsonResponse({ detail: 'input.messages requires a user message' }, 400)

  const assistantId = stringValue(value.assistant_id) ?? null
  const model = stringValue(context.model_name)
  if (!model) {
    return jsonResponse({ detail: 'model is not configured for this KWorks user' }, 400)
  }
  const workModeId = workModeIdFromCompatContext(context)
  const workspace = resolveKWorksWorkspace(runtime, value, context, workModeId)
  const title = deriveThreadTitle(prompt)
  await syncRuntimeToolsForActor(runtime, actor)
  await ensureThread(runtime, threadId, {
    model,
    workspace,
    title,
    mode: context.is_plan_mode === true ? 'plan' : 'agent',
    workModeId
  })

  const run: RunRecord = {
    run_id: randomUUID(),
    thread_id: threadId,
    assistant_id: assistantId,
    status: 'pending',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    metadata: isObject(value.metadata) ? value.metadata : {},
    kwargs: { input, config: isObject(value.config) ? value.config : {} }
  }
  runs.set(run.run_id, run)
  const ids = runsByThread.get(threadId) ?? []
  ids.unshift(run.run_id)
  runsByThread.set(threadId, ids)

  const start = await runtime.turnService.startTurn({
    threadId,
    request: {
      prompt,
      displayText: prompt,
      model,
      mode: context.is_plan_mode === true ? 'plan' : undefined,
      workModeId,
      reasoningEffort: normalizeReasoningEffort(context.reasoning_effort)
    }
  })
  run.turn_id = start.turnId
  run.status = 'running'
  run.updated_at = new Date().toISOString()
  runtime.runTurn(threadId, start.turnId)

  return kworksRunEventStream(runtime, request, run)
}

export function kworksRunEventStream(runtime: ServerRuntime, request: Request, run: RunRecord): Response {
  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | undefined
  let closed = false
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const initialThread = await runtime.threadService.get(run.thread_id)
      const mirror = new KWorksThreadMirror(run.thread_id, initialThread?.title)
      const send = (event: string, data: unknown, id?: string | number) => {
        controller.enqueue(encoder.encode(formatKWorksSse(event, data, id)))
      }
      const close = () => {
        if (closed) return
        closed = true
        unsubscribe?.()
        try {
          send('end', null)
          controller.close()
        } catch {
          // ignored
        }
      }
      request.signal.addEventListener('abort', close)
      send('metadata', { run_id: run.run_id, thread_id: run.thread_id, runtime: 'qiongqi' })
      const backlog = await runtime.sessionStore.loadEventsSince(run.thread_id, 0)
      const handleEvent = (event: RuntimeEvent) => {
        if (closed) return
        if (event.turnId && run.turn_id && event.turnId !== run.turn_id) return
        const update = mirror.apply(event)
        if (update.message) {
          const tuple = [update.message, { runtime: 'qiongqi', thread_id: run.thread_id }]
          send('messages', tuple, event.seq)
          send('messages-tuple', tuple, event.seq)
        }
        if (update.changed) {
          send('values', mirror.values(), event.seq)
        }
        if (event.kind === 'turn_completed') {
          run.status = 'success'
          run.updated_at = new Date().toISOString()
          close()
        } else if (event.kind === 'turn_failed' || event.kind === 'turn_aborted' || event.kind === 'error') {
          run.status = event.kind === 'turn_aborted' ? 'interrupted' : 'error'
          run.error = 'message' in event && typeof event.message === 'string' ? event.message : undefined
          run.updated_at = new Date().toISOString()
          if (run.status === 'error') {
            send('error', { message: run.error ?? 'QiongQi turn failed', name: 'QiongQiRuntimeError' }, event.seq)
          }
          close()
        }
      }
      for (const event of backlog) handleEvent(event)
      unsubscribe = runtime.eventBus.subscribe(run.thread_id, handleEvent)
    },
    cancel() {
      closed = true
      unsubscribe?.()
    }
  })
  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'content-location': `/api/threads/${run.thread_id}/runs/${run.run_id}`
    }
  })
}

function formatKWorksSse(event: string, data: unknown, id?: string | number): string {
  const parts = [`event: ${event}`, `data: ${JSON.stringify(data)}`]
  if (id !== undefined) parts.push(`id: ${id}`)
  parts.push('', '')
  return parts.join('\n')
}

async function ensureThread(
  runtime: ServerRuntime,
  threadId: string,
  input: { model: string; workspace: string; title: string; mode: 'agent' | 'plan'; workModeId?: string }
): Promise<void> {
  const existing = await runtime.threadService.get(threadId)
  if (existing) {
    const patch: {
      title?: string
      workspace?: string
      model?: string
      mode?: 'agent' | 'plan'
      workModeId?: string
    } = {}
    if (isDefaultThreadTitle(existing.title) && input.title !== existing.title) {
      patch.title = input.title
    }
    if (existing.workspace !== input.workspace) {
      patch.workspace = input.workspace
    }
    if (existing.model !== input.model) {
      patch.model = input.model
    }
    if (existing.mode !== input.mode) {
      patch.mode = input.mode
    }
    if (input.workModeId && existing.workModeId !== input.workModeId) {
      patch.workModeId = input.workModeId
    }
    if (Object.keys(patch).length > 0) {
      await runtime.threadService.update(threadId, patch)
    }
    return
  }
  await runtime.threadService.create(
    {
      title: input.title,
      workspace: input.workspace,
      model: input.model,
      mode: input.mode,
      workModeId: input.workModeId
    },
    { id: threadId, title: input.title }
  )
}

function workModeIdFromCompatContext(context: Record<string, unknown>): string | undefined {
  return stringValue(context.workModeId) ?? stringValue(context.work_mode_id)
}

function resolveKWorksWorkspace(
  runtime: ServerRuntime,
  value: Record<string, unknown>,
  context: Record<string, unknown>,
  workModeId?: string
): string {
  return (
    explicitWorkspace(stringValue(context.workspaceRoot)) ??
    explicitWorkspace(stringValue(context.workspace_root)) ??
    explicitWorkspace(stringValue(context.project_root)) ??
    explicitWorkspace(stringValue(context.workspace)) ??
    explicitWorkspace(stringValue(value.workspaceRoot)) ??
    explicitWorkspace(stringValue(value.workspace_root)) ??
    explicitWorkspace(stringValue(value.workspace)) ??
    defaultThreadWorkspace(runtime, workModeId)
  )
}

function explicitWorkspace(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed && trimmed !== '.' ? trimmed : undefined
}

function promptWithExplicitSkillContext(prompt: string, context: Record<string, unknown>): string {
  const skillId = stringValue(context.activeSkillId) ?? stringValue(context.skill_id)
  if (!skillId) return prompt
  const intent = stringValue(context.skillIntent) ?? stringValue(context.skill_intent)
  const target = stringValue(context.targetSkillId) ?? stringValue(context.target_skill_id)
  const workModeId = workModeIdFromCompatContext(context)
  const lines = [`/skill:${skillId}`]
  if (intent) lines.push(`Skill intent: ${intent}`)
  if (target) lines.push(`Target skill: ${target}`)
  if (workModeId) {
    lines.push(`Work mode id: ${workModeId}`)
    if (intent === 'create') {
      lines.push(`Bind any newly created skill to work mode: ${workModeId}`)
    }
  }
  if (intent === 'create') {
    lines.push(
      'KWorks skill creation contract:',
      '- Prefer producing an installable skill draft directly when the user already supplied enough context.',
      '- Ask for user input only when the skill goal, activation scenario, or expected output is genuinely missing.',
      '- The draft should include a SKILL.md with trigger guidance, procedure, output contract, failure handling, and examples.',
      '- If generating files, keep them inside the current thread/workspace artifact path so the KWorks installer can register the skill.'
    )
  }
  lines.push('', prompt)
  return lines.join('\n')
}

class KWorksThreadMirror {
  private readonly items = new Map<string, TurnItem>()
  private readonly order: string[] = []
  private title?: string

  constructor(private readonly threadId: string, title?: string) {
    this.title = title
  }

  apply(event: RuntimeEvent): { changed: boolean; message?: unknown } {
    if ((event.kind === 'thread_created' || event.kind === 'thread_updated') && typeof event.title === 'string') {
      this.title = event.title
      return { changed: true }
    }
    if ('item' in event && event.item) {
      const item = event.item
      if (!this.items.has(item.id)) this.order.push(item.id)
      const merged = this.mergeItem(event.kind, item)
      this.items.set(item.id, merged)
      return { changed: true, message: itemToLangGraphMessage(merged) }
    }
    if (event.kind === 'turn_completed' || event.kind === 'turn_failed' || event.kind === 'turn_aborted') {
      return { changed: true }
    }
    return { changed: false }
  }

  private mergeItem(kind: RuntimeEvent['kind'], item: TurnItem): TurnItem {
    const previous = this.items.get(item.id)
    if (
      previous &&
      (kind === 'assistant_text_delta' || kind === 'assistant_reasoning_delta') &&
      previous.kind === item.kind &&
      'text' in previous &&
      'text' in item
    ) {
      return {
        ...item,
        text: `${previous.text}${item.text}`
      } as TurnItem
    }
    return item
  }

  values(): Record<string, unknown> {
    return {
      ...(this.title ? { title: this.title } : {}),
      messages: this.order
        .map((id) => this.items.get(id))
        .filter((item): item is TurnItem => Boolean(item))
        .map(itemToLangGraphMessage),
      thread_data: {
        runtime: 'qiongqi',
        thread_id: this.threadId
      }
    }
  }
}

function threadToKWorksResponse(thread: ThreadRecord): Record<string, unknown> {
  return {
    thread_id: thread.id,
    status: thread.status === 'running' ? 'busy' : 'idle',
    created_at: thread.createdAt,
    updated_at: thread.updatedAt,
    metadata: {},
    values: threadValues(thread),
    interrupts: {}
  }
}

function threadSummaryToKWorksResponse(thread: ThreadSummary): Record<string, unknown> {
  return {
    thread_id: thread.id,
    status: thread.status === 'running' ? 'busy' : 'idle',
    created_at: thread.createdAt,
    updated_at: thread.updatedAt,
    metadata: {},
    values: { title: thread.title, messages: [], thread_data: { runtime: 'qiongqi', thread_id: thread.id } },
    interrupts: {}
  }
}

function threadStateResponse(thread: ThreadRecord): Record<string, unknown> {
  return {
    values: threadValues(thread),
    next: [],
    metadata: { source: 'qiongqi', step: thread.turns.length },
    checkpoint: { id: `qiongqi-${thread.updatedAt}`, ts: thread.updatedAt },
    checkpoint_id: `qiongqi-${thread.updatedAt}`,
    parent_checkpoint_id: null,
    created_at: thread.updatedAt,
    tasks: []
  }
}

function threadValues(thread: ThreadRecord): Record<string, unknown> {
  return {
    title: thread.title,
    ...(thread.workModeId ? { workModeId: thread.workModeId } : {}),
    messages: threadMessages(thread),
    thread_data: { runtime: 'qiongqi', thread_id: thread.id }
  }
}

function threadMessages(thread: ThreadRecord): unknown[] {
  return thread.turns.flatMap((turn) => turn.items.map(itemToLangGraphMessage))
}

function itemToLangGraphMessage(item: TurnItem): Record<string, unknown> {
  const id = item.id
  const additional_kwargs = { qiongqi_item: item }
  if (item.kind === 'user_message') {
    return { id, type: 'human', role: 'user', content: item.displayText ?? item.text, additional_kwargs }
  }
  if (item.kind === 'assistant_reasoning') {
    return {
      id,
      type: 'ai',
      role: 'assistant',
      content: '',
      additional_kwargs: {
        ...additional_kwargs,
        reasoning_content: item.text
      }
    }
  }
  if (item.kind === 'assistant_text' || item.kind === 'review') {
    return {
      id,
      type: 'ai',
      role: 'assistant',
      content: item.kind === 'review' ? item.reviewText ?? '' : item.text,
      additional_kwargs
    }
  }
  if (item.kind === 'tool_result') {
    return {
      id,
      type: 'tool',
      role: 'tool',
      name: item.toolName,
      tool_call_id: item.callId,
      content: typeof item.output === 'string' ? item.output : JSON.stringify(item.output),
      additional_kwargs
    }
  }
  if (item.kind === 'tool_call') {
    return {
      id,
      type: 'ai',
      role: 'assistant',
      content: item.summary ?? '',
      tool_calls: [{ id: item.callId, name: item.toolName, args: item.arguments }],
      additional_kwargs
    }
  }
  if (item.kind === 'error') {
    if (isToolCatalogDriftDiagnostic(item)) {
      return {
        id,
        type: 'system',
        role: 'system',
        content: '',
        additional_kwargs: { ...additional_kwargs, hide_from_ui: true }
      }
    }
    return { id, type: 'ai', role: 'assistant', content: item.message, additional_kwargs }
  }
  return { id, type: 'system', role: 'system', content: JSON.stringify(item), additional_kwargs }
}

function isToolCatalogDriftDiagnostic(
  item: TurnItem
): item is Extract<TurnItem, { kind: 'error' }> & { code: 'tool_catalog_changed' } {
  return item.kind === 'error' && item.code === 'tool_catalog_changed'
}

function runToResponse(run: RunRecord | undefined): Record<string, unknown> {
  if (!run) return {}
  return {
    run_id: run.run_id,
    thread_id: run.thread_id,
    assistant_id: run.assistant_id ?? null,
    status: run.status,
    metadata: run.metadata,
    kwargs: run.kwargs,
    multitask_strategy: 'reject',
    created_at: run.created_at,
    updated_at: run.updated_at,
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_tokens: 0,
    llm_call_count: 0,
    lead_agent_tokens: 0,
    subagent_tokens: 0,
    middleware_tokens: 0,
    message_count: 0
  }
}

function extractPrompt(input: Record<string, unknown>): string {
  const messages = Array.isArray(input.messages) ? input.messages : []
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (!isObject(message)) continue
    const role = stringValue(message.role) ?? stringValue(message.type)
    if (role && !['human', 'user'].includes(role)) continue
    const content = message.content
    if (typeof content === 'string' && content.trim()) return content.trim()
    if (Array.isArray(content)) {
      const text = content
        .map((part) => {
          if (typeof part === 'string') return part
          if (isObject(part) && typeof part.text === 'string') return part.text
          return ''
        })
        .join('\n')
        .trim()
      if (text) return text
    }
  }
  const prompt = stringValue(input.prompt)
  return prompt?.trim() ?? ''
}

function normalizeReasoningEffort(value: unknown): 'auto' | 'off' | 'low' | 'medium' | 'high' | 'max' | undefined {
  if (value === 'auto' || value === 'off' || value === 'low' || value === 'medium' || value === 'high' || value === 'max') {
    return value
  }
  return undefined
}

function requireThread(thread: ThreadRecord | null, id: string): ThreadRecord {
  if (!thread) throw new Error(`thread not found after create: ${id}`)
  return thread
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}
