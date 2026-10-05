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
// 2026-10-05 起 PAGE_JS 里不再有主进程侧模板插值（原
// `${JSON.stringify(MEDIA_MODEL_GROUPS)}` 随「多媒体模型」分区退役一并移除，
// 见 skills-settings.ts 模块头），故直接 eval 原文即可。此前它自 v0.5.9 起因缺
// 同名常量以 ReferenceError 挂起（release/audit-v0.6.19.md 有档），v0.6.24 靠从
// media-models.ts 抽常量救回，那份夹具已随源文件一起消失。
// oxlint-disable-next-line no-eval -- 测试夹具:按模板字符串语义还原页面注入源码
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
  { id: 'disabled', title: '已停用（可恢复）', entries: [
    { name: 'parked-skill-w', description: '已停用暂存技能', source: 'disabled', path: '/tmp/park/w/SKILL.md' },
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
  refreshed[4].entries = []
  await win.webContents.executeJavaScript(`window.__dshSkillsSync(${JSON.stringify(refreshed)})`, true)
  await new Promise((r) => setTimeout(r, 200))
  const jumpProbe = await win.webContents.executeJavaScript(
    `(() => {
      const userRows = Array.from(document.querySelectorAll('.dsk-row')).filter(r => r.textContent.includes('database'))
      const enableBtns = Array.from(document.querySelectorAll('.dsk-enable')).map(b => b.textContent)
      return JSON.stringify({ userRowText: userRows.map(r => r.className), enableBtnsAfterEnable: enableBtns })
    })()`,
    true,
  )
  // 停用按钮交互：点击用户区 user-skill-y 行尾「停用」→ 模拟主进程应答成功 +
  // 目录刷新（该行跳到已停用区、按钮文案换「恢复」）；再点「恢复」→ 模拟失败
  // 应答（同名冲突）→ 按钮回「失败，重试」且复位可点
  const disableProbe = await win.webContents.executeJavaScript(
    `(() => {
      const row = document.querySelector('.dsk-row[data-path="/tmp/c/SKILL.md"]')
      if (row === null) return 'ROW MISSING'
      const btn = row.querySelector('.dsk-enable')
      if (btn === null) return 'BTN MISSING'
      const label = btn.textContent
      btn.click()
      return JSON.stringify({ label, btnText: btn.textContent, rowExpanded: row.classList.contains('on'), btnDisabled: btn.disabled })
    })()`,
    true,
  )
  await win.webContents.executeJavaScript(
    `window.__dshSkillsToggled(${JSON.stringify('/tmp/c/SKILL.md')}, true)`,
    true,
  )
  const parked = JSON.parse(JSON.stringify(refreshed))
  parked[2].entries = parked[2].entries.filter((e) => e.name !== 'user-skill-y')
  parked[3].entries.push({ name: 'user-skill-y', description: '用户测试技能', source: 'disabled', path: '/tmp/park/y/SKILL.md' })
  await win.webContents.executeJavaScript(`window.__dshSkillsSync(${JSON.stringify(parked)})`, true)
  await new Promise((r) => setTimeout(r, 200))
  const restoreProbe = await win.webContents.executeJavaScript(
    `(() => {
      const row = document.querySelector('.dsk-row[data-path="/tmp/park/y/SKILL.md"]')
      if (row === null) return 'ROW MISSING'
      const btn = row.querySelector('.dsk-enable')
      if (btn === null) return 'BTN MISSING'
      const label = btn.textContent
      btn.click()
      const busy = btn.textContent
      window.__dshSkillsToggled(${JSON.stringify('/tmp/park/y/SKILL.md')}, false)
      return JSON.stringify({ label, busy, afterFail: btn.textContent, disabledAfterFail: btn.disabled })
    })()`,
    true,
  )
  await new Promise((r) => setTimeout(r, 100))
  const probe = await win.webContents.executeJavaScript(
    `(() => {
      const kc = document.querySelector('.dsk-badge.kc')
      const plain = document.querySelector('.dsk-badge:not(.kc)')
      const info = (b) => b === null ? null : { text: b.textContent, color: getComputedStyle(b).color, bg: getComputedStyle(b).backgroundColor }
      // 退役面（2026-10-05：六个非编码技能 + 多媒体模型分区）：真实 DOM 里必须为 0。
      // 判别力自检：同一选择器必须能命中同形的**合成**节点——否则「0」只是选择器写错的假绿。
      const RETIRED_SEL = '.dsk-mg, .dsk-mf-i, .dsk-media-save, .dsk-media-ok'
      const retiredInDom = document.querySelectorAll(RETIRED_SEL).length
      const synth = document.createElement('div')
      // 合成节点按退役实现的真实形态造：保存键与提示位当时**同时**带 class 与 id，
      // 只给 id 会让类选择器命中不到——判别力自检第一次就是这么抓出夹具写错的（2/4）。
      // 注意：本段处在一个 JS 模板字符串里，注释中不得出现反引号。
      synth.innerHTML = '<div class="dsk-mg"></div><input class="dsk-mf-i"><button id="dsk-media-save" class="dsk-media-save"></button><span id="dsk-media-ok" class="dsk-media-ok"></span>'
      const retiredSelHits = synth.querySelectorAll(RETIRED_SEL).length
      const retiredTitle = Array.from(document.querySelectorAll('.dsk-gtitle')).some(t => t.textContent.includes('\u591a\u5a92\u4f53\u6a21\u578b'))
      return JSON.stringify({
        nav: ${JSON.stringify(label)}, click: ${JSON.stringify(clicked)},
        rows: document.querySelectorAll('.dsk-row').length,
        kcBadge: info(kc), plainBadge: info(plain),
        retiredInDom, retiredSelHits, retiredTitle,
      })
    })()`,
    true,
  )
  const result = JSON.parse(probe)
  // 断言：徽章文字非空；深色下 kc 徽章文字必须是深灰（真实变量）而非回退白
  const fails = []
  if (result.rows !== 10) fails.push(`rows=${result.rows} 应为 10`)
  if (!result.kcBadge || result.kcBadge.text !== 'KCoder') fails.push('kc 徽章文字缺失')
  if (!result.plainBadge || result.plainBadge.text === '') fails.push('普通徽章文字缺失')
  const en = JSON.parse(enableProbe)
  if (en.btnText !== '启用中…') fails.push(`按钮文字=${en.btnText} 应为「启用中…」（防重复点击态）`)
  if (en.btnDisabled !== true) fails.push('点击后按钮未禁用')
  if (en.rowExpanded === true) fails.push('按钮点击触发了行展开（stopPropagation 失效）')
  const jp = JSON.parse(jumpProbe)
  // database 启用成功跳用户区后：用户区三行（user-skill-y / shared-skill-z /
  // database）各带「停用」，已停用区一行带「恢复」，optional 已空 → 共 4 颗
  if (JSON.stringify(jp.enableBtnsAfterEnable) !== JSON.stringify(['停用', '停用', '停用', '恢复'])) {
    fails.push(`启用后动作钮异常: ${JSON.stringify(jp.enableBtnsAfterEnable)}`)
  }
  const dp = JSON.parse(disableProbe)
  if (dp.label !== '停用') fails.push(`停用按钮初始文案=${dp.label}`)
  if (dp.btnText !== '停用中…') fails.push(`停用中文案=${dp.btnText} 应为「停用中…」`)
  if (dp.btnDisabled !== true) fails.push('停用点击后未禁用')
  if (dp.rowExpanded === true) fails.push('停用按钮触发了行展开（stopPropagation 失效）')
  const rp = JSON.parse(restoreProbe)
  if (rp.label !== '恢复') fails.push(`已停用行按钮文案=${rp.label} 应为「恢复」`)
  if (rp.busy !== '恢复中…') fails.push(`恢复中文案=${rp.busy} 应为「恢复中…」`)
  if (rp.afterFail !== '失败，重试') fails.push(`失败应答后文案=${rp.afterFail} 应为「失败，重试」`)
  if (rp.disabledAfterFail !== false) fails.push('失败应答后按钮未复位可点')
  // 「多媒体模型」配置区已于 2026-10-05 随多媒体技能批退役移除
  // （skills-settings.ts 模块头有档）——此处原有一组渲染/回填/密码型/默认展开
  // 与保存链路的断言（6 组 / 21 输入框 / op=media-save / __dshSkillsMediaSaved），
  // 随分区一同删除。现在只留两条反向断言：退役面零残留 + 选择器非空转。
  if (result.retiredSelHits !== 4) {
    fails.push(`判别力自检失败：退役面选择器在合成节点上只命中 ${result.retiredSelHits}/4（下面的 0 是假绿）`)
  }
  if (result.retiredInDom !== 0) fails.push(`退役的多媒体分区仍在渲染：命中 ${result.retiredInDom} 个节点`)
  if (result.retiredTitle === true) fails.push('仍存在「多媒体模型」分组标题')
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
  const ok = light && dark
  // 退出码必须反映结论（2026-10-05 修）：此前失败只打印 SMOKE FAILED 却 exit 0，
  // 任何按退出码接线的门禁都会把红读成绿。
  process.exitCode = ok ? 0 : 1
  console.log(ok ? 'ALL PASS' : 'SMOKE FAILED')
  app.quit()
})
