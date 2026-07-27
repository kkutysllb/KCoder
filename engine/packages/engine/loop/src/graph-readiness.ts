import {
  GraphReadinessEvidenceSchema,
  type GraphReadinessEvidence,
  type GraphReadinessLevel
} from '@qiongqi/contracts'

export type GraphReadinessEvidenceKey = keyof GraphReadinessEvidence

export type GraphReadinessReport = {
  level: GraphReadinessLevel
  ready: boolean
  missingEvidence: GraphReadinessEvidenceKey[]
}

const requiredBooleanEvidence = [
  'definitionValid',
  'telemetryEnabled',
  'productionStore',
  'recoveryVerified',
  'budgetEnforced',
  'approvalsEnforced',
  'resourcesFenced',
  'traceCorrelation',
  'cancellationVerified',
  'circuitConfigured'
] as const satisfies readonly GraphReadinessEvidenceKey[]

export function evaluateGraphReadiness(rawEvidence: GraphReadinessEvidence): GraphReadinessReport {
  const evidence = GraphReadinessEvidenceSchema.parse(rawEvidence)
  const missingEvidence: GraphReadinessEvidenceKey[] = requiredBooleanEvidence
    .filter((key) => !evidence[key])
  if (!evidence.recoveryDrillAt) missingEvidence.push('recoveryDrillAt')

  let level: GraphReadinessLevel
  if (!evidence.definitionValid) {
    level = 'draft'
  } else if (requiredBooleanEvidence.some((key) => !evidence[key])) {
    level = 'observe'
  } else if (!evidence.recoveryDrillAt) {
    level = 'assisted'
  } else {
    level = 'autonomous'
  }
  return { level, ready: level === 'assisted' || level === 'autonomous', missingEvidence }
}
