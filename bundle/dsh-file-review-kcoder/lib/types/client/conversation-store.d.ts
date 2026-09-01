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
import type { Context } from '@deepseek-ai/cordis';
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client';
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
    get(key: string): unknown;
}
/** Structural face of the chat target's timeline (Location index over every
 * loaded turn; undefined on carriers that predate the incremental Chat
 * publication). */
export interface TimelineFace {
    readonly turnOrder: readonly number[];
    readonly turns: ReadonlyMap<number, {
        readonly turn: number;
        readonly status: 'open' | 'closed' | 'unknown';
        readonly data: TurnDataFace;
    }>;
}
/** What the plugin consumes from one published chat snapshot. */
export interface ConversationFace {
    /** Windowed transcript slice (the only face pre-timeline carriers publish). */
    readonly legacy: ConversationSnapshot;
    /** Location index over EVERY loaded turn; undefined on older carriers. */
    readonly timeline: TimelineFace | undefined;
}
export interface ConversationStore {
    getSnapshot(): ConversationFace | null;
    subscribe(listener: () => void): () => void;
}
/**
 * Resolve the chat-view snapshot store for one session, or undefined when the
 * carrier provides no uiConversation service (or the session has no binding).
 * The returned store is identity-stable per session, so callers may hold it
 * across renders.
 */
export declare function resolveConversationStore(ctx: Context, sessionId: string): ConversationStore | undefined;
//# sourceMappingURL=conversation-store.d.ts.map