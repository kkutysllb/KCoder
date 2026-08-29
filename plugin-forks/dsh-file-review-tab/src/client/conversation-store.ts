/**
 * Conversation snapshot store resolution for one session. Since dsh
 * 0.1.2-alpha.1 the controller Session object's snapshot is queue/control-
 * plane state only (no `nodes`/`turnEnds`), and the uiConversation binding's
 * own snapshot is the view-assembly state (`views`/`activeTargets`) — the
 * transcript snapshot lives on the binding's `chat` TARGET source
 * (ConversationViewSnapshotMap['chat']: nodes + turnEnds, as consumed by
 * ui-chat itself via `binding(b).target('chat')`). Resolved dynamically —
 * never a static inject — so the plugin keeps mounting on carriers lacking
 * the service, mirroring resolveConversationEvents' policy.
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
export interface ConversationStore {
  getSnapshot(): ConversationSnapshot | null
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
    return {
      getSnapshot: () => {
        const snap = source.getSnapshot() as
          | { legacy?: ConversationSnapshot | null }
          | ConversationSnapshot
          | null
          | undefined
        if (snap === undefined || snap === null) return null
        return (('legacy' in snap ? snap.legacy : snap) ?? snap) as ConversationSnapshot | null
      },
      subscribe: (listener) => source.subscribe(listener),
    }
  } catch {
    // Unknown session ids throw; degrade to "no snapshot" (badge hides, tab
    // renders empty) instead of crashing the sidebar tab strip.
    return undefined
  }
}
