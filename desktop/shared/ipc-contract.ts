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

/** 一次插件命令（add/remove/update）的执行结果。 */
export interface PluginCommandResult {
  ok: boolean
  /** 合并后的命令输出（尾部若干行）。 */
  output: string
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

/* ---------- preload 暴露面 ---------- */

/** preload 通过 contextBridge 暴露的 `window.dshDesktop`。 */
export interface DesktopBridge {
  /* 拉取 */
  dshStatus(): Promise<DshStatus>
  dshLogs(): Promise<DshLogLine[]>
  upstreamStatus(): Promise<UpstreamStatus>
  pluginsInstalled(): Promise<InstalledPlugin[]>
  pluginsCommunity(): Promise<CommunityPlugin[]>
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
  onPreviewActivity(cb: (e: PreviewEntry, focus: boolean) => void): () => void
  /** 工作区切换通知（活动已换桶，视图应重拉 previewEntries）。 */
  onPreviewRefresh(cb: () => void): () => void
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
}
