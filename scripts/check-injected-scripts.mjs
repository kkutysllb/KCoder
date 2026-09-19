#!/usr/bin/env node
/**
 * 注入脚本静态自检——拦截「模板字符串内的运行时缺陷」，typecheck 与语法
 * 检查都看不见的那一类。
 *
 * ## 背景（2026-09-18 账号菜单一轮连中三次，全部同构）
 *
 * desktop/main 的注入器把页面脚本写在 TS 模板字符串里（chipJs / PAGE_JS /
 * WATCH_JS …），tsc 不检查字符串内容、new Function 只查语法——于是：
 *
 * 1. **悬空标识符**（最疼的一类）：桥重构删掉 `busy` / `settingsTrigger` 的
 *    定义，但两处调用还留着 → 运行时 ReferenceError → 「点外部不关菜单」
 *    「点设置进不去设置页」两个用户可见故障，静默存活了数轮。
 * 2. **bundle client 半的裸 ESM export**：外置 bundle 的 client.js 必须走
 *    `window.__ModuleLoader__.load({ id, factory })` 协议（与
 *    @kkutysllb/dsh-terminal/client.js 同款）；顶层 `export` 加载器不认，
 *    顶层 `const` 会与其它 client 模块撞标识符（实测
 *    "Identifier 'name' has already been declared"，整个 client 装配失败）。
 * 3. （模板内裸反引号会截断模板——tsc 对此有 loudly 报错，已被 typecheck
 *    覆盖，本脚本不再重复。）
 *
 * ## 做法
 *
 * 1. 扫描 desktop/main/*.ts，用小型词法器提取所有模板字符串：跳过注释与
 *    普通 string、处理 `\`` 转义、递归处理 `${...}` 插值（含嵌套模板）；
 * 2. 解码后以 `(() =>` 开头的视为注入脚本：TS 侧插值替换为 null（保持语法
 *    有效），先过 new Function 语法门；
 * 3. 写入临时目录，用 oxlint 的 no-undef（browser/node/es2022 env）做
 *    未定义引用分析——任何 error 即失败；
 * 4. 扫描 bundle 下各包的 client.js：顶层 export 语句即失败（见上 2）。
 *
 * 用法：node scripts/check-injected-scripts.mjs（挂进 pnpm typecheck 链）。
 * 退出码非零 = 有问题，绝不放行。
 *
 * @module scripts/check-injected-scripts
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MAIN_DIR = join(ROOT, 'desktop', 'main')
const BUNDLE_DIR = join(ROOT, 'bundle')
const OXLINT = join(ROOT, 'node_modules', '.bin', 'oxlint')

/**
 * 扫描出的一个模板字符串。
 * @typedef {object} Template
 * @property {string} decoded 解码转义、替换插值后的脚本文本（可直接作为 JS 解析）。
 * @property {string} file 源文件相对路径（报错定位用）。
 * @property {number} line 模板在源文件中的起始行。
 */

/**
 * 从 TS 源码提取全部模板字符串。
 *
 * 小型词法器：跳过行/块注释与单双引号字符串；遇未转义反引号进入模板态；
 * 模板内 `\X` 记为转义、`${` 进入插值态（花括号深度计数，遇嵌套反引号
 * 递归处理），直到匹配的 `}` 回到模板态；再次遇未转义反引号收束。
 */
/** @param {string} src @param {string} file @returns {Template[]} */
function extractTemplates(src, file) {
  /** @type {Template[]} */
  const out = []
  /** @param {number} pos @returns {number} */
  const lineOf = (pos) => src.slice(0, pos).split('\n').length
  let i = 0
  const n = src.length
  // 模板态状态：收集 [text, escapeStartPos] 片段与插值 span
  while (i < n) {
    const ch = src[i]
    // 注释与普通字符串：直接跳到对应的结束位置（内容不参与模板识别）
    if (ch === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue }
    if (ch === '/' && src[i + 1] === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue }
    if (ch === "'" || ch === '"') {
      const q = ch; i++
      while (i < n && src[i] !== q) { if (src[i] === '\\') i++; i++ }
      i++; continue
    }
    if (ch !== '`') { i++; continue }
    // —— 模板开始 ——
    const startLine = lineOf(i)
    i++
    let text = ''
    const drops = [] // 插值 span（在 text 中的映射改用占位后统一替换）
    let done = false
    while (i < n && !done) {
      const c = src[i]
      if (c === '\\') { text += src.slice(i, i + 2); i += 2; continue }
      if (c === '`') { i++; done = true; continue }
      if (c === '$' && src[i + 1] === '{') {
        // TS 侧插值：替换为 null（语法有效；值本身不影响静态分析）
        i += 2
        let depth = 1
        let inner = ''
        while (i < n && depth > 0) {
          const d = src[i]
          if (d === '\\') { inner += src.slice(i, i + 2); i += 2; continue }
          if (d === '`') {
            // 插值里的嵌套模板：递归跳过（其内容不影响本模板的文本形态）
            i++
            let tDepth = 0
            while (i < n) {
              const t = src[i]
              if (t === '\\') { i += 2; continue }
              if (t === '$' && src[i + 1] === '{') { tDepth++; i += 2; continue }
              if (t === '{') { tDepth++; i++; continue }
              if (t === '}') { if (tDepth === 0) break; tDepth--; i++; continue }
              if (t === '`') { i++; break }
              i++
            }
            continue
          }
          if (d === '{') { depth++; inner += d; i++; continue }
          if (d === '}') { depth--; if (depth === 0) { i++; continue } inner += d; i++; continue }
          inner += d; i++
        }
        text += 'null'
        drops.push([text.length - 4, text.length])
        continue
      }
      text += c; i++
    }
    if (!done) break // 文件异常（未闭合模板）：tsc 会报，这里不管
    // 解码模板转义 → 运行时字符串值（即真正的脚本文本）
    const decoded = text
      .replace(/\\`/g, '`')
      .replace(/\\\$/g, '$')
      .replace(/\\(\r?\n)/g, '$1') // 行续接
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\\\/g, '\\')
    out.push({ decoded, file, line: startLine })
  }
  return out
}

/** 单文件收集注入脚本（`(() =>` 开头的模板）。 */
/** @param {string} src @param {string} file @returns {Template[]} */
function injectedScriptsOf(src, file) {
  return extractTemplates(src, file).filter(t => t.decoded.trimStart().startsWith('(() =>'))
}

/** @param {string} m */
const say = (m) => { console.log(`[injected-check] ${m}`) }
/** @param {string} m @returns {never} */
const die = (m) => { console.error(`[injected-check] 错误：${m}`); process.exit(1) }

// ── 1) 提取全部注入脚本 ─────────────────────────────────────────
const files = readdirSync(MAIN_DIR).filter(f => f.endsWith('.ts')).sort()
/** @type {Template[]} */
const scripts = []
for (const f of files) {
  const src = readFileSync(join(MAIN_DIR, f), 'utf8')
  scripts.push(...injectedScriptsOf(src, f))
}
if (scripts.length === 0) die('desktop/main 下一个注入脚本模板都没找到——提取器大概率坏了，宁可不跑也不假通过')
say(`提取到 ${String(scripts.length)} 个注入脚本（${String(files.length)} 个源文件）`)

// ── 1.5) 挂载侧占位符豁免 ──────────────────────────────────────
// 约定：`__全大写__` 形态的裸标识符（如 update-injector 的 __DATA__）由挂载侧
// 在执行前做文本替换（.split().join()），不是悬空引用。收集后按 readonly 全局
// 豁免，并打印豁免清单——清单变化时人应过目一眼。
const placeholderRe = /\b__[A-Z][A-Z0-9_]*__\b/g
const placeholders = new Set()
for (const s of scripts) {
  for (const m of s.decoded.matchAll(placeholderRe)) placeholders.add(m[0])
}
if (placeholders.size > 0) say(`占位符豁免（挂载侧文本替换）：${[...placeholders].join(', ')}`)

// ── 2) 语法门 + 落盘到临时目录 ─────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), 'injected-check-'))
/** @type {Array<{path: string, file: string, line: number}>} */
const written = []
let bad = 0
for (const [idx, s] of scripts.entries()) {
  const name = `script-${String(idx).padStart(2, '0')}.js`
  const path = join(tmp, name)
  try {
    // eslint-disable-next-line no-new-func
    new Function(s.decoded)
  } catch (error) {
    console.error(`  ✗ ${s.file}:${String(s.line)} 语法门失败：${String(error && error.message).slice(0, 120)}`)
    bad++
  }
  writeFileSync(path, s.decoded)
  written.push({ path, file: s.file, line: s.line })
}
if (bad > 0) { rmSync(tmp, { recursive: true, force: true }); die(`${String(bad)} 个脚本未过语法门`) }

// ── 3) oxlint no-undef（browser/node 环境全局）─────────────────
const oxlintrc = join(tmp, '.oxlintrc.json')
const globalsCfg = {}
for (const ph of placeholders) globalsCfg[ph] = 'readonly'
writeFileSync(oxlintrc, JSON.stringify({
  rules: { 'no-undef': 'error' },
  env: { browser: true, node: true, es2022: true },
  globals: globalsCfg,
}))
let lintOutput = ''
try {
  lintOutput = execFileSync(OXLINT, ['-c', oxlintrc, '--format', 'unix', tmp], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
} catch (error) {
  lintOutput = String((error && error.stdout) || '') + String((error && error.stderr) || '')
}
// unix 格式：path:line:col: message [eslint/no-undef]
const undefHits = lintOutput.split('\n')
  .map(l => l.trim())
  .filter(l => l.length > 0 && l.includes('no-undef'))
// 把临时文件名映射回源文件:行号
const pathToSrc = new Map(written.map(w => [w.path, w]))
for (const hit of undefHits) {
  const m = /^(\/[^:]+):(\d+):(\d+):\s*(.*)$/.exec(hit)
  if (m === null) { console.error(`  ✗ ${hit}`); bad++; continue }
  const w = pathToSrc.get(m[1])
  const where = w !== undefined ? `${w.file}（模板起始行 ${String(w.line)}，脚本内第 ${m[2]} 行）` : m[1]
  console.error(`  ✗ ${where}: ${m[4]}`)
  bad++
}
if (bad === 0 && undefHits.length === 0) say('no-undef：零悬空引用')
rmSync(tmp, { recursive: true, force: true })
if (bad > 0) die(`${String(bad)} 处悬空引用——typecheck/语法检查看不见它们，但运行时一定炸`)

// ── 4) bundle client 半：禁止顶层 ESM export（ModuleLoader 协议）──
if (statSync(BUNDLE_DIR, { throwIfNoEntry: false })?.isDirectory() === true) {
  for (const pkg of readdirSync(BUNDLE_DIR).sort()) {
    const client = join(BUNDLE_DIR, pkg, 'client.js')
    if (statSync(client, { throwIfNoEntry: false })?.isFile() !== true) continue
    const src = readFileSync(client, 'utf8')
    const hit = /^export\s/m.exec(src)
    if (hit !== null) {
      const line = src.slice(0, hit.index).split('\n').length
      console.error(`  ✗ bundle/${pkg}/client.js:${String(line)} 顶层 export——外置 bundle 的 client 半必须走 window.__ModuleLoader__.load({ id, factory }) 协议（同 dsh-terminal/client.js），加载器不认 ESM export，且顶层声明会与其它 client 模块撞标识符`)
      bad++
    }
  }
  if (bad === 0) say('bundle client 半：无裸 ESM export')
}
if (bad > 0) die(`${String(bad)} 处 bundle client 协议违规`)
say('通过：注入脚本零悬空引用，client 半协议合规')
