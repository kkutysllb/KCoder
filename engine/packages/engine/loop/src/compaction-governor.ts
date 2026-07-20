export type CompactionDecision =
  | { action: 'compact'; predictedNetSavings: number; reason: 'pressure' }
  | { action: 'skip'; predictedNetSavings: number; reason: 'insufficient_net_savings' | 'cooldown' | 'summary_only' | 'no_history' }

export type CompactionGovernorState = {
  version: 1
  step: number
  lastCompactionStep: number
  lastSummaryDigest?: string
}

export class CompactionGovernor {
  private step: number
  private lastCompactionStep: number
  private lastSummaryDigest: string | undefined

  constructor(
    private readonly options: { cooldownSteps?: number; minimumNetSavings?: number } = {},
    state?: Partial<CompactionGovernorState>
  ) {
    this.step = Number.isSafeInteger(state?.step) && (state?.step ?? 0) >= 0 ? state!.step! : 0
    this.lastCompactionStep = Number.isSafeInteger(state?.lastCompactionStep)
      ? state!.lastCompactionStep!
      : -1
    this.lastSummaryDigest = typeof state?.lastSummaryDigest === 'string' ? state.lastSummaryDigest : undefined
  }

  nextStep(): number {
    this.step += 1
    return this.step
  }

  decide(input: {
    step: number
    fixedTokens: number
    compactableTokens: number
    summaryTokens: number
    historyItems: number
    summaryOnly?: boolean
  }): CompactionDecision {
    const predictedNetSavings = Math.max(0, input.compactableTokens - input.summaryTokens)
    if (input.summaryOnly) return { action: 'skip', predictedNetSavings, reason: 'summary_only' }
    if (input.historyItems <= 0 || input.compactableTokens <= 0) return { action: 'skip', predictedNetSavings, reason: 'no_history' }
    if (input.step - this.lastCompactionStep < (this.options.cooldownSteps ?? 2)) return { action: 'skip', predictedNetSavings, reason: 'cooldown' }
    if (predictedNetSavings < (this.options.minimumNetSavings ?? 128)) return { action: 'skip', predictedNetSavings, reason: 'insufficient_net_savings' }
    return { action: 'compact', predictedNetSavings, reason: 'pressure' }
  }

  commit(input: { step: number; summaryDigest: string }): void {
    this.lastCompactionStep = input.step
    this.lastSummaryDigest = input.summaryDigest
  }

  get summaryDigest(): string | undefined { return this.lastSummaryDigest }

  snapshot(): CompactionGovernorState {
    return {
      version: 1,
      step: this.step,
      lastCompactionStep: this.lastCompactionStep,
      ...(this.lastSummaryDigest ? { lastSummaryDigest: this.lastSummaryDigest } : {})
    }
  }
}
