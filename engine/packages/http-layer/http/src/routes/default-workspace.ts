import { join } from 'node:path'
import type { ServerRuntime } from './server-runtime.js'

export function defaultThreadWorkspace(runtime: ServerRuntime, workModeId?: string): string {
  const root = workspaceRootFromRuntimeDataDir(runtime.info().dataDir)
  if (workModeId?.trim().toLowerCase() === 'coding') {
    return process.env.QIONGQI_CODING_HOME?.trim() || join(root, 'coding-workspace')
  }
  return join(root, 'users', workspaceUserIdFromRuntimeDataDir(runtime.info().dataDir), 'workspace')
}

function workspaceRootFromRuntimeDataDir(dataDir: string): string {
  const parts = dataDir.split(/[\\/]+/)
  const usersIndex = parts.lastIndexOf('users')
  if (usersIndex < 0) return dataDir
  const leadingSlash = dataDir.startsWith('/') ? '/' : ''
  return leadingSlash + parts.slice(0, usersIndex).filter(Boolean).join('/')
}

function workspaceUserIdFromRuntimeDataDir(dataDir: string): string {
  const parts = dataDir.split(/[\\/]+/).filter(Boolean)
  const usersIndex = parts.lastIndexOf('users')
  return usersIndex >= 0 && parts[usersIndex + 1] ? parts[usersIndex + 1]! : 'runtime'
}
