import { join } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type { ServerRuntime } from './server-runtime.js'

/**
 * Coding 交付阶段定义（5 阶段）。
 * recommended_skills 全部绑定 KCoder 真实存在的技能（非照搬 KWorks 的幽灵技能）。
 * 来源：KWorks CODING_DELIVERY_STAGES，KCoder 重设计 recommended_skills。
 */
export const CODING_DELIVERY_STAGES = [
  {
    id: 'requirements',
    title: '需求澄清',
    goal: '在编码前明确用户目标、约束、验收标准和项目上下文。',
    recommended_skills: ['brainstorming', 'planning', 'goal'],
    suggested_prompt: '澄清需求、验收标准、风险和相关代码路径，再规划变更。',
    next_stage_id: 'planning'
  },
  {
    id: 'planning',
    title: '方案规划',
    goal: '把工作拆解为可执行步骤、测试和回滚说明。',
    recommended_skills: ['writing-plans', 'planning-with-files', 'using-git-worktrees'],
    suggested_prompt: '创建简洁的实现计划，列出要改的文件、要跑的测试和风险。',
    next_stage_id: 'implementation'
  },
  {
    id: 'implementation',
    title: '实现',
    goal: '在工作区聚焦实现代码变更，测试同步更新。',
    recommended_skills: ['tdd', 'test-driven-development', 'debugging', 'frontend-design'],
    suggested_prompt: '实现计划中的变更，保持改动聚焦，同步更新测试。',
    next_stage_id: 'review'
  },
  {
    id: 'review',
    title: '审查',
    goal: '检查回归、缺失测试、安全问题和 UX 破坏。',
    recommended_skills: ['code-review', 'security-review', 'verification-before-completion', 'webapp-testing'],
    suggested_prompt: '审查当前 diff，按严重程度列出问题，运行验证命令。',
    next_stage_id: 'delivery'
  },
  {
    id: 'delivery',
    title: '交付',
    goal: '总结成果、验证证据、残余风险和交接说明。',
    recommended_skills: ['release-notes', 'finishing-a-development-branch'],
    suggested_prompt: '准备最终交接：变更内容、验证结果、后续风险。',
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

// ---------------------------------------------------------------------------
// 阶段状态持久化类型（来源 KWorks ProjectStageState）
// ---------------------------------------------------------------------------

export type StageSource = 'user' | 'agent_suggested' | 'agent_accepted'

export type StageHistoryEntry = {
  from_stage_id: string | null
  to_stage_id: string
  reason: string
  source: StageSource
  timestamp: string
  thread_id?: string | null
  run_outcome?: string | null
}

export type StageSuggestion = {
  stage_id: string
  reason: string
  suggested_by_thread_id: string
  timestamp: string
}

export type ProjectStageState = {
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

// ---------------------------------------------------------------------------
// 持久化辅助（单文件 JSON: <dataDir>/coding/project-stages.json）
// ---------------------------------------------------------------------------

function projectStageStorePath(dataDir: string): string {
  return join(dataDir, 'coding', 'project-stages.json')
}

export function projectOwnerKey(ownerUserId: string | undefined): string {
  return ownerUserId ?? 'internal-runtime'
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

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function stageSourceValue(value: unknown): StageSource {
  return value === 'agent_suggested' || value === 'agent_accepted' ? value : 'user'
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

async function loadProjectStageSnapshot(dataDir: string): Promise<ProjectStageSnapshot> {
  try {
    const parsed = JSON.parse(await readFile(projectStageStorePath(dataDir), 'utf-8')) as unknown
    if (!isObject(parsed) || !isObject(parsed.users)) return emptyProjectStageSnapshot()
    const users: Record<string, Record<string, ProjectStageState>> = {}
    for (const [ownerKey, states] of Object.entries(parsed.users as Record<string, unknown>)) {
      if (!isObject(states)) continue
      const normalizedStates: Record<string, ProjectStageState> = {}
      for (const [root, state] of Object.entries(states)) {
        const normalized = normalizeProjectStageState(root, state)
        if (normalized) normalizedStates[root] = normalized
      }
      if (Object.keys(normalizedStates).length > 0) users[ownerKey] = normalizedStates
    }
    return { version: 1, users }
  } catch {
    return emptyProjectStageSnapshot()
  }
}

async function saveProjectStageSnapshot(dataDir: string, snapshot: ProjectStageSnapshot): Promise<void> {
  await mkdir(join(dataDir, 'coding'), { recursive: true })
  await writeFile(projectStageStorePath(dataDir), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8')
}

export async function projectStageForActor(
  runtime: ServerRuntime,
  ownerUserId: string | undefined,
  projectRoot: string
): Promise<ProjectStageState> {
  const dataDir = runtime.info().dataDir
  const snapshot = await loadProjectStageSnapshot(dataDir)
  return snapshot.users[projectOwnerKey(ownerUserId)]?.[projectRoot] ?? emptyProjectStage(projectRoot)
}

export async function saveProjectStageForActor(
  runtime: ServerRuntime,
  ownerUserId: string | undefined,
  state: ProjectStageState
): Promise<void> {
  const dataDir = runtime.info().dataDir
  const snapshot = await loadProjectStageSnapshot(dataDir)
  const ownerKey = projectOwnerKey(ownerUserId)
  await saveProjectStageSnapshot(dataDir, {
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
