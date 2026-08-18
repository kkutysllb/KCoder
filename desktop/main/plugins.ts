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
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { net } from 'electron'
import { WEB_PROFILE, dshHome, resolveDshCommand } from './dsh-contract'
import { KCODER_SKILLS_BUNDLE } from './kcoder-skills-bundle'
import type { CommunityPlugin, InstalledPlugin, PluginCommandResult } from '@shared/ipc-contract'

/** 发行版模板内置层（KCoder 会物化注册自己的 skills bundle，UI 同样展示为内置）。 */
const IN_BOX_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', KCODER_SKILLS_BUNDLE]

/** profile 的 package.json 形状（仅取本模块关心的字段）。 */
interface ProfileManifest {
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
}

function profileDir(profile = WEB_PROFILE): string {
  return join(dshHome(), 'profiles', profile)
}

/**
 * 已安装的 bundle 层（内置层在前，用户层按 dsh.profile.bundles 顺序）。
 * profile 尚未初始化时返回内置层（首次 `dsh web` 启动时由模板创建）。
 */
export function installedPlugins(): InstalledPlugin[] {
  const result: InstalledPlugin[] = IN_BOX_BUNDLES.map((name, i) => ({ name, layer: i, inBox: true }))
  const manifestPath = join(profileDir(), 'package.json')
  if (!existsSync(manifestPath)) return result
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ProfileManifest
    const bundles = manifest.dsh?.profile?.bundles ?? []
    for (const name of bundles) {
      // KCoder 物化注册的 bundle 已在内置层展示，跳过避免重复
      if (IN_BOX_BUNDLES.includes(name)) continue
      result.push({ name, layer: result.length, inBox: false })
    }
    // 依赖了但还没被 dsh 识别为 bundle 的包（安装中途态）也列出
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      if (!result.some((p) => p.name === name)) {
        result.push({ name, layer: result.length, inBox: false })
      }
    }
  } catch (error) {
    console.error('[plugins] read profile manifest failed:', error)
  }
  return result
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
    const full = [...command.baseArgs, 'plugin', '--profile', WEB_PROFILE, ...args]
    const child = spawn(command.command, full, {
      cwd: command.cwd,
      env: { ...process.env, ...command.env },
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
      resolve({ ok: code === 0, output: lines.slice(-80).join('\n') })
    })
  })
}

/* ---------- 社区发现 ---------- */

/** 内存缓存（GitHub Search API 未认证限额 10 次/分钟）。 */
let communityCache: { at: number; items: CommunityPlugin[] } | null = null
const CACHE_TTL_MS = 5 * 60_000

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

/**
 * 发现社区插件（GitHub topic `dsh-plugin`，按更新时间排序）。
 * 使用 Electron net（尊重系统代理）。
 */
export async function communityPlugins(): Promise<CommunityPlugin[]> {
  if (communityCache !== null && Date.now() - communityCache.at < CACHE_TTL_MS) {
    return communityCache.items
  }
  const url = 'https://api.github.com/search/repositories?q=topic:dsh-plugin&sort=updated&order=desc&per_page=50'
  try {
    const response = await net.fetch(url, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'kcoder' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
    const body = JSON.parse((await response.text()) as string) as GitHubSearchResponse
    const items = body.items.map((item) => ({
      fullName: item.full_name,
      description: item.description ?? '',
      stars: item.stargazers_count,
      updatedAt: item.updated_at,
      url: item.html_url,
    }))
    communityCache = { at: Date.now(), items }
    return items
  } catch (error) {
    console.error('[plugins] community discovery failed:', error)
    return communityCache?.items ?? []
  }
}
