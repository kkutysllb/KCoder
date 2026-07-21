import { join } from 'path'
import { homedir } from 'os'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'

export interface AppSettings {
  // Model configuration
  apiKey: string
  baseUrl: string
  model: string

  // Engine configuration
  approvalPolicy: 'auto' | 'on-request' | 'always'
  tokenEconomyMode: boolean

  // Workspace
  defaultWorkspacePath: string | null

  // UI preferences
  theme: 'dark' | 'light' | 'system'
  fontSize: number
}

const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  approvalPolicy: 'auto',
  tokenEconomyMode: true,
  defaultWorkspacePath: null,
  theme: 'dark',
  fontSize: 14
}

let settingsPath: string = ''
let cachedSettings: AppSettings | null = null

function getSettingsPath(): string {
  if (!settingsPath) {
    // User settings live under ~/.kcoder (not in project root)
    settingsPath = join(homedir(), '.kcoder', 'settings.json')
  }
  return settingsPath
}

export function loadSettings(): AppSettings {
  if (cachedSettings) {
    return cachedSettings
  }

  const path = getSettingsPath()

  if (existsSync(path)) {
    try {
      const content = readFileSync(path, 'utf-8')
      const parsed = JSON.parse(content)
      cachedSettings = { ...DEFAULT_SETTINGS, ...parsed }
      return cachedSettings!
    } catch (error) {
      console.error('[KCoder] Failed to load settings:', error)
    }
  }

  cachedSettings = { ...DEFAULT_SETTINGS }
  return cachedSettings
}

export function saveSettings(settings: Partial<AppSettings>): AppSettings {
  const current = loadSettings()
  const updated = { ...current, ...settings }

  const path = getSettingsPath()
  const dir = join(path, '..')

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  try {
    writeFileSync(path, JSON.stringify(updated, null, 2), 'utf-8')
    cachedSettings = updated
    console.log('[KCoder] Settings saved')
  } catch (error) {
    console.error('[KCoder] Failed to save settings:', error)
  }

  return updated
}

export function getSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
  return loadSettings()[key]
}

export function setSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K]
): void {
  saveSettings({ [key]: value })
}
