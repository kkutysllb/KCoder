import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '../../stores/app-store'
import { useI18n } from '../../i18n'
import {
  getEngineAPI,
  type RuntimeConfig,
  type RuntimeConfigSection
} from '../../services/engine-api'
import { RuntimeConfigCard, type FieldDef } from './RuntimeConfigCard'

// 沙箱配置字段（对齐 KStock SandboxSettings，仅暴露本地场景字段）
const SANDBOX_FIELDS: FieldDef[] = [
  { key: 'use', label: '沙箱 Provider', type: 'string', hint: '类路径，默认 qilin.sandbox.local:LocalSandboxProvider' },
  { key: 'allow_host_bash', label: 'Host Bash', type: 'boolean', hint: '允许 bash 直接在宿主机执行（危险，仅信任环境）' },
  { key: 'bash_command_timeout', label: '命令超时（秒）', type: 'number', min: 1, step: 1, hint: 'bash 命令最长运行时间，超时自动终止' },
  { key: 'bash_output_max_chars', label: 'Bash 输出上限（字符）', type: 'number', min: 0, step: 1000, hint: '超出则中部截断，0 = 不截断' },
  { key: 'read_file_output_max_chars', label: '读文件输出上限（字符）', type: 'number', min: 0, step: 1000, hint: '超出则头部截断，0 = 不截断' },
  { key: 'ls_output_max_chars', label: 'LS 输出上限（字符）', type: 'number', min: 0, step: 1000, hint: '超出则头部截断，0 = 不截断' }
]

export function SandboxSettings() {
  const { t } = useI18n()
  const { enginePort, engineStatus } = useAppStore()
  const [runtimeCfg, setRuntimeCfg] = useState<RuntimeConfig | null>(null)
  const [cfgLoading, setCfgLoading] = useState(true)
  const [cfgSaving, setCfgSaving] = useState(false)
  const [refreshEffectedAt, setRefreshEffectedAt] = useState(0)

  // 加载运行时配置
  const loadRuntimeConfig = useCallback(async () => {
    if (engineStatus !== 'connected') { setCfgLoading(false); return }
    setCfgLoading(true)
    try {
      const api = getEngineAPI(enginePort)
      const cfg = await api.getRuntimeConfig()
      setRuntimeCfg(cfg)
    } catch (e) {
      console.error('[Sandbox] Failed to load runtime config:', e)
    } finally {
      setCfgLoading(false)
    }
  }, [enginePort, engineStatus])

  useEffect(() => {
    loadRuntimeConfig()
  }, [loadRuntimeConfig])

  // 保存后轮询刷新生效值（QiLin 热重载 1-2s 内生效）
  useEffect(() => {
    if (refreshEffectedAt === 0) return
    let cancelled = false
    const poll = async (): Promise<void> => {
      for (let i = 0; i < 3; i++) {
        await new Promise((r) => setTimeout(r, 800))
        if (cancelled) return
        try {
          const api = getEngineAPI(enginePort)
          const cfg = await api.getRuntimeConfig()
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
        const api = getEngineAPI(enginePort)
        await api.updateRuntimeConfigSection(section, value)
        setRuntimeCfg((prev) => prev ? { ...prev, [section]: value as never } : prev)
        setRefreshEffectedAt(Date.now())
      } finally {
        setCfgSaving(false)
      }
    },
    [enginePort]
  )

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto space-y-4">
        {/* Header */}
        <div>
          <h2 className="text-base font-semibold text-text-primary">{t('settings.sandbox.title')}</h2>
          <p className="text-xs text-text-muted mt-1">{t('settings.sandbox.desc')}</p>
        </div>

        {/* Restart hint */}
        <div className="flex items-start gap-2 rounded-lg border border-amber/30 bg-amber/5 px-3 py-2.5">
          <svg className="w-4 h-4 text-amber shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <p className="text-[11px] text-text-secondary leading-relaxed">{t('settings.sandbox.restartHint')}</p>
        </div>

        {/* Sandbox config card */}
        {cfgLoading ? (
          <div className="text-center py-6 text-xs text-text-muted">{t('common.loading')}</div>
        ) : runtimeCfg ? (
          <RuntimeConfigCard
            title={t('settings.sandbox.configTitle')}
            description={t('settings.sandbox.configDesc')}
            fields={SANDBOX_FIELDS}
            initialValue={runtimeCfg.sandbox as unknown as Record<string, unknown>}
            onSave={(v) => handleSaveSection('sandbox', v)}
            saving={cfgSaving}
          />
        ) : null}
      </div>
    </div>
  )
}
