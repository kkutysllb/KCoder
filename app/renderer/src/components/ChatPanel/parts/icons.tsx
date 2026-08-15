/**
 * 工具类型图标映射 + 复用 SVG 子组件。
 *
 * 按 toolName 前缀分类，返回对应的线性图标（stroke=currentColor，1.5 线宽）。
 * 所有图标继承父元素的 text-* 颜色，方便用 className 覆盖。
 */

interface IconProps {
  className?: string
}

/** 通用扳手图标（默认 fallback）*/
function WrenchIcon({ className }: IconProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437 1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008Z"
      />
    </svg>
  )
}

/** 文件图标（read/write/edit/apply_patch）*/
function FileIcon({ className }: IconProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
      />
    </svg>
  )
}

/** 搜索图标（search/grep/list_dir/find）*/
function SearchIcon({ className }: IconProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
      />
    </svg>
  )
}

/** 终端图标（bash/run_command/sh/shell/exec）*/
function TerminalIcon({ className }: IconProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m6.75 7.5-3 2.25 3 2.25m4.5-4.5 3 2.25-3 2.25m6-7.5h3v3m0 9v3h-3M5.6 20.4h12.8a1.6 1.6 0 0 0 1.6-1.6V5.2a1.6 1.6 0 0 0-1.6-1.6H5.6A1.6 1.6 0 0 0 4 5.2v13.6a1.6 1.6 0 0 0 1.6 1.6Z"
      />
    </svg>
  )
}

/** 插件图标（mcp_*）*/
function PluginIcon({ className }: IconProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0 0 12 9.75c-2.584 0-5.134.217-7.5.638V21M3 21h18M12 6.75h.008v.008H12V6.75Z"
      />
    </svg>
  )
}

/** 网络/Globe 图标（fetch/curl/http/web）*/
function GlobeIcon({ className }: IconProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418"
      />
    </svg>
  )
}

/** 复用：对勾 */
export function CheckIcon({ className }: IconProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  )
}

/** 复用：叉 */
export function XIcon({ className }: IconProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  )
}

/** 复用：三点动画 */
export function StreamingDots() {
  return (
    <span className="inline-flex items-center gap-0.5">
      <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
      <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
      <span className="h-1 w-1 animate-bounce rounded-full bg-current" />
    </span>
  )
}

/** 按 toolName 选择对应图标 */
export function toolIconFor(toolName: string): ({ className }: IconProps) => JSX.Element {
  const name = toolName.toLowerCase()
  if (
    name.startsWith('read') ||
    name.startsWith('write') ||
    name.startsWith('edit') ||
    name.startsWith('apply_patch') ||
    name.startsWith('create_file') ||
    name.startsWith('delete_file') ||
    name.startsWith('move_file')
  ) {
    return FileIcon
  }
  if (
    name.startsWith('search') ||
    name.startsWith('grep') ||
    name.startsWith('find') ||
    name.startsWith('list_dir') ||
    name.startsWith('glob') ||
    name.startsWith('list_files')
  ) {
    return SearchIcon
  }
  if (
    name === 'bash' ||
    name === 'sh' ||
    name === 'shell' ||
    name === 'run_tests' ||
    name.startsWith('run_command') ||
    name.startsWith('exec') ||
    name.startsWith('terminal')
  ) {
    return TerminalIcon
  }
  if (name.startsWith('mcp_') || name.startsWith('plugin_')) {
    return PluginIcon
  }
  if (
    name.startsWith('fetch') ||
    name.startsWith('curl') ||
    name.startsWith('http') ||
    name.startsWith('web') ||
    name.startsWith('browse')
  ) {
    return GlobeIcon
  }
  return WrenchIcon
}
