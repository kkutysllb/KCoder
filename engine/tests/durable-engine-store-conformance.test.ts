import { describe } from 'vitest'
import { InMemoryDurableEngineStore } from '@qiongqi/adapter-storage'
import { durableEngineStoreConformance } from './helpers/durable-engine-store-conformance.js'

describe('InMemoryDurableEngineStore', () => {
  durableEngineStoreConformance(() => new InMemoryDurableEngineStore())
})
