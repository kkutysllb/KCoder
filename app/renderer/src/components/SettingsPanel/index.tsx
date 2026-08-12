import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react'
import { useAppStore } from '../../stores/app-store'
import { useI18n } from '../../i18n'
import { getEngineAPI, type ModelEntry, type RuntimeConfig, type RuntimeConfigSection } from '../../services/engine-api'
import { SidebarResizeHandle } from '../SidebarResizeHandle'
import { RuntimeConfigCard, type FieldDef } from './RuntimeConfigCard'
import { SkillsSettings } from './SkillsSettings'
import { SubAgentsSettings } from './SubAgentsSettings'
import { MCPSettings } from './MCPSettings'
import { PluginsSettings } from './PluginsSettings'
import { CommandsSettings } from './CommandsSettings'
import { RemoteSettings } from './RemoteSettings'
import { MemorySettings } from './MemorySettings'
import { SandboxSettings } from './SandboxSettings'
import { WebToolsSettings } from './WebToolsSettings'
import { AboutSettings } from './AboutSettings'
import {
  MODEL_PRESETS,
  MODEL_PRESET_BY_ID,
  PRESET_CATEGORY_ORDER,
  isPatchedProvider,
  type ModelPreset
} from './model-presets'

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
  { id: 'memory', labelKey: 'settings.nav.memory', icon: MemoryIcon },
  { id: 'sandbox', labelKey: 'settings.nav.sandbox', icon: SandboxIcon },
  { id: 'web', labelKey: 'settings.nav.web', icon: WebToolsIcon },
  { id: 'remote', labelKey: 'settings.nav.remote', icon: RemoteIcon },
  { id: 'about', labelKey: 'settings.nav.about', icon: AboutIcon },
]

// Provider 运行时状态 —— 预设（ModelPreset）的不可变字段 + 用户填写的运行时字段。
// 预设的 use/defaultBaseUrl/能力/thinking模板 等从 MODEL_PRESETS 继承，不在此重复。
interface ProviderRuntime {
  /** 对应 ModelPreset.id */
  presetId: string
  /** 用户填写的 apiKey（不回显） */
  apiKey: string
  /** 用户实际编辑后的 baseUrl（本地部署可改） */
  baseUrl: string
  /** 用户选定的具体模型 id（如 gpt-4o-mini） */
  selectedModel: string
  /** 是否已启用（激活） */
  enabled: boolean
  /** 深度思考开关（仅 supportsThinkingDefault 为 true 的预设有意义） */
  thinkingEnabled: boolean
}

/** 从预设初始化运行时状态 */
function runtimeFromPreset(preset: ModelPreset): ProviderRuntime {
  return {
    presetId: preset.id,
    apiKey: '',
    baseUrl: preset.defaultBaseUrl,
    selectedModel: '',
    enabled: false,
    thinkingEnabled: false
  }
}

const DEFAULT_RUNTIMES: ProviderRuntime[] = MODEL_PRESETS.map(runtimeFromPreset)

/** 取预设（从 runtime 反查） */
function presetOf(runtime: ProviderRuntime): ModelPreset {
  return MODEL_PRESET_BY_ID[runtime.presetId] ?? MODEL_PRESETS[0]
}

export function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const { engineStatus, enginePort, bumpModelVersion, settingsNavWidth, setSettingsNavWidth } = useAppStore()
  const [activeNav, setActiveNav] = useState('general')
  const { t } = useI18n()
  const [runtimes, setRuntimes] = useState<ProviderRuntime[]>(DEFAULT_RUNTIMES)
  const [selectedProviderId, setSelectedProviderId] = useState<string>('')
  const [savedModels, setSavedModels] = useState<ModelEntry[]>([])

  // 从后端加载已保存的模型（GET /api/models）— 精确按 profile name 匹配预设 id：
  // 匹配的只更新 enabled/selectedModel；不覆盖用户的 apiKey。
  const refreshModels = useCallback(async () => {
    if (engineStatus !== 'connected') return
    try {
      const result = await getEngineAPI(enginePort).getModels()
      const activeId = result.models.find((m) => m.active)?.id
      // 已保存的 profile name → ModelEntry 索引
      const savedById = new Map(result.models.map((m) => [m.id, m]))

      setRuntimes((prev) =>
        prev.map((rt) => {
          const saved = savedById.get(rt.presetId)
          if (!saved) return { ...rt, enabled: false }
          // 匹配到已保存 profile：回显 enabled + selectedModel，不回显 apiKey
          return {
            ...rt,
            enabled: rt.presetId === activeId,
            selectedModel: saved.model || rt.selectedModel,
            baseUrl: saved.base_url ?? rt.baseUrl
          }
        })
      )
      setSavedModels(result.models)
    } catch (err) {
      console.error('[KCoder] Failed to load models:', err)
    }
  }, [engineStatus, enginePort])

  useEffect(() => {
    if (isOpen && activeNav === 'model') refreshModels()
    if (isOpen && !selectedProviderId) setSelectedProviderId(runtimes[0]?.presetId ?? '')
  }, [isOpen, activeNav, refreshModels]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen) return null

  const selectedRuntime = runtimes.find((r) => r.presetId === selectedProviderId)

  // 激活模型：必须有具体模型名才能启用。先保存再激活。
  const handleToggleProvider = async (id: string) => {
    const rt = runtimes.find((r) => r.presetId === id)
    if (!rt) return
    if (!rt.selectedModel) return
    const preset = presetOf(rt)
    try {
      const api = getEngineAPI(enginePort)
      await api.createModel(buildCreatePayload(id, preset, rt))
      await api.activateModel(id)
      setRuntimes((prev) => prev.map((r) => ({ ...r, enabled: r.presetId === id })))
      bumpModelVersion()
      await refreshModels()
    } catch (err) {
      console.error('[KCoder] Failed to activate model:', err)
    }
  }

  const handleUpdateApiKey = (id: string, apiKey: string) => {
    setRuntimes((prev) => prev.map((r) => (r.presetId === id ? { ...r, apiKey } : r)))
  }

  const handleUpdateBaseUrl = (id: string, baseUrl: string) => {
    setRuntimes((prev) => prev.map((r) => (r.presetId === id ? { ...r, baseUrl } : r)))
  }

  const handleSelectModel = (id: string, modelId: string) => {
    setRuntimes((prev) => prev.map((r) => (r.presetId === id ? { ...r, selectedModel: modelId } : r)))
  }

  const handleToggleThinking = (id: string, thinkingEnabled: boolean) => {
    setRuntimes((prev) => prev.map((r) => (r.presetId === id ? { ...r, thinkingEnabled } : r)))
  }

  // 保存：只保存有具体模型 + 满足 apiKey 要求的供应商 + 激活选中的
  const handleSave = async () => {
    const api = getEngineAPI(enginePort)
    for (const rt of runtimes) {
      if (!rt.selectedModel) continue
      const preset = presetOf(rt)
      // 云端供应商需要 apiKey；本地部署可不填
      if (!rt.apiKey && preset.apiKeyRequired) continue
      try {
        await api.createModel(buildCreatePayload(rt.presetId, preset, rt))
      } catch (err) {
        console.error(`[KCoder] Failed to save model ${rt.presetId}:`, err)
      }
    }
    const enabled = runtimes.find((r) => r.enabled)
    if (enabled && enabled.selectedModel) {
      try { await api.activateModel(enabled.presetId) } catch (err) { console.error('[KCoder] Failed to activate:', err) }
    }
    window.kcoder?.send('save-settings', { runtimes })
    bumpModelVersion()
    onClose()
  }

  /** 构造 createModel payload：预设不可变字段 + 运行时字段 + thinking 模板 */
  function buildCreatePayload(name: string, preset: ModelPreset, rt: ProviderRuntime) {
    return {
      name,
      display_name: preset.displayName,
      model: rt.selectedModel,
      base_url: rt.baseUrl,
      api_key: rt.apiKey || undefined,
      use: preset.use,
      supports_tool_calling: true,
      supports_thinking: preset.supportsThinkingDefault,
      supports_vision: preset.supportsVisionDefault,
      supports_reasoning_effort: preset.supportsReasoningEffortDefault,
      // thinking 开关决定用 enabled 还是 disabled 模板
      when_thinking_enabled: rt.thinkingEnabled ? preset.whenThinkingEnabled : undefined,
      when_thinking_disabled: preset.whenThinkingDisabled
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex bg-bg-primary">
      {/* Left Navigation — 包一层 relative 让 ResizeHandle 绝对定位 */}
      <div className="relative shrink-0">
        <div
          className="h-full border-r border-border-custom bg-bg-surface flex flex-col"
          style={{ width: settingsNavWidth }}
        >
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
        <SidebarResizeHandle
          width={settingsNavWidth}
          minWidth={160}
          maxWidth={360}
          onResize={setSettingsNavWidth}
          label="拖拽调整设置面板侧栏宽度"
          style={{ left: settingsNavWidth }}
        />
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {activeNav === 'model' ? (
          <ModelSettings
            runtimes={runtimes}
            selectedRuntime={selectedRuntime}
            selectedProviderId={selectedProviderId}
            savedModels={savedModels}
            onSelectProvider={setSelectedProviderId}
            onToggleProvider={handleToggleProvider}
            onUpdateApiKey={handleUpdateApiKey}
            onUpdateBaseUrl={handleUpdateBaseUrl}
            onSelectModel={handleSelectModel}
            onToggleThinking={handleToggleThinking}
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
        ) : activeNav === 'memory' ? (
          <MemorySettings />
        ) : activeNav === 'sandbox' ? (
          <SandboxSettings />
        ) : activeNav === 'web' ? (
          <WebToolsSettings />
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
  runtimes,
  selectedRuntime,
  selectedProviderId,
  savedModels,
  onSelectProvider,
  onToggleProvider,
  onUpdateApiKey,
  onUpdateBaseUrl,
  onSelectModel,
  onToggleThinking,
  onSave,
  onClose,
}: {
  runtimes: ProviderRuntime[]
  selectedRuntime?: ProviderRuntime
  selectedProviderId: string
  savedModels: ModelEntry[]
  onSelectProvider: (id: string) => void
  onToggleProvider: (id: string) => void
  onUpdateApiKey: (id: string, key: string) => void
  onUpdateBaseUrl: (id: string, url: string) => void
  onSelectModel: (id: string, modelId: string) => void
  onToggleThinking: (id: string, enabled: boolean) => void
  onSave: () => void
  onClose: () => void
}) {
  const { t } = useI18n()
  // 按预设 category 分组（保持 PRESET_CATEGORY_ORDER 顺序）
  const grouped = PRESET_CATEGORY_ORDER.map((category) => ({
    category,
    items: runtimes.filter((rt) => presetOf(rt).category === category)
  })).filter((g) => g.items.length > 0)

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-8 pt-6 pb-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-text-primary">{t('settings.model.title')}</h1>
            <p className="mt-1 text-xs text-text-muted">{t('settings.model.subtitle')}</p>
          </div>
        </div>
      </div>

      {/* 配置注入提示条：保存后自动写入引擎 config.yaml，新对话生效 */}
      <div className="mx-8 mb-2 px-3 py-1.5 rounded-lg bg-[#22c55e]/10 border border-[#22c55e]/20 text-xs text-[#86efac]">
        {t('settings.model.injectActive')}
      </div>

      {/* 已配置模型概览 */}
      {savedModels.length > 0 && (
        <div className="mx-8 mb-3 flex items-center gap-3 px-3 py-2 rounded-xl bg-bg-surface border border-border-subtle">
          {(() => {
            const active = savedModels.find((m) => m.active)
            return (
              <>
                {/* 激活模型徽章 */}
                {active && (
                  <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-[#22c55e]/10 border border-[#22c55e]/20">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e]" />
                    <span className="text-xs text-[#86efac] font-medium">{active.display_name || active.name}</span>
                    <span className="text-[10px] text-[#86efac]/60 font-mono">{active.model}</span>
                  </div>
                )}
                {/* 已配置数量 */}
                <span className="text-xs text-text-muted shrink-0">
                  {t('settings.model.configured.prefix')} {savedModels.length}
                </span>
                {/* 其余已配置模型（紧凑行列表，可滚动） */}
                <div className="flex items-center gap-1.5 overflow-x-auto">
                  {savedModels.filter((m) => !m.active).map((m) => (
                    <span key={m.id} className="shrink-0 px-2 py-0.5 rounded text-[11px] bg-bg-hover text-text-secondary font-mono">
                      {m.display_name || m.name}
                    </span>
                  ))}
                </div>
              </>
            )
          })()}
        </div>
      )}

      {/* Two-column content */}
      <div className="flex-1 flex overflow-hidden px-8 pb-8 gap-5">
        {/* Left: Provider List */}
        <div className="w-[220px] flex flex-col border-r border-border-custom pr-5">
          <div className="flex-1 overflow-y-auto space-y-3">
            {grouped.map(({ category, items }) => (
              <div key={category}>
                <h3 className="text-[11px] font-medium text-text-muted uppercase tracking-wider mb-1.5">{category}</h3>
                <div className="space-y-0.5">
                  {items.map((rt) => {
                    const preset = presetOf(rt)
                    return (
                      <button
                        key={rt.presetId}
                        onClick={() => onSelectProvider(rt.presetId)}
                        className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[13px] transition-colors ${
                          selectedProviderId === rt.presetId
                            ? 'bg-bg-input text-text-primary'
                            : 'text-text-secondary hover:bg-bg-sidebar hover:text-text-primary'
                        }`}
                      >
                        <ProviderIcon name={preset.displayName} />
                        <span className="flex-1 text-left truncate">{preset.displayName}</span>
                        <span className={`w-2 h-2 rounded-full shrink-0 ${rt.enabled ? 'bg-[#22c55e]' : 'bg-[#3f3f46]'}`} />
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Add provider button（预留）*/}
          <button className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border-custom text-[13px] text-text-muted hover:text-text-secondary hover:border-[#52525b] transition-colors">
            <PlusIcon />
            {t('settings.model.addProvider')}
          </button>
        </div>

        {/* Right: Provider Detail */}
        <div className="flex-1 overflow-y-auto">
          {selectedRuntime ? (
            <ProviderDetail
              runtime={selectedRuntime}
              onToggle={onToggleProvider}
              onUpdateApiKey={onUpdateApiKey}
              onUpdateBaseUrl={onUpdateBaseUrl}
              onSelectModel={onSelectModel}
              onToggleThinking={onToggleThinking}
              onSave={onSave}
              onClose={onClose}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-text-muted">
              {t('settings.model.selectProvider')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ============ Provider Detail ============
function ProviderDetail({
  runtime,
  onToggle,
  onUpdateApiKey,
  onUpdateBaseUrl,
  onSelectModel,
  onToggleThinking,
  onSave,
  onClose,
}: {
  runtime: ProviderRuntime
  onToggle: (id: string) => void
  onUpdateApiKey: (id: string, key: string) => void
  onUpdateBaseUrl: (id: string, url: string) => void
  onSelectModel: (id: string, modelId: string) => void
  onToggleThinking: (id: string, enabled: boolean) => void
  onSave: () => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const { enginePort } = useAppStore()
  const [discovered, setDiscovered] = useState<Array<{ id: string; name: string }>>([])
  const [discovering, setDiscovering] = useState(false)
  const [discoverError, setDiscoverError] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const preset = presetOf(runtime)
  const patched = isPatchedProvider(preset)
  const hasModel = Boolean(runtime.selectedModel)

  // 切换 provider 时重置发现结果
  useEffect(() => {
    setDiscovered([])
    setDiscoverError(null)
    setShowAdvanced(false)
  }, [runtime.presetId])

  const handleDiscover = async () => {
    // 云端供应商需要 API Key；本地部署（vLLM/Ollama）可不填
    if (preset.apiKeyRequired && !runtime.apiKey.trim()) {
      setDiscoverError(t('settings.model.discover.needKey'))
      return
    }
    setDiscovering(true)
    setDiscoverError(null)
    try {
      const api = getEngineAPI(enginePort)
      const result = await api.discoverModels(runtime.baseUrl, runtime.apiKey)
      setDiscovered(result.models)
      if (result.models.length === 0) setDiscoverError(t('settings.model.discover.empty'))
    } catch (e) {
      setDiscoverError(e instanceof Error ? e.message : String(e))
    } finally {
      setDiscovering(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Provider header — 名字 + 补丁徽章 + 启用状态 */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <ProviderIcon name={preset.displayName} size="lg" />
        <h2 className="text-base font-semibold text-text-primary">{preset.displayName}</h2>
        {patched && (
          <span
            className="px-2 py-0.5 rounded text-[11px] font-medium bg-[#3b82f6]/10 text-[#3b82f6] border border-[#3b82f6]/30"
            title={preset.notes}
          >
            {t('settings.model.patched')}
          </span>
        )}
        <span
          className={`px-2 py-0.5 rounded text-xs font-medium ${
            runtime.enabled
              ? 'bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/20'
              : 'bg-[#3f3f46]/30 text-text-muted border border-border-strong'
          }`}
        >
          {runtime.enabled ? t('settings.model.enabled') : t('settings.model.disabled')}
        </span>
      </div>

      {/* 补丁说明（仅补丁版显示）*/}
      {preset.notes && (
        <p className="text-xs text-text-muted leading-relaxed">{preset.notes}</p>
      )}

      {/* Enable toggle — 必须先选具体模型才能启用 */}
      <div className={`flex items-center justify-between p-4 rounded-xl border ${hasModel ? 'bg-bg-surface border-border-custom' : 'bg-bg-surface/50 border-border-custom opacity-60'}`}>
        <div>
          <p className="text-sm font-medium text-text-primary">{t('settings.model.enable')}</p>
          <p className="text-xs text-text-muted mt-0.5">
            {hasModel ? t('settings.model.enable.desc') : t('settings.model.enable.needModel')}
          </p>
        </div>
        <button
          onClick={() => hasModel && onToggle(runtime.presetId)}
          disabled={!hasModel}
          className={`relative rounded-full transition-colors duration-200 ${
            runtime.enabled ? 'bg-[#4d4d57]' : 'bg-[#3a3a42]'
          } ${!hasModel ? 'cursor-not-allowed' : 'cursor-pointer'}`}
          style={{ width: 48, height: 28 }}
        >
          <span
            className="absolute top-[3px] left-[3px] rounded-full bg-white shadow-sm transition-transform duration-200"
            style={{ width: 22, height: 22, transform: runtime.enabled ? 'translateX(20px)' : 'translateX(0)' }}
          />
        </button>
      </div>

      {/* API Configuration */}
      <div className="p-3.5 rounded-xl bg-bg-surface border border-border-custom space-y-3">
        <h3 className="text-[13px] font-medium text-text-primary">{t('settings.model.apiConfig')}</h3>
        <div>
          <label className="block text-xs text-text-muted mb-1.5">{t('settings.model.apiUrl')}</label>
          <input
            type="text"
            value={runtime.baseUrl}
            onChange={preset.baseUrlEditable ? (e) => onUpdateBaseUrl(runtime.presetId, e.target.value) : undefined}
            readOnly={!preset.baseUrlEditable}
            placeholder={preset.baseUrlEditable ? t('settings.model.baseUrl.placeholder') : undefined}
            className={`w-full px-3 py-1.5 rounded-lg bg-bg-input border text-[13px] outline-none transition-colors ${
              preset.baseUrlEditable
                ? 'border-border-custom text-text-primary focus:border-border-strong'
                : 'border-border-custom text-text-secondary'
            }`}
          />
          {preset.baseUrlEditable && (
            <p className="text-[11px] text-text-muted mt-1 opacity-70">{t('settings.model.baseUrl.hint')}</p>
          )}
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1.5">
            API Key{!preset.apiKeyRequired && `（${t('settings.model.apiKey.optional')}）`}
          </label>
          <input
            type="password"
            value={runtime.apiKey}
            onChange={(e) => onUpdateApiKey(runtime.presetId, e.target.value)}
            placeholder={preset.apiKeyEnvHint}
            className="w-full px-3 py-1.5 rounded-lg bg-bg-input border border-border-custom text-[13px] text-text-primary placeholder-text-muted outline-none focus:border-border-strong transition-colors"
          />
        </div>
        {/* 获取模型按钮 — 从供应商 API 动态拉取 */}
        <button
          onClick={handleDiscover}
          disabled={discovering}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-[13px] font-medium bg-[#3b82f6] text-white hover:bg-[#2563eb] disabled:opacity-50 transition-colors"
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

      {/* 常见模型快捷选择（预设内置）*/}
      {preset.commonModels.length > 0 && (
        <div className="p-3.5 rounded-xl bg-bg-surface border border-border-custom">
          <h3 className="text-[13px] font-medium text-text-primary mb-2.5">{t('settings.model.commonModels')}</h3>
          <div className="flex flex-wrap gap-1.5">
            {preset.commonModels.map((modelId) => (
              <button
                key={modelId}
                onClick={() => onSelectModel(runtime.presetId, modelId)}
                className={`px-2.5 py-1 rounded-lg text-xs font-mono border transition-colors ${
                  runtime.selectedModel === modelId
                    ? 'bg-[#3b82f6]/10 text-[#3b82f6] border-[#3b82f6]/40'
                    : 'bg-bg-hover text-text-secondary border-border-custom hover:text-text-primary hover:border-border-strong'
                }`}
              >
                {modelId}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 从供应商拉取的模型列表（动态）*/}
      {discovered.length > 0 && (
        <div className="p-3.5 rounded-xl bg-bg-surface border border-border-custom">
          <div className="flex items-center justify-between mb-2.5">
            <h3 className="text-[13px] font-medium text-text-primary">{t('settings.model.discover.found')}（{discovered.length}）</h3>
          </div>
          <div className="space-y-1 max-h-[300px] overflow-y-auto">
            {discovered.map((m) => (
              <div
                key={m.id}
                className={`flex items-center justify-between px-3 py-1.5 rounded-lg border transition-colors ${
                  runtime.selectedModel === m.id
                    ? 'bg-[#3b82f6]/10 border-[#3b82f6]/40'
                    : 'bg-bg-hover border-border-custom'
                }`}
              >
                <span className="text-sm text-text-primary font-mono truncate">{m.id}</span>
                <button
                  onClick={() => onSelectModel(runtime.presetId, m.id)}
                  className="shrink-0 ml-2 px-2 py-0.5 rounded text-[11px] font-medium bg-[#3b82f6]/10 text-[#3b82f6] border border-[#3b82f6]/30 hover:bg-[#3b82f6]/20 transition-colors"
                >
                  {runtime.selectedModel === m.id ? t('settings.model.discover.selected') : t('settings.model.discover.add')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 当前选中的模型 */}
      <div className="p-3.5 rounded-xl bg-bg-surface border border-border-custom">
        <h3 className="text-[13px] font-medium text-text-primary mb-2.5">{t('settings.model.selectedModel')}</h3>
        {runtime.selectedModel ? (
          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-bg-hover border border-border-custom">
            <span className="text-[13px] text-text-primary font-mono">{runtime.selectedModel}</span>
          </div>
        ) : (
          <p className="text-sm text-text-muted">{t('settings.model.noModels')}</p>
        )}
      </div>

      {/* 能力信息（只读，来自预设）*/}
      <div className="p-3.5 rounded-xl bg-bg-surface border border-border-custom">
        <h3 className="text-[13px] font-medium text-text-primary mb-2.5">{t('settings.model.capabilities')}</h3>
        <div className="grid grid-cols-3 gap-3">
          <CapabilityBadge
            label={t('settings.model.cap.thinking')}
            supported={preset.supportsThinkingDefault}
          />
          <CapabilityBadge
            label={t('settings.model.cap.vision')}
            supported={preset.supportsVisionDefault}
          />
          <CapabilityBadge
            label={t('settings.model.cap.reasoningEffort')}
            supported={preset.supportsReasoningEffortDefault}
          />
        </div>
      </div>

      {/* 深度思考开关（仅支持 thinking 的预设有意义）*/}
      {preset.supportsThinkingDefault && (
        <div className="flex items-center justify-between p-4 rounded-xl bg-bg-surface border border-border-custom">
          <div>
            <p className="text-sm font-medium text-text-primary">{t('settings.model.thinking.toggle')}</p>
            <p className="text-xs text-text-muted mt-0.5">{t('settings.model.thinking.desc')}</p>
          </div>
          <button
            onClick={() => onToggleThinking(runtime.presetId, !runtime.thinkingEnabled)}
            className={`relative rounded-full transition-colors duration-200 cursor-pointer ${
              runtime.thinkingEnabled ? 'bg-[#4d4d57]' : 'bg-[#3a3a42]'
            }`}
            style={{ width: 48, height: 28 }}
          >
            <span
              className="absolute top-[3px] left-[3px] rounded-full bg-white shadow-sm transition-transform duration-200"
              style={{ width: 22, height: 22, transform: runtime.thinkingEnabled ? 'translateX(20px)' : 'translateX(0)' }}
            />
          </button>
        </div>
      )}

      {/* 高级设置（折叠）*/}
      <div className="p-3.5 rounded-xl bg-bg-surface border border-border-custom">
        <button
          onClick={() => setShowAdvanced((v) => !v)}
          className="w-full flex items-center justify-between text-[13px] font-medium text-text-primary"
        >
          <span>{t('settings.model.advanced')}</span>
          <svg className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
        {showAdvanced && (
          <div className="mt-4 space-y-3">
            <div>
              <label className="block text-xs text-text-muted mb-1.5">{t('settings.model.classPath')}</label>
              <input
                type="text"
                value={preset.use}
                readOnly
                className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border-custom text-xs font-mono text-text-secondary outline-none"
              />
              <p className="text-[11px] text-text-muted mt-1 opacity-70">{t('settings.model.classPath.desc')}</p>
            </div>
            {preset.whenThinkingEnabled && (
              <div>
                <label className="block text-xs text-text-muted mb-1.5">{t('settings.model.thinkingTemplate')}</label>
                <pre className="px-3 py-2 rounded-lg bg-bg-input border border-border-custom text-[11px] font-mono text-text-secondary overflow-x-auto">
                  {JSON.stringify(preset.whenThinkingEnabled, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-1">
        <button
          onClick={onClose}
          className="px-3.5 py-1.5 rounded-lg text-[13px] text-text-secondary hover:bg-bg-hover transition-colors"
        >
          {t('settings.model.cancel')}
        </button>
        <button
          onClick={onSave}
          className="px-4 py-1.5 rounded-lg text-[13px] font-medium bg-white text-black hover:bg-gray-200 transition-colors"
        >
          {t('settings.model.saveConfig')}
        </button>
      </div>
    </div>
  )
}

/** 能力徽章 — 只读展示预设能力 */
function CapabilityBadge({ label, supported }: { label: string; supported: boolean }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg bg-bg-hover border border-border-custom px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] text-text-muted uppercase tracking-wide">{label}</p>
        <p className={`text-xs font-medium ${supported ? 'text-[#22c55e]' : 'text-text-muted'}`}>
          {supported ? '✓' : '—'}
        </p>
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
  const { enginePort, engineStatus, initializeEngine, setEngineStatus } = useAppStore()

  // Runtime config state（database + uploads 引擎级配置）
  const [runtimeCfg, setRuntimeCfg] = useState<RuntimeConfig | null>(null)
  const [cfgLoading, setCfgLoading] = useState(true)
  const [cfgSaving, setCfgSaving] = useState(false)
  const [refreshEffectedAt, setRefreshEffectedAt] = useState(0)
  // 引擎重启状态
  const [restarting, setRestarting] = useState(false)
  const [restartMsg, setRestartMsg] = useState<string | null>(null)

  const loadRuntimeConfig = useCallback(async () => {
    if (engineStatus !== 'connected') { setCfgLoading(false); return }
    setCfgLoading(true)
    try {
      const cfg = await getEngineAPI(enginePort).getRuntimeConfig()
      setRuntimeCfg(cfg)
    } catch (e) {
      console.error('[General] Failed to load runtime config:', e)
    } finally {
      setCfgLoading(false)
    }
  }, [enginePort, engineStatus])

  useEffect(() => {
    loadRuntimeConfig()
  }, [loadRuntimeConfig])

  // 保存后轮询刷新生效值
  useEffect(() => {
    if (refreshEffectedAt === 0) return
    let cancelled = false
    const poll = async (): Promise<void> => {
      for (let i = 0; i < 3; i++) {
        await new Promise((r) => setTimeout(r, 800))
        if (cancelled) return
        try {
          const cfg = await getEngineAPI(enginePort).getRuntimeConfig()
          if (!cancelled) setRuntimeCfg(cfg)
          return
        } catch {
          // 继续重试
        }
      }
    }
    poll()
    return () => { cancelled = true }
  }, [refreshEffectedAt, enginePort])

  const handleSaveSection = useCallback(
    async (section: RuntimeConfigSection, value: Record<string, unknown>): Promise<void> => {
      setCfgSaving(true)
      try {
        await getEngineAPI(enginePort).updateRuntimeConfigSection(section, value)
        setRuntimeCfg((prev) => prev ? { ...prev, [section]: value as never } : prev)
        setRefreshEffectedAt(Date.now())
      } finally {
        setCfgSaving(false)
      }
    },
    [enginePort]
  )

  // uploads MB↔bytes 转换
  const uploadsInitialValue = useMemo(() => {
    if (!runtimeCfg) return {}
    const u = runtimeCfg.uploads
    return {
      max_files: u.max_files,
      max_file_size: +(u.max_file_size / BYTES_PER_MB).toFixed(2),
      max_total_size: +(u.max_total_size / BYTES_PER_MB).toFixed(2),
      auto_convert_documents: u.auto_convert_documents,
    }
  }, [runtimeCfg])

  const handleSaveUploads = useCallback(async (value: Record<string, unknown>): Promise<void> => {
    const payload: Record<string, unknown> = {
      max_files: Number(value.max_files) || 1,
      max_file_size: Math.max(1, Math.round((Number(value.max_file_size) || 1) * BYTES_PER_MB)),
      max_total_size: Math.max(1, Math.round((Number(value.max_total_size) || 1) * BYTES_PER_MB)),
      auto_convert_documents: Boolean(value.auto_convert_documents),
    }
    await handleSaveSection('uploads', payload)
  }, [handleSaveSection])

  // 重启后端引擎：使 config.yaml 中启动时初始化的字段生效
  const handleRestartEngine = useCallback(async () => {
    setRestarting(true)
    setRestartMsg(null)
    try {
      const { port, token } = await window.kcoder.restartEngine()
      initializeEngine(port)
      // 等待引擎就绪（langgraph dev 启动需要数秒）
      const api = getEngineAPI(port, token)
      let attempts = 0
      const pollHealth = async (): Promise<void> => {
        const ok = await api.health()
        if (ok) {
          setEngineStatus('connected')
          return
        }
        if (attempts++ < 30) {
          await new Promise((r) => setTimeout(r, 500))
          return pollHealth()
        }
        throw new Error('health check timeout')
      }
      await pollHealth()
      setRestartMsg(t('settings.general.restarted'))
      setRefreshEffectedAt(Date.now())
    } catch (e) {
      setEngineStatus('error')
      setRestartMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setRestarting(false)
    }
  }, [initializeEngine, setEngineStatus, t])

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
                onClick={async () => {
                  const path = await window.kcoder.dialog.openFolder()
                  if (path) update('dataPath', path)
                }}
              >
                {t('settings.general.browse')}
              </button>
            }
          />
        </div>

        {/* ── 引擎级配置（database + uploads） ── */}
        <div className="max-w-[680px] mx-auto mt-6 space-y-4">
          <h2 className="text-sm font-semibold text-text-primary">{t('settings.general.engineConfig')}</h2>

          {/* database 重启提示 */}
          <div className="flex items-start gap-2 rounded-lg border border-[#f59e0b]/30 bg-[#f59e0b]/5 px-3 py-2.5">
            <svg className="w-4 h-4 text-[#f59e0b] shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <p className="text-[11px] text-text-secondary leading-relaxed">{t('settings.general.dbRestartHint')}</p>
          </div>

          {cfgLoading ? (
            <div className="text-center py-6 text-xs text-text-muted">{t('common.loading')}</div>
          ) : runtimeCfg ? (
            <>
              <RuntimeConfigCard
                title={t('settings.general.dbTitle')}
                description={t('settings.general.dbDesc')}
                fields={DATABASE_FIELDS}
                initialValue={runtimeCfg.database as unknown as Record<string, unknown>}
                onSave={(v) => handleSaveSection('database', v)}
                saving={cfgSaving}
              />
              <RuntimeConfigCard
                title={t('settings.general.uploadsTitle')}
                description={t('settings.general.uploadsDesc')}
                fields={UPLOADS_FIELDS}
                initialValue={uploadsInitialValue}
                onSave={handleSaveUploads}
                saving={cfgSaving}
              />
            </>
          ) : null}

          {/* 重启后端引擎 */}
          <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-border-subtle">
            <div className="text-[11px] text-text-secondary leading-relaxed">
              {restartMsg ?? t('settings.general.restartEngineHint')}
            </div>
            <button
              onClick={handleRestartEngine}
              disabled={restarting}
              className="shrink-0 px-3 py-1.5 rounded-md text-xs font-medium bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/20 disabled:opacity-50 transition-colors flex items-center gap-1.5"
            >
              {restarting && (
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992V4.356M19.684 8.59A7.5 7.5 0 1 0 19.684 15.41" />
                </svg>
              )}
              {restarting ? t('settings.general.restarting') : t('settings.general.restartEngine')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const BYTES_PER_MB = 1024 * 1024

const DATABASE_FIELDS: FieldDef[] = [
  {
    key: 'backend',
    label: '存储后端',
    type: 'select',
    hint: 'memory 不持久化 / sqlite 单节点 / postgres 多节点',
    options: [
      { value: 'memory', label: 'memory（开发，重启丢失）' },
      { value: 'sqlite', label: 'sqlite（单节点）' },
      { value: 'postgres', label: 'postgres（多节点）' }
    ]
  },
  { key: 'sqlite_dir', label: 'SQLite 目录', type: 'string', hint: 'backend=sqlite 时生效。默认 .qilin/data' },
  { key: 'postgres_url', label: 'Postgres URL', type: 'string', hint: 'backend=postgres 时生效。推荐用 $DATABASE_URL 引用 secrets.env' },
  {
    key: 'checkpoint_channel_mode',
    label: 'Checkpoint 模式',
    type: 'select',
    hint: 'full 完整消息 / delta 增量。重启生效',
    options: [
      { value: 'full', label: 'full（完整消息快照）' },
      { value: 'delta', label: 'delta（DeltaChannel 增量）' }
    ]
  },
  { key: 'pool_size', label: '连接池大小', type: 'number', min: 1, step: 1, hint: 'postgres ORM 连接池' },
  { key: 'pool_recycle', label: '连接回收秒数', type: 'number', min: 1, step: 1, hint: 'postgres 连接闲置回收' },
  { key: 'command_timeout', label: '命令超时（秒）', type: 'number', min: 1, step: 1, hint: 'postgres 命令超时' }
]

const UPLOADS_FIELDS: FieldDef[] = [
  { key: 'max_files', label: '文件数量上限', type: 'number', min: 1, max: 100, step: 1, hint: '单个会话允许的最大附件数量（1-100）' },
  { key: 'max_file_size', label: '单文件上限（MB）', type: 'number', min: 1, step: 1, hint: '单个附件的最大体积，单位 MB' },
  { key: 'max_total_size', label: '总量上限（MB）', type: 'number', min: 1, step: 1, hint: '单个会话所有附件合计的最大体积，单位 MB' },
  { key: 'auto_convert_documents', label: '自动转换文档', type: 'boolean', hint: '上传时自动把 PDF/docx/pptx/xlsx 等转成 markdown' }
]
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

// Setting row with input field below description (for text-type settings).
// 输入改动暂存在本地状态，点击「保存」后才提交到父组件（写 localStorage + IPC）。
function SettingInputRow({ title, desc, value, onChange, placeholder, extraButton }: {
  title: string
  desc: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  extraButton?: ReactNode
}) {
  const { t } = useI18n()
  const [localValue, setLocalValue] = useState(value)
  const [savedHint, setSavedHint] = useState(false)

  // 外部 value 变化时同步本地（如 Browse 按钮选择文件夹后父组件直接 update）
  useEffect(() => { setLocalValue(value) }, [value])

  const dirty = localValue !== value

  const handleSave = () => {
    onChange(localValue)
    setSavedHint(true)
    setTimeout(() => setSavedHint(false), 2500)
  }

  return (
    <div className="py-5">
      <p className="text-sm font-medium text-text-primary">{title}</p>
      <p className="text-xs text-text-muted mt-1 leading-relaxed">{desc}</p>
      <div className="flex items-center gap-2 mt-3">
        <input
          type="text"
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && dirty) handleSave() }}
          placeholder={placeholder}
          className="flex-1 px-3 py-2 rounded-lg text-sm bg-bg-hover border border-border-custom text-text-primary placeholder-text-muted outline-none focus:border-border-strong transition-colors"
        />
        {extraButton}
        <button
          onClick={handleSave}
          disabled={!dirty && !savedHint}
          className={`shrink-0 px-4 py-2 rounded-lg text-xs font-medium transition-colors ${
            dirty
              ? 'bg-white text-black hover:bg-gray-200'
              : 'bg-bg-input text-text-muted cursor-default'
          }`}
        >
          {savedHint ? t('settings.general.saved') : t('settings.general.save')}
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

function MemoryIcon({ active }: { active?: boolean }) {
  return (
    <svg className={`w-4 h-4 ${active ? 'text-text-primary' : 'text-text-muted'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 11.25v8.25a1.5 1.5 0 01-1.5 1.5H5.25a1.5 1.5 0 01-1.5-1.5v-8.25M12 4.875A2.625 2.625 0 109.375 7.5H12m0-2.625V7.5m0-2.625A2.625 2.625 0 1114.625 7.5H12m0 0V21m-8.625-9.75h18c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125h-18c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
    </svg>
  )
}

function SandboxIcon({ active }: { active?: boolean }) {
  return (
    <svg className={`w-4 h-4 ${active ? 'text-text-primary' : 'text-text-muted'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c.92 0 1.667.746 1.667 1.667 0 .092-.008.183-.023.272a36.04 36.04 0 015.197 2.083 1.667 1.667 0 011.65 2.893l-.013.014a1.667 1.667 0 01-.625 2.27 1.667 1.667 0 01-2.27-.625 36.09 36.09 0 00-1.05-1.725A33.67 33.67 0 0112 12a33.67 33.67 0 01-4.533-1.16 36.09 36.09 0 00-1.05 1.725 1.667 1.667 0 01-2.27.625 1.667 1.667 0 01-.625-2.27 1.667 1.667 0 01.376-.402l-.013-.014a1.667 1.667 0 011.65-2.893A36.04 36.04 0 0110.356 4.94a1.667 1.667 0 01-.023-.273C10.333 3.746 11.08 3 12 3z" />
    </svg>
  )
}

function WebToolsIcon({ active }: { active?: boolean }) {
  return (
    <svg className={`w-4 h-4 ${active ? 'text-text-primary' : 'text-text-muted'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
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
