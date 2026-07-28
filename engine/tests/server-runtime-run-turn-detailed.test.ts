import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createQiongqiServeRuntime } from '@qiongqi/http'

it('publishes the detailed Kernel turn result on ServerRuntime', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'qiongqi-runtime-detailed-'))
  const runtime = await createQiongqiServeRuntime({
    host: '127.0.0.1',
    port: 0,
    dataDir,
    runtimeToken: 'tok',
    apiKey: 'test-key',
    baseUrl: 'http://localhost',
    model: 'test-model',
    approvalPolicy: 'never',
    sandboxMode: 'danger-full-access',
    tokenEconomyMode: false,
    insecure: true,
    orchestrationMode: 'kernel_v3'
  })
  try {
    expect(runtime.runTurnDetailed).toBeTypeOf('function')
  } finally {
    await runtime.shutdown?.()
    await rm(dataDir, { recursive: true, force: true })
  }
})
