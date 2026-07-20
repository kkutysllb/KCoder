import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SkillsCapabilityConfig } from '@qiongqi/contracts'
import { SkillPluginHost } from '@qiongqi/skills'

// Build a fully-defaulted skills config so callers can pass partial overrides.
const cfg = (overrides: Record<string, unknown> = {}) =>
  SkillsCapabilityConfig.parse({ enabled: true, ...overrides })

let root: string
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'skills-'))
  // v1 skill
  await mkdir(join(root, 'tdd'), { recursive: true })
  await writeFile(join(root, 'tdd', 'skill.json'), JSON.stringify({
    specVersion: '1.0', id: 'tdd', name: 'TDD', category: 'development',
    activation: { commands: ['/tdd'], autoActivate: false },
    commands: [{ id: 'tdd', alias: [], description: 'x', injectPrompt: 'go' }],
    tools: { allowed: ['read', 'edit'] }
  }))
  await writeFile(join(root, 'tdd', 'SKILL.md'), '# TDD\nWrite tests first.')
  // legacy skill.json (no specVersion)
  await mkdir(join(root, 'legacy'), { recursive: true })
  await writeFile(join(root, 'legacy', 'skill.json'), JSON.stringify({
    name: 'Legacy', triggers: { commands: ['/legacy'] }, allowedTools: ['read']
  }))
  await writeFile(join(root, 'legacy', 'SKILL.md'), '# Legacy')
  // legacy SKILL.md only
  await mkdir(join(root, 'mdonly'), { recursive: true })
  await writeFile(join(root, 'mdonly', 'SKILL.md'), '---\nid: mdonly\nname: MdOnly\n---\n# body')
})
afterAll(async () => { await rm(root, { recursive: true, force: true }) })

describe('SkillPluginHost.create', () => {
  it('discovers v1, legacy skill.json, and legacy SKILL.md', async () => {
    const host = await SkillPluginHost.create(cfg({ roots: [root] }), {})
    const ids = host.diagnostics().skills.map((s) => s.id).sort()
    expect(ids).toEqual(['legacy', 'mdonly', 'tdd'])
  })

  it('marks v1 as non-legacy and migrated ones as legacy', async () => {
    const host = await SkillPluginHost.create(cfg({ roots: [root] }), {})
    const byId = new Map(host.diagnostics().skills.map((s) => [s.id, s]))
    expect(byId.get('tdd')?.legacy).toBe(false)
    expect(byId.get('legacy')?.legacy).toBe(true)
    expect(byId.get('mdonly')?.legacy).toBe(true)
  })

  it('collects validation errors for bad manifests without aborting others', async () => {
    const bad = await mkdtemp(join(tmpdir(), 'bad-'))
    await mkdir(join(bad, 'broken'), { recursive: true })
    await writeFile(join(bad, 'broken', 'skill.json'), '{ not json')
    await writeFile(join(bad, 'broken', 'SKILL.md'), 'ok')
    const host = await SkillPluginHost.create(cfg({ roots: [bad] }), {})
    expect(host.diagnostics().validationErrors.length).toBeGreaterThan(0)
    await rm(bad, { recursive: true, force: true })
  })
})

describe('SkillPluginHost.resolveTurn', () => {
  it('activates by explicit mention, command, pattern, fileType', async () => {
    const host = await SkillPluginHost.create(cfg({ roots: [root] }), {})
    const explicit = host.resolveTurn({ prompt: '/skill:tdd now', workspace: '' })
    expect(explicit.activeSkillIds).toContain('tdd')
    expect(explicit.instructions.some((i) => i.includes('Write tests first.'))).toBe(true)

    const cmd = host.resolveTurn({ prompt: '/legacy run', workspace: '' })
    expect(cmd.activeSkillIds).toContain('legacy')

    const res = host.resolveTurn({ prompt: '/tdd cycle', workspace: '' })
    // Skills inject instructions but do NOT restrict the turn tool catalog
    // (a skill's tools.allowed is additive info, not a session allow-list).
    expect(res.activeSkillIds).toContain('tdd')
    expect(res.instructions.length).toBeGreaterThan(0)
  })

  it('exposes the latest activations through diagnostics', async () => {
    const host = await SkillPluginHost.create(cfg({ roots: [root] }), {})

    host.resolveTurn({ prompt: '/skill:tdd now', workspace: '' })

    expect(host.diagnostics().lastActivations).toEqual([
      expect.objectContaining({ skillId: 'tdd' })
    ])
  })

  it('injects the resolved skill package root for bundled skill resources', async () => {
    const host = await SkillPluginHost.create(cfg({ roots: [root] }), {})
    const res = host.resolveTurn({ prompt: '/skill:tdd now', workspace: '/workspace/project' })

    const joined = res.instructions.join('\n')
    expect(joined).toContain(`Skill package root: ${join(root, 'tdd')}`)
    expect(joined).toContain(`Skill entry file: ${join(root, 'tdd', 'SKILL.md')}`)
    expect(joined).toContain('Resolve relative skill resource paths from this skill package root')
  })

  it('respects enabledSkills=false to exclude a skill', async () => {
    const host = await SkillPluginHost.create(
      cfg({ roots: [root] }),
      { enabledSkills: { tdd: false } }
    )
    const res = host.resolveTurn({ prompt: '/skill:tdd', workspace: '' })
    expect(res.activeSkillIds).not.toContain('tdd')
  })

  it('injects forced skills without a prompt match and deduplicates them', async () => {
    const host = await SkillPluginHost.create(cfg({ roots: [root] }), {})

    const res = host.resolveTurn({
      prompt: 'ordinary request',
      workspace: '',
      effectiveSkillIds: ['tdd'],
      forcedSkillIds: ['tdd', 'tdd']
    })

    expect(res.activeSkillIds).toEqual(['tdd'])
    expect(res.instructions.join('\n')).toContain('Write tests first.')
    expect(res.activations).toContainEqual(expect.objectContaining({
      skillId: 'tdd',
      reason: 'explicit-activation'
    }))
  })

  it('validates activatable skills against loading, enablement, and work mode', async () => {
    const host = await SkillPluginHost.create(cfg({ roots: [root] }), {})

    expect(host.resolveActivatableSkill('tdd', {
      workspace: '',
      effectiveSkillIds: ['tdd']
    })).toMatchObject({ ok: true, skill: { id: 'tdd' } })
    expect(host.resolveActivatableSkill('missing', {
      workspace: '',
      effectiveSkillIds: ['missing']
    })).toEqual({ ok: false, code: 'unknown_skill' })
    expect(host.resolveActivatableSkill('tdd', {
      workspace: '',
      effectiveSkillIds: ['legacy']
    })).toEqual({ ok: false, code: 'skill_out_of_mode' })

    const disabled = await SkillPluginHost.create(
      cfg({ roots: [root] }),
      { enabledSkills: { tdd: false } }
    )
    expect(disabled.resolveActivatableSkill('tdd', {
      workspace: '',
      effectiveSkillIds: ['tdd']
    })).toEqual({ ok: false, code: 'skill_disabled' })
  })

  it('reads enabledSkills from a dynamic provider for hot user-scoped changes', async () => {
    let enabledSkills: Record<string, boolean> = { tdd: false }
    const host = await SkillPluginHost.create(
      cfg({ roots: [root] }),
      { enabledSkillsProvider: () => enabledSkills }
    )

    expect(host.resolveTurn({ prompt: '/skill:tdd', workspace: '' }).activeSkillIds).not.toContain('tdd')

    enabledSkills = { tdd: true }

    expect(host.resolveTurn({ prompt: '/skill:tdd', workspace: '' }).activeSkillIds).toContain('tdd')
  })

  it('reloads work mode definitions on the same host instance', async () => {
    const host = await SkillPluginHost.create(cfg({ roots: [root] }), {})

    expect(host.workModeInfo('finance-market')?.id).toBe('office')

    await host.reload(cfg({
      roots: [root],
      workModes: {
        defaultModeId: 'office',
        modes: {
          task: {
            id: 'office',
            name: 'Task',
            defaultSkillIds: []
          },
          'finance-market': {
            id: 'finance-market',
            name: '金融市场',
            description: '分析市场数据、公告和交易机会',
            defaultSkillIds: ['tdd']
          }
        }
      }
    }))

    expect(host.workModeInfo('finance-market')).toMatchObject({
      id: 'finance-market',
      name: '金融市场',
      description: '分析市场数据、公告和交易机会'
    })
    expect(host.effectiveSkillIds('finance-market')).toContain('tdd')
  })

  it('respects activeLimit', async () => {
    const host = await SkillPluginHost.create(
      cfg({ roots: [root] }),
      { activeLimit: 1 }
    )
    const res = host.resolveTurn({ prompt: '/skill:tdd /skill:legacy', workspace: '' })
    expect(res.activeSkillIds.length).toBeLessThanOrEqual(1)
  })

  it('advertises enabled skills even when none activate for the prompt', async () => {
    const host = await SkillPluginHost.create(cfg({ roots: [root] }), {})

    const res = host.resolveTurn({
      prompt: 'what skills can you use?',
      workspace: '',
      effectiveSkillIds: ['tdd']
    })

    const joined = res.instructions.join('\n')
    expect(res.activeSkillIds).toEqual([])
    expect(joined).toContain('Available Skills')
    expect(joined).toContain('TDD (tdd)')
    expect(joined).not.toContain('Legacy (legacy)')
    expect(joined).toContain('not direct tool calls')
    expect(joined).toContain('available, or usable skills')
  })

  it('explains configured work mode skill IDs even when their instruction packages are not loaded', async () => {
    const host = await SkillPluginHost.create(cfg({
      roots: [root],
      workModes: {
        defaultModeId: 'empty-mode',
        modes: {
          'empty-mode': {
            id: 'empty-mode',
            name: 'Empty Mode',
            builtin: false,
            editable: true,
            defaultSkillIds: ['missing-skill']
          }
        }
      },
      lockedSkillIds: []
    }), {})

    const res = host.resolveTurn({
      prompt: '有哪些技能可以调用？',
      workspace: '',
      workModeId: 'empty-mode'
    })

    const joined = res.instructions.join('\n')
    expect(res.activeSkillIds).toEqual([])
    expect(joined).toContain('Available Skills for work mode "empty-mode"')
    expect(joined).toContain('Configured skill IDs without loaded instruction packages')
    expect(joined).toContain('missing-skill')
    expect(joined).toContain('Do not list built-in tools')
  })

  it('tells the model to discover installed skills from configured skill roots, not the workspace', async () => {
    const host = await SkillPluginHost.create(cfg({ roots: [root] }), {})

    const res = host.resolveTurn({
      prompt: '我刚创建的新技能能识别吗？',
      workspace: '/workspace/project',
      effectiveSkillIds: ['tdd']
    })

    const joined = res.instructions.join('\n')
    expect(joined).toContain('Available Skills')
    expect(joined).toContain('TDD (tdd)')
    expect(joined).toContain('answer from this list')
  })

  it('does not restrict the turn tool catalog even when a skill declares workspace:read', async () => {
    const roRoot = await mkdtemp(join(tmpdir(), 'ro-'))
    await mkdir(join(roRoot, 'ro'), { recursive: true })
    await writeFile(join(roRoot, 'ro', 'skill.json'), JSON.stringify({
      specVersion: '1.0', id: 'ro', name: 'RO',
      activation: { commands: ['/ro'], autoActivate: false },
      tools: { allowed: ['read', 'edit', 'bash'] },
      permissions: { workspace: 'read' }
    }))
    await writeFile(join(roRoot, 'ro', 'SKILL.md'), 'body')
    const host = await SkillPluginHost.create(cfg({ roots: [roRoot] }), {})
    const res = host.resolveTurn({ prompt: '/ro', workspace: '' })
    expect(res.activeSkillIds).toContain('ro')
    // resolveTurn must NOT return allowedToolNames — doing so would wrongly
    // exclude tools (e.g. bash) that coexisting flows (like /review) need.
    expect(res.allowedToolNames).toBeUndefined()
    await rm(roRoot, { recursive: true, force: true })
  })
})
