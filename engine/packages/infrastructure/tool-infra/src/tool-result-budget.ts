import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export type ToolResultBudgetInput = {
  toolName: string
  content: string
  outputDir: string
  maxInlineBytes?: number
  previewHeadBytes?: number
  previewTailBytes?: number
}

export type ToolResultBudgetApplied = {
  externalized: boolean
  toolName: string
  modelVisibleText: string
  originalBytes: number
  omittedBytes: number
  persistedPath?: string
}

const DEFAULT_MAX_INLINE_BYTES = 64 * 1024
const DEFAULT_PREVIEW_HEAD_BYTES = 4 * 1024
const DEFAULT_PREVIEW_TAIL_BYTES = 4 * 1024

export async function applyToolResultBudget(input: ToolResultBudgetInput): Promise<ToolResultBudgetApplied> {
  const maxInlineBytes = positiveInt(input.maxInlineBytes, DEFAULT_MAX_INLINE_BYTES)
  const originalBytes = Buffer.byteLength(input.content, 'utf8')
  if (originalBytes <= maxInlineBytes) {
    return {
      externalized: false,
      toolName: input.toolName,
      modelVisibleText: input.content,
      originalBytes,
      omittedBytes: 0
    }
  }

  const previewHeadBytes = positiveInt(input.previewHeadBytes, DEFAULT_PREVIEW_HEAD_BYTES)
  const previewTailBytes = positiveInt(input.previewTailBytes, DEFAULT_PREVIEW_TAIL_BYTES)
  const head = utf8ByteSlice(input.content, 0, previewHeadBytes)
  const tail = utf8ByteSlice(input.content, Math.max(0, originalBytes - previewTailBytes), originalBytes)
  const omittedBytes = Math.max(0, originalBytes - Buffer.byteLength(head, 'utf8') - Buffer.byteLength(tail, 'utf8'))
  const filename = `${safeToolName(input.toolName)}-${Date.now()}-${randomUUID().slice(0, 8)}.txt`
  const persistedPath = join(input.outputDir, filename)

  try {
    await mkdir(input.outputDir, { recursive: true })
    await writeFile(persistedPath, input.content, 'utf8')
    return {
      externalized: true,
      toolName: input.toolName,
      modelVisibleText: formatPreview({
        persistedPath,
        originalBytes,
        omittedBytes,
        head,
        tail
      }),
      originalBytes,
      omittedBytes,
      persistedPath
    }
  } catch {
    return {
      externalized: true,
      toolName: input.toolName,
      modelVisibleText: formatPreview({
        originalBytes,
        omittedBytes,
        head,
        tail
      }),
      originalBytes,
      omittedBytes
    }
  }
}

function positiveInt(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback
}

function safeToolName(toolName: string): string {
  const safe = toolName.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return safe || 'tool'
}

function utf8ByteSlice(text: string, startByte: number, endByte: number): string {
  return Buffer.from(text, 'utf8').subarray(startByte, endByte).toString('utf8')
}

function formatPreview(input: {
  persistedPath?: string
  originalBytes: number
  omittedBytes: number
  head: string
  tail: string
}): string {
  const pathLine = input.persistedPath ? `Full output: ${input.persistedPath}\n` : ''
  return [
    `[tool output omitted: ${input.omittedBytes} of ${input.originalBytes} bytes hidden]`,
    pathLine.trimEnd(),
    '--- head ---',
    input.head,
    '--- tail ---',
    input.tail
  ].filter((part) => part.length > 0).join('\n')
}
