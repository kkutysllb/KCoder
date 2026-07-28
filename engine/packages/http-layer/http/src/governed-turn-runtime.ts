import type {
  GovernedTurnBinding,
  GraphRunRecord,
  TaskScope,
  Turn
} from '@qiongqi/contracts'
import type { GovernedDurableEngineStartInput } from '@qiongqi/loop'
import type { DurableEngineStore } from '@qiongqi/ports'
import type { ThreadService, TurnService } from '@qiongqi/services'

export type GovernedTurnEngine = {
  start(input: GovernedDurableEngineStartInput): Promise<{ multiAgentRunId: string; streamId: string }>
  inspect(runId: string): Promise<GraphRunRecord>
  cancel(runId: string): Promise<void>
}

export type GovernedTurnRuntimeOptions = {
  engine: GovernedTurnEngine
  store: Pick<DurableEngineStore, 'listGraphRuns'>
  turns: Pick<TurnService, 'getTurn' | 'bindGovernedRun' | 'finishGovernedTurn'>
  threads: Pick<ThreadService, 'get'>
  nowIso: () => string
}

/** Projects a governed GraphRun onto the ordinary public Turn lifecycle. */
export class GovernedTurnRuntime {
  private readonly queues = new Map<string, Promise<void>>()

  constructor(private readonly options: GovernedTurnRuntimeOptions) {}

  runTurn(threadId: string, turnId: string): Promise<GovernedTurnBinding> {
    return this.withTurnLock(threadId, turnId, async () => {
      const turn = await this.requireGovernedTurn(threadId, turnId)
      if (turn.governedBinding) {
        await this.inspect(threadId, turnId)
        return turn.governedBinding
      }
      const request = turn.governedExecution!
      const correlated = (await this.options.store.listGraphRuns(request.scope))
        .filter((run) => run.threadId === threadId && run.turnId === turnId)
      if (correlated.length > 1) {
        throw new Error(`multiple governed GraphRuns are correlated to Turn: ${threadId}/${turnId}`)
      }

      let started: { multiAgentRunId: string; streamId: string }
      if (correlated[0]) {
        this.assertRunMatchesTurn(correlated[0], turn)
        started = {
          multiAgentRunId: correlated[0].runId,
          streamId: `stream:${correlated[0].runId}`
        }
      } else {
        const thread = await this.options.threads.get(threadId)
        if (!thread) throw new Error(`thread not found: ${threadId}`)
        started = await this.options.engine.start({
          ...request,
          threadId,
          turnId,
          workspaceKey: thread.workspace,
          prompt: turn.prompt
        })
      }

      return this.options.turns.bindGovernedRun({
        threadId,
        turnId,
        multiAgentRunId: started.multiAgentRunId,
        streamId: started.streamId,
        graphRef: request.graphRef
      })
    })
  }

  async inspect(threadId: string, turnId: string): Promise<GraphRunRecord> {
    const turn = await this.requireGovernedTurn(threadId, turnId)
    const binding = turn.governedBinding
    if (!binding) throw new Error(`governed Turn is not bound: ${threadId}/${turnId}`)
    const run = await this.options.engine.inspect(binding.multiAgentRunId)
    this.assertRunMatchesTurn(run, turn)
    await this.projectTerminal(turn, run)
    return run
  }

  async inspectRun(runId: string): Promise<GraphRunRecord> {
    const run = await this.options.engine.inspect(runId)
    const turn = await this.options.turns.getTurn(run.threadId, run.turnId)
    if (!turn?.governedBinding || turn.governedBinding.multiAgentRunId !== runId) return run
    this.assertRunMatchesTurn(run, turn)
    await this.projectTerminal(turn, run)
    return run
  }

  async cancelTurn(threadId: string, turnId: string): Promise<void> {
    const turn = await this.requireGovernedTurn(threadId, turnId)
    if (!turn.governedBinding) throw new Error(`governed Turn is not bound: ${threadId}/${turnId}`)
    await this.options.engine.cancel(turn.governedBinding.multiAgentRunId)
  }

  private async projectTerminal(turn: Turn, run: GraphRunRecord): Promise<void> {
    if (run.status !== 'completed' && run.status !== 'failed' && run.status !== 'aborted') return
    await this.options.turns.finishGovernedTurn({
      threadId: turn.threadId,
      turnId: turn.id,
      status: run.status,
      ...(run.status === 'failed' ? { error: `governed GraphRun failed: ${run.runId}` } : {})
    })
  }

  private async requireGovernedTurn(threadId: string, turnId: string): Promise<Turn> {
    const turn = await this.options.turns.getTurn(threadId, turnId)
    if (!turn) throw new Error(`turn not found: ${turnId}`)
    if (!turn.governedExecution) throw new Error(`turn is not governed: ${turnId}`)
    return turn
  }

  private assertRunMatchesTurn(run: GraphRunRecord, turn: Turn): void {
    const request = turn.governedExecution!
    if (run.threadId !== turn.threadId
      || run.turnId !== turn.id
      || run.graphId !== request.graphRef.graphId
      || run.graphRevision !== request.graphRef.revision
      || !sameScope(run.scope, request.scope)) {
      throw new Error('governed GraphRun contradicts persisted Turn request')
    }
  }

  private async withTurnLock<T>(threadId: string, turnId: string, operation: () => Promise<T>): Promise<T> {
    const key = `${threadId}:${turnId}`
    const previous = this.queues.get(key) ?? Promise.resolve()
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const current = previous.catch(() => undefined).then(() => gate)
    this.queues.set(key, current)
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
      if (this.queues.get(key) === current) this.queues.delete(key)
    }
  }
}

function sameScope(left: TaskScope, right: TaskScope): boolean {
  return left.ownerId === right.ownerId
    && left.workspaceId === right.workspaceId
    && left.taskId === right.taskId
}
