import { AgentCardSchema } from '@qiongqi/contracts'
import { jsonResponse, type JsonResponse } from '../response.js'
import type { ServerRuntime } from './server-runtime.js'

/**
 * Stage 2: A2A discovery endpoint.
 *
 * Returns this agent's published {@link AgentCard} at the RFC 8615
 * well-known URL `/.well-known/agent-card.json`. The endpoint is
 * **unauthenticated** by design — the card is public discovery
 * metadata (no secrets, no per-thread data).
 *
 * Peers consume this to learn how to reach the agent, what skills it
 * offers, and which model wire format it speaks. Once they have the
 * card, they register it in their `PeerRegistry` and invoke tasks
 * via `invokePeer(cardId, task)`.
 *
 * If the runtime was not configured with an `agentCard` (e.g. older
 * embedders that haven't opted in), the endpoint returns 404 so
 * discovery probes fail fast rather than receiving a partial card.
 */
export function agentCardJsonResponse(runtime: ServerRuntime): JsonResponse {
  if (!runtime.agentCard) {
    return {
      status: 404,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ error: 'agent card not published' })
    }
  }
  // Re-validate before serving so a malformed card never escapes.
  return jsonResponse(AgentCardSchema.parse(runtime.agentCard))
}
