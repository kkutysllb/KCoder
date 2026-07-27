import { z } from 'zod'

const slugRegex = /^[a-z0-9][a-z0-9-]*$/

export const SkillCommandV1 = z.object({
  id: z.string().min(1),
  alias: z.array(z.string().min(1)).default([]),
  description: z.string().min(1),
  injectPrompt: z.string().min(1)
}).strict()

export const SkillToolDeclarationV1 = z.object({
  name: z.string().min(1),
  template: z.enum(['bash', 'read', 'edit', 'write', 'grep', 'find', 'ls']),
  args: z.record(z.string(), z.unknown()).default({}),
  description: z.string().min(1),
  policy: z.enum(['auto', 'on-request', 'suggest', 'never', 'untrusted']).default('on-request')
}).strict()

export const SkillContributionV1 = z.object({
  chatMenu: z.array(z.object({ commandId: z.string().min(1), title: z.string().min(1), icon: z.string().min(1).optional() }).strict()).default([]),
  quickTask: z.array(z.object({ commandId: z.string().min(1), title: z.string().min(1), icon: z.string().min(1).optional() }).strict()).default([])
})

export const SkillPermissionsV1 = z.object({
  workspace: z.enum(['read', 'write']).default('write'),
  network: z.boolean().default(false),
  exec: z.enum(['none', 'workspace', 'unrestricted']).default('none'),
  requiresApproval: z.enum(['on-request', 'untrusted', 'never', 'auto', 'suggest']).default('on-request')
}).strict()

export const SkillManifestV1 = z.object({
  specVersion: z.string().regex(/^1\./, 'specVersion must be 1.x'),
  id: z.string().regex(slugRegex, 'id must be a lowercase slug'),
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.string().default('0.0.0'),
  author: z.object({ name: z.string().min(1), url: z.string().min(1).optional() }).optional(),
  license: z.string().optional(),
  icon: z.string().min(1).optional(),
  entry: z.string().min(1).default('SKILL.md'),
  category: z.enum(['development', 'review', 'planning', 'workflow', 'integration']).default('workflow'),
  priority: z.number().int().default(0),
  activation: z.object({
    commands: z.array(z.string().min(1)).default([]),
    promptPatterns: z.array(z.string().min(1)).default([]),
    fileTypes: z.array(z.string().min(1)).default([]),
    autoActivate: z.boolean().default(false)
  }).default({ commands: [], promptPatterns: [], fileTypes: [], autoActivate: false }),
  commands: z.array(SkillCommandV1).default([]),
  tools: z.object({
    allowed: z.array(z.string().min(1)).default([]),
    declarations: z.array(SkillToolDeclarationV1).default([]),
    mcpServers: z.record(z.string().min(1), z.unknown()).default({})
  }).default({ allowed: [], declarations: [], mcpServers: {} }),
  contributes: SkillContributionV1.default(() => SkillContributionV1.parse({})),
  permissions: SkillPermissionsV1.default(() => SkillPermissionsV1.parse({})),
  assets: z.array(z.string().min(1)).default([])
}).strict()
export type SkillManifestV1 = z.infer<typeof SkillManifestV1>

export type SkillCommandV1 = z.infer<typeof SkillCommandV1>
export type SkillToolDeclarationV1 = z.infer<typeof SkillToolDeclarationV1>

export type ManifestParseError = { ok: false; error: string }
export type ManifestParseOk = { ok: true; manifest: SkillManifestV1 }
export type ManifestParseResult = ManifestParseOk | ManifestParseError

export function validateSkillManifest(raw: unknown): ManifestParseResult {
  const result = SkillManifestV1.safeParse(raw)
  if (result.success) return { ok: true, manifest: result.data }
  return { ok: false, error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }
}

type LegacySkillJson = {
  id?: string
  name: string
  description?: string
  version?: string
  entry?: string
  triggers?: { commands?: string[]; promptPatterns?: string[]; fileTypes?: string[] }
  allowedTools?: string[]
  assets?: string[]
  priority?: number
}

/**
 * Upgrade a legacy skill.json (no specVersion) or SKILL.md frontmatter shape to
 * the v1 manifest. Existing fields map onto v1; derived slash commands are
 * generated from `triggers.commands` when no explicit `commands[]` is present.
 * The built object is re-parsed through SkillManifestV1 so v1 defaults apply
 * (zod v4 default factories fire during parse).
 */
export function migrateLegacyManifest(raw: Record<string, unknown>): SkillManifestV1 {
  const legacy = raw as unknown as LegacySkillJson
  const commands = legacy.triggers?.commands ?? []
  const hasExplicitCommands = Array.isArray(raw['commands'])
  const derivedCommands = commands.length > 0 && !hasExplicitCommands
    ? commands.map((cmd) => {
        const id = cmd.replace(/^\/+/, '')
        return {
          id,
          alias: [] as string[],
          description: legacy.description ?? `Run ${id}`,
          injectPrompt: `Use the ${legacy.id ?? id} skill.`
        }
      })
    : []
  const built = {
    specVersion: '1.0',
    id: legacy.id ?? slugifyName(legacy.name),
    name: legacy.name,
    description: legacy.description,
    version: legacy.version ?? '0.0.0',
    entry: legacy.entry ?? 'SKILL.md',
    priority: legacy.priority ?? 0,
    activation: {
      commands,
      promptPatterns: legacy.triggers?.promptPatterns ?? [],
      fileTypes: legacy.triggers?.fileTypes ?? [],
      autoActivate: false
    },
    commands: derivedCommands,
    tools: { allowed: legacy.allowedTools ?? [], declarations: [], mcpServers: {} },
    assets: legacy.assets ?? []
  }
  const result = SkillManifestV1.safeParse(built)
  if (!result.success) {
    throw new Error(`legacy manifest migration failed: ${result.error.issues.map((i) => i.message).join('; ')}`)
  }
  return result.data
}

function slugifyName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'skill'
}
