export function deriveThreadTitle(prompt: string): string {
  const normalized = prompt
    .replace(/\s+/g, ' ')
    .replace(/^[#>*\-\s]+/, '')
    .trim()
  if (!normalized) return 'New chat'
  return normalized.length > 48 ? `${normalized.slice(0, 48).trimEnd()}...` : normalized
}

export function isDefaultThreadTitle(title: string | undefined): boolean {
  const normalized = title?.trim().toLowerCase()
  return !normalized || normalized === 'new chat' || normalized === 'untitled' || normalized === '未命名'
}
