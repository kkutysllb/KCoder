/**
 * 技能面板 DOM 冒烟：手搓上游设置对话框 DOM → 注入 skills-settings 的
 * PAGE_JS → 手推四来源数据 → 激活「技能」分区 → 双主题断言 + 截图。
 *
 * 回归重点：上游 alias 变量近形词坑（invert/inverted）——深色主题下
 * 品牌徽章必须解析到真实变量值（深灰字），不能落回退 #fff（白底白字
 * 隐形）。变量值取自上游 ui-theme design-platform.css 深色主题块。
 * 运行：pnpm exec electron scripts/smoke-skills-dom.mjs
 */
import { app, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BT = String.fromCharCode(96)
const src = readFileSync('desktop/main/skills-settings.ts', 'utf8')
const decl = 'const PAGE_JS = ' + BT
const from = src.indexOf(decl) + decl.length
const tail = src.indexOf('\n})()' + BT, from)
const endTick = src.indexOf(BT, tail + 1)
// PAGE_JS 插值 ${JSON.stringify(MEDIA_MODEL_GROUPS)} 在 eval 作用域求值：
// 从 media-models.ts 抠真实字段表（纯数据可 eval；不含函数/类型）
const mts = readFileSync('desktop/main/media-models.ts', 'utf8')
const mAnchor = 'export const MEDIA_MODEL_GROUPS: readonly MediaModelGroup[] = '
const mStart = mts.indexOf(mAnchor) + mAnchor.length
const mEnd = mts.indexOf('\n]', mStart) + 2
const MEDIA_MODEL_GROUPS = eval(mts.slice(mStart, mEnd))
const pageJs = eval(BT + src.slice(from, endTick) + BT)

// 上游深色主题真实值（design-platform.css :root[data-theme=dark] 块）
const DARK_VARS = `:root {
  --dsw-alias-bg-layer-2: rgb(44, 44, 46);
  --dsw-alias-brand-primary: rgb(249, 250, 251);
  --dsw-alias-label-primary: rgb(249, 250, 251);
  --dsw-alias-label-primary-inverted: rgb(53, 54, 56);
  --dsw-alias-label-secondary: rgb(151, 157, 166);
  --dsw-alias-label-tertiary: rgb(97, 102, 107);
  --dsw-alias-interactive-bg-hover: rgba(249, 250, 251, .08);
  --dsw-alias-border-l2: rgb(44, 44, 46);
  --dsw-alias-border-l3: rgb(53, 54, 56);
}`

const html = (vars) => `<!doctype html><html><head><meta charset="utf-8"><style>
  ${vars}
  body { font-family: -apple-system, system-ui, sans-serif; margin: 0; background: #17181a; display: flex; align-items: center; justify-content: center; height: 100vh; }
  button { font: inherit; }
  .nv { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 12px; border: none; background: none; border-radius: 8px; cursor: pointer; color: inherit; }
  .nv.on { background: rgba(255,255,255,.1); font-weight: 600; }
</style></head><body>
<div role="dialog" aria-modal="true" style="display:flex;width:800px;height:600px;background:#1c1d1f;border-radius:24px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,.5)">
  <nav style="width:188px;flex:none;background:#17181a;padding:22px 12px 0;color:#e8eaed">
    <div style="font-weight:500;margin:0 12px 10px;font-size:16px;line-height:24px">设置</div>
    <div>
      <button type="button" class="nv on" aria-current="true"><svg width="16" height="16"><circle cx="8" cy="8" r="7" fill="#888"/></svg><span>通用</span></button>
      <button type="button" class="nv"><svg width="16" height="16"><circle cx="8" cy="8" r="7" fill="#888"/></svg><span>模型</span></button>
    </div>
  </nav>
  <!-- 对齐真实几何：panel 800 / nav 188 / options padding 0 24px 24px → 内容宽 564px -->
  <div style="flex:1;min-width:0;padding:0 24px 24px;overflow-y:auto;color:#e8eaed">
    <div class="options"><div data-slot="settings.section"><div style="color:#555">原生分区内容占位</div></div></div>
  </div>
</div>
</body></html>`

const groups = [
  { id: 'builtin', title: 'KCoder 内置', entries: [
    { name: 'planning-with-files', description: '多步任务的计划文件管理方法论', source: 'builtin', path: '/tmp/a/SKILL.md' },
    { name: 'root-cause-tracing', description: '先归因再动手', source: 'builtin', path: '/tmp/a2/SKILL.md' },
    { name: 'verification-before-done', description: '完成前验证', source: 'builtin', path: '/tmp/a3/SKILL.md' },
    { name: 'small-safe-steps', description: '小步提交', source: 'builtin', path: '/tmp/a4/SKILL.md' },
    { name: 'context-earthquake-prevention', description: '上下文防灾', source: 'builtin', path: '/tmp/a5/SKILL.md' },
  ] },
  { id: 'project', title: '工作区项目技能', entries: [
    { name: 'ws-skill-x', description: '工作区测试技能', source: 'project', path: '/tmp/b/SKILL.md' },
  ] },
  { id: 'user', title: '用户全局技能', entries: [
    { name: 'user-skill-y', description: '用户测试技能', source: 'user', path: '/tmp/c/SKILL.md' },
    { name: 'shared-skill-z', description: '共享目录测试技能', source: 'shared', path: '/tmp/d/SKILL.md' },
  ] },
  { id: 'optional', title: '未启用（随包可选）', entries: [
    { name: 'database', description: 'schema/migrations/SQL/ORM 技能', source: 'optional', path: '/tmp/opt/database/SKILL.md' },
  ] },
]

async function runScenario(win, label, vars) {
  // 单窗口复用跑两场景：destroy/新建的时序在部分环境下 ERR_FAILED
  const dir = mkdtempSync(join(tmpdir(), 'skills-smoke-'))
  const file = join(dir, 'index.html')
  writeFileSync(file, html(vars))
  await win.loadFile(file)
  await win.webContents.executeJavaScript(pageJs, true)
  await new Promise((r) => setTimeout(r, 400))
  await win.webContents.executeJavaScript(`window.__dshSkillsSync(${JSON.stringify(groups)})`, true)
  // 多媒体模型已存值推送（image-seedream 组两项 → 默认展开 + 计数）
  await win.webContents.executeJavaScript(
    `window.__dshSkillsMediaValues(${JSON.stringify({ GEMINI_API_KEY: 'sk-img-x', GEMINI_MODEL: 'doubao-seedream-5-0-260128' })})`,
    true,
  )
  await new Promise((r) => setTimeout(r, 200))
  const clicked = await win.webContents.executeJavaScript(
    `(() => { const b = document.getElementById('__dsh_desktop_skills_nav'); if (!b) return 'NAV MISSING'; b.click(); return 'ok' })()`,
    true,
  )
  await new Promise((r) => setTimeout(r, 300))
  // 启用按钮交互：点击 database 行尾「启用」→ 模拟主进程应答成功 + 目录刷新
  //（database 跳到用户区，optional 区空）；同时验证按钮 stopPropagation 不触发展开
  const enableProbe = await win.webContents.executeJavaScript(
    `(() => {
      const row = document.querySelector('.dsk-row[data-path="/tmp/opt/database/SKILL.md"]')
      if (row === null) return 'ROW MISSING'
      const btn = row.querySelector('.dsk-enable')
      if (btn === null) return 'BTN MISSING'
      btn.click()
      return JSON.stringify({ btnText: btn.textContent, rowExpanded: row.classList.contains('on'), btnDisabled: btn.disabled })
    })()`,
    true,
  )
  // 点击前快照在 click 前不可得（同一脚本），断言以点击后防重复态为准
  await win.webContents.executeJavaScript(
    `window.__dshSkillsEnabled(${JSON.stringify('/tmp/opt/database/SKILL.md')}, true)`,
    true,
  )
  const refreshed = JSON.parse(JSON.stringify(groups))
  refreshed[2].entries.push({ name: 'database', description: 'schema/migrations/SQL/ORM 技能', source: 'user', path: '/tmp/user-enabled/database/SKILL.md' })
  refreshed[3].entries = []
  await win.webContents.executeJavaScript(`window.__dshSkillsSync(${JSON.stringify(refreshed)})`, true)
  await new Promise((r) => setTimeout(r, 200))
  const jumpProbe = await win.webContents.executeJavaScript(
    `(() => {
      const userRows = Array.from(document.querySelectorAll('.dsk-row')).filter(r => r.textContent.includes('database'))
      const enableBtns = document.querySelectorAll('.dsk-enable').length
      return JSON.stringify({ userRowText: userRows.map(r => r.className), remainingEnableBtns: enableBtns })
    })()`,
    true,
  )
  const probe = await win.webContents.executeJavaScript(
    `(() => {
      const kc = document.querySelector('.dsk-badge.kc')
      const plain = document.querySelector('.dsk-badge:not(.kc)')
      const info = (b) => b === null ? null : { text: b.textContent, color: getComputedStyle(b).color, bg: getComputedStyle(b).backgroundColor }
      const mediaTitle = Array.from(document.querySelectorAll('.dsk-gtitle')).map(t => t.textContent).find(t => t.includes('\u591a\u5a92\u4f53\u6a21\u578b')) || ''
      const secretInp = document.querySelector('.dsk-mf-i[data-key="GEMINI_API_KEY"]')
      const openGroups = Array.from(document.querySelectorAll('.dsk-mg')).filter(g => g.classList.contains('on')).length
      const filledGemini = secretInp === null ? null : secretInp.value
      // 布局回归：真实 800px 对话框几何（内容区 ~525px）下卡头必须单行（≤36px 含 padding），
      // 说明在展开体（.dsk-mg-note），已配置组头右侧有徽标
      const headHs = Array.from(document.querySelectorAll('.dsk-mg-h')).map(h => +h.getBoundingClientRect().height.toFixed(1))
      const maxHeadH = Math.max.apply(null, headHs)
      const cntBadges = Array.from(document.querySelectorAll('.dsk-mg-cnt')).map(b => b.textContent)
      const notes = document.querySelectorAll('.dsk-mg-note').length
      return JSON.stringify({
        nav: ${JSON.stringify(label)}, click: ${JSON.stringify(clicked)},
        rows: document.querySelectorAll('.dsk-row').length,
        kcBadge: info(kc), plainBadge: info(plain),
        mediaGroups: document.querySelectorAll('.dsk-mg').length,
        mediaInputs: document.querySelectorAll('.dsk-mf-i').length,
        mediaTitle, secretType: secretInp === null ? null : secretInp.type,
        filledGemini, openGroups, maxHeadH, cntBadges, notes,
      })
    })()`,
    true,
  )
  const result = JSON.parse(probe)
  // 断言：徽章文字非空；深色下 kc 徽章文字必须是深灰（真实变量）而非回退白
  const fails = []
  if (result.rows !== 9) fails.push(`rows=${result.rows} 应为 9`)
  if (!result.kcBadge || result.kcBadge.text !== 'KCoder') fails.push('kc 徽章文字缺失')
  if (!result.plainBadge || result.plainBadge.text === '') fails.push('普通徽章文字缺失')
  const en = JSON.parse(enableProbe)
  if (en.btnText !== '启用中…') fails.push(`按钮文字=${en.btnText} 应为「启用中…」（防重复点击态）`)
  if (en.btnDisabled !== true) fails.push('点击后按钮未禁用')
  if (en.rowExpanded === true) fails.push('按钮点击触发了行展开（stopPropagation 失效）')
  const jp = JSON.parse(jumpProbe)
  if (jp.remainingEnableBtns !== 0) fails.push(`刷新后残留 ${jp.remainingEnableBtns} 个启用按钮`)
  // 多媒体模型配置区：渲染/回填/密码型/默认展开
  if (result.mediaGroups !== 6) fails.push(`多媒体分组=${result.mediaGroups} 应为 6`)
  if (result.mediaInputs !== 21) fails.push(`多媒体输入框=${result.mediaInputs} 应为 21`)
  if (!result.mediaTitle.includes('已配置 2 项')) fails.push(`配置计数标题异常: ${result.mediaTitle}`)
  if (result.secretType !== 'password') fails.push(`密钥字段 type=${result.secretType} 应为 password`)
  if (result.filledGemini !== 'sk-img-x') fails.push('已存值未回填输入框')
  if (result.openGroups !== 1) fails.push(`含已存值组默认展开数=${result.openGroups} 应为 1`)
  if (result.maxHeadH > 36) fails.push(`卡头换行错乱：最高 ${result.maxHeadH}px 应 ≤36px（单行）`)
  if (result.notes !== 6) fails.push(`展开体说明条=${result.notes} 应为 6`)
  if (!Array.isArray(result.cntBadges) || result.cntBadges.length !== 1 || !result.cntBadges[0].includes('已配置 2')) {
    fails.push(`已配置组徽标异常: ${JSON.stringify(result.cntBadges)}`)
  }
  // 保存链路：点击保存 → console 载荷 op=media-save（含新输入值）→ 应答回推按钮复位
  const mediaPayload = new Promise((resolve) => {
    win.webContents.once('console-message', (_e, _level, message) => resolve(message))
  })
  await win.webContents.executeJavaScript(
    `(() => {
      const inp = document.querySelector('.dsk-mf-i[data-key="MINIMAX_API_KEY"]')
      if (inp !== null) inp.value = 'mm-smoke-999'
      const btn = document.getElementById('dsk-media-save')
      if (btn === null) return 'SAVE BTN MISSING'
      btn.click()
      return 'ok'
    })()`,
    true,
  )
  const sentMsg = await Promise.race([mediaPayload, new Promise((r) => setTimeout(() => r('TIMEOUT'), 1500))])
  if (!sentMsg.startsWith('__dsh_skills__:')) fails.push(`保存未发 console 载荷: ${String(sentMsg).slice(0, 40)}`)
  else {
    const sent = JSON.parse(sentMsg.slice('__dsh_skills__:'.length))
    if (sent.op !== 'media-save') fails.push(`载荷 op=${sent.op} 应为 media-save`)
    if (sent.values?.MINIMAX_API_KEY !== 'mm-smoke-999') fails.push('新输入值未随载荷上送')
    if (sent.values?.GEMINI_API_KEY !== 'sk-img-x') fails.push('已存值未随载荷上送')
  }
  await win.webContents.executeJavaScript(`window.__dshSkillsMediaSaved(true)`, true)
  const saveProbe = JSON.parse(await win.webContents.executeJavaScript(
    `(() => JSON.stringify({
      btnDisabled: (document.getElementById('dsk-media-save') || {}).disabled,
      btnText: (document.getElementById('dsk-media-save') || {}).textContent,
      tip: (document.getElementById('dsk-media-ok') || {}).textContent,
    }))()`,
    true,
  ))
  if (saveProbe.btnDisabled !== false || saveProbe.btnText !== '保存') fails.push(`保存应答后按钮未复位: ${JSON.stringify(saveProbe)}`)
  if (!saveProbe.tip.includes('已保存')) fails.push(`保存提示异常: ${saveProbe.tip}`)
  if (vars === DARK_VARS) {
    if (result.kcBadge && result.kcBadge.color === 'rgb(255, 255, 255)') fails.push('深色主题 kc 徽章落回退 #fff（白底白字隐形，变量名又坏了）')
  }
  console.log(`[${label}]`, fails.length === 0 ? 'PASS' : 'FAIL: ' + fails.join('; '), '|', probe, '| enable:', enableProbe, '| jump:', jumpProbe)
  const img = await win.webContents.capturePage()
  const slug = label === 'dark' ? 'dark' : 'light'
  writeFileSync(`out/skills-badge-${slug}.png`, img.toPNG())
  return fails.length === 0
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1040, height: 660, show: false })
  const light = await runScenario(win, 'light', '')
  const dark = await runScenario(win, 'dark', DARK_VARS)
  console.log(light && dark ? 'ALL PASS' : 'SMOKE FAILED')
  app.quit()
})
