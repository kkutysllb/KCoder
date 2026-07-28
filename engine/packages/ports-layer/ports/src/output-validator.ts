import type { OutputValidatorRef } from '@qiongqi/contracts'

export type TurnOutputValidationInput = {
  threadId: string
  turnId: string
  outputText: string
  assistantItemIds: string[]
  toolResultItemIds: string[]
  itemRefs: string[]
}

export type TurnOutputValidationVerdict =
  | { ok: true }
  | { ok: false; reason: string }

export type OutputValidator = {
  ref: OutputValidatorRef
  validate(
    input: TurnOutputValidationInput
  ): TurnOutputValidationVerdict | Promise<TurnOutputValidationVerdict>
}

export interface OutputValidatorRegistry {
  resolve(ref: OutputValidatorRef): OutputValidator | undefined
}
