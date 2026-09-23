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
import type { Context } from '@deepseek-ai/cordis'
import type {
  ConversationNode, PartialAssistant, RunningToolCall, TurnLocation,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  TypertClientRemote, TypertDisposer, TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'

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
