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

function die(msg) {
  console.error(`[brand-assert] ${msg}`)
  process.exit(1)
}

const tar = process.argv[2]
if (!tar) die('用法：brand-assert.mjs <staging/kcoder-runtime.tar.gz>')

const tarOut = (args) =>
  execFileSync('tar', args, { encoding: 'utf8', maxBuffer: 1 << 26 })

const locale = tarOut(['-tzf', tar])
  .split('\n')
  .find((l) => l.includes('dsh-client-ui-chat/src/client/locale.ts'))
if (!locale) die('tar.gz 内无 dsh-client-ui-chat/src/client/locale.ts')

const text = tarOut(['-xzOf', tar, locale])
if (!text.includes("'chat.deepDiving': 'KCoder...'")) {
  die('chat.deepDiving 不是「KCoder...」——fork 修复 b11bd42095 未随 kcoder/alpha.2 推送/同步（先 push fork，再重新打包）')
}
if (text.includes('深度求索中')) {
  die('产物仍含「深度求索中」（fork 状态陈旧，同上一条）')
}
console.log('[brand-assert] 品牌断言通过（chat.deepDiving = KCoder...）')
