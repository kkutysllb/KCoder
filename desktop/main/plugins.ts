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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { net } from 'electron'
import { WEB_PROFILE, dshHome, resolveDshCommand, vendoredPnpmEntry } from './dsh-contract'
import { ensureProfilePatches, healLog } from './profile-patches'
import { KCODER_SKILLS_BUNDLE } from './kcoder-skills-bundle'
import { PRESET_PLUGINS } from './preset-plugins'
import type {
  CommunityPlugin,
  CommunityQueryResult,
  InstalledPlugin,
  LatestVersions,
  PluginCommandResult,
} from '@shared/ipc-contract'

/** 发行版模板内置层 + KCoder 物化注册层（预置第三方插件与技能 bundle，UI 均展示为内置且禁卸载）。 */
const IN_BOX_BUNDLES = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  KCODER_SKILLS_BUNDLE,
  ...Object.keys(PRESET_PLUGINS),
]

/**
 * dsh 宿主包缺失 peer（pnpm 安装期报警，运行时由
 * `$DSH_HOME/profiles/node_modules` 回退目录（healProfilesModuleFallback）
 * 提供）。在 profile 的 pnpm-workspace.yaml 里用 `peerDependencyRules.
 * ignoreMissing` 声明，抑制 `WARN Issues with peer dependencies found`
 * 这类误导性噪音——这些包本就不该装进 profile（会复制一份 cordis 实例）。
 */
const DS_HOST_PEER_FALLBACK = [
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-brand',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-tool',
  '@deepseek-ai/dsh-commands',
  '@deepseek-ai/dsh-credentials',
  '@deepseek-ai/dsh-home-paths',
  '@deepseek-ai/dsh-host-webserver',
  '@deepseek-ai/dsh-invariants',
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
      result.push({ name, layer: result.length, inBox: false, version: installedVersion(dir, name) })
    }
    // 依赖了但还没被 dsh 识别为 bundle 的包（安装中途态）也列出
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      if (!result.some((p) => p.name === name)) {
        result.push({ name, layer: result.length, inBox: false, version: installedVersion(dir, name) })
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
 * 执行 `dsh plugin --profile web <args...>`，收集输出。
 * 插件变更属于 profile 组合，重启 dsh 侧车后生效（由 UI 提示）。
 */
export function runPluginCommand(args: string[]): Promise<PluginCommandResult> {
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
    const pkg = args[args.length - 1] ?? ''
    const tracking = args[0] === 'update'
    const before = tracking ? installedVersion(profileDir(), pkg) : null
    healLog(
      `[plugin-cmd] dsh plugin ${args.join(' ')}（${command.describe}；pnpm ${shimDir !== null ? 'vendored shim' : 'PATH 系统源'}；registry ${registryHints()}）`,
    )
    if (tracking) healLog(`[plugin-cmd] ${pkg} 更新前实装 ${before ?? '未知'}`)
    const full = [...command.baseArgs, 'plugin', '--profile', WEB_PROFILE, ...args]
    const child = spawn(command.command, full, {
      cwd: command.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const lines: string[] = []
    const onLine = (chunk: Buffer): void => {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line !== '') lines.push(line)
      }
    }
    child.stdout?.on('data', onLine)
    child.stderr?.on('data', onLine)
    child.on('error', (error) => {
      resolve({ ok: false, output: [...lines, `无法执行: ${String(error)}`].join('\n') })
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
      if (tracking) {
        // 前后实装对比：假成功（exit 0 但版本未变，如镜像源 latest 落后
        // 空转）当场现形，不再需要用户转述 UI 一次性输出
        const after = installedVersion(profileDir(), pkg)
        healLog(
          `[plugin-cmd] ${pkg} exit=${String(code)} 实装 ${before ?? '未知'} → ${after ?? '未知'}`
          + (before !== null && after !== null && before === after ? '（版本未变！）' : ''),
        )
      } else {
        healLog(`[plugin-cmd] dsh plugin ${args.join(' ')} exit=${String(code)}`)
      }
      if (code !== 0) {
        healLog(`[plugin-cmd] 失败输出尾: ${lines.slice(-15).join(' | ').slice(0, 800)}`)
      }
      resolve({ ok: code === 0, output: lines.slice(-80).join('\n') })
    })
  })
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
 * 可命中榜单 100 名之外的插件（如 genui）；page 用于「加载更多」翻页。
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
