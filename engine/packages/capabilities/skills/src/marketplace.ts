import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

const execFileAsync = promisify(execFile)

const MarketplaceEntryRaw = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.string().default('0.0.0'),
  category: z.enum(['development', 'review', 'planning', 'workflow', 'integration']).default('workflow'),
  source: z.enum(['git', 'file']),
  repoUrl: z.string().min(1).optional(),
  homepage: z.string().min(1).optional()
}).strict()

const MarketplaceManifest = z.object({
  entries: z.array(MarketplaceEntryRaw)
}).strict()

export type MarketplaceSourceRef = { kind: 'git'; url: string; branch?: string } | { kind: 'file'; path: string }

export type ParsedMarketplaceEntry = z.infer<typeof MarketplaceEntryRaw> & {
  installed: boolean
  installedVersion?: string
  updateAvailable: boolean
}

export type ParsedMarketplace = {
  entries: ParsedMarketplaceEntry[]
}

/**
 * Git operations used by the marketplace client. The default implementation
 * shells out to the system `git`; tests inject a stub to avoid network/IO.
 */
export type GitOperations = {
  clone: (url: string, target: string, branch?: string) => Promise<void>
  pull: (target: string) => Promise<void>
}

export function parseMarketplaceManifest(raw: unknown): { entries: Array<z.infer<typeof MarketplaceEntryRaw>> } {
  const parsed = MarketplaceManifest.parse(raw)
  return { entries: parsed.entries }
}

export class MarketplaceClient {
  private readonly git: GitOperations

  constructor(private readonly options: { dataDir: string; git?: GitOperations }) {
    this.git = options.git ?? defaultGit()
  }

  async list(source: MarketplaceSourceRef | null): Promise<{
    source: MarketplaceSourceRef | null
    entries: ParsedMarketplaceEntry[]
    error?: string
  }> {
    if (!source) return { source: null, entries: [] }
    let manifestRaw: unknown
    try {
      if (source.kind === 'file') {
        manifestRaw = JSON.parse(await readFile(join(source.path, 'marketplace.json'), 'utf8'))
      } else {
        const cloneDir = join(this.options.dataDir, '.marketplace-cache')
        await rm(cloneDir, { recursive: true, force: true }).catch(() => {})
        await this.git.clone(source.url, cloneDir, source.branch)
        manifestRaw = JSON.parse(await readFile(join(cloneDir, 'marketplace.json'), 'utf8'))
      }
    } catch (error) {
      return { source, entries: [], error: error instanceof Error ? error.message : String(error) }
    }
    const parsed = parseMarketplaceManifest(manifestRaw)
    const installed = await this.installedIndex()
    const entries: ParsedMarketplaceEntry[] = parsed.entries.map((e) => {
      const inst = installed.get(e.id)
      return {
        ...e,
        installed: Boolean(inst),
        installedVersion: inst?.version,
        updateAvailable: Boolean(inst) && inst?.version !== e.version
      }
    })
    return { source, entries }
  }

  async install(source: MarketplaceSourceRef, entryId: string): Promise<void> {
    const list = await this.list(source)
    const entry = list.entries.find((e) => e.id === entryId)
    if (!entry?.repoUrl) throw new Error(`marketplace entry ${entryId} has no repoUrl`)
    const target = join(this.options.dataDir, entryId)
    await rm(target, { recursive: true, force: true }).catch(() => {})
    await this.git.clone(entry.repoUrl, target)
  }

  async uninstall(entryId: string): Promise<void> {
    const target = join(this.options.dataDir, entryId)
    await rm(target, { recursive: true, force: true })
  }

  async update(source: MarketplaceSourceRef, entryId: string): Promise<void> {
    const target = join(this.options.dataDir, entryId)
    const exists = await stat(target).then(() => true).catch(() => false)
    if (!exists) return this.install(source, entryId)
    await this.git.pull(target)
  }

  private async installedIndex(): Promise<Map<string, { version: string }>> {
    const out = new Map<string, { version: string }>()
    let entries: string[]
    try { entries = await readdir(this.options.dataDir) } catch { return out }
    for (const name of entries) {
      if (name.startsWith('.')) continue
      const skillJson = join(this.options.dataDir, name, 'skill.json')
      try {
        const raw = JSON.parse(await readFile(skillJson, 'utf8'))
        out.set(raw.id ?? name, { version: raw.version ?? '0.0.0' })
      } catch { /* skip non-skill dirs */ }
    }
    return out
  }
}

function defaultGit(): GitOperations {
  return {
    clone: async (url, target, branch) => {
      const args = ['clone', url, target]
      if (branch) args.splice(1, 0, '--branch', branch)
      await execFileAsync('git', args)
    },
    pull: async (target) => {
      await execFileAsync('git', ['-C', target, 'pull', '--ff-only'])
    }
  }
}
