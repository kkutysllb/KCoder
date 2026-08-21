// 连 CDP target 抓 3 秒 CPU profile，输出热点函数（死循环定位用）
const port = process.argv[2] ?? '9333'
const wantTitle = process.argv[3] ?? 'DSH'
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const target = targets.find((t) => t.type === 'page' && t.title.includes(wantTitle))
if (target === undefined) { console.error('target 未找到:', targets.map((t) => t.title)); process.exit(1) }
console.error('target:', target.title, target.url)

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

let seq = 0
const pending = new Map()
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq
  pending.set(id, { res, rej })
  ws.send(JSON.stringify({ id, method, params }))
})
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id !== undefined && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error !== undefined ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result)
  }
}

await send('Profiler.enable')
await send('Profiler.setSamplingInterval', { interval: 200 })
await send('Profiler.start')
await new Promise((r) => setTimeout(r, 3000))
const { profile } = await send('Profiler.stop')

// 聚合：把每个节点的 hitCount 归到自身函数
const byFunc = new Map()
const walk = (node) => {
  const key = `${node.callFrame.functionName || '(anonymous)'} @ ${node.callFrame.url || '?'}:${node.callFrame.lineNumber + 1}`
  byFunc.set(key, (byFunc.get(key) ?? 0) + node.hitCount)
  for (const c of node.children ?? []) walk(c)
}
walk(profile.head)
const total = [...byFunc.values()].reduce((a, b) => a + b, 0)
console.error(`总采样: ${total}`)
for (const [name, hits] of [...byFunc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  if (hits === 0) break
  console.error(`${(hits / Math.max(total, 1) * 100).toFixed(1).padStart(5)}%  ${hits.toString().padStart(6)}  ${name}`)
}
ws.close()
process.exit(0)
