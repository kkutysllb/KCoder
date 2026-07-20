import { describe, expect, it } from 'vitest'
import { qiongqiRuntimeListeningMessage, qiongqiRuntimeStartupInfo, SERVE_USAGE } from '@qiongqi/cli'

describe('Qiongqi serve CLI text', () => {
  it('uses qiongqi naming in user-visible serve usage', () => {
    expect(SERVE_USAGE).toContain('qiongqi serve [options]')
    expect(SERVE_USAGE).not.toContain('kun serve')
  })

  it('uses qiongqi naming in the runtime ready message', () => {
    expect(qiongqiRuntimeListeningMessage('127.0.0.1', 8899)).toBe(
      'qiongqi runtime listening on http://127.0.0.1:8899'
    )
  })

  it('labels the serve startup model as the fallback default and hides sandbox mode', () => {
    const startupInfo = qiongqiRuntimeStartupInfo({
      host: '127.0.0.1',
      port: 19987,
      info: {
        configPath: '/tmp/config.json',
        dataDir: '/tmp/data',
        model: 'deepseek-v4-pro',
        approvalPolicy: 'auto',
        sandboxMode: 'danger-full-access',
        insecure: true,
        startedAt: '2026-07-05T01:42:55.418Z',
        pid: 57263
      }
    })

    expect(startupInfo).toMatchObject({
      service: 'qiongqi',
      mode: 'serve',
      host: '127.0.0.1',
      port: 19987,
      approvalPolicy: 'auto'
    })
    expect(startupInfo).not.toHaveProperty('model')
    expect(startupInfo).not.toHaveProperty('defaultModel')
    expect(startupInfo).not.toHaveProperty('sandboxMode')
  })
})
