/**
 * profile 清单**自愈判据**冒烟（F27 / F28 的常备门）。
 *
 * 为什么需要这一条：`ensureKcoderBundles()` 每次启动都会改写用户的
 * `profiles/web/package.json`（清退役 / 清孤儿 / 摘陈旧 deps）。它的判据对
 * **版本与名单**敏感，而这两样都会随上游升级平移 —— 改错的表现不是崩溃，而是
 * **静默**：用户已开启的能力消失、或依赖图被拆掉（后续任何 pnpm 操作把实体当
 * extraneous 剪掉）。同一类 bug（宿主名单必须跟随上游名单同步）在本轮升级里
 * 咬了三次：
 *
 * | 编号 | 现象 | 判据错在哪 |
 * |---|---|---|
 * | F26 | 退役清理不触发 pnpm 收敛 ⇒ 旧版 schedule/time-context 被 peer 禁用 | 清理命中未参与 needInstall |
 * | F27 | `dsh-coding-sidebar` 的 deps 声明被误摘（它恰是唯一一条预置声明） | 借 `registryNewer(live > shipped)` 兼作「牵引例外」；S2.2 把随包版本对齐后判据翻为 false |
 * | F28 | 上游 `OPTIONAL_BUNDLES` 成员被当孤儿删掉 | `managed` 不含上游可选集 |
 *
 * 三者都不是崩溃、都不打日志以外的信号、静态分析也看不见 —— 只有真跑一次
 * `ensureKcoderBundles()` 并断言 manifest 终态才抓得住。本脚本就是那一次真跑。
 *
 * 与一次性夹具的区别：F27/F28 当初是在 `staging/`（gitignored）用临时夹具证的，
 * 那只能证明「当时修好了」，不能防未来回归。这里把它升格为常备门，并把
 * **上游名单漂移**也一并钉住（我们的常量 vs 上游 `app-boot/profile.ts`）。
 *
 * 隔离：**每次全新临时 DSH_HOME**，显式 `env -u DSH_HOME` 之外仍在脚本内强制
 * 覆盖（本机 shell 环境带生产 `DSH_HOME` 是已知事实，见计划 Errors）——
 * 断言里有一条自检，若 DSH_HOME 不是我们建的临时目录就直接判失败。
 *
 * 运行：pnpm run smoke:bundle-profile
 * （等价 `node scripts/smoke-bundle-profile.mjs`，纯 node，不需要 Electron）
 *
 * 负对照（证明本门真能红）：`KCODER_BUNDLE_SRC=<另一份 desktop/main 的副本>
 * kcoder-skills-bundle.ts 路径>`。指向副本时**整个目录**应一并复制，相对
 * import 才解析得上；产品树无需改动。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const MAIN_DIR = join(ROOT, 'desktop/main')

/** 被测源码（负对照可指到整目录副本）。 */
const BUNDLE_SRC = process.env.KCODER_BUNDLE_SRC ?? join(MAIN_DIR, 'kcoder-skills-bundle.ts')

/** 上游 `app-boot` 的可选集真源（漂移检查用；不在位时该条跳过并**打印原因**）。 */
const UPSTREAM_PROFILE_TS = [
  process.env.KCODER_UPSTREAM_DIR,
  '/Users/libing/kk_Projects/deepseek-harness',
].filter((x) => typeof x === 'string' && x !== '')
  .map((dir) => join(dir, 'packages/boot/app-boot/src/profile.ts'))
  .find((p) => existsSync(p))

// ---- 0. 隔离：先把 DSH_HOME 抢到临时目录，**再**加载被测模块 ----
const home = mkdtempSync(join(tmpdir(), 'smoke-bundle-profile-'))
process.env.DSH_HOME = home
const profileDir = join(home, 'profiles', 'web')
mkdirSync(join(profileDir, 'node_modules', 'dsh-coding-sidebar'), { recursive: true })

const fails = []
let total = 0
const check = (ok, message) => { total += 1; if (!ok) fails.push(message) }
const checkEq = (actual, expected, message) => {
  check(actual === expected, `${message}（实际 ${JSON.stringify(actual)}，应为 ${JSON.stringify(expected)}）`)
}
/** 数组/对象比较（`checkEq` 是 `===`，比数组永远为 false —— 本脚本首跑即栽在这）。 */
const checkDeep = (actual, expected, message) => {
  check(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message}（实际 ${JSON.stringify(actual)}，应为 ${JSON.stringify(expected)}）`,
  )
}

// ---- 1. 源码常量（静态面）：从 TS 文本抽数组，不 import（它未导出） ----
const srcText = readFileSync(BUNDLE_SRC, 'utf8')
// 包名常量（源码里 `tractionDeps` 用的是 `DSH_CODING_SIDEBAR` 而非字面量，
// 只抽引号会抽空 —— 本脚本首跑即栽在这）。
const consts = Object.fromEntries(
  [...srcText.matchAll(/export const (DSH_[A-Z_]+) = '([^']+)'/g)].map((m) => [m[1], m[2]]),
)
const declaredOptional = [...(/const UPSTREAM_OPTIONAL_BUNDLES = \[([\s\S]*?)\]/.exec(srcText)?.[1] ?? '')
  .matchAll(/'([^']+)'/g)].map((m) => m[1])
const declaredTraction = [...(/const tractionDeps = new Set<string>\(\[([\s\S]*?)\]\)/.exec(srcText)?.[1] ?? '')
  .matchAll(/'([^']+)'|([A-Z][A-Z0-9_]+)/g)].map((m) => m[1] ?? consts[m[2]]).filter(Boolean)
check(declaredOptional.length > 0, '源码未抽到 UPSTREAM_OPTIONAL_BUNDLES（判据或常量被改名？本脚本需同步）')
check(declaredTraction.includes('dsh-coding-sidebar'), '源码未把 dsh-coding-sidebar 列入牵引白名单')

// ---- 2. 种子 profile：与 S4 真机同形 ----
// sidebar 声明在 deps（牵引）、实体版本 == 随包版本（正是让旧判据翻 false 的条件）；
// 上游可选组合包已由用户开启（在 bundles、**不在** deps —— 这是 F28 的触发态）。
const OPTIONAL = declaredOptional.length > 0
  ? declaredOptional
  : [
      '@deepseek-ai/dsh-experimental-agent-team-profile',
      '@deepseek-ai/dsh-experimental-voice-input-bundle',
    ]
const BUILTINS = ['dsh-skills-bundle', '@kkutysllb/dsh-terminal', 'dsh-shell-prefs', 'dsh-coding-sidebar', 'dsh-ssh-remote']
const TEMPLATE = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
const SEED_DEPS = { 'dsh-coding-sidebar': '^1.0.38' }
writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
  name: 'dsh-profile-web',
  private: true,
  dependencies: { ...SEED_DEPS },
  dsh: { profile: { bundles: [...TEMPLATE, ...BUILTINS, ...OPTIONAL] } },
}, undefined, 2) + '\n')
writeFileSync(
  join(profileDir, 'node_modules', 'dsh-coding-sidebar', 'package.json'),
  JSON.stringify({ name: 'dsh-coding-sidebar', version: '1.0.38' }, undefined, 2) + '\n',
)

// ---- 3. 编译并加载**真实**模块（电子的最小替身，不重敲源码） ----
/**
 * 解析 esbuild：本仓未声明该依赖，它由 vite 带进 pnpm store。
 * 解析不到即**显式失败** —— 静默跳过等于这条门消失（同姊妹脚本）。
 */
function loadEsbuild() {
  const req = createRequire(import.meta.url)
  const searchPaths = [join(ROOT, 'node_modules/.pnpm/node_modules'), join(ROOT, 'node_modules')]
  return req(req.resolve('esbuild', { paths: searchPaths }))
}

const workdir = mkdtempSync(join(tmpdir(), 'smoke-bundle-profile-build-'))
const bundle = join(workdir, 'kcoder-skills-bundle.cjs')
// 电子替身：只覆盖被测模块链真正访问到的成员（dsh-contract 的 app.getPath）。
// 走 esbuild 的 `alias`（构建选项）而非插件 —— `buildSync` 不支持插件。
const stub = join(workdir, 'stub-electron.cjs')
writeFileSync(stub, [
  "const os = require('node:os')",
  'module.exports = { app: { isPackaged: false, getPath: () => os.homedir(), setPath: () => {} } }',
  '',
].join('\n'))

let ensureKcoderBundles
try {
  const { buildSync } = loadEsbuild()
  buildSync({
    entryPoints: [BUNDLE_SRC],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    // `__dirname` 钉成真实的 desktop/main：dsh-contract 用它推 PROJECT_ROOT，
    // 落到临时目录会一路回落到 Electron.app 的 Resources 而找不到 bundle/ 源。
    define: { __dirname: JSON.stringify(dirname(BUNDLE_SRC)) },
    alias: { electron: stub },
    logLevel: 'silent',
  })
  ;({ ensureKcoderBundles } = createRequire(import.meta.url)(bundle))
  check(typeof ensureKcoderBundles === 'function', '编译产物未导出 ensureKcoderBundles')
} catch (err) {
  check(false, `编译/加载 ${BUNDLE_SRC} 失败：${err instanceof Error ? err.message : String(err)}`)
}

// ---- 4. 真跑一次自愈，读终态 ----
const readManifest = () => JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
if (typeof ensureKcoderBundles === 'function') {
  // 隔离自检：跑真代码之前先确认真 home 没被指到（本机 shell 带生产 DSH_HOME）。
  checkEq(home.startsWith(tmpdir()) && !home.startsWith(homedir()), true, '临时 DSH_HOME 未生效（可能误伤真 home，立即中止判据）')
  try {
    ensureKcoderBundles()
  } catch (err) {
    check(false, `ensureKcoderBundles() 抛错：${err instanceof Error ? err.message : String(err)}`)
  }
  const first = readManifest()
  const deps = first.dependencies ?? {}
  const bundles = first.dsh?.profile?.bundles ?? []

  // F27：牵引包的 deps 声明**无条件**保留（判据不看版本）。
  check('dsh-coding-sidebar' in deps, `F27 牵引包 deps 声明被摘（deps=${JSON.stringify(deps)}）`)
  // F28：上游可选组合包不得被当孤儿摘除。
  for (const pkg of OPTIONAL) check(bundles.includes(pkg), `F28 上游可选组合包被当孤儿摘除：${pkg}`)
  // 内置五件 + 模板层仍须在册（防止自愈把正常项一起吃掉）。
  for (const pkg of BUILTINS) check(bundles.includes(pkg), `内置 bundle 被摘：${pkg}`)
  for (const pkg of TEMPLATE) check(bundles.includes(pkg), `模板层被摘：${pkg}`)

  // 幂等：第二次调用后终态逐字节不变（自愈不得反复改档）。
  if (typeof ensureKcoderBundles === 'function') {
    try {
      ensureKcoderBundles()
      checkEq(readFileSync(join(profileDir, 'package.json'), 'utf8'), JSON.stringify(first, undefined, 2) + '\n', 'F27/F28 自愈不幂等（第二次调用改动了 manifest）')
    } catch (err) {
      check(false, `第二次 ensureKcoderBundles() 抛错：${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

// ---- 5. 名单漂移（我们的常量 vs 上游 app-boot） ----
if (UPSTREAM_PROFILE_TS !== undefined) {
  const upstream = [...(/export const OPTIONAL_BUNDLES: readonly string\[\] = \[([\s\S]*?)\]/
    .exec(readFileSync(UPSTREAM_PROFILE_TS, 'utf8'))?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1])
  check(upstream.length > 0, `上游 OPTIONAL_BUNDLES 抽取失败：${UPSTREAM_PROFILE_TS}`)
  checkDeep([...declaredOptional].sort(), [...upstream].sort(), `本地镜像与上游可选集漂移（上游 ${UPSTREAM_PROFILE_TS}）`)
} else {
  console.error('[skip] 未找到上游 app-boot/profile.ts（KCODER_UPSTREAM_DIR 或默认路径），本轮跳过名单漂移检查')
}

// ---- 6. 结论（成功即清理，失败保留现场供排查） ----
const ok = fails.length === 0
if (ok) {
  for (const dir of [home, workdir]) rmSync(dir, { recursive: true, force: true })
} else {
  console.error(`[keep] 现场保留：DSH_HOME=${home} build=${workdir}`)
}
process.stdout.write(ok
  ? `PASS ${String(total)}/${String(total)}（真 ensureKcoderBundles：F27 牵引保留 + F28 可选集不判孤儿 + 内置/模板在册 + 幂等${UPSTREAM_PROFILE_TS !== undefined ? ' + 上游名单无漂移' : ''}）\n`
  : `FAIL ${String(total - fails.length)}/${String(total)}:\n${fails.map((f) => '  - ' + f).join('\n')}\n`)
process.exitCode = ok ? 0 : 1
