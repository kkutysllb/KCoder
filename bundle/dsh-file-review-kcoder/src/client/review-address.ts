/**
 * `dsh-resource://changes-review/…` takeover — the native Sidebar's review
 * gesture, rerouted into THIS plugin's own tab.
 *
 * Why this module exists: upstream's changed-files card (ui-deliverables) hands
 * its review gesture to the NATIVE right Sidebar —
 * `ctx.sidebarRight.openResource(changesReviewAddress({ sessionId, seq, turn }))`.
 * dsh-coding-sidebar's open-path wrapper claims the `dsh-resource://file/…`
 * family only (its `fileTargetOfAddress` declines every other scope), so a
 * review address falls through to the native panel. KCoder suppresses that
 * panel on purpose (产品铁律 1, docs/ARCHITECTURE.md §12: 不使用上游原生侧边栏
 * 功能), so the fall-through shows a blank area instead of a review.
 *
 * The content the address names — one turn's changed-file review — is exactly
 * what this plugin's `file-review` tab renders, so the open is claimed here and
 * rerouted to that tab in the address's own Session scope. Claiming it in the
 * plugin (not in the host) keeps the 铁律 2 line: upstream-version adaptation
 * lives in the plugin and ships as a plugin release.
 *
 * Dependency-free on purpose (no React / ui-primitives / cordis): the parse and
 * wrap logic stays unit-testable and importable outside the client runtime.
 */

/**
 * Address prefix upstream mints for one turn's review. It INCLUDES the `session`
 * scope segment (`ui-deliverables/src/changes.ts`: `CHANGES_REVIEW_ADDRESS =
 * 'dsh-resource://changes-review/session/'`), so what follows is
 * `<id>/<seq>/<turn>` — three segments.
 */
export const CHANGES_REVIEW_PREFIX = 'dsh-resource://changes-review/session/'

/** The coordinates one review address carries. */
export interface ChangesReviewCoordinates {
  /** Owning Session (percent-encoded in the address). */
  readonly sessionId: string
  /** `workspace/changes` event sequence the review was captured from. */
  readonly seq: number
  /** Turn the review belongs to (the tab's own turn numbering). */
  readonly turn: number
}

/**
 * Decode a `dsh-resource://changes-review/session/<id>/<seq>/<turn>` address —
 * the shape upstream's `changesReviewAddress` mints (three segments behind the
 * prefix, the Session id percent-encoded).
 *
 * Anything else declines: an unknown prefix, a segment count other than three,
 * a non-numeric sequence or turn, and a malformed percent escape all return
 * `undefined` so the caller's open falls through untouched (guessing here would
 * hijack opens this plugin does not own).
 *
 * @param address - candidate resource address (any unknown value is declined).
 * @returns the decoded coordinates, or undefined when this is not a review address.
 */
export function parseChangesReviewAddress(address: unknown): ChangesReviewCoordinates | undefined {
  if (typeof address !== 'string' || !address.startsWith(CHANGES_REVIEW_PREFIX)) return undefined
  const parts = address.slice(CHANGES_REVIEW_PREFIX.length).split('/')
  if (parts.length !== 3) return undefined
  const [rawId, rawSeq, rawTurn] = parts as [string, string, string]
  // Upstream mints `seq` as a non-negative integer and `turn` as 1-based; a
  // Session id is never empty. Rejecting the empty id keeps a truncated
  // address from opening a scope-less tab.
  if (rawId === '' || !/^\d+$/.test(rawSeq) || !/^[1-9]\d*$/.test(rawTurn)) return undefined
  try {
    return { sessionId: decodeURIComponent(rawId), seq: Number(rawSeq), turn: Number(rawTurn) }
  } catch {
    // `decodeURIComponent` throws URIError on a malformed escape.
    return undefined
  }
}

/** The one service method the wrapper replaces (mirror of the runtime's face). */
export interface SidebarRightStub {
  openResource(address: string, options?: unknown): void
}

/**
 * Wrap `sidebarRight.openResource` so review addresses open in this plugin's
 * own tab while every other address reaches the original method unchanged.
 *
 * `openResource` is a prototype method on the sidebar controller, so the raw
 * reference is captured and reassigned; a remount that swaps the controller
 * replaces this wrapper with the new instance's own (the disposer restores the
 * reference it captured, which is why callers must install per instance).
 *
 * @param right - the sidebarRight service face.
 * @param open - reroutes one decoded review address into the plugin's tab.
 * @returns the disposer restoring the original method (HMR-safe).
 */
export function wrapChangesReviewOpen(
  right: SidebarRightStub,
  open: (coordinates: ChangesReviewCoordinates) => void,
): () => void {
  const original = right.openResource
  if (typeof original !== 'function') return () => {}
  right.openResource = function (this: SidebarRightStub, address: string, options?: unknown): void {
    const coordinates = parseChangesReviewAddress(address)
    if (coordinates !== undefined) {
      open(coordinates)
      return
    }
    return original.call(this, address, options)
  }
  return () => {
    right.openResource = original
  }
}
