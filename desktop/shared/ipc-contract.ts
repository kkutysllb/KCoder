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
  /** 终端区背景（深 #151517 = 950 / 浅 #FFFFFF = 00）。 */
  bg: string
  /** header 条背景（深 #1B1B1C = 900 / 浅 #F9FAFB = 50）。 */
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

/* ---------- 文件预览抽屉 ---------- */

/** 一次文件活动（agent 读/改了哪个文件），随 preview:activity 推送。 */
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
  /** 主进程请求选中展示（正文文件链接接管时 true；普通活动缺省）。 */
  focus?: boolean
}

/** preview:read-file 的结果（面板按需读盘）。 */
export interface PreviewFileContent {
  ok: boolean
  content: string | null
  /** 超过上限破截断。 */
  truncated: boolean
  error: string | null
}

/* ---------- 会话轨迹（预览抽屉的轨迹模式） ---------- */

/** 预览抽屉的展示模式：files = 文件活动流；trajectory = 会话轨迹时间线。 */
export type PreviewMode = 'files' | 'trajectory'

/** 轨迹时间线一行（当前会话的消息/工具事件摘要）。 */
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

/** trajectory:fetch 的结果（当前会话的完整时间线快照）。 */
export interface TrajectorySnapshot {
  /** 当前跟随的会话（无选中会话时 null）。 */
  sessionId: string | null
  /** 会话标题（侧边栏树节点标题，可能为空串）。 */
  title: string
  /** 时间线行（seq 升序，上限截断丢最老）。 */
  rows: TrajectoryRow[]
}

/* ---------- git 环境面板 ---------- */

/** 工作区里 agent 写下的计划文档（git 面板列出，点击进预览抽屉渲染）。 */
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
  /** 相对 HEAD 的增/删行数（numstat 求和；不含 untracked）。 */
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

/* ---------- preload 暴露面 ---------- */

/** preload 通过 contextBridge 暴露的 `window.dshDesktop`。 */
export interface DesktopBridge {
  /* 拉取 */
  dshStatus(): Promise<DshStatus>
  dshLogs(): Promise<DshLogLine[]>
  upstreamStatus(): Promise<UpstreamStatus>
  pluginsInstalled(): Promise<InstalledPlugin[]>
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
  /* 内嵌终端（shell 窗口底部面板，多标签） */
  /** 全部标签快照（面板初次挂载时拉取）。 */
  terminalTabs(): Promise<TerminalTab[]>
  /** 新建标签（工作目录 = 当前工作区），返回新标签。 */
  terminalNew(): Promise<TerminalTab>
  terminalWrite(id: number, data: string): Promise<void>
  terminalResize(id: number, cols: number, rows: number): Promise<void>
  /** 销毁对应标签并以当前工作区目录重建 shell。 */
  terminalRestartTab(id: number): Promise<TerminalTab | null>
  /** 关闭单个标签（杀 shell），返回剩余标签（空 = 全部关闭）。 */
  terminalClose(id: number): Promise<TerminalTab[]>
  /** 关闭面板（pty 全部保留，会话不丢）。 */
  terminalHide(): Promise<void>
  /** 拖拽面板上缘调高度（dy 向下为正），返回新高度。 */
  terminalPanelResize(dy: number): Promise<number>
  terminalTheme(): Promise<TerminalTheme>
  /* 剪贴板（终端右键菜单用；主进程 electron.clipboard 无权限问题） */
  clipboardReadText(): Promise<string>
  clipboardWriteText(text: string): Promise<void>
  /* 文件预览抽屉（右侧面板，agent 读/编辑文件的活动流） */
  /** 活动条目列表（最近在前，同文件聚合取最新）。 */
  previewEntries(): Promise<PreviewEntry[]>
  /** 按绝对路径读文件当前内容（限 1MB，超限截断）。 */
  previewReadFile(path: string): Promise<PreviewFileContent>
  /** 关闭抽屉（活动记录保留，重开即回）。 */
  previewHide(): Promise<void>
  /** 拖左缘调宽度（dx 向左为正 = 变宽），返回新宽度。 */
  previewPanelResize(dx: number): Promise<number>
  /** 用外部代码编辑器打开当前预览文件（探测 code/cursor/zed…）。 */
  previewOpenEditor(path: string): Promise<{ ok: boolean; error: string | null }>
  /** 抽屉当前模式（轨迹/文件，随状态栏按钮切换）。 */
  previewMode(): Promise<PreviewMode>
  /** 抽屉内切换模式（不强制展示抽屉）。 */
  previewSetMode(mode: PreviewMode): Promise<void>
  onPreviewActivity(cb: (e: PreviewEntry, focus: boolean) => void): () => void
  /** 工作区切换通知（活动已换桶，视图应重拉 previewEntries）。 */
  onPreviewRefresh(cb: () => void): () => void
  /** 模式切换通知（状态栏按钮触发；视图跟随切换内容区）。 */
  onPreviewMode(cb: (m: PreviewMode) => void): () => void
  /* 会话轨迹（预览抽屉的轨迹模式数据源） */
  /** 当前会话的轨迹时间线快照。 */
  trajectoryFetch(): Promise<TrajectorySnapshot>
  /** 时间线更新推送（新事件到达/会话切换）。 */
  onTrajectoryUpdate(cb: (s: TrajectorySnapshot) => void): () => void
  /* git 环境面板（右侧停靠；探测与写操作都在主进程串行执行） */
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
  /** 在预览抽屉中打开计划文档（git 面板收起、抽屉切文件模式渲染）。 */
  gitOpenPlan(path: string): Promise<void>
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
  /**
   * 工作区切换后 PtyHost 被主进程重置并在新路径上重建首个标签，
   * 渲染端应丢弃旧 tab 再 `terminalTabs()` 重拉，保证本地/远端一致。
   */
  onTerminalReset(cb: () => void): () => void
}
