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
import type { CommunityPlugin, InstalledPlugin, LatestVersions, PluginCommandResult } from '@shared/ipc-contract'

/** 简易语义版本比较（major.minor.patch 数字逐段；prerelease/build 忽略）。 */
function versionGt(a: string, b: string): boolean {
  const seg = (v: string): number[] =>
    v.replace(/^v/, '').split('+')[0].split('-')[0].split('.').map((n) => Number.parseInt(n, 10) || 0)
  const x = seg(a)
  const y = seg(b)
  for (let i = 0; i < 3; i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  }
  return false
}

export function mountPlugins(root: HTMLElement): void {
  const installedTable = document.createElement('table')
  const communityTable = document.createElement('table')
  const output = document.createElement('pre')
  output.className = 'log'
  output.textContent = '（命令输出将显示在这里）'
  const refreshButton = document.createElement('button')
  refreshButton.textContent = '刷新'
  const restartButton = document.createElement('button')
  restartButton.textContent = '重启引擎使插件生效'

  // 已安装：客户端过滤（列表已在本机）；社区：服务端搜索（防抖后重置翻页）
  let installedQuery = ''
  let communityQuery = ''
  let communityItems: CommunityPlugin[] = []
  let communityTotal = 0
  let communityPage = 1
  let communityLoading = false
  let communityTouched = false // 首查完成前显示“加载中”，不显示空态
  let communityDirty = false // 加载期间有新查询：结束后自动重查
  let communityTimer: ReturnType<typeof setTimeout> | undefined

  // 已装包 → npm registry 最新版（60s 缓存；插件命令后强制重拉）。
  // “有新版本”判定唯一依据——不能按按钮文案恒显“更新”让用户误以为
  // 永远有待更新（v0.2.0 mac 的感知缺陷：更新已生效但仍“提示要更新”）
  let latest: LatestVersions = {}
  let latestAt = 0
  const refreshLatest = async (names: string[]): Promise<void> => {
    if (Date.now() - latestAt < 60_000) return
    latestAt = Date.now()
    try {
      latest = await bridge.pluginsLatest(names)
    } catch {
      latest = {}
    }
  }

  const installedSearch = document.createElement('input')
  installedSearch.type = 'search'
  installedSearch.placeholder = '搜索已安装插件…'
  installedSearch.addEventListener('input', () => {
    installedQuery = installedSearch.value.trim().toLowerCase()
    void renderInstalled()
  })

  const communitySearch = document.createElement('input')
  communitySearch.type = 'search'
  communitySearch.placeholder = '搜索插件（仓库名 / 说明）…'
  const searchCommunity = (): void => {
    const next = communitySearch.value.trim()
    if (next === communityQuery) return
    communityQuery = next
    void loadCommunity(true)
  }
  communitySearch.addEventListener('input', () => {
    if (communityTimer !== undefined) clearTimeout(communityTimer)
    communityTimer = setTimeout(searchCommunity, 400)
  })
  communitySearch.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return
    if (communityTimer !== undefined) clearTimeout(communityTimer)
    searchCommunity()
  })

  // 结果统计（共 N 个 · 已显示 M 个）与「加载更多」翻页
  const communityMeta = document.createElement('div')
  communityMeta.className = 'sub'
  const loadMoreButton = document.createElement('button')
  loadMoreButton.textContent = '加载更多'
  loadMoreButton.hidden = true
  loadMoreButton.addEventListener('click', () => void loadCommunity(false))

  root.append(
    el('div', 'page', [
      el('div', 'page-header', [
        el('h1', '', '插件'),
        el('div', 'sub', '一切皆插件：profile 是启动时组装的插件树；安装/卸载后需重启引擎。'),
      ]),
      el('div', 'page-body', [
        el('div', 'card', [
          el('h2', '', '已安装（层叠顺序，自下而上）'),
          installedSearch,
          installedTable,
        ]),
        el('div', 'card', [
          el('h2', '', '社区插件（GitHub topic: dsh-plugin）'),
          el('div', 'sub', '按 ★ 倒序；搜索直接查询 GitHub，可找到榜单之外的插件（如 genui / context）。'),
          communitySearch,
          communityMeta,
          communityTable,
          loadMoreButton,
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
    await refreshLatest(installed.map((p) => p.name))
    const filtered =
      installedQuery === ''
        ? installed
        : installed.filter((p) => p.name.toLowerCase().includes(installedQuery))
    installedTable.replaceChildren()
    const thead = document.createElement('thead')
    thead.append(
      el('tr', '', [el('th', '', '层'), el('th', '', '插件'), el('th', '', '版本'), el('th', '', '来源'), el('th', '', '')]),
    )
    installedTable.append(thead)
    const body = document.createElement('tbody')
    if (filtered.length === 0) {
      body.append(el('tr', '', [el('td', '', '无匹配（换个关键词，或点击下方“刷新”）')]))
    }
    for (const plugin of filtered) {
      const removeButton = document.createElement('button')
      removeButton.textContent = '卸载'
      removeButton.className = 'danger'
      removeButton.disabled = plugin.inBox
      removeButton.addEventListener('click', () => {
        void run(`卸载 ${plugin.name}`, () => bridge.pluginRemove(plugin.name)).then(renderInstalled)
      })
      const newest = latest[plugin.name]
      const versionText =
        plugin.version === null
          ? '—'
          : newest !== undefined && versionGt(newest, plugin.version)
            ? `${plugin.version} → ${newest}`
            : plugin.version
      body.append(
        el('tr', '', [
          el('td', '', String(plugin.layer)),
          el('td', '', plugin.name),
          el('td', '', versionText),
          el('td', '', plugin.inBox ? '内置' : '用户安装'),
          el('td', '', [removeButton]),
        ]),
      )
    }
    installedTable.append(body)
    // 社区表按钮三态依赖 latest，拉到后刷一遍（此处不重拉列表，仅重渲）
    void renderCommunity()
  }

  /** 社区查询：reset 重置到第 1 页替换列表；否则翻页追加（按 fullName 去重）。 */
  const loadCommunity = async (reset: boolean): Promise<void> => {
    if (communityLoading) {
      communityDirty = true // 加载中收到新查询：本次结束后自动重查
      return
    }
    communityLoading = true
    communityTouched = true
    if (reset) communityItems = []
    const page = reset ? 1 : communityPage + 1
    try {
      const result = await bridge.pluginsCommunity(communityQuery, page)
      communityPage = result.page
      communityTotal = result.totalCount
      if (reset) {
        communityItems = result.items
      } else {
        const seen = new Set(communityItems.map((p) => p.fullName))
        communityItems = [...communityItems, ...result.items.filter((p) => !seen.has(p.fullName))]
      }
    } catch {
      // IPC 异常兑底（正常失败已由主进程吞掉并返回空页/缓存页）
    } finally {
      communityLoading = false
      void renderCommunity()
      if (communityDirty) {
        communityDirty = false
        void loadCommunity(true)
      }
    }
  }

  const renderCommunity = async (): Promise<void> => {
    communityTable.replaceChildren()
    if (!communityTouched) {
      communityTable.append(el('tr', '', [el('td', '', '加载中…')]))
      return
    }
    if (communityItems.length === 0) {
      communityTable.append(el('tr', '', [
        el('td', '', communityQuery === ''
          ? '暂无结果（网络受限或社区尚无 dsh-plugin 仓库），可稍后点击下方“刷新”'
          : `没有匹配「${communityQuery}」的仓库，换个关键词试试`),
      ]))
      communityMeta.textContent = ''
      loadMoreButton.hidden = true
      return
    }
    const thead = document.createElement('thead')
    thead.append(
      el('tr', '', [el('th', '', '仓库'), el('th', '', '说明'), el('th', '', '★'), el('th', '', '版本'), el('th', '', '')]),
    )
    communityTable.append(thead)
    const body = document.createElement('tbody')
    const installedList: InstalledPlugin[] = await bridge.pluginsInstalled()
    for (const plugin of communityItems) {
      // 社区发现给出 GitHub full_name（owner/repo），已装列表是 npm 包名
      // （可能带 scope，如 @dsh-external/dsh-drag-to-attachment）。按最后一段
      // （repo 名）匹配：ysr666/dsh-vision-router ↔ dsh-vision-router。
      const repo = plugin.fullName.includes('/') ? plugin.fullName.split('/').pop()! : plugin.fullName
      const matched = installedList.find((n) => n.name === plugin.fullName || n.name.split('/').pop() === repo)
      const isInstalled = matched !== undefined
      // 真实“有新版本”判定：registry latest > 实装版本。已装且无更新时
      // 按钮显示“已最新”并禁用——不再恒显“更新”误导用户反复点击
      const newest = matched !== undefined ? latest[matched.name] : undefined
      const hasUpdate =
        matched !== undefined && matched.version !== null && newest !== undefined && versionGt(newest, matched.version)
      const actionButton = document.createElement('button')
      if (!isInstalled) {
        actionButton.textContent = '安装'
      } else if (hasUpdate) {
        actionButton.textContent = '更新'
        actionButton.className = 'primary'
      } else {
        actionButton.textContent = '已最新'
        actionButton.disabled = true
      }
      actionButton.addEventListener('click', () => {
        // 已装：用已装包名（npm spec）更新；未装：用 github spec 安装。
        const pkg = matched?.name ?? (plugin.fullName.includes('/') ? `github:${plugin.fullName}` : plugin.fullName)
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
          el('td', '', !isInstalled ? '—' : hasUpdate ? `${matched!.version} → ${newest}` : (matched!.version ?? '—')),
          el('td', '', [actionButton]),
        ]),
      )
    }
    communityTable.append(body)
    communityMeta.textContent =
      `共 ${communityTotal} 个${communityQuery === '' ? '候选' : '匹配'}仓库 · 已显示 ${communityItems.length} 个（按 ★ 倒序）`
    const more = communityItems.length < communityTotal
    loadMoreButton.hidden = !more
    loadMoreButton.disabled = communityLoading
    loadMoreButton.textContent = communityLoading ? '加载中…' : '加载更多'
  }

  async function run(label: string, action: () => Promise<PluginCommandResult>): Promise<void> {
    output.textContent = `⏳ ${label}…\n`
    const result = await action()
    latestAt = 0 // 命令后强制重拉最新版（renderInstalled 内会刷新）
    output.textContent += `${result.output}\n${result.ok ? '✅ 完成（重启引擎后生效）' : '❌ 失败'}\n`
  }

  void renderInstalled()
  void loadCommunity(true)

  refreshButton.addEventListener('click', () => {
    void renderInstalled()
    void loadCommunity(true)
  })
  restartButton.addEventListener('click', () => {
    output.textContent += '⏳ 正在重启引擎…\n'
    void bridge.dshRestart().then((status) => {
      output.textContent += status.state === 'restarting' ? '已触发重启，就绪后自动打开主界面\n' : '重启请求已发出\n'
    })
  })
}
