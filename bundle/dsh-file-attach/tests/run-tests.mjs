#!/usr/bin/env node
/**
 * node 直跑单测（零依赖）：entry.js 纯逻辑 + client.js 纯逻辑。
 *
 * client.js 是 combo 拼接执行的浏览器脚本，顶层依赖
 * window.__ModuleLoader__——测试先 stub 该 facade 捕获注册对象，再
 * 动态 import 本仓 client.js，用 factory(undefined) 拿 exports 直测
 * 纯逻辑函数（apply 不执行，不触 DOM）。
 *
 * @module tests/run-tests
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const ENTRY = join(ROOT, 'entry.js')
const CLIENT = join(ROOT, 'client.js')

let passed = 0
let failed = 0

function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log('  ok  ' + name)
  } catch (error) {
    failed += 1
    console.error('  FAIL ' + name + '\n      ' + String(error?.message ?? error))
  }
}

function eq(actual, expected, label) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) throw new Error((label ?? 'value') + ': expected ' + b + ', got ' + a)
}

async function main() {
  // ── entry.js：ESM 静态 import（node ≥18 直接吃浏览器无关纯逻辑） ──
  const entry = await import(pathToFileURL(ENTRY).href)

  console.log('[entry] normalizeAttachName')
  check('合法文件名', () => eq(entry.normalizeAttachName('设计稿.png'), '设计稿.png'))
  check('首尾空白 trim', () => eq(entry.normalizeAttachName('  a.txt '), 'a.txt'))
  check('拒路径分隔符 /', () => eq(entry.normalizeAttachName('a/b'), null))
  check('拒路径分隔符 \\', () => eq(entry.normalizeAttachName('a\\b'), null))
  check('拒 . 段', () => eq(entry.normalizeAttachName('.'), null))
  check('拒 .. 段', () => eq(entry.normalizeAttachName('..'), null))
  check('拒空串', () => eq(entry.normalizeAttachName(''), null))
  check('拒非字符串', () => eq(entry.normalizeAttachName(42), null))
  check('255 字符放行', () => eq(entry.normalizeAttachName('x'.repeat(255)), 'x'.repeat(255)))
  check('256 字符拒绝', () => eq(entry.normalizeAttachName('x'.repeat(256)), null))

  console.log('[entry] parseLocateOutput / depthOf / chooseStatus / firstLine')
  check('输出按行解析', () => eq(entry.parseLocateOutput('/a\n/b\n'), ['/a', '/b']))
  check('空输出', () => eq(entry.parseLocateOutput(''), []))
  check('深度=段数', () => eq(entry.depthOf('/x/y/z', '/x'), 2))
  check('cwd 尾斜杠', () => eq(entry.depthOf('/x/y/z', '/x/'), 2))
  check('win 反斜杠', () => eq(entry.depthOf('C:\\x\\y\\z', 'C:\\x'), 2))
  check('状态 0=none', () => eq(entry.chooseStatus(0), 'none'))
  check('状态 1=found', () => eq(entry.chooseStatus(1), 'found'))
  check('状态 2+=choose', () => eq(entry.chooseStatus(2), 'choose'))
  check('错误首行', () => eq(entry.firstLine('  a\nb\n'), 'a'))
  check('全空错误行', () => eq(entry.firstLine('\n\n'), null))

  console.log('[entry] rankCandidates')
  check('深度浅者优先', () => {
    const r = entry.rankCandidates([
      { path: '/w/sub/a', depth: 2, mtimeMs: 5 },
      { path: '/w/a', depth: 1, mtimeMs: 1 },
    ])
    eq(r.map((x) => x.path), ['/w/a', '/w/sub/a'])
  })
  check('同深 mtime 新者优先', () => {
    const r = entry.rankCandidates([
      { path: '/w/a', depth: 1, mtimeMs: 1 },
      { path: '/w/b', depth: 1, mtimeMs: 9 },
    ])
    eq(r.map((x) => x.path), ['/w/b', '/w/a'])
  })
  check('全同按路径字典序稳定', () => {
    const r = entry.rankCandidates([
      { path: '/w/b', depth: 1, mtimeMs: 1 },
      { path: '/w/a', depth: 1, mtimeMs: 1 },
    ])
    eq(r.map((x) => x.path), ['/w/a', '/w/b'])
  })
  check('入参不被改写', () => {
    const src = [{ path: '/w/b', depth: 2, mtimeMs: 1 }, { path: '/w/a', depth: 1, mtimeMs: 1 }]
    entry.rankCandidates(src)
    eq(src[0].path, '/w/b')
  })

  console.log('[entry] handleLocate（真实临时目录集成）')
  const tmp = mkdtempSync(join(tmpdir(), 'dfa-test-'))
  try {
    writeFileSync(join(tmp, 'spec.md'), 'x')
    mkdirSync(join(tmp, 'nested'))
    writeFileSync(join(tmp, 'nested', 'spec.md'), 'y')
    mkdirSync(join(tmp, 'emptydir'))

    await (async () => {
      eq(await entry.handleLocate({ name: '../etc', cwd: tmp }), { ok: false, error: 'bad name' })
    })()
    await (async () => {
      eq(await entry.handleLocate({ name: 'spec.md', cwd: 'rel/path' }), { ok: false, error: 'bad cwd' })
    })()
    await (async () => {
      const r = await entry.handleLocate({ name: 'spec.md', cwd: tmp })
      if (r.ok !== true || r.status !== 'choose') throw new Error('双命中应 choose: ' + JSON.stringify(r))
      eq(r.candidates.map((c) => c.path), [join(tmp, 'spec.md'), join(tmp, 'nested', 'spec.md')], '浅者在前')
      eq(r.candidates.map((c) => c.isDir), [false, false], '均为文件')
    })()
    await (async () => {
      const r = await entry.handleLocate({ name: 'emptydir', cwd: tmp })
      if (r.ok !== true || r.status !== 'found') throw new Error('唯一命中应 found: ' + JSON.stringify(r))
      eq(r.candidates[0].isDir, true, '目录候选 isDir')
    })()
    await (async () => {
      const r = await entry.handleLocate({ name: 'nope.txt', cwd: tmp })
      eq(r, { ok: true, status: 'none', candidates: [] }, '未命中 none')
    })()
    await (async () => {
      const r = await entry.handleLocate({ name: 'boom.txt', cwd: tmp }, async () => { throw new Error('find exploded\nline2') })
      eq(r, { ok: false, error: 'find exploded' }, 'runner 报错取首行')
    })()
    await (async () => {
      // glob 语义误匹配兜底：basename 不等价的行被精确过滤
      const r = await entry.handleLocate({ name: 'spec.md', cwd: tmp }, async () => [
        join(tmp, 'spec.md'),
        join(tmp, 'spec.md.bak'),
        join(tmp, 'nested', 'spec.md'),
      ])
      eq(r.candidates.length, 2, '误匹配行被过滤')
    })()
    await (async () => {
      // 候选上限截断
      const many = []
      for (let i = 0; i < 12; i++) {
        const d = join(tmp, 'd' + i)
        mkdirSync(d)
        writeFileSync(join(d, 'spec.md'), 'x')
        many.push(join(d, 'spec.md'))
      }
      const r = await entry.handleLocate({ name: 'spec.md', cwd: tmp })
      if (r.candidates.length !== 8) throw new Error('候选应截断到 8, got ' + r.candidates.length)
    })()
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }

  // ── client.js：stub ModuleLoader 捕获 factory ──
  let captured = null
  globalThis.window = { __ModuleLoader__: { load: (reg) => { captured = reg } } }
  await import(pathToFileURL(CLIENT).href)
  if (captured === null) throw new Error('client.js 未调用 __ModuleLoader__.load')
  const client = captured.factory(undefined)

  console.log('[client] 契约形态')
  check('注册 id', () => eq(captured.id, '@kkutysllb/dsh-file-attach'))
  check('inject 为空（全部软探测）', () => eq(client.inject, []))
  check('apply 可调用', () => eq(typeof client.apply, 'function'))

  console.log('[client] isImageName')
  check('常见光栅图', () => eq(client.isImageName('a.PNG'), true))
  check('jpeg 变体', () => eq(client.isImageName('b.JPEG'), true))
  check('无扩展名', () => eq(client.isImageName('c'), false))
  check('文本文件', () => eq(client.isImageName('d.md'), false))
  check('非图片扩展', () => eq(client.isImageName('e.pdf'), false))

  console.log('[client] 附件行格式')
  check('文件行', () => eq(
    client.buildAttachmentLine({ name: 'a.txt', path: '/x/a.txt', isDir: false }),
    '[附件]a.txt|/x/a.txt',
  ))
  check('目录行', () => eq(
    client.buildAttachmentLine({ name: 'assets', path: '/x/assets', isDir: true }),
    '[附件·目录]assets|/x/assets',
  ))

  console.log('[client] buildMessageBody')
  check('仅附件', () => eq(
    client.buildMessageBody([{ name: 'a.txt', path: '/x/a.txt', isDir: false }], ''),
    '[附件]a.txt|/x/a.txt',
  ))
  check('附件 + 原文', () => eq(
    client.buildMessageBody([
      { name: 'a.txt', path: '/x/a.txt', isDir: false },
      { name: 'b', path: '/x/b', isDir: true },
    ], '帮我看看'),
    '[附件]a.txt|/x/a.txt\n[附件·目录]b|/x/b\n\n帮我看看',
  ))
  check('无附件原样', () => eq(client.buildMessageBody([], 'hi'), 'hi'))
  check('无附件无原文', () => eq(client.buildMessageBody([], ''), ''))

  console.log('[client] parseAttachmentMarkup')
  check('混合解析', () => {
    const r = client.parseAttachmentMarkup('[附件]a.txt|/x/a.txt\n帮我看看\n[附件·目录]b|/x/b')
    eq(r.attachments, [
      { name: 'a.txt', path: '/x/a.txt', isDir: false },
      { name: 'b', path: '/x/b', isDir: true },
    ])
    eq(r.rest, '帮我看看')
  })
  check('纯文本', () => {
    const r = client.parseAttachmentMarkup('普通消息')
    eq(r.attachments, [])
    eq(r.rest, '普通消息')
  })
  check('空文本', () => {
    const r = client.parseAttachmentMarkup('')
    eq(r.attachments, [])
    eq(r.rest, '')
  })

  // ── 语法兜底：smoke 场景之外的防御（node --check 双文件） ──
  console.log('[syntax]')
  check('entry.js node --check', () => {
    execFileSync(process.execPath, ['--check', ENTRY], { stdio: 'pipe' })
  })
  check('client.js node --check', () => {
    execFileSync(process.execPath, ['--check', CLIENT], { stdio: 'pipe' })
  })

  console.log('\n' + passed + ' passed, ' + failed + ' failed')
  if (failed > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
