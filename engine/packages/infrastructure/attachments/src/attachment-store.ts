import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { AttachmentsCapabilityConfig } from '@qiongqi/contracts'
import type { AttachmentDiagnostics, AttachmentMetadata, AttachmentTextFallback } from '@qiongqi/contracts'
import { AttachmentMetadata as AttachmentMetadataSchema } from '@qiongqi/contracts'
import { defaultSharpImageTransform, isImageMimeType } from './image-transform.js'
import type { ImageTransform } from './image-transform.js'

export type AttachmentContent = AttachmentMetadata & {
  data: Buffer
}

export interface AttachmentStore {
  create(input: {
    name: string
    data: Buffer
    mimeType?: string
    textFallback?: AttachmentTextFallback
    threadId?: string
    workspace?: string
  }): Promise<AttachmentMetadata>
  get(id: string): Promise<AttachmentMetadata | null>
  resolveContent(id: string, scope: { threadId?: string; workspace?: string }): Promise<AttachmentContent>
  textFallbackPolicy(): Pick<
    AttachmentsCapabilityConfig,
    'textFallbackMaxBase64Bytes' | 'textFallbackMaxImageDimension' | 'textFallbackPreferredMimeType'
  >
  imageFallbackPolicy(): Pick<AttachmentsCapabilityConfig, 'textFallbackMaxImageDimension' | 'textFallbackPreferredMimeType'>
  diagnostics(): Promise<AttachmentDiagnostics>
}

export class FileAttachmentStore implements AttachmentStore {
  constructor(
    private readonly options: {
      rootDir: string
      config: AttachmentsCapabilityConfig
      nowIso?: () => string
      imageTransform?: ImageTransform
    }
  ) {}

  async create(input: {
    name: string
    data: Buffer
    mimeType?: string
    textFallback?: AttachmentTextFallback
    threadId?: string
    workspace?: string
  }): Promise<AttachmentMetadata> {
    await mkdir(this.options.rootDir, { recursive: true })

    // Resolve the declared MIME first. We trust magic bytes for images so that
    // a mislabeled upload (e.g. a PNG with application/octet-stream) still gets
    // the correct type; for everything else we trust the declared MIME or
    // infer it from the filename.
    const detected = detectImage(input.data)
    const declaredMimeType = input.mimeType ?? mimeTypeFromName(input.name)

    if (detected) {
      // Genuine image bytes. Reconcile with the declared MIME: a JPEG labeled
      // image/jpg (non-standard alias) is fine, but a PNG labeled image/jpeg
      // means the bytes and metadata disagree.
      if (declaredMimeType && isImageMimeType(declaredMimeType) && declaredMimeType !== detected.mimeType && !isImageAlias(declaredMimeType, detected.mimeType)) {
        throw new Error(`declared MIME type ${declaredMimeType} does not match image content (${detected.mimeType})`)
      }
      const image = detected
      if (!this.options.config.allowedMimeTypes.includes(image.mimeType)) throw new Error(`MIME type is not allowed: ${image.mimeType}`)
      if (input.data.byteLength > this.options.config.maxImageBytes) throw new Error(`image exceeds ${this.options.config.maxImageBytes} byte limit`)
      const maxDimension = Math.max(image.width ?? 0, image.height ?? 0)
      if (maxDimension > this.options.config.maxImageDimension) {
        throw new Error(`image exceeds ${this.options.config.maxImageDimension}px dimension limit`)
      }
      if (input.textFallback) validateTextFallback(input.textFallback, this.options.config)
      const hash = createHash('sha256').update(input.data).digest('hex')
      const id = `att_${hash.slice(0, 24)}`
      // Check for an existing copy BEFORE generating a fallback: re-uploading
      // the same image bytes should not re-run sharp. If the image already
      // exists with a fallback, reuse it; otherwise generate one now.
      const existing = await this.get(id)
      const textFallback = input.textFallback
        ?? existing?.textFallback
        ?? await this.maybeGenerateImageFallback({ data: input.data, sourceMimeType: image.mimeType })
      return this.persistAttachment({ id, hash, payload: input, mimeType: image.mimeType, image, textFallback })
    }

    // Non-image (or an image format detectImage doesn't recognize, e.g. GIF/BMP
    // or SVG). Trust the declared/inferred MIME and store as a generic file.
    const mimeType = declaredMimeType || 'application/octet-stream'
    if (!this.options.config.allowedMimeTypes.includes(mimeType)) throw new Error(`MIME type is not allowed: ${mimeType}`)
    if (input.data.byteLength > this.options.config.maxImageBytes) throw new Error(`file exceeds ${this.options.config.maxImageBytes} byte limit`)
    if (input.textFallback) validateTextFallback(input.textFallback, this.options.config)
    const hash = createHash('sha256').update(input.data).digest('hex')
    const id = `att_${hash.slice(0, 24)}`
    return this.persistAttachment({ id, hash, payload: input, mimeType, image: null, textFallback: input.textFallback })
  }

  private async maybeGenerateImageFallback(input: {
    data: Buffer
    sourceMimeType: string
  }): Promise<AttachmentTextFallback | undefined> {
    const transform = this.options.imageTransform ?? defaultSharpImageTransform
    const policy = this.imageFallbackPolicy()
    try {
      const fallback = await transform.generateImageFallback({
        data: input.data,
        sourceMimeType: input.sourceMimeType,
        policy
      })
      if (!fallback) return undefined
      // Validate the generated fallback against the same policy that the
      // consumer enforces — never trust the encoder blindly.
      validateTextFallback(fallback, this.options.config)
      return fallback
    } catch {
      // Sharp failed to decode/encode (corrupt bytes, unsupported codec, ...).
      // We do not fail the upload over a fallback we can't generate: the
      // consumer falls back to inlining the original bytes when they fit.
      return undefined
    }
  }

  private async persistAttachment(input: {
    id: string
    hash: string
    mimeType: string
    image: { mimeType: string; width?: number; height?: number } | null
    textFallback?: AttachmentTextFallback
    payload: { name: string; data: Buffer; threadId?: string; workspace?: string }
  }): Promise<AttachmentMetadata> {
    const contentPath = this.contentPath(input.id)
    const metadataPath = this.metadataPath(input.id)
    const now = this.options.nowIso?.() ?? new Date().toISOString()
    const existing = await this.get(input.id)
    if (existing) {
      const next = mergeScope({
        ...existing,
        ...(input.textFallback ? { textFallback: input.textFallback } : {}),
        updatedAt: now
      }, input.payload)
      await writeFile(contentPath, input.payload.data)
      await writeFile(metadataPath, JSON.stringify(next, null, 2), 'utf8')
      return next
    }
    const metadata: AttachmentMetadata = AttachmentMetadataSchema.parse(mergeScope({
      id: input.id,
      name: input.payload.name,
      mimeType: input.mimeType,
      byteSize: input.payload.data.byteLength,
      hash: input.hash,
      ...(input.image?.width ? { width: input.image.width } : {}),
      ...(input.image?.height ? { height: input.image.height } : {}),
      ...(input.textFallback ? { textFallback: input.textFallback } : {}),
      threadIds: [],
      workspaces: [],
      createdAt: now,
      updatedAt: now
    }, input.payload))
    await writeFile(contentPath, input.payload.data)
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8')
    return metadata
  }

  async get(id: string): Promise<AttachmentMetadata | null> {
    try {
      return AttachmentMetadataSchema.parse(JSON.parse(await readFile(this.metadataPath(id), 'utf8')))
    } catch {
      return null
    }
  }

  async resolveContent(id: string, scope: { threadId?: string; workspace?: string }): Promise<AttachmentContent> {
    const metadata = await this.get(id)
    if (!metadata) throw new Error(`attachment not found: ${id}`)
    if (!isAuthorized(metadata, scope)) throw new Error(`attachment is not authorized for this turn: ${id}`)
    return {
      ...metadata,
      data: await readFile(this.contentPath(id))
    }
  }

  async diagnostics(): Promise<AttachmentDiagnostics> {
    await mkdir(this.options.rootDir, { recursive: true })
    const entries = await readdir(this.options.rootDir).catch(() => [])
    const metadata = await Promise.all(
      entries
        .filter((entry) => entry.endsWith('.json'))
        .map((entry) => readFile(join(this.options.rootDir, entry), 'utf8')
          .then((text) => AttachmentMetadataSchema.parse(JSON.parse(text)))
          .catch(() => null))
    )
    const records = metadata.filter((record): record is AttachmentMetadata => Boolean(record))
    return {
      enabled: this.options.config.enabled,
      rootDir: this.options.rootDir,
      count: records.length,
      totalBytes: records.reduce((total, record) => total + record.byteSize, 0)
    }
  }

  textFallbackPolicy(): Pick<
    AttachmentsCapabilityConfig,
    'textFallbackMaxBase64Bytes' | 'textFallbackMaxImageDimension' | 'textFallbackPreferredMimeType'
  > {
    return {
      textFallbackMaxBase64Bytes: this.options.config.textFallbackMaxBase64Bytes,
      textFallbackMaxImageDimension: this.options.config.textFallbackMaxImageDimension,
      textFallbackPreferredMimeType: this.options.config.textFallbackPreferredMimeType
    }
  }

  imageFallbackPolicy(): Pick<AttachmentsCapabilityConfig, 'textFallbackMaxImageDimension' | 'textFallbackPreferredMimeType'> {
    return {
      textFallbackMaxImageDimension: this.options.config.textFallbackMaxImageDimension,
      textFallbackPreferredMimeType: this.options.config.textFallbackPreferredMimeType
    }
  }

  private contentPath(id: string): string {
    return join(this.options.rootDir, `${id}.bin`)
  }

  private metadataPath(id: string): string {
    return join(this.options.rootDir, `${id}.json`)
  }
}

function mergeScope<T extends AttachmentMetadata>(metadata: T, input: { threadId?: string; workspace?: string }): T {
  return {
    ...metadata,
    threadIds: mergeUnique(metadata.threadIds, input.threadId),
    workspaces: mergeUnique(metadata.workspaces, input.workspace)
  }
}

function mergeUnique(values: string[], value: string | undefined): string[] {
  return value && !values.includes(value) ? [...values, value] : values
}

function isAuthorized(metadata: AttachmentMetadata, scope: { threadId?: string; workspace?: string }): boolean {
  if (metadata.threadIds.length === 0 && metadata.workspaces.length === 0) return true
  if (scope.threadId && metadata.threadIds.includes(scope.threadId)) return true
  if (scope.workspace && metadata.workspaces.includes(scope.workspace)) return true
  return false
}

function validateTextFallback(fallback: AttachmentTextFallback, config: AttachmentsCapabilityConfig): void {
  if (!config.allowedMimeTypes.includes(fallback.mimeType)) {
    throw new Error(`fallback image MIME type is not allowed: ${fallback.mimeType}`)
  }
  if (Buffer.byteLength(fallback.dataBase64, 'utf8') > config.textFallbackMaxBase64Bytes) {
    throw new Error(`fallback image exceeds ${config.textFallbackMaxBase64Bytes} base64 byte limit`)
  }
  const maxDimension = Math.max(fallback.width ?? 0, fallback.height ?? 0)
  if (maxDimension > config.textFallbackMaxImageDimension) {
    throw new Error(`fallback image exceeds ${config.textFallbackMaxImageDimension}px dimension limit`)
  }
}

function detectImage(buffer: Buffer): { mimeType: string; width?: number; height?: number } | null {
  if (buffer.length >= 24 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { mimeType: 'image/png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: 'image/jpeg' }
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { mimeType: 'image/webp' }
  }
  return null
}

/**
 * Map a filename extension to a MIME type for the common non-image attachments
 * the store accepts. Falls back to `application/octet-stream`. Only used when
 * the caller did not declare a MIME type (the browser usually does).
 */
export function mimeTypeFromName(name: string): string {
  const ext = basename(name).split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'png': return 'image/png'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'webp': return 'image/webp'
    case 'gif': return 'image/gif'
    case 'bmp': return 'image/bmp'
    case 'svg': return 'image/svg+xml'
    case 'txt': return 'text/plain'
    case 'md': return 'text/markdown'
    case 'csv': return 'text/csv'
    case 'html': return 'text/html'
    case 'json': return 'application/json'
    case 'pdf': return 'application/pdf'
    case 'zip': return 'application/zip'
    case 'docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case 'xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    case 'pptx': return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    case 'doc': return 'application/msword'
    case 'xls': return 'application/vnd.ms-excel'
    case 'ppt': return 'application/vnd.ms-powerpoint'
    default: return 'application/octet-stream'
  }
}

/**
 * Treat common non-standard / vendor image MIME aliases as compatible so a JPEG
 * labeled `image/jpg` (or vice-versa) does not get rejected as a mismatch.
 */
function isImageAlias(declared: string, detected: string): boolean {
  const normalize = (mime: string) => mime.toLowerCase().replace('image/jpg', 'image/jpeg')
  return normalize(declared) === normalize(detected)
}
