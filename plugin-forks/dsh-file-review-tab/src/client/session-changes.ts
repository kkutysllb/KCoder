/**
 * Session-wide produced-file derivation from a finalized ConversationSnapshot.
 * Client-only and model-free: the vocabulary is the mutation tools' OWN
 * arguments (write / edit / str_replace_editor, plus literal rm-family
 * deletions in the terminals), never the closing prose. Since dsh
 * 0.1.2-alpha.1 the finalized ToolResultNode carries no render-intent views,
 * so this is a tool-argument contract derive, aligned with the built-in
 * ui-deliverables vocabulary: it derives EVERY in-window turn's changes from
 * the session snapshot's finalized nodes, attributing each tool result to
 * its owning turn through `turnEnds` (completed turns) or the live turn
 * counters.
 */
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { ProducedFileDiff, RecordedMutation } from '../change-types.ts'
import { deletedPathsFromCommand } from './deleted-paths.ts'
import type { ConversationFace } from './conversation-store.ts'
import { diffsFromBeforeAfter } from './recorded-diffs.ts'

/** One changed file inside one turn, hunks appended in settlement order. */
export interface SessionFileChange {
  readonly path: string
  readonly diffs: readonly ProducedFileDiff[]
  /** Terminal commands deleted this path in this turn (display-only). */
  readonly deleted?: true
}

/** One turn's produced files, in first-seen order. */
export interface TurnFileChanges {
  readonly turn: number
  /** Whether the owning turn is still running (its change set may grow). */
  readonly live: boolean
  readonly files: readonly SessionFileChange[]
}

/** Internal per-path accumulator: hunk list plus the last deletion state. */
interface FileAccumulator {
  diffs: ProducedFileDiff[]
  deleted?: true
}

/**
 * Paths a call reports having created or changed, reconstructed from the
 * call's OWN arguments. Since dsh 0.1.2-alpha.1 the finalized ToolResultNode
 * carries no render-intent views (`callView`/`resultView` are gone — only
 * `call: { name, argsRaw }` remains), and the built-in ui-deliverables
 * vocabulary recognizes mutations by tool-argument contract: `write`,
 * `edit`, and the mutating `str_replace_editor` commands. The hunks below
 * are constructed from those same arguments, which the Host reviewer's
 * locate-and-replace transform consumes unchanged: `edit`/`str_replace`
 * hunks are reversible (unique old-text match), creations render as
 * all-green inserts with no undo (nothing to restore), and `insert` is
 * listed with no hunks (its line-anchor semantics are engine-side).
 */
export function mutationDetail(
  name: string,
  argsRaw: string,
): { path: string; diffs: readonly ProducedFileDiff[] } | null {
  let args: unknown
  try {
    args = JSON.parse(argsRaw) as unknown
  } catch {
    return null
  }
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return null
  const record = args as Record<string, unknown>
  const path = (value: unknown): string | null =>
    typeof value === 'string' && value.trim().length > 0 ? value : null
  switch (name) {
    case 'write': {
      const target = path(record.file_path)
      if (target === null || typeof record.content !== 'string') return null
      return { path: target, diffs: [{ path: target, oldText: null, newText: record.content }] }
    }
    case 'edit': {
      const target = path(record.file_path)
      if (target === null) return null
      if (typeof record.old_string !== 'string' || record.old_string.length === 0
        || typeof record.new_string !== 'string' || record.old_string === record.new_string) return null
      return {
        path: target,
        diffs: [{ path: target, oldText: record.old_string, newText: record.new_string }],
      }
    }
    case 'str_replace_editor': {
      const target = path(record.path)
      if (target === null) return null
      switch (record.command) {
        case 'create':
          return typeof record.file_text === 'string'
            ? { path: target, diffs: [{ path: target, oldText: null, newText: record.file_text }] }
            : null
        case 'str_replace':
          return typeof record.old_str === 'string' && record.old_str.length > 0
            && (record.new_str === undefined || typeof record.new_str === 'string')
            ? {
              path: target,
              diffs: [{
                path: target,
                oldText: record.old_str,
                newText: typeof record.new_str === 'string' ? record.new_str : '',
              }],
            }
            : null
        default:
          // `insert` (and any future command): listed, but without hunks.
          return { path: target, diffs: [] }
      }
    }
    default:
      return null
  }
}

/**
 * Terminal deletion records from one call's raw arguments. Deletions happen
 * in the terminals (`bash` / `pwsh`, whose `command` argument carries the
 * literal line); they surface as hunk-less, non-undoable entries.
 */
export function terminalDeletions(name: string, argsRaw: string): readonly string[] {
  if (name !== 'bash' && name !== 'pwsh') return []
  let args: unknown
  try {
    args = JSON.parse(argsRaw) as unknown
  } catch {
    return []
  }
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return []
  const command = (args as Record<string, unknown>).command
  return typeof command === 'string' ? deletedPathsFromCommand(command) : []
}

/**
 * Attribute an event seq to its owning turn. Completed turns own the seq
 * range up to their `turn/end` seq; anything past the last completed end
 * belongs to the live turn (the in-flight `partial` / running call's turn,
 * or the next turn number when nothing live is observable).
 */
function turnAttribution(snapshot: ConversationSnapshot): (seq: number) => { turn: number; live: boolean } {
  const ends = [...snapshot.turnEnds.entries()].sort((a, b) => a[1] - b[1])
  const liveTurn = snapshot.partial?.turn
    ?? snapshot.runningCalls[0]?.turn
    ?? ((ends.at(-1)?.[0] ?? 0) + 1)
  return (seq: number) => {
    for (const [turn, endSeq] of ends) {
      if (endSeq >= seq) return { turn, live: false }
    }
    return { turn: liveTurn, live: true }
  }
}

/**
 * Session-wide turns from the timeline Location index: every LOADED turn's
 * Definition-owned change set, in turn order — the windowed snapshot derive
 * only ever sees the assembled window, so a session whose editing happened
 * outside the current window derived zero changes (issue #8). The plugin's
 * own `fileReviewChanges` turn data carries complete hunks; the built-in
 * `deliverables` data (paths only) covers turns this plugin's Definition
 * has not seen; and the windowed legacy derive is the last fallback for
 * carriers without a timeline at all. Memoized per published snapshot
 * reference (the badge re-derives on every tab-bar render).
 */
const timelineCache = new WeakMap<object, TurnFileChanges[]>()

export function deriveTimelineChanges(face: ConversationFace | null): TurnFileChanges[] {
  if (face === null) return []
  const timeline = face.timeline
  if (timeline === undefined) return deriveSessionChanges(face.legacy)
  const hit = timelineCache.get(timeline)
  if (hit !== undefined) return hit
  const derived: TurnFileChanges[] = []
  for (const turn of timeline.turnOrder) {
    const location = timeline.turns.get(turn)
    if (location === undefined) continue
    const own = location.data.get('fileReviewChanges') as
      | { files?: readonly { path: string; diffs: readonly ProducedFileDiff[]; deleted?: true }[] }
      | undefined
    let files: SessionFileChange[] | undefined
    if (own?.files !== undefined && own.files.length > 0) {
      files = own.files.map(file => ({
        path: file.path,
        diffs: file.diffs,
        ...(file.deleted === true ? { deleted: true as const } : {}),
      }))
    } else {
      const builtIn = location.data.get('deliverables') as
        | { produced?: readonly { seq: number; path: string }[] }
        | undefined
      if (builtIn?.produced === undefined) continue
      const seen = new Set<string>()
      const paths: string[] = []
      for (const produced of builtIn.produced) {
        if (seen.has(produced.path)) continue
        seen.add(produced.path)
        paths.push(produced.path)
      }
      if (paths.length === 0) continue
      files = paths.map(path => ({ path, diffs: [] }))
    }
    derived.push({ turn, live: location.status === 'open', files })
  }
  timelineCache.set(timeline, derived)
  return derived
}

/** Derive one session's per-turn produced-file changes (uncached core). */
function derive(snapshot: ConversationSnapshot): TurnFileChanges[] {
  const attribute = turnAttribution(snapshot)
  const byTurn = new Map<number, { live: boolean; files: Map<string, FileAccumulator> }>()
  for (const node of snapshot.nodes) {
    if (node.kind !== 'tool-result' || node.isError) continue
    const call = node.call
    if (call === null) continue
    const detail = mutationDetail(call.name, call.argsRaw)
    // dsh has no delete-file tool: deletions happen in the terminals, and a
    // successful terminal call's literal rm-family arguments are the only
    // record of them. They surface as hunk-less, non-undoable entries.
    const deletions = detail === null ? terminalDeletions(call.name, call.argsRaw) : []
    if (detail === null && deletions.length === 0) continue
    const diffs = detail?.diffs ?? []
    const paths = detail !== null ? [detail.path] : []
    const { turn, live } = attribute(node.seq)
    let group = byTurn.get(turn)
    if (group === undefined) {
      group = { live, files: new Map() }
      byTurn.set(turn, group)
    }
    for (const path of paths) {
      const own = diffs.filter(diff => diff.path === path)
      const existing = group.files.get(path)
      if (existing === undefined) group.files.set(path, { diffs: [...own] })
      else {
        existing.diffs.push(...own)
        delete existing.deleted
      }
    }
    for (const path of deletions) {
      const existing = group.files.get(path)
      if (existing === undefined) group.files.set(path, { diffs: [], deleted: true })
      else existing.deleted = true
    }
  }
  return [...byTurn.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([turn, group]) => ({
      turn,
      live: group.live,
      files: [...group.files.entries()].map(([path, own]) => ({
        path,
        diffs: own.diffs,
        ...(own.deleted === true ? { deleted: true as const } : {}),
      })),
    }))
}

/**
 * Snapshot-identity cache: the sidebar badge runs this derivation on every
 * tab-bar render, so the result is memoized per immutable snapshot reference
 * (the session publishes a fresh reference only when content changes).
 */
const cache = new WeakMap<ConversationSnapshot, TurnFileChanges[]>()

/** Derive per-turn produced-file changes for one session snapshot. */
export function deriveSessionChanges(snapshot: ConversationSnapshot | null): TurnFileChanges[] {
  if (snapshot === null) return []
  const hit = cache.get(snapshot)
  if (hit !== undefined) return hit
  const derived = derive(snapshot)
  cache.set(snapshot, derived)
  return derived
}

/**
 * One Code Mode (`run_code`) root visible in the snapshot, with the turn it
 * settles into. Children (`subCalls`) carry no reusable views, so the reset of
 * their review data arrives asynchronously from the Host recorder; these roots
 * are the join keys (the `run_code` `callId` is the dispatch `rootCallId`).
 */
export interface SessionRoot {
  readonly turn: number
  readonly live: boolean
  readonly rootCallId: string
}

/** Every `run_code` tool-result node in the window, in node order. */
export function deriveSessionRoots(snapshot: ConversationSnapshot): SessionRoot[] {
  const attribute = turnAttribution(snapshot)
  const roots: SessionRoot[] = []
  for (const node of snapshot.nodes) {
    if (node.kind !== 'tool-result' || node.isError) continue
    if (node.subCalls.length === 0) continue
    const { turn, live } = attribute(node.seq)
    roots.push({ turn, live, rootCallId: node.callId })
  }
  return roots
}

/**
 * Merge Host-recorded Code Mode mutations into the snapshot-derived turns:
 * hunks rebuilt from the full before/after are appended to the owning turn's
 * file groups (same-path entries stay one row, hunks appended in dispatch
 * order), so the tab's diff rendering, status inspection and undo all work on
 * programmatic edits exactly like model-direct ones. All inputs are immutable;
 * the result is a fresh array only when a recorded mutation matched a visible
 * root.
 */
export function mergeRecordedTurns(
  turns: readonly TurnFileChanges[],
  roots: readonly SessionRoot[],
  recorded: readonly RecordedMutation[],
): readonly TurnFileChanges[] {
  if (recorded.length === 0 || roots.length === 0) return turns
  const rootTurns = new Map<string, { turn: number; live: boolean }>()
  for (const root of roots) rootTurns.set(root.rootCallId, { turn: root.turn, live: root.live })
  const byRoot = new Map<string, RecordedMutation[]>()
  for (const mutation of recorded) {
    const list = byRoot.get(mutation.rootCallId)
    if (list === undefined) byRoot.set(mutation.rootCallId, [mutation])
    else list.push(mutation)
  }
  let matched = false
  for (const root of roots) {
    if (byRoot.has(root.rootCallId)) { matched = true; break }
  }
  if (!matched) return turns

  const groups = new Map<number, { live: boolean; files: Map<string, FileAccumulator> }>()
  for (const turn of turns) {
    const files = new Map<string, FileAccumulator>()
    for (const file of turn.files) {
      files.set(file.path, {
        diffs: [...file.diffs],
        ...(file.deleted === true ? { deleted: true as const } : {}),
      })
    }
    groups.set(turn.turn, { live: turn.live, files })
  }
  for (const [rootCallId, mutations] of byRoot) {
    const owner = rootTurns.get(rootCallId)
    if (owner === undefined) continue
    let group = groups.get(owner.turn)
    if (group === undefined) {
      group = { live: owner.live, files: new Map() }
      groups.set(owner.turn, group)
    }
    for (const mutation of mutations) {
      const diffs = diffsFromBeforeAfter(mutation.path, mutation.before, mutation.after)
      if (diffs.length === 0) continue
      const existing = group.files.get(mutation.path)
      if (existing === undefined) group.files.set(mutation.path, { diffs: [...diffs] })
      else existing.diffs.push(...diffs)
    }
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([turn, group]) => ({
      turn,
      live: group.live,
      files: [...group.files.entries()].map(([path, own]) => ({
        path,
        diffs: own.diffs,
        ...(own.deleted === true ? { deleted: true as const } : {}),
      })),
    }))
}

/** Count distinct changed paths across every turn (the sidebar badge count). */
export function countChangedFiles(turns: readonly TurnFileChanges[]): number {
  const paths = new Set<string>()
  for (const turn of turns) {
    for (const file of turn.files) paths.add(file.path)
  }
  return paths.size
}

/**
 * Turns that stay in the review tab's MAIN list: the newest
 * {@link ARCHIVE_KEEP_TURNS} turns plus every live (still-running) turn.
 * Older completed turns auto-archive to the tab's bottom section (issue #5:
 * long sessions accumulate dozens of diff groups and weigh the page down).
 */
export const ARCHIVE_KEEP_TURNS = 5

/** Archived turns render this many groups per loaded page once the section opens. */
export const ARCHIVE_PAGE_TURNS = 10

/**
 * Debug/demo override for the keep threshold: `?frtArchiveKeep=N` in the app
 * URL forces N (0 archives every completed turn) so the archive UI can be
 * exercised on sessions with few change-bearing turns. Null when absent.
 */
function archiveKeepOverride(): number | null {
  try {
    const param = new URLSearchParams(window.location.search).get('frtArchiveKeep')
    if (param === null) return null
    const value = Number(param)
    if (Number.isInteger(value) && value >= 0) return value
  } catch {
    // Non-browser context (tests): no override.
  }
  return null
}

/** Split turns into the main list and the auto-archived tail (both newest-first). */
export function splitArchivedTurns(
  turns: readonly TurnFileChanges[],
  keep = ARCHIVE_KEEP_TURNS,
): { main: readonly TurnFileChanges[]; archived: readonly TurnFileChanges[] } {
  const effective = archiveKeepOverride() ?? keep
  const descending = [...turns].sort((left, right) => right.turn - left.turn)
  const kept = new Set(descending.slice(0, effective).map(turn => turn.turn))
  const main: TurnFileChanges[] = []
  const archived: TurnFileChanges[] = []
  for (const turn of descending) {
    // A live turn never archives, however old its number is.
    if (turn.live || kept.has(turn.turn)) main.push(turn)
    else archived.push(turn)
  }
  return { main, archived }
}

/** Trailing path segment, the part that identifies the file at a glance. */
export function basename(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}

/** POSIX root, drive-letter, or UNC absolute-path test (separator-agnostic). */
function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || path.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(path)
}

/** Resolve a (possibly relative) tool path against the session cwd. */
export function resolveSessionPath(cwd: string | undefined, path: string): string {
  if (isAbsolutePath(path)) return path
  const base = cwd ?? ''
  if (base === '') return path
  const separator = base.includes('\\') ? '\\' : '/'
  return `${base.replace(/[\\/]+$/, '')}${separator}${path}`
}
