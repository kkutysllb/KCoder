export function isRecoverableToolDispatchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.startsWith('unknown tool:') ||
    message.includes(' is not provided by ') ||
    message.includes(' is not advertised') ||
    message.includes(' is disabled by policy')
  )
}
