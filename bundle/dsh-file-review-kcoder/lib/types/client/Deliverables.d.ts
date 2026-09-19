import type { SessionStandardProps } from '@deepseek-ai/dsh-client-ui-slots';
import { type DeliverablesMatch } from './turn-deliverables.ts';
import type { PresentedOpenController } from './present-open.ts';
import type { ReactElement } from 'react';
import { type ProducedFilesProps } from './ProducedFiles.tsx';
/** The wrapper's props: the card's inject face, plus the two-way match. */
export type DeliverablesProps = Omit<ProducedFilesProps, 'matched'> & Pick<SessionStandardProps, 'sessionId'> & {
    /** Changed files and declared deliveries the elected claim matched. */
    matched: DeliverablesMatch;
    /**
     * Native-open controller for declared deliveries. Optional so a carrier
     * without the Host delivery routes still renders the cards with their
     * Sidebar preview intact.
     */
    presentedController?: PresentedOpenController | undefined;
};
/**
 * Render the closing turn's complete deliverables row.
 * @param props - match, inject face, and the Session standard share.
 * @returns the changed-files card, the delivery cards, or both.
 */
/**
 * List-mode turn-tail wrapper (dsh 0.1.6-alpha.2): the slot became a list —
 * no select callback runs before mount, so the claim computation moved here
 * and re-runs on every render. Declines (null) when the turn produced
 * nothing and declared no deliveries; otherwise renders the enhanced card.
 * Structural owner face: the type baseline this plugin builds against
 * predates the list-mode shapes (same recipe as the turn-data reads).
 */
export declare function FileReviewTurnTail(props: DeliverablesProps & {
    readonly turn?: unknown;
    readonly seq?: unknown;
}): ReactElement | null;
export declare function Deliverables({ matched, presentedController, sessionId, ...card }: DeliverablesProps): import("react").JSX.Element;
//# sourceMappingURL=Deliverables.d.ts.map