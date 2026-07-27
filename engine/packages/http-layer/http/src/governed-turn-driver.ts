/**
 * Governed graph turn driver — bridges the HTTP turn lifecycle to the durable
 * governed-graph execution plane (DurableEngine + EventedV2MultiAgentRuntime).
 *
 * The default HTTP runtime drives a single-AgentRun loop directly (classic /
 * kernel_v3 / evented). This driver routes a turn through a governed graph:
 * it publishes an immutable GraphRevision, starts a DurableEngine run, and
 * drives the dispatch → kernel-execute → completion cycle until the graph
 * reaches a terminal state.
 *
 * The key bridge is `startKernel`: when the governed graph traverses to an
 * agent/judge node, KernelAgentExecutor calls startKernel(input). The driver
 * runs a RuntimeKernel (the single-AgentRun Kernel execution plane) via the
 * injected runKernel callback and returns the outcome/usage as a
 * KernelExecutionResult.
 *
 * Architecture (per README): evented_v2 is the sole cross-Agent orchestration
 * plane; Kernel is the single-AgentRun isolated execution plane. This driver
 * wires the HTTP turn to both planes.
 */
import {
  AgentGraphSchema,
  BudgetStateSchema,
  type BudgetState,
  type GraphRevision,
  type RunIdentity
} from '@qiongqi/contracts'
import type { DurableEngineStore } from '@qiongqi/ports'
import {
  compileAgentGraph,
  createEngine,
  KernelAgentExecutor,
  type KernelExecutionResult,
  type PreparedAgentExecutionInput
} from '@qiongqi/loop'
import { ModelProfileRegistry } from '@qiongqi/loop'
import { validateAgentGraph, defaultManagerSpecialistGraph } from '@qiongqi/loop'
import type { DurableEngine } from '@qiongqi/loop'

const DEFAULT_BUDGET_LIMITS: BudgetState = {
  stepsUsed: 96,
  toolCallsUsed: 256,
  inputTokens: 4_000_000,
  outputTokens: 4_000_000,
  costUsd: 100
}

/**
 * A single-agent graph that exercises the full governed machinery (GraphRunRecord,
 * EngineRunRecord, RootRunAggregate, circuit, approval) without requiring a
 * multi-agent peer. One agent node runs to completion, then terminates.
 *
 * Default for KCoder's single-process deployment. The governed machinery
 * (durability, recovery, governance) is fully active; only fan-out to multiple
 * agents is absent until peers are configured.
 */
function defaultSingleAgentGraph(agentId: string) {
  const graph = AgentGraphSchema.parse({
    version: 1,
    graphId: `governed_single_${agentId}`,
    startNodeId: 'primary',
    nodes: [
      { id: 'primary', kind: 'agent', agentId, label: 'Primary Agent' },
      { id: 'done', kind: 'terminate' }
    ],
    edges: [{ from: 'primary', to: 'done', condition: 'completed' }]
  })
  return validateAgentGraph(graph)
}

/**
 * Callback that runs one Kernel execution for a governed-graph agent node.
 * Supplied by runtime-factory (it has access to kernel-v3 internals: node
 * handlers, stores, middleware). Receives the agent's execution identity +
 * turn context, returns the outcome/usage.
 */
export type RunKernelCallback = (input: {
  prepared: PreparedAgentExecutionInput
  threadId: string
  turnId: string
}) => Promise<KernelExecutionResult>

export type GovernedTurnDriverOptions = {
  store: DurableEngineStore
  agentId: string
  runKernel: RunKernelCallback
  budgetLimits?: BudgetState
  /** false → manager-specialist graph; true (default) → single-agent graph. */
  singleAgent?: boolean
  managerAgentId?: string
  specialistAgentId?: string
  nowIso?: () => string
}

export type GovernedTurnDriver = {
  runTurn(threadId: string, turnId: string): Promise<'completed' | 'degraded' | 'suspended' | 'failed' | 'aborted'>
  engine: DurableEngine
}

/**
 * Create a governed graph turn driver. Publishes the default graph revision
 * (idempotent), then drives each turn through the governed graph lifecycle.
 */
export async function createGovernedTurnDriver(
  options: GovernedTurnDriverOptions
): Promise<GovernedTurnDriver> {
  const nowIso = options.nowIso ?? (() => new Date().toISOString())
  const budgetLimits = BudgetStateSchema.parse(options.budgetLimits ?? DEFAULT_BUDGET_LIMITS)

  // Build + publish the default graph revision (idempotent by graphDigest).
  const graph = options.singleAgent === false
    ? defaultManagerSpecialistGraph({
      managerAgentId: options.managerAgentId ?? options.agentId,
      specialistAgentId: options.specialistAgentId ?? 'specialist'
    })
    : defaultSingleAgentGraph(options.agentId)
  const revision: GraphRevision = compileAgentGraph(graph, { revision: 1, publishedAt: nowIso() })

  // Per-turn context holder — startKernel closes over this so the executor
  // (constructed once) can read the current turn's threadId/turnId.
  let currentTurn: { threadId: string; turnId: string } | null = null

  const kernelExecutor = new KernelAgentExecutor({
    store: options.store,
    ids: (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    nowIso,
    startKernel: async (input: PreparedAgentExecutionInput): Promise<KernelExecutionResult> => {
      if (!currentTurn) throw new Error('governed startKernel invoked outside of a turn')
      return options.runKernel({ prepared: input, threadId: currentTurn.threadId, turnId: currentTurn.turnId })
    }
  })

  // Passthrough model registry — KCoder resolves models per-user via
  // UserScopedModelClient; governed-graph model policy validation is permissive.
  const registry = new ModelProfileRegistry()
  registry.validatePolicy = () => []

  const engine = createEngine({
    store: options.store,
    modelRegistry: registry,
    kernelExecutor,
    ids: (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    nowIso
  })

  await engine.publishGraph(revision)
  const graphRef = { graphId: revision.graphId, revision: revision.revision }

  return {
    engine,
    async runTurn(threadId, turnId) {
      currentTurn = { threadId, turnId }
      try {
        const scope = {
          ownerId: 'local-default-owner',
          workspaceId: 'local-default-workspace',
          taskId: `task_${threadId}_${turnId}`
        }
        const started = await engine.start({
          scope,
          threadId,
          turnId,
          workspaceKey: scope.workspaceId,
          prompt: '',
          modelPolicy: { authorizedProfileIds: [] },
          graphRef,
          budgetLimits
        })

        // Drive the dispatch → completion cycle until terminal.
        const multiAgentRunId = started.multiAgentRunId
        let run = await engine.inspect(multiAgentRunId)
        let safety = 0
        while (!isGraphTerminal(run.status) && safety < 10_000) {
          safety++
          await engine.flushAgentDispatches(100)
          run = await engine.inspect(multiAgentRunId)
          if (isGraphTerminal(run.status)) break
          await new Promise((resolve) => setTimeout(resolve, 5))
        }

        return graphStatusToTurnStatus(run.status)
      } finally {
        currentTurn = null
      }
    }
  }
}

function isGraphTerminal(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'aborted' || status === 'retired' || status === 'degraded'
}

function graphStatusToTurnStatus(status: string): 'completed' | 'degraded' | 'suspended' | 'failed' | 'aborted' {
  if (status === 'completed') return 'completed'
  if (status === 'degraded') return 'degraded'
  if (status === 'aborted' || status === 'retired') return 'aborted'
  if (status === 'suspended') return 'suspended'
  return 'failed'
}

export { defaultSingleAgentGraph, DEFAULT_BUDGET_LIMITS }
