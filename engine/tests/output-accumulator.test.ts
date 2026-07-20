import { describe, expect, it } from 'vitest'
import { OutputAccumulator } from '@qiongqi/tool-infra'

function createAccumulator(): OutputAccumulator {
  return new OutputAccumulator({
    maxLines: 200,
    maxBytes: 20_000,
    tempFilePrefix: 'kun-output-test'
  })
}

describe('OutputAccumulator', () => {
  it('decodes UTF-8 command output', () => {
    const output = createAccumulator()

    output.append(Buffer.from('hello\n世界', 'utf8'))
    output.finish()

    expect(output.snapshot().content).toBe('hello\n世界')
  })

  it('exposes short UTF-8 line output before the command finishes', () => {
    const output = createAccumulator()

    output.append(Buffer.from('ready\n', 'utf8'))

    expect(output.snapshot().content).toBe('ready\n')
  })

  it('decodes UTF-16LE command output from Windows PowerShell pipes', () => {
    const output = createAccumulator()

    output.append(Buffer.from('Start-Process\r\n浏览.html', 'utf16le'))
    output.finish()

    expect(output.snapshot().content).toBe('Start-Process\r\n浏览.html')
  })

  it('decodes UTF-16LE command output without ASCII NUL bytes', () => {
    const output = createAccumulator()

    output.append(Buffer.from('测试', 'utf16le'))
    output.finish()

    expect(output.snapshot().content).toBe('测试')
  })
})
