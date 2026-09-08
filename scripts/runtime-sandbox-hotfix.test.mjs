import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import {
  applyRuntimeSandboxHotfix,
  RUNTIME_SANDBOX_RELATIVE_PATH,
} from './runtime-sandbox-hotfix.mjs'

const UNPATCHED_RUNTIME = [
  'const WIDER_MODES = {',
  '\t"workspace-write": ["danger-full-access"]',
  '};',
  'async function approveEscalation(request) {',
  '\tconst { requestedMode: mode, effectiveMode } = request;',
  "\tif (!(WIDER_MODES[effectiveMode] ?? []).includes(mode)) throw new Error('sandbox escalation is not strictly wider');",
  '\treturn mode;',
  '}',
  'export { approveEscalation };',
].join('\n')

test('patches the shipped sandbox package and remains idempotent', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kcoder-sandbox-hotfix-'))
  const file = join(root, RUNTIME_SANDBOX_RELATIVE_PATH)
  mkdirSync(join(root, 'node_modules', '@deepseek-ai', 'dsh-sandbox', 'lib'), { recursive: true })
  writeFileSync(file, UNPATCHED_RUNTIME)

  try {
    const unpatched = await import(`${pathToFileURL(file).href}?case=unpatched`)
    await assert.rejects(
      unpatched.approveEscalation({ requestedMode: 'danger-full-access', effectiveMode: 'danger-full-access' }),
      /not strictly wider/,
    )

    const first = applyRuntimeSandboxHotfix(root)
    assert.equal(first.status, 'applied')
    const patched = readFileSync(file, 'utf8')
    assert.match(patched, /KCODER: repeated sandbox permission is already granted/)

    const mod = await import(`${pathToFileURL(file).href}?case=patched`)
    assert.equal(await mod.approveEscalation({
      requestedMode: 'workspace-write',
      effectiveMode: 'workspace-write',
    }), 'workspace-write')
    assert.equal(await mod.approveEscalation({
      requestedMode: 'danger-full-access',
      effectiveMode: 'danger-full-access',
    }), 'danger-full-access')
    await assert.rejects(
      mod.approveEscalation({ requestedMode: 'workspace-write', effectiveMode: 'danger-full-access' }),
      /not strictly wider/,
    )

    const second = applyRuntimeSandboxHotfix(root)
    assert.equal(second.status, 'already-applied')
    assert.equal(readFileSync(file, 'utf8'), patched)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('fails closed when the compiled guard changes unexpectedly', () => {
  const root = mkdtempSync(join(tmpdir(), 'kcoder-sandbox-hotfix-anchor-'))
  const file = join(root, RUNTIME_SANDBOX_RELATIVE_PATH)
  mkdirSync(join(root, 'node_modules', '@deepseek-ai', 'dsh-sandbox', 'lib'), { recursive: true })
  writeFileSync(file, 'async function approveEscalation() {}\n')

  try {
    assert.throws(() => applyRuntimeSandboxHotfix(root), /anchor not found/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
