/**
 * The 0.1.7-alpha.1 Client contract faces this plugin consumes but cannot
 * import.
 *
 * dsh 0.1.7 decomposed the `@deepseek-ai/dsh-client-runtime` umbrella (the
 * package 0.1.0-rc.7 typechecked this plugin against) into the packages that
 * now own each face. This plugin's type baseline is the narrow set of
 * @deepseek-ai packages it actually calls (package.json), and five of those
 * owners sit outside it:
 *
 *   ctx.slots                      → @deepseek-ai/dsh-client-ui-renderer
 *   Events['connection/reset']     → @deepseek-ai/dsh-client-connection
 *   ctx.remote (ClientRemote)      → @deepseek-ai/dsh-api-gateway
 *   SessionStandardProps.sessionId → @deepseek-ai/dsh-client-ui-session
 *   TurnTailOwnerProps and the windowed transcript slice
 *                                  → @deepseek-ai/dsh-client-ui-chat
 *
 * Upstream consumers pull each face with the `import type {} from '<pkg>/client'`
 * idiom (docs/subsystems/slots.md; packages/client/ui-deliverables/src/client/index.ts).
 * Where the absent owner only MERGES a declaration, the faces here mirror that
 * merge verbatim — same member, same type, so the merge stays valid the day the
 * owner joins the baseline. Where the absent owner defines an interface with a
 * body, the slice this plugin reads is declared structurally: the same recipe
 * this plugin already uses for `ISessions`, `SidebarRightStub`, `TimelineFace`,
 * and `TurnDataFace`.
 *
 * Authority for every mirror: the fork mirror of upstream dsh 0.1.7-alpha.1 at
 * /Users/libing/kk_Projects/deepseek-harness (paths cited per member below).
 */
import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {
  ConversationNode, PartialAssistant, RunningToolCall, TurnLocation,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  TypertClientRemote, TypertDisposer, TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'
import type { PresentedAction, PresentedOpenFailure } from './present-open.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A connection generation was established: wire-derived caches must
     * repull, long-lived streams own their own resume. Mirrors the merge in
     * `@deepseek-ai/dsh-client-connection/client`
     * (packages/client/connection/src/client/index.ts:17-24).
     */
    'connection/reset'(): void
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SessionStandardProps {
    /**
     * Current Session identity, delivered to every `session`-scope slot.
     * Mirrors the merge in `@deepseek-ai/dsh-client-ui-session/client`
     * (packages/client/ui-session/src/client/index.ts:163-172); `ui-slots`
     * itself declares the interface empty as the zero-dependency merge point.
     */
    sessionId: SessionId
  }
}

/**
 * The windowed transcript slice, published beside the Chat target snapshot as
 * `legacy`. Mirrors `LegacyConversationSlice`
 * (packages/client/ui-chat/src/client/contract/snapshot.ts:95-102); carriers
 * older than the incremental Chat publication expose the same fields at the
 * target snapshot's top level instead, which is why the resolver in
 * conversation-store.ts reads both.
 */
export interface WindowedTranscriptFace {
  readonly nodes: readonly ConversationNode[]
  readonly turnTimings: ReadonlyMap<number, {
    readonly startTime: number
    readonly endTime?: number
  }>
  readonly turnEnds: ReadonlyMap<number, number>
  readonly partial: PartialAssistant | null
  readonly runningCalls: readonly RunningToolCall[]
}

/**
 * Owner currency of one `conversation.chat.turnTail` entry: the closing Turn,
 * its seq, and the Chat-supplied file opener. Mirrors `TurnTailOwnerProps`
 * (packages/client/ui-chat/src/client/contract/slots.ts:49-53), which 0.1.7
 * moved from `ui-conversation` to `ui-chat`.
 */
export interface TurnTailOwnerProps {
  turn: TurnLocation
  seq: number
  openFile: (path: string) => void
}

/** One synchronous effect installed while an injected slot declaration is live. */
export type SlotInjectionEffect = (() => void) | Iterable<() => void>

/**
 * The shared per-file action child slot dsh 0.1.7 added for delivery cards
 * (`deliverables.file.actions`, list/session). Owner-side name, mirrored as a
 * literal so the card's render site cannot drift from the declaration.
 */
export type FileActionsSlotKey = 'deliverables.file.actions'

/**
 * Owner props of the file-action child slot, mirrored verbatim from the
 * owner's declaration
 * (fork packages/client/ui-deliverables/src/client/file-actions.ts:8-19; the
 * sibling `deliverables.review.file.actions` — :21-25 — shares this exact
 * shape). The contributing entry (`ui-open-in-app`'s `FileRouteAction`,
 * packages/client/ui-open-in-app/src/client/FileRouteAction.tsx:30-37) reads
 * `actionUrl` twice — GET for the file's registered applications, POST for the
 * gesture — so this URL must be the very route this plugin's own control
 * posts to (`present-open.presentedFileUrl`).
 */
export interface FileActionOwnerProps {
  /** Authenticated document-relative action route carrying Session event coordinates. */
  readonly actionUrl: string
  /** Whether the serving Host can hand paths to a native desktop. */
  readonly available: boolean
  /** Whether a gesture for this file is already in flight. */
  readonly pending: boolean
  /** Execute the selected native action; the failure to announce, or null. */
  readonly onAction: (action: PresentedAction, application?: string) => Promise<PresentedOpenFailure>
}

/**
 * Child-slot render face handed to a session-scope entry by the renderer
 * (`PropsRenderSlots<'deliverables.file.actions'>`,
 * packages/client/ui-slots/lib/types/index.d.ts — `renderSlot` + the phantom
 * `__renders` anchor). Declared structurally, narrowed to the one key this
 * plugin declares and renders: the renderer-owned face is `SlotRegistryFace`'s
 * sibling, absent from this type baseline for the same reason.
 *
 * `opts.fallback` is the owner's own body, rendered when the slot has no
 * entry — the renderer keeps the slot's `[data-slot]` anchor either way
 * (packages/client/ui-renderer/src/client/scoped-slots.tsx:1235).
 */
export type FileActionsRenderFace = (
  key: FileActionsSlotKey,
  owner: FileActionOwnerProps,
  opts?: { readonly fallback?: ReactNode },
) => ReactNode

/**
 * Structural face of the renderer-owned slot registry exposed as `ctx.slots`
 * (packages/client/ui-renderer/src/client/index.ts:43-48; the `inject`/
 * `register` surface is packages/client/ui-renderer/src/client/registry.ts).
 * Declared structurally rather than as a `Context` merge on purpose: the
 * owner's member is the concrete `SlotRegistry` class, so a second declaration
 * of `Context.slots` would collide the moment that package joins the baseline.
 */
export interface SlotRegistryFace {
  /**
   * Run one contribution for every declaration lifetime of a slot key.
   * @param key - slot key to contribute into.
   * @param contribute - installs the contribution; returns its disposer.
   * @returns a disposer removing the injection.
   */
  inject(key: string, contribute: () => SlotInjectionEffect): () => void
  /**
   * Contribute one entry: component plus its registration options.
   *
   * `children` declares (and thereby authorizes) the child slots this entry
   * alone may render — one declarer per key, so a second entry declaring a
   * live child key throws (packages/client/ui-slots/src/index.ts:1263-1266).
   * The KCoder fork adds the opt-in `rendersExistingChildren: true`
   * (packages/client/ui-slots/src/index.ts:1249-1259, deployed since
   * dsh-client-ui-slots 0.1.7-alpha.1 — see the KCoder runtime's
   * lib/index.js) which lets an entry RENDER a child table another entry
   * already declared (shared render face; the first declarer keeps the
   * lifecycle). Unknown options are ignored by registries without it, so the
   * flag is a no-op there rather than a version hazard.
   *
   * @param options - registration options (name, id, locale, inject, children).
   * @param component - the entry component.
   * @returns an idempotent disposer.
   */
  register(options: object, component: unknown): () => void
}

/**
 * Read the slot registry through the Context service proxy. `slots` is a
 * declared inject of this plugin (index.tsx), so the service is live whenever
 * `apply()` runs; the structural read only stands in for the missing owner
 * package, exactly like the `ISessions` read in index.tsx.
 * @param ctx - client root context.
 * @returns the registry, or undefined on a carrier without the slots service.
 */
export function slotRegistry(ctx: Context): SlotRegistryFace | undefined {
  return (ctx as unknown as { readonly slots?: SlotRegistryFace }).slots
}

/**
 * Mount one Host-for-Client Remote contribution, typed by the owner of the
 * signature instead of by the plugin's untyped `ctx.remote`. `ClientRemote`
 * is declared in `@deepseek-ai/dsh-api-gateway/client` — absent from this type
 * baseline, which silently degrades `ctx.remote` to `any` and erases the
 * `$mount` contract; the signature itself lives in the installed
 * `@deepseek-ai/dsh-typert-protocol`
 * (packages/typert/protocol/src/types.ts:432-438).
 * @param ctx - client root context.
 * @param contribution - the package's generated Remote contribution.
 * @returns the contribution's disposer, once its namespaces are ready.
 */
export function mountRemoteContribution(
  ctx: Context,
  contribution: TypertRemoteContribution,
): Promise<TypertDisposer> {
  const remote = (ctx as unknown as { readonly remote: Pick<TypertClientRemote, '$mount'> }).remote
  return remote.$mount(contribution)
}
