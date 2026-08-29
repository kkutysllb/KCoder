/**
 * @kcoder/git-panel 单测（node 直跑，零依赖）：
 *
 *   node bundle/kcoder-git-panel/tests/run-tests.mjs
 *
 * 覆盖 entry.js 导出的纯逻辑（解析/扫描/探测）与真 git 临时仓库
 * 集成用例（git 缺席时集成块自动 SKIP，不记 FAIL）。
 */

import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, writeFile, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  firstLine, wsName, relTime,
  parseStatusLines, parseNumstatLines,
  countUntrackedLines, scanPlans,
  probeWorkspace, emptySnapshot,
  handleSnapshot, handleOpenPlan,
  RPC_PREFIX,
} from '../entry.js'

let pass = 0
let fail = 0
let skipped = 0
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

const execFileP = (cmd, args, cwd) => new Promise((resolve, reject) => {
  execFile(cmd, args, { cwd }, (error, stdout, stderr) => {
    if (error !== null) reject(new Error(stderr !== '' ? stderr : error.message))
    else resolve(stdout)
  })
})

/** git 是否可用（集成块开关）。 */
async function gitAvailable() {
  try { await execFileP('git', ['--version'], process.cwd()); return true } catch { return false }
}

/* ---------------- 纯逻辑 ---------------- */

await test('firstLine 取首个非空行', () => {
  assert.equal(firstLine('fatal: x\n  第二行\n'), 'fatal: x')
  assert.equal(firstLine('\n\n  \nabc'), 'abc')
  assert.equal(firstLine(''), null)
  assert.equal(firstLine('\n  \n'), null)
})

await test('wsName 取路径尾段', () => {
  assert.equal(wsName('/Users/t/proj'), 'proj')
  assert.equal(wsName('/Users/t/proj/'), 'proj')
  assert.equal(wsName('/'), '/')
  assert.equal(wsName('relative/path'), 'path')
})

await test('relTime 档位与单复数', () => {
  const now = Date.now()
  assert.equal(relTime(now), '0 seconds ago')
  assert.equal(relTime(now - 1000), '1 second ago')
  assert.equal(relTime(now - 59_000), '59 seconds ago')
  assert.equal(relTime(now - 60_000), '1 minute ago')
  assert.equal(relTime(now - 3_600_000), '1 hour ago')
  assert.equal(relTime(now - 86_400_000), '1 day ago')
  assert.equal(relTime(now - 31 * 86_400_000), '1 month ago')
  // 宿主原语义：先月后年（d/31 ≥ 12 才落年档，365/31=11 仍是月）
  assert.equal(relTime(now - 365 * 86_400_000), '11 months ago')
  assert.equal(relTime(now - 380 * 86_400_000), '1 year ago')
  assert.equal(relTime(now + 60_000), '0 seconds ago') // 未来 mtime 钳 0
})

await test('parseStatusLines 三计数 + 冲突双计数', () => {
  assert.deepEqual(
    parseStatusLines('A  staged.txt\n M tracked.txt\n?? new.txt\n?? dir2/\n'),
    { staged: 1, changed: 1, untracked: 2 },
  )
  // UU 冲突：X/Y 双计数
  assert.deepEqual(parseStatusLines('UU both.txt\n'), { staged: 1, changed: 1, untracked: 0 })
  assert.deepEqual(parseStatusLines(''), { staged: 0, changed: 0, untracked: 0 })
  assert.deepEqual(parseStatusLines('?? a.txt'), { staged: 0, changed: 0, untracked: 1 })
})

await test('parseNumstatLines 求和且跳过二进制', () => {
  assert.deepEqual(
    parseNumstatLines('3\t1\ta.txt\n-\t-\tbin.png\n10\t0\tb.md\n'),
    { added: 13, removed: 1 },
  )
  assert.deepEqual(parseNumstatLines(''), { added: 0, removed: 0 })
})

await test('countUntrackedLines 按 \\n 计行（末行无换行不计）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kc-git-panel-ut-'))
  await writeFile(join(dir, 'a.txt'), 'l1\nl2\nl3\n') // 3 行
  await writeFile(join(dir, 'b.txt'), 'x1\nx2') // 末行无换行 → 1 行
  await writeFile(join(dir, 'empty.txt'), '') // 0 行
  assert.equal(await countUntrackedLines(dir, 'a.txt\nb.txt\nempty.txt\n'), 4)
  assert.equal(await countUntrackedLines(dir, ''), 0)
  assert.equal(await countUntrackedLines(dir, 'missing.txt\n'), 0) // 不存在跳过
})

await test('emptySnapshot 形状', () => {
  assert.deepEqual(emptySnapshot(), {
    workspace: null, isRepo: false,
    staged: 0, changed: 0, untracked: 0, added: 0, removed: 0, plans: [],
    error: null,
  })
})

await test('handleSnapshot：cwd 缺席/相对路径 → 空快照', async () => {
  assert.deepEqual(await handleSnapshot({}), emptySnapshot())
  assert.deepEqual(await handleSnapshot({ cwd: 'relative/path' }), emptySnapshot())
  assert.deepEqual(await handleSnapshot({ cwd: null }), emptySnapshot())
})

await test('handleOpenPlan：绝对路径白名单外拒开', async () => {
  assert.equal((await handleOpenPlan({ path: '' })).ok, false)
  assert.equal((await handleOpenPlan({ path: 'relative/a.md' })).ok, false)
  assert.equal((await handleOpenPlan({ path: '/tmp/a.exe' })).ok, false)
  // 白名单内才真正拉起系统应用——不在此真开（跳过 ok 断言，仅验证拒绝分支）
})

/* ---------------- 集成（真 git 临时仓库） ---------------- */

if (await gitAvailable()) {
  await test('probeWorkspace：真仓库计数与行数增补', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kc-git-panel-repo-'))
    await execFileP('git', ['init'], dir)
    await execFileP('git', ['config', 'user.email', 't@t.local'], dir)
    await execFileP('git', ['config', 'user.name', 't'], dir)
    await writeFile(join(dir, 'tracked.txt'), 'l1\nl2\n')
    await execFileP('git', ['add', '.'], dir)
    await execFileP('git', ['commit', '-m', 'init'], dir)
    // 已跟踪文件追加 1 行（unstaged changed）
    await writeFile(join(dir, 'tracked.txt'), 'l1\nl2\nl3\n')
    // 新文件入暂存（staged）
    await writeFile(join(dir, 'staged.txt'), 's1\n')
    await execFileP('git', ['add', 'staged.txt'], dir)
    // untracked 新文件 2 行（numstat 漏报 → 增补进 added）
    await writeFile(join(dir, 'new.txt'), 'a\nb\n')

    const s = await probeWorkspace(dir)
    assert.equal(s.isRepo, true)
    assert.equal(s.workspace, dir.split('/').filter(Boolean).pop())
    assert.equal(s.error, null)
    assert.equal(s.staged, 1)
    assert.equal(s.changed, 1)
    assert.equal(s.untracked, 1)
    // numstat：tracked +1、staged +1 = 2；untracked 增补 +2 → 4
    assert.equal(s.added, 4)
    assert.equal(s.removed, 0)
  })

  await test('probeWorkspace：非 git 目录是良性空态', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kc-git-panel-norepo-'))
    const s = await probeWorkspace(dir)
    assert.equal(s.isRepo, false)
    assert.equal(s.error, null)
    assert.deepEqual(s.plans, [])
  })

  await test('scanPlans：约定位置/标题提取/上限截断', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kc-git-panel-plans-'))
    const write = async (rel, text, mtimeMs) => {
      const p = join(dir, rel)
      await writeFile(p, text)
      if (mtimeMs !== undefined) {
        const d = new Date(mtimeMs)
        await utimes(p, d, d)
      }
      return p
    }
    const base = Date.now() - 100_000
    await mkdir(join(dir, 'plans'), { recursive: true })
    await mkdir(join(dir, 'docs', 'plans'), { recursive: true })
    await write('plans/b.md', '# Plan B\n', base)
    await write('docs/plans/a.md', 'no heading\n', base + 1000)
    await write('plan.md', '# Title Root\n\nx\n', base + 2000)
    // 超上限的第 7 个（PLAN_MAX=6）——旧 mtime 应被截断
    for (let i = 0; i < 7; i++) await write(`plans/old-${i}.md`, `# Old ${i}\n`, base - 10_000 - i)

    const plans = await scanPlans(dir)
    assert.equal(plans.length, 6)
    const byTitle = new Map(plans.map(p => [p.title, p]))
    assert.equal(byTitle.get('Title Root') !== undefined, true) // 新→旧排序在列
    assert.equal(byTitle.get('Plan B') !== undefined, true)
    // 无标题文档回退文件名（去扩展名）
    assert.equal(byTitle.get('a') !== undefined, true)
    // 7 个 old 中 mtime 最旧者被截断（old-0..2 仍比约定位置外的更早批次新）
    assert.equal(byTitle.get('Old 6') !== undefined, false)
    assert.equal(byTitle.get('Old 2') !== undefined, true)
    // when 是相对时间文案
    const root = byTitle.get('Title Root')
    assert.match(root.when, /^\d+ (second|minute|hour)s? ago$/)
    // plan.path 是绝对路径
    assert.ok(root.path.startsWith('/'))
  })

  await test('probeWorkspace：计划扫描并入快照', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kc-git-panel-snap-'))
    await execFileP('git', ['init'], dir)
    await execFileP('git', ['config', 'user.email', 't@t.local'], dir)
    await execFileP('git', ['config', 'user.name', 't'], dir)
    await writeFile(join(dir, 'plan.md'), '# Snap Plan\n')
    await execFileP('git', ['add', '.'], dir)
    await execFileP('git', ['commit', '-m', 'init'], dir)

    const s = await probeWorkspace(dir)
    assert.equal(s.isRepo, true)
    assert.equal(s.plans.length, 1)
    assert.equal(s.plans[0]?.title, 'Snap Plan')
  })

  await test('handleSnapshot：绝对路径直通 probeWorkspace', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kc-git-panel-hs-'))
    const s = await handleSnapshot({ cwd: dir }) // 非 git 临时目录 → 良性空态
    assert.equal(s.isRepo, false)
    assert.equal(s.workspace, dir.split('/').filter(Boolean).pop())
  })
} else {
  skipped = 5
  console.log('SKIP git 集成用例 ×5（git 不可用）')
}

/* ---------------- 汇总 ---------------- */

console.log(`\n${pass} pass, ${fail} fail, ${skipped} skipped`)
if (failures.length > 0) {
  console.log('\n失败清单:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log('ALL PASS')
