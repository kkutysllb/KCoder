import { describe, expect, it } from 'vitest'
import { evaluateGraphReadiness } from '@qiongqi/loop'
import type { GraphReadinessEvidence } from '@qiongqi/contracts'

const complete: GraphReadinessEvidence = {
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
}

describe('graph readiness', () => {
  it('requires complete safety evidence and a recovery drill for autonomous', () => {
    expect(evaluateGraphReadiness(complete)).toMatchObject({ level: 'autonomous', missingEvidence: [] })
    expect(evaluateGraphReadiness({ ...complete, recoveryDrillAt: undefined })).toMatchObject({
      level: 'assisted', missingEvidence: ['recoveryDrillAt']
    })
  })

  it('keeps observable but incomplete graphs at observe and invalid graphs at draft', () => {
    expect(evaluateGraphReadiness({ ...complete, productionStore: false, resourcesFenced: false })).toMatchObject({
      level: 'observe', missingEvidence: expect.arrayContaining(['productionStore', 'resourcesFenced'])
    })
    expect(evaluateGraphReadiness({ ...complete, definitionValid: false })).toMatchObject({
      level: 'draft', missingEvidence: expect.arrayContaining(['definitionValid'])
    })
  })
})
