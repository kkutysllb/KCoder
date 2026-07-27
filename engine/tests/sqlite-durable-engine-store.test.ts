import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe } from 'vitest'
import { SqliteDurableEngineStore } from '@qiongqi/adapter-storage'
import { durableEngineStoreConformance } from './helpers/durable-engine-store-conformance.js'

describe('SqliteDurableEngineStore', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'qiongqi-durable-sqlite-'))
  const stores: SqliteDurableEngineStore[] = []
  let databaseIndex = 0

  afterAll(() => {
    for (const store of stores) store.close()
    rmSync(rootDir, { recursive: true, force: true })
  })

  durableEngineStoreConformance(() => {
    const store = new SqliteDurableEngineStore(join(rootDir, `engine-${databaseIndex++}.sqlite`))
    stores.push(store)
    return store
  })
})
