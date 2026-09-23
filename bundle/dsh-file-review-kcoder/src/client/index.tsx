/**
 * File-review-tab plugin, browser half: TWO coexisting surfaces over the same
 * produced-file vocabulary —
 *
 * 1. the chat turn-tail row (the original dsh-file-review card: "Edited N
 *    files · +M -K / Undo / Review"), registered into the
 *    'conversation.chat.turnTail' chain at priority -2 so it claims the chain
 *    BEFORE dsh-coding-sidebar's own -1 interception row (chain election is
 *    first-claim-wins: exactly one row ever renders, never both). Since dsh
 *    0.1.2-alpha.1 the per-turn produced paths come from the BUILT-IN
 *    ui-deliverables plugin (which owns the `deliverables` Definition and its
 *    turn Location data — this plugin registers no Definition of its own, a
 *    second `deliverables` kind would collide with and crash the built-in);
 *    the card's diff stats and undo ride the session derive (session-changes
 *    argument-contract reconstruction). Because an elected chain entry owns
 *    the WHOLE row, the registered component is `Deliverables`, which also
 *    renders dsh 0.1.5-alpha.2's explicit-delivery cards (`present`) — see
 *    Deliverables.tsx; and
 * 2. the 'file-review' better-sidebar tab (per-session change list + inline
 *    red/green diffs + per-turn/per-file undo).
 *
 * The Host half's undo/redo capability reaches both surfaces through the
 * package's Typert remote contribution, mounted here exactly like
 * dsh-file-review did. Every registration is wrapped in ctx.effect so fiber
 * disposal (HMR / plugin disable) unregisters cleanly.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the generated Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from 'dsh-coding-sidebar/client/service'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { TabDescriptor } from 'dsh-coding-sidebar/client/service'
import type {
  FileReviewRequest, FileReviewResult, ProducedFileReview,
} from '../change-types.ts'
import { TYPERT_REMOTE } from '../remote.ts'
import { FileReviewTab } from './FileReviewTab.tsx'
import { resolveConversationStore, turnChangesFingerprint } from './conversation-store.ts'
import { mountRemoteContribution, slotRegistry } from './dsh-contracts.ts'
import type { ConversationFace } from './conversation-store.ts'
import { fileReviewDefinition } from './definition.ts'
import { FileReviewTurnTail } from './Deliverables.tsx'
import { inspectionKey } from './ProducedFiles.tsx'
import { PresentedOpenController } from './present-open.ts'
import { attachLocale, en, LOCALE_NS, t, zh } from './locales.ts'
import {
  en as chatEn, NS as CHAT_NS, zh as chatZh, type DeliverablesKey,
} from './chat-locales.ts'
import {
  countChangedFiles, deriveTimelineChanges, resolveSessionPath, splitArchivedTurns,
} from './session-changes.ts'
import { basename, selectDeliverables } from './turn-deliverables.ts'
import {
  wrapChangesReviewOpen, type ChangesReviewCoordinates, type SidebarRightStub,
} from './review-address.ts'

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
 * Open (or focus) the sidebar review tab for one review address's turn, in the
 * address's OWN Session scope (a chip inside a fork's card belongs to the fork,
 * not to whatever conversation is on screen).
 *
 * The paths come from the same sources the chat card reads — this plugin's
 * per-turn Definition data first, the timeline derive as the windowed fallback
 * — so the deep link expands exactly the rows the native panel would have
 * listed. An unresolvable turn still opens the tab (the panel auto-expands via
 * the `path`-carrying seed when the review has a first file) rather than
 * silently doing nothing.
 *
 * @param ctx - client root context.
 * @param coordinates - decoded review address (Session, sequence, turn).
 */
function openReviewInSidebar(ctx: Context, { sessionId, turn }: ChangesReviewCoordinates): void {
  const sidebar = ctx.betterSidebar
  if (sidebar === undefined) return
  // The runtime ISessions face (same cast as the turn-tail inject below):
  // the ambient Context type declares `sessions.list` as a plain callable,
  // while the shipped service exposes the snapshot store.
  const sessions = (ctx as unknown as { readonly sessions: ISessions }).sessions
  const cwd = sessions.list.getSnapshot().byId[sessionId as SessionId]?.cwd
  const scope = { sessionId, ...(cwd !== undefined ? { cwd } : {}) }
  const face = resolveConversationStore(ctx, sessionId)?.getSnapshot() ?? null
  const own = face?.timeline?.turns.get(turn)?.data.get('fileReviewChanges') as
    | { files?: readonly { path: string }[] }
    | undefined
  const files = own?.files
    ?? deriveTimelineChanges(face).find(entry => entry.turn === turn)?.files
  const paths = (files ?? []).map(file => file.path)
  // `turn` anchors the deep link to one turn (the tab expands that turn's rows
  // for these paths, and scrolls to the group when the list is empty); the
  // first path rides along only so the host treats this as a CONTENT open and
  // auto-expands a collapsed panel to land the tab in sight.
  const meta = { expandPaths: paths, turn }
  const first = paths[0]
  sidebar.updateTab('file-review', { meta })
  sidebar.openTab({ type: 'file-review', ...(first !== undefined ? { path: first } : {}), meta }, scope)
  sidebar.activateTab('file-review', scope)
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

  // Native-open controller for declared deliveries (the `present` tool's
  // cards). One instance for the whole plugin: its state is keyed by the
  // per-file action URL, which already carries the Session, and the card
  // section reads it through the slot's inject face. `connection/reset`
  // invalidates cached desktop metadata; disposal cancels in-flight requests.
  const presentedOpen = new PresentedOpenController()
  ctx.effect(() => () => { void presentedOpen.dispose() }, 'file-review-tab: presented opens')
  ctx.effect(() => ctx.on('connection/reset', () => { presentedOpen.resetHost() }), 'file-review-tab: presented host reset')

  ctx.effect(() => {
    let disposed = false
    let disposeRemote: (() => Promise<void>) | undefined
    void mountRemoteContribution(ctx, TYPERT_REMOTE).then((dispose) => {
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
  // dsh 0.1.6-alpha.2 适配（2026-09-19）：槽位从 chain（select 选举 +
  // priority 抢占）改为 list（id 必需，各自渲染自己的行）。旧的
  // priority -2 先于 dsh-coding-sidebar -1 抢占的协作不复存在，改为
  // 共存协调：本行认领 produced/presented 非空的 turn（匹配判定移入
  // 组件每次渲染重算）；coding-sidebar 侧（1.0.19 起）在读到本插件的
  // turn data 时退位，原生 ui-deliverables 卡由宿主侧配置关闭——同一
  // turn 永不双行。claim 输入不变：BUILT-IN deliverables turn data
  //（paths）+ 自有 fileReviewChanges 定义（完整 hunks）；presented
  // 两段照旧由 Deliverables 渲染。本插件未组入时其余行自然接管。
  ctx.effect(() => {
    // The renderer-owned registry (`ctx.slots`), resolved through the service
    // proxy because 0.1.7 moved its Context declaration into
    // @deepseek-ai/dsh-client-ui-renderer — see dsh-contracts.ts. `slots` is a
    // declared inject below, so the fallback branch only stands in for a
    // carrier that provides no renderer at all: stay mounted, contribute
    // nothing, never fail boot.
    const slots = slotRegistry(ctx)
    if (slots === undefined) return () => {}
    // 0.1.7 共享文件动作子槽的声明结果，由下方注册写入、inject 面读取：
    // 只有本次注册真的拿到了该子槽的渲染面，卡片才允许 renderSlot（对
    // 未声明的子键调用会被渲染器直接抛错并让整行退位）。
    let fileActionsSlot = false
    return slots.inject('conversation.chat.turnTail', () => {
    // const 持有后再传入：非新鲜字面量，旧类型基线（无 id 字段）不做
    // 多余属性检查；alpha.2 运行时按 id 走 list 匹配
    const turnTailOptions = {
      // 双轨注册（2026-09-19）：id 是 0.1.6-alpha.2 list 语义必需；
      // select/priority 保留给 pre-alpha.2 的 chain 引擎（旧类型基线下
      // select 为必填）。alpha.2 运行时忽略 select/priority、按 id 走
      // list 匹配（组件内重算）。本对象经 return 直接传入——非独立声明的
      // 新鲜字面量在旧类型下仍会触发多余属性检查，故下方 register 调用
      // 以变量持有绕开（见 register 调用处注释）。
      name: 'conversation.chat.turnTail',
      id: 'dsh-file-review-tab',
      select: selectDeliverables,
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
        // The resolved store is identity-stable per session (its getSnapshot
        // caches the face keyed on the underlying snapshot reference — what
        // useSyncExternalStore needs to avoid the #185 max-update loop), but
        // it only EXISTS once the session binds to the uiConversation service.
        // The slots framework caches this entry's inject result per session,
        // so capturing the resolution at first run would freeze the card at
        // +0 -0 whenever the binding is not ready yet (cold start / fresh
        // session). Resolve lazily and cache the first defined store, so a
        // card rendered before the binding self-heals once it lands.
        let cachedStore: ReturnType<typeof resolveConversationStore>
        const getStore = () => {
          if (cachedStore !== undefined) return cachedStore
          const store = resolveConversationStore(ctx, sessionId)
          if (store !== undefined) cachedStore = store
          return store
        }
        const collectReviews = (turn: number): readonly ProducedFileReview[] => {
          const face = getStore()?.getSnapshot() ?? null
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
          // (the fix half of the frozen-inject problem above). The accessors
          // resolve the underlying store PER CALL so a not-yet-bound session
          // (cold start) self-heals once the service is ready; the wrapper
          // object itself is constant so the hook subscribes exactly once.
          // getTurnSnapshot hands each card a TURN-SCOPED content fingerprint
          // (conversation-store.turnChangesFingerprint) instead of the session
          // face: streaming publications swap the face reference per event,
          // and a face-keyed subscription re-rendered — and the card's then
          // identity-keyed effect re-inspected host state on — every mounted
          // card non-stop while ANY turn ran (the blinking 撤销 button). A
          // card must re-render only when its OWN turn's review content moves.
          changesStore: {
            getSnapshot: () => getStore()?.getSnapshot() ?? null,
            getTurnSnapshot: (turn: number) =>
              turnChangesFingerprint(getStore()?.getSnapshot() ?? null, turn),
            subscribe: (listener: () => void) => getStore()?.subscribe(listener) ?? (() => {}),
          },
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
          // Non-code artifacts (images / media / office / reports): open the
          // SIDEBAR's own viewer pipeline — the editor tab runs
          // matchFileViewer over the path (image / pdf / markdown / html
          // built-ins; office/video via its viewer plugins) — instead of the
          // diff review tab, which has no hunks to show for them. Falls back
          // to the card's Host openFile (OS default app) when the carrier
          // has no sidebar; ProducedFiles owns that fallback.
          openPreview: (path: string) => {
            const sidebar = ctx.betterSidebar
            if (sidebar === undefined) return
            const absolute = resolveSessionPath(projectRoot, path)
            sidebar.openFile(
              { sessionId, ...(projectRoot !== undefined ? { cwd: projectRoot } : {}) },
              absolute,
              basename(absolute),
            )
          },
          // Native-open face for the delivery cards. The controller instance
          // is shared (its state is keyed per file action URL), so this entry
          // is stable across session re-binds; the section reads both stores
          // through useSyncExternalStore.
          presentedController: presentedOpen,
          // 本卡片自己的文件动作子槽（dsh-file-review-kcoder.file.actions）是否
          // 由本次注册声明成功——见上方 fileActionsSlot 与下方注册处的注释。
          fileActionsSlot,
        }
      },
    } as const
    // 文件动作子槽：本卡片声明自己的键，绝不去认领 upstream 的
    // deliverables.file.actions。upstream 0.1.7 把它声明为原生交付卡的子键
    //（fork packages/client/ui-deliverables/src/client/index.ts:83），而一个子键
    // 只能有一个声明者（fork packages/client/ui-slots/src/index.ts:1263 起）：
    // 第二个声明者会抛「already declared」，整条 entry 随 apply 一起失败，
    // assertEntriesActive 再把它升级成整个 web boot 失败（0.1.10 修的就是这个
    // 现场：本插件先注册、原生卡后注册 → 原生卡方的 ui-deliverables.apply 抛错
    // → 页面停在「Failed to load plugins」）。
    //
    // 运行时无法协商归属：谁先 register 谁拥有该键，慢的那个必抛，因此把
    // 「共享名字 + rendersExistingChildren 兜底」当方案会让启动成功与否取决于
    // 客户端激活顺序。命名空间化的自有键把这个不确定性彻底去掉：KCoder 的
    // 贡献控件（PresentedFiles 的动作位）仍挂在卡片上，upstream 原生的
    // open-with / reveal 控件留在它自己的卡片上，两边互不侵占。
    const withFileActions = {
      ...turnTailOptions,
      children: { 'dsh-file-review-kcoder.file.actions': { kind: 'list', scope: 'session' } },
    } as const
    try {
      const dispose = slots.register(withFileActions, FileReviewTurnTail)
      fileActionsSlot = true
      return dispose
    } catch (error: unknown) {
      console.warn('[dsh-file-review-tab] file-action child slot unavailable, keeping the card\'s own control:', error)
      return slots.register(turnTailOptions, FileReviewTurnTail)
    }
    })
  }, 'file-review-tab: turn-tail row')

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

  // 原生侧边栏接管（产品铁律 1，docs/ARCHITECTURE.md §12「不使用上游原生侧边栏
  // 功能」）：上游 changed-files 卡的「审查」手势走
  // `ctx.sidebarRight.openResource('dsh-resource://changes-review/…')`，而
  // coding-sidebar 的文件打开门只认 `dsh-resource://file/…` 家族（其余 scope
  // 一律让它落到原方法）——于是该地址落回**原生右栏**；原生外壳又被产品侧压制，
  // 用户看到的就是一片空白。本插件接管这一家族，改开自己的 file-review 页签：
  // 同一个 turn 的变更评审本来就是它渲染的内容。
  //
  // 装配方式与 coding-sidebar 的门同款（ctx.inject 延迟装配）：sidebarRight 由
  // 随包的 Web 补丁组合、不在本插件的静态 inject 里，单次 ctx.get 探针可能先于
  // 提供方执行而**永久装不上**；ctx.inject 在服务就绪时回调（已在则同步触发），
  // 载具永不提供则回调不触发、门保持未装——不阻塞插件激活，与旧行为降级面一致。
  ctx.effect(() => {
    let disposed = false
    let disposeWrap = () => {}
    const fiber = ctx.inject(['sidebarRight'], () => {
      if (disposed) return
      const right = ctx.get('sidebarRight') as SidebarRightStub | undefined
      if (right === undefined) return
      disposeWrap = wrapChangesReviewOpen(right, coordinates => { openReviewInSidebar(ctx, coordinates) })
      // 安装期诊断（每激活一次一行）：现场排查「点交付卡片出了原生空白区」
      // 只需看这一行在不在。
      console.log('[dsh-file-review-tab] native-sidebar takeover: changes-review → file-review tab')
    })
    return () => {
      disposed = true
      disposeWrap()
      void fiber.dispose()
    }
  }, 'file-review-tab: changes-review takeover')
}

// Pure helpers re-exported for the package smoke regression checks
// (scripts/smoke-plugin.mjs asserts the blink-fix, artifact, and
// delivery-claim invariants on lib/client.js).
export { turnChangesFingerprint }
export { inspectionKey }
export { captureArtifacts, classifyPath } from './artifacts.ts'
export { presentedForClosing, selectDeliverables } from './turn-deliverables.ts'
export { parseChangesReviewAddress, wrapChangesReviewOpen } from './review-address.ts'
export { Deliverables } from './Deliverables.tsx'
// Native-open face re-exported for the smoke regression checks
// (scripts/smoke-plugin.mjs drives the controller against a stubbed fetch to
// pin the route URL composition, `application` included).
export { PresentedOpenController, presentedFileUrl } from './present-open.ts'
