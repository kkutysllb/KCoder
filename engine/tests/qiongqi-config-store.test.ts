import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  FileQiongqiConfigStore,
  qiongqiConfigFromRuntimeOptions
} from '@qiongqi/http'

describe('Qiongqi runtime config store', () => {
  it('does not include api keys when deriving disk config from runtime options', () => {
    const config = qiongqiConfigFromRuntimeOptions({
      host: '127.0.0.1',
      port: 8899,
      dataDir: '/tmp/qiongqi-data',
      runtimeToken: '',
      apiKey: 'runtime-secret',
      baseUrl: 'https://example.invalid/v1',
      model: 'deepseek-chat',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      tokenEconomyMode: false,
      insecure: false
    })

    expect(config.serve).not.toHaveProperty('apiKey')
  })

  it('strips api keys from snapshots and persisted config writes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qiongqi-config-store-'))
    const configPath = join(dir, 'config.json')
    const store = new FileQiongqiConfigStore({
      path: configPath,
      initial: {
        serve: {
          dataDir: dir,
          apiKey: 'initial-secret',
          baseUrl: 'https://example.invalid/v1',
          model: 'deepseek-chat'
        }
      }
    })

    try {
      expect(store.snapshot().serve).not.toHaveProperty('apiKey')

      const written = await store.write({
        serve: {
          dataDir: dir,
          apiKey: 'written-secret',
          baseUrl: 'https://example.invalid/v1',
          model: 'deepseek-chat'
        }
      })

      expect(written.serve).not.toHaveProperty('apiKey')
      expect(store.snapshot().serve).not.toHaveProperty('apiKey')
      const disk = JSON.parse(await readFile(configPath, 'utf8')) as { serve?: Record<string, unknown> }
      expect(disk.serve).not.toHaveProperty('apiKey')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('removes api keys when reading legacy runtime config from disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qiongqi-config-store-read-'))
    const configPath = join(dir, 'config.json')
    await writeFile(configPath, JSON.stringify({
      serve: {
        dataDir: dir,
        apiKey: 'legacy-secret',
        baseUrl: 'https://example.invalid/v1',
        model: 'deepseek-chat'
      }
    }), 'utf8')

    try {
      const store = new FileQiongqiConfigStore({
        path: configPath,
        initial: {
          serve: {
            dataDir: dir,
            baseUrl: '',
            model: 'deepseek-chat'
          }
        }
      })

      const read = await store.read()
      expect(read.serve).not.toHaveProperty('apiKey')
      expect(store.snapshot().serve).not.toHaveProperty('apiKey')
      const disk = JSON.parse(await readFile(configPath, 'utf8')) as { serve?: Record<string, unknown> }
      expect(disk.serve).not.toHaveProperty('apiKey')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
