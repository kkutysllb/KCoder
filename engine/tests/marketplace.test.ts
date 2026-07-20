import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest'
import { mkdtemp, writeFile, mkdir, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MarketplaceClient, parseMarketplaceManifest, type GitOperations } from '@qiongqi/skills'

let dataDir: string
beforeAll(async () => { dataDir = await mkdtemp(join(tmpdir(), 'mk-')) })
afterAll(async () => { await rm(dataDir, { recursive: true, force: true }) })

describe('parseMarketplaceManifest', () => {
  it('parses entries', () => {
    const m = parseMarketplaceManifest({
      entries: [
        { id: 'tdd', name: 'TDD', version: '1.0.0', category: 'development', source: 'git', repoUrl: 'https://e/r.git' }
      ]
    })
    expect(m.entries[0].id).toBe('tdd')
  })
  it('rejects missing entries array', () => {
    expect(() => parseMarketplaceManifest({})).toThrow()
  })
})

describe('MarketplaceClient local file source', () => {
  it('lists entries and marks installed', async () => {
    const source = await mkdtemp(join(tmpdir(), 'src-'))
    await writeFile(join(source, 'marketplace.json'), JSON.stringify({
      entries: [{ id: 'tdd', name: 'TDD', version: '1.0.0', category: 'development', source: 'git', repoUrl: 'https://e/r.git' }]
    }))
    const client = new MarketplaceClient({ dataDir, git: stubGit() })
    const list = await client.list({ kind: 'file', path: source })
    expect(list.entries[0].id).toBe('tdd')
    expect(list.entries[0].installed).toBe(false)

    // 模拟安装：直接在 dataDir 下放一个目录
    await mkdir(join(dataDir, 'tdd'), { recursive: true })
    await writeFile(join(dataDir, 'tdd', 'skill.json'), JSON.stringify({ specVersion: '1.0', id: 'tdd', name: 'TDD' }))
    const list2 = await client.list({ kind: 'file', path: source })
    expect(list2.entries[0].installed).toBe(true)

    await rm(source, { recursive: true, force: true })
  })

  it('uninstall removes the skill directory', async () => {
    await mkdir(join(dataDir, 'gone'), { recursive: true })
    await writeFile(join(dataDir, 'gone', 'skill.json'), '{}')
    const client = new MarketplaceClient({ dataDir, git: stubGit() })
    await client.uninstall('gone')
    await expect(readFile(join(dataDir, 'gone', 'skill.json'))).rejects.toThrow()
  })

  it('install uses injected git operations to clone into dataDir', async () => {
    const git = stubGit({
      clone: async (url, target) => {
        await mkdir(target, { recursive: true })
        await writeFile(join(target, 'skill.json'), JSON.stringify({ id: 'tdd', name: 'TDD', version: '1.0.0' }))
      }
    })
    const client = new MarketplaceClient({ dataDir, git })
    const source = await mkdtemp(join(tmpdir(), 'src2-'))
    await writeFile(join(source, 'marketplace.json'), JSON.stringify({
      entries: [{ id: 'tdd', name: 'TDD', version: '1.0.0', category: 'development', source: 'git', repoUrl: 'https://e/r.git' }]
    }))
    await client.install({ kind: 'file', path: source }, 'tdd')
    const installed = await readFile(join(dataDir, 'tdd', 'skill.json'), 'utf8')
    expect(JSON.parse(installed).id).toBe('tdd')
    await rm(source, { recursive: true, force: true })
  })
})

function stubGit(overrides: Partial<GitOperations> = {}): GitOperations {
  return {
    clone: vi.fn(async () => {}),
    pull: vi.fn(async () => {}),
    ...overrides
  }
}
