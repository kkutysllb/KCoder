export type TerminalState = 'completed' | 'failed' | 'cancelled' | 'aborted'

const TERMINAL_STATES = new Set<string>(['completed', 'failed', 'cancelled', 'aborted'])

export function isTerminalState(status: string): boolean {
  return TERMINAL_STATES.has(status)
}

export function trySetTerminalState<T extends { status: string }>(
  current: T,
  next: T
): { accepted: boolean; record: T } {
  if (!isTerminalState(current.status)) {
    return { accepted: true, record: next }
  }
  if (current.status === next.status) {
    return { accepted: true, record: next }
  }
  return { accepted: false, record: current }
}
