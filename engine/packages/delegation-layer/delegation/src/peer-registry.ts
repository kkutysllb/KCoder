import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  AgentCardSchema,
  PeerArtifactSchema,
  PeerRecordSchema,
  PeerTaskSchema,
  type AgentCard,
  type PeerArtifact,
  type PeerRecord,
  type PeerTask
} from '@qiongqi/contracts'

/**
 * # PeerRegistry (Stage 2.2)
 *
 * A unified registry for both **local** and **remote** agent peers.
 *
 * - **Local peer** — an in-process agent (e.g. a child agent spun up by
 *   `DelegationRuntime`). Registered with a {@link LocalPeerHandle} that
 *   the registry calls directly.
 * - **Remote peer** — an agent reachable over HTTP. Registered with an
 *   {@link AgentCard}; invocation goes through a {@link RemotePeerTransport}
 *   (typically an HTTP client supplied by `@qiongqi/http`).
 *
 * Both kinds are addressed by `cardId` and invoked through the same
 * `invokePeer(cardId, task)` method, so callers don't need to know
 * whether a peer is local or remote.
 *
 * ## Dependency direction
 *
 * `@qiongqi/delegation` stays free of `@qiongqi/http`. The transport
 * and handle interfaces are defined here and injected by the caller
 * (usually `createAgent` in `@qiongqi/http`). This is classic dependency
 * inversion: the low-level delegation package owns the abstraction, and
 * the high-level http package supplies the implementation.
 */

/**
 * Handle for a local (in-process) peer. The registry calls
 * `invoke(task)` directly — no network hop.
 */
export interface LocalPeerHandle {
  /** The AgentCard this handle is registered under. */
  readonly card: AgentCard
  /** Execute a task against this local peer. */
  invoke(task: PeerTask, signal: AbortSignal): Promise<PeerArtifact>
}

/**
 * Transport for reaching remote peers over HTTP. Implemented by
 * `@qiongqi/http` (or a test double). The registry never calls
 * `fetch` directly — it always goes through this interface so the
 * delegation package has zero HTTP dependencies.
 */
export interface RemotePeerTransport {
  /**
   * Invoke a task on a remote peer identified by its AgentCard.
   *
   * @param card  The peer's AgentCard (contains `url` + `endpoints.a2a`).
   * @param task  The task to submit.
   * @param signal Optional abort signal.
   */
  invokeRemote(
    card: AgentCard,
    task: PeerTask,
    signal: AbortSignal
  ): Promise<PeerArtifact>
}

/**
 * Callback fired whenever a peer is registered or unregistered. Useful
 * for persisting the peer list to disk so it survives restarts.
 */
export type PeerRegistryChangeHandler = (
  record: PeerRecord,
  action: 'register' | 'unregister'
) => void | Promise<void>

export interface PeerRegistryOptions {
  /** Transport used for remote peers. Required to register remote peers. */
  remoteTransport?: RemotePeerTransport
  /** Notified on every register/unregister. */
  onChange?: PeerRegistryChangeHandler
}

/**
 * Registry that unifies local and remote agent peers under a single
 * `invokePeer(cardId, task)` entry point.
 *
 * Concurrency policy (maxParallel / maxChildRuns) is intentionally **not**
 * enforced here — that remains the responsibility of the
 * `DelegationRuntime` policy layer. The registry is purely about
 * addressing and dispatch.
 */
export class PeerRegistry {
  private readonly locals = new Map<string, LocalPeerHandle>()
  private readonly remotes = new Map<string, AgentCard>()
  private readonly remoteTransport?: RemotePeerTransport
  private readonly onChange?: PeerRegistryChangeHandler

  constructor(options: PeerRegistryOptions = {}) {
    this.remoteTransport = options.remoteTransport
    this.onChange = options.onChange
  }

  /**
   * Register a local (in-process) peer.
   * @returns the cardId the peer was registered under.
   */
  async registerLocal(handle: LocalPeerHandle): Promise<string> {
    const cardId = handle.card.id
    this.locals.set(cardId, handle)
    // A local peer is also implicitly a remote-capable address — its
    // AgentCard is available so peers can discover it. We do not store
    // it in `remotes` (that's for HTTP-only peers), but we do emit a
    // change event so persistence layers can record the card.
    await this.emitChange(
      { kind: 'local', cardId, handleRef: cardId },
      'register'
    )
    return cardId
  }

  /**
   * Register a remote peer discovered via its AgentCard.
   * @returns the cardId the peer was registered under.
   * @throws if no `remoteTransport` was supplied to the constructor.
   */
  async registerRemote(card: AgentCard): Promise<string> {
    if (!this.remoteTransport) {
      throw new Error(
        'PeerRegistry cannot register remote peers without a remoteTransport'
      )
    }
    const parsed = AgentCardSchema.parse(card)
    this.remotes.set(parsed.id, parsed)
    await this.emitChange({ kind: 'remote', card: parsed }, 'register')
    return parsed.id
  }

  /**
   * Remove a peer from the registry (local or remote).
   */
  async unregister(cardId: string): Promise<boolean> {
    const local = this.locals.get(cardId)
    if (local) {
      this.locals.delete(cardId)
      await this.emitChange(
        { kind: 'local', cardId, handleRef: cardId },
        'unregister'
      )
      return true
    }
    const remote = this.remotes.get(cardId)
    if (remote) {
      this.remotes.delete(cardId)
      await this.emitChange({ kind: 'remote', card: remote }, 'unregister')
      return true
    }
    return false
  }

  /** Look up a peer by cardId. Returns `undefined` if not registered. */
  get(cardId: string): PeerRecord | undefined {
    const local = this.locals.get(cardId)
    if (local) {
      return PeerRecordSchema.parse({
        kind: 'local',
        cardId,
        handleRef: cardId
      })
    }
    const remote = this.remotes.get(cardId)
    if (remote) {
      return PeerRecordSchema.parse({ kind: 'remote', card: remote })
    }
    return undefined
  }

  /** The AgentCard for a registered peer, or `undefined`. */
  getCard(cardId: string): AgentCard | undefined {
    return this.locals.get(cardId)?.card ?? this.remotes.get(cardId)
  }

  /** All registered card ids (local + remote). */
  list(): string[] {
    return [...this.locals.keys(), ...this.remotes.keys()]
  }

  /** Count of registered peers. */
  get size(): number {
    return this.locals.size + this.remotes.size
  }

  /**
   * Invoke a task on the peer identified by `cardId`.
   *
   * Dispatches to the local handle (no network hop) or to the remote
   * transport (HTTP) depending on how the peer was registered.
   *
   * @throws if the peer is unknown or the registry lacks a transport
   *   for a remote peer.
   */
  async invokePeer(
    cardId: string,
    task: PeerTask,
    signal: AbortSignal
  ): Promise<PeerArtifact> {
    const parsedTask = PeerTaskSchema.parse(task)
    const local = this.locals.get(cardId)
    if (local) {
      const artifact = await local.invoke(parsedTask, signal)
      return PeerArtifactSchema.parse(artifact)
    }
    const remote = this.remotes.get(cardId)
    if (remote) {
      if (!this.remoteTransport) {
        throw new Error(
          `PeerRegistry cannot invoke remote peer ${cardId}: no transport configured`
        )
      }
      const artifact = await this.remoteTransport.invokeRemote(
        remote,
        parsedTask,
        signal
      )
      return PeerArtifactSchema.parse(artifact)
    }
    throw new Error(`PeerRegistry: unknown peer ${cardId}`)
  }

  private async emitChange(
    record: PeerRecord,
    action: 'register' | 'unregister'
  ): Promise<void> {
    await this.onChange?.(record, action)
  }
}

/**
 * File-backed persistence for a PeerRegistry's remote peers.
 *
 * Local peers are intentionally **not** persisted — they reference
 * in-process handles that cannot survive a restart. Remote peers
 * (pure data) are persisted to `<dir>/peers.json` so a restart can
 * re-establish A2A connections automatically.
 */
export class FilePeerStore {
  constructor(private readonly dir: string) {}

  async load(): Promise<AgentCard[]> {
    try {
      const text = await readFile(join(this.dir, 'peers.json'), 'utf8')
      const raw = JSON.parse(text) as unknown
      if (!Array.isArray(raw)) return []
      const cards: AgentCard[] = []
      for (const entry of raw) {
        const parsed = AgentCardSchema.safeParse(entry)
        if (parsed.success) cards.push(parsed.data)
      }
      return cards
    } catch {
      return []
    }
  }

  async save(cards: readonly AgentCard[]): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    await writeFile(
      join(this.dir, 'peers.json'),
      JSON.stringify(cards, null, 2),
      'utf8'
    )
  }
}
