import { describe, expect, it } from 'vitest'
import { collectCommands } from '@qiongqi/skills'
import type { LoadedSkillPlugin } from '@qiongqi/skills'

function plugin(id: string, commands: Array<{ id: string; alias?: string[] }>): LoadedSkillPlugin {
  return {
    id, root: `/r/${id}`, entryPath: '/r/x', entry: '', assets: [], legacy: false, source: 'unknown',
    manifest: {
      specVersion: '1.0', id, name: id, version: '0.0.0', entry: 'SKILL.md', category: 'workflow', priority: 0,
      activation: { commands: [], promptPatterns: [], fileTypes: [], autoActivate: false },
      commands: commands.map((c) => ({ id: c.id, alias: c.alias ?? [], description: `${c.id} desc`, injectPrompt: `${c.id} prompt` })),
      tools: { allowed: [], declarations: [], mcpServers: {} },
      contributes: { chatMenu: [], quickTask: [] },
      permissions: { workspace: 'write', network: false, exec: 'none', requiresApproval: 'on-request' },
      assets: []
    }
  }
}

describe('collectCommands', () => {
  it('flattens commands from plugins and namespaces alias resolution', () => {
    const cmds = collectCommands([plugin('tdd', [{ id: 'tdd', alias: ['test'] }]), plugin('rev', [{ id: 'review' }])])
    expect(cmds.map((c) => c.id)).toEqual(['tdd', 'review'])
    expect(cmds[0].alias).toEqual(['test'])
  })

  it('dedupes by id, later loses', () => {
    const cmds = collectCommands([plugin('a', [{ id: 'go' }]), plugin('b', [{ id: 'go' }])])
    expect(cmds.filter((c) => c.id === 'go')).toHaveLength(1)
  })
})
