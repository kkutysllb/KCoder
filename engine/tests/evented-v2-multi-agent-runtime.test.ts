import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  FileMailboxStore,
  FileMultiAgentRunStore,
  InMemoryEventedV2WorkerRegistryStore,
  InMemoryMailboxStore,
  InMemoryMultiAgentRunStore
} from '@qiongqi/adapter-storage'
import type { AgentGraph, MultiAgentRun, PeerArtifact, PeerTask } from '@qiongqi/contracts'
import { EventedV2AgentWorker, EventedV2MultiAgentRuntime, EventedV2OutboxReconciler, EventedV2RemoteAgentScheduler, EventedV2RemoteAgentWorker, defaultManagerSpecialistGraph } from '@qiongqi/loop'
import type { LeaseFence, MailboxClaimOptions, MultiAgentRunStore, MultiAgentRunUpdateOptions } from '@qiongqi/ports'

describe('EventedV2MultiAgentRuntime', () => {
  it('starts a durable multi-agent run without changing single-agent behavior', async () => {
    const runs = new InMemoryMultiAgentRunStore()
    const mailbox = new InMemoryMailboxStore()
    const runtime = new EventedV2MultiAgentRuntime({
      runs,
      mailbox,
      graph: defaultManagerSpecialistGraph({ managerAgentId: 'manager', specialistAgentId: 'researcher' }),
      ids: nextId(),
      nowIso: fixedClock()
    })

    const run = await runtime.start({
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspaceKey: 'workspace_1',
      prompt: 'Research evented v2.'
    })

    expect(run).toMatchObject({
      status: 'running',
      activeNodeId: 'manager',
      activeAgentStack: ['manager']
    })
    expect(await runs.load(run.runId)).toMatchObject({ runId: run.runId })
  })

  it('records a manager-to-specialist handoff into the durable mailbox', async () => {
    const runs = new InMemoryMultiAgentRunStore()
    const mailbox = new InMemoryMailboxStore()
    const runtime = new EventedV2MultiAgentRuntime({
      runs,
      mailbox,
      graph: defaultManagerSpecialistGraph({ managerAgentId: 'manager', specialistAgentId: 'researcher' }),
      ids: nextId(),
      nowIso: fixedClock()
    })
    const run = await runtime.start({
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspaceKey: 'workspace_1',
      prompt: 'Research evented v2.'
    })

    const next = await runtime.handoff({
      runId: run.runId,
      sourceAgentId: 'manager',
      targetAgentId: 'researcher',
      prompt: 'Summarize the current evented loop.'
    })

    expect(next.activeNodeId).toBe('researcher')
    expect(next.activeAgentStack).toEqual(['manager', 'researcher'])
    expect(next.events.map((event) => event.type)).toContain('handoff_delivered')
    expect(await mailbox.listForRun(run.runId)).toMatchObject([{ toAgentId: 'researcher', status: 'queued' }])
  })

  it('rejects a handoff when the accepted target node belongs to another agent', async () => {
    const runs = new InMemoryMultiAgentRunStore()
    const mailbox = new InMemoryMailboxStore()
    const graph: AgentGraph = {
      version: 1,
      graphId: 'manager_to_mismatched_researcher',
      startNodeId: 'manager',
      nodes: [
        { id: 'manager', kind: 'agent', agentId: 'manager', label: 'Manager' },
        { id: 'handoff_researcher', kind: 'handoff', targetAgentId: 'researcher' },
        { id: 'writer', kind: 'agent', agentId: 'writer', label: 'Writer' }
      ],
      edges: [
        { from: 'manager', to: 'handoff_researcher', condition: 'handoff' },
        { from: 'handoff_researcher', to: 'writer', condition: 'accepted' }
      ]
    }
    const runtime = new EventedV2MultiAgentRuntime({
      runs,
      mailbox,
      graph,
      ids: nextId(),
      nowIso: fixedClock()
    })
    const run = await runtime.start({
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspaceKey: 'workspace_1',
      prompt: 'Research evented v2.'
    })

    await expect(runtime.handoff({
      runId: run.runId,
      sourceAgentId: 'manager',
      targetAgentId: 'researcher',
      prompt: 'Summarize the current evented loop.'
    })).rejects.toThrow('Handoff accepted target mismatch: writer !== researcher')
  })

  it('rejects a handoff for a run created from a different graph', async () => {
    const runs = new InMemoryMultiAgentRunStore()
    const mailbox = new InMemoryMailboxStore()
    const researcherRuntime = new EventedV2MultiAgentRuntime({
      runs,
      mailbox,
      graph: defaultManagerSpecialistGraph({ managerAgentId: 'manager', specialistAgentId: 'researcher' }),
      ids: nextId(),
      nowIso: fixedClock()
    })
    const writerRuntime = new EventedV2MultiAgentRuntime({
      runs,
      mailbox,
      graph: defaultManagerSpecialistGraph({ managerAgentId: 'manager', specialistAgentId: 'writer' }),
      ids: nextId(),
      nowIso: fixedClock()
    })
    const run = await researcherRuntime.start({
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspaceKey: 'workspace_1',
      prompt: 'Research evented v2.'
    })

    await expect(writerRuntime.handoff({
      runId: run.runId,
      sourceAgentId: 'manager',
      targetAgentId: 'writer',
      prompt: 'Summarize the current evented loop.'
    })).rejects.toThrow('MultiAgentRun graph mismatch: manager_to_researcher !== manager_to_writer')
  })

  it('rejects a handoff from a non-active source agent without mutating durable state', async () => {
    const runs = new InMemoryMultiAgentRunStore()
    const mailbox = new InMemoryMailboxStore()
    const runtime = new EventedV2MultiAgentRuntime({
      runs,
      mailbox,
      graph: defaultManagerSpecialistGraph({ managerAgentId: 'manager', specialistAgentId: 'researcher' }),
      ids: nextId(),
      nowIso: fixedClock()
    })
    const run = await runtime.start({
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspaceKey: 'workspace_1',
      prompt: 'Research evented v2.'
    })

    await expect(runtime.handoff({
      runId: run.runId,
      sourceAgentId: 'writer',
      targetAgentId: 'researcher',
      prompt: 'Summarize the current evented loop.'
    })).rejects.toThrow('Handoff source mismatch: manager !== writer')

    expect(await mailbox.listForRun(run.runId)).toEqual([])
    expect(await runs.load(run.runId)).toEqual(run)
  })

  it('does not expose a mailbox message when the run update fails', async () => {
    const runs = new FailFirstUpdateAfterMutateRunStore()
    const mailbox = new InMemoryMailboxStore()
    const runtime = new EventedV2MultiAgentRuntime({
      runs,
      mailbox,
      graph: defaultManagerSpecialistGraph({ managerAgentId: 'manager', specialistAgentId: 'researcher' }),
      ids: nextId(),
      nowIso: fixedClock()
    })
    const run = await runtime.start({
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspaceKey: 'workspace_1',
      prompt: 'Research evented v2.'
    })

    await expect(runtime.handoff({
      runId: run.runId,
      sourceAgentId: 'manager',
      targetAgentId: 'researcher',
      prompt: 'Summarize the current evented loop.'
    })).rejects.toThrow('update failed once')

    expect(await mailbox.listForRun(run.runId)).toEqual([])
    expect(await runs.load(run.runId)).toEqual(run)
  })

  it('recovers a handoff after run update succeeds but mailbox enqueue fails once', async () => {
    const runs = new InMemoryMultiAgentRunStore()
    const mailbox = new FailFirstEnqueueMailboxStore()
    const runtime = new EventedV2MultiAgentRuntime({
      runs,
      mailbox,
      graph: defaultManagerSpecialistGraph({ managerAgentId: 'manager', specialistAgentId: 'researcher' }),
      ids: nextId(),
      nowIso: fixedClock()
    })
    const run = await runtime.start({
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspaceKey: 'workspace_1',
      prompt: 'Research evented v2.'
    })

    await expect(runtime.handoff({
      runId: run.runId,
      sourceAgentId: 'manager',
      targetAgentId: 'researcher',
      prompt: 'Summarize the current evented loop.'
    })).rejects.toThrow('enqueue failed once')

    expect(await mailbox.listForRun(run.runId)).toEqual([])
    expect((await runs.load(run.runId))?.activeAgentStack).toEqual(['manager', 'researcher'])
    expect((await runs.load(run.runId))?.outbox).toMatchObject([{ kind: 'mailbox_enqueue', status: 'pending' }])

    const next = await runtime.handoff({
      runId: run.runId,
      sourceAgentId: 'manager',
      targetAgentId: 'researcher',
      prompt: 'Summarize the current evented loop.'
    })

    expect(await mailbox.listForRun(run.runId)).toMatchObject([
      { fromAgentId: 'manager', toAgentId: 'researcher', status: 'queued' }
    ])
    expect(next.activeAgentStack).toEqual(['manager', 'researcher'])
    expect(next.agentRuns.filter((agentRun) => agentRun.agentId === 'researcher')).toHaveLength(1)
    expect(next.events.filter((event) => event.type === 'handoff_delivered')).toHaveLength(1)
    expect((await runs.load(run.runId))?.outbox).toMatchObject([{ kind: 'mailbox_enqueue', status: 'published' }])
  })

  it('flushes pending outbox handoffs from a new runtime instance after enqueue failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qiongqi-evented-v2-runtime-'))
    const runs = new FileMultiAgentRunStore(root)
    const graph = defaultManagerSpecialistGraph({ managerAgentId: 'manager', specialistAgentId: 'researcher' })
    const runtimeA = new EventedV2MultiAgentRuntime({
      runs,
      mailbox: new FailFirstEnqueueFileMailboxStore(root),
      graph,
      ids: nextId(),
      nowIso: fixedClock()
    })
    const runtimeB = new EventedV2MultiAgentRuntime({
      runs,
      mailbox: new FileMailboxStore(root),
      graph,
      ids: nextId(),
      nowIso: fixedClock()
    })
    try {
      const run = await runtimeA.start({
        threadId: 'thread_1',
        turnId: 'turn_1',
        workspaceKey: 'workspace_1',
        prompt: 'Research evented v2.'
      })

      await expect(runtimeA.handoff({
        runId: run.runId,
        sourceAgentId: 'manager',
        targetAgentId: 'researcher',
        prompt: 'Summarize the current evented loop.'
      })).rejects.toThrow('enqueue failed once')

      expect(await new FileMailboxStore(root).listForRun(run.runId)).toEqual([])
      expect((await runs.load(run.runId))?.outbox).toMatchObject([{ kind: 'mailbox_enqueue', status: 'pending' }])

      const recovered = await runtimeB.flushPendingOutbox(run.runId)

      expect(await new FileMailboxStore(root).listForRun(run.runId)).toMatchObject([
        { fromAgentId: 'manager', toAgentId: 'researcher', status: 'queued' }
      ])
      expect(recovered.outbox).toMatchObject([{ kind: 'mailbox_enqueue', status: 'published' }])
      expect((await runs.load(run.runId))?.outbox).toMatchObject([{ kind: 'mailbox_enqueue', status: 'published' }])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('flushes all pending outbox handoffs discovered from the run store', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qiongqi-evented-v2-runtime-'))
    const runs = new FileMultiAgentRunStore(root)
    const graph = defaultManagerSpecialistGraph({ managerAgentId: 'manager', specialistAgentId: 'researcher' })
    const runtimeA = new EventedV2MultiAgentRuntime({
      runs,
      mailbox: new FailFirstEnqueueFileMailboxStore(root),
      graph,
      ids: nextId(),
      nowIso: fixedClock()
    })
    const runtimeB = new EventedV2MultiAgentRuntime({
      runs,
      mailbox: new FileMailboxStore(root),
      graph,
      ids: nextId(),
      nowIso: fixedClock()
    })
    try {
      const run = await runtimeA.start({
        threadId: 'thread_1',
        turnId: 'turn_1',
        workspaceKey: 'workspace_1',
        prompt: 'Research evented v2.'
      })
      await expect(runtimeA.handoff({
        runId: run.runId,
        sourceAgentId: 'manager',
        targetAgentId: 'researcher',
        prompt: 'Summarize the current evented loop.'
      })).rejects.toThrow('enqueue failed once')

      const recovered = await runtimeB.flushAllPendingOutbox()

      expect(recovered.map((candidate) => candidate.runId)).toEqual([run.runId])
      expect(await new FileMailboxStore(root).listForRun(run.runId)).toMatchObject([{ status: 'queued' }])
      expect(await runs.listWithPendingOutbox()).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not requeue a handoff message that another worker already claimed', async () => {
    const runs = new InMemoryMultiAgentRunStore()
    const mailbox = new InMemoryMailboxStore()
    const runtime = new EventedV2MultiAgentRuntime({
      runs,
      mailbox,
      graph: defaultManagerSpecialistGraph({ managerAgentId: 'manager', specialistAgentId: 'researcher' }),
      ids: nextId(),
      nowIso: fixedClock()
    })
    const run = await runtime.start({
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspaceKey: 'workspace_1',
      prompt: 'Research evented v2.'
    })
    await runtime.handoff({
      runId: run.runId,
      sourceAgentId: 'manager',
      targetAgentId: 'researcher',
      prompt: 'Summarize the current evented loop.'
    })
    expect(await mailbox.claimNext('researcher')).toMatchObject({ status: 'delivered' })

    await runtime.handoff({
      runId: run.runId,
      sourceAgentId: 'manager',
      targetAgentId: 'researcher',
      prompt: 'Summarize the current evented loop.'
    })

    expect(await mailbox.listForRun(run.runId)).toMatchObject([{ status: 'delivered' }])
  })

  it('keeps concurrent identical handoffs idempotent for the same run', async () => {
    const runs = new InMemoryMultiAgentRunStore()
    const mailbox = new InMemoryMailboxStore()
    const runtime = new EventedV2MultiAgentRuntime({
      runs,
      mailbox,
      graph: defaultManagerSpecialistGraph({ managerAgentId: 'manager', specialistAgentId: 'researcher' }),
      ids: nextId(),
      nowIso: fixedClock()
    })
    const run = await runtime.start({
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspaceKey: 'workspace_1',
      prompt: 'Research evented v2.'
    })

    await Promise.all([
      runtime.handoff({
        runId: run.runId,
        sourceAgentId: 'manager',
        targetAgentId: 'researcher',
        prompt: 'Summarize the current evented loop.'
      }),
      runtime.handoff({
        runId: run.runId,
        sourceAgentId: 'manager',
        targetAgentId: 'researcher',
        prompt: 'Summarize the current evented loop.'
      })
    ])

    const messages = await mailbox.listForRun(run.runId)
    const saved = await runs.load(run.runId)
    expect(messages).toHaveLength(1)
    expect(saved?.activeAgentStack).toEqual(['manager', 'researcher'])
    expect(saved?.agentRuns.filter((agentRun) => agentRun.agentId === 'researcher')).toHaveLength(1)
    expect(saved?.events.filter((event) => event.type === 'handoff_delivered')).toHaveLength(1)
  })

  it('keeps file-backed handoffs atomic across runtime instances', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qiongqi-evented-v2-runtime-'))
    const runs = new FileMultiAgentRunStore(root)
    const mailbox = new FileMailboxStore(root)
    const graph = defaultManagerSpecialistGraph({ managerAgentId: 'manager', specialistAgentId: 'researcher' })
    const runtimeA = new EventedV2MultiAgentRuntime({
      runs,
      mailbox,
      graph,
      ids: nextId(),
      nowIso: fixedClock()
    })
    const runtimeB = new EventedV2MultiAgentRuntime({
      runs,
      mailbox,
      graph,
      ids: nextId(),
      nowIso: fixedClock()
    })
    try {
      const run = await runtimeA.start({
        threadId: 'thread_1',
        turnId: 'turn_1',
        workspaceKey: 'workspace_1',
        prompt: 'Research evented v2.'
      })

      await Promise.all([
        runtimeA.handoff({
          runId: run.runId,
          sourceAgentId: 'manager',
          targetAgentId: 'researcher',
          prompt: 'Summarize the current evented loop.'
        }),
        runtimeB.handoff({
          runId: run.runId,
          sourceAgentId: 'manager',
          targetAgentId: 'researcher',
          prompt: 'Summarize the current evented loop.'
        })
      ])

      const messages = await mailbox.listForRun(run.runId)
      const saved = await runs.load(run.runId)
      expect(messages).toHaveLength(1)
      expect(saved?.activeAgentStack).toEqual(['manager', 'researcher'])
      expect(saved?.agentRuns.filter((agentRun) => agentRun.agentId === 'researcher')).toHaveLength(1)
      expect(saved?.events.filter((event) => event.type === 'handoff_requested')).toHaveLength(1)
      expect(saved?.events.filter((event) => event.type === 'handoff_delivered')).toHaveLength(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('returns a compact trace for observability', async () => {
    const runtime = new EventedV2MultiAgentRuntime({
      runs: new InMemoryMultiAgentRunStore(),
      mailbox: new InMemoryMailboxStore(),
      graph: defaultManagerSpecialistGraph({ managerAgentId: 'manager', specialistAgentId: 'researcher' }),
      ids: nextId(),
      nowIso: fixedClock()
    })
    const run = await runtime.start({
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspaceKey: 'workspace_1',
      prompt: 'Research evented v2.'
    })
    await runtime.handoff({
      runId: run.runId,
      sourceAgentId: 'manager',
      targetAgentId: 'researcher',
      prompt: 'Summarize current loop.'
    })

    expect(await runtime.trace(run.runId)).toEqual([
      'run_started:manager',
      'handoff_requested:manager',
      'handoff_delivered:researcher'
    ])
  })

  it('returns projected timeline and aggregate metrics for management observability', async () => {
    const runtime = new EventedV2MultiAgentRuntime({
      runs: new InMemoryMultiAgentRunStore(),
      mailbox: new InMemoryMailboxStore(),
      graph: defaultManagerSpecialistGraph({ managerAgentId: 'manager', specialistAgentId: 'researcher' }),
      ids: nextId(),
      nowIso: fixedClock()
    })
    const run = await runtime.start({
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspaceKey: 'workspace_1',
      prompt: 'Research evented v2.'
    })
    await runtime.handoff({
      runId: run.runId,
      sourceAgentId: 'manager',
      targetAgentId: 'researcher',
      prompt: 'Summarize current loop.'
    })

    await expect(runtime.timeline(run.runId)).resolves.toMatchObject({
      runId: run.runId,
      events: [
        { seq: 0, type: 'run_started' },
        { seq: 1, type: 'handoff_requested' },
        { seq: 2, type: 'handoff_delivered' }
      ],
      outbox: [{ status: 'published' }]
    })
    await expect(runtime.metrics()).resolves.toMatchObject({
      totalRuns: 1,
      byStatus: { running: 1 },
      outbox: { total: 1, pending: 0, published: 1, runsWithPendingOutbox: 0 }
    })
  })

  it('claims a queued agent task, completes the mailbox message, and advances the run to termination', async () => {
    const runs = new InMemoryMultiAgentRunStore()
    const mailbox = new InMemoryMailboxStore()
    const graph = defaultManagerSpecialistGraph({ managerAgentId: 'manager', specialistAgentId: 'researcher' })
    const runtime = new EventedV2MultiAgentRuntime({
      runs,
      mailbox,
      graph,
      ids: nextId(),
      nowIso: fixedClock()
    })
    const worker = new EventedV2AgentWorker({ runtime, mailbox })
    const run = await runtime.start({
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspaceKey: 'workspace_1',
      prompt: 'Research evented v2.'
    })
    await runtime.handoff({
      runId: run.runId,
      sourceAgentId: 'manager',
      targetAgentId: 'researcher',
      prompt: 'Summarize current loop.'
    })

    const handled: string[] = []
    const result = await worker.processNext({
      agentId: 'researcher',
      handler: async ({ message }) => {
        handled.push(message.payload.prompt)
        return { condition: 'completed', summary: 'Research complete.' }
      }
    })

    const saved = await runs.load(run.runId)
    expect(result).toMatchObject({ processed: true, runId: run.runId })
    expect(handled).toEqual(['Summarize current loop.'])
    expect(await mailbox.listForRun(run.runId)).toMatchObject([{ status: 'completed' }])
    expect(saved).toMatchObject({ status: 'completed', activeNodeId: 'done' })
    expect(saved?.agentRuns.find((agentRun) => agentRun.agentId === 'researcher')).toMatchObject({
      status: 'completed',
      summary: 'Research complete.'
    })
    expect(saved?.events.map((event) => event.type)).toContain('run_completed')
  })

  it('invokes a remote peer for a queued agent task and advances the run', async () => {
    const runs = new InMemoryMultiAgentRunStore()
    const mailbox = new InMemoryMailboxStore()
    const peer = new RecordingPeerInvoker({
      peerCardId: 'peer_researcher',
      status: 'completed',
      summary: 'Remote research complete.',
      artifacts: [{
        id: 'artifact_1',
        mimeType: 'text/markdown',
        label: 'Research report',
        text: '# Remote research',
        tags: ['assistant_text'],
        isError: false
      }]
    })
    const graph = defaultManagerSpecialistGraph({ managerAgentId: 'manager', specialistAgentId: 'researcher' })
    const runtime = new EventedV2MultiAgentRuntime({
      runs,
      mailbox,
      graph,
      ids: nextId(),
      nowIso: fixedClock()
    })
    const worker = new EventedV2RemoteAgentWorker({
      runtime,
      mailbox,
      runs,
      peerInvoker: peer,
      agentPeers: { researcher: 'peer_researcher' }
    })
    const run = await runtime.start({
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspaceKey: '/workspace/project',
      prompt: 'Research evented v2.'
    })
    await runtime.handoff({
      runId: run.runId,
      sourceAgentId: 'manager',
      targetAgentId: 'researcher',
      prompt: 'Summarize current loop.'
    })

    const result = await worker.processNext({ agentId: 'researcher' })

    const saved = await runs.load(run.runId)
    expect(result).toMatchObject({ processed: true, runId: run.runId, peerCardId: 'peer_researcher' })
    expect(peer.calls).toEqual([{
      cardId: 'peer_researcher',
      task: {
        prompt: 'Summarize current loop.',
        workspace: '/workspace/project',
        label: 'evented_v2:researcher'
      }
    }])
    expect(await mailbox.listForRun(run.runId)).toMatchObject([{ status: 'completed' }])
    expect(saved).toMatchObject({ status: 'completed', activeNodeId: 'done' })
    expect(saved?.agentRuns.find((agentRun) => agentRun.agentId === 'researcher')).toMatchObject({
      status: 'completed',
      summary: 'Remote research complete.',
      peerArtifact: {
        peerCardId: 'peer_researcher',
        status: 'completed',
        artifacts: [{
          id: 'artifact_1',
          mimeType: 'text/markdown',
          label: 'Research report',
          text: '# Remote research',
          tags: ['assistant_text'],
          isError: false
        }]
      }
    })
    expect(saved?.events.find((event) => event.type === 'node_completed' && event.agentId === 'researcher')).toMatchObject({
      payload: {
        condition: 'completed',
        peerArtifact: {
          peerCardId: 'peer_researcher',
          status: 'completed'
        }
      }
    })
  })

  it('uses mailbox claim leases when configured for remote peer work', async () => {
    const runs = new InMemoryMultiAgentRunStore()
    const mailbox = new RecordingLeasedMailboxStore()
    const peer = new RecordingPeerInvoker()
    const graph = defaultManagerSpecialistGraph({ managerAgentId: 'manager', specialistAgentId: 'researcher' })
    const runtime = new EventedV2MultiAgentRuntime({
      runs,
      mailbox,
      graph,
      ids: nextId(),
      nowIso: fixedClock()
    })
    const worker = new EventedV2RemoteAgentWorker({
      runtime,
      mailbox,
      runs,
      peerInvoker: peer,
      agentPeers: { researcher: 'peer_researcher' },
      workerId: 'worker_a',
      leaseTtlMs: 5000
    })
    const run = await runtime.start({
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspaceKey: 'workspace_1',
      prompt: 'Research evented v2.'
    })
    await runtime.handoff({
      runId: run.runId,
      sourceAgentId: 'manager',
      targetAgentId: 'researcher',
      prompt: 'Summarize current loop.'
    })

    const result = await worker.processNext({ agentId: 'researcher' })

    expect(result).toMatchObject({ processed: true })
    expect(mailbox.claims).toEqual([{
      agentId: 'researcher',
      options: { holderId: 'worker_a', ttlMs: 5000 }
    }])
    expect(mailbox.completeFences).toMatchObject([{
      holderId: 'worker_a',
      epoch: 1
    }])
  })

  it('records failed peer artifacts without marking the agent run completed', async () => {
    const runs = new InMemoryMultiAgentRunStore()
    const mailbox = new InMemoryMailboxStore()
    const graph = remoteOutcomeGraph()
    const runtime = new EventedV2MultiAgentRuntime({
      runs,
      mailbox,
      graph,
      ids: nextId(),
      nowIso: fixedClock()
    })
    const worker = new EventedV2RemoteAgentWorker({
      runtime,
      mailbox,
      runs,
      peerInvoker: new RecordingPeerInvoker({
        peerCardId: 'peer_researcher',
        status: 'failed',
        error: 'remote model failed',
        artifacts: [{
          id: 'artifact_error',
          mimeType: 'text/plain',
          text: 'remote model failed',
          isError: true,
          tags: ['error']
        }]
      }),
      agentPeers: { researcher: 'peer_researcher' }
    })
    const run = await runtime.start({
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspaceKey: 'workspace_1',
      prompt: 'Research evented v2.'
    })
    await runtime.handoff({
      runId: run.runId,
      sourceAgentId: 'manager',
      targetAgentId: 'researcher',
      prompt: 'Summarize current loop.'
    })

    const result = await worker.processNext({ agentId: 'researcher' })

    const saved = await runs.load(run.runId)
    expect(result).toMatchObject({ processed: true, peerStatus: 'failed' })
    expect(await mailbox.listForRun(run.runId)).toMatchObject([{ status: 'failed' }])
    expect(saved).toMatchObject({ status: 'completed', activeNodeId: 'done' })
    expect(saved?.agentRuns.find((agentRun) => agentRun.agentId === 'researcher')).toMatchObject({
      status: 'failed',
      error: 'remote model failed',
      peerArtifact: {
        peerCardId: 'peer_researcher',
        status: 'failed',
        error: 'remote model failed',
        artifacts: [{
          id: 'artifact_error',
          mimeType: 'text/plain',
          text: 'remote model failed',
          isError: true,
          tags: ['error']
        }]
      }
    })
  })

  it('maps remote peer outcomes through a declared compensation condition', async () => {
    const runs = new InMemoryMultiAgentRunStore()
    const mailbox = new InMemoryMailboxStore()
    const graph = remoteCompensationGraph()
    const runtime = new EventedV2MultiAgentRuntime({
      runs,
      mailbox,
      graph,
      ids: nextId(),
      nowIso: fixedClock()
    })
    const worker = new EventedV2RemoteAgentWorker({
      runtime,
      mailbox,
      runs,
      peerInvoker: new RecordingPeerInvoker({
        peerCardId: 'peer_researcher',
        status: 'failed',
        error: 'remote model failed'
      }),
      agentPeers: { researcher: 'peer_researcher' },
      compensationPolicy: {
        statusConditions: { failed: 'remote_failed' }
      }
    })
    const run = await runtime.start({
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspaceKey: 'workspace_1',
      prompt: 'Research evented v2.'
    })
    await runtime.handoff({
      runId: run.runId,
      sourceAgentId: 'manager',
      targetAgentId: 'researcher',
      prompt: 'Summarize current loop.'
    })

    const result = await worker.processNext({ agentId: 'researcher' })

    expect(result).toMatchObject({ processed: true, peerStatus: 'failed' })
    expect(await runs.load(run.runId)).toMatchObject({ status: 'completed', activeNodeId: 'compensated' })
    expect((await runs.load(run.runId))?.events.find((event) =>
      event.type === 'node_completed' && event.agentId === 'researcher'
    )).toMatchObject({
      payload: { condition: 'remote_failed' }
    })
  })

  it('recovers remote mailbox completion for compensation outcomes through run outbox', async () => {
    const runs = new InMemoryMultiAgentRunStore()
    const mailbox = new FailFirstCompleteMailboxStore()
    const graph = remoteCompensationGraph()
    const runtimeA = new EventedV2MultiAgentRuntime({
      runs,
      mailbox,
      graph,
      ids: nextId(),
      nowIso: fixedClock()
    })
    const worker = new EventedV2RemoteAgentWorker({
      runtime: runtimeA,
      mailbox,
      runs,
      peerInvoker: new RecordingPeerInvoker({
        peerCardId: 'peer_researcher',
        status: 'failed',
        error: 'remote model failed'
      }),
      agentPeers: { researcher: 'peer_researcher' },
      compensationPolicy: {
        statusConditions: { failed: 'remote_failed' }
      }
    })
    const run = await runtimeA.start({
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspaceKey: 'workspace_1',
      prompt: 'Research evented v2.'
    })
    await runtimeA.handoff({
      runId: run.runId,
      sourceAgentId: 'manager',
      targetAgentId: 'researcher',
      prompt: 'Summarize current loop.'
    })

    await expect(worker.processNext({ agentId: 'researcher' })).rejects.toThrow('complete failed once')

    expect(await runs.load(run.runId)).toMatchObject({
      status: 'completed',
      activeNodeId: 'compensated',
      outbox: [
        { kind: 'mailbox_enqueue', status: 'published' },
        { kind: 'mailbox_complete', status: 'pending', messageId: expect.any(String), mailboxStatus: 'failed' }
      ]
    })
    expect(await mailbox.listForRun(run.runId)).toMatchObject([{ status: 'delivered' }])

    const runtimeB = new EventedV2MultiAgentRuntime({
      runs,
      mailbox,
      graph,
      ids: nextId(),
      nowIso: fixedClock()
    })
    const recovered = await runtimeB.flushPendingOutbox(run.runId)

    expect(recovered.outbox).toMatchObject([
      { kind: 'mailbox_enqueue', status: 'published' },
      { kind: 'mailbox_complete', status: 'published' }
    ])
    expect(await mailbox.listForRun(run.runId)).toMatchObject([{ status: 'failed' }])
  })

  it('converts remote peer cancellation into an aborted agent task', async () => {
    const runs = new InMemoryMultiAgentRunStore()
    const mailbox = new InMemoryMailboxStore()
    const graph = remoteOutcomeGraph()
    const runtime = new EventedV2MultiAgentRuntime({
      runs,
      mailbox,
      graph,
      ids: nextId(),
      nowIso: fixedClock()
    })
    const worker = new EventedV2RemoteAgentWorker({
      runtime,
      mailbox,
      runs,
      peerInvoker: {
        invokePeer: async (_cardId, _task, signal) => {
          expect(signal.aborted).toBe(true)
          throw abortError('user cancelled remote agent')
        }
      },
      agentPeers: { researcher: 'peer_researcher' }
    })
    const run = await runtime.start({
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspaceKey: 'workspace_1',
      prompt: 'Research evented v2.'
    })
    await runtime.handoff({
      runId: run.runId,
      sourceAgentId: 'manager',
      targetAgentId: 'researcher',
      prompt: 'Summarize current loop.'
    })
    const controller = new AbortController()
    controller.abort(new Error('user cancelled remote agent'))

    const result = await worker.processNext({ agentId: 'researcher', signal: controller.signal })

    expect(result).toMatchObject({ processed: true, peerStatus: 'aborted' })
    expect(await mailbox.listForRun(run.runId)).toMatchObject([{ status: 'aborted' }])
    expect(await runs.load(run.runId)).toMatchObject({
      status: 'completed',
      activeNodeId: 'done',
      agentRuns: [
        expect.objectContaining({ agentId: 'manager' }),
        expect.objectContaining({
          agentId: 'researcher',
          status: 'aborted',
          error: 'user cancelled remote agent',
          peerArtifact: {
            peerCardId: 'peer_researcher',
            status: 'aborted',
            error: 'user cancelled remote agent'
          }
        })
      ]
    })
  })

  it('times out a remote peer invocation and records an aborted agent task', async () => {
    const runs = new InMemoryMultiAgentRunStore()
    const mailbox = new InMemoryMailboxStore()
    const graph = remoteOutcomeGraph()
    const runtime = new EventedV2MultiAgentRuntime({
      runs,
      mailbox,
      graph,
      ids: nextId(),
      nowIso: fixedClock()
    })
    const worker = new EventedV2RemoteAgentWorker({
      runtime,
      mailbox,
      runs,
      timeoutMs: 1,
      peerInvoker: {
        invokePeer: async (_cardId, _task, signal) => new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      },
      agentPeers: { researcher: 'peer_researcher' }
    })
    const run = await runtime.start({
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspaceKey: 'workspace_1',
      prompt: 'Research evented v2.'
    })
    await runtime.handoff({
      runId: run.runId,
      sourceAgentId: 'manager',
      targetAgentId: 'researcher',
      prompt: 'Summarize current loop.'
    })

    const result = await worker.processNext({ agentId: 'researcher' })

    expect(result).toMatchObject({ processed: true, peerStatus: 'aborted' })
    expect(await mailbox.listForRun(run.runId)).toMatchObject([{ status: 'aborted' }])
    expect(await runs.load(run.runId)).toMatchObject({
      agentRuns: [
        expect.objectContaining({ agentId: 'manager' }),
        expect.objectContaining({
          agentId: 'researcher',
          status: 'aborted',
          error: 'evented_v2 remote agent task timed out after 1ms'
        })
      ]
    })
  })

  it('leaves a remote agent task delivered when the peer invocation fails before completion', async () => {
    const runs = new InMemoryMultiAgentRunStore()
    const mailbox = new InMemoryMailboxStore()
    const graph = defaultManagerSpecialistGraph({ managerAgentId: 'manager', specialistAgentId: 'researcher' })
    const runtime = new EventedV2MultiAgentRuntime({
      runs,
      mailbox,
      graph,
      ids: nextId(),
      nowIso: fixedClock()
    })
    const worker = new EventedV2RemoteAgentWorker({
      runtime,
      mailbox,
      runs,
      peerInvoker: {
        invokePeer: async () => {
          throw new Error('remote unavailable')
        }
      },
      agentPeers: { researcher: 'peer_researcher' }
    })
    const run = await runtime.start({
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspaceKey: 'workspace_1',
      prompt: 'Research evented v2.'
    })
    await runtime.handoff({
      runId: run.runId,
      sourceAgentId: 'manager',
      targetAgentId: 'researcher',
      prompt: 'Summarize current loop.'
    })

    await expect(worker.processNext({ agentId: 'researcher' })).rejects.toThrow('remote unavailable')

    expect(await mailbox.listForRun(run.runId)).toMatchObject([{ status: 'delivered' }])
    expect(await runs.load(run.runId)).toMatchObject({ status: 'running', activeNodeId: 'researcher' })
  })

  it('uses store lease fencing when completing an agent task', async () => {
    const runs = new FenceRequiredMultiAgentRunStore()
    const runtime = new EventedV2MultiAgentRuntime({
      runs,
      mailbox: new InMemoryMailboxStore(),
      graph: defaultManagerSpecialistGraph({ managerAgentId: 'manager', specialistAgentId: 'researcher' }),
      ids: nextId(),
      nowIso: fixedClock(),
      leaseHolderId: 'worker_a',
      leaseTtlMs: 60_000
    })
    const run = await runtime.start({
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspaceKey: 'workspace_1',
      prompt: 'Use a fenced update.'
    })

    await runtime.completeAgentTask({ runId: run.runId, agentId: 'manager', condition: 'handoff' })

    expect(runs.acquireCalls).toEqual([{ runId: run.runId, holderId: 'worker_a', ttlMs: 60_000 }])
    expect(runs.updateFences).toHaveLength(1)
    expect(runs.releaseCalls).toEqual([{ runId: run.runId, holderId: 'worker_a' }])
  })

  it('suspends the run when graph advancement reaches an external wait node', async () => {
    const runs = new InMemoryMultiAgentRunStore()
    const runtime = new EventedV2MultiAgentRuntime({
      runs,
      mailbox: new InMemoryMailboxStore(),
      graph: waitAfterManagerGraph(),
      ids: nextId(),
      nowIso: fixedClock()
    })
    const run = await runtime.start({
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspaceKey: 'workspace_1',
      prompt: 'Wait for approval.'
    })

    const next = await runtime.completeAgentTask({ runId: run.runId, agentId: 'manager', condition: 'completed' })

    expect(next).toMatchObject({ status: 'suspended', activeNodeId: 'wait_approval' })
    expect(next.events.some((event) => event.type === 'node_started' && event.nodeId === 'wait_approval')).toBe(true)
  })

  it('resumes a suspended wait node with a declared condition', async () => {
    const runs = new InMemoryMultiAgentRunStore()
    const runtime = new EventedV2MultiAgentRuntime({
      runs,
      mailbox: new InMemoryMailboxStore(),
      graph: waitToTerminateGraph(),
      ids: nextId(),
      nowIso: fixedClock()
    })
    const run = await runtime.start({
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspaceKey: 'workspace_1',
      prompt: 'Wait for approval.'
    })
    await runtime.completeAgentTask({ runId: run.runId, agentId: 'manager', condition: 'completed' })

    const next = await runtime.completeExternalNode({
      runId: run.runId,
      nodeId: 'wait_approval',
      condition: 'approved',
      payload: { approver: 'human' }
    })

    expect(next).toMatchObject({ status: 'completed', activeNodeId: 'done' })
    expect(next.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'node_completed',
        nodeId: 'wait_approval',
        payload: { condition: 'approved', approver: 'human' }
      }),
      expect.objectContaining({ type: 'run_completed', nodeId: 'done' })
    ]))
  })

  it('routes tool and judge nodes through external completion conditions', async () => {
    const runs = new InMemoryMultiAgentRunStore()
    const runtime = new EventedV2MultiAgentRuntime({
      runs,
      mailbox: new InMemoryMailboxStore(),
      graph: toolJudgeGraph(),
      ids: nextId(),
      nowIso: fixedClock()
    })
    const run = await runtime.start({
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspaceKey: 'workspace_1',
      prompt: 'Run tool then judge.'
    })

    const afterTool = await runtime.completeAgentTask({ runId: run.runId, agentId: 'manager', condition: 'completed' })
    expect(afterTool).toMatchObject({ status: 'suspended', activeNodeId: 'collect_context' })

    const afterJudge = await runtime.completeExternalNode({
      runId: run.runId,
      nodeId: 'collect_context',
      condition: 'succeeded'
    })
    expect(afterJudge).toMatchObject({ status: 'suspended', activeNodeId: 'quality_gate' })

    const done = await runtime.completeExternalNode({
      runId: run.runId,
      nodeId: 'quality_gate',
      condition: 'passed'
    })
    expect(done).toMatchObject({ status: 'completed', activeNodeId: 'done' })
  })

  it('continues through a satisfied join node to terminate the run', async () => {
    const runs = new InMemoryMultiAgentRunStore()
    const runtime = new EventedV2MultiAgentRuntime({
      runs,
      mailbox: new InMemoryMailboxStore(),
      graph: joinAfterManagerGraph(),
      ids: nextId(),
      nowIso: fixedClock()
    })
    const run = await runtime.start({
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspaceKey: 'workspace_1',
      prompt: 'Join branches.'
    })

    const next = await runtime.completeAgentTask({ runId: run.runId, agentId: 'manager', condition: 'completed' })

    expect(next).toMatchObject({ status: 'completed', activeNodeId: 'done' })
    expect(next.events.map((event) => event.type)).toContain('run_completed')
  })

  it('routes retry nodes through retry and exhausted edges using retryCounters', async () => {
    const runs = new InMemoryMultiAgentRunStore()
    const runtime = new EventedV2MultiAgentRuntime({
      runs,
      mailbox: new InMemoryMailboxStore(),
      graph: retryAfterManagerGraph(),
      ids: nextId(),
      nowIso: fixedClock()
    })
    const run = await runtime.start({
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspaceKey: 'workspace_1',
      prompt: 'Retry once.'
    })

    const retried = await runtime.completeAgentTask({ runId: run.runId, agentId: 'manager', condition: 'failed' })
    const exhausted = await runtime.completeAgentTask({ runId: run.runId, agentId: 'manager', condition: 'failed' })

    expect(retried).toMatchObject({ status: 'running', activeNodeId: 'manager', retryCounters: { retry_manager: 1 } })
    expect(retried.agentRuns.filter((agentRun) => agentRun.agentId === 'manager')).toHaveLength(2)
    expect(exhausted).toMatchObject({ status: 'completed', activeNodeId: 'done', retryCounters: { retry_manager: 2 } })
  })
})

describe('EventedV2OutboxReconciler', () => {
  it('flushes pending outbox runs and reports run ids', async () => {
    const flushed: string[][] = []
    const reconciler = new EventedV2OutboxReconciler({
      runtime: {
        flushAllPendingOutbox: async () => [
          { ...minimalRun(), runId: 'mar_a' },
          { ...minimalRun(), runId: 'mar_b' }
        ]
      },
      intervalMs: 1000,
      nowIso: fixedClock(),
      onFlush: (result) => flushed.push(result.runIds)
    })

    const result = await reconciler.flushOnce()

    expect(result).toMatchObject({ runsFlushed: 2, runIds: ['mar_a', 'mar_b'] })
    expect(flushed).toEqual([['mar_a', 'mar_b']])
  })

  it('schedules and cancels periodic outbox flushes', async () => {
    let callback: (() => void | Promise<void>) | undefined
    let cleared: unknown
    let flushes = 0
    const reconciler = new EventedV2OutboxReconciler({
      runtime: {
        flushAllPendingOutbox: async () => {
          flushes += 1
          return []
        }
      },
      intervalMs: 1000,
      nowIso: fixedClock(),
      setInterval: (fn, intervalMs) => {
        expect(intervalMs).toBe(1000)
        callback = fn
        return 'timer_1'
      },
      clearInterval: (timer) => {
        cleared = timer
      }
    })

    reconciler.start()
    await callback?.()
    reconciler.stop()

    expect(flushes).toBe(1)
    expect(cleared).toBe('timer_1')
  })
})

describe('EventedV2RemoteAgentScheduler', () => {
  it('processes each configured remote agent and reports batch results', async () => {
    const calls: string[] = []
    const scheduler = new EventedV2RemoteAgentScheduler({
      worker: {
        processNext: async ({ agentId }) => {
          calls.push(agentId)
          return { processed: agentId === 'researcher', messageId: agentId === 'researcher' ? 'msg_1' : undefined }
        }
      },
      agentIds: ['researcher', 'writer'],
      intervalMs: 1000,
      nowIso: fixedClock()
    })

    const result = await scheduler.flushOnce()

    expect(calls).toEqual(['researcher', 'writer'])
    expect(result).toMatchObject({
      agentsChecked: 2,
      messagesProcessed: 1,
      messageIds: ['msg_1']
    })
  })

  it('schedules, isolates errors, and cancels periodic remote agent polling', async () => {
    let callback: (() => void | Promise<void>) | undefined
    let cleared: unknown
    const errors: unknown[] = []
    const scheduler = new EventedV2RemoteAgentScheduler({
      worker: {
        processNext: async ({ agentId }) => {
          if (agentId === 'researcher') throw new Error('peer unavailable')
          return { processed: true, messageId: 'msg_2' }
        }
      },
      agentIds: ['researcher', 'writer'],
      intervalMs: 1000,
      nowIso: fixedClock(),
      onError: (error) => errors.push(error),
      setInterval: (fn, intervalMs) => {
        expect(intervalMs).toBe(1000)
        callback = fn
        return 'timer_1'
      },
      clearInterval: (timer) => {
        cleared = timer
      }
    })

    scheduler.start()
    await callback?.()
    scheduler.stop()

    expect(scheduler.isRunning()).toBe(false)
    expect(cleared).toBe('timer_1')
    expect(errors).toHaveLength(1)
  })

  it('reports supervision metrics for remote agent polling', async () => {
    let callback: (() => void | Promise<void>) | undefined
    const scheduler = new EventedV2RemoteAgentScheduler({
      workerId: 'worker_a',
      worker: {
        processNext: async ({ agentId }) => {
          if (agentId === 'researcher') throw new Error('peer unavailable')
          return { processed: true, messageId: 'msg_2' }
        }
      },
      agentIds: ['researcher', 'writer'],
      intervalMs: 1000,
      nowIso: sequenceClock([
        '2026-07-21T00:00:00.000Z',
        '2026-07-21T00:00:01.000Z',
        '2026-07-21T00:00:02.000Z'
      ]),
      setInterval: (fn) => {
        callback = fn
        return 'timer_1'
      },
      clearInterval: () => undefined
    })

    scheduler.start()
    await callback?.()

    expect(scheduler.snapshot()).toMatchObject({
      workerId: 'worker_a',
      status: 'running',
      health: 'degraded',
      agentIds: ['researcher', 'writer'],
      agentsConfigured: 2,
      flushesTotal: 1,
      messagesProcessedTotal: 1,
      errorsTotal: 1,
      consecutiveErrors: 1,
      lastMessageIds: ['msg_2'],
      lastFlushStartedAt: '2026-07-21T00:00:00.000Z',
      lastFlushFinishedAt: '2026-07-21T00:00:01.000Z',
      lastHeartbeatAt: '2026-07-21T00:00:01.000Z'
    })

    scheduler.stop()

    expect(scheduler.snapshot()).toMatchObject({
      status: 'stopped',
      health: 'stopped'
    })
  })

  it('records worker registry heartbeats after remote polling flushes', async () => {
    const workerRegistry = new InMemoryEventedV2WorkerRegistryStore()
    const scheduler = new EventedV2RemoteAgentScheduler({
      workerId: 'worker_registry_a',
      workerRegistry,
      heartbeatTtlMs: 60_000,
      worker: {
        processNext: async () => ({ processed: false })
      },
      agentIds: ['researcher', 'writer'],
      intervalMs: 1000,
      nowIso: sequenceClock([
        '2026-07-21T00:00:00.000Z',
        '2026-07-21T00:00:01.000Z'
      ])
    })

    await scheduler.flushOnce()

    expect(await workerRegistry.list({ nowIso: '2026-07-21T00:00:02.000Z' })).toMatchObject([
      {
        workerId: 'worker_registry_a',
        role: 'remote_agent',
        status: 'online',
        agentIds: ['researcher', 'writer'],
        heartbeatAt: '2026-07-21T00:00:01.000Z',
        expiresAt: '2026-07-21T00:01:01.000Z'
      }
    ])
  })
})

function fixedClock(): () => string {
  return () => '2026-07-21T00:00:00.000Z'
}

function sequenceClock(values: string[]): () => string {
  let index = 0
  return () => values[Math.min(index++, values.length - 1)] ?? values[values.length - 1] ?? '2026-07-21T00:00:00.000Z'
}

function nextId(): (prefix: string) => string {
  let seq = 0
  return (prefix) => `${prefix}_${++seq}`
}

function abortError(message: string): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

function minimalRun(): MultiAgentRun {
  return {
    version: 1,
    runId: 'mar_1',
    threadId: 'thread_1',
    turnId: 'turn_1',
    workspaceKey: 'workspace_1',
    status: 'running',
    graphId: 'graph_default',
    activeNodeId: 'manager',
    activeAgentStack: ['manager'],
    branchStatus: {},
    agentRuns: [],
    events: [],
    outbox: [],
    retryCounters: {},
    budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z'
  }
}

function waitAfterManagerGraph(): AgentGraph {
  return {
    version: 1,
    graphId: 'wait_after_manager',
    startNodeId: 'manager',
    nodes: [
      { id: 'manager', kind: 'agent', agentId: 'manager' },
      { id: 'wait_approval', kind: 'wait', waitFor: 'approval' }
    ],
    edges: [
      { from: 'manager', to: 'wait_approval', condition: 'completed' }
    ]
  }
}

function waitToTerminateGraph(): AgentGraph {
  return {
    version: 1,
    graphId: 'wait_to_terminate',
    startNodeId: 'manager',
    nodes: [
      { id: 'manager', kind: 'agent', agentId: 'manager' },
      { id: 'wait_approval', kind: 'wait', waitFor: 'approval' },
      { id: 'done', kind: 'terminate' }
    ],
    edges: [
      { from: 'manager', to: 'wait_approval', condition: 'completed' },
      { from: 'wait_approval', to: 'done', condition: 'approved' }
    ]
  }
}

function toolJudgeGraph(): AgentGraph {
  return {
    version: 1,
    graphId: 'tool_judge',
    startNodeId: 'manager',
    nodes: [
      { id: 'manager', kind: 'agent', agentId: 'manager' },
      { id: 'collect_context', kind: 'tool', toolName: 'read_context' },
      { id: 'quality_gate', kind: 'judge', policy: 'complete_enough' },
      { id: 'done', kind: 'terminate' }
    ],
    edges: [
      { from: 'manager', to: 'collect_context', condition: 'completed' },
      { from: 'collect_context', to: 'quality_gate', condition: 'succeeded' },
      { from: 'quality_gate', to: 'done', condition: 'passed' }
    ]
  }
}

function joinAfterManagerGraph(): AgentGraph {
  return {
    version: 1,
    graphId: 'join_after_manager',
    startNodeId: 'manager',
    nodes: [
      { id: 'manager', kind: 'agent', agentId: 'manager' },
      { id: 'join_done', kind: 'join', requiredBranchIds: [] },
      { id: 'done', kind: 'terminate' }
    ],
    edges: [
      { from: 'manager', to: 'join_done', condition: 'completed' },
      { from: 'join_done', to: 'done', condition: 'completed' }
    ]
  }
}

function retryAfterManagerGraph(): AgentGraph {
  return {
    version: 1,
    graphId: 'retry_after_manager',
    startNodeId: 'manager',
    nodes: [
      { id: 'manager', kind: 'agent', agentId: 'manager' },
      { id: 'retry_manager', kind: 'retry', maxAttempts: 1 },
      { id: 'done', kind: 'terminate' }
    ],
    edges: [
      { from: 'manager', to: 'retry_manager', condition: 'failed' },
      { from: 'retry_manager', to: 'manager', condition: 'retry' },
      { from: 'retry_manager', to: 'done', condition: 'exhausted' }
    ]
  }
}

function remoteOutcomeGraph(): AgentGraph {
  return {
    version: 1,
    graphId: 'remote_outcome',
    startNodeId: 'manager',
    nodes: [
      { id: 'manager', kind: 'agent', agentId: 'manager' },
      { id: 'handoff_researcher', kind: 'handoff', targetAgentId: 'researcher' },
      { id: 'researcher', kind: 'agent', agentId: 'researcher' },
      { id: 'done', kind: 'terminate' }
    ],
    edges: [
      { from: 'manager', to: 'handoff_researcher', condition: 'handoff' },
      { from: 'handoff_researcher', to: 'researcher', condition: 'accepted' },
      { from: 'researcher', to: 'done', condition: 'completed' },
      { from: 'researcher', to: 'done', condition: 'failed' },
      { from: 'researcher', to: 'done', condition: 'aborted' }
    ]
  }
}

function remoteCompensationGraph(): AgentGraph {
  return {
    version: 1,
    graphId: 'remote_compensation',
    startNodeId: 'manager',
    nodes: [
      { id: 'manager', kind: 'agent', agentId: 'manager' },
      { id: 'handoff_researcher', kind: 'handoff', targetAgentId: 'researcher' },
      { id: 'researcher', kind: 'agent', agentId: 'researcher' },
      { id: 'compensated', kind: 'terminate' }
    ],
    edges: [
      { from: 'manager', to: 'handoff_researcher', condition: 'handoff' },
      { from: 'handoff_researcher', to: 'researcher', condition: 'accepted' },
      { from: 'researcher', to: 'compensated', condition: 'remote_failed' }
    ]
  }
}

class FailFirstUpdateAfterMutateRunStore extends InMemoryMultiAgentRunStore implements MultiAgentRunStore {
  private updates = 0

  async update(runId: string, mutate: (current: MultiAgentRun) => MultiAgentRun | Promise<MultiAgentRun>): Promise<MultiAgentRun> {
    this.updates += 1
    if (this.updates === 1) {
      const current = await this.load(runId)
      if (!current) throw new Error(`MultiAgentRun not found: ${runId}`)
      await mutate(current)
      throw new Error('update failed once')
    }
    return super.update(runId, mutate)
  }
}

class FenceRequiredMultiAgentRunStore extends InMemoryMultiAgentRunStore {
  readonly acquireCalls: Array<{ runId: string; holderId: string; ttlMs: number }> = []
  readonly releaseCalls: Array<{ runId: string; holderId: string }> = []
  readonly updateFences: LeaseFence[] = []

  override async acquireLease(runId: string, holderId: string, ttlMs: number): Promise<{ acquired: boolean; expiresAt?: string; fence?: LeaseFence }> {
    this.acquireCalls.push({ runId, holderId, ttlMs })
    return super.acquireLease(runId, holderId, ttlMs)
  }

  override async releaseLease(runId: string, holderId: string, fence?: LeaseFence): Promise<void> {
    this.releaseCalls.push({ runId, holderId })
    return super.releaseLease(runId, holderId, fence)
  }

  override async update(
    runId: string,
    mutate: (current: MultiAgentRun) => MultiAgentRun | Promise<MultiAgentRun>,
    options: MultiAgentRunUpdateOptions = {}
  ): Promise<MultiAgentRun> {
    if (!options.fence) throw new Error('test store requires a lease fence')
    this.updateFences.push(options.fence)
    return super.update(runId, mutate, options)
  }
}

class FailFirstEnqueueMailboxStore extends InMemoryMailboxStore {
  private enqueues = 0

  async enqueue(message: Parameters<InMemoryMailboxStore['enqueue']>[0]): Promise<void> {
    this.enqueues += 1
    if (this.enqueues === 1) throw new Error('enqueue failed once')
    return super.enqueue(message)
  }
}

class FailFirstCompleteMailboxStore extends InMemoryMailboxStore {
  private completes = 0

  async complete(messageId: string, status?: 'completed' | 'failed' | 'aborted', fence?: unknown) {
    this.completes += 1
    if (this.completes === 1) throw new Error('complete failed once')
    return super.complete(messageId, status, fence as never)
  }
}

class FailFirstEnqueueFileMailboxStore extends FileMailboxStore {
  private enqueues = 0

  async enqueue(message: Parameters<FileMailboxStore['enqueue']>[0]): Promise<void> {
    this.enqueues += 1
    if (this.enqueues === 1) throw new Error('enqueue failed once')
    return super.enqueue(message)
  }
}

class RecordingLeasedMailboxStore extends InMemoryMailboxStore {
  readonly claims: Array<{ agentId: string; options?: MailboxClaimOptions }> = []
  readonly completeFences: Array<unknown> = []

  constructor() {
    super({ nowMs: () => Date.parse('2026-07-21T00:00:00.000Z') })
  }

  override async claimNext(agentId: string, options?: MailboxClaimOptions) {
    this.claims.push({ agentId, ...(options ? { options } : {}) })
    return super.claimNext(agentId, options)
  }

  override async complete(messageId: string, status?: 'completed' | 'failed' | 'aborted', fence?: unknown) {
    this.completeFences.push(fence)
    return super.complete(messageId, status, fence as never)
  }
}

class RecordingPeerInvoker {
  readonly calls: Array<{ cardId: string; task: PeerTask }> = []

  constructor(private readonly artifact: PeerArtifact = {
    peerCardId: 'peer_researcher',
    status: 'completed',
    summary: 'Remote research complete.'
  }) {}

  async invokePeer(cardId: string, task: PeerTask): Promise<PeerArtifact> {
    this.calls.push({ cardId, task })
    return { ...this.artifact, peerCardId: cardId }
  }
}
