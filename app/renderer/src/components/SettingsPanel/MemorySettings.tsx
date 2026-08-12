import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '../../stores/app-store'
import { useI18n } from '../../i18n'
import {
  getEngineAPI,
  type MemoryRecord,
  type RuntimeConfig,
  type RuntimeConfigSection
} from '../../services/engine-api'
import { RuntimeConfigCard, type FieldDef } from './RuntimeConfigCard'

// 记忆机制配置字段
const MEMORY_FIELDS: FieldDef[] = [
  { key: 'enabled', label: '启用记忆机制', type: 'boolean', hint: '总开关（关闭后 agent 不再记忆）' },
  {
    key: 'mode',
    label: '运行模式',
    type: 'select',
    hint: 'middleware 被动摘要 / tool 模型主动调用',
    options: [
      { value: 'middleware', label: '中间件（被动摘要）' },
      { value: 'tool', label: '工具（模型主动调用）' }
    ]
  },
  { key: 'injection_enabled', label: '注入系统提示', type: 'boolean', hint: '把记忆注入到 system prompt' },
  {
    key: 'shutdown_flush_timeout_seconds',
    label: '关闭刷新超时（秒）',
    type: 'number',
    min: 1,
    max: 300,
    step: 1,
    hint: '优雅关闭时刷入记忆的最大秒数'
  },
  {
    key: 'manager_class',
    label: '后端选择器',
    type: 'string',
    hint: 'qilinmem / noop 或点分路径'
  }
]

// 摘要配置字段
const SUMMARIZATION_FIELDS: FieldDef[] = [
  { key: 'enabled', label: '启用摘要', type: 'boolean', hint: '长会话达到阈值时自动压缩历史' },
  {
    key: 'model_name',
    label: '摘要模型',
    type: 'nullable-string',
    hint: '留空 = 用运行模型生成'
  },
  {
    key: 'trigger',
    label: '触发阈值',
    type: 'context-size',
    hint: '达到阈值时触发压缩（OR 逻辑，任一满足即触发）'
  },
  {
    key: 'keep',
    label: '保留策略',
    type: 'context-size',
    hint: '压缩后保留多少历史'
  },
  {
    key: 'trim_tokens_to_summarize',
    label: '截断 token 上限',
    type: 'number',
    min: 0,
    step: 100,
    hint: '准备消息时的最大 token 数'
  }
]

// 标题生成配置字段
const TITLE_FIELDS: FieldDef[] = [
  { key: 'enabled', label: '启用标题生成', type: 'boolean' },
  { key: 'max_words', label: '最大词数', type: 'number', min: 1, max: 20, step: 1 },
  { key: 'max_chars', label: '最大字符数', type: 'number', min: 10, max: 200, step: 1 },
  {
    key: 'model_name',
    label: '标题模型',
    type: 'nullable-string',
    hint: '留空 = 本地快速回退'
  }
]

// ============ Memory Settings Page ============

export function MemorySettings() {
  const { t } = useI18n()
  const { enginePort, engineStatus, workspacePath } = useAppStore()
  const [memories, setMemories] = useState<MemoryRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [factsExpanded, setFactsExpanded] = useState(true)

  // Runtime config state（三段配置）
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
      // 配置加载失败不阻断事实面板
      console.error('[Memory] Failed to load runtime config:', e)
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
        // 立即更新本地（optimistic），轮询会拿回热重载后的值
        setRuntimeCfg((prev) => prev ? { ...prev, [section]: value as never } : prev)
        setRefreshEffectedAt(Date.now())
      } finally {
        setCfgSaving(false)
      }
    },
    [enginePort]
  )

  // 记忆事实 CRUD（保留原有逻辑）
  const loadMemories = useCallback(async () => {
    if (engineStatus !== 'connected') { setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      const api = getEngineAPI(enginePort)
      const list = await api.listMemories({ ...(workspacePath ? { workspace: workspacePath } : {}) })
      setMemories(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [enginePort, engineStatus, workspacePath])

  useEffect(() => {
    loadMemories()
  }, [loadMemories])

  const handleCreate = async (content: string, scope: 'user' | 'workspace' | 'project', tags: string[]): Promise<void> => {
    try {
      const api = getEngineAPI(enginePort)
      await api.createMemory({ content, scope, tags, ...(workspacePath ? { workspace: workspacePath } : {}) })
      setShowCreate(false)
      await loadMemories()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleUpdate = async (id: string): Promise<void> => {
    try {
      const api = getEngineAPI(enginePort)
      await api.updateMemory(id, { content: editContent })
      setEditingId(null)
      await loadMemories()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleDelete = async (id: string): Promise<void> => {
    try {
      const api = getEngineAPI(enginePort)
      await api.deleteMemory(id)
      await loadMemories()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleToggleDisable = async (memory: MemoryRecord): Promise<void> => {
    try {
      const api = getEngineAPI(enginePort)
      await api.updateMemory(memory.id, { disabled: !memory.disabledAt })
      await loadMemories()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-text-primary">{t('settings.memory.title')}</h2>
            <p className="text-xs text-text-muted mt-1">{t('settings.memory.desc')}</p>
          </div>
        </div>

        {/* Runtime config cards */}
        {cfgLoading ? (
          <div className="text-center py-6 text-xs text-text-muted">{t('common.loading')}</div>
        ) : runtimeCfg ? (
          <div className="space-y-3">
            <RuntimeConfigCard
              title={t('settings.memory.configTitle')}
              description={t('settings.memory.configDesc')}
              fields={MEMORY_FIELDS}
              initialValue={runtimeCfg.memory as unknown as Record<string, unknown>}
              onSave={(v) => handleSaveSection('memory', v)}
              saving={cfgSaving}
            />
            <RuntimeConfigCard
              title={t('settings.memory.summarizationTitle')}
              description={t('settings.memory.summarizationDesc')}
              fields={SUMMARIZATION_FIELDS}
              initialValue={runtimeCfg.summarization as unknown as Record<string, unknown>}
              onSave={(v) => handleSaveSection('summarization', v)}
              saving={cfgSaving}
            />
            <RuntimeConfigCard
              title={t('settings.memory.titleConfigTitle')}
              description={t('settings.memory.titleConfigDesc')}
              fields={TITLE_FIELDS}
              initialValue={runtimeCfg.title as unknown as Record<string, unknown>}
              onSave={(v) => handleSaveSection('title', v)}
              saving={cfgSaving}
            />
          </div>
        ) : null}

        {/* Divider */}
        <div className="border-t border-border-custom pt-4 mt-6">
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              onClick={() => setFactsExpanded((v) => !v)}
              className="flex items-center gap-1.5 text-sm font-semibold text-text-primary hover:opacity-80 transition-opacity"
            >
              <svg className={`w-3.5 h-3.5 transition-transform ${factsExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              {t('settings.memory.factsTitle')}
              <span className="text-xs font-normal text-text-muted">({memories.length})</span>
            </button>
            <button
              onClick={() => { setShowCreate(true); setFactsExpanded(true) }}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white text-black hover:bg-gray-200 transition-colors"
            >
              + {t('settings.memory.create')}
            </button>
          </div>

          {factsExpanded && (
            <>
          {/* Stats */}
          <div className="flex gap-3 text-xs text-text-muted mb-3">
            <span>{t('settings.memory.total')}: {memories.length}</span>
            <span>{t('settings.memory.active')}: {memories.filter((m) => !m.disabledAt && !m.deletedAt).length}</span>
            <span>{t('settings.memory.disabled')}: {memories.filter((m) => m.disabledAt).length}</span>
          </div>

          {error && (
            <div className="px-3 py-2 rounded-lg bg-[#ef4444]/10 text-[#ef4444] text-xs mb-3">{error}</div>
          )}

          {/* Create form */}
          {showCreate && (
            <CreateMemoryForm
              onSubmit={handleCreate}
              onCancel={() => setShowCreate(false)}
            />
          )}

          {/* Memory list */}
          {loading ? (
            <div className="text-center py-8 text-xs text-text-muted">{t('common.loading')}</div>
          ) : memories.length === 0 ? (
            <div className="text-center py-12 text-xs text-text-muted">{t('settings.memory.empty')}</div>
          ) : (
            <div className="space-y-2">
              {memories.map((memory) => (
                <div
                  key={memory.id}
                  className={`rounded-lg border p-3 transition-colors ${
                    memory.deletedAt ? 'border-border-subtle opacity-40' :
                    memory.disabledAt ? 'border-[#f59e0b]/30 bg-[#f59e0b]/5' :
                    'border-border-custom bg-bg-input'
                  }`}
                >
                  {editingId === memory.id ? (
                    /* Edit mode */
                    <div className="space-y-2">
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        rows={3}
                        className="w-full px-3 py-2 rounded-lg text-sm bg-bg-hover border border-border-custom text-text-primary outline-none focus:border-[#3b82f6] resize-none"
                      />
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setEditingId(null)} className="px-3 py-1 rounded text-xs text-text-muted hover:bg-bg-hover">{t('common.cancel')}</button>
                        <button onClick={() => handleUpdate(memory.id)} className="px-3 py-1 rounded text-xs bg-white text-black hover:bg-gray-200">{t('common.save')}</button>
                      </div>
                    </div>
                  ) : (
                    /* View mode */
                    <>
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-text-primary whitespace-pre-wrap break-words">{memory.content}</p>
                          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover text-text-muted">{memory.scope}</span>
                            {memory.confidence < 1 && (
                              <span className="text-[10px] text-text-muted">{Math.round(memory.confidence * 100)}%</span>
                            )}
                            {memory.tags.map((tag) => (
                              <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-[#3b82f6]/10 text-[#3b82f6]">#{tag}</span>
                            ))}
                            {memory.disabledAt && <span className="text-[10px] text-[#f59e0b]">{t('settings.memory.disabledBadge')}</span>}
                            {memory.deletedAt && <span className="text-[10px] text-[#ef4444]">{t('settings.memory.deletedBadge')}</span>}
                          </div>
                        </div>
                        {/* Actions */}
                        {!memory.deletedAt && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => { setEditingId(memory.id); setEditContent(memory.content) }}
                              title={t('common.edit')}
                              className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => handleToggleDisable(memory)}
                              title={memory.disabledAt ? t('settings.memory.enable') : t('settings.memory.disable')}
                              className="p-1 rounded text-text-muted hover:text-[#f59e0b] hover:bg-bg-hover transition-colors"
                            >
                              {memory.disabledAt ? (
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1 1 0 010-.644C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178a1 1 0 010 .644C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.964-7.178z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                              ) : (
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                                </svg>
                              )}
                            </button>
                            <button
                              onClick={() => handleDelete(memory.id)}
                              title={t('common.delete')}
                              className="p-1 rounded text-text-muted hover:text-[#ef4444] hover:bg-bg-hover transition-colors"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                              </svg>
                            </button>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function CreateMemoryForm({ onSubmit, onCancel }: { onSubmit: (content: string, scope: 'user' | 'workspace' | 'project', tags: string[]) => void; onCancel: () => void }) {
  const { t } = useI18n()
  const [content, setContent] = useState('')
  const [scope, setScope] = useState<'user' | 'workspace' | 'project'>('workspace')
  const [tagsInput, setTagsInput] = useState('')

  const handleSubmit = (): void => {
    if (!content.trim()) return
    const tags = tagsInput.split(',').map((s) => s.trim()).filter(Boolean)
    onSubmit(content.trim(), scope, tags)
  }

  return (
    <div className="rounded-lg border border-border-custom bg-bg-input p-4 space-y-3 mb-3">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={t('settings.memory.create.placeholder')}
        rows={3}
        className="w-full px-3 py-2 rounded-lg text-sm bg-bg-hover border border-border-custom text-text-primary placeholder-text-muted outline-none focus:border-[#3b82f6] resize-none"
      />
      <div className="flex items-center gap-3">
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as 'user' | 'workspace' | 'project')}
          className="px-3 py-1.5 rounded-lg text-xs bg-bg-hover border border-border-custom text-text-primary outline-none"
        >
          <option value="user">user</option>
          <option value="workspace">workspace</option>
          <option value="project">project</option>
        </select>
        <input
          type="text"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          placeholder={t('settings.memory.create.tags')}
          className="flex-1 px-3 py-1.5 rounded-lg text-xs bg-bg-hover border border-border-custom text-text-primary placeholder-text-muted outline-none focus:border-[#3b82f6]"
        />
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-1.5 rounded text-xs text-text-muted hover:bg-bg-hover">{t('common.cancel')}</button>
        <button onClick={handleSubmit} disabled={!content.trim()} className="px-4 py-1.5 rounded text-xs font-medium bg-white text-black hover:bg-gray-200 disabled:opacity-40">{t('common.create')}</button>
      </div>
    </div>
  )
}
