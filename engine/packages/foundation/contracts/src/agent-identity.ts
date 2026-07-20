import { z } from 'zod'
import { RuntimeCapabilityManifest } from './capabilities.js'
import { MODEL_ENDPOINT_FORMATS } from './model-endpoint-format.js'

/**
 * # Agent Identity & AgentCard (Stage 2)
 *
 * Stage 2 introduces a discoverable, machine-readable "identity card" for
 * every Qiongqi agent instance. An `AgentCard` is the public face of an
 * agent: it tells other agents (and humans) how to reach it, what skills
 * it offers, what capabilities it has, and which model endpoint it speaks.
 *
 * The card follows the A2A (Agent-to-Agent) discovery pattern:
 *
 * 1.  An agent publishes its card at `/.well-known/agent-card.json`.
 * 2.  Peers `GET` that URL to learn about the agent.
 * 3.  Peers register the card in a {@link PeerRegistry} and invoke tasks
 *     via `invokePeer(cardId, task)`.
 *
 * ## Why a separate SkillSummary?
 *
 * The full `SkillManifestV1` lives in `@qiongqi/skills` (which depends on
 * `@qiongqi/contracts`). To keep `contracts` dependency-free at this
 * layer, we define a lightweight {@link SkillSummarySchema} that carries
 * only the public-facing fields an AgentCard consumer needs. The skills
 * package can map its full manifest onto this summary at publish time.
 */

/**
 * Lightweight, dependency-free summary of a Skill for inclusion in an
 * AgentCard. Mirrors the public fields of `SkillManifestV1` from
 * `@qiongqi/skills`.
 */
export const SkillSummarySchema = z
  .object({
    /** Stable lowercase slug (e.g. `code-review`). */
    id: z.string().min(1),
    /** Human-readable name (e.g. `Code Review`). */
    name: z.string().min(1),
    /** Semantic version of the skill. */
    version: z.string().default('0.0.0'),
    /** One-line description shown in discovery UIs. */
    description: z.string().optional(),
    /** Category bucket — matches `SkillManifestV1.category`. */
    category: z
      .enum(['development', 'review', 'planning', 'workflow', 'integration'])
      .default('workflow')
  })
  .strict()
export type SkillSummary = z.infer<typeof SkillSummarySchema>

/**
 * Model endpoint metadata advertised on an AgentCard. Consumers use this
 * to know which model provider the agent speaks and which wire formats
 * it accepts (so they can pick the cheapest compatible one).
 */
export const AgentCardModelSchema = z
  .object({
    /** Logical provider id (e.g. `deepseek`, `openai`, `vllm`). */
    provider: z.string().min(1),
    /** Default model id the agent will use when none is specified. */
    defaultModel: z.string().min(1),
    /** Wire formats accepted at the model endpoint. */
    endpointFormats: z.array(z.enum(MODEL_ENDPOINT_FORMATS)).min(1)
  })
  .strict()
export type AgentCardModel = z.infer<typeof AgentCardModelSchema>

/**
 * Standardised endpoint paths. All Qiongqi agents expose these three
 * discovery / interop endpoints; the paths are overridable for embedders
 * that proxy or relocate them.
 */
export const AgentCardEndpointsSchema = z
  .object({
    /** AgentCard discovery URL (RFC 8615 well-known convention). */
    wellKnown: z.string().default('/.well-known/agent-card.json'),
    /** A2A task-submission endpoint. */
    a2a: z.string().default('/a2a'),
    /** MCP tool-export endpoint. */
    mcp: z.string().default('/mcp')
  })
  .strict()
export type AgentCardEndpoints = z.infer<typeof AgentCardEndpointsSchema>

/**
 * An AgentCard — the public identity of a Qiongqi agent.
 *
 * Every running agent instance owns exactly one card. The card is:
 * - **Stable** across restarts for the same `dataDir` (the `id` is
 *   persisted so peers can re-establish trust).
 * - **Self-describing** — includes capabilities, skills, and model info.
 * - **Discoverable** — published at `/.well-known/agent-card.json`.
 */
export const AgentCardSchema = z
  .object({
    /**
     * Globally-unique agent identifier. Format: `qiongqi:<random>` for
     * Qiongqi-native agents, or any URI-safe string for foreign agents
     * registered into a PeerRegistry.
     */
    id: z.string().min(1),
    /** Public base URL where this agent is reachable (scheme + host + port). */
    url: z.string().url(),
    /** Display name shown in discovery UIs (e.g. `Qiongqi Coding`). */
    name: z.string().min(1),
    /** One-line description of what this agent does. */
    description: z.string().optional(),
    /** Agent software version (semver). */
    version: z.string().default('0.1.0'),
    /** Skills advertised by this agent. */
    skills: z.array(SkillSummarySchema).default([]),
    /** Runtime capability manifest (model, mcp, web, skills, ...). */
    capabilities: RuntimeCapabilityManifest,
    /** Model endpoint metadata. */
    model: AgentCardModelSchema,
    /** Standardised endpoint paths. */
    endpoints: AgentCardEndpointsSchema.default(() => AgentCardEndpointsSchema.parse({}))
  })
  .strict()
export type AgentCard = z.infer<typeof AgentCardSchema>

/**
 * A peer reference stored inside a {@link PeerRegistry}. Local peers
 * point at an in-process runtime; remote peers carry an AgentCard plus
 * the base URL used to reach them.
 */
export const PeerRecordSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('local'),
      /** The AgentCard id this peer is registered under. */
      cardId: z.string().min(1),
      /** In-process reference — opaque to the registry itself. */
      handleRef: z.string().min(1)
    })
    .strict(),
  z
    .object({
      kind: z.literal('remote'),
      card: AgentCardSchema
    })
    .strict()
])
export type PeerRecord = z.infer<typeof PeerRecordSchema>

/**
 * A task submitted to a peer via `invokePeer`. Intentionally generic —
 * the concrete execution contract is defined by the receiving agent's
 * turn service (the peer simply runs a turn with this prompt and
 * returns the resulting items).
 */
export const PeerTaskSchema = z
  .object({
    /** Free-form prompt text the peer agent should act on. */
    prompt: z.string().min(1),
    /** Optional workspace path hint for the peer. */
    workspace: z.string().optional(),
    /** Optional model override (otherwise the peer uses its default). */
    model: z.string().optional(),
    /** Optional human-readable label for diagnostics. */
    label: z.string().optional()
  })
  .strict()
export type PeerTask = z.infer<typeof PeerTaskSchema>

/**
 * The artifact returned by `invokePeer`. Contains the peer agent's
 * summary text plus optional usage accounting so callers can track
 * cost across the delegation hop.
 */
export const PeerArtifactSchema = z
  .object({
    /** Card id of the peer that produced this artifact. */
    peerCardId: z.string().min(1),
    /** Final status of the delegated turn. */
    status: z.enum(['completed', 'failed', 'aborted']),
    /** Human-readable summary of what the peer did. */
    summary: z.string().optional(),
    /** Error message when `status` is `failed` or `aborted`. */
    error: z.string().optional()
  })
  .strict()
export type PeerArtifact = z.infer<typeof PeerArtifactSchema>
