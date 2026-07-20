import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { SkillsCapabilityConfig } from '@qiongqi/contracts'
import type { SkillsCapabilityConfig as SkillsCapabilityConfigType } from '@qiongqi/contracts'
import { migrateLegacyManifest, SkillManifestV1, validateSkillManifest } from './manifest.js'
import { resolveEffectiveSkillIds, resolveWorkModeId } from './work-modes.js'

export type LoadedSkillPlugin = {
  id: string
  manifest: SkillManifestV1
  root: string
  entryPath: string
  entry: string
  assets: string[]
  legacy: boolean
  source: 'official' | 'community' | 'unknown'
}

export type SkillActivation = { skillId: string; reason: string; score: number }

export type SkillTurnResolution = {
  activeSkillIds: string[]
  activations: SkillActivation[]
  instructions: string[]
  allowedToolNames?: string[]
  injectedBytes: number
}

export type WorkModeInfo = {
  id: string
  name: string
  description?: string
}

export type SkillPluginDiagnostics = {
  enabled: boolean
  roots: string[]
  skills: Array<{
    id: string; name: string; description?: string; version: string; root: string; legacy: boolean
    commands: LoadedSkillPlugin['manifest']['commands']
    contributions: LoadedSkillPlugin['manifest']['contributes']
    permissions: LoadedSkillPlugin['manifest']['permissions']
    source: LoadedSkillPlugin['source']
    category: LoadedSkillPlugin['manifest']['category']
    validationError?: string
    // 兼容旧 diagnostics 的 triggers/allowedTools 字段
    triggers: { commands: string[]; promptPatterns: string[]; fileTypes: string[] }
    allowedTools: string[]
  }>
  validationErrors: Array<{ root: string; message: string }>
  lastActivations: SkillActivation[]
}

export type SkillPluginHostContext = {
  threadId?: string
  ownerUserId?: string
  workspace?: string
  workModeId?: string
  effectiveSkillIds?: readonly string[]
}

export type ActivatableSkillResolution =
  | { ok: true; skill: LoadedSkillPlugin }
  | { ok: false; code: 'unknown_skill' | 'skill_disabled' | 'skill_out_of_mode' }

export type SkillPluginHostOptions = {
  activeLimit?: number
  instructionBudgetBytes?: number
  enabledSkills?: Record<string, boolean>
  enabledSkillsProvider?: (context?: SkillPluginHostContext) => Record<string, boolean> | undefined
  builtinRoot?: string
  builtinRoots?: string[]
}

const DEFAULT_ACTIVE_LIMIT = 6
const DEFAULT_INSTRUCTION_BUDGET_BYTES = 48_000
const DEFAULT_CATALOG_BUDGET_BYTES = 12_000

export class SkillPluginHost {
  private plugins: LoadedSkillPlugin[]
  private validationErrors: Array<{ root: string; message: string }>
  private lastActivations: SkillActivation[] = []

  private constructor(
    private config: SkillsCapabilityConfigType,
    private readonly options: Required<Omit<SkillPluginHostOptions, 'builtinRoot' | 'builtinRoots'>> & { builtinRoot?: string; builtinRoots?: string[] },
    loaded: { plugins: LoadedSkillPlugin[]; validationErrors: Array<{ root: string; message: string }> }
  ) {
    this.plugins = loaded.plugins
    this.validationErrors = loaded.validationErrors
  }

  static async create(
    config: SkillsCapabilityConfigType | undefined,
    options: SkillPluginHostOptions = {}
  ): Promise<SkillPluginHost> {
    const normalized = config ?? SkillsCapabilityConfig.parse({ enabled: false })
    const resolved = {
      activeLimit: options.activeLimit ?? DEFAULT_ACTIVE_LIMIT,
      instructionBudgetBytes: options.instructionBudgetBytes ?? DEFAULT_INSTRUCTION_BUDGET_BYTES,
      enabledSkills: options.enabledSkills ?? {},
      enabledSkillsProvider: options.enabledSkillsProvider
    }
    const loaded = normalized.enabled
      ? await discoverPlugins(normalized, options.builtinRoots ?? (options.builtinRoot ? [options.builtinRoot] : []))
      : { plugins: [], validationErrors: [] }
    return new SkillPluginHost(normalized, resolved as never, loaded)
  }

  list(): readonly LoadedSkillPlugin[] { return this.plugins }

  async reload(config: SkillsCapabilityConfigType | undefined): Promise<void> {
    const normalized = config ?? SkillsCapabilityConfig.parse({ enabled: false })
    const loaded = normalized.enabled
      ? await discoverPlugins(normalized, this.options.builtinRoots ?? (this.options.builtinRoot ? [this.options.builtinRoot] : []))
      : { plugins: [], validationErrors: [] }
    this.config = normalized
    this.plugins = loaded.plugins
    this.validationErrors = loaded.validationErrors
    this.lastActivations = []
  }

  isEnabled(plugin: LoadedSkillPlugin, context?: SkillPluginHostContext): boolean {
    if (context?.effectiveSkillIds && !context.effectiveSkillIds.includes(plugin.id)) return false
    const current = this.options.enabledSkillsProvider?.(context) ?? this.options.enabledSkills
    const v = current[plugin.id]
    return v === undefined ? true : v
  }

  effectiveSkillIds(workModeId?: string): string[] {
    return resolveEffectiveSkillIds(this.config, workModeId)
  }

  workModeInfo(workModeId?: string): WorkModeInfo | undefined {
    const id = resolveWorkModeId(this.config, workModeId)
    const mode = this.config.workModes.modes[id]
    if (!mode) return undefined
    return {
      id: mode.id,
      name: mode.name,
      ...(mode.description ? { description: mode.description } : {})
    }
  }

  resolveActivatableSkill(
    skillId: string,
    context: SkillPluginHostContext = {}
  ): ActivatableSkillResolution {
    const skill = this.plugins.find((plugin) => plugin.id === skillId)
    if (!skill) return { ok: false, code: 'unknown_skill' }
    const effectiveSkillIds = context.effectiveSkillIds
      ?? (context.workModeId ? this.effectiveSkillIds(context.workModeId) : undefined)
    if (effectiveSkillIds && !effectiveSkillIds.includes(skill.id)) {
      return { ok: false, code: 'skill_out_of_mode' }
    }
    if (!this.isEnabled(skill, { ...context, effectiveSkillIds })) {
      return { ok: false, code: 'skill_disabled' }
    }
    return { ok: true, skill }
  }

  diagnostics(): SkillPluginDiagnostics {
    return {
      enabled: this.config.enabled,
      roots: [...this.config.roots],
      skills: this.plugins.map((p) => ({
        id: p.id,
        name: p.manifest.name,
        description: p.manifest.description,
        version: p.manifest.version,
        root: p.root,
        legacy: p.legacy,
        source: p.source,
        category: p.manifest.category,
        commands: p.manifest.commands,
        contributions: p.manifest.contributes,
        permissions: p.manifest.permissions,
        triggers: {
          commands: p.manifest.activation.commands,
          promptPatterns: p.manifest.activation.promptPatterns,
          fileTypes: p.manifest.activation.fileTypes
        },
        allowedTools: p.manifest.tools.allowed
      })),
      validationErrors: [...this.validationErrors],
      lastActivations: [...this.lastActivations]
    }
  }

  count(): number { return this.plugins.length }

  resolveTurn(input: {
    prompt: string
    workspace: string
    filePaths?: readonly string[]
    threadId?: string
    ownerUserId?: string
    workModeId?: string
    effectiveSkillIds?: readonly string[]
    forcedSkillIds?: readonly string[]
  }): SkillTurnResolution {
    if (!this.config.enabled) return emptyResolution()
    const effectiveSkillIds = input.effectiveSkillIds ?? (input.workModeId ? this.effectiveSkillIds(input.workModeId) : undefined)
    const context: SkillPluginHostContext = {
      threadId: input.threadId,
      ownerUserId: input.ownerUserId,
      workspace: input.workspace,
      workModeId: input.workModeId,
      effectiveSkillIds
    }
    const available = this.plugins.filter((skill) => this.isEnabled(skill, context))
    const matches = this.matchSkills({ ...input, effectiveSkillIds })
    const forced = uniqueStrings(input.forcedSkillIds ?? [])
      .sort()
      .flatMap((skillId) => {
        const resolved = this.resolveActivatableSkill(skillId, context)
        return resolved.ok
          ? [{ skill: resolved.skill, skillId, reason: 'explicit-activation', score: 2_000 }]
          : []
      })
    const forcedIds = new Set(forced.map((match) => match.skillId))
    const active = [
      ...forced,
      ...matches.filter((match) => !forcedIds.has(match.skillId))
    ].slice(0, this.options.activeLimit)
    const catalog = buildAvailableSkillsInstruction(
      available,
      input.workModeId,
      this.config.roots,
      Math.min(DEFAULT_CATALOG_BUDGET_BYTES, this.options.instructionBudgetBytes),
      effectiveSkillIds ?? []
    )
    const remainingBudget = Math.max(0, this.options.instructionBudgetBytes - (catalog?.bytes ?? 0))
    const injection = buildInjection(active, remainingBudget)
    this.lastActivations = active.map(({ skill, reason, score }) => ({ skillId: skill.id, reason, score }))
    // NOTE: We intentionally do NOT return `allowedToolNames` here. A skill's
    // `tools.allowed` declares which built-in tools the skill *itself* needs
    // (additive), not a restrictive allow-list for the whole turn. Returning it
    // as a session-wide allow-list breaks coexisting flows: e.g. the hardcoded
    // `/review` flow needs `bash` to run `git diff`, but the review skill's
    // `tools.allowed: [read, grep, find]` would wrongly exclude `bash`.
    // Per-skill permission enforcement (workspace:read / exec:none) is better
    // expressed via approval policy tightening, not tool-catalog restriction.
    return {
      activeSkillIds: injection.activeSkillIds,
      activations: this.lastActivations,
      instructions: [
        ...(catalog ? [catalog.text] : []),
        ...injection.instructions
      ],
      injectedBytes: (catalog?.bytes ?? 0) + injection.injectedBytes
    }
  }

  private matchSkills(input: {
    prompt: string
    workspace?: string
    filePaths?: readonly string[]
    threadId?: string
    ownerUserId?: string
    workModeId?: string
    effectiveSkillIds?: readonly string[]
  }): Array<SkillActivation & { skill: LoadedSkillPlugin }> {
    const prompt = input.prompt
    const lower = prompt.toLowerCase()
    const fileTypes = new Set((input.filePaths ?? []).map((p) => p.toLowerCase()))
    const matches: Array<SkillActivation & { skill: LoadedSkillPlugin }> = []
    for (const skill of this.plugins) {
      if (!this.isEnabled(skill, {
        threadId: input.threadId,
        ownerUserId: input.ownerUserId,
        workspace: input.workspace,
        workModeId: input.workModeId,
        effectiveSkillIds: input.effectiveSkillIds
      })) continue
      // Gate: a skill is a candidate if autoActivate is set, the prompt
      // explicitly mentions it, the prompt starts with one of its commands,
      // or the prompt contains a description keyword match (for legacy
      // SKILL.md packages that have no explicit triggers).
      const descKeyword = this.descriptionKeywordMatch(skill, prompt)
      if (
        !skill.manifest.activation.autoActivate &&
        !this.isExplicitlyMentioned(skill, prompt) &&
        !this.startsWithCommand(skill, lower) &&
        !descKeyword
      ) continue
      const explicit = this.explicitMention(skill, prompt)
      if (explicit) { matches.push({ skill, skillId: skill.id, reason: explicit, score: 1_000 + skill.manifest.priority }); continue }
      const command = skill.manifest.activation.commands.find((c) => lower.startsWith(c.toLowerCase()))
      if (command) { matches.push({ skill, skillId: skill.id, reason: `command:${command}`, score: 900 + skill.manifest.priority }); continue }
      const pattern = skill.manifest.activation.promptPatterns.find((p) => safePattern(p).test(prompt))
      if (pattern) { matches.push({ skill, skillId: skill.id, reason: `pattern:${pattern}`, score: 500 + skill.manifest.priority }); continue }
      const ft = skill.manifest.activation.fileTypes.find((t) => fileTypes.has(t.toLowerCase()))
      if (ft) { matches.push({ skill, skillId: skill.id, reason: `fileType:${ft}`, score: 300 + skill.manifest.priority }); continue }
      if (descKeyword) { matches.push({ skill, skillId: skill.id, reason: `keyword:${descKeyword}`, score: 200 + skill.manifest.priority }) }
    }
    return matches.sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id))
  }

  /**
   * Check whether the user prompt contains a meaningful keyword extracted from
   * the skill's description. This is a fallback activation path for legacy
   * SKILL.md packages that have no explicit triggers/commands/promptPatterns.
   *
   * Strategy:
   * - CJK: extract 3+ char terms from the description, then check if any 3-char
   *   substring of those terms appears in the prompt. This handles partial
   *   matches (e.g. desc "市场联动分析引擎" matches prompt "市场联动分析").
   * - English: extract 4+ char words (excluding stop words) and check inclusion.
   */
  private descriptionKeywordMatch(skill: LoadedSkillPlugin, prompt: string): string | undefined {
    const desc = skill.manifest.description
    if (!desc || desc.length < 4) return undefined
    // CJK matching: 3-char substring overlap.
    const cjkTerms = desc.match(/[\u4e00-\u9fff]{3,}/g) ?? []
    for (const term of cjkTerms) {
      for (let i = 0; i <= term.length - 3; i++) {
        const sub = term.slice(i, i + 3)
        if (prompt.includes(sub)) return sub
      }
    }
    // English matching: 4+ char words.
    const lowerPrompt = prompt.toLowerCase()
    const STOP_WORDS = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'use', 'via', 'with', 'this', 'that', 'from', 'have', 'your', 'tool', 'data', 'based', 'engine', 'skill'])
    const enTerms = (desc.toLowerCase().match(/[a-z]{4,}/g) ?? [])
      .filter((w) => !STOP_WORDS.has(w))
    for (const term of enTerms) {
      if (lowerPrompt.includes(term)) return term
    }
    return undefined
  }

  private isExplicitlyMentioned(skill: LoadedSkillPlugin, prompt: string): boolean {
    return Boolean(this.explicitMention(skill, prompt))
  }
  private startsWithCommand(skill: LoadedSkillPlugin, lower: string): boolean {
    return skill.manifest.activation.commands.some((c) => lower.startsWith(c.toLowerCase()))
  }
  private explicitMention(skill: LoadedSkillPlugin, prompt: string): string | undefined {
    const lower = prompt.toLowerCase()
    const id = skill.id.toLowerCase()
    const name = skill.manifest.name.toLowerCase()
    if (lower.includes(`${id}`) || lower.includes(`@${id}`) || lower.includes(`/skill:${id}`)) return 'explicit:id'
    if (name && (lower.includes(`${name}`) || lower.includes(`@${name}`))) return 'explicit:name'
    return undefined
  }
}

async function discoverPlugins(
  config: SkillsCapabilityConfig,
  builtinRoots: readonly string[] = []
): Promise<{ plugins: LoadedSkillPlugin[]; validationErrors: Array<{ root: string; message: string }> }> {
  const plugins: LoadedSkillPlugin[] = []
  const validationErrors: Array<{ root: string; message: string }> = []
  const roots = [...builtinRoots, ...config.roots]
  for (const rawRoot of roots) {
    const root = resolve(rawRoot)
    const candidates = await packageCandidates(root).catch((error) => {
      validationErrors.push({ root, message: errorMessage(error) })
      return []
    })
    for (const candidate of candidates) {
      const loaded = await loadPlugin(candidate, config.legacySkillMd, isOfficialRoot(root, builtinRoots)).catch((error) => {
        validationErrors.push({ root: candidate, message: errorMessage(error) })
        return null
      })
      if (loaded) plugins.push(loaded)
    }
  }
  const unique = new Map<string, LoadedSkillPlugin>()
  for (const p of plugins) {
    if (!unique.has(p.id)) unique.set(p.id, p)
    else validationErrors.push({ root: p.root, message: `duplicate Skill id: ${p.id}` })
  }
  return { plugins: [...unique.values()].sort((a, b) => a.id.localeCompare(b.id)), validationErrors }
}

function isOfficialRoot(root: string, builtinRoots: readonly string[]): boolean {
  return builtinRoots.some((builtinRoot) => resolve(root) === resolve(builtinRoot))
}

async function packageCandidates(root: string): Promise<string[]> {
  const candidates = new Set<string>()
  if (await exists(join(root, 'skill.json')) || await exists(join(root, 'SKILL.md'))) candidates.add(root)
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const dir = join(root, entry.name)
      if (await exists(join(dir, 'skill.json')) || await exists(join(dir, 'SKILL.md'))) candidates.add(dir)
    }
  }
  return [...candidates]
}

async function loadPlugin(root: string, allowLegacy: boolean, official: boolean): Promise<LoadedSkillPlugin | null> {
  const manifestPath = join(root, 'skill.json')
  let manifest: SkillManifestV1
  let legacy = false
  if (await exists(manifestPath)) {
    const raw = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (raw && typeof raw === 'object' && 'specVersion' in raw) {
      const result = validateSkillManifest(raw)
      if (!result.ok) throw new Error(result.error)
      manifest = result.manifest
    } else {
      manifest = migrateLegacyManifest(raw)
      legacy = true
    }
  } else if (allowLegacy && await exists(join(root, 'SKILL.md'))) {
    const entry = await readFile(join(root, 'SKILL.md'), 'utf8')
    const frontmatter = readFrontmatter(entry)
    const folder = basename(root)
    manifest = migrateLegacyManifest({
      id: frontmatter.id || folder,
      name: frontmatter.name || folder,
      description: frontmatter.description,
      entry: 'SKILL.md'
    })
    legacy = true
  } else {
    return null
  }
  const entryPath = resolve(root, manifest.entry)
  const entry = await readFile(entryPath, 'utf8')
  return {
    id: manifest.id,
    manifest,
    root,
    entryPath,
    entry,
    assets: manifest.assets.map((a) => resolve(root, a)),
    legacy,
    source: official ? 'official' : 'unknown'
  }
}

/**
 * Parse YAML frontmatter from a SKILL.md file. Handles simple `key: value`
 * pairs as well as YAML block scalars (`|` literal, `>` folded) — which are
 * common in KSkills packages where multi-line descriptions use `description: |`.
 *
 * This is intentionally a minimal parser, not a full YAML implementation.
 */
function readFrontmatter(entry: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---/.exec(entry)
  const out: Record<string, string> = {}
  if (!match) return out
  const lines = match[1].split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    const idx = line.indexOf(':')
    if (idx <= 0 || line.startsWith(' ') || line.startsWith('\t')) {
      // Skip indented lines (they're block-scalar content, handled below)
      i++
      continue
    }
    const key = line.slice(0, idx).trim()
    let value = line.slice(idx + 1).trim()
    // Handle YAML block scalars: `key: |` or `key: >` — content is on
    // subsequent indented lines.
    if (value === '|' || value === '>') {
      const blockLines: string[] = []
      i++
      while (i < lines.length) {
        const blockLine = lines[i]!
        // Block content must be indented (starts with space or tab)
        if (blockLine.startsWith(' ') || blockLine.startsWith('\t')) {
          // Strip one level of indentation
          blockLines.push(blockLine.replace(/^[ \t]{1,2}/, ''))
          i++
        } else {
          break
        }
      }
      value = value === '>'
        ? blockLines.join(' ').replace(/\s+/g, ' ').trim()
        : blockLines.join('\n').trim()
      out[key] = value
      continue
    }
    out[key] = value
    i++
  }
  return out
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true } catch { return false }
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function buildInjection(
  active: Array<SkillActivation & { skill: LoadedSkillPlugin }>,
  budgetBytes: number
): { activeSkillIds: string[]; instructions: string[]; allowedToolNames?: string[]; injectedBytes: number } {
  const instructions: string[] = []
  const activeSkillIds: string[] = []
  const allowed = new Set<string>()
  let injectedBytes = 0
  for (const match of active) {
    const skill = match.skill
    const text = [
      `Active Skill: ${skill.manifest.name} (${skill.id})`,
      `Activation: ${match.reason}`,
      `Skill package root: ${skill.root}`,
      `Skill entry file: ${skill.entryPath}`,
      'Resolve relative skill resource paths from this skill package root. Do not guess or search for this skill under the user workspace, project directory, or other home-directory paths.',
      skill.manifest.description ? `Description: ${skill.manifest.description}` : '',
      skill.manifest.tools.allowed.length ? `Allowed tools: ${skill.manifest.tools.allowed.join(', ')}` : '',
      skill.assets.length ? `Assets:\n${skill.assets.map((a) => `- ${a}`).join('\n')}` : '',
      skill.entry
    ].filter(Boolean).join('\n\n')
    const bytes = Buffer.byteLength(text, 'utf8')
    if (injectedBytes + bytes > budgetBytes) continue
    activeSkillIds.push(skill.id)
    instructions.push(text)
    injectedBytes += bytes
    for (const tool of skill.manifest.tools.allowed) allowed.add(tool)
  }
  return {
    activeSkillIds, instructions,
    ...(allowed.size > 0 ? { allowedToolNames: [...allowed].sort() } : {}),
    injectedBytes
  }
}

function buildAvailableSkillsInstruction(
  available: readonly LoadedSkillPlugin[],
  workModeId: string | undefined,
  roots: readonly string[],
  budgetBytes: number,
  effectiveSkillIds: readonly string[] = []
): { text: string; bytes: number } | undefined {
  if (budgetBytes <= 0) return undefined
  const loadedIds = new Set(available.map((skill) => skill.id))
  const unloadedConfiguredIds = uniqueStrings(effectiveSkillIds)
    .filter((id) => !loadedIds.has(id))
  const lines = [
    `Available Skills${workModeId ? ` for work mode "${workModeId}"` : ''}:`,
    'These are installed skill instruction packages available in the current work mode. Skills are not direct tool calls; use this list to understand what specialized workflows you can apply.',
    'When the user asks about installed, available, or usable skills, answer from this list. Do not list built-in tools (bash, read, etc.) as skills.',
    ''
  ]
  let bytes = Buffer.byteLength(lines.join('\n'), 'utf8')
  let included = 0
  for (const skill of available) {
    const description = skill.manifest.description ? `: ${skill.manifest.description}` : ''
    const commands = skill.manifest.activation.commands.length
      ? ` Commands: ${skill.manifest.activation.commands.join(', ')}.`
      : ''
    const line = `- ${skill.manifest.name} (${skill.id})${description}${commands}`
    const lineBytes = Buffer.byteLength(`${line}\n`, 'utf8')
    if (bytes + lineBytes > budgetBytes) break
    lines.push(line)
    bytes += lineBytes
    included += 1
  }
  if (included === 0 && unloadedConfiguredIds.length === 0) return undefined
  if (unloadedConfiguredIds.length > 0) {
    const configuredLine = `Configured skill IDs without loaded instruction packages: ${unloadedConfiguredIds.join(', ')}.`
    const guidanceLine = 'If asked what skills are available, mention these IDs separately as configured for the work mode but not currently loaded as executable skill instruction packages.'
    const extraBytes = Buffer.byteLength(`${configuredLine}\n${guidanceLine}\n`, 'utf8')
    if (bytes + extraBytes <= budgetBytes) {
      lines.push(configuredLine, guidanceLine)
      bytes += extraBytes
    }
  }
  if (included < available.length) {
    const omitted = `- ${available.length - included} additional skills omitted by context budget.`
    lines.push(omitted)
    bytes += Buffer.byteLength(`${omitted}\n`, 'utf8')
  }
  return { text: lines.join('\n'), bytes }
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()))]
}

function emptyResolution(): SkillTurnResolution {
  return { activeSkillIds: [], activations: [], instructions: [], injectedBytes: 0 }
}

function safePattern(pattern: string): RegExp {
  try { return new RegExp(pattern, 'i') } catch { return /(?:)/i }
}
