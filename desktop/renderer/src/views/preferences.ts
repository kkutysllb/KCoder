/**
 * Preferences：桌面壳偏好设置（应用菜单 ⌘, / 工具 / 托盘）。
 *
 * 两组：界面样式（档位驱动 style-overlay，写后主进程即时重注入
 * shell 窗口）与通用行为（托盘保活——此前只能手改 JSON）。
 * 变更即存即生效，无确定/取消按钮。
 *
 * @module desktop/renderer/src/views/preferences
 */

import { bridge } from '../bridge'
import { el } from './splash'
import type { Preferences, StyleSettings } from '@shared/ipc-contract'

/** 页面私有样式（head 内幂等注入，hash 路由重挂不累积）。 */
const PAGE_CSS = `
.pref-opt { display: flex; align-items: flex-start; gap: 9px; padding: 6px 0; cursor: pointer; }
.pref-opt input { flex: none; margin: 2px 0 0; accent-color: var(--accent); }
.pref-opt .t { color: var(--text); }
.pref-opt .d { margin-top: 1px; color: var(--muted); font-size: 12px; }
.pref-group { margin-top: 14px; }
.pref-group > .caption { margin: 0 0 4px; color: var(--muted); font-size: 12px; }
.pref-opts { display: flex; flex-wrap: wrap; gap: 2px 24px; }
.pref-disabled { opacity: 0.45; pointer-events: none; }
`

const DENSITY_OPTS: Array<{ value: StyleSettings['density']; label: string; hint: string }> = [
  { value: 'compact', label: '紧凑', hint: '正文 14px · 信息密度高（默认）' },
  { value: 'standard', label: '标准', hint: '正文 15px · 居中折衷' },
  { value: 'native', label: '原生', hint: '上游 16px · 完全原始排版' },
]

const WIDTH_OPTS: Array<{ value: StyleSettings['contentWidth']; label: string; hint: string }> = [
  { value: 'narrow', label: '紧凑', hint: '748px（上游默认）' },
  { value: 'wide', label: '加宽', hint: '960px' },
  { value: 'extra', label: '超宽', hint: '1080px（默认）' },
]

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

  const styleBody = document.createElement('div')
  const generalBody = document.createElement('div')

  root.append(
    el('div', 'page', [
      el('div', 'page-header', [
        el('h1', '', '偏好设置'),
        el('div', 'sub', '变更立即生效——切回主窗口即可看到，无需重启。'),
      ]),
      el('div', 'page-body', [
        el('div', 'card', [el('h2', '', '界面样式'), styleBody]),
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

  const renderStyle = (): void => {
    const s = pref?.style
    if (s === undefined) return
    const enableRow = option(
      'checkbox', 'dsh-style-enabled', '1', s.enabled, '启用样式定制',
      '关闭 = 完全恢复上游原版排版（列宽 748、正文 16px、气泡原样）',
      () => write({ style: { ...s, enabled: !s.enabled } }),
    )
    const densityGroup = el('div', 'pref-group', [
      el('div', 'caption', '正文密度'),
      el('div', 'pref-opts', DENSITY_OPTS.map((o) =>
        option('radio', 'dsh-density', o.value, s.density === o.value, o.label, o.hint, () =>
          write({ style: { ...s, density: o.value } }),
        ),
      )),
    ])
    const widthGroup = el('div', 'pref-group', [
      el('div', 'caption', '消息列宽'),
      el('div', 'pref-opts', WIDTH_OPTS.map((o) =>
        option('radio', 'dsh-width', o.value, s.contentWidth === o.value, o.label, o.hint, () =>
          write({ style: { ...s, contentWidth: o.value } }),
        ),
      )),
    ])
    if (!s.enabled) {
      densityGroup.classList.add('pref-disabled')
      widthGroup.classList.add('pref-disabled')
    }
    styleBody.replaceChildren(enableRow, densityGroup, widthGroup)
  }

  const renderGeneral = (): void => {
    if (pref === null) return
    generalBody.replaceChildren(
      option(
        'checkbox', 'dsh-tray', '1', pref.keepRunningInTray, '关闭主窗口时保持后台运行',
        '开启：最小化到托盘，dsh 继续运行；关闭：退出 dsh 并关闭应用（默认开启）',
        () => write({ keepRunningInTray: !pref?.keepRunningInTray }),
      ),
    )
  }

  const render = (): void => {
    renderStyle()
    renderGeneral()
  }

  void bridge.preferencesGet().then((p) => {
    pref = p
    render()
  })
}
