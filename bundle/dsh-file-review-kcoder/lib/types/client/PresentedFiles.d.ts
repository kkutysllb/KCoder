import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { FileActionsRenderFace } from './dsh-contracts.ts';
import { type PresentedPath } from './turn-deliverables.ts';
import { type PresentedOpenController } from './present-open.ts';
import type { NS } from './chat-locales.ts';
/** Props supplied by the plugin's slot registration. */
export type PresentedFilesProps = {
    /** Deliveries the closing turn declared, in first-seen path order. */
    files: readonly PresentedPath[];
    /** Viewed Session; addresses the Host's authenticated native-open route. */
    sessionId: string;
    /** Session workspace root, used for the card's full-path title. */
    projectRoot?: string | undefined;
    /** Open the file in the Sidebar viewer pipeline (Host opener as fallback). */
    onPreview: (path: string) => void;
    /** Native-open controller; absent on carriers without the delivery routes. */
    controller?: PresentedOpenController | undefined;
    /**
     * Bound render face of the `deliverables.file.actions` child slot this
     * plugin's turn-tail registration declares (dsh 0.1.7), narrowed to the one
     * key it may render. Absent on carriers without the renderer-owned child
     * slots — and on a registration that had to fall back to declaring no
     * children (see index.tsx) — where the card keeps its own control only.
     */
    renderSlot?: FileActionsRenderFace | undefined;
} & PropsLocale<typeof NS>;
/**
 * The closing turn's explicit deliveries.
 * @param props - deliveries, Session scope, preview route, and native controller.
 * @returns the delivery section, or null when the turn declared none.
 */
export declare function PresentedFiles({ files, sessionId, projectRoot, onPreview, controller, renderSlot, t, }: PresentedFilesProps): import("react").JSX.Element | null;
//# sourceMappingURL=PresentedFiles.d.ts.map