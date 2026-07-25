import { useState, useMemo } from 'react'
import { useI18n } from '../../i18n'

// ============ Commands Settings Page ============
// Commands in KCoder:
//   1. Skill commands — registered via skill.json "commands" field (read-only here)
//   2. User commands — standalone .md files, invoked via /command-name in chat
// Engine alignment: SkillManifestV1.commands[{ id, alias, description, injectPrompt }]

export interface CommandEntry {
  /** Command name (invoked as /name) */
  id: string
  description: string
  /** Markdown prompt content injected when invoked */
  content: string
  /** Where this command comes from */
  source: 'skill' | 'user'
  /** Parent skill id (for skill-sourced commands) */
  skillId?: string
  aliases: string[]
  createdAt?: string
  updatedAt?: string
}

// ---- Mock: builtin commands derived from installed skills ----
// TODO(backend): 后端无 /api/commands 路由（会 404），暂保留 mock 数据。
// 待后端补齐 commands 路由后，替换为 api.listCommands() 等调用。

const SKILL_COMMANDS: CommandEntry[] = [
  { id: 'deploy', description: 'Deploy the application', content: '', source: 'skill', skillId: 'deploy', aliases: ['部署'] },
  { id: 'write-plan', description: 'Write an implementation plan before coding', content: '', source: 'skill', skillId: 'writing-plans', aliases: ['写计划'] },
  { id: 'execute-plan', description: 'Execute an implementation plan with review checkpoints', content: '', source: 'skill', skillId: 'executing-plans', aliases: ['执行计划'] },
  { id: 'verify', description: 'Run verification before claiming completion', content: '', source: 'skill', skillId: 'verification', aliases: ['验证'] },
  { id: 'create-skill', description: 'Create or improve a skill package', content: '', source: 'skill', skillId: 'skill-creator', aliases: ['创建技能'] },
  { id: 'find-skill', description: 'Discover available skills for a task', content: '', source: 'skill', skillId: 'find-skills', aliases: ['找技能'] },
  { id: 'frontend-design', description: 'Design and build production-grade UI', content: '', source: 'skill', skillId: 'frontend-design', aliases: ['前端设计'] },
  { id: 'pdf', description: 'Manipulate PDF files', content: '', source: 'skill', skillId: 'pdf', aliases: [] },
  { id: 'docx', description: 'Create or edit Word documents', content: '', source: 'skill', skillId: 'docx', aliases: ['word'] },
  { id: 'xlsx', description: 'Manipulate spreadsheet files', content: '', source: 'skill', skillId: 'xlsx', aliases: ['excel'] },
  { id: 'release-notes', description: 'Generate release notes from git history', content: '', source: 'skill', skillId: 'release-notes', aliases: ['发布说明'] },
  { id: 'webapp-test', description: 'Test a running web app with Playwright', content: '', source: 'skill', skillId: 'webapp-testing', aliases: ['测试应用'] },
  { id: 'mcp-builder', description: 'Build an MCP server', content: '', source: 'skill', skillId: 'mcp-builder', aliases: ['构建MCP'] },
  { id: 'parallel', description: 'Dispatch independent tasks in parallel', content: '', source: 'skill', skillId: 'parallel-agents', aliases: ['并行'] },
]

// ---- Persistence layer (localStorage mock, to be replaced by engine API) ----

const STORAGE_KEY = 'kcoder-user-commands'

function loadUserCommands(): CommandEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveUserCommands(commands: CommandEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(commands))
  // Reserved: sync to engine — user commands stored as .md files
  // window.kcoder?.send('save-commands', { commands })
}

// Future API endpoints:
//   GET    /api/commands          → list all (skill + user)
//   POST   /api/commands          → create user command (.md file)
//   PUT    /api/commands/:id      → update user command
//   DELETE /api/commands/:id      → delete user command
//   POST   /api/commands/import   → import .md command files

// ============ Component ============

export function CommandsSettings() {
  const { t } = useI18n()
  const [userCommands, setUserCommands] = useState<CommandEntry[]>(loadUserCommands)
  const [search, setSearch] = useState('')
  const [editingCommand, setEditingCommand] = useState<CommandEntry | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const filteredSkill = SKILL_COMMANDS.filter((c) => matchSearch(c, search))
  const filteredUser = userCommands.filter((c) => matchSearch(c, search))

  const handleDelete = (id: string) => {
    const next = userCommands.filter((c) => c.id !== id)
    setUserCommands(next)
    saveUserCommands(next)
  }

  const handleSave = (command: CommandEntry) => {
    const exists = userCommands.some((c) => c.id === command.id)
    const next = exists
      ? userCommands.map((c) => (c.id === command.id ? { ...command, updatedAt: new Date().toISOString() } : c))
      : [...userCommands, command]
    setUserCommands(next)
    saveUserCommands(next)
    setEditingCommand(null)
    setShowCreate(false)
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-8 pt-8 pb-4">
        <div className="max-w-[680px] mx-auto">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-lg font-semibold text-text-primary">{t('settings.commands.title')}</h1>
              <p className="text-xs text-text-muted mt-1">{t('settings.commands.subtitle')}</p>
            </div>
            {/* Action buttons: + create, import, open folder, refresh */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowCreate(true)}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-border-custom text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
                title={t('settings.commands.create')}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </button>
              <button
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-border-custom text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
                title={t('settings.commands.import')}
                onClick={() => console.log('[KCoder] TODO: import .md command files via IPC')}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
              </button>
              <button
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-border-custom text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
                title={t('settings.commands.openFolder')}
                onClick={() => console.log('[KCoder] TODO: open commands folder via IPC')}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                </svg>
              </button>
              <button
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-border-custom text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
                title={t('settings.commands.refresh')}
                onClick={() => setUserCommands(loadUserCommands())}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                </svg>
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="mt-5">
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('settings.commands.search')}
                className="w-full pl-9 pr-4 py-2 rounded-lg text-sm bg-bg-input border border-border-custom text-text-primary placeholder-text-muted outline-none focus:border-border-strong transition-colors"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Command list */}
      <div className="flex-1 overflow-y-auto px-8 pb-8">
        <div className="max-w-[680px] mx-auto space-y-8 pt-2">
          {/* Skill commands section (read-only) */}
          {filteredSkill.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-xs font-medium text-text-muted">{t('settings.commands.section.skill')}</h2>
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-bg-hover text-text-muted border border-border-custom">
                    {filteredSkill.length}
                  </span>
                </div>
                <span className="text-[11px] text-text-muted opacity-70">{t('settings.commands.skillNote')}</span>
              </div>
              <div className="space-y-2">
                {filteredSkill.map((cmd) => (
                  <CommandCard key={cmd.id} command={cmd} />
                ))}
              </div>
            </section>
          )}

          {/* User commands section */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-xs font-medium text-text-muted">{t('settings.commands.section.user')}</h2>
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-bg-hover text-text-muted border border-border-custom">
                {filteredUser.length}
              </span>
            </div>
            {filteredUser.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border-custom py-10 text-center">
                <p className="text-sm text-text-muted">{t('settings.commands.empty')}</p>
                <button
                  onClick={() => setShowCreate(true)}
                  className="mt-3 px-4 py-1.5 rounded-lg text-xs text-text-secondary border border-border-custom hover:bg-bg-hover transition-colors"
                >
                  {t('settings.commands.create')}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredUser.map((cmd) => (
                  <CommandCard
                    key={cmd.id}
                    command={cmd}
                    onEdit={() => setEditingCommand(cmd)}
                    onDelete={() => handleDelete(cmd.id)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Create / Edit modal */}
      {(showCreate || editingCommand) && (
        <CommandEditorModal
          command={editingCommand}
          existingIds={[...SKILL_COMMANDS.map((c) => c.id), ...userCommands.map((c) => c.id)]}
          onSave={handleSave}
          onClose={() => { setEditingCommand(null); setShowCreate(false) }}
        />
      )}
    </div>
  )
}

function matchSearch(cmd: CommandEntry, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return (
    cmd.id.toLowerCase().includes(q) ||
    cmd.description.toLowerCase().includes(q) ||
    cmd.aliases.some((a) => a.toLowerCase().includes(q))
  )
}

// ============ Command Card ============

function CommandCard({
  command,
  onEdit,
  onDelete,
}: {
  command: CommandEntry
  onEdit?: () => void
  onDelete?: () => void
}) {
  const { t } = useI18n()
  const isSkill = command.source === 'skill'

  return (
    <div className="rounded-xl bg-bg-surface border border-border-subtle px-4 py-3 hover:border-border-strong transition-colors">
      <div className="flex items-center gap-3">
        {/* Slash command name */}
        <div className="shrink-0 w-[180px]">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-text-primary font-mono">/{command.id}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            {isSkill ? (
              <span className="px-1.5 py-px rounded text-[10px] font-medium bg-bg-hover text-text-muted border border-border-custom">
                {command.skillId}
              </span>
            ) : (
              <span className="px-1.5 py-px rounded text-[10px] font-medium bg-[#3b82f6]/10 text-[#3b82f6] border border-[#3b82f6]/30">
                .md
              </span>
            )}
          </div>
        </div>

        {/* Description */}
        <p className="flex-1 min-w-0 text-xs text-text-muted truncate">{command.description}</p>

        {/* Aliases */}
        {command.aliases.length > 0 && (
          <div className="shrink-0 flex items-center gap-1">
            {command.aliases.map((alias) => (
              <span key={alias} className="px-1.5 py-0.5 rounded bg-bg-hover text-[10px] text-text-muted">
                {alias}
              </span>
            ))}
          </div>
        )}

        {/* Actions (user commands only) */}
        {!isSkill && (
          <div className="shrink-0 flex items-center gap-1">
            <button
              onClick={onEdit}
              className="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
              title={t('settings.commands.edit')}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
              </svg>
            </button>
            <button
              onClick={onDelete}
              className="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-[#ef4444] hover:bg-[#ef4444]/10 transition-colors"
              title={t('settings.commands.delete')}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ============ Command Editor Modal ============

function CommandEditorModal({
  command,
  existingIds,
  onSave,
  onClose,
}: {
  command: CommandEntry | null
  existingIds: string[]
  onSave: (command: CommandEntry) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const isEdit = command !== null

  const [name, setName] = useState(command?.id ?? '')
  const [description, setDescription] = useState(command?.description ?? '')
  const [aliases, setAliases] = useState(command?.aliases.join(', ') ?? '')
  const [content, setContent] = useState(command?.content ?? '')
  const [err, setErr] = useState<string | null>(null)

  const handleSubmit = () => {
    const id = name.trim().toLowerCase().replace(/^\//, '').replace(/[^\w-]+/g, '-')
    if (!id) {
      setErr(t('settings.commands.editor.nameRequired'))
      return
    }
    if (!isEdit && existingIds.includes(id)) {
      setErr(t('settings.commands.editor.nameDuplicate'))
      return
    }
    onSave({
      id,
      description: description.trim(),
      content,
      source: 'user',
      aliases: aliases.split(',').map((s) => s.trim()).filter(Boolean),
      createdAt: command?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[560px] max-h-[85vh] overflow-y-auto rounded-2xl bg-bg-primary border border-border-custom p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-text-primary">
          {isEdit ? t('settings.commands.editor.editTitle') : t('settings.commands.editor.createTitle')}
        </h2>
        <p className="text-xs text-text-muted mt-1">{t('settings.commands.editor.hint')}</p>

        <div className="mt-5 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs text-text-muted mb-1.5">{t('settings.commands.editor.name')}</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-muted font-mono">/</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isEdit}
                placeholder={t('settings.commands.editor.name.placeholder')}
                className="w-full pl-7 pr-3 py-2 rounded-lg text-sm bg-bg-input border border-border-custom text-text-primary placeholder-text-muted outline-none focus:border-border-strong transition-colors font-mono disabled:opacity-50"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs text-text-muted mb-1.5">{t('settings.commands.editor.desc')}</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('settings.commands.editor.desc.placeholder')}
              className="w-full px-3 py-2 rounded-lg text-sm bg-bg-input border border-border-custom text-text-primary placeholder-text-muted outline-none focus:border-border-strong transition-colors"
            />
          </div>

          {/* Aliases */}
          <div>
            <label className="block text-xs text-text-muted mb-1.5">{t('settings.commands.editor.aliases')}</label>
            <input
              type="text"
              value={aliases}
              onChange={(e) => setAliases(e.target.value)}
              placeholder={t('settings.commands.editor.aliases.placeholder')}
              className="w-full px-3 py-2 rounded-lg text-sm bg-bg-input border border-border-custom text-text-primary placeholder-text-muted outline-none focus:border-border-strong transition-colors"
            />
            <p className="text-[11px] text-text-muted mt-1 opacity-70">{t('settings.commands.editor.aliases.hint')}</p>
          </div>

          {/* Markdown content */}
          <div>
            <label className="block text-xs text-text-muted mb-1.5">{t('settings.commands.editor.content')}</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={t('settings.commands.editor.content.placeholder')}
              rows={10}
              className="w-full px-3 py-2 rounded-lg text-sm bg-bg-input border border-border-custom text-text-primary placeholder-text-muted outline-none focus:border-border-strong transition-colors resize-none font-mono leading-relaxed"
            />
            <p className="text-[11px] text-text-muted mt-1 opacity-70">{t('settings.commands.editor.content.hint')}</p>
          </div>
        </div>

        {err && <p className="mt-3 text-xs text-[#ef4444]">{err}</p>}

        <div className="mt-5 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-text-secondary hover:bg-bg-hover transition-colors"
          >
            {t('settings.commands.editor.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            className="px-5 py-2 rounded-lg text-sm font-medium bg-white text-black hover:bg-gray-200 transition-colors"
          >
            {t('settings.commands.editor.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
