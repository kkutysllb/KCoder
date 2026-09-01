/**
 * The plugin's own Conversation Definition (`fileReviewChanges`): the
 * built-in `deliverables` vocabulary (successful root-call `write` / `edit`
 * / mutating `str_replace_editor` — Code Dispatch children never enter a
 * Definition independently) accumulated per Turn from the event stream with
 * COMPLETE hunks instead of paths alone. Registered on the uiConversation
 * event registry (resolved dynamically in apply(), issue #6 policy), it
 * publishes turn Location data for EVERY loaded turn — the session-wide
 * source the windowed snapshot derive cannot cover (a bottom-anchored
 * window derives zero changes, issue #8). The kind differs from the
 * built-in's on purpose: a second `deliverables` registration would collide
 * with and crash the registry, and the Location data store rejects a
 * foreign writer of the same key.
 *
 * Every face here is structural on purpose: the @deepseek-ai type releases
 * this plugin builds against predate the Conversation Definition engine.
 * The append-origin gate mirrors the engine's `isAppendSurfaceEvent`
 * (replacement copies stay model-only and never belong in a transcript).
 */
import type { ProducedFileDiff } from '../change-types.ts';
/** One Conversation engine event, narrowed to what the matchers consume. */
interface DefinitionEvent {
    readonly type: string;
    readonly seq: number;
    /** `'append'` on durable-transcript events; replacements are model-only. */
    readonly surfaceOp?: unknown;
    readonly data: {
        readonly turn?: unknown;
        readonly callId?: unknown;
        readonly name?: unknown;
        /** Model-produced JSON arguments (exactly the projection's argsRaw). */
        readonly arguments?: unknown;
        readonly message?: {
            readonly content?: readonly {
                readonly isError?: unknown;
            }[];
            readonly source?: {
                readonly callId?: unknown;
            };
        };
    };
}
/** What one observed `tool/call` contributes until its result settles. */
type CallRecord = {
    readonly kind: 'mutation';
    readonly path: string;
    readonly hunks: readonly ProducedFileDiff[];
} | {
    readonly kind: 'deletion';
    readonly paths: readonly string[];
} | null;
/** Per-turn accumulator state (immutable updates, engine-reduced). */
interface FileReviewState {
    readonly turn: number;
    readonly calls: ReadonlyMap<string, CallRecord>;
    readonly files: ReadonlyMap<string, {
        diffs: ProducedFileDiff[];
        deleted?: true;
    }>;
}
/** Structural face of the engine's Definition contract (kind-unique keyed). */
export interface ConversationNodeDefinitionLike {
    readonly kind: string;
    match(event: DefinitionEvent): {
        id: string;
        role: 'start' | 'update';
    } | null;
    start(context: unknown, match: {
        event: DefinitionEvent;
    }): FileReviewState;
    update(context: {
        readonly state: FileReviewState;
    }, match: {
        event: DefinitionEvent;
    }): FileReviewState;
    buildLocationData(context: {
        readonly state: FileReviewState | undefined;
    }, scope: string): {
        kind: 'turn';
        turn: number;
        key: string;
        value: unknown;
    } | null;
}
/**
 * Per-Turn produced-file facts for one loaded turn, published as turn
 * Location data: complete files (paths + reversible hunks + deletion state)
 * keyed `fileReviewChanges`, consumed session-wide by the sidebar tab, the
 * badge and the turn-tail card's reviews.
 */
export declare const fileReviewDefinition: ConversationNodeDefinitionLike;
export {};
//# sourceMappingURL=definition.d.ts.map