import { describe, expect, it } from 'vitest'
import { QIONGQI_CLI_USAGE, runAgentCommand } from '@qiongqi/cli'

describe('Qiongqi agent CLI text', () => {
  it('uses qiongqi naming in the top-level usage text', () => {
    expect(QIONGQI_CLI_USAGE).toContain('qiongqi <command> [options]')
    expect(QIONGQI_CLI_USAGE).not.toContain('kun <command>')
  })

  it('uses qiongqi naming in command errors', async () => {
    let stderr = ''

    const code = await runAgentCommand('run', ['--data-dir', '/tmp/qiongqi-data', '--api-key', 'test-key', '--base-url', 'https://example.invalid/v1'], {
      stdout: { write: () => undefined },
      stderr: { write: (chunk) => { stderr += chunk } },
      env: {},
      cwd: () => '/tmp/workspace'
    })

    expect(code).toBe(64)
    expect(stderr).toContain('qiongqi run: missing prompt')
    expect(stderr).not.toContain('kun run')
  })
})
