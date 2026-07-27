import type { ToolExecutionLedgerEntry } from '@qiongqi/contracts'
import type {
  ToolCallLike,
  ToolExecutionUpdate,
  ToolHostContext,
  ToolHostResult,
  ToolProviderPolicy,
  ToolReplayDescriptor,
  ToolReplayVerification
} from './tool-host.js'

export type LocalToolReplayMetadata = {
  effectPolicy: ToolReplayDescriptor['effectPolicy']
  describe?: (
    call: ToolCallLike,
    context: ToolHostContext
  ) => Promise<Pick<ToolReplayDescriptor, 'semanticKey' | 'preconditionVersions'>>
    | Pick<ToolReplayDescriptor, 'semanticKey' | 'preconditionVersions'>
  verifyReplay?: (input: {
    call: ToolCallLike
    previous: ToolExecutionLedgerEntry
    context: ToolHostContext
  }) => Promise<ToolReplayVerification> | ToolReplayVerification
}

export type LocalTool = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  toolKind: 'tool_call' | 'command_execution' | 'file_change'
  policy: 'auto' | 'on-request' | 'suggest' | 'never' | 'untrusted'
  shouldAdvertise?: (context: ToolHostContext) => boolean
  capabilityClass?: string
  replay: LocalToolReplayMetadata
  semantic?: (
    args: Record<string, unknown>,
    context: ToolHostContext,
    result: { output: unknown; isError?: boolean },
    call: ToolCallLike
  ) => ToolHostResult['semantic'] | undefined
  execute: (
    args: Record<string, unknown>,
    context: ToolHostContext,
    onUpdate?: (update: ToolExecutionUpdate) => Promise<void> | void
  ) => Promise<{ output: unknown; isError?: boolean; semantic?: ToolHostResult['semantic'] }>
}

export type CapabilityToolProvider = ToolProviderPolicy & {
  tools: readonly LocalTool[]
}
