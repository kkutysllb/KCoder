import { describe, expect, it } from 'vitest'

import {
  ownNestedSourceDir,
  packageRelativeDirs
} from '../scripts/flatten-dist.mjs'

describe('flatten-dist script helpers', () => {
  it('discovers packages nested one or two directories under packages', () => {
    const dirs = packageRelativeDirs([
      'foundation',
      'foundation/contracts',
      'http-layer',
      'http-layer/http',
      'README.md'
    ], (path) => path.endsWith('contracts') || path.endsWith('http'))

    expect(dirs).toEqual(['foundation/contracts', 'http-layer/http'])
  })

  it('derives the nested source output directory from the package layer path', () => {
    expect(ownNestedSourceDir('/repo/packages/http-layer/http', 'http-layer/http'))
      .toBe('/repo/packages/http-layer/http/dist/http-layer/http/src')
  })
})
