/**
 * Preferences：桌面壳偏好设置（应用菜单 ⌘, / 工具 / 托盘）。
 *
 * 只留桌面特有项（托盘保活）。界面样式定制已移至上游设置面板的
 * 「通用」区（main/style-settings.ts 注入，console 通道写回）——设置
 * 入口统一到上游面板。变更即存即生效，无确定/取消按钮。
 *
 * @module desktop/renderer/src/views/preferences
 */

import { bridge } from '../bridge'
import { el } from './splash'
import type { Preferences } from '@shared/ipc-contract'

/** 页面私有样式（head 内幂等注入，hash 路由重挂不累积）。 */
const PAGE_CSS = `
.pref-opt { display: flex; align-items: flex-start; gap: 9px; padding: 6px 0; cursor: pointer; }
.pref-opt input { flex: none; margin: 2px 0 0; accent-color: var(--accent); }
.pref-opt .t { color: var(--text); }
.pref-opt .d { margin-top: 1px; color: var(--muted); font-size: 12px; }
`

/** 单个 radio/checkbox 选项行。 */
function option(
  type: 'radio' | 'checkbox',
  name: string,
  value: string,
  checked: boolean,
  label: string,
  hint: string,
  onChange: () => void,
): HTMLLabelElement {
  const input = document.createElement('input')
  input.type = type
  input.name = name
  input.value = value
  input.checked = checked
  input.addEventListener('change', onChange)
  return el('label', 'pref-opt', [
    input,
    el('div', '', [el('div', 't', label), el('div', 'd', hint)]),
  ]) as HTMLLabelElement
}

export function mountPreferences(root: HTMLElement): void {
  let tag = document.getElementById('__dsh_pref_style')
  if (tag === null) {
    tag = document.createElement('style')
    tag.id = '__dsh_pref_style'
    document.head.append(tag)
  }
  tag.textContent = PAGE_CSS

  const generalBody = document.createElement('div')

  root.append(
    el('div', 'page', [
      el('div', 'page-header', [
        el('h1', '', '偏好设置'),
        el('div', 'sub', '变更立即生效——切回主窗口即可看到，无需重启。'),
      ]),
      el('div', 'page-body', [
        el('div', 'card', [el('h2', '', '通用'), generalBody]),
      ]),
    ]),
  )

  let pref: Preferences | null = null

  const write = (patch: Partial<Preferences>): void => {
    if (pref === null) return
    void bridge.preferencesSet(patch).then((next) => {
      pref = next
      render()
    })
  }

  const renderGeneral = (): void => {
    if (pref === null) return
    generalBody.replaceChildren(
      option(
        'checkbox', 'dsh-tray', '1', pref.keepRunningInTray, '关闭主窗口时保持后台运行',
        '开启：最小化到托盘，引擎继续运行；关闭：退出引擎并关闭应用（默认开启）',
        () => write({ keepRunningInTray: !pref?.keepRunningInTray }),
      ),
    )
  }

  const render = (): void => {
    renderGeneral()
  }

  void bridge.preferencesGet().then((p) => {
    pref = p
    render()
  })
}
