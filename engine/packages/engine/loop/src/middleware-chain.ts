import type { MiddlewareContext, MiddlewareResult, RuntimeHook, RuntimeMiddleware } from './runtime-middleware.js'

export class MiddlewareChain {
  private readonly middleware: RuntimeMiddleware[]

  constructor(middleware: RuntimeMiddleware[] = []) {
    const byId = new Map<string, RuntimeMiddleware>()
    for (const item of middleware) {
      if (byId.has(item.id)) throw new Error(`duplicate middleware: ${item.id}`)
      byId.set(item.id, item)
    }
    const indegree = new Map<string, number>()
    const outgoing = new Map<string, Set<string>>()
    for (const item of middleware) {
      indegree.set(item.id, 0)
      outgoing.set(item.id, new Set())
    }
    const addEdge = (from: string, to: string) => {
      if (!byId.has(from)) throw new Error(`unknown middleware anchor: ${from}`)
      if (!byId.has(to)) throw new Error(`unknown middleware anchor: ${to}`)
      if (from === to) throw new Error(`middleware anchor cycle: ${from}`)
      const edges = outgoing.get(from)!
      if (!edges.has(to)) {
        edges.add(to)
        indegree.set(to, indegree.get(to)! + 1)
      }
    }
    for (const item of middleware) {
      for (const target of item.before ?? []) addEdge(item.id, target)
      for (const target of item.after ?? []) addEdge(target, item.id)
    }
    const order: RuntimeMiddleware[] = []
    const ready = middleware.filter((item) => indegree.get(item.id) === 0).map((item) => item.id)
    while (ready.length) {
      const id = ready.shift()!
      order.push(byId.get(id)!)
      for (const target of outgoing.get(id) ?? []) {
        const next = indegree.get(target)! - 1
        indegree.set(target, next)
        if (next === 0) {
          const index = middleware.findIndex((item) => item.id === target)
          const insertion = ready.findIndex((candidate) => (middleware.findIndex((item) => item.id === candidate) > index))
          if (insertion < 0) ready.push(target)
          else ready.splice(insertion, 0, target)
        }
      }
    }
    if (order.length !== middleware.length) throw new Error('middleware anchor cycle')
    this.middleware = order
  }

  get ordered(): readonly RuntimeMiddleware[] { return this.middleware }

  async run(hook: RuntimeHook, context: MiddlewareContext): Promise<MiddlewareResult | undefined> {
    const applicable = this.middleware.filter((item) => item.hooks.includes(hook))
    const dispatch = async (index: number, current: MiddlewareContext): Promise<MiddlewareResult | undefined> => {
      const item = applicable[index]
      if (!item) return { context: current }
      return item.handle(current, (nextContext) => dispatch(index + 1, nextContext))
    }
    return dispatch(0, context)
  }
}
