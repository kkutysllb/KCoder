/**
 * Non-code produced-file vocabulary: kind classification by extension and
 * conservative bash/pwsh artifact capture. The turn-tail card and the sidebar
 * tab route these paths to dsh-coding-sidebar's file-viewer pipeline
 * (`betterSidebar.openFile` → editor tab → matchFileViewer: image / pdf /
 * markdown / html built-ins, office/video via its viewer plugins) instead of
 * the diff review — an image or a .docx has no reversible text hunks to show.
 *
 * Capture is deliberately CONSERVATIVE: only well-known artifact extensions
 * behind unambiguous shell output indicators (redirects, curl/wget output
 * flags, cp/mv final argument, tee). Plain code commands never match, so the
 * change lists cannot fill with false positives.
 */

/** Non-code artifact classes the review surfaces can badge and preview. */
export type ArtifactKind = 'image' | 'video' | 'audio' | 'office' | 'pdf' | 'doc'

/** Extensions (lowercase, no dot) per artifact class. */
const KIND_EXTS: Readonly<Record<ArtifactKind, readonly string[]>> = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'tiff', 'tif'],
  video: ['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'mpg', 'mpeg', 'wmv', 'flv'],
  audio: ['mp3', 'wav', 'm4a', 'ogg', 'oga', 'flac', 'aac', 'opus', 'wma'],
  office: ['docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt', 'odt', 'ods', 'odp'],
  pdf: ['pdf'],
  doc: ['md', 'markdown', 'html', 'htm'],
}

const EXT_TO_KIND = new Map<string, ArtifactKind>()
for (const [kind, exts] of Object.entries(KIND_EXTS) as readonly [ArtifactKind, readonly string[]][]) {
  for (const ext of exts) EXT_TO_KIND.set(ext, kind)
}

/** Trailing path segment after the last dot, lowercased ('' when none). */
function extensionOf(path: string): string {
  const at = path.lastIndexOf('.')
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (at === -1 || at < slash) return ''
  return path.slice(at + 1).toLowerCase()
}

/**
 * Classify a produced path. Returns 'code' for everything that is not a
 * known artifact extension — the caller keeps the diff-review behavior for
 * 'code' unchanged.
 */
export function classifyPath(path: string): ArtifactKind | 'code' {
  return EXT_TO_KIND.get(extensionOf(path)) ?? 'code'
}

/** One artifact path a captured shell command is judged to create. */
export interface CapturedArtifact {
  readonly path: string
  readonly artifact: ArtifactKind
}

/**
 * Shell output targets: one capture group around a quoted or bare token.
 * Quoted tokens may contain spaces (that is what the quotes are for); bare
 * tokens stay shell-delimiter-exclusive. Shared by every indicator pattern
 * so matches decode uniformly.
 */
const TARGET = String.raw`("[^"]+"|'[^']+'|[^\s"'><|;&]+)`

/** Output indicators worth scanning (global, flag case-insensitive). */
const INDICATORS: readonly RegExp[] = [
  // Shell redirects: `> out.png`, `>> log.md` (an optional leading fd digit
  // is consumed and the target still lands in the single group).
  new RegExp(String.raw`(?:^|[\s;|&])(?:\d)?>>?\s*${TARGET}`, 'g'),
  // curl / wget output flags.
  new RegExp(String.raw`(?:^|\s)(?:--output(?:=|\s+)|--output-document(?:=|\s+)|-o\s+|-O\s+)${TARGET}`, 'gi'),
  // cp / mv: only the FINAL argument of a segment can be a creation.
  new RegExp(String.raw`(?:^|\s)(?:cp|mv)\s[^;|&]*?\s${TARGET}\s*(?=$|[;|&])`, 'gi'),
  // tee (its whole point is writing a file).
  new RegExp(String.raw`(?:^|\s)tee\s+(?:-a\s+)?${TARGET}`, 'g'),
]

/** Decode the single capture group: strip one layer of quotes. */
function decodeTarget(match: RegExpExecArray): string {
  const raw = match[1] ?? ''
  const quoted = raw.length >= 2
    && ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))
  return quoted ? raw.slice(1, -1) : raw
}

/**
 * Artifact files one mutation-tool call creates, judged from its OWN
 * arguments — the same argument-contract philosophy as mutationDetail, with
 * a much tighter net: the tool must be a shell, and every candidate target
 * must carry a known artifact extension. Order is first-seen; duplicates
 * collapse.
 */
export function captureArtifacts(name: string, argsRaw: string): readonly CapturedArtifact[] {
  if (name !== 'bash' && name !== 'pwsh') return []
  let args: unknown
  try {
    args = JSON.parse(argsRaw) as unknown
  } catch {
    return []
  }
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return []
  const command = (args as Record<string, unknown>).command
  if (typeof command !== 'string' || command === '') return []
  const found = new Map<string, ArtifactKind>()
  for (const pattern of INDICATORS) {
    pattern.lastIndex = 0
    let match = pattern.exec(command)
    while (match !== null) {
      const target = decodeTarget(match)
      const kind = EXT_TO_KIND.get(extensionOf(target))
      if (kind !== undefined && !found.has(target)) found.set(target, kind)
      match = pattern.exec(command)
    }
  }
  return [...found].map(([path, artifact]) => ({ path, artifact }))
}
