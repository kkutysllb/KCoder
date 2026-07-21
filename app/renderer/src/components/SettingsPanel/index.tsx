import { useState, useEffect, type ReactNode } from 'react'
import { useAppStore } from '../../stores/app-store'
import { useI18n } from '../../i18n'
import { SkillsSettings } from './SkillsSettings'

interface SettingsPanelProps {
  isOpen: boolean
  onClose: () => void
}

// Navigation items
const NAV_ITEMS = [
  { id: 'general', labelKey: 'settings.nav.general', icon: GearIcon },
  { id: 'preview', labelKey: 'settings.nav.preview', icon: CodeIcon },
  { id: 'model', labelKey: 'settings.nav.model', icon: ModelIcon },
  { id: 'skills', labelKey: 'settings.nav.skills', icon: SkillIcon },
  { id: 'remote', labelKey: 'settings.nav.remote', icon: RemoteIcon },
  { id: 'advanced', labelKey: 'settings.nav.advanced', icon: AdvancedIcon },
  { id: 'about', labelKey: 'settings.nav.about', icon: AboutIcon },
]

// Provider data
interface Provider {
  id: string
  name: string
  category: string
  enabled: boolean
  baseUrl: string
  apiKey: string
  models: { name: string; context: string }[]
}

const DEFAULT_PROVIDERS: Provider[] = [
  {
    id: 'bigmodel',
    name: 'BigModel',
    category: '智谱',
    enabled: false,
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKey: '',
    models: [
      { name: 'GLM-5.2', context: '100万' },
      { name: 'GLM-5-Turbo', context: '20万' },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    category: '自定义供应商',
    enabled: false,
    baseUrl: 'https://api.deepseek.com',
    apiKey: '',
    models: [
      { name: 'deepseek-chat', context: '64K' },
      { name: 'deepseek-coder', context: '128K' },
    ],
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    category: '自定义供应商',
    enabled: false,
    baseUrl: 'https://api.minimax.chat/v1',
    apiKey: '',
    models: [{ name: 'MiniMax-Text-01', context: '100万' }],
  },
  {
    id: 'vllm',
    name: 'vLLM',
    category: '自定义供应商',
    enabled: false,
    baseUrl: 'http://localhost:8000/v1',
    apiKey: '',
    models: [],
  },
  {
    id: 'gpt',
    name: 'GPT',
    category: '自定义供应商',
    enabled: false,
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    models: [
      { name: 'gpt-4o', context: '128K' },
      { name: 'gpt-4o-mini', context: '128K' },
    ],
  },
  {
    id: 'claude',
    name: 'Claude',
    category: '自定义供应商',
    enabled: false,
    baseUrl: 'https://api.anthropic.com',
    apiKey: '',
    models: [
      { name: 'claude-sonnet-4-20250514', context: '200K' },
      { name: 'claude-haiku-4-20250514', context: '200K' },
    ],
  },
]

export function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const { engineStatus, enginePort } = useAppStore()
  const [activeNav, setActiveNav] = useState('general')
  const { t } = useI18n()
  const [providers, setProviders] = useState<Provider[]>(DEFAULT_PROVIDERS)
  const [selectedProviderId, setSelectedProviderId] = useState<string>('bigmodel')
  const [connectionType, setConnectionType] = useState('个人套餐')

  if (!isOpen) return null

  const selectedProvider = providers.find((p) => p.id === selectedProviderId)

  const handleToggleProvider = (id: string) => {
    setProviders((prev) =>
      prev.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p))
    )
  }

  const handleUpdateApiKey = (id: string, apiKey: string) => {
    setProviders((prev) =>
      prev.map((p) => (p.id === id ? { ...p, apiKey } : p))
    )
  }

  const handleSave = () => {
    // Save to electron store via IPC
    const enabledProviders = providers.filter((p) => p.enabled && p.apiKey)
    console.log('[KCoder] Saving provider config:', enabledProviders.map(p => p.name))
    window.kcoder?.send('save-settings', { providers: enabledProviders })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex bg-bg-primary">
      {/* Left Navigation */}
      <div className="w-[200px] border-r border-border-custom bg-bg-surface flex flex-col">
        {/* Back button - leave space for real macOS traffic lights (hiddenInset) */}
        <div className="h-12 flex items-center px-4">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 ml-14 px-2 py-1 rounded-md text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            {t('settings.backToWorkspace')}
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveNav(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                activeNav === item.id
                  ? 'bg-bg-input text-text-primary font-medium'
                  : 'text-text-muted hover:text-text-secondary hover:bg-bg-sidebar'
              }`}
            >
              <item.icon active={activeNav === item.id} />
              {t(item.labelKey)}
            </button>
          ))}
        </nav>

        {/* Engine status */}
        <div className="px-4 py-3 border-t border-border-custom">
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span className={`w-2 h-2 rounded-full ${engineStatus === 'connected' ? 'bg-[#22c55e]' : 'bg-[#ef4444]'}`} />
            {t('settings.engine')}{engineStatus === 'connected' ? t('settings.engineConnected') : t('settings.engineDisconnected')} · :{enginePort}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {activeNav === 'model' ? (
          <ModelSettings
            providers={providers}
            selectedProvider={selectedProvider}
            selectedProviderId={selectedProviderId}
            connectionType={connectionType}
            onSelectProvider={setSelectedProviderId}
            onToggleProvider={handleToggleProvider}
            onUpdateApiKey={handleUpdateApiKey}
            onConnectionTypeChange={setConnectionType}
            onSave={handleSave}
            onClose={onClose}
          />
        ) : activeNav === 'general' ? (
          <GeneralSettings />
        ) : activeNav === 'preview' ? (
          <CodePreviewSettings />
        ) : activeNav === 'skills' ? (
          <SkillsSettings />
        ) : (
          <PlaceholderSettings navId={activeNav} onClose={onClose} />
        )}
      </div>
    </div>
  )
}

// ============ Model Settings Page ============
function ModelSettings({
  providers,
  selectedProvider,
  selectedProviderId,
  connectionType,
  onSelectProvider,
  onToggleProvider,
  onUpdateApiKey,
  onConnectionTypeChange,
  onSave,
  onClose,
}: {
  providers: Provider[]
  selectedProvider?: Provider
  selectedProviderId: string
  connectionType: string
  onSelectProvider: (id: string) => void
  onToggleProvider: (id: string) => void
  onUpdateApiKey: (id: string, key: string) => void
  onConnectionTypeChange: (v: string) => void
  onSave: () => void
  onClose: () => void
}) {
  const { t } = useI18n()
  // Group providers by category
  const categories = providers.reduce<Record<string, Provider[]>>((acc, p) => {
    if (!acc[p.category]) acc[p.category] = []
    acc[p.category].push(p)
    return acc
  }, {})

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-8 pt-8 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-text-primary">模型设置</h1>
            <p className="mt-1 text-sm text-text-muted">管理自定义模型供应商，配置后可在聊天时选择使用。</p>
          </div>
          <div className="flex items-center gap-3">
            <button className="p-2 rounded-lg text-text-muted hover:text-text-secondary hover:bg-bg-hover transition-colors">
              <RefreshIcon />
            </button>
            <select
              value={connectionType}
              onChange={(e) => onConnectionTypeChange(e.target.value)}
              className="px-3 py-1.5 rounded-lg text-sm bg-bg-input border border-border-custom text-text-primary outline-none cursor-pointer"
            >
              <option value="个人套餐">个人套餐</option>
              <option value="团队套餐">团队套餐</option>
              <option value="API 直连">API 直连</option>
            </select>
          </div>
        </div>
      </div>

      {/* Two-column content */}
      <div className="flex-1 flex overflow-hidden px-8 pb-8 gap-6">
        {/* Left: Provider List */}
        <div className="w-[240px] flex flex-col border-r border-border-custom pr-6">
          <div className="flex-1 overflow-y-auto space-y-4">
            {Object.entries(categories).map(([category, items]) => (
              <div key={category}>
                <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">{category}</h3>
                <div className="space-y-1">
                  {items.map((provider) => (
                    <button
                      key={provider.id}
                      onClick={() => onSelectProvider(provider.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                        selectedProviderId === provider.id
                          ? 'bg-bg-input text-text-primary'
                          : 'text-text-secondary hover:bg-bg-sidebar hover:text-text-primary'
                      }`}
                    >
                      <ProviderIcon name={provider.name} />
                      <span className="flex-1 text-left">{provider.name}</span>
                      <span className={`w-2 h-2 rounded-full ${provider.enabled ? 'bg-[#22c55e]' : 'bg-[#3f3f46]'}`} />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Add provider button */}
          <button className="mt-4 w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-dashed border-border-custom text-sm text-text-muted hover:text-text-secondary hover:border-[#52525b] transition-colors">
            <PlusIcon />
                        {t('settings.model.addProvider')}
          </button>
        </div>

        {/* Right: Provider Detail */}
        <div className="flex-1 overflow-y-auto">
          {selectedProvider ? (
            <ProviderDetail
              provider={selectedProvider}
              onToggle={onToggleProvider}
              onUpdateApiKey={onUpdateApiKey}
              onSave={onSave}
              onClose={onClose}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-text-muted">
              选择一个供应商查看详情
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ============ Provider Detail ============
function ProviderDetail({
  provider,
  onToggle,
  onUpdateApiKey,
  onSave,
  onClose,
}: {
  provider: Provider
  onToggle: (id: string) => void
  onUpdateApiKey: (id: string, key: string) => void
  onSave: () => void
  onClose: () => void
}) {
  const { t } = useI18n()
  return (
    <div className="space-y-6">
      {/* Provider header */}
      <div className="flex items-center gap-3">
        <ProviderIcon name={provider.name} size="lg" />
        <h2 className="text-lg font-semibold text-text-primary">{provider.name}</h2>
        <span
          className={`px-2 py-0.5 rounded text-xs font-medium ${
            provider.enabled
              ? 'bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/20'
              : 'bg-[#3f3f46]/30 text-text-muted border border-border-strong'
          }`}
        >
          {provider.enabled ? t('settings.model.enabled') : t('settings.model.disabled')}
        </span>
      </div>

      {/* Enable toggle */}
      <div className="flex items-center justify-between p-4 rounded-xl bg-bg-surface border border-border-custom">
        <div>
          <p className="text-sm font-medium text-text-primary">{t('settings.model.enable')}</p>
          <p className="text-xs text-text-muted mt-0.5">{t('settings.model.enable.desc')}</p>
        </div>
        <button
          onClick={() => onToggle(provider.id)}
          className={`relative w-11 h-6 rounded-full transition-colors ${
            provider.enabled ? 'bg-[#22c55e]' : 'bg-[#3f3f46]'
          }`}
        >
          <span
            className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
              provider.enabled ? 'translate-x-[22px]' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      {/* API Configuration */}
      <div className="p-4 rounded-xl bg-bg-surface border border-border-custom space-y-4">
        <h3 className="text-sm font-medium text-text-primary">{t('settings.model.apiConfig')}</h3>
        <div>
          <label className="block text-xs text-text-muted mb-1.5">{t('settings.model.apiUrl')}</label>
          <input
            type="text"
            value={provider.baseUrl}
            readOnly
            className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border-custom text-sm text-text-secondary outline-none"
          />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1.5">API Key</label>
          <input
            type="password"
            value={provider.apiKey}
            onChange={(e) => onUpdateApiKey(provider.id, e.target.value)}
            placeholder={t('settings.model.apiKey.placeholder')}
            className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border-custom text-sm text-text-primary placeholder-text-muted outline-none focus:border-border-strong transition-colors"
          />
        </div>
      </div>

      {/* Model List */}
      <div className="p-4 rounded-xl bg-bg-surface border border-border-custom">
        <h3 className="text-sm font-medium text-text-primary mb-3">{t('settings.model.modelList')}</h3>
        {provider.models.length > 0 ? (
          <div className="space-y-2">
            {provider.models.map((model) => (
              <div
                key={model.name}
                className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-bg-hover border border-border-custom"
              >
                <span className="text-sm text-text-primary">{model.name}</span>
                <span className="text-xs text-text-muted">{model.context}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-text-muted">{t('settings.model.noModels')}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-lg text-sm text-text-secondary hover:bg-bg-hover transition-colors"
        >
          {t('settings.model.cancel')}
        </button>
        <button
          onClick={onSave}
          className="px-5 py-2 rounded-lg text-sm font-medium bg-white text-black hover:bg-gray-200 transition-colors"
        >
          {t('settings.model.saveConfig')}
        </button>
      </div>
    </div>
  )
}

// ============ General Settings Page ============

// Persisted general settings (localStorage)
interface GeneralPrefs {
  theme: 'dark' | 'light' | 'system'
  language: 'zh-CN' | 'en'
  taskNotification: boolean
  notificationSound: boolean
  showThinking: boolean
  showTodo: boolean
  interactionMode: 'queue' | 'guide'
  autoArchive: boolean
  archiveRetention: '7d' | '14d' | '30d' | '90d'
  httpProxy: string
  noProxy: string
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
  httpProxy: '',
  noProxy: '',
  certPath: '',
  dataPath: '',
}

function loadPrefs(): GeneralPrefs {
  try {
    const raw = localStorage.getItem('kcoder-general-prefs')
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS
  } catch {
    return DEFAULT_PREFS
  }
}

function savePrefs(prefs: GeneralPrefs) {
  localStorage.setItem('kcoder-general-prefs', JSON.stringify(prefs))
  // Reserved: sync to main process for backend integration
  window.kcoder?.send('save-settings', { general: prefs })
}

function GeneralSettings() {
  const [prefs, setPrefs] = useState<GeneralPrefs>(loadPrefs)
  const { t, setLocale } = useI18n()

  // Apply theme to document root
  useEffect(() => {
    const root = document.documentElement
    const mq = window.matchMedia('(prefers-color-scheme: light)')

    const apply = () => {
      const isLight = prefs.theme === 'light' || (prefs.theme === 'system' && mq.matches)
      root.classList.toggle('theme-light', isLight)
    }

    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [prefs.theme])

  const update = <K extends keyof GeneralPrefs>(key: K, value: GeneralPrefs[K]) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value }
      savePrefs(next)
      return next
    })
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-8 pt-8 pb-6">
        <h1 className="max-w-[680px] mx-auto text-lg font-semibold text-text-primary">{t('settings.general.title')}</h1>
      </div>

      {/* Settings list */}
      <div className="flex-1 overflow-y-auto px-8 pb-8">
        <div className="max-w-[680px] mx-auto bg-bg-surface border border-border-subtle rounded-xl px-6 divide-y divide-border-subtle">
          {/* 界面主题 */}
          <SettingRow title={t('settings.general.theme')} desc={t('settings.general.theme.desc')}>
            <SelectControl
              value={prefs.theme}
              onChange={(v) => update('theme', v as GeneralPrefs['theme'])}
              options={[
                { value: 'dark', label: t('settings.general.theme.dark') },
                { value: 'light', label: t('settings.general.theme.light') },
                { value: 'system', label: t('settings.general.theme.system') },
              ]}
            />
          </SettingRow>

          {/* 界面语言 */}
          <SettingRow title={t('settings.general.language')} desc={t('settings.general.language.desc')}>
            <SelectControl
              value={prefs.language}
              onChange={(v) => {
                update('language', v as GeneralPrefs['language'])
                setLocale(v as 'zh-CN' | 'en')
              }}
              options={[
                { value: 'zh-CN', label: '简体中文' },
                { value: 'en', label: 'English' },
              ]}
            />
          </SettingRow>

          {/* 任务通知 */}
          <SettingRow title={t('settings.general.notification')} desc={t('settings.general.notification.desc')}>
            <ToggleControl checked={prefs.taskNotification} onChange={(v) => update('taskNotification', v)} />
          </SettingRow>

          {/* 通知声音 */}
          <SettingRow title={t('settings.general.sound')} desc={t('settings.general.sound.desc')}>
            <ToggleControl checked={prefs.notificationSound} onChange={(v) => update('notificationSound', v)} />
          </SettingRow>

          {/* 显示思考过程 */}
          <SettingRow title={t('settings.general.thinking')} desc={t('settings.general.thinking.desc')}>
            <ToggleControl checked={prefs.showThinking} onChange={(v) => update('showThinking', v)} />
          </SettingRow>

          {/* 显示待办 */}
          <SettingRow title={t('settings.general.todo')} desc={t('settings.general.todo.desc')}>
            <ToggleControl checked={prefs.showTodo} onChange={(v) => update('showTodo', v)} />
          </SettingRow>

          {/* 交互行为 */}
          <SettingRow title={t('settings.general.interaction')} desc={t('settings.general.interaction.desc')}>
            <SelectControl
              value={prefs.interactionMode}
              onChange={(v) => update('interactionMode', v as GeneralPrefs['interactionMode'])}
              options={[
                { value: 'queue', label: t('settings.general.interaction.queue') },
                { value: 'guide', label: t('settings.general.interaction.guide') },
              ]}
            />
          </SettingRow>

          {/* 自动归档旧任务 */}
          <SettingRow title={t('settings.general.archive')} desc={t('settings.general.archive.desc')}>
            <ToggleControl checked={prefs.autoArchive} onChange={(v) => update('autoArchive', v)} />
          </SettingRow>

          {/* 归档保留时长 */}
          <SettingRow title={t('settings.general.retention')} desc={t('settings.general.retention.desc')}>
            <SelectControl
              value={prefs.archiveRetention}
              onChange={(v) => update('archiveRetention', v as GeneralPrefs['archiveRetention'])}
              options={[
                { value: '7d', label: t('settings.general.retention.7d') },
                { value: '14d', label: t('settings.general.retention.14d') },
                { value: '30d', label: t('settings.general.retention.30d') },
                { value: '90d', label: t('settings.general.retention.90d') },
              ]}
            />
          </SettingRow>

          {/* HTTP 代理 */}
          <SettingInputRow
            title={t('settings.general.proxy')}
            desc={t('settings.general.proxy.desc')}
            value={prefs.httpProxy}
            onChange={(v) => update('httpProxy', v)}
            placeholder={t('settings.general.proxy.placeholder')}
          />

          {/* No Proxy */}
          <SettingInputRow
            title={t('settings.general.noProxy')}
            desc={t('settings.general.noProxy.desc')}
            value={prefs.noProxy}
            onChange={(v) => update('noProxy', v)}
            placeholder={t('settings.general.noProxy.placeholder')}
          />

          {/* 自定义证书 */}
          <SettingInputRow
            title={t('settings.general.cert')}
            desc={t('settings.general.cert.desc')}
            value={prefs.certPath}
            onChange={(v) => update('certPath', v)}
            placeholder={t('settings.general.cert.placeholder')}
          />

          {/* 数据存储路径 */}
          <SettingInputRow
            title={t('settings.general.dataPath')}
            desc={t('settings.general.dataPath.desc')}
            value={prefs.dataPath}
            onChange={(v) => update('dataPath', v)}
            placeholder={t('settings.general.dataPath.placeholder')}
            extraButton={
              <button
                className="shrink-0 px-3 py-1.5 rounded-lg text-xs bg-bg-input text-text-secondary hover:bg-bg-active hover:text-text-primary transition-colors"
                onClick={() => {
                  // Reserved: invoke Electron dialog.showOpenDialog via IPC
                  console.log('[KCoder] TODO: open folder picker via IPC')
                }}
              >
                {t('settings.general.browse')}
              </button>
            }
          />
        </div>
      </div>
    </div>
  )
}

// Setting row: flat layout with title+desc left, control right (matching reference design)
function SettingRow({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-text-primary">{title}</p>
        <p className="text-xs text-text-muted mt-1 leading-relaxed">{desc}</p>
      </div>
      <div className="shrink-0 flex items-center">{children}</div>
    </div>
  )
}

// Setting row with input field below description (for text-type settings)
function SettingInputRow({ title, desc, value, onChange, placeholder, extraButton }: {
  title: string
  desc: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  extraButton?: ReactNode
}) {
  const { t } = useI18n()
  return (
    <div className="py-5">
      <p className="text-sm font-medium text-text-primary">{title}</p>
      <p className="text-xs text-text-muted mt-1 leading-relaxed">{desc}</p>
      <div className="flex items-center gap-2 mt-3">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 px-3 py-2 rounded-lg text-sm bg-bg-hover border border-border-custom text-text-primary placeholder-text-muted outline-none focus:border-border-strong transition-colors"
        />
        {extraButton}
        <button className="shrink-0 px-4 py-2 rounded-lg text-xs bg-bg-input text-text-primary hover:bg-bg-active transition-colors">
          {t('settings.general.save')}
        </button>
      </div>
    </div>
  )
}

// Toggle switch: gray track + white knob (matches reference design)
function ToggleControl({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="relative inline-flex items-center cursor-pointer">
      <input
        type="checkbox"
        className="sr-only peer"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div
        className="rounded-full bg-[#3a3a42] peer-checked:bg-[#4d4d57] transition-colors duration-200"
        style={{ width: 48, height: 28 }}
      />
      <div
        className="absolute top-[3px] left-[3px] rounded-full bg-white shadow-sm transition-transform duration-200"
        style={{ width: 22, height: 22, transform: checked ? 'translateX(20px)' : 'translateX(0)' }}
      />
    </label>
  )
}

// Dropdown select
function SelectControl({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-3 py-1.5 rounded-lg text-[13px] bg-bg-hover border border-border-custom text-text-primary outline-none cursor-pointer hover:border-[#52525b] transition-colors"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  )
}

// ============ Code Preview Settings Page ============

interface CodePreviewPrefs {
  lightTheme: string
  darkTheme: string
  showLineNumbers: boolean
  wordWrap: boolean
  fontSize: number
}

const DEFAULT_CODE_PREFS: CodePreviewPrefs = {
  lightTheme: 'github-light',
  darkTheme: 'github-dark',
  showLineNumbers: true,
  wordWrap: true,
  fontSize: 14,
}

function loadCodePrefs(): CodePreviewPrefs {
  try {
    const raw = localStorage.getItem('kcoder-code-preview-prefs')
    return raw ? { ...DEFAULT_CODE_PREFS, ...JSON.parse(raw) } : DEFAULT_CODE_PREFS
  } catch {
    return DEFAULT_CODE_PREFS
  }
}

const CODE_THEME_OPTIONS = [
  { value: 'github-light', label: 'GitHub Light' },
  { value: 'github-dark', label: 'GitHub Dark' },
  { value: 'monokai', label: 'Monokai' },
  { value: 'dracula', label: 'Dracula' },
  { value: 'solarized', label: 'Solarized' },
]

// Demo code for preview
const PREVIEW_CODE = `const theme = {
  surface: "sidebar",
  accent: "#339CFF",
  contrast: 45
}`

// Simple syntax highlighter: returns spans
function highlightLine(line: string, dark: boolean): ReactNode[] {
  const tokens: ReactNode[] = []
  // keyword | string | number | property | punctuation
  const regex = /(\b(?:const|let|var|function|return|type|interface)\b)|("[^"]*")|(\b\d+\b)|([a-zA-Z_]\w*(?=\s*:))|(.)/g
  let match: RegExpExecArray | null
  let key = 0
  const colors = dark
    ? { keyword: '#7dd3fc', string: '#a5d6a7', number: '#f9a8d4', prop: '#e4e4e7', other: '#9ca3af' }
    : { keyword: '#7c3aed', string: '#16a34a', number: '#0550ae', prop: '#1f2937', other: '#6b7280' }
  while ((match = regex.exec(line)) !== null) {
    const [, kw, str, num, prop, other] = match
    if (kw) tokens.push(<span key={key++} style={{ color: colors.keyword }}>{kw}</span>)
    else if (str) tokens.push(<span key={key++} style={{ color: colors.string }}>{str}</span>)
    else if (num) tokens.push(<span key={key++} style={{ color: colors.number }}>{num}</span>)
    else if (prop) tokens.push(<span key={key++} style={{ color: colors.prop }}>{prop}</span>)
    else tokens.push(<span key={key++} style={{ color: colors.other }}>{other}</span>)
  }
  return tokens
}

function CodePreviewCard({ label, themeName, tag, dark, prefs }: {
  label: string
  themeName: string
  tag: string
  dark: boolean
  prefs: CodePreviewPrefs
}) {
  const lines = PREVIEW_CODE.split('\n')
  return (
    <div className="flex-1 min-w-0">
      {/* Card header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary">{label}</span>
          <span className="text-xs text-text-muted">{themeName}</span>
        </div>
        <span className="px-2 py-0.5 rounded text-[11px] bg-bg-hover text-text-muted border border-border-custom">{tag}</span>
      </div>
      {/* Code area */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{
          backgroundColor: dark ? '#1e1e1e' : '#f8f9fa',
          borderColor: dark ? '#303030' : '#e0e0e0',
        }}
      >
        <pre className="p-4 overflow-x-auto" style={{ fontSize: prefs.fontSize, lineHeight: 1.6 }}>
          {lines.map((line, i) => (
            <div key={i} className="flex" style={{ whiteSpace: prefs.wordWrap ? 'pre-wrap' : 'pre' }}>
              {prefs.showLineNumbers && (
                <span
                  className="select-none text-right shrink-0 pr-4"
                  style={{ color: dark ? '#6b7280' : '#9ca3af', minWidth: '2em' }}
                >
                  {i + 1}
                </span>
              )}
              <code>{highlightLine(line, dark)}</code>
            </div>
          ))}
        </pre>
      </div>
    </div>
  )
}

function CodePreviewSettings() {
  const { t } = useI18n()
  const [prefs, setPrefs] = useState<CodePreviewPrefs>(loadCodePrefs)

  const update = <K extends keyof CodePreviewPrefs>(key: K, value: CodePreviewPrefs[K]) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value }
      localStorage.setItem('kcoder-code-preview-prefs', JSON.stringify(next))
      window.kcoder?.send('save-settings', { codePreview: next })
      return next
    })
  }

  const lightLabel = CODE_THEME_OPTIONS.find((o) => o.value === prefs.lightTheme)?.label ?? prefs.lightTheme
  const darkLabel = CODE_THEME_OPTIONS.find((o) => o.value === prefs.darkTheme)?.label ?? prefs.darkTheme

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-8 pt-8 pb-6">
        <h1 className="max-w-[680px] mx-auto text-lg font-semibold text-text-primary">{t('settings.preview.title')}</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-8">
        <div className="max-w-[680px] mx-auto space-y-6">
          {/* Settings card */}
          <div className="bg-bg-surface border border-border-subtle rounded-xl px-6 divide-y divide-border-subtle">
            <SettingRow title={t('settings.preview.lightTheme')} desc={t('settings.preview.lightTheme.desc')}>
              <SelectControl
                value={prefs.lightTheme}
                onChange={(v) => update('lightTheme', v)}
                options={CODE_THEME_OPTIONS}
              />
            </SettingRow>

            <SettingRow title={t('settings.preview.darkTheme')} desc={t('settings.preview.darkTheme.desc')}>
              <SelectControl
                value={prefs.darkTheme}
                onChange={(v) => update('darkTheme', v)}
                options={CODE_THEME_OPTIONS}
              />
            </SettingRow>

            <SettingRow title={t('settings.preview.lineNumbers')} desc={t('settings.preview.lineNumbers.desc')}>
              <ToggleControl checked={prefs.showLineNumbers} onChange={(v) => update('showLineNumbers', v)} />
            </SettingRow>

            <SettingRow title={t('settings.preview.wordWrap')} desc={t('settings.preview.wordWrap.desc')}>
              <ToggleControl checked={prefs.wordWrap} onChange={(v) => update('wordWrap', v)} />
            </SettingRow>

            {/* Font size slider */}
            <div className="py-5">
              <div className="flex items-center justify-between gap-6">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-primary">{t('settings.preview.fontSize')}</p>
                  <p className="text-xs text-text-muted mt-1 leading-relaxed">{t('settings.preview.fontSize.desc')}</p>
                </div>
                <div className="shrink-0 flex items-center gap-3">
                  <input
                    type="range"
                    min={10}
                    max={24}
                    value={prefs.fontSize}
                    onChange={(e) => update('fontSize', parseInt(e.target.value, 10))}
                    className="w-32 accent-[#3b82f6]"
                  />
                  <span className="text-sm text-text-primary w-6 text-right">{prefs.fontSize}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Live preview area */}
          <div className="flex gap-4">
            <CodePreviewCard
              label={t('settings.preview.lightPreview')}
              themeName={lightLabel}
              tag={t('settings.preview.lightTag')}
              dark={false}
              prefs={prefs}
            />
            <CodePreviewCard
              label={t('settings.preview.darkPreview')}
              themeName={darkLabel}
              tag={t('settings.preview.activeTag')}
              dark={true}
              prefs={prefs}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// ============ Placeholder for other settings pages ============
function PlaceholderSettings({ navId, onClose }: { navId: string; onClose: () => void }) {
  const { t } = useI18n()
  return (
    <div className="flex-1 flex flex-col items-center justify-center">
      <p className="text-lg text-text-muted">{t(`settings.nav.${navId}`)}</p>
      <p className="text-sm text-text-muted mt-2">{t('settings.comingSoon')}</p>
      <button
        onClick={onClose}
        className="mt-6 px-4 py-2 rounded-lg text-sm text-text-secondary border border-border-custom hover:bg-bg-hover transition-colors"
      >
        {t('settings.back')}
      </button>
    </div>
  )
}

// ============ Icons ============
function GearIcon({ active }: { active?: boolean }) {
  return (
    <svg className={`w-4 h-4 ${active ? 'text-text-primary' : 'text-text-muted'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}

function CodeIcon({ active }: { active?: boolean }) {
  return (
    <svg className={`w-4 h-4 ${active ? 'text-text-primary' : 'text-text-muted'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
    </svg>
  )
}

function ModelIcon({ active }: { active?: boolean }) {
  return (
    <svg className={`w-4 h-4 ${active ? 'text-text-primary' : 'text-text-muted'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
    </svg>
  )
}

function SkillIcon({ active }: { active?: boolean }) {
  return (
    <svg className={`w-4 h-4 ${active ? 'text-text-primary' : 'text-text-muted'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
    </svg>
  )
}

function RemoteIcon({ active }: { active?: boolean }) {
  return (
    <svg className={`w-4 h-4 ${active ? 'text-text-primary' : 'text-text-muted'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z" />
    </svg>
  )
}

function AdvancedIcon({ active }: { active?: boolean }) {
  return (
    <svg className={`w-4 h-4 ${active ? 'text-text-primary' : 'text-text-muted'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
    </svg>
  )
}

function AboutIcon({ active }: { active?: boolean }) {
  return (
    <svg className={`w-4 h-4 ${active ? 'text-text-primary' : 'text-text-muted'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
    </svg>
  )
}

function RefreshIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  )
}

function ProviderIcon({ name, size = 'sm' }: { name: string; size?: 'sm' | 'lg' }) {
  const sizeClass = size === 'lg' ? 'w-8 h-8' : 'w-5 h-5'
  const colors: Record<string, string> = {
    BigModel: 'bg-[#4f8ef7]',
    DeepSeek: 'bg-[#6366f1]',
    MiniMax: 'bg-[#8b5cf6]',
    vLLM: 'bg-[#f59e0b]',
    GPT: 'bg-[#10a37f]',
    Claude: 'bg-[#d97706]',
  }
  return (
    <div className={`${sizeClass} rounded-md ${colors[name] || 'bg-[#3f3f46]'} flex items-center justify-center`}>
      <span className={`text-white font-bold ${size === 'lg' ? 'text-sm' : 'text-[10px]'}`}>
        {name.charAt(0)}
      </span>
    </div>
  )
}
