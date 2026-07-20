import { describe, expect, it } from 'vitest'
import { RuntimeRolloutMetrics, resolveRuntimeRolloutMode } from '@qiongqi/loop'

describe('runtime rollout checkpoint', () => {
  it('keeps classic default and requires explicit kernel enablement', () => {
    expect(resolveRuntimeRolloutMode({})).toBe('classic')
    expect(resolveRuntimeRolloutMode({ configured: 'kernel_v3' })).toBe('classic')
    expect(resolveRuntimeRolloutMode({ configured: 'kernel_v3', enabled: true, threadMetadata: { orchestrationMode: 'kernel_v3' } })).toBe('kernel_v3')
  })

  it('records bounded mode/provider/reason labels without raw payloads', () => {
    const metrics = new RuntimeRolloutMetrics()
    metrics.increment('run_outcome', { mode: 'kernel_v3', provider: 'minimax-m3', reason: 'normal_stop' })
    metrics.increment('run_outcome', { mode: 'kernel_v3', provider: 'minimax-m3', reason: 'normal_stop' })
    const snapshot = metrics.snapshot()
    expect(snapshot).toHaveLength(1)
    expect(snapshot[0]).toMatchObject({ name: 'run_outcome', value: 2, labels: { mode: 'kernel_v3', provider: 'minimax-m3', reason: 'normal_stop' } })
    expect(JSON.stringify(snapshot)).not.toContain('arguments')
  })
})
