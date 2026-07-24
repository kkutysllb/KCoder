import type { ThreadService } from '@qiongqi/services'
import type { TurnService } from '@qiongqi/services'
import type { UsageService } from '@qiongqi/services'
import type { ReviewService } from '../review-service.js'
import type { EventBus } from '@qiongqi/ports'
import type { SessionStore } from '@qiongqi/ports'
import type { ApprovalGate } from '@qiongqi/ports'
import type { UserInputGate } from '@qiongqi/ports'
import type { WorkspaceInspector } from '@qiongqi/ports'
import type { ToolHost, ToolProviderPolicy } from '@qiongqi/ports'
import type { RuntimeEventRecorder } from '@qiongqi/services'
import type { RuntimeInfoResponse, AgentCard } from '@qiongqi/contracts'
import type { A2ATaskRecord } from '../a2a-task-model.js'
import type { FileA2ATaskStore } from '../a2a-task-store.js'
import type { McpServerDiagnostic } from '@qiongqi/adapter-tools'
import type { McpSearchRuntimeDiagnostic } from '@qiongqi/adapter-tools'
import type { WebProviderDiagnostic } from '@qiongqi/adapter-tools'
import type { SkillRuntimeDiagnostics } from '@qiongqi/skills'
import type { SkillPluginDiagnostics } from '@qiongqi/skills'
import type { AttachmentDiagnostics } from '@qiongqi/contracts'
import type { AttachmentStore } from '@qiongqi/attachments'
import type { MemoryDiagnostics } from '@qiongqi/contracts'
import type { MemoryStore } from '@qiongqi/memory'
import type { ReviewTarget } from '@qiongqi/contracts'
import type { AuthService } from '../auth-service.js'
import type { QiongqiConfig } from '@qiongqi/contracts'
import type { UserDataStore } from '../user-data-store.js'
import type { PeerRegistry } from '@qiongqi/delegation'
import type { EventedV2MultiAgentRuntime, EventedV2OutboxReconciler, EventedV2RemoteAgentScheduler, EventedV2RemoteAgentWorker, EventedV2RolloutController } from '@qiongqi/loop'
import type { EventedV2WorkerRegistryStore } from '@qiongqi/ports'

export type RuntimeToolDiagnostics = {
  providers: ToolProviderPolicy[]
  mcpServers: McpServerDiagnostic[]
  mcpSearch?: McpSearchRuntimeDiagnostic
  webProviders: WebProviderDiagnostic[]
  skills: SkillRuntimeDiagnostics
  attachments: AttachmentDiagnostics
  memory: MemoryDiagnostics
}

export type StorageDiagnostics = {
  backend: 'hybrid' | 'file' | string
  available: boolean
  degraded: boolean
  reason?: string
  sqlite?: {
    available: boolean
    path?: string
    reason?: string
  }
}

export type QiongqiConfigStore = {
  read(): Promise<QiongqiConfig> | QiongqiConfig
  write(config: QiongqiConfig): Promise<QiongqiConfig> | QiongqiConfig
  snapshot?(): QiongqiConfig
}

/**
 * Dependencies that the HTTP router needs. Bundled into a single
 * type so callers can compose the runtime from the in-memory or
 * file-backed adapters without leaking concrete types into routes.
 */
export type ServerRuntime = {
  threadService: ThreadService
  turnService: TurnService
  usageService: UsageService
  reviewService?: ReviewService
  eventBus: EventBus
  sessionStore: SessionStore
  events: RuntimeEventRecorder
  approvalGate: ApprovalGate
  userInputGate: UserInputGate
  workspaceInspector: WorkspaceInspector
  toolHost?: ToolHost
  attachmentStore?: AttachmentStore
  memoryStore?: MemoryStore
  authService?: AuthService
  userDataStore?: UserDataStore
  peerRegistry?: PeerRegistry
  multiAgentRuntime?: EventedV2MultiAgentRuntime
  multiAgentOutboxReconciler?: EventedV2OutboxReconciler
  multiAgentWorkerRegistry?: EventedV2WorkerRegistryStore
  multiAgentRemoteWorker?: EventedV2RemoteAgentWorker
  multiAgentRemoteScheduler?: EventedV2RemoteAgentScheduler
  eventedV2Rollout?: EventedV2RolloutController
  runTurn(threadId: string, turnId: string): Promise<'completed' | 'failed' | 'aborted'> | void
  cancelA2ATaskTurn?(input: { threadId: string; turnId: string }): Promise<void> | void
  runReview?(input: {
    threadId: string
    turnId: string
    reviewItemId: string
    target: ReviewTarget
    model?: string
  }): Promise<'completed' | 'failed' | 'aborted'> | void
  runtimeToken: string
  insecure: boolean
  allocateSeq: (threadId: string) => number
  nowIso: () => string
  info(): RuntimeInfoResponse
  /**
   * This agent's published identity card (Stage 2). Served at
   * `/.well-known/agent-card.json` for A2A discovery.
   */
  agentCard?: AgentCard
  /** Stage 4: A2A task store for persistence. */
  a2aTaskStore?: FileA2ATaskStore
  toolDiagnostics?(): RuntimeToolDiagnostics | Promise<RuntimeToolDiagnostics>
  refreshRuntimeTools?(): Promise<void>
  refreshMcpTools?(): Promise<void>
  storageDiagnostics?(): StorageDiagnostics | Promise<StorageDiagnostics>
  configStore?: QiongqiConfigStore
  models?(): Array<Record<string, unknown>>
  skills?(): SkillRuntimeDiagnostics | Promise<SkillRuntimeDiagnostics>
  /**
   * v1 plugin diagnostics: same surface as `skills()` plus per-skill
   * `commands`, `contributions`, `permissions`, `category`, and `source`.
   * Renderer surfaces (SkillsView, contribution registry, slash menu) read
   * this to render plugin-declared UI/commands.
   */
  skillsV2?(): SkillPluginDiagnostics | Promise<SkillPluginDiagnostics>
  shutdown?(): Promise<void>
}
