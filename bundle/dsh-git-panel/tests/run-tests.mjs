/**
 * @kkutysllb/dsh-git-panel 单测（node 直跑，零依赖）：
 *
 *   node bundle/dsh-git-panel/tests/run-tests.mjs
 *
 * 覆盖 entry.js 导出的纯逻辑（解析/扫描/探测）与真 git 临时仓库
 * 集成用例（git 缺席时集成块自动 SKIP，不记 FAIL）。
 */

import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, writeFile, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  firstLine, wsName, relTime,
  parseStatusLines, parseNumstatLines,
  unquotePath, parseStatusEntries, parseNumstatMap,
  parseWorktreesPorcelain, parseAheadBehind, isValidBranchName,
  remoteRepoUrl, compareUrl,
  countUntrackedLines, scanPlans,
  probeWorkspace, emptySnapshot,
  handleSnapshot, handleOpenPlan,
  handleBranches, handleCheckout, handleCreateBranch, handleDeleteBranch,
  handleCommit, handlePush, handleOpenCompare,
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
  const dir = await mkdtemp(join(tmpdir(), 'dsh-git-panel-ut-'))
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
    branch: null, ahead: 0, behind: 0, hasUpstream: false,
    remoteUrl: null, defaultBranch: null, worktrees: [], root: null,
    files: [], filesTruncated: false,
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

await test('unquotePath：普通/引号转义/八进制 UTF-8', () => {
  assert.equal(unquotePath('plain.txt'), 'plain.txt')
  assert.equal(unquotePath('"a\\tb.txt"'), 'a\tb.txt')
  assert.equal(unquotePath('"a\\"q.txt"'), 'a"q.txt')
  // 中文：E4 B8 AD = 中
  assert.equal(unquotePath('"\\344\\270\\255.txt"'), '中.txt')
  assert.equal(unquotePath('"'), '"') // 单引号字符不当引号路径
})

await test('parseStatusEntries：逐文件 + rename 取新路径', () => {
  const es = parseStatusEntries('M  a.txt\n M b.txt\n?? new.txt\nR  old.txt -> new2.txt\n')
  assert.equal(es.length, 4)
  assert.deepEqual(es[0], { path: 'a.txt', x: 'M', y: ' ', untracked: false, staged: true, changed: false })
  assert.equal(es[1].staged, false)
  assert.equal(es[1].changed, true)
  assert.equal(es[2].untracked, true)
  assert.equal(es[3].path, 'new2.txt')
  assert.equal(parseStatusEntries('').length, 0)
})

await test('parseNumstatMap：rename 两形态归一 + 二进制记 0', () => {
  const m = parseNumstatMap('3\t1\ta.txt\n-\t-\tbin.png\n1\t0\tdir/{old.js => new.js}\n2\t0\tx => y\n')
  assert.deepEqual(m.get('a.txt'), { added: 3, removed: 1 })
  assert.deepEqual(m.get('bin.png'), { added: 0, removed: 0 })
  assert.deepEqual(m.get('dir/new.js'), { added: 1, removed: 0 })
  assert.deepEqual(m.get('y'), { added: 2, removed: 0 })
})

await test('parseWorktreesPorcelain：branch/detached/bare 剔除', () => {
  const out = [
    'worktree /r/main', 'HEAD aaa', 'branch refs/heads/main', '',
    'worktree /r/wt1', 'HEAD bbb', 'detached', '',
    'worktree /r/bare1', 'bare', '',
  ].join('\n')
  const ws = parseWorktreesPorcelain(out)
  assert.equal(ws.length, 2)
  assert.deepEqual(ws[0], { path: '/r/main', branch: 'main', detached: false })
  assert.equal(ws[1].detached, true)
})

await test('parseAheadBehind：< > 前缀剥离与坏输入', () => {
  assert.deepEqual(parseAheadBehind('<3\t>1\n'), { ahead: 3, behind: 1 })
  assert.deepEqual(parseAheadBehind('0\t0\n'), { ahead: 0, behind: 0 })
  assert.deepEqual(parseAheadBehind('fatal: no upstream'), { ahead: 0, behind: 0 })
})

await test('isValidBranchName：高频拒绝项', () => {
  assert.equal(isValidBranchName('feature/x'), true)
  assert.equal(isValidBranchName('v0.5.0'), true)
  assert.equal(isValidBranchName(''), false)
  assert.equal(isValidBranchName('bad name'), false)
  assert.equal(isValidBranchName('-lead'), false)
  assert.equal(isValidBranchName('a..b'), false)
  assert.equal(isValidBranchName('x.lock'), false)
  assert.equal(isValidBranchName('a^b'), false)
  assert.equal(isValidBranchName(null), false)
})

await test('remoteRepoUrl/compareUrl：scp/https/ssh/坏输入', () => {
  assert.deepEqual(remoteRepoUrl('git@github.com:kkutysllb/dsh-plugins.git'), { host: 'github.com', path: 'kkutysllb/dsh-plugins' })
  assert.deepEqual(remoteRepoUrl('https://github.com/a/b.git'), { host: 'github.com', path: 'a/b' })
  assert.deepEqual(remoteRepoUrl('ssh://git@github.com/a/b'), { host: 'github.com', path: 'a/b' })
  assert.equal(remoteRepoUrl('ftp://x/a/b'), null)
  assert.equal(remoteRepoUrl('git@github.com:solo.git'), null) // 单段不视为 owner/repo
  assert.equal(compareUrl('git@github.com:a/b.git', 'main', 'feat/x'), 'https://github.com/a/b/compare/main...feat/x')
  assert.equal(compareUrl('not a url', 'main', 'b'), null)
  assert.equal(compareUrl('git@github.com:a/b.git', null, 'b'), null)
})

/* ---------------- 集成（真 git 临时仓库） ---------------- */

if (await gitAvailable()) {
  await test('probeWorkspace：真仓库计数与行数增补', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-git-panel-repo-'))
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
    const dir = await mkdtemp(join(tmpdir(), 'dsh-git-panel-norepo-'))
    const s = await probeWorkspace(dir)
    assert.equal(s.isRepo, false)
    assert.equal(s.error, null)
    assert.deepEqual(s.plans, [])
  })

  await test('scanPlans：约定位置/标题提取/上限截断', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-git-panel-plans-'))
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
    const dir = await mkdtemp(join(tmpdir(), 'dsh-git-panel-snap-'))
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
    const dir = await mkdtemp(join(tmpdir(), 'dsh-git-panel-hs-'))
    const s = await handleSnapshot({ cwd: dir }) // 非 git 临时目录 → 良性空态
    assert.equal(s.isRepo, false)
    assert.equal(s.workspace, dir.split('/').filter(Boolean).pop())
  })

  await test('集成：clone 仓库快照扩展字段（branch/root/worktrees/files/ahead）', async () => {
    const base = await mkdtemp(join(tmpdir(), 'dsh-git-panel-origin-'))
    const origin = join(base, 'o.git')
    const src = join(base, 'src')
    await mkdir(src, { recursive: true })
    await execFileP('git', ['init', '-b', 'main'], src)
    await execFileP('git', ['config', 'user.email', 't@t.local'], src)
    await execFileP('git', ['config', 'user.name', 't'], src)
    await writeFile(join(src, 'a.txt'), '1\n')
    await execFileP('git', ['add', '.'], src)
    await execFileP('git', ['commit', '-m', 'init'], src)
    await execFileP('git', ['init', '--bare', '-b', 'main', origin], base)
    await execFileP('git', ['remote', 'add', 'origin', origin], src)
    await execFileP('git', ['push', '-u', 'origin', 'main'], src)
    const repo = join(base, 'clone')
    await execFileP('git', ['clone', origin, repo], base)
    await execFileP('git', ['config', 'user.email', 't@t.local'], repo)
    await execFileP('git', ['config', 'user.name', 't'], repo)
    // 工作区变更：修改 + 新文件
    await writeFile(join(repo, 'a.txt'), '1\n2\n')
    await writeFile(join(repo, 'b.txt'), 'x\n')

    const s = await probeWorkspace(repo)
    assert.equal(s.isRepo, true)
    assert.equal(s.branch, 'main')
    // macOS /var → /private/var 符号链接：git 返回 realpath
    assert.equal(s.root, await realpath(repo))
    assert.equal(s.hasUpstream, true)
    assert.equal(s.ahead, 0)
    assert.equal(s.defaultBranch, 'main') // clone 设 origin/HEAD
    assert.equal(s.worktrees.length, 1)
    assert.equal(s.worktrees[0]?.branch, 'main')
    assert.equal(s.remoteUrl, origin)
    // files：修改 + untracked 两条
    const paths = s.files.map(f => f.path).sort()
    assert.deepEqual(paths, ['a.txt', 'b.txt'])
    const a = s.files.find(f => f.path === 'a.txt')
    assert.deepEqual({ added: a.added, removed: a.removed }, { added: 1, removed: 0 })
    const b = s.files.find(f => f.path === 'b.txt')
    assert.equal(b.untracked, true)
    assert.equal(b.added, null)
  })

  await test('集成：分支/检出/新建/提交/推送 全链路', async () => {
    const base = await mkdtemp(join(tmpdir(), 'dsh-git-panel-flow-'))
    const origin = join(base, 'o.git')
    const src = join(base, 'src')
    await mkdir(src, { recursive: true })
    await execFileP('git', ['init', '-b', 'main'], src)
    await execFileP('git', ['config', 'user.email', 't@t.local'], src)
    await execFileP('git', ['config', 'user.name', 't'], src)
    await writeFile(join(src, 'a.txt'), '1\n')
    await execFileP('git', ['add', '.'], src)
    await execFileP('git', ['commit', '-m', 'init'], src)
    await execFileP('git', ['init', '--bare', '-b', 'main', origin], base)
    await execFileP('git', ['remote', 'add', 'origin', origin], src)
    await execFileP('git', ['push', '-u', 'origin', 'main'], src)

    // branches 清单
    const bl = await handleBranches({ cwd: src })
    assert.equal(bl.ok, true)
    assert.equal(bl.current, 'main')
    assert.deepEqual(bl.branches, ['main'])
    // 非法分支名拒绝
    assert.equal((await handleCheckout({ cwd: src, branch: 'bad name' })).ok, false)
    assert.equal((await handleCreateBranch({ cwd: src, name: '-x' })).ok, false)
    // 新建并检出
    const cb = await handleCreateBranch({ cwd: src, name: 'feature/x' })
    assert.equal(cb.ok, true)
    assert.equal((await handleBranches({ cwd: src })).current, 'feature/x')
    // 切回 main
    assert.equal((await handleCheckout({ cwd: src, branch: 'main' })).ok, true)
    // 提交：空信息拒绝；暂存后成功
    assert.equal((await handleCommit({ cwd: src, message: '  ' })).ok, false)
    await writeFile(join(src, 'c.txt'), 'c\n')
    await execFileP('git', ['add', 'c.txt'], src)
    const cm = await handleCommit({ cwd: src, message: 'add c' })
    assert.equal(cm.ok, true)
    // ahead=1 → push → ahead=0
    const s1 = await probeWorkspace(src)
    assert.equal(s1.ahead, 1)
    assert.equal(s1.branch, 'main')
    assert.equal((await handlePush({ cwd: src })).ok, true)
    const s2 = await probeWorkspace(src)
    assert.equal(s2.ahead, 0)
    // open-compare：本地路径 remote 不可派生 compare URL
    const oc = await handleOpenCompare({ cwd: src })
    assert.equal(oc.ok, false)
    // 无暂存提交：仅 unstaged 变更 → 自动 add -A 后提交
    await writeFile(join(src, 'd.txt'), 'd\n')
    const cm2 = await handleCommit({ cwd: src, message: 'add d' })
    assert.equal(cm2.ok, true)
    const s3 = await probeWorkspace(src)
    assert.equal(s3.ahead, 1)
    assert.equal(s3.untracked, 0) // 自动暂存并入提交
    assert.equal((await handlePush({ cwd: src })).ok, true)
    // 无任何变更拒绝提交
    assert.equal((await handleCommit({ cwd: src, message: 'noop' })).ok, false)
    // 删除分支：非法名/当前分支拒绝；已合并安全删（-d）
    assert.equal((await handleDeleteBranch({ cwd: src, name: '-x' })).ok, false)
    assert.equal((await handleDeleteBranch({ cwd: src, name: 'main' })).ok, false)
    assert.equal((await handleDeleteBranch({ cwd: src, name: 'feature/x' })).ok, true)
    assert.deepEqual((await handleBranches({ cwd: src })).branches, ['main'])
    // 未合并分支：-d 拒绝并带 merged 标记，force 走 -D
    await handleCreateBranch({ cwd: src, name: 'wip' })
    await writeFile(join(src, 'w.txt'), 'w\n')
    assert.equal((await handleCommit({ cwd: src, message: 'wip' })).ok, true)
    assert.equal((await handleCheckout({ cwd: src, branch: 'main' })).ok, true)
    const dw = await handleDeleteBranch({ cwd: src, name: 'wip' })
    assert.equal(dw.ok, false)
    assert.equal(dw.merged, true)
    assert.equal((await handleDeleteBranch({ cwd: src, name: 'wip', force: true })).ok, true)
    assert.deepEqual((await handleBranches({ cwd: src })).branches, ['main'])
  })
} else {
  skipped = 7
  console.log('SKIP git 集成用例 ×7（git 不可用）')
}

/* ---------------- 汇总 ---------------- */

console.log(`\n${pass} pass, ${fail} fail, ${skipped} skipped`)
if (failures.length > 0) {
  console.log('\n失败清单:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log('ALL PASS')
