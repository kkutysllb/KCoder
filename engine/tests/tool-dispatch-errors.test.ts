import { describe, expect, it } from 'vitest'
import { isRecoverableToolDispatchError } from '@qiongqi/loop'

describe('tool dispatch error classification', () => {
  it.each([
    'unknown tool: skill-manage',
    'tool x is not provided by provider y',
    'tool x is not advertised in the current context',
    'tool x is disabled by policy'
  ])('classifies recoverable dispatch error: %s', (message) => {
    expect(isRecoverableToolDispatchError(new Error(message))).toBe(true)
  })

  it.each([
    'lease fence lost',
    'database write failed',
    'request was aborted'
  ])('keeps non-dispatch error terminal: %s', (message) => {
    expect(isRecoverableToolDispatchError(new Error(message))).toBe(false)
  })
})
