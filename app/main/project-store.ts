/**
 * project-store.ts — 项目注册表（产品层概念，引擎无 /api/projects HTTP 语义）。
 *
 * 数据流：
 *   Sidebar 添加项目 / 线程自动注册 → projects.json → 侧边栏分组显示
 *
 * 存储：`<dataDir>/product/kcoder_local/projects.json`
 *   [{ id, name, path, description, is_git_repo, created_at, updated_at }]
 *
 * 语义（对齐旧 kcoder_gateway /v1/projects）：
 *   - create：按 path upsert（同一目录重复注册返回既有条目）；目录不存在时
 *     silentMissing=true 返回 {skipped, reason}（自动注册用），否则抛错
 *   - id：`proj_` + path 稳定哈希（跨重启一致，upsert 可去重）
 *   - is_git_repo：探测 path/.git 是否存在（git 面板依赖）
 */
import { existsSync } from 'node:fs'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join, dirname, basename } from 'node:path'
import { createHash } from 'node:crypto'

export interface ProjectEntry {
  id: string
  name: string
  path: string
  description?: string
  is_git_repo: boolean
  created_at: string
  updated_at: string
}

interface ProjectStore {
  projects: ProjectEntry[]
}

function projectStorePath(dataDir: string): string {
  return join(dataDir, 'product', 'kcoder_local', 'projects.json')
}

function projectIdForPath(path: string): string {
  const digest = createHash('sha1').update(path).digest('hex').slice(0, 12)
  return `proj_${digest}`
}

async function readStore(dataDir: string): Promise<ProjectStore> {
  try {
    const raw = await readFile(projectStorePath(dataDir), 'utf8')
    const parsed = JSON.parse(raw) as ProjectStore
    return { projects: Array.isArray(parsed.projects) ? parsed.projects : [] }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { projects: [] }
    }
    throw err
  }
}

async function writeStore(dataDir: string, store: ProjectStore): Promise<void> {
  const path = projectStorePath(dataDir)
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify(store, null, 2), 'utf8')
  // 原子替换（与 sub_agents.json 一致）
  const { rename } = await import('node:fs/promises')
  await rename(tmp, path)
}

export async function listProjects(dataDir: string): Promise<ProjectEntry[]> {
  const store = await readStore(dataDir)
  return store.projects
}

export interface CreateProjectResult {
  entry?: ProjectEntry
  skipped?: boolean
  reason?: string
}

export async function createProject(
  dataDir: string,
  path: string,
  name?: string,
  silentMissing = false
): Promise<CreateProjectResult> {
  const norm = path.trim()
  if (!norm) throw new Error('Project path is required')
  const store = await readStore(dataDir)

  // 目录存在性检查（silentMissing：自动注册用，目录已删时静默跳过）
  if (!existsSync(norm)) {
    if (silentMissing) return { skipped: true, reason: `Directory does not exist: ${norm}` }
    throw new Error(`Directory does not exist: ${norm}`)
  }

  // 按 path upsert
  const existing = store.projects.find((p) => p.path === norm)
  const now = new Date().toISOString()
  const entry: ProjectEntry = existing ?? {
    id: projectIdForPath(norm),
    name: name?.trim() || basename(norm) || norm,
    path: norm,
    is_git_repo: existsSync(join(norm, '.git')),
    created_at: now,
    updated_at: now
  }
  if (existing) {
    if (name?.trim()) entry.name = name.trim()
    entry.updated_at = now
    entry.is_git_repo = existsSync(join(norm, '.git'))
  }
  store.projects = [
    ...store.projects.filter((p) => p.id !== entry.id),
    entry
  ]
  await writeStore(dataDir, store)
  return { entry }
}

export async function updateProject(
  dataDir: string,
  projectId: string,
  patch: { name?: string; description?: string }
): Promise<ProjectEntry> {
  const store = await readStore(dataDir)
  const entry = store.projects.find((p) => p.id === projectId)
  if (!entry) throw new Error(`Project not found: ${projectId}`)
  if (patch.name?.trim()) entry.name = patch.name.trim()
  if (patch.description !== undefined) entry.description = patch.description
  entry.updated_at = new Date().toISOString()
  await writeStore(dataDir, store)
  return entry
}

export async function deleteProject(
  dataDir: string,
  projectId: string
): Promise<{ deleted: boolean; archivedThreads?: number }> {
  const store = await readStore(dataDir)
  const before = store.projects.length
  store.projects = store.projects.filter((p) => p.id !== projectId)
  const deleted = store.projects.length < before
  if (deleted) await writeStore(dataDir, store)
  // 线程归档由引擎端线程 metadata 驱动；产品层无法统计，返回 0
  return { deleted, archivedThreads: 0 }
}
