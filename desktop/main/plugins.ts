/**
 * 插件生态桥：读 profile 层叠清单 + 发现社区插件 + 转发安装命令。
 *
 * 上游契约：
 * - 已装层叠：`$DSH_HOME/profiles/<name>/package.json` 的
 *   `dsh.profile.bundles`（`dsh plugin` 由 pnpm 安装后回写）；
 *   模板内置层（dsh-base / dsh-web-app）不在此列表中。
 * - 安装/卸载/更新：`dsh plugin --profile <name> <pnpm args>`，
 *   即 pnpm 转发器（add/remove/update），bundle 声明自动入栈。
 * - 社区发现：GitHub Search API，topic `dsh-plugin`。
 *
 * @module desktop/main/plugins
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { net } from 'electron'
import { WEB_PROFILE, dshHome, resolveDshCommand, vendoredPnpmEntry } from './dsh-contract'
import { ensureProfilePatches, healLog } from './profile-patches'
import { MATERIALIZED_BUNDLES } from './kcoder-skills-bundle'
import { PRESET_PLUGINS } from './preset-plugins'
import type {
  CommunityPlugin,
  CommunityQueryResult,
  InstalledPlugin,
  LatestVersions,
  PluginCommandResult,
} from '@shared/ipc-contract'

/** 发行版模板引擎层：与内置运行时（kcoder-runtime.tar.gz）整体版本耦合，
 *  不随插件管理页单独更新（卸载/更新均不开放，随应用发版整包升级）。 */
const ENGINE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

/** 内置清单：引擎层 + KCoder 物化 bundle（此前漏列会被当成「用户安装」
 *  误可卸载；file-attach 已于 0.5.6 退役，stats-panel 随 0.1.5-rc.2 基线
 *  退役，git-panel 已于 2026-09-14 退役，file-review 已于 2026-10-04 退役，
 *  coding-sidebar 已于 2026-10-09 退役）+ 预置第三方插件（`PRESET_PLUGINS`
 *  2026-10-09 起为空表，这一项自然为空；去重逻辑保留）。UI 展示为内置、
 *  禁卸载；除引擎层外均可更新。 */
const IN_BOX_BUNDLES = [
  ...ENGINE_BUNDLES,
  ...MATERIALIZED_BUNDLES,
  ...Object.keys(PRESET_PLUGINS).filter((n) => !MATERIALIZED_BUNDLES.includes(n)),
]

/**
 * dsh 宿主包缺失 peer（pnpm 安装期报警，运行时由
 * `$DSH_HOME/profiles/node_modules` 回退目录（healProfilesModuleFallback）
 * 提供）。在 profile 的 pnpm-workspace.yaml 里用 `peerDependencyRules.
 * ignoreMissing` 声明，抑制 `WARN Issues with peer dependencies found`
 * 这类误导性噪音——这些包本就不该装进 profile（会复制一份 cordis 实例）。
 *
 * 2026-10-04 清理（dsh 0.2.1-alpha.1）两处**陈旧条目**——它们在上游已不存在，
 * 留着只会让 ignoreMissing 清单与上游漂移（两个 tag 上按各包
 * `packages/<scope>/<name>/package.json` 的 `"name"` 字段实测）：
 * - `@deepseek-ai/dsh-invariants`：0.2.1-alpha.1 删除了 runtime-diagnostics/
 *   invariants 整包（官方指南 remove-runtime-invariants）⇒ rc.2 上还有、新版已无；
 * - `@deepseek-ai/dsh-client-runtime`：**rc.2 上就已不存在**（既有债，本次顺手回收）。
 *
 * 注意：本注释内不得出现「星号紧跟斜杠」的序列——那会当场闭合本块注释
 * （写路径 glob 时尤其容易踩；本次实测 TS1005/TS1161 一片）。
 */
const DS_HOST_PEER_FALLBACK = [
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-brand',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-tool',
  '@deepseek-ai/dsh-commands',
  '@deepseek-ai/dsh-credentials',
  '@deepseek-ai/dsh-home-paths',
  '@deepseek-ai/dsh-host-webserver',
  '@deepseek-ai/dsh-launch-environment',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-mcp-client',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-settings',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-timeout',
  '@deepseek-ai/dsh-tools',
]

/** profile 的 package.json 形状（仅取本模块关心的字段）。 */
interface ProfileManifest {
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
}

function profileDir(profile = WEB_PROFILE): string {
  return join(dshHome(), 'profiles', profile)
}

/** 读 node_modules 内包实体的 version（缺失/损坏返回 null；本地物化层无实体）。 */
function installedVersion(dir: string, name: string): string | null {
  try {
    const pkg = JSON.parse(
      readFileSync(join(dir, 'node_modules', name, 'package.json'), 'utf8'),
    ) as { version?: unknown }
    return typeof pkg.version === 'string' ? pkg.version : null
  } catch {
    return null
  }
}

/**
 * 已安装的 bundle 层（内置层在前，用户层按 dsh.profile.bundles 顺序）。
 * profile 尚未初始化时返回内置层（首次 `dsh web` 启动时由模板创建）。
 */
export function installedPlugins(): InstalledPlugin[] {
  const dir = profileDir()
  const result: InstalledPlugin[] = IN_BOX_BUNDLES.map((name, i) => ({
    name,
    layer: i,
    inBox: true,
    updatable: !ENGINE_BUNDLES.includes(name),
    version: installedVersion(dir, name),
  }))
  const manifestPath = join(dir, 'package.json')
  if (!existsSync(manifestPath)) return result
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ProfileManifest
    const bundles = manifest.dsh?.profile?.bundles ?? []
    for (const name of bundles) {
      // KCoder 物化注册的 bundle 已在内置层展示，跳过避免重复
      if (IN_BOX_BUNDLES.includes(name)) continue
      result.push({ name, layer: result.length, inBox: false, updatable: true, version: installedVersion(dir, name) })
    }
    // 依赖了但还没被 dsh 识别为 bundle 的包（安装中途态）也列出
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      if (!result.some((p) => p.name === name)) {
        result.push({ name, layer: result.length, inBox: false, updatable: true, version: installedVersion(dir, name) })
      }
    }
  } catch (error) {
    console.error('[plugins] read profile manifest failed:', error)
  }
  return result
}

/**
 * 批量查 npm registry dist-tags（包名 → latest）。UI 的“有新版本”判定
 * 必须基于 registry 实际 latest，而不是恒显“更新”文案——pnpm update 遵守
 * manifest 范围，而 0.x 包的 ^ 只含 patch 级，按范围判定会让用户永远看
 * 到“提示要更新”却点不出任何变化（v0.2.0 mac 的感知缺陷）。单包 10s
 * 超时，失败/非 200/解析异常的包不进结果（UI 显示“已最新”兑底）。
 */
export async function latestVersions(names: string[]): Promise<LatestVersions> {
  const unique = [...new Set(names)].filter((n) => n !== '' && !n.startsWith('file:'))
  const result: LatestVersions = {}
  const started = Date.now()
  const failed: string[] = []
  await Promise.allSettled(
    unique.map(async (name) => {
      const url = `https://registry.npmjs.org/-/package/${encodeURIComponent(name)}/dist-tags`
      try {
        const response = await net.fetch(url, { signal: AbortSignal.timeout(10_000) })
        if (!response.ok) return
        const body = JSON.parse((await response.text()) as string) as { latest?: unknown }
        if (typeof body.latest === 'string') result[name] = body.latest
      } catch {
        failed.push(name) // 网络受限：UI 兑底显示已最新（假阴性），落盘留痕
      }
    }),
  )
  healLog(
    `[latest] ${String(Object.keys(result).length)}/${String(unique.length)} 命中 耗时${String(Date.now() - started)}ms`
    + (failed.length === 0 ? '' : ` 失败=[${failed.join(',')}]`),
  )
  return result
}

/**
 * pnpm 实际使用的 registry 线索（诊断假成功：镜像源 latest 落后时
 * `update --latest` 在范围内空转成功，而 UI 查官方源仍提示更新）。
 * GUI 进程 env 基本无 npm_config_registry，主要是用户 ~/.npmrc。
 */
function registryHints(): string {
  const parts: string[] = []
  const envRegistry = process.env.npm_config_registry
  if (envRegistry !== undefined && envRegistry !== '') parts.push(`env=${envRegistry}`)
  try {
    const npmrc = readFileSync(join(homedir(), '.npmrc'), 'utf8')
    const matched = /^registry\s*=\s*(\S+)/m.exec(npmrc)
    if (matched !== null) parts.push(`npmrc=${matched[1]}`)
  } catch {
    // 无 ~/.npmrc = 默认官方源
  }
  return parts.length === 0 ? '默认 npmjs.org' : parts.join(' ')
}

/**
 * win32 物化 vendored pnpm 的 cmd shim（$DSH_HOME/bin/pnpm.cmd），返回
 * 其目录。上游 dsh plugin 写死 `spawnSync('pnpm', shell:win32)` 找 PATH
 * 上的系统 pnpm——GUI 进程 PATH 不可控（可能没有 pnpm），且与 KCoder
 * 自身 install/heal 链的 vendored pnpm 分叉（版本/行为/registry 均不可控，
 * v0.2.1 Windows 更新仍提示更新疑点链）。前置 PATH 后 dsh 统一走
 * vendored（ELECTRON_RUN_AS_NODE 同款直跑模式）。非 win32 / 未物化返回
 * null，mac 行为不变（已验证）。
 */
function ensurePnpmShim(): string | null {
  if (process.platform !== 'win32') return null
  const entry = vendoredPnpmEntry()
  if (entry === null) return null
  const dir = join(dshHome(), 'bin')
  const file = join(dir, 'pnpm.cmd')
  const content = [
    '@echo off',
    'setlocal',
    'set "ELECTRON_RUN_AS_NODE=1"',
    `"${process.execPath}" "${entry}" %*`,
    'endlocal & exit /b %ERRORLEVEL%',
    '',
  ].join('\r\n')
  try {
    mkdirSync(dir, { recursive: true })
    let unchanged = false
    try {
      unchanged = readFileSync(file, 'utf8') === content
    } catch {
      // 首次物化无旧文件
    }
    if (!unchanged) writeFileSync(file, content)
    return dir
  } catch (error) {
    console.error('[plugins] ensure pnpm shim failed:', error)
    return null
  }
}

/**
 * 确保 profile 的 pnpm-workspace.yaml 带 peerDependencyRules.ignoreMissing。
 * pnpm 默认把"未安装的 peer"当问题警告（用户侧表现为安装/更新时刷
 * `WARN Issues with peer dependencies found`），但 dsh 的宿主 peer
 * （cordis 与 @deepseek-ai/dsh-*）由 $DSH_HOME/profiles/node_modules
 * 回退目录在运行时提供，并不缺失。声明 ignoreMissing 后 pnpm 不再报警，
 * 且不改变解析行为（仅抑制检查）。文件由 app-boot initProfile 模板创建，
 * 这里做幂等补写；非 dsh 管理的异常内容保留。
 */
function ensureProfilePeerRules(profileDirPath: string): void {
  const workspacePath = join(profileDirPath, 'pnpm-workspace.yaml')
  if (!existsSync(workspacePath)) return
  try {
    const current = readFileSync(workspacePath, 'utf8')
    if (current.includes('peerDependencyRules:')) return
    const block = [
      'peerDependencyRules:',
      '  ignoreMissing:',
      ...DS_HOST_PEER_FALLBACK.map((p) => `    - '${p}'`),
    ].join('\n')
    writeFileSync(workspacePath, `${current.replace(/\n*$/, '\n')}${block}\n`)
  } catch (error) {
    console.error('[plugins] ensure profile peer rules failed:', error)
  }
}

/**
 * 更新一个插件（统一入口，按包属选路）：
 * - 内置可更新层（KCoder 物化 bundle 与预置插件）：物化 bundle 不在 profile
 *   dependencies（kcoder-skills-bundle 按「残留接线」摘除非 registry 顶替的
 *   声明），pnpm update 对它们无从谈起；add 幂等升线并把实体交给 registry
 *   管理——配合物化让位规则，更新结果重启后不被随包副本打回，deps 声明也因
 *   「registry 顶替」判定得以保留（图与磁盘不漂移）。
 * - 用户安装插件：同样落到 add（deps 范围由 pnpm 按新版本回写）。
 * - 引擎层（dsh-base / dsh-web-app）：维持 `update --latest` 旧口径不动
 *   （与内置运行时整体版本耦合，UI 侧 updatable=false 已隐藏入口）。
 *
 * **有 registry latest 时一律装精确版本**（`add <pkg>@<version>`），而不是
 * `@latest` / `update --latest`：pnpm 11 的 `minimumReleaseAge` 供应链年龄门
 * 会把「刚发布不久」的版本静默排除在解析之外——此时 `@latest` 会回落到旧版
 * **并 exit 0**，UI 误报「完成」（2026-10-03 现场：dsh-coding-sidebar
 * 1.0.36 → 1.0.37 连续两次假成功，`pnpm outdated` 也不列该项）。精确版本走
 * pnpm 的显式请求路径，它会自行把该版本记进 profile `pnpm-workspace.yaml` 的
 * `minimumReleaseAgeExclude`（豁免留痕、可审计）。
 *
 * 查不到 latest（网络受限）时回落到旧口径，输出里说明——此时仍可能被年龄门
 * 挡住，由 {@link PluginCommandResult.versionChange} 的判定兜底提示。
 */
export async function updatePlugin(pkg: string): Promise<PluginCommandResult> {
  // 占闸必须在**查 registry latest 之前**：那段 await（最多 10s 网络等待）是
  // 竞态窗口，放在后面会让并发调用双双通过检查（见 claimPluginOp）
  if (!claimPluginOp(pkg)) {
    healLog(`[plugin-cmd] 拒绝并发更新 ${pkg}（在飞：${pluginOpInFlight ?? '未知'}）`)
    return busyResult()
  }
  try {
    if (ENGINE_BUNDLES.includes(pkg)) {
      return await executePluginCommand(['update', '--latest', pkg])
    }
    const latest = (await latestVersions([pkg]))[pkg]
    if (typeof latest === 'string' && latest !== '') {
      healLog(`[plugin-cmd] ${pkg} registry latest = ${latest}，按精确版本安装`)
      return await executePluginCommand(['add', `${pkg}@${latest}`])
    }
    const fallback = IN_BOX_BUNDLES.includes(pkg)
      ? ['add', `${pkg}@latest`]
      : ['update', '--latest', pkg]
    const result = await executePluginCommand(fallback)
    return {
      ...result,
      output: `${result.output}\n[plugins] 未能查到 ${pkg} 的 registry latest（网络受限？）`
        + '——已回落到范围更新；若版本未变，多因 pnpm 供应链年龄门或镜像源滞后。',
    }
  } finally {
    pluginOpInFlight = null
  }
}

/**
 * 卸载一个插件（按注册形态选路）：
 * - dependencies 里的常规插件：沿用 `dsh plugin remove`（pnpm 原生语义，
 *   成功后上游 reconcile 按 dependencies 回写 bundles 层叠）。
 * - 仅注册在 `dsh.profile.bundles`、不在 dependencies 的孤儿项：pnpm
 *   remove 报 ERR_PNPM_CANNOT_REMOVE_MISSING_DEPS，而上游 reconcile 只遍历
 *   dependencies，孤儿声明永远无人清理——bundle 声明入栈后 pnpm 安装未
 *   落地即产生这种态，且启动时 resolveBundleDir 解析不到实体会挡死整个
 *   profile（进程 exit 1 循环重启）。主进程直接摘层叠声明并清理可能的
 *   物化残留。
 *
 * 内置层（引擎/物化/预置）不在此开放：UI 已禁卸载，此处再挡一道。
 */
export async function removePlugin(pkg: string): Promise<PluginCommandResult> {
  if (IN_BOX_BUNDLES.includes(pkg)) {
    return { ok: false, output: `内置组件不可卸载: ${pkg}` }
  }
  const dir = profileDir()
  const manifestPath = join(dir, 'package.json')
  let manifest: ProfileManifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ProfileManifest
  } catch (error) {
    return { ok: false, output: `读取 profile 清单失败: ${String(error)}` }
  }
  const bundles = manifest.dsh?.profile?.bundles ?? []
  const inDeps = pkg in (manifest.dependencies ?? {})
  const inBundles = bundles.includes(pkg)
  if (!inDeps && !inBundles) {
    return { ok: false, output: `未安装: ${pkg}` }
  }
  if (inDeps) return runPluginCommand(['remove', pkg])
  const remaining = bundles.filter((x) => x !== pkg)
  const dsh = (manifest.dsh ?? {}) as { profile?: Record<string, unknown> }
  const profile = (dsh.profile ?? {}) as Record<string, unknown>
  manifest.dsh = { ...dsh, profile: { ...profile, bundles: remaining } }
  try {
    writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
    rmSync(join(dir, 'node_modules', pkg), { recursive: true, force: true })
  } catch (error) {
    return { ok: false, output: `写回 profile 清单失败: ${String(error)}` }
  }
  healLog(`[plugin-cmd] 摘除孤儿 bundles 注册项 ${pkg}（不在 dependencies，pnpm remove 无从谈起）`)
  return { ok: true, output: `已移除 ${pkg} 的 bundles 层叠注册（不在 dependencies，跳过 pnpm remove）` }
}

/**
 * 同一时刻只允许一项插件操作在飞。
 *
 * 上游 `dsh plugin` 用 profile manifest 的跨进程写锁（`<package.json>.lock`
 * + `withFileLock`）串行化写者，而它的等待上限只有 **2 秒**
 * （`@deepseek-ai/dsh-atomic-write` 的 `DEFAULT_LOCK_WAIT_MS`），且只在持有者
 * PID 已不存在时才接管锁。于是「上一个操作还卡着」时，第二次点击必然在 2 秒
 * 后抛 `atomic-write: timed out waiting for the writer lock`——用户看到的是一段
 * 与点击动作毫无关系的栈。这里在源头拒绝并发，把话说清楚。
 */
let pluginOpInFlight: string | null = null

/**
 * 插件操作看门狗。pnpm 偶发「落位完成后进程不收尾」（2026-10-03 现场：
 * 0 CPU、无 socket、无子进程地阻塞 30 分钟以上，`.modules.yaml` 已写出），
 * 而 CLI 会一直等它 ⇒ manifest 锁被无限期攥住、**全机插件操作一起废掉**。
 * 到点杀进程树：CLI 一死，下一次操作按上游语义（持有者 PID 不存在 ⇒ 接管）
 * 自动清掉残留锁，自愈。
 */
const PLUGIN_OP_TIMEOUT_MS = 10 * 60_000

/** 终止一个子进程及其整棵进程树（Windows 用 taskkill /T；POSIX 走进程组）。 */
function killProcessTree(pid: number | undefined): void {
  if (pid === undefined) return
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
      return
    }
    process.kill(-pid, 'SIGKILL')
  } catch (error) {
    healLog(`[plugin-cmd] 终止进程树失败（pid=${String(pid)}）：${String(error)}`)
  }
}

/**
 * 插件命令参数解析：被操作的包名 + 是否属于「可追踪版本变化」的操作。
 * 三条更新路径都算追踪：`update --latest <pkg>`（用户插件）、
 * `add <pkg>@latest`（旧口径）与 `add <pkg>@<version>`（现行口径，见
 * updatePlugin：精确版本才躲得开 pnpm 的供应链年龄门）。
 */
function parsePluginSpec(args: string[]): { pkg: string; tracking: boolean } {
  const addSpec = args[0] === 'add' ? args[1] : undefined
  const atIndex = addSpec === undefined ? -1 : addSpec.lastIndexOf('@')
  const pkg = addSpec !== undefined
    ? (atIndex > 0 ? addSpec.slice(0, atIndex) : addSpec)
    : (args[args.length - 1] ?? '')
  return { pkg, tracking: args[0] === 'update' || (addSpec !== undefined && atIndex > 0) }
}

/** 并发被拒时的统一回包（成因见 {@link pluginOpInFlight}）。 */
function busyResult(): PluginCommandResult {
  return {
    ok: false,
    busy: true,
    output: `另一项插件操作正在进行（${pluginOpInFlight ?? '未知'}），请等它结束后再试。\n`
      + '（profile manifest 在同一次操作期间独占写锁，并发只会撞 2 秒超时）',
  }
}

/**
 * 占并发闸。**必须在任何 await 之前调用**——像 updatePlugin 那样「先查 registry
 * latest（最多 10s 网络等待）再执行」的话，那段异步窗口里第二个调用会畅通无阻
 * 地挤进来（2026-10-03 设计验证时发现）。
 */
function claimPluginOp(label: string): boolean {
  if (pluginOpInFlight !== null) return false
  pluginOpInFlight = label
  return true
}

/**
 * 执行 `dsh plugin --profile web <args...>`，收集输出。
 * **调用方必须已占并发闸**（见 {@link claimPluginOp}）；超时由看门狗终止
 * （见 {@link PLUGIN_OP_TIMEOUT_MS}）。插件变更属于 profile 组合，重启 dsh
 * 侧车后生效（由 UI 提示）。
 */
function executePluginCommand(args: string[]): Promise<PluginCommandResult> {
  return new Promise<PluginCommandResult>((resolve) => {
    const command = resolveDshCommand()
    if (command === null) {
      resolve({ ok: false, output: '未找到可用的 dsh：请先完成上游初始化' })
      return
    }
    ensureProfilePeerRules(profileDir())
    const shimDir = ensurePnpmShim()
    const env: NodeJS.ProcessEnv = { ...process.env, ...command.env }
    if (shimDir !== null) env.PATH = `${shimDir};${process.env.PATH ?? ''}`
    // 实装追踪口径见 parsePluginSpec
    const { pkg, tracking } = parsePluginSpec(args)
    const before = tracking ? installedVersion(profileDir(), pkg) : null
    healLog(
      `[plugin-cmd] dsh plugin ${args.join(' ')}（${command.describe}；pnpm ${shimDir !== null ? 'vendored shim' : 'PATH 系统源'}；registry ${registryHints()}）`,
    )
    if (tracking) healLog(`[plugin-cmd] ${pkg} 更新前实装 ${before ?? '未知'}`)
    const full = [...command.baseArgs, 'plugin', '--profile', WEB_PROFILE, ...args]
    const child = spawn(command.command, full, {
      cwd: command.cwd,
      windowsHide: true,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      // POSIX：独立进程组，看门狗才能整组杀（CLI + 它拉起的 pnpm）
      detached: process.platform !== 'win32',
    })
    const lines: string[] = []
    const onLine = (chunk: Buffer): void => {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line !== '') lines.push(line)
      }
    }
    child.stdout?.on('data', onLine)
    child.stderr?.on('data', onLine)
    let timedOut = false
    const watchdog = setTimeout(() => {
      timedOut = true
      healLog(
        `[plugin-cmd] ${pkg || args.join(' ')} 超过 ${String(PLUGIN_OP_TIMEOUT_MS / 60_000)} 分钟未结束，`
        + '判定卡死并终止进程树（残留 manifest 锁由下一次操作按上游语义接管）',
      )
      killProcessTree(child.pid)
    }, PLUGIN_OP_TIMEOUT_MS)
    const finish = (result: PluginCommandResult): void => {
      clearTimeout(watchdog)
      resolve(result)
    }
    child.on('error', (error) => {
      finish({ ok: false, output: [...lines, `无法执行: ${String(error)}`].join('\n') })
    })
    child.on('exit', (code) => {
      if (code === 0) {
        // 变更成功后立即校验补丁仍生效：pnpm 重装会重放 name-only 补丁，
        // 但静默失败时插件裸装（v0.1.9 Windows 现场）——锄点兑底在此接管
        try {
          ensureProfilePatches()
        } catch {
          // ensureProfilePatches 内部已兜底全部异常，此处防御性忽略
        }
      }
      let versionChange: PluginCommandResult['versionChange'] = undefined
      if (tracking) {
        // 前后实装对比：假成功（exit 0 但版本未变——pnpm 的 minimumReleaseAge
        // 供应链年龄门把刚发布的版本静默挡回旧版，或镜像源 latest 滞后）当场
        // 现形，并回传给 UI 提示（不能显示「完成」）
        const after = installedVersion(profileDir(), pkg)
        const unchanged = before !== null && after !== null && before === after
        versionChange = { pkg, from: before, to: after, unchanged }
        healLog(
          `[plugin-cmd] ${pkg} exit=${String(code)} 实装 ${before ?? '未知'} → ${after ?? '未知'}`
          + (unchanged ? '（版本未变！）' : ''),
        )
      } else {
        healLog(`[plugin-cmd] dsh plugin ${args.join(' ')} exit=${String(code)}`)
      }
      if (code !== 0) {
        healLog(`[plugin-cmd] 失败输出尾: ${lines.slice(-15).join(' | ').slice(0, 800)}`)
      }
      const tail = timedOut
        ? [
            `\n[plugins] 该操作超过 ${String(PLUGIN_OP_TIMEOUT_MS / 60_000)} 分钟未结束，已判定卡死并终止。`,
            '残留的 profile manifest 锁会在下一次插件操作时自动接管，无需手工清理；请重试。',
          ].join('\n')
        : ''
      finish({
        ok: code === 0 && !timedOut,
        output: `${lines.slice(-80).join('\n')}${tail}`,
        ...(versionChange === undefined ? {} : { versionChange }),
      })
    })
  })
}

/**
 * 对外统一入口：占闸 → 执行 → 释放。并发时立即返回 {@link busyResult}
 * （不排队：排队同样要等同一个 manifest 锁，不如把话说清）。
 */
export async function runPluginCommand(args: string[]): Promise<PluginCommandResult> {
  const label = parsePluginSpec(args).pkg || args.join(' ')
  if (!claimPluginOp(label)) {
    healLog(`[plugin-cmd] 拒绝并发操作 ${args.join(' ')}（在飞：${pluginOpInFlight ?? '未知'}）`)
    return busyResult()
  }
  try {
    return await executePluginCommand(args)
  } finally {
    pluginOpInFlight = null
  }
}

/* ---------- 社区发现 ---------- */

/** 内存缓存（GitHub Search API 未认证限额 10 次/分钟；按 查询词|页码 分桶）。 */
const communityCache = new Map<string, { at: number; items: CommunityPlugin[]; totalCount: number }>()
const CACHE_TTL_MS = 5 * 60_000
/** 缓存桶上限（防长时间使用后内存膨胀；超出丢最老）。 */
const CACHE_MAX_KEYS = 24

interface GitHubSearchResponse {
  total_count: number
  items: Array<{
    full_name: string
    description: string | null
    stargazers_count: number
    updated_at: string
    html_url: string
  }>
}

/** 搜索词净化：GitHub 查询语法里的引号/冒号/括号会改语义，一律剔除。 */
function sanitizeQuery(query: string): string {
  return query.replace(/["'():+\\/<>]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * 发现社区插件（GitHub topic `dsh-plugin`，按 ★ 倒序；未认证 API
 * 单页上限 100 条）。query 非空时走服务端搜索（`in:name,description`），
 * 可命中榜单 100 名之外的插件（如 context）；page 用于「加载更多」翻页。
 * 使用 Electron net（尊重系统代理）。失败时返回已缓存页，无缓存则空。
 */
export async function communityPlugins(query = '', page = 1): Promise<CommunityQueryResult> {
  const key = `${sanitizeQuery(query)}|${page}`
  const cached = communityCache.get(key)
  if (cached !== undefined && Date.now() - cached.at < CACHE_TTL_MS) {
    return { items: cached.items, totalCount: cached.totalCount, page }
  }
  const q = sanitizeQuery(query)
  const qualifiers = `topic:dsh-plugin${q === '' ? '' : ` ${q} in:name,description`}`
  const url =
    `https://api.github.com/search/repositories?q=${encodeURIComponent(qualifiers)}` +
    `&sort=stars&order=desc&per_page=100&page=${page}`
  try {
    const response = await net.fetch(url, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'kcoder' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
    const body = JSON.parse((await response.text()) as string) as GitHubSearchResponse
    // 显式再排一次：Search API 的 sort=stars 不保证返回顺序严格单调
    const items = body.items
      .map((item) => ({
        fullName: item.full_name,
        description: item.description ?? '',
        stars: item.stargazers_count,
        updatedAt: item.updated_at,
        url: item.html_url,
      }))
      .sort((a, b) => b.stars - a.stars)
    communityCache.set(key, { at: Date.now(), items, totalCount: body.total_count })
    if (communityCache.size > CACHE_MAX_KEYS) {
      let oldestKey: string | null = null
      let oldestAt = Number.POSITIVE_INFINITY
      for (const [k, v] of communityCache) {
        if (v.at < oldestAt) { oldestAt = v.at; oldestKey = k }
      }
      if (oldestKey !== null) communityCache.delete(oldestKey)
    }
    return { items, totalCount: body.total_count, page }
  } catch (error) {
    console.error('[plugins] community discovery failed:', error)
    if (cached !== undefined) return { items: cached.items, totalCount: cached.totalCount, page }
    return { items: [], totalCount: 0, page }
  }
}
