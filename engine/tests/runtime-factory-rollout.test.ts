import { expect, it } from 'vitest'
import { normalizeOrchestrationMode } from '@qiongqi/loop'
import { orchestrationModeForRuntimeOptions } from '@qiongqi/http'

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
