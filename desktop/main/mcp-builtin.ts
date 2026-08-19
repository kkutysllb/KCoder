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
 * @module desktop/main/mcp-builtin
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dshHome } from './dsh-contract'
import { mcpServerSave, mcpServers, type McpServerEntry } from './mcp-store'

/**
 * 内置定义版本。修改任何内置条目（命令/参数/新增/删除）时递增，触发
 * 已安装用户的全量重写（确保旧错误配置被修正）。
 */
const BUILTIN_VERSION = 2

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
    args: ['-y', '@executeautomation/playwright-mcp-server'],
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

/**
 * 幂等物化内置 MCP 服务器（dsh 启动前调用）。首次启动写入全部条目，升级时
 * 只追加新增项（用户删过的不复活——状态文件记录已处理过的名字）。
 */
export function ensureBuiltinMcpServers(): void {
  try {
    const state = readSyncState()
    const versionChanged = state.version !== BUILTIN_VERSION
    const synced = versionChanged ? new Set<string>() : state.synced

    if (versionChanged) {
      console.log(`[mcp-builtin] 内置定义版本变更 ${state.version} → ${BUILTIN_VERSION}，全量重写`)
    }

    const existing = new Set(mcpServers().map((s) => s.serverName))
    const newBuiltins = BUILTIN_MCP_SERVERS.filter((b) => !synced.has(b.serverName))

    if (newBuiltins.length === 0 && !versionChanged) return

    for (const entry of newBuiltins) {
      // 版本变更时强制覆盖（修正旧错误配置）；否则仅追加缺失条目
      const force = versionChanged && existing.has(entry.serverName)
      if (!existing.has(entry.serverName) || force) {
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

    writeSyncState(synced)
  } catch (error) {
    console.error('[mcp-builtin] 物化失败:', error)
  }
}
