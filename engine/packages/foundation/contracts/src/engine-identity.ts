import { z } from 'zod'

/** Canonical UTC timestamp used by durable Engine v1 records. */
export const IsoTimestampSchema = z.string().refine((value) => {
  const parsed = new Date(value)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value
}, 'expected a canonical ISO-8601 UTC timestamp')
export type IsoTimestamp = z.infer<typeof IsoTimestampSchema>

/** Record keys must not transform during parsing or collide after normalization. */
export const CanonicalRecordKeySchema = z.string().min(1).refine(
  (value) => value === value.trim(),
  'record key must not have leading or trailing whitespace'
)
export type CanonicalRecordKey = z.infer<typeof CanonicalRecordKeySchema>

/** Stable owner, workspace, and task identity, independent of execution attempts. */
export const TaskScopeSchema = z.object({
  ownerId: CanonicalRecordKeySchema,
  workspaceId: CanonicalRecordKeySchema,
  taskId: CanonicalRecordKeySchema
}).strict()
export type TaskScope = z.infer<typeof TaskScopeSchema>

export const GraphCorrelationIdentitySchema = z.object({
  graphId: CanonicalRecordKeySchema,
  graphRevision: z.number().int().positive(),
  graphDigest: z.string().regex(/^[a-f0-9]{64}$/),
  branchId: CanonicalRecordKeySchema.optional(),
  nodeId: CanonicalRecordKeySchema.optional(),
  edgeId: CanonicalRecordKeySchema.optional(),
  attemptId: CanonicalRecordKeySchema,
  callerId: CanonicalRecordKeySchema,
  policyRevision: z.number().int().positive()
}).strict()
export type GraphCorrelationIdentity = z.infer<typeof GraphCorrelationIdentitySchema>

export const MultiAgentRunIdentitySchema = z.object({
  scope: TaskScopeSchema,
  multiAgentRunId: CanonicalRecordKeySchema
}).strict()
export type MultiAgentRunIdentity = z.infer<typeof MultiAgentRunIdentitySchema>

export const PreviousKernelAttemptSchema = z.object({
  kernelRunId: CanonicalRecordKeySchema
}).strict()
export type PreviousKernelAttempt = z.infer<typeof PreviousKernelAttemptSchema>

const KernelRunWithMultiAgentParentSchema = z.object({
  scope: TaskScopeSchema,
  parentKind: z.literal('multi_agent'),
  multiAgentRunId: CanonicalRecordKeySchema,
  parentRunId: CanonicalRecordKeySchema,
  kernelRunId: CanonicalRecordKeySchema,
  graph: GraphCorrelationIdentitySchema.optional(),
  previousAttempt: PreviousKernelAttemptSchema.optional()
}).strict()

const KernelRunWithAgentParentSchema = z.object({
  scope: TaskScopeSchema,
  parentKind: z.literal('agent'),
  multiAgentRunId: CanonicalRecordKeySchema,
  agentRunId: CanonicalRecordKeySchema,
  parentRunId: CanonicalRecordKeySchema,
  kernelRunId: CanonicalRecordKeySchema,
  graph: GraphCorrelationIdentitySchema.optional(),
  previousAttempt: PreviousKernelAttemptSchema.optional()
}).strict()

export const KernelRunIdentitySchema = z.discriminatedUnion('parentKind', [
  KernelRunWithMultiAgentParentSchema,
  KernelRunWithAgentParentSchema
]).superRefine((identity, context) => {
  const expectedParentRunId = identity.parentKind === 'agent'
    ? identity.agentRunId
    : identity.multiAgentRunId
  if (identity.parentRunId !== expectedParentRunId) {
    context.addIssue({
      code: 'custom',
      message: 'kernel run parentRunId must match its immediate parent',
      path: ['parentRunId']
    })
  }
  if (identity.previousAttempt?.kernelRunId === identity.kernelRunId) {
    context.addIssue({
      code: 'custom',
      message: 'kernel previous attempt must differ from kernelRunId',
      path: ['previousAttempt', 'kernelRunId']
    })
  }
})
export type KernelRunIdentity = z.infer<typeof KernelRunIdentitySchema>

export const PreviousAgentAttemptSchema = z.object({
  agentRunId: CanonicalRecordKeySchema,
  kernelRunId: CanonicalRecordKeySchema
}).strict()
export type PreviousAgentAttempt = z.infer<typeof PreviousAgentAttemptSchema>

export const AgentRunIdentitySchema = z.object({
  scope: TaskScopeSchema,
  multiAgentRunId: CanonicalRecordKeySchema,
  parentRunId: CanonicalRecordKeySchema,
  agentRunId: CanonicalRecordKeySchema,
  agentId: CanonicalRecordKeySchema,
  nodeId: CanonicalRecordKeySchema,
  graph: GraphCorrelationIdentitySchema.optional(),
  executionRef: KernelRunIdentitySchema,
  previousAttempt: PreviousAgentAttemptSchema.optional()
}).strict().superRefine((identity, context) => {
  if (identity.parentRunId !== identity.multiAgentRunId) {
    context.addIssue({
      code: 'custom',
      message: 'agent run parentRunId must match multiAgentRunId',
      path: ['parentRunId']
    })
  }
  if (identity.previousAttempt?.agentRunId === identity.agentRunId) {
    context.addIssue({
      code: 'custom',
      message: 'agent previous attempt must differ from agentRunId',
      path: ['previousAttempt', 'agentRunId']
    })
  }
  if (identity.graph?.nodeId && identity.graph.nodeId !== identity.nodeId) {
    context.addIssue({ code: 'custom', message: 'agent graph nodeId must match identity nodeId', path: ['graph', 'nodeId'] })
  }
  if (identity.executionRef.parentKind !== 'agent'
    || identity.executionRef.multiAgentRunId !== identity.multiAgentRunId
    || identity.executionRef.agentRunId !== identity.agentRunId
    || identity.executionRef.parentRunId !== identity.agentRunId
    || encodeTaskScope(identity.executionRef.scope) !== encodeTaskScope(identity.scope)) {
    context.addIssue({
      code: 'custom',
      message: 'executionRef must identify this agent run child kernel',
      path: ['executionRef']
    })
  }
})
export type AgentRunIdentity = z.infer<typeof AgentRunIdentitySchema>

export const ModelOperationIdentitySchema = z.object({
  kind: z.literal('model'),
  scope: TaskScopeSchema,
  kernelRunId: CanonicalRecordKeySchema,
  parentRunId: CanonicalRecordKeySchema,
  operationId: CanonicalRecordKeySchema
}).strict().superRefine((identity, context) => {
  if (identity.parentRunId !== identity.kernelRunId) {
    context.addIssue({ code: 'custom', message: 'model operation parentRunId must match kernelRunId', path: ['parentRunId'] })
  }
})
export type ModelOperationIdentity = z.infer<typeof ModelOperationIdentitySchema>

export const ToolOperationIdentitySchema = z.object({
  kind: z.literal('tool'),
  scope: TaskScopeSchema,
  kernelRunId: CanonicalRecordKeySchema,
  parentRunId: CanonicalRecordKeySchema,
  operationId: CanonicalRecordKeySchema
}).strict().superRefine((identity, context) => {
  if (identity.parentRunId !== identity.kernelRunId) {
    context.addIssue({ code: 'custom', message: 'tool operation parentRunId must match kernelRunId', path: ['parentRunId'] })
  }
})
export type ToolOperationIdentity = z.infer<typeof ToolOperationIdentitySchema>

export const OperationIdentitySchema = z.discriminatedUnion('kind', [
  ModelOperationIdentitySchema,
  ToolOperationIdentitySchema
])
export type OperationIdentity = z.infer<typeof OperationIdentitySchema>

/** Deterministic task-scope encoding for durable keys and stream partitioning. */
export function encodeTaskScope(input: TaskScope): string {
  const scope = TaskScopeSchema.parse(input)
  return [
    `ownerId=${encodeURIComponent(scope.ownerId)}`,
    `workspaceId=${encodeURIComponent(scope.workspaceId)}`,
    `taskId=${encodeURIComponent(scope.taskId)}`
  ].join('|')
}

export function encodeMultiAgentRunIdentity(input: MultiAgentRunIdentity): string {
  const identity = MultiAgentRunIdentitySchema.parse(input)
  return `${encodeTaskScope(identity.scope)}|multiAgentRunId=${encodeURIComponent(identity.multiAgentRunId)}`
}

export function encodeKernelRunIdentity(input: KernelRunIdentity): string {
  const identity = KernelRunIdentitySchema.parse(input)
  return [
    encodeTaskScope(identity.scope),
    `parentKind=${identity.parentKind}`,
    `multiAgentRunId=${encodeURIComponent(identity.multiAgentRunId)}`,
    ...(identity.parentKind === 'agent' ? [`agentRunId=${encodeURIComponent(identity.agentRunId)}`] : []),
    `parentRunId=${encodeURIComponent(identity.parentRunId)}`,
    `kernelRunId=${encodeURIComponent(identity.kernelRunId)}`,
    ...(identity.previousAttempt ? [`previousKernelRunId=${encodeURIComponent(identity.previousAttempt.kernelRunId)}`] : [])
  ].join('|')
}

export function encodeAgentRunIdentity(input: AgentRunIdentity): string {
  const identity = AgentRunIdentitySchema.parse(input)
  return [
    encodeTaskScope(identity.scope),
    `multiAgentRunId=${encodeURIComponent(identity.multiAgentRunId)}`,
    `parentRunId=${encodeURIComponent(identity.parentRunId)}`,
    `agentRunId=${encodeURIComponent(identity.agentRunId)}`,
    `agentId=${encodeURIComponent(identity.agentId)}`,
    `nodeId=${encodeURIComponent(identity.nodeId)}`,
    ...(identity.previousAttempt ? [
      `previousAgentRunId=${encodeURIComponent(identity.previousAttempt.agentRunId)}`,
      `previousKernelRunId=${encodeURIComponent(identity.previousAttempt.kernelRunId)}`
    ] : []),
    `executionRef=${encodeURIComponent(encodeKernelRunIdentity(identity.executionRef))}`
  ].join('|')
}

export function encodeModelOperationIdentity(input: ModelOperationIdentity): string {
  return encodeOperationIdentity(ModelOperationIdentitySchema.parse(input))
}

export function encodeToolOperationIdentity(input: ToolOperationIdentity): string {
  return encodeOperationIdentity(ToolOperationIdentitySchema.parse(input))
}

export function encodeOperationIdentity(input: OperationIdentity): string {
  const identity = OperationIdentitySchema.parse(input)
  return [
    encodeTaskScope(identity.scope),
    `kind=${identity.kind}`,
    `parentRunId=${encodeURIComponent(identity.parentRunId)}`,
    `kernelRunId=${encodeURIComponent(identity.kernelRunId)}`,
    `operationId=${encodeURIComponent(identity.operationId)}`
  ].join('|')
}
