import { describe, expect, it } from 'vitest'
import { collectSkillMcpServers } from '@qiongqi/skills'
import type { LoadedSkillPlugin } from '@qiongqi/skills'

function plugin(id: string, servers: Record<string, unknown>): LoadedSkillPlugin {
  return {
    id, root: `/r/${id}`, entryPath: '/r', entry: '', assets: [], legacy: false, source: 'unknown',
    manifest: {
      specVersion: '1.0', id, name: id, version: '0', entry: 'SKILL.md', category: 'workflow', priority: 0,
      activation: { commands: [], promptPatterns: [], fileTypes: [], autoActivate: false },
      commands: [],
      tools: { allowed: [], declarations: [], mcpServers: servers },
      contributes: { chatMenu: [], quickTask: [] },
      permissions: { workspace: 'write', network: false, exec: 'none', requiresApproval: 'on-request' },
      assets: []
    }
  }
}

describe('collectSkillMcpServers', () => {
  it('namespaces server ids by skill and injects workspace trust', () => {
    const out = collectSkillMcpServers(
      [plugin('tdd', { runner: { transport: 'stdio', command: 'node', args: ['r.js'] } })],
      '/ws'
    )
    expect(Object.keys(out)).toEqual(['tdd__runner'])
    expect(out.tdd__runner).toMatchObject({ transport: 'stdio', command: 'node', trustScope: 'workspace', trustedWorkspaceRoots: ['/ws'] })
  })

  it('skips servers from disabled skills when filter provided', () => {
    const out = collectSkillMcpServers(
      [plugin('tdd', { runner: { transport: 'stdio', command: 'node' } })],
      '/ws',
      (p) => p.id !== 'tdd'
    )
    expect(out).toEqual({})
  })
})
