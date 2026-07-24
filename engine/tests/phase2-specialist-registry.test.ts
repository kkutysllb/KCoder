import { describe, expect, it } from 'vitest'
import {
  createDefaultSpecialistRegistry,
  materializeTeamGraph,
  TEAM_GRAPH_TEMPLATE_ID,
  type SpecialistDefinition,
  type SpecialistRegistryContract
} from '@qiongqi/loop'
import { ManagerRouteDecisionSchema, type ManagerRouteDecision } from '@qiongqi/contracts'

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
      enabledIds: ['backend', 'frontend']
    })
    // listEnabled 查询可包含未启用（planning）和不存在（nonexistent）的 id，结果过滤掉它们
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
    const nodeIds = snapshot.nodes.map((n) => n.id)
    expect(nodeIds).toEqual(['manager_planning', 'join', 'manager_synthesis'])
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
    const backendNode = snapshot.nodes.find((n) => n.id === 'specialist:backend')!
    expect(backendNode.label).toBe('后端逻辑工程师')
    const joinNode = snapshot.nodes.find((n) => n.id === 'join')!
    expect(joinNode.kind).toBe('join')
    if (joinNode.kind === 'join') {
      expect(joinNode.requiredBranchIds).toEqual(['specialist:backend'])
    }
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
    expect(snapshot.edges).toContainEqual({ from: 'specialist:backend', to: 'specialist:frontend', condition: 'dependency:frontend' })
    expect(snapshot.edges).toContainEqual({ from: 'manager_planning', to: 'specialist:backend', condition: 'activated:backend' })
    expect(snapshot.edges).toContainEqual({ from: 'specialist:backend', to: 'join', condition: 'completed' })
    expect(snapshot.edges).toContainEqual({ from: 'specialist:frontend', to: 'join', condition: 'completed' })
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
      expect(joinNode.requiredBranchIds).toEqual(['specialist:backend'])
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

