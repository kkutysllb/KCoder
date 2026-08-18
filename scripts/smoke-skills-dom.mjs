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
<div role="dialog" aria-modal="true" style="display:flex;width:960px;height:600px;background:#1c1d1f;border-radius:12px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,.5)">
  <nav style="width:200px;background:#17181a;padding:16px 10px;flex:none;color:#e8eaed">
    <div style="font-weight:600;margin:0 8px 10px">设置</div>
    <div>
      <button type="button" class="nv on" aria-current="true"><svg width="16" height="16"><circle cx="8" cy="8" r="7" fill="#888"/></svg><span>通用</span></button>
      <button type="button" class="nv"><svg width="16" height="16"><circle cx="8" cy="8" r="7" fill="#888"/></svg><span>模型</span></button>
    </div>
  </nav>
  <div style="flex:1;padding:20px;overflow:auto;color:#e8eaed">
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
  const probe = await win.webContents.executeJavaScript(
    `(() => {
      const kc = document.querySelector('.dsk-badge.kc')
      const plain = document.querySelector('.dsk-badge:not(.kc)')
      const info = (b) => b === null ? null : { text: b.textContent, color: getComputedStyle(b).color, bg: getComputedStyle(b).backgroundColor }
      return JSON.stringify({
        nav: ${JSON.stringify(label)}, click: ${JSON.stringify(clicked)},
        rows: document.querySelectorAll('.dsk-row').length,
        kcBadge: info(kc), plainBadge: info(plain),
      })
    })()`,
    true,
  )
  const result = JSON.parse(probe)
  // 断言：徽章文字非空；深色下 kc 徽章文字必须是深灰（真实变量）而非回退白
  const fails = []
  if (result.rows !== 8) fails.push(`rows=${result.rows} 应为 8`)
  if (!result.kcBadge || result.kcBadge.text !== 'KCoder') fails.push('kc 徽章文字缺失')
  if (!result.plainBadge || result.plainBadge.text === '') fails.push('普通徽章文字缺失')
  if (vars === DARK_VARS) {
    if (result.kcBadge && result.kcBadge.color === 'rgb(255, 255, 255)') fails.push('深色主题 kc 徽章落回退 #fff（白底白字隐形，变量名又坏了）')
  }
  console.log(`[${label}]`, fails.length === 0 ? 'PASS' : 'FAIL: ' + fails.join('; '), '|', probe)
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
