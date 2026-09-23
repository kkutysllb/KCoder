// Deliverables: the elected turn-tail row.
//
// The 'conversation.chat.turnTail' slot is a CHAIN: the first entry whose
// `select` returns non-null renders, and it alone owns the row. This plugin
// registers at priority -2 so its review card wins over dsh-coding-sidebar's
// -1 chip row and the built-in ui-deliverables row at 0 — which means the
// elected component must render EVERY section the vanilla row would have
// rendered, or the sections it does not render disappear from the chat:
//
//   1. "Files changed"  → ProducedFiles (this plugin's enhanced card: diff
//      stats, Undo/Reapply, Sidebar-tab deep links, artifact previews).
//   2. explicit deliveries → PresentedFiles (dsh's `present` tool cards).
//
// Section 2 is why this wrapper exists. dsh 0.1.5-alpha.2 added the `present`
// tool and the delivery cards to the built-in row; a claim keyed on changed
// files alone swallowed them on every turn that both wrote files and declared
// deliveries, which is the documented flow ("call present after writing it").

import type { SessionStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { selectDeliverables, type DeliverablesMatch } from './turn-deliverables.ts'
import type { PresentedOpenController } from './present-open.ts'
import type { FileActionsRenderFace } from './dsh-contracts.ts'
import type { ReactElement } from 'react'
import { PresentedFiles } from './PresentedFiles.tsx'
import { ProducedFiles, type ProducedFilesProps } from './ProducedFiles.tsx'

/** The wrapper's props: the card's inject face, plus the two-way match. */
export type DeliverablesProps =
  & Omit<ProducedFilesProps, 'matched'>
  & Pick<SessionStandardProps, 'sessionId'>
  & {
    /** Changed files and declared deliveries the elected claim matched. */
    matched: DeliverablesMatch
    /**
     * Native-open controller for declared deliveries. Optional so a carrier
     * without the Host delivery routes still renders the cards with their
     * Sidebar preview intact.
     */
    presentedController?: PresentedOpenController | undefined
    /**
     * Whether THIS registration declared the shared `deliverables.file.actions`
     * child slot (inject face, set by index.tsx). Rendering an undeclared child
     * key throws inside the renderer's bound `renderSlot`, so the card only
     * calls it when the declaration actually landed.
     */
    fileActionsSlot?: boolean | undefined
    /**
     * Bound render face of the delivered files' action slot, handed down from
     * the turn-tail registration (see PresentedFiles).
     */
    renderSlot?: FileActionsRenderFace | undefined
  }

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
export function FileReviewTurnTail(props: DeliverablesProps & {
  readonly turn?: unknown
  readonly seq?: unknown
}): ReactElement | null {
  const owner = props as unknown as Parameters<typeof selectDeliverables>[0]
  const matched = selectDeliverables(owner)
  if (matched === null) return null
  return <Deliverables {...props} matched={matched} />
}

export function Deliverables({
  matched, presentedController, sessionId, fileActionsSlot, renderSlot, ...card
}: DeliverablesProps) {
  const { produced, presented } = matched
  return (
    <>
      {produced.length > 0 && <ProducedFiles matched={produced} {...card} />}
      {presented.length > 0 && (
        <PresentedFiles
          files={presented}
          sessionId={sessionId}
          projectRoot={card.projectRoot}
          onPreview={card.openPreview ?? card.openFile}
          controller={presentedController}
          // Both conditions matter: the renderer's face exists (0.1.7+) AND
          // this registration owns the declaration (see the doc on
          // fileActionsSlot above).
          renderSlot={fileActionsSlot === true ? renderSlot : undefined}
          t={card.t}
        />
      )}
    </>
  )
}
