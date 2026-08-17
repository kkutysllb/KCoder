/**
 * console 通道：注入脚本 → 主进程的回传机制。
 *
 * shell 窗口是纯浏览器载体（无 preload、sandbox），对上游页面的扩展
 * 经 `console.log('<前缀>:<载荷>')` 上报，主进程在 webContents
 * 'console-message' 事件里按前缀过滤——CSP 不影响、零导航开销，
 * 是无 preload 窗口里最轻的页面 → 主进程通道（主题/工作区终端在用）。
 *
 * Electron 新版把 message 收敛到 event 对象上；旧版为位置参数
 * (event, level, message, line, sourceId)。这里做双签名兼容。
 *
 * @module desktop/main/console-channel
 */

/** 从 console-message 事件参数取出消息文本（新旧签名兼容）。 */
export function consoleMessageText(event: unknown, rest: readonly unknown[]): string {
  const maybeMessage = (event as { message?: unknown } | null)?.message
  if (typeof maybeMessage === 'string') return maybeMessage
  return typeof rest[2] === 'string' ? (rest[2] as string) : ''
}
