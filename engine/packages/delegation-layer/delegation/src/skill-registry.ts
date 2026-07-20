import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

/**
 * # SkillRegistry — engine-level skill lifecycle management
 *
 * A generic registry that maps skill ids to the agents that own them.
 * All orchestrator agents (KStock, KMedical, KLegal, ...) share this
 * single engine-level component.
 *
 * ## Relationship with PeerRegistry
 *
 * - **SkillRegistry** answers "which agent has skill X?"
 * - **PeerRegistry** answers "how do I reach agent Y?"
 *
 * They are intentionally decoupled — you can use SkillRegistry without
 * PeerRegistry (e.g. for offline skill discovery) and vice versa.
 */

export interface SkillEntry {
  /** Skill id extracted from SKILL.md frontmatter `name` field. */
  skillId: string
  /** The agent card id that owns this skill. Set by `register()`. */
  agentCardId: string
  /** Capabilities declared in SKILL.md frontmatter. */
  capabilities: string[]
  /** Absolute path to the skill directory. */
  rootDir: string
}

/**
 * Frontmatter shape minimally required for skill discovery.
 * The actual SkillManifestV1 schema is richer, but scanFromDir only
 * needs `name` and `capabilities` to populate the registry.
 */
interface SkillFrontmatter {
  name?: string
  capabilities?: Array<{ id?: string }>
}

export class SkillRegistry {
  private readonly map = new Map<string, SkillEntry>()

  /**
   * Scan a directory tree for SKILL.md files and populate the registry.
   * Each immediate subdirectory is treated as a skill candidate.
   *
   * @param rootDir  Absolute path to the skills root (e.g. `<KStock>/skills/stock-agent/`)
   * @param agentCardId  The agent that owns these skills (will be set via `register` later if not known yet)
   * @returns  The number of skills discovered.
   */
  async scanFromDir(rootDir: string, agentCardId = 'unbound'): Promise<number> {
    if (!existsSync(rootDir)) return 0
    const entries = await readdir(rootDir, { withFileTypes: true })
    let count = 0
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillDir = join(rootDir, entry.name)
      const skillMdPath = join(skillDir, 'SKILL.md')
      if (!existsSync(skillMdPath)) continue
      try {
        const text = await readFile(skillMdPath, 'utf8')
        const fm = this.parseFrontmatter(text)
        if (!fm.name) continue
        this.map.set(fm.name, {
          skillId: fm.name,
          agentCardId,
          capabilities: (fm.capabilities ?? []).map(c => c.id ?? '').filter(Boolean),
          rootDir: skillDir
        })
        count++
      } catch {
        // Corrupt or unparseable SKILL.md — skip
      }
    }
    return count
  }

  /** Register a single skill-to-agent binding. */
  register(skillId: string, agentCardId: string): void {
    const existing = this.map.get(skillId)
    if (existing) {
      existing.agentCardId = agentCardId
    } else {
      this.map.set(skillId, { skillId, agentCardId, capabilities: [], rootDir: '' })
    }
  }

  /** Unbind all skills owned by an agent. */
  unbind(agentCardId: string): void {
    for (const [id, entry] of this.map) {
      if (entry.agentCardId === agentCardId) {
        entry.agentCardId = 'unbound'
      }
    }
  }

  /** Find which agent owns a specific skill. Returns undefined if not registered. */
  findBySkill(skillId: string): SkillEntry | undefined {
    return this.map.get(skillId)
  }

  /** List all skills owned by an agent. */
  listByAgent(agentCardId: string): SkillEntry[] {
    return [...this.map.values()].filter(e => e.agentCardId === agentCardId)
  }

  /** Return a copy of the complete skill→agent mapping. */
  allSkills(): ReadonlyMap<string, SkillEntry> {
    return new Map(this.map)
  }

  /** Number of registered skills. */
  get size(): number { return this.map.size }

  // ------------ internal helpers ------------

  private parseFrontmatter(text: string): SkillFrontmatter {
    const match = text.match(/^---\n([\s\S]*?)\n---/)
    if (!match) return {}
    const yaml = match[1]
    const result: SkillFrontmatter = {}
    // Minimal YAML parser — only handles the fields we need.
    const nameMatch = yaml.match(/^name:\s*(.+)$/m)
    if (nameMatch) result.name = nameMatch[1].trim()
    // Extract capabilities block
    const capsSection = yaml.match(/^capabilities:\s*\n([\s\S]*?)(?:^\w|$)/m)
    if (capsSection) {
      const ids: Array<{ id?: string }> = []
      const idMatches = capsSection[1].matchAll(/^\s*-\s*id:\s*(.+)$/gm)
      for (const m of idMatches) {
        ids.push({ id: m[1].trim() })
      }
      result.capabilities = ids
    }
    return result
  }
}
