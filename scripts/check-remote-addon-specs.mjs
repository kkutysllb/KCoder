#!/usr/bin/env node
/**
 * 远端目标平台判据断言 —— `plans/remote-arch-adaptation.md` 阶段 1 的落点。
 *
 * ## 为什么需要它
 *
 * 2026-10-01 事故：`localAddonSpecs` 把原生包命名族**写死成 `-linux-x64`**，
 * aarch64 目标机上 npm 以 `EBADPLATFORM` 整单拒绝；而安装脚本既不 `set -e` 也不
 * 查退出码，末尾无条件 `echo ADDONS_OK`，于是失败被判成功、指纹照写 → 远端起不来
 * 且状态永久粘滞。判据本身没有回归覆盖，是这次事故能一路走到「等满 180 秒超时」
 * 的原因之一。
 *
 * 本脚本把判据钉住，三层：
 *   A. 纯函数层（hermetic）：三元组规范化、拒绝分支、命名族、覆盖度；
 *   B. fixture 层（hermetic）：在一棵构造出来的最小依赖树上跑派生，断言两个目标
 *      各得到**恰好**那 7 条；
 *   C. 真实树层（有则跑）：与**旧实现的实机输出**逐条比对（零回归证明），并要求
 *      两个目标的结果互不串台。
 *
 * 导入的是 `desktop/main/remote-target.ts` 本尊（Node ≥22.18 原生类型擦除），
 * 不是它的副本——判据只有一份。
 *
 * ## 用法
 *
 *   node scripts/check-remote-addon-specs.mjs                 # 自动找树，找不到只跑 A/B
 *   node scripts/check-remote-addon-specs.mjs --runtime <dir> # 指定 runtime 目录
 *
 * 退出码：0 = 全过；1 = 有断言失败。
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const {
  localAddonSpecs,
  matchesAddonTarget,
  missingRequiredAddons,
  parseTarget,
  requiredAddonNames,
  targetLabel,
} = await import(new URL('../desktop/main/remote-target.ts', import.meta.url).href)

const X64 = { os: 'linux', cpu: 'x64', libc: 'gnu' }
const ARM64 = { os: 'linux', cpu: 'arm64', libc: 'gnu' }

/**
 * T1：**旧实现**在一棵真实 runtime 树上的实际输出（远端 `addon-specs.txt` 原件，
 * 2026-10-01 取自 74推理）。只比名字不比版本——版本随引擎升级而变，名字族才是判据。
 */
const T1_NAMES = [
  '@deepseek-ai/node-addon-system-linux-x64',
  '@img/sharp-libvips-linux-x64',
  '@img/sharp-linux-x64',
  '@koromix/koffi-linux-x64',
  '@vscode/ripgrep-linux-x64',
  'node-addon-require-builtin-linux-x64-gnu',
  'sherpa-onnx-linux-x64',
].sort()

/** T2：同一棵树在 arm64 目标下应当得到的清单 = T1 换命名族（2026-10-01 实机验证过可安装并跑通）。 */
const T2_NAMES = T1_NAMES.map(name => name.replace('-linux-x64', '-linux-arm64')).sort()

const namesOf = (specs) => specs.map((spec) => {
  const at = spec.lastIndexOf('@')
  return at > 0 ? spec.slice(0, at) : spec
}).sort()
const same = (a, b) => a.length === b.length && a.every((item, index) => item === b[index])

let failed = 0
let passed = 0
const section = (title) => console.log(`\n${title}`)
const check = (label, condition, detail) => {
  if (condition) { passed++; console.log(`  ✅ ${label}`); return }
  failed++
  console.log(`  ❌ ${label}`)
  if (detail !== undefined) console.log(`     ${detail}`)
}
const throws = (fn) => {
  try { fn(); return null } catch (error) { return error }
}

// ─────────────────────────── A. 纯函数层 ───────────────────────────

section('A. 三元组规范化')
check('Linux/x86_64/gnu → linux-x64/gnu', same([targetLabel(parseTarget('Linux', 'x86_64', 'gnu'))], ['linux-x64/gnu']))
check('Linux/aarch64/gnu → linux-arm64/gnu', same([targetLabel(parseTarget('Linux', 'aarch64', 'gnu'))], ['linux-arm64/gnu']))
check('别名（amd64 / arm64）与空白都能收敛', same([targetLabel(parseTarget(' Linux ', ' arm64 ', ' gnu '))], ['linux-arm64/gnu']))

section('B. 拒绝分支（**不认识就抛错，绝不退化成空清单** —— 原始事故正是「静默装 0 个包」）')
const darwin = throws(() => parseTarget('Darwin', 'arm64', 'gnu'))
check('macOS 远端被拒且说明原因', darwin !== null && /macOS/.test(darwin.message), String(darwin))
const musl = throws(() => parseTarget('Linux', 'aarch64', 'musl'))
check('musl 远端被拒且说明原因', musl !== null && /musl/.test(musl.message), String(musl))
const unknownArch = throws(() => parseTarget('Linux', 'ppc64le', 'gnu'))
check('未知架构被拒', unknownArch !== null && /架构/.test(unknownArch.message), String(unknownArch))
const unknownOs = throws(() => parseTarget('FreeBSD', 'x86_64', 'gnu'))
check('未知系统被拒', unknownOs !== null, String(unknownOs))

section('C. 命名族（两个方向都要对：该命中的命中，不该命中的绝不能命中）')
check('@koromix/koffi-linux-arm64 命中 arm64', matchesAddonTarget('@koromix/koffi-linux-arm64', ARM64) === true)
check('…-linux-arm64-gnu 命中 arm64', matchesAddonTarget('node-addon-require-builtin-linux-arm64-gnu', ARM64) === true)
check('x64 的包**不**命中 arm64 目标', matchesAddonTarget('node-addon-require-builtin-linux-x64-gnu', ARM64) === false)
check('arm64 的包**不**命中 x64 目标', matchesAddonTarget('@koromix/koffi-linux-arm64', X64) === false)
check('musl 命名族不落进 gnu 目标', matchesAddonTarget('@img/sharp-linuxmusl-arm64', ARM64) === false)

section('D. 覆盖度断言（缺必需包必须能被发现）')
check('arm64 必需包名单', same([...requiredAddonNames(ARM64)], [
  'node-addon-require-builtin-linux-arm64-gnu',
  '@deepseek-ai/node-addon-system-linux-arm64',
]))
check('清单完整时无缺失', missingRequiredAddons(T2_NAMES.map(n => `${n}@1.0.0`), ARM64).length === 0)
const gap = missingRequiredAddons(
  T2_NAMES.filter(n => !n.startsWith('node-addon-require-builtin')).map(n => `${n}@1.0.0`),
  ARM64,
)
check('缺 require-builtin 时精确报出它', same([...gap], ['node-addon-require-builtin-linux-arm64-gnu']), JSON.stringify(gap))

// ─────────────────────────── E. fixture 层 ───────────────────────────

/** 构造一棵最小依赖树：声明面按 2026-10-01 实测的真实形状抄写（含 musl/darwin 干扰项）。 */
function buildFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'kcoder-addon-specs-'))
  const write = (name, pkg) => {
    const file = join(dir, 'node_modules', name, 'package.json')
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify({ name, ...pkg }, null, 2)}\n`)
  }
  write('node-addon-require-builtin', {
    version: '0.1.6',
    optionalDependencies: {
      'node-addon-require-builtin-darwin-arm64': '0.1.6',
      'node-addon-require-builtin-linux-arm64-gnu': '0.1.6',
      'node-addon-require-builtin-linux-x64-gnu': '0.1.6',
      'node-addon-require-builtin-win32-x64-msvc': '0.1.6',
    },
  })
  write('sharp', {
    version: '0.35.3',
    optionalDependencies: {
      '@img/sharp-linux-x64': '0.35.3',
      '@img/sharp-linux-arm64': '0.35.3',
      '@img/sharp-linuxmusl-x64': '0.35.3',
      '@img/sharp-linuxmusl-arm64': '0.35.3',
      '@img/sharp-darwin-arm64': '0.35.3',
    },
  })
  write('@img/sharp-linux-x64', { version: '0.35.3', optionalDependencies: { '@img/sharp-libvips-linux-x64': '1.3.2' } })
  write('@img/sharp-linux-arm64', { version: '0.35.3', optionalDependencies: { '@img/sharp-libvips-linux-arm64': '1.3.2' } })
  write('koffi', {
    version: '3.1.1',
    optionalDependencies: {
      '@koromix/koffi-linux-x64': '3.1.1',
      '@koromix/koffi-linux-arm64': '3.1.1',
      '@koromix/koffi-darwin-arm64': '3.1.1',
    },
  })
  write('sherpa-onnx-node', {
    version: '1.13.8',
    optionalDependencies: { 'sherpa-onnx-linux-x64': '^1.13.8', 'sherpa-onnx-linux-arm64': '^1.13.8' },
  })
  write('@vscode/ripgrep', {
    version: '1.18.0',
    optionalDependencies: { '@vscode/ripgrep-linux-x64': '1.18.0', '@vscode/ripgrep-linux-arm64': '1.18.0' },
  })
  // workspace: 协议要能回落到本地实体版本——这正是 arm64 需要的那条路径。
  write('@deepseek-ai/node-addon-system', {
    version: '0.1.2',
    optionalDependencies: {
      '@deepseek-ai/node-addon-system-linux-x64': 'workspace:~',
      '@deepseek-ai/node-addon-system-linux-arm64': 'workspace:~',
      '@deepseek-ai/node-addon-system-darwin-arm64': 'workspace:~',
    },
  })
  write('@deepseek-ai/node-addon-system-linux-x64', { version: '0.1.2' })
  write('@deepseek-ai/node-addon-system-linux-arm64', { version: '0.1.2' })
  return dir
}

section('E. fixture 树（hermetic：CI / 干净克隆也能跑）')
const fixture = buildFixture()
try {
  const fixtureX64 = namesOf(localAddonSpecs(fixture, X64))
  const fixtureArm = namesOf(localAddonSpecs(fixture, ARM64))
  check('fixture × x64 = 那 7 条', same(fixtureX64, T1_NAMES), `got ${JSON.stringify(fixtureX64)}`)
  check('fixture × arm64 = 那 7 条（换命名族）', same(fixtureArm, T2_NAMES), `got ${JSON.stringify(fixtureArm)}`)
  check('fixture 下 x64 结果不含 arm64 包', !fixtureX64.some(n => n.includes('-linux-arm64')))
  check('fixture 下 arm64 结果不含 x64 包', !fixtureArm.some(n => n.includes('-linux-x64')))
  check('fixture 下 workspace: 版本回落生效', localAddonSpecs(fixture, ARM64).includes('@deepseek-ai/node-addon-system-linux-arm64@0.1.2'))
} finally {
  rmSync(fixture, { recursive: true, force: true })
}

// ─────────────────────────── C. 真实树层 ───────────────────────────

const explicit = process.argv.indexOf('--runtime')
const findTree = () => {
  const candidates = explicit >= 0
    ? [process.argv[explicit + 1] ?? '']
    : [join(ROOT, 'staging', 'kcoder-runtime'), join(homedir(), 'Library', 'Application Support', 'KCoder', 'kcoder-runtime')]
  return candidates.find(dir => dir !== '' && existsSync(join(dir, 'node_modules'))) ?? null
}
const tree = findTree()

if (tree === null) {
  console.log('\nF. 真实树 —— 跳过（没找到 staging/kcoder-runtime 或已装 App 的 runtime；用 --runtime <dir> 指定）')
} else {
  section(`F. 真实树 —— ${tree}`)
  const treeX64 = namesOf(localAddonSpecs(tree, X64))
  const treeArm = namesOf(localAddonSpecs(tree, ARM64))
  // 零回归：与**旧实现的实机输出**逐条相等（不是与另一份实现比）。
  check('x64 目标 = 旧实现的实际输出（零回归）', same(treeX64, T1_NAMES), `got ${JSON.stringify(treeX64)}`)
  check('arm64 目标 = 同一棵树换命名族', same(treeArm, T2_NAMES), `got ${JSON.stringify(treeArm)}`)
  check('x64 结果不含 arm64 包', !treeX64.some(n => n.includes('-linux-arm64')))
  check('arm64 结果不含 x64 包', !treeArm.some(n => n.includes('-linux-x64')))
  check('arm64 覆盖度完整', missingRequiredAddons(localAddonSpecs(tree, ARM64), ARM64).length === 0)
}

console.log(`\n${failed === 0 ? '✅' : '❌'} 共 ${String(passed)} 项通过、${String(failed)} 项失败`)
process.exit(failed === 0 ? 0 : 1)
