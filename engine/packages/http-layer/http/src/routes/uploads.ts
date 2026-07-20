import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { VirtualPathResolver } from '@qiongqi/attachments'
import { jsonResponse, type JsonResponse } from '../response.js'
import { ERRORS } from './runtime-error.js'
import type { ServerRuntime } from './server-runtime.js'

type UploadedFileInfo = {
  filename: string
  size: number
  path: string
  virtual_path: string
  artifact_url: string
  extension?: string
  modified?: number
}

export async function uploadThreadFiles(
  runtime: ServerRuntime,
  threadId: string,
  request: Request
): Promise<JsonResponse | Response> {
  const form = await request.formData().catch(() => null)
  if (!form) return ERRORS.validation('upload request must be multipart/form-data')
  const values = form.getAll('files')
  const files = values.filter((value): value is File => value instanceof File)
  if (files.length === 0) return ERRORS.validation('at least one file is required')

  const uploadsDir = threadUploadsDir(runtime, threadId)
  await mkdir(uploadsDir, { recursive: true })

  const uploaded: UploadedFileInfo[] = []
  for (const file of files) {
    const filename = await uniqueUploadName(uploadsDir, safeUploadName(file.name || 'upload'))
    const absolutePath = join(uploadsDir, filename)
    await writeFile(absolutePath, Buffer.from(await file.arrayBuffer()))
    const info = await uploadInfo(runtime, threadId, absolutePath, filename)
    if (info) uploaded.push(info)
  }

  return jsonResponse({
    success: true,
    files: uploaded,
    message: uploaded.length === 1 ? 'Uploaded 1 file' : `Uploaded ${uploaded.length} files`
  })
}

export async function listThreadUploads(
  runtime: ServerRuntime,
  threadId: string
): Promise<JsonResponse> {
  const uploadsDir = threadUploadsDir(runtime, threadId)
  const entries = await readdir(uploadsDir, { withFileTypes: true }).catch(() => [])
  const files: UploadedFileInfo[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const info = await uploadInfo(runtime, threadId, join(uploadsDir, entry.name), entry.name)
    if (info) files.push(info)
  }
  files.sort((a, b) => a.filename.localeCompare(b.filename))
  return jsonResponse({ files, count: files.length })
}

export async function deleteThreadUpload(
  runtime: ServerRuntime,
  threadId: string,
  filename: string
): Promise<JsonResponse> {
  const safeName = safeUploadName(filename)
  const absolutePath = join(threadUploadsDir(runtime, threadId), safeName)
  try {
    await rm(absolutePath, { force: false })
  } catch {
    return ERRORS.notFound(`uploaded file not found: ${safeName}`)
  }
  return jsonResponse({ success: true, message: `Deleted ${safeName}` })
}

async function uploadInfo(
  runtime: ServerRuntime,
  threadId: string,
  absolutePath: string,
  filename: string
): Promise<UploadedFileInfo | null> {
  const fileStat = await stat(absolutePath).catch(() => null)
  if (!fileStat) return null
  const virtualPath = await resolverForThread(runtime, threadId).toVirtualPath(absolutePath)
  if (!virtualPath) return null
  const extension = extname(filename).replace(/^\./, '')
  return {
    filename,
    size: fileStat.size,
    path: absolutePath,
    virtual_path: virtualPath,
    artifact_url: `/api/threads/${encodeURIComponent(threadId)}/artifacts${virtualPath}`,
    ...(extension ? { extension } : {}),
    modified: Math.floor(fileStat.mtimeMs)
  }
}

async function uniqueUploadName(dir: string, filename: string): Promise<string> {
  const extension = extname(filename)
  const stem = extension ? filename.slice(0, -extension.length) : filename
  let candidate = filename
  for (let suffix = 1; suffix < 10_000; suffix += 1) {
    const exists = await stat(join(dir, candidate)).then(() => true, () => false)
    if (!exists) return candidate
    candidate = `${stem}-${suffix}${extension}`
  }
  throw new Error(`could not allocate upload filename for ${filename}`)
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

function threadUploadsDir(runtime: ServerRuntime, threadId: string): string {
  return join(threadRoot(runtime, threadId), 'uploads')
}

function threadRoot(runtime: ServerRuntime, threadId: string): string {
  return join(runtime.info().dataDir, 'threads', threadId)
}

function safeUploadName(name: string): string {
  const cleaned = basename(name).replace(/[^\w.\- ]+/g, '_').replace(/^\.+$/, '_').trim()
  return cleaned || 'upload'
}
