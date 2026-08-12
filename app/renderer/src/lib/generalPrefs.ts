/**
 * 常规设置偏好读取工具（轻量级，不走 Zustand）。
 *
 * SettingsPanel 侧通过 savePrefs() 写入 localStorage，
 * 消费侧（ChatPanel / InfoPanel / useChat）通过本模块读取。
 *
 * 偏好变更频率低，消费组件（ChatPanel 等）在消息变化 / 面板开合时
 * 都会重新渲染，因此直接读 localStorage 即可拿到最新值，无需订阅。
 */

const STORAGE_KEY = 'kcoder-general-prefs'

export interface GeneralPrefs {
  theme: 'dark' | 'light' | 'system'
  language: 'zh-CN' | 'en'
  taskNotification: boolean
  notificationSound: boolean
  showThinking: boolean
  showTodo: boolean
  interactionMode: 'queue' | 'guide'
  autoArchive: boolean
  archiveRetention: '7d' | '14d' | '30d' | '90d'
  certPath: string
  dataPath: string
}

const DEFAULT_PREFS: GeneralPrefs = {
  theme: 'dark',
  language: 'zh-CN',
  taskNotification: true,
  notificationSound: true,
  showThinking: true,
  showTodo: true,
  interactionMode: 'queue',
  autoArchive: true,
  archiveRetention: '7d',
  certPath: '',
  dataPath: '',
}

/** 读取全部常规偏好（合并默认值）。 */
export function getGeneralPrefs(): GeneralPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS
  } catch {
    return DEFAULT_PREFS
  }
}

/** 读取单个偏好字段。 */
export function getGeneralPref<K extends keyof GeneralPrefs>(key: K): GeneralPrefs[K] {
  return getGeneralPrefs()[key]
}
