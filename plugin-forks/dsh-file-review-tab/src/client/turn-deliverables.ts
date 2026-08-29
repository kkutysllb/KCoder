/**
 * Turn-tail claim over the HOST deliverables vocabulary. Since dsh
 * 0.1.2-alpha.1 the produced-files row is native: the built-in ui-deliverables
 * plugin owns the `deliverables` Conversation Definition (tool-argument
 * contract: write / edit / str_replace_editor) and publishes each Turn's
 * successful mutation paths on the turn Location data. This plugin registers
 * NO Definition of its own — a second `deliverables` kind would collide with
 * the built-in registration and crash it — and instead claims the tail row
 * with its enhanced card (diff stats, undo, sidebar-tab deep links), reading
 * the built-in paths as the claim input.
 */
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

/**
 * The built-in ui-deliverables turn data face. Paths only, by design — the
 * hunks this card displays come from the sidebar derive (session-changes.ts),
 * reconstructed from the same tool arguments.
 *
 * Read through a string-keyed face on purpose: the @deepseek-ai type
 * releases this plugin builds against still carry the pre-native
 * ConversationTurnDataMap (the old `turn-tail` key), so the map's keyof
 * constraint cannot name the built-in's `deliverables` key. The runtime
 * store is a plain keyed reader; the cast only realigns the type view.
 */
interface DeliverablesTurnData {
  readonly produced: readonly {
    readonly seq: number
    readonly path: string
  }[]
}

/** String-keyed reader face of the turn Location data store. */
interface TurnDataStore {
  get(key: string): unknown
}

/**
 * Files produced by one Turn data value, deduplicated in first-seen order.
 * Mirrors the built-in producedForClosing: the Location index owns turn
 * membership, so paths cannot spill across turns.
 * @param data - engine-published Deliverables data for one Turn.
 * @param seq - closing Assistant seq; later Tool settlements are excluded.
 * @returns Produced paths in first-seen order; empty when the turn wrote nothing.
 */
export function producedPathsForClosing(
  data: Readonly<DeliverablesTurnData> | undefined,
  seq = Number.POSITIVE_INFINITY,
): readonly string[] {
  if (data === undefined) return []
  const paths: string[] = []
  const seen = new Set<string>()
  for (const produced of data.produced) {
    if (produced.seq > seq || seen.has(produced.path)) continue
    seen.add(produced.path)
    paths.push(produced.path)
  }
  return paths
}

/**
 * Claim the turn-tail chain only when its closing turn produced files.
 * Own `fileReviewChanges` turn data first (this plugin's Definition: same
 * vocabulary, complete hunks); the built-in `deliverables` data remains the
 * claim input of last resort for a turn the own Definition has not covered.
 * @param owner - Turn-tail owner currency for the closing assistant.
 * @returns Produced paths as the component's match, or null to decline before mount.
 */
export function selectDeliverablePaths(owner: TurnTailOwnerProps): readonly string[] | null {
  const data = owner.turn.data as unknown as TurnDataStore
  const own = data.get('fileReviewChanges') as
    | { files?: readonly { path: string }[] }
    | undefined
  if (own?.files !== undefined) {
    const paths: string[] = []
    const seen = new Set<string>()
    for (const file of own.files) {
      if (seen.has(file.path)) continue
      seen.add(file.path)
      paths.push(file.path)
    }
    if (paths.length > 0) return paths
  }
  const builtIn = data.get('deliverables') as
    | Readonly<DeliverablesTurnData>
    | undefined
  const paths = producedPathsForClosing(builtIn, owner.seq)
  return paths.length === 0 ? null : paths
}

/** Trailing path segment, the part that identifies the file at a glance. */
export function basename(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}
