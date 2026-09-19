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
 *
 * Since dsh 0.1.5-alpha.2 the SAME turn data also carries explicit
 * deliveries: the `present` tool appends `deliverables/presented`, and the
 * built-in Definition publishes them beside `produced` as
 * `presented: [{ path, description?, seq, index }]`. The turn-tail slot is a
 * CHAIN — "the first non-null selector return elects its entry", so exactly
 * one row ever renders — and a claim driven by `produced` alone therefore
 * swallowed the new delivery cards on every turn that both wrote files and
 * called `present`. The claim reads BOTH faces and the row renders both
 * sections: an elected chain entry owns the complete deliverables vocabulary.
 */
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client';
/** One explicitly delivered file with its native-open coordinates. */
export interface PresentedPath {
    /** Original absolute path or path relative to the Session working directory. */
    readonly path: string;
    /** Optional description supplied by the model. */
    readonly description?: string;
    /** Sequence of the `deliverables/presented` event that declared it. */
    readonly seq: number;
    /** Original index of the file inside that event's `files` array. */
    readonly index: number;
}
/** The complete turn-tail match: changed files plus declared deliveries. */
export interface DeliverablesMatch {
    /** Paths of the turn's successful file mutations, first-seen order. */
    readonly produced: readonly string[];
    /** Files the model explicitly declared as final deliverables. */
    readonly presented: readonly PresentedPath[];
}
/**
 * The built-in ui-deliverables turn data face. `produced` is paths only, by
 * design — the hunks this card displays come from the sidebar derive
 * (session-changes.ts), reconstructed from the same tool arguments.
 * `presented` is optional: it exists only on carriers that ship the present
 * tool and its Definition (dsh >= 0.1.5-alpha.2), and a turn that never
 * declared a delivery omits it entirely.
 *
 * Read through a string-keyed face on purpose: the @deepseek-ai type
 * releases this plugin builds against still carry the pre-native
 * ConversationTurnDataMap (the old `turn-tail` key), so the map's keyof
 * constraint cannot name the built-in's `deliverables` key. The runtime
 * store is a plain keyed reader; the cast only realigns the type view.
 */
interface DeliverablesTurnData {
    readonly produced: readonly {
        readonly seq: number;
        readonly path: string;
    }[];
    readonly presented?: readonly PresentedPath[];
}
/**
 * Files produced by one Turn data value, deduplicated in first-seen order.
 * Mirrors the built-in producedForClosing: the Location index owns turn
 * membership, so paths cannot spill across turns.
 * @param data - engine-published Deliverables data for one Turn.
 * @param seq - closing Assistant seq; later Tool settlements are excluded.
 * @returns Produced paths in first-seen order; empty when the turn wrote nothing.
 */
export declare function producedPathsForClosing(data: Readonly<DeliverablesTurnData> | undefined, seq?: number): readonly string[];
/**
 * One accepted delivery declaration. Validation mirrors the built-in
 * `isPresentedFile` / `isPresentedData` pair — path is a non-blank string,
 * description is a string when present, seq and index are usable integers —
 * so a malformed row is dropped instead of rendered as broken coordinates.
 * @param value - one entry of the published `presented` array.
 * @returns whether the entry can address a native open.
 */
export declare function isPresentedPath(value: unknown): value is PresentedPath;
/**
 * Deliveries declared before the closing reply, latest declaration per path.
 * Mirrors the built-in presentedForClosing: a Map keyed by path keeps the
 * first-seen insertion position while a later `present` call replaces the
 * value, so the row's order is stable and its description is the freshest
 * one. Deliveries settled at or after the closing Assistant belong to a later
 * reply and are excluded.
 * @param data - engine-published Deliverables data for one Turn.
 * @param seq - closing Assistant seq.
 * @returns Replayable deliveries in first-seen path order.
 */
export declare function presentedForClosing(data: Readonly<DeliverablesTurnData> | undefined, seq?: number): readonly PresentedPath[];
/**
 * Claim the turn-tail chain whenever its closing turn produced files OR
 * declared deliveries. Own `fileReviewChanges` turn data comes first (this
 * plugin's Definition: same vocabulary, complete hunks); the built-in
 * `deliverables` data remains the claim input of last resort for a turn the
 * own Definition has not covered.
 *
 * Claiming deliveries-only turns too is required, not cosmetic: the chain
 * elects the FIRST non-null selector, so declining would hand that turn to
 * the built-in `Deliverables` row and the same feature would render two
 * different ways across turns. An elected entry owns the whole row.
 * @param owner - Turn-tail owner currency for the closing assistant.
 * @returns Produced paths and declared deliveries as the component's match,
 *   or null to decline before mount.
 */
export declare function selectDeliverables(owner: TurnTailOwnerProps): DeliverablesMatch | null;
/** Trailing path segment, the part that identifies the file at a glance. */
export declare function basename(path: string): string;
/**
 * Uppercase extension of a basename, or an empty string when it has none.
 * The card's secondary line when the model supplied no description.
 * @param name - trailing path segment.
 * @returns Extension without its dot, uppercased.
 */
export declare function extensionOf(name: string): string;
/**
 * Drop a trailing parenthesized aside from a model-supplied description —
 * the built-in card applies the same rule, so the row's renderings agree.
 * @param description - raw description, possibly undefined.
 * @returns Trimmed description, or undefined when nothing is left.
 */
export declare function cleanDescription(description: string | undefined): string | undefined;
export {};
//# sourceMappingURL=turn-deliverables.d.ts.map