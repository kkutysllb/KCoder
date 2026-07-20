export type CommandAuditDecision = 'allow' | 'warn' | 'block'

export type CommandAuditResult = {
  decision: CommandAuditDecision
  reasons: string[]
  maskedCommand: string
}

export function auditShellCommand(command: string): CommandAuditResult {
  const stripped = stripHeredocBodies(command)
  const normalized = stripped.replace(/\s+/g, ' ').trim()
  const lowered = normalized.toLowerCase()
  const reasons: string[] = []

  if (isDestructiveDelete(lowered)) reasons.push('destructive-delete')
  if (/\|\s*(?:sh|bash|zsh|fish|ksh|dash)\b/.test(lowered)) reasons.push('pipe-to-shell')
  if (/base64\s+(?:-[a-z]*d[a-z]*|--decode)\b.*\|\s*(?:sh|bash|zsh|fish|ksh|dash)\b/.test(lowered)) {
    reasons.push('base64-decode-pipe-to-shell')
  }
  if (/: *\(\) *\{ *: *\| *: *& *\} *; *:/.test(lowered)) reasons.push('fork-bomb')

  if (reasons.length > 0) {
    return {
      decision: 'block',
      reasons,
      maskedCommand: maskCommandSecrets(stripped)
    }
  }

  if (lowered.includes('/dev/tcp')) reasons.push('tcp-device-access')
  if (/^(?:env|printenv|set)(?:\s|$)/.test(lowered)) reasons.push('environment-dump')
  if (/\bchmod\s+-r\b|\bchown\s+-r\b/.test(lowered)) reasons.push('recursive-permission-change')
  if (/\bkill(?:all)?\s+(?:-9\s+)?(?:-1|0|[0-9]+|\w+)/.test(lowered)) reasons.push('broad-process-signal')

  return {
    decision: reasons.length > 0 ? 'warn' : 'allow',
    reasons,
    maskedCommand: maskCommandSecrets(stripped)
  }
}

export function maskCommandSecrets(command: string): string {
  return command
    .replace(
      /\b([A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASS|AUTH)[A-Z0-9_]*)=("[^"]*"|'[^']*'|[^\s;&|]+)/gi,
      '$1=<redacted>'
    )
    .replace(/(Authorization:\s*Bearer\s+)([A-Za-z0-9._~+/=-]+)/gi, '$1<redacted>')
    .replace(/(--(?:api-key|token|password|secret)\s+)([^\s;&|]+)/gi, '$1<redacted>')
}

export function stripHeredocBodies(command: string): string {
  const lines = command.split(/\r?\n/)
  const output: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    output.push(line)
    const marker = line.match(/<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/)
    if (!marker) continue
    const terminator = marker[1]
    output.push('[heredoc body redacted]')
    index += 1
    while (index < lines.length && (lines[index] ?? '').trim() !== terminator) {
      index += 1
    }
    if (index < lines.length) output.push(lines[index] ?? '')
  }
  return output.join('\n')
}

function isDestructiveDelete(lowered: string): boolean {
  if (!/\brm\s+/.test(lowered)) return false
  if (!/(?:^|\s)-[a-z]*r[a-z]*f|(?:^|\s)-[a-z]*f[a-z]*r/.test(lowered)) return false
  return /\s(?:\/|~|\$home|\$\{home\}|\/users|\/home|\.{1,2})(?:\s|$)/.test(lowered)
}
