import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileAttachmentStore, defaultSharpImageTransform } from '@qiongqi/attachments'
import type { ImageTransform } from '@qiongqi/attachments'
import { DeepseekCompatModelClient } from '@qiongqi/adapter-model'
import {
  QiongqiCapabilitiesConfig,
  type AttachmentsCapabilityConfig,
  type ModelCapabilityMetadata
} from '@qiongqi/contracts'
import { modelCapabilitiesForModel } from '@qiongqi/loop'
import type { ModelClient, ModelRequest } from '@qiongqi/ports'
import { dispatchRequest } from '@qiongqi/http'
import { bootstrapThread, makeHarness } from './loop-test-harness.js'
import { buildHarness, readJson } from './http-server-test-harness.js'

describe('Attachment store and multimodal input', () => {
  let dir = ''

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'kun-attachments-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('stores images outside session logs, deduplicates by hash, and enforces scope', async () => {
    const store = createStore()
    const data = png(2, 3)
    const first = await store.create({
      name: 'shot.png',
      data,
      mimeType: 'image/png',
      threadId: 'thr_1',
      workspace: '/tmp/ws'
    })
    const second = await store.create({
      name: 'shot-again.png',
      data,
      threadId: 'thr_1'
    })

    expect(second.id).toBe(first.id)
    expect(first).toMatchObject({ mimeType: 'image/png', width: 2, height: 3, byteSize: data.byteLength })
    await expect(store.resolveContent(first.id, { threadId: 'thr_2' })).rejects.toThrow(/not authorized/)
    await expect(store.resolveContent(first.id, { workspace: '/tmp/ws' })).resolves.toMatchObject({ id: first.id })
  })

  it('repairs missing content when a duplicate attachment is uploaded again', async () => {
    const store = createStore()
    const data = png(2, 3)
    const first = await store.create({
      name: 'shot.png',
      data,
      threadId: 'thr_1'
    })
    await rm(join(dir, 'attachments', `${first.id}.bin`), { force: true })

    const second = await store.create({
      name: 'shot-again.png',
      data,
      threadId: 'thr_1'
    })

    expect(second.id).toBe(first.id)
    await expect(store.resolveContent(first.id, { threadId: 'thr_1' })).resolves.toMatchObject({
      id: first.id,
      data
    })
  })

  it('accepts non-image files, rejects MIME outside the allow-list, and enforces image limits', async () => {
    // Non-image files now succeed (used to throw "unsupported image MIME type").
    const textAttachment = await createStore().create({
      name: 'notes.txt',
      data: Buffer.from('hello world'),
      mimeType: 'text/plain'
    })
    expect(textAttachment).toMatchObject({ mimeType: 'text/plain', byteSize: 'hello world'.length })
    expect(textAttachment.width).toBeUndefined()

    // MIME not in the allow-list is still rejected.
    await expect(createStore().create({
      name: 'weird.bin',
      data: Buffer.from('nope'),
      mimeType: 'application/x-totally-made-up'
    })).rejects.toThrow(/MIME type is not allowed/)

    await expect(createStore({ maxImageBytes: 10 }).create({
      name: 'large.png',
      data: png(1, 1)
    })).rejects.toThrow(/byte limit/)

    await expect(createStore({ maxImageDimension: 4 }).create({
      name: 'huge.png',
      data: png(5, 1)
    })).rejects.toThrow(/dimension/)

    await expect(createStore({ textFallbackMaxBase64Bytes: 4 }).create({
      name: 'fallback-large.png',
      data: png(1, 1),
      textFallback: {
        dataBase64: 'abcdefgh',
        mimeType: 'image/png',
        byteSize: 6,
        width: 1,
        height: 1
      }
    })).rejects.toThrow(/fallback image exceeds/)
  })

  it('stores PDF, ZIP and Office documents as generic file attachments', async () => {
    const store = createStore()
    const pdf = await store.create({
      name: 'report.pdf',
      data: Buffer.from('%PDF-1.4 payload'),
      mimeType: 'application/pdf',
      threadId: 'thr_1'
    })
    expect(pdf).toMatchObject({ mimeType: 'application/pdf', byteSize: 16 })
    expect(pdf.width).toBeUndefined()

    const zip = await store.create({
      name: 'archive.zip',
      data: Buffer.from([0x50, 0x4b, 0x03, 0x04, ...Buffer.from('zip body')]),
      mimeType: 'application/zip'
    })
    expect(zip).toMatchObject({ mimeType: 'application/zip' })

    const docx = await store.create({
      name: 'spec.docx',
      data: Buffer.from('office bytes')
    })
    expect(docx).toMatchObject({
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    })
  })

  it('serves authenticated upload, metadata, content, and diagnostics routes', async () => {
    const h = buildHarness()
    h.runtime.attachmentStore = createStore()
    const upload = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/attachments', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'shot.png',
          mimeType: 'image/png',
          dataBase64: png(1, 1).toString('base64'),
          threadId: 'thr_1',
          textFallback: {
            dataBase64: 'abcd',
            mimeType: 'image/png',
            byteSize: 3,
            width: 1,
            height: 1,
            wasCompressed: false
          }
        })
      })
    )

    expect(upload.status).toBe(201)
    const uploaded = await readJson(upload) as { attachment: { id: string } }
    const metadata = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/attachments/${uploaded.attachment.id}`, {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(metadata.status).toBe(200)
    expect(await readJson(metadata)).toMatchObject({
      attachment: {
        textFallback: {
          dataBase64: 'abcd',
          mimeType: 'image/png'
        }
      }
    })
    const content = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/attachments/${uploaded.attachment.id}/content?thread_id=thr_1`, {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(content.status).toBe(200)
    expect((await readJson(content)) as { dataBase64?: string }).toMatchObject({
      dataBase64: expect.any(String)
    })
    const diagnostics = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/attachments/diagnostics', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(await readJson(diagnostics)).toMatchObject({ enabled: true, count: 1 })
  })

  it('serves legacy KWorks thread uploads as workspace files', async () => {
    const h = buildHarness()
    const originalInfo = h.runtime.info()
    h.runtime.info = () => ({
      host: '127.0.0.1',
      port: 0,
      dataDir: dir,
      model: 'deepseek-chat',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      insecure: false,
      startedAt: new Date().toISOString(),
      capabilities: originalInfo.capabilities
    })
    await h.threadService.create(
      { title: 'Upload thread', workspace: process.cwd(), model: 'deepseek-chat', mode: 'agent' },
      { id: 'thr_upload' }
    )
    const form = new FormData()
    form.append('files', new File(['hello skill'], 'notes.md', { type: 'text/markdown' }))

    const upload = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/threads/thr_upload/uploads', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1' },
        body: form
      })
    )

    expect(upload.status).toBe(200)
    const body = await readJson(upload) as {
      success: boolean
      files: Array<{
        filename: string
        size: number
        path: string
        virtual_path: string
        artifact_url: string
        extension?: string
      }>
    }
    expect(body).toMatchObject({
      success: true,
      files: [
        {
          filename: 'notes.md',
          size: 'hello skill'.length,
          virtual_path: '/mnt/qiongqi/uploads/notes.md',
          artifact_url: '/api/threads/thr_upload/artifacts/mnt/qiongqi/uploads/notes.md',
          extension: 'md'
        }
      ]
    })
    await expect(readFile(join(dir, 'threads', 'thr_upload', 'uploads', 'notes.md'), 'utf8')).resolves.toBe('hello skill')

    const list = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/threads/thr_upload/uploads/list', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(list.status).toBe(200)
    await expect(readJson(list)).resolves.toMatchObject({
      count: 1,
      files: [expect.objectContaining({ filename: 'notes.md', virtual_path: '/mnt/qiongqi/uploads/notes.md' })]
    })
  })

  it('resolves image attachments for vision models and text fallbacks for text-only models', async () => {
    const store = createStore()
    const attachment = await store.create({
      name: 'shot.png',
      data: png(1, 1),
      threadId: 'thr_1',
      workspace: '/tmp/ws'
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
    const h = makeHarness(model, {
      attachmentStore: store,
      modelCapabilities: () => visionCapabilities()
    })
    await bootstrapThread(h, {
      workspace: '/tmp/ws',
      request: { prompt: 'look', attachmentIds: [attachment.id], model: 'vision-model' }
    })

    await h.loop.runTurn(h.threadId, h.turnId)

    expect(seenRequests.at(-1)?.attachments?.[0]).toMatchObject({
      id: attachment.id,
      mimeType: 'image/png',
      dataBase64: expect.any(String)
    })

    const textOnly = makeHarness(model, {
      attachmentStore: store,
      modelCapabilities: () => ({ ...visionCapabilities(), inputModalities: ['text'] })
    })
    await bootstrapThread(textOnly, {
      workspace: '/tmp/ws',
      request: { prompt: 'look', attachmentIds: [attachment.id], model: 'text-only' }
    })
    expect(await textOnly.loop.runTurn(textOnly.threadId, textOnly.turnId)).toBe('completed')
    expect(seenRequests.at(-1)?.attachments).toBeUndefined()
    // The store now auto-generates a compressed webp fallback on upload, so the
    // text-only turn uses it instead of inlining the raw PNG bytes.
    expect(seenRequests.at(-1)?.attachmentTextFallbacks?.[0]).toMatchObject({
      id: attachment.id,
      mimeType: 'image/webp',
      dataBase64: expect.any(String),
      wasCompressed: true
    })
  })

  it('routes built-in DeepSeek v4 image attachments as text fallbacks', async () => {
    const store = createStore()
    const attachment = await store.create({
      name: 'shot.png',
      data: png(1, 1),
      threadId: 'thr_1',
      workspace: '/tmp/ws'
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
    const h = makeHarness(model, {
      attachmentStore: store,
      modelCapabilities: modelCapabilitiesForModel
    })
    await bootstrapThread(h, {
      workspace: '/tmp/ws',
      request: { prompt: 'look', attachmentIds: [attachment.id], model: 'deepseek-v4-pro' }
    })

    expect(await h.loop.runTurn(h.threadId, h.turnId)).toBe('completed')
    const userItem = (await h.sessionStore.loadItems(h.threadId))
      .find((item) => item.kind === 'user_message')
    expect(userItem).toMatchObject({ attachmentIds: [attachment.id] })
    await expect(h.turns.getTurn(h.threadId, h.turnId)).resolves.toMatchObject({
      attachmentIds: [attachment.id]
    })
    expect(seenRequests.at(-1)?.attachments).toBeUndefined()
    expect(seenRequests.at(-1)?.attachmentTextFallbacks?.[0]).toMatchObject({
      id: attachment.id,
      mimeType: 'image/webp',
      dataBase64: expect.any(String),
      wasCompressed: true
    })
    const preSend = (await h.sessionStore.loadEventsSince(h.threadId, 0))
      .find((event): event is Extract<typeof event, { kind: 'pipeline_stage' }> =>
        event.kind === 'pipeline_stage' && event.stage === 'pre_send'
      )
    expect(preSend?.details).toMatchObject({
      attachmentIds: [attachment.id],
      modelInputModalities: ['text'],
      modelMessageParts: ['text'],
      imageAttachmentCount: 0,
      imageAttachmentBase64Bytes: 0,
      textFallbackCount: 1,
      textFallbackMimeTypes: ['image/webp']
    })
  })

  it('injects legacy thread uploads as text fallback context without the attachment store', async () => {
    const seenRequests: ModelRequest[] = []
    const model: ModelClient = {
      provider: 'fake',
      model: 'fake',
      async *stream(request) {
        seenRequests.push(request)
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
    const h = makeHarness(model, {
      runtimeDataDir: dir,
      modelCapabilities: () => ({ ...visionCapabilities(), inputModalities: ['text'] })
    })
    await mkdir(join(dir, 'threads', h.threadId, 'uploads'), { recursive: true })
    await writeFile(join(dir, 'threads', h.threadId, 'uploads', 'analysis-report.zip'), Buffer.from('PK\x03\x04skill zip'))
    await bootstrapThread(h, {
      workspace: dir,
      request: {
        prompt: 'analyze the uploaded file',
        attachmentIds: ['/mnt/qiongqi/uploads/analysis-report.zip'],
        model: 'text-model'
      }
    })

    expect(await h.loop.runTurn(h.threadId, h.turnId)).toBe('completed')

    expect(seenRequests.at(-1)?.attachments).toBeUndefined()
    expect(seenRequests.at(-1)?.attachmentTextFallbacks?.[0]).toMatchObject({
      id: '/mnt/qiongqi/uploads/analysis-report.zip',
      name: 'analysis-report.zip',
      mimeType: 'application/zip',
      byteSize: Buffer.byteLength('PK\x03\x04skill zip'),
      wasCompressed: false
    })
    const preSend = (await h.sessionStore.loadEventsSince(h.threadId, 0))
      .find((event): event is Extract<typeof event, { kind: 'pipeline_stage' }> =>
        event.kind === 'pipeline_stage' && event.stage === 'pre_send'
      )
    expect(preSend?.details).toMatchObject({
      attachmentIds: ['/mnt/qiongqi/uploads/analysis-report.zip'],
      textFallbackCount: 1,
      textFallbackMimeTypes: ['application/zip']
    })
  })

  it('fails text-only image turns when no bounded text fallback is available', async () => {
    // Sharp cannot compress a 1x1 PNG under an 8-base64-byte budget, so the
    // auto-generated fallback is dropped and the turn fails the same way it
    // did before auto-generation existed.
    const store = createStore({ textFallbackMaxBase64Bytes: 8 })
    const attachment = await store.create({
      name: 'shot.png',
      data: png(1, 1),
      threadId: 'thr_1',
      workspace: '/tmp/ws'
    })
    const model: ModelClient = {
      provider: 'fake',
      model: 'fake',
      async *stream() {
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
    const h = makeHarness(model, {
      attachmentStore: store,
      modelCapabilities: () => ({ ...visionCapabilities(), inputModalities: ['text'] })
    })
    await bootstrapThread(h, {
      workspace: '/tmp/ws',
      request: { prompt: 'look', attachmentIds: [attachment.id], model: 'text-only' }
    })

    expect(await h.loop.runTurn(h.threadId, h.turnId)).toBe('failed')
    await expect(h.turns.getTurn(h.threadId, h.turnId)).resolves.toMatchObject({
      error: expect.stringMatching(/missing a compressed text fallback/)
    })
  })

  it('maps image attachments to DeepSeek-compatible message parts', async () => {
    let body: { messages?: Array<{ role: string; content: unknown }> } | undefined
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://model.example.test',
      apiKey: '',
      model: 'vision-model',
      nonStreaming: true,
      fetchImpl: async (_url, init) => {
        body = JSON.parse(String(init?.body))
        return new Response(JSON.stringify({
          id: 'cmpl_1',
          model: 'vision-model',
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }]
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
    })

    for await (const _chunk of client.stream({
      threadId: 'thr_1',
      turnId: 'turn_1',
      model: 'vision-model',
      prefix: [],
      history: [{
        id: 'item_user',
        threadId: 'thr_1',
        turnId: 'turn_1',
        role: 'user',
        status: 'completed',
        createdAt: 'now',
        finishedAt: 'now',
        kind: 'user_message',
        text: 'describe'
      }],
      attachments: [{
        id: 'att_1',
        name: 'shot.png',
        mimeType: 'image/png',
        dataBase64: png(1, 1).toString('base64')
      }],
      tools: [],
      abortSignal: new AbortController().signal
    })) {
      // drain stream
    }

    expect(body?.messages?.[0]?.content).toEqual([
      { type: 'text', text: 'describe' },
      { type: 'image_url', image_url: { url: expect.stringMatching(/^data:image\/png;base64,/) } }
    ])
  })

  it('maps text attachment fallbacks to structured DeepSeek-compatible user text', async () => {
    let body: { messages?: Array<{ role: string; content: unknown }> } | undefined
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://model.example.test',
      apiKey: '',
      model: 'text-model',
      nonStreaming: true,
      fetchImpl: async (_url, init) => {
        body = JSON.parse(String(init?.body))
        return new Response(JSON.stringify({
          id: 'cmpl_1',
          model: 'text-model',
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }]
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
    })

    for await (const _chunk of client.stream({
      threadId: 'thr_1',
      turnId: 'turn_1',
      model: 'text-model',
      prefix: [],
      history: [{
        id: 'item_user',
        threadId: 'thr_1',
        turnId: 'turn_1',
        role: 'user',
        status: 'completed',
        createdAt: 'now',
        finishedAt: 'now',
        kind: 'user_message',
        text: 'describe'
      }],
      attachmentTextFallbacks: [{
        id: 'att_1',
        name: 'shot.png',
        mimeType: 'image/webp',
        dataBase64: 'YWJj',
        byteSize: 3,
        width: 1280,
        height: 720,
        wasCompressed: true
      }],
      tools: [],
      abortSignal: new AbortController().signal
    })) {
      // drain stream
    }

    expect(body?.messages?.[0]?.content).toContain('describe')
    expect(body?.messages?.[0]?.content).toContain('[Attached image as base64 text]')
    expect(body?.messages?.[0]?.content).toContain('MIME: image/webp')
    expect(body?.messages?.[0]?.content).toContain('Dimensions: 1280x720')
    expect(body?.messages?.[0]?.content).toContain('```base64\nYWJj\n```')
  })

  it('auto-generates a webp text fallback with sharp when none is provided', async () => {
    // Real sharp path: a fully valid 40x30 PNG (with pixel data) is resized to
    // <=1280px and re-encoded webp. The png() helper only emits a header, which
    // sharp refuses to decode, so we use a fixture image here.
    const store = createStore({}, { imageTransform: defaultSharpImageTransform })
    const realPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAACgAAAAeCAYAAABe3VzdAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAASElEQVR4nO3OoREAQRACQTQaTf5Z/ofBXtWI9i2n32VaB0wwBDtPmGAI9iytAyYYgp0nTDAEe5bWARMMwc4TJhiCPUvrgF8P/rshxNxd9Q+jAAAAAElFTkSuQmCC',
      'base64'
    )
    const attachment = await store.create({
      name: 'photo.png',
      data: realPng,
      threadId: 'thr_1'
    })
    expect(attachment.mimeType).toBe('image/png')
    expect(attachment.textFallback).toMatchObject({
      mimeType: 'image/webp',
      wasCompressed: true,
      width: 40,
      height: 30
    })
    // The fallback must be decodable back to an image (sanity check sharp output).
    const fallbackBytes = Buffer.from(attachment.textFallback!.dataBase64, 'base64')
    expect(fallbackBytes.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(fallbackBytes.subarray(8, 12).toString('ascii')).toBe('WEBP')
  })

  it('routes non-image attachments to metadata-only text fallbacks without inlining bytes', async () => {
    const store = createStore()
    const attachment = await store.create({
      name: 'doc.pdf',
      data: Buffer.from('%PDF-1.4 ...big binary...'),
      mimeType: 'application/pdf',
      threadId: 'thr_1'
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
    // Even a vision model must not receive a PDF as an image_url.
    const h = makeHarness(model, {
      attachmentStore: store,
      modelCapabilities: () => visionCapabilities()
    })
    await bootstrapThread(h, {
      workspace: '/tmp/ws',
      request: { prompt: 'summarize', attachmentIds: [attachment.id], model: 'vision-model' }
    })
    expect(await h.loop.runTurn(h.threadId, h.turnId)).toBe('completed')
    expect(seenRequests.at(-1)?.attachments).toBeUndefined()
    expect(seenRequests.at(-1)?.attachmentTextFallbacks?.[0]).toMatchObject({
      id: attachment.id,
      mimeType: 'application/pdf',
      dataBase64: '',
      byteSize: attachment.byteSize
    })
  })

  function createStore(
    overrides: Partial<AttachmentsCapabilityConfig> = {},
    options: { imageTransform?: ImageTransform } = {}
  ) {
    return new FileAttachmentStore({
      rootDir: join(dir, 'attachments'),
      config: attachmentConfig(overrides),
      nowIso: () => '2026-06-03T00:00:00.000Z',
      imageTransform: options.imageTransform ?? fakeImageTransform
    })
  }

  // Deterministic stand-in for sharp so the bulk of the suite doesn't depend on
  // the native binding. The real sharp path is exercised in its own test below.
  const fakeImageTransform: ImageTransform = {
    async generateImageFallback({ policy }) {
      return {
        dataBase64: Buffer.from('compressed').toString('base64'),
        mimeType: policy.textFallbackPreferredMimeType,
        byteSize: 9,
        width: 1,
        height: 1,
        wasCompressed: true
      }
    }
  }

  function attachmentConfig(overrides: Partial<AttachmentsCapabilityConfig> = {}) {
    return QiongqiCapabilitiesConfig.parse({
      attachments: {
        enabled: true,
        ...overrides
      }
    }).attachments
  }
})

function png(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24)
  buffer[0] = 0x89
  buffer[1] = 0x50
  buffer[2] = 0x4e
  buffer[3] = 0x47
  buffer[4] = 0x0d
  buffer[5] = 0x0a
  buffer[6] = 0x1a
  buffer[7] = 0x0a
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer
}

function visionCapabilities(): ModelCapabilityMetadata {
  return {
    id: 'vision-model',
    inputModalities: ['text', 'image'],
    outputModalities: ['text'],
    supportsToolCalling: true,
    contextWindowTokens: 128_000,
    messageParts: ['text', 'image_url']
  }
}
