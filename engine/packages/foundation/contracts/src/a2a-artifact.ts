import { z } from 'zod'
import type { TurnItem } from './items.js'

/**
 * Stage 4: A2A protocol Artifact types.
 *
 * An Artifact is the standard A2A output format — a structured
 * payload produced by a peer agent. Qiongqi maps turn items onto
 * artifacts so A2A consumers receive them in protocol-compliant form.
 */

export const ArtifactMimeType = z.enum([
  'text/plain',
  'text/markdown',
  'application/json',
  'application/octet-stream'
])
export type ArtifactMimeType = z.infer<typeof ArtifactMimeType>

/**
 * An A2A Artifact — a single output piece from an agent turn.
 */
export const ArtifactSchema = z.object({
  /** Unique artifact id. */
  id: z.string().min(1),
  /** MIME type of the artifact content. */
  mimeType: ArtifactMimeType.default('text/plain'),
  /** Human-readable label. */
  label: z.string().optional(),
  /** Artifact content as a string (for text types). */
  text: z.string().optional(),
  /** Artifact content as base64 (for binary types). */
  data: z.string().optional(),
  /** Metadata tags. */
  tags: z.array(z.string().min(1)).default([]),
  /** Whether this artifact represents an error. */
  isError: z.boolean().default(false)
}).strict()
export type Artifact = z.infer<typeof ArtifactSchema>

/**
 * Map Qiongqi TurnItems into A2A Artifacts.
 *
 * Each assistant_text item becomes a text/markdown artifact,
 * each tool_result becomes an application/json artifact,
 * and each error item becomes a text/plain error artifact.
 */
export function mapItemsToArtifacts(items: readonly TurnItem[]): Artifact[] {
  const artifacts: Artifact[] = []
  let seq = 0
  for (const item of items) {
    if (item.kind === 'assistant_text' && item.text) {
      artifacts.push(
        ArtifactSchema.parse({
          id: `${item.id}-text`,
          mimeType: 'text/markdown' as const,
          text: item.text,
          tags: ['assistant_text']
        })
      )
    } else if (item.kind === 'tool_result') {
      artifacts.push(
        ArtifactSchema.parse({
          id: `${item.id}-result`,
          mimeType: 'application/json' as const,
          text: safeStringify(item.output),
          tags: ['tool_result', item.toolName ?? 'unknown'],
          ...(item.isError ? { isError: true } : {})
        })
      )
    } else if (item.kind === 'error') {
      artifacts.push(
        ArtifactSchema.parse({
          id: `${item.id}-error`,
          mimeType: 'text/plain' as const,
          text: item.message,
          isError: true,
          tags: ['error']
        })
      )
    }
    seq++
  }
  return artifacts
}

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value
  try { return JSON.stringify(value) } catch { return String(value) }
}
