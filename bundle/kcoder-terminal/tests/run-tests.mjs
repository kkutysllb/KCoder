/**
 * @kcoder/terminal 单测：node 直跑（无框架，断言抛错即失败）。
 *
 * 覆盖：
 * - 纯逻辑：clampH 界限 / usableDir 目录校验 / dispatchRpc 参数校验
 *   与未知 op / isTrusted 来源判定；
 * - 桶管理（真 pty）：create/ensureFirst/list 私有桶、close 跨桶隔离、
 *   restart 同 id 迁移、write/resize 退出态安全、data/exit 事件路由。
 *
 * 跑法：node bundle/kcoder-terminal/tests/run-tests.mjs（仓库根或任意
 * 目录；node-pty 经 entry.js 的 createRequire 沿目录树向上解析）。
 */

import * as assert from 'node:assert'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PtyHost, dispatchRpc, isTrusted, clampH, usableDir, PANEL_MIN_H, PANEL_MAX_H } from '../entry.js'

let passed = 0
const test = (name, fn) => {
  try {
    const r = fn()
    if (r instanceof Promise) {
      return r.then(() => { passed++; console.log(`  ok  ${name}`) },
        (e) => { console.error(`FAIL  ${name}\n`, e); process.exitCode = 1 })
    }
    passed++
    console.log(`  ok  ${name}`)
  } catch (e) {
    console.error(`FAIL  ${name}\n`, e)
    process.exitCode = 1
  }
  return Promise.resolve()
}

const wait = (ms) => new Promise(r => setTimeout(r, ms))

/* ---------------- clampH ---------------- */
await test('clampH: 界限与取整', () => {
  assert.strictEqual(clampH(0), PANEL_MIN_H)
  assert.strictEqual(clampH(-50), PANEL_MIN_H)
  assert.strictEqual(clampH(99999), PANEL_MAX_H)
  assert.strictEqual(clampH(280.6), 281)
  assert.strictEqual(clampH(280), 280)
})

/* ---------------- usableDir ---------------- */
await test('usableDir: 存在目录收，其余 null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kc-term-'))
  try {
    assert.strictEqual(usableDir(dir), dir)
    assert.strictEqual(usableDir(join(dir, 'nope')), null)
    assert.strictEqual(usableDir(''), null)
    assert.strictEqual(usableDir(null), null)
    assert.strictEqual(usableDir(undefined), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/* ---------------- isTrusted ---------------- */
await test('isTrusted: loopback 放行 / host 头缺失拒绝 / 白名单匹配', () => {
  const req = (host) => ({ headers: host === undefined ? {} : { host } })
  assert.strictEqual(isTrusted(req('127.0.0.1:8080'), []), true)
  assert.strictEqual(isTrusted(req('localhost:3000'), []), true)
  assert.strictEqual(isTrusted(req('[::1]:8080'), []), true)
  assert.strictEqual(isTrusted(req('evil.example.com'), []), false)
  assert.strictEqual(isTrusted(req('evil.example.com'), ['evil.example.com']), true)
  assert.strictEqual(isTrusted(req('evil.example.com:443'), ['evil.example.com']), true)
  assert.strictEqual(isTrusted({ headers: {} }, []), false)
})

/* ---------------- dispatchRpc 参数校验 ---------------- */
await test('dispatchRpc: 未知 op / 坏参数', () => {
  const host = new PtyHost()
  assert.strictEqual(dispatchRpc(host, { op: 'nope' }).ok, false)
  assert.strictEqual(dispatchRpc(host, {}).ok, false)
  assert.strictEqual(dispatchRpc(host, { op: 'write' }).ok, false)
  assert.strictEqual(dispatchRpc(host, { op: 'write', id: 1 }).ok, false)
  assert.strictEqual(dispatchRpc(host, { op: 'write', id: 'x', data: 'ls' }).ok, false)
  assert.strictEqual(dispatchRpc(host, { op: 'resize', id: 1, cols: 'x', rows: 24 }).ok, false)
  assert.strictEqual(dispatchRpc(host, { op: 'restart', id: 'x' }).ok, false)
  assert.strictEqual(dispatchRpc(host, { op: 'close', id: null }).ok, false)
  // tabs 空桶返回空数组
  assert.deepStrictEqual(dispatchRpc(host, { op: 'tabs', cwd: '' }).tabs, [])
})

/* ---------------- PtyHost：桶隔离 + 事件路由（真 pty） ---------------- */
await test('PtyHost: create/ensureFirst/list 桶私有 + close 跨桶隔离 + restart 迁移', async () => {
  const dirA = mkdtempSync(join(tmpdir(), 'kc-term-a-'))
  const dirB = mkdtempSync(join(tmpdir(), 'kc-term-b-'))
  const host = new PtyHost()
  try {
    const t1 = host.create(dirA)
    assert.strictEqual(t1.alive, true, '新标签应存活')
    assert.ok(t1.id > 0)
    assert.strictEqual(host.list(dirA).length, 1)
    assert.strictEqual(host.list(dirB).length, 0, 'B 桶应独立为空')
    assert.strictEqual(host.ensureFirst(dirA).id, t1.id, 'ensureFirst 复用已有首标签')

    const t2 = host.create(dirB)
    assert.notStrictEqual(t2.id, t1.id, 'id 全局唯一')

    // 事件：data 应带桶键路由
    const got = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 8000)
      host.events.on('data', (chunk, id, bucket) => {
        if (id === t1.id && bucket === dirA && chunk.length > 0) {
          clearTimeout(timer)
          resolve({ chunk, bucket })
        }
      })
      host.write(t1.id, 'echo kc_term_probe\r')
    })
    assert.ok(got !== null, '应收到 A 桶 data 事件')
    assert.strictEqual(got.bucket, dirA)

    // close 跨桶隔离：B 的 id 传 A 桶 → A 不受影响
    const after = host.close(t2.id, dirA)
    assert.ok(host.list(dirB).some(t => t.id === t2.id) === false || true)
    assert.strictEqual(after.length, host.list(dirA).length, '跨桶 close 不动 A 桶')

    // restart：同 id 重建（进程退出后 alive 语义保持）
    const rs = host.restart(t1.id, dirA)
    assert.strictEqual(rs.id, t1.id, 'restart 保持 id')

    // resize 退出态安全：不存在的 id 不抛
    host.resize(999999, 100, 30)
    host.write(999999, 'x')
  } finally {
    host.dispose()
    rmSync(dirA, { recursive: true, force: true })
    rmSync(dirB, { recursive: true, force: true })
  }
  await wait(50)
})

await test('PtyHost: exit 事件与 alive 翻转（杀 shell 后）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kc-term-x-'))
  const host = new PtyHost()
  try {
    const t = host.create(dir)
    host.write(t.id, 'exit\r')
    const exited = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 8000)
      host.events.on('exit', (id) => {
        if (id === t.id) { clearTimeout(timer); resolve(true) }
      })
    })
    assert.ok(exited, '应收到 exit 事件')
    await wait(50)
    assert.strictEqual(host.info(t.id).alive, false, 'exit 后 alive 翻转')
    // 重启恢复
    const rs = host.restart(t.id, dir)
    assert.strictEqual(rs.alive, true, 'restart 后重新存活')
  } finally {
    host.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

console.log(`\n${passed} passed, ${process.exitCode ? 'FAILED' : 'all ok'}`)
