import { describe, expect, it } from 'vitest'
import { dispatchRequest } from '@qiongqi/http'
import { evaluateGraphReadiness } from '@qiongqi/loop'
import { buildHarness, readJson } from './http-server-test-harness.js'

const evidence = {
  definitionValid: true,
  telemetryEnabled: true,
  productionStore: true,
  recoveryVerified: true,
  budgetEnforced: true,
  approvalsEnforced: true,
  resourcesFenced: true,
  traceCorrelation: true,
  cancellationVerified: true,
  circuitConfigured: true,
  recoveryDrillAt: '2026-07-26T00:00:00.000Z'
} as const

describe('HTTP graph readiness', () => {
  it('reports aggregate graph levels and degrades when a graph is only observe', async () => {
    const h = buildHarness()
    h.runtime.graphReadiness = () => [
      evaluateGraphReadiness(evidence),
      evaluateGraphReadiness({ ...evidence, productionStore: false })
    ]

    const response = await dispatchRequest(h.router, new Request('http://localhost/ready'))

    expect(response.status).toBe(200)
    expect(await readJson(response)).toMatchObject({
      status: 'degraded',
      checks: {
        graphs: {
          ready: false,
          total: 2,
          minimumLevel: 'observe',
          byLevel: { autonomous: 1, observe: 1 }
        }
      }
    })
  })
})
