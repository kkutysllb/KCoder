'use strict'
// subagent-monitor 隔离单测：esbuild 单文件转译 + 解析劫持 stub 掉
// dsh-manager / file-activity（electron 链），测 filterForWorkspace
// 的按工作区过滤语义（核心回归：B 工作区运行中条目不进 A 工作区面板）
// 与 toEntry 契约映射。
// 用法：node build/subagent-test/run.js
const fs = require('fs')
const path = require('path')
const Module = require('module')

const DIR = __dirname

// 最小 stub：dshManager.status 恒非 ready（不触发轮询 fetch）；
// fileActivity.onFrame no-op（单例构造挂接即可）；textOfBlocks 简单拼接
fs.writeFileSync(path.join(DIR, 'dsh-manager-stub.js'),
  "module.exports = { dshManager: { status: { state: 'off', url: null } } }\n")
fs.writeFileSync(path.join(DIR, 'file-activity-stub.js'),
  'module.exports = {\n' +
  "  fileActivity: { onFrame() {} },\n" +
  '  textOfBlocks: (c) => Array.isArray(c) ? c.map(b => b?.text ?? "").join("") : "",\n' +
  '}\n')
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request === './dsh-manager') return path.join(DIR, 'dsh-manager-stub.js')
  if (request === './file-activity') return path.join(DIR, 'file-activity-stub.js')
  return origResolve.call(this, request, ...rest)
}
const es = require(path.join(DIR, '..', '..', 'node_modules', '.pnpm', 'esbuild@0.25.12', 'node_modules', 'esbuild'))
es.buildSync({
  entryPoints: [path.join(DIR, '..', '..', 'desktop', 'main', 'subagent-monitor.ts')],
  format: 'cjs', target: 'node20', platform: 'node',
  outfile: path.join(DIR, 'monitor.js'),
})
const { filterForWorkspace, toEntry } = require('./monitor.js')

let pass = 0
const fail = []
const check = (name, cond) => { if (cond) { pass++ } else { fail.push(name) } }

const rec = (over) => ({
  id: '', parentId: null, label: '子代理', cwd: null, running: false,
  task: '', toolCalls: 0, lastAt: 0, rows: [], seen: new Set(), historyDone: true,
  ...over,
})
// A 工作区（活跃父会话 p1）：运行中 / 已结束随锚点 / 已结束属老会话 p0
const aRun = rec({ id: 'a-run', parentId: 'p1', cwd: '/wa', running: true })
const aDone = rec({ id: 'a-done', parentId: 'p1', cwd: '/wa', running: false })
const aOld = rec({ id: 'a-old', parentId: 'p0', cwd: '/wa', running: false })
// B 工作区（父会话 p2）：运行中（核心回归对象）/ 已结束
const bRun = rec({ id: 'b-run', parentId: 'p2', cwd: '/wb', running: true })
const bDone = rec({ id: 'b-done', parentId: 'p2', cwd: '/wb', running: false })
// cwd 未知（session.list 无 cwd）的运行中条目
const nRun = rec({ id: 'n-run', parentId: 'p3', cwd: null, running: true })
const ALL = [aRun, aDone, aOld, bRun, bDone, nRun]
const ids = (list) => list.map(r => r.id).sort()

// ========== A 工作区面板（ws=/wa，活跃父会话 p1） ==========
let out = filterForWorkspace(ALL, '/wa', 'p1')
check('A1 只含 A 工作区条目', JSON.stringify(ids(out)) === JSON.stringify(['a-done', 'a-run']))
check('A2 B 工作区运行中条目被排除（旧逻辑会跨区放行）', !out.includes(bRun))
check('A3 B 工作区已结束条目被排除', !out.includes(bDone))
check('A4 cwd 未知的运行中条目不进有工作区面板', !out.includes(nRun))
check('A5 A 老会话已结束条目退场（防残留）', !out.includes(aOld))
check('A6 A 运行中条目随本工作区保留', out.includes(aRun))
check('A7 A 活跃父会话已结束条目保留', out.includes(aDone))

// ========== B 工作区面板（对称） ==========
out = filterForWorkspace(ALL, '/wb', 'p2')
check('B1 只含 B 工作区条目', JSON.stringify(ids(out)) === JSON.stringify(['b-done', 'b-run']))

// ========== 无工作区态（null / ''）显示全部 ==========
check('C1 ws=null 显示全部', filterForWorkspace(ALL, null, null).length === ALL.length)
check('C2 ws="" 显示全部', filterForWorkspace(ALL, '', null).length === ALL.length)

// ========== 锚点消失（dsh 重启新存储：活跃父会话没了） ==========
out = filterForWorkspace(ALL, '/wa', null)
check('D1 锚点消失时仅运行中保留（已结束退场）', JSON.stringify(ids(out)) === JSON.stringify(['a-run']))

// ========== toEntry 契约映射 ==========
const e = toEntry(aRun)
check('E1 ws 为 cwd 尾段', e.ws === 'wa')
check('E2 cwd null → ws null', toEntry(nRun).ws === null)
check('E3 label 缺省回退', e.label === '子代理')
check('E4 rows 透传', Array.isArray(e.rows) && e.rows.length === 0)

if (fail.length > 0) {
  console.error(`FAIL ${fail.length}/${pass + fail.length}:`)
  for (const f of fail) console.error('  - ' + f)
  process.exit(1)
}
console.log(`subagent-test: ${pass}/${pass + fail.length} PASS`)
