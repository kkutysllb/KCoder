#!/usr/bin/env node
/**
 * 发布物品牌断言：fork 侧文案修复必须真实打进 staging 产物 tar。
 *
 * 0.4.5 现场：发布物构建（CI 于 tag 推送时克隆 fork）早于 fork push，
 * b11bd42095（chat.deepDiving「深度求索中…」→「KCoder...」）未进克隆
 * 态——dev 现象与发布物脱节（本地 dev 用本地 fork 工作树，恒为新值，
 * 更具迷惑性）。此后此类修复未随 kcoder/alpha.2 推送就打包，在产物
 * 层硬拦。release.sh（本地）与 release.yml（CI）共用本脚本。
 *
 * 用法：node scripts/brand-assert.mjs staging/kcoder-runtime.tar.gz
 */
import { execFileSync } from 'node:child_process'
import { basename, dirname, resolve } from 'node:path'

function die(msg) {
  console.error(`[brand-assert] ${msg}`)
  process.exit(1)
}

const tar = process.argv[2]
if (!tar) die('用法：brand-assert.mjs <staging/kcoder-runtime.tar.gz>')

// Windows + Git Bash 下把**绝对路径**交给 GNU tar 会被当成「远端主机」：
// `tar -tzf D:\…\x.tar.gz` → `tar (child): Cannot connect to D: resolve failed`
// （MSYS 把参数转写成 `D:/…`，GNU tar 见冒号即按 rsh 语法解析）。故一律切到所在
// 目录、只传基名——与 verify-runtime-providers / verify-runtime-experimental 同款。
// 而 release.sh 传的正是 $ROOT/staging/... 绝对路径，所以这一步在 Windows 上必死
// （2026-10-10 本机实测：相对路径通过、绝对路径 exit 1）。
const tarPath = resolve(tar)
const tarCwd = dirname(tarPath)
const tarName = basename(tarPath)

const tarOut = (args) =>
  execFileSync('tar', args, { cwd: tarCwd, encoding: 'utf8', maxBuffer: 1 << 26 })

const locale = tarOut(['-tzf', tarName])
  .split('\n')
  .find((l) => l.includes('dsh-client-ui-chat/src/client/locale.ts'))
if (!locale) die('tar.gz 内无 dsh-client-ui-chat/src/client/locale.ts')

const text = tarOut(['-xzOf', tarName, locale])
if (!text.includes("'chat.deepDiving': 'KCoder'")) {
  die('chat.deepDiving 不是「KCoder」——fork 侧品牌串未随 rc.2 排版跟进（0.2.0-rc.2 起去点；先 push fork 集成分支，再重新打包）')
}
if (text.includes('深度求索中')) {
  die('产物仍含「深度求索中」（fork 状态陈旧，同上一条）')
}
console.log('[brand-assert] 品牌断言通过（chat.deepDiving = KCoder）')
