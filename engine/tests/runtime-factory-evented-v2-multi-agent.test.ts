import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createQiongqiServeRuntime } from '@qiongqi/http'
import type { AgentCard, AgentGraph } from '@qiongqi/contracts'

type RuntimeOptions = Parameters<typeof createQiongqiServeRuntime>[0]

async function withRuntime(
  orchestrationMode: RuntimeOptions['orchestrationMode'],
  assertion: (runtime: Awaited<ReturnType<typeof createQiongqiServeRuntime>>) => void
) {
  const dataDir = await mkdtemp(join(tmpdir(), 'qiongqi-runtime-evented-v2-'))
  let runtime: Awaited<ReturnType<typeof createQiongqiServeRuntime>> | undefined
  try {
    runtime = await createQiongqiServeRuntime({
      host: '127.0.0.1',
      port: 0,
      dataDir,
      runtimeToken: 'tok',
      apiKey: 'test-key',
      baseUrl: 'http://localhost',
      model: 'test-model',
      approvalPolicy: 'never',
      sandboxMode: 'danger-full-access',
      tokenEconomyMode: false,
      insecure: true,
      ...(orchestrationMode ? { orchestrationMode } : {})
    })

    assertion(runtime)
  } finally {
    await runtime?.shutdown?.()
    await rm(dataDir, { recursive: true, force: true })
  }
}

describe('runtime factory evented_v2 multi-agent wiring', () => {
  it('attaches multiAgentRuntime only for evented_v2', async () => {
    await withRuntime('evented_v2', (runtime) => {
      expect(runtime.multiAgentRuntime).toBeDefined()
      expect(runtime.multiAgentOutboxReconciler).toBeDefined()
    })

    await withRuntime(undefined, (runtime) => {
      expect(runtime.multiAgentRuntime).toBeUndefined()
      expect(runtime.multiAgentOutboxReconciler).toBeUndefined()
    })

    await withRuntime('classic', (runtime) => {
      expect(runtime.multiAgentRuntime).toBeUndefined()
      expect(runtime.multiAgentOutboxReconciler).toBeUndefined()
    })
  })

  it('stops the evented_v2 outbox reconciler during runtime shutdown', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'qiongqi-runtime-evented-v2-'))
    const runtime = await createQiongqiServeRuntime({
      host: '127.0.0.1',
      port: 0,
      dataDir,
      runtimeToken: 'tok',
      apiKey: 'test-key',
      baseUrl: 'http://localhost',
      model: 'test-model',
      approvalPolicy: 'never',
      sandboxMode: 'danger-full-access',
      tokenEconomyMode: false,
      insecure: true,
      orchestrationMode: 'evented_v2'
    })
    let stopped = false
    const originalStop = runtime.multiAgentOutboxReconciler?.stop.bind(runtime.multiAgentOutboxReconciler)
    if (runtime.multiAgentOutboxReconciler && originalStop) {
      runtime.multiAgentOutboxReconciler.stop = () => {
        stopped = true
        originalStop()
      }
    }
    try {
      await runtime.shutdown?.()

      expect(stopped).toBe(true)
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('starts the evented_v2 outbox reconciler when runtime config enables it', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'qiongqi-runtime-evented-v2-'))
    const runtime = await createQiongqiServeRuntime({
      host: '127.0.0.1',
      port: 0,
      dataDir,
      runtimeToken: 'tok',
      apiKey: 'test-key',
      baseUrl: 'http://localhost',
      model: 'test-model',
      approvalPolicy: 'never',
      sandboxMode: 'danger-full-access',
      tokenEconomyMode: false,
      insecure: true,
      orchestrationMode: 'evented_v2',
      runtime: { eventedV2OutboxReconciler: { enabled: true, intervalMs: 10_000 } }
    })
    try {
      expect(runtime.multiAgentOutboxReconciler?.isRunning()).toBe(true)
    } finally {
      await runtime.shutdown?.()
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('loads the evented_v2 agent graph from runtime config', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'qiongqi-runtime-evented-v2-'))
    const runtime = await createQiongqiServeRuntime({
      host: '127.0.0.1',
      port: 0,
      dataDir,
      runtimeToken: 'tok',
      apiKey: 'test-key',
      baseUrl: 'http://localhost',
      model: 'test-model',
      approvalPolicy: 'never',
      sandboxMode: 'danger-full-access',
      tokenEconomyMode: false,
      insecure: true,
      orchestrationMode: 'evented_v2',
      runtime: {
        eventedV2AgentGraph: {
          version: 1,
          graphId: 'planner_wait_graph',
          startNodeId: 'planner',
          nodes: [
            { id: 'planner', kind: 'agent', agentId: 'planner' },
            { id: 'wait_approval', kind: 'wait', waitFor: 'approval' }
          ],
          edges: [
            { from: 'planner', to: 'wait_approval', condition: 'completed' }
          ]
        }
      }
    })
    try {
      const run = await runtime.multiAgentRuntime?.start({
        threadId: 'thread_1',
        turnId: 'turn_1',
        workspaceKey: 'workspace_1',
        prompt: 'Use the configured graph.'
      })

      expect(run).toMatchObject({
        graphId: 'planner_wait_graph',
        activeNodeId: 'planner',
        activeAgentStack: ['planner']
      })
    } finally {
      await runtime.shutdown?.()
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('mounts a remote agent worker from evented_v2 peer bindings', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'qiongqi-runtime-evented-v2-'))
    const runtime = await createQiongqiServeRuntime({
      host: '127.0.0.1',
      port: 0,
      dataDir,
      runtimeToken: 'tok',
      apiKey: 'test-key',
      baseUrl: 'http://localhost',
      model: 'test-model',
      approvalPolicy: 'never',
      sandboxMode: 'danger-full-access',
      tokenEconomyMode: false,
      insecure: true,
      orchestrationMode: 'evented_v2',
      runtime: {
        eventedV2AgentPeers: { specialist: 'peer_specialist' }
      }
    })
    try {
      await runtime.peerRegistry?.registerLocal({
        card: peerCard('peer_specialist'),
        invoke: async (task) => ({
          peerCardId: 'peer_specialist',
          status: 'completed',
          summary: `remote handled: ${task.prompt}`
        })
      })
      const run = await runtime.multiAgentRuntime?.start({
        threadId: 'thread_1',
        turnId: 'turn_1',
        workspaceKey: 'workspace_1',
        prompt: 'Use remote specialist.'
      })
      expect(run).toBeDefined()
      await runtime.multiAgentRuntime?.handoff({
        runId: run!.runId,
        sourceAgentId: 'Qiongqi',
        targetAgentId: 'specialist',
        prompt: 'Handle remotely.'
      })

      const result = await runtime.multiAgentRemoteWorker?.processNext({ agentId: 'specialist' })

      expect(result).toMatchObject({ processed: true, peerCardId: 'peer_specialist' })
      await expect(runtime.multiAgentRuntime?.timeline(run!.runId)).resolves.toMatchObject({
        status: 'completed',
        activeNodeId: 'done',
        agentRuns: [
          expect.objectContaining({ agentId: 'Qiongqi', status: 'running' }),
          expect.objectContaining({
            agentId: 'specialist',
            status: 'completed',
            summary: 'remote handled: Handle remotely.'
          })
        ]
      })
    } finally {
      await runtime.shutdown?.()
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('passes configured remote agent timeouts into the evented_v2 remote worker', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'qiongqi-runtime-evented-v2-'))
    const runtime = await createQiongqiServeRuntime({
      host: '127.0.0.1',
      port: 0,
      dataDir,
      runtimeToken: 'tok',
      apiKey: 'test-key',
      baseUrl: 'http://localhost',
      model: 'test-model',
      approvalPolicy: 'never',
      sandboxMode: 'danger-full-access',
      tokenEconomyMode: false,
      insecure: true,
      orchestrationMode: 'evented_v2',
      runtime: {
        eventedV2AgentGraph: remoteOutcomeGraph(),
        eventedV2AgentPeers: { specialist: 'peer_specialist' },
        eventedV2RemoteAgent: { timeoutMs: 1 }
      }
    })
    try {
      await runtime.peerRegistry?.registerLocal({
        card: peerCard('peer_specialist'),
        invoke: async (_task, signal) => new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      })
      const run = await runtime.multiAgentRuntime?.start({
        threadId: 'thread_1',
        turnId: 'turn_1',
        workspaceKey: 'workspace_1',
        prompt: 'Use remote specialist.'
      })
      expect(run).toBeDefined()
      await runtime.multiAgentRuntime?.handoff({
        runId: run!.runId,
        sourceAgentId: 'Qiongqi',
        targetAgentId: 'specialist',
        prompt: 'Handle remotely.'
      })

      const result = await runtime.multiAgentRemoteWorker?.processNext({ agentId: 'specialist' })

      expect(result).toMatchObject({ processed: true, peerStatus: 'aborted' })
      await expect(runtime.multiAgentRuntime?.timeline(run!.runId)).resolves.toMatchObject({
        agentRuns: [
          expect.objectContaining({ agentId: 'Qiongqi' }),
          expect.objectContaining({
            agentId: 'specialist',
            status: 'aborted',
            error: 'evented_v2 remote agent task timed out after 1ms'
          })
        ]
      })
    } finally {
      await runtime.shutdown?.()
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('starts and stops the evented_v2 remote agent scheduler from runtime config', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'qiongqi-runtime-evented-v2-'))
    const runtime = await createQiongqiServeRuntime({
      host: '127.0.0.1',
      port: 0,
      dataDir,
      runtimeToken: 'tok',
      apiKey: 'test-key',
      baseUrl: 'http://localhost',
      model: 'test-model',
      approvalPolicy: 'never',
      sandboxMode: 'danger-full-access',
      tokenEconomyMode: false,
      insecure: true,
      orchestrationMode: 'evented_v2',
      runtime: {
        eventedV2AgentPeers: { specialist: 'peer_specialist' },
        eventedV2RemoteAgent: {
          workerId: 'worker_runtime_a',
          heartbeatTtlMs: 60_000,
          scheduler: { enabled: true, intervalMs: 10_000 }
        }
      }
    })
    try {
      expect(runtime.multiAgentRemoteWorker).toBeDefined()
      expect(runtime.multiAgentWorkerRegistry).toBeDefined()
      expect(runtime.multiAgentRemoteScheduler?.isRunning()).toBe(true)
      expect(runtime.multiAgentRemoteScheduler?.snapshot()).toMatchObject({
        workerId: 'worker_runtime_a',
        status: 'running'
      })
      await runtime.multiAgentRemoteScheduler?.flushOnce()
      expect(await runtime.multiAgentWorkerRegistry?.list({ nowIso: runtime.nowIso() })).toMatchObject([
        {
          workerId: 'worker_runtime_a',
          role: 'remote_agent',
          status: 'online',
          agentIds: ['specialist']
        }
      ])

      await runtime.shutdown?.()

      expect(runtime.multiAgentRemoteScheduler?.isRunning()).toBe(false)
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('passes remote agent compensation conditions into the evented_v2 remote worker', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'qiongqi-runtime-evented-v2-'))
    const runtime = await createQiongqiServeRuntime({
      host: '127.0.0.1',
      port: 0,
      dataDir,
      runtimeToken: 'tok',
      apiKey: 'test-key',
      baseUrl: 'http://localhost',
      model: 'test-model',
      approvalPolicy: 'never',
      sandboxMode: 'danger-full-access',
      tokenEconomyMode: false,
      insecure: true,
      orchestrationMode: 'evented_v2',
      runtime: {
        eventedV2AgentGraph: remoteCompensationGraph(),
        eventedV2AgentPeers: { specialist: 'peer_specialist' },
        eventedV2RemoteAgent: {
          compensation: {
            statusConditions: { failed: 'remote_failed' }
          }
        }
      }
    })
    try {
      await runtime.peerRegistry?.registerLocal({
        card: peerCard('peer_specialist'),
        invoke: async () => ({
          peerCardId: 'peer_specialist',
          status: 'failed',
          error: 'remote model failed'
        })
      })
      const run = await runtime.multiAgentRuntime?.start({
        threadId: 'thread_1',
        turnId: 'turn_1',
        workspaceKey: 'workspace_1',
        prompt: 'Use remote specialist.'
      })
      expect(run).toBeDefined()
      await runtime.multiAgentRuntime?.handoff({
        runId: run!.runId,
        sourceAgentId: 'Qiongqi',
        targetAgentId: 'specialist',
        prompt: 'Handle remotely.'
      })

      const result = await runtime.multiAgentRemoteWorker?.processNext({ agentId: 'specialist' })

      expect(result).toMatchObject({ processed: true, peerStatus: 'failed' })
      await expect(runtime.multiAgentRuntime?.timeline(run!.runId)).resolves.toMatchObject({
        status: 'completed',
        activeNodeId: 'compensated',
        events: expect.arrayContaining([
          expect.objectContaining({
            agentId: 'specialist',
            payload: expect.objectContaining({ condition: 'remote_failed' })
          })
        ])
      })
    } finally {
      await runtime.shutdown?.()
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('rejects an invalid evented_v2 agent graph from runtime config', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'qiongqi-runtime-evented-v2-'))
    try {
      await expect(createQiongqiServeRuntime({
        host: '127.0.0.1',
        port: 0,
        dataDir,
        runtimeToken: 'tok',
        apiKey: 'test-key',
        baseUrl: 'http://localhost',
        model: 'test-model',
        approvalPolicy: 'never',
        sandboxMode: 'danger-full-access',
        tokenEconomyMode: false,
        insecure: true,
        orchestrationMode: 'evented_v2',
        runtime: {
          eventedV2AgentGraph: {
            version: 1,
            graphId: 'invalid_graph',
            startNodeId: 'planner',
            nodes: [
              { id: 'planner', kind: 'agent', agentId: 'planner' },
              { id: 'done', kind: 'terminate' }
            ],
            edges: [
              { from: 'planner', to: 'missing', condition: 'completed' }
            ]
          }
        }
      })).rejects.toThrow('AgentGraph edge points to unknown node: planner -> missing')
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})

function peerCard(id: string): AgentCard {
  return {
    id,
    url: 'http://peer.example.test',
    name: id,
    version: '0.0.0',
    capabilities: {
      mcp: { enabled: false, servers: {} },
      web: { enabled: false, fetchEnabled: false, searchEnabled: false },
      skills: { enabled: false },
      subagents: { enabled: false, maxParallel: 0, maxChildRuns: 0 },
      attachments: { enabled: false },
      memory: { enabled: false }
    },
    skills: [],
    model: {
      provider: 'fake',
      model: 'fake',
      endpointFormats: ['openai-chat-completions']
    },
    endpoints: {
      agentCard: '/.well-known/agent-card.json',
      a2a: '/a2a'
    }
  }
}

function remoteOutcomeGraph(): AgentGraph {
  return {
    version: 1,
    graphId: 'remote_outcome',
    startNodeId: 'manager',
    nodes: [
      { id: 'manager', kind: 'agent', agentId: 'Qiongqi' },
      { id: 'handoff_specialist', kind: 'handoff', targetAgentId: 'specialist' },
      { id: 'specialist', kind: 'agent', agentId: 'specialist' },
      { id: 'done', kind: 'terminate' }
    ],
    edges: [
      { from: 'manager', to: 'handoff_specialist', condition: 'handoff' },
      { from: 'handoff_specialist', to: 'specialist', condition: 'accepted' },
      { from: 'specialist', to: 'done', condition: 'completed' },
      { from: 'specialist', to: 'done', condition: 'failed' },
      { from: 'specialist', to: 'done', condition: 'aborted' }
    ]
  }
}

function remoteCompensationGraph(): AgentGraph {
  return {
    version: 1,
    graphId: 'remote_compensation',
    startNodeId: 'manager',
    nodes: [
      { id: 'manager', kind: 'agent', agentId: 'Qiongqi' },
      { id: 'handoff_specialist', kind: 'handoff', targetAgentId: 'specialist' },
      { id: 'specialist', kind: 'agent', agentId: 'specialist' },
      { id: 'compensated', kind: 'terminate' }
    ],
    edges: [
      { from: 'manager', to: 'handoff_specialist', condition: 'handoff' },
      { from: 'handoff_specialist', to: 'specialist', condition: 'accepted' },
      { from: 'specialist', to: 'compensated', condition: 'remote_failed' }
    ]
  }
}
