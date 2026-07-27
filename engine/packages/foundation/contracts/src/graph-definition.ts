import { z } from 'zod'
import { CanonicalRecordKeySchema, IsoTimestampSchema } from './engine-identity.js'

const Key = CanonicalRecordKeySchema

export const VersionedPolicyRefSchema = z.object({
  policyId: Key,
  revision: z.number().int().positive()
}).strict()
export type VersionedPolicyRef = z.infer<typeof VersionedPolicyRefSchema>

export const ModelPolicyRefSchema = VersionedPolicyRefSchema
export type ModelPolicyRef = VersionedPolicyRef

const GraphAgentNodeSchema = z.object({
  id: Key,
  kind: z.literal('agent'),
  agentId: Key,
  label: z.string().optional(),
  modelPolicyRef: ModelPolicyRefSchema.optional(),
  nodePolicyRef: VersionedPolicyRefSchema.optional(),
  capabilities: z.array(Key).default([])
}).strict()

const GraphHandoffNodeSchema = z.object({
  id: Key,
  kind: z.literal('handoff'),
  targetAgentId: Key,
  nodePolicyRef: VersionedPolicyRefSchema.optional()
}).strict()

const GraphToolNodeSchema = z.object({
  id: Key,
  kind: z.literal('tool'),
  toolName: Key,
  nodePolicyRef: VersionedPolicyRefSchema.optional()
}).strict()

const GraphJudgeNodeSchema = z.object({
  id: Key,
  kind: z.literal('judge'),
  policy: Key,
  modelPolicyRef: ModelPolicyRefSchema.optional(),
  nodePolicyRef: VersionedPolicyRefSchema.optional()
}).strict()

const GraphJoinNodeSchema = z.object({
  id: Key,
  kind: z.literal('join'),
  requiredBranchIds: z.array(Key).default([]),
  nodePolicyRef: VersionedPolicyRefSchema.optional()
}).strict()

const GraphWaitNodeSchema = z.object({
  id: Key,
  kind: z.literal('wait'),
  waitFor: z.enum(['mailbox', 'user_input', 'approval', 'external_event']),
  nodePolicyRef: VersionedPolicyRefSchema.optional()
}).strict()

const GraphRetryNodeSchema = z.object({
  id: Key,
  kind: z.literal('retry'),
  maxAttempts: z.number().int().nonnegative().default(1),
  nodePolicyRef: VersionedPolicyRefSchema.optional()
}).strict()

const GraphTerminateNodeSchema = z.object({
  id: Key,
  kind: z.literal('terminate'),
  nodePolicyRef: VersionedPolicyRefSchema.optional()
}).strict()

export const GraphNodeV1Schema = z.discriminatedUnion('kind', [
  GraphAgentNodeSchema,
  GraphHandoffNodeSchema,
  GraphToolNodeSchema,
  GraphJudgeNodeSchema,
  GraphJoinNodeSchema,
  GraphWaitNodeSchema,
  GraphRetryNodeSchema,
  GraphTerminateNodeSchema
])
export type GraphNodeV1 = z.infer<typeof GraphNodeV1Schema>

export const GraphEdgeV1Schema = z.object({
  edgeId: Key,
  from: Key,
  to: Key,
  condition: Key,
  edgePolicyRef: VersionedPolicyRefSchema.optional()
}).strict()
export type GraphEdgeV1 = z.infer<typeof GraphEdgeV1Schema>

export const GraphDiagnosticSchema = z.object({
  code: z.enum(['agent_node_model_deprecated']),
  message: z.string().trim().min(1),
  nodeId: Key.optional()
}).strict()
export type GraphDiagnostic = z.infer<typeof GraphDiagnosticSchema>

export const GraphRevisionSchema = z.object({
  schemaVersion: z.literal(1),
  graphId: Key,
  revision: z.number().int().positive(),
  graphDigest: z.string().regex(/^[a-f0-9]{64}$/),
  startNodeId: Key,
  nodes: z.array(GraphNodeV1Schema).min(1),
  edges: z.array(GraphEdgeV1Schema).default([]),
  publishedAt: IsoTimestampSchema,
  diagnostics: z.array(GraphDiagnosticSchema).default([])
}).strict()
export type GraphRevision = z.infer<typeof GraphRevisionSchema>

export const GraphManifestSchema = z.object({
  schemaVersion: z.literal(1),
  graphId: Key,
  ownerId: Key,
  latestRevision: z.number().int().positive(),
  revisionDigests: z.record(Key, z.string().regex(/^[a-f0-9]{64}$/)),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema
}).strict()
export type GraphManifest = z.infer<typeof GraphManifestSchema>
