import { describe, expect, it } from 'vitest'
import { EventedV2RolloutController, RuntimeRolloutMetrics, resolveEventedV2RolloutMode, resolveRuntimeRolloutMode } from '@qiongqi/loop'

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
    metrics.increment('evented_v2_rollout', { mode: 'evented_v2', reason: 'canary_selected' })
    const snapshot = metrics.snapshot()
    expect(snapshot).toHaveLength(2)
    expect(snapshot).toContainEqual({ name: 'run_outcome', value: 2, labels: { mode: 'kernel_v3', provider: 'minimax-m3', reason: 'normal_stop' } })
    expect(snapshot).toContainEqual({ name: 'evented_v2_rollout', value: 1, labels: { mode: 'evented_v2', reason: 'canary_selected' } })
    expect(JSON.stringify(snapshot)).not.toContain('arguments')
  })

  it('resolves evented_v2 shadow rollout without changing the primary runtime mode', () => {
    expect(resolveEventedV2RolloutMode({
      policy: { stage: 'shadow', fallbackMode: 'kernel_v3' },
      threadId: 'thread_a'
    })).toEqual({
      stage: 'shadow',
      primaryMode: 'kernel_v3',
      shadowMode: 'evented_v2',
      fallbackMode: 'kernel_v3',
      reason: 'shadow'
    })
    expect(resolveEventedV2RolloutMode({
      policy: { stage: 'shadow', fallbackMode: 'kernel_v3', shadowSamplePercent: 0 },
      threadId: 'thread_a'
    })).toEqual({
      stage: 'shadow',
      primaryMode: 'kernel_v3',
      fallbackMode: 'kernel_v3',
      reason: 'shadow_not_sampled'
    })
  })

  it('resolves evented_v2 canary rollout deterministically from thread id', () => {
    expect(resolveEventedV2RolloutMode({
      policy: { stage: 'canary', canaryPercent: 100, fallbackMode: 'kernel_v3' },
      threadId: 'thread_a'
    })).toMatchObject({
      stage: 'canary',
      primaryMode: 'evented_v2',
      fallbackMode: 'kernel_v3',
      reason: 'canary_selected'
    })
    expect(resolveEventedV2RolloutMode({
      policy: { stage: 'canary', canaryPercent: 0, fallbackMode: 'kernel_v3' },
      threadId: 'thread_a'
    })).toMatchObject({
      stage: 'canary',
      primaryMode: 'kernel_v3',
      fallbackMode: 'kernel_v3',
      reason: 'canary_not_selected'
    })
  })

  it('forces evented_v2 canary traffic back to the fallback mode when health is degraded', () => {
    expect(resolveEventedV2RolloutMode({
      policy: { stage: 'canary', canaryPercent: 100, fallbackMode: 'kernel_v3' },
      threadId: 'thread_a',
      forcedFallback: { active: true, reason: 'failure_rate' }
    })).toEqual({
      stage: 'canary',
      primaryMode: 'kernel_v3',
      fallbackMode: 'kernel_v3',
      reason: 'auto_fallback',
      fallbackReason: 'failure_rate'
    })
  })

  it('trips and clears automatic evented_v2 fallback from recent run outcomes', () => {
    let now = 1_000
    const controller = new EventedV2RolloutController({
      policy: {
        stage: 'canary',
        canaryPercent: 100,
        fallbackMode: 'kernel_v3',
        autoFallback: {
          enabled: true,
          windowSize: 4,
          minRuns: 3,
          failureRateThreshold: 0.5,
          consecutiveFailures: 2,
          cooldownMs: 1_000
        }
      },
      nowMs: () => now
    })

    expect(controller.decide({ threadId: 'thread_a' }).primaryMode).toBe('evented_v2')
    controller.recordOutcome('completed')
    controller.recordOutcome('failed')
    controller.recordOutcome('aborted')

    expect(controller.decide({ threadId: 'thread_a' })).toMatchObject({
      primaryMode: 'kernel_v3',
      reason: 'auto_fallback',
      fallbackReason: 'failure_rate'
    })
    expect(controller.snapshot()).toMatchObject({
      fallbackActive: true,
      failures: 2,
      total: 3,
      consecutiveFailures: 2
    })

    now = 2_001
    expect(controller.decide({ threadId: 'thread_a' })).toMatchObject({
      primaryMode: 'evented_v2',
      reason: 'canary_selected'
    })
  })

  it('records rollout decisions for shadow, canary, and fallback observability', () => {
    const controller = new EventedV2RolloutController({
      policy: {
        stage: 'shadow',
        shadowSamplePercent: 100,
        fallbackMode: 'kernel_v3'
      }
    })
    controller.recordDecision(controller.decide({ threadId: 'thread_a' }))

    expect(controller.snapshot().decisions).toEqual({
      shadow: 1
    })
  })
})
