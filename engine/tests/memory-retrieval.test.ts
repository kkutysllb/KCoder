import { describe, expect, it } from 'vitest'
import { rankMemoryRecords, tokenizeMemoryText } from '@qiongqi/memory'
import type { MemoryRecord } from '@qiongqi/contracts'

describe('memory retrieval ranking', () => {
  it('tokenizes Chinese n-grams and English technical tokens', () => {
    const tokens = tokenizeMemoryText('穷奇引擎 A2A traceparent better-sqlite3 adapter_tools')

    expect(tokens).toContain('穷奇')
    expect(tokens).toContain('引擎')
    expect(tokens).toContain('a2a')
    expect(tokens).toContain('traceparent')
    expect(tokens).toContain('better-sqlite3')
    expect(tokens).toContain('better')
    expect(tokens).toContain('sqlite3')
    expect(tokens).toContain('adapter_tools')
    expect(tokens).toContain('adapter')
    expect(tokens).toContain('tools')
  })

  it('ranks Chinese relevant facts above unrelated facts', () => {
    const ranked = rankMemoryRecords({
      query: '穷奇引擎 如何验证 A2A 跨实例',
      records: [
        memory('mem_unrelated', '用户喜欢深色主题'),
        memory('mem_a2a', '穷奇引擎需要运行 evented A2A 跨实例验证脚本')
      ],
      limit: 2
    })

    expect(ranked.map((record) => record.id)).toEqual(['mem_a2a'])
  })

  it('preserves technical-token exact matches', () => {
    const ranked = rankMemoryRecords({
      query: 'better-sqlite3 traceparent adapter-tools',
      records: [
        memory('mem_generic', 'SQLite storage and tracing are useful'),
        memory('mem_exact', 'Run better-sqlite3 binding checks and propagate traceparent in adapter-tools tests')
      ],
      limit: 2
    })

    expect(ranked[0]?.id).toBe('mem_exact')
  })

  it('filters workspace-scoped facts outside the active workspace', () => {
    const ranked = rankMemoryRecords({
      query: 'pnpm frontend',
      workspace: '/tmp/current',
      records: [
        memory('mem_other', 'Use pnpm for frontend work', { scope: 'workspace', workspace: '/tmp/other' }),
        memory('mem_current', 'Use pnpm for frontend work', { scope: 'workspace', workspace: '/tmp/current' }),
        memory('mem_user', 'User prefers pnpm', { scope: 'user' })
      ],
      limit: 5
    })

    expect(ranked.map((record) => record.id)).toEqual(['mem_current', 'mem_user'])
  })

  it('shares project memory across threads only within the same owner and workspace', () => {
    const ranked = rankMemoryRecords({
      query: 'project build', workspace: '/tmp/current', ownerUserId: 'owner-a',
      records: [
        memory('mem_project_same_owner', 'project build convention', { ownerUserId: 'owner-a', scope: 'project', workspace: '/tmp/current', sourceThreadId: 'thread-1' }),
        memory('mem_project_other_owner', 'project build convention', { ownerUserId: 'owner-b', scope: 'project', workspace: '/tmp/current', sourceThreadId: 'thread-1' })
      ], limit: 5
    })
    expect(ranked.map((record) => record.id)).toEqual(['mem_project_same_owner'])
  })

  it('uses confidence and recency as deterministic tie breakers', () => {
    const ranked = rankMemoryRecords({
      query: 'pnpm',
      records: [
        memory('mem_low', 'pnpm', { confidence: 0.2, updatedAt: '2026-06-20T00:00:00.000Z' }),
        memory('mem_high_old', 'pnpm', { confidence: 0.9, updatedAt: '2026-06-19T00:00:00.000Z' }),
        memory('mem_high_new', 'pnpm', { confidence: 0.9, updatedAt: '2026-06-21T00:00:00.000Z' })
      ],
      limit: 3
    })

    expect(ranked.map((record) => record.id)).toEqual(['mem_high_new', 'mem_high_old', 'mem_low'])
  })
})

function memory(id: string, content: string, overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id,
    content,
    scope: 'user',
    tags: [],
    confidence: 1,
    createdAt: '2026-06-18T00:00:00.000Z',
    updatedAt: '2026-06-18T00:00:00.000Z',
    ...overrides
  }
}
