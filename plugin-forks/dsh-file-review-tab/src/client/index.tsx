/**
 * File-review-tab plugin, browser half: TWO coexisting surfaces over the same
 * produced-file vocabulary —
 *
 * 1. the chat turn-tail row (the original dsh-file-review card: "Edited N
 *    files · +M -K / Undo / Review"), registered into the
 *    'conversation.chat.turnTail' chain at priority -2 so it claims the chain
 *    BEFORE dsh-better-sidebar's own -1 interception row (chain election is
 *    first-claim-wins: exactly one row ever renders, never both). Since dsh
 *    0.1.2-alpha.1 the per-turn produced paths come from the BUILT-IN
 *    ui-deliverables plugin (which owns the `deliverables` Definition and its
 *    turn Location data — this plugin registers no Definition of its own, a
 *    second `deliverables` kind would collide with and crash the built-in);
 *    the card's diff stats and undo ride the session derive (session-changes
 *    argument-contract reconstruction); and
 * 2. the 'file-review' better-sidebar tab (per-session change list + inline
 *    red/green diffs + per-turn/per-file undo).
 *
 * The Host half's undo/redo capability reaches both surfaces through the
 * package's Typert remote contribution, mounted here exactly like
 * dsh-file-review did. Every registration is wrapped in ctx.effect so fiber
 * disposal (HMR / plugin disable) unregisters cleanly.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from 'dsh-better-sidebar/client/service'
import type { ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { TabDescriptor } from 'dsh-better-sidebar/client/service'
import type {
  FileReviewRequest, FileReviewResult, ProducedFileReview,
} from '../change-types.ts'
import { TYPERT_REMOTE } from '../remote.ts'
import { FileReviewTab } from './FileReviewTab.tsx'
import { resolveConversationStore } from './conversation-store.ts'
import type { ConversationFace } from './conversation-store.ts'
import { fileReviewDefinition } from './definition.ts'
import { ProducedFiles } from './ProducedFiles.tsx'
import { attachLocale, en, LOCALE_NS, t, zh } from './locales.ts'
import {
  en as chatEn, NS as CHAT_NS, zh as chatZh, type DeliverablesKey,
} from './chat-locales.ts'
import { countChangedFiles, deriveTimelineChanges, splitArchivedTurns } from './session-changes.ts'
import { selectDeliverablePaths } from './turn-deliverables.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Turn-tail row copy (the chat-side surface). */
    'file-review': DeliverablesKey
  }
}

/**
 * Required services: the sidebar registry, session snapshots, locale, remote,
 * and the slot registry (turn-tail chain). The conversation Definition
 * registry is deliberately NOT a static inject: its service name moved across
 * dsh releases (<= 0.1.1: root `conversationEvents`; 0.1.2-alpha.1+:
 * `uiConversation.events`), so a hard inject on either name leaves the whole
 * plugin forever "pending" on the other version and fails web boot (issue
 * #6). It is resolved dynamically in apply() instead.
 */
export const inject = [
  'betterSidebar',
  'sessions',
  'locale',
  'remote',
  'slots',
]

/** The tab icon: a modest line-diff glyph drawn at the host-given size. */
function FileReviewIcon({ size }: { readonly size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5.25 2.75h6l3.5 3.5v10a1 1 0 0 1-1 1h-8.5a1 1 0 0 1-1-1V3.75a1 1 0 0 1 1-1Z" />
      <path d="M11.25 2.75v3.5h3.5" />
      <path d="M7 10h2.5M10.5 10H12M7 13h5" />
    </svg>
  )
}

interface FileReviewRemote {
  status(request: FileReviewRequest): Promise<RemoteResult<FileReviewResult>>
  apply(request: FileReviewRequest): Promise<RemoteResult<FileReviewResult>>
}

/**
 * The tab-strip badge: the number of distinct files this session changed.
 * The sidebar re-renders the tab bar constantly (and streams publish a fresh
 * snapshot reference per event), so the derivation is memoized by a cheap
 * structural fingerprint per session — streaming token flushes keep the
 * fingerprint stable and skip the full re-derive.
 */
const badgeMemo = new Map<string, { fingerprint: string; count: number | null }>()

function faceFingerprint(face: ConversationFace | null): string {
  if (face === null) return 'none'
  let lastEnd = 0
  for (const endSeq of face.legacy.turnEnds.values()) lastEnd = endSeq
  // Definition data can land on the timeline (including a late-registration
  // rebuild) without touching the windowed transcript slice, so the count
  // of data-bearing turns rides the fingerprint too.
  let dataTurns = -1
  const timeline = face.timeline
  if (timeline !== undefined) {
    dataTurns = 0
    for (const turn of timeline.turnOrder) {
      if (timeline.turns.get(turn)?.data.get('fileReviewChanges') !== undefined) dataTurns += 1
    }
  }
  return `${face.legacy.nodes.length}:${face.legacy.turnEnds.size}:${lastEnd}:${dataTurns}`
}

function badgeCount(ctx: Context, sessionId: string): number | null {
  // Snapshot source is the uiConversation binding (the controller Session
  // snapshot carries queue state only on 0.1.2-alpha.1+ — see
  // conversation-store.ts).
  const store = resolveConversationStore(ctx, sessionId)
  const face = store?.getSnapshot() ?? null
  const fingerprint = faceFingerprint(face)
  const hit = badgeMemo.get(sessionId)
  if (hit !== undefined && hit.fingerprint === fingerprint) return hit.count
  // The badge counts the MAIN list only — auto-archived turns already read
  // their review and left the tab's active section (issue #5). The derive
  // is session-wide via the timeline (issue #8); the windowed snapshot
  // derive remains the fallback inside deriveTimelineChanges.
  const { main } = splitArchivedTurns(deriveTimelineChanges(face))
  const count = countChangedFiles(main)
  const value = count === 0 ? null : count
  badgeMemo.set(sessionId, { fingerprint, count: value })
  return value
}

/**
 * Client plugin body: attach locale, mount the Typert remote, register the
 * chat turn-tail row AND the sidebar tab.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  attachLocale(ctx.locale)
  ctx.effect(() => {
    const offZh = ctx.locale.register(LOCALE_NS, 'zh', zh)
    const offEn = ctx.locale.register(LOCALE_NS, 'en', en)
    return () => { offZh(); offEn() }
  }, 'file-review-tab: tab dictionaries')

  ctx.effect(
    () => ctx.locale.register(CHAT_NS, { zh: chatZh, en: chatEn }),
    'file-review-tab: chat dictionaries',
  )

  ctx.effect(() => {
    let disposed = false
    let disposeRemote: (() => Promise<void>) | undefined
    void ctx.remote.$mount(TYPERT_REMOTE).then((dispose) => {
      if (disposed) void dispose()
      else disposeRemote = dispose
    }).catch((error: unknown) => {
      console.error('[dsh-file-review-tab] remote mount error:', error)
    })
    return () => {
      disposed = true
      if (disposeRemote !== undefined) void disposeRemote()
    }
  }, 'file-review-tab: typert remote')

  // The plugin's own session-wide Definition (see definition.ts). The
  // registry lives on the uiConversation service, which is deliberately NOT
  // a declared inject (issue #6 policy: the conversation registries' service
  // name moved across dsh releases, and a hard inject would leave the whole
  // plugin forever pending on the wrong version) — resolve it dynamically
  // instead, retrying briefly past client boot in case this plugin
  // activates first. A missed registration only degrades the tab, badge and
  // card reviews to the windowed snapshot derive; it never fails boot. The
  // registry rebuilds existing bindings on registration, so even a late
  // registration covers every already-loaded turn.
  ctx.effect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let dispose: (() => void) | undefined
    let attempts = 0
    const stop = (): void => {
      if (timer !== undefined) { clearTimeout(timer); timer = undefined }
    }
    const tryRegister = (): void => {
      attempts += 1
      const anyCtx = ctx as unknown as { get?: (name: string) => unknown }
      const service = (typeof anyCtx.get === 'function' ? anyCtx.get('uiConversation') : undefined) as
        | { events?: { register(definition: unknown): () => void } }
        | undefined
      const events = service?.events
      if (events !== undefined && typeof events.register === 'function') {
        dispose = events.register(fileReviewDefinition)
        stop()
        return
      }
      // ~30s of retries, then give up (carrier without the service).
      if (attempts >= 120) { stop(); return }
      timer = setTimeout(tryRegister, 250)
    }
    tryRegister()
    return () => {
      stop()
      if (dispose !== undefined) dispose()
    }
  }, 'file-review-tab: session-wide Definition')

  // The chat turn-tail row — the original dsh-file-review card, verbatim.
  // priority -2 runs BEFORE dsh-better-sidebar's -1 interception row: chain
  // election is first-claim-wins in ascending priority order, so this row
  // renders and the sidebar's chip row declines (never a double row). The
  // claim input is the BUILT-IN ui-deliverables turn data (paths only); the
  // card's hunks/stats/undo are reconstructed per turn from the session
  // snapshot derive (the same argument-contract vocabulary the tab uses).
  // When this plugin is composed out, the built-in row (or the -1 chip row)
  // takes over again — the off state needs no cleanup here.
  ctx.effect(
    () => ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
      name: 'conversation.chat.turnTail',
      select: selectDeliverablePaths,
      priority: -2,
      locale: CHAT_NS,
      registrant: 'dsh-file-review-tab',
      inject: (sessionId: string) => {
        const sessions = (ctx as unknown as { readonly sessions: ISessions }).sessions
        const projectRoot = sessions.list.getSnapshot().byId[sessionId as SessionId]?.cwd
        const invoke = async (
          method: 'status' | 'apply',
          request: FileReviewRequest,
        ): Promise<FileReviewResult> => {
          const scope = sessions.scope(sessionId as SessionId)
          if (scope === undefined) throw new Error('Session is unavailable')
          // Session scopes are minted by the client runtime and cannot
          // statically inject namespaces contributed later by feature plugins.
          // `get()` is the Cordis escape hatch for an explicitly mounted
          // dynamic service; tracing still binds the Remote call to this
          // Session scope.
          const fileReview = scope.get('remote.fileReview') as FileReviewRemote | undefined
          if (fileReview === undefined) throw new Error('File review Remote is unavailable')
          const result = await fileReview[method](request)
          if (!result.ok) throw new Error(result.error.message)
          return result.value
        }
        // Reviews for the claiming turn: the session-wide turn data first
        // (this plugin's Definition — complete hunks for EVERY loaded turn),
        // with the windowed snapshot derive as the timeline-less fallback.
        // The snapshot is resolved PER CALL on purpose: the slots framework
        // caches this entry's inject result per session (ui-renderer's
        // sessionInjectCache), so a face captured in this closure would stay
        // frozen at whichever turn was current when the session's FIRST card
        // rendered — every later turn would read as +0 -0 until reload. The
        // card re-derives when the reactive `changesStore` face moves
        // (subscribed via useSyncExternalStore inside ProducedFiles).
        const store = resolveConversationStore(ctx, sessionId)
        const collectReviews = (turn: number): readonly ProducedFileReview[] => {
          const face = store?.getSnapshot() ?? null
          const own = face?.timeline?.turns.get(turn)?.data.get('fileReviewChanges') as
            | { files?: readonly ProducedFileReview[] }
            | undefined
          const files = own?.files
            ?? deriveTimelineChanges(face).find(entry => entry.turn === turn)?.files
          if (files === undefined) return []
          return files.map(file => ({
            path: file.path,
            diffs: [...file.diffs],
            ...(file.deleted === true ? { deleted: true as const } : {}),
          }))
        }
        return {
          projectRoot,
          inspectChanges: (request: FileReviewRequest) => invoke('status', request),
          applyChanges: (request: FileReviewRequest) => invoke('apply', request),
          collectReviews,
          // Reactive face for the card's useSyncExternalStore subscription
          // (the fix half of the frozen-inject problem above). Identity used
          // to be stable only via the framework's cache; passing the store
          // itself keeps the hook subscribed exactly once per session.
          changesStore: store,
          // 审查 button / per-file chip: open (or focus) the sidebar tab with
          // these paths pre-expanded. updateTab runs FIRST: an already-open
          // tab receives the fresh meta reference here (the tab replays the
          // expansion), while openTab below only FOCUSES an existing tab —
          // it never applies a seed's meta to one (see the sidebar service's
          // openTab: meta lands only on creation). For a not-yet-open tab
          // updateTab is a strict no-op and openTab creates the tab WITH the
          // meta. activateTab then guarantees focus either way.
          // `path` rides along only so the host treats this as a CONTENT open:
          // a collapsed side panel auto-expands to land the tab in sight
          // (type-only opens leave collapsed panels alone). The tab itself
          // never reads tab.path.
          openInSidebarTab: (paths: readonly string[], turn?: number) => {
            const sidebar = ctx.betterSidebar
            const first = paths[0]
            if (sidebar === undefined || first === undefined) return
            // `turn` anchors the deep link to one turn: the tab expands only
            // that turn's rows for these paths (a recurring path stays
            // collapsed in its other turns).
            const meta = { expandPaths: [...paths], ...(turn !== undefined ? { turn } : {}) }
            const scope = { sessionId, ...(projectRoot !== undefined ? { cwd: projectRoot } : {}) }
            sidebar.updateTab('file-review', { meta })
            sidebar.openTab({ type: 'file-review', path: first, meta }, scope)
            sidebar.activateTab('file-review', scope)
          },
        }
      },
    }, ProducedFiles)),
    'file-review-tab: turn-tail row',
  )

  ctx.effect(() => ctx.betterSidebar.registerTab({
    id: 'file-review',
    title: () => t('tabTitle'),
    icon: (size: number) => <FileReviewIcon size={size} />,
    order: 35,
    single: true,
    badge: (badgeCtx, scope) => badgeCount(badgeCtx as unknown as Context, scope.sessionId),
    component: ({ ctx: tabCtx, scope, visible, tab }) => (
      <FileReviewTab
        ctx={tabCtx as unknown as Context}
        sessionId={scope.sessionId}
        cwd={scope.cwd}
        visible={visible}
        tab={tab}
      />
    ),
  } satisfies TabDescriptor), 'file-review-tab: register tab')
}
