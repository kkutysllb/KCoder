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

  // 一次只允许一项插件操作在飞（主进程也会拒并发，见 main/plugins.ts 的
  // pluginOpInFlight）：并发点击只会撞 profile manifest 的 2 秒写锁超时
  // （2026-10-03 现场：上一个操作卡住时，第二次点击抛 atomic-write 栈），
  // 不如在界面上直接不给点。
  let inFlight = false
  const setInFlight = (flag: boolean): void => {
    inFlight = flag
    for (const btn of root.querySelectorAll<HTMLButtonElement>('button[data-plugin-action]')) {
      // 内置项的「卸载」/「已最新」本就长禁（data-plugin-locked），只解除
      // 因在飞而加上的那部分
      btn.disabled = flag || btn.dataset.pluginLocked === 'true'
    }
  }

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
          el('div', 'sub', '按 ★ 倒序；搜索直接查询 GitHub，可找到榜单之外的插件（如 context）。'),
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
      // 操作位单按钮互换：检出 registry 新版 → 「更新」（内置可更新层与
      // 用户安装共用 pluginUpdate，主进程按包属选路 add@latest /
      // update --latest）；否则回落「卸载」（内置禁用）。两动作同位展示，
      // 不并排挤占行宽
      const newest = latest[plugin.name]
      const hasUpdate =
        plugin.updatable && plugin.version !== null
        && newest !== undefined && versionGt(newest, plugin.version)
      const actionButton = document.createElement('button')
      // 登记为「插件动作按钮」：在飞期间由 setInFlight 统一禁用
      actionButton.dataset.pluginAction = 'true'
      if (hasUpdate) {
        actionButton.textContent = '更新'
        actionButton.className = 'primary'
        actionButton.addEventListener('click', () => {
          void run(`更新 ${plugin.name}`, () => bridge.pluginUpdate(plugin.name)).then(renderInstalled)
        })
      } else {
        actionButton.textContent = '卸载'
        actionButton.className = 'danger'
        actionButton.disabled = plugin.inBox
        if (plugin.inBox) actionButton.dataset.pluginLocked = 'true'
        actionButton.addEventListener('click', () => {
          void run(`卸载 ${plugin.name}`, () => bridge.pluginRemove(plugin.name)).then(renderInstalled)
        })
      }
      // 渲染发生在某项操作进行中（如社区列表随后加载完）：新按钮同样禁用——
      // setInFlight 只作用于「那一刻已存在」的按钮（2026-10-03 验证时发现：
      // 社区表 100 个按钮在操作开始后才建出来，全是可点状态）
      if (inFlight) actionButton.disabled = true
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
          el('td', '', [actionButton]),
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
      // （可能带 scope）。按最后一段（repo 名）匹配：
      // ysr666/dsh-vision-router ↔ dsh-vision-router。
      const repo = plugin.fullName.includes('/') ? plugin.fullName.split('/').pop()! : plugin.fullName
      const matched = installedList.find((n) => n.name === plugin.fullName || n.name.split('/').pop() === repo)
      const isInstalled = matched !== undefined
      // 真实“有新版本”判定：registry latest > 实装版本。已装且无更新时
      // 按钮显示“已最新”并禁用——不再恒显“更新”误导用户反复点击
      const newest = matched !== undefined ? latest[matched.name] : undefined
      const hasUpdate =
        matched !== undefined && matched.version !== null && newest !== undefined && versionGt(newest, matched.version)
      const actionButton = document.createElement('button')
      // 同上：纳入在飞统一禁用面
      actionButton.dataset.pluginAction = 'true'
      if (!isInstalled) {
        actionButton.textContent = '安装'
      } else if (hasUpdate) {
        actionButton.textContent = '更新'
        actionButton.className = 'primary'
      } else {
        actionButton.textContent = '已最新'
        actionButton.disabled = true
        actionButton.dataset.pluginLocked = 'true'
      }
      actionButton.addEventListener('click', () => {
        // 已装：用已装包名（npm spec）更新；未装：用 github spec 安装。
        const pkg = matched?.name ?? (plugin.fullName.includes('/') ? `github:${plugin.fullName}` : plugin.fullName)
        void run(`${actionButton.textContent} ${plugin.fullName}`, () =>
          isInstalled ? bridge.pluginUpdate(pkg) : bridge.pluginAdd(pkg),
        ).then(renderInstalled)
      })
      // 同上：渲染落在操作进行中时不漏禁用
      if (inFlight) actionButton.disabled = true
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
    if (inFlight) return // 双保险：主进程同样以 busy 拒绝并发
    setInFlight(true)
    output.textContent = `⏳ ${label}…\n`
    try {
      const result = await action()
      latestAt = 0 // 命令后强制重拉最新版（renderInstalled 内会刷新）
      output.textContent += `${result.output}\n`
      if (!result.ok) {
        // busy = 被主进程按并发闸拒绝（另一项还在飞），其余为命令失败
        output.textContent += result.busy
          ? '⚠️ 已拒绝：同一时刻只能进行一项插件操作（另一个操作还在跑，等它结束后重试）\n'
          : '❌ 失败\n'
      } else if (result.versionChange?.unchanged === true) {
        // 假成功：exit 0 但实装版本没动。pnpm 11 的 minimumReleaseAge 供应链
        // 年龄门会把「刚发布不久」的版本静默挡回旧版，镜像源 latest 滞后同理
        // ——不能报「完成」，否则用户以为更上去了（2026-10-03 现场）。
        const { from, to } = result.versionChange
        output.textContent += `⚠️ 版本未变（${from ?? '未知'} → ${to ?? '未知'}）：命令成功但实装版本没动。`
          + '多为 pnpm 供应链年龄门（该版本发布未满门槛）或镜像源 latest 滞后，稍后重试即可\n'
      } else {
        output.textContent += '✅ 完成（重启引擎后生效）\n'
      }
    } catch (error) {
      output.textContent += `❌ 调用失败：${String(error)}\n`
    } finally {
      setInFlight(false)
    }
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
