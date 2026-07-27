export function isRecoverableToolDispatchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.startsWith('unknown tool:') ||
    message.startsWith('tool_replay_policy_missing:') ||
    message.includes(' is not provided by ') ||
    message.includes(' is not advertised') ||
    message.includes(' is disabled by policy')
  )
}
