import type { TurnExecutionProjectionServiceContract } from './turn-execution-projection-service.js'

export type ExecutionRevisionChangedDraft = {
  kind: 'execution_revision_changed'
  threadId: string
  turnId: string
  revision: string
}

export interface ExecutionRevisionNotifierContract {
  notify(input: { threadId: string; turnId: string }): Promise<void>
}

export type ExecutionRevisionNotifierOptions = {
  projection: Pick<TurnExecutionProjectionServiceContract, 'get'>
  record: (event: ExecutionRevisionChangedDraft) => Promise<unknown> | unknown
}

export class ExecutionRevisionNotifier implements ExecutionRevisionNotifierContract {
  private readonly inFlight = new Map<string, Promise<void>>()
  private readonly lastPublishedRevision = new Map<string, string>()

  constructor(private readonly options: ExecutionRevisionNotifierOptions) {}

  async notify(input: { threadId: string; turnId: string }): Promise<void> {
    const key = `${input.threadId}\u0000${input.turnId}`
    const pending = this.inFlight.get(key)
    if (pending) return pending

    const run = this.publish(input, key)
    this.inFlight.set(key, run)
    try {
      await run
    } finally {
      if (this.inFlight.get(key) === run) this.inFlight.delete(key)
    }
  }

  private async publish(
    input: { threadId: string; turnId: string },
    key: string
  ): Promise<void> {
    const view = await this.options.projection.get(input)
    if (!view.revision.startsWith('sha256:')) return
    if (this.lastPublishedRevision.get(key) === view.revision) return

    await this.options.record({
      kind: 'execution_revision_changed',
      threadId: input.threadId,
      turnId: input.turnId,
      revision: view.revision
    })
    this.lastPublishedRevision.set(key, view.revision)
  }
}
