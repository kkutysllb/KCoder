import { describe, expect, it } from 'vitest'
import { dispatchRequest } from '@qiongqi/http'
import { buildHarness } from './http-server-test-harness.js'

describe('product compatibility isolation', () => {
  it('does not register product-only compatibility routes on the core router', async () => {
    const h = buildHarness()
    const response = await dispatchRequest(h.router, new Request('http://localhost/api/projects', {
      headers: { authorization: 'Bearer tok-1' }
    }))

    expect(response.status).toBe(404)
  })
})
