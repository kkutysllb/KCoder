/**
 * dsh-stats-panel 单测（node 直跑，零依赖）：
 *
 *   node bundle/dsh-stats-panel/tests/run-tests.mjs
 *
 * 覆盖 client.js 导出的 parseStatsLine（StatsLine 行文本 → 图表数据）。
 * client-module 交付物无 import/export，测试以 ModuleLoader stub 取
 * factory 产物（与 dsh /plugins combo 注入后的真实形态一致）。
 */

import assert from 'node:assert/strict'

// client.js 载入即 window.__ModuleLoader__.load(...)——先布桩再 import
let loaded = null
globalThis.window = {
  __ModuleLoader__: { load(def) { loaded = def } },
}

await import('../client.js')

assert.ok(loaded, 'client.js 应向 __ModuleLoader__ 注册')
assert.equal(loaded.id, 'dsh-stats-panel')
const api = loaded.factory()
assert.ok(Array.isArray(api.inject), 'factory 产物应含 inject 数组')
assert.equal(typeof api.apply, 'function', 'factory 产物应含 apply')
assert.equal(typeof api.parseStatsLine, 'function', '应导出 parseStatsLine 供测试')
const parse = api.parseStatsLine

let pass = 0
let fail = 0
const failures = []

/** 单用例：断言失败计 FAIL 并继续（全量跑完给出清单）。 */
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { pass++; console.log(`PASS ${name}`) })
    .catch((error) => {
      fail++
      failures.push(`${name}: ${error?.message ?? error}`)
      console.log(`FAIL ${name}: ${error?.message ?? error}`)
    })
}

/** 浮点近似相等（token K/M 换算不可精确表示）。 */
function close(a, b) {
  assert.ok(Math.abs(a - b) < 1e-6, `expected ${a} ≈ ${b}`)
}

/* ---------------- v0.1.0 修复目标：新基线 i18n 时长格式 ---------------- */

await test('zh 全量行：「分/秒」时长（v0.1.0 修复项）', () => {
  const o = parse('16 轮 · 496 步 | LLM 5分12秒 · 工具调用 2分42秒 | 首 token 平均 3.5秒 · 99 tok/s | 缓存命中 96% | 输入 2M tok · 输出 378.5K tok')
  assert.deepEqual(o, {
    turns: 16, steps: 496,
    llmSec: 312, toolSec: 162, ttftSec: 3.5,
    tps: 99, cachePct: 96,
    inputTok: 2e6, outputTok: 378500,
  })
})

await test('zh 小数秒：「45.2秒」', () => {
  assert.equal(parse('LLM 45.2秒').llmSec, 45.2)
  assert.equal(parse('首 token 平均 1.2秒').ttftSec, 1.2)
  assert.equal(parse('工具调用 3秒').toolSec, 3)
})

await test('zh 分钟档整分：「2分0秒」', () => {
  assert.equal(parse('LLM 2分0秒').llmSec, 120)
})

await test('「首token 平均」无空格变体（旧版兼容）', () => {
  assert.equal(parse('首token 平均 3.5秒').ttftSec, 3.5)
})

/* ---------------- en 格式回归（英文界面 / 旧基线） ---------------- */

await test('en 全量行：英文时长格式仍兼容', () => {
  const o = parse('16 turns · 496 steps | LLM 5m12s · Tool call 2m42s | TTFT avg 45.2s · 99 tok/s | Cache hit 96% | Input 2M tok · Output 378.5K tok')
  assert.equal(o.turns, 16)
  assert.equal(o.steps, 496)
  assert.equal(o.llmSec, 312)
  assert.equal(o.toolSec, 162)
  assert.equal(o.ttftSec, 45.2)
  assert.equal(o.tps, 99)
  assert.equal(o.cachePct, 96)
})

await test('en 小数秒与整分', () => {
  assert.equal(parse('LLM 45.2s').llmSec, 45.2)
  assert.equal(parse('LLM 2m0s').llmSec, 120)
  assert.equal(parse('Tool call 3s').toolSec, 3)
})

/* ---------------- 其余统计项与边界 ---------------- */

await test('真实规模行：M 档输入（浮点近似）', () => {
  const o = parse('16 轮 · 496 步 | LLM 5分12秒 · 工具调用 2分42秒 | 首 token 平均 3.5秒 · 99 tok/s | 缓存命中 96% | 输入 181.2M tok · 输出 378.5K tok')
  close(o.inputTok, 181200000)
  close(o.outputTok, 378500)
})

await test('K 档与无后缀 token 计数', () => {
  const o = parse('输入 517 tok · 输出 12.2K tok')
  assert.equal(o.inputTok, 517)
  close(o.outputTok, 12200)
})

await test('计数行（无时长/token）只出计数', () => {
  assert.deepEqual(parse('16 轮 · 496 步'), { turns: 16, steps: 496 })
})

await test('不可解析返回空对象（脆性边界：静默失败）', () => {
  assert.deepEqual(parse(''), {})
  assert.deepEqual(parse('与统计无关的任意文本'), {})
})

await test('部分可解析只出可解析项', () => {
  const o = parse('16 轮 · 496 步 | 缓存命中 96%')
  assert.deepEqual(o, { turns: 16, steps: 496, cachePct: 96 })
})

await test('时长解析拒绝畸形输入（缺秒档/缺分钟档）', () => {
  assert.equal(parse('LLM 5分').llmSec, undefined)
  assert.equal(parse('LLM m42s').llmSec, undefined)
})

/* ---------------- 汇总 ---------------- */

console.log(`\n${pass} passed, ${fail} failed${fail > 0 ? '' : ' 🎉'}`)
if (fail > 0) {
  console.log('失败清单:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exitCode = 1
}
