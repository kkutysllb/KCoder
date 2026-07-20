import type { AttachmentTextFallback } from '@qiongqi/contracts'

/**
 * MIME types we can decode and re-encode with sharp. Kept in sync with the
 * magic-byte sniff in {@link detectImage}: anything sharp can read that we also
 * want to auto-generate a fallback for. SVG is intentionally excluded — it is
 * a vector format and sharp rasterizes it, which is rarely what the user wants.
 */
export const SHARP_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/tiff', 'image/bmp'] as const

/** Returns true when `mimeType` looks like an image (`image/*`). */
export function isImageMimeType(mimeType: string | undefined): boolean {
  return Boolean(mimeType && mimeType.toLowerCase().startsWith('image/'))
}

export interface ImageFallbackPolicy {
  textFallbackMaxImageDimension: number
  textFallbackPreferredMimeType: string
}

export interface ImageTransform {
  /**
   * Convert raw image bytes into a bounded text fallback. The output is resized
   * so its largest edge does not exceed `policy.textFallbackMaxImageDimension`
   * and re-encoded to `policy.textFallbackPreferredMimeType` (default webp).
   *
   * Returns `null` when the input cannot be decoded (e.g. corrupt or an
   * unsupported format). Callers decide how to handle that case.
   */
  generateImageFallback(input: {
    data: Buffer
    sourceMimeType?: string
    policy: ImageFallbackPolicy
  }): Promise<AttachmentTextFallback | null>
}

/**
 * Default {@link ImageTransform} backed by `sharp`. Imported lazily so the rest
 * of the package does not pay for the native binding unless image fallback
 * generation is actually needed.
 */
export const defaultSharpImageTransform: ImageTransform = {
  async generateImageFallback({ data, sourceMimeType, policy }) {
    // Lazy require keeps sharp out of modules that never touch images.
    const sharp = (await import('sharp')).default
    // Constrain sharp's resource footprint: the embedded runtime is a
    // long-lived process, and libvips defaults to a per-CPU-core thread pool
    // plus an operation cache that never releases. Disabling the cache and
    // capping concurrency keeps the baseline memory/CPU low between uploads.
    configureSharpFootprint(sharp)
    const pipeline = sharp(data, { failOn: 'error' })
    const metadata = await pipeline.metadata().catch(() => null)
    if (!metadata) return null

    const maxDimension = Math.max(0, policy.textFallbackMaxImageDimension)
    const targetFormat = preferredSharpFormat(policy.textFallbackPreferredMimeType)
    const resized = pipeline.resize(
      maxDimension > 0
        ? { width: maxDimension, height: maxDimension, fit: 'inside', withoutEnlargement: true }
        : undefined
    )
    const buffer = await resized.toFormat(targetFormat.format, targetFormat.options).toBuffer()
    const encoded = await sharp(buffer).metadata().catch(() => null)
    return {
      dataBase64: buffer.toString('base64'),
      mimeType: targetFormat.mimeType,
      byteSize: buffer.byteLength,
      ...(encoded?.width ? { width: encoded.width } : {}),
      ...(encoded?.height ? { height: encoded.height } : {}),
      wasCompressed: true
    }
  }
}

function preferredSharpFormat(preferredMimeType: string): {
  format: 'webp' | 'png' | 'jpeg' | 'avif'
  mimeType: string
  options: Record<string, unknown>
} {
  switch (preferredMimeType.toLowerCase()) {
    case 'image/png':
      return { format: 'png', mimeType: 'image/png', options: {} }
    case 'image/jpeg':
      return { format: 'jpeg', mimeType: 'image/jpeg', options: { quality: 80 } }
    case 'image/avif':
      return { format: 'avif', mimeType: 'image/avif', options: { quality: 60 } }
    case 'image/webp':
    default:
      return { format: 'webp', mimeType: 'image/webp', options: { quality: 80 } }
  }
}

/**
 * Cap sharp's resource usage for long-lived embedded processes. Called once
 * after the first lazy import. Idempotent — re-configuring is cheap.
 */
let sharpFootprintConfigured = false
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function configureSharpFootprint(sharp: any): void {
  if (sharpFootprintConfigured) return
  sharpFootprintConfigured = true
  try {
    // Disable libvips' operation cache so decoded images are freed promptly.
    sharp.cache(false)
    // Single-threaded processing: fallback generation is a one-shot resize +
    // encode, not latency-sensitive; avoid spinning up a per-core worker pool.
    sharp.concurrency(1)
  } catch {
    // sharp versions/builds may reject these calls; best-effort.
  }
}
