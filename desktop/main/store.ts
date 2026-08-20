/**
 * 桌面端自身设置的极简 JSON 存储（无第三方依赖）。
 *
 * 仅保存桌面壳的偏好（窗口状态等）；dsh 会话、凭据、插件等
 * 一律由上游在 `$DSH_HOME` 中持久化，桌面端不越界。
 *
 * @module desktop/main/store
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { StyleSettings } from '@shared/ipc-contract'

/** 样式定制的默认档（与 style-overlay 定值表一致：紧凑密度 + 1080 列宽）。 */
export const DEFAULT_STYLE: StyleSettings = {
  enabled: true,
  density: 'compact',
  contentWidth: 'extra',
}

/** 持久化的设置形状。 */
export interface DesktopSettings {
  /** 主窗口（承载上游 Web UI 的窗口）上次的 bounds。 */
  windowBounds: { x: number; y: number; width: number; height: number } | null
  /** 关闭主窗口时是否最小化到托盘（false = 直接退出 dsh 与应用）。 */
  keepRunningInTray: boolean
  /** 上游 Web UI 最后已知的渲染主题（用于启动时预置原生外观，避免闪烁）。 */
  lastTheme: 'system' | 'light' | 'dark'
  /** 界面样式定制（预设档位，见 style-overlay）。 */
  style: StyleSettings
}

const DEFAULTS: DesktopSettings = {
  windowBounds: null,
  keepRunningInTray: true,
  lastTheme: 'system',
  style: DEFAULT_STYLE,
}

let cache: DesktopSettings | null = null

function storePath(): string {
  return join(app.getPath('userData'), 'desktop-settings.json')
}

/** 读取设置（缺省合并，坏文件回退默认值）。 */
export function getSettings(): DesktopSettings {
  if (cache !== null) return cache
  try {
    const raw = JSON.parse(readFileSync(storePath(), 'utf8')) as Partial<DesktopSettings>
    cache = { ...DEFAULTS, ...raw, style: { ...DEFAULT_STYLE, ...raw.style } }
  } catch {
    cache = { ...DEFAULTS }
  }
  return cache
}

/** 写回设置（同步小文件，容忍原子性折衷）。 */
export function saveSettings(patch: Partial<DesktopSettings>): void {
  const next = { ...getSettings(), ...patch }
  cache = next
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(storePath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  } catch (error) {
    console.error('[store] persist failed:', error)
  }
}
