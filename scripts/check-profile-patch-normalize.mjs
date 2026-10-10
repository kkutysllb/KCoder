/**
 * 平台互斥 entry 归一的逻辑门（2026-10-10）。
 *
 * 背景见 desktop/shared/platform-exclusive-entries.ts：上游 terminal-bundle 的
 * optional-terminal-bash / optional-terminal-pwsh 是**同一包的两个 entry**（共享
 * PTY 后端名 `shell`），插件页把对手那个打开会写下显式 `disabled: false` 压过
 * 平台条件 ⇒ 打包态「持久终端」组件异常、右栏终端不可用。本门钉住归一逻辑。
 *
 * 用法：node scripts/check-profile-patch-normalize.mjs（挂进 pnpm typecheck 链）
 * 退出码：0 = 全过；1 = 有断言失败。
 *
 * @module scripts/check-profile-patch-normalize
 */

const mod = await import(new URL('../desktop/shared/platform-exclusive-entries.ts', import.meta.url).href)

let passed = 0
let failed = 0
const ok = (name, cond) => { if (cond) { passed += 1 } else { failed += 1; console.error(`  ✗ ${name}`) } }
const eq = (name, actual, expected) => ok(`${name}（实际 ${JSON.stringify(actual)} / 期望 ${JSON.stringify(expected)}）`, JSON.stringify(actual) === JSON.stringify(expected))

const PWSH_ON_MAC = [
  '- id: dsh-kylin-memory',
  '  disabled: false',
  '- id: optional-terminal-pwsh',
  '  disabled: false',
  '',
].join('\n')

const r1 = mod.normalizePatchText(PWSH_ON_MAC, 'darwin')
ok('A1 darwin 上 pwsh 的显式 false 被纠为 true', r1.changed && r1.text.includes('- id: optional-terminal-pwsh\n  disabled: true'))
ok('A2 其它条目原样保留', r1.text.includes('- id: dsh-kylin-memory\n  disabled: false'))

const r2 = mod.normalizePatchText(r1.text, 'darwin')
ok('B1 幂等：二次归一不再改动', r2.changed === false && r2.text === r1.text)

const BASH_ON_WIN = ['- id: optional-terminal-bash', '  disabled: false', ''].join('\n')
const r3 = mod.normalizePatchText(BASH_ON_WIN, 'win32')
ok('C1 win32 上 bash 被纠为 true（对称方向）', r3.changed && r3.text.includes('disabled: true'))

const r3b = mod.normalizePatchText(BASH_ON_WIN, 'darwin')
ok('C2 darwin 上 bash 是「本平台该启用」的，不动它', r3b.changed === false)

const NO_KEY = ['- id: optional-terminal-pwsh', '  config:', '    shellDialect: pwsh', ''].join('\n')
const r4 = mod.normalizePatchText(NO_KEY, 'darwin')
ok('D1 块内无 disabled 键 → 追加  disabled: true', r4.changed && r4.text.includes('    shellDialect: pwsh\n  disabled: true'))

const ABSENT = ['- id: dsh-kylin-memory', '  disabled: false', ''].join('\n')
const r5 = mod.normalizePatchText(ABSENT, 'darwin')
ok('E1 entry 不存在 → 不新增、不改动', r5.changed === false && r5.text === ABSENT)

const CRLF = ['- id: optional-terminal-pwsh', '  disabled: false', ''].join('\r\n')
const r6 = mod.normalizePatchText(CRLF, 'darwin')
ok('F1 CRLF 行尾保留', r6.changed && r6.text.includes('\r\n') && r6.text.includes('disabled: true'))

const TWO = [
  '- id: optional-terminal-bash',
  '  disabled: false',
  '- id: optional-terminal-pwsh',
  '  disabled: false',
  '- id: tail-entry',
  '  disabled: false',
  '',
].join('\n')
const r7 = mod.normalizePatchText(TWO, 'darwin')
ok('G1 只动对手条目，前后条目与顺序不变',
  r7.text.split('\n').filter((l) => l.startsWith('- id:')).join('|') === '- id: optional-terminal-bash|- id: optional-terminal-pwsh|- id: tail-entry'
  && r7.text.includes('- id: optional-terminal-bash\n  disabled: false')
  && r7.text.includes('- id: optional-terminal-pwsh\n  disabled: true')
  && r7.text.includes('- id: tail-entry\n  disabled: false'))

const wrongMac = mod.wrongPlatformEntry('darwin')
const wrongWin = mod.wrongPlatformEntry('win32')
eq('H1 darwin 的对手是 pwsh', wrongMac, 'optional-terminal-pwsh')
eq('H2 win32 的对手是 bash', wrongWin, 'optional-terminal-bash')

console.log(`check-profile-patch-normalize: ${String(passed)} passed, ${String(failed)} failed`)
if (failed > 0) process.exit(1)
