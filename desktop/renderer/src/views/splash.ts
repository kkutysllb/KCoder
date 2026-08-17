/**
 * Splash：启动等待页。dsh 就绪自动切走（主进程负责），此处仅展示状态。
 *
 * @module desktop/renderer/src/views/splash
 */

import { bridge } from '../bridge'
import type { DshStatus } from '@shared/ipc-contract'

export function mountSplash(root: HTMLElement): void {
  const statusLine = document.createElement('div')
  statusLine.className = 'status'

  root.append(
    el('div', 'splash', [
      // KCoder 标志（build/icon.png）
      (() => {
        const img = document.createElement('img')
        img.src = 'kcoder.png'
        img.alt = 'KCoder'
        img.className = 'logo'
        return img
      })(),
      el('div', 'title', '正在启动 DeepSeek Harness…'),
      statusLine,
      el('div', 'spinner', ''),
    ]),
  )

  const update = (status: DshStatus): void => {
    statusLine.textContent =
      status.state === 'starting' ? '正在拉起 dsh web 服务…'
      : status.state === 'restarting' ? '正在重启 dsh…'
      : status.state === 'failed' ? `启动失败：${status.error ?? '未知原因'}（即将转至设置页）`
      : status.state === 'ready' ? '已就绪，正在打开主界面…'
      : '等待中…'
  }
  void bridge.dshStatus().then(update)
  bridge.onDshStateChanged(update)
}

/** 极简 DOM 构造器。 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  children: (Node | string)[] | string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (typeof children === 'string') node.textContent = children
  else for (const child of children) node.append(child)
  return node
}
