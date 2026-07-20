import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildHarness, readJson } from './http-server-test-harness.js'
import { buildRouter, dispatchRequest } from '@qiongqi/http'

describe('HTTP artifacts routes', () => {
  let dir = ''

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'qiongqi-http-artifacts-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('lists and reads thread output artifacts by virtual path', async () => {
    const h = buildHarness()
    const baseInfo = h.runtime.info
    h.runtime.info = () => ({
      ...baseInfo(),
      dataDir: dir
    })
    h.router = buildRouter(h.runtime)
    const outputDir = join(dir, 'threads', 'thr_1', 'outputs')
    await mkdir(outputDir, { recursive: true })
    await writeFile(join(outputDir, 'log.txt'), 'hello artifact', 'utf8')

    const list = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads/thr_1/artifacts', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(list.status).toBe(200)
    expect(await readJson(list)).toMatchObject({
      artifacts: [
        {
          name: 'log.txt',
          virtualPath: '/mnt/qiongqi/outputs/log.txt'
        }
      ]
    })

    const read = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads/thr_1/artifacts/content?path=/mnt/qiongqi/outputs/log.txt', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(read.status).toBe(200)
    expect(await read.text()).toBe('hello artifact')
  })

  it('rejects artifact path traversal', async () => {
    const h = buildHarness()
    const baseInfo = h.runtime.info
    h.runtime.info = () => ({
      ...baseInfo(),
      dataDir: dir
    })
    h.router = buildRouter(h.runtime)

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads/thr_1/artifacts/content?path=/mnt/qiongqi/outputs/%2e%2e/secret.txt', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )

    expect(response.status).toBe(403)
  })
})
