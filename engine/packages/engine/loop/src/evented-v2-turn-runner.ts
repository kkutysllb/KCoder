import type {
  AgentGraphSnapshot,
  AgentRun,
  MultiAgentRun,
  Turn,
  TurnStatus
} from '@qiongqi/contracts'
import type { IdGenerator, MultiAgentRunStore, ThreadStore } from '@qiongqi/ports'
import type { TurnService } from '@qiongqi/services'
import {
  AgentNodeExecutor,
  type GraphBudgetLedger,
  type ManagerRouteController,
  type NodeDelegator
} from './agent-node-executor.js'
import { materializeTeamGraph } from './evented-v2-graph-template.js'
import { EventedV2MultiAgentRuntime } from './evented-v2-multi-agent-runtime.js'
import type { SpecialistRegistryContract } from './specialist-registry.js'

export type EventedV2TurnStatus = Extract<TurnStatus, 'completed' | 'failed' | 'aborted'>

export type EventedV2TurnRunnerDeps = {
  threads: ThreadStore
  turns: Pick<
    TurnService,
    | 'getTurn'
    | 'getAbortController'
    | 'linkEventedV2Run'
    | 'applyItemOnce'
    | 'finishTurn'
  >
  runs: MultiAgentRunStore
  runtimeFactory: (snapshot: AgentGraphSnapshot) => EventedV2MultiAgentRuntime
  registry: SpecialistRegistryContract
  nodeExecutor: AgentNodeExecutor
  routeToolFactory: () => ManagerRouteController
  ids: IdGenerator
  nowIso: () => string
  graphBudgetFor: (input: {
    threadId: string
    turnId: string
    runId: string
    graphSnapshot: AgentGraphSnapshot
    agentRun: AgentRun
  }) => GraphBudgetLedger
  routePolicy?: {
    specialistIds: readonly string[]
    maxActivatedSpecialists: number
    specialists?: readonly { id: string; name: string; capabilities: readonly string[] }[]
  }
  delegation?: NodeDelegator
}

export interface RuntimeTurnRunner {
  runTurn(threadId: string, turnId: string): Promise<EventedV2TurnStatus>
}

export class EventedV2TurnRunner implements RuntimeTurnRunner {
  constructor(private readonly deps: EventedV2TurnRunnerDeps) {}

  async runTurn(threadId: string, turnId: string): Promise<EventedV2TurnStatus> {
    const turn = await this.requireTurn(threadId, turnId)
    if (isTerminalTurn(turn.status)) return turn.status
    if (turn.runtimeDecision?.effectiveMode !== 'evented_v2') {
      throw new Error(`Turn is not assigned to evented_v2: ${threadId}/${turnId}`)
    }
    if (!turn.runtimeCapabilitySnapshot) {
      throw new Error(`Turn runtime capability snapshot is missing: ${threadId}/${turnId}`)
    }

    const signal = this.deps.turns.getAbortController(turnId) ?? new AbortController().signal
    let run: MultiAgentRun | undefined
    let runtime: EventedV2MultiAgentRuntime | undefined
    try {
      throwIfAborted(signal)
      ;({ run, runtime } = await this.loadOrStartRun(turn))

      if (run.status === 'running' && !run.routeDecision) {
        const planning = requireActiveAgentRun(run, 'manager_planning')
        const routeTool = this.deps.routeToolFactory()
        const planningResult = await this.deps.nodeExecutor.execute({
          threadId,
          turnId,
          runId: run.runId,
          graphPublicKey: requiredSnapshot(run).publicKey,
          agentRun: planning,
          dependencyResults: new Map(),
          routeTool,
          ...(this.deps.delegation ? { delegation: this.deps.delegation } : {}),
          graphBudget: this.graphBudget(run, planning),
          ...(this.deps.routePolicy ? { routePolicy: this.deps.routePolicy } : {}),
          signal
        })
        throwIfAborted(signal)
        const routeDecision = planningResult.routeDecision ?? routeTool.requireDecision()
        const routedSnapshot = materializeTeamGraph({
          decision: routeDecision,
          registry: this.deps.registry,
          graphPublicKey: requiredSnapshot(run).publicKey,
          budgets: requiredSnapshot(run).budgets
        })
        run = await runtime.applyRouteDecision({
          runId: run.runId,
          graphSnapshot: routedSnapshot,
          routeDecision
        })
        runtime = this.deps.runtimeFactory(routedSnapshot)
        run = await runtime.completeAgentTask({
          runId: run.runId,
          agentId: planning.agentId,
          status: 'completed',
          summary: planningResult.summary,
          ...(planningResult.usage ? { usage: planningResult.usage } : {})
        })
      }

      if (
        run.status === 'running' &&
        run.routeDecision &&
        run.activeNodeIds.includes('manager_planning')
      ) {
        const planning = requireActiveAgentRun(run, 'manager_planning')
        runtime = this.deps.runtimeFactory(requiredSnapshot(run))
        run = await runtime.completeAgentTask({
          runId: run.runId,
          agentId: planning.agentId,
          status: 'completed',
          summary: run.routeDecision.summary
        })
      }

      while (run.status === 'running') {
        throwIfAborted(signal)
        const activeRuns = run.activeNodeIds.map((nodeId) => requireActiveAgentRun(run!, nodeId))
        if (activeRuns.length === 0) {
          throw new Error(`Running MultiAgentRun has no active AgentRun: ${run.runId}`)
        }
        await Promise.all(activeRuns.map(async (agentRun) => {
          try {
            const result = await this.deps.nodeExecutor.execute({
              threadId,
              turnId,
              runId: run!.runId,
              graphPublicKey: requiredSnapshot(run!).publicKey,
              agentRun,
              ...(agentRun.phase === 'execution'
                ? { specialist: this.requireSpecialist(agentRun.agentId) }
                : {}),
              dependencyResults: completedResults(run!),
              ...(this.deps.delegation ? { delegation: this.deps.delegation } : {}),
              graphBudget: this.graphBudget(run!, agentRun),
              ...(this.deps.routePolicy ? { routePolicy: this.deps.routePolicy } : {}),
              signal
            })
            throwIfAborted(signal)
            await runtime!.completeAgentTask({
              runId: run!.runId,
              agentId: agentRun.agentId,
              status: 'completed',
              summary: result.summary,
              ...(result.usage ? { usage: result.usage } : {})
            })
          } catch (error) {
            if (isAbortError(error, signal)) throw error
            await runtime!.completeAgentTask({
              runId: run!.runId,
              agentId: agentRun.agentId,
              status: 'failed',
              error: errorMessage(error)
            })
          }
        }))
        run = await this.requireRun(run.runId)
      }

      return this.finishFromRun(turn, run)
    } catch (error) {
      if (isAbortError(error, signal)) {
        if (run && runtime) await runtime.abortRun(run.runId, abortReason(signal, error))
        const latest = await this.requireTurn(threadId, turnId)
        if (!isTerminalTurn(latest.status)) {
          await this.deps.turns.finishTurn({ threadId, turnId, status: 'aborted' })
        }
        return 'aborted'
      }
      if (run && runtime && run.status === 'running') {
        const active = run.activeNodeIds
          .map((nodeId) => run!.agentRuns.find((candidate) => candidate.nodeId === nodeId && candidate.status === 'running'))
          .find((candidate): candidate is AgentRun => Boolean(candidate))
        if (active) {
          run = await runtime.completeAgentTask({
            runId: run.runId,
            agentId: active.agentId,
            status: 'failed',
            error: errorMessage(error)
          })
        }
      }
      const latest = await this.requireTurn(threadId, turnId)
      if (!isTerminalTurn(latest.status)) {
        await this.deps.turns.finishTurn({
          threadId,
          turnId,
          status: 'failed',
          error: errorMessage(error)
        })
      }
      return 'failed'
    }
  }

  private async loadOrStartRun(turn: Turn): Promise<{
    run: MultiAgentRun
    runtime: EventedV2MultiAgentRuntime
  }> {
    if (turn.eventedV2RunId) {
      const run = await this.requireRun(turn.eventedV2RunId)
      const snapshot = requiredSnapshot(run)
      return { run, runtime: this.deps.runtimeFactory(snapshot) }
    }

    const thread = await this.deps.threads.get(turn.threadId)
    if (!thread) throw new Error(`thread not found: ${turn.threadId}`)
    const graphPublicKey = this.deps.ids.next('agent_graph')
    const provisionalSnapshot = materializeTeamGraph({
      decision: { summary: 'Manager route pending', specialists: [] },
      registry: this.deps.registry,
      graphPublicKey,
      budgets: graphBudgets(turn)
    })
    const runtime = this.deps.runtimeFactory(provisionalSnapshot)
    const started = await runtime.startRun({
      threadId: turn.threadId,
      turnId: turn.id,
      workspaceKey: thread.workspace,
      prompt: turn.prompt
    })
    const linkedRunId = await this.deps.turns.linkEventedV2Run(turn.threadId, turn.id, started.runId)
    if (linkedRunId === started.runId) return { run: started, runtime }
    const linked = await this.requireRun(linkedRunId)
    return { run: linked, runtime: this.deps.runtimeFactory(requiredSnapshot(linked)) }
  }

  private async finishFromRun(turn: Turn, run: MultiAgentRun): Promise<EventedV2TurnStatus> {
    if (run.status === 'completed') {
      const synthesis = [...run.agentRuns]
        .reverse()
        .find((agentRun) => agentRun.nodeId === 'manager_synthesis' && agentRun.status === 'completed')
      if (!synthesis?.summary) throw new Error(`Completed MultiAgentRun is missing synthesis output: ${run.runId}`)
      const now = this.deps.nowIso()
      await this.deps.turns.applyItemOnce(turn.threadId, {
        id: `item_${run.runId}_final`,
        turnId: turn.id,
        threadId: turn.threadId,
        role: 'assistant',
        status: 'completed',
        createdAt: now,
        finishedAt: now,
        kind: 'assistant_text',
        text: synthesis.summary,
        sourceRef: `evented_v2:${run.runId}:final`
      })
    }
    const status = terminalRunStatus(run)
    const latest = await this.requireTurn(turn.threadId, turn.id)
    if (!isTerminalTurn(latest.status)) {
      await this.deps.turns.finishTurn({
        threadId: turn.threadId,
        turnId: turn.id,
        status,
        ...(status === 'failed' ? { error: failedRunMessage(run) } : {})
      })
    }
    return status
  }

  private graphBudget(run: MultiAgentRun, agentRun: AgentRun): GraphBudgetLedger {
    return this.deps.graphBudgetFor({
      threadId: run.threadId,
      turnId: run.turnId,
      runId: run.runId,
      graphSnapshot: requiredSnapshot(run),
      agentRun
    })
  }

  private requireSpecialist(id: string) {
    const specialist = this.deps.registry.get(id)
    if (!specialist) throw new Error(`unknown specialist: ${id}`)
    return specialist
  }

  private async requireTurn(threadId: string, turnId: string): Promise<Turn> {
    const turn = await this.deps.turns.getTurn(threadId, turnId)
    if (!turn) throw new Error(`turn not found: ${threadId}/${turnId}`)
    return turn
  }

  private async requireRun(runId: string): Promise<MultiAgentRun> {
    const run = await this.deps.runs.load(runId)
    if (!run) throw new Error(`MultiAgentRun not found: ${runId}`)
    return run
  }
}

function graphBudgets(turn: Turn): AgentGraphSnapshot['budgets'] {
  const capability = turn.runtimeCapabilitySnapshot?.agentGraph
  if (!capability) throw new Error(`Turn AgentGraph capability snapshot is missing: ${turn.id}`)
  return {
    maxParallelNodes: capability.maxParallelNodes,
    maxActivatedSpecialists: capability.maxActivatedSpecialists,
    maxRetriesPerNode: capability.maxRetriesPerNode,
    maxDurationMs: capability.maxDurationMs
  }
}

function requiredSnapshot(run: MultiAgentRun): AgentGraphSnapshot {
  if (!run.graphSnapshot) throw new Error(`MultiAgentRun graph snapshot is missing: ${run.runId}`)
  return run.graphSnapshot
}

function requireActiveAgentRun(run: MultiAgentRun, nodeId: string): AgentRun {
  const agentRun = [...run.agentRuns]
    .reverse()
    .find((candidate) => candidate.nodeId === nodeId && candidate.status === 'running')
  if (!agentRun) throw new Error(`Active AgentRun not found: ${run.runId}/${nodeId}`)
  return agentRun
}

function completedResults(run: MultiAgentRun): ReadonlyMap<string, string> {
  const results = new Map<string, string>()
  for (const agentRun of run.agentRuns) {
    if (agentRun.status !== 'completed' || agentRun.summary === undefined) continue
    results.set(agentRun.agentId, agentRun.summary)
  }
  return results
}

function terminalRunStatus(run: MultiAgentRun): EventedV2TurnStatus {
  if (run.status === 'completed' || run.status === 'failed' || run.status === 'aborted') return run.status
  throw new Error(`MultiAgentRun is not terminal: ${run.runId}/${run.status}`)
}

function failedRunMessage(run: MultiAgentRun): string {
  const failed = [...run.agentRuns].reverse().find((agentRun) => agentRun.status === 'failed')
  return failed?.error ?? `evented_v2 execution failed: ${run.runId}`
}

function isTerminalTurn(status: TurnStatus): status is EventedV2TurnStatus {
  return status === 'completed' || status === 'failed' || status === 'aborted'
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  throw asAbortError(signal.reason)
}

function isAbortError(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && error.name === 'AbortError')
}

function asAbortError(cause: unknown): Error {
  if (cause instanceof Error && cause.name === 'AbortError') return cause
  const error = new Error(errorMessage(cause) || 'aborted')
  error.name = 'AbortError'
  return error
}

function abortReason(signal: AbortSignal, error: unknown): string {
  return errorMessage(signal.reason ?? error) || 'aborted'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '')
}
