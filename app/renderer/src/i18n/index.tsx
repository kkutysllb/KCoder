// Lightweight i18n: locale dictionaries + React context + useI18n hook

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

export type Locale = 'zh-CN' | 'en'

type Dict = Record<string, string>

const zhCN: Dict = {
  // Sidebar
  'sidebar.collapse': '折叠侧边栏',
  'sidebar.newTask': '新建任务',
  'sidebar.search': '搜索',
  'sidebar.skills': '技能',
  'sidebar.group': '# 分组',
  'sidebar.project': '📁 项目',
  'sidebar.showMore': '显示更多',
  'sidebar.user': '用户',

  // WelcomeScreen
  'welcome.morning': '早上好，新的一天从代码开始',
  'welcome.afternoon': '下午好，保持专注继续前进',
  'welcome.evening': '晚上好，辛苦了一天记得休息',
  'welcome.night': '夜深啦，困了也要照顾好自己哦',
  'welcome.hintFile': '提及文件',
  'welcome.hintCommand': '命令',
  'welcome.hintSkill': '技能',
  'welcome.hintChat': '关联对话',

  // CommandInput
  'input.placeholder': '向 KCoder 提问, @ 提及文件、文件夹或画板, / 使用命令或子智能体, $ 使用技能, # 关联对话',
  'input.noModel': '未配置模型',
  'perm.confirmBeforeChange': '变更前确认',
  'perm.confirmBeforeChange.desc': '改文件前先问我。',
  'perm.autoEdit': '自动编辑',
  'perm.autoEdit.desc': '自动编辑文件。',
  'perm.planMode': '计划模式',
  'perm.planMode.desc': '编辑前先出计划。',
  'perm.fullAccess': '完全访问',
  'perm.fullAccess.desc': '减少确认次数。',

  // SettingsPanel - navigation
  'settings.backToWorkspace': '返回工作区',
  'settings.engine': '引擎 ',
  'settings.engineConnected': '已连接',
  'settings.engineDisconnected': '未连接',
  'settings.nav.general': '常规',
  'settings.nav.preview': '代码预览',
  'settings.nav.model': '模型设置',
  'settings.nav.skills': '技能',
  'settings.nav.remote': '远程控制',
  'settings.nav.advanced': '高级',
  'settings.nav.about': '关于',

  // SettingsPanel - general
  'settings.general.title': '常规',
  'settings.general.theme': '界面主题',
  'settings.general.theme.desc': '切换应用界面使用的主题外观。',
  'settings.general.theme.dark': '深色',
  'settings.general.theme.light': '浅色',
  'settings.general.theme.system': '跟随系统',
  'settings.general.language': '界面语言',
  'settings.general.language.desc': '选择应用 UI 的显示语言。',
  'settings.general.notification': '任务通知',
  'settings.general.notification.desc': '任务完成、失败或需要确认时发送桌面通知。',
  'settings.general.sound': '通知声音',
  'settings.general.sound.desc': '通知开启后，可单独关闭任务通知提示音。',
  'settings.general.thinking': '显示思考过程',
  'settings.general.thinking.desc': '在消息流中展示模型思考内容。',
  'settings.general.todo': '显示待办',
  'settings.general.todo.desc': '在消息流中展示 Todo 工具卡片。',
  'settings.general.interaction': '交互行为',
  'settings.general.interaction.desc': 'Agent 运行时将后续操作加入队列，或引导至下一轮工具调用后运行。',
  'settings.general.interaction.queue': '队列',
  'settings.general.interaction.guide': '引导',
  'settings.general.archive': '自动归档旧任务',
  'settings.general.archive.desc': '将已完成、未读、未置顶且超过保留期的任务自动归档。',
  'settings.general.retention': '归档保留时长',
  'settings.general.retention.desc': '任务最后更新时间早于该时长后，才会进入自动归档候选。',
  'settings.general.retention.7d': '7 天后归档',
  'settings.general.retention.14d': '14 天后归档',
  'settings.general.retention.30d': '30 天后归档',
  'settings.general.retention.90d': '90 天后归档',
  'settings.general.proxy': 'HTTP 代理',
  'settings.general.proxy.desc': '模型、MCP、命令工具与应用渲染层的出口流量经此代理；留空时直连。修改后需重启应用生效。',
  'settings.general.proxy.placeholder': '留空直连，例如 http://127.0.0.1:7890',
  'settings.general.noProxy': 'No Proxy',
  'settings.general.noProxy.desc': '匹配这些主机的请求将直连，不经过 HTTP 代理。多个规则用英文逗号分隔。修改后需重启应用生效。',
  'settings.general.noProxy.placeholder': '例如 localhost,127.0.0.1,.example.com',
  'settings.general.cert': '自定义证书',
  'settings.general.cert.desc': '可选。填写 PEM 根证书路径后，会作为 NODE_EXTRA_CA_CERTS 注入模型与工具进程。修改后需重启应用生效。',
  'settings.general.cert.placeholder': '例如 /Users/name/certs/root-ca.pem',
  'settings.general.dataPath': '数据存储路径',
  'settings.general.dataPath.desc': '应用数据的根目录，修改后会将现有数据复制到新位置。修改后需重启应用生效。',
  'settings.general.dataPath.placeholder': '默认为用户主目录',
  'settings.general.browse': '选择文件夹',
  'settings.general.save': '保存',

  // SettingsPanel - model
  'settings.model.enabled': '已启用',
  'settings.model.disabled': '未启用',
  'settings.model.enable': '启用此供应商',
  'settings.model.enable.desc': '启用后可在聊天时选择该供应商的模型',
  'settings.model.apiConfig': 'API 配置',
  'settings.model.apiUrl': 'API 地址',
  'settings.model.apiKey': 'API Key',
  'settings.model.apiKey.placeholder': '输入 API Key...',
  'settings.model.modelList': '模型列表',
  'settings.model.noModels': '暂无可用模型，请配置 API Key 后刷新。',
  'settings.model.addProvider': '添加供应商',
  'settings.model.plan.personal': '个人套餐',
  'settings.model.plan.team': '团队套餐',
  'settings.model.saveConfig': '保存配置',
  'settings.model.cancel': '取消',
  'settings.model.category.zhipu': '智谱',
  'settings.model.category.custom': '自定义供应商',

  // SettingsPanel - code preview
  'settings.preview.title': '代码预览',
  'settings.preview.lightTheme': '浅色代码主题',
  'settings.preview.lightTheme.desc': '浅色模式下代码块使用的高亮主题。',
  'settings.preview.darkTheme': '深色代码主题',
  'settings.preview.darkTheme.desc': '深色模式下代码块使用的高亮主题。',
  'settings.preview.lineNumbers': '显示行号',
  'settings.preview.lineNumbers.desc': '在代码预览中显示每一行的行号。',
  'settings.preview.wordWrap': '长行自动换行',
  'settings.preview.wordWrap.desc': '内容过长时在预览区域内自动换行。',
  'settings.preview.fontSize': '代码字号',
  'settings.preview.fontSize.desc': '调整代码预览的默认字号。',
  'settings.preview.lightPreview': '浅色预览',
  'settings.preview.darkPreview': '深色预览',
  'settings.preview.lightTag': '浅色',
  'settings.preview.activeTag': '当前生效',

  // SettingsPanel - placeholder page
  'settings.comingSoon': '即将推出',
  'settings.back': '返回',

  // CodeBlock
  'code.copy': '复制',
  'code.copied': '已复制',
}

const en: Dict = {
  // Sidebar
  'sidebar.collapse': 'Collapse Sidebar',
  'sidebar.newTask': 'New Task',
  'sidebar.search': 'Search',
  'sidebar.skills': 'Skills',
  'sidebar.group': '# Groups',
  'sidebar.project': '📁 Projects',
  'sidebar.showMore': 'Show more',
  'sidebar.user': 'User',

  // WelcomeScreen
  'welcome.morning': 'Good morning, start the day with code',
  'welcome.afternoon': 'Good afternoon, stay focused and keep going',
  'welcome.evening': 'Good evening, take a break after a long day',
  'welcome.night': 'It\'s late, take care of yourself',
  'welcome.hintFile': 'Mention files',
  'welcome.hintCommand': 'Commands',
  'welcome.hintSkill': 'Skills',
  'welcome.hintChat': 'Link chats',

  // CommandInput
  'input.placeholder': 'Ask KCoder, @ to mention files, / for commands or sub-agents, $ for skills, # to link chats',
  'input.noModel': 'No model configured',
  'perm.confirmBeforeChange': 'Confirm before change',
  'perm.confirmBeforeChange.desc': 'Ask me before modifying files.',
  'perm.autoEdit': 'Auto edit',
  'perm.autoEdit.desc': 'Edit files automatically.',
  'perm.planMode': 'Plan mode',
  'perm.planMode.desc': 'Create a plan before editing.',
  'perm.fullAccess': 'Full access',
  'perm.fullAccess.desc': 'Fewer confirmations.',

  // SettingsPanel - navigation
  'settings.backToWorkspace': 'Back to Workspace',
  'settings.engine': 'Engine ',
  'settings.engineConnected': 'Connected',
  'settings.engineDisconnected': 'Disconnected',
  'settings.nav.general': 'General',
  'settings.nav.preview': 'Code Preview',
  'settings.nav.model': 'Model Settings',
  'settings.nav.skills': 'Skills',
  'settings.nav.remote': 'Remote Control',
  'settings.nav.advanced': 'Advanced',
  'settings.nav.about': 'About',

  // SettingsPanel - general
  'settings.general.title': 'General',
  'settings.general.theme': 'Interface Theme',
  'settings.general.theme.desc': 'Switch the theme appearance of the app interface.',
  'settings.general.theme.dark': 'Dark',
  'settings.general.theme.light': 'Light',
  'settings.general.theme.system': 'Follow System',
  'settings.general.language': 'Interface Language',
  'settings.general.language.desc': 'Select the display language for the app UI.',
  'settings.general.notification': 'Task Notifications',
  'settings.general.notification.desc': 'Send desktop notifications when tasks complete, fail, or need confirmation.',
  'settings.general.sound': 'Notification Sound',
  'settings.general.sound.desc': 'Independently mute task notification sounds when notifications are on.',
  'settings.general.thinking': 'Show Thinking Process',
  'settings.general.thinking.desc': 'Display model thinking content in the message stream.',
  'settings.general.todo': 'Show Todos',
  'settings.general.todo.desc': 'Display Todo tool cards in the message stream.',
  'settings.general.interaction': 'Interaction Mode',
  'settings.general.interaction.desc': 'Queue subsequent actions while the agent is running, or guide them into the next tool call.',
  'settings.general.interaction.queue': 'Queue',
  'settings.general.interaction.guide': 'Guide',
  'settings.general.archive': 'Auto-archive Old Tasks',
  'settings.general.archive.desc': 'Automatically archive completed, unread, unpinned tasks past the retention period.',
  'settings.general.retention': 'Archive Retention',
  'settings.general.retention.desc': 'Tasks become archive candidates only after their last update exceeds this period.',
  'settings.general.retention.7d': 'Archive after 7 days',
  'settings.general.retention.14d': 'Archive after 14 days',
  'settings.general.retention.30d': 'Archive after 30 days',
  'settings.general.retention.90d': 'Archive after 90 days',
  'settings.general.proxy': 'HTTP Proxy',
  'settings.general.proxy.desc': 'Outbound traffic for models, MCP, command tools and the renderer goes through this proxy. Leave empty for direct connection. Restart required.',
  'settings.general.proxy.placeholder': 'Leave empty for direct, e.g. http://127.0.0.1:7890',
  'settings.general.noProxy': 'No Proxy',
  'settings.general.noProxy.desc': 'Requests matching these hosts connect directly, bypassing the HTTP proxy. Separate multiple rules with commas. Restart required.',
  'settings.general.noProxy.placeholder': 'e.g. localhost,127.0.0.1,.example.com',
  'settings.general.cert': 'Custom Certificate',
  'settings.general.cert.desc': 'Optional. When a PEM root certificate path is provided, it will be injected as NODE_EXTRA_CA_CERTS into model and tool processes. Restart required.',
  'settings.general.cert.placeholder': 'e.g. /Users/name/certs/root-ca.pem',
  'settings.general.dataPath': 'Data Storage Path',
  'settings.general.dataPath.desc': 'Root directory for app data. Existing data will be copied to the new location after change. Restart required.',
  'settings.general.dataPath.placeholder': 'Defaults to user home directory',
  'settings.general.browse': 'Select Folder',
  'settings.general.save': 'Save',

  // SettingsPanel - model
  'settings.model.enabled': 'Enabled',
  'settings.model.disabled': 'Disabled',
  'settings.model.enable': 'Enable this provider',
  'settings.model.enable.desc': 'Once enabled, you can select models from this provider in chat',
  'settings.model.apiConfig': 'API Configuration',
  'settings.model.apiUrl': 'API URL',
  'settings.model.apiKey': 'API Key',
  'settings.model.apiKey.placeholder': 'Enter API Key...',
  'settings.model.modelList': 'Model List',
  'settings.model.noModels': 'No models available. Configure an API Key and refresh.',
  'settings.model.addProvider': 'Add Provider',
  'settings.model.plan.personal': 'Personal Plan',
  'settings.model.plan.team': 'Team Plan',
  'settings.model.saveConfig': 'Save Configuration',
  'settings.model.cancel': 'Cancel',
  'settings.model.category.zhipu': 'Zhipu',
  'settings.model.category.custom': 'Custom Provider',

  // SettingsPanel - code preview
  'settings.preview.title': 'Code Preview',
  'settings.preview.lightTheme': 'Light Code Theme',
  'settings.preview.lightTheme.desc': 'Syntax highlighting theme for code blocks in light mode.',
  'settings.preview.darkTheme': 'Dark Code Theme',
  'settings.preview.darkTheme.desc': 'Syntax highlighting theme for code blocks in dark mode.',
  'settings.preview.lineNumbers': 'Show Line Numbers',
  'settings.preview.lineNumbers.desc': 'Display line numbers in the code preview.',
  'settings.preview.wordWrap': 'Word Wrap',
  'settings.preview.wordWrap.desc': 'Automatically wrap long lines in the preview area.',
  'settings.preview.fontSize': 'Code Font Size',
  'settings.preview.fontSize.desc': 'Adjust the default font size for code preview.',
  'settings.preview.lightPreview': 'Light Preview',
  'settings.preview.darkPreview': 'Dark Preview',
  'settings.preview.lightTag': 'Light',
  'settings.preview.activeTag': 'Active',

  // SettingsPanel - placeholder page
  'settings.comingSoon': 'Coming soon',
  'settings.back': 'Back',

  // CodeBlock
  'code.copy': 'Copy',
  'code.copied': 'Copied',
}

const dictionaries: Record<Locale, Dict> = { 'zh-CN': zhCN, en }

// ---- Context ----

interface I18nContextValue {
  locale: Locale
  setLocale: (l: Locale) => void
  t: (key: string) => string
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'zh-CN',
  setLocale: () => {},
  t: (key) => key,
})

const LOCALE_STORAGE_KEY = 'kcoder-general-prefs'

function loadSavedLocale(): Locale {
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (raw) {
      const lang = JSON.parse(raw).language
      if (lang === 'en' || lang === 'zh-CN') return lang
    }
  } catch { /* ignore */ }
  return 'zh-CN'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(loadSavedLocale)

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
  }, [])

  const t = useCallback(
    (key: string): string => dictionaries[locale][key] ?? dictionaries['zh-CN'][key] ?? key,
    [locale]
  )

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  return useContext(I18nContext)
}
