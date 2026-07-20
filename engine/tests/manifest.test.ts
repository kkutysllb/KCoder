import { describe, expect, it } from 'vitest'
import { migrateLegacyManifest, SkillManifestV1 } from '@qiongqi/skills'

describe('SkillManifestV1', () => {
  it('parses a minimal valid manifest', () => {
    const parsed = SkillManifestV1.parse({
      specVersion: '1.0',
      id: 'tdd',
      name: 'TDD',
      entry: 'SKILL.md'
    })
    expect(parsed.id).toBe('tdd')
    expect(parsed.entry).toBe('SKILL.md')
    expect(parsed.category).toBe('workflow')
    expect(parsed.activation.autoActivate).toBe(false)
    expect(parsed.permissions.workspace).toBe('write')
    expect(parsed.permissions.exec).toBe('none')
    expect(parsed.permissions.network).toBe(false)
  })

  it('parses a full manifest with all capability dimensions', () => {
    const parsed = SkillManifestV1.parse({
      specVersion: '1.0',
      id: 'tdd',
      name: 'TDD',
      version: '1.2.0',
      category: 'development',
      priority: 5,
      activation: { commands: ['/tdd'], promptPatterns: ['\\btdd\\b'], fileTypes: ['.test.ts'], autoActivate: true },
      commands: [{ id: 'tdd', alias: ['test'], description: 'start', injectPrompt: 'go' }],
      tools: {
        allowed: ['read', 'edit'],
        declarations: [{ name: 'run_tests', template: 'bash', args: { command: 'npm test' }, description: 'run', policy: 'auto' }],
        mcpServers: { r: { transport: 'stdio', command: 'node', args: ['r.js'], trustScope: 'workspace', trustedWorkspaceRoots: ['${workspace}'] } }
      },
      contributes: { chatMenu: [{ commandId: 'tdd', title: 'TDD', icon: 'flask' }] },
      permissions: { workspace: 'read', network: false, exec: 'workspace', requiresApproval: 'on-request' }
    })
    expect(parsed.commands).toHaveLength(1)
    expect(parsed.tools.allowed).toEqual(['read', 'edit'])
    expect(parsed.contributes.chatMenu[0].commandId).toBe('tdd')
    expect(parsed.permissions.workspace).toBe('read')
  })

  it('rejects manifest without specVersion matching 1.x', () => {
    expect(() => SkillManifestV1.parse({ id: 'x', name: 'X' })).toThrow()
  })

  it('rejects invalid id (non-slug)', () => {
    expect(() => SkillManifestV1.parse({ specVersion: '1.0', id: 'Bad ID!', name: 'X' })).toThrow()
  })

  it('rejects specVersion 2.0', () => {
    expect(() => SkillManifestV1.parse({ specVersion: '2.0', id: 'x', name: 'X' })).toThrow()
  })

  it('accepts specVersion 1.5', () => {
    expect(SkillManifestV1.parse({ specVersion: '1.5', id: 'x', name: 'X' }).specVersion).toBe('1.5')
  })
})

describe('migrateLegacyManifest', () => {
  it('migrates a legacy skill.json (no specVersion) to v1', () => {
    const v1 = migrateLegacyManifest({
      id: 'legacy',
      name: 'Legacy Skill',
      description: 'old',
      triggers: { commands: ['/legacy'], promptPatterns: ['legacy'], fileTypes: ['.ts'] },
      allowedTools: ['read', 'bash'],
      assets: ['ref.md'],
      priority: 2
    })
    expect(v1.specVersion).toBe('1.0')
    expect(v1.id).toBe('legacy')
    expect(v1.activation.commands).toEqual(['/legacy'])
    expect(v1.tools.allowed).toEqual(['read', 'bash'])
    expect(v1.commands[0].id).toBe('legacy')
    expect(v1.commands[0].injectPrompt).toContain('legacy')
    expect(v1.permissions.workspace).toBe('write')
  })

  it('derives commands from activation.commands when commands[] missing', () => {
    const v1 = migrateLegacyManifest({ name: 'NoCmd', triggers: { commands: ['/a', '/b'] } })
    expect(v1.commands.map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('migrates SKILL.md frontmatter shape', () => {
    const v1 = migrateLegacyManifest({ name: 'FromMd', description: 'd', id: 'from-md' })
    expect(v1.id).toBe('from-md')
    expect(v1.entry).toBe('SKILL.md')
    expect(v1.activation.autoActivate).toBe(false)
  })

  it('rejects empty name during migration', () => {
    expect(() => migrateLegacyManifest({ name: '' })).toThrow()
  })

  it('preserves custom entry path', () => {
    const v1 = migrateLegacyManifest({ name: 'X', entry: 'GUIDE.md' })
    expect(v1.entry).toBe('GUIDE.md')
  })
})
