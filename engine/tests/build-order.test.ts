import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')
const manifest = (path: string) => JSON.parse(read(path)) as { dependencies?: Record<string, string> }

describe('strict package build order', () => {
  it('does not tolerate non-zero package compiler exits', () => {
    const script = read('scripts/build.mjs')
    expect(script).not.toContain('OK (with non-fatal type warnings)')
    expect(script).not.toContain('type-only back-edges are tolerated')
  })

  it('removes reverse package dependencies from services, skills, and loop', () => {
    expect(manifest('packages/engine/services/package.json').dependencies).not.toHaveProperty('@qiongqi/loop')
    expect(manifest('packages/capabilities/skills/package.json').dependencies).not.toHaveProperty('@qiongqi/adapter-tools')
    expect(manifest('packages/engine/loop/package.json').dependencies).not.toHaveProperty('@qiongqi/adapter-tools')
    expect(read('packages/engine/services/src/turn-service.ts')).not.toContain("from '@qiongqi/loop'")
    expect(read('packages/capabilities/skills/src/skill-tool-provider.ts')).not.toContain("from '@qiongqi/adapter-tools'")
  })

  it('builds loop before delegation and adapter-tools after the cycle is removed', () => {
    const script = read('scripts/build.mjs')
    expect(script.indexOf("['loop',")).toBeLessThan(script.indexOf("['delegation',"))
    expect(script.indexOf("['delegation',")).toBeLessThan(script.indexOf("['adapter-tools',"))
  })
})
