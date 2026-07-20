import { describe, expect, it } from 'vitest'
import { LoopGovernor } from '@qiongqi/loop'
import type { ToolObservation } from '@qiongqi/contracts'
import minimaxFixture from './fixtures/kernel-governance/minimax-m3-tool-storm.json'
import noReasoningFixture from './fixtures/kernel-governance/no-reasoning-tool-loop.json'
import kimiFixture from './fixtures/kernel-governance/kimi-k2-tool-loop.json'
import openrouterFixture from './fixtures/kernel-governance/openrouter-hy3-tool-loop.json'
import vllmFixture from './fixtures/kernel-governance/vllm-deepseek-tool-loop.json'

const providerFixtures = [
  minimaxFixture,
  noReasoningFixture,
  kimiFixture,
  openrouterFixture,
  vllmFixture
] as const

describe('provider-neutral Kernel v3 storm governance', () => {
  it.each(providerFixtures)('$provider terminates repeated evidence through one shared governor', (fixture) => {
    const governor = new LoopGovernor()
    let state = undefined
    let outcome: { reason?: string } = {}
    const items: Array<{ kind: string }> = []

    for (const [index, frame] of fixture.frames.entries()) {
      const observation: ToolObservation = {
        callId: `${fixture.provider}-${index}`,
        toolName: frame.tool.name,
        effect: 'read',
        capabilityClass: 'filesystem.read',
        resourceKeys: [String(frame.tool.arguments.path ?? 'workspace://task-state')],
        canonicalArgumentsDigest: `${fixture.provider}:same-call-shape`,
        resultDigest: `${fixture.provider}:result-${index}`,
        resultItemId: `${fixture.provider}:result-item-${index}`,
        artifactRefs: [],
        failed: false,
        replayed: false
      }
      const decision = governor.evaluate(state, {
        stage: 'tool',
        observations: [observation],
        progress: { level: 'none', digest: 'none' }
      })
      state = decision.state
      items.push({ kind: 'runtime_progress' })
      if (decision.action === 'terminate') {
        outcome = { reason: decision.reason }
        break
      }
    }

    expect(outcome.reason).toBe('exact_call_repetition')
    expect(fixture.frames.length).toBe(3)
    expect(items.some((item) => item.kind === 'runtime_progress')).toBe(true)
  })
})
