import { expect, it } from 'vitest'
import { normalizeOrchestrationMode } from '@qiongqi/loop'
import { eventedV2RolloutDecisionForRuntimeOptions, orchestrationModeForRuntimeOptions } from '@qiongqi/http'

it('keeps classic default and maps legacy evented to evented_v2', () => {
  expect(normalizeOrchestrationMode(undefined)).toBe('classic')
  expect(normalizeOrchestrationMode('evented')).toBe('evented_v2')
  expect(normalizeOrchestrationMode('kernel_v3')).toBe('kernel_v3')
})

it('defaults production runtime to kernel v3 while preserving explicit classic fallback', () => {
  expect(orchestrationModeForRuntimeOptions({})).toBe('kernel_v3')
  expect(orchestrationModeForRuntimeOptions({ runtime: { kernelRollout: { defaultMode: 'kernel_v3' } } })).toBe('kernel_v3')
  expect(orchestrationModeForRuntimeOptions({ runtime: { kernelRollout: { enabled: true, defaultMode: 'kernel_v3' } } })).toBe('kernel_v3')
  expect(orchestrationModeForRuntimeOptions({ orchestrationMode: 'classic' })).toBe('classic')
  expect(orchestrationModeForRuntimeOptions({ runtime: { kernelRollout: { enabled: false, defaultMode: 'kernel_v3' } } })).toBe('classic')
  expect(orchestrationModeForRuntimeOptions({ orchestrationMode: 'kernel_v3' })).toBe('kernel_v3')
})

it('uses evented_v2 rollout policy to select the production primary runtime mode', () => {
  expect(orchestrationModeForRuntimeOptions({ runtime: { eventedV2Rollout: { stage: 'shadow' } } })).toBe('kernel_v3')
  expect(orchestrationModeForRuntimeOptions({ runtime: { eventedV2Rollout: { stage: 'canary', canaryPercent: 0 } } })).toBe('kernel_v3')
  expect(orchestrationModeForRuntimeOptions({ runtime: { eventedV2Rollout: { stage: 'canary', canaryPercent: 100 } } })).toBe('evented_v2')
  expect(orchestrationModeForRuntimeOptions({ runtime: { eventedV2Rollout: { stage: 'default' } } })).toBe('evented_v2')
  expect(orchestrationModeForRuntimeOptions({ runtime: { orchestrationMode: 'classic', eventedV2Rollout: { stage: 'default' } } })).toBe('classic')
})

it('resolves evented_v2 rollout decisions at thread/run granularity', () => {
  expect(eventedV2RolloutDecisionForRuntimeOptions(
    { runtime: { eventedV2Rollout: { stage: 'shadow', fallbackMode: 'kernel_v3', shadowSamplePercent: 100 } } },
    { threadId: 'thread_a' }
  )).toMatchObject({
    primaryMode: 'kernel_v3',
    shadowMode: 'evented_v2',
    reason: 'shadow'
  })
  expect(eventedV2RolloutDecisionForRuntimeOptions(
    { runtime: { eventedV2Rollout: { stage: 'canary', canaryPercent: 100, fallbackMode: 'kernel_v3' } } },
    { threadId: 'thread_a', forcedFallback: { active: true, reason: 'failure_rate' } }
  )).toMatchObject({
    primaryMode: 'kernel_v3',
    reason: 'auto_fallback',
    fallbackReason: 'failure_rate'
  })
})
