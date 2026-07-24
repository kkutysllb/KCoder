# KWorks 引擎移植 — Phase 2: Specialist Registry + Graph Template

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建 KCoder 原生的 specialist 注册表（10 个编码 specialist）和 team 图模板，为 Phase 3 的多 agent turn runner 提供"专家发现 + 路由校验 + 图实例化"能力。

**Architecture:** 忠实移植 KWorks `specialist-registry.ts` 的**注册表机制**（`SpecialistDefinition`/`SpecialistRegistryContract`/`createDefaultSpecialistRegistry`/`validateRoute`/环检测），但**替换 agent 定义**为 10 个 KCoder 原生编码 specialist（绑定真实存在的技能分类）。移植 `evented-v2-graph-template.ts` 的 `materializeTeamGraph`（构建 manager→specialist→join→synthesis DAG）。纯数据/纯函数，无运行时依赖。

**Tech Stack:** TypeScript 5.x, Zod 3.x, Vitest 3.2.x, pnpm workspace

**前置依赖**: Phase 1 已合入 main（`ManagerRouteDecisionSchema`/`AgentGraphSnapshotSchema`/`AgentGraphEdge`/`AgentGraphNode` 等契约已就绪）。

**参考设计文档**: `docs/superpowers/specs/2026-07-24-kworks-engine-migration-design.md` §3.1（10 specialist 定义）、§3.2（Manager 职责）。

**来源映射**: KWorks = `/Users/libing/kk_Projects/KWorks/qiongqi/packages/engine/loop/src/{specialist-registry,evented-v2-graph-template}.ts`

**全局验证命令**（在 `engine/` 目录下执行）:
- 单测: `pnpm vitest run tests/phase2-specialist-registry.test.ts`
- 类型检查: `pnpm typecheck`

---

## 文件结构总览

| 动作 | 文件 | 职责 |
|---|---|---|
| 创建 | `packages/engine/loop/src/specialist-registry.ts` | `SpecialistDefinition` 类型 + `SpecialistRegistryContract` 接口 + 10 个 KCoder specialist 定义 + `createDefaultSpecialistRegistry` + `validateRoute` + 环检测 |
| 创建 | `packages/engine/loop/src/evented-v2-graph-template.ts` | `TEAM_GRAPH_TEMPLATE_ID` + `materializeTeamGraph`（manager-specialist-v1 DAG 构造） |
| 修改 | `packages/engine/loop/src/index.ts` | barrel 导出两个新模块 |
| 创建 | `tests/phase2-specialist-registry.test.ts` | 注册表 + 图模板的单测 |

**关键设计决策（来自已批准的 spec §3.1）**:
- 10 个 specialist，全部 `workModeId: 'coding'`（KCoder 纯 coding 应用，无 finance specialist）
- `backend`/`frontend` 是 `defaultRequired: true`（核心），其余 `false`（按需激活）
- `backend`/`frontend`/`devops`/`frontend-native`/`tooling` 允许 `delegate_task`（复杂任务可再拆），`planning`/`testing`/`review`/`security`/`docs` 不允许（保持专注）
- 技能可被多个 specialist 引用（通过 `capabilities[]` 标签间接表达职责），但 `allowedTools` 交集设计保证职责清晰
- **不移植** KWorks 的 `FINANCE_SPECIALISTS`（22 个）和 `resolveSpecialistIdsForWorkMode` 的 finance 模块逻辑（KCoder 无 finance 模式）；`resolveSpecialistIdsForWorkMode` 简化为 coding-only 透传

---

## Task 1: 创建 specialist-registry.ts — 类型 + 10 个 specialist 定义 + 工厂

**Files:**
- Create: `packages/engine/loop/src/specialist-registry.ts`
- Test: `tests/phase2-specialist-registry.test.ts`

KCoder 完全缺失此文件。创建 KCoder 原生版本：移植机制（类型/接口/工厂/校验），替换 agent 定义为 10 个编码 specialist。

- [ ] **Step 1: 写失败测试 — 验证注册表工厂 + get/listEnabled 基本行为**

创建 `tests/phase2-specialist-registry.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  createDefaultSpecialistRegistry,
  type SpecialistDefinition,
  type SpecialistRegistryContract
} from '@qiongqi/loop'

describe('specialist-registry: 基本行为', () => {
  it('createDefaultSpecialistRegistry 启用全部 10 个 specialist', () => {
    const registry = createDefaultSpecialistRegistry({
      revision: 'reg_v1',
      enabledIds: ['planning', 'backend', 'frontend', 'testing', 'review', 'security', 'devops', 'docs', 'frontend-native', 'tooling']
    })
    expect(registry.revision).toBe('reg_v1')
    // 10 个 specialist 都能 get 到
    expect(registry.get('planning')?.name).toBe('规划分析师')
    expect(registry.get('backend')?.name).toBe('后端逻辑工程师')
    expect(registry.get('frontend')?.name).toBe('前端 UI 工程师')
    expect(registry.get('testing')?.name).toBe('测试验证工程师')
    expect(registry.get('review')?.name).toBe('代码审查员')
    expect(registry.get('security')?.name).toBe('安全工程师')
    expect(registry.get('devops')?.name).toBe('DevOps 工程师')
    expect(registry.get('docs')?.name).toBe('文档工程师')
    expect(registry.get('frontend-native')?.name).toBe('移动端工程师')
    expect(registry.get('tooling')?.name).toBe('工具集成工程师')
  })

  it('get 返回未启用的 specialist 为 undefined', () => {
    const registry = createDefaultSpecialistRegistry({
      revision: 'reg_v1',
      enabledIds: ['backend', 'frontend']
    })
    expect(registry.get('backend')).toBeDefined()
    expect(registry.get('planning')).toBeUndefined() // 未启用
    expect(registry.get('nonexistent')).toBeUndefined()
  })

  it('get 返回的 definition 是克隆（修改不影响内部状态）', () => {
    const registry = createDefaultSpecialistRegistry({
      revision: 'reg_v1',
      enabledIds: ['backend']
    })
    const def1 = registry.get('backend')!
    def1.capabilities.push('HACKED')
    def1.allowedTools.push('HACKED')
    const def2 = registry.get('backend')!
    expect(def2.capabilities).not.toContain('HACKED')
    expect(def2.allowedTools).not.toContain('HACKED')
  })

  it('listEnabled 只返回已启用且存在的 specialist', () => {
    const registry = createDefaultSpecialistRegistry({
      revision: 'reg_v1',
      enabledIds: ['backend', 'frontend', 'nonexistent']
    })
    const enabled = registry.listEnabled(['backend', 'frontend', 'planning', 'nonexistent'])
    const ids = enabled.map((d) => d.id)
    expect(ids).toEqual(['backend', 'frontend']) // planning 未启用，nonexistent 不存在
  })

  it('createDefaultSpecialistRegistry 对未知 enabledId 抛错', () => {
    expect(() =>
      createDefaultSpecialistRegistry({
        revision: 'reg_v1',
        enabledIds: ['backend', 'totally-fake-specialist']
      })
    ).toThrow(/unknown specialist in registry config: totally-fake-specialist/)
  })

  it('SpecialistDefinition 字段完整', () => {
    const registry = createDefaultSpecialistRegistry({
      revision: 'reg_v1',
      enabledIds: ['backend']
    })
    const backend = registry.get('backend') as SpecialistDefinition
    expect(backend.id).toBe('backend')
    expect(backend.workModeId).toBe('coding')
    expect(backend.defaultRequired).toBe(true)
    expect(backend.allowSubagents).toBe(true)
    expect(Array.isArray(backend.capabilities)).toBe(true)
    expect(Array.isArray(backend.allowedTools)).toBe(true)
    expect(backend.allowedTools).toContain('delegate_task')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/phase2-specialist-registry.test.ts`
Expected: FAIL — `@qiongqi/loop` 不导出 `createDefaultSpecialistRegistry` 等

- [ ] **Step 3: 实现 — 创建 specialist-registry.ts**

创建 `packages/engine/loop/src/specialist-registry.ts`，完整内容：

```ts
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
```

> **来源说明**: 机制（`SpecialistDefinition`/`SpecialistRegistryContract`/`createDefaultSpecialistRegistry`/`validateRoute`/`assertAcyclicDependencies`/`cloneDefinition`）逐行移植自 KWorks。差异：(1) `KCODER_CODING_SPECIALISTS` 替代 KWorks 的 `DEFAULT_SPECIALISTS + FINANCE_SPECIALISTS`（10 个 KCoder 原生 specialist，绑定真实技能分类标签）；(2) `resolveSpecialistIdsForWorkMode` 简化为透传（移除 finance 模块子集逻辑）。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run tests/phase2-specialist-registry.test.ts`
Expected: PASS — 6 个测试全过

- [ ] **Step 5: 提交**

```bash
git add packages/engine/loop/src/specialist-registry.ts tests/phase2-specialist-registry.test.ts
git commit -m "feat(loop): 创建 KCoder 原生 specialist 注册表（10 个编码 specialist）

移植 specialist-registry.ts 机制（SpecialistDefinition/RegistryContract/createDefault/validateRoute/环检测）
agent 定义为 KCoder 原生 10 个编码 specialist（规划/后端/前端/测试/审查/安全/DevOps/文档/移动端/工具集成）
全部 workModeId: 'coding'，绑定真实技能分类标签"
```

---

## Task 2: 扩展测试 — validateRoute 路由校验（数量/存在性/去重/依赖/环）

**Files:**
- Test: `tests/phase2-specialist-registry.test.ts`（追加测试块）

`validateRoute` 是注册表的核心校验逻辑，需要覆盖全部 5 类失败场景 + 成功场景。

- [ ] **Step 1: 写失败测试 — 追加 validateRoute 测试块**

在 `tests/phase2-specialist-registry.test.ts` 末尾追加（先 import `ManagerRouteDecisionSchema` 用于构造合法决策）：

```ts
import { ManagerRouteDecisionSchema, type ManagerRouteDecision } from '@qiongqi/contracts'

const fullRegistry = createDefaultSpecialistRegistry({
  revision: 'reg_v1',
  enabledIds: ['planning', 'backend', 'frontend', 'testing', 'review', 'security', 'devops', 'docs', 'frontend-native', 'tooling']
})

function route(specialists: Array<{ specialistId: string; task: string; dependsOn?: string[]; required?: boolean }>): ManagerRouteDecision {
  return ManagerRouteDecisionSchema.parse({
    summary: '测试路由',
    specialists: specialists.map((s) => ({
      specialistId: s.specialistId,
      task: s.task,
      dependsOn: s.dependsOn ?? [],
      required: s.required ?? false
    }))
  })
}

describe('specialist-registry: validateRoute 路由校验', () => {
  it('接受空路由（manager 自答）', () => {
    const decision = route([])
    const validated = fullRegistry.validateRoute(decision, { maxActivatedSpecialists: 10 })
    expect(validated.specialists).toHaveLength(0)
  })

  it('接受单 specialist 路由', () => {
    const decision = route([{ specialistId: 'backend', task: '实现 API', required: true }])
    const validated = fullRegistry.validateRoute(decision, { maxActivatedSpecialists: 10 })
    expect(validated.specialists).toHaveLength(1)
  })

  it('接受带依赖的多 specialist 路由', () => {
    const decision = route([
      { specialistId: 'backend', task: '实现 API', required: true },
      { specialistId: 'frontend', task: '实现 UI', dependsOn: ['backend'], required: true }
    ])
    const validated = fullRegistry.validateRoute(decision, { maxActivatedSpecialists: 10 })
    expect(validated.specialists).toHaveLength(2)
    expect(validated.specialists[1].dependsOn).toEqual(['backend'])
  })

  it('拒绝超过数量上限的路由', () => {
    const decision = route([
      { specialistId: 'backend', task: 't1' },
      { specialistId: 'frontend', task: 't2' }
    ])
    expect(() => fullRegistry.validateRoute(decision, { maxActivatedSpecialists: 1 })).toThrow(
      /specialist activation limit exceeded: 1/
    )
  })

  it('拒绝未知的 specialist id', () => {
    const decision = route([{ specialistId: 'ghost', task: 't1' }])
    expect(() => fullRegistry.validateRoute(decision, { maxActivatedSpecialists: 10 })).toThrow(
      /unknown specialist: ghost/
    )
  })

  it('拒绝重复的 specialist', () => {
    const decision = route([
      { specialistId: 'backend', task: 't1' },
      { specialistId: 'backend', task: 't2' }
    ])
    expect(() => fullRegistry.validateRoute(decision, { maxActivatedSpecialists: 10 })).toThrow(
      /duplicate specialist: backend/
    )
  })

  it('拒绝指向未选 specialist 的依赖', () => {
    const decision = route([
      { specialistId: 'frontend', task: 't1', dependsOn: ['backend'] } // backend 未被选中
    ])
    expect(() => fullRegistry.validateRoute(decision, { maxActivatedSpecialists: 10 })).toThrow(
      /unknown dependency for frontend: backend/
    )
  })

  it('拒绝成环的依赖', () => {
    const decision = route([
      { specialistId: 'backend', task: 't1', dependsOn: ['frontend'] },
      { specialistId: 'frontend', task: 't2', dependsOn: ['backend'] }
    ])
    expect(() => fullRegistry.validateRoute(decision, { maxActivatedSpecialists: 10 })).toThrow(
      /specialist dependency cycle detected/
    )
  })

  it('拒绝未启用的 specialist（即使定义存在）', () => {
    const partialRegistry = createDefaultSpecialistRegistry({
      revision: 'reg_v1',
      enabledIds: ['backend'] // 只启用 backend
    })
    const decision = route([{ specialistId: 'frontend', task: 't1' }])
    expect(() => partialRegistry.validateRoute(decision, { maxActivatedSpecialists: 10 })).toThrow(
      /unknown specialist: frontend/
    )
  })
})
```

- [ ] **Step 2: 运行测试确认通过**（Task 1 已实现 validateRoute，这些测试应直接通过）

Run: `pnpm vitest run tests/phase2-specialist-registry.test.ts`
Expected: PASS — 全部测试通过（6 个 Task1 + 9 个 Task2 = 15 个）

> 这些测试验证已实现的 `validateRoute`，按 TDD 顺序本应先写测试，但 validateRoute 在 Task 1 已完整实现。此处作为回归覆盖。

- [ ] **Step 3: 提交**

```bash
git add tests/phase2-specialist-registry.test.ts
git commit -m "test(loop): 覆盖 specialist validateRoute 全部校验场景

9 个测试覆盖: 空路由/单 specialist/带依赖多 specialist（成功）
+ 数量超限/未知 id/重复/依赖不存在/成环/未启用（失败）"
```

---

## Task 3: 创建 evented-v2-graph-template.ts — materializeTeamGraph

**Files:**
- Create: `packages/engine/loop/src/evented-v2-graph-template.ts`
- Test: `tests/phase2-specialist-registry.test.ts`（追加图模板测试）

`materializeTeamGraph` 把 `ManagerRouteDecision` 实例化为不可变的 `AgentGraphSnapshot` DAG（manager_planning → specialists → join → manager_synthesis）。

- [ ] **Step 1: 写失败测试 — 验证 materializeTeamGraph 三种场景**

在 `tests/phase2-specialist-registry.test.ts` 追加 import 和测试块：

```ts
import {
  materializeTeamGraph,
  TEAM_GRAPH_TEMPLATE_ID
} from '@qiongqi/loop'

const defaultBudgets = {
  maxParallelNodes: 4,
  maxActivatedSpecialists: 10,
  maxRetriesPerNode: 2,
  maxDurationMs: 600000
}

describe('evented-v2-graph-template: materializeTeamGraph', () => {
  it('TEAM_GRAPH_TEMPLATE_ID 为 manager-specialists-v1', () => {
    expect(TEAM_GRAPH_TEMPLATE_ID).toBe('manager-specialists-v1')
  })

  it('空路由生成 manager 自答图（planning → join → synthesis）', () => {
    const snapshot = materializeTeamGraph({
      decision: { summary: '简单任务', specialists: [] },
      registry: fullRegistry,
      graphPublicKey: 'graph_empty',
      budgets: defaultBudgets
    })
    expect(snapshot.publicKey).toBe('graph_empty')
    expect(snapshot.templateId).toBe('manager-specialists-v1')
    expect(snapshot.startNodeId).toBe('manager_planning')
    // 3 个固定节点：planning, join, synthesis
    const nodeIds = snapshot.nodes.map((n) => n.id)
    expect(nodeIds).toEqual(['manager_planning', 'join', 'manager_synthesis'])
    // 空 specialist 时 planning 直连 join
    expect(snapshot.edges).toContainEqual({ from: 'manager_planning', to: 'join', condition: 'planned' })
    expect(snapshot.edges).toContainEqual({ from: 'join', to: 'manager_synthesis', condition: 'joined' })
    expect(snapshot.registryRevision).toBe('reg_v1')
  })

  it('单 specialist 路由生成完整 DAG', () => {
    const snapshot = materializeTeamGraph({
      decision: {
        summary: '后端任务',
        specialists: [{ specialistId: 'backend', task: '实现 API', dependsOn: [], required: true }]
      },
      registry: fullRegistry,
      graphPublicKey: 'graph_one',
      budgets: defaultBudgets
    })
    const nodeIds = snapshot.nodes.map((n) => n.id)
    expect(nodeIds).toEqual(['manager_planning', 'specialist:backend', 'join', 'manager_synthesis'])
    // backend 节点 label 来自 registry 定义
    const backendNode = snapshot.nodes.find((n) => n.id === 'specialist:backend')!
    expect(backendNode.label).toBe('后端逻辑工程师')
    // join 等待 required 的 backend
    const joinNode = snapshot.nodes.find((n) => n.id === 'join')!
    expect(joinNode.kind).toBe('join')
    if (joinNode.kind === 'join') {
      expect(joinNode.requiredBranchIds).toEqual(['specialist:backend'])
    }
    // 边：planning→backend(activated), backend→join(completed), join→synthesis(joined)
    expect(snapshot.edges).toContainEqual({ from: 'manager_planning', to: 'specialist:backend', condition: 'activated:backend' })
    expect(snapshot.edges).toContainEqual({ from: 'specialist:backend', to: 'join', condition: 'completed' })
  })

  it('带依赖的多 specialist 生成依赖边', () => {
    const snapshot = materializeTeamGraph({
      decision: {
        summary: '全栈任务',
        specialists: [
          { specialistId: 'backend', task: '实现 API', dependsOn: [], required: true },
          { specialistId: 'frontend', task: '实现 UI', dependsOn: ['backend'], required: true }
        ]
      },
      registry: fullRegistry,
      graphPublicKey: 'graph_dep',
      budgets: defaultBudgets
    })
    // frontend 依赖 backend：backend→frontend(dependency:frontend)
    expect(snapshot.edges).toContainEqual({ from: 'specialist:backend', to: 'specialist:frontend', condition: 'dependency:frontend' })
    // backend 无依赖：planning→backend
    expect(snapshot.edges).toContainEqual({ from: 'manager_planning', to: 'specialist:backend', condition: 'activated:backend' })
    // 两个都连 join
    expect(snapshot.edges).toContainEqual({ from: 'specialist:backend', to: 'join', condition: 'completed' })
    expect(snapshot.edges).toContainEqual({ from: 'specialist:frontend', to: 'join', condition: 'completed' })
    // join 等待两个 required
    const joinNode = snapshot.nodes.find((n) => n.id === 'join')!
    if (joinNode.kind === 'join') {
      expect(joinNode.requiredBranchIds.sort()).toEqual(['specialist:backend', 'specialist:frontend'])
    }
  })

  it('non-required specialist 不进入 join 的 requiredBranchIds', () => {
    const snapshot = materializeTeamGraph({
      decision: {
        summary: '可选测试',
        specialists: [
          { specialistId: 'backend', task: 't1', dependsOn: [], required: true },
          { specialistId: 'testing', task: 't2', dependsOn: ['backend'], required: false }
        ]
      },
      registry: fullRegistry,
      graphPublicKey: 'graph_opt',
      budgets: defaultBudgets
    })
    const joinNode = snapshot.nodes.find((n) => n.id === 'join')!
    if (joinNode.kind === 'join') {
      expect(joinNode.requiredBranchIds).toEqual(['specialist:backend']) // 只等 required
      expect(joinNode.requiredBranchIds).not.toContain('specialist:testing')
    }
  })

  it('materializeTeamGraph 对非法路由抛错（复用 validateRoute）', () => {
    expect(() =>
      materializeTeamGraph({
        decision: {
          summary: '坏路由',
          specialists: [{ specialistId: 'ghost', task: 't1', dependsOn: [], required: true }]
        },
        registry: fullRegistry,
        graphPublicKey: 'graph_bad',
        budgets: defaultBudgets
      })
    ).toThrow(/unknown specialist: ghost/)
  })

  it('snapshot 携带 budgets', () => {
    const snapshot = materializeTeamGraph({
      decision: { summary: 't', specialists: [] },
      registry: fullRegistry,
      graphPublicKey: 'graph_budget',
      budgets: defaultBudgets
    })
    expect(snapshot.budgets).toEqual(defaultBudgets)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/phase2-specialist-registry.test.ts`
Expected: FAIL — `@qiongqi/loop` 不导出 `materializeTeamGraph`/`TEAM_GRAPH_TEMPLATE_ID`

- [ ] **Step 3: 实现 — 创建 evented-v2-graph-template.ts**

创建 `packages/engine/loop/src/evented-v2-graph-template.ts`，完整内容（忠实移植 KWorks）：

```ts
import {
  AgentGraphSnapshotSchema,
  type AgentGraphEdge,
  type AgentGraphNode,
  type AgentGraphSnapshot,
  type ManagerRouteDecision
} from '@qiongqi/contracts'
import type { SpecialistRegistryContract } from './specialist-registry.js'

/**
 * Team 图模板标识。manager-specialists-v1 = manager_planning → specialists → join → manager_synthesis。
 * 来源：KWorks evented-v2-graph-template.ts（TEAM_GRAPH_TEMPLATE_ID）。
 */
export const TEAM_GRAPH_TEMPLATE_ID = 'manager-specialists-v1'

/**
 * 把 manager 路由决策实例化为不可变的 AgentGraphSnapshot DAG。
 * - 空 specialists：manager_planning 直连 join（manager 自答路径）
 * - 有 specialists：planning 扇出到无依赖的 specialist，有依赖的从依赖节点接入，全部连 join，join 连 synthesis
 * - join 的 requiredBranchIds 只含 required 的 specialist
 * 来源：KWorks materializeTeamGraph（忠实移植）。
 */
export function materializeTeamGraph(input: {
  decision: ManagerRouteDecision
  registry: SpecialistRegistryContract
  graphPublicKey: string
  budgets: AgentGraphSnapshot['budgets']
}): AgentGraphSnapshot {
  const decision = input.registry.validateRoute(input.decision, {
    maxActivatedSpecialists: input.budgets.maxActivatedSpecialists
  })
  const specialistNodes: AgentGraphNode[] = decision.specialists.map((specialist) => {
    const definition = input.registry.get(specialist.specialistId)
    if (!definition) throw new Error(`unknown specialist: ${specialist.specialistId}`)
    return {
      id: specialistNodeId(specialist.specialistId),
      kind: 'agent',
      agentId: specialist.specialistId,
      label: definition.name,
      capabilities: [...definition.capabilities]
    }
  })
  const nodes: AgentGraphNode[] = [
    {
      id: 'manager_planning',
      kind: 'agent',
      agentId: 'manager',
      label: 'Manager Planning',
      capabilities: ['routing']
    },
    ...specialistNodes,
    {
      id: 'join',
      kind: 'join',
      requiredBranchIds: decision.specialists
        .filter((specialist) => specialist.required)
        .map((specialist) => specialistNodeId(specialist.specialistId))
    },
    {
      id: 'manager_synthesis',
      kind: 'agent',
      agentId: 'manager',
      label: 'Manager Synthesis',
      capabilities: ['synthesis']
    }
  ]
  const edges: AgentGraphEdge[] = []

  if (decision.specialists.length === 0) {
    edges.push({ from: 'manager_planning', to: 'join', condition: 'planned' })
  } else {
    for (const specialist of decision.specialists) {
      const nodeId = specialistNodeId(specialist.specialistId)
      if (specialist.dependsOn.length === 0) {
        edges.push({
          from: 'manager_planning',
          to: nodeId,
          condition: `activated:${specialist.specialistId}`
        })
      } else {
        for (const dependency of specialist.dependsOn) {
          edges.push({
            from: specialistNodeId(dependency),
            to: nodeId,
            condition: `dependency:${specialist.specialistId}`
          })
        }
      }
      edges.push({ from: nodeId, to: 'join', condition: 'completed' })
    }
  }
  edges.push({ from: 'join', to: 'manager_synthesis', condition: 'joined' })

  return AgentGraphSnapshotSchema.parse({
    version: 1,
    publicKey: input.graphPublicKey,
    templateId: TEAM_GRAPH_TEMPLATE_ID,
    registryRevision: input.registry.revision,
    startNodeId: 'manager_planning',
    nodes,
    edges,
    budgets: input.budgets
  })
}

function specialistNodeId(specialistId: string): string {
  return `specialist:${specialistId}`
}
```

> **来源说明**: `evented-v2-graph-template.ts` 逐行忠实移植自 KWorks（98 行）。无 KCoder 特化改动——图模板是 domain-neutral 的，不依赖具体 specialist 定义。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run tests/phase2-specialist-registry.test.ts`
Expected: PASS — 全部测试通过（15 个 Task1+2 + 7 个 Task3 = 22 个）

- [ ] **Step 5: 提交**

```bash
git add packages/engine/loop/src/evented-v2-graph-template.ts tests/phase2-specialist-registry.test.ts
git commit -m "feat(loop): 创建 evented-v2 team 图模板 materializeTeamGraph

materializeTeamGraph 把 ManagerRouteDecision 实例化为不可变 AgentGraphSnapshot DAG
（manager_planning → specialists → join → manager_synthesis）
TEAM_GRAPH_TEMPLATE_ID = 'manager-specialists-v1'
（来源 KWorks evented-v2-graph-template.ts 忠实移植，domain-neutral 无特化）"
```

---

## Task 4: barrel 导出 + 全量验证

**Files:**
- Modify: `packages/engine/loop/src/index.ts`（追加两行导出）

让 `@qiongqi/loop` 导出新模块，供 Phase 3+ 消费。

- [ ] **Step 1: 实现 — 在 index.ts 追加导出**

Read `packages/engine/loop/src/index.ts`，在末尾（`kernel-v3-turn-runner.js` 导出之后）追加：

```ts
export * from './kernel-v3-turn-runner.js'
export * from './specialist-registry.js'
export * from './evented-v2-graph-template.js'
```

- [ ] **Step 2: 类型检查 + 全量测试**

Run: `pnpm typecheck`
Expected: PASS — 0 错误（新模块类型自洽，且 contracts 依赖已就绪）

Run: `pnpm vitest run tests/phase2-specialist-registry.test.ts`
Expected: PASS — 22 个测试全过

- [ ] **Step 3: 全量回归（确认无破坏）**

Run: `pnpm vitest run tests/`
Expected: 仅有 Phase 1 已知的 5 个环境相关预存失败（KWorks 路径/CORS），无新增失败

> 若出现新失败，需排查是否因 barrel 导出导致符号冲突（如 `materializeTeamGraph` 与现有导出重名）。`grep -rnE "materializeTeamGraph|TEAM_GRAPH_TEMPLATE_ID|createDefaultSpecialistRegistry" packages/` 确认无意外覆盖。

- [ ] **Step 4: 引擎构建冒烟测试**

Run: `pnpm build`
Expected: PASS — 18 包构建成功（含 `@qiongqi/loop`）

- [ ] **Step 5: 提交**

```bash
git add packages/engine/loop/src/index.ts
git commit -m "feat(loop): barrel 导出 specialist-registry 与 evented-v2-graph-template

@qiongqi/loop 现导出 createDefaultSpecialistRegistry/materializeTeamGraph/TEAM_GRAPH_TEMPLATE_ID
供 Phase 3 turn runner 消费"
```

---

## Phase 2 完成验证

执行以下全部检查，全部 PASS 后 Phase 2 完成：

- [ ] **V1: Phase 2 单测全过**
  Run: `pnpm vitest run tests/phase2-specialist-registry.test.ts`
  Expected: PASS — 22 个测试（6 注册表基本 + 9 validateRoute + 7 materializeTeamGraph）

- [ ] **V2: 全量类型检查通过**
  Run: `pnpm typecheck`
  Expected: PASS — 0 错误

- [ ] **V3: 全量测试无新增回归**
  Run: `pnpm vitest run tests/`
  Expected: 仅 Phase 1 已知 5 个环境失败，无新增

- [ ] **V4: 引擎构建成功**
  Run: `pnpm build`
  Expected: PASS — 18 包构建成功

- [ ] **V5: git 历史干净**
  Run: `git log --oneline <merge-base>..HEAD`
  Expected: 4 个 commit（Task 1-4 各一），信息清晰

**Phase 2 完成后，进入 Phase 3（Agent Node Executor + Turn Runner + 现有 Runtime 升级）。** Phase 3 计划将在 Phase 2 验证通过后编写，基于本阶段产出的注册表/图模板接口。

---

## 附录：KCoder 与 KWorks 关键差异备忘

执行本计划时需注意的差异（已在 Task 1 实现中体现）：

1. **specialist 定义**: KWorks 有 25 个（3 编码 DEFAULT + 22 金融 FINANCE）；KCoder 为 10 个编码 specialist（`KCODER_CODING_SPECIALISTS`），无金融 specialist。
2. **`resolveSpecialistIdsForWorkMode`**: KWorks 有 finance 模块子集逻辑（`FINANCE_MODULE_SPECIALIST_IDS`）；KCoder 简化为透传（无 finance 模式）。
3. **`materializeTeamGraph`**: 无差异，逐行移植（domain-neutral）。
4. **import 路径**: `specialist-registry.ts` 无内部依赖（仅 `@qiongqi/contracts`）；`evented-v2-graph-template.ts` 依赖 `./specialist-registry.js`（本地）+ `@qiongqi/contracts`。
5. **barrel 导出**: 使用 `.js` 后缀 + `export *`，与 KCoder 现有 loop barrel 风格一致。
6. **测试风格**: 显式 `import { describe, expect, it } from 'vitest'`，与 Phase 1 测试一致。
