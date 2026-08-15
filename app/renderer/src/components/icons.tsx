// icons.tsx — 统一图标组件（避免 Sidebar / App / StatusBar 重复 inline SVG）。
//
// 约定：
// - 全部 stroke=currentColor，颜色跟随父元素 text-* 类。
// - strokeWidth 默认 1.5，个别图标（对勾/叉/箭头）用 2 更清晰。
// - 尺寸由调用方 className 控制（w-* h-*）。

export interface IconProps {
  className?: string
  strokeWidth?: number
}

function Svg({
  className = 'w-4 h-4',
  strokeWidth = 1.5,
  children
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={strokeWidth}
    >
      {children}
    </svg>
  )
}

export function IconPlus({ className, strokeWidth }: IconProps) {
  return (
    <Svg className={className} strokeWidth={strokeWidth}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </Svg>
  )
}

export function IconSearch({ className, strokeWidth }: IconProps) {
  return (
    <Svg className={className} strokeWidth={strokeWidth}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
      />
    </Svg>
  )
}

export function IconClock({ className, strokeWidth }: IconProps) {
  return (
    <Svg className={className} strokeWidth={strokeWidth}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </Svg>
  )
}

export function IconBolt({ className, strokeWidth }: IconProps) {
  return (
    <Svg className={className} strokeWidth={strokeWidth}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13 10V3L4 14h7v7l9-11h-7z"
      />
    </Svg>
  )
}

export function IconFolder({ className, strokeWidth }: IconProps) {
  return (
    <Svg className={className} strokeWidth={strokeWidth}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
      />
    </Svg>
  )
}

export function IconHash({ className, strokeWidth }: IconProps) {
  return (
    <Svg className={className} strokeWidth={strokeWidth}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18" />
    </Svg>
  )
}

export function IconChevronDown({ className, strokeWidth }: IconProps) {
  return (
    <Svg className={className} strokeWidth={strokeWidth}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </Svg>
  )
}

export function IconChevronLeft({ className, strokeWidth }: IconProps) {
  return (
    <Svg className={className} strokeWidth={strokeWidth}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </Svg>
  )
}

export function IconChevronRight({ className, strokeWidth }: IconProps) {
  return (
    <Svg className={className} strokeWidth={strokeWidth}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </Svg>
  )
}

export function IconPanelLeftClose({ className, strokeWidth }: IconProps) {
  return (
    <Svg className={className} strokeWidth={strokeWidth}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 5.25h16.5a.75.75 0 01.75.75v12a.75.75 0 01-.75.75H3.75a.75.75 0 01-.75-.75V6a.75.75 0 01.75-.75zM14 9l-3 3 3 3"
      />
    </Svg>
  )
}

export function IconSortUpDown({ className, strokeWidth }: IconProps) {
  return (
    <Svg className={className} strokeWidth={strokeWidth}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 7.5L7.5 3m0 0L12 7.5M7.5 3v13.5m13.5 0L16.5 21m0 0L12 16.5m4.5 4.5V7.5"
      />
    </Svg>
  )
}

export function IconArchiveBox({ className, strokeWidth }: IconProps) {
  return (
    <Svg className={className} strokeWidth={strokeWidth}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"
      />
    </Svg>
  )
}

export function IconCheck({ className, strokeWidth }: IconProps) {
  return (
    <Svg className={className} strokeWidth={strokeWidth}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </Svg>
  )
}

export function IconChatBubble({ className, strokeWidth }: IconProps) {
  return (
    <Svg className={className} strokeWidth={strokeWidth}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
      />
    </Svg>
  )
}

export function IconSettings({ className, strokeWidth }: IconProps) {
  return (
    <Svg className={className} strokeWidth={strokeWidth}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </Svg>
  )
}

export function IconDevice({ className, strokeWidth }: IconProps) {
  return (
    <Svg className={className} strokeWidth={strokeWidth}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 18h.01M8 21h8a1 1 0 001-1V4a1 1 0 00-1-1H8a1 1 0 00-1 1v16a1 1 0 001 1z"
      />
    </Svg>
  )
}

export function IconLogout({ className, strokeWidth }: IconProps) {
  return (
    <Svg className={className} strokeWidth={strokeWidth}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
      />
    </Svg>
  )
}

export function IconPencil({ className, strokeWidth }: IconProps) {
  return (
    <Svg className={className} strokeWidth={strokeWidth}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
      />
    </Svg>
  )
}

export function IconTrash({ className, strokeWidth }: IconProps) {
  return (
    <Svg className={className} strokeWidth={strokeWidth}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
      />
    </Svg>
  )
}

export function IconTerminal({ className, strokeWidth }: IconProps) {
  return (
    <Svg className={className} strokeWidth={strokeWidth}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z"
      />
    </Svg>
  )
}

export function IconInfo({ className, strokeWidth }: IconProps) {
  return (
    <Svg className={className} strokeWidth={strokeWidth}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"
      />
    </Svg>
  )
}

export function IconChanges({ className, strokeWidth }: IconProps) {
  return (
    <Svg className={className} strokeWidth={strokeWidth}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 12.25l4.5-4.5 4.5 4.5M12 7.75v9.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 4.5h15" opacity={0.4} />
    </Svg>
  )
}

export function IconFilePreview({ className, strokeWidth }: IconProps) {
  return (
    <Svg className={className} strokeWidth={strokeWidth}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 3.75v16.5a.75.75 0 00.75.75H19.5a.75.75 0 00.75-.75V3.75a.75.75 0 00-.75-.75H4.5a.75.75 0 00-.75.75zM14.25 3.75v16.5"
      />
    </Svg>
  )
}

export function IconX({ className, strokeWidth }: IconProps) {
  return (
    <Svg className={className} strokeWidth={strokeWidth}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </Svg>
  )
}
