import { describe, expect, it } from 'vitest'
import { Router, dispatchRequest, startNodeHttpServer, userWorkspacePaths } from '@qiongqi/http'
import { buildHarness, readJson } from './http-server-test-harness.js'

describe('HTTP server', () => {
  it('defines per-user workspace directories for runtime data and artifacts', () => {
    expect(userWorkspacePaths('/Users/tester/.qiongqi', 'user:123')).toEqual({
      root: '/Users/tester/.qiongqi',
      userRoot: '/Users/tester/.qiongqi/users/user_123',
      data: '/Users/tester/.qiongqi/users/user_123/data',
      thread: '/Users/tester/.qiongqi/users/user_123/thread',
      threads: '/Users/tester/.qiongqi/users/user_123/threads',
      workspace: '/Users/tester/.qiongqi/users/user_123/workspace',
      memory: '/Users/tester/.qiongqi/users/user_123/memory',
      secrets: '/Users/tester/.qiongqi/users/user_123/secrets',
      usage: '/Users/tester/.qiongqi/users/user_123/usage',
      skills: '/Users/tester/.qiongqi/users/user_123/skills',
      mcp: '/Users/tester/.qiongqi/users/user_123/mcp',
      tools: '/Users/tester/.qiongqi/users/user_123/tools',
      automations: '/Users/tester/.qiongqi/users/user_123/automations',
      artifacts: '/Users/tester/.qiongqi/users/user_123/artifacts',
      attachments: '/Users/tester/.qiongqi/users/user_123/attachments',
      logs: '/Users/tester/.qiongqi/users/user_123/logs'
    })
  })

  it('returns 200 on /health without auth', async () => {
    const h = buildHarness()
    const response = await dispatchRequest(h.router, new Request('http://localhost/health'))

    expect(response.status).toBe(200)
    expect(await readJson(response)).toEqual({ status: 'ok', service: 'qiongqi', mode: 'serve' })
  })

  it('allows generic client headers in CORS preflight requests', async () => {
    const router = new Router()
    router.add('POST', '/v1/auth/initialize', () => new Response(null, { status: 204 }))
    const server = await startNodeHttpServer({
      router,
      host: '127.0.0.1',
      port: 0,
      corsOrigins: ['app://-']
    })

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/v1/auth/initialize`, {
        method: 'OPTIONS',
        headers: {
          origin: 'app://-',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type,x-qiongqi-client'
        }
      })

      expect(response.status).toBe(204)
      expect(response.headers.get('access-control-allow-origin')).toBe('app://-')
      expect(response.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('x-qiongqi-client')
    } finally {
      await server.close()
    }
  })

  it('does not register product compatibility routes on the core router', async () => {
    const h = buildHarness()
    const response = await dispatchRequest(h.router, new Request('http://localhost/api/projects', {
      headers: { authorization: 'Bearer tok-1' }
    }))

    expect(response.status).toBe(404)
  })
})
