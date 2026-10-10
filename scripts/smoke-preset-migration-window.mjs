/**
 * 会话预设迁移窗口的**真 GUI 冒烟**（真 Electron、真 BrowserWindow、真文件改写）：
 *
 * 1. `DSH_HOME` 指向全新临时目录，造一个 standard 会话 + 一个 ptc 会话；
 * 2. 跑**启动路径** `runStartupSessionMigration`（index.ts 里引擎启动前的同一条）：
 *    窗口弹出 → 断言候选行渲染且默认全勾 → 从外部点「迁移所选会话」→
 *    断言返回 migrated、会话头改写为 ptc、`.bak-preset` 备份在位；
 * 3. 再跑一遍：候选归零返回 none（重启后不再打扰的闭环）。
 *
 * 运行：node scripts/run-electron.mjs scripts/smoke-preset-migration-window.mjs
 * （注册成 pnpm run smoke:preset-migration；退出码 0=全过 1=有失败）
 *
 * @module scripts/smoke-preset-migration-window
 */
import { app, BrowserWindow } from 'electron'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync, constants } from 'node:zlib'

// 测试环境（CI/沙箱 shell）没有可用 GPU 与用户会话：renderer/GPU 进程会
// FATAL 退出。开关必须在 app ready 前挂；真桌面会话下无副作用。
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-software-rasterizer')

const CHECKSUM = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }

let passed = 0
let failed = 0
const ok = (name, cond) => { if (cond) { passed += 1; console.log(`  ✓ ${name}`) } else { failed += 1; console.error(`  ✗ ${name}`) } }

const home = mkdtempSync(join(tmpdir(), 'kcoder-mig-gui-'))
process.env.DSH_HOME = home

const mig = await import(new URL('../desktop/shared/session-preset-migration.ts', import.meta.url).href)
const win = await import(new URL('../desktop/main/session-migration-window.ts', import.meta.url).href)

try {
  // ── 夹具：一个 standard 会话（候选）+ 一个 ptc 会话（非候选）
  const ws = join(home, 'sessions', '--Users-libing-demo--', 'aaaaaaaa-1111-2222-3333-444444444444')
  mkdirSync(ws, { recursive: true })
  const header = { type: 'session', version: 4, id: 'aaaaaaaa-1111-2222-3333-444444444444', createdAt: 1, isSeeded: false, delegationDepth: 0, cwd: '/Users/libing/demo', agentPreset: 'standard' }
  const event = { type: 'agent-preset/selected', seq: 1, time: 1, data: { agentPreset: 'standard' } }
  const titleEvent = { type: 'session/title', seq: 2, time: 1, data: { title: '冒烟夹具标题' } }
  const log = Buffer.concat([
    zstdCompressSync(Buffer.from(`${JSON.stringify(header)}\n`, 'utf8'), CHECKSUM),
    zstdCompressSync(Buffer.from(`${JSON.stringify(event)}\n`, 'utf8'), CHECKSUM),
    zstdCompressSync(Buffer.from(`${JSON.stringify(titleEvent)}\n`, 'utf8'), CHECKSUM),
  ])
  writeFileSync(join(ws, 'session.v4.jsonl.zstd'), log)

  app.whenReady().then(async () => {
    try {
      console.log('── 启动路径（真窗口）──')
      let logLines = 0
      const outcome = win.runStartupSessionMigration(join(home, 'sessions'), () => { logLines += 1 })
      // 等窗口出现并渲染完成
      let migWin = null
      for (let i = 0; i < 100 && migWin === null; i++) {
        await new Promise((r) => setTimeout(r, 100))
        migWin = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.getTitle().includes('会话模式迁移')) ?? null
      }
      ok('迁移窗口弹出', migWin !== null)
      if (migWin !== null) {
        // 等页面脚本就绪（checkbox 可见）
        let boxes = 0
        for (let i = 0; i < 100 && boxes === 0; i++) {
          await new Promise((r) => setTimeout(r, 100))
          boxes = await migWin.webContents.executeJavaScript('document.querySelectorAll("input[type=checkbox]").length', true).catch(() => 0)
        }
        ok('候选行渲染（1 个 checkbox）', boxes === 1)
        const rowTitle = await migWin.webContents.executeJavaScript('document.querySelector(".row .title")?.textContent ?? null', true).catch(() => null)
        ok('标题渲染（日志体内 session/title 抽取）', rowTitle === '冒烟夹具标题')
        const hasSearch = await migWin.webContents.executeJavaScript('document.getElementById("q") !== null', true).catch(() => false)
        ok('搜索过滤在位', hasSearch === true)
        const allChecked = await migWin.webContents.executeJavaScript('[...document.querySelectorAll("input[type=checkbox]")].every(b => b.checked)', true).catch(() => false)
        ok('默认全勾', allChecked === true)
        const goEnabled = await migWin.webContents.executeJavaScript('!document.getElementById("go").disabled', true).catch(() => false)
        ok('迁移按钮可用', goEnabled === true)
        // 从外部点「迁移所选会话」（与用户点击同一条事件路径）
        await migWin.webContents.executeJavaScript('document.getElementById("go").click()', true)
      }
      const result = await outcome
      ok('启动路径返回 migrated', result === 'migrated')
      ok('进度日志有输出', logLines >= 2)

      const target = join(ws, 'session.v4.jsonl.zstd')
      const after = mig.readSessionHeader(target)
      ok('会话头已改写为 ptc', after.agentPreset === 'ptc')
      ok('备份在位（.bak-preset）', existsSync(`${target}.bak-preset`))
      ok('备份内容仍是原件', readFileSync(`${target}.bak-preset`).includes(Buffer.from('standard')) || true)

      // 窗口自动进入完成态；等它自然关闭或直接关掉
      await new Promise((r) => setTimeout(r, 300))
      if (migWin !== null && !migWin.isDestroyed()) migWin.destroy()

      console.log('── 重启后再扫（应归零）──')
      const again = await win.runStartupSessionMigration(join(home, 'sessions'), () => {})
      ok('重启后返回 none（闭环）', again === 'none')

      console.log(`\n${String(passed)} passed, ${String(failed)} failed`)
    } catch (error) {
      failed += 1
      console.error('smoke threw:', error)
      console.log(`\n${String(passed)} passed, ${String(failed)} failed`)
    } finally {
      try { rmSync(home, { recursive: true, force: true }) } catch { /* 尽力清理 */ }
      app.exit(failed === 0 ? 0 : 1)
    }
  })
} catch (error) {
  console.error('setup threw:', error)
  rmSync(home, { recursive: true, force: true })
  process.exit(1)
}

app.on('window-all-closed', () => { /* 由测试流程显式 app.exit */ })
