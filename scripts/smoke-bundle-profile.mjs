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
 * | F27 | `dsh-coding-sidebar` 的 deps 声明被误摘 → **2026-10-09 该插件整线退役，例外随之撤销** | 当时借 `registryNewer(live > shipped)` 兼作「牵引例外」（S2.2 把随包版本对齐后判据翻为 false）；退役后本门改钉**反向不变量**——退役包的三处残留必须全清 |
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
import { dirname, join, resolve, sep } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const MAIN_DIR = join(ROOT, 'desktop/main')

/** 被测源码（负对照可指到整目录副本）。 */
const BUNDLE_SRC = process.env.KCODER_BUNDLE_SRC ?? join(MAIN_DIR, 'kcoder-skills-bundle.ts')

/**
 * 上游 `app-boot` 的可选集真源（漂移检查用；不在位时该条跳过并**打印原因**）。
 * 解析链与 desktop/main/dsh-contract.ts 对齐：环境变量 > 仓内指针 `.upstream-dir`
 * （由 scripts/setup.sh 落盘）> 历史默认。2026-10-10：只认前两者时，pointer-only
 * 的机器上 `pnpm run check` 会静默跳过漂移检查（37/37 而非 39/39）。
 */
const UPSTREAM_DIR_POINTER = join(ROOT, '.upstream-dir')
let pointerDir = ''
try {
  pointerDir = readFileSync(UPSTREAM_DIR_POINTER, 'utf8').trim()
} catch {
  /* 指针缺失即回退下一档 */
}
const UPSTREAM_PROFILE_TS = [
  process.env.KCODER_UPSTREAM_DIR,
  pointerDir,
  '/Users/libing/kk_Projects/deepseek-harness',
].filter((x) => typeof x === 'string' && x !== '')
  .map((dir) => join(dir, 'packages/boot/app-boot/src/profile.ts'))
  .find((p) => existsSync(p))

// ---- 0. 隔离：先把 DSH_HOME 抢到临时目录，**再**加载被测模块 ----
const home = mkdtempSync(join(tmpdir(), 'smoke-bundle-profile-'))
process.env.DSH_HOME = home
const profileDir = join(home, 'profiles', 'web')
mkdirSync(join(profileDir, 'node_modules', 'dsh-coding-sidebar'), { recursive: true })
// 作用域包的实体同样要有（退役清理的 scope 父目录路径与无 scope 包不同）
mkdirSync(join(profileDir, 'node_modules', '@kkutysllb', 'dsh-terminal'), { recursive: true })

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
const declaredOptional = [...(/const UPSTREAM_OPTIONAL_BUNDLES = \[([\s\S]*?)\]/.exec(srcText)?.[1] ?? '')
  .matchAll(/'([^']+)'/g)].map((m) => m[1])
// 退役名单（`RETIRED_PLUGINS`，未导出 ⇒ 只抽引号）。判据是「源码真的把该包
// 当退役货」，不是脚本自己写死的常量——写死就测不出名单被误删。
const declaredRetired = [...(/const RETIRED_PLUGINS = \[([\s\S]*?)\n\]/.exec(srcText)?.[1] ?? '')
  .matchAll(/'([^']+)'/g)].map((m) => m[1])
check(declaredOptional.length > 0, '源码未抽到 UPSTREAM_OPTIONAL_BUNDLES（判据或常量被改名？本脚本需同步）')
for (const name of ['dsh-coding-sidebar', '@kkutysllb/dsh-terminal']) {
  check(
    declaredRetired.includes(name),
    `源码未把 ${name} 列入 RETIRED_PLUGINS（退役判据或常量被改名？本脚本需同步）`,
  )
}

// ---- 2. 种子 profile：与真机同形（退役残留 + 上游可选集开启） ----
// 两个触发态：① 退役的 dsh-coding-sidebar 三处残留俱全（deps 声明 + bundles
// 层叠 + node_modules 实体）——退役自愈必须三清干净；② 上游可选组合包已由用户
// 开启（在 bundles、**不在** deps —— 这是 F28 的触发态，不得被当孤儿摘除）。
const OPTIONAL = declaredOptional.length > 0
  ? declaredOptional
  : [
      '@deepseek-ai/dsh-experimental-agent-team-profile',
      '@deepseek-ai/dsh-experimental-voice-input-bundle',
    ]
const BUILTINS = ['dsh-skills-bundle', 'dsh-shell-prefs', 'dsh-ssh-remote']
const TEMPLATE = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
/**
 * 退役种子（三处残留俱全，断言「清干净」）：无 scope 与作用域包各一条——
 * `dsh-coding-sidebar`（2026-10-09 退役，曾挂在 PRESET 声明上）与
 * `@kkutysllb/dsh-terminal`（2026-10-09 退役，作用域包 ⇒ 走 scope 父目录清理路径）。
 */
const RETIRED_SEED = 'dsh-coding-sidebar'
const RETIRED_SEED_SCOPED = '@kkutysllb/dsh-terminal'
const RETIRED_SEEDS = [RETIRED_SEED, RETIRED_SEED_SCOPED]
const SEED_DEPS = { [RETIRED_SEED]: '^1.0.40', [RETIRED_SEED_SCOPED]: '^1.3.0' }
writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
  name: 'dsh-profile-web',
  private: true,
  dependencies: { ...SEED_DEPS },
  dsh: { profile: { bundles: [...TEMPLATE, ...BUILTINS, ...RETIRED_SEEDS, ...OPTIONAL] } },
}, undefined, 2) + '\n')
writeFileSync(
  join(profileDir, 'node_modules', RETIRED_SEED, 'package.json'),
  JSON.stringify({ name: RETIRED_SEED, version: '1.0.40' }, undefined, 2) + '\n',
)
writeFileSync(
  join(profileDir, 'node_modules', RETIRED_SEED_SCOPED, 'package.json'),
  JSON.stringify({ name: RETIRED_SEED_SCOPED, version: '1.3.0' }, undefined, 2) + '\n',
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
  // 判据只认「真 home 的已知落点」，**不能**用 `!home.startsWith(homedir())`——
  // Windows 的 TEMP 就在用户主目录里（C:\Users\X\AppData\Local\Temp），那样恒假
  // （2026-10-08 本机踩到：24/25，唯一那条红就是它）。
  const realHomes = ['.dsh', '.kcoder', '.kcoder-dev'].map((name) => join(homedir(), name))
  const pointedAtRealHome = realHomes.some((h) => home === h || home.startsWith(h + sep))
  checkEq(home.startsWith(tmpdir()) && !pointedAtRealHome, true, '临时 DSH_HOME 未生效（可能误伤真 home，立即中止判据）')
  try {
    ensureKcoderBundles()
  } catch (err) {
    check(false, `ensureKcoderBundles() 抛错：${err instanceof Error ? err.message : String(err)}`)
  }
  const first = readManifest()
  const deps = first.dependencies ?? {}
  const bundles = first.dsh?.profile?.bundles ?? []

  // F27（退役态）：退役包的三处残留必须**全清**——deps 声明、bundles 层叠、
  // node_modules 实体。它曾以「牵引例外」形态被无条件保留（判据不看版本）；
  // 例外随 2026-10-09 的整线退役撤销，本门改钉反向不变量。
  for (const pkg of RETIRED_SEEDS) {
    check(!(pkg in deps), `F27 退役包的 deps 声明未清：${pkg}（deps=${JSON.stringify(deps)}）`)
    check(!bundles.includes(pkg), `F27 退役包仍在 bundles 层叠：${pkg}（bundles=${JSON.stringify(bundles)}）`)
    check(!existsSync(join(profileDir, 'node_modules', pkg)), `F27 退役包实体未删除：${pkg}`)
  }
  // F28：上游可选组合包不得被当孤儿摘除。
  for (const pkg of OPTIONAL) check(bundles.includes(pkg), `F28 上游可选组合包被当孤儿摘除：${pkg}`)
  // 内置四件 + 模板层仍须在册（防止自愈把正常项一起吃掉）。
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

// ---- 4.5 F29：「默认选中实验性组合包」必须**声明跟随实态**（2026-10-09 决策）
// 上游可选集全表随 KCoder 发版并默认选中；但只有**引擎解析树里真有**的才写进
// bundles——声明了却解析不到 = profile 组成期直接失败（旧 runtime 上写新名单就是
// 这个后果）。判据必须双向量：夹具里有的必须被声明，夹具里没有的**不得**被声明。
// KCODER_RUNTIME_DIR 是排他覆盖（只认它），夹具才测得出两侧行为。
if (typeof ensureKcoderBundles === 'function') {
  const home2 = mkdtempSync(join(tmpdir(), 'smoke-bundle-profile-rt-'))
  const profileDir2 = join(home2, 'profiles', 'web')
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'smoke-runtime-fixture-'))
  mkdirSync(profileDir2, { recursive: true })
  const PRESENT = declaredOptional.slice(0, 2)
  const ABSENT = declaredOptional[declaredOptional.length - 1]
  for (const pkg of PRESENT) {
    mkdirSync(join(fixtureRoot, 'node_modules', pkg), { recursive: true })
    writeFileSync(join(fixtureRoot, 'node_modules', pkg, 'package.json'), JSON.stringify({ name: pkg, version: '0.0.0-fixture' }))
  }
  writeFileSync(join(profileDir2, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: [...TEMPLATE, ...BUILTINS] } },
  }, undefined, 2) + '\n')
  process.env.DSH_HOME = home2
  process.env.KCODER_RUNTIME_DIR = fixtureRoot
  try {
    ensureKcoderBundles()
    const manifest2 = JSON.parse(readFileSync(join(profileDir2, 'package.json'), 'utf8'))
    const bundles2 = manifest2.dsh?.profile?.bundles ?? []
    for (const pkg of PRESENT) check(bundles2.includes(pkg), `F29 实态在位的实验性组合包未被默认选中：${pkg}`)
    check(!bundles2.includes(ABSENT), `F29 实态不在位的实验性组合包被声明：${ABSENT}（声明未跟随实态 ⇒ 旧 runtime 上会启动失败）`)
  } catch (err) {
    check(false, `F29 ensureKcoderBundles() 抛错：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    delete process.env.KCODER_RUNTIME_DIR
    process.env.DSH_HOME = home
    rmSync(home2, { recursive: true, force: true })
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
}

// ---- 5. 退役的非编码技能不得回流（2026-10-05） ----
// 六个非编码内置技能（多媒体生成 + 漫画 + 深度研究）已从注册面退役，配套的
// 「多媒体模型」分区与 media-models.env 注入同批移除。判据落在**物化后的**
// manifest 与磁盘：注册清单不得再出现这些名字，且物化目录里也不得残留。
// 为什么需要这道门：`scripts/adapt-kskills.mjs`（历史批生成器）曾把
// `...MEDIA_SKILLS, ...RESEARCH_SKILLS` 展开进 MANIFEST_ORDER，一次重跑就会
// 把它们写回 bundle —— 而那正是「改了却没人发现」的那类静默回流。
const RETIRED_NONCODING_SKILLS = [
  'image-generation', 'video-generation', 'music-generation',
  'podcast-generation', 'comic', 'deep-research',
]
{
  const skillsRoot = join(profileDir, 'node_modules', 'dsh-skills-bundle', 'skills')
  const manifestPath = join(skillsRoot, 'manifest.json')
  let names = []
  try {
    names = (JSON.parse(readFileSync(manifestPath, 'utf8')).skills ?? []).map((s) => s.name)
  } catch (err) {
    check(false, `物化后的内置技能清单不可读：${manifestPath}（${err instanceof Error ? err.message : String(err)}）`)
  }
  if (names.length > 0) {
    const back = RETIRED_NONCODING_SKILLS.filter((n) => names.includes(n))
    check(back.length === 0, `退役的非编码技能回流注册面：${back.join('、')}`)
    // 反向：现役方法论批仍在（防止「删多了」）
    for (const n of ['planning-with-files', 'test-driven-development', 'typescript', 'release-engineering']) {
      check(names.includes(n), `现役方法论技能缺失：${n}`)
    }
    const stillOnDisk = RETIRED_NONCODING_SKILLS.filter((n) => existsSync(join(skillsRoot, n)))
    check(stillOnDisk.length === 0, `退役技能的目录残留在物化树里：${stillOnDisk.join('、')}`)
  }
}

// ---- 6. 名单漂移（我们的常量 vs 上游 app-boot） ----
if (UPSTREAM_PROFILE_TS !== undefined) {
  const upstream = [...(/export const OPTIONAL_BUNDLES: readonly string\[\] = \[([\s\S]*?)\]/
    .exec(readFileSync(UPSTREAM_PROFILE_TS, 'utf8'))?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1])
  check(upstream.length > 0, `上游 OPTIONAL_BUNDLES 抽取失败：${UPSTREAM_PROFILE_TS}`)
  checkDeep([...declaredOptional].sort(), [...upstream].sort(), `本地镜像与上游可选集漂移（上游 ${UPSTREAM_PROFILE_TS}）`)
} else {
  console.error('[skip] 未找到上游 app-boot/profile.ts（KCODER_UPSTREAM_DIR 或默认路径），本轮跳过名单漂移检查')
}

// ---- 7. 结论（成功即清理，失败保留现场供排查） ----
const ok = fails.length === 0
if (ok) {
  for (const dir of [home, workdir]) rmSync(dir, { recursive: true, force: true })
} else {
  console.error(`[keep] 现场保留：DSH_HOME=${home} build=${workdir}`)
}
process.stdout.write(ok
  ? `PASS ${String(total)}/${String(total)}（真 ensureKcoderBundles：F27 退役包三清 + F28 可选集不判孤儿 + F29 实验集声明跟随实态 + 内置/模板在册 + 幂等 + 退役非编码技能零回流${UPSTREAM_PROFILE_TS !== undefined ? ' + 上游名单无漂移' : ''}）\n`
  : `FAIL ${String(total - fails.length)}/${String(total)}:\n${fails.map((f) => '  - ' + f).join('\n')}\n`)
process.exitCode = ok ? 0 : 1
