import {
  ManagerRouteDecisionSchema,
  type ManagerRouteDecision
} from '@qiongqi/contracts'

/**
 * Specialist 定义 — 注册表中的单个专家 agent 描述。
 * 来源：KWorks specialist-registry.ts（SpecialistDefinition），机制移植，agent 定义为 KCoder 原生。
 */
export type SpecialistDefinition = {
  id: string
  name: string
  /** 能力标签（manager 路由时用于匹配任务类型）。 */
  capabilities: string[]
  /** 允许的模型（可选，未使用时走默认模型）。 */
  allowedModels?: string[]
  /** 允许的工具名（执行阶段 restrict 到此集合）。 */
  allowedTools: string[]
  /** 所属工作模式（KCoder 仅 coding）。 */
  workModeId: string
  /** 是否默认必需（manager 路由时的默认 required 标记）。 */
  defaultRequired: boolean
  /** 是否允许派生子 agent（执行 delegate_task）。 */
  allowSubagents: boolean
}

/**
 * Specialist 注册表契约 — 不可变，按 revision 寻址。
 * 来源：KWorks specialist-registry.ts（SpecialistRegistryContract）。
 */
export interface SpecialistRegistryContract {
  readonly revision: string
  get(id: string): SpecialistDefinition | undefined
  listEnabled(ids: readonly string[]): SpecialistDefinition[]
  validateRoute(
    decision: ManagerRouteDecision,
    limits: { maxActivatedSpecialists: number }
  ): ManagerRouteDecision
}

/**
 * KCoder 原生编码 specialist 团队（10 个）。
 * 全部 workModeId: 'coding'，绑定真实存在的技能分类。
 * 来源：spec §3.1（KCoder 重新设计，非 KWorks 原样）。
 */
const KCODER_CODING_SPECIALISTS: readonly SpecialistDefinition[] = [
  {
    id: 'planning',
    name: '规划分析师',
    capabilities: ['planning', 'brainstorming', 'requirements', 'task-decomposition', 'risk-assessment'],
    allowedTools: ['read', 'ls', 'find', 'grep', 'bash'],
    workModeId: 'coding',
    defaultRequired: false,
    allowSubagents: false
  },
  {
    id: 'backend',
    name: '后端逻辑工程师',
    capabilities: ['backend', 'api', 'debugging', 'refactoring', 'unit-testing'],
    allowedTools: ['read', 'ls', 'find', 'grep', 'bash', 'write', 'edit', 'web_fetch', 'delegate_task'],
    workModeId: 'coding',
    defaultRequired: true,
    allowSubagents: true
  },
  {
    id: 'frontend',
    name: '前端 UI 工程师',
    capabilities: ['frontend', 'ui', 'styling', 'components', 'accessibility'],
    allowedTools: ['read', 'ls', 'find', 'grep', 'bash', 'write', 'edit', 'web_fetch', 'delegate_task'],
    workModeId: 'coding',
    defaultRequired: true,
    allowSubagents: true
  },
  {
    id: 'testing',
    name: '测试验证工程师',
    capabilities: ['testing', 'e2e', 'regression', 'verification'],
    allowedTools: ['read', 'ls', 'find', 'grep', 'bash'],
    workModeId: 'coding',
    defaultRequired: false,
    allowSubagents: false
  },
  {
    id: 'review',
    name: '代码审查员',
    capabilities: ['code-review', 'pr-review', 'maintainability', 'verification'],
    allowedTools: ['read', 'ls', 'find', 'grep', 'bash'],
    workModeId: 'coding',
    defaultRequired: false,
    allowSubagents: false
  },
  {
    id: 'security',
    name: '安全工程师',
    capabilities: ['security', 'vulnerability', 'input-validation', 'secrets'],
    allowedTools: ['read', 'ls', 'find', 'grep', 'bash'],
    workModeId: 'coding',
    defaultRequired: false,
    allowSubagents: false
  },
  {
    id: 'devops',
    name: 'DevOps 工程师',
    capabilities: ['deployment', 'ci-cd', 'release', 'branch-management'],
    allowedTools: ['read', 'ls', 'find', 'grep', 'bash', 'write', 'edit', 'web_fetch', 'delegate_task'],
    workModeId: 'coding',
    defaultRequired: false,
    allowSubagents: true
  },
  {
    id: 'docs',
    name: '文档工程师',
    capabilities: ['documentation', 'api-docs', 'internal-comms', 'presentation'],
    allowedTools: ['read', 'ls', 'find', 'grep', 'bash', 'write', 'edit'],
    workModeId: 'coding',
    defaultRequired: false,
    allowSubagents: false
  },
  {
    id: 'frontend-native',
    name: '移动端工程师',
    capabilities: ['mobile', 'react-native', 'cross-platform', 'video'],
    allowedTools: ['read', 'ls', 'find', 'grep', 'bash', 'write', 'edit', 'web_fetch', 'delegate_task'],
    workModeId: 'coding',
    defaultRequired: false,
    allowSubagents: true
  },
  {
    id: 'tooling',
    name: '工具集成工程师',
    capabilities: ['mcp', 'skill-authoring', 'git-workflow', 'parallel-dispatch', 'subagent'],
    allowedTools: ['read', 'ls', 'find', 'grep', 'bash', 'write', 'edit', 'web_fetch', 'delegate_task'],
    workModeId: 'coding',
    defaultRequired: false,
    allowSubagents: true
  }
]

/**
 * 解析指定工作模式下的 specialist id 集合。
 * KCoder 仅 coding 模式，直接透传配置的 id（无 finance 模块子集逻辑）。
 * 来源：KWorks resolveSpecialistIdsForWorkMode（简化，去除 finance 分支）。
 */
export function resolveSpecialistIdsForWorkMode(
  configuredIds: readonly string[],
  _workModeId?: string,
  _workModeModuleId?: string
): string[] {
  return [...configuredIds]
}

/**
 * 创建默认 specialist 注册表。
 * 来源：KWorks createDefaultSpecialistRegistry（机制移植，specialist 定义为 KCoder 原生）。
 */
export function createDefaultSpecialistRegistry(input: {
  revision: string
  enabledIds: readonly string[]
}): SpecialistRegistryContract {
  const definitions = new Map(
    KCODER_CODING_SPECIALISTS.map((definition) => [definition.id, definition])
  )
  const enabled = new Map<string, SpecialistDefinition>()
  for (const id of input.enabledIds) {
    const definition = definitions.get(id)
    if (!definition) throw new Error(`unknown specialist in registry config: ${id}`)
    enabled.set(id, cloneDefinition(definition))
  }

  return {
    revision: input.revision,
    get: (id) => {
      const definition = enabled.get(id)
      return definition ? cloneDefinition(definition) : undefined
    },
    listEnabled: (ids) =>
      ids.flatMap((id) => {
        const definition = enabled.get(id)
        return definition ? [cloneDefinition(definition)] : []
      }),
    validateRoute: (decision, limits) => validateRoute(decision, limits, enabled)
  }
}

/**
 * 校验 manager 路由决策：数量上限、存在性、去重、依赖存在性、无环。
 * 来源：KWorks validateRoute（忠实移植）。
 */
function validateRoute(
  decision: ManagerRouteDecision,
  limits: { maxActivatedSpecialists: number },
  enabled: ReadonlyMap<string, SpecialistDefinition>
): ManagerRouteDecision {
  const parsed = ManagerRouteDecisionSchema.parse(decision)
  if (parsed.specialists.length > limits.maxActivatedSpecialists) {
    throw new Error(`specialist activation limit exceeded: ${limits.maxActivatedSpecialists}`)
  }

  const selectedIds = new Set<string>()
  for (const specialist of parsed.specialists) {
    if (!enabled.has(specialist.specialistId)) {
      throw new Error(`unknown specialist: ${specialist.specialistId}`)
    }
    if (selectedIds.has(specialist.specialistId)) {
      throw new Error(`duplicate specialist: ${specialist.specialistId}`)
    }
    selectedIds.add(specialist.specialistId)
  }

  for (const specialist of parsed.specialists) {
    for (const dependency of specialist.dependsOn) {
      if (!selectedIds.has(dependency)) {
        throw new Error(`unknown dependency for ${specialist.specialistId}: ${dependency}`)
      }
    }
  }
  assertAcyclicDependencies(parsed)
  return parsed
}

/**
 * DFS 环检测：specialist 依赖关系不能成环。
 * 来源：KWorks assertAcyclicDependencies（忠实移植）。
 */
function assertAcyclicDependencies(decision: ManagerRouteDecision): void {
  const dependencies = new Map(
    decision.specialists.map((specialist) => [specialist.specialistId, specialist.dependsOn])
  )
  const visiting = new Set<string>()
  const visited = new Set<string>()

  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error(`specialist dependency cycle detected at: ${id}`)
    if (visited.has(id)) return
    visiting.add(id)
    for (const dependency of dependencies.get(id) ?? []) visit(dependency)
    visiting.delete(id)
    visited.add(id)
  }

  for (const specialist of decision.specialists) visit(specialist.specialistId)
}

function cloneDefinition(definition: SpecialistDefinition): SpecialistDefinition {
  return {
    ...definition,
    capabilities: [...definition.capabilities],
    allowedTools: [...definition.allowedTools],
    ...(definition.allowedModels ? { allowedModels: [...definition.allowedModels] } : {})
  }
}
