import { describe, expect, it } from 'vitest'
import { buildSkillToolProvider, type ActiveSkillsLookup } from '@qiongqi/skills'
import type { LoadedSkillPlugin } from '@qiongqi/skills'
import type { ToolHostContext } from '@qiongqi/ports'
import { createActivateSkillTool } from '@qiongqi/adapter-tools'

function plugin(id: string, declName: string): LoadedSkillPlugin {
  return {
    id, root: `/r/${id}`, entryPath: '/r', entry: '', assets: [], legacy: false, source: 'unknown',
    manifest: {
      specVersion: '1.0', id, name: id, version: '0', entry: 'SKILL.md', category: 'workflow', priority: 0,
      activation: { commands: [], promptPatterns: [], fileTypes: [], autoActivate: false },
      commands: [],
      tools: {
        allowed: [],
        declarations: [{ name: declName, template: 'bash', args: { command: 'npm test' }, description: 'run tests', policy: 'auto' }],
        mcpServers: {}
      },
      contributes: { chatMenu: [], quickTask: [] },
      permissions: { workspace: 'write', network: false, exec: 'none', requiresApproval: 'on-request' },
      assets: []
    }
  }
}

const ctx = (active: string[]): ToolHostContext => ({
  threadId: 't', turnId: '1', workspace: '', activeSkillIds: active
} as unknown as ToolHostContext)

describe('buildSkillToolProvider', () => {
  it('does not advertise tool when skill inactive', () => {
    const lookup: ActiveSkillsLookup = () => []
    const provider = buildSkillToolProvider([plugin('tdd', 'run_tests')], lookup)
    const specs = provider.tools.map((t) => ({ name: t.name, advertise: t.shouldAdvertise ? t.shouldAdvertise(ctx([])) : true }))
    expect(specs.length).toBe(1)
    expect(specs[0].advertise).toBe(false)
  })

  it('advertises tool when skill active', () => {
    const lookup: ActiveSkillsLookup = (id) => (id === 'tdd' ? ['tdd'] : [])
    const provider = buildSkillToolProvider([plugin('tdd', 'run_tests')], lookup)
    const tool = provider.tools[0]
    expect(tool.shouldAdvertise?.(ctx(['tdd']))).toBe(true)
    expect(tool.toolKind).toBe('tool_call')
  })

  it('marks provider kind skill and id', () => {
    const provider = buildSkillToolProvider([plugin('tdd', 'run_tests')], () => [])
    expect(provider.kind).toBe('skill')
    expect(provider.id).toBe('skill')
  })

  it('delegates execute to the injected executor when provided', async () => {
    let captured: { template: string; args: unknown } | null = null
    const executor = async (template: string, args: Record<string, unknown>) => {
      captured = { template, args }
      return { output: 'real test output' }
    }
    const provider = buildSkillToolProvider([plugin('tdd', 'run_tests')], () => [], executor as never)
    const result = await provider.tools[0].execute({}, ctx(['tdd']) as never)
    expect(captured).toEqual({ template: 'bash', args: { command: 'npm test' } })
    expect(result).toEqual({ output: 'real test output' })
  })

  it('returns a descriptive message when no executor is injected', async () => {
    const provider = buildSkillToolProvider([plugin('tdd', 'run_tests')], () => [])
    const result = await provider.tools[0].execute({}, ctx(['tdd']) as never)
    expect(typeof result.output).toBe('string')
    expect(result.output).toContain('run_tests')
  })
})

describe('createActivateSkillTool', () => {
  const activationContext = ctx([])

  it('activates an enabled skill and is idempotent', async () => {
    const activated: string[] = []
    const tool = createActivateSkillTool({
      resolveSkill: (skillId) => skillId === 'chart-visualization'
        ? { ok: true, skill: { id: skillId } }
        : { ok: false, code: 'unknown_skill' },
      activateTurnSkill: async ({ skillId }) => { activated.push(skillId) }
    })

    expect(await tool.execute({ skill_id: 'chart-visualization' }, activationContext)).toEqual({
      output: { code: 'skill_activated', skill_id: 'chart-visualization' }
    })
    expect(await tool.execute({ skill_id: 'chart-visualization' }, activationContext)).toEqual({
      output: { code: 'skill_activated', skill_id: 'chart-visualization' }
    })
    expect(activated).toEqual(['chart-visualization', 'chart-visualization'])
  })

  it.each(['unknown_skill', 'skill_disabled', 'skill_out_of_mode'] as const)(
    'returns a structured rejection for %s without activating',
    async (code) => {
      let activated = false
      const tool = createActivateSkillTool({
        resolveSkill: () => ({ ok: false, code }),
        activateTurnSkill: async () => { activated = true }
      })

      const result = await tool.execute({ skill_id: 'chart-visualization' }, activationContext)

      expect(result).toEqual({
        output: { code: 'skill_activation_rejected', reason: code },
        isError: true
      })
      expect(activated).toBe(false)
    }
  )

  it('rejects malformed skill ids before calling the resolver', async () => {
    let resolved = false
    const tool = createActivateSkillTool({
      resolveSkill: () => {
        resolved = true
        return { ok: false, code: 'unknown_skill' }
      },
      activateTurnSkill: async () => undefined
    })

    const result = await tool.execute({ skill_id: '  ' }, activationContext)

    expect(result.isError).toBe(true)
    expect(result.output).toEqual({ code: 'skill_activation_rejected', reason: 'invalid_skill_id' })
    expect(resolved).toBe(false)
  })
})
