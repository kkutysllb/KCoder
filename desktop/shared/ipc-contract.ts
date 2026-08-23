/**
 * 主进程 ↔ 渲染进程的 IPC 契约（双向唯一事实源）。
 *
 * 主进程在 ipc.ts 中按本文件注册；preload 按本文件暴露；
 * 渲染页面只 import 本文件类型，不感知 Electron。
 *
 * @module desktop/shared/ipc-contract
 */

/* ---------- dsh 侧车状态 ---------- */

/** dsh 侧车进程的运行状态机。 */
export type DshState = 'stopped' | 'starting' | 'ready' | 'failed' | 'restarting'

/** 一次状态快照，随 `dsh:state-changed` 广播，也可 `dsh:status` 拉取。 */
export interface DshStatus {
  state: DshState
  /** 就绪后的 Web UI 地址（http://127.0.0.1:<port>）。 */
  url: string | null
  /** 使用的启动来源。 */
  source: DshSource | null
  /** 最近一次失败原因（state=failed 时有值）。 */
  error: string | null
  /** 本会话内崩溃自动重启的剩余次数。 */
  restartsLeft: number
}

/** dsh 命令解析来源。 */
export type DshSource = 'env' | 'checkout' | 'path'

/** dsh:logs 事件的一行日志。 */
export interface DshLogLine {
  stream: 'stdout' | 'stderr'
  line: string
  at: number
}

/* ---------- 桌面壳偏好设置 ---------- */

/** 界面样式定制（预设档位；生效与否由 style-overlay 按此生成 CSS）。 */
export interface StyleSettings {
  /** 总开关：false = 完全回上游原样。 */
  enabled: boolean
  /** 正文密度：compact=14/22（默认）、standard=15/25、native=上游 16/28。 */
  density: 'compact' | 'standard' | 'native'
  /** 消息列宽：narrow=748（上游原生）、wide=960、extra=1080（默认）。 */
  contentWidth: 'narrow' | 'wide' | 'extra'
  /** 正文字号：'auto' = 跟随密度档（默认）；12–20 = 自定义 base，整套
   * 排版梯度（标题/代码/气泡）按所选密度档形状同比缩放。 */
  fontSize: 'auto' | number
}

/** Agent 回答语言定制（生效链见 language-settings.ts）。 */
export interface LanguageSettings {
  /** 强制 agent 正文用简体中文回答（false = 跟随模型默认）。 */
  forceChinese: boolean
}

/** 偏好设置页可读写的全部桌面壳偏好（样式 + 通用）。 */
export interface Preferences {
  style: StyleSettings
  /** 关闭主窗口时最小化到托盘（false = 直接退出 dsh 与应用）。 */
  keepRunningInTray: boolean
}

/* ---------- 上游仓库 ---------- */

/** 上游克隆的状态快照。 */
export interface UpstreamStatus {
  /** 上游克隆目录是否存在。 */
  cloned: boolean
  /** 当前 HEAD 短哈希。 */
  head: string | null
  /** 本地是否领先远端（自有提交）。 */
  ahead: boolean
  /** 本地是否落后远端（可同步）。 */
  behind: boolean
  /** 落后提交数（-1 表示未知）。 */
  behindCount: number
  /** 工作树是否被改动（同步会被拒绝）。 */
  dirty: boolean
  /** 构建产物（apps/cli/lib/bin.js）是否已生成。 */
  built: boolean
  /** 上游声明的 node 版本要求。 */
  nodeRange: string | null
}

/** upstream:progress 事件的一条流水线输出。 */
export interface UpstreamProgress {
  /** 当前步骤标签。 */
  step: string
  /** 一行输出（空串表示步骤完成）。 */
  line: string
  /** 是否出错终止。 */
  error: boolean
}

/* ---------- 插件 ---------- */

/** profile 中已安装的一个 bundle 层。 */
export interface InstalledPlugin {
  name: string
  /** 层叠顺序（0 = 最底层）。 */
  layer: number
  /** 是否随发行版模板内置（不可卸载）。 */
  inBox: boolean
  /** 实装版本（node_modules 内 package.json；内置层无实体为 null）。 */
  version: string | null
}

/** GitHub dsh-plugin 社区插件条目。 */
export interface CommunityPlugin {
  fullName: string
  description: string
  stars: number
  updatedAt: string
  url: string
}

/**
 * 社区插件的一次查询结果（GitHub Search API 单页上限 100 条；
 * 服务端按 ★ 倒序，页码用于「加载更多」翻页）。
 */
export interface CommunityQueryResult {
  items: CommunityPlugin[]
  /** 匹配仓库总数（全量分页口径，非本页条数）。 */
  totalCount: number
  /** 本次返回的页码（1 起；请求失败时沿用已缓存页）。 */
  page: number
}

/** 一次插件命令（add/remove/update）的执行结果。 */
export interface PluginCommandResult {
  ok: boolean
  /** 合并后的命令输出（尾部若干行）。 */
  output: string
}

/** 已装用户插件 → npm registry 最新版（查询失败的包不进结果）。 */
export type LatestVersions = Record<string, string>

/* ---------- 技能 ---------- */

/** 技能目录中的一个条目（枚举自文件系统，与插件页严格分开）。 */
export interface SkillCatalogEntry {
  /** kebab-case 技能名（`/name` 调用、模型目录匹配的键）。 */
  name: string
  /** 路由描述（模型匹配依据）。 */
  description: string
  /** 来源分区（optional = 随包分发但未注册，拷到用户目录即启用）。 */
  source: 'builtin' | 'project' | 'user' | 'shared' | 'optional'
  /** SKILL.md 绝对路径（正文读取白名单键）。 */
  path: string
}

/** 技能面板的一个来源分区。 */
export interface SkillCatalogGroup {
  id: 'builtin' | 'project' | 'user' | 'optional'
  title: string
  entries: SkillCatalogEntry[]
}

/* ---------- 应用自动更新 ---------- */

/**
 * 自动更新状态机。
 * - idle：初始（未检查）；checking：检测中
 * - unavailable：已是最新；available：发现新版本（即将/正在后台下载）
 * - downloading：后台下载中（progress 有值）；downloaded：下载完成，待用户触发安装
 * - installing：正在退出并安装（终态，随后进程被替换重启）
 * - error：检测或下载失败（error 有值）
 */
export type UpdateState =
  | 'idle'
  | 'checking'
  | 'unavailable'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error'

/** 更新状态快照，随 `update:state-changed` 广播，也可 `update:status` 拉取。 */
export interface UpdateStatus {
  state: UpdateState
  /** 当前运行版本（app 版本）。 */
  currentVersion: string
  /** 检测到的可用新版本（available 及之后有值）。 */
  availableVersion: string | null
  /** 下载进度 0–100（downloading 时有值）。 */
  progress: number | null
  /** 最近一次错误（state=error 时有值）。 */
  error: string | null
}

/* ---------- 内嵌终端 ---------- */

/** 终端面板/pty 的主题 token（上游 bg-base/sidebar-fill 系）。 */
export interface TerminalTheme {
  dark: boolean
  /** 终端区背景（深 #151517 / 浅 #FFFFFF）。 */
  bg: string
  /** header 条背景（深 #1B1B1C / 浅 #F9FAFB）。 */
  headerBg: string
  fg: string
  border: string
  accent: string
}

/** pty 会话快照（terminal:tabs / terminal:new 拉取）：一个标签 = 一个 shell。 */
export interface TerminalTab {
  id: number
  alive: boolean
  cwd: string
  /** shell 名（zsh/bash/powershell，tab/header 显示用）。 */
  title: string
}

/* ---------- 文件活动 ---------- */

/**
 * 一次文件活动（agent 读/改了哪个文件）。file-activity 聚合存储
 *（主进程内部），workspace-probe 消费驱动正文文件徽章。
 */
export interface PreviewEntry {
  /** 绝对路径（相对路径已按当前工作区解析）。 */
  path: string
  /** read = 读取；edit = 编辑/写入。 */
  kind: 'read' | 'edit'
  /** 事件时间（Date.now()）。 */
  at: number
  /** 最近一次编辑的增/删行数（kind=edit 有值）。 */
  added: number
  removed: number
  /** 语法高亮语言提示（上游 read 视图给出，或按扩展名推断）。 */
  lang: string | null
  /** 上游 applied hunk（kind=edit 有值；行级 diff 渲染原料）。 */
  diffs: Array<{ path: string; oldText: string | null; newText: string }> | null
  /** 主进程请求选中展示（历史回放标志；普通活动缺省）。 */
  focus?: boolean
}

/* ---------- git 环境面板 ---------- */

/** 轨迹时间线一行（当前会话的消息/工具事件摘要；子代理条目同构）。 */
export interface TrajectoryRow {
  /** 会话事件序号（升序排列基准）。 */
  seq: number
  /** 事件时间（Unix 毫秒）。 */
  at: number
  /** 所属轮次（turn/start 的 turn 号）。 */
  turn: number
  /** user = 用户消息；assistant = 助手消息；tool = 工具调用。 */
  kind: 'user' | 'assistant' | 'tool'
  /** user/assistant 的文本摘录（text 块拼接截断；纯图片/纯工具调用时 null）。 */
  text: string | null
  /** kind=tool 时的调用信息（其他 kind 为 null）。 */
  tool: {
    callId: string
    name: string
    /** running = 进行中；ok = 完成；error = 失败。 */
    status: 'running' | 'ok' | 'error'
    /** 耗时毫秒（完成后有值）。 */
    ms: number | null
  } | null
}

/** 工作区里 agent 写下的计划文档（git 面板列出，点击系统默认应用打开）。 */
export interface GitPlanFile {
  /** 绝对路径。 */
  path: string
  /** 标题（文档首个 # 标题，缺省回退文件名）。 */
  title: string
  /** 相对修改时间（git 风格「3 hours ago」）。 */
  when: string
}

/**
 * git 工作区状态快照（主进程探测；随 `git:changed` 推送，也可
 * `git:snapshot` 拉取）。非 git 仓库时 isRepo=false 其余字段归零。
 */
export interface GitSnapshot {
  /** 当前工作区名（路径尾段；无工作区 null）。 */
  workspace: string | null
  isRepo: boolean
  branch: string | null
  /** 上游分支短名（origin/main；无则 null）。 */
  upstream: string | null
  ahead: number | null
  behind: number | null
  staged: number
  changed: number
  untracked: number
  /** 相对 HEAD 的增/删行数（numstat 求和 + untracked 新文件行数）。 */
  added: number
  removed: number
  /** 本地分支列表（字母序；当前分支靠 branch 字段高亮）。 */
  branches: string[]
  /** 工作区内的计划文档（mtime 降序，最多 6 个；可为空）。 */
  plans: GitPlanFile[]
  commits: Array<{ hash: string; subject: string; when: string; author: string }>
  /** Fetch 进行中（按钮禁用态）。 */
  fetching: boolean
  /** 写操作（提交/推送/切分支/建分支）进行中，视图按钮禁用。 */
  busy: boolean
  error: string | null
}

/** git 写操作（commit/push/branch-create 等）的执行结果。 */
export interface GitOpResult {
  ok: boolean
  /** 失败时的首行错误文案（git 原样输出）。 */
  error: string | null
}

/** 子代理监控条目（subagent 子会话的聚合视图，git 面板展示）。 */
export interface SubagentEntry {
  /** 子会话 id。 */
  id: string
  /** 父会话 id（发起 subagent 工具调用的会话）。 */
  parentId: string | null
  /** 工作区显示名（cwd 尾段；跨工作区条目标注用，无 cwd 时 null）。 */
  ws: string | null
  /** 子代理名（agentPreset；缺省「子代理」）。 */
  label: string
  /** 任务描述（首条 user 消息摘录；未观察到时空串）。 */
  task: string
  /** 是否仍在运行（session.list 的 running，轮询刷新）。 */
  running: boolean
  /** 工具调用次数（tool/call 计数）。 */
  toolCalls: number
  /** 最后活动时间（Unix 毫秒；0 = 未观察到）。 */
  lastAt: number
  /** 执行轨迹（seq 升序，最多 N 行）。 */
  rows: TrajectoryRow[]
}

/* ---------- preload 暴露面 ---------- */

/** preload 通过 contextBridge 暴露的 `window.dshDesktop`。 */
export interface DesktopBridge {
  /* 拉取 */
  dshStatus(): Promise<DshStatus>
  dshLogs(): Promise<DshLogLine[]>
  upstreamStatus(): Promise<UpstreamStatus>
  pluginsInstalled(): Promise<InstalledPlugin[]>
  /** 批量查 npm registry 最新版（包名 → latest；离线/失败返回空对象）。 */
  pluginsLatest(names: string[]): Promise<LatestVersions>
  /**
   * 社区插件查询（GitHub topic `dsh-plugin`，按 ★ 倒序）。
   * @param query 关键词（空 = 全量榜单；服务端过滤，可搜到榜单外的插件）
   * @param page 页码（1 起；默认列表与搜索各自分页）
   */
  pluginsCommunity(query?: string, page?: number): Promise<CommunityQueryResult>
  /* 动作 */
  dshStart(): Promise<DshStatus>
  dshRestart(): Promise<DshStatus>
  updateCheck(): Promise<UpdateStatus>
  updateInstall(): Promise<UpdateStatus>
  updateStatus(): Promise<UpdateStatus>
  /** 打开已就绪的 dsh Web UI，并关闭当前 landing 窗口。 */
  showShell(): Promise<boolean>
  openExternal(url: string): Promise<void>
  revealPath(path: string): Promise<void>
  upstreamSync(): Promise<{ ok: boolean; error: string | null }>
  upstreamSetup(): Promise<{ ok: boolean; error: string | null }>
  pluginAdd(pkg: string): Promise<PluginCommandResult>
  pluginRemove(pkg: string): Promise<PluginCommandResult>
  pluginUpdate(pkg: string): Promise<PluginCommandResult>
  /* 剪贴板（面板右键菜单用；主进程 electron.clipboard 无权限问题） */
  clipboardReadText(): Promise<string>
  clipboardWriteText(text: string): Promise<void>
  /* 内嵌终端（面板视图 ↔ pty，多标签：每个工作区一份私有桶；调用方
   * 工作区 = event.sender 所属 view 的 workspace） */
  terminalTabs(): Promise<TerminalTab[]>
  terminalNew(): Promise<TerminalTab>
  terminalWrite(id: number, data: string): Promise<void>
  terminalResize(id: number, cols: number, rows: number): Promise<void>
  terminalRestartTab(id: number): Promise<TerminalTab | null>
  terminalClose(id: number): Promise<TerminalTab[]>
  terminalHide(): Promise<void>
  terminalPanelResize(dy: number): Promise<number>
  terminalTheme(): Promise<TerminalTheme>
  /* git 环境面板（右侧浮动卡片；探测与写操作主进程串行） */
  /** 当前快照（面板初次挂载时拉取）。 */
  gitSnapshot(): Promise<GitSnapshot>
  /** 触发一次重探（视图内手动刷新）。 */
  gitRefresh(): Promise<void>
  /** git fetch（拉取上游，完成后快照会再推一次）。 */
  gitFetch(): Promise<GitOpResult>
  /** 提交全部变更（add -A + commit -m；message 视图/主进程双重非空校验）。 */
  gitCommit(message: string): Promise<GitOpResult>
  /** 推送（有上游直接 push，否则 push -u origin HEAD）。 */
  gitPush(): Promise<GitOpResult>
  /** 切换本地分支（checkout）。 */
  gitBranchSwitch(name: string): Promise<GitOpResult>
  /** 新建分支并切换（base 空 = 从当前 HEAD）。 */
  gitBranchCreate(name: string, base: string | null): Promise<GitOpResult>
  /** 关闭面板（用户在面板内点关闭；算手动关闭，本次任务不再自动展开）。 */
  gitHide(): Promise<void>
  /** 用系统默认应用打开计划文档。 */
  gitOpenPlan(path: string): Promise<void>
  /* 子代理监控（subagent 子会话聚合；随面板打开启停轮询） */
  /** 当前工作区的子代理条目（面板初次挂载时拉取）。 */
  gitSubagents(): Promise<SubagentEntry[]>
  /** 子代理条目更新推送（轮询发现变化/mux 实时事件）。 */
  onGitSubagents(cb: (list: SubagentEntry[]) => void): () => void
  /** 快照更新推送（探测完成/操作完成/开合）。 */
  onGitSnapshot(cb: (s: GitSnapshot) => void): () => void
  /* 偏好设置（样式定制/托盘保活；样式变更后主进程自动重注入 shell 窗口） */
  preferencesGet(): Promise<Preferences>
  preferencesSet(patch: Partial<Preferences>): Promise<Preferences>
  /* 事件订阅（返回退订函数） */
  onDshStateChanged(cb: (s: DshStatus) => void): () => void
  onDshLog(cb: (l: DshLogLine) => void): () => void
  onUpstreamProgress(cb: (p: UpstreamProgress) => void): () => void
  onUpdateStateChanged(cb: (s: UpdateStatus) => void): () => void
  onTerminalData(cb: (chunk: string, id: number) => void): () => void
  onTerminalExit(cb: (id: number) => void): () => void
  onTerminalTheme(cb: (t: TerminalTheme) => void): () => void
  /** 工作区切换后 PtyHost 在新桶重建首标签，渲染端应丢弃旧 tab 重拉。 */
  onTerminalReset(cb: () => void): () => void
}
