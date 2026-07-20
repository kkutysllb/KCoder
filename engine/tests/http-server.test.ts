import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { Router, dispatchRequest, startNodeHttpServer } from '@qiongqi/http'
import { kworksUserWorkspacePaths } from '@qiongqi/http'
import { createApprovalRequest } from '@qiongqi/domain'
import { makeAssistantReasoningItem, makeAssistantTextItem, makeErrorItem } from '@qiongqi/domain'
import { encodeSseEvent } from '@qiongqi/http'
import { buildRuntimeCapabilityManifest } from '@qiongqi/contracts'
import { modelCapabilitiesForModel } from '@qiongqi/loop'
import { buildHarness, readJson, readSseEvents, usageSnapshot } from './http-server-test-harness.js'

describe('HTTP server', () => {
  let dataDir = ''
  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'kun-http-'))
  })
  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  it('defines per-user KWorks workspace directories for data, threads, skills, MCP, and tools', () => {
    expect(kworksUserWorkspacePaths('/Users/tester/.kworks-workspace', 'user:123')).toEqual({
      root: '/Users/tester/.kworks-workspace',
      userRoot: '/Users/tester/.kworks-workspace/users/user_123',
      data: '/Users/tester/.kworks-workspace/users/user_123/data',
      thread: '/Users/tester/.kworks-workspace/users/user_123/thread',
      threads: '/Users/tester/.kworks-workspace/users/user_123/threads',
      workspace: '/Users/tester/.kworks-workspace/users/user_123/workspace',
      memory: '/Users/tester/.kworks-workspace/users/user_123/memory',
      secrets: '/Users/tester/.kworks-workspace/users/user_123/secrets',
      usage: '/Users/tester/.kworks-workspace/users/user_123/usage',
      skills: '/Users/tester/.kworks-workspace/users/user_123/skills',
      mcp: '/Users/tester/.kworks-workspace/users/user_123/mcp',
      tools: '/Users/tester/.kworks-workspace/users/user_123/tools',
      automations: '/Users/tester/.kworks-workspace/users/user_123/automations',
      artifacts: '/Users/tester/.kworks-workspace/users/user_123/artifacts',
      attachments: '/Users/tester/.kworks-workspace/users/user_123/attachments',
      logs: '/Users/tester/.kworks-workspace/users/user_123/logs'
    })
  })

  it('returns 200 on /health without auth', async () => {
    const h = buildHarness()
    const response = await dispatchRequest(h.router, new Request('http://localhost/health'))
    expect(response.status).toBe(200)
    const body = await readJson(response)
    expect(body).toEqual({ status: 'ok', service: 'qiongqi', mode: 'serve' })
  })

  it('allows desktop auth headers in CORS preflight requests', async () => {
    const router = new Router()
    router.add('POST', '/api/v1/auth/initialize', () => new Response(null, { status: 204 }))
    const server = await startNodeHttpServer({
      router,
      host: '127.0.0.1',
      port: 0,
      corsOrigins: ['app://-']
    })

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/v1/auth/initialize`, {
        method: 'OPTIONS',
        headers: {
          origin: 'app://-',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type,x-kworks-desktop'
        }
      })

      expect(response.status).toBe(204)
      expect(response.headers.get('access-control-allow-origin')).toBe('app://-')
      expect(response.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('x-kworks-desktop')
    } finally {
      await server.close()
    }
  })

  it('allows desktop SSE resume headers in CORS preflight requests', async () => {
    const router = new Router()
    router.add('GET', '/v1/threads/thread-1/events', () => new Response(null, { status: 204 }))
    const server = await startNodeHttpServer({
      router,
      host: '127.0.0.1',
      port: 0,
      corsOrigins: ['app://-']
    })

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/v1/threads/thread-1/events`, {
        method: 'OPTIONS',
        headers: {
          origin: 'app://-',
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'last-event-id'
        }
      })

      expect(response.status).toBe(204)
      expect(response.headers.get('access-control-allow-origin')).toBe('app://-')
      expect(response.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('last-event-id')
    } finally {
      await server.close()
    }
  })

  it('allows desktop csrf headers in CORS preflight requests', async () => {
    const router = new Router()
    router.add('PUT', '/api/models/test-model', () => new Response(null, { status: 204 }))
    const server = await startNodeHttpServer({
      router,
      host: '127.0.0.1',
      port: 0,
      corsOrigins: ['app://-']
    })

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/models/test-model`, {
        method: 'OPTIONS',
        headers: {
          origin: 'app://-',
          'access-control-request-method': 'PUT',
          'access-control-request-headers': 'content-type,authorization,x-csrf-token'
        }
      })

      const allowHeaders = response.headers.get('access-control-allow-headers')?.toLowerCase()
      expect(response.status).toBe(204)
      expect(response.headers.get('access-control-allow-origin')).toBe('app://-')
      expect(allowHeaders).toContain('content-type')
      expect(allowHeaders).toContain('authorization')
      expect(allowHeaders).toContain('x-csrf-token')
    } finally {
      await server.close()
    }
  })

  it('returns readiness with degraded storage diagnostics without auth', async () => {
    const h = buildHarness()
    h.runtime.storageDiagnostics = () => ({
      backend: 'hybrid',
      available: true,
      degraded: true,
      reason: 'sqlite native binding unavailable',
      sqlite: { available: false, path: '/tmp/index.sqlite3' }
    })

    const response = await dispatchRequest(h.router, new Request('http://localhost/ready'))

    expect(response.status).toBe(200)
    await expect(readJson(response)).resolves.toMatchObject({
      status: 'degraded',
      service: 'qiongqi',
      checks: {
        storage: {
          backend: 'hybrid',
          degraded: true,
          sqlite: { available: false }
        }
      }
    })
  })

  it('returns runtime info with disabled capability defaults', async () => {
    const h = buildHarness()
    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/runtime/info', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )

    expect(response.status).toBe(200)
    const body = await readJson(response) as {
      model?: string
      capabilities?: {
        contractVersion?: number
        mcp?: { available?: boolean; reason?: string }
        web?: { available?: boolean; fetch?: { available?: boolean } }
        attachments?: { available?: boolean; allowedMimeTypes?: string[] }
        cli?: { serve?: { available?: boolean }; run?: { available?: boolean; reason?: string } }
        model?: { inputModalities?: string[]; supportsToolCalling?: boolean; contextWindowTokens?: number }
      }
    }
    expect(body.model).toBe('deepseek-chat')
    expect(body.capabilities?.contractVersion).toBe(1)
    expect(body.capabilities?.model?.inputModalities).toContain('text')
    expect(body.capabilities?.model?.supportsToolCalling).toBe(true)
    expect(body.capabilities?.model?.contextWindowTokens).toBe(1_000_000)
    expect(body.capabilities?.mcp?.available).toBe(false)
    expect(body.capabilities?.mcp?.reason).toMatch(/disabled/)
    expect(body.capabilities?.web?.fetch?.available).toBe(false)
    expect(body.capabilities?.attachments?.allowedMimeTypes).toContain('image/png')
    expect(body.capabilities?.cli?.serve?.available).toBe(true)
    expect(body.capabilities?.cli?.run?.available).toBe(false)
  })

  it('returns an empty model list for authenticated users without configured models', async () => {
    const h = buildHarness()
    const session = await h.runtime.authService?.initialize({
      email: 'empty-models@example.com',
      password: 'password123'
    })

    const response = await dispatchRequest(h.router, new Request('http://localhost/api/models', {
      headers: { authorization: `Bearer ${session?.accessToken}` }
    }))

    expect(response.status).toBe(200)
    await expect(readJson(response)).resolves.toMatchObject({
      models: []
    })
  })

  it('does not implicitly activate the first configured user model profile', async () => {
    const h = buildHarness()
    const session = await h.runtime.authService?.initialize({
      email: 'manual-models@example.com',
      password: 'password123'
    })
    await h.runtime.kworksUserDataStore?.saveModelProfile(session!.user.id, 'deepseek-pro', {
      providerModel: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.example/v1'
    })

    const response = await dispatchRequest(h.router, new Request('http://localhost/api/models', {
      headers: { authorization: `Bearer ${session?.accessToken}` }
    }))

    expect(response.status).toBe(200)
    const body = await readJson(response) as { models: Array<{ name: string; active?: boolean }> }
    expect(body.models).toHaveLength(1)
    expect(body.models[0]).toMatchObject({ name: 'deepseek-pro', active: false })
  })

  it('does not enable legacy KWorks token usage indicators from the models endpoint', async () => {
    const h = buildHarness()

    const response = await dispatchRequest(h.router, new Request('http://localhost/api/models', {
      headers: { authorization: 'Bearer tok-1' }
    }))

    expect(response.status).toBe(200)
    await expect(readJson(response)).resolves.toMatchObject({
      token_usage: { enabled: false }
    })
  })

  it('redacts model api keys on KWorks compatibility model endpoints', async () => {
    const h = buildHarness()
    const createResponse = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/models', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'secret-model',
          use: 'qiongqi',
          model: 'deepseek-chat',
          display_name: 'Secret Model',
          api_key: 'sk-test-secret'
        })
      })
    )
    expect(createResponse.status).toBe(201)
    const created = await readJson(createResponse) as { api_key?: string | null }
    expect(created.api_key).not.toBe('sk-test-secret')

    const listResponse = await dispatchRequest(h.router, new Request('http://localhost/api/models', {
      headers: { authorization: 'Bearer tok-1' }
    }))
    expect(listResponse.status).toBe(200)
    const listed = await readJson(listResponse) as { models: Array<{ api_key?: string | null }> }
    expect(listed.models[0]?.api_key).not.toBe('sk-test-secret')
  })

  it('auto-detects vision capabilities from known multimodal model names', async () => {
    const h = buildHarness()
    const createResponse = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/models', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'vision-model',
          model: 'gpt-4o',
          base_url: 'https://api.openai.com/v1',
          api_key: 'sk-vision-test'
        })
      })
    )
    expect(createResponse.status).toBe(201)
    const created = await readJson(createResponse) as {
      input_modalities?: string[]
      output_modalities?: string[]
      message_parts?: string[]
      supports_vision?: boolean
    }
    expect(created.input_modalities).toEqual(['text', 'image'])
    expect(created.output_modalities).toEqual(['text'])
    expect(created.message_parts).toEqual(['text', 'image_url'])
    expect(created.supports_vision).toBe(true)

    const stored = await h.runtime.configStore?.read()
    expect(stored?.models?.profiles?.['vision-model']).toMatchObject({
      providerModel: 'gpt-4o'
    })
  })

  it('activates a model profile as the QiongQi runtime default model', async () => {
    const h = buildHarness()
    const createResponse = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/models', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'vision-profile',
          model: 'provider-vision-model',
          base_url: 'https://api.example.test/v1',
          api_key: 'sk-vision',
          input_modalities: ['text', 'image'],
          output_modalities: ['text'],
          supports_tool_calling: true,
          message_parts: ['text', 'image_url']
        })
      })
    )
    expect(createResponse.status).toBe(201)

    const activate = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/models/vision-profile/activate', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(activate.status).toBe(200)
    await expect(readJson(activate)).resolves.toMatchObject({
      model: 'vision-profile',
      active: true
    })

    const serve = await dispatchRequest(h.router, new Request('http://localhost/api/config/serve', {
      headers: { authorization: 'Bearer tok-1' }
    }))
    await expect(readJson(serve)).resolves.toMatchObject({
      data: {
        model: 'vision-profile',
        baseUrl: 'https://api.example.test/v1',
        apiKey: '********'
      }
    })
    const stored = await h.runtime.configStore?.read()
    expect(stored?.serve?.model).toBe('vision-profile')
    expect(stored?.serve?.baseUrl).toBe('https://api.example.test/v1')
    expect(stored?.serve?.apiKey).toBe('sk-vision')

    const list = await dispatchRequest(h.router, new Request('http://localhost/api/models', {
      headers: { authorization: 'Bearer tok-1' }
    }))
    const listed = await readJson(list) as { models: Array<{ name: string; active?: boolean }> }
    expect(listed.models.find((model) => model.name === 'vision-profile')?.active).toBe(true)
  })

  it('activates a model profile for an authenticated KWorks user', async () => {
    const h = buildHarness()
    const session = await h.runtime.authService?.initialize({
      email: 'activate-user@example.com',
      password: 'password123'
    })
    expect(session?.accessToken).toBeTruthy()

    const createResponse = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/models', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${session?.accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          name: 'user-zhipu',
          model: 'glm-5.2',
          base_url: 'https://open.bigmodel.cn/api/paas/v4',
          api_key: 'zhipu-secret',
          endpoint_format: 'openai_compatible',
          input_modalities: ['text'],
          output_modalities: ['text'],
          supports_tool_calling: true,
          message_parts: ['text']
        })
      })
    )
    expect(createResponse.status).toBe(201)

    const activate = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/models/user-zhipu/activate', {
        method: 'POST',
        headers: { authorization: `Bearer ${session?.accessToken}` }
      })
    )
    expect(activate.status).toBe(200)
    await expect(readJson(activate)).resolves.toMatchObject({
      model: 'user-zhipu',
      active: true,
      serve: {
        model: 'user-zhipu',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        apiKey: '********'
      }
    })

    const list = await dispatchRequest(h.router, new Request('http://localhost/api/models', {
      headers: { authorization: `Bearer ${session?.accessToken}` }
    }))
    const listed = await readJson(list) as { models: Array<{ name: string; active?: boolean }> }
    expect(listed.models.find((model) => model.name === 'user-zhipu')?.active).toBe(true)
  })

  it('imports a legacy global model profile into the authenticated user on activation', async () => {
    const h = buildHarness()
    const session = await h.runtime.authService?.initialize({
      email: 'legacy-model-user@example.com',
      password: 'password123'
    })
    expect(session?.accessToken).toBeTruthy()

    const initialConfig = await h.runtime.configStore?.read()
    await h.runtime.configStore?.write({
      ...initialConfig!,
      models: {
        ...(initialConfig!.models ?? {}),
        profiles: {
          ...(initialConfig!.models?.profiles ?? {}),
          'legacy-profile': {
            providerModel: 'legacy-provider-model',
            baseUrl: 'https://legacy.example/v1',
            apiKey: 'legacy-secret',
            endpointFormat: 'chat_completions',
            inputModalities: ['text'],
            outputModalities: ['text'],
            supportsToolCalling: true,
            messageParts: ['text']
          }
        }
      }
    })

    const activate = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/models/legacy-profile/activate', {
        method: 'POST',
        headers: { authorization: `Bearer ${session?.accessToken}` }
      })
    )
    expect(activate.status).toBe(200)
    await expect(readJson(activate)).resolves.toMatchObject({
      model: 'legacy-profile',
      active: true,
      serve: {
        model: 'legacy-profile',
        baseUrl: 'https://legacy.example/v1',
        apiKey: '********'
      }
    })

    const saved = await h.runtime.kworksUserDataStore?.listModelProfiles(session!.user.id)
    expect(saved?.activeModel).toBe('legacy-profile')
    expect(saved?.profiles['legacy-profile']).toMatchObject({
      providerModel: 'legacy-provider-model',
      apiKey: 'legacy-secret'
    })
  })

  it('uses QiongQi config as the source of truth for config endpoints', async () => {
    const h = buildHarness()

    const readInitial = await dispatchRequest(h.router, new Request('http://localhost/api/config'))
    expect(readInitial.status).toBe(200)
    const initialBody = await readJson(readInitial) as { config?: { serve?: Record<string, unknown> } }
    expect(initialBody).toMatchObject({
      config: {
        serve: {
          model: 'deepseek-chat',
          approvalPolicy: 'on-request'
        },
        models: {
          profiles: {
            'deepseek-chat': {
              supportsToolCalling: true
            }
          }
        },
        capabilities: {
          mcp: {
            enabled: false,
            servers: {}
          }
        }
      }
    })
    expect(initialBody.config?.serve).not.toHaveProperty('sandboxMode')

    const save = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/config/serve', {
        method: 'PUT',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          data: {
            model: 'new-model',
            baseUrl: 'https://api.example.test/v1',
            apiKey: 'sk-config-secret',
            endpointFormat: 'chat_completions',
            approvalPolicy: 'auto',
            sandboxMode: 'danger-full-access',
            tokenEconomyMode: true,
            storage: { backend: 'file' }
          }
        })
      })
    )
    expect(save.status).toBe(200)
    const saveBody = await readJson(save) as { data?: Record<string, unknown> }
    expect(saveBody).toMatchObject({
      section: 'serve',
      data: {
        model: 'new-model',
        apiKey: '********',
        approvalPolicy: 'auto',
        storage: { backend: 'file' }
      }
    })
    expect(saveBody.data).not.toHaveProperty('sandboxMode')

    const stored = await h.runtime.configStore?.read()
    expect(stored?.serve?.model).toBe('new-model')
    expect(stored?.serve?.apiKey).toBe('sk-config-secret')
  })

  it('does not expose sandbox as a KWorks config section', async () => {
    const h = buildHarness()

    const read = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/config/sandbox', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(read.status).toBe(404)

    const save = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/config/sandbox', {
        method: 'PUT',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ data: 'danger-full-access' })
      })
    )
    expect(save.status).toBe(404)
  })

  it('preserves existing secrets when saving a redacted full config payload', async () => {
    const h = buildHarness()
    const initial = await h.runtime.configStore?.read()
    await h.runtime.configStore?.write({
      ...initial!,
      serve: {
        ...(initial!.serve ?? {}),
        model: 'secret-profile',
        apiKey: 'sk-existing-serve-secret'
      },
      models: {
        ...(initial!.models ?? {}),
        profiles: {
          ...(initial!.models?.profiles ?? {}),
          'secret-profile': {
            providerModel: 'secret-provider-model',
            baseUrl: 'https://api.example.test/v1',
            apiKey: 'sk-existing-profile-secret',
            endpointFormat: 'chat_completions',
            inputModalities: ['text'],
            outputModalities: ['text'],
            supportsToolCalling: true,
            messageParts: ['text']
          }
        }
      }
    })

    const read = await dispatchRequest(h.router, new Request('http://localhost/api/config'))
    const redacted = await readJson(read) as { config: Record<string, unknown> }
    const save = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/config', {
        method: 'PUT',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ config: redacted.config })
      })
    )

    expect(save.status).toBe(200)
    const stored = await h.runtime.configStore?.read()
    expect(stored?.serve?.apiKey).toBe('sk-existing-serve-secret')
    expect(stored?.models?.profiles?.['secret-profile']?.apiKey).toBe('sk-existing-profile-secret')
  })

  it('treats an empty serve.model in config writes as no active model', async () => {
    const h = buildHarness()
    const initial = await h.runtime.configStore?.read()
    expect(initial?.serve?.model).toBe('deepseek-chat')

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/config', {
        method: 'PUT',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          config: {
            ...initial,
            serve: {
              ...(initial?.serve ?? {}),
              model: ''
            },
            models: {
              profiles: {}
            }
          }
        })
      })
    )

    expect(response.status).toBe(200)
    const body = await readJson(response) as { config?: { serve?: { model?: string } } }
    expect(body.config?.serve?.model).toBeUndefined()
    const stored = await h.runtime.configStore?.read()
    expect(stored?.serve?.model).toBeUndefined()
  })

  it('persists full config model profiles to the authenticated user store', async () => {
    const h = buildHarness()
    const session = await h.runtime.authService?.initialize({
      email: 'settings-models@example.com',
      password: 'password123'
    })
    const token = session!.accessToken

    const readInitial = await dispatchRequest(h.router, new Request('http://localhost/api/config', {
      headers: { authorization: `Bearer ${token}` }
    }))
    const initial = await readJson(readInitial) as { config: Record<string, unknown> }

    const save = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/config', {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          config: {
            ...initial.config,
            serve: {
              ...(initial.config.serve as Record<string, unknown> | undefined),
              model: 'settings-zhipu'
            },
            models: {
              profiles: {
                'settings-zhipu': {
                  providerModel: 'glm-5.2',
                  baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
                  apiKey: 'zhipu-secret',
                  endpointFormat: 'openai_compatible',
                  inputModalities: ['text'],
                  outputModalities: ['text'],
                  supportsToolCalling: true,
                  messageParts: ['text']
                }
              }
            }
          }
        })
      })
    )
    expect(save.status).toBe(200)

    const savedUserModels = await h.runtime.kworksUserDataStore?.listModelProfiles(session!.user.id)
    expect(savedUserModels?.activeModel).toBe('settings-zhipu')
    expect(savedUserModels?.profiles['settings-zhipu']).toMatchObject({
      providerModel: 'glm-5.2',
      apiKey: 'zhipu-secret'
    })

    const reread = await dispatchRequest(h.router, new Request('http://localhost/api/config', {
      headers: { authorization: `Bearer ${token}` }
    }))
    await expect(readJson(reread)).resolves.toMatchObject({
      config: {
        serve: {
          model: 'settings-zhipu',
          apiKey: '********'
        },
        models: {
          profiles: {
            'settings-zhipu': {
              providerModel: 'glm-5.2',
              apiKey: '********'
            }
          }
        }
      }
    })

    const models = await dispatchRequest(h.router, new Request('http://localhost/api/models', {
      headers: { authorization: `Bearer ${token}` }
    }))
    await expect(readJson(models)).resolves.toMatchObject({
      models: [
        {
          name: 'settings-zhipu',
          model: 'glm-5.2',
          active: true
        }
      ]
    })
  })

  it('preserves model profile secrets when saving a redacted models section', async () => {
    const h = buildHarness()
    const initial = await h.runtime.configStore?.read()
    await h.runtime.configStore?.write({
      ...initial!,
      models: {
        ...(initial!.models ?? {}),
        profiles: {
          ...(initial!.models?.profiles ?? {}),
          'secret-profile': {
            providerModel: 'secret-provider-model',
            baseUrl: 'https://api.example.test/v1',
            apiKey: 'sk-existing-profile-secret',
            endpointFormat: 'chat_completions',
            inputModalities: ['text'],
            outputModalities: ['text'],
            supportsToolCalling: true,
            messageParts: ['text']
          }
        }
      }
    })

    const read = await dispatchRequest(h.router, new Request('http://localhost/api/config/models'))
    const redacted = await readJson(read) as { data: Record<string, unknown> }
    const save = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/config/models', {
        method: 'PUT',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ data: redacted.data })
      })
    )

    expect(save.status).toBe(200)
    const stored = await h.runtime.configStore?.read()
    expect(stored?.models?.profiles?.['secret-profile']?.apiKey).toBe('sk-existing-profile-secret')
  })

  it('does not expose the legacy config restart endpoint', async () => {
    const h = buildHarness()
    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/config/restart', { method: 'POST' })
    )

    expect(response.status).toBe(404)
  })

  it('reflects model config writes immediately in KWorks model endpoints', async () => {
    const h = buildHarness()
    const save = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/config/models', {
        method: 'PUT',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          data: {
            profiles: {
              'zhipu-glm-4': {
                providerModel: 'glm-4-plus',
                baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
                apiKey: 'sk-zhipu',
                endpointFormat: 'chat_completions',
                contextWindowTokens: 128000,
                supportsToolCalling: true,
                inputModalities: ['text'],
                outputModalities: ['text'],
                messageParts: ['text']
              }
            }
          }
        })
      })
    )
    expect(save.status).toBe(200)

    const models = await dispatchRequest(h.router, new Request('http://localhost/api/models', {
      headers: { authorization: 'Bearer tok-1' }
    }))
    expect(models.status).toBe(200)
    const body = await readJson(models) as { models: Array<Record<string, unknown>> }
    expect(body.models).toContainEqual(expect.objectContaining({
      name: 'zhipu-glm-4',
      model: 'glm-4-plus',
      base_url: 'https://open.bigmodel.cn/api/paas/v4',
      endpoint_format: 'chat_completions',
      api_key: '********'
    }))

    const activate = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/models/zhipu-glm-4/activate', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(activate.status).toBe(200)
    const activatedModels = await dispatchRequest(h.router, new Request('http://localhost/api/models', {
      headers: { authorization: 'Bearer tok-1' }
    }))
    const activatedBody = await readJson(activatedModels) as { models: Array<Record<string, unknown>> }
    expect(activatedBody.models).toContainEqual(expect.objectContaining({
      name: 'zhipu-glm-4',
      active: true,
      model: 'glm-4-plus',
      base_url: 'https://open.bigmodel.cn/api/paas/v4'
    }))
  })

  it('exposes provider compatibility diagnostics for local vLLM MiniMax M3 profiles', async () => {
    const h = buildHarness()
    const save = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/config/models', {
        method: 'PUT',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          data: {
            profiles: {
              'local-minimax-m3': {
                providerModel: 'MiniMax-M3',
                baseUrl: 'http://127.0.0.1:8000/v1',
                endpointFormat: 'chat_completions',
                supportsToolCalling: true
              }
            }
          }
        })
      })
    )
    expect(save.status).toBe(200)

    const models = await dispatchRequest(h.router, new Request('http://localhost/api/models', {
      headers: { authorization: 'Bearer tok-1' }
    }))
    expect(models.status).toBe(200)
    const body = await readJson(models) as { models: Array<Record<string, unknown>> }
    expect(body.models).toContainEqual(expect.objectContaining({
      name: 'local-minimax-m3',
      model: 'MiniMax-M3',
      provider_compatibility: expect.objectContaining({
        provider: 'vllm',
        thinking_dialect: 'minimax',
        tool_call_protocol: 'server-parser-required',
        request_flags: expect.objectContaining({
          reasoning_split: true
        })
      }),
      compatibility_warnings: [
        expect.stringContaining('--tool-call-parser minimax_m3')
      ]
    }))
  })

  it('uses the authenticated user active model when native threads and turns omit a model', async () => {
    const h = buildHarness()
    const session = await h.runtime.authService?.initialize({
      email: 'native-active-model@example.com',
      password: 'long-password'
    })
    expect(session?.accessToken).toEqual(expect.any(String))

    const createModel = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/models', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${session?.accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          name: 'user-zhipu',
          model: 'glm-5.2',
          base_url: 'https://open.bigmodel.cn/api/paas/v4',
          api_key: 'sk-user-zhipu'
        })
      })
    )
    expect(createModel.status).toBe(201)

    const activate = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/models/user-zhipu/activate', {
        method: 'POST',
        headers: { authorization: `Bearer ${session?.accessToken}` }
      })
    )
    expect(activate.status).toBe(200)

    const createThread = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${session?.accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          id: 'active-model-thread',
          workspace: '/tmp/project'
        })
      })
    )
    expect(createThread.status).toBe(201)
    const thread = await readJson(createThread) as { id: string; model: string }
    expect(thread.model).toBe('user-zhipu')

    const startTurn = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads/active-model-thread/turns', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${session?.accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          prompt: 'hello'
        })
      })
    )
    expect(startTurn.status).toBe(202)
    const start = await readJson(startTurn) as { turnId: string }
    const turn = await h.turnService.getTurn('active-model-thread', start.turnId)
    expect(turn?.model).toBe('user-zhipu')
  })

  it('does not use the first saved user model profile as a native default when none is active', async () => {
    const h = buildHarness()
    const session = await h.runtime.authService?.initialize({
      email: 'native-unselected-model@example.com',
      password: 'long-password'
    })
    expect(session?.accessToken).toEqual(expect.any(String))

    const createModel = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/models', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${session?.accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          name: 'user-zhipu-unselected',
          model: 'glm-5.2',
          base_url: 'https://open.bigmodel.cn/api/paas/v4',
          api_key: 'sk-user-zhipu'
        })
      })
    )
    expect(createModel.status).toBe(201)

    const createThread = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${session?.accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          id: 'fallback-model-thread',
          workspace: '/tmp/project'
        })
      })
    )
    expect(createThread.status).toBe(201)
    const thread = await readJson(createThread) as { id: string; model: string }
    expect(thread.model).toBe('deepseek-chat')

    const startTurn = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads/fallback-model-thread/turns', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${session?.accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          prompt: 'hello'
        })
      })
    )
    expect(startTurn.status).toBe(202)
    const start = await readJson(startTurn) as { turnId: string }
    const turn = await h.turnService.getTurn('fallback-model-thread', start.turnId)
    expect(turn?.model).toBe('deepseek-chat')
  })

  it('rejects invalid QiongQi config writes', async () => {
    const h = buildHarness()
    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/config/contextCompaction', {
        method: 'PUT',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          data: {
            defaultSoftThreshold: 10,
            defaultHardThreshold: 5
          }
        })
      })
    )

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toMatchObject({
      detail: expect.stringMatching(/Invalid QiongQi config/)
    })
  })

  it('does not expose built-in attachments as a writable config section', async () => {
    const h = buildHarness()
    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/config/attachments', {
        method: 'PUT',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ data: { enabled: false, allowedMimeTypes: [] } })
      })
    )

    expect(response.status).toBe(403)
    await expect(readJson(response)).resolves.toMatchObject({
      detail: expect.stringMatching(/built-in/)
    })
  })

  it('stores KWorks MCP compatibility config per authenticated user', async () => {
    const h = buildHarness()
    const admin = await h.runtime.authService?.initialize({
      email: 'admin-mcp@example.com',
      password: 'password123'
    })
    const user = await h.runtime.authService?.register({
      email: 'user-mcp@example.com',
      password: 'password123'
    })
    const update = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/mcp/config', {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${admin?.accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          mcp_servers: {
            filesystem: {
              enabled: true,
              transport: 'stdio',
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
              env: {},
              trustScope: 'workspace',
              trustedWorkspaceRoots: ['/tmp'],
              timeoutMs: 30_000
            }
          }
        })
      })
    )

    expect(update.status).toBe(200)
    await expect(readJson(update)).resolves.toMatchObject({
      mcp_servers: {
        filesystem: {
          enabled: true,
          transport: 'stdio',
          command: 'npx'
        }
      }
    })

    const read = await dispatchRequest(h.router, new Request('http://localhost/api/mcp/config', {
      headers: { authorization: `Bearer ${admin?.accessToken}` }
    }))
    expect(read.status).toBe(200)
    await expect(readJson(read)).resolves.toMatchObject({
      mcp_servers: {
        filesystem: {
          enabled: true,
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
          trustedWorkspaceRoots: ['/tmp']
        }
      }
    })
    const readOtherUser = await dispatchRequest(h.router, new Request('http://localhost/api/mcp/config', {
      headers: { authorization: `Bearer ${user?.accessToken}` }
    }))
    expect(readOtherUser.status).toBe(200)
    await expect(readJson(readOtherUser)).resolves.toEqual({
      mcp_servers: {},
      mcpServers: {},
      skills: {}
    })
  })

  it('accepts legacy KWorks mcpServers and skill enablement config', async () => {
    const h = buildHarness()
    const session = await h.runtime.authService?.initialize({
      email: 'legacy-extensions@example.com',
      password: 'password123'
    })

    const save = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/mcp/config', {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${session?.accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          mcpServers: {
            legacyFs: {
              enabled: true,
              type: 'stdio',
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
              env: { FS_MODE: 'legacy' }
            }
          },
          skills: {
            'skill-creator': { enabled: true },
            'find-skills': false
          }
        })
      })
    )

    expect(save.status).toBe(200)
    await expect(readJson(save)).resolves.toMatchObject({
      mcp_servers: {
        legacyFs: {
          enabled: true,
          transport: 'stdio',
          command: 'npx'
        }
      },
      mcpServers: {
        legacyFs: {
          enabled: true,
          type: 'stdio',
          command: 'npx'
        }
      },
      skills: {
        'skill-creator': { enabled: true },
        'find-skills': { enabled: false }
      }
    })

    const reread = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/mcp/config', {
        headers: { authorization: `Bearer ${session?.accessToken}` }
      })
    )
    await expect(readJson(reread)).resolves.toMatchObject({
      mcpServers: {
        legacyFs: {
          command: 'npx'
        }
      },
      skills: {
        'find-skills': { enabled: false }
      }
    })
  })

  it('preserves MCP tool discovery search settings when saving compatibility config', async () => {
    const h = buildHarness()
    const initial = await h.runtime.configStore?.read()
    await h.runtime.configStore?.write({
      ...initial!,
      capabilities: {
        ...(initial!.capabilities ?? {}),
        mcp: {
          enabled: true,
          servers: {},
          search: {
            enabled: true,
            mode: 'search',
            autoThresholdToolCount: 12,
            topKDefault: 4,
            topKMax: 8,
            minScore: 0.2,
            bm25: { k1: 1.4, b: 0.6 }
          }
        }
      }
    })

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/mcp/config', {
        method: 'PUT',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          mcp_servers: {
            brave: {
              enabled: true,
              transport: 'stdio',
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-brave-search'],
              env: { BRAVE_API_KEY: 'brave-secret' },
              trustScope: 'user',
              timeoutMs: 30_000
            }
          }
        })
      })
    )

    expect(response.status).toBe(200)
    const saved = await h.runtime.configStore?.read()
    expect(saved?.capabilities?.mcp?.search).toMatchObject({
      enabled: true,
      mode: 'search',
      autoThresholdToolCount: 12,
      topKDefault: 4,
      topKMax: 8,
      minScore: 0.2,
      bm25: { k1: 1.4, b: 0.6 }
    })
  })

  it('syncs authenticated MCP compatibility saves into runtime capabilities', async () => {
    const h = buildHarness()
    const session = await h.runtime.authService?.initialize({
      email: 'runtime-mcp@example.com',
      password: 'password123'
    })
    const initial = await h.runtime.configStore?.read()
    await h.runtime.configStore?.write({
      ...initial!,
      capabilities: {
        ...(initial!.capabilities ?? {}),
        mcp: {
          enabled: false,
          servers: {},
          search: {
            enabled: true,
            mode: 'search',
            autoThresholdToolCount: 10,
            topKDefault: 3,
            topKMax: 6,
            minScore: 0.25,
            bm25: { k1: 1.3, b: 0.7 }
          }
        }
      }
    })

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/mcp/config', {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${session!.accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          mcp_servers: {
            brave: {
              enabled: true,
              transport: 'stdio',
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-brave-search'],
              env: { BRAVE_API_KEY: 'brave-secret' },
              trustScope: 'user',
              timeoutMs: 30_000
            }
          }
        })
      })
    )

    expect(response.status).toBe(200)
    const saved = await h.runtime.configStore?.read()
    expect(saved?.capabilities?.mcp).toMatchObject({
      enabled: true,
      search: {
        enabled: true,
        mode: 'search',
        autoThresholdToolCount: 10,
        topKDefault: 3,
        topKMax: 6,
        minScore: 0.25,
        bm25: { k1: 1.3, b: 0.7 }
      },
      servers: {
        brave: {
          enabled: true,
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-brave-search'],
          env: { BRAVE_API_KEY: 'brave-secret' },
          trustScope: 'user'
        }
      }
    })
  })

  it('refreshes runtime MCP tools after saving compatibility config', async () => {
    const h = buildHarness()
    const session = await h.runtime.authService?.initialize({
      email: 'refresh-mcp@example.com',
      password: 'password123'
    })
    let refreshCount = 0
    h.runtime.refreshMcpTools = async () => {
      refreshCount += 1
    }

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/mcp/config', {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${session!.accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          mcp_servers: {
            local: {
              enabled: true,
              transport: 'stdio',
              command: 'node',
              args: ['server.js'],
              trustScope: 'workspace',
              trustedWorkspaceRoots: ['/tmp']
            }
          }
        })
      })
    )

    expect(response.status).toBe(200)
    expect(refreshCount).toBe(1)
  })

  it('refreshes runtime tools after saving web capability config', async () => {
    const h = buildHarness()
    const session = await h.runtime.authService?.initialize({
      email: 'refresh-web@example.com',
      password: 'password123'
    })
    let refreshCount = 0
    h.runtime.refreshRuntimeTools = async () => {
      refreshCount += 1
    }

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/config/web', {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${session!.accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          data: {
            enabled: true,
            fetchEnabled: true,
            searchEnabled: false,
            allowDomains: ['example.com'],
            denyDomains: []
          }
        })
      })
    )

    expect(response.status).toBe(200)
    expect(refreshCount).toBe(1)
  })

  it('persists web capability config in user settings across runtime config resets', async () => {
    const h = buildHarness()
    const session = await h.runtime.authService?.initialize({
      email: 'persist-web@example.com',
      password: 'password123'
    })

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/config/web', {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${session!.accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          data: {
            enabled: true,
            fetchEnabled: true,
            searchEnabled: true,
            provider: 'builtin',
            allowDomains: ['example.com'],
            denyDomains: ['blocked.example']
          }
        })
      })
    )
    expect(response.status).toBe(200)

    const savedSetting = await h.runtime.kworksUserDataStore?.getUserSetting(session!.user.id, 'capabilities.web')
    expect(savedSetting).toMatchObject({
      enabled: true,
      fetchEnabled: true,
      searchEnabled: true,
      provider: 'builtin',
      allowDomains: ['example.com'],
      denyDomains: ['blocked.example']
    })

    const initial = await h.runtime.configStore?.read()
    await h.runtime.configStore?.write({
      ...initial!,
      capabilities: {
        ...(initial!.capabilities ?? {}),
        web: { enabled: false, fetchEnabled: false, searchEnabled: false }
      }
    })

    const reread = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/config/web', {
        headers: { authorization: `Bearer ${session!.accessToken}` }
      })
    )
    expect(reread.status).toBe(200)
    await expect(readJson(reread)).resolves.toMatchObject({
      section: 'web',
      data: {
        enabled: true,
        fetchEnabled: true,
        searchEnabled: true,
        provider: 'builtin',
        allowDomains: ['example.com'],
        denyDomains: ['blocked.example']
      }
    })
  })

  it('preserves runtime model config when an authenticated user saves web capabilities', async () => {
    const h = buildHarness()
    const session = await h.runtime.authService?.initialize({
      email: 'preserve-runtime-model-web@example.com',
      password: 'password123'
    })

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/config/web', {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${session!.accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          data: {
            enabled: true,
            fetchEnabled: true,
            searchEnabled: false,
            allowDomains: [],
            denyDomains: []
          }
        })
      })
    )

    expect(response.status).toBe(200)
    const saved = await h.runtime.configStore?.read()
    expect(saved?.serve?.model).toBe('deepseek-chat')
    expect(saved?.models?.profiles?.['deepseek-chat']).toMatchObject({
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsToolCalling: true
    })
  })

  it('persists MCP capability config from generic config saves in user settings', async () => {
    const h = buildHarness()
    const session = await h.runtime.authService?.initialize({
      email: 'persist-config-mcp@example.com',
      password: 'password123'
    })

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/config/mcp', {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${session!.accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          data: {
            enabled: true,
            servers: {
              browser: {
                enabled: true,
                transport: 'stdio',
                command: 'npx',
                args: ['-y', '@modelcontextprotocol/server-brave-search'],
                env: { BRAVE_API_KEY: 'secret' },
                trustScope: 'user',
                trustedWorkspaceRoots: [],
                timeoutMs: 30_000
              }
            },
            search: {
              enabled: true,
              mode: 'auto',
              autoThresholdToolCount: 12,
              topKDefault: 4,
              topKMax: 8,
              minScore: 0.2,
              bm25: { k1: 1.4, b: 0.6 }
            }
          }
        })
      })
    )
    expect(response.status).toBe(200)

    const savedCompat = await h.runtime.kworksUserDataStore?.getUserSetting(session!.user.id, 'capabilities.mcp.compat')
    expect(savedCompat).toMatchObject({
      mcp_servers: {
        browser: {
          enabled: true,
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-brave-search'],
          env: { BRAVE_API_KEY: 'secret' },
          trustScope: 'user',
          timeoutMs: 30_000
        }
      }
    })

    const initial = await h.runtime.configStore?.read()
    await h.runtime.configStore?.write({
      ...initial!,
      capabilities: {
        ...(initial!.capabilities ?? {}),
        mcp: { enabled: false, servers: {} }
      }
    })

    const reread = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/config/mcp', {
        headers: { authorization: `Bearer ${session!.accessToken}` }
      })
    )
    expect(reread.status).toBe(200)
    await expect(readJson(reread)).resolves.toMatchObject({
      section: 'mcp',
      data: {
        enabled: true,
        servers: {
          browser: {
            enabled: true,
            transport: 'stdio',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-brave-search'],
            env: { BRAVE_API_KEY: 'secret' },
            trustScope: 'user'
          }
        }
      }
    })
  })

  it('hydrates persisted user web config before runtime tool diagnostics', async () => {
    const h = buildHarness()
    const session = await h.runtime.authService?.initialize({
      email: 'hydrate-web-tools@example.com',
      password: 'password123'
    })

    await dispatchRequest(
      h.router,
      new Request('http://localhost/api/config/web', {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${session!.accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          data: {
            enabled: true,
            fetchEnabled: true,
            searchEnabled: false,
            allowDomains: ['example.com'],
            denyDomains: []
          }
        })
      })
    )

    const initial = await h.runtime.configStore?.read()
    await h.runtime.configStore?.write({
      ...initial!,
      capabilities: {
        ...(initial!.capabilities ?? {}),
        web: { enabled: false, fetchEnabled: false, searchEnabled: false }
      }
    })

    let refreshCount = 0
    h.runtime.refreshRuntimeTools = async () => {
      refreshCount += 1
    }

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/runtime/tools', {
        headers: { authorization: `Bearer ${session!.accessToken}` }
      })
    )
    expect(response.status).toBe(200)
    expect(refreshCount).toBe(1)
    const saved = await h.runtime.configStore?.read()
    expect(saved?.capabilities?.web).toMatchObject({
      enabled: true,
      fetchEnabled: true,
      searchEnabled: false,
      allowDomains: ['example.com'],
      denyDomains: []
    })

    const stableResponse = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/runtime/tools', {
        headers: { authorization: `Bearer ${session!.accessToken}` }
      })
    )
    expect(stableResponse.status).toBe(200)
    expect(refreshCount).toBe(1)
  })

  it('reports refreshed MCP capability state from runtime info', async () => {
    const h = buildHarness()
    const session = await h.runtime.authService?.initialize({
      email: 'info-mcp@example.com',
      password: 'password123'
    })
    h.runtime.refreshMcpTools = async () => {
      const config = await h.runtime.configStore?.read()
      h.runtime.info = () => ({
        host: '127.0.0.1',
        port: 0,
        dataDir: '/tmp/kun',
        model: 'deepseek-chat',
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write',
        insecure: false,
        startedAt: h.nowIso(),
        capabilities: buildRuntimeCapabilityManifest({
          config: config?.capabilities,
          model: modelCapabilitiesForModel('deepseek-chat'),
          mcp: {
            configuredServers: Object.keys(config?.capabilities?.mcp.servers ?? {}).length
          }
        })
      })
    }

    await dispatchRequest(
      h.router,
      new Request('http://localhost/api/mcp/config', {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${session!.accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          mcp_servers: {
            local: {
              enabled: true,
              transport: 'stdio',
              command: 'node',
              args: ['server.js'],
              trustScope: 'workspace',
              trustedWorkspaceRoots: ['/tmp']
            }
          }
        })
      })
    )

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/runtime/info', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(response.status).toBe(200)
    await expect(readJson(response)).resolves.toMatchObject({
      capabilities: {
        mcp: {
          enabled: true,
          configuredServers: 1
        }
      }
    })
  })

  it('stores KWorks cron jobs per authenticated user', async () => {
    const h = buildHarness()
    const admin = await h.runtime.authService?.initialize({
      email: 'admin@example.com',
      password: 'password123'
    })
    const user = await h.runtime.authService?.register({
      email: 'user@example.com',
      password: 'password123'
    })
    expect(admin?.accessToken).toBeTruthy()
    expect(user?.accessToken).toBeTruthy()

    const create = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/crons/nightly-report', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${admin?.accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          enabled: true,
          cron: '0 9 * * *',
          description: 'Daily project report',
          agent: 'qiongqi',
          model: 'deepseek-chat',
          prompt: 'Summarize the workspace'
        })
      })
    )
    expect(create.status).toBe(201)
    await expect(readJson(create)).resolves.toMatchObject({
      enabled: true,
      cron: '0 9 * * *',
      description: 'Daily project report',
      agent: 'qiongqi',
      model: 'deepseek-chat',
      prompt: 'Summarize the workspace'
    })

    const listAdmin = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/crons', {
        headers: { authorization: `Bearer ${admin?.accessToken}` }
      })
    )
    expect(listAdmin.status).toBe(200)
    await expect(readJson(listAdmin)).resolves.toMatchObject({
      cron_jobs: {
        'nightly-report': {
          enabled: true,
          cron: '0 9 * * *'
        }
      }
    })

    const listUser = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/crons', {
        headers: { authorization: `Bearer ${user?.accessToken}` }
      })
    )
    expect(listUser.status).toBe(200)
    await expect(readJson(listUser)).resolves.toEqual({ cron_jobs: {} })

    const toggle = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/crons/nightly-report/toggle', {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${admin?.accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ enabled: false })
      })
    )
    expect(toggle.status).toBe(200)
    await expect(readJson(toggle)).resolves.toMatchObject({ enabled: false })

    const deleteResponse = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/crons/nightly-report', {
        method: 'DELETE',
        headers: { authorization: `Bearer ${admin?.accessToken}` }
      })
    )
    expect(deleteResponse.status).toBe(200)
    await expect(readJson(deleteResponse)).resolves.toEqual({ success: true })
  })

  it('requires auth for KWorks cron compatibility endpoints', async () => {
    const h = buildHarness()
    const response = await dispatchRequest(h.router, new Request('http://localhost/api/crons'))

    expect(response.status).toBe(401)
  })

  it('maps QiongQi reasoning items to reasoning_content instead of visible assistant content', async () => {
    const h = buildHarness()
    await h.threadService.create({
      workspace: '/tmp',
      model: 'deepseek-chat',
      mode: 'agent'
    }, { id: 'thread_reasoning', title: 'Reasoning' })
    const start = await h.turnService.startTurn({
      threadId: 'thread_reasoning',
      request: { prompt: 'hello', model: 'deepseek-chat' }
    })
    await h.turnService.applyItem(
      'thread_reasoning',
      makeAssistantReasoningItem({
        id: 'reasoning_1',
        threadId: 'thread_reasoning',
        turnId: start.turnId,
        text: 'hidden reasoning',
        status: 'running'
      })
    )

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/threads/thread_reasoning/state', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )

    expect(response.status).toBe(200)
    const body = await readJson(response) as {
      values?: {
        messages?: Array<{
          id?: string
          content?: string
          additional_kwargs?: { reasoning_content?: string }
        }>
      }
    }
    const message = body.values?.messages?.find((item) => item.id === 'reasoning_1') as {
      content?: string
      additional_kwargs?: { reasoning_content?: string }
    } | undefined
    expect(message?.content).toBe('')
    expect(message?.additional_kwargs?.reasoning_content).toBe('hidden reasoning')
  })

  it('hides legacy tool catalog drift diagnostics from KWorks compatibility thread state', async () => {
    const h = buildHarness()
    await h.threadService.create({
      workspace: '/tmp',
      model: 'deepseek-chat',
      mode: 'agent'
    }, { id: 'thread_tool_catalog_drift', title: 'Tool Catalog Drift' })
    const start = await h.turnService.startTurn({
      threadId: 'thread_tool_catalog_drift',
      request: { prompt: 'hello', model: 'deepseek-chat' }
    })
    await h.turnService.applyItem(
      'thread_tool_catalog_drift',
      makeErrorItem({
        id: 'item_tool_catalog_changed',
        threadId: 'thread_tool_catalog_drift',
        turnId: start.turnId,
        message: 'Tool catalog changed for this thread',
        code: 'tool_catalog_changed',
        severity: 'info'
      })
    )

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/threads/thread_tool_catalog_drift/state', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )

    expect(response.status).toBe(200)
    const body = await readJson(response) as {
      values?: {
        messages?: Array<{
          id?: string
          type?: string
          content?: string
          additional_kwargs?: { hide_from_ui?: boolean }
        }>
      }
    }
    const message = body.values?.messages?.find((item) => item.id === 'item_tool_catalog_changed')
    expect(message).toMatchObject({
      type: 'system',
      content: '',
      additional_kwargs: { hide_from_ui: true }
    })
  })

  it('returns empty follow-up suggestions for the KWorks compatibility input box', async () => {
    const h = buildHarness()
    await h.threadService.create({
      workspace: '/tmp',
      model: 'deepseek-chat',
      mode: 'agent'
    }, { id: 'thread_suggestions', title: 'Suggestions' })

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/threads/thread_suggestions/suggestions', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'user', content: 'hello' },
            { role: 'assistant', content: 'hi' }
          ],
          n: 3
        })
      })
    )

    expect(response.status).toBe(200)
    await expect(readJson(response)).resolves.toEqual({ suggestions: [] })
  })

  it('accepts KWorks compatibility run feedback without requiring legacy storage', async () => {
    const h = buildHarness()
    await h.threadService.create({
      workspace: '/tmp',
      model: 'deepseek-chat',
      mode: 'agent'
    }, { id: 'thread_feedback', title: 'Feedback' })

    const upsert = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/threads/thread_feedback/runs/run_1/feedback', {
        method: 'PUT',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ rating: 1, comment: null })
      })
    )

    expect(upsert.status).toBe(200)
    await expect(readJson(upsert)).resolves.toEqual({
      feedback_id: 'thread_feedback:run_1',
      rating: 1,
      comment: null
    })

    const remove = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/threads/thread_feedback/runs/run_1/feedback', {
        method: 'DELETE',
        headers: { authorization: 'Bearer tok-1' }
      })
    )

    expect(remove.status).toBe(200)
    await expect(readJson(remove)).resolves.toEqual({ success: true })
  })

  it('keeps legacy KWorks settings compatibility actions from returning route 404s', async () => {
    const h = buildHarness()

    const restartChannel = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/channels/zhipu/restart', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(restartChannel.status).toBe(200)
    await expect(readJson(restartChannel)).resolves.toEqual({
      success: true,
      message: 'Channel restart is not required for the QiongQi runtime'
    })

    const clearMemory = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/memory', {
        method: 'DELETE',
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(clearMemory.status).toBe(200)
    await expect(readJson(clearMemory)).resolves.toEqual({
      enabled: true,
      facts: [],
      memories: []
    })

    const updateFact = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/memory/facts/fact_1', {
        method: 'PATCH',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'updated' })
      })
    )
    expect(updateFact.status).toBe(200)

    const deleteFact = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/memory/facts/fact_1', {
        method: 'DELETE',
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(deleteFact.status).toBe(200)
  })

  it('derives the KWorks thread title from the first prompt for existing default-title threads', async () => {
    const h = buildHarness()
    const create = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/threads', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ thread_id: 'thread_title_from_prompt', title: 'New chat' })
      })
    )
    expect(create.status).toBe(200)

    const stream = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/threads/thread_title_from_prompt/runs/stream', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          input: {
            messages: [
              {
                role: 'user',
                content: '  帮我分析一下这个项目为什么启动后标题没有生成  '
              }
            ]
          },
          context: { model_name: 'deepseek-chat', workspace: '/tmp' }
        })
      })
    )
    expect(stream.status).toBe(200)

    const events = await readSseEvents(stream)
    const titleValues = events
      .filter((frame) => frame.includes('event: values'))
      .map((frame) => {
        const dataLine = frame.split('\n').find((line) => line.startsWith('data: '))
        return dataLine ? JSON.parse(dataLine.slice(6)) as { title?: string } : {}
      })
      .filter((value) => typeof value.title === 'string')
    expect(titleValues.some((value) => value.title === '帮我分析一下这个项目为什么启动后标题没有生成')).toBe(true)

    const state = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/threads/thread_title_from_prompt/state', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(state.status).toBe(200)
    const body = await readJson(state) as { values?: { title?: string } }
    expect(body.values?.title).toBe('帮我分析一下这个项目为什么启动后标题没有生成')
  })

  it('uses the selected workspaceRoot from KWorks run context as the QiongQi thread workspace', async () => {
    const h = buildHarness()
    const selectedWorkspace = '/tmp/kk_aoshu'

    const stream = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/threads/thread_workspace_root/runs/stream', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          input: { messages: [{ role: 'user', content: '当前目录是什么' }] },
          context: { model_name: 'deepseek-chat', workspaceRoot: selectedWorkspace }
        })
      })
    )

    expect(stream.status).toBe(200)
    const thread = await h.threadService.get('thread_workspace_root')
    expect(thread?.workspace).toBe(selectedWorkspace)
  })

  it('defaults KWorks task runs to the user workspace instead of the process cwd', async () => {
    const h = buildHarness()

    const stream = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/threads/thread_default_workspace/runs/stream', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          input: { messages: [{ role: 'user', content: '当前默认工作区是什么' }] },
          context: { model_name: 'deepseek-chat', workModeId: 'office' }
        })
      })
    )

    expect(stream.status).toBe(200)
    const thread = await h.threadService.get('thread_default_workspace')
    expect(thread?.workspace).toBe('/tmp/kun/users/runtime/workspace')
    expect(thread?.workspace).not.toBe(process.cwd())
  })

  it('defaults KWorks coding runs to the dedicated coding workspace', async () => {
    const h = buildHarness()

    const stream = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/threads/thread_default_coding_workspace/runs/stream', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          input: { messages: [{ role: 'user', content: '写代码' }] },
          context: { model_name: 'deepseek-chat', workModeId: 'coding' }
        })
      })
    )

    expect(stream.status).toBe(200)
    const thread = await h.threadService.get('thread_default_coding_workspace')
    expect(thread?.workspace).toBe('/tmp/kun/coding-workspace')
  })

  it('updates a pre-created KWorks thread to the selected workspaceRoot before running', async () => {
    const h = buildHarness()
    await h.threadService.create(
      { workspace: process.cwd(), model: 'deepseek-chat', mode: 'agent' },
      { id: 'thread_workspace_root_existing', title: 'New chat' }
    )
    const selectedWorkspace = '/tmp/kk_aoshu'

    const stream = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/threads/thread_workspace_root_existing/runs/stream', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          input: { messages: [{ role: 'user', content: '当前目录是什么' }] },
          context: { model_name: 'deepseek-chat', workspaceRoot: selectedWorkspace }
        })
      })
    )

    expect(stream.status).toBe(200)
    const thread = await h.threadService.get('thread_workspace_root_existing')
    expect(thread?.workspace).toBe(selectedWorkspace)
  })

  it('prefixes KWorks skill task context so the selected built-in skill activates', async () => {
    const h = buildHarness()
    const stream = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/threads/thread_skill_context/runs/stream', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          input: { messages: [{ role: 'user', content: '帮我创建一个研报搜索技能' }] },
          context: {
            model_name: 'deepseek-chat',
            workspaceRoot: '/tmp',
            activeSkillId: 'skill-creator',
            skillIntent: 'create',
            targetSkillId: 'report-search'
          }
        })
      })
    )

    expect(stream.status).toBe(200)
    const thread = await h.threadService.get('thread_skill_context')
    expect(thread?.turns.at(-1)?.prompt).toContain('/skill:skill-creator')
    expect(thread?.turns.at(-1)?.prompt).toContain('Skill intent: create')
    expect(thread?.turns.at(-1)?.prompt).toContain('Target skill: report-search')
    expect(thread?.turns.at(-1)?.prompt).toContain('KWorks skill creation contract:')
    expect(thread?.turns.at(-1)?.prompt).toContain(
      'Ask for user input only when the skill goal, activation scenario, or expected output is genuinely missing.'
    )
  })

  it('streams KWorks compatibility assistant deltas as messages-tuple frames', async () => {
    const h = buildHarness()
    await h.threadService.create(
      { workspace: '/tmp', model: 'deepseek-chat', mode: 'agent' },
      { id: 'thread_stream_delta', title: 'Streaming' }
    )
    const { turnId } = await h.turnService.startTurn({
      threadId: 'thread_stream_delta',
      request: { prompt: 'hi', model: 'deepseek-chat' }
    })
    const stream = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/threads/thread_stream_delta/runs/stream', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          input: { messages: [{ role: 'user', content: 'hi again' }] },
          context: { model_name: 'deepseek-chat', workspace: '/tmp' }
        })
      })
    )
    expect(stream.status).toBe(200)
    const runEvents = await h.sessionStore.loadEventsSince('thread_stream_delta', 0)
    const runTurnId = runEvents.find((event) => event.kind === 'turn_started' && event.turnId !== turnId)?.turnId
    expect(runTurnId).toBeTruthy()

    await h.events.record({
      kind: 'assistant_reasoning_delta',
      threadId: 'thread_stream_delta',
      turnId: runTurnId,
      itemId: 'item_stream_reasoning',
      item: makeAssistantReasoningItem({
        id: 'item_stream_reasoning',
        threadId: 'thread_stream_delta',
        turnId: runTurnId ?? '',
        text: '内部计算过程',
        status: 'running'
      })
    })
    await h.events.record({
      kind: 'assistant_text_delta',
      threadId: 'thread_stream_delta',
      turnId: runTurnId,
      itemId: 'item_stream_text',
      item: makeAssistantTextItem({
        id: 'item_stream_text',
        threadId: 'thread_stream_delta',
        turnId: runTurnId ?? '',
        text: 'he',
        status: 'running'
      })
    })
    await h.events.record({
      kind: 'assistant_text_delta',
      threadId: 'thread_stream_delta',
      turnId: runTurnId,
      itemId: 'item_stream_text',
      item: makeAssistantTextItem({
        id: 'item_stream_text',
        threadId: 'thread_stream_delta',
        turnId: runTurnId ?? '',
        text: 'llo',
        status: 'running'
      })
    })
    await h.turnService.finishTurn({
      threadId: 'thread_stream_delta',
      turnId: runTurnId ?? '',
      status: 'completed'
    })

    const events = await readSseEvents(stream)
    const tupleContents = events
      .filter((frame) => frame.includes('event: messages-tuple'))
      .map((frame) => {
        const dataLine = frame.split('\n').find((line) => line.startsWith('data: '))
        const tuple = dataLine ? JSON.parse(dataLine.slice(6)) as Array<{ content?: string }> : []
        return tuple[0]?.content
      })
    expect(tupleContents).toEqual(expect.arrayContaining(['he', 'hello']))
    expect(tupleContents).not.toContain('内部计算过程')
  })

  it('requires auth for runtime info', async () => {
    const h = buildHarness()
    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/runtime/info')
    )

    expect(response.status).toBe(401)
  })

  it('returns structured validation errors for invalid JSON bodies', async () => {
    const h = buildHarness()
    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: '{'
      })
    )

    expect(response.status).toBe(400)
    expect(await readJson(response)).toMatchObject({
      code: 'validation_error',
      message: 'invalid JSON body'
    })
  })

  it('returns runtime tool diagnostics', async () => {
    const h = buildHarness()
    h.runtime.toolDiagnostics = () => ({
      providers: [
        {
          id: 'mcp:github',
          kind: 'mcp',
          enabled: true,
          available: false,
          reason: 'token=provider-secret'
        }
      ],
      mcpServers: [
        {
          id: 'github',
          enabled: true,
          transport: 'stdio',
          trustScope: 'user',
          available: false,
          status: 'error',
          toolCount: 0,
          lastError: 'Authorization: Bearer server-secret'
        }
      ],
      webProviders: [],
      skills: {
        enabled: false,
        roots: [],
        skills: [],
        validationErrors: [],
        lastActivations: []
      },
      attachments: {
        enabled: false,
        rootDir: '',
        count: 0,
        totalBytes: 0
      },
      memory: {
        enabled: false,
        rootDir: '',
        activeCount: 0,
        tombstoneCount: 0,
        lastInjectedIds: []
      }
    })
    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/runtime/tools', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )

    expect(response.status).toBe(200)
    const body = await readJson(response) as {
      providers: Array<{ id: string; reason?: string }>
      mcpServers: Array<{ id: string; lastError?: string }>
      webProviders: unknown[]
      skills: unknown
      attachments: unknown
      memory: unknown
    }
    expect(body.providers[0]).toMatchObject({ id: 'mcp:github', reason: 'token=<redacted>' })
    expect(body.mcpServers[0]).toMatchObject({
      id: 'github',
      lastError: 'Authorization=<redacted>'
    })
    expect(JSON.stringify(body)).not.toContain('provider-secret')
    expect(JSON.stringify(body)).not.toContain('server-secret')
  })

  it('requires auth for runtime tool diagnostics', async () => {
    const h = buildHarness()
    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/runtime/tools')
    )

    expect(response.status).toBe(401)
  })

  it('submits A2A tasks asynchronously and completes them in the background', async () => {
    const h = buildHarness()
    const records = new Map<string, unknown>()
    h.runtime.a2aTaskStore = {
      async upsert(record: { id: string }) {
        records.set(record.id, structuredClone(record))
      },
      async get(id: string) {
        return records.get(id) as never
      },
      async list() {
        return Array.from(records.values()) as never
      }
    } as never
    h.runtime.agentCard = {
      id: 'qiongqi:test-b',
      url: 'http://localhost',
      name: 'Test B',
      version: '0.1.0',
      skills: [],
      capabilities: h.runtime.info().capabilities,
      model: {
        provider: 'fake',
        defaultModel: 'fake-model',
        endpointFormats: ['chat_completions']
      },
      endpoints: {
        wellKnown: '/.well-known/agent-card.json',
        a2a: '/a2a',
        mcp: '/mcp'
      }
    }
    let completed = false
    h.runtime.runTurn = async (threadId, turnId) => {
      await new Promise((resolve) => setTimeout(resolve, 40))
      await h.sessionStore.appendItem(threadId, makeAssistantTextItem({
        id: 'item_a2a_done',
        threadId,
        turnId,
        text: 'background A2A finished',
        status: 'completed'
      }))
      completed = true
      return 'completed'
    }

    const submit = await dispatchRequest(
      h.router,
      new Request('http://localhost/a2a/tasks', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'run async task', label: 'async-a2a' })
      })
    )

    expect(submit.status).toBe(202)
    expect(completed).toBe(false)
    const body = await readJson(submit) as { task: { id: string; status: string; threadId?: string; turnId?: string } }
    expect(body.task.status).toBe('working')
    expect(body.task.threadId).toBeTruthy()
    expect(body.task.turnId).toBeTruthy()

    await new Promise((resolve) => setTimeout(resolve, 80))
    const lookup = await dispatchRequest(
      h.router,
      new Request(`http://localhost/a2a/tasks/${body.task.id}`, {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(lookup.status).toBe(200)
    await expect(readJson(lookup)).resolves.toMatchObject({
      id: body.task.id,
      status: 'completed',
      summary: 'background A2A finished'
    })
  })

  it('cancels a running A2A task through the runtime turn hook', async () => {
    const h = buildHarness()
    const records = new Map<string, unknown>()
    h.runtime.a2aTaskStore = {
      async upsert(record: { id: string }) {
        records.set(record.id, structuredClone(record))
      },
      async get(id: string) {
        return records.get(id) as never
      },
      async list() {
        return Array.from(records.values()) as never
      }
    } as never
    let cancelInput: { threadId: string; turnId: string } | undefined
    h.runtime.cancelA2ATaskTurn = async (input) => {
      cancelInput = input
    }
    h.runtime.runTurn = async () => {
      await new Promise((resolve) => setTimeout(resolve, 100))
      return 'completed'
    }

    const submit = await dispatchRequest(
      h.router,
      new Request('http://localhost/a2a/tasks', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'cancel me' })
      })
    )
    const submitted = await readJson(submit) as { task: { id: string; threadId: string; turnId: string } }

    const cancel = await dispatchRequest(
      h.router,
      new Request(`http://localhost/a2a/tasks/${submitted.task.id}/cancel`, {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1' }
      })
    )

    expect(cancel.status).toBe(200)
    expect(cancelInput).toEqual({
      threadId: submitted.task.threadId,
      turnId: submitted.task.turnId
    })
    await expect(readJson(cancel)).resolves.toMatchObject({
      id: submitted.task.id,
      status: 'cancelled'
    })

    await new Promise((resolve) => setTimeout(resolve, 130))
    const lookup = await dispatchRequest(
      h.router,
      new Request(`http://localhost/a2a/tasks/${submitted.task.id}`, {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    await expect(readJson(lookup)).resolves.toMatchObject({
      id: submitted.task.id,
      status: 'cancelled'
    })
  })

  it('lists discovered skills through the HTTP layer', async () => {
    const h = buildHarness()
    h.runtime.skills = () => ({
      enabled: true,
      roots: ['/tmp/skills'],
      skills: [
        {
          id: 'review',
          name: 'Review',
          description: 'Review the current change',
          version: '1.0.0',
          root: '/tmp/skills/review',
          legacy: false,
          triggers: { commands: ['/review'], promptPatterns: [], fileTypes: [] },
          allowedTools: ['read']
        }
      ],
      validationErrors: [],
      lastActivations: []
    })

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/skills', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )

    expect(response.status).toBe(200)
    const body = await readJson(response) as { skills: Array<{ id: string; description?: string }> }
    expect(body.skills[0]).toMatchObject({
      id: 'review',
      description: 'Review the current change'
    })
  })

  it('prefers v2 skill diagnostics over legacy skill runtime diagnostics', async () => {
    const h = buildHarness()
    h.runtime.skills = () => ({
      enabled: true,
      roots: ['/tmp/legacy-skills'],
      skills: [],
      validationErrors: [
        {
          root: '/tmp/legacy-skills/tdd',
          message: 'legacy parser rejected v2 manifest'
        }
      ],
      lastActivations: []
    })
    h.runtime.skillsV2 = () => ({
      enabled: true,
      roots: ['/tmp/v2-skills'],
      skills: [
        {
          id: 'tdd',
          name: 'TDD',
          description: 'Write tests first',
          version: '1.0.0',
          root: '/tmp/v2-skills/tdd',
          legacy: false,
          source: 'official',
          category: 'development',
          commands: [],
          contributions: { chatMenu: [], quickTask: [] },
          permissions: { workspace: 'write', network: false, exec: 'workspace' },
          triggers: { commands: ['/tdd'], promptPatterns: [], fileTypes: [] },
          allowedTools: []
        }
      ],
      validationErrors: [],
      lastActivations: []
    })

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/skills', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )

    expect(response.status).toBe(200)
    const body = await readJson(response) as {
      roots: string[]
      skills: Array<{ id: string; root: string; commands?: unknown[] }>
      validationErrors: unknown[]
    }
    expect(body.roots).toEqual(['/tmp/v2-skills'])
    expect(body.skills.map((skill) => skill.id)).toEqual(['tdd'])
    expect(body.skills[0]).toMatchObject({
      root: '/tmp/v2-skills/tdd',
      commands: []
    })
    expect(body.validationErrors).toEqual([])
  })

  it('lists KWorks skill lifecycle entries including built-in management skills', async () => {
    const h = buildHarness()
    h.runtime.skillsV2 = () => ({
      enabled: true,
      roots: ['/tmp/skills/public', '/tmp/skills/custom'],
      skills: [
        {
          id: 'skill-creator',
          name: 'skill-creator',
          description: 'Create and improve skills',
          version: '1.0.0',
          root: '/tmp/skills/public/skill-creator',
          legacy: true,
          source: 'official',
          category: 'workflow',
          commands: [],
          contributions: { chatMenu: [], quickTask: [] },
          permissions: { workspace: 'write', network: true, exec: 'workspace' },
          triggers: { commands: [], promptPatterns: [], fileTypes: [] },
          allowedTools: []
        },
        {
          id: 'find-skills',
          name: 'find-skills',
          description: 'Find installable skills',
          version: '1.0.0',
          root: '/tmp/skills/public/find-skills',
          legacy: true,
          source: 'official',
          category: 'workflow',
          commands: [],
          contributions: { chatMenu: [], quickTask: [] },
          permissions: { workspace: 'read', network: true, exec: 'workspace' },
          triggers: { commands: [], promptPatterns: [], fileTypes: [] },
          allowedTools: []
        },
        {
          id: 'skill-manage',
          name: 'skill-manage',
          description: 'Register and unregister skills',
          version: '1.0.0',
          root: '/tmp/skills/public/skill-manage',
          legacy: true,
          source: 'official',
          category: 'workflow',
          commands: [],
          contributions: { chatMenu: [], quickTask: [] },
          permissions: { workspace: 'write', network: false, exec: 'workspace' },
          triggers: { commands: [], promptPatterns: [], fileTypes: [] },
          allowedTools: []
        }
      ],
      validationErrors: [],
      lastActivations: []
    })

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/skills', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )

    expect(response.status).toBe(200)
    const body = await readJson(response) as { skills: Array<{ id: string; name: string; category: string; family: string; status: string; builtin: boolean; enabled: boolean; editable: boolean }> }
    expect(body.skills.map((skill) => skill.id)).toEqual(['find-skills', 'skill-creator', 'skill-manage'])
    expect(body.skills.find((skill) => skill.id === 'skill-creator')).toMatchObject({
      name: 'skill-creator',
      category: 'public',
      status: 'registered',
      builtin: true,
      enabled: true,
      editable: false
    })
    expect(body.skills.find((skill) => skill.id === 'skill-creator')?.family).toBe('kworks-management')
  })

  it('marks QiongQi coding preset skills separately from KWorks management skills', async () => {
    const h = buildHarness()
    h.runtime.skillsV2 = () => ({
      enabled: true,
      roots: ['/tmp/qiongqi/skills'],
      skills: [
        {
          id: 'tdd',
          name: 'TDD',
          description: 'Write tests first',
          version: '1.0.0',
          root: '/tmp/qiongqi/skills/tdd',
          legacy: false,
          source: 'official',
          category: 'development',
          commands: [],
          contributions: { chatMenu: [], quickTask: [] },
          permissions: { workspace: 'write', network: false, exec: 'workspace' },
          triggers: { commands: ['/tdd'], promptPatterns: [], fileTypes: [] },
          allowedTools: []
        }
      ],
      validationErrors: [],
      lastActivations: []
    })

    const response = await dispatchRequest(h.router, new Request('http://localhost/api/skills', {
      headers: { authorization: 'Bearer tok-1' }
    }))

    expect(response.status).toBe(200)
    const body = await readJson(response) as { skills: Array<{ id: string; family: string; builtin: boolean; editable: boolean }> }
    expect(body.skills[0]).toMatchObject({
      id: 'tdd',
      family: 'qiongqi-coding',
      builtin: true,
      editable: false
    })
  })

  it('toggles KWorks skill enablement through the legacy skills map', async () => {
    const h = buildHarness()
    const session = await h.runtime.authService?.initialize({
      email: 'skill-toggle@example.com',
      password: 'password123'
    })
    h.runtime.skillsV2 = () => ({
      enabled: true,
      roots: ['/tmp/skills/public'],
      skills: [
        {
          id: 'xlsx-creator',
          name: 'xlsx-creator',
          version: '1.0.0',
          root: '/tmp/skills/public/xlsx-creator',
          legacy: true,
          source: 'official',
          category: 'workflow',
          commands: [],
          contributions: { chatMenu: [], quickTask: [] },
          permissions: { workspace: 'write', network: true, exec: 'workspace' },
          triggers: { commands: [], promptPatterns: [], fileTypes: [] },
          allowedTools: []
        }
      ],
      validationErrors: [],
      lastActivations: []
    })

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/skills/xlsx-creator', {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${session?.accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ enabled: false })
      })
    )

    expect(response.status).toBe(200)
    await expect(readJson(response)).resolves.toMatchObject({
      skill: {
        id: 'xlsx-creator',
        enabled: false,
        status: 'disabled'
      }
    })

    const saved = await h.runtime.kworksUserDataStore?.getUserSetting(session!.user.id, 'capabilities.skills.compat')
    expect(saved).toMatchObject({
      'xlsx-creator': { enabled: false }
    })
    const config = await h.runtime.configStore?.read()
    expect(config?.capabilities?.skills?.enabledSkills).toMatchObject({
      'xlsx-creator': false
    })
  })

  it('syncs legacy KWorks skills from MCP config into QiongQi capabilities', async () => {
    const h = buildHarness()
    const session = await h.runtime.authService?.initialize({
      email: 'legacy-skill-sync@example.com',
      password: 'password123'
    })

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/mcp/config', {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${session?.accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          mcpServers: {},
          skills: {
            'skill-creator': { enabled: true },
            'find-skills': false
          }
        })
      })
    )

    expect(response.status).toBe(200)
    const config = await h.runtime.configStore?.read()
    expect(config?.capabilities?.skills).toMatchObject({
      enabled: true,
      enabledSkills: {
        'skill-creator': true,
        'find-skills': false
      }
    })
  })

  it('registers and unregisters KWorks skills through lifecycle endpoints', async () => {
    const h = buildHarness()
    const session = await h.runtime.authService?.initialize({
      email: 'skill-lifecycle@example.com',
      password: 'password123'
    })
    h.runtime.skillsV2 = () => ({
      enabled: true,
      roots: ['/tmp/skills/public'],
      skills: [
        {
          id: 'xlsx-creator',
          name: 'xlsx-creator',
          version: '1.0.0',
          root: '/tmp/skills/public/xlsx-creator',
          legacy: true,
          source: 'official',
          category: 'workflow',
          commands: [],
          contributions: { chatMenu: [], quickTask: [] },
          permissions: { workspace: 'read', network: true, exec: 'workspace' },
          triggers: { commands: [], promptPatterns: [], fileTypes: [] },
          allowedTools: []
        }
      ],
      validationErrors: [],
      lastActivations: []
    })

    const unregister = await dispatchRequest(h.router, new Request('http://localhost/api/skills/xlsx-creator/unregister', {
      method: 'POST',
      headers: { authorization: `Bearer ${session?.accessToken}` }
    }))
    expect(unregister.status).toBe(200)
    await expect(readJson(unregister)).resolves.toMatchObject({
      skill: { id: 'xlsx-creator', enabled: false, status: 'disabled' }
    })

    const register = await dispatchRequest(h.router, new Request('http://localhost/api/skills/xlsx-creator/register', {
      method: 'POST',
      headers: { authorization: `Bearer ${session?.accessToken}` }
    }))
    expect(register.status).toBe(200)
    await expect(readJson(register)).resolves.toMatchObject({
      skill: { id: 'xlsx-creator', enabled: true, status: 'registered' }
    })
  })

  it('creates a KWorks skill through the deterministic create endpoint', async () => {
    const h = buildHarness()
    const session = await h.runtime.authService?.initialize({
      email: 'skill-create@example.com',
      password: 'password123'
    })
    let refreshCount = 0
    h.runtime.refreshRuntimeTools = async () => {
      refreshCount += 1
    }
    await rm(join('/tmp/kun', 'skills', 'custom', 'shared', 'report-search'), { recursive: true, force: true })

    const response = await dispatchRequest(h.router, new Request('http://localhost/api/skills/create', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${session?.accessToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        id: 'report-search',
        name: '研报搜索',
        description: '搜索和整理证券研究资料',
        trigger: '用户需要搜索研报或整理证券研究资料',
        output: 'Markdown 摘要，包含来源、要点和后续问题',
        procedure: '1. 明确主题和范围\n2. 检索资料\n3. 输出结构化摘要',
        workModeId: 'office'
      })
    }))

    expect(response.status).toBe(201)
    const body = await readJson(response) as { success: boolean; skill_id: string; root: string; workModeId: string }
    expect(body).toMatchObject({
      success: true,
      skill_id: 'report-search',
      workModeId: 'office'
    })
    expect(body.root.endsWith('/skills/custom/shared/report-search')).toBe(true)
    const skillMd = await readFile(join(body.root, 'SKILL.md'), 'utf8')
    expect(skillMd).toContain('name: report-search')
    expect(skillMd).toContain('description: 搜索和整理证券研究资料')
    expect(skillMd).toContain('## When To Use')
    expect(skillMd).toContain('用户需要搜索研报或整理证券研究资料')
    expect(skillMd).toContain('## Output Contract')

    const config = await h.runtime.configStore?.read()
    expect(config?.capabilities?.skills?.enabled).toBe(true)
    expect(config?.capabilities?.skills?.roots).toContain('/tmp/kun/skills/custom/shared')
    expect(config?.capabilities?.skills?.enabledSkills).toMatchObject({
      'report-search': true
    })
    expect(config?.capabilities?.skills?.modeSkillOverrides?.office?.addedSkillIds).toContain('report-search')
    const saved = await h.runtime.kworksUserDataStore?.getUserSetting(session!.user.id, 'capabilities.skills')
    expect(saved).toMatchObject({
      enabled: true,
      enabledSkills: {
        'report-search': true
      }
    })
    expect(refreshCount).toBe(1)
  })

  it('creates a skill draft from uploaded scripts and analyzes a python entrypoint', async () => {
    const h = buildHarness()
    const form = new FormData()
    form.append('mode', 'scripts')
    form.append('files', new File([
      [
        'import argparse',
        'import markdown',
        '',
        'def main():',
        "    parser = argparse.ArgumentParser(description='Convert Markdown to HTML')",
        "    parser.add_argument('input')",
        "    parser.add_argument('output')",
        '    parser.parse_args()',
        '',
        "if __name__ == '__main__':",
        '    main()'
      ].join('\n')
    ], 'convert.py', { type: 'text/x-python' }))

    const create = await dispatchRequest(h.router, new Request('http://localhost/api/skills/drafts', {
      method: 'POST',
      headers: { authorization: 'Bearer tok-1' },
      body: form
    }))
    expect(create.status).toBe(201)
    const created = await readJson(create) as { draftId: string; files: Array<{ path: string; kind: string; size: number }> }
    expect(created.draftId).toMatch(/^draft_/)
    expect(created.files).toEqual([
      { path: 'convert.py', kind: 'python', size: expect.any(Number) }
    ])

    const analyze = await dispatchRequest(h.router, new Request(`http://localhost/api/skills/drafts/${created.draftId}/analyze`, {
      method: 'POST',
      headers: { authorization: 'Bearer tok-1' }
    }))
    expect(analyze.status).toBe(200)
    const analyzed = await readJson(analyze) as {
      evidence: {
        entryCandidates: Array<{ path: string; reason: string }>
        commands: Array<{ suggestedInvocation: string; arguments: Array<{ name: string }> }>
        dependencies: Array<{ name: string }>
      }
    }
    expect(analyzed.evidence.entryCandidates[0]?.path).toBe('convert.py')
    expect(analyzed.evidence.entryCandidates[0]?.reason).toContain('__main__')
    expect(analyzed.evidence.commands[0]?.suggestedInvocation).toBe('python scripts/convert.py <input> <output>')
    expect(analyzed.evidence.commands[0]?.arguments.map((arg) => arg.name)).toEqual(['input', 'output'])
    expect(analyzed.evidence.dependencies.map((dep) => dep.name)).toContain('markdown')
  })

  it('lists skill drafts through the draft route instead of the dynamic skill route', async () => {
    const h = buildHarness()
    const response = await dispatchRequest(h.router, new Request('http://localhost/api/skills/drafts', {
      headers: { authorization: 'Bearer tok-1' }
    }))

    expect(response.status).toBe(200)
    const body = await readJson(response) as { drafts?: unknown[] }
    expect(Array.isArray(body.drafts)).toBe(true)
  })

  it('generates and installs a script skill with copied scripts and relative commands', async () => {
    const h = buildHarness()
    await rm(join('/tmp/kun', 'skills', 'custom', 'shared', 'convert'), { recursive: true, force: true })
    const form = new FormData()
    form.append('mode', 'scripts')
    form.append('workModeId', 'office')
    form.append('files', new File([
      [
        "import argparse",
        "parser = argparse.ArgumentParser(description='Convert Markdown to HTML')",
        "parser.add_argument('input')",
        "parser.add_argument('output')"
      ].join('\n')
    ], 'convert.py'))

    const create = await dispatchRequest(h.router, new Request('http://localhost/api/skills/drafts', {
      method: 'POST',
      headers: { authorization: 'Bearer tok-1' },
      body: form
    }))
    const { draftId } = await readJson(create) as { draftId: string }

    const generate = await dispatchRequest(h.router, new Request(`http://localhost/api/skills/drafts/${draftId}/generate`, {
      method: 'POST',
      headers: { authorization: 'Bearer tok-1' }
    }))
    expect(generate.status).toBe(200)
    const generated = await readJson(generate) as {
      draft: {
        metadata: { id: string; name: string; description: string }
        skillMarkdown: string
        manifestPatch: Record<string, unknown>
      }
    }
    expect(generated.draft.metadata.id).toBe('convert')
    expect(generated.draft.skillMarkdown).toContain('python scripts/convert.py <input> <output>')
    expect(generated.draft.skillMarkdown).not.toContain('/Users/')

    const install = await dispatchRequest(h.router, new Request(`http://localhost/api/skills/drafts/${draftId}/install`, {
      method: 'POST',
      headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
      body: JSON.stringify({
        workModeId: 'office',
        metadata: generated.draft.metadata,
        skillMarkdown: generated.draft.skillMarkdown,
        manifestPatch: generated.draft.manifestPatch,
        confirmations: ['exec-workspace']
      })
    }))
    expect(install.status).toBe(201)
    const installed = await readJson(install) as { root: string; skill_id: string; workModeId: string }
    expect(installed.skill_id).toBe('convert')
    expect(installed.workModeId).toBe('office')
    await expect(readFile(join(installed.root, 'SKILL.md'), 'utf8')).resolves.toContain('python scripts/convert.py')
    await expect(readFile(join(installed.root, 'scripts', 'convert.py'), 'utf8')).resolves.toContain('argparse')
  })

  it('extracts uploaded zip skill packages, classifies them as package drafts, and installs without retaining the zip', async () => {
    const h = buildHarness()
    await rm(join('/tmp/kun', 'skills', 'custom', 'shared', 'kk-common'), { recursive: true, force: true })
    const form = new FormData()
    form.append('mode', 'scripts')
    form.append('workModeId', 'office')
    form.append('files', new File([
      storedZip([
        {
          path: 'kk-common/SKILL.md',
          content: [
            '---',
            'name: kk-common',
            'description: Common KWorks helpers',
            '---',
            '',
            '# KK Common',
            '',
            'Use this skill for common helper scripts.'
          ].join('\n')
        },
        {
          path: 'kk-common/skill.json',
          content: JSON.stringify({
            specVersion: '1.0',
            id: 'kk-common',
            name: 'KK Common',
            description: 'Common KWorks helpers',
            entry: 'SKILL.md',
            assets: ['scripts/script.py']
          })
        },
        {
          path: 'kk-common/scripts/script.py',
          content: 'print("kk common")\n'
        }
      ])
    ], 'kk-common.zip', { type: 'application/zip' }))

    const create = await dispatchRequest(h.router, new Request('http://localhost/api/skills/drafts', {
      method: 'POST',
      headers: { authorization: 'Bearer tok-1' },
      body: form
    }))
    expect(create.status).toBe(201)
    const created = await readJson(create) as {
      draftId: string
      mode: string
      files: Array<{ path: string; kind: string; size: number }>
    }
    expect(created.mode).toBe('package')
    expect(created.files.map((file) => file.path).sort()).toEqual([
      'SKILL.md',
      'scripts/script.py',
      'skill.json'
    ])
    expect(created.files.map((file) => file.path)).not.toContain('kk-common.zip')

    const generate = await dispatchRequest(h.router, new Request(`http://localhost/api/skills/drafts/${created.draftId}/generate`, {
      method: 'POST',
      headers: { authorization: 'Bearer tok-1' }
    }))
    expect(generate.status).toBe(200)
    const generated = await readJson(generate) as {
      draft: {
        metadata: { id: string; name: string; description: string }
        skillMarkdown: string
        manifestPatch: Record<string, unknown>
      }
    }
    expect(generated.draft.metadata).toMatchObject({
      id: 'kk-common',
      name: 'KK Common',
      description: 'Common KWorks helpers'
    })
    expect(generated.draft.skillMarkdown).toContain('# KK Common')

    const install = await dispatchRequest(h.router, new Request(`http://localhost/api/skills/drafts/${created.draftId}/install`, {
      method: 'POST',
      headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
      body: JSON.stringify({
        workModeId: 'office',
        metadata: generated.draft.metadata,
        skillMarkdown: generated.draft.skillMarkdown,
        manifestPatch: generated.draft.manifestPatch,
        confirmations: []
      })
    }))
    expect(install.status).toBe(201)
    const installed = await readJson(install) as { root: string; skill_id: string; workModeId: string }
    expect(installed.skill_id).toBe('kk-common')
    expect(installed.workModeId).toBe('office')
    await expect(readFile(join(installed.root, 'SKILL.md'), 'utf8')).resolves.toContain('# KK Common')
    await expect(readFile(join(installed.root, 'scripts', 'script.py'), 'utf8')).resolves.toContain('kk common')
    await expect(readFile(join(installed.root, 'scripts', 'kk-common.zip'), 'utf8')).rejects.toThrow()
  })

  it('installs imported package skills whose SKILL.md documents absolute local paths', async () => {
    const h = buildHarness()
    await rm(join('/tmp/kun', 'skills', 'custom', 'shared', 'abs-doc'), { recursive: true, force: true })
    const form = new FormData()
    form.append('mode', 'package')
    form.append('workModeId', 'office')
    form.append('files', new File([
      storedZip([
        {
          path: 'abs-doc/SKILL.md',
          content: [
            '---',
            'name: abs-doc',
            'description: Imported package with documented local paths',
            '---',
            '',
            '# Abs Doc',
            '',
            'Example source path from the author machine: /Users/libing/Downloads/source.csv'
          ].join('\n')
        },
        {
          path: 'abs-doc/skill.json',
          content: JSON.stringify({
            specVersion: '1.0',
            id: 'abs-doc',
            name: 'Abs Doc',
            description: 'Imported package with documented local paths',
            entry: 'SKILL.md'
          })
        }
      ])
    ], 'abs-doc.zip', { type: 'application/zip' }))

    const create = await dispatchRequest(h.router, new Request('http://localhost/api/skills/drafts', {
      method: 'POST',
      headers: { authorization: 'Bearer tok-1' },
      body: form
    }))
    expect(create.status).toBe(201)
    const created = await readJson(create) as { draftId: string; mode: string }
    expect(created.mode).toBe('package')

    const generate = await dispatchRequest(h.router, new Request(`http://localhost/api/skills/drafts/${created.draftId}/generate`, {
      method: 'POST',
      headers: { authorization: 'Bearer tok-1' }
    }))
    expect(generate.status).toBe(200)
    const generated = await readJson(generate) as {
      draft: {
        metadata: { id: string; name: string; description: string }
        skillMarkdown: string
        manifestPatch: Record<string, unknown>
      }
    }
    expect(generated.draft.skillMarkdown).toContain('/Users/libing/Downloads/source.csv')

    const install = await dispatchRequest(h.router, new Request(`http://localhost/api/skills/drafts/${created.draftId}/install`, {
      method: 'POST',
      headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
      body: JSON.stringify({
        workModeId: 'office',
        metadata: generated.draft.metadata,
        skillMarkdown: generated.draft.skillMarkdown,
        manifestPatch: generated.draft.manifestPatch,
        confirmations: []
      })
    }))
    expect(install.status).toBe(201)
    const installed = await readJson(install) as { root: string; skill_id: string }
    expect(installed.skill_id).toBe('abs-doc')
    await expect(readFile(join(installed.root, 'SKILL.md'), 'utf8')).resolves.toContain('/Users/libing/Downloads/source.csv')
  })

  it('supports deflated zip skill packages and rejects unsafe zip paths', async () => {
    const h = buildHarness()
    const form = new FormData()
    form.append('mode', 'package')
    form.append('files', new File([
      zipArchive([
        {
          path: 'deflated-skill/SKILL.md',
          content: [
            '---',
            'name: deflated-skill',
            'description: Deflated skill package',
            '---',
            '# Deflated Skill'
          ].join('\n'),
          compression: 8
        }
      ])
    ], 'deflated-skill.zip', { type: 'application/zip' }))

    const create = await dispatchRequest(h.router, new Request('http://localhost/api/skills/drafts', {
      method: 'POST',
      headers: { authorization: 'Bearer tok-1' },
      body: form
    }))
    expect(create.status).toBe(201)
    await expect(readJson(create)).resolves.toMatchObject({
      mode: 'package',
      files: [{ path: 'SKILL.md', kind: 'markdown' }]
    })

    const bad = new FormData()
    bad.append('mode', 'package')
    bad.append('files', new File([
      storedZip([{ path: '../evil/SKILL.md', content: '# bad' }])
    ], 'evil.zip', { type: 'application/zip' }))

    const rejected = await dispatchRequest(h.router, new Request('http://localhost/api/skills/drafts', {
      method: 'POST',
      headers: { authorization: 'Bearer tok-1' },
      body: bad
    }))
    expect(rejected.status).toBe(400)
    await expect(readJson(rejected)).resolves.toMatchObject({
      message: expect.stringContaining('unsafe')
    })
  })

  it('installs package drafts preserving package-relative files instead of copying uploads into scripts', async () => {
    const h = buildHarness()
    await rm(join('/tmp/kun', 'skills', 'custom', 'shared', 'market-brief'), { recursive: true, force: true })
    const form = new FormData()
    form.append('mode', 'package')
    form.append('workModeId', 'office')
    form.append('files', new File([
      [
        '---',
        'name: market-brief',
        'description: Create a market brief',
        '---',
        '',
        '# Market Brief'
      ].join('\n')
    ], 'market-brief/SKILL.md', { type: 'text/markdown' }))
    form.append('files', new File([
      JSON.stringify({
        specVersion: '1.0',
        id: 'market-brief',
        name: 'Market Brief',
        description: 'Create a market brief',
        entry: 'SKILL.md',
        assets: ['resources/template.md']
      })
    ], 'market-brief/skill.json', { type: 'application/json' }))
    form.append('files', new File(['# Template\n'], 'market-brief/resources/template.md', { type: 'text/markdown' }))

    const create = await dispatchRequest(h.router, new Request('http://localhost/api/skills/drafts', {
      method: 'POST',
      headers: { authorization: 'Bearer tok-1' },
      body: form
    }))
    expect(create.status).toBe(201)
    const created = await readJson(create) as { draftId: string; mode: string; files: Array<{ path: string }> }
    expect(created.mode).toBe('package')
    expect(created.files.map((file) => file.path).sort()).toEqual([
      'SKILL.md',
      'resources/template.md',
      'skill.json'
    ])

    const generate = await dispatchRequest(h.router, new Request(`http://localhost/api/skills/drafts/${created.draftId}/generate`, {
      method: 'POST',
      headers: { authorization: 'Bearer tok-1' }
    }))
    const generated = await readJson(generate) as {
      draft: {
        metadata: { id: string; name: string; description: string }
        skillMarkdown: string
        manifestPatch: Record<string, unknown>
      }
    }

    const install = await dispatchRequest(h.router, new Request(`http://localhost/api/skills/drafts/${created.draftId}/install`, {
      method: 'POST',
      headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
      body: JSON.stringify({
        workModeId: 'office',
        metadata: generated.draft.metadata,
        skillMarkdown: generated.draft.skillMarkdown,
        manifestPatch: generated.draft.manifestPatch,
        confirmations: []
      })
    }))
    expect(install.status).toBe(201)
    const installed = await readJson(install) as { root: string; skill_id: string }
    expect(installed.skill_id).toBe('market-brief')
    await expect(readFile(join(installed.root, 'resources', 'template.md'), 'utf8')).resolves.toContain('# Template')
    await expect(readFile(join(installed.root, 'scripts', 'template.md'), 'utf8')).rejects.toThrow()
  })

  it('rejects generated script skill installs that contain absolute local paths', async () => {
    const h = buildHarness()
    const form = new FormData()
    form.append('mode', 'scripts')
    form.append('files', new File(['print("ok")'], 'convert.py'))
    const create = await dispatchRequest(h.router, new Request('http://localhost/api/skills/drafts', {
      method: 'POST',
      headers: { authorization: 'Bearer tok-1' },
      body: form
    }))
    const { draftId } = await readJson(create) as { draftId: string }

    const install = await dispatchRequest(h.router, new Request(`http://localhost/api/skills/drafts/${draftId}/install`, {
      method: 'POST',
      headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
      body: JSON.stringify({
        workModeId: 'office',
        metadata: { id: 'convert', name: 'Convert', description: 'Convert files' },
        skillMarkdown: 'Run python /Users/libing/private/convert.py',
        manifestPatch: {
          permissions: {
            workspace: 'write',
            network: false,
            exec: 'workspace',
            requiresApproval: 'on-request'
          }
        },
        confirmations: []
      })
    }))
    expect(install.status).toBe(400)
    await expect(readJson(install)).resolves.toMatchObject({
      detail: expect.stringContaining('absolute')
    })
  })

  it('rejects invalid KWorks skill ids before creating files', async () => {
    const h = buildHarness()
    const session = await h.runtime.authService?.initialize({
      email: 'skill-create-invalid@example.com',
      password: 'password123'
    })

    const response = await dispatchRequest(h.router, new Request('http://localhost/api/skills/create', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${session?.accessToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        id: '../ReportSearch',
        name: 'Bad',
        description: 'bad skill',
        trigger: 'bad trigger',
        output: 'bad output'
      })
    }))

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toMatchObject({
      detail: 'id must start with a lowercase English letter or number and contain only lowercase English letters, numbers, or hyphens'
    })
  })

  it('refuses to delete built-in KWorks skills', async () => {
    const h = buildHarness()
    const session = await h.runtime.authService?.initialize({
      email: 'skill-delete@example.com',
      password: 'password123'
    })
    h.runtime.skillsV2 = () => ({
      enabled: true,
      roots: ['/tmp/skills/public'],
      skills: [
        {
          id: 'skill-creator',
          name: 'skill-creator',
          version: '1.0.0',
          root: '/tmp/skills/public/skill-creator',
          legacy: true,
          source: 'official',
          category: 'workflow',
          commands: [],
          contributions: { chatMenu: [], quickTask: [] },
          permissions: { workspace: 'write', network: true, exec: 'workspace' },
          triggers: { commands: [], promptPatterns: [], fileTypes: [] },
          allowedTools: []
        }
      ],
      validationErrors: [],
      lastActivations: []
    })

    const response = await dispatchRequest(h.router, new Request('http://localhost/api/skills/skill-creator', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${session?.accessToken}` }
    }))

    expect(response.status).toBe(403)
  })

  it('returns the real user message item id when starting a turn', async () => {
    const h = buildHarness()
    await h.threadService.create({
      workspace: '/tmp',
      model: 'deepseek-chat',
      mode: 'agent',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write'
    }, { id: 'thr_1', title: 'demo' })

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads/thr_1/turns', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'hello' })
      })
    )

    expect(response.status).toBe(202)
    const body = await readJson(response) as { turnId: string; userMessageItemId: string }
    expect(body.turnId).toMatch(/^turn_/)
    expect(body.userMessageItemId).toBe(`item_${body.turnId}_user`)
  })

  it('derives the native thread title from the first turn prompt for default-title threads', async () => {
    const h = buildHarness()
    await h.threadService.create({
      workspace: '/tmp',
      model: 'deepseek-chat',
      mode: 'agent',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write'
    }, { id: 'thr_v1_title', title: 'New chat' })

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads/thr_v1_title/turns', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: '  我说当前系统有哪些技能  '
        })
      })
    )

    expect(response.status).toBe(202)
    const thread = await h.threadService.get('thr_v1_title')
    expect(thread?.title).toBe('我说当前系统有哪些技能')
    const events = await h.sessionStore.loadEventsSince('thr_v1_title', 0)
    expect(events.some((event) => event.kind === 'thread_updated' && event.title === '我说当前系统有哪些技能')).toBe(true)
  })

  it('creates and lists threads through the HTTP layer', async () => {
    const h = buildHarness()
    const create = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ workspace: '/tmp', model: 'deepseek-chat' })
      })
    )
    expect(create.status).toBe(201)
    const created = (await readJson(create)) as { id: string }
    const list = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    const listed = (await readJson(list)) as { threads: { id: string }[] }
    expect(listed.threads.map((t) => t.id)).toContain(created.id)
  })

  it('creates native task threads in the user workspace when workspace is omitted', async () => {
    const h = buildHarness()
    const create = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'deepseek-chat', workModeId: 'office' })
      })
    )
    expect(create.status).toBe(201)
    const created = await readJson(create) as { workspace: string }
    expect(created.workspace).toBe('/tmp/kun/users/runtime/workspace')
    expect(created.workspace).not.toBe(process.cwd())
  })

  it('creates native coding threads in the dedicated coding workspace when workspace is omitted', async () => {
    const h = buildHarness()
    const create = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'deepseek-chat', workModeId: 'coding' })
      })
    )
    expect(create.status).toBe(201)
    const created = await readJson(create) as { workspace: string }
    expect(created.workspace).toBe('/tmp/kun/coding-workspace')
  })

  it('sets, reads, and clears thread goals through the HTTP layer', async () => {
    const h = buildHarness()
    await h.threadService.create({
      workspace: '/tmp',
      model: 'deepseek-chat',
      mode: 'agent'
    }, { id: 'thr_goal', title: 'Goal' })

    const setGoal = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads/thr_goal/goal', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ objective: 'ship goal mode', status: 'active' })
      })
    )
    expect(setGoal.status).toBe(200)
    const setBody = await readJson(setGoal) as { goal?: { objective?: string; status?: string } }
    expect(setBody.goal).toMatchObject({ objective: 'ship goal mode', status: 'active' })

    const readGoal = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads/thr_goal/goal', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(readGoal.status).toBe(200)
    const readBody = await readJson(readGoal) as { goal?: { objective?: string } | null }
    expect(readBody.goal?.objective).toBe('ship goal mode')

    const clearGoal = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads/thr_goal/goal', {
        method: 'DELETE',
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(clearGoal.status).toBe(200)
    expect(await readJson(clearGoal)).toEqual({ cleared: true })
  })

  it('sets, reads, and clears thread todos through the HTTP layer', async () => {
    const h = buildHarness()
    await h.threadService.create({
      workspace: '/tmp',
      model: 'deepseek-chat',
      mode: 'agent'
    }, { id: 'thr_todos', title: 'Todos' })

    const setTodos = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads/thr_todos/todos', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          todos: [
            { content: 'Wire API', status: 'completed' },
            { content: 'Render panel', status: 'pending' }
          ]
        })
      })
    )
    expect(setTodos.status).toBe(200)
    const setBody = await readJson(setTodos) as { todos?: { items?: Array<{ content?: string; status?: string }> } }
    expect(setBody.todos?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: 'Wire API', status: 'completed' })
    ]))

    const readTodos = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads/thr_todos/todos', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(readTodos.status).toBe(200)
    const readBody = await readJson(readTodos) as { todos?: { items?: Array<{ content?: string }> } | null }
    expect(readBody.todos?.items?.[0]?.content).toBe('Wire API')

    const clearTodos = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads/thr_todos/todos', {
        method: 'DELETE',
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(clearTodos.status).toBe(200)
    expect(await readJson(clearTodos)).toEqual({ cleared: true })
  })

  it('filters thread lists for search, archives, and limits', async () => {
    const h = buildHarness()
    await h.threadService.create(
      { workspace: '/tmp/alpha', model: 'deepseek-chat', mode: 'agent' },
      { id: 'thr_alpha', title: 'Alpha Project' }
    )
    await h.threadService.create(
      { workspace: '/tmp/beta', model: 'deepseek-chat', mode: 'agent' },
      { id: 'thr_beta', title: 'Beta Archive' }
    )
    await h.threadService.update('thr_beta', { status: 'archived' })

    const active = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(active.status).toBe(200)
    const activeBody = (await readJson(active)) as { threads: Array<{ id: string }> }
    expect(activeBody.threads.map((thread) => thread.id)).toEqual(['thr_alpha'])

    const archived = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads?archived_only=true', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    const archivedBody = (await readJson(archived)) as { threads: Array<{ id: string }> }
    expect(archivedBody.threads.map((thread) => thread.id)).toEqual(['thr_beta'])

    const search = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads?include_archived=true&search=archive', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    const searchBody = (await readJson(search)) as { threads: Array<{ id: string }> }
    expect(searchBody.threads.map((thread) => thread.id)).toEqual(['thr_beta'])

    const limited = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads?include_archived=true&limit=1', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    const limitedBody = (await readJson(limited)) as { threads: Array<{ id: string }> }
    expect(limitedBody.threads).toHaveLength(1)
  })

  it('deletes threads through the HTTP layer', async () => {
    const h = buildHarness()
    const create = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ workspace: '/tmp/delete-me', model: 'deepseek-chat' })
      })
    )
    expect(create.status).toBe(201)
    const created = (await readJson(create)) as { id: string }

    const deleted = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/threads/${created.id}`, {
        method: 'DELETE',
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(deleted.status).toBe(200)
    expect(await readJson(deleted)).toEqual({ id: created.id, deleted: true })

    const list = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads?include_archived=true', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    const listed = (await readJson(list)) as { threads: Array<{ id: string }> }
    expect(listed.threads.map((thread) => thread.id)).not.toContain(created.id)

    const detail = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/threads/${created.id}`, {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(detail.status).toBe(404)
  })

  it('returns 404 when deleting a missing thread', async () => {
    const h = buildHarness()
    const deleted = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads/missing-thread', {
        method: 'DELETE',
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(deleted.status).toBe(404)
    expect(await readJson(deleted)).toMatchObject({
      code: 'not_found',
      message: 'thread not found: missing-thread'
    })
  })

  it('rejects invalid thread creation bodies with 400', async () => {
    const h = buildHarness()
    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ workspace: '', model: '' })
      })
    )
    expect(response.status).toBe(400)
  })

  it('starts a turn and serves the SSE backlog', async () => {
    const h = buildHarness()
    const create = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ workspace: '/tmp', model: 'deepseek-chat' })
      })
    )
    const thread = (await readJson(create)) as { id: string }
    const turn = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/threads/${thread.id}/turns`, {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'hi' })
      })
    )
    expect(turn.status).toBe(202)
    const turnBody = (await readJson(turn)) as { threadId: string; turnId: string }
    expect(turnBody.threadId).toBe(thread.id)
    const detail = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/threads/${thread.id}`, {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    const detailBody = (await readJson(detail)) as {
      latestSeq: number
      turns: Array<{ items: Array<{ kind: string }> }>
    }
    expect(detailBody.latestSeq).toBeGreaterThan(0)
    expect(detailBody.turns.at(-1)?.items.some((item) => item.kind === 'user_message')).toBe(true)
    const eventStream = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/threads/${thread.id}/events?since_seq=0`, {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    const events = await readSseEvents(eventStream)
    const kinds = events.flatMap((frame) =>
      frame
        .split('\n')
        .filter((line) => line.startsWith('event:'))
        .map((line) => line.slice(7))
    )
    expect(kinds).toContain('turn_started')
  })

  it('hydrates thread detail items from the session log when the thread snapshot lags', async () => {
    const h = buildHarness()
    await h.threadService.create(
      { workspace: '/tmp', model: 'deepseek-chat', mode: 'agent' },
      { id: 'thr_lag', title: 'Lagging snapshot' }
    )
    const { turnId } = await h.turnService.startTurn({
      threadId: 'thr_lag',
      request: { prompt: 'hi' }
    })
    await h.sessionStore.appendItem('thr_lag', makeAssistantTextItem({
      id: 'item_answer',
      turnId,
      threadId: 'thr_lag',
      text: 'hello after reload',
      status: 'completed'
    }))
    const snapshot = await h.threadService.get('thr_lag')
    expect(snapshot?.turns.at(-1)?.items.map((item) => item.kind)).toEqual(['user_message'])

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads/thr_lag', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )

    expect(response.status).toBe(200)
    const body = (await readJson(response)) as {
      turns: Array<{ items: Array<{ kind: string; text?: string }> }>
    }
    expect(body.turns.at(-1)?.items.map((item) => item.kind)).toEqual(['user_message', 'assistant_text'])
    expect(body.turns.at(-1)?.items.at(-1)).toMatchObject({
      kind: 'assistant_text',
      text: 'hello after reload'
    })
  })

  it('persists GUI plan context from start-turn requests', async () => {
    const h = buildHarness()
    const create = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ workspace: '/tmp', model: 'deepseek-chat' })
      })
    )
    const thread = (await readJson(create)) as { id: string }
    const turn = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/threads/${thread.id}/turns`, {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Plan auth',
          guiPlan: {
            operation: 'draft',
            workspaceRoot: '/tmp',
            relativePath: '.deepseekgui/plan/auth.md',
            planId: '/tmp:.deepseekgui/plan/auth.md',
            sourceRequest: 'Add auth',
            title: 'Auth'
          }
        })
      })
    )
    expect(turn.status).toBe(202)
    const turnBody = (await readJson(turn)) as { turnId: string }
    const detail = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/threads/${thread.id}/turns/${turnBody.turnId}`, {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(detail.status).toBe(200)
    const detailBody = (await readJson(detail)) as { guiPlan?: { relativePath?: string; operation?: string } }
    expect(detailBody.guiPlan).toMatchObject({
      operation: 'draft',
      relativePath: '.deepseekgui/plan/auth.md'
    })
  })

  it('groups usage by the usage event model instead of the thread default model', async () => {
    const h = buildHarness()
    const today = new Date().toISOString().slice(0, 10)
    const create = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ workspace: '/tmp', model: 'deepseek-chat' })
      })
    )
    expect(create.status).toBe(201)
    const thread = (await readJson(create)) as { id: string }
    const turn = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/threads/${thread.id}/turns`, {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'hi' })
      })
    )
    expect(turn.status).toBe(202)
    const turnBody = (await readJson(turn)) as { turnId: string }
    await h.runtime.events.record({
      kind: 'usage',
      threadId: thread.id,
      turnId: turnBody.turnId,
      model: 'deepseek-v4-pro',
      usage: usageSnapshot({ promptTokens: 30, completionTokens: 10, totalTokens: 40 })
    })

    const usage = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/usage?group_by=model&from=${today}&to=${today}&timezone=UTC`, {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(usage.status).toBe(200)
    const body = (await readJson(usage)) as {
      buckets: Array<{ model: string; total_tokens: number }>
    }
    expect(body.buckets).toEqual([
      expect.objectContaining({
        model: 'deepseek-v4-pro',
        total_tokens: 40
      })
    ])
  })

  it('replays SSE backlog from Last-Event-ID when since_seq is omitted', async () => {
    const h = buildHarness()
    const create = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ workspace: '/tmp', model: 'deepseek-chat' })
      })
    )
    const thread = (await readJson(create)) as { id: string }
    const turn = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/threads/${thread.id}/turns`, {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'hi' })
      })
    )
    expect(turn.status).toBe(202)

    const allEvents = await h.sessionStore.loadEventsSince(thread.id, 0)
    const secondSeq = allEvents[1]?.seq ?? 0
    const eventStream = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/threads/${thread.id}/events`, {
        headers: { authorization: 'Bearer tok-1', 'Last-Event-ID': String(secondSeq) }
      })
    )
    const events = await readSseEvents(eventStream)
    const ids = events.flatMap((frame) =>
      frame
        .split('\n')
        .filter((line) => line.startsWith('id:'))
        .map((line) => Number(line.slice(3).trim()))
    )
    expect(ids.every((id) => id > secondSeq)).toBe(true)
  })

  it('resolves an approval through the HTTP endpoint', async () => {
    const h = buildHarness()
    const approval = createApprovalRequest({
      id: 'appr_1',
      threadId: 'thr_1',
      turnId: 'turn_1',
      toolName: 'echo',
      summary: 'run echo'
    })
    const pending = h.approvalGate.request(approval)
    const decide = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/approvals/appr_1', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'allow' })
      })
    )
    expect(decide.status).toBe(200)
    const body = (await readJson(decide)) as { decision: string }
    expect(body.decision).toBe('allow')
    await expect(pending).resolves.toBe('allow')
  })

  it('resolves GUI user input through both HTTP compatibility endpoints', async () => {
    const h = buildHarness()
    const pending = h.userInputGate.request({
      id: 'in_1',
      threadId: 'thr_1',
      turnId: 'turn_1',
      itemId: 'item_in_1',
      prompt: 'Pick one',
      questions: []
    })
    const submit = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/user-inputs/in_1', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          answers: [{ id: 'choice', label: 'Yes', value: 'yes' }]
        })
      })
    )
    expect(submit.status).toBe(200)
    await expect(pending).resolves.toEqual({
      status: 'submitted',
      answers: [{ id: 'choice', label: 'Yes', value: 'yes' }]
    })

    const cancelPending = h.userInputGate.request({
      id: 'in_2',
      threadId: 'thr_1',
      turnId: 'turn_1',
      itemId: 'item_in_2',
      prompt: 'Cancel?',
      questions: []
    })
    const cancel = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/user-input/in_2', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ cancelled: true })
      })
    )
    expect(cancel.status).toBe(200)
    await expect(cancelPending).resolves.toEqual({ status: 'cancelled' })
    const events = await h.sessionStore.loadEventsSince('thr_1', 0)
    expect(events.filter((event) => event.kind === 'user_input_resolved')).toHaveLength(0)
  })

  it('forks a thread with copied history and lineage metadata', async () => {
    const h = buildHarness()
    await h.threadService.create(
      { workspace: '/tmp/project', model: 'deepseek-chat', mode: 'agent' },
      { id: 'thr_parent', title: 'Parent' }
    )
    await h.turnService.startTurn({
      threadId: 'thr_parent',
      request: { prompt: 'hello' }
    })

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads/thr_parent/fork', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1' }
      })
    )

    expect(response.status).toBe(201)
    const fork = (await readJson(response)) as {
      id: string
      forkedFromThreadId?: string
      forkedFromTitle?: string
      forkedFromMessageCount?: number
      forkedFromTurnCount?: number
      turns: Array<{ threadId: string; items: Array<{ threadId: string; kind: string }> }>
    }
    expect(fork.forkedFromThreadId).toBe('thr_parent')
    expect(fork.forkedFromTitle).toBe('Parent')
    expect(fork.forkedFromMessageCount).toBe(1)
    expect(fork.forkedFromTurnCount).toBe(1)
    expect(fork.turns[0]?.threadId).toBe(fork.id)
    expect(fork.turns[0]?.items[0]).toMatchObject({ threadId: fork.id, kind: 'user_message' })
    const copiedItems = await h.sessionStore.loadItems(fork.id)
    expect(copiedItems).toHaveLength(1)
    expect(copiedItems[0]).toMatchObject({ threadId: fork.id, kind: 'user_message' })
  })

  it('forks with relation: side, attaches parentThreadId, and is excluded from the default list', async () => {
    const h = buildHarness()
    await h.threadService.create(
      { workspace: '/tmp/project', model: 'deepseek-chat', mode: 'agent' },
      { id: 'thr_parent', title: 'Parent' }
    )
    await h.turnService.startTurn({
      threadId: 'thr_parent',
      request: { prompt: 'seed turn' }
    })

    const forkResponse = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads/thr_parent/fork', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ relation: 'side' })
      })
    )
    expect(forkResponse.status).toBe(201)
    const fork = (await readJson(forkResponse)) as {
      id: string
      relation?: string
      parentThreadId?: string
      title: string
    }
    expect(fork.relation).toBe('side')
    expect(fork.parentThreadId).toBe('thr_parent')
    expect(fork.title).toBe('Parent · side')

    // Default list hides side threads.
    const listResponse = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    const listBody = (await readJson(listResponse)) as {
      threads: Array<{ id: string; relation?: string }>
    }
    expect(listBody.threads.find((t) => t.id === fork.id)).toBeUndefined()
    expect(listBody.threads.find((t) => t.id === 'thr_parent')).toBeDefined()

    // Opt-in include=side surfaces them.
    const includeResponse = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads?include=side', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    const includeBody = (await readJson(includeResponse)) as {
      threads: Array<{ id: string; relation?: string }>
    }
    expect(includeBody.threads.find((t) => t.id === fork.id)).toMatchObject({ relation: 'side' })
  })

  it('bodyless fork still defaults to relation: fork', async () => {
    const h = buildHarness()
    await h.threadService.create(
      { workspace: '/tmp/project', model: 'deepseek-chat', mode: 'agent' },
      { id: 'thr_default_fork', title: 'Forker' }
    )
    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads/thr_default_fork/fork', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(response.status).toBe(201)
    const body = (await readJson(response)) as { relation?: string; parentThreadId?: string }
    expect(body.relation).toBe('fork')
    expect(body.parentThreadId).toBe('thr_default_fork')
  })

  it('resumes a persisted session into a new Qiongqi thread', async () => {
    const h = buildHarness()
    await h.threadService.create(
      { workspace: '/tmp/project', model: 'deepseek-chat', mode: 'agent' },
      { id: 'thr_source', title: 'Source Thread' }
    )
    await h.turnService.startTurn({
      threadId: 'thr_source',
      request: { prompt: 'restore this' }
    })

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/sessions/thr_source/resume-thread', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ workspace: '/tmp/override', model: 'deepseek-coder', mode: 'plan' })
      })
    )

    expect(response.status).toBe(201)
    const body = (await readJson(response)) as {
      thread_id: string
      session_id: string
      message_count: number
      summary: string
    }
    expect(body.session_id).toBe('thr_source')
    expect(body.message_count).toBe(1)
    expect(body.summary).toBe('Source Thread resumed')
    const resumed = await h.threadService.get(body.thread_id)
    expect(resumed).toMatchObject({
      workspace: '/tmp/override',
      model: 'deepseek-coder',
      mode: 'plan',
      status: 'idle',
      forkedFromThreadId: 'thr_source'
    })
    expect(resumed?.turns[0]?.status).toBe('completed')
    expect(resumed?.turns[0]?.items[0]).toMatchObject({
      threadId: body.thread_id,
      kind: 'user_message',
      text: 'restore this'
    })
    const copiedItems = await h.sessionStore.loadItems(body.thread_id)
    expect(copiedItems).toHaveLength(1)
  })

  it('returns 404 when resuming an unknown session', async () => {
    const h = buildHarness()
    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/sessions/missing/resume-thread', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({})
      })
    )

    expect(response.status).toBe(404)
  })

  it('returns cumulative usage from /v1/usage', async () => {
    const h = buildHarness()
    h.runtime.usageService.record('thr_1', {
      promptTokens: 5,
      completionTokens: 3,
      totalTokens: 8,
      cachedTokens: 2,
      cacheHitTokens: 2,
      cacheMissTokens: 3,
      cacheHitRate: 0.4,
      turns: 1
    })
    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/usage', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(response.status).toBe(200)
    const body = (await readJson(response)) as { total: { promptTokens: number } }
    expect(body.total.promptTokens).toBe(5)
  })

  it('serves KWorks compatibility usage from /api/usage', async () => {
    const h = buildHarness()
    await h.threadService.create({
      workspace: '/tmp',
      model: 'deepseek-chat',
      mode: 'agent'
    }, { id: 'thr_api_usage', title: 'Usage alias' })
    h.runtime.usageService.record('thr_api_usage', usageSnapshot({ promptTokens: 11, completionTokens: 5 }))

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/usage?group_by=model', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )

    expect(response.status).toBe(200)
    const body = await readJson(response) as {
      buckets?: Array<{ model?: string; total_tokens?: number }>
      model_days?: Array<{ date?: string; model?: string; total_tokens?: number }>
    }
    expect(body.buckets?.[0]).toMatchObject({
      model: 'deepseek-chat',
      total_tokens: 16
    })
    expect(body.model_days?.find((bucket) => bucket.total_tokens === 16)).toMatchObject({
      model: 'deepseek-chat',
      total_tokens: 16
    })
  })

  it('returns runtime metrics with usage, cache, A2A, and storage summaries', async () => {
    const h = buildHarness()
    h.runtime.storageDiagnostics = () => ({
      backend: 'hybrid',
      available: true,
      degraded: true,
      reason: 'sqlite native binding unavailable',
      sqlite: { available: false, path: '/tmp/index.sqlite3' }
    })
    h.runtime.a2aTaskStore = {
      async upsert() {},
      async get() {
        return undefined
      },
      async list() {
        return [
          { id: 'a', senderCardId: 'x', prompt: 'one', status: 'completed', createdAt: '2026-06-22T00:00:00.000Z', updatedAt: '2026-06-22T00:00:01.000Z' },
          { id: 'b', senderCardId: 'x', prompt: 'two', status: 'cancelled', createdAt: '2026-06-22T00:00:00.000Z', updatedAt: '2026-06-22T00:00:01.000Z' }
        ] as never
      }
    } as never
    h.runtime.usageService.record('thr_1', {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      cachedTokens: 6,
      cacheHitTokens: 6,
      cacheMissTokens: 4,
      cacheHitRate: 0.6,
      turns: 2
    })

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/runtime/metrics', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )

    expect(response.status).toBe(200)
    await expect(readJson(response)).resolves.toMatchObject({
      service: 'qiongqi',
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        turns: 2
      },
      cache: {
        cachedTokens: 6,
        cacheHitTokens: 6,
        cacheMissTokens: 4,
        cacheHitRate: 0.6
      },
      a2a: {
        total: 2,
        byStatus: { completed: 1, cancelled: 1 }
      },
      storage: {
        backend: 'hybrid',
        degraded: true
      }
    })
  })

  it('returns live thread-grouped usage buckets from /v1/usage?group_by=thread', async () => {
    const h = buildHarness()
    await h.threadService.create(
      { workspace: '/tmp/project', model: 'deepseek-chat', mode: 'agent' },
      { id: 'thr_live', title: 'Live usage' }
    )
    h.runtime.usageService.record('thr_live', usageSnapshot({ promptTokens: 12, completionTokens: 8 }))

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/usage?group_by=thread', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )

    expect(response.status).toBe(200)
    const body = (await readJson(response)) as {
      group_by: string
      buckets: Array<{ thread_id: string; total_tokens: number; turns: number }>
    }
    expect(body.group_by).toBe('thread')
    expect(body.buckets).toEqual([
      expect.objectContaining({ thread_id: 'thr_live', total_tokens: 20, turns: 1 })
    ])
  })

  it('derives daily usage from persisted cumulative usage events', async () => {
    const h = buildHarness()
    await h.threadService.create(
      { workspace: '/tmp/project', model: 'deepseek-chat', mode: 'agent' },
      { id: 'thr_usage', title: 'Persisted usage' }
    )
    await h.sessionStore.appendEvent('thr_usage', {
      kind: 'usage',
      seq: 2,
      timestamp: '2026-06-02T09:00:00.000Z',
      threadId: 'thr_usage',
      usage: usageSnapshot({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        turns: 1,
        tokenEconomySavingsTokens: 100,
        tokenEconomySavingsUsd: 0.001
      })
    })
    await h.sessionStore.appendEvent('thr_usage', {
      kind: 'usage',
      seq: 3,
      timestamp: '2026-06-02T09:05:00.000Z',
      threadId: 'thr_usage',
      usage: usageSnapshot({
        promptTokens: 30,
        completionTokens: 10,
        totalTokens: 40,
        turns: 2,
        tokenEconomySavingsTokens: 250,
        tokenEconomySavingsUsd: 0.0025
      })
    })

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/usage?group_by=day&from=2026-06-02&to=2026-06-02&timezone=UTC', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )

    expect(response.status).toBe(200)
    const body = (await readJson(response)) as {
      group_by: string
      buckets: Array<{ date: string; total_tokens: number; turns: number; thread_count: number }>
      totals: {
        total_tokens: number
        turns: number
        active_days: number
        token_economy_savings_tokens: number
        token_economy_savings_usd: number
      }
    }
    expect(body.group_by).toBe('day')
    expect(body.buckets[0]).toMatchObject({
      date: '2026-06-02',
      total_tokens: 40,
      turns: 2,
      thread_count: 1
    })
    expect(body.totals).toMatchObject({
      total_tokens: 40,
      turns: 2,
      active_days: 1,
      token_economy_savings_tokens: 250,
      token_economy_savings_usd: 0.0025
    })
  })

  it('keeps token usage history after deleting a conversation', async () => {
    const h = buildHarness()
    const session = await h.runtime.authService?.initialize({
      email: 'usage-ledger@example.com',
      password: 'password123'
    })
    expect(session?.accessToken).toBeTruthy()

    const createThread = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${session?.accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          id: 'thr_usage_ledger',
          workspace: '/tmp/project',
          model: 'deepseek-chat'
        })
      })
    )
    expect(createThread.status).toBe(201)

    await h.runtime.events.record({
      kind: 'usage',
      threadId: 'thr_usage_ledger',
      turnId: 'turn_usage_ledger',
      model: 'deepseek-chat',
      timestamp: '2026-06-02T09:00:00.000Z',
      usage: usageSnapshot({
        promptTokens: 120,
        completionTokens: 30,
        totalTokens: 150,
        cacheHitTokens: 80,
        cacheMissTokens: 40,
        cacheHitRate: 80 / 120,
        turns: 2,
        tokenEconomySavingsTokens: 45
      })
    })

    const deleteThread = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads/thr_usage_ledger', {
        method: 'DELETE',
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(deleteThread.status).toBe(200)

    const usageResponse = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/usage?group_by=day&from=2026-06-02&to=2026-06-02&timezone=UTC', {
        headers: { authorization: `Bearer ${session?.accessToken}` }
      })
    )

    expect(usageResponse.status).toBe(200)
    const body = (await readJson(usageResponse)) as {
      totals: {
        input_tokens: number
        output_tokens: number
        total_tokens: number
        cached_tokens: number
        cache_miss_tokens: number
        token_economy_savings_tokens: number
      }
    }
    expect(body.totals).toMatchObject({
      input_tokens: 120,
      output_tokens: 30,
      total_tokens: 150,
      cached_tokens: 80,
      cache_miss_tokens: 40,
      token_economy_savings_tokens: 45
    })
  })

  it('combines usage ledger records with legacy thread usage events during migration', async () => {
    const h = buildHarness()
    const session = await h.runtime.authService?.initialize({
      email: 'usage-migration@example.com',
      password: 'password123'
    })
    expect(session?.accessToken).toBeTruthy()

    await h.threadService.create(
      { workspace: '/tmp/project', model: 'deepseek-chat', mode: 'agent' },
      { id: 'thr_legacy_usage', title: 'Legacy usage', ownerUserId: session!.user.id }
    )
    await h.sessionStore.appendEvent('thr_legacy_usage', {
      kind: 'usage',
      seq: 2,
      timestamp: '2026-06-02T08:00:00.000Z',
      threadId: 'thr_legacy_usage',
      usage: usageSnapshot({
        promptTokens: 40,
        completionTokens: 10,
        totalTokens: 50,
        cacheHitTokens: 20,
        cacheMissTokens: 20,
        turns: 1
      })
    })

    await h.threadService.create(
      { workspace: '/tmp/project', model: 'deepseek-chat', mode: 'agent' },
      { id: 'thr_new_usage', title: 'New usage', ownerUserId: session!.user.id }
    )
    await h.runtime.events.record({
      kind: 'usage',
      threadId: 'thr_new_usage',
      turnId: 'turn_new_usage',
      model: 'deepseek-chat',
      timestamp: '2026-06-02T09:00:00.000Z',
      usage: usageSnapshot({
        promptTokens: 120,
        completionTokens: 30,
        totalTokens: 150,
        cacheHitTokens: 80,
        cacheMissTokens: 40,
        turns: 2
      })
    })

    const usageResponse = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/usage?group_by=day&from=2026-06-02&to=2026-06-02&timezone=UTC', {
        headers: { authorization: `Bearer ${session?.accessToken}` }
      })
    )

    expect(usageResponse.status).toBe(200)
    const body = (await readJson(usageResponse)) as {
      totals: {
        input_tokens: number
        output_tokens: number
        total_tokens: number
        cached_tokens: number
        cache_miss_tokens: number
        turns: number
        thread_count: number
      }
    }
    expect(body.totals).toMatchObject({
      input_tokens: 160,
      output_tokens: 40,
      total_tokens: 200,
      cached_tokens: 100,
      cache_miss_tokens: 60,
      turns: 3,
      thread_count: 2
    })
  })

  it('encodes SSE events with sequence numbers and event names', () => {
    const frame = encodeSseEvent({
      kind: 'heartbeat',
      seq: 7,
      timestamp: 't',
      threadId: 'th'
    })
    expect(frame).toContain('id: 7')
    expect(frame).toContain('event: heartbeat')
    expect(frame.endsWith('\n\n')).toBe(true)
  })

  it('returns a 404 for unknown routes', async () => {
    const h = buildHarness()
    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/unknown')
    )
    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await readJson(response)).toEqual({
      code: 'not_found',
      message: 'route not found'
    })
  })

  it('streams a workspace status response', async () => {
    const h = buildHarness()
    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/workspace/status?path=/tmp', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(response.status).toBe(200)
    const body = (await readJson(response)) as { path: string }
    expect(body.path).toBe('/tmp')
  })

  it('prevents per-user settings from disabling skills when the global config has them enabled', async () => {
    // Simulate the KWorks desktop scenario: startup enables skills via
    // KWorks_SKILLS_PATH (global enabled=true). A user must not be able to
    // disable the entire skills subsystem through per-user config overrides.
    const h = buildHarness()
    // Simulate the live SkillPluginHost (as started by KWorks_SKILLS_PATH):
    // it reports skills as enabled regardless of config-store overrides.
    h.runtime.skillsV2 = async () => ({ enabled: true, roots: ['/tmp/kun/skills'], skills: [], validationErrors: [] })
    // Flip the global config to enabled=true (as serve.ts would do when
    // KWorks_SKILLS_PATH is set).
    const current = h.runtime.configStore?.snapshot()
    await h.runtime.configStore?.write({
      ...(current as NonNullable<typeof current>),
      capabilities: {
        ...(current as NonNullable<typeof current>).capabilities,
        skills: { ...(current as NonNullable<typeof current>).capabilities.skills, enabled: true }
      }
    })

    const session = await h.runtime.authService?.initialize({
      email: 'skills-lock@example.com',
      password: 'password123'
    })

    // User tries to save skills.enabled = false via the config API.
    // Even after this write, the effective config must retain enabled=true
    // because the global (startup) config has skills enabled.
    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/config/skills', {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${session?.accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ data: { enabled: false, roots: ['/tmp/kun/skills'] } })
      })
    )
    expect(response.status).toBe(200)

    // The effective config seen by this user must still have enabled=true.
    const configResponse = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/config', {
        headers: { authorization: `Bearer ${session?.accessToken}` }
      })
    )
    const configBody = (await readJson(configResponse)) as {
      config?: { capabilities?: { skills?: { enabled?: boolean } } }
    }
    expect(configBody.config?.capabilities?.skills?.enabled).toBe(true)
  })

  it('normalizes a legacy "task" work mode to "office" in per-user config (no duplicate)', async () => {
    const h = buildHarness()
    const session = await h.runtime.authService?.initialize({
      email: 'task-alias@example.com',
      password: 'password123'
    })
    // Seed per-user skills config with a stale "task" mode (as persisted before
    // the task→office rename). The effective config must collapse it to a
    // single "office" entry — not render two "日常办公".
    await h.runtime.kworksUserDataStore?.setUserSetting(
      session!.user.id,
      'capabilities.skills',
      {
        enabled: true,
        roots: [],
        lockedSkillIds: ['bootstrap', 'find-skills', 'goal', 'skill-creator', 'skill-manage', 'todo', 'web'],
        workModes: {
          defaultModeId: 'task',
          modes: {
            task: { id: 'task', name: '日常办公', builtin: true, editable: true, defaultSkillIds: ['data-analysis'] },
            coding: { id: 'coding', name: 'Coding 模式', builtin: true, editable: true, defaultSkillIds: ['code-review'] }
          }
        },
        modeSkillOverrides: {}
      }
    )

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/api/config', {
        headers: { authorization: `Bearer ${session?.accessToken}` }
      })
    )
    const body = (await readJson(response)) as {
      config?: {
        capabilities?: {
          skills?: {
            workModes?: { defaultModeId?: string; modes?: Record<string, { id: string; name: string }> }
          }
        }
      }
    }
    const workModes = body.config?.capabilities?.skills?.workModes
    const modeIds = Object.keys(workModes?.modes ?? {})
    expect(modeIds).not.toContain('task')
    expect(modeIds).toContain('office')
    expect(modeIds).toContain('coding')
    expect(workModes?.defaultModeId).toBe('office')
    // Only one "日常办公" entry.
    const officeNames = modeIds.filter((id) => workModes?.modes?.[id]?.name === '日常办公')
    expect(officeNames).toEqual(['office'])
  })
})

function storedZip(entries: Array<{ path: string; content: string | Buffer }>): Buffer {
  return zipArchive(entries.map((entry) => ({ ...entry, compression: 0 as const })))
}

function zipArchive(entries: Array<{ path: string; content: string | Buffer; compression?: 0 | 8 }>): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8')
    const data = typeof entry.content === 'string' ? Buffer.from(entry.content, 'utf8') : entry.content
    const compression = entry.compression ?? 0
    const compressed = compression === 8 ? deflateRawSync(data) : data
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(compression, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.byteLength, 18)
    local.writeUInt32LE(data.byteLength, 22)
    local.writeUInt16LE(name.byteLength, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, name, compressed)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(compression, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.byteLength, 20)
    central.writeUInt32LE(data.byteLength, 24)
    central.writeUInt16LE(name.byteLength, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, name)
    offset += local.byteLength + name.byteLength + compressed.byteLength
  }
  const centralOffset = offset
  const central = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(central.byteLength, 12)
  end.writeUInt32LE(centralOffset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...localParts, central, end])
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}
