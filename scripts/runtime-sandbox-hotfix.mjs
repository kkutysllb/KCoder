import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const RUNTIME_SANDBOX_RELATIVE_PATH = 'node_modules/@deepseek-ai/dsh-sandbox/lib/index.js'
const REPEATED_PERMISSION_MARKER = 'KCODER: repeated sandbox permission is already granted'

// Keep the replacement narrow: a changed upstream guard must stop the build.
const STRICT_WIDENING_GUARD = /^[ \t]*if \(!\(WIDER_MODES\[effectiveMode\] \?\? \[\]\)\.includes\(mode\)\) throw new Error\([^\n]*sandbox escalation[^\n]*\);$/m

function idempotentGuard(indentation) {
  return [
    indentation + '// ' + REPEATED_PERMISSION_MARKER + '; reuse the effective mode without requesting approval.',
    indentation + 'if (mode === effectiveMode && (mode === "workspace-write" || mode === "danger-full-access")) return mode;',
  ].join('\n')
}

export function applyRuntimeSandboxHotfix(runtimeRoot) {
  const file = join(runtimeRoot, RUNTIME_SANDBOX_RELATIVE_PATH)
  if (!existsSync(file)) return { status: 'skipped', reason: 'package-not-found', file }

  const before = readFileSync(file, 'utf8')
  if (before.includes(REPEATED_PERMISSION_MARKER)) return { status: 'already-applied', file }

  const match = before.match(STRICT_WIDENING_GUARD)
  if (match === null) {
    if (/^[ \t]*if \(mode === effectiveMode && \(mode === "workspace-write" \|\| mode === "danger-full-access"\)\) return mode;$/m.test(before)) {
      return { status: 'already-fixed', file }
    }
    throw new Error('runtime sandbox hotfix anchor not found: ' + file)
  }

  const indentation = match[0].match(/^[ \t]*/)?.[0] ?? '\t'
  const after = before.replace(match[0], idempotentGuard(indentation) + '\n' + match[0])
  writeFileSync(file, after)
  return { status: 'applied', file }
}
