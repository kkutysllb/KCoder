import { describe, expect, it } from 'vitest'
import { MiddlewareChain, type RuntimeMiddleware } from '@qiongqi/loop'

describe('MiddlewareChain', () => {
  it('orders middleware using before/after anchors', async () => {
    const seen: string[] = []
    const make = (id: string, anchors: Partial<RuntimeMiddleware> = {}): RuntimeMiddleware => ({
      id, version: 1, hooks: ['beforeNode'], ...anchors,
      handle: async (_ctx, next) => { seen.push(id); return next(_ctx) }
    })
    const chain = new MiddlewareChain([
      make('third', { after: ['second'] }),
      make('first'),
      make('second', { after: ['first'] })
    ])
    await chain.run('beforeNode', {} as never)
    expect(seen).toEqual(['first', 'second', 'third'])
  })

  it('rejects anchor cycles and duplicate middleware ids', () => {
    const base = (id: string, before?: string[], after?: string[]): RuntimeMiddleware => ({
      id, version: 1, hooks: ['beforeNode'], before, after,
      handle: async (_ctx, next) => next(_ctx)
    })
    expect(() => new MiddlewareChain([base('a'), base('a')])).toThrow('duplicate middleware')
    expect(() => new MiddlewareChain([base('a', ['b']), base('b', ['a'])])).toThrow('cycle')
  })
})
