import { describe, expect, it } from 'vitest'
import { CompactionGovernor } from '@qiongqi/loop'

describe('compaction governor', () => {
  it('separates fixed prompt overhead from compactable history and requires net savings', () => {
    const governor = new CompactionGovernor({ cooldownSteps: 2, minimumNetSavings: 200 })
    expect(governor.decide({ step: 1, fixedTokens: 8_000, compactableTokens: 100, summaryTokens: 80, historyItems: 3 })).toMatchObject({ action: 'skip', reason: 'insufficient_net_savings' })
    expect(governor.decide({ step: 2, fixedTokens: 8_000, compactableTokens: 2_000, summaryTokens: 500, historyItems: 20 })).toMatchObject({ action: 'compact', predictedNetSavings: 1_500 })
  })

  it('enforces cooldown and never compresses a summary-only history', () => {
    const governor = new CompactionGovernor({ cooldownSteps: 3 })
    governor.commit({ step: 2, summaryDigest: 's1' })
    expect(governor.decide({ step: 3, fixedTokens: 1, compactableTokens: 2_000, summaryTokens: 100, historyItems: 10 })).toMatchObject({ action: 'skip', reason: 'cooldown' })
    expect(governor.decide({ step: 6, fixedTokens: 1, compactableTokens: 2_000, summaryTokens: 100, historyItems: 1, summaryOnly: true })).toMatchObject({ action: 'skip', reason: 'summary_only' })
  })

  it('restores cooldown and step state after a process restart', () => {
    const first = new CompactionGovernor({ cooldownSteps: 3 })
    const step = first.nextStep()
    first.commit({ step, summaryDigest: 'summary-1' })
    const restored = new CompactionGovernor({ cooldownSteps: 3 }, first.snapshot())

    expect(restored.snapshot()).toEqual({
      version: 1,
      step: 1,
      lastCompactionStep: 1,
      lastSummaryDigest: 'summary-1'
    })
    expect(restored.decide({ step: 2, fixedTokens: 1, compactableTokens: 2_000, summaryTokens: 100, historyItems: 10 }))
      .toMatchObject({ action: 'skip', reason: 'cooldown' })
  })
})
