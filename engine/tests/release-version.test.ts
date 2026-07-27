import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function packageFiles(root: string): string[] {
  const files = [join(root, 'package.json')]
  for (const layer of readdirSync(join(root, 'packages'), { withFileTypes: true })) {
    if (!layer.isDirectory()) continue
    for (const pkg of readdirSync(join(root, 'packages', layer.name), { withFileTypes: true })) {
      if (pkg.isDirectory()) files.push(join(root, 'packages', layer.name, pkg.name, 'package.json'))
    }
  }
  return files
}

describe('engine v1.1.2 release metadata', () => {
  it('keeps root and all 18 workspace packages on exactly 1.1.2', () => {
    const root = process.cwd()
    const versions = packageFiles(root).map((file) => JSON.parse(readFileSync(file, 'utf8')).version)
    expect(versions).toHaveLength(19)
    expect(new Set(versions)).toEqual(new Set(['1.1.2']))
  })

  it('links the parallel design, implementation plan, migration, and patch notes', () => {
    const root = process.cwd()
    const specification = readFileSync(
      join(root, 'docs/superpowers/specs/2026-07-27-durable-parallel-join-design.md'),
      'utf8'
    )
    const implementationPlan = readFileSync(
      join(root, 'docs/superpowers/plans/2026-07-27-durable-parallel-join.md'),
      'utf8'
    )
    const readme = readFileSync(join(root, 'README.md'), 'utf8')
    const englishReadme = readFileSync(join(root, 'README.en.md'), 'utf8')
    const migration = readFileSync(join(root, 'docs/migrations/engine-v1.1.md'), 'utf8')
    const release = readFileSync(join(root, 'docs/releases/v1.1.2.md'), 'utf8')

    expect(specification).toContain('Durable Parallel Branch and Join')
    expect(implementationPlan).toContain('Durable Parallel Branch and Join Implementation Plan')
    expect(readme).toContain('docs/releases/v1.1.2.md')
    expect(englishReadme).toContain('docs/releases/v1.1.2.md')
    expect(migration).toContain('migrateGraphOnlyRun')
    expect(migration).toContain('Upgrade v1.1.1 to v1.1.2')
    expect(release).toContain('requestedBudgets')
  })
})
