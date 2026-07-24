import {
  DEFAULT_WORK_MODES,
  DEFAULT_LOCKED_SKILL_IDS as CONTRACT_LOCKED_SKILL_IDS,
  type SkillsCapabilityConfig
} from '@qiongqi/contracts'

export const DEFAULT_LOCKED_SKILL_IDS = [...CONTRACT_LOCKED_SKILL_IDS]

/**
 * Legacy alias: the built-in "日常办公" mode was originally named `task`, later
 * renamed to `office`. KCoder 现为纯 coding 应用，office 模式已移除；旧的 `task`
 * 和 `office` 标识统一归一到 `coding`，保证历史线程/URL/持久化数据平滑迁移。
 */
const WORK_MODE_ALIASES: Record<string, string> = {
  task: 'coding',
  office: 'coding'
}

function normalizeWorkModeId(id: string): string {
  return WORK_MODE_ALIASES[id] ?? id
}

export function resolveWorkModeId(
  config: Pick<SkillsCapabilityConfig, 'workModes'>,
  requested?: string
): string {
  const modes = config.workModes.modes
  const normalized = requested ? normalizeWorkModeId(requested) : undefined
  if (normalized && modes[normalized]) return normalized
  const defaultId = normalizeWorkModeId(config.workModes.defaultModeId)
  if (modes[defaultId]) return defaultId
  return 'coding'
}

export function resolveEffectiveSkillIds(
  config: Pick<SkillsCapabilityConfig, 'lockedSkillIds' | 'workModes' | 'modeSkillOverrides'>,
  requestedModeId?: string
): string[] {
  const modeId = resolveWorkModeId(config, requestedModeId)
  const overrides = config.modeSkillOverrides[modeId]
  const locked = new Set(config.lockedSkillIds)
  const defaultIds = resolveWorkModeDefaultSkillIds(config, modeId)
  const removed = new Set((overrides?.removedSkillIds ?? []).filter((id) => !locked.has(id)))
  if (isBuiltInWorkMode(config, modeId)) {
    for (const id of defaultIds) removed.delete(id)
  }
  const effective = new Set<string>()

  for (const id of config.lockedSkillIds) effective.add(id)
  for (const id of defaultIds) {
    if (!removed.has(id)) effective.add(id)
  }
  for (const id of overrides?.addedSkillIds ?? []) {
    if (!removed.has(id)) effective.add(id)
  }

  return [...effective]
}

export function resolveWorkModeDefaultSkillIds(
  config: Pick<SkillsCapabilityConfig, 'workModes'>,
  modeId: string
): string[] {
  const ids = new Set<string>()
  const builtin = DEFAULT_WORK_MODES[modeId as keyof typeof DEFAULT_WORK_MODES]
  for (const id of builtin?.defaultSkillIds ?? []) ids.add(id)
  for (const id of config.workModes.modes[modeId]?.defaultSkillIds ?? []) ids.add(id)
  return [...ids]
}

function isBuiltInWorkMode(
  config: Pick<SkillsCapabilityConfig, 'workModes'>,
  modeId: string
): boolean {
  const mode = config.workModes.modes[modeId]
  return mode?.builtin === true
}

export function assertSkillCanBeDisabled(lockedSkillIds: readonly string[], skillId: string): void {
  if (lockedSkillIds.includes(skillId)) {
    throw new Error(`Skill ${skillId} is locked`)
  }
}

export function assertSkillCanBeRemovedFromMode(lockedSkillIds: readonly string[], skillId: string): void {
  if (lockedSkillIds.includes(skillId)) {
    throw new Error(`Skill ${skillId} is required by all work modes`)
  }
}
