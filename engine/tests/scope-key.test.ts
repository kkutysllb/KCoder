import { describe, expect, it } from 'vitest'
import { encodeScopeKey, type ScopeKey } from '@qiongqi/contracts'

function scope(overrides: Partial<ScopeKey> = {}): ScopeKey {
  return { ownerUserId: 'u1', workspaceKey: 'w1', threadId: 't1', purpose: 'runtime', ...overrides }
}

describe('ScopeKey encoding', () => {
  it('changes when owner changes even if thread ids match', () => {
    expect(encodeScopeKey(scope())).not.toBe(encodeScopeKey(scope({ ownerUserId: 'u2' })))
  })

  it('is deterministic and includes optional run scope', () => {
    const a = encodeScopeKey(scope({ runId: 'r1', turnId: 'tu1' }))
    const b = encodeScopeKey({ purpose: 'runtime', threadId: 't1', ownerUserId: 'u1', turnId: 'tu1', workspaceKey: 'w1', runId: 'r1' })
    expect(a).toBe(b)
    expect(a).toContain('runId=r1')
  })
})
