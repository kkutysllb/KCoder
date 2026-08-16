/**
 * Global type declarations for the renderer process.
 *
 * The preload script exposes a `window.kcoder` bridge via contextBridge, but
 * its `declare global` lives in the preload tsconfig and is not visible to
 * the renderer. This file re-declares the bridge shape the renderer relies
 * on so type checking passes without duplicating the implementation.
 *
 * Keep this in sync with app/preload/index.ts.
 */
import type { OpenDialogOptions } from 'electron'

interface TerminalApi {
  create: (options?: { cwd?: string; cols?: number; rows?: number }) => Promise<{
    id: string
    shell: string
    name: string
    cwd: string
  }>
  write: (id: string, data: string) => void
  resize: (id: string, cols: number, rows: number) => void
  kill: (id: string) => Promise<void>
  onData: (callback: (id: string, data: string) => void) => () => void
  onExit: (callback: (id: string, exitCode: number) => void) => () => void
}

interface ModelsBridge {
  list: (userId: string) => Promise<unknown>
  save: (userId: string, name: string, profile: unknown) => Promise<void>
  delete: (userId: string, name: string) => Promise<void>
  activate: (userId: string, name: string) => Promise<void>
  discover: (input: unknown) => Promise<unknown>
}

/** 产品级本地服务（2026-08 重构：主进程 IPC + product_services.py）。 */
interface LocalServicesBridge {
  runtimeConfig: {
    get: (section?: string) => Promise<unknown>
    set: (section: string, value: Record<string, unknown>) => Promise<unknown>
  }
  tokenUsage: {
    stats: (year?: number, month?: number) => Promise<unknown>
    timeseries: (days?: number) => Promise<unknown>
  }
  git: {
    status: (repo: string) => Promise<unknown>
    createBranch: (repo: string, name: string) => Promise<unknown>
    commit: (repo: string, message: string) => Promise<unknown>
    push: (repo: string) => Promise<unknown>
    branches: (repo: string) => Promise<unknown>
    log: (repo: string, n?: number) => Promise<unknown>
    repoExists: (repo: string) => Promise<boolean>
  }
}

interface KcoderBridge {
  platform: NodeJS.Platform
  window: {
    minimize: () => void
    maximize: () => void
    close: () => void
  }
  send: (channel: string, ...args: unknown[]) => void
  /** Restart the Python sidecar engine, returns new port + token. */
  restartEngine: () => Promise<{ port: number; token: string }>
  on: (channel: string, callback: (...args: unknown[]) => void) => void
  off: (channel: string, callback: (...args: unknown[]) => void) => void
  terminal: TerminalApi
  dialog: {
    openFolder: (options?: OpenDialogOptions) => Promise<string | null>
    /** 在 Finder/资源管理器中显示路径（目录打开，文件定位高亮）。 */
    showInFolder?: (targetPath: string) => Promise<void>
  }
  models: ModelsBridge
  /** Trigger config.yaml re-sync of sub_agents.json → custom_agents. */
  syncSubAgents: () => Promise<void>
  local: LocalServicesBridge
}

declare global {
  interface Window {
    kcoder: KcoderBridge
  }
}

export {}
