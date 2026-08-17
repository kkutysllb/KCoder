/**
 * `window.dshDesktop` 的渲染端类型声明（preload 注入）。
 *
 * @module desktop/renderer/src/bridge
 */

import type { DesktopBridge } from '@shared/ipc-contract'

declare global {
  interface Window {
    dshDesktop: DesktopBridge
  }
}

export const bridge: DesktopBridge = window.dshDesktop
