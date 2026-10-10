/**
 * 归档写入器的**可执行**检查（2026-10-10）。
 *
 * 为什么必须是「真跑」而不是「看代码」：归档段连着两次翻车——自检流式回读把 CI 挂死 20 分钟、
 * 自检计数器作用域错误直接 `ReferenceError`——两者都能通过 `node --check`（纯语法）。
 *
 * 本检查：① 真打一个 tar.gz（普通文件 + 0755 可执行 + 超长路径）；
 *          ② 让**系统 tar** 读回来核对执行位/路径（外部工具 = 独立证据）；
 *          ③ 负对照：注入「mode 写死 0644」的回归形态，必须被拦下并抛错。
 */
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeTarGz } from './lib/tar-writer.mjs'

let passed = 0
let failed = 0
const ok = (cond, message) => {
  if (cond) { passed += 1; return }
  failed += 1
  console.error('  ✗ ' + message)
}

const dir = mkdtempSync(join(tmpdir(), 'check-tar-writer-'))
writeFileSync(join(dir, 'plain.txt'), 'hello\n')
mkdirSync(join(dir, 'bin'), { recursive: true })
writeFileSync(join(dir, 'bin', 'run.sh'), '#!/bin/sh\necho hi\n')
chmodSync(join(dir, 'bin', 'run.sh'), 0o755)
const deepRelDir = 'deep/' + 'x'.repeat(60) + '/' + 'y'.repeat(60)
mkdirSync(join(dir, ...deepRelDir.split('/')), { recursive: true })
writeFileSync(join(dir, ...deepRelDir.split('/'), 'tool'), 'x')
chmodSync(join(dir, ...deepRelDir.split('/'), 'tool'), 0o755)

const files = [
  { rel: 'plain.txt', abs: join(dir, 'plain.txt') },
  { rel: 'bin/run.sh', abs: join(dir, 'bin', 'run.sh') },
  { rel: deepRelDir + '/tool', abs: join(dir, ...deepRelDir.split('/'), 'tool') },
]
const tarPath = join(dir, 'out.tar.gz')
const res = await writeTarGz(files, tarPath)
ok(res.files === 3, '归档文件数为 3（实际 ' + res.files + '）')
ok(res.execChecked === 2, '可执行文件计数为 2（实际 ' + res.execChecked + '）')

const tv = spawnSync('tar', ['-tvzf', tarPath], { encoding: 'utf8' })
ok(tv.status === 0, '系统 tar 能读取产物（status ' + tv.status + '）')
ok(/rwxr-xr-x[^\n]*bin\/run\.sh/.test(tv.stdout), 'run.sh 的执行位被系统 tar 认出')
ok(tv.stdout.includes('/tool'), '超长路径项存在（GNU LongName 路径）')
ok(/rwxr-xr-x[^\n]*\/tool/.test(tv.stdout), '超长路径项的执​行位被认出')

let threw = null
try {
  await writeTarGz(files, join(dir, 'bad.tar.gz'), { modeOf: () => 0o644 })
} catch (err) {
  threw = String(err instanceof Error ? err.message : err)
}
ok(threw !== null && threw.includes('归档自检失败'), '负对照：mode 写死 0644 必须被拦下（实际 ' + String(threw) + '）')

console.log('check-tar-writer: ' + passed + ' passed, ' + failed + ' failed')
if (failed > 0) process.exit(1)
