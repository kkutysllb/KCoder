import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '../../stores/app-store'
import { useI18n } from '../../i18n'
import {
  getEngineAPI,
  type RuntimeConfig
} from '../../services/engine-api'
import { RuntimeConfigCard, type FieldDef } from './RuntimeConfigCard'

// 网络代理与搜索工具字段
const NETWORK_FIELDS: FieldDef[] = [
  { key: 'proxy', label: '全局代理', type: 'nullable-string', hint: '所有 web 工具共享（web_search / web_fetch / 浏览器自动化）。http://host:port 或 socks5://host:port，留空直连' },
  { key: 'web_search_max_results', label: '网页搜索结果数', type: 'number', min: 1, max: 50, step: 1, hint: 'web_search 返回的最大结果数（1-50）' },
  { key: 'web_fetch_timeout', label: '网页抓取超时（秒）', type: 'number', min: 1, max: 120, step: 1, hint: 'web_fetch 每次请求的超时时间（1-120 秒）' },
  { key: 'image_search_max_results', label: '图片搜索结果数', type: 'number', min: 1, max: 50, step: 1, hint: 'image_search 返回的最大结果数（1-50）' }
]

// 浏览器自动化字段（Playwright Chromium）
const BROWSER_FIELDS: FieldDef[] = [
  { key: 'browser_headless', label: '无头模式 (Headless)', type: 'boolean', hint: '开启后浏览器在后台运行，不显示窗口' },
  { key: 'browser_viewport_width', label: '视口宽度', type: 'number', min: 320, max: 3840, step: 10, hint: '浏览器视口宽度（像素，320-3840）' },
  { key: 'browser_viewport_height', label: '视口高度', type: 'number', min: 240, max: 2160, step: 10, hint: '浏览器视口高度（像素，240-2160）' },
  { key: 'browser_timeout_ms', label: '超时（毫秒）', type: 'number', min: 1000, max: 120000, step: 1000, hint: 'Playwright 导航/交互操作的超时时间（1000-120000 毫秒）' }
]

export function WebToolsSettings() {
  const { t } = useI18n()
  const { enginePort, engineStatus } = useAppStore()
  const [runtimeCfg, setRuntimeCfg] = useState<RuntimeConfig | null>(null)
  const [cfgLoading, setCfgLoading] = useState(true)
  const [cfgSaving, setCfgSaving] = useState(false)
  const [refreshEffectedAt, setRefreshEffectedAt] = useState(0)

  const loadRuntimeConfig = useCallback(async () => {
    if (engineStatus !== 'connected') { setCfgLoading(false); return }
    setCfgLoading(true)
    try {
      const api = getEngineAPI(enginePort)
      const cfg = await api.getRuntimeConfig()
      setRuntimeCfg(cfg)
    } catch (e) {
      console.error('[WebTools] Failed to load runtime config:', e)
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

  // 保存时合并当前 network 生效值，避免两个 Card 互相覆盖
  const handleSaveNetwork = useCallback(
    async (value: Record<string, unknown>): Promise<void> => {
      setCfgSaving(true)
      try {
        const api = getEngineAPI(enginePort)
        // 合并：已有 network 段 + 本次编辑字段（后者覆盖前者）
        const merged = {
          ...(runtimeCfg?.network as unknown as Record<string, unknown> ?? {}),
          ...value,
        }
        await api.updateRuntimeConfigSection('network', merged)
        setRuntimeCfg((prev) => prev ? { ...prev, network: merged as never } : prev)
        setRefreshEffectedAt(Date.now())
      } finally {
        setCfgSaving(false)
      }
    },
    [enginePort, runtimeCfg]
  )

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto space-y-4">
        {/* Header */}
        <div>
          <h2 className="text-base font-semibold text-text-primary">{t('settings.web.title')}</h2>
          <p className="text-xs text-text-muted mt-1">{t('settings.web.desc')}</p>
        </div>

        {/* Proxy hint */}
        <div className="flex items-start gap-2 rounded-lg border border-border-custom bg-bg-surface px-3 py-2.5">
          <svg className="w-4 h-4 text-text-muted shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
          </svg>
          <p className="text-[11px] text-text-secondary leading-relaxed">{t('settings.web.proxyHint')}</p>
        </div>

        {cfgLoading ? (
          <div className="text-center py-6 text-xs text-text-muted">{t('common.loading')}</div>
        ) : runtimeCfg ? (
          <>
            {/* 网络代理与搜索 */}
            <RuntimeConfigCard
              title={t('settings.web.networkTitle')}
              description={t('settings.web.networkDesc')}
              fields={NETWORK_FIELDS}
              initialValue={runtimeCfg.network as unknown as Record<string, unknown>}
              onSave={handleSaveNetwork}
              saving={cfgSaving}
            />

            {/* 浏览器自动化 */}
            <RuntimeConfigCard
              title={t('settings.web.browserTitle')}
              description={t('settings.web.browserDesc')}
              fields={BROWSER_FIELDS}
              initialValue={runtimeCfg.network as unknown as Record<string, unknown>}
              onSave={handleSaveNetwork}
              saving={cfgSaving}
            />
          </>
        ) : null}
      </div>
    </div>
  )
}
