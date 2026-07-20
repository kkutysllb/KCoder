import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { VirtualPathResolver } from '@qiongqi/attachments'
import { jsonResponse, type JsonResponse } from '../response.js'
import { ERRORS } from './runtime-error.js'
import type { ServerRuntime } from './server-runtime.js'

export async function listThreadArtifacts(
  runtime: ServerRuntime,
  threadId: string
): Promise<JsonResponse> {
  const resolver = resolverForThread(runtime, threadId)
  const outputsDir = join(threadRoot(runtime, threadId), 'outputs')
  const entries = await readdir(outputsDir, { withFileTypes: true }).catch(() => [])
  const artifacts = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const absolutePath = join(outputsDir, entry.name)
    const info = await stat(absolutePath).catch(() => null)
    const virtualPath = await resolver.toVirtualPath(absolutePath)
    if (!info || !virtualPath) continue
    artifacts.push({
      name: entry.name,
      byteSize: info.size,
      virtualPath,
      updatedAt: info.mtime.toISOString()
    })
  }
  artifacts.sort((a, b) => a.name.localeCompare(b.name))
  return jsonResponse({ threadId, artifacts })
}

export async function readThreadArtifact(
  runtime: ServerRuntime,
  threadId: string,
  request: Request
): Promise<JsonResponse | Response> {
  const url = new URL(request.url)
  const path = url.searchParams.get('path') ?? virtualPathFromLegacyArtifactUrl(url, threadId)
  if (!path) return ERRORS.validation('artifact path is required')
  const resolver = resolverForThread(runtime, threadId)
  try {
    const absolutePath = path.startsWith('/mnt/qiongqi/')
      ? (await resolveMountedArtifactPath(resolver, path)).absolutePath
      : await resolveWorkspaceArtifactPath(runtime, threadId, path)
    const data = await readFile(absolutePath)
    return new Response(data, {
      status: 200,
      headers: {
        'content-type': contentTypeForPath(absolutePath),
        'content-disposition': contentDispositionForPath(absolutePath, isDownloadRequest(url))
      }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/escapes|unsupported|artifact path must target/i.test(message)) return ERRORS.forbidden(message)
    return ERRORS.notFound(message)
  }
}

async function resolveMountedArtifactPath(
  resolver: VirtualPathResolver,
  path: string
): Promise<{ absolutePath: string }> {
  const resolved = await resolver.resolve(path)
  if (resolved.mount !== 'outputs' && resolved.mount !== 'artifacts' && resolved.mount !== 'uploads') {
    throw new Error('artifact path must target uploads, outputs, or artifacts')
  }
  return { absolutePath: resolved.absolutePath }
}

async function resolveWorkspaceArtifactPath(
  runtime: ServerRuntime,
  threadId: string,
  path: string
): Promise<string> {
  const thread = await runtime.threadService.get(threadId)
  if (!thread?.workspace) throw new Error(`thread ${threadId} workspace not found`)
  const workspaceRoot = await realpath(thread.workspace)
  // Resolve relative paths against the workspace root, mirroring how the
  // write/edit tools resolve the same paths. Without this, a file the model
  // wrote to a relative path (e.g. "report.md") cannot be read back for
  // preview/download — the original absolute-only check returned 403.
  const candidate = isAbsolute(path) ? resolve(path) : resolve(workspaceRoot, path)
  // realpath() fails for non-existent files; fall back to the lexical resolve
  // so the isInside containment check still applies, then let readFile surface
  // a 404 if the file truly doesn't exist.
  const requestedPath = await realpath(candidate).catch(() => candidate)
  if (!isInside(workspaceRoot, requestedPath)) {
    throw new Error('artifact path escapes thread workspace')
  }
  return requestedPath
}

function virtualPathFromLegacyArtifactUrl(url: URL, threadId: string): string | null {
  const prefix = `/api/threads/${encodeURIComponent(threadId)}/artifacts/`
  if (!url.pathname.startsWith(prefix)) return null
  const suffix = url.pathname.slice(prefix.length)
  if (!suffix) return null
  if (suffix.startsWith('mnt/qiongqi/')) return `/${suffix}`
  const parts = suffix.split('/').filter(Boolean)
  const mount = parts[0]
  if (!mount) return null
  const relativePath = parts.slice(1).join('/')
  return `/mnt/qiongqi/${mount}${relativePath ? `/${relativePath}` : ''}`
}

function resolverForThread(runtime: ServerRuntime, threadId: string): VirtualPathResolver {
  const root = threadRoot(runtime, threadId)
  return new VirtualPathResolver({
    workspaceDir: join(root, 'workspace'),
    uploadsDir: join(root, 'uploads'),
    outputsDir: join(root, 'outputs'),
    artifactsDir: join(root, 'artifacts')
  })
}

function isInside(root: string, absolutePath: string): boolean {
  const rel = relative(root, absolutePath)
  return rel === '' || (!rel.startsWith('..') && !rel.includes(`..${sep}`) && !resolve(rel).startsWith('/..'))
}

function threadRoot(runtime: ServerRuntime, threadId: string): string {
  return join(runtime.info().dataDir, 'threads', threadId)
}

function contentTypeForPath(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.json')) return 'application/json; charset=utf-8'
  if (lower.endsWith('.md')) return 'text/markdown; charset=utf-8'
  if (lower.endsWith('.html')) return 'text/html; charset=utf-8'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  return 'text/plain; charset=utf-8'
}

function isDownloadRequest(url: URL): boolean {
  const value = url.searchParams.get('download')?.toLowerCase()
  return value === 'true' || value === '1'
}

function contentDispositionForPath(path: string, download: boolean): string {
  const type = download ? 'attachment' : 'inline'
  const filename = basename(path).replace(/"/g, '')
  if (/^[\x20-\x7E]+$/.test(filename)) {
    return `${type}; filename="${filename}"`
  }
  return `${type}; filename="${fallbackAsciiFilename(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

function fallbackAsciiFilename(filename: string): string {
  const sanitized = filename.replace(/[^\x20-\x7E]+/g, '_').replace(/"/g, '')
  return sanitized.trim() || 'artifact'
}
