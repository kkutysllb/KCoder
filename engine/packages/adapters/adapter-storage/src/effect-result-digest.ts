import { createHash } from 'node:crypto'

export function effectResultDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  return Object.fromEntries(
    Object.keys(record).sort().map((key) => [key, canonicalize(record[key])])
  )
}
