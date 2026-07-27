import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')
const manifest = (path: string) => JSON.parse(read(path)) as { dependencies?: Record<string, string> }
const compilerPaths = (path: string) => (
  JSON.parse(read(path)) as { compilerOptions?: { paths?: Record<string, string[]> } }
).compilerOptions?.paths
const packageTsconfigs = () => readdirSync('packages', { withFileTypes: true }).flatMap((layer) => {
  if (!layer.isDirectory()) return []
  return readdirSync(`packages/${layer.name}`, { withFileTypes: true }).flatMap((pkg) => {
    const path = `packages/${layer.name}/${pkg.name}/tsconfig.json`
    return pkg.isDirectory() && existsSync(path) ? [path] : []
  })
})

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

  it('resolves direct workspace imports from source before dist exists', () => {
    const configs = packageTsconfigs()
    expect(configs).toHaveLength(18)
    let checked = 0
    for (const config of configs) {
      const paths = compilerPaths(config)
      if (!paths || Object.keys(paths).length < 10) continue
      checked += 1
      expect(paths, config).toMatchObject({
        '@qiongqi/adapter-fs': ['../../infrastructure/adapter-fs/src'],
        '@qiongqi/tool-infra': ['../../infrastructure/tool-infra/src']
      })
    }
    expect(checked).toBe(16)
  })
})
