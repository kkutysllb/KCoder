/**
 * 内置 MCP 服务器：随 KCoder 发版的推荐工具（fetch / context7 /
 * sequential-thinking / playwright）。首次启动自动写入用户配置，升级时
 * 只追加新增条目（用户删过的不复活）。
 *
 * 物化逻辑：
 * - 状态文件 `$DSH_HOME/mcp-builtin-state.json` 记录已同步过的内置名
 * - 启动时对比当前内置列表与状态文件，只写入新增条目
 * - 写入走 mcpServerSave（复用校验 + YAML 写入链）
 * - UI 通过 BUILTIN_MCP_SERVERS 判断是否显示「内置」徽标 + 禁删除
 *
 * 命令可用性门：stdio 内置条目写入前探测 command 在 PATH 上可执行
 * （mcp-fetch 依赖 uvx——普通 Windows 用户机器没装 uv，盲写会让 dsh
 * 每次启动拉 MCP server 时报「'uvx' 不是内部或外部命令」；无 node 的
 * 机器上 npx 同理）。不可用则不写入且不标记 synced（每次启动重探，
 * 用户装好对应运行时后自动补上）；已写入但命令已不可用的内置条目
 * （卸载了 uv/node 的现场）顺手清理。
 *
 * @module desktop/main/mcp-builtin
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { dshHome } from './dsh-contract'
import { mcpServerDelete, mcpServerSave, mcpServers, type McpServerEntry } from './mcp-store'

/**
 * 内置定义版本。修改任何内置条目（命令/参数/新增/删除）时递增，触发
 * 已安装用户的全量重写（确保旧错误配置被修正）。
 */
const BUILTIN_VERSION = 4

/**
 * 系统 Chrome 常见安装位置（跨平台）。
 *
 * 注意：以下三个辅助函数被 BUILTIN_MCP_SERVERS 在模块加载期急切引用，
 * 声明（含 chromeAvailableCache 的 let）必须位于数组字面量之前，
 * 否则启动时 TDZ ReferenceError（v4 曾踩）。
 */
function chromeCandidates(): string[] {
  switch (process.platform) {
    case 'darwin':
      return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    case 'win32':
      return [
        join(process.env['PROGRAMFILES'] ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(process.env['LOCALAPPDATA'] ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      ]
    default:
      return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/snap/bin/chromium']
  }
}

/** 系统是否装了 Chrome（探测结果单次启动内缓存）。 */
let chromeAvailableCache: boolean | undefined
function chromeAvailable(): boolean {
  chromeAvailableCache ??= chromeCandidates().some((p) => p !== '' && existsSync(p))
  return chromeAvailableCache
}

/**
 * playwright MCP 浏览器参数：有系统 Chrome 时用 channel 直驱（零下载）；
 * 缺失时不传 --browser，回落官方默认 chromium（首次使用时自动下载
 * 一次，而非每次会话重试）。
 */
function playwrightBrowserArgs(): string[] {
  return chromeAvailable() ? ['--browser', 'chrome'] : []
}

/** 内置 MCP 服务器定义。 */
export const BUILTIN_MCP_SERVERS: McpServerEntry[] = [
  {
    id: 'mcp-fetch',
    serverName: 'fetch',
    transport: 'stdio',
    enabled: true,
    command: 'uvx',
    args: ['mcp-server-fetch'],
    env: {},
    cwd: '',
    url: '',
    headers: {},
    toolCallTimeoutMs: null,
  },
  {
    id: 'mcp-context7',
    serverName: 'context7',
    transport: 'stdio',
    enabled: true,
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp'],
    env: {},
    cwd: '',
    url: '',
    headers: {},
    toolCallTimeoutMs: null,
  },
  {
    id: 'mcp-sequential-thinking',
    serverName: 'sequential-thinking',
    transport: 'stdio',
    enabled: true,
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    env: {},
    cwd: '',
    url: '',
    headers: {},
    toolCallTimeoutMs: null,
  },
  {
    id: 'mcp-playwright',
    serverName: 'playwright',
    transport: 'stdio',
    enabled: true,
    command: 'npx',
    // 官方 @playwright/mcp + 系统 Chrome（channel 直驱）：不下载专属
    // chromium build，库升级不再触发浏览器重装（旧 executeautomation
    // 服务器 + playwright 库/浏览器强耦合是“每次都要安装”的病灶）。
    // Chrome 缺失时降级为默认 chromium（首次使用自动下载一次）。
    args: ['-y', '@playwright/mcp@latest', ...playwrightBrowserArgs()],
    env: {},
    cwd: '',
    url: '',
    headers: {},
    toolCallTimeoutMs: null,
  },
  {
    id: 'mcp-memory',
    serverName: 'memory',
    transport: 'stdio',
    enabled: true,
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    env: {},
    cwd: '',
    url: '',
    headers: {},
    toolCallTimeoutMs: null,
  },
]

/** 状态文件路径（记录已同步的内置条目，升级时只追加新增项）。 */
function statePath(): string {
  return join(dshHome(), 'mcp-builtin-state.json')
}

/** 读取已同步状态（版本不匹配时返回空 Set，触发全量重写）。 */
function readSyncState(): { synced: Set<string>; version: number } {
  const p = statePath()
  if (!existsSync(p)) return { synced: new Set(), version: 0 }
  try {
    const data = JSON.parse(readFileSync(p, 'utf8')) as { synced?: unknown; version?: unknown }
    const version = typeof data.version === 'number' ? data.version : 0
    const synced = Array.isArray(data.synced) ? new Set(data.synced as string[]) : new Set<string>()
    return { synced, version }
  } catch {
    return { synced: new Set<string>(), version: 0 }
  }
}

/** 写回同步状态。 */
function writeSyncState(synced: Set<string>): void {
  writeFileSync(statePath(), JSON.stringify({ synced: [...synced], version: BUILTIN_VERSION }, null, 2), 'utf8')
}

/** 命令可用性探测结果缓存（单次启动内去重；PATH 增强在 index.ts 入口完成）。 */
const commandProbeCache = new Map<string, boolean>()

/** stdio command 是否可执行：绝对路径查文件存在，裸命令 where/which 查 PATH。 */
function commandAvailable(command: string): boolean {
  const cached = commandProbeCache.get(command)
  if (cached !== undefined) return cached
  let ok = false
  if (command !== '') {
    if (isAbsolute(command)) {
      ok = existsSync(command)
    } else {
      const probe = process.platform === 'win32'
        ? spawnSync('where.exe', [command], { encoding: 'utf8', timeout: 5_000, windowsHide: true })
        : spawnSync('which', [command], { encoding: 'utf8', timeout: 5_000 })
      ok = probe.status === 0
    }
  }
  commandProbeCache.set(command, ok)
  return ok
}

/**
 * 幂等物化内置 MCP 服务器（dsh 启动前调用）。首次启动写入全部条目，升级时
 * 只追加新增项（用户删过的不复活——状态文件记录已处理过的名字）；
 * stdio 条目命令不可用时不写入（不标记 synced，每次启动重探），已写入
 * 但命令失效的内置条目顺手清理（按 command 匹配，用户改过配置的不动）。
 */
export function ensureBuiltinMcpServers(): void {
  try {
    const state = readSyncState()
    const versionChanged = state.version !== BUILTIN_VERSION
    const synced = versionChanged ? new Set<string>() : state.synced

    if (versionChanged) {
      console.log(`[mcp-builtin] 内置定义版本变更 ${state.version} → ${BUILTIN_VERSION}，全量重写`)
    }

    const existing = mcpServers()
    const existingNames = new Set(existing.map((s) => s.serverName))
    const newBuiltins = BUILTIN_MCP_SERVERS.filter((b) => !synced.has(b.serverName))

    // 已写入但命令已不可用的内置条目：清理（下次命令可用时自动重写）。
    // 按 command 匹配限定只动内置写入的同款配置，用户改过的不碰
    let staleRemoved = false
    for (const b of BUILTIN_MCP_SERVERS) {
      if (b.transport !== 'stdio' || commandAvailable(b.command)) continue
      const stale = existing.find((s) => s.serverName === b.serverName && s.command === b.command)
      if (stale !== undefined) {
        const result = mcpServerDelete(stale.id)
        if (result.ok) {
          staleRemoved = true
          console.log(`[mcp-builtin] 已清理命令失效的内置 MCP 服务器: ${b.serverName}（${b.command} 不可用）`)
          synced.delete(b.serverName)
        } else {
          console.warn(`[mcp-builtin] 清理失败 ${b.serverName}: ${result.error}`)
        }
      }
    }

    for (const entry of newBuiltins) {
      if (entry.transport === 'stdio' && !commandAvailable(entry.command)) {
        console.warn(
          `[mcp-builtin] 跳过 ${entry.serverName}：命令 ${entry.command} 不在 PATH（安装对应运行时后下次启动自动补上）`,
        )
        continue
      }
      // 版本变更时强制覆盖同名条目（修正旧配置；按名字匹配，内置条目
      // 换 command/参数后旧条目也能被换掉）；否则仅追加缺失条目
      const force = versionChanged && existingNames.has(entry.serverName)
      if (!existingNames.has(entry.serverName) || force) {
        const result = mcpServerSave(entry)
        if (result.ok) {
          synced.add(entry.serverName)
          console.log(`[mcp-builtin] 已${force ? '覆盖' : '添加'}内置 MCP 服务器: ${entry.serverName}`)
        } else {
          console.warn(`[mcp-builtin] ${force ? '覆盖' : '添加'}失败 ${entry.serverName}: ${result.error}`)
        }
      } else {
        // 条目已存在且版本未变（用户可能改过配置），标记为已同步但不覆盖
        synced.add(entry.serverName)
      }
    }

    if (newBuiltins.length > 0 || versionChanged || staleRemoved) writeSyncState(synced)
  } catch (error) {
    console.error('[mcp-builtin] 物化失败:', error)
  }
}
