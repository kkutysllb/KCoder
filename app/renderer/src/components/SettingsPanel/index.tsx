import { useState, useEffect, type ReactNode } from 'react'
import { useAppStore } from '../../stores/app-store'
import { useI18n } from '../../i18n'
import { getEngineAPI, type ModelEntry } from '../../services/engine-api'
import { SkillsSettings } from './SkillsSettings'
import { SubAgentsSettings } from './SubAgentsSettings'
import { MCPSettings } from './MCPSettings'
import { PluginsSettings } from './PluginsSettings'
import { CommandsSettings } from './CommandsSettings'
import { RemoteSettings } from './RemoteSettings'
import { AboutSettings } from './AboutSettings'

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
  { id: 'agents', labelKey: 'settings.nav.agents', icon: AgentIcon },
  { id: 'mcp', labelKey: 'settings.nav.mcp', icon: McpIcon },
  { id: 'plugins', labelKey: 'settings.nav.plugins', icon: PluginIcon },
  { id: 'commands', labelKey: 'settings.nav.commands', icon: CommandIcon },
  { id: 'remote', labelKey: 'settings.nav.remote', icon: RemoteIcon },
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
  /** 本地部署的供应商允许用户编辑 baseUrl（vLLM/Ollama） */
  baseUrlEditable?: boolean
  /** API Key 是否必填（本地部署可不填） */
  apiKeyRequired?: boolean
  // 能力信息（从 ModelEntry 映射，用于详情展示）
  supportsToolCalling?: boolean
  supportsVision?: boolean
  supportsReasoningEffort?: boolean
  reasoningEffortValues?: string[]
  rawModel?: string
}

const DEFAULT_PROVIDERS: Provider[] = [
  {
    id: 'bigmodel',
    name: 'BigModel',
    category: '云端供应商',
    enabled: false,
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKey: '',
    models: [],
    apiKeyRequired: true,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    category: '云端供应商',
    enabled: false,
    baseUrl: 'https://api.deepseek.com',
    apiKey: '',
    models: [],
    apiKeyRequired: true,
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    category: '云端供应商',
    enabled: false,
    baseUrl: 'https://api.minimax.chat/v1',
    apiKey: '',
    models: [],
    apiKeyRequired: true,
  },
  {
    id: 'gpt',
    name: 'GPT',
    category: '云端供应商',
    enabled: false,
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    models: [],
    apiKeyRequired: true,
  },
  {
    id: 'claude',
    name: 'Claude',
    category: '云端供应商',
    enabled: false,
    baseUrl: 'https://api.anthropic.com',
    apiKey: '',
    models: [],
    apiKeyRequired: true,
  },
  {
    id: 'vllm',
    name: 'vLLM',
    category: '本地部署',
    enabled: false,
    baseUrl: 'http://localhost:8000/v1',
    apiKey: '',
    models: [],
    baseUrlEditable: true,
    apiKeyRequired: false,
  },
  {
    id: 'ollama',
    name: 'Ollama',
    category: '本地部署',
    enabled: false,
    baseUrl: 'http://localhost:11434/v1',
    apiKey: '',
    models: [],
    baseUrlEditable: true,
    apiKeyRequired: false,
  },
]

export function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const { engineStatus, enginePort } = useAppStore()
  const [activeNav, setActiveNav] = useState('general')
  const { t } = useI18n()
  const [providers, setProviders] = useState<Provider[]>(DEFAULT_PROVIDERS)
  const [selectedProviderId, setSelectedProviderId] = useState<string>('')
  const [connectionType, setConnectionType] = useState('API 直连')

  // 从后端加载真实模型列表（GET /api/models）
  useEffect(() => {
    if (engineStatus !== 'connected' || !isOpen) return
    getEngineAPI(enginePort)
      .getModels()
      .then((result) => {
        const mapped: Provider[] = result.models.map((m) => ({
          id: m.id,
          name: m.display_name || m.name,
          category: m.active ? '当前模型' : '可用模型',
          enabled: m.active,
          baseUrl: m.base_url ?? '',
          apiKey: '',
          models: m.context_window_tokens
            ? [{ name: m.model, context: `${Math.round(m.context_window_tokens / 1000)}K` }]
            : [{ name: m.model, context: '-' }],
          // 保留能力信息用于详情展示
          supportsToolCalling: m.supports_tool_calling,
          supportsVision: m.supports_vision,
          supportsReasoningEffort: m.supports_reasoning_effort,
          reasoningEffortValues: m.reasoning_effort_values,
          rawModel: m.model
        }))
        if (mapped.length > 0) {
          setProviders(mapped)
          // 选中当前激活的模型
          const active = mapped.find((p) => p.enabled)
          setSelectedProviderId(active?.id ?? mapped[0]!.id)
        }
      })
      .catch((err) => console.error('[KCoder] Failed to load models:', err))
  }, [engineStatus, enginePort, isOpen])

  if (!isOpen) return null

  const selectedProvider = providers.find((p) => p.id === selectedProviderId)

  const handleToggleProvider = (id: string) => {
    // 激活模型（后端只支持单选激活）
    setProviders((prev) => prev.map((p) => ({ ...p, enabled: p.id === id })))
    getEngineAPI(enginePort)
      .activateModel(id)
      .catch((err) => console.error('[KCoder] Failed to activate model:', err))
  }

  const handleUpdateApiKey = (id: string, apiKey: string) => {
    setProviders((prev) =>
      prev.map((p) => (p.id === id ? { ...p, apiKey } : p))
    )
  }

  const handleUpdateBaseUrl = (id: string, baseUrl: string) => {
    setProviders((prev) =>
      prev.map((p) => (p.id === id ? { ...p, baseUrl } : p))
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
            onUpdateBaseUrl={handleUpdateBaseUrl}
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
        ) : activeNav === 'agents' ? (
          <SubAgentsSettings />
        ) : activeNav === 'mcp' ? (
          <MCPSettings />
        ) : activeNav === 'plugins' ? (
          <PluginsSettings />
        ) : activeNav === 'commands' ? (
          <CommandsSettings />
        ) : activeNav === 'remote' ? (
          <RemoteSettings />
        ) : activeNav === 'about' ? (
          <AboutSettings />
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
  onUpdateBaseUrl,
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
  onUpdateBaseUrl: (id: string, url: string) => void
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
              onUpdateBaseUrl={onUpdateBaseUrl}
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
  onUpdateBaseUrl,
  onSave,
  onClose,
}: {
  provider: Provider
  onToggle: (id: string) => void
  onUpdateApiKey: (id: string, key: string) => void
  onUpdateBaseUrl: (id: string, url: string) => void
  onSave: () => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const { enginePort } = useAppStore()
  const [discovered, setDiscovered] = useState<Array<{ id: string; name: string }>>([])
  const [discovering, setDiscovering] = useState(false)
  const [discoverError, setDiscoverError] = useState<string | null>(null)

  // 切换 provider 时重置发现结果
  useEffect(() => {
    setDiscovered([])
    setDiscoverError(null)
  }, [provider.id])

  const handleDiscover = async () => {
    // 云端供应商需要 API Key；本地部署（vLLM/Ollama）可不填
    if (provider.apiKeyRequired !== false && !provider.apiKey.trim()) {
      setDiscoverError(t('settings.model.discover.needKey'))
      return
    }
    setDiscovering(true)
    setDiscoverError(null)
    try {
      const api = getEngineAPI(enginePort)
      const result = await api.discoverModels(provider.baseUrl, provider.apiKey)
      setDiscovered(result.models)
      if (result.models.length === 0) setDiscoverError(t('settings.model.discover.empty'))
    } catch (e) {
      setDiscoverError(e instanceof Error ? e.message : String(e))
    } finally {
      setDiscovering(false)
    }
  }

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
          className={`relative rounded-full transition-colors duration-200 ${
            provider.enabled ? 'bg-[#4d4d57]' : 'bg-[#3a3a42]'
          }`}
          style={{ width: 48, height: 28 }}
        >
          <span
            className="absolute top-[3px] left-[3px] rounded-full bg-white shadow-sm transition-transform duration-200"
            style={{ width: 22, height: 22, transform: provider.enabled ? 'translateX(20px)' : 'translateX(0)' }}
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
            onChange={provider.baseUrlEditable ? (e) => onUpdateBaseUrl(provider.id, e.target.value) : undefined}
            readOnly={!provider.baseUrlEditable}
            placeholder={provider.baseUrlEditable ? 'http://localhost:8000/v1' : undefined}
            className={`w-full px-3 py-2 rounded-lg bg-bg-input border text-sm outline-none transition-colors ${
              provider.baseUrlEditable
                ? 'border-border-custom text-text-primary focus:border-border-strong'
                : 'border-border-custom text-text-secondary'
            }`}
          />
          {provider.baseUrlEditable && (
            <p className="text-[11px] text-text-muted mt-1 opacity-70">{t('settings.model.baseUrl.hint')}</p>
          )}
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1.5">API Key{provider.apiKeyRequired === false && `（可选）`}</label>
          <input
            type="password"
            value={provider.apiKey}
            onChange={(e) => onUpdateApiKey(provider.id, e.target.value)}
            placeholder={t('settings.model.apiKey.placeholder')}
            className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border-custom text-sm text-text-primary placeholder-text-muted outline-none focus:border-border-strong transition-colors"
          />
        </div>
        {/* 获取模型按钮 — 从供应商 API 动态拉取 */}
        <button
          onClick={handleDiscover}
          disabled={discovering}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[#3b82f6] text-white hover:bg-[#2563eb] disabled:opacity-50 transition-colors"
        >
          {discovering ? (
            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
            </svg>
          )}
          {discovering ? t('settings.model.discover.loading') : t('settings.model.discover.button')}
        </button>
        {discoverError && (
          <p className="text-xs text-[#ef4444]">{discoverError}</p>
        )}
      </div>

      {/* 从供应商拉取的模型列表（动态） */}
      {discovered.length > 0 && (
        <div className="p-4 rounded-xl bg-bg-surface border border-border-custom">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-text-primary">{t('settings.model.discover.found')}（{discovered.length}）</h3>
          </div>
          <div className="space-y-1 max-h-[300px] overflow-y-auto">
            {discovered.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between px-3 py-2 rounded-lg bg-bg-hover border border-border-custom"
              >
                <span className="text-sm text-text-primary font-mono truncate">{m.id}</span>
                <button
                  onClick={() => {
                    // 一键添加该模型到配置（调用后端 createModel）
                    getEngineAPI(enginePort)
                      .createModel({ id: m.id, name: m.id, base_url: provider.baseUrl, api_key: provider.apiKey, providerModel: m.id })
                      .then(() => onSave())
                      .catch((e) => setDiscoverError(e instanceof Error ? e.message : String(e)))
                  }}
                  className="shrink-0 ml-2 px-2 py-0.5 rounded text-[11px] font-medium bg-[#3b82f6]/10 text-[#3b82f6] border border-[#3b82f6]/30 hover:bg-[#3b82f6]/20 transition-colors"
                >
                  {t('settings.model.discover.add')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

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

      {/* 模型能力信息（从后端 ModelEntry 映射） */}
      {(provider.supportsToolCalling !== undefined || provider.supportsVision !== undefined) && (
        <div className="p-4 rounded-xl bg-bg-surface border border-border-custom">
          <h3 className="text-sm font-medium text-text-primary mb-3">模型能力</h3>
          <div className="grid grid-cols-2 gap-3">
            {provider.models[0] && (
              <div className="flex items-center gap-2.5 rounded-lg bg-bg-hover border border-border-custom px-3 py-2.5">
                <svg className="w-4 h-4 text-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="min-w-0">
                  <p className="text-[10px] text-text-muted uppercase tracking-wide">上下文窗口</p>
                  <p className="text-xs font-medium text-text-primary">{provider.models[0].context}</p>
                </div>
              </div>
            )}
            {provider.supportsToolCalling !== undefined && (
              <div className="flex items-center gap-2.5 rounded-lg bg-bg-hover border border-border-custom px-3 py-2.5">
                <svg className="w-4 h-4 text-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877" />
                </svg>
                <div className="min-w-0">
                  <p className="text-[10px] text-text-muted uppercase tracking-wide">工具调用</p>
                  <p className={`text-xs font-medium ${provider.supportsToolCalling ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
                    {provider.supportsToolCalling ? '✓ 支持' : '✗ 不支持'}
                  </p>
                </div>
              </div>
            )}
            {provider.supportsVision !== undefined && (
              <div className="flex items-center gap-2.5 rounded-lg bg-bg-hover border border-border-custom px-3 py-2.5">
                <svg className="w-4 h-4 text-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <div className="min-w-0">
                  <p className="text-[10px] text-text-muted uppercase tracking-wide">视觉理解</p>
                  <p className={`text-xs font-medium ${provider.supportsVision ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
                    {provider.supportsVision ? '✓ 支持' : '✗ 不支持'}
                  </p>
                </div>
              </div>
            )}
            {provider.supportsReasoningEffort !== undefined && (
              <div className="flex items-center gap-2.5 rounded-lg bg-bg-hover border border-border-custom px-3 py-2.5">
                <svg className="w-4 h-4 text-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
                </svg>
                <div className="min-w-0">
                  <p className="text-[10px] text-text-muted uppercase tracking-wide">推理强度</p>
                  <p className={`text-xs font-medium ${provider.supportsReasoningEffort ? 'text-[#22c55e]' : 'text-text-muted'}`}>
                    {provider.supportsReasoningEffort ? (provider.reasoningEffortValues?.join('/') ?? '可调') : '—'}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

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

function AgentIcon({ active }: { active?: boolean }) {
  return (
    <svg className={`w-4 h-4 ${active ? 'text-text-primary' : 'text-text-muted'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
    </svg>
  )
}

function McpIcon({ active }: { active?: boolean }) {
  return (
    <svg className={`w-4 h-4 ${active ? 'text-text-primary' : 'text-text-muted'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75a4.5 4.5 0 01-4.884 4.484c-1.076-.091-2.264.071-2.95.904l-7.152 8.684a2.548 2.548 0 11-3.586-3.586l8.684-7.152c.833-.686.995-1.874.904-2.95a4.5 4.5 0 016.336-4.486l-3.276 3.276a3.004 3.004 0 002.25 2.25l3.276-3.276c.256.565.398 1.192.398 1.852z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.867 19.125h.008v.008h-.008v-.008z" />
    </svg>
  )
}

function PluginIcon({ active }: { active?: boolean }) {
  return (
    <svg className={`w-4 h-4 ${active ? 'text-text-primary' : 'text-text-muted'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085" />
    </svg>
  )
}

function CommandIcon({ active }: { active?: boolean }) {
  return (
    <svg className={`w-4 h-4 ${active ? 'text-text-primary' : 'text-text-muted'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
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
