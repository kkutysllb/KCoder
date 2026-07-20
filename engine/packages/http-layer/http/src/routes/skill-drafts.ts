import { createHash, randomUUID } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import {
  DEFAULT_QIONGQI_CAPABILITIES_CONFIG,
  QiongqiConfigSchema,
  type QiongqiConfig
} from '@qiongqi/contracts'
import { migrateLegacyManifest, resolveWorkModeDefaultSkillIds, SkillManifestV1 } from '@qiongqi/skills'
import type { AuthActor } from '../auth-service.js'
import { readJsonBody } from '../read-json-body.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { ERRORS } from './runtime-error.js'
import type { ServerRuntime } from './server-runtime.js'

type DraftMode = 'scripts' | 'package'
type SkillDraftFormValue = string | File

type DraftFile = {
  path: string
  kind: string
  size: number
  sha256?: string
}

type SkillDraftSnapshot = {
  version: 1
  draftId: string
  mode: DraftMode
  workModeId?: string
  createdAt: string
  updatedAt: string
  files: DraftFile[]
  evidence?: SkillDraftEvidence
  draft?: GeneratedSkillDraft
}

type EntryCandidate = {
  path: string
  confidence: number
  reason: string
}

type CommandArgument = {
  name: string
  required: boolean
  source: string
}

type CommandEvidence = {
  path: string
  suggestedInvocation: string
  arguments: CommandArgument[]
}

type DependencyEvidence = {
  name: string
  source: string
}

type RiskEvidence = {
  severity: 'low' | 'medium' | 'high'
  kind: string
  evidence: string
}

type SnippetEvidence = {
  path: string
  label: string
  text: string
}

type SkillDraftEvidence = {
  files: DraftFile[]
  entryCandidates: EntryCandidate[]
  commands: CommandEvidence[]
  dependencies: DependencyEvidence[]
  risks: RiskEvidence[]
  snippets: SnippetEvidence[]
}

type GeneratedSkillDraft = {
  metadata: {
    id: string
    name: string
    description: string
  }
  skillMarkdown: string
  manifestPatch: Record<string, unknown>
  questions: Array<{ field: string; question: string }>
  warnings: Array<{ severity: string; message: string }>
}

const SCRIPT_EXTENSIONS = new Set(['.py', '.sh', '.js', '.ts', '.mjs', '.cjs'])
const MAX_UPLOAD_BYTES = 512 * 1024
const MAX_EXTRACTED_BYTES = 2 * 1024 * 1024
const MAX_DRAFT_FILES = 200

export async function createSkillDraft(
  runtime: ServerRuntime,
  _actor: AuthActor | undefined,
  request: Request
): Promise<JsonResponse | Response> {
  const form = await request.formData().catch(() => null)
  if (!form) return ERRORS.validation('skill draft request must be multipart/form-data')
  const values = form.getAll('files')
  const files = values.filter((value): value is File => value instanceof File)
  if (files.length === 0) return ERRORS.validation('at least one file is required')

  const draftId = `draft_${randomUUID().replace(/-/g, '').slice(0, 16)}`
  const root = draftRoot(runtime, draftId)
  const filesRoot = join(root, 'files')
  await mkdir(filesRoot, { recursive: true })

  let mode = draftMode(form.get('mode'))
  const uploaded: DraftFile[] = []
  for (const file of files) {
    if (file.size > MAX_UPLOAD_BYTES) {
      return ERRORS.validation(`file exceeds ${MAX_UPLOAD_BYTES} byte limit: ${file.name}`)
    }
    const data = Buffer.from(await file.arrayBuffer())
    if (isZipUpload(file.name || '', data)) {
      const extracted = extractZipEntries(data)
      if (!extracted.ok) return ERRORS.validation(extracted.detail)
      if (extracted.files.some((entry) => isSkillPackageMarker(entry.path))) mode = 'package'
      for (const entry of extracted.files) {
        const saved = await writeDraftFile(filesRoot, entry.path, entry.data)
        if (!saved.ok) return ERRORS.validation(saved.detail)
        uploaded.push(saved.file)
      }
      continue
    }
    const saved = await writeDraftFile(filesRoot, file.name || 'upload', data)
    if (!saved.ok) return ERRORS.validation(saved.detail)
    uploaded.push(saved.file)
  }

  const normalizedFiles = await normalizeDraftPackageRoot(filesRoot, uploaded, mode)
  if (!normalizedFiles.ok) return ERRORS.validation(normalizedFiles.detail)
  if (normalizedFiles.files.some((file) => isSkillPackageMarker(file.path))) {
    mode = 'package'
  }

  const now = runtime.nowIso()
  const draft: SkillDraftSnapshot = {
    version: 1,
    draftId,
    mode,
    workModeId: normalizeWorkModeId(stringFormValue(form.get('workModeId')) ?? stringFormValue(form.get('work_mode_id'))),
    createdAt: now,
    updatedAt: now,
    files: normalizedFiles.files
  }
  await saveDraft(runtime, draft)

  return jsonResponse({
    success: true,
    draftId,
    mode: draft.mode,
    files: draft.files.map(({ sha256: _sha256, ...file }) => file)
  }, 201)
}

async function writeDraftFile(
  filesRoot: string,
  name: string,
  data: Buffer
): Promise<{ ok: true; file: DraftFile } | { ok: false; detail: string }> {
  const safePath = safeUploadPath(name || 'upload')
  if (!safePath.ok) return safePath
  const absolutePath = resolve(filesRoot, safePath.path)
  const rel = relative(filesRoot, absolutePath)
  if (rel.startsWith('..') || rel.includes(`..${sep}`)) {
    return { ok: false, detail: 'uploaded file path escapes draft workspace' }
  }
  await mkdir(dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, data)
  return {
    ok: true,
    file: {
      path: safePath.path,
      kind: kindForPath(safePath.path),
      size: data.byteLength,
      sha256: createHash('sha256').update(data).digest('hex')
    }
  }
}

async function normalizeDraftPackageRoot(
  filesRoot: string,
  files: DraftFile[],
  mode: DraftMode
): Promise<{ ok: true; files: DraftFile[] } | { ok: false; detail: string }> {
  if (files.length > MAX_DRAFT_FILES) {
    return { ok: false, detail: `draft contains more than ${MAX_DRAFT_FILES} files` }
  }
  if (mode !== 'package' && !files.some((file) => isSkillPackageMarker(file.path))) {
    return { ok: true, files }
  }
  const prefix = commonPackageRootPrefix(files.map((file) => file.path))
  if (!prefix) return { ok: true, files }

  const nextFiles: DraftFile[] = []
  const seen = new Set<string>()
  for (const file of files) {
    const nextPath = file.path.startsWith(prefix) ? file.path.slice(prefix.length) : file.path
    if (!nextPath || seen.has(nextPath)) return { ok: false, detail: 'package files contain duplicate paths after root normalization' }
    seen.add(nextPath)
    const source = resolve(filesRoot, file.path)
    const target = resolve(filesRoot, nextPath)
    const rel = relative(filesRoot, target)
    if (rel.startsWith('..') || rel.includes(`..${sep}`)) {
      return { ok: false, detail: 'package file path escapes draft workspace' }
    }
    if (source !== target) {
      await mkdir(dirname(target), { recursive: true })
      await rename(source, target)
    }
    nextFiles.push({
      ...file,
      path: nextPath,
      kind: kindForPath(nextPath)
    })
  }
  await rm(resolve(filesRoot, prefix.slice(0, -1)), { recursive: true, force: true }).catch(() => undefined)
  return { ok: true, files: nextFiles.sort((a, b) => a.path.localeCompare(b.path)) }
}

function commonPackageRootPrefix(paths: string[]): string | undefined {
  if (paths.length === 0) return undefined
  const split = paths.map((path) => path.split('/'))
  if (split.some((parts) => parts.length < 2)) return undefined
  const first = split[0]?.[0]
  if (!first || split.some((parts) => parts[0] !== first)) return undefined
  const stripped = paths.map((path) => path.slice(first.length + 1))
  if (!stripped.some((path) => isSkillPackageMarker(path))) return undefined
  return `${first}/`
}

function isZipUpload(name: string, data: Buffer): boolean {
  return extname(name).toLowerCase() === '.zip' || data.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
}

function extractZipEntries(data: Buffer): { ok: true; files: Array<{ path: string; data: Buffer }> } | { ok: false; detail: string } {
  const eocdOffset = findEndOfCentralDirectory(data)
  if (eocdOffset < 0) return { ok: false, detail: 'uploaded zip file is invalid or unsupported' }
  const totalEntries = data.readUInt16LE(eocdOffset + 10)
  const centralSize = data.readUInt32LE(eocdOffset + 12)
  const centralOffset = data.readUInt32LE(eocdOffset + 16)
  if (centralOffset + centralSize > data.byteLength) {
    return { ok: false, detail: 'uploaded zip central directory is invalid' }
  }
  if (totalEntries > MAX_DRAFT_FILES) {
    return { ok: false, detail: `zip contains more than ${MAX_DRAFT_FILES} files` }
  }

  const files: Array<{ path: string; data: Buffer }> = []
  const seen = new Set<string>()
  let totalSize = 0
  let offset = centralOffset
  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > data.byteLength || data.readUInt32LE(offset) !== 0x02014b50) {
      return { ok: false, detail: 'uploaded zip central directory entry is invalid' }
    }
    const flags = data.readUInt16LE(offset + 8)
    const compression = data.readUInt16LE(offset + 10)
    const compressedSize = data.readUInt32LE(offset + 20)
    const uncompressedSize = data.readUInt32LE(offset + 24)
    const nameLength = data.readUInt16LE(offset + 28)
    const extraLength = data.readUInt16LE(offset + 30)
    const commentLength = data.readUInt16LE(offset + 32)
    const localHeaderOffset = data.readUInt32LE(offset + 42)
    const nameStart = offset + 46
    const nameEnd = nameStart + nameLength
    if (nameEnd > data.byteLength) return { ok: false, detail: 'uploaded zip file name is invalid' }
    const rawName = data.subarray(nameStart, nameEnd).toString('utf8')
    offset = nameEnd + extraLength + commentLength

    if (!rawName || rawName.endsWith('/')) continue
    if (rawName.startsWith('__MACOSX/') || rawName.endsWith('/.DS_Store') || rawName === '.DS_Store') continue
    if ((flags & 0x1) !== 0) return { ok: false, detail: 'encrypted zip files are not supported' }
    const safePath = safeUploadPath(rawName)
    if (!safePath.ok) return safePath
    if (seen.has(safePath.path)) return { ok: false, detail: 'zip contains duplicate file paths' }
    seen.add(safePath.path)
    if (localHeaderOffset + 30 > data.byteLength || data.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      return { ok: false, detail: 'uploaded zip local header is invalid' }
    }
    const localNameLength = data.readUInt16LE(localHeaderOffset + 26)
    const localExtraLength = data.readUInt16LE(localHeaderOffset + 28)
    const compressedStart = localHeaderOffset + 30 + localNameLength + localExtraLength
    const compressedEnd = compressedStart + compressedSize
    if (compressedEnd > data.byteLength) return { ok: false, detail: 'uploaded zip file data is invalid' }
    const compressed = data.subarray(compressedStart, compressedEnd)
    const content = compression === 0
      ? Buffer.from(compressed)
      : compression === 8
        ? inflateRawSync(compressed)
        : undefined
    if (!content) return { ok: false, detail: `unsupported zip compression method: ${compression}` }
    if (content.byteLength !== uncompressedSize) {
      return { ok: false, detail: 'uploaded zip file size metadata is invalid' }
    }
    totalSize += content.byteLength
    if (totalSize > MAX_EXTRACTED_BYTES) {
      return { ok: false, detail: `zip extracted content exceeds ${MAX_EXTRACTED_BYTES} byte limit` }
    }
    files.push({ path: safePath.path, data: content })
  }
  if (files.length === 0) return { ok: false, detail: 'zip does not contain any importable files' }
  return { ok: true, files }
}

function findEndOfCentralDirectory(data: Buffer): number {
  const min = Math.max(0, data.byteLength - 65_557)
  for (let index = data.byteLength - 22; index >= min; index -= 1) {
    if (data.readUInt32LE(index) === 0x06054b50) return index
  }
  return -1
}

function isSkillPackageMarker(path: string): boolean {
  return path === 'SKILL.md' || path.endsWith('/SKILL.md') || path === 'skill.json' || path.endsWith('/skill.json')
}

export async function analyzeSkillDraft(
  runtime: ServerRuntime,
  _actor: AuthActor | undefined,
  draftId: string
): Promise<JsonResponse | Response> {
  const draft = await loadDraft(runtime, draftId)
  if (!draft) return ERRORS.notFound(`skill draft not found: ${draftId}`)
  const evidence = await analyzeDraftFiles(runtime, draft)
  const next = { ...draft, evidence, updatedAt: runtime.nowIso() }
  await saveDraft(runtime, next)
  return jsonResponse({ success: true, draftId, evidence })
}

export async function generateSkillDraft(
  runtime: ServerRuntime,
  _actor: AuthActor | undefined,
  draftId: string
): Promise<JsonResponse | Response> {
  const draft = await loadDraft(runtime, draftId)
  if (!draft) return ERRORS.notFound(`skill draft not found: ${draftId}`)
  const evidence = draft.evidence ?? await analyzeDraftFiles(runtime, draft)
  const generated = draft.mode === 'package'
    ? await generatePackageDraft(runtime, draft, evidence).catch((error) => error instanceof Error ? error : new Error(String(error)))
    : generateDraftFromEvidence(evidence)
  if (generated instanceof Error) return ERRORS.validation(generated.message)
  await saveDraft(runtime, {
    ...draft,
    evidence,
    draft: generated,
    updatedAt: runtime.nowIso()
  })
  return jsonResponse({ success: true, draftId, evidence, draft: generated })
}

export async function updateSkillDraft(
  runtime: ServerRuntime,
  _actor: AuthActor | undefined,
  draftId: string,
  request: Request
): Promise<JsonResponse | Response> {
  const draft = await loadDraft(runtime, draftId)
  if (!draft) return ERRORS.notFound(`skill draft not found: ${draftId}`)
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  if (!isObject(body.value)) return jsonResponse({ detail: 'skill draft update body must be an object' }, 400)
  const nextDraft = parseGeneratedDraft(body.value.draft) ?? draft.draft
  const next: SkillDraftSnapshot = {
    ...draft,
    ...(nextDraft ? { draft: nextDraft } : {}),
    updatedAt: runtime.nowIso()
  }
  await saveDraft(runtime, next)
  return jsonResponse({ success: true, draftId, draft: next.draft })
}

export async function installSkillDraft(
  runtime: ServerRuntime,
  actor: AuthActor | undefined,
  draftId: string,
  request: Request
): Promise<JsonResponse | Response> {
  const draft = await loadDraft(runtime, draftId)
  if (!draft) return ERRORS.notFound(`skill draft not found: ${draftId}`)
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  if (!isObject(body.value)) return jsonResponse({ detail: 'skill draft install body must be an object' }, 400)

  const generated = parseGeneratedDraft(body.value) ?? draft.draft
  if (!generated) return jsonResponse({ detail: 'skill draft has not been generated' }, 400)
  const skillId = generated.metadata.id.trim()
  if (!isValidCustomSkillId(skillId)) {
    return jsonResponse({ detail: 'id must start with a lowercase English letter or number and contain only lowercase English letters, numbers, or hyphens' }, 400)
  }
  if (draft.mode !== 'package' && containsUnsafeAbsolutePath(generated.skillMarkdown)) {
    return jsonResponse({ detail: 'generated SKILL.md contains an absolute local path' }, 400)
  }

  const targetRoot = userSkillInstallRoot(runtime, skillId)
  await rm(targetRoot, { recursive: true, force: true })
  if (draft.mode === 'package') {
    await mkdir(targetRoot, { recursive: true })
    for (const file of draft.files) {
      const source = resolve(draftFilesRoot(runtime, draft.draftId), file.path)
      const target = resolve(targetRoot, file.path)
      const rel = relative(targetRoot, target)
      if (rel.startsWith('..') || rel.includes(`..${sep}`)) {
        return ERRORS.validation('package file path escapes skill install root')
      }
      await mkdir(dirname(target), { recursive: true })
      await cp(source, target, { recursive: false, force: true })
    }
  } else {
    await mkdir(join(targetRoot, 'scripts'), { recursive: true })
    for (const file of draft.files) {
      const source = resolve(draftFilesRoot(runtime, draft.draftId), file.path)
      const targetName = basename(file.path)
      await cp(source, join(targetRoot, 'scripts', targetName), { recursive: false, force: true })
    }
  }
  await writeFile(join(targetRoot, 'SKILL.md'), generated.skillMarkdown, 'utf8')
  await writeFile(join(targetRoot, 'skill.json'), `${JSON.stringify(skillManifestForDraft(generated), null, 2)}\n`, 'utf8')

  const requestedWorkModeId = normalizeWorkModeId(stringValue(body.value.workModeId) ?? stringValue(body.value.work_mode_id) ?? draft.workModeId)
  const registered = await enableDraftSkillForActor(runtime, actor, skillId, requestedWorkModeId)
  if (!registered.ok) return registered.response

  return jsonResponse({
    success: true,
    installed: true,
    skill_name: skillId,
    skill_id: skillId,
    workModeId: registered.workModeId,
    root: targetRoot,
    message: `技能 ${skillId} 已安装并绑定到 ${registered.workModeId}`
  }, 201)
}

async function analyzeDraftFiles(runtime: ServerRuntime, draft: SkillDraftSnapshot): Promise<SkillDraftEvidence> {
  const files: DraftFile[] = []
  const entryCandidates: EntryCandidate[] = []
  const commands: CommandEvidence[] = []
  const dependencies = new Map<string, DependencyEvidence>()
  const risks: RiskEvidence[] = []
  const snippets: SnippetEvidence[] = []

  for (const file of draft.files) {
    const absolutePath = resolve(draftFilesRoot(runtime, draft.draftId), file.path)
    const content = await readFile(absolutePath, 'utf8').catch(() => '')
    files.push(file)
    if (draft.mode === 'package' && file.path === 'SKILL.md') {
      entryCandidates.push({ path: file.path, confidence: 0.95, reason: 'skill package entry' })
      snippets.push({ path: file.path, label: 'skill entry', text: content.split(/\r?\n/).slice(0, 12).join('\n') })
      continue
    }
    if (draft.mode === 'package' && file.path === 'skill.json') {
      snippets.push({ path: file.path, label: 'skill manifest', text: content.split(/\r?\n/).slice(0, 24).join('\n') })
      continue
    }
    if (!SCRIPT_EXTENSIONS.has(extname(file.path).toLowerCase())) continue

    const kind = kindForPath(file.path)
    const args = extractArguments(content)
    const hasMain = /if\s+__name__\s*==\s*['"]__main__['"]/.test(content)
    const hasArgparse = /\bargparse\b|ArgumentParser|add_argument/.test(content)
    const confidence = hasMain && hasArgparse ? 0.86 : hasArgparse ? 0.7 : 0.5
    const reasons = [
      hasMain ? 'has __main__ guard' : undefined,
      hasArgparse ? 'argparse definitions' : undefined,
      !hasMain && !hasArgparse ? `${kind} script file` : undefined
    ].filter(Boolean).join(' and ')
    entryCandidates.push({ path: file.path, confidence, reason: reasons })
    commands.push({
      path: file.path,
      suggestedInvocation: invocationFor(file.path, args),
      arguments: args.map((name) => ({ name, required: true, source: hasArgparse ? 'argparse positional' : 'script heuristic' }))
    })

    for (const dependency of extractDependencies(content, kind)) {
      dependencies.set(dependency.name, dependency)
    }
    risks.push(...extractRisks(content))
    const snippet = content.split(/\r?\n/).filter((line) => /ArgumentParser|add_argument|if\s+__name__/.test(line)).slice(0, 8).join('\n')
    if (snippet) snippets.push({ path: file.path, label: 'cli section', text: snippet })
  }

  entryCandidates.sort((a, b) => b.confidence - a.confidence || a.path.localeCompare(b.path))
  commands.sort((a, b) => a.path.localeCompare(b.path))
  return {
    files,
    entryCandidates,
    commands,
    dependencies: [...dependencies.values()].sort((a, b) => a.name.localeCompare(b.name)),
    risks,
    snippets
  }
}

async function generatePackageDraft(
  runtime: ServerRuntime,
  draft: SkillDraftSnapshot,
  evidence: SkillDraftEvidence
): Promise<GeneratedSkillDraft> {
  const filesRoot = draftFilesRoot(runtime, draft.draftId)
  const skillMarkdown = await readFile(resolve(filesRoot, 'SKILL.md'), 'utf8').catch(() => undefined)
  if (!skillMarkdown) throw new Error('package draft must contain SKILL.md')
  const manifest = await readPackageManifest(filesRoot, skillMarkdown)
  const warnings = evidence.risks.map((risk) => ({ severity: risk.severity, message: `${risk.kind}: ${risk.evidence}` }))
  return {
    metadata: {
      id: manifest.id,
      name: manifest.name,
      description: manifest.description ?? descriptionFromSkillMarkdown(skillMarkdown, manifest.name)
    },
    skillMarkdown,
    manifestPatch: {
      ...manifest,
      assets: manifest.assets,
      permissions: manifest.permissions
    },
    questions: [],
    warnings
  }
}

async function readPackageManifest(filesRoot: string, skillMarkdown: string): Promise<SkillManifestV1> {
  const manifestPath = resolve(filesRoot, 'skill.json')
  const raw = await readFile(manifestPath, 'utf8').catch(() => undefined)
  if (raw) {
    const parsed = JSON.parse(raw) as unknown
    if (isObject(parsed) && 'specVersion' in parsed) {
      return SkillManifestV1.parse(parsed)
    }
    if (isObject(parsed)) return migrateLegacyManifest(parsed)
  }
  const frontmatter = readSkillFrontmatter(skillMarkdown)
  const id = slugifySkillId(frontmatter.name ?? frontmatter.id ?? frontmatter.title) ?? 'custom-skill'
  return SkillManifestV1.parse({
    specVersion: '1.0',
    id,
    name: frontmatter.title ?? titleFromSlug(id),
    description: frontmatter.description ?? descriptionFromSkillMarkdown(skillMarkdown, titleFromSlug(id)),
    entry: 'SKILL.md',
    category: 'workflow',
    activation: {
      commands: [],
      promptPatterns: frontmatter.description ? [escapeRegExp(frontmatter.description)] : [],
      fileTypes: [],
      autoActivate: false
    },
    commands: [],
    tools: { allowed: [], declarations: [], mcpServers: {} },
    contributes: { chatMenu: [], quickTask: [] },
    permissions: {
      workspace: 'write',
      network: false,
      exec: 'workspace',
      requiresApproval: 'on-request'
    },
    assets: []
  })
}

function readSkillFrontmatter(markdown: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)
  const out: Record<string, string> = {}
  if (!match) return out
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx > 0) out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  return out
}

function descriptionFromSkillMarkdown(markdown: string, fallbackName: string): string {
  const frontmatter = readSkillFrontmatter(markdown)
  if (frontmatter.description) return frontmatter.description
  const heading = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim()
  return heading ? `Use the ${heading} skill package.` : `Use the ${fallbackName} skill package.`
}

function generateDraftFromEvidence(evidence: SkillDraftEvidence): GeneratedSkillDraft {
  const command = evidence.commands[0]
  const entry = evidence.entryCandidates[0]
  const base = basename(command?.path ?? entry?.path ?? evidence.files[0]?.path ?? 'skill', extname(command?.path ?? entry?.path ?? evidence.files[0]?.path ?? ''))
  const id = slugifySkillId(base) ?? 'script-skill'
  const title = titleFromSlug(id)
  const description = descriptionFromEvidence(evidence, title)
  const invocation = command?.suggestedInvocation ?? `python scripts/${basename(entry?.path ?? 'script.py')}`
  const warnings = evidence.risks.map((risk) => ({ severity: risk.severity, message: `${risk.kind}: ${risk.evidence}` }))
  const questions = command && command.arguments.length > 0
    ? []
    : [{ field: 'arguments', question: 'Confirm the required command arguments before using this skill.' }]
  const skillMarkdown = [
    '---',
    `name: ${id}`,
    `description: ${frontmatterLine(description)}`,
    '---',
    '',
    `# ${title}`,
    '',
    '## When To Use',
    `Use when the user needs to run the bundled ${title} script workflow.`,
    '',
    '## Procedure',
    '- Confirm the input files, output path, and any user-specific constraints before running the script.',
    `- Run the bundled command with package-relative paths:`,
    '',
    '```bash',
    invocation,
    '```',
    '- Review the command output and report any missing dependencies or script errors clearly.',
    '',
    '## Output Contract',
    '- Provide the generated file path or command output.',
    '- Summarize what the script did and list any warnings or follow-up actions.',
    ...(warnings.length
      ? [
          '',
          '## Warnings',
          ...warnings.map((warning) => `- ${warning.message}`)
        ]
      : [])
  ].join('\n')

  return {
    metadata: { id, name: title, description },
    skillMarkdown,
    manifestPatch: {
      category: 'workflow',
      permissions: {
        workspace: 'write',
        network: evidence.risks.some((risk) => risk.kind === 'network'),
        exec: 'workspace',
        requiresApproval: 'on-request'
      },
      assets: evidence.files.map((file) => `scripts/${basename(file.path)}`)
    },
    questions,
    warnings
  }
}

function skillManifestForDraft(draft: GeneratedSkillDraft): Record<string, unknown> {
  const permissions = isObject(draft.manifestPatch.permissions)
    ? draft.manifestPatch.permissions
    : {
        workspace: 'write',
        network: false,
        exec: 'workspace',
        requiresApproval: 'on-request'
      }
  const assets = Array.isArray(draft.manifestPatch.assets)
    ? draft.manifestPatch.assets.filter((asset): asset is string => typeof asset === 'string')
    : []
  const base = {
    specVersion: '1.0',
    id: draft.metadata.id,
    name: draft.metadata.name,
    description: draft.metadata.description,
    version: stringValue(draft.manifestPatch.version) ?? '0.1.0',
    entry: stringValue(draft.manifestPatch.entry) ?? 'SKILL.md',
    category: stringValue(draft.manifestPatch.category) ?? 'workflow',
    ...(isObject(draft.manifestPatch.author) ? { author: draft.manifestPatch.author } : {}),
    ...(stringValue(draft.manifestPatch.license) ? { license: stringValue(draft.manifestPatch.license) } : {}),
    ...(stringValue(draft.manifestPatch.icon) ? { icon: stringValue(draft.manifestPatch.icon) } : {}),
    ...(typeof draft.manifestPatch.priority === 'number' ? { priority: draft.manifestPatch.priority } : {}),
    activation: {
      commands: [],
      promptPatterns: [escapeRegExp(draft.metadata.description)],
      fileTypes: [],
      autoActivate: false,
      ...(isObject(draft.manifestPatch.activation) ? draft.manifestPatch.activation : {})
    },
    commands: Array.isArray(draft.manifestPatch.commands) ? draft.manifestPatch.commands : [],
    tools: isObject(draft.manifestPatch.tools) ? draft.manifestPatch.tools : {
      allowed: [],
      declarations: [],
      mcpServers: {}
    },
    contributes: isObject(draft.manifestPatch.contributes) ? draft.manifestPatch.contributes : {
      chatMenu: [],
      quickTask: []
    },
    permissions,
    assets
  }
  return SkillManifestV1.parse(base)
}

async function enableDraftSkillForActor(
  runtime: ServerRuntime,
  actor: AuthActor | undefined,
  skillId: string,
  requestedWorkModeId: string | undefined
): Promise<{ ok: true; workModeId: string } | { ok: false; response: JsonResponse }> {
  const current = await readEffectiveConfig(runtime, actor)
  const currentSkills = current.capabilities?.skills ?? DEFAULT_QIONGQI_CAPABILITIES_CONFIG.skills
  const installRoot = customSharedSkillRoot(runtime)
  const roots = new Set(currentSkills.roots ?? [])
  roots.add(installRoot)
  const withRoot = {
    ...currentSkills,
    enabled: true,
    roots: [...roots].sort((a, b) => a.localeCompare(b)),
    enabledSkills: {
      ...(currentSkills.enabledSkills ?? {}),
      [skillId]: true
    }
  }
  const workModeId = requestedWorkModeId && withRoot.workModes.modes[requestedWorkModeId]
    ? requestedWorkModeId
    : withRoot.workModes.defaultModeId
  const defaultIds = new Set(resolveWorkModeDefaultSkillIds(withRoot, workModeId))
  const currentOverride = withRoot.modeSkillOverrides[workModeId] ?? { addedSkillIds: [], removedSkillIds: [] }
  const added = new Set(currentOverride.addedSkillIds)
  const removed = new Set(currentOverride.removedSkillIds)
  removed.delete(skillId)
  if (!defaultIds.has(skillId)) added.add(skillId)
  const skills = {
    ...withRoot,
    modeSkillOverrides: {
      ...withRoot.modeSkillOverrides,
      [workModeId]: {
        addedSkillIds: [...added].sort((a, b) => a.localeCompare(b)),
        removedSkillIds: [...removed].sort((a, b) => a.localeCompare(b))
      }
    }
  }
  const next = QiongqiConfigSchema.parse({
    ...current,
    capabilities: {
      ...(current.capabilities ?? {}),
      skills
    }
  })
  await writeConfig(runtime, next)
  const owner = ownerUserId(actor)
  if (owner && runtime.kworksUserDataStore) {
    await runtime.kworksUserDataStore.setUserSetting(owner, 'capabilities.skills', skills)
    await runtime.kworksUserDataStore.setUserSetting(owner, 'capabilities.skills.compat', skillCompatFromCapability(skills))
  }
  await (runtime.refreshRuntimeTools?.() ?? runtime.refreshMcpTools?.())
  return { ok: true, workModeId }
}

async function readEffectiveConfig(runtime: ServerRuntime, actor?: AuthActor): Promise<QiongqiConfig> {
  const config = await readConfig(runtime)
  const owner = ownerUserId(actor)
  if (!owner || !runtime.kworksUserDataStore) return config
  const savedSkills = await runtime.kworksUserDataStore.getUserSetting(owner, 'capabilities.skills')
  if (!isObject(savedSkills)) return config
  return QiongqiConfigSchema.parse({
    ...config,
    capabilities: {
      ...(config.capabilities ?? {}),
      skills: savedSkills
    }
  })
}

async function readConfig(runtime: ServerRuntime): Promise<QiongqiConfig> {
  if (runtime.configStore) return QiongqiConfigSchema.parse(await runtime.configStore.read())
  const info = runtime.info()
  const model = info.model || 'default'
  return QiongqiConfigSchema.parse({
    serve: {
      host: info.host,
      port: info.port,
      dataDir: info.dataDir,
      runtimeToken: runtime.runtimeToken,
      model,
      approvalPolicy: info.approvalPolicy,
      sandboxMode: info.sandboxMode,
      insecure: info.insecure
    },
    models: {
      profiles: {
        [model]: {
          inputModalities: ['text'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text']
        }
      }
    }
  })
}

async function writeConfig(runtime: ServerRuntime, config: QiongqiConfig): Promise<QiongqiConfig> {
  const parsed = QiongqiConfigSchema.parse(config)
  if (!runtime.configStore) return parsed
  return QiongqiConfigSchema.parse(await runtime.configStore.write(parsed))
}

function extractArguments(content: string): string[] {
  const args: string[] = []
  const regex = /add_argument\(\s*['"]([^'"\-][^'"]*)['"]/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    const name = match[1]?.trim()
    if (name && !args.includes(name)) args.push(name)
  }
  return args
}

function extractDependencies(content: string, kind: string): DependencyEvidence[] {
  if (kind !== 'python') return []
  const builtins = new Set(['argparse', 'os', 'sys', 'json', 're', 'pathlib', 'subprocess', 'typing'])
  const out = new Map<string, DependencyEvidence>()
  for (const line of content.split(/\r?\n/)) {
    const importMatch = /^\s*import\s+([a-zA-Z_][\w.]*)/.exec(line)
    const fromMatch = /^\s*from\s+([a-zA-Z_][\w.]*)\s+import\b/.exec(line)
    const name = (importMatch?.[1] ?? fromMatch?.[1])?.split('.')[0]
    if (name && !builtins.has(name)) out.set(name, { name, source: 'python import' })
  }
  return [...out.values()]
}

function extractRisks(content: string): RiskEvidence[] {
  const risks: RiskEvidence[] = []
  if (/\b(requests|urllib|fetch|curl|wget)\b/.test(content)) {
    risks.push({ severity: 'medium', kind: 'network', evidence: 'network-related import or command detected' })
  }
  if (/rm\s+-rf|shutil\.rmtree|unlink\(|delete\s+/i.test(content)) {
    risks.push({ severity: 'high', kind: 'destructive-filesystem', evidence: 'destructive filesystem operation detected' })
  }
  if (/AKIA[0-9A-Z]{16}|api[_-]?key|secret/i.test(content)) {
    risks.push({ severity: 'medium', kind: 'credentials', evidence: 'credential-like token or variable detected' })
  }
  return risks
}

function invocationFor(path: string, args: string[]): string {
  const script = `scripts/${basename(path)}`
  const suffix = args.map((arg) => `<${arg}>`).join(' ')
  const prefix = extname(path).toLowerCase() === '.py'
    ? `python ${script}`
    : extname(path).toLowerCase() === '.sh'
      ? `bash ${script}`
      : `node ${script}`
  return suffix ? `${prefix} ${suffix}` : prefix
}

function descriptionFromEvidence(evidence: SkillDraftEvidence, title: string): string {
  const snippet = evidence.snippets.map((item) => item.text).join('\n')
  const description = /ArgumentParser\(description=['"]([^'"]+)['"]/.exec(snippet)?.[1]
  return description?.trim() || `Run the bundled ${title} command workflow.`
}

async function loadDraft(runtime: ServerRuntime, draftId: string): Promise<SkillDraftSnapshot | null> {
  if (!isValidDraftId(draftId)) return null
  const content = await readFile(draftMetaPath(runtime, draftId), 'utf8').catch(() => null)
  if (!content) return null
  return JSON.parse(content) as SkillDraftSnapshot
}

async function saveDraft(runtime: ServerRuntime, draft: SkillDraftSnapshot): Promise<void> {
  const root = draftRoot(runtime, draft.draftId)
  await mkdir(root, { recursive: true })
  await writeFile(draftMetaPath(runtime, draft.draftId), `${JSON.stringify(draft, null, 2)}\n`, 'utf8')
}

function draftMetaPath(runtime: ServerRuntime, draftId: string): string {
  return join(draftRoot(runtime, draftId), 'draft.json')
}

function draftFilesRoot(runtime: ServerRuntime, draftId: string): string {
  return join(draftRoot(runtime, draftId), 'files')
}

function draftRoot(runtime: ServerRuntime, draftId: string): string {
  return join(workspaceRootFromRuntimeDataDir(runtime.info().dataDir), 'skill-drafts', draftId)
}

function customSharedSkillRoot(runtime: ServerRuntime): string {
  return join(workspaceRootFromRuntimeDataDir(runtime.info().dataDir), 'skills', 'custom', 'shared')
}

function userSkillInstallRoot(runtime: ServerRuntime, skillId: string): string {
  return join(customSharedSkillRoot(runtime), skillId)
}

function workspaceRootFromRuntimeDataDir(dataDir: string): string {
  const parts = dataDir.split(/[\\/]+/)
  const usersIndex = parts.lastIndexOf('users')
  if (usersIndex < 0) return dataDir
  const leadingSlash = dataDir.startsWith('/') ? '/' : ''
  return `${leadingSlash}${parts.slice(0, usersIndex).join('/')}`
}

function safeUploadPath(name: string): { ok: true; path: string } | { ok: false; detail: string } {
  const rawParts = name.replace(/\\/g, '/').split('/')
  if (rawParts.some((part) => part === '..' || part.startsWith('.'))) {
    return { ok: false, detail: 'uploaded file path contains unsafe segments' }
  }
  const normalized = rawParts.filter(Boolean)
  const safeParts = normalized.map((part) => basename(part).replace(/[^\w.\- ]+/g, '_').trim()).filter(Boolean)
  const path = safeParts.join('/')
  if (!path) return { ok: false, detail: 'uploaded file name is empty' }
  return { ok: true, path }
}

function kindForPath(path: string): string {
  const extension = extname(path).toLowerCase()
  if (extension === '.py') return 'python'
  if (extension === '.sh') return 'shell'
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') return 'javascript'
  if (extension === '.ts') return 'typescript'
  if (extension === '.md') return 'markdown'
  if (extension === '.json') return 'json'
  return extension.replace(/^\./, '') || 'text'
}

function draftMode(value: SkillDraftFormValue | null): DraftMode {
  return stringFormValue(value) === 'package' ? 'package' : 'scripts'
}

function parseGeneratedDraft(value: unknown): GeneratedSkillDraft | undefined {
  if (!isObject(value)) return undefined
  const metadata = isObject(value.metadata) ? value.metadata : undefined
  const id = metadata ? stringValue(metadata.id) : undefined
  const name = metadata ? stringValue(metadata.name) : undefined
  const description = metadata ? stringValue(metadata.description) : undefined
  const skillMarkdown = stringValue(value.skillMarkdown)
  if (!id || !name || !description || !skillMarkdown) return undefined
  return {
    metadata: { id, name, description },
    skillMarkdown,
    manifestPatch: isObject(value.manifestPatch) ? value.manifestPatch : {},
    questions: arrayOfObjects(value.questions).map((item) => ({
      field: stringValue(item.field) ?? 'unknown',
      question: stringValue(item.question) ?? ''
    })).filter((item) => item.question),
    warnings: arrayOfObjects(value.warnings).map((item) => ({
      severity: stringValue(item.severity) ?? 'medium',
      message: stringValue(item.message) ?? ''
    })).filter((item) => item.message)
  }
}

function containsUnsafeAbsolutePath(markdown: string): boolean {
  return /(?:^|\s)(?:python3?\s+|bash\s+|node\s+)?(?:\/Users\/|\/home\/|\/private\/|[A-Za-z]:\\)/.test(markdown)
}

function normalizeWorkModeId(id: string | undefined): string | undefined {
  const fromId = id?.trim()
  if (!fromId) return undefined
  const lower = fromId.toLowerCase()
  // Legacy alias: "task" was renamed to "office".
  return lower === 'task' ? 'office' : lower
}

function isValidCustomSkillId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(id)
}

function isValidDraftId(id: string): boolean {
  return /^draft_[a-f0-9]{16}$/.test(id)
}

function slugifySkillId(value: string | undefined): string | undefined {
  const slug = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || undefined
}

function titleFromSlug(value: string): string {
  return value.split('-').filter(Boolean).map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(' ')
}

function frontmatterLine(value: string): string {
  return value.replace(/\r?\n/g, ' ').replace(/"/g, '\\"').trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function skillCompatFromCapability(value: NonNullable<NonNullable<QiongqiConfig['capabilities']>['skills']>): Record<string, { enabled: boolean }> {
  const out: Record<string, { enabled: boolean }> = {}
  for (const [name, enabled] of Object.entries(value.enabledSkills ?? {})) out[name] = { enabled }
  return out
}

function ownerUserId(actor?: AuthActor): string | undefined {
  return actor && actor.sessionId !== 'runtime-token' ? actor.userId : undefined
}

function stringFormValue(value: SkillDraftFormValue | null): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function arrayOfObjects(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => isObject(item)) : []
}

export async function listSkillDrafts(runtime: ServerRuntime): Promise<JsonResponse> {
  const root = join(workspaceRootFromRuntimeDataDir(runtime.info().dataDir), 'skill-drafts')
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const drafts = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const draft = await loadDraft(runtime, entry.name)
    if (draft) drafts.push({ draftId: draft.draftId, mode: draft.mode, files: draft.files, updatedAt: draft.updatedAt })
  }
  return jsonResponse({ drafts })
}
