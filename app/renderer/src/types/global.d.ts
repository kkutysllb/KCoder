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

interface KcoderBridge {
  platform: NodeJS.Platform
  window: {
    minimize: () => void
    maximize: () => void
    close: () => void
  }
  send: (channel: string, ...args: unknown[]) => void
  on: (channel: string, callback: (...args: unknown[]) => void) => void
  off: (channel: string, callback: (...args: unknown[]) => void) => void
  terminal: TerminalApi
  dialog: {
    openFolder: (options?: OpenDialogOptions) => Promise<string | null>
  }
  models: ModelsBridge
}

declare global {
  interface Window {
    kcoder: KcoderBridge
  }
}

export {}
