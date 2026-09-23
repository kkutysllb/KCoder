import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { TurnTailOwnerProps } from './dsh-contracts.ts';
import type { FileReviewRequest, FileReviewResult, ProducedFileReview } from '../change-types.ts';
import type { NS } from './chat-locales.ts';
/**
 * Minimal reactive face of the plugin's conversation snapshot store (the
 * inject side passes its resolveConversationStore result). The snapshot
 * value is opaque here — it only signals that the reviews derivation must
 * re-run; collectReviews resolves the current snapshot itself per call.
 */
export interface ChangesStoreFace {
    getSnapshot(): unknown;
    /**
     * Turn-scoped reactive value: a content fingerprint of ONE turn's review
     * data (conversation-store.turnChangesFingerprint), so a card re-renders
     * only when ITS OWN turn's content moves — not on every session-wide
     * snapshot publication (fresh reference per streaming event). Optional:
     * carriers without it fall back to the raw face snapshot, whose identity
     * churn re-renders more often — harmless now that the inspection effect
     * below is content-gated.
     */
    getTurnSnapshot?(turn: number): unknown;
    subscribe(listener: () => void): () => void;
}
/** Matched produced paths plus the opener and locale supplied by the turn-tail slot. */
export type ProducedFilesProps = Pick<TurnTailOwnerProps, 'openFile' | 'turn'> & {
    /** The built-in deliverables turn data: the turn's produced paths, in order. */
    matched: readonly string[];
    /**
     * Reviews (hunks + deletion state) for the claiming turn, reconstructed
     * from the session snapshot by the slot's inject; the built-in turn data
     * carries paths only. Paths without a review render as hunk-less chips.
     */
    collectReviews?: (turn: number) => readonly ProducedFileReview[];
    /**
     * Reactive face of the plugin's conversation snapshot store. The slot
     * framework caches this entry's inject result per session, so reviews
     * reconstructed through collectReviews are frozen at whatever snapshot
     * was current when the session's FIRST card rendered. Subscribing here
     * re-derives the stats whenever the snapshot reference moves (turn data
     * published after the card mounted); absent on carriers without the
     * uiConversation service.
     */
    changesStore?: ChangesStoreFace | undefined;
    /** Session workspace root (reserved; the chat card shows tool paths verbatim). */
    projectRoot?: string | undefined;
    inspectChanges?: (request: FileReviewRequest) => Promise<FileReviewResult>;
    applyChanges?: (request: FileReviewRequest) => Promise<FileReviewResult>;
    /**
     * Open the plugin's sidebar tab with the given paths pre-expanded
     * (the 审查 button passes every produced path; a file chip passes its own).
     * The owning turn number rides along so the tab expands only this turn's
     * rows — a path that recurs in other turns stays collapsed there.
     */
    openInSidebarTab?: (paths: readonly string[], turn?: number) => void;
    /**
     * Open a non-code artifact (image / media / office / report) through the
     * sidebar's file-viewer pipeline instead of the diff review tab. Falls
     * back to the Host `openFile` (OS default app) when absent.
     */
    openPreview?: (path: string) => void;
} & PropsLocale<typeof NS>;
/**
 * Content key of a host-state inspection input: paths plus hunk counts.
 * Identity-stable across re-derivations — two freshly-allocated arrays with
 * the same files produce the same key, an appended hunk changes it. Exported
 * for the smoke regression checks (the blink fix's core invariant).
 */
export declare function inspectionKey(files: readonly {
    readonly path: string;
    readonly diffs: readonly unknown[];
}[]): string;
/** Render one turn's produced files as a summary card opening the sidebar tab. */
export declare function ProducedFiles({ matched, collectReviews, changesStore, openFile, turn: turnLocation, inspectChanges, applyChanges, openInSidebarTab, openPreview, t, }: ProducedFilesProps): import("react").JSX.Element;
//# sourceMappingURL=ProducedFiles.d.ts.map