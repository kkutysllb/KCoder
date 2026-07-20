import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CapabilityRegistry } from '@qiongqi/adapter-tools'
import { LocalToolHost } from '@qiongqi/adapter-tools'
import { buildMemoryToolProviders } from '@qiongqi/adapter-tools'
import { QiongqiCapabilitiesConfig, type MemoryCapabilityConfig } from '@qiongqi/contracts'
import { FileMemoryStore } from '@qiongqi/memory'
import type { ModelClient, ModelRequest } from '@qiongqi/ports'
import { dispatchRequest } from '@qiongqi/http'
import { bootstrapThread, makeHarness } from './loop-test-harness.js'
import { buildHarness, readJson } from './http-server-test-harness.js'

describe('Memory store and recall', () => {
  let dir = ''
  let nextId = 1

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'kun-memory-'))
    nextId = 1
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('stores scoped memories, retrieves relevant records, and keeps tombstones', async () => {
    const store = createStore()
    const memory = await store.create({
      content: 'User prefers pnpm for frontend projects',
      scope: 'workspace',
      workspace: '/tmp/ws',
      tags: ['frontend'],
      confidence: 0.9
    })
    await store.create({
      content: 'Unrelated backend preference',
      scope: 'workspace',
      workspace: '/tmp/other'
    })

    expect((await store.retrieve({ query: 'frontend pnpm preference', workspace: '/tmp/ws', limit: 3 })).map((item) => item.id)).toEqual([memory.id])
    expect(await createStore({ enabled: false }).retrieve({ query: 'pnpm', workspace: '/tmp/ws', limit: 3 })).toHaveLength(1)

    await store.update(memory.id, { disabled: true })
    expect(await store.retrieve({ query: 'pnpm', workspace: '/tmp/ws', limit: 3 })).toEqual([])
    await store.update(memory.id, { disabled: false, content: 'User strongly prefers pnpm' })
    expect(await store.retrieve({ query: 'pnpm', workspace: '/tmp/ws', limit: 3 })).toHaveLength(1)
    await store.delete(memory.id)
    expect(await store.retrieve({ query: 'pnpm', workspace: '/tmp/ws', limit: 3 })).toEqual([])
    expect((await store.list({ workspace: '/tmp/ws', includeDeleted: true })).find((item) => item.id === memory.id)?.deletedAt).toBeTruthy()
  })

  it('keeps memories isolated by owner user and workspace during retrieval', async () => {
    const store = createStore()
    const userMemory = await store.create({
      ownerUserId: 'user_a',
      content: 'Use pnpm for frontend projects',
      scope: 'user',
      workspace: '/tmp/shared'
    })
    const workspaceMemory = await store.create({
      ownerUserId: 'user_a',
      content: 'Frontend deployment uses vercel',
      scope: 'workspace',
      workspace: '/tmp/ws-a'
    })
    await store.create({
      ownerUserId: 'user_b',
      content: 'Use pnpm for backend services',
      scope: 'user',
      workspace: '/tmp/shared'
    })
    await store.create({
      ownerUserId: 'user_a',
      content: 'Frontend deployment uses netlify',
      scope: 'workspace',
      workspace: '/tmp/ws-b'
    })

    expect((await store.retrieve({
      query: 'frontend pnpm deployment',
      workspace: '/tmp/ws-a',
      ownerUserId: 'user_a',
      limit: 5
    })).map((item) => item.id)).toEqual([userMemory.id, workspaceMemory.id])
    expect(await store.retrieve({
      query: 'pnpm',
      workspace: '/tmp/ws-a',
      ownerUserId: 'user_b',
      limit: 5
    })).not.toContainEqual(expect.objectContaining({ ownerUserId: 'user_a' }))
    expect(await store.retrieve({
      query: 'netlify',
      workspace: '/tmp/ws-a',
      ownerUserId: 'user_a',
      limit: 5
    })).toEqual([])
  })

  it('keeps memories isolated by source thread when thread scope is provided', async () => {
    const store = createStore()
    const threadMemory = await store.create({
      ownerUserId: 'user_a',
      content: 'Frontend project uses pnpm',
      scope: 'project',
      workspace: '/tmp/ws',
      sourceThreadId: 'thread_a'
    })
    await store.create({
      ownerUserId: 'user_a',
      content: 'Frontend project uses yarn',
      scope: 'project',
      workspace: '/tmp/ws',
      sourceThreadId: 'thread_b'
    })
    const userMemory = await store.create({
      ownerUserId: 'user_a',
      content: 'General user preference says frontend uses npm',
      scope: 'user',
      workspace: '/tmp/ws'
    })

    expect((await store.retrieve({
      query: 'frontend project package manager',
      workspace: '/tmp/ws',
      ownerUserId: 'user_a',
      threadId: 'thread_a',
      limit: 5
    })).map((item) => item.id)).toEqual([threadMemory.id, userMemory.id])

    expect(await store.retrieve({
      query: 'yarn',
      workspace: '/tmp/ws',
      ownerUserId: 'user_a',
      threadId: 'thread_a',
      limit: 5
    })).toEqual([])
    expect(await store.retrieve({
      query: 'npm',
      workspace: '/tmp/ws',
      ownerUserId: 'user_a',
      limit: 5
    })).toEqual([userMemory])
  })

  it('retrieves user and workspace memories across threads while keeping project memories thread-scoped', async () => {
    const store = createStore()
    const userMemory = await store.create({
      ownerUserId: 'user_a',
      content: 'User prefers pnpm for frontend analysis dashboards',
      scope: 'user',
      workspace: '/tmp/ws',
      sourceThreadId: 'old_thread'
    })
    const workspaceMemory = await store.create({
      ownerUserId: 'user_a',
      content: 'Workspace financial reports should include MD and HTML outputs',
      scope: 'workspace',
      workspace: '/tmp/ws',
      sourceThreadId: 'old_thread'
    })
    await store.create({
      ownerUserId: 'user_a',
      content: 'Project-specific draft uses yarn',
      scope: 'project',
      workspace: '/tmp/ws',
      sourceThreadId: 'old_thread'
    })

    expect((await store.retrieve({
      query: 'frontend financial analysis reports pnpm MD HTML',
      workspace: '/tmp/ws',
      ownerUserId: 'user_a',
      threadId: 'new_thread',
      limit: 5
    })).map((item) => item.id)).toEqual([workspaceMemory.id, userMemory.id])
  })

  it('carries current-thread project memories across continue prompts without leaking other tasks', async () => {
    const store = createStore()
    const currentTask = await store.create({
      ownerUserId: 'user_a',
      content: '真实任务是宁德时代 300750 全面深度分析，需要输出 MD 报告和 HTML 看板',
      scope: 'project',
      workspace: '/tmp/ws',
      sourceThreadId: 'catl_thread'
    })
    await store.create({
      ownerUserId: 'user_a',
      content: '旧任务是股指期货联动分析',
      scope: 'project',
      workspace: '/tmp/ws',
      sourceThreadId: 'futures_thread'
    })

    expect((await store.retrieve({
      query: '继续',
      workspace: '/tmp/ws',
      ownerUserId: 'user_a',
      threadId: 'catl_thread',
      limit: 5
    })).map((item) => item.id)).toEqual([currentTask.id])
  })

  it('exposes memory API routes with diagnostics', async () => {
    const h = buildHarness()
    h.runtime.memoryStore = createStore()
    const created = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/memory', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          content: 'Remember pnpm',
          scope: 'workspace',
          workspace: '/tmp/ws'
        })
      })
    )
    expect(created.status).toBe(201)
    const body = await readJson(created) as { memory: { id: string } }

    const list = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/memory?workspace=/tmp/ws', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect((await readJson(list)) as { memories: unknown[] }).toMatchObject({ memories: [expect.any(Object)] })

    const disabled = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/memory/${body.memory.id}`, {
        method: 'PATCH',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ disabled: true })
      })
    )
    expect(disabled.status).toBe(200)
    const deleted = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/memory/${body.memory.id}`, {
        method: 'DELETE',
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(deleted.status).toBe(200)
    const diagnostics = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/memory/diagnostics', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(await readJson(diagnostics)).toMatchObject({ tombstoneCount: 1 })
  })

  it('scopes memory API records to the authenticated user', async () => {
    const h = buildHarness()
    h.runtime.memoryStore = createStore()
    const sessionA = await h.runtime.authService?.initialize({
      email: 'memory-a@example.com',
      password: 'password123'
    })
    const sessionB = await h.runtime.authService?.register({
      email: 'memory-b@example.com',
      password: 'password123'
    })

    const created = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/memory', {
        method: 'POST',
        headers: { authorization: `Bearer ${sessionA?.accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          content: 'User A remembers pnpm',
          scope: 'user',
          workspace: '/tmp/ws'
        })
      })
    )
    expect(created.status).toBe(201)
    const createdBody = await readJson(created) as { memory: { id: string; ownerUserId?: string } }
    expect(createdBody.memory.ownerUserId).toBe(sessionA?.user.id)

    const listA = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/memory?workspace=/tmp/ws', {
        headers: { authorization: `Bearer ${sessionA?.accessToken}` }
      })
    )
    expect(await readJson(listA)).toMatchObject({ memories: [expect.objectContaining({ id: createdBody.memory.id })] })

    const listB = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/memory?workspace=/tmp/ws', {
        headers: { authorization: `Bearer ${sessionB?.accessToken}` }
      })
    )
    expect(await readJson(listB)).toEqual({ memories: [] })

    const deleteAsB = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/memory/${createdBody.memory.id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${sessionB?.accessToken}` }
      })
    )
    expect(deleteAsB.status).toBe(404)
  })

  it('gates memory mutation tools through approval', async () => {
    const store = createStore()
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildMemoryToolProviders(store))
    })
    let approvals = 0
    const result = await host.execute({
      callId: 'call_1',
      toolName: 'memory_create',
      arguments: { content: 'Use pnpm', workspace: '/tmp/ws' }
    }, {
      threadId: 'thr_1',
      turnId: 'turn_1',
      workspace: '/tmp/ws',
      ownerUserId: 'user_a',
      approvalPolicy: 'on-request',
      abortSignal: new AbortController().signal,
      awaitApproval: async () => {
        approvals += 1
        return 'allow'
      }
    })

    expect(approvals).toBe(1)
    expect(result.item).toMatchObject({ kind: 'tool_result', isError: false })
    const memories = await store.list({ workspace: '/tmp/ws', ownerUserId: 'user_a' })
    expect(memories).toHaveLength(1)
    expect(memories[0]).toMatchObject({
      scope: 'project',
      sourceThreadId: 'thr_1'
    })
    expect(await store.list({ workspace: '/tmp/ws', ownerUserId: 'user_b' })).toHaveLength(0)
  })

  it('prevents memory tools from mutating another thread memory', async () => {
    const store = createStore()
    const memory = await store.create({
      ownerUserId: 'user_a',
      content: 'Other thread memory',
      scope: 'project',
      workspace: '/tmp/ws',
      sourceThreadId: 'thr_other'
    })
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildMemoryToolProviders(store))
    })
    const context = {
      threadId: 'thr_1',
      turnId: 'turn_1',
      workspace: '/tmp/ws',
      ownerUserId: 'user_a',
      approvalPolicy: 'on-request' as const,
      abortSignal: new AbortController().signal,
      awaitApproval: async () => 'allow' as const
    }

    const update = await host.execute({
      callId: 'call_update_other',
      toolName: 'memory_update',
      arguments: { id: memory.id, content: 'changed' }
    }, context)
    const deletion = await host.execute({
      callId: 'call_delete_other',
      toolName: 'memory_delete',
      arguments: { id: memory.id }
    }, context)

    expect(update.item).toMatchObject({ kind: 'tool_result', isError: true })
    expect(deletion.item).toMatchObject({ kind: 'tool_result', isError: true })
    const record = (await store.list({ workspace: '/tmp/ws', ownerUserId: 'user_a' }))[0]
    expect(record).toMatchObject({
      id: memory.id,
      content: 'Other thread memory'
    })
    expect(record?.deletedAt).toBeUndefined()
  })

  it('injects relevant memories into TurnOrchestrator metadata and stops after deletion', async () => {
    const store = createStore()
    const memory = await store.create({
      content: 'Use pnpm when touching frontend code',
      scope: 'workspace',
      workspace: '/tmp/ws',
      sourceThreadId: 'thr_1'
    })
    const seenRequests: ModelRequest[] = []
    const model: ModelClient = {
      provider: 'fake',
      model: 'fake',
      async *stream(request) {
        seenRequests.push(request)
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
    const h = makeHarness(model, { memoryStore: store })
    await bootstrapThread(h, { workspace: '/tmp/ws', request: { prompt: 'frontend pnpm setup?' } })

    await h.loop.runTurn(h.threadId, h.turnId)

    expect(seenRequests.at(-1)?.contextInstructions?.[0]).toContain(memory.id)
    expect((await h.turns.getTurn(h.threadId, h.turnId))?.injectedMemoryIds).toEqual([memory.id])
    expect((await store.diagnostics()).lastInjectedIds).toEqual([memory.id])

    await store.delete(memory.id)
    const h2 = makeHarness(model, { memoryStore: store })
    await bootstrapThread(h2, { workspace: '/tmp/ws', request: { prompt: 'frontend pnpm setup?' } })
    await h2.loop.runTurn(h2.threadId, h2.turnId)
    const finalInstructions = seenRequests.at(-1)?.contextInstructions?.join('\n') ?? ''
    expect(finalInstructions).not.toContain(memory.id)
    expect(finalInstructions).toContain('Shell runtime:')
  })

  it('injects only memories owned by the thread owner', async () => {
    const store = createStore()
    const owned = await store.create({
      ownerUserId: 'user_a',
      content: 'Frontend projects use pnpm',
      scope: 'user',
      workspace: '/tmp/ws',
      sourceThreadId: 'thr_1'
    })
    const other = await store.create({
      ownerUserId: 'user_b',
      content: 'Frontend projects use yarn',
      scope: 'user',
      workspace: '/tmp/ws',
      sourceThreadId: 'thr_1'
    })
    const seenRequests: ModelRequest[] = []
    const model: ModelClient = {
      provider: 'fake',
      model: 'fake',
      async *stream(request) {
        seenRequests.push(request)
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
    const h = makeHarness(model, { memoryStore: store })
    await bootstrapThread(h, {
      workspace: '/tmp/ws',
      thread: { ownerUserId: 'user_a' },
      request: { prompt: 'frontend project package manager?' }
    })

    await h.loop.runTurn(h.threadId, h.turnId)

    const instructions = seenRequests.at(-1)?.contextInstructions?.join('\n') ?? ''
    expect(instructions).toContain(owned.id)
    expect(instructions).not.toContain(other.id)
    expect((await h.turns.getTurn(h.threadId, h.turnId))?.injectedMemoryIds).toEqual([owned.id])
  })

  it('injects only project memories created for the current thread', async () => {
    const store = createStore()
    const current = await store.create({
      ownerUserId: 'user_a',
      content: 'Frontend task uses pnpm',
      scope: 'project',
      workspace: '/tmp/ws',
      sourceThreadId: 'thread_current'
    })
    const other = await store.create({
      ownerUserId: 'user_a',
      content: 'Frontend task uses yarn',
      scope: 'project',
      workspace: '/tmp/ws',
      sourceThreadId: 'thread_other'
    })
    const seenRequests: ModelRequest[] = []
    const model: ModelClient = {
      provider: 'fake',
      model: 'fake',
      async *stream(request) {
        seenRequests.push(request)
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
    const h = makeHarness(model, { memoryStore: store })
    await bootstrapThread(h, {
      threadId: 'thread_current',
      workspace: '/tmp/ws',
      thread: { ownerUserId: 'user_a' },
      request: { prompt: 'frontend task package manager?' }
    })

    await h.loop.runTurn(h.threadId, h.turnId)

    const instructions = seenRequests.at(-1)?.contextInstructions?.join('\n') ?? ''
    expect(instructions).toContain(current.id)
    expect(instructions).not.toContain(other.id)
    expect((await h.turns.getTurn(h.threadId, h.turnId))?.injectedMemoryIds).toEqual([current.id])
  })

  it('injects current task project memory on continue prompts without pulling another task', async () => {
    const store = createStore()
    const current = await store.create({
      ownerUserId: 'user_a',
      content: '真实任务是宁德时代 300750 全面深度分析，需要输出 MD 报告和 HTML 看板',
      scope: 'project',
      workspace: '/tmp/ws',
      sourceThreadId: 'catl_thread'
    })
    const other = await store.create({
      ownerUserId: 'user_a',
      content: '旧任务是股指期货联动分析',
      scope: 'project',
      workspace: '/tmp/ws',
      sourceThreadId: 'futures_thread'
    })
    const seenRequests: ModelRequest[] = []
    const model: ModelClient = {
      provider: 'fake',
      model: 'fake',
      async *stream(request) {
        seenRequests.push(request)
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
    const h = makeHarness(model, { memoryStore: store })
    await bootstrapThread(h, {
      threadId: 'catl_thread',
      workspace: '/tmp/ws',
      thread: { ownerUserId: 'user_a' },
      request: { prompt: '继续' }
    })

    await h.loop.runTurn(h.threadId, h.turnId)

    const instructions = seenRequests.at(-1)?.contextInstructions?.join('\n') ?? ''
    expect(instructions).toContain(current.id)
    expect(instructions).toContain('宁德时代 300750')
    expect(instructions).not.toContain(other.id)
    expect(instructions).not.toContain('股指期货')
    expect((await h.turns.getTurn(h.threadId, h.turnId))?.injectedMemoryIds).toEqual([current.id])
  })

  it('writes memory records atomically (no .tmp file left on success)', async () => {
    const store = createStore()
    await store.create({ content: 'atomic test memory' })

    // Final file present and parseable.
    const finalContents = await readFile(
      join(dir, 'memory', 'mem_1.json'),
      'utf8'
    )
    expect(finalContents.length).toBeGreaterThan(0)
    expect(JSON.parse(finalContents).content).toBe('atomic test memory')

    // No .tmp leftover from the atomic write.
    const entries = await readdir(join(dir, 'memory'))
    expect(entries.filter((entry) => entry.includes('.tmp'))).toEqual([])
  })

  function createStore(overrides: Partial<MemoryCapabilityConfig> = {}) {
    return new FileMemoryStore({
      rootDir: join(dir, 'memory'),
      config: memoryConfig(overrides),
      nowIso: () => '2026-06-03T00:00:00.000Z',
      idGenerator: () => `mem_${nextId++}`
    })
  }

  function memoryConfig(overrides: Partial<MemoryCapabilityConfig> = {}) {
    return QiongqiCapabilitiesConfig.parse({
      memory: {
        enabled: true,
        ...overrides
      }
    }).memory
  }
})
