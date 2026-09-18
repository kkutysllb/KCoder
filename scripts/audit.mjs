#!/usr/bin/env node
/**
 * 全仓库审计（发版前置规定，2026-09-11 起）：
 *
 *   node scripts/audit.mjs
 *
 * 分节执行，[门] 为硬性失败项（退出码 1），[报告] 为审计项——不阻断
 * 命令退出，但必须逐条处置（修复或在 release/audit-v<版本>.md 中说明
 * 豁免理由）后才能 ship：
 *
 * 1. [门] TYPECHECK   —— tsc 双 project 严格类型检查
 * 2. [门] LINT        —— oxlint 全仓库（desktop + scripts），0 error 才过；
 *                        warning 逐条列出，安全类（eval 等）必须处置
 * 3. [门] SECURITY    —— pnpm audit 生产依赖漏洞，high 及以上即失败
 *                        （镜像源无 audit 端点，固定走 npmjs 官方）
 * 4. [报告] DEAD EXPORTS —— ts-prune 双 project 未消费导出清单
 * 5. [报告] UNUSED DEPS  —— depcheck 未使用依赖清单
 *
 * ship（release.sh）前置：本命令退出码 0 + 审计报告
 * release/audit-v<版本>.md 存在（随发版提交一并入库）。
 */
import { spawnSync } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const results = []
let failed = false

const section = (name, gate, fn) => {
  process.stdout.write(`\n━━━ [${gate ? '门' : '报告'}] ${name} ━━━\n`)
  let verdict
  try {
    verdict = fn()
  } catch (error) {
    verdict = { status: 'fail', detail: String(error?.message ?? error) }
  }
  verdict = verdict ?? { status: 'pass' }
  results.push({ name, gate, ...verdict })
  if (verdict.gate === false || (gate && verdict.status === 'fail')) failed = true
  for (const f of verdict.findings ?? []) console.log('  • ' + f)
  const mark = verdict.status === 'pass' ? '\x1b[32mPASS\x1b[0m' : verdict.status === 'fail' ? '\x1b[31mFAIL\x1b[0m' : '\x1b[33mREPORT\x1b[0m'
  console.log(`${mark} ${name}${verdict.note ? ' — ' + verdict.note : ''}`)
}

const run = (cmd, args) => spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' })

/* 1. TYPECHECK */
section('TYPECHECK', true, () => {
  const r = run('pnpm', ['typecheck'])
  return r.status === 0 ? { status: 'pass' } : { status: 'fail', detail: (r.stdout + r.stderr).slice(-2000) }
})

/* 2. LINT */
section('LINT', true, () => {
  const r = run('npx', ['oxlint', 'desktop', 'scripts'])
  const out = r.stdout + r.stderr
  const errors = Number(/(\d+) errors?/.exec(out)?.[1] ?? 0)
  const warnings = Number(/(\d+) warnings?/.exec(out)?.[1] ?? 0)
  if (r.status !== 0 || errors > 0) return { status: 'fail', detail: out.slice(-2000) }
  return { status: 'pass', note: `${warnings} warning（安全类如 eval 必须逐条处置或加注豁免理由）` }
})

/* 3. SECURITY：镜像源无 audit 端点，固定官方 registry */
section('SECURITY（生产依赖漏洞，high+ 即失败）', true, () => {
  const r = run('pnpm', ['audit', '--prod', '--audit-level', 'high', '--registry=https://registry.npmjs.org'])
  const out = r.stdout + r.stderr
  if (/audit endpoint|EAUDIT|ENOTFOUND|ETIMEDOUT/i.test(out) && r.status !== 0) {
    return { status: 'fail', detail: 'audit 端点不可达（网络/registry 问题），修好网络后重跑——不允许静默跳过' }
  }
  if (r.status !== 0) return { status: 'fail', detail: out.slice(-2000) }
  const m = /found (\d+) vulnerabilities?/.exec(out)
  return { status: 'pass', note: m ? m[0] : '无 high+ 漏洞' }
})

/* 4. DEAD EXPORTS（ts-prune 双 project；人工逐条处置，报告进审计文件） */
section('DEAD EXPORTS（未消费导出）', false, () => {
  // 已知合法豁免（有意的公开面/工具入口，非遗留）：
  const WAIVED = [
    { re: /electron\.vite\.config\.ts.*- default/, why: 'electron-vite 配置入口' },
    { re: /desktop\/shared\/ipc-contract\.ts/, why: 'IPC 契约面类型（跨进程文档面，按设计导出）' },
  ]
  const lines = []
  let waived = 0
  for (const project of ['tsconfig.node.json', 'tsconfig.web.json']) {
    const r = run('npx', ['ts-prune', '-p', project])
    if (r.status !== 0 && r.stdout === '') return { status: 'fail', detail: 'ts-prune 执行失败' }
    for (const line of (r.stdout || '').split('\n')) {
      if (line.trim() === '' || line.includes('(used in module)')) continue
      const full = `[${project}] ${line.trim()}`
      if (WAIVED.some((w) => w.re.test(full))) { waived += 1; continue }
      lines.push(full)
    }
  }
  return { status: 'report', note: `${lines.length} 项待逐条处置（修复或在审计报告中豁免；另有 ${waived} 项已知豁免）`, findings: lines }
})

/* 5. UNUSED DEPS（depcheck；报告项） */
section('UNUSED DEPS（未使用依赖）', false, () => {
  const dir = mkdtempSync(join(tmpdir(), 'kcoder-audit-'))
  const ignoreFile = join(dir, '.depcheckrc.json')
  writeFileSync(ignoreFile, JSON.stringify({
    ignores: ['electron', 'electron-builder', 'electron-vite', 'vite', 'typescript', 'oxlint', 'ts-prune', 'depcheck'],
    skipMissing: true,
  }))
  const r = run('npx', ['depcheck', '--json', `--config=${ignoreFile}`])
  let unused = {}
  try { unused = JSON.parse(r.stdout || '{}').using ?? {} } catch { /* 解析失败按空处理 */ }
  const names = Object.keys(unused)
  return { status: 'report', note: names.length > 0 ? `${names.length} 项：${names.join(', ')}` : '无', findings: names }
})

/* 汇总 */
console.log('\n━━━ 审计汇总 ━━━')
for (const r of results) {
  console.log(`${r.gate ? '[门]' : '[报告]'} ${r.name}: ${r.status}${r.note ? ' — ' + r.note : ''}`)
}
if (failed) {
  console.error('\n\x1b[31m审计未通过：存在硬性失败项，修复后重跑\x1b[0m')
  process.exit(1)
}
console.log('\x1b[32m审计通过（报告项需逐条处置并记录到 release/audit-v<版本>.md）\x1b[0m')
