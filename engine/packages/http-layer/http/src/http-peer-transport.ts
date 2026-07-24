import type { RemotePeerTransport } from '@qiongqi/delegation'
import { ArtifactSchema, PeerArtifactSchema, type AgentCard, type PeerArtifact, type PeerTask } from '@qiongqi/contracts'
import { z } from 'zod'

const Stage4A2AResponseSchema = z.object({
  artifact: PeerArtifactSchema,
  artifacts: z.array(ArtifactSchema).optional()
}).passthrough()

/**
 * Stage 2: HTTP-based implementation of {@link RemotePeerTransport}.
 *
 * Calls a remote peer's `POST /a2a` endpoint (as advertised in its
 * AgentCard) to submit a task and returns the resulting
 * {@link PeerArtifact}.
 *
 * ## Token resolution
 *
 * A2A endpoints are authenticated, so the caller must supply an
 * authorization token. The token is resolved lazily via the
 * {@link getToken} callback so different peers can use different
 * tokens (e.g. a shared admin token vs per-instance tokens).
 *
 * Usage inside `createAgent`:
 * ```ts
 * const transport = new HttpPeerTransport({
 *   getToken: () => options.runtimeToken
 * })
 * ```
 */
export class HttpPeerTransport implements RemotePeerTransport {
  constructor(
    private readonly options: {
      /**
       * Resolve the bearer token for the given peer. Return the same
       * token for all peers (shared token) or per-peer tokens.
       * If the function returns undefined, the request is sent without
       * an Authorization header (untrusted mode).
       */
      getToken?: (cardId: string) => string | undefined
      /** Custom fetch implementation for tests. */
      fetchImpl?: typeof fetch
    } = {}
  ) {}

  async invokeRemote(
    card: AgentCard,
    task: PeerTask,
    signal: AbortSignal
  ): Promise<PeerArtifact> {
    const fetchFn = this.options.fetchImpl ?? fetch
    const a2aPath = card.endpoints?.a2a ?? '/a2a'
    const url = new URL(a2aPath, card.url).href
    const token = this.options.getToken?.(card.id)

    const headers: Record<string, string> = {
      'content-type': 'application/json'
    }
    if (token) {
      headers['authorization'] = `Bearer ${token}`
    }

    const response = await fetchFn(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(task),
      signal
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(
        `Peer ${card.id} returned ${response.status}: ${text.slice(0, 200)}`
      )
    }

    const body = await response.json()
    const legacy = PeerArtifactSchema.safeParse(body)
    if (legacy.success) return legacy.data
    const stage4 = Stage4A2AResponseSchema.parse(body)
    return PeerArtifactSchema.parse({
      ...stage4.artifact,
      ...(stage4.artifacts ? { artifacts: stage4.artifacts } : {})
    })
  }
}
