import { randomUUID } from 'node:crypto'
import type { EngineStreamSink, ModelClient, ModelRequest, ModelStreamChunk } from '@qiongqi/ports'
import { ModelProposalSchema, type ImmutableProfileRef, type ModelProposal, type RunIdentity, type TaskScope } from '@qiongqi/contracts'
import type { EffectResultStore } from '@qiongqi/ports'
import { digestValue } from './effect-commit.js'
import { modelLogicalRequestKey, modelRequestFingerprint } from './execution-fingerprint.js'
import type { ExecutionLedgerService } from './execution-ledger-service.js'
import { makeModelProposal, normalizeModelCompletion } from './model-protocol-normalizer.js'

export type ModelProposalRunnerOptions = {
  client: ModelClient
  ledger?: ExecutionLedgerService
  results?: EffectResultStore
  provider?: string
  endpointFormat?: 'chat_completions' | 'responses' | 'messages'
  stream?: EngineStreamSink
  onDelta?: (
    chunk: ModelStreamChunk,
    request: ModelRequest,
    context: ModelProposalDeltaContext
  ) => Promise<void> | void
  onUsage?: (
    usage: Extract<ModelStreamChunk, { kind: 'usage' }>['usage'],
    request: ModelRequest
  ) => Promise<void> | void
}

export type ModelProposalDeltaContext = {
  proposalId: string
}

export type DurableModelAttempt = {
  identity: RunIdentity
  scope: TaskScope
  kernelRunId: string
  taskRevision: number
  contextRevision: number
  strategyRevision: number
  strategyDigest: string
  profileRef: ImmutableProfileRef
  operationId: string
}

export type DurableModelProposalRunInput = {
  request: ModelRequest
  attempt: DurableModelAttempt
}

export class ModelResolutionRequiredError extends Error {
  readonly outcome = {
    status: 'suspended' as const,
    reason: 'runtime_error' as const,
    retryable: true,
    details: { waitingState: 'waiting_model_resolution' }
  }

  constructor(message: string) {
    super(message)
    this.name = 'ModelResolutionRequiredError'
  }
}

export class ModelProposalRunner {
  constructor(private readonly options: ModelProposalRunnerOptions) {}

  async run(input: ModelRequest | DurableModelProposalRunInput): Promise<ModelProposal> {
    if (isDurableInput(input)) return this.runDurable(input)
    return this.invoke(input)
  }

  private async runDurable(input: DurableModelProposalRunInput): Promise<ModelProposal> {
    const { ledger, results } = this.options
    if (!ledger || !results) {
      throw new Error('durable model execution requires ledger and result store')
    }
    const { abortSignal: _abortSignal, ...physicalRequest } = input.request
    const logical = {
      scope: input.attempt.scope,
      kernelRunId: input.attempt.kernelRunId,
      taskRevision: input.attempt.taskRevision,
      contextRevision: input.attempt.contextRevision,
      strategyDigest: input.attempt.strategyDigest
    }
    const logicalRequestKey = modelLogicalRequestKey(logical)
    const requestFingerprint = modelRequestFingerprint({
      logical,
      profileRef: input.attempt.profileRef,
      request: physicalRequest
    })
    const preparation = await ledger.prepareModel({
      ...input.attempt,
      runId: input.attempt.identity.runId,
      logicalRequestKey,
      requestFingerprint
    })
    if (preparation.action === 'resolution-required') {
      throw new ModelResolutionRequiredError(preparation.reason)
    }
    if (preparation.action === 'replay') {
      const stored = await results.load(input.attempt.identity, preparation.previous.resultRef!)
      if (!stored) {
        throw new ModelResolutionRequiredError(
          `model result ${preparation.previous.resultRef} is unavailable for replay`
        )
      }
      return ModelProposalSchema.parse(stored.result)
    }

    let running = preparation.entry
    let proposal: ModelProposal
    try {
      running = await ledger.markModelRunning({
        runId: input.attempt.identity.runId,
        entry: preparation.entry
      })
      proposal = await this.invoke(input.request, input.attempt.operationId, false)
      const resultRef = input.attempt.operationId
      await results.save(input.attempt.identity, resultRef, digestValue(proposal), proposal)
      await ledger.completeModel({
        runId: input.attempt.identity.runId,
        entry: running,
        resultRef,
        ...(proposal.usage ? { usage: proposal.usage } : {})
      })
    } catch (error) {
      await ledger.markModelUncertain({
        runId: input.attempt.identity.runId,
        entry: running
      })
      throw error
    }
    if (proposal.usage) await this.options.onUsage?.(proposal.usage, input.request)
    return proposal
  }

  private async invoke(
    request: ModelRequest,
    proposalId?: string,
    reportUsage = true
  ): Promise<ModelProposal> {
    const resolvedProposalId = proposalId ?? randomUUID()
    const chunks: ModelStreamChunk[] = []
    let usage: Extract<ModelStreamChunk, { kind: 'usage' }>['usage'] | undefined
    for await (const chunk of this.options.client.stream(request)) {
      chunks.push(chunk)
      if (chunk.kind === 'usage') usage = chunk.usage
      await publishModelChunk(this.options.stream, chunk)
      await this.options.onDelta?.(chunk, request, { proposalId: resolvedProposalId })
    }
    if (usage && reportUsage) await this.options.onUsage?.(usage, request)
    const completion = await normalizeModelCompletion(chunks, {
      provider: this.options.provider ?? this.options.client.provider,
      model: this.options.client.model,
      endpointFormat: this.options.endpointFormat
    })
    return {
      ...makeModelProposal(completion, {
        model: this.options.client.model,
        proposalId: resolvedProposalId
      }),
      ...(usage ? { usage } : {})
    }
  }
}

async function publishModelChunk(stream: EngineStreamSink | undefined, chunk: ModelStreamChunk): Promise<void> {
  if (!stream) return
  const event = modelChunkEvent(chunk)
  await stream.publish(event)
}

function modelChunkEvent(chunk: ModelStreamChunk): {
  channel: 'public' | 'private' | 'diagnostic'
  kind: string
  payload: unknown
} {
  switch (chunk.kind) {
    case 'assistant_text_delta':
      return { channel: 'public', kind: 'model.text.delta', payload: { text: chunk.text } }
    case 'assistant_reasoning_delta':
      return { channel: 'private', kind: 'model.reasoning.delta', payload: chunk }
    case 'tool_call_delta':
      return { channel: 'public', kind: 'model.tool_call.delta', payload: chunk }
    case 'tool_call_complete':
      return { channel: 'public', kind: 'model.tool_call.completed', payload: chunk }
    case 'usage':
      return { channel: 'public', kind: 'usage.updated', payload: chunk.usage }
    case 'completed':
      return { channel: 'public', kind: 'model.completed', payload: chunk }
    case 'error':
      return { channel: 'diagnostic', kind: 'model.error', payload: chunk }
  }
}

function isDurableInput(input: ModelRequest | DurableModelProposalRunInput): input is DurableModelProposalRunInput {
  return 'request' in input && 'attempt' in input
}
