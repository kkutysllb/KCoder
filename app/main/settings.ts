import { join } from 'path'
import { homedir } from 'os'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { ipcMain, session } from 'electron'

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

// ── save-settings IPC handler ───────────────────────────────────

/** renderer 通过 save-settings 传入的常规偏好中与 main 进程相关的子集。 */
interface GeneralPrefsPayload {
  httpProxy?: string
  noProxy?: string
  certPath?: string
}

/**
 * 将 renderer 的常规偏好应用到 main 进程网络层。
 *
 * - HTTP 代理：Electron session.setProxy 即时生效（renderer + main fetch）
 * - 自定义证书：注入 NODE_EXTRA_CA_CERTS 环境变量（sidecar 需重启才继承）
 */
function applyGeneralSettings(prefs: GeneralPrefsPayload): void {
  // 1. Proxy
  const proxyUrl = prefs.httpProxy?.trim()
  const noProxy = prefs.noProxy?.trim()
  if (proxyUrl) {
    // bypass list: 逗号分隔转分号分隔（Electron proxyBypassRules 格式）
    const bypass = noProxy
      ? noProxy.split(',').map((s) => s.trim()).filter(Boolean).join(';')
      : '<local>'
    session.defaultSession.setProxy({
      proxyRules: proxyUrl,
      proxyBypassRules: bypass || undefined
    })
    console.log(`[KCoder] Proxy applied: ${proxyUrl} (bypass: ${bypass})`)
  } else {
    session.defaultSession.setProxy({ proxyRules: 'direct://' })
    console.log('[KCoder] Proxy cleared (direct connection)')
  }

  // 2. Custom cert — 注入环境变量
  const certPath = prefs.certPath?.trim()
  if (certPath) {
    process.env.NODE_EXTRA_CA_CERTS = certPath
    console.log(`[KCoder] NODE_EXTRA_CA_CERTS set to ${certPath}`)
  } else {
    delete process.env.NODE_EXTRA_CA_CERTS
  }
}

/**
 * 注册 save-settings IPC handler。
 *
 * renderer 在常规设置保存时（savePrefs）以及启动时（App.tsx 初始化）
 * 都会 send 'save-settings'，main 收到后提取 general 偏好应用到网络层。
 */
export function setupSettingsIPC(): void {
  ipcMain.on('save-settings', (_event, payload: unknown) => {
    const data = payload as { general?: Record<string, unknown> }
    if (data?.general) {
      applyGeneralSettings(data.general as GeneralPrefsPayload)
    }
  })
}
