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
  /* 偏好设置（样式定制/托盘保活；样式变更后主进程自动重注入 shell 窗口） */
  preferencesGet(): Promise<Preferences>
  preferencesSet(patch: Partial<Preferences>): Promise<Preferences>
  /* 事件订阅（返回退订函数） */
  onDshStateChanged(cb: (s: DshStatus) => void): () => void
  onDshLog(cb: (l: DshLogLine) => void): () => void
  onUpstreamProgress(cb: (p: UpstreamProgress) => void): () => void
  onUpdateStateChanged(cb: (s: UpdateStatus) => void): () => void
}
