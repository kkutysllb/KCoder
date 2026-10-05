/**
 * 工作区探针 + 正文文件**类型**徽章冒烟，兼作「edit +n/−n 统计徽章退役」的
 * 回归闸门。注入 `desktop/main/workspace-probe.ts` 里那份真实 `PAGE_JS`，
 * 在还原的正文 DOM 上断言**留下什么**与**不许再有什么**。
 *
 * ## 回归背景（2026-10-05，用户实测）
 *
 * 工具行里出现两枚 `+n/−n`：本产品注入器在文件路径后追加的一枚，与上游
 * `client-ui-tool` 的 `ToolRow` 自带的一枚（`diffTotals(diff.card.diffs)` →
 * `+added -removed`，`ui-tool/src/client/tool/components/ToolRow.tsx:248-250`）。
 * 用户判定冲突并要求退役本产品那枚（保留上游）。本次改动退役的不只是渲染：
 * 整条只服务于它的数据链一并删除——页面侧 `window.__dshFileStat` 通道、
 * `statCache`/`applyStat`、`session/page` 的 fetch 拦截；主进程侧
 * `file-activity` 的历史补拉 / numstat / turn-end 探针 / 分桶活动表
 * （模块缩减为 `workspace-base.ts`）。
 *
 * ## 断言面
 *
 * - **留下**：类型徽章（`._fileLink` → `TS`、`._fileMention` → `MD`；
 *   无扩展名不加徽章）、原文不被破坏（徽章是**前置** span，文本仍在）、
 *   样式表生效（路径配色 `rgb(47,111,237)`）、工作区探针照常
 *   （`--dsh-ws-name` / `--dsh-ws-path` + console 上报 `{workspace}` ——
 *   这是 skills-catalog 工作区项目技能的基准，绝不能跟着徽章一起死）；
 * - **退役面（判别点）**：`.__dsh-fb-stat` 零节点、样式表内无该规则、
 *   `window.__dshFileStat` 必须 **undefined**、`window.fetch` 必须是**同一个
 *   函数**（身份相等 ⇒ 未被包装，`session/page` 拦截真的没了）；
 * - **幂等**：重复注入不叠加 style、不重复插徽章；二次重扫（触发一次 DOM
 *   变动后等过 debounce）仍每节点恰好 1 枚。
 *
 * 运行：`env -u ELECTRON_RUN_AS_NODE pnpm exec electron scripts/smoke-workspace-probe.mjs`
 * （本机终端若导出了 `ELECTRON_RUN_AS_NODE=1`，electron 会被按纯 Node 启动而报
 * 「does not provide an export named 'BrowserWindow'」——必须 unset。）
 *
 * 判别力自检（负对照）：
 * `WORKSPACE_PROBE_SRC=<改动前那份 workspace-probe.ts>` 必须 FAIL，
 * 且红的正是退役面三条（`__dshFileStat` 存在 / fetch 被包装 / 样式表仍有
 * 统计规则）——留下的那几条仍应通过，证明本冒烟分得清「退役」与「误伤」。
 *
 * @module scripts/smoke-workspace-probe
 */
import { app, BrowserWindow } from 'electron'
import { readFileSync } from 'node:fs'

const BT = String.fromCharCode(96)
const SRC_PATH = process.env.WORKSPACE_PROBE_SRC ?? 'desktop/main/workspace-probe.ts'
const src = readFileSync(SRC_PATH, 'utf8')
const decl = 'const PAGE_JS = ' + BT
const from = src.indexOf(decl) + decl.length
const tail = src.indexOf('\n})()' + BT, from)
const endTick = src.indexOf(BT, tail + 1)
if (from <= decl.length || tail === -1 || endTick === -1) {
  console.log(`[ws-probe] FAIL: 无法从 ${SRC_PATH} 提取 PAGE_JS`)
  process.exit(1)
}
// 提取失败必须在**加载时**响亮失败：源码里若出现未转义的反引号（模板字面量被
// 提前截断），eval 会抛在模块顶层——Electron 主进程不会因此退出，冒烟就变成
// 「永远挂着不出结论」（本仓既有教训，2026-10-05 实际踩到）。
let pageJs
try {
  // oxlint-disable-next-line no-eval -- 测试夹具:按模板字符串语义还原页面注入源码
  pageJs = eval(BT + src.slice(from, endTick) + BT)
  // eslint-disable-next-line no-new-func -- 同上：只做语法检查，不执行
  new Function(pageJs)
} catch (error) {
  console.log(`[ws-probe] FAIL: 提取的 PAGE_JS 不是合法 JS（${error instanceof Error ? error.message : String(error)}）`)
  console.log('SMOKE FAILED')
  process.exit(1)
}
// 看门狗：任何阶段卡住都不许静默悬挂
const watchdog = setTimeout(() => {
  console.log('[ws-probe] FAIL: 超时未出结论（看门狗 30s）')
  console.log('SMOKE FAILED')
  process.exit(1)
}, 30000)
watchdog.unref?.()

/**
 * 夹具：还原工具行正文里两个真实锚点（`_fileLink` 工具卡片路径按钮、
 * `_fileMention` 正文提及），外加一个无扩展名目标（不得加徽章）。
 * 页面侧先装好三样探针环境：
 * - `__logs` + console 覆写（捕 `__dsh_wsprobe__:` 上报）；
 * - `__origFetch` + session/list 存根（工作区解析走它，返回 /tmp/fake-ws）；
 * - 记录**装桩后**的 fetch 身份（`__preEvalFetch`），供「fetch 未被包装」断言比对。
 */
const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"></head><body>
  <div id="root">
    <button type="button" class="_fileLink_96PAOq" id="fileLink">desktop/main/workspace-probe.ts</button>
    <span class="_fileMention_x" id="fileMention">docs/README.md</span>
    <button type="button" class="_fileLink_x" id="noExt">Makefile</button>
  </div>
  <script>
    window.__logs = [];
    const origLog = console.log.bind(console);
    console.log = (...args) => {
      try { window.__logs.push(args.map(String).join(' ')) } catch (e) {}
      origLog(...args);
    };
    window.__origFetch = window.fetch;
    window.fetch = (input) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.indexOf('/api/session/list') !== -1) {
        const body = JSON.stringify({ result: { ok: true, value: { items: [
          { sessionId: 'session-a', cwd: '/tmp/fake-ws', updatedAt: 900 },
          { sessionId: 'session-b', cwd: '/tmp/older-ws', updatedAt: 100 }
        ] } } });
        return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    };
    // ⚠ 必须在**装桩之后**采样：要判的是「注入脚本有没有把页面这枚 fetch 换掉」，
    // 采样在装桩前会让身份比对按构造就必然不等（2026-10-05 首版实际踩到）。
    window.__preEvalFetch = window.fetch;
  </script>
</body></html>`

/** 页面侧取样：只读 DOM/CSS/全局，返回纯对象（主进程侧断言）。 */
const PROBE = `(() => {
  const first = (id) => {
    const el = document.getElementById(id)
    if (el === null) return null
    const kid = el.firstElementChild
    return {
      cls: kid !== null ? kid.className : null,
      text: kid !== null ? kid.textContent : null,
      body: el.textContent,
      whole: el.textContent,
    }
  }
  const link = document.getElementById('fileLink')
  const styleEl = document.getElementById('__dsh_desktop_filebadge_style')
  const root = document.documentElement
  const cs = getComputedStyle(root)
  return {
    wired: window.__dshWsProbeWired === true,
    styleCount: document.querySelectorAll('#__dsh_desktop_filebadge_style').length,
    styleHasStatRule: styleEl !== null && styleEl.textContent.indexOf('__dsh-fb-stat') !== -1,
    link: first('fileLink'),
    mention: first('fileMention'),
    noExt: first('noExt'),
    badgeCount: document.querySelectorAll('.__dsh-fb').length,
    statCount: document.querySelectorAll('.__dsh-fb-stat').length,
    statFn: typeof window.__dshFileStat,
    fetchWrapped: window.fetch !== window.__preEvalFetch,
    wsName: (cs.getPropertyValue('--dsh-ws-name') || '').trim(),
    wsPath: (cs.getPropertyValue('--dsh-ws-path') || '').trim(),
    linkColor: link !== null ? getComputedStyle(link).color : null,
    reports: (window.__logs || []).filter((l) => l.indexOf('__dsh_wsprobe__:') === 0),
  }
})()`

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })

/** 断言一批取样结果；返回失败项数组。 */
function verdict(p, tag) {
  const fails = []
  const t = (s) => `[${tag}] ${s}`
  if (!p.wired) fails.push(t('PAGE_JS 未接线（window.__dshWsProbeWired 非 true）'))
  if (p.styleCount !== 1) fails.push(t(`样式表不幂等（${p.styleCount} 个 #__dsh_desktop_filebadge_style）`))
  // —— 留下：类型徽章 ——
  if (p.link === null || p.link.cls !== '__dsh-fb') fails.push(t(`文件路径按钮未加类型徽章（${p.link === null ? 'MISSING' : p.link.cls}）`))
  else if (p.link.text !== 'TS') fails.push(t(`类型徽章文本应为 TS（${p.link.text}）`))
  else if (p.link.body !== 'TS' + 'desktop/main/workspace-probe.ts') {
    fails.push(t(`原文被改动（${p.link.body}）——徽章必须是前置 span，不得吃掉路径文本`))
  }
  if (p.mention === null || p.mention.text !== 'MD') fails.push(t(`文件提及未加类型徽章（${p.mention === null ? 'MISSING' : p.mention.text}）`))
  if (p.noExt === null) fails.push(t('夹具缺少无扩展名目标（noExt）'))
  else if (p.noExt.cls !== null) fails.push(t(`无扩展名目标被误加徽章（${p.noExt.cls}）`))
  if (p.linkColor !== 'rgb(47, 111, 237)') fails.push(t(`路径配色样式表未生效（${p.linkColor}）`))
  // —— 留下：工作区探针（skills-catalog 的工作区项目技能基准） ——
  if (p.wsName !== 'fake-ws') fails.push(t(`--dsh-ws-name 未写入（${p.wsName}）`))
  if (p.wsPath !== '/tmp/fake-ws') fails.push(t(`--dsh-ws-path 未写入（${p.wsPath}）`))
  if (!p.reports.some((l) => l.indexOf('"workspace":"/tmp/fake-ws"') !== -1)) {
    fails.push(t(`工作区基准未上报（reports=${JSON.stringify(p.reports)}）——skills-catalog 的工作区项目技能会失去来源`))
  }
  // —— 退役面（判别点） ——
  if (p.statCount !== 0) fails.push(t(`统计徽章仍在渲染（.__dsh-fb-stat × ${p.statCount}）——用户要求退役的正是它`))
  if (p.styleHasStatRule) fails.push(t('样式表里仍有 .__dsh-fb-stat 规则——渲染代码退役了、样式没跟上'))
  if (p.statFn !== 'undefined') fails.push(t(`window.__dshFileStat 仍存在（${p.statFn}）——退役的推送通道又回来了`))
  if (p.fetchWrapped) fails.push(t('window.fetch 仍被包装——session/page 拦截（历史补拉）未退役'))
  return fails
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 900, height: 600, show: false })
  let fails = []
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(FIXTURE))
    await win.webContents.executeJavaScript(pageJs, true)
    await sleep(400) // 等工作区解析（stub fetch → microtask → .then 写 CSS 变量）
    const p1 = await win.webContents.executeJavaScript(PROBE, true)
    fails = fails.concat(verdict(p1, 'inject'))
    // 幂等：重复注入不得叠加；二次重扫不得重复插徽章
    await win.webContents.executeJavaScript(pageJs, true)
    await win.webContents.executeJavaScript(
      `(() => { const d = document.createElement('div'); d.id = 'mutationBait'; document.body.append(d) })()`,
      true,
    )
    await sleep(500) // 越过 fbScan 的 300ms debounce
    const p2 = await win.webContents.executeJavaScript(PROBE, true)
    fails = fails.concat(verdict(p2, 're-inject'))
    if (p2.badgeCount !== p1.badgeCount) {
      fails.push(`[re-inject] 重扫后徽章数量变了（${p1.badgeCount} → ${p2.badgeCount}）——不幂等`)
    }
    console.log(`[ws-probe src=${SRC_PATH}] 取样：`, JSON.stringify({
      link: p2.link, mention: p2.mention, badgeCount: p2.badgeCount, statCount: p2.statCount,
      statFn: p2.statFn, fetchWrapped: p2.fetchWrapped, wsName: p2.wsName, styleHasStatRule: p2.styleHasStatRule,
    }))
  } catch (error) {
    fails.push(`异常：${error instanceof Error ? error.message : String(error)}`)
  }
  console.log(`[ws-probe] `, fails.length === 0 ? 'PASS' : 'FAIL: ' + fails.join('; '))
  console.log(fails.length === 0 ? 'ALL PASS' : 'SMOKE FAILED')
  app.exit(fails.length === 0 ? 0 : 1)
})
