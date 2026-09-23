/**
 * Native-open plumbing for declared deliveries.
 *
 * The delivery cards must be able to (a) preview a file in the Sidebar and
 * (b) hand it to the Host desktop (default application / file manager). This
 * plugin owns only (a) through dsh-coding-sidebar; (b) is a Host capability
 * that the built-in ui-deliverables host half already exposes as two
 * authenticated same-origin routes:
 *
 *   GET  /api/present.host                    → desktop availability + file manager
 *   POST /api/present.open?sessionId&seq&index[&action=reveal]
 *
 * Those routes are addressed by URL on purpose instead of imported: this
 * plugin's client half deliberately keeps only TYPE imports from the
 * @deepseek-ai UI packages (see index.tsx), because the versions it supports
 * span releases in which the runtime exports of those packages moved. A route
 * is therefore used best-effort and degrades in two steps:
 *
 *   - 404 on the metadata route  → 'absent': the carrier does not ship the
 *     present feature at all, so the native actions are not rendered and the
 *     card keeps the Sidebar preview.
 *   - any other failure / 422    → 'error' / 'nativeUnavailable': the card
 *     shows the retryable state, exactly like the built-in row.
 */

/**
 * Authenticated POST route for opening a workspace file on the Host desktop.
 *
 * 0.1.7：上游浏览器侧 app 路由统一改**文档相对**寻址
 * （`PRESENT_HOST_ROUTE = 'api/present.host'`，无前导斜杠）——根部署下与原
 * 绝对路径等价，前缀剥离反代挂载（如 `https://host/tools/dsh/`）下才正确。
 * 见 fork `.agents/notes/implemented/architecture/2026-09-14-web-document-relative-app-routes.md`。
 */
const PRESENT_OPEN_PATH = 'api/present.open'

/** Authenticated desktop availability and destination metadata (document-relative, see above). */
const PRESENT_HOST_PATH = 'api/present.host'

/** Native file action selected by an explicit user gesture. */
export type PresentedAction = 'open' | 'reveal'

/** State of the latest explicit open gesture for one delivered file. */
export type PresentedOpenPhase =
  | 'opening' | 'opened' | 'error'
  | 'revealing' | 'revealed' | 'revealError' | 'nativeUnavailable'

/** Serving Host information; file-manager names never derive from the browser's OS. */
export interface PresentedHost {
  readonly name: string
  readonly available: boolean
  readonly fileManager: 'finder' | 'explorer' | 'directory' | null
}

/**
 * Metadata read result. `'absent'` means the carrier has no present routes at
 * all — a permanent condition, unlike the retryable `'error'`.
 */
export type PresentedHostState = PresentedHost | 'error' | 'absent' | null

/** Minimal immutable snapshot store, the shape useSyncExternalStore expects. */
interface Store<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
  set(value: T): void
}

/**
 * Build a snapshot store. `set` replaces the reference and notifies only on a
 * reference change, so a value that did not move never re-renders a card.
 * @param initial - first published value.
 * @returns the store.
 */
function createStore<T>(initial: T): Store<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: (next) => {
      if (Object.is(next, value)) return
      value = next
      for (const listener of [...listeners]) listener()
    },
  }
}

/** Validate desktop metadata received over HTTP (mirrors the built-in guard). */
function isPresentedHost(value: unknown): value is PresentedHost {
  if (typeof value !== 'object' || value === null) return false
  const host = value as Record<string, unknown>
  return typeof host.name === 'string' && typeof host.available === 'boolean'
    && (host.fileManager === null || host.fileManager === 'finder'
      || host.fileManager === 'explorer' || host.fileManager === 'directory')
}

/**
 * Same-origin action URL, keyed by the viewed Session's delivery coordinates.
 * Also the card's status key: the same file reached from two surfaces shares
 * one pending/acknowledged phase.
 * @param sessionId - viewed Session.
 * @param seq - durable delivery event sequence.
 * @param index - original file index within that event.
 * @returns the authenticated action URL.
 */
export function presentedFileUrl(sessionId: string, seq: number, index: number): string {
  const params = new URLSearchParams({ sessionId, seq: String(seq), index: String(index) })
  return `${PRESENT_OPEN_PATH}?${params.toString()}`
}

/**
 * One browser plugin's native-open requests, cancelled when that plugin is
 * disposed. Mirrors the built-in PresentedOpenController's observable shape
 * so the card's status line and pending states behave identically.
 */
export class PresentedOpenController {
  /** File action URLs key the state across Sessions, turns, and both clickable surfaces. */
  readonly state = createStore<Record<string, PresentedOpenPhase | undefined>>({})
  /** Native destination metadata, a retryable read failure, or an absent carrier. */
  readonly host = createStore<PresentedHostState>(null)
  private loading: Promise<void> | undefined
  private metadata = new AbortController()
  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<void>>()

  /**
   * Open a declared file once while a request for the same coordinates is
   * pending. Failures stay visible on the card and a later gesture retries.
   * @param sessionId - viewed Session, including a fork's own identity.
   * @param seq - durable delivery event sequence.
   * @param index - original file index within that event.
   * @param action - default-application open or file-manager reveal.
   * @returns after the Host acknowledges the action or the error state is published.
   */
  async open(
    sessionId: string,
    seq: number,
    index: number,
    action: PresentedAction = 'open',
  ): Promise<void> {
    const url = presentedFileUrl(sessionId, seq, index)
    const phase = this.state.getSnapshot()[url]
    if (this.lifetime.signal.aborted || phase === 'opening' || phase === 'revealing') return
    this.state.set({
      ...this.state.getSnapshot(),
      [url]: action === 'open' ? 'opening' : 'revealing',
    })
    const task = this.request(url, action)
    this.pending.add(task)
    try {
      await task
    } finally {
      this.pending.delete(task)
    }
  }

  /**
   * Read the serving desktop metadata, coalescing concurrent reads.
   * @returns after metadata, a retryable error, or 'absent' is published.
   */
  async loadHost(): Promise<void> {
    if (this.lifetime.signal.aborted) return
    if (this.loading !== undefined) return this.loading
    // An absent carrier is permanent for this deployment: never re-probe a
    // route the Host already answered 404 for, or every card re-fires it.
    if (this.host.getSnapshot() === 'absent') return
    this.host.set(null)
    // AbortSignal.any is a modern-browser API; a carrier without it simply
    // loses the reset-cancels-read refinement (the lifetime signal still
    // cancels on disposal), never the feature.
    const signal = typeof AbortSignal.any === 'function'
      ? AbortSignal.any([this.lifetime.signal, this.metadata.signal])
      : this.lifetime.signal
    const task = this.readHost(signal)
    this.loading = task
    this.pending.add(task)
    try {
      await task
    } finally {
      if (this.loading === task) this.loading = undefined
      this.pending.delete(task)
    }
  }

  /**
   * Invalidate cached metadata after a connection replacement. `'absent'`
   * survives: the composed plugin roster does not change with a reconnect.
   */
  resetHost(): void {
    if (this.host.getSnapshot() === 'absent') return
    const wasLoading = this.loading !== undefined
    this.metadata.abort()
    this.metadata = new AbortController()
    this.loading = undefined
    this.host.set(null)
    if (wasLoading) void this.loadHost()
  }

  /** Cancel outstanding requests and wait until no request can publish state. */
  async dispose(): Promise<void> {
    this.lifetime.abort()
    await Promise.all(this.pending)
  }

  private async readHost(signal: AbortSignal): Promise<void> {
    let host: PresentedHostState = 'error'
    try {
      const response = await fetch(PRESENT_HOST_PATH, { signal })
      if (response.status === 404) host = 'absent'
      else if (response.ok) {
        const value: unknown = await response.json()
        if (isPresentedHost(value)) host = value
      }
    } catch {
      // Aborted reads publish nothing (a replacement read owns the state).
      if (signal.aborted) return
      host = 'error'
    }
    if (!signal.aborted) this.host.set(host)
  }

  private async request(url: string, action: PresentedAction): Promise<void> {
    const failure: PresentedOpenPhase = action === 'open' ? 'error' : 'revealError'
    let phase: PresentedOpenPhase = action === 'open' ? 'opened' : 'revealed'
    try {
      const response = await fetch(
        action === 'open' ? url : `${url}&action=reveal`,
        { method: 'POST', signal: this.lifetime.signal },
      )
      if (!response.ok) phase = response.status === 422 ? 'nativeUnavailable' : failure
    } catch {
      // Transport failures share the retryable card state with Host open failures.
      phase = failure
    }
    if (!this.lifetime.signal.aborted) {
      this.state.set({ ...this.state.getSnapshot(), [url]: phase })
    }
  }
}
