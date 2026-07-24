import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type UserWorkspaceTarget = 'desktop' | 'web'

export type UserWorkspacePaths = {
  root: string
  userRoot: string
  data: string
  thread: string
  threads: string
  workspace: string
  memory: string
  secrets: string
  usage: string
  skills: string
  mcp: string
  tools: string
  automations: string
  artifacts: string
  attachments: string
  logs: string
}

export function defaultUserWorkspaceRoot(
  env: Record<string, string | undefined> = process.env,
  _target: UserWorkspaceTarget = env.QIONGQI_RUNTIME_TARGET === 'desktop' ? 'desktop' : 'web'
): string {
  if (env.QIONGQI_WORKSPACE_DIR?.trim()) return env.QIONGQI_WORKSPACE_DIR.trim()
  return join(env.HOME || env.USERPROFILE || homedir(), '.qiongqi')
}

export function userWorkspacePaths(root: string, userId: string): UserWorkspacePaths {
  const userRoot = join(root, 'users', sanitizeUserId(userId))
  return {
    root,
    userRoot,
    data: join(userRoot, 'data'),
    thread: join(userRoot, 'thread'),
    threads: join(userRoot, 'threads'),
    workspace: join(userRoot, 'workspace'),
    memory: join(userRoot, 'memory'),
    secrets: join(userRoot, 'secrets'),
    usage: join(userRoot, 'usage'),
    skills: join(userRoot, 'skills'),
    mcp: join(userRoot, 'mcp'),
    tools: join(userRoot, 'tools'),
    automations: join(userRoot, 'automations'),
    artifacts: join(userRoot, 'artifacts'),
    attachments: join(userRoot, 'attachments'),
    logs: join(userRoot, 'logs')
  }
}

export async function ensureUserWorkspace(paths: UserWorkspacePaths): Promise<void> {
  await Promise.all([
    mkdir(paths.threads, { recursive: true }),
    mkdir(paths.workspace, { recursive: true }),
    mkdir(paths.memory, { recursive: true }),
    mkdir(paths.mcp, { recursive: true }),
    mkdir(paths.artifacts, { recursive: true }),
    mkdir(paths.attachments, { recursive: true })
  ])
}

function sanitizeUserId(userId: string): string {
  const cleaned = userId.trim().replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+$/, '_')
  return cleaned || 'default'
}
