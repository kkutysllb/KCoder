import type { ModelClient, ModelRequest, ModelStreamChunk } from '@qiongqi/ports'
import type { ModelProposal } from '@qiongqi/contracts'
import { makeModelProposal, normalizeModelCompletion } from './model-protocol-normalizer.js'

export type ModelProposalRunnerOptions = {
  client: ModelClient
  provider?: string
  endpointFormat?: 'chat_completions' | 'responses' | 'messages'
  onDelta?: (chunk: ModelStreamChunk, request: ModelRequest) => Promise<void> | void
  onUsage?: (
    usage: Extract<ModelStreamChunk, { kind: 'usage' }>['usage'],
    request: ModelRequest
  ) => Promise<void> | void
}

export class ModelProposalRunner {
  constructor(private readonly options: ModelProposalRunnerOptions) {}

  async run(request: ModelRequest): Promise<ModelProposal> {
    const chunks: ModelStreamChunk[] = []
    let usage: Extract<ModelStreamChunk, { kind: 'usage' }>['usage'] | undefined
    for await (const chunk of this.options.client.stream(request)) {
      chunks.push(chunk)
      if (chunk.kind === 'usage') usage = chunk.usage
      await this.options.onDelta?.(chunk, request)
    }
    if (usage) await this.options.onUsage?.(usage, request)
    const completion = await normalizeModelCompletion(chunks, {
      provider: this.options.provider ?? this.options.client.provider,
      model: this.options.client.model,
      endpointFormat: this.options.endpointFormat
    })
    return {
      ...makeModelProposal(completion, { model: this.options.client.model }),
      ...(usage ? { usage } : {})
    }
  }
}
