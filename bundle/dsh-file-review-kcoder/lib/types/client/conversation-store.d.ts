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
 * structural: the windowed slice's owning package (ui-chat) is outside this
 * plugin's type baseline, and the plugin must keep assembling against carriers
 * that predate the incremental Chat publication — see dsh-contracts.ts.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { WindowedTranscriptFace } from './dsh-contracts.ts';
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
    readonly legacy: WindowedTranscriptFace;
    /** Location index over EVERY loaded turn; undefined on older carriers. */
    readonly timeline: TimelineFace | undefined;
}
export interface ConversationStore {
    getSnapshot(): ConversationFace | null;
    subscribe(listener: () => void): () => void;
}
/**
 * Turn-scoped content fingerprint for the turn-tail card's reactive
 * subscription. The session chat source publishes a fresh snapshot reference
 * per streaming event (token flushes, per-event Definition republications —
 * see index.tsx badgeCount), so a subscription keyed on the face reference
 * re-rendered every mounted card non-stop while ANY turn ran, and the card's
 * identity-keyed inspection effect turned that churn into a disabled-state
 * flicker on the 撤销 button (statusPending true → host status RPC → false,
 * per publication). This fingerprint instead moves only when ONE turn's
 * review content moves: the own Definition data signature (paths + hunk
 * counts + deletion flags — the engine APPENDS hunks, definition.ts update(),
 * so counts are monotonic and faithful) plus the built-in deliverables
 * fallback signature (the derive falls back to it when own data has no
 * files, session-changes.deriveTimelineChanges). A string on purpose:
 * recomputation stays Object.is-stable for useSyncExternalStore.
 * @param face - resolved conversation face (null before the view assembles).
 * @param turn - the card's owning turn number.
 * @returns Content signature; equal across content-preserving republications.
 */
export declare function turnChangesFingerprint(face: ConversationFace | null, turn: number): string;
/**
 * Resolve the chat-view snapshot store for one session, or undefined when the
 * carrier provides no uiConversation service (or the session has no binding).
 * The returned store is identity-stable per session, so callers may hold it
 * across renders.
 */
export declare function resolveConversationStore(ctx: Context, sessionId: string): ConversationStore | undefined;
//# sourceMappingURL=conversation-store.d.ts.map