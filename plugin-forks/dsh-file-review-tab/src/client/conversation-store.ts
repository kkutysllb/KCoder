/**
 * Conversation snapshot store resolution for one session. Since dsh
 * 0.1.2-alpha.1 the controller Session object's snapshot is queue/control-
 * plane state only (no `nodes`/`turnEnds`), and the uiConversation binding's
 * own snapshot is the view-assembly state (`views`/`activeTargets`) — the
 * transcript snapshot lives on the binding's `chat` TARGET source
 * (ConversationViewSnapshotMap['chat'], as consumed by ui-chat itself via
 * `binding(b).target('chat')`). Resolved dynamically — never a static
 * inject — so the plugin keeps mounting on carriers lacking the service,
 * mirroring resolveConversationEvents' policy.
 *
 * The resolved face re-exposes BOTH slices the plugin consumes: the
 * windowed `legacy` transcript slice (nodes/turnEnds — the ONLY face older
 * carriers publish) and the `timeline` Location index (turnOrder + per-turn
 * Location data), which carries Definition-owned turn data for EVERY loaded
 * turn — the session-wide source a windowed transcript cannot provide (a
 * bottom-anchored window derives zero changes, issue #8). Both faces are
 * structural: the plugin builds against @deepseek-ai type releases that
 * predate either shape.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'

/**
 * Structural face of the per-session chat snapshot source: the
 * ObservableSnapshot pair consumed by useSyncExternalStore and the badge
 * fingerprint, with the target source's transient `undefined` normalized to
 * null. Typed structurally so the plugin builds against older @deepseek-ai
 * type releases that predate the service.
 */
/** Per-turn Location data reader face (string-keyed on purpose — see
 * turn-deliverables.ts: the built-against type releases predate the map's
 * keys). */
export interface TurnDataFace {
  get(key: string): unknown
}

/** Structural face of the chat target's timeline (Location index over every
 * loaded turn; undefined on carriers that predate the incremental Chat
 * publication). */
export interface TimelineFace {
  readonly turnOrder: readonly number[]
  readonly turns: ReadonlyMap<number, {
    readonly turn: number
    readonly status: 'open' | 'closed' | 'unknown'
    readonly data: TurnDataFace
  }>
}

/** What the plugin consumes from one published chat snapshot. */
export interface ConversationFace {
  /** Windowed transcript slice (the only face pre-timeline carriers publish). */
  readonly legacy: ConversationSnapshot
  /** Location index over EVERY loaded turn; undefined on older carriers. */
  readonly timeline: TimelineFace | undefined
}

export interface ConversationStore {
  getSnapshot(): ConversationFace | null
  subscribe(listener: () => void): () => void
}

/** Read a service without the inject requirement (ctx.get, then reflect). */
function lookupService(ctx: Context, name: string): unknown {
  const anyCtx = ctx as unknown as { get?: (name: string) => unknown }
  if (typeof anyCtx.get === 'function') return anyCtx.get(name)
  return ctx.reflect.get(name)
}

/**
 * Resolve the chat-view snapshot store for one session, or undefined when the
 * carrier provides no uiConversation service (or the session has no binding).
 * The returned store is identity-stable per session, so callers may hold it
 * across renders.
 */
export function resolveConversationStore(ctx: Context, sessionId: string): ConversationStore | undefined {
  const service = lookupService(ctx, 'uiConversation') as
    | {
        binding?: (source: string) => {
          target?: (name: string) => {
            getSnapshot(): unknown
            subscribe(listener: () => void): () => void
          } | undefined
        } | undefined
      }
    | undefined
  if (service === undefined || typeof service.binding !== 'function') return undefined
  try {
    const source = service.binding(sessionId)?.target?.('chat')
    if (source === undefined) return undefined
    // The target source publishes undefined until the chat view assembles;
    // normalize once here so every consumer can rely on snapshot-or-null.
    // Since the incremental ChatSnapshot publication the transcript fields
    // (nodes/turnEnds/turnTimings/partial/runningCalls) live on the
    // compatibility `legacy` slice; older carriers published them at the top
    // level — prefer the slice, fall back to the raw snapshot.
    //
    // useSyncExternalStore compares getSnapshot() results with Object.is on
    // EVERY render — returning a freshly-built face object each call reads as
    // "changed forever" and spins React into the #185 maximum-update-depth
    // loop (the 0.5.2 crash). Cache the face keyed on the underlying snapshot
    // reference: the source only swaps that reference on real publication.
    let seen = false
    let cachedSnap: unknown
    let cachedFace: ConversationFace | null = null
    return {
      getSnapshot: () => {
        const snap = source.getSnapshot() as
          | { legacy?: ConversationSnapshot | null; timeline?: TimelineFace }
          | ConversationSnapshot
          | null
          | undefined
        if (seen && snap === cachedSnap) return cachedFace
        let face: ConversationFace | null
        if (snap === undefined || snap === null) face = null
        else if ('legacy' in snap && snap.legacy !== undefined && snap.legacy !== null) {
          face = { legacy: snap.legacy, timeline: snap.timeline }
        }
        // Older carriers publish the transcript at the top level, without a
        // timeline — consumers degrade to the windowed derive.
        else face = { legacy: snap as ConversationSnapshot, timeline: undefined }
        seen = true
        cachedSnap = snap
        cachedFace = face
        return face
      },
      subscribe: (listener) => source.subscribe(listener),
    }
  } catch {
    // Unknown session ids throw; degrade to "no snapshot" (badge hides, tab
    // renders empty) instead of crashing the sidebar tab strip.
    return undefined
  }
}
