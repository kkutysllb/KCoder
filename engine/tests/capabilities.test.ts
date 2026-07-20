import { describe, expect, it } from 'vitest'
import { SkillsCapabilityConfig } from '@qiongqi/contracts'

describe('SkillsCapabilityConfig', () => {
  it('defaults new fields', () => {
    const c = SkillsCapabilityConfig.parse({ enabled: true, roots: ['/x'] })
    expect(c.enabledSkills).toEqual({})
    expect(c.marketplace.autoUpdate).toBe(false)
    expect(c.marketplace.source).toBeUndefined()
  })

  it('parses git marketplace source', () => {
    const c = SkillsCapabilityConfig.parse({
      enabled: true, roots: [],
      marketplace: { source: { kind: 'git', url: 'https://example.org/m.git', branch: 'main' }, autoUpdate: true }
    })
    expect(c.marketplace.source?.kind).toBe('git')
    expect(c.marketplace.autoUpdate).toBe(true)
  })

  it('parses enabledSkills map', () => {
    const c = SkillsCapabilityConfig.parse({ enabled: true, roots: [], enabledSkills: { tdd: false } })
    expect(c.enabledSkills.tdd).toBe(false)
  })
})
