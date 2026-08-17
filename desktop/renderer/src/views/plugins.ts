/**
 * Plugins：插件管理面板。
 *
 * 上半区：profile 已装 bundle 层叠（一切皆插件——层顺序即组合顺序）；
 * 下半区：GitHub topic `dsh-plugin` 社区发现 + 一键安装/卸载/更新。
 * 插件变更后需重启 dsh 才进入组合（profile 是启动时组装的插件树）。
 *
 * @module desktop/renderer/src/views/plugins
 */

import { bridge } from '../bridge'
import { el } from './splash'
import type { CommunityPlugin, InstalledPlugin, PluginCommandResult } from '@shared/ipc-contract'

export function mountPlugins(root: HTMLElement): void {
  const installedTable = document.createElement('table')
  const communityTable = document.createElement('table')
  const output = document.createElement('pre')
  output.className = 'log'
  output.textContent = '（命令输出将显示在这里）'
  const refreshButton = document.createElement('button')
  refreshButton.textContent = '刷新'
  const restartButton = document.createElement('button')
  restartButton.textContent = '重启 dsh 使插件生效'

  root.append(
    el('div', 'page', [
      el('div', 'page-header', [
        el('h1', '', '插件'),
        el('div', 'sub', '一切皆插件：profile 是启动时组装的插件树；安装/卸载后需重启 dsh。'),
      ]),
      el('div', 'page-body', [
        el('div', 'card', [
          el('h2', '', '已安装（层叠顺序，自下而上）'),
          installedTable,
        ]),
        el('div', 'card', [
          el('h2', '', '社区插件（GitHub topic: dsh-plugin）'),
          communityTable,
        ]),
        el('div', 'card', [
          el('h2', '', '操作'),
          el('div', 'row', [refreshButton, restartButton]),
          output,
        ]),
      ]),
    ]),
  )

  const renderInstalled = async (): Promise<void> => {
    const installed: InstalledPlugin[] = await bridge.pluginsInstalled()
    installedTable.replaceChildren()
    const thead = document.createElement('thead')
    thead.append(el('tr', '', [el('th', '', '层'), el('th', '', '插件'), el('th', '', '来源'), el('th', '', '')]))
    installedTable.append(thead)
    const body = document.createElement('tbody')
    for (const plugin of installed) {
      const removeButton = document.createElement('button')
      removeButton.textContent = '卸载'
      removeButton.className = 'danger'
      removeButton.disabled = plugin.inBox
      removeButton.addEventListener('click', () => {
        void run(`卸载 ${plugin.name}`, () => bridge.pluginRemove(plugin.name)).then(renderInstalled)
      })
      body.append(
        el('tr', '', [
          el('td', '', String(plugin.layer)),
          el('td', '', plugin.name),
          el('td', '', plugin.inBox ? '内置' : '用户安装'),
          el('td', '', [removeButton]),
        ]),
      )
    }
    installedTable.append(body)
  }

  const renderCommunity = async (): Promise<void> => {
    const community: CommunityPlugin[] = await bridge.pluginsCommunity()
    communityTable.replaceChildren()
    if (community.length === 0) {
      communityTable.append(el('tr', '', [el('td', '', '暂无结果（网络受限或社区尚无 dsh-plugin 仓库）')]))
      return
    }
    const thead = document.createElement('thead')
    thead.append(el('tr', '', [el('th', '', '仓库'), el('th', '', '说明'), el('th', '', '★'), el('th', '', '')]))
    communityTable.append(thead)
    const body = document.createElement('tbody')
    const installed = new Set((await bridge.pluginsInstalled()).map((p) => p.name))
    for (const plugin of community) {
      const name = plugin.fullName.includes('/') ? plugin.fullName : plugin.fullName
      const isInstalled = installed.has(name)
      const actionButton = document.createElement('button')
      actionButton.textContent = isInstalled ? '更新' : '安装'
      if (isInstalled) actionButton.className = 'primary'
      actionButton.addEventListener('click', () => {
        const pkg = plugin.fullName.includes('/') ? `github:${plugin.fullName}` : plugin.fullName
        void run(`${actionButton.textContent} ${plugin.fullName}`, () =>
          isInstalled ? bridge.pluginUpdate(pkg) : bridge.pluginAdd(pkg),
        ).then(renderInstalled)
      })
      const link = el('td', '', plugin.fullName)
      link.style.cursor = 'pointer'
      link.style.color = 'var(--accent)'
      link.addEventListener('click', () => void bridge.openExternal(plugin.url))
      body.append(
        el('tr', '', [
          link,
          el('td', '', plugin.description.slice(0, 80)),
          el('td', '', String(plugin.stars)),
          el('td', '', [actionButton]),
        ]),
      )
    }
    communityTable.append(body)
  }

  async function run(label: string, action: () => Promise<PluginCommandResult>): Promise<void> {
    output.textContent = `⏳ ${label}…\n`
    const result = await action()
    output.textContent += `${result.output}\n${result.ok ? '✅ 完成（重启 dsh 后生效）' : '❌ 失败'}\n`
  }

  void renderInstalled()
  void renderCommunity()

  refreshButton.addEventListener('click', () => {
    void renderInstalled()
    void renderCommunity()
  })
  restartButton.addEventListener('click', () => {
    output.textContent += '⏳ 正在重启 dsh…\n'
    void bridge.dshRestart().then((status) => {
      output.textContent += status.state === 'restarting' ? '已触发重启，就绪后自动打开主界面\n' : '重启请求已发出\n'
    })
  })
}
