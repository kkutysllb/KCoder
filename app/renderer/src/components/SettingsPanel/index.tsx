import { useState } from 'react'
import { useAppStore } from '../../stores/app-store'

interface SettingsPanelProps {
  isOpen: boolean
  onClose: () => void
}

// Navigation items
const NAV_ITEMS = [
  { id: 'general', label: '常规', icon: GearIcon },
  { id: 'preview', label: '代码预览', icon: CodeIcon },
  { id: 'model', label: '模型设置', icon: ModelIcon },
  { id: 'skills', label: '技能', icon: SkillIcon },
  { id: 'remote', label: '远程控制', icon: RemoteIcon },
  { id: 'advanced', label: '高级', icon: AdvancedIcon },
  { id: 'about', label: '关于', icon: AboutIcon },
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
  const [activeNav, setActiveNav] = useState('model')
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
    <div className="fixed inset-0 z-50 flex bg-[#0d0d0d]">
      {/* Left Navigation */}
      <div className="w-[200px] border-r border-[#2a2a2c] bg-[#141414] flex flex-col">
        {/* macOS traffic lights space */}
        <div className="h-12 flex items-center px-4">
          <div className="flex gap-2">
            <button onClick={onClose} className="w-3 h-3 rounded-full bg-[#ff5f57] hover:brightness-110 transition-all" />
            <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
            <div className="w-3 h-3 rounded-full bg-[#28c840]" />
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveNav(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                activeNav === item.id
                  ? 'bg-[#2a2a2c] text-[#e4e4e7] font-medium'
                  : 'text-[#71717a] hover:text-[#a1a1aa] hover:bg-[#1e1e20]'
              }`}
            >
              <item.icon active={activeNav === item.id} />
              {item.label}
            </button>
          ))}
        </nav>

        {/* Engine status */}
        <div className="px-4 py-3 border-t border-[#2a2a2c]">
          <div className="flex items-center gap-2 text-xs text-[#71717a]">
            <span className={`w-2 h-2 rounded-full ${engineStatus === 'connected' ? 'bg-[#22c55e]' : 'bg-[#ef4444]'}`} />
            引擎 {engineStatus === 'connected' ? '已连接' : '未连接'} · :{enginePort}
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
            <h1 className="text-xl font-semibold text-[#e4e4e7]">模型设置</h1>
            <p className="mt-1 text-sm text-[#71717a]">管理自定义模型供应商，配置后可在聊天时选择使用。</p>
          </div>
          <div className="flex items-center gap-3">
            <button className="p-2 rounded-lg text-[#71717a] hover:text-[#a1a1aa] hover:bg-[#2a2a2c] transition-colors">
              <RefreshIcon />
            </button>
            <select
              value={connectionType}
              onChange={(e) => onConnectionTypeChange(e.target.value)}
              className="px-3 py-1.5 rounded-lg text-sm bg-[#2a2a2c] border border-[#333336] text-[#e4e4e7] outline-none cursor-pointer"
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
        <div className="w-[240px] flex flex-col border-r border-[#2a2a2c] pr-6">
          <div className="flex-1 overflow-y-auto space-y-4">
            {Object.entries(categories).map(([category, items]) => (
              <div key={category}>
                <h3 className="text-xs font-medium text-[#71717a] uppercase tracking-wider mb-2">{category}</h3>
                <div className="space-y-1">
                  {items.map((provider) => (
                    <button
                      key={provider.id}
                      onClick={() => onSelectProvider(provider.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                        selectedProviderId === provider.id
                          ? 'bg-[#2a2a2c] text-[#e4e4e7]'
                          : 'text-[#a1a1aa] hover:bg-[#1e1e20] hover:text-[#e4e4e7]'
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
          <button className="mt-4 w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-dashed border-[#333336] text-sm text-[#71717a] hover:text-[#a1a1aa] hover:border-[#52525b] transition-colors">
            <PlusIcon />
            添加供应商
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
            <div className="flex items-center justify-center h-full text-[#71717a]">
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
  return (
    <div className="space-y-6">
      {/* Provider header */}
      <div className="flex items-center gap-3">
        <ProviderIcon name={provider.name} size="lg" />
        <h2 className="text-lg font-semibold text-[#e4e4e7]">{provider.name}</h2>
        <span
          className={`px-2 py-0.5 rounded text-xs font-medium ${
            provider.enabled
              ? 'bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/20'
              : 'bg-[#3f3f46]/30 text-[#71717a] border border-[#3f3f46]'
          }`}
        >
          {provider.enabled ? '已启用' : '未启用'}
        </span>
      </div>

      {/* Enable toggle */}
      <div className="flex items-center justify-between p-4 rounded-xl bg-[#1a1a1c] border border-[#2a2a2c]">
        <div>
          <p className="text-sm font-medium text-[#e4e4e7]">启用此供应商</p>
          <p className="text-xs text-[#71717a] mt-0.5">启用后可在聊天时选择该供应商的模型</p>
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
      <div className="p-4 rounded-xl bg-[#1a1a1c] border border-[#2a2a2c] space-y-4">
        <h3 className="text-sm font-medium text-[#e4e4e7]">API 配置</h3>
        <div>
          <label className="block text-xs text-[#71717a] mb-1.5">API 地址</label>
          <input
            type="text"
            value={provider.baseUrl}
            readOnly
            className="w-full px-3 py-2 rounded-lg bg-[#2a2a2c] border border-[#333336] text-sm text-[#a1a1aa] outline-none"
          />
        </div>
        <div>
          <label className="block text-xs text-[#71717a] mb-1.5">API Key</label>
          <input
            type="password"
            value={provider.apiKey}
            onChange={(e) => onUpdateApiKey(provider.id, e.target.value)}
            placeholder="输入 API Key..."
            className="w-full px-3 py-2 rounded-lg bg-[#2a2a2c] border border-[#333336] text-sm text-[#e4e4e7] placeholder-[#52525b] outline-none focus:border-[#52525b] transition-colors"
          />
        </div>
      </div>

      {/* Model List */}
      <div className="p-4 rounded-xl bg-[#1a1a1c] border border-[#2a2a2c]">
        <h3 className="text-sm font-medium text-[#e4e4e7] mb-3">模型列表</h3>
        {provider.models.length > 0 ? (
          <div className="space-y-2">
            {provider.models.map((model) => (
              <div
                key={model.name}
                className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-[#222224] border border-[#2a2a2c]"
              >
                <span className="text-sm text-[#e4e4e7]">{model.name}</span>
                <span className="text-xs text-[#71717a]">{model.context}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[#52525b]">暂无可用模型，请配置 API Key 后刷新。</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-lg text-sm text-[#a1a1aa] hover:bg-[#2a2a2c] transition-colors"
        >
          取消
        </button>
        <button
          onClick={onSave}
          className="px-5 py-2 rounded-lg text-sm font-medium bg-white text-black hover:bg-gray-200 transition-colors"
        >
          保存配置
        </button>
      </div>
    </div>
  )
}

// ============ Placeholder for other settings pages ============
function PlaceholderSettings({ navId, onClose }: { navId: string; onClose: () => void }) {
  const labels: Record<string, string> = {
    general: '常规',
    preview: '代码预览',
    skills: '技能',
    remote: '远程控制',
    advanced: '高级',
    about: '关于',
  }
  return (
    <div className="flex-1 flex flex-col items-center justify-center">
      <p className="text-lg text-[#71717a]">{labels[navId] || navId}</p>
      <p className="text-sm text-[#52525b] mt-2">即将推出</p>
      <button
        onClick={onClose}
        className="mt-6 px-4 py-2 rounded-lg text-sm text-[#a1a1aa] border border-[#333336] hover:bg-[#2a2a2c] transition-colors"
      >
        返回
      </button>
    </div>
  )
}

// ============ Icons ============
function GearIcon({ active }: { active?: boolean }) {
  return (
    <svg className={`w-4 h-4 ${active ? 'text-[#e4e4e7]' : 'text-[#71717a]'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}

function CodeIcon({ active }: { active?: boolean }) {
  return (
    <svg className={`w-4 h-4 ${active ? 'text-[#e4e4e7]' : 'text-[#71717a]'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
    </svg>
  )
}

function ModelIcon({ active }: { active?: boolean }) {
  return (
    <svg className={`w-4 h-4 ${active ? 'text-[#e4e4e7]' : 'text-[#71717a]'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
    </svg>
  )
}

function SkillIcon({ active }: { active?: boolean }) {
  return (
    <svg className={`w-4 h-4 ${active ? 'text-[#e4e4e7]' : 'text-[#71717a]'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
    </svg>
  )
}

function RemoteIcon({ active }: { active?: boolean }) {
  return (
    <svg className={`w-4 h-4 ${active ? 'text-[#e4e4e7]' : 'text-[#71717a]'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z" />
    </svg>
  )
}

function AdvancedIcon({ active }: { active?: boolean }) {
  return (
    <svg className={`w-4 h-4 ${active ? 'text-[#e4e4e7]' : 'text-[#71717a]'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
    </svg>
  )
}

function AboutIcon({ active }: { active?: boolean }) {
  return (
    <svg className={`w-4 h-4 ${active ? 'text-[#e4e4e7]' : 'text-[#71717a]'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
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
